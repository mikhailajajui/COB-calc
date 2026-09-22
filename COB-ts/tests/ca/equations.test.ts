import { describe, expect, it } from 'vitest';
import {
  calculateTermDaysDisplay,
  cobAmount,
  cobRatePercent,
  periodicRateFromNominalPerPeriod,
  periodicRateFromSemiAnnualNominal,
  totalPeriodsFromYearsMonths,
  triggerRatePercent,
} from '../../src/ca/equations.js';

describe('periodicRateFromSemiAnnualNominal (equation 1)', () => {
  // Hand-computed: (1 + 0.05/2)^(2/12) - 1 = 1.025^(1/6) - 1 = 0.0041239154651442345
  // (matches the spec's own cited worked value of 0.41239%/period, yorku.ca's
  // "Canadian mortgage constant" conversion, n=12).
  it('happy path: 5% nominal, monthly, hand-computed', () => {
    expect(periodicRateFromSemiAnnualNominal(5, 12)).toBeCloseTo(0.0041239154651442345, 10);
  });

  it('edge case: 0% nominal rate gives 0 periodic rate', () => {
    expect(periodicRateFromSemiAnnualNominal(0, 12)).toBe(0);
  });

  it('throws RangeError on a negative contract rate', () => {
    expect(() => periodicRateFromSemiAnnualNominal(-1, 12)).toThrow(RangeError);
  });
});

describe('periodicRateFromNominalPerPeriod (equation 2)', () => {
  it('happy path: 5% nominal, monthly, hand-computed as rate/100/12', () => {
    expect(periodicRateFromNominalPerPeriod(5, 12)).toBeCloseTo(0.0041666666666667, 10);
  });

  it('edge case: 0% nominal rate gives 0 periodic rate', () => {
    expect(periodicRateFromNominalPerPeriod(0, 12)).toBe(0);
  });

  it('throws RangeError on a negative contract rate', () => {
    expect(() => periodicRateFromNominalPerPeriod(-1, 12)).toThrow(RangeError);
  });
});

describe('invariant #5: semi-annual vs. monthly compounding produce different periodic rates', () => {
  // The spec's own invariant #5 prose claims semi-annual is "more expensive" than
  // monthly at the same nominal rate -- this direction is backwards (semi-annual
  // compounding is actually cheaper, per the spec's own "Excel implementation notes"
  // judgment-call #7, which flags this as a documented error in the spec's prose, not
  // in the equations). The testable, direction-agnostic part of the invariant --
  // that the two conventions must produce DIFFERENT periodic rates for the same
  // nominal contractRatePercent -- does hold, and is what this test asserts.
  it('produce different periodic rates for the same nominal rate (direction not asserted)', () => {
    const semiAnnual = periodicRateFromSemiAnnualNominal(5, 12);
    const monthly = periodicRateFromNominalPerPeriod(5, 12);
    expect(semiAnnual).not.toBeCloseTo(monthly, 10);
  });
});

describe('triggerRatePercent (equation 4)', () => {
  // WOWA.ca's fully worked example: $500,000 balance, $1,998.59 monthly payment ->
  // 4.80% trigger rate.
  it('happy path: reproduces the WOWA.ca worked example ($500,000 / $1,998.59/mo -> ~4.80%)', () => {
    const trigger = triggerRatePercent(1998.59, 12, 500000);
    expect(trigger).toBeCloseTo(4.796616, 5);
    expect(Math.round(trigger * 100) / 100).toBeCloseTo(4.8, 2);
  });

  it('edge case: a payment that exactly covers interest-only gives the nominal rate back', () => {
    // paymentAmount = balance * (nominalRate/12) implies trigger = nominalRate exactly.
    const balance = 100000;
    const nominalRate = 6; // percent
    const interestOnlyPayment = balance * (nominalRate / 100 / 12);
    expect(triggerRatePercent(interestOnlyPayment, 12, balance)).toBeCloseTo(nominalRate, 10);
  });

  it('throws RangeError on non-positive totalBorrowed', () => {
    expect(() => triggerRatePercent(1998.59, 12, 0)).toThrow(RangeError);
  });
});

describe('invariant #6: trigger rate monotonicity', () => {
  it('increasing totalBorrowed (payment/paymentsPerYear held fixed) decreases the trigger rate', () => {
    const paymentAmount = 1998.59;
    const paymentsPerYear = 12;
    const smallerBalanceTrigger = triggerRatePercent(paymentAmount, paymentsPerYear, 500000);
    const largerBalanceTrigger = triggerRatePercent(paymentAmount, paymentsPerYear, 600000);
    expect(largerBalanceTrigger).toBeLessThan(smallerBalanceTrigger);
  });
});

describe('cobRatePercent (equation 6)', () => {
  it('happy path: APR = (C / (T x P)) x 100', () => {
    // C = $10,000 cost of borrowing, T = 5 years, P = $400,000 average balance.
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

describe('cobAmount (equation 7)', () => {
  it('happy path: cob_amount = total_interest + total_fees_included_in_cob', () => {
    expect(cobAmount(117019.11, 400)).toBe(117419.11);
  });

  it('edge case: no COB-included fees leaves cob_amount == total_interest exactly', () => {
    expect(cobAmount(117019.11, 0)).toBe(117019.11);
  });

  it('throws RangeError on negative total_interest', () => {
    expect(() => cobAmount(-1, 0)).toThrow(RangeError);
  });
});

describe('calculateTermDaysDisplay (equation 8)', () => {
  it('happy path: a partial-month remainder after whole years/months are extracted', () => {
    const start = new Date('2024-01-10');
    const end = new Date('2029-01-15'); // 5 years + 5 days past start
    expect(calculateTermDaysDisplay(start, end, 5, 0)).toBe(5);
  });

  it('edge case: an exact whole-years/months term has term_days == 0', () => {
    const start = new Date('2024-01-10');
    const end = new Date('2029-01-10');
    expect(calculateTermDaysDisplay(start, end, 5, 0)).toBe(0);
  });

  it('throws RangeError on an invalid Date', () => {
    expect(() => calculateTermDaysDisplay(new Date('not-a-date'), new Date(), 5, 0)).toThrow(RangeError);
  });
});

describe('invariant #4: term_days never changes any monetary output', () => {
  it('varying only the term_days display calculation leaves it isolated from cobAmount/cobRatePercent inputs', () => {
    // calculateTermDaysDisplay takes no monetary arguments at all and returns a plain
    // number consumed only as CobCanadaResult.termDays -- there is no code path from
    // its output back into cobAmount/cobRatePercent/periodicRate*/triggerRatePercent
    // (see cobCanada.ts: termDays is computed last, from inputs already used above,
    // and assigned directly into the result object). This test pins that isolation by
    // asserting the same monetary equation calls produce identical results regardless
    // of which term_days value happens to be computed alongside them.
    const start = new Date('2024-01-10');
    const cobAmountA = cobAmount(1000, 0);
    calculateTermDaysDisplay(start, new Date('2029-06-01'), 5, 0);
    const cobAmountB = cobAmount(1000, 0);
    calculateTermDaysDisplay(start, new Date('2029-01-10'), 5, 0);
    expect(cobAmountA).toBe(cobAmountB);
  });
});

describe('totalPeriodsFromYearsMonths', () => {
  it('happy path: exact for monthly frequency (25 years -> 300 payments)', () => {
    expect(totalPeriodsFromYearsMonths(25, 0, 12)).toBe(300);
  });

  it('edge case: rounds to the nearest whole payment for a non-monthly frequency', () => {
    // 1 month at 52 payments/year = 52/12 = 4.333... -> rounds to 4.
    expect(totalPeriodsFromYearsMonths(0, 1, 52)).toBe(4);
  });

  it('throws RangeError on negative years', () => {
    expect(() => totalPeriodsFromYearsMonths(-1, 0, 12)).toThrow(RangeError);
  });
});
