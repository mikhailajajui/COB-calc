/**
 * A0 golden-master characterisation (COB-architecture.md §5 A0). Tests only; green on the
 * code of 2026-09-27.
 *
 * Every case of the corpus in fixtures/generate_golden.mjs goes through calculateCobCanada.
 * The test compares JSON.stringify(result) hashes per group against
 * fixtures/golden_engine_v1.json. For the 6 long 30-year cases it compares the full JSON.
 * A mismatch names the group, the first differing case (its inputs), and the headline
 * fields that differ, expected vs actual.
 *
 * REGENERATING golden_engine_v1.json IS ALLOWED ONLY in a task that is an approved
 * behaviour change (a B backlog item or a decided OQ), in that same task, with every
 * changed group key listed in CHANGES.md. Refactors (R items) must never regenerate: a red
 * golden test during a refactor means the refactor changed behaviour. Never hand-edit the
 * fixture. Command: `npx vite-node tests/ca/fixtures/generate_golden.mjs --write`.
 *
 * B14 (OQ-Y revised, approved regeneration 2026-09-28): extra:zeroPayment is swapped for
 * extra:minimumPayment ($0.01) in the corpus. The per-group loop runs over the union of the
 * golden file's keys and the corpus keys, so until the fixture is regenerated exactly two
 * group tests are red (the removed key and the added key) plus the corpus-shape key check;
 * the other 147 groups and the 6 long cases stay green.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { calculateCobCanada } from '../../../src/ca/cobCanada.js';
import type { CobCanadaInput, CobCanadaResult } from '../../../src/ca/types.js';
// @ts-ignore -- plain .mjs shared with the generator (no .d.ts); tests are not typechecked yet (F8).
import * as corpus from '../fixtures/generate_golden.mjs';

type CaseTuple = [string, ...(number | null)[]];
interface GoldenGroup { hash: string; n: number; cases: CaseTuple[] }
interface GoldenFile {
  caseFields: string[];
  groups: Record<string, GoldenGroup>;
  long: Record<string, { scalars: Record<string, unknown>; amortizationSchedule: unknown[] }>;
}
interface Computed { groups: Record<string, GoldenGroup>; long: Record<string, unknown> }

const golden: GoldenFile = JSON.parse(
  readFileSync(fileURLToPath(new URL('../fixtures/golden_engine_v1.json', import.meta.url)), 'utf8'),
);
const calc = (input: CobCanadaInput): CobCanadaResult => calculateCobCanada(input);
const groupsDef: { key: string; extra: boolean; cases: { label: string; params: unknown }[] }[] = corpus.buildGroups();

/** Human-readable diff for a group whose hash changed. */
function explainGroup(key: string, expected: GoldenGroup, actual: GoldenGroup): string {
  const def = groupsDef.find((g) => g.key === key);
  if (expected.n !== actual.n) return `group ${key}: case count ${expected.n} -> ${actual.n}`;
  const i = expected.cases.findIndex((c, j) => c[0] !== actual.cases[j]![0]);
  if (i < 0) return `group ${key}: group hash differs but every case hash matches (case order changed?)`;
  const fields = golden.caseFields.slice(1);
  const diffs = fields
    .map((f, k) => [f, expected.cases[i]![k + 1], actual.cases[i]![k + 1]] as const)
    .filter(([, e, a]) => !Object.is(e, a))
    .map(([f, e, a]) => `    ${f}: expected ${String(e)}, actual ${String(a)}`);
  const nDiff = expected.cases.filter((c, j) => c[0] !== actual.cases[j]![0]).length;
  return [
    `GOLDEN MISMATCH in group ${key}: ${nDiff} of ${expected.n} cases differ.`,
    `  first differing case #${i}: ${def?.cases[i]?.label ?? '?'}`,
    ...(diffs.length
      ? diffs
      : ['    headline fields identical; the difference is in schedule rows or another result field.']),
  ].join('\n');
}

/** First differing JSON path between two plain values (exact, Object.is for numbers). */
function firstDiff(e: unknown, a: unknown, path = '$'): string | null {
  if (typeof e !== 'object' || e === null || typeof a !== 'object' || a === null) {
    return Object.is(e, a) ? null : `${path}: expected ${JSON.stringify(e)}, actual ${JSON.stringify(a)}`;
  }
  const keys = [...new Set([...Object.keys(e), ...Object.keys(a)])];
  for (const k of keys) {
    const d = firstDiff((e as Record<string, unknown>)[k], (a as Record<string, unknown>)[k], `${path}.${k}`);
    if (d) return d;
  }
  return null;
}

let computed: Computed;
beforeAll(() => {
  computed = corpus.computeGolden(calc);
});

describe('A0 golden master: corpus shape', () => {
  // B27 (DEV-FB24, approved 2026-09-30): a personal loan is Monthly only, so the 54 personal-loan
  // weekly/biweekly/semiMonthly core groups (1,404 cases) are gone: 144 -> 90 core groups and
  // 3,744 -> 2,340 core cases; extra:underpayment is trimmed to its Monthly cases (312 -> 78); 94 groups, 2,817 cases.
  it('2,340 core cases in 90 groups (26 dates x 12 of the 16 freq x product/rate pairs x 3 fees x 3 flows) + 4 extra groups; 94 groups / 2,817 cases in all (B27)', () => {
    const core = groupsDef.filter((g) => !g.extra);
    expect(core).toHaveLength(90);
    expect(core.reduce((s, g) => s + g.cases.length, 0)).toBe(2340);
    expect(groupsDef).toHaveLength(94);
    expect(groupsDef.reduce((s, g) => s + g.cases.length, 0)).toBe(2817);
    expect(groupsDef.find((g) => g.key === 'extra:underpayment')!.cases).toHaveLength(78);
    expect(groupsDef.filter((g) => g.extra).map((g) => g.key)).toEqual([
      'extra:minimumPayment',
      'extra:underpayment',
      'extra:semiMonthlyMonthEnd',
      'extra:monthlyMonthEnd',
    ]);
    expect(Object.keys(golden.groups)).toEqual(groupsDef.map((g) => g.key));
    expect(Object.keys(golden.long)).toHaveLength(6);
    // B27: no corpus input is a personal loan at a non-monthly frequency.
    for (const g of groupsDef)
      for (const c of g.cases) {
        const p = c.params as { productType: string; frequency: string };
        expect(p.productType === 'personalLoan' && p.frequency !== 'monthly', `${g.key}: ${c.label}`).toBe(false);
      }
  });

  it('the 26 first-payment dates are every 29th day from 2027-01-01 and cross Feb 29 2028', () => {
    const dates: Date[] = corpus.FIRST_DATES;
    expect(dates[0]!.toISOString()).toBe('2027-01-01T00:00:00.000Z');
    expect(dates[25]!.toISOString()).toBe('2028-12-26T00:00:00.000Z');
    const feb29 = Date.UTC(2028, 1, 29);
    expect(dates.some((d) => d.getTime() < feb29) && dates.some((d) => d.getTime() > feb29)).toBe(true);
  });
});

describe('A0 golden master: per-group hashes', () => {
  // Union of golden and corpus keys, so a group added to the corpus but missing from the golden
  // file is its own red test (not only the shape check).
  const keys = [...new Set([...Object.keys(golden.groups), ...groupsDef.map((g) => g.key)])];
  for (const key of keys) {
    it(key, () => {
      const expected = golden.groups[key];
      const actual = computed.groups[key];
      if (!expected) expect.fail(`group ${key} is produced by the corpus but is not in golden_engine_v1.json`);
      if (!actual) expect.fail(`group ${key} is no longer produced by the corpus`);
      if (actual.hash !== expected.hash) expect.fail(explainGroup(key, expected, actual));
    });
  }
});

describe('A0 golden master: 30-year cases (full JSON)', () => {
  for (const key of Object.keys(golden.long)) {
    it(key, () => {
      const { scalars, amortizationSchedule } = golden.long[key]!;
      // Schedule first, so the message points at the first differing row and field.
      const { amortizationSchedule: actualRows, ...actualScalars } = computed.long[key] as Record<string, unknown>;
      const d =
        firstDiff(amortizationSchedule, actualRows, '$.amortizationSchedule') ?? firstDiff(scalars, actualScalars);
      if (d) expect.fail(`GOLDEN MISMATCH in ${key}: ${d}`);
    });
  }
});

/** Self-checks: the extra groups really exercise the paths they are there for. */
describe('A0 golden master: extra groups hit their paths', () => {
  const run = (key: string) =>
    groupsDef.find((g) => g.key === key)!.cases.map((c) => calc(corpus.makeInput(c.params)));

  // B19 (DEV-OQL, 2026-09-29): unpaid interest is never capitalised, so every case now ends at exactly 250,000
  // (was: 104 renewal850 flat, 208 grown by OQ-L capitalisation).
  it('minimumPayment (OQ-Y revised): every row pays 0.01, no fee or principal is paid; every case ends at exactly 250,000 (B19, DEV-OQL: no interest on unpaid interest)', () => {
    const cases = groupsDef.find((g) => g.key === 'extra:minimumPayment')!.cases;
    expect(cases).toHaveLength(312);
    let flat = 0;
    run('extra:minimumPayment').forEach((r, i) => {
      expect(r.amortizationSchedule.length).toBeGreaterThan(0);
      expect(r.amortizationSchedule.every((row) => row.paymentAmount === 0.01)).toBe(true);
      expect(r.amortizationSchedule.every((row) => row.feesPaid === 0)).toBe(true);
      expect(r.amortizationSchedule.every((row) => row.principalPortion === 0)).toBe(true);
      if (cases[i]!.label.endsWith('flow=renewal850 payment=0.01')) {
        flat += 1;
      }
      expect(r.endingBalance).toBe(250000);
    });
    expect(flat).toBe(104);
  });

  it('underpayment (T6/OQ-L): payment < first-period interest in every case', () => {
    for (const r of run('extra:underpayment')) {
      const row1 = r.amortizationSchedule[0]!;
      expect(row1.paymentAmount).toBeLessThan(row1.periodInterest);
      expect(row1.carriedAccruedInterestClosing).toBeGreaterThan(0);
    }
  });

  it('semiMonthlyMonthEnd (T4): 15th/month-end alternation, 14th -> Feb 28, 16th -> 1st', () => {
    const cases = groupsDef.find((g) => g.key === 'extra:semiMonthlyMonthEnd')!.cases;
    const dates = (first: string) => {
      const c = cases.find((x) => x.label.startsWith(`first=${first} `))!;
      return calc(corpus.makeInput(c.params)).amortizationSchedule.slice(0, 4).map((r) => r.date.toISOString().slice(0, 10));
    };
    expect(dates('2027-01-31')).toEqual(['2027-01-31', '2027-02-15', '2027-02-28', '2027-03-15']);
    expect(dates('2027-02-14')).toEqual(['2027-02-14', '2027-02-28', '2027-03-14', '2027-03-29']);
    expect(dates('2027-01-16')).toEqual(['2027-01-16', '2027-02-01', '2027-02-16', '2027-03-01']);
  });

  it('monthlyMonthEnd (T3/OQ-X): Feb 28 2027 -> Mar 31 (OQ-X), Jan 30 -> Feb 28 -> Mar 30 (T3 clamp)', () => {
    const cases = groupsDef.find((g) => g.key === 'extra:monthlyMonthEnd')!.cases;
    const dates = (first: string) => {
      const c = cases.find((x) => x.label.startsWith(`first=${first} `))!;
      return calc(corpus.makeInput(c.params)).amortizationSchedule.slice(0, 3).map((r) => r.date.toISOString().slice(0, 10));
    };
    expect(dates('2027-02-28')).toEqual(['2027-02-28', '2027-03-31', '2027-04-30']);
    expect(dates('2027-01-30')).toEqual(['2027-01-30', '2027-02-28', '2027-03-30']);
  });

  it('long cases: payoff variants reach 0 before End, noPayoff variants do not', () => {
    for (const [key, v] of Object.entries(golden.long)) {
      const bal = v.scalars.endingBalance as number;
      if (key.endsWith(':payoff')) expect(bal).toBe(0);
      else expect(bal).toBeGreaterThan(0);
    }
  });
});
