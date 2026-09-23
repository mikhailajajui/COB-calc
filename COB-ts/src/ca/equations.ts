import type { ProductType, RateType } from './types.js';

/**
 * The equations from docs/new-req/006-cost-of-borrowing-disclosure.md's "## Equations"
 * section (rewritten per doc 007's BRD reconciliation), implemented as specified --
 * each function below is annotated with that equation's number.
 *
 * Rounding note: unlike this project's general convention (round only final currency
 * amounts to cents), this module deliberately does NOT round intermediate or final
 * currency values. Doc 007's worked validation vector (pulled directly from the live
 * Alterna workbook's `data_only=True` cell values) is itself unrounded to 13+
 * significant digits at every row (e.g. payment #1's interest_portion =
 * 138.82433838712447), which means the source-of-truth workbook never applies a
 * ROUND() function anywhere in this calculation -- it carries full floating-point
 * precision throughout and only formats for display. Rounding each row to cents here
 * would diverge from that vector by more than floating-point noise, so this module
 * matches the workbook's actual (unrounded) behavior instead. This is a deliberate,
 * documented deviation from the repo-wide rounding convention, scoped to this engine.
 */

/**
 * Equation 1 -- frequency-equivalent nominal rate from a compounded contract rate,
 * general conversion formula (CONFIRMED, Interest Act R.S.C. 1985, c. I-15, s. 6 for
 * the m=2 case; docx Appendix A for the general shape):
 *   calculated_rate = n x [(1 + contract_rate/m)^(m/n) - 1]
 * Returned as a DECIMAL (e.g. 0.03706781471105014), not a percent -- period_interest
 * (equation 3) multiplies this directly against a dollar balance. `m` is selected by
 * product/rate type (equation 2 / selectCompoundingPeriodsPerYear below); when m==n
 * this reduces to contractRate/100 exactly (the algebraic basis for the variable-rate
 * mortgage's "no conversion" case).
 */
export function calculatedRate(
  contractRatePercent: number,
  compoundingPeriodsPerYear: number,
  paymentsPerYear: number,
): number {
  if (!(contractRatePercent >= 0)) {
    throw new RangeError(`contractRatePercent must be >= 0, got ${contractRatePercent}`);
  }
  if (!(compoundingPeriodsPerYear > 0)) {
    throw new RangeError(`compoundingPeriodsPerYear must be > 0, got ${compoundingPeriodsPerYear}`);
  }
  if (!(paymentsPerYear > 0)) {
    throw new RangeError(`paymentsPerYear must be > 0, got ${paymentsPerYear}`);
  }
  const annualRate = contractRatePercent / 100;
  return (
    paymentsPerYear *
    (Math.pow(1 + annualRate / compoundingPeriodsPerYear, compoundingPeriodsPerYear / paymentsPerYear) - 1)
  );
}

/**
 * Equation 2 -- selecting `m` (the compounding-periods-per-year parameter equation 1
 * needs) by product/rate type (docx section 4.2's explicit three-case table, doc 007
 * finding #10):
 *   - Fixed-rate mortgage: m = 2 (semi-annual) -- CONFIRMED, Interest Act s. 6.
 *   - Variable-rate mortgage: m = n (paymentsPerYear) -- reduces equation 1 to
 *     calculated_rate = contract_rate exactly (no conversion). This-BRD-specific
 *     convention, not a claim about Canadian lending generally.
 *   - Personal loan (either rate type): m = 12 -- applied via the SAME equation-1
 *     formula, not a flat contract_rate/n. Reduces to contract_rate/12 exactly when
 *     paymentFrequency is itself monthly (m=12, n=12).
 */
export function selectCompoundingPeriodsPerYear(
  productType: ProductType,
  rateType: RateType,
  paymentsPerYear: number,
): number {
  if (!(paymentsPerYear > 0)) {
    throw new RangeError(`paymentsPerYear must be > 0, got ${paymentsPerYear}`);
  }
  if (productType === 'mortgage') {
    return rateType === 'fixed' ? 2 : paymentsPerYear;
  }
  // personalLoan, either rate type.
  return 12;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/** UTC-midnight timestamp for a Date's calendar-date components. Extracted via UTC
 *  getters (not local getters) because this module's Dates are constructed from
 *  'YYYY-MM-DD'-style ISO strings, which parse to UTC midnight -- using local getters
 *  would silently shift the calendar date by a day in any timezone west of UTC (e.g.
 *  this repo's own dev/CI environment, America/Toronto). All date arithmetic in this
 *  module stays in UTC space for exactly this reason. */
function utcDateOnly(date: Date): number {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

/**
 * Actual calendar days between two dates (no leap-year splitting -- a plain integer
 * day count). Feeds ScheduleRow.days_in_period and term_days.
 */
export function daysBetween(start: Date, end: Date): number {
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw new RangeError('start/end must be valid Dates');
  }
  return Math.round((utcDateOnly(end) - utcDateOnly(start)) / MS_PER_DAY);
}

/**
 * Equation 3's day-count-fraction step -- docx section 4.4 / Appendix B.3: the actual
 * number of calendar days in [start, end), divided by 365, EXCEPT that any days
 * falling in a leap calendar year are divided by 366 instead, with the (possibly
 * several) partial results summed. This is additive across contiguous sub-ranges --
 * calling it once over a whole span gives the same result as summing it over each
 * row-length sub-period of that span (verified against doc 007's worked vector; see
 * cobCanada.ts's cob_rate_percent T for where this additivity is relied on).
 */
export function dayCountFraction(start: Date, end: Date): number {
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw new RangeError('start/end must be valid Dates');
  }
  const endUtc = utcDateOnly(end);
  let cursor = utcDateOnly(start);
  if (cursor > endUtc) {
    throw new RangeError('start must be on or before end');
  }
  let fraction = 0;
  while (cursor < endUtc) {
    const year = new Date(cursor).getUTCFullYear();
    const nextYearStart = Date.UTC(year + 1, 0, 1);
    const segmentEnd = Math.min(nextYearStart, endUtc);
    const daysInSegment = Math.round((segmentEnd - cursor) / MS_PER_DAY);
    const daysInYear = isLeapYear(year) ? 366 : 365;
    fraction += daysInSegment / daysInYear;
    cursor = segmentEnd;
  }
  return fraction;
}

/**
 * Equation 3 -- period interest, day-count proration:
 *   period_interest = opening_balance x calculated_rate x (days_in_period / 365)
 * with the leap-year split folded into dayCountFraction above (this is the "second,
 * independent step applied on top of" calculated_rate the spec describes -- never
 * folded into a single fixed periodic rate).
 */
export function periodInterest(
  openingBalance: number,
  calculatedRateDecimal: number,
  periodStart: Date,
  periodEnd: Date,
): number {
  if (!(openingBalance >= 0)) {
    throw new RangeError(`openingBalance must be >= 0, got ${openingBalance}`);
  }
  if (!(calculatedRateDecimal >= 0)) {
    throw new RangeError(`calculatedRateDecimal must be >= 0, got ${calculatedRateDecimal}`);
  }
  return openingBalance * calculatedRateDecimal * dayCountFraction(periodStart, periodEnd);
}

export interface PaymentWaterfallResult {
  totalInterestDue: number;
  interestPaid: number;
  carriedAccruedInterestClosing: number;
  feesPaid: number;
  feesClosing: number;
  principalPortion: number;
}

/**
 * Equation 4 -- payment allocation waterfall: interest (including carried accrued
 * interest), then fees, then principal (docx BR-13 / Appendix B.5, doc 007
 * finding #8). Pure function over one row's inputs, reused per schedule row by
 * cobCanada.ts's schedule generator -- kept independently testable rather than
 * inlined into the loop.
 */
export function applyPaymentWaterfall(
  periodInterestAmount: number,
  carriedAccruedInterestOpening: number,
  feesOpening: number,
  paymentAmount: number,
): PaymentWaterfallResult {
  if (!(periodInterestAmount >= 0)) {
    throw new RangeError(`periodInterestAmount must be >= 0, got ${periodInterestAmount}`);
  }
  if (!(carriedAccruedInterestOpening >= 0)) {
    throw new RangeError(`carriedAccruedInterestOpening must be >= 0, got ${carriedAccruedInterestOpening}`);
  }
  if (!(feesOpening >= 0)) {
    throw new RangeError(`feesOpening must be >= 0, got ${feesOpening}`);
  }
  if (!(paymentAmount > 0)) {
    throw new RangeError(`paymentAmount must be > 0, got ${paymentAmount}`);
  }

  const totalInterestDue = periodInterestAmount + carriedAccruedInterestOpening;
  const interestPaid = Math.min(paymentAmount, totalInterestDue);
  const carriedAccruedInterestClosing = totalInterestDue - interestPaid;

  const remainingAfterInterest = paymentAmount - interestPaid;
  const feesPaid = Math.min(remainingAfterInterest, feesOpening);
  const feesClosing = feesOpening - feesPaid;

  const principalPortion = remainingAfterInterest - feesPaid;

  return { totalInterestDue, interestPaid, carriedAccruedInterestClosing, feesPaid, feesClosing, principalPortion };
}

/**
 * Equation 6 -- trigger rate (mortgage + variable-rate only). CONFIRMED, unchanged by
 * doc 007 -- `loanAmount` here means the flow's CURRENT outstanding principal (the
 * original loanAmount for a newMortgageOrLoan flow; the current balance for
 * renewal/paymentChange/variableRatePaymentChange flows). Returned as a percent, left
 * unrounded (a ratio, per this project's rounding policy).
 */
export function triggerRatePercent(paymentAmount: number, paymentsPerYear: number, loanAmount: number): number {
  if (!(paymentAmount > 0)) {
    throw new RangeError(`paymentAmount must be > 0, got ${paymentAmount}`);
  }
  if (!(paymentsPerYear > 0)) {
    throw new RangeError(`paymentsPerYear must be > 0, got ${paymentsPerYear}`);
  }
  if (!(loanAmount > 0)) {
    throw new RangeError(`loanAmount must be > 0, got ${loanAmount}`);
  }
  return ((paymentAmount * paymentsPerYear) / loanAmount) * 100;
}

/**
 * Equation 7's GENERAL branch (fees > 0) -- cost-of-borrowing rate ("APR"). CONFIRMED
 * shape (Financial Consumer Protection Framework Regulations, SOR/2021-181,
 * ss. 47-48), VBA-confirmed via doc 007's "Addendum: VBA macro source review":
 *   cob_rate_percent = (C / (T x P)) x 100
 * C = cob_amount (equation 8), T = the term in years as a PLAIN (non-leap-adjusted)
 * days/365 divide, P = the SIMPLE (unweighted) average of each row's opening
 * balance. Both T and P are computed by the caller (cobCanada.ts). This function
 * implements only the general branch -- callers must apply the fees===0
 * short-circuit themselves (see costOfBorrowingRatePercent below), since no T/P
 * choice reproduces the short-circuit's result from this formula as an identity
 * (confirmed numerically against the real workbook's per-row balances -- see doc
 * 007's addendum). Returned as a percent, left unrounded.
 */
export function cobRatePercent(costOfBorrowing: number, termYears: number, averagePrincipalOutstanding: number): number {
  if (!(costOfBorrowing >= 0)) {
    throw new RangeError(`costOfBorrowing must be >= 0, got ${costOfBorrowing}`);
  }
  if (!(termYears > 0)) {
    throw new RangeError(`termYears must be > 0, got ${termYears}`);
  }
  if (!(averagePrincipalOutstanding > 0)) {
    throw new RangeError(`averagePrincipalOutstanding must be > 0, got ${averagePrincipalOutstanding}`);
  }
  return (costOfBorrowing / (termYears * averagePrincipalOutstanding)) * 100;
}

/**
 * Equation 7 (FULL) -- cost-of-borrowing rate, including the fees===0 short-circuit.
 * VBA-confirmed, doc 007's "Addendum: VBA macro source review" (the live macro's
 * literal `getRate`/`COBRate` code):
 *   if fees.total_financed_fees + fees.total_cash_fees == 0:
 *       cob_rate_percent = calculated_rate x 100   -- SHORT-CIRCUIT, no T/P involved
 *   else:
 *       cob_rate_percent = (cob_amount / (T x P)) x 100
 * This is a hard branch, not an approximation or a reverse-engineered T/P choice --
 * sourced from FCPFR s.32 ("the APR ... is the annual interest rate if the only cost
 * of borrowing is interest"), the same shape as this project's existing `apr.py`
 * (spec 002) `if total_cash_fees == 0: apr_percent = note_rate` convention. Delegates
 * to cobRatePercent (the general branch) rather than re-deriving it inline.
 */
export function costOfBorrowingRatePercent(
  calculatedRateDecimal: number,
  totalFinancedFees: number,
  totalCashFees: number,
  costOfBorrowing: number,
  termYears: number,
  averagePrincipalOutstanding: number,
): number {
  if (!(calculatedRateDecimal >= 0)) {
    throw new RangeError(`calculatedRateDecimal must be >= 0, got ${calculatedRateDecimal}`);
  }
  if (!(totalFinancedFees >= 0)) {
    throw new RangeError(`totalFinancedFees must be >= 0, got ${totalFinancedFees}`);
  }
  if (!(totalCashFees >= 0)) {
    throw new RangeError(`totalCashFees must be >= 0, got ${totalCashFees}`);
  }
  if (totalFinancedFees + totalCashFees === 0) {
    return calculatedRateDecimal * 100;
  }
  return cobRatePercent(costOfBorrowing, termYears, averagePrincipalOutstanding);
}

/**
 * Equation 8 -- cost-of-borrowing dollar amount. CORRECTED (doc 007 finding #6) --
 * drops the prior draft's FCPFR inclusion/exclusion filtering entirely:
 *   cob_amount = total_interest + fees.total_financed_fees + fees.total_cash_fees
 * All fees, unconditionally -- this engine never reads Fee.includedInCob.
 */
export function cobAmount(totalInterest: number, totalFinancedFees: number, totalCashFees: number): number {
  if (!(totalInterest >= 0)) {
    throw new RangeError(`totalInterest must be >= 0, got ${totalInterest}`);
  }
  if (!(totalFinancedFees >= 0)) {
    throw new RangeError(`totalFinancedFees must be >= 0, got ${totalFinancedFees}`);
  }
  if (!(totalCashFees >= 0)) {
    throw new RangeError(`totalCashFees must be >= 0, got ${totalCashFees}`);
  }
  return totalInterest + totalFinancedFees + totalCashFees;
}
