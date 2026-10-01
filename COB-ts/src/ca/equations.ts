import { dayCountFraction } from './calendar.js';
import type { ProductType, RateType } from './types.js';
import { isFiniteNumber } from './types.js';

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
 * (equation 3) multiplies this directly against a dollar balance. Only the
 * SEMI-ANNUAL rate basis (fixed-rate mortgage, m = 2) is converted; the MONTHLY basis
 * uses the contract rate as entered (selectRateBasis below). When m==n this reduces
 * algebraically to contractRate/100, but not exactly in floating point.
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
 * The workbook's rate basis (Calculator!G10, list "MONTHLY,SEMI-ANNUAL"), which decides
 * the Calculated Rate cell (OQ-C, settled 2026-09-27 from the workbook):
 *   D10 = IF(RateType="MONTHLY", MonthlyRate, XLOOKUP(Freq, r_Freq, r_EquivalentRate))
 *   - Fixed-rate mortgage: SEMI-ANNUAL -- converted by equation 1 at m = 2
 *     (Interest Act s. 6).
 *   - Variable-rate mortgage and personal loan (either rate type): MONTHLY -- the
 *     contract rate itself, unconverted, at every payment frequency.
 *   A personal loan is Monthly only in the engine (B27, DEV-FB24), so for it this applies
 *   at n = 12; a variable mortgage still uses it at every frequency.
 */
export type RateBasis = 'MONTHLY' | 'SEMI-ANNUAL';

export function selectRateBasis(productType: ProductType, rateType: RateType): RateBasis {
  return productType === 'mortgage' && rateType === 'fixed' ? 'SEMI-ANNUAL' : 'MONTHLY';
}

/**
 * Equation 2 -- `m` (the compounding-periods-per-year parameter of equation 1) for the
 * product/rate type:
 *   - SEMI-ANNUAL basis (fixed-rate mortgage): m = 2.
 *   - MONTHLY basis (variable-rate mortgage, personal loan of either rate type):
 *     m = n (paymentsPerYear), i.e. no conversion. The engine does not evaluate
 *     equation 1 for this basis; it uses the contract rate directly so the result is
 *     exact (see calculatedRateFor).
 */
export function selectCompoundingPeriodsPerYear(
  productType: ProductType,
  rateType: RateType,
  paymentsPerYear: number,
): number {
  if (!(paymentsPerYear > 0)) {
    throw new RangeError(`paymentsPerYear must be > 0, got ${paymentsPerYear}`);
  }
  return selectRateBasis(productType, rateType) === 'SEMI-ANNUAL' ? 2 : paymentsPerYear;
}

/**
 * The Calculated Rate (workbook D10, app OUT-01) for a product/rate type and payment
 * frequency, as a percent and as the decimal fed to period interest (the macro's
 * getRate reads aRate = D10 / 100). MONTHLY basis: percent === contractRatePercent
 * exactly. SEMI-ANNUAL basis: equation 1 at m = 2.
 */
export function calculatedRateFor(
  productType: ProductType,
  rateType: RateType,
  contractRatePercent: number,
  paymentsPerYear: number,
): { percent: number; decimal: number } {
  if (!(contractRatePercent >= 0)) {
    throw new RangeError(`contractRatePercent must be >= 0, got ${contractRatePercent}`);
  }
  if (!(paymentsPerYear > 0)) {
    throw new RangeError(`paymentsPerYear must be > 0, got ${paymentsPerYear}`);
  }
  if (selectRateBasis(productType, rateType) === 'MONTHLY') {
    return { percent: contractRatePercent, decimal: contractRatePercent / 100 };
  }
  const m = selectCompoundingPeriodsPerYear(productType, rateType, paymentsPerYear);
  const decimal = calculatedRate(contractRatePercent, m, paymentsPerYear);
  return { percent: decimal * 100, decimal };
}

export { daysBetween, dayCountFraction } from './calendar.js';

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
  /** The row's Payment: `paymentAmount` itself unless the principal step was capped
   *  (a payoff row), then the remaining principal only -- the macro's
   *  `pymtAmnt = currPrinciple` (OQ-K / OQ-T). */
  amountPaid: number;
}

/**
 * Equation 4 -- payment allocation waterfall: interest (including carried accrued
 * interest), then fees, then principal (docx BR-13 / Appendix B.5, doc 007
 * finding #8). Pure function over one row's inputs, reused per schedule row by
 * cobCanada.ts's schedule generator -- kept independently testable rather than
 * inlined into the loop.
 *
 * `principalOutstanding` (= the row's openingBalance - feesOpening) caps the
 * principal step: principalPortion = min(paymentAmount - interestPaid - feesPaid,
 * max(principalOutstanding, 0)). The cap is never negative, as the macro's running
 * `currPrinciple` can't go negative (B11). On a payoff row (the cap applies) the row's
 * Payment is the remaining principal only, as in the workbook (OQ-K / OQ-T).
 */
export function applyPaymentWaterfall(
  periodInterestAmount: number,
  carriedAccruedInterestOpening: number,
  feesOpening: number,
  paymentAmount: number,
  principalOutstanding: number,
): PaymentWaterfallResult {
  if (!isFiniteNumber(periodInterestAmount)) {
    throw new RangeError(`periodInterestAmount must be a finite number, got ${String(periodInterestAmount)}`);
  }
  if (!(periodInterestAmount >= 0)) {
    throw new RangeError(`periodInterestAmount must be >= 0, got ${periodInterestAmount}`);
  }
  if (!isFiniteNumber(carriedAccruedInterestOpening)) {
    throw new RangeError(`carriedAccruedInterestOpening must be a finite number, got ${String(carriedAccruedInterestOpening)}`);
  }
  if (!(carriedAccruedInterestOpening >= 0)) {
    throw new RangeError(`carriedAccruedInterestOpening must be >= 0, got ${carriedAccruedInterestOpening}`);
  }
  if (!isFiniteNumber(feesOpening)) {
    throw new RangeError(`feesOpening must be a finite number, got ${String(feesOpening)}`);
  }
  if (!(feesOpening >= 0)) {
    throw new RangeError(`feesOpening must be >= 0, got ${feesOpening}`);
  }
  if (!isFiniteNumber(paymentAmount)) {
    throw new RangeError(`paymentAmount must be a finite number, got ${String(paymentAmount)}`);
  }
  if (!(paymentAmount >= 0)) {
    throw new RangeError(`paymentAmount must be >= 0, got ${paymentAmount}`);
  }
  if (!isFiniteNumber(principalOutstanding)) {
    throw new RangeError(`principalOutstanding must be a finite number, got ${String(principalOutstanding)}`);
  }

  const totalInterestDue = periodInterestAmount + carriedAccruedInterestOpening;
  const interestPaid = Math.min(paymentAmount, totalInterestDue);
  const carriedAccruedInterestClosing = totalInterestDue - interestPaid;

  const remainingAfterInterest = paymentAmount - interestPaid;
  const feesPaid = Math.min(remainingAfterInterest, feesOpening);
  const feesClosing = feesOpening - feesPaid;

  const remainingAfterFees = remainingAfterInterest - feesPaid;
  const principalCap = principalOutstanding > 0 ? principalOutstanding : 0;
  const isPayoff = principalCap < remainingAfterFees;
  const principalPortion = isPayoff ? principalCap : remainingAfterFees;
  const amountPaid = isPayoff ? principalPortion : paymentAmount;

  return {
    totalInterestDue,
    interestPaid,
    carriedAccruedInterestClosing,
    feesPaid,
    feesClosing,
    principalPortion,
    amountPaid,
  };
}

/**
 * Equation 6 -- trigger rate (mortgage + variable-rate only). CONFIRMED, unchanged by
 * doc 007 -- `loanAmount` here means the flow's CURRENT outstanding principal (the
 * original loanAmount for a newMortgageOrLoan flow; the current balance for
 * renewal/paymentChange/variableRatePaymentChange flows). Returned as a percent, left
 * unrounded (a ratio, per this project's rounding policy).
 */
export function triggerRatePercent(paymentAmount: number, paymentsPerYear: number, loanAmount: number): number {
  if (!isFiniteNumber(paymentAmount)) {
    throw new RangeError(`paymentAmount must be a finite number, got ${String(paymentAmount)}`);
  }
  if (!(paymentAmount >= 0)) {
    throw new RangeError(`paymentAmount must be >= 0, got ${paymentAmount}`);
  }
  if (!isFiniteNumber(paymentsPerYear)) {
    throw new RangeError(`paymentsPerYear must be a finite number, got ${String(paymentsPerYear)}`);
  }
  if (!(paymentsPerYear > 0)) {
    throw new RangeError(`paymentsPerYear must be > 0, got ${paymentsPerYear}`);
  }
  if (!isFiniteNumber(loanAmount)) {
    throw new RangeError(`loanAmount must be a finite number, got ${String(loanAmount)}`);
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
