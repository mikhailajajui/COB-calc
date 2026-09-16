import { validateDscrInputs } from './validate.js';

/** DSCR = netOperatingIncome / annualDebtService, unrounded ratio. Values > 1.0
 *  indicate sufficient income to cover debt. */
export function debtServiceCoverageRatio(
  netOperatingIncome: number,
  annualDebtService: number,
): number {
  validateDscrInputs(netOperatingIncome, annualDebtService);
  return netOperatingIncome / annualDebtService;
}
