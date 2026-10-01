/**
 * F10 (COB-architecture.md §6, added in A15): no dangling references. Permanent check.
 * - Every relative import/export specifier in src/**\/*.ts, tests/**\/*.ts and ui/*.js
 *   (and ui/*.mjs) resolves to an existing file: the literal path first, then .js -> .ts.
 * - Every '/dist/X.js' import in ui/*.js maps to an existing src/X.ts.
 * - Every <script src> in ui/*.html exists (absolute paths are from the project root,
 *   as ui/serve.mjs serves it).
 * Green before and after A15; it is the no-dangling-reference proof for the deletion.
 *
 * A15 guard (COB-architecture.md §5 A15, ADR-13(b); QA 2026-09-27): the 35 US-library
 * files are gone and no legacy US text remains in ui/serve.mjs, src/ca/types.ts,
 * README.md or the package.json description. Red until the A15 deletion and rewrites land.
 */
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ROOT, importsOf, listFiles, read, rel } from './support.js';

const codeFiles = [
  ...listFiles(join(ROOT, 'src'), /\.ts$/),
  ...listFiles(join(ROOT, 'tests'), /\.ts$/),
  ...listFiles(join(ROOT, 'ui'), /\.m?js$/).filter((f) => dirname(f) === join(ROOT, 'ui')),
];
const edges = codeFiles.flatMap(importsOf);
const relativeEdges = edges.filter((e) => e.spec.startsWith('.'));

function resolves(target: string): boolean {
  const abs = join(ROOT, target);
  if (existsSync(abs)) return true;
  return abs.endsWith('.js') && existsSync(abs.slice(0, -3) + '.ts');
}

const uiJs = listFiles(join(ROOT, 'ui'), /\.m?js$/).filter((f) => dirname(f) === join(ROOT, 'ui'));
const distEdges = uiJs.flatMap(importsOf).filter((e) => e.spec.startsWith('/dist/'));

const htmlFiles = listFiles(join(ROOT, 'ui'), /\.html$/).filter((f) => dirname(f) === join(ROOT, 'ui'));
const scripts = htmlFiles.flatMap((f) =>
  [...read(f).matchAll(/<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi)].map((m) => ({
    file: rel(f),
    src: m[1]!,
  })),
);

describe('F10 no dangling references', () => {
  it('F10: the scan is not vacuous (src, tests and ui all contribute relative specifiers)', () => {
    const from = new Set(relativeEdges.map((e) => e.file.split('/')[0]));
    expect([...from].sort()).toEqual(expect.arrayContaining(['src', 'tests']));
    expect(relativeEdges.length).toBeGreaterThan(50);
    expect(distEdges.map((e) => e.spec)).toContain('/dist/ca/index.js');
    expect(scripts.map((s) => s.src)).toContain('/ui/ca.js');
  });

  it('F10: every relative import/export specifier resolves (literal path, then .js -> .ts)', () => {
    const bad = relativeEdges.filter((e) => !resolves(e.resolved!));
    expect(bad.map((e) => `${e.file}:${e.line} ${e.spec}`)).toEqual([]);
  });

  it("F10: every '/dist/X.js' import in ui/*.js maps to an existing src/X.ts", () => {
    const bad = distEdges.filter((e) => !/^\/dist\/.+\.js$/.test(e.spec) || !existsSync(join(ROOT, 'src', e.spec.slice(6, -3) + '.ts')));
    expect(bad.map((e) => `${e.file}:${e.line} ${e.spec}`)).toEqual([]);
  });

  it('F10: every <script src> in ui/*.html exists', () => {
    const bad = scripts.filter((s) => {
      const target = s.src.startsWith('/') ? join(ROOT, s.src) : resolve(ROOT, dirname(s.file), s.src);
      return !existsSync(target);
    });
    expect(bad.map((s) => `${s.file} ${s.src}`)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------
// A15 guard

const US_SRC = [
  'arm', 'compare', 'costs', 'dscr', 'extraPayment', 'importOverrides', 'loan', 'ltv', 'money',
  'mortgage', 'payment', 'paymentFrequency', 'pmi', 'points', 'refinance', 'segment', 'types', 'validate',
];
const US_TESTS = [
  'arm', 'compare', 'costs', 'dscr', 'extraPayment', 'importOverrides', 'loan', 'ltv', 'mortgage',
  'payment', 'paymentFrequency', 'pmi', 'points', 'refinance', 'segment',
];
const A15_DELETED = [
  ...US_SRC.map((m) => `src/${m}.ts`),
  ...US_TESTS.map((m) => `tests/${m}.test.ts`),
  'ui/index.html',
  'ui/main.js',
];

// The 24 US runtime exports removed from the root by ADR-13(b).
const US_API = [
  'addMonths', 'annuityPaymentFromPeriodicRate', 'applyRecurringCosts', 'calculateArmResetRate',
  'calculateExtraPaymentSavings', 'calculateMonthlyPayment', 'calculatePaymentFrequencySchedule',
  'calculatePmiPayment', 'calculatePointsBreakeven', 'calculateRefinanceBreakeven', 'combinedLoanToValue',
  'compareLoanTerms', 'compareRefinance', 'computeMortgageSchedule', 'computeSegmentSchedule',
  'debtServiceCoverageRatio', 'fromHomePrice', 'importOverridesFromCsv', 'importOverridesFromJson',
  'loanToValue', 'round2', 'summarizeLoan', 'summarizeMortgage', 'toSingleSegmentMortgage',
];

describe('A15 US library deleted', () => {
  it('A15: the delete list is exactly 35 files (18 src, 15 tests, 2 ui)', () => {
    expect(new Set(A15_DELETED).size).toBe(35);
    expect(US_SRC).toHaveLength(18);
    expect(US_TESTS).toHaveLength(15);
    expect(US_API).toHaveLength(24);
  });

  it('A15: none of the 35 paths exists', () => {
    expect(A15_DELETED.filter((p) => existsSync(join(ROOT, p)))).toEqual([]);
  });

  it("A15: ui/serve.mjs mentions neither 'index.html' nor 'legacy'", () => {
    const lines = read(join(ROOT, 'ui', 'serve.mjs')).split('\n');
    const hits = lines.flatMap((l, i) => (/index\.html|legacy/i.test(l) ? [`ui/serve.mjs:${i + 1} ${l.trim()}`] : []));
    expect(hits).toEqual([]);
  });

  it('A15: src/ca/types.ts no longer cites src/payment.ts, src/segment.ts or src/mortgage.ts', () => {
    const text = read(join(ROOT, 'src', 'ca', 'types.ts'));
    expect(['src/payment.ts', 'src/segment.ts', 'src/mortgage.ts'].filter((s) => text.includes(s))).toEqual([]);
  });

  it('A15: README.md describes the COB calculator (ui/ca.html) and names no deleted module or US API', () => {
    const text = read(join(ROOT, 'README.md'));
    expect(text).toContain('ui/ca.html');
    expect(text).not.toMatch(/calculator\.net/i);
    const modRe = new RegExp(`(?<![\\w/]ca/)\\b(?:${US_SRC.join('|')})\\.(?:ts|js)\\b`, 'g');
    expect([...text.matchAll(modRe)].map((m) => m[0])).toEqual([]);
    expect(US_API.filter((n) => new RegExp(`\\b${n}\\b`).test(text))).toEqual([]);
  });

  it('A15: package.json description is the COB (Canada) engine; main/types unchanged', () => {
    const pkg = JSON.parse(read(join(ROOT, 'package.json'))) as Record<string, unknown>;
    expect(pkg.description).toBe('Cost of Borrowing (COB) calculator engine (Canada)');
    expect(pkg.main).toBe('./dist/index.js');
    expect(pkg.types).toBe('./dist/index.d.ts');
  });
});
