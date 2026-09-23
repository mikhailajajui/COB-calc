import { describe, expect, it } from 'vitest';
import {
  applyPaymentWaterfall,
  calculatedRate,
  cobAmount,
  cobRatePercent,
  costOfBorrowingRatePercent,
  dayCountFraction,
  daysBetween,
  periodInterest,
  selectCompoundingPeriodsPerYear,
  triggerRatePercent,
} from '../../src/ca/equations.js';

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

  it('m=12, n=12 (monthly personal loan) reduces to contractRate/12 x 12 == contractRate', () => {
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

  it('personal loan (either rate type) -> m=12', () => {
    expect(selectCompoundingPeriodsPerYear('personalLoan', 'fixed', 26)).toBe(12);
    expect(selectCompoundingPeriodsPerYear('personalLoan', 'variable', 26)).toBe(12);
  });
});

describe('invariant #5: semi-annual, m=n, and m=12 conversions produce different periodic rates', () => {
  it('fixed mortgage, variable mortgage, and personal loan diverge at the same nominal rate + non-monthly frequency', () => {
    const n = 26; // biweekly -- not 2, not 12, so all three branches genuinely differ
    const fixedMortgage = calculatedRate(6, 2, n);
    const variableMortgage = calculatedRate(6, n, n);
    const personalLoan = calculatedRate(6, 12, n);

    expect(variableMortgage).toBeCloseTo(0.06, 12); // m=n degenerates to the nominal rate exactly
    expect(fixedMortgage).not.toBeCloseTo(variableMortgage, 6);
    expect(fixedMortgage).not.toBeCloseTo(personalLoan, 6);
    expect(personalLoan).not.toBeCloseTo(variableMortgage, 6);
    // Semi-annual compounding is cheaper than monthly at the same nominal rate --
    // (1+r/2)^2 < (1+r/12)^12 for r>0 -- so the fixed-mortgage conversion must land
    // below the personal-loan (m=12) conversion.
    expect(fixedMortgage).toBeLessThan(personalLoan);
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
    const result = applyPaymentWaterfall(100, 0, 50, 500);
    expect(result.interestPaid).toBe(100);
    expect(result.carriedAccruedInterestClosing).toBe(0);
    expect(result.feesPaid).toBe(50);
    expect(result.feesClosing).toBe(0);
    expect(result.principalPortion).toBe(350);
  });

  it('edge case: payment does not even cover this periods interest + carried accrued interest', () => {
    const result = applyPaymentWaterfall(100, 80, 50, 120);
    // totalInterestDue = 180, payment only covers 120 of it.
    expect(result.totalInterestDue).toBe(180);
    expect(result.interestPaid).toBe(120);
    expect(result.carriedAccruedInterestClosing).toBe(60);
    expect(result.feesPaid).toBe(0);
    expect(result.feesClosing).toBe(50);
    expect(result.principalPortion).toBe(0);
  });

  it('throws RangeError on a non-positive paymentAmount', () => {
    expect(() => applyPaymentWaterfall(100, 0, 0, 0)).toThrow(RangeError);
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
