import { calculateMonthlyPayment } from './payment.js';
import { round2 } from './money.js';
import { summarizeMortgage } from './mortgage.js';
import { validateExtraPaymentSavingsInput } from './validate.js';
import type { ExtraPaymentSavingsInput, ExtraPaymentSavingsResult } from './types.js';

/** Composes two summarizeMortgage() calls (baseline vs. with an extra monthly
 *  principal payment) rather than reimplementing amortization. */
export function calculateExtraPaymentSavings(
  input: ExtraPaymentSavingsInput,
): ExtraPaymentSavingsResult {
  validateExtraPaymentSavingsInput(input);

  const startDate = input.startDate ?? new Date();

  const baseline = summarizeMortgage({
    segments: [
      {
        startDate,
        annualInterestRatePercent: input.annualInterestRatePercent,
        amortizationMonthsRemaining: input.termMonths,
        startingBalance: input.loanAmount,
      },
    ],
  });

  const basePayment = calculateMonthlyPayment(
    input.loanAmount,
    input.annualInterestRatePercent,
    input.termMonths,
  );

  const withExtra = summarizeMortgage({
    segments: [
      {
        startDate,
        annualInterestRatePercent: input.annualInterestRatePercent,
        paymentAmount: round2(basePayment + input.extraMonthlyPayment),
        startingBalance: input.loanAmount,
        // amortizationMonthsRemaining/termMonths intentionally omitted: the payoff
        // length with extra payments isn't known in advance, so the engine runs the
        // open-ended payment-only branch until the balance reaches zero.
      },
    ],
  });

  return {
    originalMonths: baseline.numberOfPayments,
    newMonths: withExtra.numberOfPayments,
    monthsSaved: baseline.numberOfPayments - withExtra.numberOfPayments,
    originalTotalInterest: baseline.totalInterestPaid,
    newTotalInterest: withExtra.totalInterestPaid,
    interestSaved: round2(baseline.totalInterestPaid - withExtra.totalInterestPaid),
  };
}
