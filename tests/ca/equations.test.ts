import { describe, expect, it } from 'vitest';
import {
  applyPaymentWaterfall,
  calculatedRate,
  calculatedRateFor,
  cobAmount,
  cobRatePercent,
  costOfBorrowingRatePercent,
  dayCountFraction,
  daysBetween,
  periodInterest,
  selectCompoundingPeriodsPerYear,
  selectRateBasis,
  triggerRatePercent,
  conversionPaymentsPerYear,
  leapAwarePaymentsPerYear,
  roundToCentHalfAwayFromZero,
  convertsMonthlyRate,
  roundsPeriodInterestToCent,
} from '../../src/ca/equations.js';
import type { PaymentFrequency, ProductType, RateType } from '../../src/ca/index.js';
import { expectRangeErrorMatching } from './support/compare.js';
import { utcDate } from './support/builders.js';
import { oracleMonthlyConvertedDecimal, oracleRoundCent } from './support/leapNOracle.js';

describe('calculatedRate (equation 1)', () => {
  // Hand-computed: (1 + 0.05/2)^(2/12) - 1 = 1.025^(1/6) - 1 = 0.0041239154651442345
  // per period; x12 annualized = 0.04948698558173081 (yorku.ca's "Canadian mortgage
  // constant" conversion, n=12, m=2).
  it('happy path: 5% nominal, m=2 (semi-annual), monthly, hand-computed', () => {
    expect(calculatedRate(5, 2, 12)).toBeCloseTo(0.04948698558173081, 10);
  });

  it('edge case: m=n reduces to the nominal contract rate exactly', () => {
    expect(calculatedRate(5, 52, 52)).toBeCloseTo(0.05, 12);
  });

  it('edge case: m=12, n=12 (equation 1 at m=n, monthly) reduces to contractRate/12 x 12 == contractRate', () => {
    expect(calculatedRate(8, 12, 12)).toBeCloseTo(0.08, 12);
  });

  it('throws RangeError on a negative contract rate', () => {
    expect(() => calculatedRate(-1, 2, 12)).toThrow(RangeError);
  });
});

describe('selectCompoundingPeriodsPerYear (equation 2)', () => {
  it('fixed-rate mortgage -> m=2 (semi-annual)', () => {
    expect(selectCompoundingPeriodsPerYear('mortgage', 'fixed', 52)).toBe(2);
  });

  it('variable-rate mortgage -> m=n (no conversion)', () => {
    expect(selectCompoundingPeriodsPerYear('mortgage', 'variable', 52)).toBe(52);
    expect(selectCompoundingPeriodsPerYear('mortgage', 'variable', 12)).toBe(12);
  });

  // OQ-C 2026-09-27: MONTHLY rate type = contract rate unconverted
  it('personal loan (either rate type) -> m=n (no conversion, was m=12)', () => {
    expect(selectCompoundingPeriodsPerYear('personalLoan', 'fixed', 26)).toBe(26);
    expect(selectCompoundingPeriodsPerYear('personalLoan', 'variable', 26)).toBe(26);
  });
});

// OQ-C 2026-09-27: MONTHLY rate type = contract rate unconverted
describe('invariant #5: only the semi-annual (fixed mortgage) rate is converted; MONTHLY rate types use the contract rate', () => {
  it('fixed mortgage differs from the contract rate; variable mortgage and personal loan equal it exactly at a non-monthly frequency', () => {
    const n = 26; // biweekly -- not 2, not 12
    const fixedMortgage = calculatedRateFor('mortgage', 'fixed', 6, n);
    const variableMortgage = calculatedRateFor('mortgage', 'variable', 6, n);
    const personalLoanFixed = calculatedRateFor('personalLoan', 'fixed', 6, n);
    const personalLoanVariable = calculatedRateFor('personalLoan', 'variable', 6, n);

    expect(variableMortgage).toEqual({ percent: 6, decimal: 0.06 });
    expect(personalLoanFixed).toEqual({ percent: 6, decimal: 0.06 });
    expect(personalLoanVariable).toEqual({ percent: 6, decimal: 0.06 });
    expect(fixedMortgage.decimal).toBe(calculatedRate(6, 2, n));
    expect(fixedMortgage.decimal).not.toBeCloseTo(0.06, 6);
    // Semi-annual compounding converted to n = 26 lands below the nominal rate.
    expect(fixedMortgage.decimal).toBeLessThan(0.06);
  });
});

describe('selectRateBasis / calculatedRateFor (OQ-C, workbook D10)', () => {
  it('fixed mortgage -> SEMI-ANNUAL; everything else -> MONTHLY', () => {
    expect(selectRateBasis('mortgage', 'fixed')).toBe('SEMI-ANNUAL');
    expect(selectRateBasis('mortgage', 'variable')).toBe('MONTHLY');
    expect(selectRateBasis('personalLoan', 'fixed')).toBe('MONTHLY');
    expect(selectRateBasis('personalLoan', 'variable')).toBe('MONTHLY');
  });

  it('edge case: a 0% contract rate is 0 on both bases', () => {
    expect(calculatedRateFor('personalLoan', 'fixed', 0, 52)).toEqual({ percent: 0, decimal: 0 });
    expect(calculatedRateFor('mortgage', 'fixed', 0, 52).decimal).toBe(0);
  });

  it('throws RangeError on a negative contract rate or a non-positive frequency', () => {
    expect(() => calculatedRateFor('personalLoan', 'variable', -1, 12)).toThrow(RangeError);
    expect(() => calculatedRateFor('mortgage', 'variable', 6, 0)).toThrow(RangeError);
  });
});

describe('daysBetween', () => {
  it('happy path: plain calendar day count', () => {
    expect(daysBetween(new Date('2026-03-17'), new Date('2026-03-23'))).toBe(6);
  });

  it('edge case: same date gives 0', () => {
    expect(daysBetween(new Date('2026-03-17'), new Date('2026-03-17'))).toBe(0);
  });

  it('throws RangeError on an invalid Date', () => {
    expect(() => daysBetween(new Date('not-a-date'), new Date())).toThrow(RangeError);
  });
});

describe('dayCountFraction (equation 3 day-count step)', () => {
  it('happy path: a period entirely within a non-leap year is a plain days/365 fraction', () => {
    expect(dayCountFraction(new Date('2026-03-17'), new Date('2026-03-23'))).toBeCloseTo(6 / 365, 12);
  });

  it('edge case: a period straddling a leap-year boundary splits 365/366', () => {
    // 2028 is a leap year. 2027-12-29 -> 2028-01-05: 3 days in 2027 (/365, Dec 29-31
    // inclusive-start) + 4 days in 2028 (/366, Jan 1-4 inclusive-start) = 7 total.
    const fraction = dayCountFraction(new Date('2027-12-29'), new Date('2028-01-05'));
    expect(fraction).toBeCloseTo(3 / 365 + 4 / 366, 12);
  });

  it('throws RangeError when start is after end', () => {
    expect(() => dayCountFraction(new Date('2026-03-23'), new Date('2026-03-17'))).toThrow(RangeError);
  });
});

describe('periodInterest (equation 3)', () => {
  // Doc 007's worked vector, payment #1: 227829.65 opening balance, 3.706781471105014%
  // calculated_rate (decimal 0.03706781471105014), 6 actual days -> 138.82433838712447.
  it('happy path: reproduces doc 007s worked vector payment #1 exactly', () => {
    const interest = periodInterest(227829.65, 0.03706781471105014, new Date('2026-03-17'), new Date('2026-03-23'));
    expect(interest).toBeCloseTo(138.82433838712447, 6);
  });

  it('edge case: a zero opening balance accrues zero interest', () => {
    expect(periodInterest(0, 0.05, new Date('2026-01-01'), new Date('2026-02-01'))).toBe(0);
  });

  it('throws RangeError on a negative opening balance', () => {
    expect(() => periodInterest(-1, 0.05, new Date('2026-01-01'), new Date('2026-02-01'))).toThrow(RangeError);
  });
});

describe('applyPaymentWaterfall (equation 4)', () => {
  it('happy path: payment comfortably covers interest+fees, remainder reduces principal', () => {
    const result = applyPaymentWaterfall(100, 0, 50, 500, 10000);
    expect(result.interestPaid).toBe(100);
    expect(result.carriedAccruedInterestClosing).toBe(0);
    expect(result.feesPaid).toBe(50);
    expect(result.feesClosing).toBe(0);
    expect(result.principalPortion).toBe(350);
    expect(result.amountPaid).toBe(500);
  });

  it('edge case: payment does not even cover this periods interest + carried accrued interest', () => {
    const result = applyPaymentWaterfall(100, 80, 50, 120, 10000);
    // totalInterestDue = 180, payment only covers 120 of it.
    expect(result.totalInterestDue).toBe(180);
    expect(result.interestPaid).toBe(120);
    expect(result.carriedAccruedInterestClosing).toBe(60);
    expect(result.feesPaid).toBe(0);
    expect(result.feesClosing).toBe(50);
    expect(result.principalPortion).toBe(0);
    expect(result.amountPaid).toBe(120);
  });

  // OQ-K/OQ-T 2026-09-27: workbook rule replaces DQ-28
  it('payoff (OQ-K / OQ-T): principal is capped at principalOutstanding and the row records the principal only', () => {
    const result = applyPaymentWaterfall(10, 0, 50, 1000, 200);
    expect(result.interestPaid).toBe(10);
    expect(result.feesPaid).toBe(50);
    expect(result.principalPortion).toBe(200);
    expect(result.amountPaid).toBe(200);
  });

  it('boundary: principalOutstanding exactly equal to the remainder is not a payoff cap', () => {
    const result = applyPaymentWaterfall(10, 0, 50, 260, 200);
    expect(result.principalPortion).toBe(200);
    expect(result.amountPaid).toBe(260);
  });

  it('negative payment rejected', () => {
    // OQ-Y 2026-09-27: $0 payment allowed; negative still rejected
    expect(() => applyPaymentWaterfall(100, 0, 0, -1, 10000)).toThrow(RangeError);
  });

  it('throws RangeError on a NaN principalOutstanding', () => {
    expect(() => applyPaymentWaterfall(100, 0, 0, 500, Number.NaN)).toThrow(RangeError);
  });
});

describe('triggerRatePercent (equation 6)', () => {
  // WOWA.ca's fully worked example: $500,000 balance, $1,998.59 monthly payment ->
  // 4.80% trigger rate.
  it('happy path: reproduces the WOWA.ca worked example ($500,000 / $1,998.59/mo -> ~4.80%)', () => {
    const trigger = triggerRatePercent(1998.59, 12, 500000);
    expect(trigger).toBeCloseTo(4.796616, 5);
    expect(Math.round(trigger * 100) / 100).toBeCloseTo(4.8, 2);
  });

  // Doc 007's worked vector: 465.46 x 52 / 227829.65 x 100 = 10.623691868025078.
  it('happy path: reproduces doc 007s worked vector exactly', () => {
    expect(triggerRatePercent(465.46, 52, 227829.65)).toBeCloseTo(10.623691868025078, 9);
  });

  it('edge case: a payment that exactly covers interest-only gives the nominal rate back', () => {
    const balance = 100000;
    const nominalRate = 6; // percent
    const interestOnlyPayment = balance * (nominalRate / 100 / 12);
    expect(triggerRatePercent(interestOnlyPayment, 12, balance)).toBeCloseTo(nominalRate, 10);
  });

  it('throws RangeError on non-positive loanAmount', () => {
    expect(() => triggerRatePercent(1998.59, 12, 0)).toThrow(RangeError);
  });
});

describe('invariant #6: trigger rate monotonicity', () => {
  it('increasing loanAmount (payment/paymentsPerYear held fixed) decreases the trigger rate', () => {
    const paymentAmount = 1998.59;
    const paymentsPerYear = 12;
    const smallerBalanceTrigger = triggerRatePercent(paymentAmount, paymentsPerYear, 500000);
    const largerBalanceTrigger = triggerRatePercent(paymentAmount, paymentsPerYear, 600000);
    expect(largerBalanceTrigger).toBeLessThan(smallerBalanceTrigger);
  });
});

describe('cobRatePercent (equation 7)', () => {
  it('happy path: APR = (C / (T x P)) x 100', () => {
    expect(cobRatePercent(10000, 5, 400000)).toBeCloseTo(0.5, 10);
  });

  it('edge case: zero cost of borrowing gives a 0% rate', () => {
    expect(cobRatePercent(0, 5, 400000)).toBe(0);
  });

  it('throws RangeError on non-positive term years', () => {
    expect(() => cobRatePercent(10000, 0, 400000)).toThrow(RangeError);
  });

  it('throws RangeError on non-positive average principal outstanding', () => {
    expect(() => cobRatePercent(10000, 5, 0)).toThrow(RangeError);
  });
});

describe('costOfBorrowingRatePercent (equation 7, FULL -- including the fees===0 short-circuit)', () => {
  // VBA-confirmed (doc 007's "Addendum: VBA macro source review"): `If finFee +
  // nonFinFee = 0 Then COBRate = aRate * 100`. No T/P combination reproduces this as
  // a property of the general C/(T*P) formula -- it is a hard branch.
  it('happy path: fees === 0 short-circuits to calculatedRate x 100, ignoring T/P entirely', () => {
    // Doc 007's worked vector: calculated_rate 0.03706781471105014 (decimal) ->
    // cob_rate_percent 3.706781471105014% when fees are $0, regardless of what T/P
    // are passed (garbage values below to prove they're unused on this path).
    const result = costOfBorrowingRatePercent(0.03706781471105014, 0, 0, 999999, 0.001, 1);
    expect(result).toBe(3.706781471105014);
  });

  it('edge case: fees > 0 delegates to the general C/(T x P) x 100 formula', () => {
    const calculatedRateDecimal = 0.05; // deliberately different from the C/(T*P) result
    const result = costOfBorrowingRatePercent(calculatedRateDecimal, 300, 0, 10000, 5, 400000);
    expect(result).toBeCloseTo(cobRatePercent(10000, 5, 400000), 10);
    expect(result).not.toBeCloseTo(calculatedRateDecimal * 100, 3);
  });

  it('financed-only fees (no cash fees) still take the general branch, not the short-circuit', () => {
    const result = costOfBorrowingRatePercent(0.05, 300, 0, 10000, 5, 400000);
    expect(result).toBeCloseTo(cobRatePercent(10000, 5, 400000), 10);
  });

  it('throws RangeError on a negative calculatedRateDecimal', () => {
    expect(() => costOfBorrowingRatePercent(-0.01, 0, 0, 0, 5, 400000)).toThrow(RangeError);
  });
});

describe('cobAmount (equation 8)', () => {
  it('happy path: cob_amount = total_interest + total_financed_fees + total_cash_fees, unconditionally', () => {
    expect(cobAmount(117019.11, 300, 100)).toBeCloseTo(117419.11, 8);
  });

  it('edge case: no fees leaves cob_amount == total_interest exactly', () => {
    expect(cobAmount(117019.11, 0, 0)).toBe(117019.11);
  });

  it('throws RangeError on negative total_interest', () => {
    expect(() => cobAmount(-1, 0, 0)).toThrow(RangeError);
  });
});

// B38 (spec 013 E-B38-3, DEC-B38-YEARFRAC-ROUND, DEV-B38-ROUND): Excel ROUND(x, 2) on the 15-significant-digit decimal.
describe('B38 INV-B38-ROUND roundToCentHalfAwayFromZero', () => {
  const T: [number, number, string][] = [
    [1.005, 1.01, 'Math.round(x * 100) / 100 gives 1'],
    [-1.005, -1.01, ''],
    [2.675, 2.68, ''],
    [0.005, 0.01, ''],
    [0.0049999999, 0, ''],
    [0.0025, 0, ''],
    [0.0001, 0, ''],
    [1e-9, 0, ''],
    [0.015, 0.02, 'half-even would give 0.02 too; 1.005 kills half-even'],
    [1.115, 1.12, ''],
    [10.235, 10.24, ''],
    [1234.565, 1234.57, ''],
    [1234.5649999999, 1234.56, ''],
    [123456789.125, 123456789.13, ''],
    [758.3018733743622, 758.3, 'V-CASE1 row 1'],
    [0, 0, ''],
  ];
  it.each(T)('%f -> %f %s (and the QA oracle agrees)', (x, want) => {
    expect(Object.is(roundToCentHalfAwayFromZero(x), want)).toBe(true);
    expect(Object.is(oracleRoundCent(x), want)).toBe(true);
  });

  it('INV-B38-ROUND-RANGE: above 1e12 the cent decision is toExponential\'s (pinned): 1e15 / 7 -> 142857142857143', () => {
    expect(roundToCentHalfAwayFromZero(1e15 / 7)).toBe(142857142857143);
    expect(roundToCentHalfAwayFromZero(999999999999.995)).toBe(oracleRoundCent(999999999999.995));
  });

  it('never returns -0: -0, -0.004 and -1e-9 give +0', () => {
    for (const x of [-0, -0.004, -1e-9, -0.0049999]) expect(Object.is(roundToCentHalfAwayFromZero(x), 0), String(x)).toBe(true);
    expect(roundToCentHalfAwayFromZero(-0.005)).toBe(-0.01);
  });

  it('NaN and +-Infinity are RangeErrors', () => {
    for (const x of [NaN, Infinity, -Infinity]) {
      expectRangeErrorMatching(() => roundToCentHalfAwayFromZero(x), /^x must be a finite number, got /);
    }
  });
});

describe('B38 leapAwarePaymentsPerYear / conversionPaymentsPerYear YEARFRAC parameter (defaults false)', () => {
  const s = utcDate('2026-10-08');
  const e = utcDate('2029-09-23');
  it('leapAwarePaymentsPerYear(14, V-CASE1 dates, true) is 1081 / 14 / (1081 / 365.25); without the flag it is the B37 n', () => {
    expect(leapAwarePaymentsPerYear(14, s, e, true)).toBe(26.089285714285715);
    expect(leapAwarePaymentsPerYear(14, s, e, true)).toBe(1081 / 14 / (1081 / 365.25));
    expect(leapAwarePaymentsPerYear(14, s, e)).toBe(26.095568783068778);
    expect(leapAwarePaymentsPerYear(14, s, e, false)).toBe(26.095568783068778);
  });
  it('conversionPaymentsPerYear: the seventh parameter defaults to false; with leapAware false or a monthly frequency it changes nothing', () => {
    expect(conversionPaymentsPerYear('mortgage', 'fixed', 'biweekly', s, e, true)).toBe(conversionPaymentsPerYear('mortgage', 'fixed', 'biweekly', s, e, true, false));
    expect(conversionPaymentsPerYear('mortgage', 'fixed', 'biweekly', s, e, true, true)).toBe(26.089285714285715);
    expect(conversionPaymentsPerYear('mortgage', 'fixed', 'biweekly', s, e, false, true)).toBe(26);
    expect(conversionPaymentsPerYear('mortgage', 'fixed', 'monthly', s, e, true, true)).toBe(12);
    expect(conversionPaymentsPerYear('mortgage', 'variable', 'weekly', s, e, true, true)).toBe(52);
  });
  it('leapAwarePaymentsPerYear(…, true) keeps the guards: start === end is a RangeError', () => {
    expectRangeErrorMatching(() => leapAwarePaymentsPerYear(14, s, s, true), /^start must be before end$/);
  });
});

describe('B39 calculatedRateFor fifth parameter convertMonthly (E-B39-3; spec 014, DEC-B39-VAR-PL-M12)', () => {
  const N_VAR1 = 52.17857142857142;
  const N_VAR2 = 26.083333333333332;
  it('defaults to false: four arguments are byte-identical to convertMonthly false (MONTHLY basis = the contract rate)', () => {
    expect(calculatedRateFor('mortgage', 'variable', 4, N_VAR1)).toEqual({ percent: 4, decimal: 0.04 });
    expect(calculatedRateFor('mortgage', 'variable', 4, N_VAR1, false)).toEqual(calculatedRateFor('mortgage', 'variable', 4, N_VAR1));
    expect(calculatedRateFor('personalLoan', 'fixed', 8, 52.166666666666664)).toEqual({ percent: 8, decimal: 0.08 });
  });
  it('MONTHLY basis, true: equation 1 at m = 12, percent = decimal * 100 (VAR-1 3.994876602469461, VAR-2 3.796756654443251; the oracle)', () => {
    const v1 = calculatedRateFor('mortgage', 'variable', 4, N_VAR1, true);
    expect(v1.decimal).toBe(calculatedRate(4, 12, N_VAR1));
    expect(v1.percent).toBe(v1.decimal * 100);
    expect(v1.percent).toBe(3.994876602469461);
    expect(v1.decimal).toBe(oracleMonthlyConvertedDecimal(4, N_VAR1));
    const v2 = calculatedRateFor('mortgage', 'variable', 3.8, N_VAR2, true);
    expect(v2.percent).toBe(3.796756654443251);
    // E-B39-3: the pin is decimal * 100, not 100 * n * (...), which differs in the last bit.
    expect(100 * N_VAR2 * (Math.pow(1 + 3.8 / 100 / 12, 12 / N_VAR2) - 1)).toBe(3.7967566544432505);
    expect(calculatedRateFor('personalLoan', 'variable', 8, 52.166666666666664, true).percent).toBe(7.979547907300506);
  });
  it('SEMI-ANNUAL basis ignores convertMonthly (m = 2 either way)', () => {
    expect(calculatedRateFor('mortgage', 'fixed', 4.34, 26.089285714285715, true)).toEqual(calculatedRateFor('mortgage', 'fixed', 4.34, 26.089285714285715));
  });
  it('edge: contract rate 0 converts to exactly 0 (INV-B39-ZERO); for n > 12 and i > 0 the result is below the contract rate (INV-B39-BELOW)', () => {
    expect(calculatedRateFor('mortgage', 'variable', 0, N_VAR1, true)).toEqual({ percent: 0, decimal: 0 });
    expect(calculatedRateFor('mortgage', 'variable', 0.01, N_VAR1, true).percent).toBeLessThan(0.01);
    expect(calculatedRateFor('mortgage', 'variable', 0.01, N_VAR1, true).percent).toBeGreaterThan(0);
  });
  it('invalid: a negative contract rate or n <= 0 is still a RangeError with convertMonthly true', () => {
    expectRangeErrorMatching(() => calculatedRateFor('mortgage', 'variable', -1, N_VAR1, true), /^contractRatePercent must be >= 0, got -1$/);
    expectRangeErrorMatching(() => calculatedRateFor('mortgage', 'variable', 4, 0, true), /^paymentsPerYear must be > 0, got 0$/);
  });
});

describe('B39 convertsMonthlyRate (predicate M, E-B39-1) and conversionPaymentsPerYear eighth parameter (E-B39-2)', () => {
  const s = utcDate('2026-10-08');
  const e = utcDate('2029-09-27');
  const SIX: PaymentFrequency[] = ['weekly', 'acceleratedWeekly', 'biweekly', 'acceleratedBiweekly', 'semiMonthly', 'monthly'];
  const BASES: [ProductType, RateType, 'MONTHLY' | 'SEMI-ANNUAL'][] = [
    ['mortgage', 'fixed', 'SEMI-ANNUAL'],
    ['mortgage', 'variable', 'MONTHLY'],
    ['personalLoan', 'fixed', 'MONTHLY'],
  ];
  it('table: 8 switch states x 6 frequencies x 3 bases; M = monthlyConversion && leapAware && MONTHLY basis && P in {7, 14}; S (rounding) is never true for the MONTHLY basis', () => {
    const bad: string[] = [];
    for (const la of [true, false]) for (const yf of [true, false]) for (const mc of [true, false]) {
      for (const f of SIX) for (const [pt, rt, basis] of BASES) {
        const day = f !== 'semiMonthly' && f !== 'monthly';
        const want = mc && la && basis === 'MONTHLY' && day;
        if (convertsMonthlyRate(pt, rt, f, s, e, la, mc) !== want) bad.push(`M ${la} ${yf} ${mc} ${f} ${pt}/${rt}`);
        if (basis === 'MONTHLY' && roundsPeriodInterestToCent(pt, rt, f, s, e, la, yf)) bad.push(`S ${la} ${yf} ${f} ${pt}/${rt}`);
      }
    }
    expect(bad).toEqual([]);
  });
  it('edge: invalid or empty spans give false, never a throw (start missing, NaN, start === end, start after end, unknown frequency)', () => {
    expect(convertsMonthlyRate('mortgage', 'variable', 'weekly', undefined, e, true, true)).toBe(false);
    expect(convertsMonthlyRate('mortgage', 'variable', 'weekly', s, new Date(NaN), true, true)).toBe(false);
    expect(convertsMonthlyRate('mortgage', 'variable', 'weekly', s, s, true, true)).toBe(false);
    expect(convertsMonthlyRate('mortgage', 'variable', 'weekly', e, s, true, true)).toBe(false);
    expect(convertsMonthlyRate('mortgage', 'variable', 'daily' as PaymentFrequency, s, e, true, true)).toBe(false);
  });
  it('conversionPaymentsPerYear: the eighth parameter defaults to false (seven arguments = 52 / 26 for the MONTHLY basis); true gives D / P / YEARFRAC (VAR-1 52.17857142857142)', () => {
    for (const [pt, rt] of [['mortgage', 'variable'], ['personalLoan', 'fixed'], ['personalLoan', 'variable']] as [ProductType, RateType][]) {
      expect(conversionPaymentsPerYear(pt, rt, 'weekly', s, e, true, true)).toBe(52);
      expect(conversionPaymentsPerYear(pt, rt, 'weekly', s, e, true, true, false)).toBe(52);
      expect(conversionPaymentsPerYear(pt, rt, 'biweekly', s, e, true, true, false)).toBe(26);
      expect(conversionPaymentsPerYear(pt, rt, 'weekly', s, e, true, true, true)).toBe(52.17857142857142);
      expect(conversionPaymentsPerYear(pt, rt, 'weekly', s, e, false, true, true)).toBe(52);
      expect(conversionPaymentsPerYear(pt, rt, 'monthly', s, e, true, true, true)).toBe(12);
      expect(conversionPaymentsPerYear(pt, rt, 'semiMonthly', s, e, true, true, true)).toBe(24);
    }
    expect(conversionPaymentsPerYear('mortgage', 'fixed', 'weekly', s, e, true, true, true)).toBe(conversionPaymentsPerYear('mortgage', 'fixed', 'weekly', s, e, true, true));
    expectRangeErrorMatching(() => conversionPaymentsPerYear('mortgage', 'variable', 'daily' as PaymentFrequency, s, e, true, true, true), /^paymentFrequency must be one of /);
  });
});
