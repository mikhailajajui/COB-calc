import { summarizeMortgage } from './mortgage.js';
import { validateLoanInput } from './validate.js';
import type { HomePriceLoanInput, LoanInput, LoanSummary, MortgageInput } from './types.js';

/**
 * Convenience wrapper for the simple, non-renewing case (a single fixed-rate loan
 * from origination to payoff). Builds a one-segment MortgageInput so the simple loan
 * case and the segmented/renewal case share one implementation.
 */
export function toSingleSegmentMortgage(input: LoanInput): MortgageInput {
  validateLoanInput(input);
  return {
    segments: [
      {
        startDate: input.startDate ?? new Date(),
        annualInterestRatePercent: input.annualInterestRatePercent,
        amortizationMonthsRemaining: Math.round(input.termYears * 12),
        startingBalance: input.loanAmount,
        // termMonths intentionally omitted so this single segment runs to payoff.
      },
    ],
  };
}

export function summarizeLoan(input: LoanInput): LoanSummary {
  return summarizeMortgage(toSingleSegmentMortgage(input));
}

/** Pure adapter: derives loanAmount from homePrice - downPayment. */
export function fromHomePrice(input: HomePriceLoanInput): LoanInput {
  if (!(input.downPayment < input.homePrice)) {
    throw new RangeError(
      `downPayment (${input.downPayment}) must be less than homePrice (${input.homePrice})`,
    );
  }
  const { homePrice, downPayment, ...rest } = input;
  return {
    ...rest,
    loanAmount: homePrice - downPayment,
  };
}
