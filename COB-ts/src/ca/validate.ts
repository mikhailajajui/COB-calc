import type { CobCanadaInput } from './types.js';
import { PAYMENTS_PER_YEAR } from './types.js';
import { validateFeeSchedule } from './fees.js';

/**
 * Validates a CobCanadaInput against docs/new-req/006-cost-of-borrowing-disclosure.md's
 * "Data shapes" and "Presentation layer" sections (rewritten per doc 007's BRD
 * reconciliation): field ranges, the flow-conditional required date fields, and the
 * mortgage+variable-only scoping of the variableRatePaymentChange flow. Called first
 * by calculateCobCanada, per this project's validateXInput convention (plain
 * RangeError, no custom error classes).
 *
 * Unlike the pre-rewrite model, flow no longer implies productType (doc 007
 * finding #9 -- newMortgageOrLoan/renewal/paymentChange apply identically to both
 * mortgages and personal loans; only variableRatePaymentChange is still scoped, by
 * construction, to mortgage+variable), so there is no flow<->productType consistency
 * check left to perform beyond that one case.
 */
export function validateCobCanadaInput(input: CobCanadaInput): void {
  if (!(input.loanAmount > 0)) {
    throw new RangeError(`loanAmount must be > 0, got ${input.loanAmount}`);
  }
  if (!(input.contractRatePercent >= 0)) {
    throw new RangeError(`contractRatePercent must be >= 0, got ${input.contractRatePercent}`);
  }
  if (!(input.paymentAmount > 0)) {
    throw new RangeError(`paymentAmount must be > 0, got ${input.paymentAmount}`);
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

  validateFeeSchedule(input.fees);

  // variableRatePaymentChange exists specifically to recompute the trigger rate, so
  // it's mortgage+variable-only by construction (spec 006's "Presentation layer"
  // table). The other three flows apply identically across product/rate type -- no
  // further flow<->product consistency check is needed (doc 007 finding #9).
  if (input.flow === 'variableRatePaymentChange' && (input.productType !== 'mortgage' || input.rateType !== 'variable')) {
    throw new RangeError(
      "flow 'variableRatePaymentChange' is mortgage + variable-rate only (it exists specifically to " +
        `recompute the trigger rate), got productType='${input.productType}', rateType='${input.rateType}'`,
    );
  }

  if (!(input.firstPaymentDate instanceof Date) || Number.isNaN(input.firstPaymentDate.getTime())) {
    throw new RangeError('firstPaymentDate must be a valid Date');
  }
  if (!(input.endDate instanceof Date) || Number.isNaN(input.endDate.getTime())) {
    throw new RangeError('endDate must be a valid Date');
  }
  if (input.endDate.getTime() <= input.firstPaymentDate.getTime()) {
    throw new RangeError('endDate must be after firstPaymentDate -- otherwise the schedule generates zero payments');
  }

  // Flow-conditional date fields (spec 006's "Presentation layer" table).
  if (input.flow === 'newMortgageOrLoan') {
    if (input.disbursalDate === undefined) {
      throw new RangeError(`flow '${input.flow}' requires disbursalDate`);
    }
    if (input.disbursalDate.getTime() > input.firstPaymentDate.getTime()) {
      throw new RangeError('disbursalDate must be on or before firstPaymentDate');
    }
  } else {
    if (input.renewalDate === undefined) {
      throw new RangeError(`flow '${input.flow}' requires renewalDate`);
    }
    if (input.renewalDate.getTime() > input.firstPaymentDate.getTime()) {
      throw new RangeError('renewalDate must be on or before firstPaymentDate');
    }
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
}
