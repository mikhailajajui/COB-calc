import { round2 } from './money.js';
import { validatePaymentInputs } from './validate.js';

/**
 * Standard fixed-rate annuity payment formula:
 *   r = annualInterestRatePercent / 100 / 12
 *   M = balance * [ r(1+r)^n ] / [ (1+r)^n - 1 ]
 * with the r = 0 edge case handled separately (M = balance / n) to avoid division by
 * zero. Returns the payment rounded to cents.
 */
export function calculateMonthlyPayment(
  balance: number,
  annualInterestRatePercent: number,
  numberOfPayments: number,
): number {
  validatePaymentInputs(balance, annualInterestRatePercent, numberOfPayments);

  const r = annualInterestRatePercent / 100 / 12;
  if (r === 0) {
    return round2(balance / numberOfPayments);
  }

  const factor = Math.pow(1 + r, numberOfPayments);
  const payment = (balance * (r * factor)) / (factor - 1);
  return round2(payment);
}
