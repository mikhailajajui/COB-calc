import { describe, expect, it } from 'vitest';
import { compareLoanTerms } from '../src/compare.js';

describe('compareLoanTerms', () => {
  it('matches a known example: $400K 30-year @ 6.5% vs 15-year @ 5.9%', () => {
    const result = compareLoanTerms([
      { loanAmount: 400000, annualInterestRatePercent: 6.5, termYears: 30 },
      { loanAmount: 400000, annualInterestRatePercent: 5.9, termYears: 15 },
    ]);

    // The 30-year has the lower monthly payment but the higher total interest.
    expect(result.lowestMonthlyPaymentIndex).toBe(0);
    expect(result.lowestTotalInterestIndex).toBe(1);
    expect(result.entries[0]!.monthlyPayment).toBeLessThan(result.entries[1]!.monthlyPayment);
    expect(result.entries[1]!.totalInterestPaid).toBeLessThan(result.entries[0]!.totalInterestPaid);
  });

  it('resolves ties to the first (lowest) index for two identical loans', () => {
    const loan = { loanAmount: 300000, annualInterestRatePercent: 6, termYears: 30 };
    const result = compareLoanTerms([loan, { ...loan }]);
    expect(result.lowestMonthlyPaymentIndex).toBe(0);
    expect(result.lowestTotalInterestIndex).toBe(0);
  });

  it('throws when fewer than 2 loans are given', () => {
    expect(() =>
      compareLoanTerms([{ loanAmount: 300000, annualInterestRatePercent: 6, termYears: 30 }]),
    ).toThrow(RangeError);
  });
});
