import { describe, expect, it } from 'vitest';
import { summarizeLoan, fromHomePrice } from '../src/loan.js';
import { calculateMonthlyPayment } from '../src/payment.js';

describe('summarizeLoan — simple fixed-rate, non-renewing case', () => {
  const input = {
    loanAmount: 200000,
    annualInterestRatePercent: 6,
    termYears: 30,
    startDate: new Date('2024-01-01'),
  };

  it('matches calculateMonthlyPayment for the same inputs', () => {
    const summary = summarizeLoan(input);
    const expectedPayment = calculateMonthlyPayment(200000, 6, 360);
    expect(summary.segmentSummaries[0]!.monthlyPayment).toBe(expectedPayment);
  });

  it('produces a full 360-row schedule ending at exactly zero balance', () => {
    const summary = summarizeLoan(input);
    expect(summary.numberOfPayments).toBe(360);
    expect(summary.schedule).toHaveLength(360);
    expect(summary.schedule[359]!.remainingBalance).toBe(0);
  });

  it('totalOfPayments equals totalInterestPaid plus the original loan amount', () => {
    const summary = summarizeLoan(input);
    expect(summary.totalOfPayments).toBeCloseTo(summary.totalInterestPaid + 200000, 2);
  });

  it('defaults startDate to today when omitted', () => {
    const { startDate, ...rest } = input;
    const summary = summarizeLoan(rest);
    const today = new Date();
    expect(summary.schedule[0]!.paymentDate.getFullYear()).toBe(today.getFullYear());
    expect(summary.schedule[0]!.paymentDate.getMonth()).toBe(today.getMonth());
  });
});

describe('fromHomePrice', () => {
  it('derives loanAmount as homePrice - downPayment', () => {
    const loanInput = fromHomePrice({
      homePrice: 300000,
      downPayment: 60000,
      annualInterestRatePercent: 5,
      termYears: 25,
    });
    expect(loanInput.loanAmount).toBe(240000);

    const direct = summarizeLoan({
      loanAmount: 240000,
      annualInterestRatePercent: 5,
      termYears: 25,
      startDate: new Date('2024-01-01'),
    });
    const viaAdapter = summarizeLoan({ ...loanInput, startDate: new Date('2024-01-01') });
    expect(viaAdapter.totalOfPayments).toBe(direct.totalOfPayments);
  });

  it('throws when downPayment >= homePrice', () => {
    expect(() =>
      fromHomePrice({
        homePrice: 100000,
        downPayment: 100000,
        annualInterestRatePercent: 5,
        termYears: 25,
      }),
    ).toThrow(RangeError);
  });
});
