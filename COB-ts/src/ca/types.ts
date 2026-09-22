import type { PaymentFrequency } from '../types.js';
import type { FeeSchedule } from './fees.js';

/**
 * Canadian Cost of Borrowing (COB) disclosure engine -- a new sibling module to the
 * existing US-style engine (src/payment.ts, src/segment.ts, src/mortgage.ts), per
 * docs/new-req/006-cost-of-borrowing-disclosure.md's "Open questions" -> target-module
 * resolution: the monthly-compounding assumption is hardcoded independently in at
 * least three US-engine files, the output aggregation contract is different (US
 * LoanSummary spans a whole stitched multi-segment schedule; this module's outputs are
 * scoped to just the current contract term), and there's no US concept of trigger rate
 * or contract-term-vs-amortization split. This module does not stitch into
 * segment.ts/mortgage.ts -- that integration is explicitly out of scope for spec 006.
 */

/**
 * The six dropdown-driven flows from spec 006's "Presentation layer" table. Determines
 * which date field is required (pre-approval vs renewal), whether accrued interest
 * carries forward, and whether a trigger rate is computed -- see
 * flowComputesTriggerRate in cobCanada.ts for the exact table.
 */
export type CobFlow =
  | 'newMortgage'
  | 'newLoan'
  | 'existingMortgage'
  | 'existingLoan'
  | 'paymentChange'
  | 'variableRatePaymentChange';

export type ProductType = 'mortgage' | 'personalLoan';
export type RateType = 'variable' | 'fixed';

/**
 * Payments/year per payment frequency. Re-declared here (rather than imported from
 * paymentFrequency.ts's private FREQUENCY_CONFIG) because this module derives a
 * genuine annuity at the periodic cadence directly from equations 1-3, unlike
 * paymentFrequency.ts's "pay half the monthly payment every 2 weeks" acceleration
 * model -- the two modules don't share a config shape worth factoring out, only the
 * underlying payments-per-year counts (12/24/26/52), which are standard.
 */
export const PAYMENTS_PER_YEAR: Record<PaymentFrequency, number> = {
  monthly: 12,
  semiMonthly: 24,
  biweekly: 26,
  weekly: 52,
};

export interface CobCanadaInput {
  flow: CobFlow;
  productType: ProductType;
  rateType: RateType;

  /** spec: loan_amount -- face/contract amount for new flows, or the CURRENT
   *  outstanding balance for existing/payment-change flows (the prior term's final
   *  schedule row's remainingBalance -- see CobCanadaResult.endingBalance). */
  loanAmount: number;
  fees: FeeSchedule;
  /** spec: contract_rate_percent -- nominal annual, a percent number (6 means 6%, per
   *  this project's percent-rate convention). */
  contractRatePercent: number;
  paymentFrequency: PaymentFrequency;

  /** spec: term_years / term_months -- the CONTRACT TERM (renewable,
   *  user-customizable -- commonly 3 or 5 years but not restricted to those values),
   *  distinct from the amortization period. */
  termYears: number;
  termMonths: number;
  /** spec: remaining_amortization_years / remaining_amortization_months -- what's left
   *  of the full payoff horizon at the start of THIS contract term. Equals the full
   *  requested amortization for new-flow inputs; shorter than the original for
   *  existing/renewal flows. */
  remainingAmortizationYears: number;
  remainingAmortizationMonths: number;

  firstPaymentDate: Date;
  /** spec: end_date -- maturity/renewal date of THIS contract term, NOT the
   *  amortization payoff date. */
  endDate: Date;

  /** new mortgage / new loan only. */
  disbursalDate?: Date;
  /** new mortgage / new loan only -- display metadata, not read by any equation. */
  preApprovalDate?: Date;
  /** existing mortgage / existing loan / payment change / variable rate payment
   *  change only. */
  renewalDate?: Date;
  /** existing/renewal flows: interest accrued since the last payment, carried into
   *  this calculation. Capitalized into this term's opening balance alongside
   *  financed fees -- a documented judgment call mirroring the COB-xlsx reference
   *  implementation's treatment (spec 006 doesn't pin down accrued-interest mechanics
   *  beyond "carried into this calculation" -- see cobCanada.ts). Defaults to 0 when
   *  omitted, and is ignored entirely for new flows. */
  accruedInterest?: number;
  /** fixed-rate mortgages only -- display/reference anchor for equation 1's
   *  semi-annual conversion; does not change the conversion itself. */
  semiAnnualCompoundingDate?: Date;
}

export interface CobScheduleRow {
  /** 1-based, within this term's schedule only (not a global/cross-renewal number). */
  periodNumber: number;
  periodDate: Date;
  /** The balance this row's interest accrues on, before this row's payment is
   *  applied -- equation 6's P averages this column across the term, per the
   *  Financial Consumer Protection Framework Regulations s.47(1) wording ("principal
   *  outstanding ... before subtracting the payment due at that time"). */
  beginningBalance: number;
  paymentAmount: number;
  interestPortion: number;
  principalPortion: number;
  remainingBalance: number;
}

export interface CobCanadaResult {
  /** Always computed, never a direct input, across every flow (spec 006, "Data
   *  shapes") -- solved via the annuity formula (equation 3) using
   *  remainingAmortization* as n. */
  paymentAmount: number;
  /** spec: cob_amount (equation 7). */
  cobAmount: number;
  /** spec: cob_rate_percent -- this project's Canadian equivalent of APR (equation 6).
   *  A ratio, left unrounded per this project's rounding policy. */
  cobRatePercent: number;
  /** Scoped to the current contract term, not the full amortization. */
  totalPayment: number;
  numberOfPayments: number;
  totalInterest: number;
  principalPayment: number;
  /** mortgage + variable-rate only; null for personal loans and fixed-rate mortgages
   *  (equation 4, invariant #1). A ratio, left unrounded. */
  triggerRatePercent: number | null;
  /** Scoped to the current contract term. The final row's remainingBalance is exposed
   *  separately as endingBalance below -- what a follow-on renewal call would pass in
   *  as its loanAmount (no automatic cross-call chaining is implemented). */
  amortizationSchedule: CobScheduleRow[];
  /** spec: term_days -- DISPLAY ONLY, derived from the term's start reference date +
   *  term_years/term_months. Never read back into any monetary calculation
   *  (invariant #4). */
  termDays: number;
  /** loanAmount + fees.totalFinancedFees - fees.totalCashFees ("Financed fees",
   *  Conditional calculation paths) -- what's actually disbursed on a NEW mortgage/
   *  loan. Still computed (for completeness) on existing/renewal flows, though nothing
   *  is freshly disbursed there. */
  disbursalAmount: number;
  /** loanAmount + fees.totalFinancedFees (+ accruedInterest for existing/renewal
   *  flows) -- the P0 that paymentAmount, totalInterest, and equation 6's average
   *  balance are all computed against. */
  amortizedPrincipal: number;
  /** amortizationSchedule's last row's remainingBalance -- what a follow-on
   *  "existing"/"payment change" call would use as its loanAmount input. */
  endingBalance: number;
}
