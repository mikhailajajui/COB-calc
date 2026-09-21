import { summarizeLoan } from './loan.js';
import { round2 } from './money.js';
import { validateRefinanceBreakevenInputs } from './validate.js';
import type { LoanInput } from './types.js';

export interface RefinanceBreakevenInput {
  closingCosts: number;
  oldMonthlyPayment: number;
  newMonthlyPayment: number;
}

/** Months to recoup refinancing closing costs. Infinity if the new payment doesn't
 *  save anything — a legitimate financial outcome, not an invalid input. */
export function calculateRefinanceBreakeven(input: RefinanceBreakevenInput): number {
  validateRefinanceBreakevenInputs(input);
  const savings = input.oldMonthlyPayment - input.newMonthlyPayment;
  if (savings <= 0) return Infinity;
  return input.closingCosts / savings;
}

export interface RefinanceComparisonInput {
  oldLoan: LoanInput;
  newLoan: LoanInput;
  closingCosts: number;
}

export interface RefinanceComparisonResult {
  oldMonthlyPayment: number;
  newMonthlyPayment: number;
  oldTotalCost: number;
  newTotalCost: number;
  netSavings: number;
  breakevenMonths: number;
}

/** Composes two summarizeLoan() calls rather than reimplementing amortization. */
export function compareRefinance(input: RefinanceComparisonInput): RefinanceComparisonResult {
  const oldSummary = summarizeLoan(input.oldLoan);
  const newSummary = summarizeLoan(input.newLoan);

  const oldMonthlyPayment = oldSummary.segmentSummaries[0]!.monthlyPayment;
  const newMonthlyPayment = newSummary.segmentSummaries[0]!.monthlyPayment;
  const oldTotalCost = oldSummary.totalOfPayments;
  const newTotalCost = round2(newSummary.totalOfPayments + input.closingCosts);
  const netSavings = round2(oldTotalCost - newTotalCost);
  const breakevenMonths = calculateRefinanceBreakeven({
    closingCosts: input.closingCosts,
    oldMonthlyPayment,
    newMonthlyPayment,
  });

  return {
    oldMonthlyPayment,
    newMonthlyPayment,
    oldTotalCost,
    newTotalCost,
    netSavings,
    breakevenMonths,
  };
}
