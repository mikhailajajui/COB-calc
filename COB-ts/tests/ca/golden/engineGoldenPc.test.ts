/**
 * B18 golden-master characterisation for Payment Change and VRPC (COB-architecture.md §5 B18,
 * revision 18). Tests only; green on the code of 2026-09-29. User approval 2026-09-29 for this
 * second golden fixture.
 *
 * Every case of the corpus in fixtures/generate_golden_pc.mjs goes through calculateCobCanada.
 * The test compares JSON.stringify(result) hashes per group against
 * fixtures/golden_engine_pc_v1.json, and the full JSON of the 2 long 30-year cases. A mismatch
 * names the group, the first differing case (its inputs), and the headline fields that differ.
 * golden_engine_v1.json is a separate fixture and is not touched by this file.
 *
 * REGENERATING golden_engine_pc_v1.json IS ALLOWED ONLY in a task that is an approved
 * behaviour change (a B backlog item or a decided OQ), in that same task, with every changed
 * group key listed in CHANGES.md. Refactors (R items) must never regenerate. Never hand-edit
 * the fixture. Command: `npx vite-node tests/ca/fixtures/generate_golden_pc.mjs --write`.
 *
 * Besides the hashes, B18-P1..P6 pin the design facts that make later items move this fixture
 * only where intended (B19: 2 groups + 1 long case; B20-B25: none), B18-INV-flow-equivalence
 * pins that the engine treats Renewal / Payment Change / VRPC identically for mortgages, and
 * B18-FB16 pins QA's FB-16 probe (decision 2) as reference figures for B22.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { calculateCobCanada } from '../../../src/ca/cobCanada.js';
import type { CobCanadaInput, CobCanadaResult } from '../../../src/ca/types.js';
// @ts-ignore -- plain .mjs shared with the generator (no .d.ts).
import * as corpus from '../fixtures/generate_golden_pc.mjs';

type CaseTuple = [string, ...(number | null)[]];
interface GoldenGroup { hash: string; n: number; cases: CaseTuple[] }
interface GoldenFile {
  version: string;
  caseFields: string[];
  groups: Record<string, GoldenGroup>;
  long: Record<string, { scalars: Record<string, unknown>; amortizationSchedule: unknown[] }>;
}
interface Computed { groups: Record<string, GoldenGroup>; long: Record<string, unknown> }
interface CaseParams {
  first: Date;
  frequency: string;
  productType: string;
  rateType: string;
  feeSet: string;
  flowKey: 'pc' | 'vrpc';
  accKey: 'acc0' | 'acc850';
  payment?: number;
}
interface GroupDef { key: string; extra: boolean; cases: { label: string; params: CaseParams }[] }

const golden: GoldenFile = JSON.parse(
  readFileSync(fileURLToPath(new URL('../fixtures/golden_engine_pc_v1.json', import.meta.url)), 'utf8'),
);
const calc = (input: CobCanadaInput): CobCanadaResult => calculateCobCanada(input);
const groupsDef: GroupDef[] = corpus.buildGroups();
const input = (p: CaseParams): CobCanadaInput => corpus.makeInput(p);
const ymd = (d: Date) => d.toISOString().slice(0, 10);

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
/** Every corpus case with its result, for the property tests (group key, label, params, result). */
let runs: { key: string; extra: boolean; label: string; params: CaseParams; result: CobCanadaResult }[];
beforeAll(() => {
  computed = corpus.computeGolden(calc);
  runs = groupsDef.flatMap((g) =>
    g.cases.map((c) => ({ key: g.key, extra: g.extra, label: c.label, params: c.params, result: calc(input(c.params)) })),
  );
});

describe('B18 golden master (PC/VRPC): corpus shape', () => {
  // B27 (DEV-FB24, approved 2026-09-30): personal loans are Monthly only, so 36 regular pc groups
  // (936 cases) are gone (120 -> 84 groups, 3,120 -> 2,184 cases), pcx:underpayment is trimmed to its
  // Monthly cases (208 -> 52), and the weekly personal-loan long case is replaced by the monthly one.
  it('B18-S1 (B27): 84 regular groups (2,184 cases) + pcx:underpayment (52) and vrpcx:minimumPayment (208); 86 groups / 2,444 cases; fixture keys = corpus keys; 2 long cases', () => {
    const regular = groupsDef.filter((g) => !g.extra);
    expect(regular).toHaveLength(84);
    expect(regular.filter((g) => g.key.startsWith('pc|'))).toHaveLength(60);
    expect(regular.filter((g) => g.key.startsWith('vrpc|'))).toHaveLength(24);
    expect(regular.every((g) => g.cases.length === 26)).toBe(true);
    expect(regular.reduce((s, g) => s + g.cases.length, 0)).toBe(2184);
    expect(groupsDef).toHaveLength(86);
    expect(groupsDef.reduce((s, g) => s + g.cases.length, 0)).toBe(2444);
    const extras = groupsDef.filter((g) => g.extra);
    expect(extras.map((g) => g.key)).toEqual(['pcx:underpayment', 'vrpcx:minimumPayment']);
    expect(extras.map((g) => g.cases.length)).toEqual([52, 208]);
    expect(groupsDef[0]!.key).toBe('pc|weekly|mortgage/fixed|none|acc0');
    expect(groupsDef[83]!.key).toBe('vrpc|monthly|mortgage/variable|fin2000cash400|acc850');
    expect(golden.version).toBe('golden_engine_pc_v1');
    expect(Object.keys(golden.groups)).toEqual(groupsDef.map((g) => g.key));
    // B27: no corpus input is a personal loan at a non-monthly frequency.
    for (const g of groupsDef)
      for (const c of g.cases)
        expect(c.params.productType === 'personalLoan' && c.params.frequency !== 'monthly', `${g.key}: ${c.label}`).toBe(false);
    expect(Object.keys(golden.long)).toEqual(['long:vrpc:monthly:acc850', 'long:pc:monthly:acc850:underpayment']);
  });

  it('B18-S2: SEMI_FIRST_DATES alternate 15th / month end and contain 2028-02-29; lastPaymentDate gives the 9 worked examples', () => {
    const semi: Date[] = corpus.SEMI_FIRST_DATES;
    expect(semi).toHaveLength(26);
    expect(ymd(semi[0]!)).toBe('2027-01-15');
    expect(ymd(semi[1]!)).toBe('2027-02-28');
    expect(ymd(semi[13]!)).toBe('2028-02-29');
    expect(ymd(semi[25]!)).toBe('2029-02-28');
    semi.forEach((d, k) => {
      expect(d.getUTCMonth()).toBe(k % 12);
      if (k % 2 === 0) expect(d.getUTCDate()).toBe(15);
      else expect(new Date(d.getTime() + 86_400_000).getUTCDate()).toBe(1);
    });
    const lpd = (f: string, first: string) =>
      ymd(corpus.lastPaymentDate(f, new Date(`${first}T00:00:00.000Z`)) as Date);
    expect(lpd('weekly', '2027-01-01')).toBe('2026-12-25');
    expect(lpd('biweekly', '2028-01-13')).toBe('2027-12-30');
    expect(lpd('semiMonthly', '2027-01-15')).toBe('2026-12-31');
    expect(lpd('semiMonthly', '2027-02-28')).toBe('2027-02-15');
    expect(lpd('semiMonthly', '2028-02-29')).toBe('2028-02-15');
    expect(lpd('monthly', '2027-01-01')).toBe('2026-12-01');
    expect(lpd('monthly', '2027-01-30')).toBe('2026-12-30');
    expect(lpd('monthly', '2027-03-29')).toBe('2027-02-28');
    expect(lpd('monthly', '2028-09-30')).toBe('2028-08-30');
  });
});

describe('B18 golden master (PC/VRPC): per-group hashes', () => {
  // Union of golden and corpus keys, so a group added to the corpus but missing from the golden
  // file is its own red test.
  const keys = [...new Set([...Object.keys(golden.groups), ...groupsDef.map((g) => g.key)])];
  for (const key of keys) {
    it(key, () => {
      const expected = golden.groups[key];
      const actual = computed.groups[key];
      if (!expected) expect.fail(`group ${key} is produced by the corpus but is not in golden_engine_pc_v1.json`);
      if (!actual) expect.fail(`group ${key} is no longer produced by the corpus`);
      if (actual.hash !== expected.hash) expect.fail(explainGroup(key, expected, actual));
    });
  }
});

describe('B18 golden master (PC/VRPC): 30-year cases (full JSON)', () => {
  for (const key of Object.keys(golden.long)) {
    it(key, () => {
      const { scalars, amortizationSchedule } = golden.long[key]!;
      const { amortizationSchedule: actualRows, ...actualScalars } = computed.long[key] as Record<string, unknown>;
      const d =
        firstDiff(amortizationSchedule, actualRows, '$.amortizationSchedule') ?? firstDiff(scalars, actualScalars);
      if (d) expect.fail(`GOLDEN MISMATCH in ${key}: ${d}`);
    });
  }
});

describe('B18 golden master (PC/VRPC): design facts (B18-P1..P6)', () => {
  it('B18-P1: regular groups: row 1 days by frequency; closing = opening - fees - principal in every row; the accrued pool is cleared by the last row', () => {
    const DAYS: Record<string, [number, number]> = { weekly: [7, 7], biweekly: [14, 14], semiMonthly: [13, 16], monthly: [28, 31] };
    let n = 0;
    for (const r of runs.filter((x) => !x.extra)) {
      const rows = r.result.amortizationSchedule;
      expect(rows.length, r.label).toBeGreaterThan(0);
      const [lo, hi] = DAYS[r.params.frequency]!;
      expect(rows[0]!.daysInPeriod, r.label).toBeGreaterThanOrEqual(lo);
      expect(rows[0]!.daysInPeriod, r.label).toBeLessThanOrEqual(hi);
      for (const row of rows) {
        if (row.closingBalance !== row.openingBalance - row.feesPaid - row.principalPortion)
          expect.fail(`${r.label} ${ymd(row.date)}: closing ${row.closingBalance} != opening - fees - principal`);
      }
      expect(rows[rows.length - 1]!.carriedAccruedInterestClosing, r.label).toBe(0);
      n += 1;
    }
    expect(n).toBe(2184);
  });

  it('B18-P2: every semi-monthly row date in the corpus is the 15th or the last day of its month', () => {
    let rowsSeen = 0;
    for (const r of runs.filter((x) => x.params.frequency === 'semiMonthly')) {
      for (const row of r.result.amortizationSchedule) {
        const d = row.date;
        const monthEnd = new Date(d.getTime() + 86_400_000).getUTCDate() === 1;
        if (d.getUTCDate() !== 15 && !monthEnd) expect.fail(`${r.label}: row date ${ymd(d)}`);
        rowsSeen += 1;
      }
    }
    expect(rowsSeen).toBeGreaterThan(0);
  });

  it('B18-P3: triggerRatePercent is finite for exactly the mortgage / variable cases, null otherwise', () => {
    for (const r of runs) {
      const t = r.result.triggerRatePercent;
      if (r.params.productType === 'mortgage' && r.params.rateType === 'variable')
        expect(Number.isFinite(t), r.label).toBe(true);
      else expect(t, r.label).toBeNull();
    }
  });

  it('B18-P4: pcx:underpayment (B27: Monthly only): row 1 payment < period interest and the accrued pool is not cleared, in all 52 cases', () => {
    const rs = runs.filter((x) => x.key === 'pcx:underpayment');
    expect(rs).toHaveLength(52);
    for (const r of rs) {
      const rows = r.result.amortizationSchedule;
      expect(rows[0]!.paymentAmount, r.label).toBeLessThan(rows[0]!.periodInterest);
      expect(rows[rows.length - 1]!.carriedAccruedInterestClosing, r.label).toBeGreaterThan(0);
    }
  });

  // B19 (DEV-OQL, 2026-09-29): nothing unpaid is capitalised, so acc0 also ends at exactly 250,000 (was above it, OQ-L).
  it('B18-P5: vrpcx:minimumPayment: every row pays 0.01, no fee or principal; all 208 end at exactly 250,000 (B19, DEV-OQL); 104 acc850, 104 acc0', () => {
    const rs = runs.filter((x) => x.key === 'vrpcx:minimumPayment');
    expect(rs).toHaveLength(208);
    let flat = 0;
    let grown = 0;
    for (const r of rs) {
      const rows = r.result.amortizationSchedule;
      expect(rows.length, r.label).toBeGreaterThan(0);
      expect(rows.every((row) => row.paymentAmount === 0.01), r.label).toBe(true);
      expect(rows.every((row) => row.feesPaid === 0), r.label).toBe(true);
      expect(rows.every((row) => row.principalPortion === 0), r.label).toBe(true);
      expect(r.result.endingBalance, r.label).toBe(250000);
      if (r.params.accKey === 'acc850') flat += 1;
      else grown += 1;
    }
    expect([flat, grown]).toEqual([104, 104]);
  });

  it('B18-P6: long cases: both end with a balance; the pc monthly underpayment case (B27: replaces the weekly one) ends at exactly 250,000 with the accrued pool not cleared', () => {
    for (const v of Object.values(golden.long)) expect(v.scalars.endingBalance as number).toBeGreaterThan(0);
    const pc = computed.long['long:pc:monthly:acc850:underpayment'] as CobCanadaResult;
    expect(pc.endingBalance).toBe(250000);
    const rows = pc.amortizationSchedule;
    expect(rows[rows.length - 1]!.carriedAccruedInterestClosing).toBeGreaterThan(0);
  });
});

describe('B18 golden master (PC/VRPC): flow equivalence', () => {
  it('B18-INV-flow-equivalence: every mortgage case gives the same JSON as Renewal (and VRPC as Payment Change): 2,912 comparisons', () => {
    let compared = 0;
    const bad: string[] = [];
    for (const r of runs.filter((x) => x.params.productType === 'mortgage')) {
      const base = input(r.params);
      const json = JSON.stringify(r.result);
      const twins: CobCanadaInput['flow'][] = r.params.flowKey === 'vrpc' ? ['renewal', 'paymentChange'] : ['renewal'];
      for (const flow of twins) {
        compared += 1;
        if (JSON.stringify(calc({ ...base, flow } as CobCanadaInput)) !== json) bad.push(`${r.label} as ${flow}`);
      }
    }
    expect(bad.slice(0, 5)).toEqual([]);
    expect(compared).toBe(2912);
  });
});

describe('B18 golden master (PC/VRPC): FB-16 reference pins (decision 2; for B22)', () => {
  const utc = (s: string) => new Date(`${s}T00:00:00.000Z`);
  it.each([
    ['today (start = change date)', '2027-01-20', 675.41, 37970.44582804594, 5.311489287555756, 1077, 12],
    ['literal reading', '2027-01-01', 675.41, 38754.64033976053, 5.311894244170482, 1096, 31],
    ['decision 2 (option a)', '2027-01-01', 0, 37970.44694321004, 5.2194106815669645, 1096, 31],
  ] as const)('B18-FB16 %s: start %s, accrued %s', (_name, start, accrued, cob, rate, termDays, row1Days) => {
    const r = calc({
      flow: 'paymentChange',
      productType: 'mortgage',
      rateType: 'variable',
      loanAmount: 250000,
      fees: { fees: [{ name: 'Fee', amount: 250, financed: false }] },
      contractRatePercent: 5.19,
      paymentAmount: 1500,
      paymentFrequency: 'monthly',
      firstPaymentDate: utc('2027-02-01'),
      endDate: utc('2030-01-01'),
      termYears: 3,
      termMonths: 0,
      renewalDate: utc(start),
      accruedInterest: accrued,
    } as CobCanadaInput);
    expect(r.cobAmount).toBe(cob);
    expect(r.cobRatePercent).toBe(rate);
    expect(r.termDays).toBe(termDays);
    expect(r.amortizationSchedule[0]!.daysInPeriod).toBe(row1Days);
  });
});
