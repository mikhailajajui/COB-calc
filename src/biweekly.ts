import { calculateMonthlyPayment } from './payment.js';
import { round2 } from './money.js';
import { calculateExtraPaymentSavings } from './extraPayment.js';
import { validateBiweeklyScheduleInput } from './validate.js';
import type { BiweeklyScheduleInput, BiweeklyScheduleResult } from './types.js';

/**
 * Models the standard "26 half-payments = 13 full payments/year" biweekly equivalence
 * as one extra full monthly payment per year, spread evenly across 12 months. The
 * engine is fundamentally monthly-periodic; true biweekly (14-day accrual) would
 * require a parallel engine and is out of scope — this is a documented approximation,
 * not a distinct amortization model.
 */
export function calculateBiweeklySchedule(input: BiweeklyScheduleInput): BiweeklyScheduleResult {
  validateBiweeklyScheduleInput(input);

  const monthlyPayment = calculateMonthlyPayment(
    input.loanAmount,
    input.annualInterestRatePercent,
    input.termMonths,
  );
  const biweeklyPaymentAmount = round2(monthlyPayment / 2);
  const effectiveExtraMonthlyPayment = round2(monthlyPayment / 12);

  const savings = calculateExtraPaymentSavings({
    loanAmount: input.loanAmount,
    annualInterestRatePercent: input.annualInterestRatePercent,
    termMonths: input.termMonths,
    extraMonthlyPayment: effectiveExtraMonthlyPayment,
    startDate: input.startDate,
  });

  return {
    monthlyPayment,
    biweeklyPaymentAmount,
    effectiveExtraMonthlyPayment,
    originalMonths: savings.originalMonths,
    newMonths: savings.newMonths,
    monthsSaved: savings.monthsSaved,
    originalTotalInterest: savings.originalTotalInterest,
    newTotalInterest: savings.newTotalInterest,
    interestSaved: savings.interestSaved,
  };
}
