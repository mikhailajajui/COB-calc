import { validateArmResetInput } from './validate.js';

export interface ArmResetInput {
  previousRatePercent: number;
  initialRatePercent: number;
  indexRatePercent: number;
  marginPercent: number;
  initialCapPercent?: number;
  periodicCapPercent?: number;
  lifetimeCapPercent?: number;
  isFirstReset: boolean;
}

export interface ArmResetResult {
  fullyIndexedRatePercent: number;
  cappedRatePercent: number;
}

/**
 * Pure rate-cap calculator. Plug cappedRatePercent into a normal renewal segment's
 * annualInterestRatePercent (the existing "variable rate change" mechanism) — call
 * calculateMonthlyPayment(balance, cappedRatePercent, remainingMonths) directly for
 * the resulting payment; this module doesn't duplicate that.
 */
export function calculateArmResetRate(input: ArmResetInput): ArmResetResult {
  validateArmResetInput(input);

  const fullyIndexedRatePercent = input.indexRatePercent + input.marginPercent;
  let capped = fullyIndexedRatePercent;

  const perResetCap = input.isFirstReset ? input.initialCapPercent : input.periodicCapPercent;
  if (perResetCap !== undefined) {
    capped = Math.min(capped, input.previousRatePercent + perResetCap);
  }
  if (input.lifetimeCapPercent !== undefined) {
    capped = Math.min(capped, input.initialRatePercent + input.lifetimeCapPercent);
  }
  capped = Math.max(capped, 0);

  return { fullyIndexedRatePercent, cappedRatePercent: capped };
}
