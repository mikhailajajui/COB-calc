import { calculateMonthlyPayment } from './payment.js';
import { round2 } from './money.js';
import { calculateExtraPaymentSavings } from './extraPayment.js';
import { validatePaymentFrequencyScheduleInput } from './validate.js';
import type {
  PaymentFrequency,
  PaymentFrequencyScheduleInput,
  PaymentFrequencyScheduleResult,
} from './types.js';

/**
 * paymentFraction: what fraction of the monthly payment is paid at each occurrence.
 * paymentsPerYear × paymentFraction gives the annual-equivalent payment count (12 for
 * an unaccelerated frequency, 13 for an accelerated one) — see types.ts's
 * PaymentFrequency doc comment for why semiMonthly isn't accelerated but biweekly and
 * weekly are.
 */
const FREQUENCY_CONFIG: Record<PaymentFrequency, { paymentsPerYear: number; paymentFraction: number }> = {
  monthly: { paymentsPerYear: 12, paymentFraction: 1 },
  semiMonthly: { paymentsPerYear: 24, paymentFraction: 1 / 2 },
  biweekly: { paymentsPerYear: 26, paymentFraction: 1 / 2 },
  weekly: { paymentsPerYear: 52, paymentFraction: 1 / 4 },
};

export function calculatePaymentFrequencySchedule(
  input: PaymentFrequencyScheduleInput,
): PaymentFrequencyScheduleResult {
  validatePaymentFrequencyScheduleInput(input);

  const { paymentsPerYear, paymentFraction } = FREQUENCY_CONFIG[input.frequency];
  const monthlyPayment = calculateMonthlyPayment(
    input.loanAmount,
    input.annualInterestRatePercent,
    input.termMonths,
  );
  const periodPaymentAmount = round2(monthlyPayment * paymentFraction);

  const annualEquivalentPayments = paymentsPerYear * paymentFraction;
  const extraAnnualPayments = annualEquivalentPayments - 12;
  const effectiveExtraMonthlyPayment = round2((monthlyPayment * extraAnnualPayments) / 12);

  const savings = calculateExtraPaymentSavings({
    loanAmount: input.loanAmount,
    annualInterestRatePercent: input.annualInterestRatePercent,
    termMonths: input.termMonths,
    extraMonthlyPayment: Math.max(effectiveExtraMonthlyPayment, 0),
    startDate: input.startDate,
  });

  return {
    frequency: input.frequency,
    paymentsPerYear,
    monthlyPayment,
    periodPaymentAmount,
    effectiveExtraMonthlyPayment,
    originalMonths: savings.originalMonths,
    newMonths: savings.newMonths,
    monthsSaved: savings.monthsSaved,
    originalTotalInterest: savings.originalTotalInterest,
    newTotalInterest: savings.newTotalInterest,
    interestSaved: savings.interestSaved,
  };
}
