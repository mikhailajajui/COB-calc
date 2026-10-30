import { SEMI_ANNUAL_DATE_REQUIRED } from './policies.js';
import type { CobFlow, ProductType, RateType } from './types.js';

/**
 * The use-case catalogue (ADR-07: one home for the per-flow facts). The engine
 * (cobCanada.ts, validate.ts) and the UI (ui/ca.js, through the barrel) read it.
 * Every value is today's behaviour.
 */
export interface FlowSpec {
  /** Which input date starts the schedule (spec 006's "Presentation layer" table). */
  readonly startDateField: 'disbursalDate' | 'renewalDate';
  /**
   * Whether the flow takes IN-11 past accrued interest. 'hidden': never read (the
   * engine seeds 0). 'required': must be supplied ($0 is valid); decision 4, B20.
   */
  readonly accruedInterest: 'hidden' | 'required';
  /** The product type this flow forces, or null when any is allowed. */
  readonly forcedProductType: ProductType | null;
  /** The rate type this flow forces, or null when any is allowed. */
  readonly forcedRateType: RateType | null;
  /** Label of the start-date field on screen and in the print record (decisions 2 and 5, B22). */
  readonly startDateLabel: string;
  /** Label of the first-payment-date field on screen and in the print record (decisions 2 and 5, B22). */
  readonly firstPaymentDateLabel: string;
}

/** The four flows. The order is load-bearing: validate.ts joins it with '/' in its message. */
export const FLOW_IDS: readonly CobFlow[] = Object.freeze([
  'newMortgageOrLoan',
  'renewal',
  'paymentChange',
  'variableRatePaymentChange',
] as const);

export const FLOWS: Readonly<Record<CobFlow, FlowSpec>> = Object.freeze({
  newMortgageOrLoan: Object.freeze({
    startDateField: 'disbursalDate',
    accruedInterest: 'hidden',
    forcedProductType: null,
    forcedRateType: null,
    startDateLabel: 'Disbursal date',
    firstPaymentDateLabel: 'First payment date',
  }),
  renewal: Object.freeze({
    startDateField: 'renewalDate',
    accruedInterest: 'required',
    forcedProductType: null,
    forcedRateType: null,
    startDateLabel: 'Renewal date',
    firstPaymentDateLabel: 'First payment date',
  }),
  paymentChange: Object.freeze({
    startDateField: 'renewalDate',
    accruedInterest: 'required',
    forcedProductType: null,
    forcedRateType: null,
    startDateLabel: 'Date of change',
    firstPaymentDateLabel: 'Next payment date',
  }),
  // Exists specifically to recompute the trigger rate, so it is mortgage + variable only.
  variableRatePaymentChange: Object.freeze({
    startDateField: 'renewalDate',
    accruedInterest: 'required',
    forcedProductType: 'mortgage',
    forcedRateType: 'variable',
    startDateLabel: 'Date of change',
    firstPaymentDateLabel: 'Next payment date',
  }),
} satisfies Record<CobFlow, FlowSpec>);

/**
 * Trigger rate is computed whenever product = mortgage and rate = variable,
 * regardless of which of the four flows is in play (spec 006's "Presentation layer"
 * table: newMortgageOrLoan/renewal/paymentChange all say "Yes, if product = mortgage
 * and rate type = variable"; variableRatePaymentChange says "Yes, always" but that
 * flow is validated to be mortgage+variable-only by construction -- see validate.ts --
 * so the condition collapses to this single productType/rateType check for every flow).
 */
export function computesTriggerRate(productType: ProductType, rateType: RateType): boolean {
  return productType === 'mortgage' && rateType === 'variable';
}

/** Whether the semi-annual compounding reference date belongs to this product and rate type (a fixed-rate mortgage). */
function semiAnnualDateApplies(productType: ProductType, rateType: RateType): boolean {
  return productType === 'mortgage' && rateType === 'fixed';
}

/**
 * Q-SACD: the semi-annual compounding reference date (equation 1) is required for a
 * fixed-rate mortgage only while `required` is on (mechanism M2: the defaulted last
 * parameter). This coincides today with equations.ts selectRateBasis (OQ-C), but the
 * two rules are kept separate on purpose.
 */
export function requiresSemiAnnualDate(
  productType: ProductType,
  rateType: RateType,
  required: boolean = SEMI_ANNUAL_DATE_REQUIRED,
): boolean {
  return required && semiAnnualDateApplies(productType, rateType);
}
