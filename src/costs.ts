import { round2 } from './money.js';
import { calculatePmiPayment } from './pmi.js';
import { validatePmiInput, validateRecurringCosts } from './validate.js';
import type { AmortizationEntry, CostBreakdownSummary, PmiInput, RecurringCosts } from './types.js';

/** annualIncreasePercent compounds at each 12-payment anniversary; the compounding
 *  itself stays unrounded until the final round2 of the monthly portion. */
function monthlyRecurringAmount(
  annualAmount: number,
  annualIncreasePercent: number | undefined,
  paymentNumber: number,
): number {
  const yearIndex = Math.floor((paymentNumber - 1) / 12);
  const escalated = annualAmount * Math.pow(1 + (annualIncreasePercent ?? 0) / 100, yearIndex);
  return round2(escalated / 12);
}

export function applyRecurringCosts(
  schedule: AmortizationEntry[],
  recurringCosts: RecurringCosts | undefined,
  pmi: PmiInput | undefined,
): { rows: AmortizationEntry[]; breakdown: CostBreakdownSummary } {
  validateRecurringCosts(recurringCosts);
  if (pmi) validatePmiInput(pmi);

  const originalLoanAmount = schedule.length > 0 ? schedule[0]!.remainingBalance + schedule[0]!.principalPortion : 0;
  const dropAtLtv = (pmi?.dropAtLtvPercent ?? 80) / 100;

  let totalTaxPaid = 0;
  let totalInsurancePaid = 0;
  let totalHoaPaid = 0;
  let totalPmiPaid = 0;
  let pmiDroppedAtPaymentNumber: number | undefined;
  let pmiWasActive = false;

  const rows = schedule.map((row) => {
    const taxPortion = recurringCosts?.propertyTax
      ? monthlyRecurringAmount(
          recurringCosts.propertyTax.annualAmount,
          recurringCosts.propertyTax.annualIncreasePercent,
          row.paymentNumber,
        )
      : undefined;
    const insurancePortion = recurringCosts?.homeInsurance
      ? monthlyRecurringAmount(
          recurringCosts.homeInsurance.annualAmount,
          recurringCosts.homeInsurance.annualIncreasePercent,
          row.paymentNumber,
        )
      : undefined;
    const hoaPortion = recurringCosts?.hoa
      ? monthlyRecurringAmount(
          recurringCosts.hoa.annualAmount,
          recurringCosts.hoa.annualIncreasePercent,
          row.paymentNumber,
        )
      : undefined;

    let pmiPortion: number | undefined;
    if (pmi) {
      const currentLtv = row.remainingBalance / pmi.propertyValue;
      if (currentLtv > dropAtLtv) {
        pmiPortion = calculatePmiPayment(originalLoanAmount, pmi.annualRatePercent);
        pmiWasActive = true;
      } else {
        pmiPortion = 0;
        if (pmiWasActive && pmiDroppedAtPaymentNumber === undefined) {
          pmiDroppedAtPaymentNumber = row.paymentNumber;
        }
      }
    }

    totalTaxPaid = round2(totalTaxPaid + (taxPortion ?? 0));
    totalInsurancePaid = round2(totalInsurancePaid + (insurancePortion ?? 0));
    totalHoaPaid = round2(totalHoaPaid + (hoaPortion ?? 0));
    totalPmiPaid = round2(totalPmiPaid + (pmiPortion ?? 0));

    return { ...row, taxPortion, insurancePortion, hoaPortion, pmiPortion };
  });

  const totalOfPayments = round2(rows.reduce((sum, row) => sum + row.paymentAmount, 0));
  const totalCostOfOwnership = round2(
    totalOfPayments + totalTaxPaid + totalInsurancePaid + totalHoaPaid + totalPmiPaid,
  );

  return {
    rows,
    breakdown: {
      totalTaxPaid,
      totalInsurancePaid,
      totalHoaPaid,
      totalPmiPaid,
      totalCostOfOwnership,
      pmiDroppedAtPaymentNumber,
    },
  };
}
