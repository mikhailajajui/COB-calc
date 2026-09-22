import { round2 } from '../money.js';

/**
 * The 8 equations from docs/new-req/006-cost-of-borrowing-disclosure.md's
 * "## Equations" section, implemented exactly as specified (no re-derivation) -- each
 * function below is annotated with that equation's number and research status
 * (CONFIRMED / CORRECTED / BEST AVAILABLE) as given in the spec.
 */

/**
 * Equation 1 -- periodic rate from a semi-annually-compounded nominal rate (fixed-rate
 * mortgages only). CONFIRMED (Interest Act, R.S.C. 1985, c. I-15, s. 6): the "Canadian
 * mortgage constant" conversion --
 *   i_period = (1 + contractRate/2)^(2/paymentsPerYear) - 1
 * i.e. paymentsPerYear periodic compoundings must reproduce the same effective annual
 * rate as 2 semi-annual compoundings.
 */
export function periodicRateFromSemiAnnualNominal(
  contractRatePercent: number,
  paymentsPerYear: number,
): number {
  if (!(contractRatePercent >= 0)) {
    throw new RangeError(`contractRatePercent must be >= 0, got ${contractRatePercent}`);
  }
  if (!(paymentsPerYear > 0)) {
    throw new RangeError(`paymentsPerYear must be > 0, got ${paymentsPerYear}`);
  }
  const annualRate = contractRatePercent / 100;
  return Math.pow(1 + annualRate / 2, 2 / paymentsPerYear) - 1;
}

/**
 * Equation 2 -- periodic rate under the simple nominal/n convention (variable-rate
 * mortgages, all personal loans). BEST AVAILABLE, not authoritative -- real lenders
 * differ (see spec 006 equation 2 for the full per-lender sourcing); this is the
 * default used by this engine, and also the convention equation 4's trigger rate
 * annualization assumes.
 */
export function periodicRateFromNominalPerPeriod(
  contractRatePercent: number,
  paymentsPerYear: number,
): number {
  if (!(contractRatePercent >= 0)) {
    throw new RangeError(`contractRatePercent must be >= 0, got ${contractRatePercent}`);
  }
  if (!(paymentsPerYear > 0)) {
    throw new RangeError(`paymentsPerYear must be > 0, got ${paymentsPerYear}`);
  }
  return contractRatePercent / 100 / paymentsPerYear;
}

/**
 * Equation 4 -- trigger rate (mortgage + variable-rate only). CONFIRMED, with
 * `totalBorrowed` meaning the CURRENT outstanding principal balance (equal to
 * loanAmount at disbursal for a new mortgage, but not thereafter -- see Bank of Canada
 * Staff Analytical Note 2022-19). Annualizes via the same nominal/n convention as
 * equation 2 -- the only convention that actually applies to variable-rate mortgages.
 * Returned as a percent, left unrounded (a ratio, per this project's rounding policy).
 */
export function triggerRatePercent(
  paymentAmount: number,
  paymentsPerYear: number,
  totalBorrowed: number,
): number {
  if (!(paymentAmount > 0)) {
    throw new RangeError(`paymentAmount must be > 0, got ${paymentAmount}`);
  }
  if (!(paymentsPerYear > 0)) {
    throw new RangeError(`paymentsPerYear must be > 0, got ${paymentsPerYear}`);
  }
  if (!(totalBorrowed > 0)) {
    throw new RangeError(`totalBorrowed must be > 0, got ${totalBorrowed}`);
  }
  return ((paymentAmount * paymentsPerYear) / totalBorrowed) * 100;
}

/**
 * Equation 6 -- cost-of-borrowing rate ("APR"). CORRECTED from spec 002's IRR/
 * actuarial solve: Canadian regulation (Financial Consumer Protection Framework
 * Regulations, SOR/2021-181, s. 47(1)) prescribes an average-outstanding-balance
 * formula instead --
 *   APR = (C / (T x P)) x 100
 * C = the dollar cost of borrowing over the term (equation 7), T = the term expressed
 * in years (>= 2 decimal places per s.47(2)(a)), P = the average of the principal
 * outstanding at the end of each payment period, before subtracting the payment due at
 * that time (i.e. each period's beginning balance). Do NOT reuse spec 002's IRR
 * solver for this. Returned as a percent, left unrounded.
 */
export function cobRatePercent(
  costOfBorrowing: number,
  termYears: number,
  averagePrincipalOutstanding: number,
): number {
  if (!(costOfBorrowing >= 0)) {
    throw new RangeError(`costOfBorrowing must be >= 0, got ${costOfBorrowing}`);
  }
  if (!(termYears > 0)) {
    throw new RangeError(`termYears must be > 0, got ${termYears}`);
  }
  if (!(averagePrincipalOutstanding > 0)) {
    throw new RangeError(
      `averagePrincipalOutstanding must be > 0, got ${averagePrincipalOutstanding}`,
    );
  }
  return (costOfBorrowing / (termYears * averagePrincipalOutstanding)) * 100;
}

/**
 * Equation 7 -- cost-of-borrowing dollar amount. CONFIRMED shape --
 *   cob_amount = total_interest + total_fees_included_in_cob
 * `totalFeesIncludedInCob` must come from each Fee's `includedInCob` flag (Financial
 * Consumer Protection Framework Regulations s.48's regulatory inclusion/exclusion
 * list), NOT from `totalFinancedFees`/`totalCashFees` -- those answer a different
 * question (see src/ca/fees.ts).
 */
export function cobAmount(totalInterest: number, totalFeesIncludedInCob: number): number {
  if (!(totalInterest >= 0)) {
    throw new RangeError(`totalInterest must be >= 0, got ${totalInterest}`);
  }
  if (!(totalFeesIncludedInCob >= 0)) {
    throw new RangeError(`totalFeesIncludedInCob must be >= 0, got ${totalFeesIncludedInCob}`);
  }
  return round2(totalInterest + totalFeesIncludedInCob);
}

/**
 * Equation 8 -- term_days, a pure DISPLAY derivation never fed back into any monetary
 * calculation (invariant #4). Computed as the remainder, in days, after advancing
 * `termStartDate` by termYears/termMonths (whole years/months extracted) and comparing
 * against `endDate`.
 */
export function calculateTermDaysDisplay(
  termStartDate: Date,
  endDate: Date,
  termYears: number,
  termMonths: number,
): number {
  if (Number.isNaN(termStartDate.getTime()) || Number.isNaN(endDate.getTime())) {
    throw new RangeError('termStartDate/endDate must be valid Dates');
  }
  if (!(termYears >= 0) || !(termMonths >= 0)) {
    throw new RangeError(`termYears/termMonths must both be >= 0, got ${termYears}/${termMonths}`);
  }
  const wholeYearsMonthsDate = new Date(termStartDate);
  wholeYearsMonthsDate.setFullYear(wholeYearsMonthsDate.getFullYear() + termYears);
  wholeYearsMonthsDate.setMonth(wholeYearsMonthsDate.getMonth() + termMonths);
  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.round((endDate.getTime() - wholeYearsMonthsDate.getTime()) / msPerDay);
}

/**
 * Not one of the 8 numbered equations, but a small shared conversion equations 3/4/6
 * all need: turns a years+months length (contract term or remaining amortization)
 * into a total number of payments at the given payment frequency. Exact for monthly
 * frequency (whole months x 1); for non-monthly frequencies (biweekly/weekly/
 * semiMonthly) this rounds to the nearest whole payment, since months don't divide
 * evenly into 26/52/24 payments/year -- a judgment call with no regulatory guidance
 * (the spec's equations assume an integer payment count).
 */
export function totalPeriodsFromYearsMonths(
  years: number,
  months: number,
  paymentsPerYear: number,
): number {
  if (!(years >= 0) || !(months >= 0)) {
    throw new RangeError(`years/months must both be >= 0, got ${years}/${months}`);
  }
  if (!(paymentsPerYear > 0)) {
    throw new RangeError(`paymentsPerYear must be > 0, got ${paymentsPerYear}`);
  }
  const totalMonths = years * 12 + months;
  return Math.round((totalMonths / 12) * paymentsPerYear);
}
