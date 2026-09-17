import { describe, expect, it } from 'vitest';
import { calculatePaymentFrequencySchedule } from '../src/paymentFrequency.js';
import { calculateMonthlyPayment } from '../src/payment.js';
import { round2 } from '../src/money.js';

const loanAmount = 300000;
const annualInterestRatePercent = 6.5;
const termMonths = 360;

describe('calculatePaymentFrequencySchedule', () => {
  it('monthly is a no-op: 12 payments/yr, periodPaymentAmount === monthlyPayment, zero months saved', () => {
    const result = calculatePaymentFrequencySchedule({
      loanAmount,
      annualInterestRatePercent,
      termMonths,
      frequency: 'monthly',
    });
    expect(result.paymentsPerYear).toBe(12);
    expect(result.periodPaymentAmount).toBe(result.monthlyPayment);
    expect(result.effectiveExtraMonthlyPayment).toBe(0);
    expect(result.monthsSaved).toBe(0);
    expect(result.interestSaved).toBe(0);
  });

  it('semiMonthly is NOT accelerated: 24 half-payments/yr = exactly 12 monthly-equivalents', () => {
    const result = calculatePaymentFrequencySchedule({
      loanAmount,
      annualInterestRatePercent,
      termMonths,
      frequency: 'semiMonthly',
    });
    const monthlyPayment = calculateMonthlyPayment(loanAmount, annualInterestRatePercent, termMonths);
    expect(result.paymentsPerYear).toBe(24);
    expect(result.periodPaymentAmount).toBe(round2(monthlyPayment / 2));
    expect(result.effectiveExtraMonthlyPayment).toBe(0);
    expect(result.monthsSaved).toBe(0);
    expect(result.interestSaved).toBe(0);
  });

  it('biweekly and weekly produce the same acceleration (both 13 annual-equivalents/yr)', () => {
    const biweekly = calculatePaymentFrequencySchedule({
      loanAmount,
      annualInterestRatePercent,
      termMonths,
      frequency: 'biweekly',
    });
    const weekly = calculatePaymentFrequencySchedule({
      loanAmount,
      annualInterestRatePercent,
      termMonths,
      frequency: 'weekly',
    });
    expect(biweekly.paymentsPerYear).toBe(26);
    expect(weekly.paymentsPerYear).toBe(52);
    expect(biweekly.effectiveExtraMonthlyPayment).toBe(weekly.effectiveExtraMonthlyPayment);
    expect(biweekly.monthsSaved).toBe(weekly.monthsSaved);
    expect(biweekly.monthsSaved).toBeGreaterThan(0);
  });

  it('produces zero months saved for a 1-month term (nothing to accelerate)', () => {
    const result = calculatePaymentFrequencySchedule({
      loanAmount: 10000,
      annualInterestRatePercent: 6,
      termMonths: 1,
      frequency: 'biweekly',
    });
    expect(result.monthsSaved).toBe(0);
  });

  it('throws for an unsupported frequency string', () => {
    expect(() =>
      calculatePaymentFrequencySchedule({
        loanAmount,
        annualInterestRatePercent,
        termMonths,
        // @ts-expect-error intentionally invalid for the runtime-validation test
        frequency: 'bimonthly',
      }),
    ).toThrow(RangeError);
  });
});
