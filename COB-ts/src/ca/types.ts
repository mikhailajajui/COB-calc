/**
 * Canadian Cost of Borrowing (COB) disclosure engine, per the BRD v2.3
 * (COB-business-requirement.md; input fields §3.1) and the four flows of use cases UC-01
 * to UC-04 (COB-user-stories.md), reconciled against the real Alterna Savings
 * workbook. This module is standalone: no integration with other systems.
 */

/**
 * The four dropdown-driven flows from BRD §3.1 (docx
 * IN-01, collapsed from an earlier six-value draft -- product
 * type, IN-03, is already a separate, orthogonal dropdown that applies identically
 * across all four). Determines which date field is required (disbursal vs renewal),
 * whether accrued interest carries forward, and (jointly with productType/rateType)
 * whether a trigger rate is computed.
 */
export type CobFlow = 'newMortgageOrLoan' | 'renewal' | 'paymentChange' | 'variableRatePaymentChange';

export type ProductType = 'mortgage' | 'personalLoan';
export type RateType = 'variable' | 'fixed';

/** Payment frequency -- the same literal union as the US library's PaymentFrequency
 *  (src/types.ts), declared here so src/ca imports nothing outside src/ca (ADR-05). */
export type PaymentFrequency =
  | 'monthly'
  | 'semiMonthly'
  | 'biweekly'
  | 'weekly'
  | 'acceleratedBiweekly'
  | 'acceleratedWeekly';

/** Payments/year per payment frequency -- standard counts (12/24/26/52), used
 *  throughout equations 1-8. Per BR-09, Accelerated Weekly has the same n as Weekly (52)
 *  and Accelerated Bi-weekly the same n as Bi-weekly (26). */
export const PAYMENTS_PER_YEAR: Record<PaymentFrequency, number> = {
  monthly: 12,
  semiMonthly: 24,
  biweekly: 26,
  weekly: 52,
  acceleratedBiweekly: 26,
  acceleratedWeekly: 52,
};

/** True only for a primitive number that is finite (not NaN / +-Infinity). No
 *  coercion: numeric strings, booleans, arrays and null are all false (012 D-11). */
export function isFiniteNumber(x: unknown): x is number {
  return typeof x === 'number' && Number.isFinite(x);
}

/**
 * Loan fees, itemized: name, amount and `financed` (a financed fee is already inside
 * loan_amount; a non-financed fee is paid in cash; BRD §6 fee limit, B10).
 *
 * Carries a second, optional per-fee `includedInCob` flag. It does not decide what counts toward
 * cobAmount: under OQ-E every fee, financed or not, is counted in full.
 *
 * `includedInCob` is optional. If present it must be a boolean (validateFee in
 * fees.ts); the engine never reads its value, and C counts every fee in full
 * (OQ-E, macro line 562; B10, user 2026-09-29).
 */
export interface Fee {
  name: string;
  amount: number;
  /** true: already inside loanAmount (reduces disbursal) and recovered through the
   *  payment waterfall. false: paid separately by the member -- never reduces
   *  disbursal, never enters principal or the waterfall, counted only in cobAmount
   *  (BRD IN-07 / BR-04, spec 011). */
  financed: boolean;
  /** Optional; if present it must be a boolean. Never read by the engine: every
   *  fee counts toward cobAmount (OQ-E; B10). */
  includedInCob?: boolean;
}

export interface FeeSchedule {
  fees: Fee[];
}

/** Fields every flow takes. */
export interface CobInputCommon {
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

  /** @deprecated Never read and never validated (DEV-OQP). The contract term is derived
   *  from the schedule: see `contractTerm(input, result)`. */
  termYears?: number;
  /** @deprecated Never read and never validated (DEV-OQP). The contract term is derived
   *  from the schedule: see `contractTerm(input, result)`. */
  termMonths?: number;

  /** fixed-rate mortgages only -- display/reference anchor for the semi-annual
   *  compounding conversion (equation 1); does not change the conversion itself.
   *  Not a BRD input. Required only while `SEMI_ANNUAL_DATE_REQUIRED` is on (`Q-SACD`). */
  semiAnnualCompoundingDate?: Date;
}

export interface NewLoanInput extends CobInputCommon {
  flow: 'newMortgageOrLoan';
  /** newMortgageOrLoan ONLY -- start of interest accrual and this flow's start_date
   *  for the cob_rate_percent equation's T. */
  disbursalDate: Date;
  /** Not taken by this flow; a JS caller's value is ignored. */
  renewalDate?: undefined;
  /** Not taken by this flow (FLOWS.newMortgageOrLoan.accruedInterest = 'hidden'). */
  accruedInterest?: undefined;
}

export interface ExistingLoanInput extends CobInputCommon {
  flow: 'renewal' | 'paymentChange' | 'variableRatePaymentChange';
  /** renewal / paymentChange / variableRatePaymentChange ONLY -- this flow's
   *  start_date, same role as disbursalDate for a new flow. The field name is kept
   *  for all three flows; each flow's screen label comes from flows.ts (`@pending OQ-A`). */
  renewalDate: Date;
  /** Not taken by these flows; a JS caller's value is ignored. */
  disbursalDate?: undefined;
  /** renewal/paymentChange/variableRatePaymentChange flows: interest accrued since
   *  the last payment, carried into this calculation as the schedule's initial
   *  carriedAccruedInterest (equation 4) -- NOT added to loanAmount or the schedule's
   *  opening balance (doc 007 finding #5). Required since B20 (decision 4):
   *  omitting it throws; 0 is valid. A newMortgageOrLoan input declares it
   *  `?: undefined` (NewLoanInput); the engine starts that flow at 0. */
  accruedInterest: number;
}

export type CobCanadaInput = NewLoanInput | ExistingLoanInput;

/** A calendar span as whole years, months and leftover days (all non-negative integers). */
export interface ContractTerm {
  years: number;
  months: number;
  days: number;
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
  /** Unpaid interest entering this row: the bucket of all unpaid interest (IN-11 and
   *  period shortfalls), outside openingBalance and earning nothing (DEV-OQL). In the
   *  workbook branch (UNPAID_INTEREST_CAPITALISED true) it is either unpaid period
   *  interest, which is inside openingBalance (OQ-L), or, while any is outstanding,
   *  IN-11 past accrued interest, which is not (OQ-W interim). */
  carriedAccruedInterestOpening: number;
  /** feesToRecover balance entering this row (financed fees only, spec 011). */
  feesOpening: number;
  /** The row's Payment: the input payment, except on a payoff row, where it is the
   *  remaining principal only (principalPortion), as in the workbook (OQ-K / OQ-T). */
  paymentAmount: number;
  /** Portion of the payment applied to period_interest + carried accrued interest
   *  (waterfall step 1, equation 4). */
  interestPaid: number;
  /** Portion applied to feesOpening (waterfall step 2). */
  feesPaid: number;
  /** Remainder, applied to openingBalance, capped at openingBalance - feesOpening
   *  (waterfall step 3). */
  principalPortion: number;
  /** Unpaid interest leaving this row; same two sources as carriedAccruedInterestOpening. */
  carriedAccruedInterestClosing: number;
  feesClosing: number;
  /** The Loan balance: principal + unrecovered financed fees; unpaid interest is not in
   *  it (DEV-OQL). Workbook branch (UNPAID_INTEREST_CAPITALISED true): also unpaid period
   *  interest (OQ-L; CalculateAll `newBalance = newFees + newPrinciple + intAccrued -
   *  totalInterestPaid`); IN-11 is never included. */
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
  /** Interest charged over the term (DEV-OQL; CalculateAll `TOTALINTERESTCELL =
   *  intAccrued`): period interest as charged (sum of interest_paid plus the period
   *  interest still unpaid after the last row) plus IN-11 as far as it is paid (W2). */
  totalInterest: number;
  /** Sum of principal_portion across every row. principal_payment ==
   *  total_payment - sum(interest_paid) - fees_recovered (invariant #2). */
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
