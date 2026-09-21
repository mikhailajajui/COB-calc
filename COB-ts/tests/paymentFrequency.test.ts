import { describe, expect, it } from 'vitest';
import { calculatePaymentFrequencySchedule } from '../src/paymentFrequency.js';
import { calculateMonthlyPayment } from '../src/payment.js';
import { round2 } from '../src/money.js';

const loanAmount = 300000;
const annualInterestRatePercent = 6.5;
const termMonths = 360;

describe('calculatePaymentFrequencySchedule', () => {
  it('monthly is an exact identity against the standard monthly schedule (not an approximation)', () => {
    const result = calculatePaymentFrequencySchedule({
      loanAmount,
      annualInterestRatePercent,
      termMonths,
      frequency: 'monthly',
    });
    expect(result.paymentsPerYear).toBe(12);
    expect(result.periodPaymentAmount).toBe(result.monthlyPayment);
    expect(result.numberOfPeriods).toBe(result.originalMonths);
    expect(result.monthsSaved).toBe(0);
    expect(result.interestSaved).toBe(0);
    expect(result.schedule).toHaveLength(360);
    expect(result.schedule[result.schedule.length - 1]!.remainingBalance).toBe(0);
  });

  it('semiMonthly saves no time (0 months) but a modest amount of interest from payment timing, under true per-period accrual', () => {
    // Nominally "not accelerated" (24 half-payments/yr = 12 monthly-equivalents by
    // payment count), but true independent per-period compounding at annual/24 still
    // produces a small interest saving purely because half the annual total arrives
    // ~15 days earlier on average than a single monthly lump payment — a real,
    // if modest, timing effect the monthly-equivalent approximation couldn't surface.
    const result = calculatePaymentFrequencySchedule({
      loanAmount,
      annualInterestRatePercent,
      termMonths,
      frequency: 'semiMonthly',
    });
    const monthlyPayment = calculateMonthlyPayment(loanAmount, annualInterestRatePercent, termMonths);
    expect(result.paymentsPerYear).toBe(24);
    expect(result.periodPaymentAmount).toBe(round2(monthlyPayment / 2));
    expect(result.numberOfPeriods).toBe(720);
    expect(result.monthsSaved).toBe(0);
    expect(result.interestSaved).toBeGreaterThan(0);
    // Sanity bound: the timing effect is real but small relative to total interest.
    expect(result.interestSaved).toBeLessThan(result.originalTotalInterest * 0.01);
  });

  it('biweekly and weekly both accelerate substantially, weekly by at least as much as biweekly', () => {
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
    expect(biweekly.monthsSaved).toBeGreaterThan(60);
    expect(weekly.monthsSaved).toBeGreaterThan(60);
    expect(biweekly.interestSaved).toBeGreaterThan(50000);
    expect(weekly.interestSaved).toBeGreaterThan(50000);
    // More frequent compounding/payment timing never saves less — but the two aren't
    // required to be identical the way they were under the old monthly-equivalent
    // approximation.
    expect(weekly.interestSaved).toBeGreaterThanOrEqual(biweekly.interestSaved);
  });

  it('produces a full per-period schedule ending at exactly $0 with real calendar dates', () => {
    const result = calculatePaymentFrequencySchedule({
      loanAmount: 20000,
      annualInterestRatePercent: 6,
      termMonths: 24,
      frequency: 'weekly',
      startDate: new Date('2024-01-01'),
    });
    expect(result.schedule.length).toBe(result.numberOfPeriods);
    expect(result.schedule[0]!.periodDate).toEqual(new Date('2024-01-01'));
    expect(result.schedule[1]!.periodDate).toEqual(new Date('2024-01-08')); // +7 days
    const last = result.schedule[result.schedule.length - 1]!;
    expect(last.remainingBalance).toBe(0);
    expect(result.payoffDate).toEqual(last.periodDate);
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
