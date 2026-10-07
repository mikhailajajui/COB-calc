/**
 * B34 engine half (COB-architecture.md section 5 B34, revision 53; user decision DEC-B34-TERM, 2026-10-06,
 * COB-user-stories.md section 7.5 "Contract term in years and months"). QA red step, 2026-10-06.
 *
 * New export contractTermOptions(input, result) -> { lastPayment, endDate }, each { years, months } (months 0-11), both from
 * the flow's start date (input[FLOWS[flow].startDateField]) and rounded UP to whole months (any leftover day = a full month;
 * no leftover day, no rounding): lastPayment to the last schedule row, endDate to input.endDate as typed. Internal helper
 * roundUpToWholeMonths in src/ca/calendar.ts (reached through src/ca/calendar.js, ADR-05). contractTerm is unchanged.
 *
 *   T1  B34-INV-ROUND    roundUpToWholeMonths: the brief's 9 rows, exact keys, and an arithmetic sweep.
 *   T2  B34-INV-VECTORS  the brief's table (22 entries), one QA row (F12's real SHORTFALL End date) and the BA catalogue
 *                        (B34-BV-01..67, fixture b34_term_vectors.json), each with a trust gate on the own oracle.
 *   T3  B34-INV-ORACLE   sweep 4 flows x 3 products x frequencies x 3 start offsets x 7 End dates x 2 payments (2,400 kept)
 *                        against support/termMonthsOracle.ts (own stepper; smallest m with stepped date >= target).
 *   T4  B34-INV-ORDER    same set: endDate >= lastPayment, endDate >= 1 month, last row <= End date.
 *   T5  B34-INV-ERRORS   RangeError (never TypeError) in the brief's order (B34-BV-89..97; Q-BA-3: no guard).
 *   T6  B34-INV-PURE     no mutation; equal, distinct results; calculateCobCanada's result keys unchanged.
 *   T7  barrels          one function on cobModule / both barrels, .length 2; roundUpToWholeMonths internal; the type exports.
 *
 * The new names are read at call time through casts, so the file type-checks before and after B34 and each test fails on
 * "not a function" until sr-dev adds the export (the intended red). In `test:tz` (both zones; B34-BV-99).
 * Expected values come from the fixture (typed from the brief and the BA catalogue), never from the code under test.
 * sr-dev must not edit these assertions or the fixture.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as ca from '../../src/ca/index.js';
import * as root from '../../src/index.js';
import * as cobModule from '../../src/ca/cobCanada.js';
import * as calendar from '../../src/ca/calendar.js';
import type { CobCanadaInput, CobFlow, ProductType, RateType } from '../../src/ca/index.js';
import { asInput, isoDay, utcDate, wireToInput } from './support/builders.js';
import { loadFixture } from './support/fixtures.js';
import { monthCount, roundedTermMonths } from './support/termMonthsOracle.js';
import type { Months } from './support/termMonthsOracle.js';

const d = utcDate;
const DAY = 86_400_000;
const M = (years: number, months: number): Months => ({ years, months });

interface Options { lastPayment: Months; endDate: Months }
type OptionsFn = (input: unknown, result: unknown) => Options;
type RoundFn = (term: { years: number; months: number; days: number }) => Months;
/** B34-R2: read at call time (undefined before B34: the call throws "not a function", the intended red). */
const contractTermOptions: OptionsFn = (i, r) => ((ca as unknown as Record<string, OptionsFn>)['contractTermOptions']!)(i, r);
const roundUpToWholeMonths: RoundFn = (t) => ((calendar as unknown as Record<string, RoundFn>)['roundUpToWholeMonths']!)(t);

// ---------------------------------------------------------------------------------------------------------------
// fixture
// ---------------------------------------------------------------------------------------------------------------
interface Row {
  id: string; name: string; source: 'brief' | 'ba' | 'qa'; base: string; changes: Record<string, unknown>; capture?: string;
  lastRow: string; lastPayment: Months; endDate: Months; lastPaymentText: string; endDateText: string; choice: boolean;
}
interface Rejected { id: string; base: string; changes: Record<string, unknown>; message: string }
interface Fixture { bases: Record<string, Record<string, unknown>>; vectors: Row[]; boundaries: Row[]; rejected: Rejected[] }
const FIX = loadFixture<Fixture>('b34_term_vectors.json');

/** BASES[base] overlaid with changes; null deletes a key, 'invalid' is new Date(NaN); YYYY-MM-DD strings become UTC midnight. */
function build(base: string, changes: Record<string, unknown>): CobCanadaInput {
  const out: Record<string, unknown> = { ...structuredClone(FIX.bases[base]!) };
  for (const [k, v] of Object.entries(changes)) {
    if (v === null) delete out[k];
    else out[k] = v;
  }
  const input = wireToInput(out) as unknown as Record<string, unknown>;
  for (const [k, v] of Object.entries(changes)) if (v === 'invalid') input[k] = new Date(NaN);
  return asInput(input);
}
const startOf = (input: CobCanadaInput): Date => (input as unknown as Record<string, Date>)[ca.FLOWS[input.flow].startDateField]!;

interface CaptureRaw { scenarios: { id: string; raw: Record<string, string> }[] }
const CAPTURE = loadFixture<CaptureRaw>('a10_ui_capture_v1.json');
const capturedInput = async (id: string): Promise<CobCanadaInput> => {
  const view = (await import('../../ui/ca-view.js')) as unknown as { toInput: (raw: unknown, ctx: unknown) => CobCanadaInput };
  const raw = CAPTURE.scenarios.find((s) => s.id === id)!.raw;
  const spec = ca.FLOWS[raw['flow'] as CobFlow];
  const ctx = { spec, semiAnnual: ca.requiresSemiAnnualDate(raw['productType'] as ProductType, raw['rateType'] as RateType), switches: { financedOption: false, acceleratedFrequencies: false, contractDateField: false } };
  return view.toInput(raw, ctx);
};

const ALL_ROWS: Row[] = [...FIX.vectors, ...FIX.boundaries];

// ---------------------------------------------------------------------------------------------------------------
// T1 rounding
// ---------------------------------------------------------------------------------------------------------------
describe('B34-T1 INV-ROUND: roundUpToWholeMonths (src/ca/calendar.js; internal)', () => {
  // B34-INV-ROUND, typed from the brief: {y, m, d} -> {y, m}.
  const TABLE: [[number, number, number], Months][] = [
    [[2, 11, 27], M(3, 0)], // user: 2y 11m 27d -> 3 years
    [[2, 11, 5], M(3, 0)], // user: 2y 11m 5d -> 3 years
    [[2, 5, 25], M(2, 6)], // user: 2y 5m 25d -> 2 years 6 months
    [[3, 0, 0], M(3, 0)], // 0 leftover days, no rounding
    [[0, 0, 0], M(0, 0)],
    [[0, 0, 1], M(0, 1)],
    [[0, 11, 1], M(1, 0)],
    [[1, 11, 30], M(2, 0)],
    [[0, 11, 0], M(0, 11)],
  ];

  it.each(TABLE.map(([[y, m, dd], want]) => [`{${y}, ${m}, ${dd}}`, { years: y, months: m, days: dd }, want] as const))('%s', (_n, term, want) => {
    const got = roundUpToWholeMonths(term);
    expect(got).toStrictEqual(want);
    expect(Object.keys(got).sort()).toEqual(['months', 'years']);
  });

  it('sweep {0..40 years} x {0..11 months} x {0, 1, 2, 15, 30, 31 days}: no days -> unchanged; any day -> one month more, carried into years', () => {
    const bad: string[] = [];
    for (let y = 0; y <= 40; y += 1) {
      for (let m = 0; m <= 11; m += 1) {
        for (const dd of [0, 1, 2, 15, 30, 31]) {
          const n = 12 * y + m + (dd === 0 ? 0 : 1);
          const want = M((n - (n % 12)) / 12, n % 12);
          const got = roundUpToWholeMonths({ years: y, months: m, days: dd });
          if (JSON.stringify(got) !== JSON.stringify(want)) bad.push(`{${y},${m},${dd}} -> ${JSON.stringify(got)}`);
        }
      }
    }
    expect(bad).toEqual([]);
  });

  it('does not mutate its argument and returns a new object', () => {
    const t = Object.freeze({ years: 2, months: 11, days: 27 });
    const got = roundUpToWholeMonths(t);
    expect(got).not.toBe(t as unknown);
    expect(t).toEqual({ years: 2, months: 11, days: 27 });
  });
});

// ---------------------------------------------------------------------------------------------------------------
// T2 vectors
// ---------------------------------------------------------------------------------------------------------------
describe('B34-T2 INV-VECTORS (engine): the brief\'s table and the BA boundary catalogue, exact', () => {
  it('the tables are not silently shortened: 22 brief entries (21 rows, REF-01 / S1_fees split), 1 QA row, 68 BA rows, 9 rejected', () => {
    expect(FIX.vectors.filter((v) => v.source === 'brief')).toHaveLength(22);
    expect(FIX.vectors.filter((v) => v.source === 'qa')).toHaveLength(1);
    expect(FIX.boundaries).toHaveLength(68);
    expect(FIX.rejected).toHaveLength(9);
    expect(new Set(ALL_ROWS.map((r) => r.id)).size).toBe(ALL_ROWS.length);
  });

  it('non-vacuity: both "choice" and "no choice" rows, every flow, every frequency, a zero option 1 and a 30-year term', () => {
    expect(ALL_ROWS.filter((r) => r.choice).length).toBeGreaterThanOrEqual(20);
    expect(ALL_ROWS.filter((r) => !r.choice).length).toBeGreaterThanOrEqual(40);
    const inputs = ALL_ROWS.map((r) => build(r.base, r.changes));
    expect(new Set(inputs.map((i) => i.flow)).size).toBe(4);
    expect(new Set(inputs.map((i) => i.paymentFrequency)).size).toBe(6);
    expect(ALL_ROWS.some((r) => monthCount(r.lastPayment) === 0)).toBe(true);
    expect(ALL_ROWS.some((r) => r.endDate.years === 30)).toBe(true);
  });

  it('trust gate: the oracle reproduces every row from (start date, last row) and (start date, End date); last rows as stated', () => {
    const bad: string[] = [];
    for (const v of ALL_ROWS) {
      const input = build(v.base, v.changes);
      const r = ca.calculateCobCanada(input);
      const last = r.amortizationSchedule.at(-1)!.date;
      if (isoDay(last) !== v.lastRow) bad.push(`${v.id}: last row ${isoDay(last)} != ${v.lastRow}`);
      const o1 = roundedTermMonths(startOf(input), last);
      const o2 = roundedTermMonths(startOf(input), input.endDate);
      if (JSON.stringify(o1) !== JSON.stringify(v.lastPayment)) bad.push(`${v.id}: oracle lastPayment ${JSON.stringify(o1)}`);
      if (JSON.stringify(o2) !== JSON.stringify(v.endDate)) bad.push(`${v.id}: oracle endDate ${JSON.stringify(o2)}`);
      if (v.choice !== (monthCount(v.lastPayment) !== monthCount(v.endDate))) bad.push(`${v.id}: choice flag`);
    }
    expect(bad).toEqual([]);
  });

  it.each(ALL_ROWS.map((v) => [`${v.id} ${v.name}`, v] as const))('%s', (_n, v) => {
    const input = build(v.base, v.changes);
    const r = ca.calculateCobCanada(input);
    expect(contractTermOptions(input, r)).toStrictEqual({ lastPayment: v.lastPayment, endDate: v.endDate });
  });

  it.each(FIX.vectors.filter((v) => v.capture).map((v) => [v.capture!, v] as const))('capture scenario %s through ui toInput: same options as the wire base', async (_id, v) => {
    const input = await capturedInput(v.capture!);
    const r = ca.calculateCobCanada(input);
    expect(isoDay(r.amortizationSchedule.at(-1)!.date)).toBe(v.lastRow);
    expect(contractTermOptions(input, r)).toStrictEqual({ lastPayment: v.lastPayment, endDate: v.endDate });
  });

  it.each(FIX.rejected.map((x) => [x.id, x] as const))('%s: the input is rejected with the stated message (the page shows no term)', (_id, x) => {
    const issues = ca.collectInputIssues(build(x.base, x.changes)).map((i) => i.message);
    expect(issues).toContain(x.message);
  });

  it('the option values are the rounded spans: lastPayment = roundUpToWholeMonths(contractTerm(input, r)) on every row', () => {
    const bad: string[] = [];
    for (const v of ALL_ROWS) {
      const input = build(v.base, v.changes);
      const r = ca.calculateCobCanada(input);
      const want = roundUpToWholeMonths(ca.contractTerm(input, r));
      if (JSON.stringify(contractTermOptions(input, r).lastPayment) !== JSON.stringify(want)) bad.push(v.id);
    }
    expect(bad).toEqual([]);
  });

  it('B34-BV-51 / M6: a New input that also holds Renewal date 2026-01-01 is measured from the Disbursal date (not "3 years, 3 months")', () => {
    const input = build('REF', {});
    expect((input as unknown as Record<string, Date>)['renewalDate']).toEqual(d('2026-01-01'));
    const r = ca.calculateCobCanada(input);
    expect(contractTermOptions(input, r).endDate).toStrictEqual(M(3, 0));
    expect(roundedTermMonths(d('2026-01-01'), d('2029-03-17'))).toStrictEqual(M(3, 3));
  });

  it('M4: option 2 is measured to the End date, not to the first payment date', () => {
    const input = build('REF', { endDate: '2029-03-18' });
    const r = ca.calculateCobCanada(input);
    expect(contractTermOptions(input, r).endDate).toStrictEqual(M(3, 1));
    expect(roundedTermMonths(d('2026-03-17'), d('2026-03-23'))).toStrictEqual(M(0, 1));
  });
});

// ---------------------------------------------------------------------------------------------------------------
// T3 / T4 sweep
// ---------------------------------------------------------------------------------------------------------------
const FIRST = d('2027-01-10');
const PRODUCTS: [ProductType, RateType][] = [['mortgage', 'fixed'], ['mortgage', 'variable'], ['personalLoan', 'variable']];
const FLOWS4: CobFlow[] = ['newMortgageOrLoan', 'renewal', 'paymentChange', 'variableRatePaymentChange'];
const END_OFFSETS = [1, 3, 10, 30, 1095, 1096, 1125];
interface Case { label: string; input: CobCanadaInput }
const SWEEP: Case[] = [];
const SWEEP_REJECTED: string[] = [];
for (const flow of FLOWS4) {
  for (const [productType, rateType] of PRODUCTS) {
    for (const paymentFrequency of ca.allowedPaymentFrequencies(productType)) {
      for (const offset of [0, 6, 31]) {
        for (const endOffset of END_OFFSETS) {
          for (const paymentAmount of [1300, 60000]) {
            const start = new Date(FIRST.getTime() - offset * DAY);
            const input = asInput({
              flow, productType, rateType, loanAmount: 50000, contractRatePercent: 5, paymentFrequency, paymentAmount,
              fees: { fees: [] }, firstPaymentDate: FIRST, endDate: new Date(FIRST.getTime() + endOffset * DAY), semiAnnualCompoundingDate: start,
              ...(flow === 'newMortgageOrLoan' ? { disbursalDate: start } : { renewalDate: start, accruedInterest: 0 }),
            });
            const label = `${flow} ${productType}/${rateType} ${paymentFrequency} start-${offset} end+${endOffset} pay ${paymentAmount}`;
            if (ca.collectInputIssues(input).length > 0) SWEEP_REJECTED.push(label);
            else SWEEP.push({ label, input });
          }
        }
      }
    }
  }
}
// VRPC takes the variable mortgage only, so 10 of the 12 flow x product groups hold cases.
const GROUPS = FLOWS4.flatMap((f) => PRODUCTS.map(([p, rt]) => `${f} ${p}/${rt} `)).filter((g) => SWEEP.some((c) => c.label.startsWith(g)));

describe('B34-T3 INV-ORACLE sweep: contractTermOptions = own oracle (start date -> last row, start date -> End date)', () => {
  it('sweep size: 2,400 calculated (as the brief\'s prototype), 624 rejected (VRPC x non-variable-mortgage, and semi-monthly End before the moved first date)', () => {
    expect(SWEEP.length).toBe(2400);
    expect(SWEEP_REJECTED.length).toBe(624);
    expect(SWEEP_REJECTED.filter((l) => !l.startsWith('variableRatePaymentChange ')).every((l) => / semiMonthly .* end\+(1|3) /.test(l))).toBe(true);
    expect(GROUPS).toHaveLength(10);
  });

  it('non-vacuity: the oracle sees both "differ" and "agree" pairs, payoffs and every End offset', () => {
    let differ = 0;
    let agree = 0;
    for (const c of SWEEP) {
      const r = ca.calculateCobCanada(c.input);
      const o1 = roundedTermMonths(startOf(c.input), r.amortizationSchedule.at(-1)!.date);
      const o2 = roundedTermMonths(startOf(c.input), c.input.endDate);
      if (monthCount(o1) === monthCount(o2)) agree += 1; else differ += 1;
    }
    expect(differ).toBeGreaterThan(200);
    expect(agree).toBeGreaterThan(200);
  });

  it.each(GROUPS)('%s(every frequency, offset, End, payment)', (group) => {
    const bad: string[] = [];
    const cases = SWEEP.filter((c) => c.label.startsWith(group));
    expect(cases.length).toBeGreaterThan(0);
    for (const c of cases) {
      const r = ca.calculateCobCanada(c.input);
      const start = startOf(c.input);
      const want = { lastPayment: roundedTermMonths(start, r.amortizationSchedule.at(-1)!.date), endDate: roundedTermMonths(start, c.input.endDate) };
      const got = contractTermOptions(c.input, r);
      if (JSON.stringify(got) !== JSON.stringify(want)) bad.push(`${c.label}: ${JSON.stringify(got)} != ${JSON.stringify(want)}`);
      if (JSON.stringify(got.lastPayment) !== JSON.stringify(roundUpToWholeMonths(ca.contractTerm(c.input, r)))) bad.push(`${c.label}: lastPayment != round(contractTerm)`);
    }
    expect(bad.slice(0, 10)).toEqual([]);
  });
});

describe('B34-T4 INV-ORDER: for every pair from calculateCobCanada, endDate >= lastPayment and >= 1 month; last row <= End date', () => {
  it('last row <= End date on every sweep case and every vector row (holds before B34)', () => {
    const bad: string[] = [];
    for (const c of [...SWEEP, ...ALL_ROWS.map((v) => ({ label: v.id, input: build(v.base, v.changes) }))]) {
      const last = ca.calculateCobCanada(c.input).amortizationSchedule.at(-1)!.date;
      if (last.getTime() > c.input.endDate.getTime()) bad.push(c.label);
    }
    expect(bad).toEqual([]);
  });

  it('endDate >= lastPayment (in months) and endDate >= 1 month on every sweep case and every vector row', () => {
    const bad: string[] = [];
    for (const c of [...SWEEP, ...ALL_ROWS.map((v) => ({ label: v.id, input: build(v.base, v.changes) }))]) {
      const o = contractTermOptions(c.input, ca.calculateCobCanada(c.input));
      if (monthCount(o.endDate) < monthCount(o.lastPayment) || monthCount(o.endDate) < 1) bad.push(`${c.label}: ${JSON.stringify(o)}`);
      if (o.endDate.months > 11 || o.lastPayment.months > 11 || o.endDate.months < 0 || o.lastPayment.months < 0) bad.push(`${c.label}: months out of 0-11`);
    }
    expect(bad.slice(0, 10)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// T5 errors
// ---------------------------------------------------------------------------------------------------------------
const throwsOf = (fn: () => unknown): { type: string; message: string } | null => {
  try { fn(); return null; } catch (e) { return { type: (e as Error).constructor.name, message: (e as Error).message }; }
};
const RANGE = (message: string) => ({ type: 'RangeError', message });
const FLOW_MSG = 'flow must be one of newMortgageOrLoan/renewal/paymentChange/variableRatePaymentChange';

describe('B34-T5 INV-ERRORS: RangeError, never TypeError, in the order contractTerm\'s checks, then the End date, then End before start', () => {
  const ref = async () => { const input = await capturedInput('REF-01'); return { input, r: ca.calculateCobCanada(input) }; };

  it('B34-BV-89: an empty schedule (with endDate undefined too) names the schedule first', async () => {
    const { input } = await ref();
    expect(throwsOf(() => contractTermOptions({ ...input, endDate: undefined }, { amortizationSchedule: [] }))).toEqual(RANGE('amortizationSchedule must have at least one row'));
    expect(throwsOf(() => contractTermOptions(input, { amortizationSchedule: [] }))).toEqual(RANGE('amortizationSchedule must have at least one row'));
  });

  it.each(['bogus', 'toString', '__proto__', ''])('B34-BV-90: flow %j (End date also invalid) names the four flows', async (flow) => {
    const { input, r } = await ref();
    expect(throwsOf(() => contractTermOptions({ ...input, flow, endDate: new Date(NaN) }, r))).toEqual(RANGE(FLOW_MSG));
  });

  it('B34-BV-91: the start date missing or invalid names the flow\'s start field, before the End date', async () => {
    const { input, r } = await ref();
    expect(throwsOf(() => contractTermOptions({ ...input, disbursalDate: undefined, endDate: undefined }, r))).toEqual(RANGE('disbursalDate must be a valid Date'));
    expect(throwsOf(() => contractTermOptions({ ...input, disbursalDate: new Date(NaN) }, r))).toEqual(RANGE('disbursalDate must be a valid Date'));
    const ren = await capturedInput('RENEWAL');
    const rr = ca.calculateCobCanada(ren);
    expect(throwsOf(() => contractTermOptions({ ...ren, renewalDate: new Date(NaN), endDate: undefined }, rr))).toEqual(RANGE('renewalDate must be a valid Date'));
    expect(throwsOf(() => contractTermOptions({ ...ren, renewalDate: '2026-04-01' }, rr))).toEqual(RANGE('renewalDate must be a valid Date'));
  });

  it('B34-BV-92: start after the last row (Disbursal 2029-04-01, End also invalid) -> "from must be on or before to" from contractTerm, before the End date check', async () => {
    const { input, r } = await ref();
    expect(throwsOf(() => contractTermOptions({ ...input, disbursalDate: d('2029-04-01'), endDate: new Date(NaN) }, r))).toEqual(RANGE('from must be on or before to'));
  });

  it.each([
    ['undefined', undefined],
    ['null', null],
    ['new Date(NaN)', new Date(NaN)],
    ['the string "2029-03-18"', '2029-03-18'],
    ['a number', Date.UTC(2029, 2, 18)],
    ['a date-like object', { getTime: (): number => 0 }],
  ] as const)('B34-BV-93: REF-01\'s result with endDate %s -> RangeError "endDate must be a valid Date"', async (_n, endDate) => {
    const { input, r } = await ref();
    expect(throwsOf(() => contractTermOptions({ ...input, endDate }, r))).toEqual(RANGE('endDate must be a valid Date'));
  });

  it('B34-BV-94: endDate 2026-03-16 (before Disbursal 2026-03-17) -> RangeError "from must be on or before to"', async () => {
    const { input, r } = await ref();
    expect(throwsOf(() => contractTermOptions({ ...input, endDate: d('2026-03-16') }, r))).toEqual(RANGE('from must be on or before to'));
  });

  it('B34-BV-95: endDate equal to the start date returns {0, 0} for option 2 (direct call only), no error', async () => {
    const { input, r } = await ref();
    expect(contractTermOptions({ ...input, endDate: d('2026-03-17') }, r)).toStrictEqual({ lastPayment: M(3, 0), endDate: M(0, 0) });
  });

  it('B34-BV-96: the time of day is dropped (endDate 2029-03-18T23:59:59Z = 2029-03-18; start 2026-03-17T23:00Z = 2026-03-17)', async () => {
    const { input, r } = await ref();
    expect(contractTermOptions({ ...input, endDate: new Date('2029-03-18T23:59:59Z') }, r)).toStrictEqual({ lastPayment: M(3, 0), endDate: M(3, 1) });
    expect(contractTermOptions({ ...input, disbursalDate: new Date('2026-03-17T23:00:00Z'), endDate: new Date('2029-03-18T00:00:01Z') }, r)).toStrictEqual({ lastPayment: M(3, 0), endDate: M(3, 1) });
  });

  it('B34-BV-97 (Q-BA-3 ruling: no guard): an End date before the last row (pair the page cannot produce) returns values per the rule, no error', async () => {
    const { input, r } = await ref();
    expect(contractTermOptions({ ...input, endDate: d('2028-01-01') }, r)).toStrictEqual({ lastPayment: M(3, 0), endDate: M(1, 10) });
  });

  it('the start field is chosen by the flow for option 2 as well: a renewal input with a different Disbursal date', async () => {
    const ren = await capturedInput('RENEWAL'); // renewalDate 2026-04-01, End 2028-10-01
    const rr = ca.calculateCobCanada(ren);
    expect(contractTermOptions({ ...ren, disbursalDate: d('2020-01-01') }, rr)).toStrictEqual({ lastPayment: M(2, 6), endDate: M(2, 6) });
  });

  it('swapped arguments throw, never return options', async () => {
    const { input, r } = await ref();
    expect(() => contractTermOptions(r, input)).toThrow();
  });
});

// ---------------------------------------------------------------------------------------------------------------
// T6 purity
// ---------------------------------------------------------------------------------------------------------------
const deepFreeze = <T>(o: T): T => {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const v of Object.values(o as object)) deepFreeze(v);
  }
  return o;
};

describe('B34-T6 INV-PURE: reads only; equal, distinct results; no new result field', () => {
  it('deep-frozen input and result: no throw, no change (JSON before = after), two calls equal and distinct', async () => {
    const input = await capturedInput('PL_WEEKLY');
    const r = ca.calculateCobCanada(input);
    const before = [JSON.stringify(input), JSON.stringify(r), input.endDate.getTime(), input.disbursalDate!.getTime()];
    deepFreeze(input);
    deepFreeze(r);
    const a = contractTermOptions(input, r);
    const b = contractTermOptions(input, r);
    expect(a).toStrictEqual({ lastPayment: M(2, 11), endDate: M(3, 0) });
    expect(b).toStrictEqual(a);
    expect(b).not.toBe(a);
    expect(b.lastPayment).not.toBe(a.lastPayment);
    expect(b.endDate).not.toBe(a.endDate);
    expect([JSON.stringify(input), JSON.stringify(r), input.endDate.getTime(), input.disbursalDate!.getTime()]).toEqual(before);
  });

  it('a minimal result (Pick<amortizationSchedule>, last row only) is enough', async () => {
    const input = await capturedInput('REF-01');
    expect(contractTermOptions(input, { amortizationSchedule: [{ date: d('2029-03-12') }] })).toStrictEqual({ lastPayment: M(3, 0), endDate: M(3, 0) });
  });

  it('calculateCobCanada\'s result keys are unchanged (no term field; the goldens pin the values)', async () => {
    const r = ca.calculateCobCanada(await capturedInput('REF-01'));
    expect(Object.keys(r)).toEqual(['calculatedRatePercent', 'cobAmount', 'cobRatePercent', 'totalPayment', 'numberOfPayments', 'totalInterest',
      'principalPayment', 'feesRecovered', 'triggerRatePercent', 'amortizationSchedule', 'termDays', 'disbursalAmount', 'amortizedPrincipal', 'endingBalance']);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// T7 barrels
// ---------------------------------------------------------------------------------------------------------------
const srcText = (rel: string): string => readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

describe('B34-T7 barrels: one new runtime export, two new type exports, the helper stays internal', () => {
  it('contractTermOptions is a function of length 2 (input, result)', () => {
    const fn = (ca as unknown as Record<string, unknown>)['contractTermOptions'];
    expect(typeof fn).toBe('function');
    expect((fn as (...a: unknown[]) => unknown).length).toBe(2);
  });

  it('cobCanada.ts, the src/ca barrel and the root barrel export the same function', () => {
    const fn = (cobModule as unknown as Record<string, unknown>)['contractTermOptions'];
    expect(typeof fn).toBe('function');
    expect((ca as unknown as Record<string, unknown>)['contractTermOptions']).toBe(fn);
    expect((root as unknown as Record<string, unknown>)['contractTermOptions']).toBe(fn);
  });

  it('roundUpToWholeMonths is exported by calendar.ts only (internal to src/ca, ADR-05), not by either barrel', () => {
    expect(typeof (calendar as unknown as Record<string, unknown>)['roundUpToWholeMonths']).toBe('function');
    expect(Object.keys(ca)).not.toContain('roundUpToWholeMonths');
    expect(Object.keys(root)).not.toContain('roundUpToWholeMonths');
  });

  it('contractTerm is unchanged: same function, length 2, REF-01 still 2 years, 11 months, 23 days', async () => {
    expect(ca.contractTerm).toBe(cobModule.contractTerm);
    expect((ca.contractTerm as unknown as (...a: unknown[]) => unknown).length).toBe(2);
    const input = await capturedInput('REF-01');
    expect(ca.contractTerm(input, ca.calculateCobCanada(input))).toStrictEqual({ years: 2, months: 11, days: 23 });
  });

  it('src/ca/index.ts and src/index.ts export the types ContractTermMonths and ContractTermOptions by name', () => {
    for (const f of ['src/ca/index.ts', 'src/index.ts']) {
      const blocks = [...srcText(f).matchAll(/export\s+type\s*\{([^}]*)\}/g)].map((m) => m[1]!).join(',');
      const names = blocks.split(',').map((x) => x.trim()).filter(Boolean);
      expect(names, f).toContain('ContractTermMonths');
      expect(names, f).toContain('ContractTermOptions');
      expect(names, f).toContain('ContractTerm');
    }
  });

  it('types.ts: ContractTermMonths { years; months } and ContractTermOptions { lastPayment; endDate } (B34-R1)', () => {
    const t = srcText('src/ca/types.ts');
    expect(t).toMatch(/export interface ContractTermMonths \{\s*years: number;\s*months: number;\s*\}/);
    expect(t).toMatch(/export interface ContractTermOptions \{\s*lastPayment: ContractTermMonths;\s*endDate: ContractTermMonths;\s*\}/);
  });

  it('calculateCobCanada does not call the display rounding (F4-clean, display only): roundUpToWholeMonths appears in cobCanada.ts only inside contractTermOptions and its import', () => {
    const src = srcText('src/ca/cobCanada.ts');
    const body = src.slice(src.indexOf('export function contractTermOptions'));
    const before = src.slice(0, src.indexOf('export function contractTermOptions'));
    expect(body).toContain('roundUpToWholeMonths(');
    expect(before.replace(/import[^;]*;/g, '')).not.toContain('roundUpToWholeMonths');
  });
});
