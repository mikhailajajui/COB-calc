import { describe, expect, it } from 'vitest';
import { calculateCobCanada } from '../../src/ca/index.js';
import type { CobCanadaInput, CobScheduleRow } from '../../src/ca/index.js';
import { asInput, isoDay, utcDate } from './support/builders.js';
import { withinRel as withinRelTol } from './support/compare.js';
import { loadFixture } from './support/fixtures.js';

/**
 * REF-01 (T5, QA 2026-09-27): parity with REAL Excel output -- the calculation saved in
 * 'Cost of Borrowing Rate Calc_Current.xlsm', Calculator sheet, cached values extracted
 * by fixtures/extract_ref01.py into fixtures/ca_ref01_workbook_saved.json (provenance,
 * sha256 and cell addresses are in the fixture). Every stored row cell (B37:O192) and
 * every summary cell is compared at 1e-9 relative.
 *
 * Inputs: loan 227829.65, no fees, G10 = SEMI-ANNUAL so the rate is the converter's
 * 3.74% (fixed mortgage), Accelerated Weekly (= weekly, BR-09), disbursal 2026-03-17,
 * first payment 2026-03-23, end 2029-03-17, payment 465.46. The loan does not pay off
 * before the End Date, so the OQ-K/T last-payment rule does not apply.
 *
 * Columns E (opening principal), H (cumulative interest accrued) and N (closing
 * principal) have no engine field; they are derived: E = openingBalance - feesOpening,
 * H = running sum of periodInterest, N = closingBalance - feesClosing.
 */
const ref = loadFixture('ca_ref01_workbook_saved.json') as {
  provenance: Record<string, unknown>;
  inputs: Record<string, number | string>;
  converter: { mortgage_rate_pct: number; compounding_per_year: number };
  summary: Record<string, number>;
  rows: Record<string, number | string>[];
};

const TOL = 1e-9;
const d = utcDate;
const iso = isoDay;

const withinRel = (actual: number, expected: number): boolean => withinRelTol(actual, expected, TOL);

const input: CobCanadaInput = asInput({
  flow: 'newMortgageOrLoan',
  productType: 'mortgage',
  rateType: 'fixed',
  loanAmount: ref.inputs.loan_amount as number,
  contractRatePercent: ref.converter.mortgage_rate_pct,
  paymentAmount: ref.inputs.payment_amount as number,
  paymentFrequency: 'weekly',
  disbursalDate: d(ref.inputs.disbursal_date as string),
  firstPaymentDate: d(ref.inputs.first_payment_date as string),
  endDate: d(ref.inputs.end_date as string),
  termYears: ref.inputs.term_years as number,
  termMonths: 0,
  fees: { fees: [] },
  semiAnnualCompoundingDate: d(ref.inputs.disbursal_date as string),
});

const result = calculateCobCanada(input);
const rows = result.amortizationSchedule;
const cumInt: number[] = [];
rows.reduce((s, r, i) => (cumInt[i] = s + r.periodInterest), 0);

type Getter = (r: CobScheduleRow, i: number) => number;
const ROW_FIELDS: [string, string, Getter][] = [
  ['B Pymt#', 'n', (r) => r.period],
  ['D Loan (open)', 'open_loan', (r) => r.openingBalance],
  ['E Principle (open)', 'open_principal', (r) => r.openingBalance - r.feesOpening],
  ['F Fees (open)', 'open_fees', (r) => r.feesOpening],
  ['G New Int', 'new_int', (r) => r.periodInterest],
  ['H Total Int', 'total_int', (_r, i) => cumInt[i]!],
  ['I Payment', 'payment', (r) => r.paymentAmount],
  ['J Int Paid', 'interest_paid', (r) => r.interestPaid],
  ['K Fees Paid', 'fees_paid', (r) => r.feesPaid],
  ['L Principle Paid', 'principal_paid', (r) => r.principalPortion],
  ['M Fees (close)', 'close_fees', (r) => r.feesClosing],
  ['N Principle (close)', 'close_principal', (r) => r.closingBalance - r.feesClosing],
  ['O Loan (close)', 'close_loan', (r) => r.closingBalance],
];

describe('REF-01 real Excel output (Calculator sheet, saved calculation)', () => {
  it('fixture is the saved 156-row weekly schedule with the expected inputs', () => {
    expect(ref.rows).toHaveLength(156);
    expect(ref.inputs.rate_type).toBe('SEMI-ANNUAL');
    expect(ref.converter).toMatchObject({ mortgage_rate_pct: 3.74, compounding_per_year: 2 });
    expect(ref.summary.n_payments).toBe(156);
  });

  it('row count = G31 (156) and the last row is dated before the End Date', () => {
    expect(rows).toHaveLength(ref.rows.length);
    expect(iso(rows.at(-1)!.date)).toBe(ref.rows.at(-1)!.date);
  });

  it('C Date: every row date matches', () => {
    const bad = ref.rows.flatMap((fx, i) => (rows[i] && iso(rows[i]!.date) === fx.date ? [] : [`row ${i + 1}: ${rows[i] ? iso(rows[i]!.date) : 'missing'} vs ${String(fx.date)}`]));
    expect(bad).toEqual([]);
  });

  for (const [label, key, get] of ROW_FIELDS) {
    it(`${label}: every row within 1e-9 relative`, () => {
      const bad: string[] = [];
      ref.rows.forEach((fx, i) => {
        const r = rows[i];
        if (!r) return void bad.push(`row ${i + 1} missing`);
        const a = get(r, i);
        if (!withinRel(a, fx[key] as number)) bad.push(`row ${i + 1}: ${a} vs ${String(fx[key])}`);
      });
      expect(bad).toEqual([]);
    });
  }

  const SUMMARY: [string, string, () => number | null][] = [
    ['D10 calculated rate', 'calculated_rate_pct', () => result.calculatedRatePercent],
    ['D29 COB amount', 'cob_amount', () => result.cobAmount],
    ['D31 COB rate', 'cob_rate_pct', () => result.cobRatePercent],
    ['G29 total payments', 'total_payment', () => result.totalPayment],
    ['G31 # payments', 'n_payments', () => result.numberOfPayments],
    ['J29 total interest', 'total_interest', () => result.totalInterest],
    ['J31 principal paid', 'principal_paid', () => result.principalPayment],
    ['D20 term days', 'term_days', () => result.termDays],
    ['I193 payment column sum', 'payment_column_sum', () => rows.reduce((s, r) => s + r.paymentAmount, 0)],
  ];
  for (const [label, key, get] of SUMMARY) {
    it(`${label} within 1e-9 relative`, () => {
      const expected = key === 'calculated_rate_pct' ? (ref.inputs[key] as number) : ref.summary[key]!;
      const a = get();
      expect(a, `${label}: ${String(a)} vs ${expected}`).not.toBeNull();
      expect(withinRel(a as number, expected), `${label}: ${String(a)} vs ${expected}`).toBe(true);
    });
  }

  // M29 Trigger Rate: the workbook shows 10.6237% for this FIXED mortgage; the engine
  // computes a trigger rate only for variable-rate mortgages (null here). Pinned as the
  // engine's current, documented behaviour; the workbook value is kept in the fixture.
  it('M29 trigger rate: workbook shows a value for a fixed mortgage, engine returns null (documented difference)', () => {
    expect(ref.summary.trigger_rate_pct).toBeCloseTo(10.623691868025078, 12);
    expect(result.triggerRatePercent).toBeNull();
  });
});
