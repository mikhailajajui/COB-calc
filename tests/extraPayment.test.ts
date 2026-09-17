import { describe, expect, it } from 'vitest';
import { calculateExtraPaymentSavings } from '../src/extraPayment.js';

describe('calculateExtraPaymentSavings', () => {
  it('matches a known example: $300,000 @ 6.5% 30-year + $200/month extra', () => {
    // Independently re-derive expected values with a standalone simulation loop,
    // rather than trusting the implementation (mirrors the lending skill's own
    // verified demo: 300000, 6.5%, 360mo, +$200/mo -> months saved 83).
    const principal = 300000;
    const ratePercent = 6.5;
    const termMonths = 360;
    const extra = 200;
    const r = ratePercent / 100 / 12;

    // Standard annuity formula for the base payment.
    const factor = Math.pow(1 + r, termMonths);
    const basePayment = Math.round(((principal * (r * factor)) / (factor - 1)) * 100) / 100;
    const totalPmt = basePayment + extra;

    let balance = principal;
    let months = 0;
    let interestPaid = 0;
    while (balance > 0.005) {
      months += 1;
      const interest = balance * r;
      interestPaid += interest;
      const principalPortion = Math.min(totalPmt - interest, balance);
      balance -= principalPortion;
      if (totalPmt <= interest) break;
    }

    const originalInterest = termMonths * basePayment - principal;

    const result = calculateExtraPaymentSavings({
      loanAmount: principal,
      annualInterestRatePercent: ratePercent,
      termMonths,
      extraMonthlyPayment: extra,
    });

    expect(result.monthsSaved).toBe(termMonths - months);
    expect(result.newMonths).toBe(months);
    // ~$10 slack for rounding-policy differences between the two independent
    // implementations (per-row cent rounding vs. a raw simulation loop).
    expect(result.interestSaved).toBeCloseTo(originalInterest - interestPaid, -1);
  });

  it('produces exactly zero savings when extraMonthlyPayment is 0', () => {
    // Short-circuited in the implementation specifically to guarantee this — a zero
    // extra payment is mathematically identical to the baseline, not just "close".
    const result = calculateExtraPaymentSavings({
      loanAmount: 300000,
      annualInterestRatePercent: 6.5,
      termMonths: 360,
      extraMonthlyPayment: 0,
    });
    expect(result.monthsSaved).toBe(0);
    expect(result.newMonths).toBe(result.originalMonths);
    expect(result.interestSaved).toBe(0);
  });

  it('throws when extraMonthlyPayment is negative', () => {
    expect(() =>
      calculateExtraPaymentSavings({
        loanAmount: 300000,
        annualInterestRatePercent: 6.5,
        termMonths: 360,
        extraMonthlyPayment: -50,
      }),
    ).toThrow(RangeError);
  });
});
