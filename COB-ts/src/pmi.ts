import { round2 } from './money.js';
import { validatePmiPaymentInputs } from './validate.js';

/** Monthly PMI payment against a given balance (typically the original loan amount —
 *  PMI doesn't vary month-to-month like a running-balance figure would). */
export function calculatePmiPayment(loanBalance: number, annualRatePercent: number): number {
  validatePmiPaymentInputs(loanBalance, annualRatePercent);
  return round2((loanBalance * annualRatePercent) / 100 / 12);
}
