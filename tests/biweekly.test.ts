import { describe, expect, it } from 'vitest';
import { calculateBiweeklySchedule } from '../src/biweekly.js';
import { calculateMonthlyPayment } from '../src/payment.js';
import { round2 } from '../src/money.js';

describe('calculateBiweeklySchedule', () => {
  it('halves the monthly payment for biweeklyPaymentAmount and saves several years for a 30-year @ 6.5%', () => {
    const loanAmount = 300000;
    const annualInterestRatePercent = 6.5;
    const termMonths = 360;
    const monthlyPayment = calculateMonthlyPayment(
      loanAmount,
      annualInterestRatePercent,
      termMonths,
    );

    const result = calculateBiweeklySchedule({ loanAmount, annualInterestRatePercent, termMonths });

    expect(result.biweeklyPaymentAmount).toBe(round2(monthlyPayment / 2));
    // A 1-extra-payment-per-year acceleration on a 30-year loan typically saves
    // somewhere between 3 and 6 years; a documented range check since this composes
    // an already-tested function (calculateExtraPaymentSavings).
    expect(result.monthsSaved).toBeGreaterThan(36);
    expect(result.monthsSaved).toBeLessThan(72);
  });

  it('saves zero months for a 1-month term (nothing to accelerate)', () => {
    const result = calculateBiweeklySchedule({
      loanAmount: 10000,
      annualInterestRatePercent: 6,
      termMonths: 1,
    });
    expect(result.monthsSaved).toBe(0);
  });

  it('throws when loanAmount is not positive', () => {
    expect(() =>
      calculateBiweeklySchedule({
        loanAmount: 0,
        annualInterestRatePercent: 6,
        termMonths: 360,
      }),
    ).toThrow(RangeError);
  });
});
