import { describe, expect, it } from 'vitest';
import { calculateRefinanceBreakeven, compareRefinance } from '../src/refinance.js';
import { calculateMonthlyPayment } from '../src/payment.js';

describe('calculateRefinanceBreakeven', () => {
  it('matches closingCosts / (oldMonthlyPayment - newMonthlyPayment)', () => {
    expect(
      calculateRefinanceBreakeven({
        closingCosts: 6000,
        oldMonthlyPayment: 2024.99,
        newMonthlyPayment: 1839.72,
      }),
    ).toBeCloseTo(6000 / (2024.99 - 1839.72), 2);
  });

  it('returns 0 when closingCosts is 0 and there is positive monthly savings', () => {
    expect(
      calculateRefinanceBreakeven({
        closingCosts: 0,
        oldMonthlyPayment: 2000,
        newMonthlyPayment: 1800,
      }),
    ).toBe(0);
  });

  it('returns Infinity (not a throw) when the new payment is not lower', () => {
    expect(
      calculateRefinanceBreakeven({
        closingCosts: 6000,
        oldMonthlyPayment: 1800,
        newMonthlyPayment: 1800,
      }),
    ).toBe(Infinity);
  });
});

describe('compareRefinance', () => {
  it('matches a known example: $300,000 balance, 6.5% -> 5.5%, 25 years, $6,000 closing costs', () => {
    const oldLoan = { loanAmount: 300000, annualInterestRatePercent: 6.5, termYears: 25 };
    const newLoan = { loanAmount: 300000, annualInterestRatePercent: 5.5, termYears: 25 };
    const closingCosts = 6000;

    // Independently re-derive expected monthly payments instead of trusting the implementation.
    const expectedOldPmt = calculateMonthlyPayment(300000, 6.5, 300);
    const expectedNewPmt = calculateMonthlyPayment(300000, 5.5, 300);
    const expectedBreakeven = closingCosts / (expectedOldPmt - expectedNewPmt);

    const result = compareRefinance({ oldLoan, newLoan, closingCosts });

    expect(result.oldMonthlyPayment).toBeCloseTo(expectedOldPmt, 2);
    expect(result.newMonthlyPayment).toBeCloseTo(expectedNewPmt, 2);
    expect(result.breakevenMonths).toBeCloseTo(expectedBreakeven, 1);
    // Precision -1 allows ~$5 slack for rounding accumulated over 300 payments.
    expect(result.oldTotalCost).toBeCloseTo(expectedOldPmt * 300, -1);
    expect(result.netSavings).toBeGreaterThan(0);
  });

  it('closingCosts of 0 produces a breakevenMonths of 0', () => {
    const oldLoan = { loanAmount: 300000, annualInterestRatePercent: 6.5, termYears: 25 };
    const newLoan = { loanAmount: 300000, annualInterestRatePercent: 5.5, termYears: 25 };
    const result = compareRefinance({ oldLoan, newLoan, closingCosts: 0 });
    expect(result.breakevenMonths).toBe(0);
  });

  it('throws when the new loan has a non-positive termYears', () => {
    const oldLoan = { loanAmount: 300000, annualInterestRatePercent: 6.5, termYears: 25 };
    const newLoan = { loanAmount: 300000, annualInterestRatePercent: 5.5, termYears: 0 };
    expect(() => compareRefinance({ oldLoan, newLoan, closingCosts: 6000 })).toThrow(RangeError);
  });
});
