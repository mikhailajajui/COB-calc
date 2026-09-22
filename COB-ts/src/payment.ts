import { round2 } from './money.js';
import { validateAnnuityInputs, validatePaymentInputs } from './validate.js';

/**
 * Pure annuity-payment primitive, shared across engines:
 *   PMT = P * [ r(1+r)^n ] / [ (1+r)^n - 1 ]
 * with the r = 0 edge case handled separately (PMT = P / n) to avoid division by zero.
 * `r` here is already a PERIODIC rate -- callers derive it however is appropriate for
 * their convention (calculateMonthlyPayment below divides an annual percent by 12; the
 * Canadian COB module in src/ca/ derives it via equation 1's semi-annual conversion or
 * equation 2's nominal/n convention -- see docs/new-req/
 * 006-cost-of-borrowing-disclosure.md's "Open questions" -> target-module resolution
 * for why this extraction, rather than parameterizing calculateMonthlyPayment itself,
 * was the chosen reuse path). Returns the payment rounded to cents.
 */
export function annuityPaymentFromPeriodicRate(
  principal: number,
  periodicRate: number,
  numberOfPayments: number,
): number {
  validateAnnuityInputs(principal, periodicRate, numberOfPayments);

  if (periodicRate === 0) {
    return round2(principal / numberOfPayments);
  }

  const factor = Math.pow(1 + periodicRate, numberOfPayments);
  const payment = (principal * (periodicRate * factor)) / (factor - 1);
  return round2(payment);
}

/**
 * Standard fixed-rate annuity payment formula, monthly-only:
 *   r = annualInterestRatePercent / 100 / 12
 *   M = balance * [ r(1+r)^n ] / [ (1+r)^n - 1 ]
 * Delegates to annuityPaymentFromPeriodicRate once r is derived. Kept as its own public
 * entry point with an unchanged signature/behavior (byte-identical for every existing
 * caller) -- validatePaymentInputs still runs first so error messages referencing
 * annualInterestRatePercent are unchanged.
 */
export function calculateMonthlyPayment(
  balance: number,
  annualInterestRatePercent: number,
  numberOfPayments: number,
): number {
  validatePaymentInputs(balance, annualInterestRatePercent, numberOfPayments);

  const r = annualInterestRatePercent / 100 / 12;
  return annuityPaymentFromPeriodicRate(balance, r, numberOfPayments);
}
