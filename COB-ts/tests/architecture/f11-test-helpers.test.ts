/**
 * F11 (COB-architecture.md §6; §5 A12b, revision 14): test helpers have one home.
 * Scope: every tests/ca/**\/*.ts except tests/ca/support/** (the one home) and tests/ca/golden/**
 * (the A0 guard stays self-contained). Comments are stripped with support.ts `stripComments`;
 * F11a-e match per line, F11f per file.
 * QA-owned (A12b red step, 2026-09-29). The developer must not edit this file.
 * Red when written: 14 / 27 / 12 / 35 / 3 / 85 hits (F11a-f); green after the A12b migration.
 */
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ROOT, fmt, grepCode, listFiles, read, rel, stripComments } from './support.js';

const TESTS_CA = join(ROOT, 'tests', 'ca');
const SCOPE = listFiles(TESTS_CA, /\.ts$/).filter((f) => {
  const r = rel(f);
  return !r.startsWith('tests/ca/support/') && !r.startsWith('tests/ca/golden/');
});

/** F11a: no fixture path built outside support/fixtures.ts. */
const F11A = /new URL\(\s*['"`][^'"`]*fixtures\//;
/** F11b: no UTC-midnight date template outside support/builders.ts. */
const F11B = /new Date\(`\$\{[^}]*\}T00:00:00Z`\)/;
/** F11c: no relative-error formula outside support/compare.ts. */
const F11C = /Math\.max\(\s*Math\.abs\([^)]*\),\s*(Math\.abs\(|1\s*\))/;
/** F11d: no double cast to the input type; use `asInput`. */
const F11D = /as\s+unknown\s+as\s+CobCanadaInput\b/;
/** F11e: no local RangeError-throw helper; use `expectRangeErrorMatching`. */
const F11E = /expect\(caught, 'expected a throw'\)\.toBeInstanceOf\(RangeError\)/;
/** F11f: named imports from a src/ca/<module>.js path. */
const F11F = /import\s+(?:type\s+)?\{([^}]*)\}\s*from\s*'((?:\.\.\/)+src\/ca\/([a-zA-Z]+)\.js)'/g;

/** Names in the barrel's `export {…}` / `export type {…}` lists (exported name, after any `as`). */
function barrelNames(): Set<string> {
  const code = stripComments(read(join(ROOT, 'src', 'ca', 'index.ts')));
  const names = new Set<string>();
  for (const m of code.matchAll(/export\s+(?:type\s+)?\{([^}]*)\}/g)) {
    for (const raw of m[1]!.split(',')) {
      const n = raw.trim().replace(/^type\s+/, '').split(/\s+as\s+/).pop()!.trim();
      if (n) names.add(n);
    }
  }
  return names;
}

/** Every barrel name imported by name from a src/ca module other than index. */
function internalBarrelImports(files: string[]): string[] {
  const barrel = barrelNames();
  const out: string[] = [];
  for (const f of files) {
    const code = stripComments(read(f));
    for (const m of code.matchAll(F11F)) {
      if (m[3] === 'index') continue;
      const line = code.slice(0, m.index).split('\n').length;
      for (const raw of m[1]!.split(',')) {
        const name = raw.trim().replace(/^type\s+/, '').split(/\s+as\s+/)[0]!.trim();
        if (name && barrel.has(name)) out.push(`${rel(f)}:${line} ${name} from ${m[2]}`);
      }
    }
  }
  return out;
}

describe('F11 test helpers have one home (tests/ca/support)', () => {
  it('F11a: no fixture path built outside support/fixtures.ts (use loadFixture)', () => {
    expect(SCOPE.length, 'F11 scope must not be empty').toBeGreaterThan(30);
    expect(fmt(grepCode(SCOPE, F11A))).toEqual([]);
  });
  it('F11b: no UTC-midnight date template outside support/builders.ts (use utcDate)', () => {
    expect(fmt(grepCode(SCOPE, F11B))).toEqual([]);
  });
  it('F11c: no relative-error formula outside support/compare.ts (use withinRel / relDiffFloor1)', () => {
    expect(fmt(grepCode(SCOPE, F11C))).toEqual([]);
  });
  it('F11d: no `as unknown as CobCanadaInput` (use asInput)', () => {
    expect(fmt(grepCode(SCOPE, F11D))).toEqual([]);
  });
  it('F11e: no local RangeError-throw helper (use expectRangeErrorMatching)', () => {
    expect(fmt(grepCode(SCOPE, F11E))).toEqual([]);
  });
  it('F11f: barrel names are imported from src/ca/index.js, not from internal module paths', () => {
    expect(barrelNames().has('calculateCobCanada'), 'barrel list must be read').toBe(true);
    expect(internalBarrelImports(SCOPE)).toEqual([]);
  });
});
