import { summarizeLoan } from './loan.js';
import { validateTermComparisonInput } from './validate.js';
import type { LoanInput } from './types.js';

export interface TermComparisonEntry {
  input: LoanInput;
  monthlyPayment: number;
  totalInterestPaid: number;
  totalOfPayments: number;
  payoffDate: Date;
}

export interface TermComparisonResult {
  entries: TermComparisonEntry[];
  lowestMonthlyPaymentIndex: number;
  lowestTotalInterestIndex: number;
}

/** Pure aggregation over summarizeLoan() per entry. Ties resolve to the first (lowest)
 *  index. */
export function compareLoanTerms(loans: LoanInput[]): TermComparisonResult {
  validateTermComparisonInput(loans);

  const entries: TermComparisonEntry[] = loans.map((input) => {
    const summary = summarizeLoan(input);
    return {
      input,
      monthlyPayment: summary.segmentSummaries[0]!.monthlyPayment,
      totalInterestPaid: summary.totalInterestPaid,
      totalOfPayments: summary.totalOfPayments,
      payoffDate: summary.payoffDate,
    };
  });

  let lowestMonthlyPaymentIndex = 0;
  let lowestTotalInterestIndex = 0;
  for (let i = 1; i < entries.length; i += 1) {
    if (entries[i]!.monthlyPayment < entries[lowestMonthlyPaymentIndex]!.monthlyPayment) {
      lowestMonthlyPaymentIndex = i;
    }
    if (entries[i]!.totalInterestPaid < entries[lowestTotalInterestIndex]!.totalInterestPaid) {
      lowestTotalInterestIndex = i;
    }
  }

  return { entries, lowestMonthlyPaymentIndex, lowestTotalInterestIndex };
}
