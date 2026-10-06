/**
 * B32 engine half (COB-architecture.md section 5 B32, revision 50; user decision DEC-B32-TERM, 2026-10-05,
 * COB-user-stories.md section 7.5 "Contract term from the start date"; DEV-OQP start point). QA red step, 2026-10-05.
 *
 * The derived Contract term runs from the flow's START DATE (input[FLOWS[flow].startDateField]: Disbursal date,
 * Renewal date, Date of change) to the LAST scheduled payment date, in every flow. New signature (B32-R1, breaking):
 * contractTerm(input, result). Same span as result.termDays.
 *
 *   T1  B32-INV-VECTORS  the architect's 17-row table (18 entries: REF-01 and S1_fees run separately) (first row, last row, new term, termDays; never the old term).
 *   T2  B32-INV-START    sweep 4 flows x 3 products x allowedPaymentFrequencies x 3 start offsets against the own oracle
 *                        (support/termOracle.ts refTerm: own month stepper, imports nothing from src/).
 *   T3  B32-INV-DAYS     addMonthsClamped(start, 12y+m) + days = last row; daysBetween(start, last) === termDays.
 *   T4  B32-INV-MOVE     the moved semi-monthly first date no longer changes the term (supersedes Q-CT-B25).
 *   T5  B32-INV-ERRORS   RangeError (never TypeError) in the brief's order; the field is chosen by the flow.
 *   T6  barrels          contractTerm.length === 2, one function on both barrels, export lists unchanged (pre-B32 pins).
 *
 * contractTerm is called through a two-argument cast so this file type-checks before and after B32 (the one-argument
 * call is pinned at type level in tests/types/b24-term-optional.typecheck.ts, B24-T5-12). In `test:tz` (both zones).
 * Expected values are typed from the brief's table, not computed by the code under test. sr-dev must not edit them.
 */
import { describe, expect, it } from 'vitest';
import * as ca from '../../src/ca/index.js';
import * as root from '../../src/index.js';
import * as cobModule from '../../src/ca/cobCanada.js';
import { addMonthsClamped, daysBetween } from '../../src/ca/calendar.js';
import type { CobCanadaInput, CobCanadaResult, CobFlow, PaymentFrequency, ProductType, RateType } from '../../src/ca/index.js';
import { asInput, isoDay, utcDate } from './support/builders.js';
import { loadFixture } from './support/fixtures.js';
import { refTerm } from './support/termOracle.js';
import type { Term } from './support/termOracle.js';
// @ts-ignore -- plain .mjs shared with the B25 snapshot generator (no .d.ts), as in b25-semimonthly-move.test.ts.
import * as snap from './fixtures/generate_b25_pre_snapshot.mjs';

const d = utcDate;
const DAY = 86_400_000;
const T = (years: number, months: number, days: number): Term => ({ years, months, days });

type ContractTerm2 = (input: unknown, result: unknown) => Term;
/** B32-R1: contractTerm(input, result), read at call time from the barrel. */
const contractTerm: ContractTerm2 = (i, r) => (ca.contractTerm as unknown as ContractTerm2)(i, r);

interface CaptureRaw { scenarios: { id: string; raw: Record<string, string> }[] }
const CAPTURE = loadFixture<CaptureRaw>('a10_ui_capture_v1.json');
const capturedInput = async (id: string): Promise<CobCanadaInput> => {
  const view = (await import('../../ui/ca-view.js')) as unknown as { toInput: (raw: unknown, ctx: unknown) => CobCanadaInput };
  const raw = CAPTURE.scenarios.find((s) => s.id === id)!.raw;
  const spec = ca.FLOWS[raw['flow'] as CobFlow];
  const ctx = { spec, semiAnnual: ca.requiresSemiAnnualDate(raw['productType'] as ProductType, raw['rateType'] as RateType), switches: { financedOption: false, acceleratedFrequencies: false, contractDateField: false } };
  return view.toInput(raw, ctx);
};

const startOf = (input: CobCanadaInput): Date => (input as unknown as Record<string, Date>)[ca.FLOWS[input.flow].startDateField]!;

// B24-T3 BASE (mortgage / variable, 250,000 @ 5.19%, monthly 1,300, disbursal 2027-01-01, first 2027-02-01, end 2029-06-01).
const B24_BASE = {
  flow: 'newMortgageOrLoan', productType: 'mortgage', rateType: 'variable', loanAmount: 250000, contractRatePercent: 5.19,
  paymentFrequency: 'monthly', paymentAmount: 1300, fees: { fees: [] },
  disbursalDate: d('2027-01-01'), firstPaymentDate: d('2027-02-01'), endDate: d('2029-06-01'),
};
const b24 = (o: Record<string, unknown>): CobCanadaInput => asInput({ ...B24_BASE, ...o });
// B25-T3 inputs: snapInput (mortgage / fixed, 250,000 @ 5.19%) with the start moved to 2027-01-01.
const b25 = (typed: string, end: string, frequency: PaymentFrequency = 'semiMonthly'): CobCanadaInput =>
  asInput({ ...snap.snapInput(typed, frequency, end), disbursalDate: d('2027-01-01'), semiAnnualCompoundingDate: d('2027-01-01') });
const changeFlow = (flow: CobFlow, o: Record<string, unknown>): CobCanadaInput =>
  asInput({ flow, productType: 'mortgage', rateType: 'fixed', fees: { fees: [] }, accruedInterest: 0, paymentFrequency: 'monthly', ...o });

interface Vector { name: string; input: () => CobCanadaInput | Promise<CobCanadaInput>; start: string; first: string; last: string; old: Term; want: Term; termDays: number }
// B32-INV-VECTORS: the brief's table, every row (bold column = want).
const VECTORS: Vector[] = [
  { name: 'user example (paymentChange, monthly, Date of change 2026-02-20)', start: '2026-02-20', first: '2026-03-15', last: '2029-03-15', old: T(3, 0, 0), want: T(3, 0, 23), termDays: 1119,
    input: () => changeFlow('paymentChange', { loanAmount: 200000, contractRatePercent: 5, paymentAmount: 1200, renewalDate: d('2026-02-20'), firstPaymentDate: d('2026-03-15'), endDate: d('2029-03-15'), semiAnnualCompoundingDate: d('2026-02-20') }) },
  { name: 'REF-01 (capture)', start: '2026-03-17', first: '2026-03-23', last: '2029-03-12', old: T(2, 11, 17), want: T(2, 11, 23), termDays: 1091, input: () => capturedInput('REF-01') },
  { name: 'S1_fees (capture)', start: '2026-03-17', first: '2026-03-23', last: '2029-03-12', old: T(2, 11, 17), want: T(2, 11, 23), termDays: 1091, input: () => capturedInput('S1_fees') },
  { name: 'RENEWAL (capture)', start: '2026-04-01', first: '2026-05-01', last: '2028-10-01', old: T(2, 5, 0), want: T(2, 6, 0), termDays: 914, input: () => capturedInput('RENEWAL') },
  { name: 'VRPC_zero_accrued (capture)', start: '2026-06-15', first: '2026-06-26', last: '2031-06-06', old: T(4, 11, 11), want: T(4, 11, 22), termDays: 1817, input: () => capturedInput('VRPC_zero_accrued') },
  { name: 'F17 S1 (new, variable, semi-monthly, typed 01-10 moved to 01-15)', start: '2027-01-01', first: '2027-01-15', last: '2029-01-15', old: T(2, 0, 0), want: T(2, 0, 14), termDays: 745,
    input: () => asInput({ flow: 'newMortgageOrLoan', productType: 'mortgage', rateType: 'variable', loanAmount: 100000, contractRatePercent: 5, paymentAmount: 1000, paymentFrequency: 'semiMonthly', fees: { fees: [] }, disbursalDate: d('2027-01-01'), firstPaymentDate: d('2027-01-10'), endDate: d('2029-01-15') }) },
  { name: 'F17 S5 (paymentChange, semi-monthly, typed 01-20 moved to 01-31)', start: '2027-01-01', first: '2027-01-31', last: '2029-01-15', old: T(1, 11, 15), want: T(2, 0, 14), termDays: 745,
    input: () => asInput({ flow: 'paymentChange', productType: 'mortgage', rateType: 'variable', loanAmount: 100000, contractRatePercent: 5, paymentAmount: 1000, paymentFrequency: 'semiMonthly', fees: { fees: [] }, renewalDate: d('2027-01-01'), accruedInterest: 0, firstPaymentDate: d('2027-01-20'), endDate: d('2029-01-15') }) },
  { name: 'B25-T3 b (semi-monthly, typed 2027-01-30, end 2028-01-31)', start: '2027-01-01', first: '2027-01-31', last: '2028-01-31', old: T(1, 0, 0), want: T(1, 0, 30), termDays: 395, input: () => b25('2027-01-30', '2028-01-31') },
  { name: 'B25-T3 c (semi-monthly, typed 2027-01-15, end 2029-01-15)', start: '2027-01-01', first: '2027-01-15', last: '2029-01-15', old: T(2, 0, 0), want: T(2, 0, 14), termDays: 745, input: () => b25('2027-01-15', '2029-01-15') },
  { name: 'B25-T3 d (monthly, typed 2027-01-10, end 2029-01-10)', start: '2027-01-01', first: '2027-01-10', last: '2029-01-10', old: T(2, 0, 0), want: T(2, 0, 9), termDays: 740, input: () => b25('2027-01-10', '2029-01-10', 'monthly') },
  { name: 'SHORTFALL (F12; new, fixed, monthly, 200,000 @ 5%, pay 700)', start: '2026-04-01', first: '2026-05-01', last: '2028-04-01', old: T(1, 11, 0), want: T(2, 0, 0), termDays: 731,
    input: () => asInput({ flow: 'newMortgageOrLoan', productType: 'mortgage', rateType: 'fixed', loanAmount: 200000, contractRatePercent: 5, paymentAmount: 700, paymentFrequency: 'monthly', fees: { fees: [] }, disbursalDate: d('2026-04-01'), firstPaymentDate: d('2026-05-01'), endDate: d('2028-04-15') }) },
  { name: 'B24-T3 payoff (10,000, pay 2,000, end 2030-01-01)', start: '2027-01-01', first: '2027-02-01', last: '2027-07-01', old: T(0, 5, 0), want: T(0, 6, 0), termDays: 181, input: () => b24({ loanAmount: 10000, paymentAmount: 2000, endDate: d('2030-01-01') }) },
  { name: 'B24-T3 short (weekly, pay 300, first 2027-03-23, end 2027-03-31)', start: '2027-01-01', first: '2027-03-23', last: '2027-03-30', old: T(0, 0, 7), want: T(0, 2, 29), termDays: 88, input: () => b24({ paymentFrequency: 'weekly', paymentAmount: 300, firstPaymentDate: d('2027-03-23'), endDate: d('2027-03-31') }) },
  { name: 'B24-T3 one row (first = start, no fees; Q-B32-SAME-DAY default)', start: '2027-01-01', first: '2027-01-01', last: '2027-01-01', old: T(0, 0, 0), want: T(0, 0, 0), termDays: 0, input: () => b24({ firstPaymentDate: d('2027-01-01'), endDate: d('2027-01-02') }) },
  { name: 'B24-T3 semi (pay 700, first 2027-01-15, end 2027-06-20)', start: '2027-01-01', first: '2027-01-15', last: '2027-06-15', old: T(0, 5, 0), want: T(0, 5, 14), termDays: 165, input: () => b24({ paymentFrequency: 'semiMonthly', paymentAmount: 700, firstPaymentDate: d('2027-01-15'), endDate: d('2027-06-20') }) },
  { name: 'month-end start (renewal, Renewal date 2026-01-31)', start: '2026-01-31', first: '2026-02-28', last: '2027-02-28', old: T(1, 0, 0), want: T(1, 1, 0), termDays: 393,
    input: () => changeFlow('renewal', { loanAmount: 100000, contractRatePercent: 5, paymentAmount: 1000, renewalDate: d('2026-01-31'), firstPaymentDate: d('2026-02-28'), endDate: d('2027-02-28'), semiAnnualCompoundingDate: d('2026-01-31') }) },
  { name: 'leap month-end start (paymentChange, Date of change 2028-02-29)', start: '2028-02-29', first: '2028-03-15', last: '2029-02-15', old: T(0, 11, 0), want: T(0, 11, 15), termDays: 352,
    input: () => changeFlow('paymentChange', { loanAmount: 100000, contractRatePercent: 5, paymentAmount: 1000, renewalDate: d('2028-02-29'), firstPaymentDate: d('2028-03-15'), endDate: d('2029-02-28'), semiAnnualCompoundingDate: d('2028-02-29') }) },
  { name: 'personal loan (new, variable, monthly, 10,000 @ 8%, pay 300)', start: '2026-03-17', first: '2026-04-17', last: '2029-03-17', old: T(2, 11, 0), want: T(3, 0, 0), termDays: 1096,
    input: () => asInput({ flow: 'newMortgageOrLoan', productType: 'personalLoan', rateType: 'variable', loanAmount: 10000, contractRatePercent: 8, paymentAmount: 300, paymentFrequency: 'monthly', fees: { fees: [] }, disbursalDate: d('2026-03-17'), firstPaymentDate: d('2026-04-17'), endDate: d('2029-03-17') }) },
];

// ---------------------------------------------------------------------------------------------------------------
// T1 vectors
// ---------------------------------------------------------------------------------------------------------------
describe('B32-T1 INV-VECTORS: the brief\'s table, exact (contractTerm(input, result), start date to last row)', () => {
  it('the table is not silently shortened (17 rows; the REF-01 / S1_fees row runs as its two capture scenarios = 18 entries)', () => {
    expect(VECTORS).toHaveLength(18);
  });

  it('trust gate: the oracle refTerm reproduces every row of the bold column from (start, last row), and the old column from (first row, last row)', () => {
    for (const v of VECTORS) {
      expect(refTerm(d(v.start), d(v.last)), v.name).toEqual(v.want);
      expect(refTerm(d(v.first), d(v.last)), `${v.name} (old)`).toEqual(v.old);
    }
  });

  it.each(VECTORS.map((v) => [v.name, v] as const))('%s', async (_n, v) => {
    const input = await v.input();
    const r = ca.calculateCobCanada(input);
    const rows = r.amortizationSchedule;
    expect(isoDay(startOf(input)), 'start date (input[FLOWS[flow].startDateField])').toBe(v.start);
    expect(isoDay(rows[0]!.date), 'first row').toBe(v.first);
    expect(isoDay(rows.at(-1)!.date), 'last row').toBe(v.last);
    expect(r.termDays, 'termDays unchanged').toBe(v.termDays);
    expect(contractTerm(input, r)).toEqual(v.want);
    if (JSON.stringify(v.old) !== JSON.stringify(v.want)) expect(contractTerm(input, r), 'not the pre-B32 first-row term').not.toEqual(v.old);
  });

  it('REF-01 IS 2 years, 11 months, 23 days, not the 2, 11, 17 of the first row, and not the 2, 11, 22 of the End Date (2029-03-17)', async () => {
    const input = await capturedInput('REF-01');
    const r = ca.calculateCobCanada(input);
    expect(contractTerm(input, r)).toEqual(T(2, 11, 23));
    expect(contractTerm(input, r)).not.toEqual(T(2, 11, 17));
    expect(refTerm(d('2026-03-23'), d('2029-03-17'))).toEqual(T(2, 11, 22)); // the End Date reading (M4 would give a different start too)
    expect(contractTerm(input, r)).not.toEqual(refTerm(d('2026-03-17'), d('2029-03-17'))); // start to End Date = 3, 0, 0
  });

  it('the result is not changed by the call (contractTerm reads only; JSON before = JSON after)', async () => {
    const input = await capturedInput('RENEWAL');
    const r = ca.calculateCobCanada(input);
    const before = [JSON.stringify(r), JSON.stringify(input)];
    contractTerm(input, r);
    expect([JSON.stringify(r), JSON.stringify(input)]).toEqual(before);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// T2 / T3 sweep
// ---------------------------------------------------------------------------------------------------------------
const FIRST = d('2027-01-10');
const PRODUCTS: [ProductType, RateType][] = [['mortgage', 'fixed'], ['mortgage', 'variable'], ['personalLoan', 'variable']];
const FLOWS4: CobFlow[] = ['newMortgageOrLoan', 'renewal', 'paymentChange', 'variableRatePaymentChange'];
const PAY: Record<string, number> = { monthly: 1000, semiMonthly: 500, biweekly: 460, weekly: 230, acceleratedBiweekly: 500, acceleratedWeekly: 250 };
interface Case { label: string; input: CobCanadaInput }
const SWEEP_ACCEPTED: Case[] = [];
const SWEEP_REJECTED: string[] = [];
for (const flow of FLOWS4) {
  for (const [productType, rateType] of PRODUCTS) {
    for (const paymentFrequency of ca.allowedPaymentFrequencies(productType)) {
      for (const offset of [0, 6, 31]) {
        const start = new Date(FIRST.getTime() - offset * DAY);
        const input = asInput({
          flow, productType, rateType, loanAmount: 50000, contractRatePercent: 5, paymentFrequency, paymentAmount: PAY[paymentFrequency]!,
          fees: { fees: [] }, firstPaymentDate: FIRST, endDate: new Date(FIRST.getTime() + 1095 * DAY), semiAnnualCompoundingDate: start,
          ...(flow === 'newMortgageOrLoan' ? { disbursalDate: start } : { renewalDate: start, accruedInterest: 0 }),
        });
        const label = `${flow} ${productType}/${rateType} ${paymentFrequency} start-${offset}`;
        if (ca.collectInputIssues(input).length > 0) SWEEP_REJECTED.push(label);
        else SWEEP_ACCEPTED.push({ label, input });
      }
    }
  }
}

describe('B32-T2 INV-START sweep: contractTerm(input, r) = oracle(start date, last row) (4 flows x 3 products x frequencies x 3 offsets)', () => {
  // B33 (DEC-B33-FREQ): the personal loan takes all six frequencies (was Monthly only), so 4 x 3 x 6 x 3 = 216 cases:
  // 180 calculated (was 135), 36 rejected = VRPC x {mortgage/fixed, personalLoan/variable} x 6 x 3 (was 21).
  it('sweep size: 180 calculated, 36 rejected by collectInputIssues (skipped, counted); B33 (was 135 / 21)', () => {
    expect(SWEEP_ACCEPTED.length).toBe(180);
    expect(SWEEP_REJECTED.length).toBe(36);
    expect(SWEEP_REJECTED.every((l) => l.startsWith('variableRatePaymentChange '))).toBe(true);
  });

  it('non-vacuity: the sweep holds every flow, every frequency of the products, and the start = first payment case', () => {
    expect(new Set(SWEEP_ACCEPTED.map((c) => c.input.flow)).size).toBe(4);
    expect(new Set(SWEEP_ACCEPTED.map((c) => c.input.paymentFrequency))).toEqual(new Set(ca.allowedPaymentFrequencies('mortgage')));
    expect(SWEEP_ACCEPTED.some((c) => c.label.endsWith('start-0'))).toBe(true);
  });

  it.each(SWEEP_ACCEPTED.map((c) => [c.label, c] as const))('%s', (_l, c) => {
    const r = ca.calculateCobCanada(c.input);
    const start = startOf(c.input);
    const last = r.amortizationSchedule.at(-1)!.date;
    expect(contractTerm(c.input, r)).toEqual(refTerm(start, last));
    // whenever the first row is later than the start date, the term differs from the pre-B32 first-row term
    const first = r.amortizationSchedule[0]!.date;
    if (isoDay(first) !== isoDay(start)) expect(contractTerm(c.input, r)).not.toEqual(refTerm(first, last));
  });
});

describe('B32-T3 INV-DAYS: the term rebuilds the last row date, and measures the same span as "Term in days"', () => {
  const ALL = async (): Promise<Case[]> => [
    ...(await Promise.all(VECTORS.map(async (v) => ({ label: v.name, input: await v.input() })))),
    ...SWEEP_ACCEPTED,
  ];

  it('for every vector row and every sweep case (198; B33, was 153): addMonthsClamped(start, 12y+m) + days = last row; daysBetween(start, last) === termDays', async () => {
    const bad: string[] = [];
    const cases = await ALL();
    for (const c of cases) {
      const r = ca.calculateCobCanada(c.input);
      const start = startOf(c.input);
      const last = r.amortizationSchedule.at(-1)!.date;
      const t = contractTerm(c.input, r);
      const rebuilt = addMonthsClamped(start, 12 * t.years + t.months).getTime() + t.days * DAY;
      if (rebuilt !== last.getTime()) bad.push(`${c.label}: rebuilt ${isoDay(new Date(rebuilt))} != ${isoDay(last)}`);
      if (daysBetween(start, last) !== r.termDays) bad.push(`${c.label}: daysBetween ${daysBetween(start, last)} != termDays ${r.termDays}`);
    }
    expect(bad).toEqual([]);
    expect(cases).toHaveLength(18 + 180); // B33 (DEC-B33-FREQ): was 18 + 135
  });
});

// ---------------------------------------------------------------------------------------------------------------
// T4 the move no longer moves the term
// ---------------------------------------------------------------------------------------------------------------
describe('B32-T4 INV-MOVE: the first payment date no longer moves the term (supersedes Q-CT-B25)', () => {
  const semi = (flow: CobFlow, typed: string): CobCanadaInput => asInput({
    flow, productType: 'mortgage', rateType: 'variable', loanAmount: 100000, contractRatePercent: 5, paymentAmount: 1000, paymentFrequency: 'semiMonthly',
    fees: { fees: [] }, firstPaymentDate: d(typed), endDate: d('2029-01-15'),
    ...(flow === 'newMortgageOrLoan' ? { disbursalDate: d('2027-01-01') } : { renewalDate: d('2027-01-01'), accruedInterest: 0 }),
  });

  it.each([
    ['new, typed 2027-01-10 (moved to 01-15)', 'newMortgageOrLoan', '2027-01-10', '2027-01-15'],
    ['new, typed 2027-01-15 (not moved)', 'newMortgageOrLoan', '2027-01-15', '2027-01-15'],
    ['paymentChange, typed 2027-01-20 (moved to 01-31)', 'paymentChange', '2027-01-20', '2027-01-31'],
  ] as const)('%s: 2 years, 0 months, 14 days', (_n, flow, typed, row1) => {
    const input = semi(flow, typed);
    const r = ca.calculateCobCanada(input);
    expect(isoDay(r.amortizationSchedule[0]!.date)).toBe(row1);
    expect(contractTerm(input, r)).toEqual(T(2, 0, 14));
  });
});

// ---------------------------------------------------------------------------------------------------------------
// T5 errors and the field chosen by the flow
// ---------------------------------------------------------------------------------------------------------------
const throwsOf = (fn: () => unknown): { type: string; message: string } | null => {
  try { fn(); return null; } catch (e) { return { type: (e as Error).constructor.name, message: (e as Error).message }; }
};

describe('B32-T5 INV-ERRORS: RangeError, never TypeError, in the brief\'s check order; the start field is chosen by the flow', () => {
  const FLOW_MSG = 'flow must be one of newMortgageOrLoan/renewal/paymentChange/variableRatePaymentChange';

  it('an empty schedule with REF-01\'s input: RangeError "amortizationSchedule must have at least one row"', async () => {
    const input = await capturedInput('REF-01');
    expect(throwsOf(() => contractTerm(input, { amortizationSchedule: [] }))).toEqual({ type: 'RangeError', message: 'amortizationSchedule must have at least one row' });
  });

  it('the empty-schedule check comes first: an empty schedule with a bogus flow still names the schedule', async () => {
    const input = { ...(await capturedInput('REF-01')), flow: 'bogus' };
    expect(throwsOf(() => contractTerm(input, { amortizationSchedule: [] }))).toEqual({ type: 'RangeError', message: 'amortizationSchedule must have at least one row' });
  });

  it.each(['bogus', 'toString', '__proto__', ''])('flow %j with REF-01\'s result: RangeError naming the four flows', async (flow) => {
    const input = await capturedInput('REF-01');
    const r = ca.calculateCobCanada(input);
    expect(throwsOf(() => contractTerm({ ...input, flow }, r))).toEqual({ type: 'RangeError', message: FLOW_MSG });
  });

  it.each([
    ['undefined', undefined],
    ['new Date(NaN)', new Date(NaN)],
    ['an ISO string', '2026-04-01'],
    ['a number', Date.UTC(2026, 3, 1)],
  ] as const)('a renewal input with renewalDate %s: RangeError "renewalDate must be a valid Date"', async (_n, value) => {
    const input = await capturedInput('RENEWAL');
    const r = ca.calculateCobCanada(input);
    expect(throwsOf(() => contractTerm({ ...input, renewalDate: value }, r))).toEqual({ type: 'RangeError', message: 'renewalDate must be a valid Date' });
  });

  it('a new-flow input with disbursalDate missing or invalid: RangeError naming disbursalDate', async () => {
    const input = await capturedInput('REF-01');
    const r = ca.calculateCobCanada(input);
    expect(throwsOf(() => contractTerm({ ...input, disbursalDate: new Date(NaN) }, r))).toEqual({ type: 'RangeError', message: 'disbursalDate must be a valid Date' });
    expect(throwsOf(() => contractTerm({ ...input, disbursalDate: undefined }, r))).toEqual({ type: 'RangeError', message: 'disbursalDate must be a valid Date' });
  });

  it('paymentChange reads renewalDate (Date of change): an invalid renewalDate names renewalDate', async () => {
    const input = await VECTORS[0]!.input();
    const r = ca.calculateCobCanada(input);
    expect(throwsOf(() => contractTerm({ ...input, renewalDate: new Date(NaN) }, r))).toEqual({ type: 'RangeError', message: 'renewalDate must be a valid Date' });
  });

  it('a new-flow input with disbursalDate 2030-01-01 against REF-01\'s result: RangeError "from must be on or before to"', async () => {
    const input = await capturedInput('REF-01');
    const r = ca.calculateCobCanada(input);
    const got = throwsOf(() => contractTerm({ ...input, disbursalDate: d('2030-01-01') }, r));
    expect(got?.type).toBe('RangeError');
    expect(got?.message).toMatch(/from must be on or before to/);
  });

  it('the field is chosen by the flow: a renewal input that also carries a different disbursalDate uses renewalDate', async () => {
    const input = await capturedInput('RENEWAL'); // renewalDate 2026-04-01, disbursalDate 2026-03-17 (both on the raw form)
    const r = ca.calculateCobCanada(input);
    const both = { ...input, disbursalDate: d('2025-01-01') };
    expect(contractTerm(both, r)).toEqual(T(2, 6, 0));
    expect(contractTerm(both, r)).not.toEqual(refTerm(d('2025-01-01'), r.amortizationSchedule.at(-1)!.date));
  });

  it('and a new-flow input that also carries a renewalDate uses disbursalDate', async () => {
    const input = await capturedInput('REF-01');
    const r = ca.calculateCobCanada(input);
    expect(contractTerm({ ...input, renewalDate: d('2026-03-01') }, r)).toEqual(T(2, 11, 23));
  });

  it('the first row is not read: a result whose only row is the last row gives the same term (minimal Pick; times of day dropped)', async () => {
    const input = await capturedInput('REF-01');
    expect(contractTerm(input, { amortizationSchedule: [{ date: new Date('2029-03-12T18:00:00Z') }] })).toEqual(T(2, 11, 23));
    const rows = [{ date: new Date('2028-01-01T00:00:00Z') }, { date: new Date('2029-03-12T03:00:00Z') }];
    expect(contractTerm({ ...input, disbursalDate: new Date('2026-03-17T23:59:00Z') }, { amortizationSchedule: rows })).toEqual(T(2, 11, 23));
  });

  it('swapped arguments throw (the input has no amortizationSchedule), never return a term', async () => {
    const input = await capturedInput('REF-01');
    const r = ca.calculateCobCanada(input);
    expect(() => contractTerm(r, input)).toThrow();
  });
});

// ---------------------------------------------------------------------------------------------------------------
// T6 barrels
// ---------------------------------------------------------------------------------------------------------------
interface PrePins { exports: { caBarrel: string[]; rootBarrel: string[] } }
const PRE = loadFixture<PrePins>('b32_pre_label_pins.json');

describe('B32-T6 barrels: the two-argument contractTerm, one function, export lists unchanged', () => {
  it('contractTerm.length === 2 (input, result)', () => {
    expect((ca.contractTerm as unknown as (...a: unknown[]) => unknown).length).toBe(2);
  });

  it('cobCanada.ts, the src/ca barrel and the root barrel export the same function', () => {
    const fn = (cobModule as unknown as { contractTerm: unknown }).contractTerm;
    expect(ca.contractTerm).toBe(fn);
    expect((root as unknown as { contractTerm: unknown }).contractTerm).toBe(fn);
  });

  it('the runtime export lists of both barrels equal the pre-B32 pins (b32_pre_label_pins.json)', () => {
    expect(Object.keys(ca).sort()).toEqual(PRE.exports.caBarrel);
    expect(Object.keys(root).sort()).toEqual(PRE.exports.rootBarrel);
  });

  it('the result of calculateCobCanada still has no start-date or term field (goldens pin JSON.stringify of the result)', async () => {
    const r: CobCanadaResult = ca.calculateCobCanada(await capturedInput('REF-01'));
    expect(Object.keys(r).some((k) => /startDate|contractTerm|term(Years|Months|Text)/i.test(k))).toBe(false);
  });
});
