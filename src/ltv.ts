import { validateCltvInputs, validateLtvInputs } from './validate.js';

/** LTV = loanAmount / propertyValue, as an unrounded decimal ratio (0.9 = 90%). */
export function loanToValue(loanAmount: number, propertyValue: number): number {
  validateLtvInputs(loanAmount, propertyValue);
  return loanAmount / propertyValue;
}

/** CLTV = (firstLienBalance + secondLienBalance) / propertyValue, unrounded decimal ratio. */
export function combinedLoanToValue(
  firstLienBalance: number,
  secondLienBalance: number,
  propertyValue: number,
): number {
  validateCltvInputs(firstLienBalance, secondLienBalance, propertyValue);
  return (firstLienBalance + secondLienBalance) / propertyValue;
}
