export interface Segment {
  startDate: Date;
  annualInterestRatePercent: number;
  /** Manual payment override for this segment (payment change). If omitted, computed
   *  from balance + rate + amortizationMonthsRemaining via calculateMonthlyPayment.
   *  Not used (and not required) when interestOnly is set. */
  paymentAmount?: number;
  /** Amortization period (months) used to size the payment when paymentAmount is
   *  omitted. At least one of paymentAmount / amortizationMonthsRemaining is required,
   *  unless interestOnly is set. */
  amortizationMonthsRemaining?: number;
  /** How many payments this segment covers before the next segment (renewal/change)
   *  takes over. Required on every segment except the last, which runs to payoff —
   *  unless balloon is true, in which case it's required on the (balloon) last
   *  segment too. */
  termMonths?: number;
  /** Only valid on segments[0] — the original principal. Later segments inherit their
   *  starting balance from the previous segment's ending balance. */
  startingBalance?: number;
  /** Only valid on the last segment, together with termMonths — that segment stops
   *  after termMonths payments with a nonzero balance, reported as
   *  LoanSummary.balloonPaymentDue, instead of running to payoff. */
  balloon?: boolean;
  /** Payment = balance * monthly rate for every row; principal never moves. Requires
   *  termMonths (an interest-only segment never amortizes to zero on its own) —
   *  optionally combined with balloon: true, or followed by another segment. */
  interestOnly?: boolean;
}

export interface ManualPaymentOverride {
  /** 1-based payment number, global across the whole stitched schedule. */
  paymentNumber: number;
  paymentAmount?: number;
  interestPortion?: number;
  principalPortion?: number;
  /** If given, forces this row's ending balance directly; otherwise derived from
   *  balance - principalPortion as usual. */
  remainingBalance?: number;
  /** Free-text audit note, e.g. "bank fee adjustment" or "statement reconciliation". */
  reason?: string;
}

export interface LumpSumPayment {
  /** Global payment number of the last row of the segment this lump sum is applied
   *  after — must be exactly a segment/renewal boundary (v1 supports boundary-only
   *  lump sums, not mid-segment). */
  afterPaymentNumber: number;
  amount: number;
}

export interface RecurringCost {
  annualAmount: number;
  /** Annual % increase applied at each 12-payment anniversary. Escalation only — no
   *  cost decreases are modeled in v1. */
  annualIncreasePercent?: number;
}

export interface RecurringCosts {
  propertyTax?: RecurringCost;
  homeInsurance?: RecurringCost;
  hoa?: RecurringCost;
}

export interface PmiInput {
  annualRatePercent: number;
  propertyValue: number;
  /** LTV percent at/below which PMI is dropped. Defaults to 80. */
  dropAtLtvPercent?: number;
}

export interface CostBreakdownSummary {
  totalTaxPaid: number;
  totalInsurancePaid: number;
  totalHoaPaid: number;
  totalPmiPaid: number;
  /** totalOfPayments (P&I) + all of the above. */
  totalCostOfOwnership: number;
  /** First payment number where PMI dropped off; undefined if PMI was never active
   *  (starting LTV already at/under the drop threshold) or PMI wasn't configured. */
  pmiDroppedAtPaymentNumber?: number;
}

export interface MortgageInput {
  /** Chronological; segments[0] is the original mortgage origination. */
  segments: Segment[];
  manualOverrides?: ManualPaymentOverride[];
  lumpSumPayments?: LumpSumPayment[];
  recurringCosts?: RecurringCosts;
  pmi?: PmiInput;
}

export interface AmortizationEntry {
  /** Global, 1-based payment number across the whole stitched schedule. */
  paymentNumber: number;
  /** Index into MortgageInput.segments this row belongs to. */
  segmentIndex: number;
  paymentDate: Date;
  paymentAmount: number;
  interestPortion: number;
  principalPortion: number;
  remainingBalance: number;
  /** True if this row's values came from a ManualPaymentOverride. */
  isManualOverride: boolean;
  /** Recurring-cost/PMI portions, present only when MortgageInput.recurringCosts /
   *  .pmi are set — additive on top of P&I, applied by applyRecurringCosts(). */
  taxPortion?: number;
  insurancePortion?: number;
  hoaPortion?: number;
  pmiPortion?: number;
  /** Threaded through from ManualPaymentOverride.reason when this row came from an
   *  override that specified one. */
  overrideReason?: string;
}

export interface SegmentSummary {
  segmentIndex: number;
  monthlyPayment: number;
  startingBalance: number;
  endingBalance: number;
}

export interface LoanSummary {
  schedule: AmortizationEntry[];
  totalOfPayments: number;
  totalInterestPaid: number;
  numberOfPayments: number;
  payoffDate: Date;
  segmentSummaries: SegmentSummary[];
  /** Set when the last segment has balloon: true — the lump sum still owed when that
   *  segment's termMonths payments run out. */
  balloonPaymentDue?: { segmentIndex: number; amount: number; dueDate: Date };
  /** Set when MortgageInput.recurringCosts or .pmi are provided. totalOfPayments and
   *  totalInterestPaid above remain P&I-only regardless. */
  costBreakdown?: CostBreakdownSummary;
}

/** Convenience input for the simple single-rate, no-renewal case (mirrors the
 *  original calculator.net-style inputs). Internally converted to a one-segment
 *  MortgageInput via toSingleSegmentMortgage(). */
export interface LoanInput {
  loanAmount: number;
  annualInterestRatePercent: number;
  termYears: number;
  startDate?: Date;
}

export interface HomePriceLoanInput extends Omit<LoanInput, 'loanAmount'> {
  homePrice: number;
  downPayment: number;
}

export interface ExtraPaymentSavingsInput {
  loanAmount: number;
  annualInterestRatePercent: number;
  termMonths: number;
  extraMonthlyPayment: number;
  startDate?: Date;
}

export interface ExtraPaymentSavingsResult {
  originalMonths: number;
  newMonths: number;
  monthsSaved: number;
  originalTotalInterest: number;
  newTotalInterest: number;
  interestSaved: number;
}

/**
 * The engine is monthly-periodic (see src/segment.ts); every non-monthly frequency
 * here is modeled as a monthly-equivalent acceleration, not true calendar-day accrual
 * (7-day/14-day periods with their own interest accrual). That's a documented v1
 * simplification (docs/spec.md) — fine for "how much sooner would I pay off" borrower
 * estimates, not for a statement-accurate day-by-day schedule.
 *
 * There is no industry-recognized "accelerated" variant distinct from plain biweekly
 * or weekly — the acceleration is inherent to the calendar (26 biweekly / 52 weekly
 * periods per year don't divide evenly into 12 months), so no separate flag is
 * exposed. semiMonthly (24 payments/yr, paid on two fixed dates/month) is NOT
 * accelerated — 24 half-payments/yr equal exactly 12 monthly-equivalents.
 */
export type PaymentFrequency = 'monthly' | 'semiMonthly' | 'biweekly' | 'weekly';

export interface PaymentFrequencyScheduleInput {
  loanAmount: number;
  annualInterestRatePercent: number;
  termMonths: number;
  frequency: PaymentFrequency;
  startDate?: Date;
}

export interface PaymentFrequencyScheduleResult {
  frequency: PaymentFrequency;
  paymentsPerYear: number;
  monthlyPayment: number;
  /** The amount paid on each occurrence of the chosen frequency (e.g. every 2 weeks
   *  for 'biweekly'); equals monthlyPayment for 'monthly'. */
  periodPaymentAmount: number;
  effectiveExtraMonthlyPayment: number;
  originalMonths: number;
  newMonths: number;
  monthsSaved: number;
  originalTotalInterest: number;
  newTotalInterest: number;
  interestSaved: number;
}
