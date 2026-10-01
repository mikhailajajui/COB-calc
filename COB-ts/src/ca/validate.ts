import type { CobCanadaInput, ProductType, RateType } from './types.js';
import { PAYMENTS_PER_YEAR, isFiniteNumber } from './types.js';
import { utcDateOnly } from './calendar.js';
import { totalCashFees, totalFinancedFees, validateFeeSchedule } from './fees.js';
import { FLOWS, FLOW_IDS, requiresSemiAnnualDate } from './flows.js';
import { allowedPaymentFrequencies } from './products.js';

/**
 * Validates a CobCanadaInput against docs/new-req/006-cost-of-borrowing-disclosure.md's
 * "Data shapes" and "Presentation layer" sections (rewritten per doc 007's BRD
 * reconciliation): field types (finite numbers, own-key enum values; 012 D-11) and
 * ranges, the BRD §6 fee limit (financed + non-financed; OQ-M), the flow-conditional
 * required date fields (each a valid Date by name, ordered on UTC calendar dates;
 * 012 D-12), and the mortgage+variable-only scoping of the variableRatePaymentChange
 * flow. Called first by calculateCobCanada, per this project's validateXInput
 * convention (plain RangeError, no custom error classes). collectInputIssues runs the
 * same checks and returns every issue instead of throwing at the first (A9).
 *
 * Unlike the pre-rewrite model, flow no longer implies productType (doc 007
 * finding #9 -- newMortgageOrLoan/renewal/paymentChange apply identically to both
 * mortgages and personal loans; only variableRatePaymentChange is still scoped, by
 * construction, to mortgage+variable), so there is no flow<->productType consistency
 * check left to perform beyond that one case.
 */
const PRODUCT_TYPES: readonly ProductType[] = ['mortgage', 'personalLoan'];
const RATE_TYPES: readonly RateType[] = ['variable', 'fixed'];

function isOneOf(allowed: readonly string[], x: unknown): boolean {
  return typeof x === 'string' && allowed.includes(x);
}

/** 012 D-12: a real, finite Date (objects that merely have getTime are rejected). */
function isValidDate(x: unknown): x is Date {
  return x instanceof Date && Number.isFinite(x.getTime());
}

/** The flow's start date: input[FLOWS[flow].startDateField], checked to be a valid Date (the input's own object). */
export interface ValidatedInput {
  readonly startDate: Date;
}

/** One input problem: the top-level input field it belongs to, and its message. */
export interface InputIssue {
  readonly field: keyof CobCanadaInput;
  readonly message: string;
}

type Report = (issue: InputIssue) => void;

/**
 * Runs every check in order and passes each issue to `report`. A check whose inputs
 * failed an earlier check is skipped (it would only report a consequence, or throw).
 * Returns the flow's start date when its checks pass, otherwise undefined -- and every
 * undefined path has reported first, so a throwing reporter always gets a Date back.
 */
function checkInput(input: CobCanadaInput, report: (issue: InputIssue) => never): Date;
function checkInput(input: CobCanadaInput, report: Report): Date | undefined;
function checkInput(input: CobCanadaInput, report: Report): Date | undefined {
  let loanOk = false;
  if (!isFiniteNumber(input.loanAmount)) {
    report({ field: 'loanAmount', message: `loanAmount must be a finite number, got ${String(input.loanAmount)}` });
  } else if (!(input.loanAmount > 0)) {
    report({ field: 'loanAmount', message: `loanAmount must be > 0, got ${input.loanAmount}` });
  } else {
    loanOk = true;
  }
  if (!isFiniteNumber(input.contractRatePercent)) {
    report({
      field: 'contractRatePercent',
      message: `contractRatePercent must be a finite number, got ${String(input.contractRatePercent)}`,
    });
  } else if (!(input.contractRatePercent > 0)) {
    report({ field: 'contractRatePercent', message: `contractRatePercent must be > 0, got ${input.contractRatePercent}` });
  }
  if (!isFiniteNumber(input.paymentAmount)) {
    report({ field: 'paymentAmount', message: `paymentAmount must be a finite number, got ${String(input.paymentAmount)}` });
  } else if (!(input.paymentAmount > 0)) {
    report({ field: 'paymentAmount', message: `paymentAmount must be > 0, got ${input.paymentAmount}` });
  }
  const freqOk = typeof input.paymentFrequency === 'string' && Object.hasOwn(PAYMENTS_PER_YEAR, input.paymentFrequency);
  if (!freqOk) {
    report({
      field: 'paymentFrequency',
      message: `paymentFrequency must be one of ${Object.keys(PAYMENTS_PER_YEAR).join('/')}, got ${String(input.paymentFrequency)}`,
    });
  }
  const flowOk = isOneOf(FLOW_IDS, input.flow);
  if (!flowOk) {
    report({ field: 'flow', message: `flow must be one of ${FLOW_IDS.join('/')}, got ${String(input.flow)}` });
  }
  const productOk = isOneOf(PRODUCT_TYPES, input.productType);
  if (!productOk) {
    report({
      field: 'productType',
      message: `productType must be one of ${PRODUCT_TYPES.join('/')}, got ${String(input.productType)}`,
    });
  }
  const rateOk = isOneOf(RATE_TYPES, input.rateType);
  if (!rateOk) {
    report({ field: 'rateType', message: `rateType must be one of ${RATE_TYPES.join('/')}, got ${String(input.rateType)}` });
  }

  const feesOk = validateFeeSchedule(input.fees, (message) => report({ field: 'fees', message }));
  // BRD §6 / OQ-M: financed + non-financed fees must be less than the loan amount
  // (macro lines 174-184). Summed as two group totals, as the macro does
  // (finFee + nonFinFee), not as one list-order sum (B2-R1).
  if (feesOk && loanOk) {
    const groupedFees = totalFinancedFees(input.fees) + totalCashFees(input.fees);
    if (!(groupedFees < input.loanAmount)) {
      report({
        field: 'fees',
        message: `total fees (financed + non-financed) (${groupedFees}) must be less than loanAmount (${input.loanAmount})`,
      });
    }
  }

  // A flow may force a product type and/or a rate type (renewal: mortgage;
  // variableRatePaymentChange: mortgage + variable; the locks live in flows.ts). The
  // other flows apply identically across product/rate type. The message is built from
  // the catalogue. FLOWS[input.flow] is safe: this runs only if the flow check passed.
  if (flowOk && productOk && rateOk) {
    const flowSpec = FLOWS[input.flow];
    if (
      (flowSpec.forcedProductType !== null && input.productType !== flowSpec.forcedProductType) ||
      (flowSpec.forcedRateType !== null && input.rateType !== flowSpec.forcedRateType)
    ) {
      const allowed = [
        flowSpec.forcedProductType,
        flowSpec.forcedRateType === null ? null : `${flowSpec.forcedRateType}-rate`,
      ]
        .filter((x) => x !== null)
        .join(' + ');
      report({
        field: 'flow',
        message: `flow '${input.flow}' is ${allowed} only, got productType='${input.productType}', rateType='${input.rateType}'`,
      });
    }
  }

  // The product catalogue restricts the payment frequency (personal loan: monthly only;
  // B27, DEV-FB24). Every flow and rate type; runs only when both enums passed.
  if (productOk && freqOk) {
    const allowedFrequencies = allowedPaymentFrequencies(input.productType);
    if (!allowedFrequencies.includes(input.paymentFrequency)) {
      report({
        field: 'paymentFrequency',
        message: `paymentFrequency '${input.paymentFrequency}' is not allowed for productType '${input.productType}' (allowed: ${allowedFrequencies.join('/')})`,
      });
    }
  }

  const firstOk = isValidDate(input.firstPaymentDate);
  if (!firstOk) {
    report({ field: 'firstPaymentDate', message: 'firstPaymentDate must be a valid Date' });
  }
  const endOk = isValidDate(input.endDate);
  if (!endOk) {
    report({ field: 'endDate', message: 'endDate must be a valid Date' });
  }
  if (firstOk && endOk && utcDateOnly(input.endDate) <= utcDateOnly(input.firstPaymentDate)) {
    report({ field: 'endDate', message: 'endDate must be after firstPaymentDate (compared as UTC calendar dates)' });
  }

  // Flow-conditional date fields (spec 006's "Presentation layer" table).
  let startDate: Date | undefined;
  if (flowOk) {
    const startField = FLOWS[input.flow].startDateField;
    const startValue = input[startField];
    if (startValue === undefined) {
      report({ field: startField, message: `flow '${input.flow}' requires ${startField}` });
    } else if (!isValidDate(startValue)) {
      report({ field: startField, message: `${startField} must be a valid Date` });
    } else if (firstOk && utcDateOnly(startValue) > utcDateOnly(input.firstPaymentDate)) {
      report({ field: startField, message: `${startField} must be on or before firstPaymentDate` });
    } else {
      startDate = startValue;
    }
  }
  if (flowOk && FLOWS[input.flow].accruedInterest === 'required' && input.accruedInterest === undefined) {
    report({
      field: 'accruedInterest',
      message: `flow '${input.flow}' requires accruedInterest (enter 0 if there is none)`,
    });
  } else if (input.accruedInterest !== undefined && !isFiniteNumber(input.accruedInterest)) {
    report({
      field: 'accruedInterest',
      message: `accruedInterest must be a finite number, got ${String(input.accruedInterest)}`,
    });
  } else if (input.accruedInterest !== undefined && !(input.accruedInterest >= 0)) {
    report({ field: 'accruedInterest', message: `accruedInterest must be >= 0, got ${input.accruedInterest}` });
  }

  // Compounding-convention reference input (equation 1).
  if (requiresSemiAnnualDate(input.productType, input.rateType, true)) {
    if (input.semiAnnualCompoundingDate === undefined) {
      if (requiresSemiAnnualDate(input.productType, input.rateType)) {
        report({
          field: 'semiAnnualCompoundingDate',
          message:
            "productType 'mortgage' with rateType 'fixed' requires semiAnnualCompoundingDate " +
            '(the semi-annual compounding reference anchor -- equation 1)',
        });
      }
    } else if (!isValidDate(input.semiAnnualCompoundingDate)) {
      report({ field: 'semiAnnualCompoundingDate', message: 'semiAnnualCompoundingDate must be a valid Date' });
    }
  }

  return startDate;
}

/** Throws a RangeError with the first issue's message; evaluates no check after it (A9-R3). */
export function validateCobCanadaInput(input: CobCanadaInput): ValidatedInput {
  return {
    startDate: checkInput(input, (issue) => {
      throw new RangeError(issue.message);
    }),
  };
}

/** Every issue validateCobCanadaInput would find, in check order; [] when the input is valid. Never catches. */
export function collectInputIssues(input: CobCanadaInput): InputIssue[] {
  const issues: InputIssue[] = [];
  checkInput(input, (issue) => {
    issues.push(issue);
  });
  return issues;
}
