import { describe, expect, it } from 'vitest';
import { calculateCobCanada } from '../../src/ca/index.js';
import type { CobCanadaInput } from '../../src/ca/index.js';
import { expectRelFloor1 } from './support/compare.js';
import { LEAP_OFF, SHIPPED, calculateWith } from './support/switches.js';

/**
 * T2 / OQ-C (resolved 2026-09-27 from the workbook): which annual rate feeds the
 * daily-interest calculation (macro getRate: aRate x days / daysInYear).
 *
 * Workbook Calculator!D10 ("Calculated Rate (%)", app OUT-01 = calculatedRatePercent):
 *   =IF(RateType="MONTHLY", MonthlyRate, XLOOKUP(Freq, r_Freq, r_EquivalentRate))
 * and the macro reads `aRate = Range("D10") / 100`.
 *   - Fixed mortgage      -> SEMI-ANNUAL -> n x ((1 + i/2)^(2/n) - 1)   (converted)
 *   - Variable mortgage   -> MONTHLY     -> the contract rate, unconverted, every n
 *   - Personal loan (F/V) -> MONTHLY     -> the contract rate, unconverted, every n
 *
 * "Unconverted" = the rate is the entered cell, not the output of any conversion
 * formula, so OUT-01 must equal the contract rate EXACTLY (toBe, no tolerance). The
 * contract rates used here (8, 6) round-trip exactly through /100 and x100 in IEEE
 * doubles (8/100*100 === 8, 6/100*100 === 6).
 *
 * Row-1 interest is hand-computed (all dates in 2026, no leap-year crossing, so the
 * day-count fraction is days / 365): loan x contract/100 x days/365, 1e-12 relative.
 * The old m = 12 conversion moves the weekly/bi-weekly/semi-monthly rate by ~1e-3
 * relative, so that tolerance discriminates.
 */

const INTEREST_REL_TOL = 1e-12;
const APPENDIX_A_ABS_TOL = 1e-12;

const expectRel = (actual: number, expected: number, tol: number): void => expectRelFloor1(actual, expected, tol);

type Freq = Exclude<CobCanadaInput['paymentFrequency'], 'acceleratedWeekly' | 'acceleratedBiweekly'>;

/** Disbursal 2026-01-05; first payment chosen per frequency (days in row 1). */
const FIRST_PAYMENT: Record<Freq, { date: string; days: number }> = {
  weekly: { date: '2026-01-12', days: 7 },
  biweekly: { date: '2026-01-19', days: 14 },
  semiMonthly: { date: '2026-01-15', days: 10 },
  monthly: { date: '2026-02-05', days: 31 },
};
const FREQS: Freq[] = ['weekly', 'biweekly', 'semiMonthly', 'monthly'];

function input(
  productType: CobCanadaInput['productType'],
  rateType: CobCanadaInput['rateType'],
  paymentFrequency: Freq,
  contractRatePercent: number,
): CobCanadaInput {
  return {
    flow: 'newMortgageOrLoan',
    productType,
    rateType,
    loanAmount: 10000,
    contractRatePercent,
    paymentAmount: 500,
    paymentFrequency,
    disbursalDate: new Date('2026-01-05'),
    firstPaymentDate: new Date(FIRST_PAYMENT[paymentFrequency].date),
    endDate: new Date('2026-12-31'),
    termYears: 1,
    termMonths: 0,
    fees: { fees: [] },
    ...(productType === 'mortgage' && rateType === 'fixed'
      ? { semiAnnualCompoundingDate: new Date('2026-01-05') }
      : {}),
  };
}

// Hand-computed row-1 interest = 10000 x rate x days/365:
//   8%: weekly    10000 x 0.08 x  7/365 = 15.342465753424657
//       biweekly  10000 x 0.08 x 14/365 = 30.684931506849313
//       semiMon.  10000 x 0.08 x 10/365 = 21.91780821917808
//       monthly   10000 x 0.08 x 31/365 = 67.94520547945206
//   6%: weekly    10000 x 0.06 x  7/365 = 11.506849315068493
//       biweekly  10000 x 0.06 x 14/365 = 23.013698630136986
//       semiMon.  10000 x 0.06 x 10/365 = 16.438356164383563
//       monthly   10000 x 0.06 x 31/365 = 50.95890410958904
const ROW1_INTEREST: Record<number, Record<Freq, number>> = {
  8: { weekly: 15.342465753424657, biweekly: 30.684931506849313, semiMonthly: 21.91780821917808, monthly: 67.94520547945206 },
  6: { weekly: 11.506849315068493, biweekly: 23.013698630136986, semiMonthly: 16.438356164383563, monthly: 50.95890410958904 },
};

// B27: DEV-FB24 class C -- a personal loan may only pay Monthly, so its cases are restricted to ['monthly']
// (the 12 weekly / biweekly / semi-monthly personal-loan tests are retired: 2 products x 3 frequencies x 2 claims).
// The same claims stay covered by the variable-mortgage block below at the same frequencies (same MONTHLY
// rate basis), by the Monthly personal loan, and by the all-frequency equation test B27-T14.
const UNCONVERTED_CASES: [string, CobCanadaInput['productType'], CobCanadaInput['rateType'], number, readonly Freq[]][] = [
  ['personal loan, fixed', 'personalLoan', 'fixed', 8, ['monthly']],
  ['personal loan, variable', 'personalLoan', 'variable', 6, ['monthly']],
  ['variable mortgage', 'mortgage', 'variable', 6, FREQS],
];

for (const [label, productType, rateType, contract, freqs] of UNCONVERTED_CASES) {
  describe(`OQ-C ${label}: contract rate ${contract}% used unconverted at every frequency (workbook MONTHLY)`, () => {
    it.each(freqs)('%s: calculatedRatePercent (OUT-01) === contract rate exactly', (freq) => {
      const res = calculateCobCanada(input(productType, rateType, freq, contract));
      expect(res.calculatedRatePercent).toBe(contract);
    });

    it.each(freqs)('%s: row-1 interest == loan x contract/100 x days/365', (freq) => {
      const res = calculateCobCanada(input(productType, rateType, freq, contract));
      const row1 = res.amortizationSchedule[0]!;
      expect(row1.daysInPeriod).toBe(FIRST_PAYMENT[freq].days);
      expect(row1.openingBalance).toBe(10000);
      expectRel(row1.periodInterest, ROW1_INTEREST[contract]![freq], INTEREST_REL_TOL);
    });
  });
}

describe('OQ-C fixed mortgage 3.74%: semi-annual conversion, BRD Appendix A (workbook SEMI-ANNUAL)', () => {
  // Appendix A (fixtures/ca_appendix_a.json): 3.74% at m = 2 converted to n.
  const APPENDIX_A: Record<Freq, number> = {
    weekly: 3.706781471105014, // n = 52
    biweekly: 3.7081026469586664, // n = 26
    semiMonthly: 3.7083229039668097, // n = 24
    monthly: 3.7111878328753178, // n = 12
  };

  it.each(FREQS)('%s: calculatedRatePercent matches Appendix A to 1e-12', (freq) => {
    // B37 (DEC-B37-LEAP-N): workbook converter (n = 52/26), switch off (Q-B37-APPA: Appendix A at the stated n; Monthly and
    // Semi-monthly are the same in both states, the weekly / bi-weekly rows are the workbook's).
    const res = calculateWith(input('mortgage', 'fixed', freq, 3.74), SHIPPED, LEAP_OFF);
    expect(Math.abs(res.calculatedRatePercent - APPENDIX_A[freq])).toBeLessThanOrEqual(APPENDIX_A_ABS_TOL);
  });

  it.each(FREQS)('%s: row-1 interest uses the converted rate, not the contract rate', (freq) => {
    // B37 (DEC-B37-LEAP-N): workbook converter (n = 52/26), switch off (Q-B37-APPA: Appendix A at the stated n; Monthly and
    // Semi-monthly are the same in both states, the weekly / bi-weekly rows are the workbook's).
    const res = calculateWith(input('mortgage', 'fixed', freq, 3.74), SHIPPED, LEAP_OFF);
    const expected = 10000 * (APPENDIX_A[freq] / 100) * (FIRST_PAYMENT[freq].days / 365);
    expectRel(res.amortizationSchedule[0]!.periodInterest, expected, 1e-11);
    expect(res.calculatedRatePercent).not.toBe(3.74);
  });
});

describe('OQ-C invalid input still rejected', () => {
  it('a negative contract rate on a personal loan throws RangeError', () => {
    expect(() => calculateCobCanada(input('personalLoan', 'fixed', 'weekly', -1))).toThrow(RangeError);
  });
});
