import type { PaymentFrequency } from '../types.js';
import type { FeeSchedule } from './fees.js';

/**
 * Canadian Cost of Borrowing (COB) disclosure engine -- a sibling module to the
 * existing US-style engine (src/payment.ts, src/segment.ts, src/mortgage.ts), per
 * docs/new-req/006-cost-of-borrowing-disclosure.md (rewritten per doc 007's BRD
 * reconciliation against the real Alterna Savings requirements/workbook). This module
 * does not stitch into segment.ts/mortgage.ts -- that integration is explicitly out of
 * scope for spec 006.
 */

/**
 * The four dropdown-driven flows from spec 006's "Presentation layer" table (docx
 * IN-01, collapsed from an earlier six-value draft per doc 007 finding #9 -- product
 * type, IN-03, is already a separate, orthogonal dropdown that applies identically
 * across all four). Determines which date field is required (disbursal vs renewal),
 * whether accrued interest carries forward, and (jointly with productType/rateType)
 * whether a trigger rate is computed.
 */
export type CobFlow = 'newMortgageOrLoan' | 'renewal' | 'paymentChange' | 'variableRatePaymentChange';

export type ProductType = 'mortgage' | 'personalLoan';
export type RateType = 'variable' | 'fixed';

/** Payments/year per payment frequency -- standard counts (12/24/26/52), used
 *  throughout equations 1-8. "Accelerated Weekly" (BR-09) is treated identically to
 *  plain Weekly for rate/day-count purposes, so there is no separate enum value. */
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

  /** spec: loan_amount -- face amount, ALREADY INCLUSIVE of any financed fees
   *  (IN-02). For renewal/paymentChange/variableRatePaymentChange flows this is the
   *  CURRENT outstanding balance (the prior term's final closing_balance), not the
   *  original disbursed amount -- see doc 007 finding #4. */
  loanAmount: number;
  fees: FeeSchedule;
  /** spec: contract_rate_percent -- nominal annual, a percent number (6 means 6%, per
   *  this project's percent-rate convention). */
  contractRatePercent: number;
  /** spec: payment_amount -- USER-ENTERED, present in EVERY flow (IN-08). Never
   *  derived by this engine (doc 007 finding #1); constant across every scheduled
   *  payment for the flow being computed. */
  paymentAmount: number;
  paymentFrequency: PaymentFrequency;

  firstPaymentDate: Date;
  /** spec: end_date (IN-13) -- the date the schedule is run to. The schedule stops at
   *  the last scheduled row before this date is reached, or when closing_balance
   *  reaches zero, whichever comes first -- see cobCanada.ts's schedule generator.
   *  There is no amortization-horizon concept in this engine (doc 007 finding #2). */
  endDate: Date;

  /** term_years / term_months -- DISPLAY ONLY. Informational contract-term length;
   *  does not drive the schedule (end_date does) and does not feed any monetary
   *  output. */
  termYears: number;
  termMonths: number;

  /** newMortgageOrLoan ONLY -- start of interest accrual and this flow's start_date
   *  for the cob_rate_percent equation's T. */
  disbursalDate?: Date;
  /** renewal / paymentChange / variableRatePaymentChange ONLY -- this flow's
   *  start_date, same role as disbursalDate for a new flow. */
  renewalDate?: Date;
  /** renewal/paymentChange/variableRatePaymentChange flows: interest accrued since
   *  the last payment, carried into this calculation as the schedule's initial
   *  carriedAccruedInterest (equation 4) -- NOT added to loanAmount or the schedule's
   *  opening balance (doc 007 finding #5). Defaults to 0 when omitted, and is ignored
   *  entirely for newMortgageOrLoan (always starts at 0 for that flow). */
  accruedInterest?: number;
  /** fixed-rate mortgages only -- display/reference anchor for the semi-annual
   *  compounding conversion (equation 1); does not change the conversion itself. */
  semiAnnualCompoundingDate?: Date;
}

export interface CobScheduleRow {
  /** 1-based, within this schedule only. */
  period: number;
  /** This row's payment date. */
  date: Date;
  /** Actual calendar days since the prior row's date (or since start_date for the
   *  first row) -- feeds period_interest (equation 3). */
  daysInPeriod: number;
  openingBalance: number;
  /** openingBalance x calculated_rate x (days_in_period / 365), split across a
   *  leap-year boundary if the period straddles one (equation 3). */
  periodInterest: number;
  /** Unrecovered accrued interest entering this row (0 once fully recovered, always
   *  0 for newMortgageOrLoan flows). */
  carriedAccruedInterestOpening: number;
  /** feesToRecover balance entering this row (financed fees only, spec 011). */
  feesOpening: number;
  /** The amount actually paid on this row (the input payment, except on a payoff
   *  row, where it is interestPaid + feesPaid + principalPortion -- spec 011 DQ-28). */
  paymentAmount: number;
  /** Portion of the payment applied to period_interest + carried accrued interest
   *  (waterfall step 1, equation 4). */
  interestPaid: number;
  /** Portion applied to feesOpening (waterfall step 2). */
  feesPaid: number;
  /** Remainder, applied to openingBalance, capped at openingBalance - feesOpening
   *  (waterfall step 3, spec 011 DQ-28). */
  principalPortion: number;
  carriedAccruedInterestClosing: number;
  feesClosing: number;
  closingBalance: number;
}

export interface CobCanadaResult {
  /** docx OUT-01 ("Semi-Annual Compounding Rate") -- the frequency-equivalent
   *  nominal rate equations 1/2 derive from contractRatePercent (e.g. 3.74% at m=2,
   *  n=52 -> 3.706781471105014%). Was computed and used internally (periodInterest,
   *  costOfBorrowingRatePercent's short-circuit) but not previously exposed here. */
  calculatedRatePercent: number;
  /** spec: cob_amount (equation 8) -- total_interest + all fees, unconditionally. */
  cobAmount: number;
  /** spec: cob_rate_percent -- this project's Canadian equivalent of APR
   *  (equation 7). A ratio, left unrounded per this project's rounding policy. */
  cobRatePercent: number;
  /** Total of all scheduled payments actually generated. */
  totalPayment: number;
  /** Total count of scheduled payments actually generated (bounded by end_date --
   *  see "Schedule generation"). */
  numberOfPayments: number;
  /** Sum of interest_paid across every row -- includes any recovered accrued
   *  interest, per equation 4. */
  totalInterest: number;
  /** Sum of principal_portion across every row. principal_payment ==
   *  total_payment - total_interest - fees_recovered (invariant #2). */
  principalPayment: number;
  /** Sum of fees_paid across every row -- new in this rewrite (invariant #2's
   *  three-bucket reconciliation). */
  feesRecovered: number;
  /** mortgage + variable-rate only; null for personal loans and fixed-rate
   *  mortgages (equation 6, invariant #1). A ratio, left unrounded. */
  triggerRatePercent: number | null;
  amortizationSchedule: CobScheduleRow[];
  /** spec: term_days -- computed the SAME way as T in the cob_rate_percent equation
   *  (start_date to final_payment_date, actual days) rather than derived
   *  independently from term_years/term_months (doc 007 finding #7). Unlike the
   *  prior model, this DOES feed a monetary output (cob_rate_percent's T), so it is
   *  no longer purely cosmetic. */
  termDays: number;
  /** loanAmount - fees.totalFinancedFees -- the actual cash advanced. Cash
   *  (non-financed) fees do NOT reduce disbursal (doc 007 finding #4). Still
   *  computed (for completeness) on renewal/paymentChange flows, though nothing is
   *  freshly disbursed there. */
  disbursalAmount: number;
  /** == loanAmount, always (doc 007 finding #4) -- financing a fee does not change
   *  this figure at all, it only changes how much of loanAmount is cash vs fee.
   *  Exposed for completeness/renewal-chaining convenience. */
  amortizedPrincipal: number;
  /** amortizationSchedule's last row's closingBalance -- commonly nonzero (the
   *  schedule may end before full payoff, doc 007 finding #2); what a follow-on
   *  renewal/paymentChange call would use as its loanAmount input. */
  endingBalance: number;
}
