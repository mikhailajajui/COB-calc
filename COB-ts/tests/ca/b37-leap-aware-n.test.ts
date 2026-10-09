/**
 * B37 (COB-architecture.md §5 B37, revision 56, and its addendum, revision 57; user decision DEC-B37-LEAP-N, 2026-10-09;
 * answers Q-B37-REF01 / Q-B37-APPA / Q-B37-HINT / Q-B37-LABEL; label format: whole numbers, "DEC-B37-LEAP-N: label format").
 * Deviation DEV-B37-LEAPN. QA-owned; the developer must not edit this file or its fixture.
 *
 * Rule: for a fixed-rate mortgage (SEMI-ANNUAL basis) paid Weekly / Accelerated weekly (P = 7) or Bi-weekly / Accelerated
 * bi-weekly (P = 14), equation 1 uses n = (D / P) / Y (D = days from the flow's start date to the End date, Y = the same span
 * in leap-aware years) instead of 52 / 26; switch LEAP_AWARE_PAYMENTS_PER_YEAR (policies.ts, ADR-14), shipped true; off =
 * today byte for byte.
 *
 * Expected numbers come from QA's own oracle (tests/ca/support/leapNOracle.ts, no engine code), written to
 * fixtures/b37_leap_n_vectors.json by fixtures/generate_b37_leap_n_vectors.ts. B37-T0 is the oracle's trust check (the saved
 * workbook's REF-01 and the unmodified engine, switch off); it is green before and after B37.
 *
 * Tests: B37-T0 oracle trust; T1 INV-PIN; T2 INV-N, INV-GUARD; T3 vectors (both states; REF-01 on-state is
 * known_divergence DEV-B37-LEAPN); T4 INV-ORDER; T5 INV-BOUNDS, INV-SCOPE, INV-SAMEDATES (4,800-input sweep, 1999-2101);
 * T6 INV-RATE, INV-CONST (and the schedule oracle on every 7/14-day sweep case); T7 INV-ACCEL, INV-B19, INV-LEAPRULE;
 * T8 INV-OFF (the pre-B37 goldens replayed with the switch off); T9 the label's engine function paymentsPerYearFor
 * (INV-LABEL-N, INV-LABEL-SHARED, INV-LABEL-TOTAL, the C3 n vectors). In test:tz (B37-INV-PURE).
 *
 * Red until sr-dev lands B37-R1..R5 and B37-L1..L3: functions that do not exist yet are read at call time, so each test
 * fails on its own.
 */
import { createHash } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import * as ca from '../../src/ca/index.js';
import { PAYMENTS_PER_YEAR, calculateCobCanada, contractTerm } from '../../src/ca/index.js';
import type { CobCanadaInput, CobCanadaResult, CobFlow, PaymentFrequency, ProductType, RateType } from '../../src/ca/index.js';
import * as calendar from '../../src/ca/calendar.js';
import { addUtcDays, periodDateFor } from '../../src/ca/calendar.js';
import * as equations from '../../src/ca/equations.js';
import { calculatedRateFor, periodInterest } from '../../src/ca/equations.js';
import * as policies from '../../src/ca/policies.js';
import { SRC_CA, read, stripComments } from '../architecture/support.js';
import { asInput, isoDay, utcDate } from './support/builders.js';
import { expectRangeErrorMatching, withinRel } from './support/compare.js';
import { loadFixture } from './support/fixtures.js';
import {
  ORACLE_BASE_N,
  civilDays,
  civilIso,
  oracleConvertedDecimal,
  oracleN,
  oracleSchedule,
  oracleYears,
} from './support/leapNOracle.js';
import type { OracleCase } from './support/leapNOracle.js';
import { preB37GoldenText } from './support/preB37Golden.js';
import { BOTH_LEAP, LEAP_OFF, LEAP_ON, SHIPPED, WORKBOOK, calculateWith } from './support/switches.js';
import { join } from 'node:path';

// ------------------------------------------------------------------------------------------------ helpers
type Fn = (...args: never[]) => unknown;
function fnOf<T extends Fn>(mod: object, name: string): T {
  const f = (mod as Record<string, unknown>)[name];
  if (typeof f !== 'function') throw new Error(`B37: ${name} is not exported yet`);
  return f as T;
}
const leapAwarePaymentsPerYear = (p: number, s: Date, e: Date): number =>
  fnOf<(p: number, s: Date, e: Date) => number>(equations, 'leapAwarePaymentsPerYear')(p, s, e);
const conversionPaymentsPerYear = (
  pt: ProductType,
  rt: RateType,
  f: PaymentFrequency,
  s: Date | undefined,
  e: Date | undefined,
  leap: boolean,
): number =>
  fnOf<(pt: ProductType, rt: RateType, f: PaymentFrequency, s: Date | undefined, e: Date | undefined, l: boolean) => number>(
    equations,
    'conversionPaymentsPerYear',
  )(pt, rt, f, s, e, leap);
const paymentPeriodDays = (f: string): number | null => fnOf<(f: string) => number | null>(calendar, 'paymentPeriodDays')(f);
/** The public label function, read from the barrel (ADR-13(j)). */
const paymentsPerYearFor = (x: CobCanadaInput, f: string): number =>
  fnOf<(x: CobCanadaInput, f: string) => number>(ca, 'paymentsPerYearFor')(x, f);
const leapSwitch = (): unknown => (policies as Record<string, unknown>).LEAP_AWARE_PAYMENTS_PER_YEAR;

const on = (x: CobCanadaInput): CobCanadaResult => calculateWith(x, SHIPPED, LEAP_ON);
const off = (x: CobCanadaInput): CobCanadaResult => calculateWith(x, SHIPPED, LEAP_OFF);
const json = (r: unknown): string => JSON.stringify(r);
const cents = (x: number): number => Math.round(x * 100) / 100;
const sha256 = (s: string): string => createHash('sha256').update(s).digest('hex');

/** Oracle case -> engine input (UTC midnight dates). */
function toInput(c: OracleCase): CobCanadaInput {
  const fees = {
    fees: [
      ...c.financedFees.map((amount, i) => ({ name: `F${i}`, amount, financed: true })),
      ...c.cashFees.map((amount, i) => ({ name: `C${i}`, amount, financed: false })),
    ],
  };
  const common = {
    flow: c.flow,
    productType: c.productType,
    rateType: c.rateType,
    contractRatePercent: c.contractRatePercent,
    loanAmount: c.loanAmount,
    paymentFrequency: c.frequency,
    paymentAmount: c.paymentAmount,
    firstPaymentDate: utcDate(c.first),
    endDate: utcDate(c.end),
    fees,
  };
  return asInput(
    c.flow === 'newMortgageOrLoan'
      ? { ...common, disbursalDate: utcDate(c.start) }
      : { ...common, renewalDate: utcDate(c.start), accruedInterest: c.accruedInterest },
  );
}

// ------------------------------------------------------------------------------------------------ fixture
interface Totals {
  n: number;
  calculatedRatePercent: number;
  numberOfPayments: number;
  totalInterest: number;
  principalPayment: number;
  endingBalance: number;
  termDays: number;
  cobAmount: number;
  cobRatePercent: number;
  row1PeriodInterest: number;
  lastRowDate: string;
}
interface Vectors {
  cases: Record<string, { input: OracleCase; D: number; Y: number; on: Totals; off: Totals }>;
  nVectors: { periodDays: number; start: string; end: string; n: number }[];
  labelN: Record<string, { start: string; end: string; n: Record<string, number> }>;
}
const V = loadFixture<Vectors>('b37_leap_n_vectors.json');
const CASE_IDS = Object.keys(V.cases);
const caseOf = (id: string) => V.cases[id]!;

// The brief's table (COB-architecture.md §5 B37 "Vectors"), as literals: the oracle fixture must agree with it exactly.
const BRIEF: Record<string, { D?: number; Y?: number; n: number; onRate: number; onTI: number; onPP?: number; N?: number; offRate: number; offTI: number }> = {
  'V-CASE1': { D: 1081, Y: 2.9589041095890414, n: 26.095568783068778, onRate: 4.297115439387225, onTI: 60137.618211587614, onPP: 43861.66178841238, N: 77, offRate: 4.297128436970388, offTI: 60137.811965667206 },
  'V-EX2': { D: 1631, Y: 4.465753424657534, n: 26.087423312883434, onRate: 4.257898074996161, onTI: 74326.10837208964, onPP: 48523.89162791039, N: 117, offRate: 4.257909752442668, offTI: 74326.33141908054 },
  'V-WEEKLY': { D: 1081, Y: 2.9589041095890414, n: 52.191137566137556, onRate: 4.295347896619311, onTI: 60092.058340465344, onPP: 43907.22165953466, N: 154, offRate: 4.295354391840345, offTI: 60092.15517062708 },
  'V-NOLEAP-EXACT': { D: 730, Y: 2, n: 52.142857142857146, onRate: 5.915112980676596, onTI: 27495.81781302489, onPP: 34904.18218697511, N: 104, offRate: 5.9151221944217625, offTI: 27495.86331047438 },
  'V-NOLEAP-ULP': { D: 728, Y: 1.9945205479452055, n: 52.14285714285714, onRate: 4.940861928258346, onTI: 26860.159233793678, onPP: 56339.84076620632, N: 104, offRate: 4.940868357244277, offTI: 26860.196007946724 },
  'V-2028': { D: 343, Y: 0.9371584699453552, n: 26.142857142857142, onRate: 4.943190020396645, onTI: 13067.52165346835, onPP: 25332.47834653165, N: 24, offRate: 4.943215682256108, offTI: 13067.591010389247 },
  'V-WHOLE5Y': { D: 1826, Y: 5, n: 26.085714285714282, onRate: 5.918464372064263, onTI: 64785.229272157296, onPP: 65214.77072784272, N: 130, offRate: 5.918486489669039, offTI: 64785.512107596245 },
  'V-REF01': { D: 1096, Y: 3, n: 52.1904761904762, onRate: 3.7067766504448727, onTI: 22514.07489146169, onPP: 50097.685108538324, offRate: 3.706781471105014, offTI: 22514.10591158249 },
};

// ================================================================================================ T0
describe('B37-T0 oracle trust check (green before and after B37): QA\'s oracle reproduces the workbook and today\'s engine with the switch off', () => {
  it('the vector fixture equals a fresh oracle run, and agrees with the brief\'s table exactly', () => {
    for (const id of CASE_IDS) {
      const v = caseOf(id);
      for (const [state, leap] of [['on', true], ['off', false]] as const) {
        const o = oracleSchedule(v.input, leap);
        const t = v[state];
        expect(o.calculatedRatePercent, `${id} ${state}`).toBe(t.calculatedRatePercent);
        expect(o.totalInterest, `${id} ${state}`).toBe(t.totalInterest);
        expect(o.endingBalance, `${id} ${state}`).toBe(t.endingBalance);
        expect(o.cobRatePercent, `${id} ${state}`).toBe(t.cobRatePercent);
      }
    }
    for (const [id, b] of Object.entries(BRIEF)) {
      const v = caseOf(id);
      if (b.D !== undefined) expect(v.D, id).toBe(b.D);
      if (b.Y !== undefined) expect(v.Y, id).toBe(b.Y);
      expect(v.on.n, id).toBe(b.n);
      expect(v.on.calculatedRatePercent, id).toBe(b.onRate);
      expect(v.on.totalInterest, id).toBe(b.onTI);
      if (b.onPP !== undefined) expect(v.on.principalPayment, id).toBe(b.onPP);
      if (b.N !== undefined) expect(v.on.numberOfPayments, id).toBe(b.N);
      expect(v.off.calculatedRatePercent, id).toBe(b.offRate);
      expect(v.off.totalInterest, id).toBe(b.offTI);
    }
    expect(caseOf('V-FEES').on.cobRatePercent).toBe(4.332873910153778);
    expect(caseOf('V-FEES').on.cobAmount).toBe(60637.618211587614);
    expect(caseOf('V-FEES').off.cobRatePercent).toBe(4.332886887926772);
    expect(caseOf('V-REF01').on.endingBalance).toBe(177731.96489146174);
    expect(caseOf('V-REF01').on.row1PeriodInterest).toBe(138.8241578464155);
    expect(caseOf('V-CASE1').on.endingBalance).toBe(451605.20821158733);
  });

  it('off: the oracle reproduces the saved workbook REF-01 (rate exactly; every row date and interest, total interest, 1e-9)', () => {
    const ref = loadFixture<{ inputs: Record<string, number | string>; summary: Record<string, number>; rows: Record<string, number | string>[] }>(
      'ca_ref01_workbook_saved.json',
    );
    const o = oracleSchedule(caseOf('V-REF01').input, false);
    expect(o.calculatedRatePercent).toBe(ref.inputs.calculated_rate_pct);
    expect(o.rows.map((r) => r.date)).toEqual(ref.rows.map((r) => r.date));
    o.rows.forEach((r, i) => expect(withinRel(r.periodInterest, ref.rows[i]!.new_int as number, 1e-9), `row ${i + 1}`).toBe(true));
    expect(withinRel(o.totalInterest, ref.summary.total_interest!, 1e-9)).toBe(true);
    expect(o.numberOfPayments).toBe(ref.summary.n_payments);
    expect(o.termDays).toBe(ref.summary.term_days);
  });

  it.each(CASE_IDS)('off: %s: the oracle equals the engine with the switch off on every row and total (Object.is)', (id) => {
    const c = caseOf(id).input;
    const o = oracleSchedule(c, false);
    const r = off(toInput(c));
    expect(r.amortizationSchedule.length).toBe(o.rows.length);
    r.amortizationSchedule.forEach((row, i) => {
      const q = o.rows[i]!;
      expect(isoDay(row.date)).toBe(q.date);
      expect(row.openingBalance).toBe(q.openingBalance);
      expect(row.periodInterest).toBe(q.periodInterest);
      expect(row.interestPaid).toBe(q.interestPaid);
      expect(row.principalPortion).toBe(q.principalPortion);
      expect(row.closingBalance).toBe(q.closingBalance);
    });
    for (const k of ['calculatedRatePercent', 'totalInterest', 'principalPayment', 'endingBalance', 'termDays', 'cobAmount', 'cobRatePercent', 'numberOfPayments'] as const) {
      expect(r[k], k).toBe(o[k]);
    }
  });
});

// ================================================================================================ T1
describe('B37-T1 INV-PIN: the switch is shipped on, and calculateCobCanada is the on state', () => {
  it('LEAP_AWARE_PAYMENTS_PER_YEAR === true (value pin, ADR-14)', () => {
    expect(leapSwitch()).toBe(true);
  });

  it('calculateCobCanada(V-CASE1) JSON-equals calculateCobCanadaWith(V-CASE1, SHIPPED, true), and its rate is the leap-aware one', () => {
    const x = toInput(caseOf('V-CASE1').input);
    expect(json(calculateCobCanada(x))).toBe(json(on(x)));
    expect(calculateCobCanada(x).calculatedRatePercent).toBe(4.297115439387225);
  });

  it('the two states differ on V-CASE1 (the third parameter is honoured both ways)', () => {
    const x = toInput(caseOf('V-CASE1').input);
    expect(on(x).calculatedRatePercent).toBe(caseOf('V-CASE1').on.calculatedRatePercent);
    expect(off(x).calculatedRatePercent).toBe(caseOf('V-CASE1').off.calculatedRatePercent);
  });

  it('source: calculateCobCanadaWith takes the switch as a defaulted third parameter; calculateCobCanada passes two arguments', () => {
    const code = stripComments(read(join(SRC_CA, 'cobCanada.ts')));
    expect(code).toMatch(
      /export function calculateCobCanadaWith\(\s*input: CobCanadaInput,\s*switches: EngineSwitches,\s*leapAware: boolean = LEAP_AWARE_PAYMENTS_PER_YEAR,?\s*\): CobCanadaResult/,
    );
    expect(code).toMatch(/return calculateCobCanadaWith\(input, SHIPPED_SWITCHES\);/);
  });
});

// ================================================================================================ T2
describe('B37-T2 INV-N and INV-GUARD: leapAwarePaymentsPerYear and paymentPeriodDays', () => {
  it.each(V.nVectors.map((v) => [v.periodDays, v.start, v.end, v.n] as const))(
    'leapAwarePaymentsPerYear(%i, %s, %s) is %f exactly (Object.is the oracle)',
    (p, s, e, n) => {
      expect(Object.is(leapAwarePaymentsPerYear(p, utcDate(s), utcDate(e)), n)).toBe(true);
    },
  );

  it('the brief\'s n-only literals', () => {
    const lit: [number, string, string, number][] = [
      [14, '2026-10-08', '2029-09-23', 26.095568783068778], [7, '2026-10-08', '2029-09-23', 52.191137566137556],
      [14, '2025-01-01', '2030-01-01', 26.085714285714282], [14, '2000-02-01', '2000-11-30', 26.142857142857142],
      [7, '2100-01-04', '2100-12-27', 52.142857142857146], [14, '2025-03-01', '2025-12-01', 26.07142857142857],
      [7, '2026-10-08', '2026-10-09', 52.14285714285714], [14, '2027-12-31', '2028-01-01', 26.07142857142857],
      [14, '2028-12-31', '2029-01-01', 26.142857142857142],
    ];
    for (const [p, s, e, n] of lit) {
      expect(V.nVectors.find((v) => v.periodDays === p && v.start === s && v.end === e)!.n).toBe(n);
      expect(leapAwarePaymentsPerYear(p, utcDate(s), utcDate(e))).toBe(n);
    }
  });

  it('no snapping to 365/P: the no-leap spans keep their float bits (one is 365/7 exactly, two are one ulp below)', () => {
    expect(leapAwarePaymentsPerYear(7, utcDate('2099-06-01'), utcDate('2101-06-01'))).toBe(365 / 7);
    expect(leapAwarePaymentsPerYear(7, utcDate('2025-01-06'), utcDate('2027-01-04'))).not.toBe(365 / 7);
    expect(leapAwarePaymentsPerYear(14, utcDate('2025-03-01'), utcDate('2025-12-01'))).not.toBe(365 / 14);
  });

  it('RangeError guards: start === end, start after end, periodDays 0', () => {
    expectRangeErrorMatching(() => leapAwarePaymentsPerYear(14, utcDate('2026-10-08'), utcDate('2026-10-08')), /^start must be before end$/);
    expectRangeErrorMatching(() => leapAwarePaymentsPerYear(14, utcDate('2026-10-09'), utcDate('2026-10-08')), /^start must be before end$/);
    expectRangeErrorMatching(() => leapAwarePaymentsPerYear(0, utcDate('2026-10-08'), utcDate('2027-10-08')), /^periodDays must be > 0, got 0$/);
  });

  it('paymentPeriodDays: 7, 7, 14, 14, null, null', () => {
    expect(['weekly', 'acceleratedWeekly', 'biweekly', 'acceleratedBiweekly', 'monthly', 'semiMonthly'].map(paymentPeriodDays)).toEqual([
      7, 7, 14, 14, null, null,
    ]);
  });

  it('paymentPeriodDays agrees with the schedule step: addUtcDays(first, P) === periodDateFor(f, first, 1, first)', () => {
    for (const f of ['weekly', 'acceleratedWeekly', 'biweekly', 'acceleratedBiweekly'] as const) {
      for (const first of ['2027-12-28', '2028-02-25', '2100-02-26', '2026-03-23']) {
        const d = utcDate(first);
        expect(addUtcDays(d, paymentPeriodDays(f)!).getTime(), `${f} ${first}`).toBe(periodDateFor(f, d, 1, d).getTime());
      }
    }
  });
});

// ================================================================================================ T3
describe('B37-T3 vectors, both states (on: the leap-aware n; off: the workbook converter, today byte for byte)', () => {
  const FIELDS = ['calculatedRatePercent', 'numberOfPayments', 'totalInterest', 'principalPayment', 'endingBalance', 'termDays', 'cobAmount', 'cobRatePercent'] as const;
  const rows = CASE_IDS.flatMap((id) => BOTH_LEAP.map(([label, leap]) => [id, label, leap] as const));
  it.each(rows)('%s [%s]: every headline output, row 1 and the last row date equal the oracle exactly', (id, _label, leap) => {
    // known_divergence DEV-B37-LEAPN (Q-B37-REF01): for V-REF01 the on state is the shipped calculator, which no longer
    // reproduces the saved workbook (total interest 22,514.11 -> 22,514.07); the off state is the workbook (ref01-workbook.test.ts).
    const v = caseOf(id);
    const t = leap ? v.on : v.off;
    const r = calculateWith(toInput(v.input), SHIPPED, leap);
    for (const k of FIELDS) expect(r[k], `${id} ${k}`).toBe(t[k]);
    expect(r.amortizationSchedule[0]!.periodInterest).toBe(t.row1PeriodInterest);
    expect(isoDay(r.amortizationSchedule.at(-1)!.date)).toBe(t.lastRowDate);
  });

  it.each(CASE_IDS)('%s [on]: every row equals the oracle (Object.is)', (id) => {
    const c = caseOf(id).input;
    const o = oracleSchedule(c, true);
    const r = on(toInput(c));
    expect(r.amortizationSchedule.length).toBe(o.rows.length);
    r.amortizationSchedule.forEach((row, i) => {
      const q = o.rows[i]!;
      expect(isoDay(row.date)).toBe(q.date);
      expect(row.periodInterest, `row ${i + 1}`).toBe(q.periodInterest);
      expect(row.interestPaid, `row ${i + 1}`).toBe(q.interestPaid);
      expect(row.principalPortion, `row ${i + 1}`).toBe(q.principalPortion);
      expect(row.closingBalance, `row ${i + 1}`).toBe(q.closingBalance);
    });
  });

  it('known_divergence DEV-B37-LEAPN REF-01 (shipped): total interest 22,514.07 and Balance 177,731.96, not the workbook\'s 22,514.11 / 177,732.00', () => {
    const r = calculateCobCanada(toInput(caseOf('V-REF01').input));
    expect(r.calculatedRatePercent).toBe(3.7067766504448727);
    expect(cents(r.totalInterest)).toBe(22514.07);
    expect(cents(r.endingBalance)).toBe(177731.96);
    expect(cents(r.principalPayment)).toBe(50097.69);
    expect(r.numberOfPayments).toBe(156);
  });

  it('US-08 the user\'s case 1 (V-CASE1, shipped): D 1,081, Y = 85/365 + 1 + 1 + 265/365, n 26.0955688..., rate 4.297115439387225 %, Total interest 60,137.62, Total principal 43,861.66', () => {
    const v = caseOf('V-CASE1');
    expect(v.D).toBe(1081);
    expect(v.Y).toBe(85 / 365 + 1 + 1 + 265 / 365);
    const r = calculateCobCanada(toInput(v.input));
    expect(r.calculatedRatePercent).toBe(4.297115439387225);
    expect(cents(r.totalInterest)).toBe(60137.62);
    expect(cents(r.principalPayment)).toBe(43861.66);
    expect(r.cobRatePercent).toBe(r.calculatedRatePercent); // no fees: OQ-Q short-circuit uses the new rate
  });

  it('US-08 the user\'s example 2 (V-EX2, shipped): D 1,631, Y = 85/365 + 4 + 85/365, rate 4.257898074996161 %, Total interest 74,326.11, Total principal 48,523.89 (Excel to the cent)', () => {
    const v = caseOf('V-EX2');
    expect(v.D).toBe(1631);
    expect(withinRel(v.Y, 85 / 365 + 4 + 85 / 365, 1e-15)).toBe(true);
    const r = calculateCobCanada(toInput(v.input));
    expect(r.calculatedRatePercent).toBe(4.257898074996161);
    expect(cents(r.totalInterest)).toBe(74326.11);
    expect(cents(r.principalPayment)).toBe(48523.89);
  });

  // Controls (B37-INV-SCOPE): values are today's engine (QA ran the unmodified engine, 2026-10-09); on === off.
  const vc = caseOf('V-CASE1').input;
  const CONTROLS: [string, CobCanadaInput, number, number, number | null][] = [
    ['C-MONTHLY', toInput({ ...vc, frequency: 'weekly' }), 4.301271675874396, 60155.38468203708, null],
    ['C-SEMI', toInput({ ...vc }), 4.297424206123068, 59857.28280638032, null],
    ['C-VAR', toInput({ ...vc, rateType: 'variable' }), 4.34, 60777.30834943973, 7.087585896510093],
    ['C-VRPC', toInput({ ...vc, flow: 'variableRatePaymentChange', rateType: 'variable', frequency: 'weekly', paymentAmount: 675.32, first: '2026-10-14' }), 4.34, 60758.17883281611, 7.087585896510093],
    ['C-PL', toInput({ ...vc, flow: 'newMortgageOrLoan', productType: 'personalLoan', rateType: 'fixed', loanAmount: 20000, contractRatePercent: 8, paymentAmount: 300, first: '2026-10-22', accruedInterest: 0 }), 8, 2408.246744021781, null],
  ];
  // Monthly / semi-monthly are not in OracleCase's frequency union: set them on the engine input.
  CONTROLS[0]![1] = asInput({ ...CONTROLS[0]![1], paymentFrequency: 'monthly', paymentAmount: 2930 });
  CONTROLS[1]![1] = asInput({ ...CONTROLS[1]![1], paymentFrequency: 'semiMonthly', paymentAmount: 1465, firstPaymentDate: utcDate('2026-10-15') });
  it.each(CONTROLS)('%s: on JSON-equals off; rate, total interest and trigger rate as today', (_id, x, rate, ti, trigger) => {
    const a = on(x);
    const b = off(x);
    expect(json(a)).toBe(json(b));
    expect(a.calculatedRatePercent).toBe(rate);
    expect(a.totalInterest).toBe(ti);
    expect(a.triggerRatePercent).toBe(trigger);
  });
});

// ================================================================================================ T4
describe('B37-T4 INV-ORDER: n = (D / P) / Y, evaluated left to right', () => {
  it.each(['V-WEEKLY', 'V-WHOLE5Y'])('%s: the shipped rate is equation 1 at (D / P) / Y, and differs from equation 1 at D / (P * Y)', (id) => {
    const v = caseOf(id);
    const p = paymentPeriodDays(v.input.frequency)!;
    const nOrdered = v.D / p / v.Y;
    const nOther = v.D / (p * v.Y);
    expect(nOrdered).toBe(v.on.n);
    expect(nOther).not.toBe(nOrdered);
    const r = on(toInput(v.input));
    expect(r.calculatedRatePercent).toBe(calculatedRateFor('mortgage', 'fixed', v.input.contractRatePercent, nOrdered).percent);
    expect(r.calculatedRatePercent).not.toBe(calculatedRateFor('mortgage', 'fixed', v.input.contractRatePercent, nOther).percent);
  });
});

// ================================================================================================ sweep
const FLOW_IDS: CobFlow[] = ['newMortgageOrLoan', 'renewal', 'paymentChange', 'variableRatePaymentChange'];
const SIX: PaymentFrequency[] = ['weekly', 'acceleratedWeekly', 'biweekly', 'acceleratedBiweekly', 'semiMonthly', 'monthly'];
const DAY_BASED = new Set<string>(['weekly', 'acceleratedWeekly', 'biweekly', 'acceleratedBiweekly']);
interface SweepCase {
  x: CobCanadaInput;
  flow: CobFlow;
  pt: ProductType;
  rt: RateType;
  f: PaymentFrequency;
  start: string;
  end: string;
  oc: OracleCase | null;
}
/** Deterministic 4,800-input sweep: four flows, both products and rate types (as each flow allows), six frequencies,
 *  start dates 1999-01-01 .. 2101-06-30 (every 8th case inside 2000, every 8th inside 2100), spans 1 .. 3,021 days. */
function buildSweep(): SweepCase[] {
  let seed = 37;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648), seed / 2147483648);
  const lo = civilDays('1999-01-01');
  const hi = civilDays('2101-06-30');
  const out: SweepCase[] = [];
  for (let i = 0; i < 4800; i += 1) {
    const flow = FLOW_IDS[i % 4]!;
    const f = SIX[Math.floor(i / 4) % 6]!;
    let pt: ProductType = rnd() < 0.6 ? 'mortgage' : 'personalLoan';
    let rt: RateType = rnd() < 0.6 ? 'fixed' : 'variable';
    if (flow === 'renewal') pt = 'mortgage';
    if (flow === 'variableRatePaymentChange') [pt, rt] = ['mortgage', 'variable'];
    const startDay =
      i % 8 === 3 ? civilDays('2000-01-01') + Math.floor(rnd() * 366) : i % 8 === 5 ? civilDays('2100-01-01') + Math.floor(rnd() * 365) : lo + Math.floor(rnd() * (hi - lo));
    const firstDay = startDay + Math.floor(rnd() * 21);
    const endDay = firstDay + 1 + Math.floor(rnd() * 3000);
    const loan = +(10000 + rnd() * 590000).toFixed(2);
    const rate = +(0.5 + rnd() * 11.5).toFixed(3);
    const ppy = PAYMENTS_PER_YEAR[f];
    const pay = +((loan * rate) / 100 / ppy * (rnd() < 0.1 ? 0.6 : 1.1 + rnd() * 2)).toFixed(2);
    const accrued = flow === 'newMortgageOrLoan' ? 0 : rnd() < 0.5 ? 0 : +(rnd() * 1200).toFixed(2);
    const feeDraw = rnd();
    const financedFees = feeDraw < 0.15 ? [+(rnd() * 3000).toFixed(2)] : [];
    const cashFees = feeDraw > 0.85 ? [+(rnd() * 800).toFixed(2)] : [];
    const start = civilIso(startDay);
    const end = civilIso(endDay);
    const first = civilIso(firstDay);
    const oc: OracleCase | null = DAY_BASED.has(f)
      ? { flow, productType: pt, rateType: rt, frequency: f as OracleCase['frequency'], loanAmount: loan, contractRatePercent: rate, paymentAmount: pay, accruedInterest: accrued, start, first, end, financedFees, cashFees }
      : null;
    const fees = { fees: [...financedFees.map((amount) => ({ name: 'F', amount, financed: true })), ...cashFees.map((amount) => ({ name: 'C', amount, financed: false }))] };
    const common = { flow, productType: pt, rateType: rt, contractRatePercent: rate, loanAmount: loan, paymentFrequency: f, paymentAmount: pay, firstPaymentDate: utcDate(first), endDate: utcDate(end), fees };
    const x = asInput(flow === 'newMortgageOrLoan' ? { ...common, disbursalDate: utcDate(start) } : { ...common, renewalDate: utcDate(start), accruedInterest: accrued });
    out.push({ x, flow, pt, rt, f, start, end, oc });
  }
  return out;
}
const SWEEP = buildSweep();
type Outcome = { ok: true; on: CobCanadaResult; off: CobCanadaResult } | { ok: false; onErr: string; offErr: string };
let OUTCOMES: Outcome[] = [];
const tryRun = (fn: () => CobCanadaResult): CobCanadaResult | string => {
  try {
    return fn();
  } catch (e) {
    return e instanceof Error ? `${e.name}: ${e.message}` : String(e);
  }
};
function outcomes(): Outcome[] {
  if (OUTCOMES.length === 0) {
    OUTCOMES = SWEEP.map((c) => {
      const a = tryRun(() => on(c.x));
      const b = tryRun(() => off(c.x));
      return typeof a === 'string' || typeof b === 'string'
        ? { ok: false, onErr: typeof a === 'string' ? a : 'ok', offErr: typeof b === 'string' ? b : 'ok' }
        : { ok: true, on: a, off: b };
    });
  }
  return OUTCOMES;
}
const isConverted = (c: SweepCase) => c.pt === 'mortgage' && c.rt === 'fixed' && DAY_BASED.has(c.f);

// ================================================================================================ T5
describe('B37-T5 sweep (4,800 inputs): INV-BOUNDS, INV-SCOPE, INV-SAMEDATES', () => {
  beforeAll(() => {
    outcomes();
  }, 120_000);

  it('the sweep is wide: every flow, product / rate type and frequency occurs; starts in 2000 and 2100; most cases calculate in both states; errors are identical in both states', () => {
    const res = outcomes();
    const ok = res.filter((o) => o.ok).length;
    expect(ok).toBeGreaterThan(4000);
    for (const o of res) if (!o.ok) expect(o.onErr).toBe(o.offErr);
    expect(SWEEP.filter((c) => c.start.startsWith('2000-')).length).toBeGreaterThan(500);
    expect(SWEEP.filter((c) => c.start.startsWith('2100-')).length).toBeGreaterThan(500);
    expect(SWEEP.filter((c, i) => isConverted(c) && res[i]!.ok).length).toBeGreaterThan(800);
    for (const f of SIX) expect(SWEEP.some((c) => c.f === f)).toBe(true);
    for (const fl of FLOW_IDS) expect(SWEEP.some((c) => c.flow === fl)).toBe(true);
  });

  it('INV-BOUNDS: fixed mortgage at 7/14 days: 365/P (1 - 1e-12) <= n <= 366/P (1 + 1e-12), and the on rate is strictly below the off rate', () => {
    const res = outcomes();
    let checked = 0;
    const bad: string[] = [];
    SWEEP.forEach((c, i) => {
      const o = res[i]!;
      if (!isConverted(c) || !o.ok) return;
      const p = paymentPeriodDays(c.f)!;
      const n = oracleN(c.pt, c.rt, c.f, c.start, c.end, true);
      if (!(n >= (365 / p) * (1 - 1e-12) && n <= (366 / p) * (1 + 1e-12))) bad.push(`${i} n ${n}`);
      if (!(o.on.calculatedRatePercent < o.off.calculatedRatePercent)) bad.push(`${i} on ${o.on.calculatedRatePercent} off ${o.off.calculatedRatePercent}`);
      checked += 1;
    });
    expect(bad.slice(0, 5), `${bad.length} failures`).toEqual([]);
    expect(checked).toBeGreaterThan(800);
  });

  it('INV-SCOPE: every case that is not a fixed mortgage at 7/14 days (Monthly, Semi-monthly, variable, personal loan, VRPC) is byte-identical on and off', () => {
    const res = outcomes();
    const bad: number[] = [];
    let checked = 0;
    SWEEP.forEach((c, i) => {
      const o = res[i]!;
      if (isConverted(c) || !o.ok) return;
      checked += 1;
      if (json(o.on) !== json(o.off)) bad.push(i);
    });
    expect(bad.slice(0, 5), `${bad.length} differ`).toEqual([]);
    expect(checked).toBeGreaterThan(3000);
  });

  it('INV-SAMEDATES: fixed mortgage at 7/14 days: same row dates, number of payments, term days, disbursal, amortized principal, trigger rate (null) and contract term on and off', () => {
    const res = outcomes();
    const bad: string[] = [];
    SWEEP.forEach((c, i) => {
      const o = res[i]!;
      if (!isConverted(c) || !o.ok) return;
      const da = o.on.amortizationSchedule.map((r) => r.date.getTime()).join();
      const db = o.off.amortizationSchedule.map((r) => r.date.getTime()).join();
      if (da !== db) bad.push(`${i} dates`);
      for (const k of ['numberOfPayments', 'termDays', 'disbursalAmount', 'amortizedPrincipal', 'triggerRatePercent'] as const) {
        if (!Object.is(o.on[k], o.off[k])) bad.push(`${i} ${k}`);
      }
      if (o.on.triggerRatePercent !== null) bad.push(`${i} trigger not null`);
      if (json(contractTerm(c.x, o.on)) !== json(contractTerm(c.x, o.off))) bad.push(`${i} contractTerm`);
    });
    expect(bad.slice(0, 5), `${bad.length} failures`).toEqual([]);
  });
});

// ================================================================================================ T6
describe('B37-T6 INV-RATE and INV-CONST (the on-state twin of the A5 equivalence sweep); the schedule oracle on every 7/14-day case', () => {
  beforeAll(() => {
    outcomes();
  }, 120_000);

  it('INV-RATE: on, fixed mortgage at 7/14 days: calculatedRatePercent === calculatedRateFor(mortgage, fixed, j, n_oracle).percent === oracle equation 1; no fees: cobRatePercent === calculatedRatePercent', () => {
    const res = outcomes();
    const bad: string[] = [];
    SWEEP.forEach((c, i) => {
      const o = res[i]!;
      if (!isConverted(c) || !o.ok) return;
      const n = oracleN(c.pt, c.rt, c.f, c.start, c.end, true);
      const pct = calculatedRateFor('mortgage', 'fixed', c.x.contractRatePercent, n).percent;
      if (!Object.is(o.on.calculatedRatePercent, pct)) bad.push(`${i} engine ${o.on.calculatedRatePercent} vs ${pct}`);
      if (!Object.is(pct, oracleConvertedDecimal(c.x.contractRatePercent, n) * 100)) bad.push(`${i} oracle eq1`);
      if (c.x.fees.fees.length === 0 && !Object.is(o.on.cobRatePercent, o.on.calculatedRatePercent)) bad.push(`${i} cobRate`);
    });
    expect(bad.slice(0, 5), `${bad.length} failures`).toEqual([]);
  });

  it('INV-CONST: on, every case: every row\'s periodInterest === periodInterest(opening, decimal, prior, date) with the one decimal of equation 1 at the decided n', () => {
    const res = outcomes();
    let rows = 0;
    let mismatches = 0;
    SWEEP.forEach((c, i) => {
      const o = res[i]!;
      if (!o.ok) return;
      const n = oracleN(c.pt, c.rt, c.f, c.start, c.end, true);
      const dec = calculatedRateFor(c.pt, c.rt, c.x.contractRatePercent, n).decimal;
      let prior = utcDate(c.start);
      for (const row of o.on.amortizationSchedule) {
        rows += 1;
        if (!Object.is(row.periodInterest, periodInterest(row.openingBalance, dec, prior, row.date))) mismatches += 1;
        prior = row.date;
      }
    });
    expect(rows).toBeGreaterThan(100000);
    expect(mismatches).toBe(0);
  });

  it('QA schedule oracle: every 7/14-day case (any product, both states) matches the oracle\'s totals exactly', () => {
    const res = outcomes();
    const bad: string[] = [];
    let checked = 0;
    SWEEP.forEach((c, i) => {
      const o = res[i]!;
      if (c.oc === null || !o.ok) return;
      for (const [leap, r] of [[true, o.on], [false, o.off]] as const) {
        const q = oracleSchedule(c.oc, leap);
        for (const k of ['calculatedRatePercent', 'numberOfPayments', 'totalInterest', 'principalPayment', 'endingBalance', 'cobAmount', 'cobRatePercent', 'termDays'] as const) {
          if (!Object.is(r[k], q[k])) bad.push(`${i} ${leap ? 'on' : 'off'} ${k}: ${r[k]} vs ${q[k]}`);
        }
      }
      checked += 1;
    });
    expect(bad.slice(0, 5), `${bad.length} failures`).toEqual([]);
    expect(checked).toBeGreaterThan(2500);
  });
});

// ================================================================================================ T7
describe('B37-T7 INV-ACCEL, INV-B19, INV-LEAPRULE', () => {
  const twin = (x: CobCanadaInput, f: PaymentFrequency) => asInput({ ...x, paymentFrequency: f });
  it.each(BOTH_LEAP)('INV-ACCEL [%s]: accelerated weekly / bi-weekly JSON-equal weekly / bi-weekly (V-NOLEAP-EXACT, V-WHOLE5Y)', (_l, leap) => {
    const a = toInput(caseOf('V-NOLEAP-EXACT').input);
    expect(json(calculateWith(a, SHIPPED, leap))).toBe(json(calculateWith(twin(a, 'weekly'), SHIPPED, leap)));
    const b = toInput(caseOf('V-WHOLE5Y').input);
    expect(json(calculateWith(b, SHIPPED, leap))).toBe(json(calculateWith(twin(b, 'biweekly'), SHIPPED, leap)));
  });

  it('INV-ACCEL: the accelerated runs are the leap-aware ones in the on state', () => {
    expect(on(toInput(caseOf('V-NOLEAP-EXACT').input)).calculatedRatePercent).toBe(caseOf('V-NOLEAP-EXACT').on.calculatedRatePercent);
    expect(on(toInput(caseOf('V-WHOLE5Y').input)).calculatedRatePercent).toBe(caseOf('V-WHOLE5Y').on.calculatedRatePercent);
  });

  it('INV-B19: the leap switch is independent of unpaidInterestCapitalised (V-CASE1): the rate depends on the leap state only', () => {
    const x = toInput(caseOf('V-CASE1').input);
    const v = caseOf('V-CASE1');
    expect(calculateWith(x, WORKBOOK, LEAP_ON).calculatedRatePercent).toBe(v.on.calculatedRatePercent);
    expect(calculateWith(x, SHIPPED, LEAP_ON).calculatedRatePercent).toBe(v.on.calculatedRatePercent);
    expect(calculateWith(x, WORKBOOK, LEAP_OFF).calculatedRatePercent).toBe(v.off.calculatedRatePercent);
    expect(calculateWith(x, SHIPPED, LEAP_OFF).calculatedRatePercent).toBe(v.off.calculatedRatePercent);
  });

  it('INV-LEAPRULE: 2000 is a leap year (400 rule) and 2100 is not (100 rule), through the function and through the engine', () => {
    expect(leapAwarePaymentsPerYear(14, utcDate('2000-02-01'), utcDate('2000-11-30'))).toBe(366 / 14);
    expect(leapAwarePaymentsPerYear(7, utcDate('2100-01-04'), utcDate('2100-12-27'))).toBe(365 / 7);
    const base: OracleCase = { ...caseOf('V-2028').input, start: '2000-02-01', first: '2000-02-15', end: '2000-11-30' };
    expect(on(toInput(base)).calculatedRatePercent).toBe(calculatedRateFor('mortgage', 'fixed', 5, 366 / 14).percent);
    const w: OracleCase = { ...caseOf('V-NOLEAP-ULP').input, start: '2100-01-04', first: '2100-01-11', end: '2100-12-27' };
    expect(on(toInput(w)).calculatedRatePercent).toBe(calculatedRateFor('mortgage', 'fixed', 5, 365 / 7).percent);
    expect(oracleYears('2000-01-01', '2001-01-01')).toBe(1);
    expect(oracleYears('2100-01-01', '2100-12-31')).toBe(364 / 365);
  });
});

// ================================================================================================ T8
describe('B37-T8 INV-OFF: with the switch off the engine replays both pre-B37 goldens byte for byte', () => {
  const PIN = loadFixture<{ v1: { fileSha256: string }; pc: { fileSha256: string } }>('b37_pre_golden_group_hashes.json');
  it('the pin records the committed pre-B37 shas', () => {
    expect(PIN.v1.fileSha256).toBe('922fd69580e420957bfaa928a60b553fdbff07b4e92215de81422e901cc93aee');
    expect(PIN.pc.fileSha256).toBe('5ab1c6a6c086ba737d790bb1e42f2eb36ccd61c3c256e2634a6d5cc312fa7df5');
  });
  it('golden v1: serialise(computeGolden(leap off)) has the pre-B37 sha', () => {
    expect(sha256(preB37GoldenText('v1'))).toBe(PIN.v1.fileSha256);
  }, 120_000);
  it('golden PC: serialise(computeGolden(leap off)) has the pre-B37 sha', () => {
    expect(sha256(preB37GoldenText('pc'))).toBe(PIN.pc.fileSha256);
  }, 120_000);
});

// ================================================================================================ T9
describe('B37-T9 the label\'s engine function paymentsPerYearFor (addendum B37-L1..L3)', () => {
  beforeAll(() => {
    outcomes();
  }, 120_000);

  it('C3 vectors: n for all six frequencies on the brief\'s dates (fixed mortgage, Payment change), Object.is the oracle', () => {
    for (const [id, v] of Object.entries(V.labelN)) {
      const x = asInput({ ...toInput(caseOf('V-CASE1').input), renewalDate: utcDate(v.start), firstPaymentDate: utcDate(v.start), endDate: utcDate(v.end) });
      for (const f of SIX) expect(Object.is(paymentsPerYearFor(x, f), v.n[f]), `${id} ${f}`).toBe(true);
    }
    expect(V.labelN['V-CASE1']!.n.biweekly).toBe(26.095568783068778);
    expect(V.labelN['REF-01']!.n.weekly).toBe(52.1904761904762);
    expect(V.labelN['V-EX2']!.n.biweekly).toBe(26.087423312883434);
    expect(V.labelN['RENEWAL']!.n.biweekly).toBe(26.09280051287531);
    expect(V.labelN['V-2028']!.n.weekly).toBe(52.285714285714285);
    expect(V.labelN['V-NOLEAP']!.n.biweekly).toBe(26.071428571428573);
  });

  it('it reads the flow\'s START date, not the first payment date (V-CASE1 as entered: Date of change 2026-10-08, first payment 2026-10-21)', () => {
    const x = toInput(caseOf('V-CASE1').input);
    expect(paymentsPerYearFor(x, 'biweekly')).toBe(26.095568783068778);
    expect(paymentsPerYearFor(x, 'weekly')).toBe(52.191137566137556);
    const n = toInput(caseOf('V-REF01').input); // newMortgageOrLoan: the Disbursal date
    expect(paymentsPerYearFor(n, 'weekly')).toBe(52.1904761904762);
  });

  it('INV-LABEL-N: for every successful sweep case, paymentsPerYearFor(x, its frequency) Object.is QA\'s n, and equation 1 at it is the shipped Calculated rate', () => {
    const res = outcomes();
    const bad: string[] = [];
    SWEEP.forEach((c, i) => {
      const o = res[i]!;
      if (!o.ok) return;
      const n = paymentsPerYearFor(c.x, c.f);
      if (!Object.is(n, oracleN(c.pt, c.rt, c.f, c.start, c.end, true))) bad.push(`${i} n ${n}`);
      if (!Object.is(calculatedRateFor(c.pt, c.rt, c.x.contractRatePercent, n).percent, calculateCobCanada(c.x).calculatedRatePercent)) bad.push(`${i} rate`);
    });
    expect(bad.slice(0, 5), `${bad.length} failures`).toEqual([]);
  });

  it('INV-LABEL-SHARED: paymentsPerYearFor(x, f) Object.is conversionPaymentsPerYear(p, r, f, start, end, LEAP_AWARE_PAYMENTS_PER_YEAR) and the oracle, every sweep case x every frequency; off: the base n', () => {
    const bad: string[] = [];
    const sw = leapSwitch() as boolean;
    SWEEP.forEach((c, i) => {
      const start = utcDate(c.start);
      const end = c.x.endDate;
      for (const f of SIX) {
        const a = paymentsPerYearFor(c.x, f);
        if (!Object.is(a, conversionPaymentsPerYear(c.pt, c.rt, f, start, end, sw))) bad.push(`${i} ${f} shared`);
        if (!Object.is(a, oracleN(c.pt, c.rt, f, c.start, c.end, true))) bad.push(`${i} ${f} oracle`);
        if (conversionPaymentsPerYear(c.pt, c.rt, f, start, end, false) !== PAYMENTS_PER_YEAR[f]) bad.push(`${i} ${f} off`);
      }
    });
    expect(bad.slice(0, 5), `${bad.length} failures`).toEqual([]);
  });

  it('INV-LABEL-SHARED source guard: cobCanada.ts calls conversionPaymentsPerYear( exactly twice, never leapAwarePaymentsPerYear( or paymentPeriodDays(, and paymentsPerYearFor passes the switch constant', () => {
    const code = stripComments(read(join(SRC_CA, 'cobCanada.ts')));
    expect(code.match(/\bconversionPaymentsPerYear\(/g)?.length ?? 0).toBe(2);
    expect(code).not.toMatch(/\bleapAwarePaymentsPerYear\(/);
    expect(code).not.toMatch(/\bpaymentPeriodDays\(/);
    const start = code.indexOf('export function paymentsPerYearFor(');
    expect(start).toBeGreaterThan(-1);
    const body = code.slice(start, code.indexOf('\n}', start));
    expect(body).toMatch(/conversionPaymentsPerYear\([\s\S]*LEAP_AWARE_PAYMENTS_PER_YEAR,?\s*\)/);
    expect(body).not.toMatch(/\btrue\b/);
    const eq = stripComments(read(join(SRC_CA, 'equations.ts')));
    expect(eq).toMatch(/export function conversionPaymentsPerYear\(/);
    expect(eq).not.toMatch(/policies/);
  });

  it('INV-LABEL-TOTAL: the fallbacks return the base n and never throw', () => {
    const x = toInput(caseOf('V-CASE1').input);
    const rec = (o: object) => asInput({ ...x, ...o });
    const base = (input: CobCanadaInput) => SIX.map((f) => paymentsPerYearFor(input, f));
    const BASE = SIX.map((f) => PAYMENTS_PER_YEAR[f]);
    const fallbacks: [string, CobCanadaInput][] = [
      ['VRPC (variable)', rec({ flow: 'variableRatePaymentChange', rateType: 'variable' })],
      ['variable mortgage', rec({ rateType: 'variable' })],
      ['personal loan, fixed', rec({ productType: 'personalLoan' })],
      ['End date NaN', rec({ endDate: new Date(NaN) })],
      ['End date missing', rec({ endDate: undefined })],
      ['start missing', rec({ renewalDate: undefined })],
      ['start NaN', rec({ renewalDate: new Date(NaN) })],
      ['start === End date', rec({ renewalDate: utcDate('2029-09-23') })],
      ['start after End date', rec({ renewalDate: utcDate('2029-09-24') })],
      ['unknown flow', rec({ flow: 'bogus' })],
      ['newMortgageOrLoan carrying only renewalDate', rec({ flow: 'newMortgageOrLoan' })],
      ['start as a string', rec({ renewalDate: '2026-10-08' })],
      ['blank rate and NaN payment do not matter: still leap-aware', rec({ contractRatePercent: undefined, paymentAmount: NaN })],
    ];
    for (const [name, input] of fallbacks.slice(0, -1)) {
      let got: number[] = [];
      expect(() => (got = base(input)), name).not.toThrow();
      expect(got, name).toEqual(BASE);
    }
    expect(base(fallbacks.at(-1)![1])).toEqual([52.191137566137556, 52.191137566137556, 26.095568783068778, 26.095568783068778, 24, 12]);
  });

  it('INV-LABEL-TOTAL: RangeError only for a frequency outside PaymentFrequency (daily, toString)', () => {
    const x = toInput(caseOf('V-CASE1').input);
    const msg = (got: string) =>
      new RegExp(`^paymentFrequency must be one of monthly/semiMonthly/biweekly/weekly/acceleratedBiweekly/acceleratedWeekly, got ${got}$`);
    expectRangeErrorMatching(() => paymentsPerYearFor(x, 'daily'), msg('daily'));
    expectRangeErrorMatching(() => paymentsPerYearFor(x, 'toString'), msg('toString'));
    expectRangeErrorMatching(() => conversionPaymentsPerYear('mortgage', 'fixed', 'daily' as PaymentFrequency, undefined, undefined, true), msg('daily'));
    expectRangeErrorMatching(() => conversionPaymentsPerYear('mortgage', 'fixed', 'daily' as PaymentFrequency, undefined, undefined, false), msg('daily'));
  });

  it('conversionPaymentsPerYear never throws for date arguments: undefined, NaN, start === end, start after end -> base', () => {
    const s = utcDate('2026-10-08');
    const e = utcDate('2029-09-23');
    for (const f of SIX) {
      expect(conversionPaymentsPerYear('mortgage', 'fixed', f, undefined, e, true)).toBe(PAYMENTS_PER_YEAR[f]);
      expect(conversionPaymentsPerYear('mortgage', 'fixed', f, s, undefined, true)).toBe(PAYMENTS_PER_YEAR[f]);
      expect(conversionPaymentsPerYear('mortgage', 'fixed', f, new Date(NaN), e, true)).toBe(PAYMENTS_PER_YEAR[f]);
      expect(conversionPaymentsPerYear('mortgage', 'fixed', f, s, s, true)).toBe(PAYMENTS_PER_YEAR[f]);
      expect(conversionPaymentsPerYear('mortgage', 'fixed', f, e, s, true)).toBe(PAYMENTS_PER_YEAR[f]);
      expect(conversionPaymentsPerYear('mortgage', 'fixed', f, s, e, true)).toBe(oracleN('mortgage', 'fixed', f, '2026-10-08', '2029-09-23', true));
      expect(ORACLE_BASE_N[f]).toBe(PAYMENTS_PER_YEAR[f]);
    }
  });

  it('none of the four new names is on either barrel except paymentsPerYearFor (ADR-13(j))', () => {
    for (const n of ['conversionPaymentsPerYear', 'leapAwarePaymentsPerYear', 'paymentPeriodDays', 'LEAP_AWARE_PAYMENTS_PER_YEAR']) {
      expect(Object.keys(ca)).not.toContain(n);
    }
    expect(typeof (ca as Record<string, unknown>).paymentsPerYearFor).toBe('function');
  });
});
