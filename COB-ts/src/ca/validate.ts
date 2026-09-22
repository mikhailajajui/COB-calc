import type { CobCanadaInput } from './types.js';
import { PAYMENTS_PER_YEAR } from './types.js';
import { validateFeeSchedule } from './fees.js';

function isNewFlow(flow: CobCanadaInput['flow']): boolean {
  return flow === 'newMortgage' || flow === 'newLoan';
}

/**
 * Validates a CobCanadaInput against docs/new-req/006-cost-of-borrowing-disclosure.md's
 * "Data shapes" and "Presentation layer" sections: field ranges, the flow<->product-type
 * consistency implied by the dropdown table, flow-conditional required date fields, and
 * the term-cannot-outlive-amortization constraint. Called first by calculateCobCanada,
 * per this project's validateXInput convention (plain RangeError, no custom error
 * classes).
 */
export function validateCobCanadaInput(input: CobCanadaInput): void {
  if (!(input.loanAmount > 0)) {
    throw new RangeError(`loanAmount must be > 0, got ${input.loanAmount}`);
  }
  if (!(input.contractRatePercent >= 0)) {
    throw new RangeError(`contractRatePercent must be >= 0, got ${input.contractRatePercent}`);
  }
  if (PAYMENTS_PER_YEAR[input.paymentFrequency] === undefined) {
    throw new RangeError(
      `paymentFrequency must be one of monthly/semiMonthly/biweekly/weekly, got ${String(input.paymentFrequency)}`,
    );
  }

  if (!(Number.isInteger(input.termYears) && input.termYears >= 0)) {
    throw new RangeError(`termYears must be a non-negative integer, got ${input.termYears}`);
  }
  if (!(Number.isInteger(input.termMonths) && input.termMonths >= 0 && input.termMonths < 12)) {
    throw new RangeError(`termMonths must be an integer in [0, 11], got ${input.termMonths}`);
  }
  if (input.termYears === 0 && input.termMonths === 0) {
    throw new RangeError('termYears/termMonths must not both be 0 -- the contract term must be > 0');
  }

  if (!(Number.isInteger(input.remainingAmortizationYears) && input.remainingAmortizationYears >= 0)) {
    throw new RangeError(
      `remainingAmortizationYears must be a non-negative integer, got ${input.remainingAmortizationYears}`,
    );
  }
  if (
    !(
      Number.isInteger(input.remainingAmortizationMonths) &&
      input.remainingAmortizationMonths >= 0 &&
      input.remainingAmortizationMonths < 12
    )
  ) {
    throw new RangeError(
      `remainingAmortizationMonths must be an integer in [0, 11], got ${input.remainingAmortizationMonths}`,
    );
  }
  if (input.remainingAmortizationYears === 0 && input.remainingAmortizationMonths === 0) {
    throw new RangeError(
      'remainingAmortizationYears/remainingAmortizationMonths must not both be 0 -- there must be ' +
        'amortization horizon left for this term to sit inside',
    );
  }

  const termMonthsTotal = input.termYears * 12 + input.termMonths;
  const remainingMonthsTotal = input.remainingAmortizationYears * 12 + input.remainingAmortizationMonths;
  if (termMonthsTotal > remainingMonthsTotal) {
    throw new RangeError(
      `term (${termMonthsTotal} months) cannot exceed remaining amortization (${remainingMonthsTotal} months) ` +
        "-- a mortgage/loan's contract term cannot outlive its own amortization",
    );
  }

  validateFeeSchedule(input.fees);

  // Flow <-> product-type consistency, per the "Presentation layer" dropdown table.
  if ((input.flow === 'newMortgage' || input.flow === 'existingMortgage') && input.productType !== 'mortgage') {
    throw new RangeError(`flow '${input.flow}' requires productType 'mortgage', got '${input.productType}'`);
  }
  if ((input.flow === 'newLoan' || input.flow === 'existingLoan') && input.productType !== 'personalLoan') {
    throw new RangeError(`flow '${input.flow}' requires productType 'personalLoan', got '${input.productType}'`);
  }
  if (input.flow === 'variableRatePaymentChange' && (input.productType !== 'mortgage' || input.rateType !== 'variable')) {
    throw new RangeError(
      "flow 'variableRatePaymentChange' is mortgage + variable-rate only (it exists specifically to " +
        `recompute the trigger rate), got productType='${input.productType}', rateType='${input.rateType}'`,
    );
  }

  // Flow-conditional date fields.
  if (isNewFlow(input.flow) && input.disbursalDate === undefined) {
    throw new RangeError(`flow '${input.flow}' requires disbursalDate`);
  }
  if (!isNewFlow(input.flow) && input.renewalDate === undefined) {
    throw new RangeError(`flow '${input.flow}' requires renewalDate`);
  }
  if (input.accruedInterest !== undefined && !(input.accruedInterest >= 0)) {
    throw new RangeError(`accruedInterest must be >= 0, got ${input.accruedInterest}`);
  }

  // Compounding-convention reference input (equation 1).
  if (
    input.productType === 'mortgage' &&
    input.rateType === 'fixed' &&
    input.semiAnnualCompoundingDate === undefined
  ) {
    throw new RangeError(
      "productType 'mortgage' with rateType 'fixed' requires semiAnnualCompoundingDate " +
        '(the semi-annual compounding reference anchor -- equation 1)',
    );
  }

  if (!(input.firstPaymentDate instanceof Date) || Number.isNaN(input.firstPaymentDate.getTime())) {
    throw new RangeError('firstPaymentDate must be a valid Date');
  }
  if (!(input.endDate instanceof Date) || Number.isNaN(input.endDate.getTime())) {
    throw new RangeError('endDate must be a valid Date');
  }
}
