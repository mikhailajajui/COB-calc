import { dayCountFraction, daysBetween, excelYearFracBasis1, paymentPeriodDays } from './calendar.js';
import type { PaymentFrequency, ProductType, RateType } from './types.js';
import { isFiniteNumber, PAYMENTS_PER_YEAR } from './types.js';

/**
 * The eight equations, implemented as specified -- each function below is annotated with
 * that equation's number. The numbering 1 to 8 is the archived spec's own labelling, kept
 * as the code's labels; the rules are stated in the BRD v2.3: equations 1 and 2 (rate
 * conversion, m) in BRD §4.2 and Appendix A; equation 3 (period interest, day count) in
 * §4.4 and B.3; equation 4 (waterfall) in B.5; equation 6 (trigger rate) in §4.3;
 * equations 7 and 8 (COB rate and amount) in §4.1 and B.7.
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
 * One exception (B38, DEC-B38-YEARFRAC-ROUND, DEV-B38-ROUND): roundToCentHalfAwayFromZero, which the
 * schedule applies to period interest only where roundsPeriodInterestToCent is true.
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
 * B39 (DEC-B39-VAR-PL-M12): the MONTHLY basis is also converted, at m = 12, at the 7/14-day frequencies when
 * convertsMonthlyRate is true (calculatedRateFor).
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
 *   A personal loan accepts every payment frequency (B33, DEC-B33-FREQ; B27's Monthly-only
 *   rule removed), so this applies at every n for it, as for a variable mortgage.
 *   B39 (DEC-B39-VAR-PL-M12): with MONTHLY_RATE_CONVERSION on, the MONTHLY basis at the 7/14-day frequencies is
 *   converted by equation 1 at m = 12 instead (convertsMonthlyRate); Monthly and Semi-monthly keep the contract rate.
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
 *     B39 (DEC-B39-VAR-PL-M12): where convertsMonthlyRate is true, calculatedRateFor uses m = 12 instead (not this function).
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

/** BRD §4.2 m = 12: the monthly compounding of the MONTHLY basis when it is converted (B39, DEC-B39-VAR-PL-M12). */
const MONTHLY_COMPOUNDING_PERIODS_PER_YEAR = 12;

/**
 * The Calculated Rate (workbook D10, app OUT-01) for a product/rate type and payment
 * frequency, as a percent and as the decimal fed to period interest (the macro's
 * getRate reads aRate = D10 / 100). MONTHLY basis: percent === contractRatePercent
 * exactly, or with `convertMonthly` (B39, DEC-B39-VAR-PL-M12; the caller passes convertsMonthlyRate) equation 1 at
 * BRD §4.2 m = 12. SEMI-ANNUAL basis: equation 1 at m = 2 (`convertMonthly` is ignored).
 * `paymentsPerYear` is n for equation 1: `PAYMENTS_PER_YEAR`, or for the 7/14-day frequencies with the B37 switch on,
 * `leapAwarePaymentsPerYear` (non-integer).
 */
export function calculatedRateFor(
  productType: ProductType,
  rateType: RateType,
  contractRatePercent: number,
  paymentsPerYear: number,
  convertMonthly: boolean = false,
): { percent: number; decimal: number } {
  if (!(contractRatePercent >= 0)) {
    throw new RangeError(`contractRatePercent must be >= 0, got ${contractRatePercent}`);
  }
  if (!(paymentsPerYear > 0)) {
    throw new RangeError(`paymentsPerYear must be > 0, got ${paymentsPerYear}`);
  }
  if (selectRateBasis(productType, rateType) === 'MONTHLY') {
    if (!convertMonthly) return { percent: contractRatePercent, decimal: contractRatePercent / 100 };
    const decimal = calculatedRate(contractRatePercent, MONTHLY_COMPOUNDING_PERIODS_PER_YEAR, paymentsPerYear);
    return { percent: decimal * 100, decimal };
  }
  const m = selectCompoundingPeriodsPerYear(productType, rateType, paymentsPerYear);
  const decimal = calculatedRate(contractRatePercent, m, paymentsPerYear);
  return { percent: decimal * 100, decimal };
}

/**
 * B37 (DEC-B37-LEAP-N): leap-aware payments per year for a day-based payment period, used as n in equation 1:
 *   n = (D / P) / Y
 * D = daysBetween(start, end) (actual days), P = periodDays (7 or 14), Y = dayCountFraction(start, end) (the same span in
 * years, days in a leap year counted /366, others /365), or with `yearFrac` (B38, DEC-B38-YEARFRAC-ROUND)
 * Y = excelYearFracBasis1(start, end). Evaluated in exactly this order. RangeError unless start < end and periodDays > 0.
 */
export function leapAwarePaymentsPerYear(periodDays: number, start: Date, end: Date, yearFrac: boolean = false): number {
  if (!(periodDays > 0)) {
    throw new RangeError(`periodDays must be > 0, got ${periodDays}`);
  }
  const days = daysBetween(start, end);
  if (!(days > 0)) {
    throw new RangeError('start must be before end');
  }
  return days / periodDays / (yearFrac ? excelYearFracBasis1(start, end) : dayCountFraction(start, end));
}

/**
 * B37 addendum (DEC-B37-LEAP-N answers, Q-B37-LABEL): THE choice of n for equation 1. calculateCobCanadaWith and the
 * public paymentsPerYearFor both call this, so the dropdown label and the calculation cannot drift. Never throws for
 * any date argument; RangeError only for an unknown frequency. In this order:
 *   1. base = PAYMENTS_PER_YEAR[paymentFrequency] (own key only; RangeError otherwise)
 *   2. leapAware false -> base
 *   3. paymentPeriodDays(paymentFrequency) null (Monthly, Semi-monthly) -> base
 *   4. selectRateBasis(productType, rateType) !== 'SEMI-ANNUAL' and not monthlyConversion -> base (B39,
 *      DEC-B39-VAR-PL-M12: with monthlyConversion the MONTHLY basis takes the leap path too)
 *   5. start or end not a valid Date, or daysBetween(start, end) <= 0 -> base
 *   6. leapAwarePaymentsPerYear(periodDays, start, end, yearFracRounded) (B38: Y is YEARFRAC when yearFracRounded)
 */
export function conversionPaymentsPerYear(
  productType: ProductType,
  rateType: RateType,
  paymentFrequency: PaymentFrequency,
  start: Date | undefined,
  end: Date | undefined,
  leapAware: boolean,
  yearFracRounded: boolean = false,
  monthlyConversion: boolean = false,
): number {
  const base = Object.hasOwn(PAYMENTS_PER_YEAR, paymentFrequency) ? PAYMENTS_PER_YEAR[paymentFrequency] : undefined;
  if (base === undefined) {
    throw new RangeError(`paymentFrequency must be one of ${Object.keys(PAYMENTS_PER_YEAR).join('/')}, got ${String(paymentFrequency)}`);
  }
  if (!leapPathApplies(productType, rateType, paymentFrequency, start, end, leapAware, monthlyConversion)) return base;
  return leapAwarePaymentsPerYear(paymentPeriodDays(paymentFrequency)!, start!, end!, yearFracRounded);
}

/** Steps 2 to 5 of conversionPaymentsPerYear: true when n takes the leap path (step 6). Shared with
 *  roundsPeriodInterestToCent (six arguments: SEMI-ANNUAL basis only) and convertsMonthlyRate (B39: monthlyConversion
 *  also admits the MONTHLY basis) so the rounding and conversion scopes cannot drift from the n scope. */
function leapPathApplies(
  productType: ProductType,
  rateType: RateType,
  paymentFrequency: PaymentFrequency,
  start: Date | undefined,
  end: Date | undefined,
  leapAware: boolean,
  monthlyConversion: boolean = false,
): boolean {
  if (!leapAware) return false;
  if (paymentPeriodDays(paymentFrequency) == null) return false;
  if (selectRateBasis(productType, rateType) !== 'SEMI-ANNUAL' && !monthlyConversion) return false;
  return isValidDate(start) && isValidDate(end) && daysBetween(start, end) > 0;
}

/**
 * B39 (DEC-B39-VAR-PL-M12) predicate M: the MONTHLY rate basis (variable-rate mortgage, personal loan of either rate
 * type) is converted by equation 1 at m = 12 exactly when monthlyConversion is true and n takes the leap path of
 * conversionPaymentsPerYear (7- or 14-day frequency, start < end, leapAware). Never throws. Disjoint from
 * roundsPeriodInterestToCent (SEMI-ANNUAL basis only).
 */
export function convertsMonthlyRate(
  productType: ProductType,
  rateType: RateType,
  paymentFrequency: PaymentFrequency,
  start: Date | undefined,
  end: Date | undefined,
  leapAware: boolean,
  monthlyConversion: boolean,
): boolean {
  return (
    monthlyConversion &&
    selectRateBasis(productType, rateType) === 'MONTHLY' &&
    leapPathApplies(productType, rateType, paymentFrequency, start, end, leapAware, true)
  );
}

/**
 * B38 (DEC-B38-YEARFRAC-ROUND) predicate S: each schedule row's period interest is rounded to the cent
 * (roundToCentHalfAwayFromZero) exactly when n takes the leap path of conversionPaymentsPerYear (fixed-rate mortgage,
 * 7- or 14-day frequency, start < end, leapAware) and yearFracRounded is true. Never for the MONTHLY basis (B39 keeps
 * full precision, DEV-B39-M12).
 */
export function roundsPeriodInterestToCent(
  productType: ProductType,
  rateType: RateType,
  paymentFrequency: PaymentFrequency,
  start: Date | undefined,
  end: Date | undefined,
  leapAware: boolean,
  yearFracRounded: boolean,
): boolean {
  return yearFracRounded && leapPathApplies(productType, rateType, paymentFrequency, start, end, leapAware);
}

/**
 * B38 (DEC-B38-YEARFRAC-ROUND, deviation DEV-B38-ROUND): Excel `ROUND(x, 2)`. The 15-significant-digit decimal nearest
 * |x| (toExponential(14)) is rounded to whole cents half away from zero in exact decimal arithmetic, then the sign is
 * restored. Exact for |x| < 1e12. Never returns -0. RangeError for a non-finite x.
 */
export function roundToCentHalfAwayFromZero(x: number): number {
  if (!Number.isFinite(x)) {
    throw new RangeError(`x must be a finite number, got ${x}`);
  }
  if (x === 0) return 0;
  const sign = x < 0 ? -1 : 1;
  const [mantissa, exponentText] = Math.abs(x).toExponential(14).split('e') as [string, string]; // fitness:cent-round
  const digits = mantissa.replace('.', ''); // 15 significant digits
  const shift = Number(exponentText) - 12; // cents = digits x 10^shift
  if (shift >= 0) return (sign * Number(digits + '0'.repeat(shift))) / 100;
  const keep = 15 + shift; // leading digits that are whole cents
  if (keep < 0) return 0;
  const wholeCents = keep === 0 ? 0 : Number(digits.slice(0, keep));
  const cents = wholeCents + (Number(digits.charAt(keep)) >= 5 ? 1 : 0);
  return cents === 0 ? 0 : (sign * cents) / 100;
}

function isValidDate(x: unknown): x is Date {
  return x instanceof Date && !Number.isNaN(x.getTime());
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
