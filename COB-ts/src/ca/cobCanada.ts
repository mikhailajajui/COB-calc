import type { PaymentFrequency } from '../types.js';
import { totalCashFees, totalFinancedFees } from './fees.js';
import {
  applyPaymentWaterfall,
  calculatedRate,
  cobAmount as cobAmountEquation,
  costOfBorrowingRatePercent,
  dayCountFraction,
  daysBetween,
  selectCompoundingPeriodsPerYear,
  triggerRatePercent as triggerRatePercentEquation,
} from './equations.js';
import type { CobCanadaInput, CobCanadaResult, CobScheduleRow } from './types.js';
import { PAYMENTS_PER_YEAR } from './types.js';
import { validateCobCanadaInput } from './validate.js';

/**
 * Trigger rate is computed whenever product = mortgage and rate = variable,
 * regardless of which of the four flows is in play (spec 006's "Presentation layer"
 * table: newMortgageOrLoan/renewal/paymentChange all say "Yes, if product = mortgage
 * and rate type = variable"; variableRatePaymentChange says "Yes, always" but that
 * flow is validated to be mortgage+variable-only by construction -- see validate.ts --
 * so the condition collapses to this single productType/rateType check for every flow).
 */
function flowComputesTriggerRate(input: CobCanadaInput): boolean {
  return input.productType === 'mortgage' && input.rateType === 'variable';
}

/** UTC-safe day/month stepping -- see equations.ts's utcDateOnly doc comment for why
 *  this module avoids local-timezone Date getters/setters entirely. */
function addUtcDays(date: Date, days: number): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + days));
}

function addUtcMonths(date: Date, months: number): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, date.getUTCDate()));
}

/** periodDate for period index i (0-based) at the given payment frequency.
 *  "Accelerated Weekly" (BR-09) is treated identically to plain Weekly, so there is no
 *  separate case. semiMonthly is evenly spaced, same approximation used elsewhere in
 *  this codebase (paymentFrequency.ts) for the "1st & 15th" convention some lenders
 *  use. */
function periodDateFor(frequency: PaymentFrequency, firstPaymentDate: Date, index: number): Date {
  switch (frequency) {
    case 'monthly':
      return addUtcMonths(firstPaymentDate, index);
    case 'weekly':
      return addUtcDays(firstPaymentDate, index * 7);
    case 'biweekly':
      return addUtcDays(firstPaymentDate, index * 14);
    case 'semiMonthly':
      return addUtcDays(firstPaymentDate, Math.round((index * 365.25) / 24));
  }
}

/** A generous safety cap against a misconfigured schedule that never reaches
 *  end_date (the date-based stop condition below is otherwise self-terminating by
 *  construction, since periodDateFor is strictly increasing) -- not expected to ever
 *  trigger for real input, purely defensive. */
const MAX_SCHEDULE_ROWS_SAFETY_CAP = 20000;

interface BuildScheduleArgs {
  loanAmount: number;
  calculatedRateDecimal: number;
  paymentAmount: number;
  startDate: Date;
  firstPaymentDate: Date;
  endDate: Date;
  frequency: PaymentFrequency;
  initialCarriedAccruedInterest: number;
  initialFeesToRecover: number;
}

/**
 * Equation 5 -- schedule generation / stop condition (doc 007 finding #2, boundary
 * corrected against the live macro source -- see doc 007's "Addendum: VBA macro
 * source review"). One row per payment_frequency period starting at
 * first_payment_date, running equations 3-4 each row, stopping BEFORE generating the
 * first candidate row whose date is STRICTLY AFTER end_date -- a row landing exactly
 * ON end_date IS generated (inclusive, not exclusive; matches the real macro's
 * `DateDiff("d", endDate, candidateDate) > 0` exit check) -- or right after the row
 * whose closing_balance reaches zero, whichever comes first. Verified against doc
 * 007's worked vector: first_payment_date 2026-03-23, weekly, end_date 2029-03-17
 * generates exactly 156 rows, the last dated 2029-03-12 (row 157 would fall on
 * 2029-03-19, strictly after end_date, so it is never generated) -- there is no
 * amortization-horizon input anywhere in this engine.
 */
function buildSchedule(args: BuildScheduleArgs): CobScheduleRow[] {
  const {
    loanAmount,
    calculatedRateDecimal,
    paymentAmount,
    startDate,
    firstPaymentDate,
    endDate,
    frequency,
    initialCarriedAccruedInterest,
    initialFeesToRecover,
  } = args;

  const rows: CobScheduleRow[] = [];
  let openingBalance = loanAmount;
  let carriedAccruedInterest = initialCarriedAccruedInterest;
  let feesToRecover = initialFeesToRecover;
  let priorDate = startDate;

  for (let index = 0; index < MAX_SCHEDULE_ROWS_SAFETY_CAP; index += 1) {
    const rowDate = periodDateFor(frequency, firstPaymentDate, index);
    if (rowDate.getTime() > endDate.getTime()) {
      break;
    }

    const daysInPeriod = daysBetween(priorDate, rowDate);
    const periodInterestAmount = openingBalance * calculatedRateDecimal * dayCountFraction(priorDate, rowDate);

    const waterfall = applyPaymentWaterfall(
      periodInterestAmount,
      carriedAccruedInterest,
      feesToRecover,
      paymentAmount,
      openingBalance - feesToRecover,
    );
    // Spec 011 D9/D8 (DEV-011-2): financed fees are inside openingBalance, so the fees
    // paid reduce it as well as the principal paid.
    const closingBalance = openingBalance - waterfall.feesPaid - waterfall.principalPortion;

    rows.push({
      period: index + 1,
      date: rowDate,
      daysInPeriod,
      openingBalance,
      periodInterest: periodInterestAmount,
      carriedAccruedInterestOpening: carriedAccruedInterest,
      feesOpening: feesToRecover,
      paymentAmount: waterfall.amountPaid,
      interestPaid: waterfall.interestPaid,
      feesPaid: waterfall.feesPaid,
      principalPortion: waterfall.principalPortion,
      carriedAccruedInterestClosing: waterfall.carriedAccruedInterestClosing,
      feesClosing: waterfall.feesClosing,
      closingBalance,
    });

    openingBalance = closingBalance;
    carriedAccruedInterest = waterfall.carriedAccruedInterestClosing;
    feesToRecover = waterfall.feesClosing;
    priorDate = rowDate;

    if (closingBalance <= 0) {
      break;
    }
  }

  return rows;
}

/**
 * Equation 7's P (general branch only) -- the SIMPLE (unweighted) average of each
 * row's opening balance. VBA-confirmed (doc 007's "Addendum: VBA macro source
 * review"): the macro's own `avgOpeningPrinciple = totalOpeningPrinciple /
 * pymtCount`, matching the spec's prose ("the average of the opening balances
 * across all payments") and docx Appendix B.7 exactly -- an earlier version of this
 * module weighted this average by each row's day-count fraction to
 * reverse-engineer a match against doc 007's worked vector, but that vector's
 * cob_rate_percent is produced by equation 7's fees===0 SHORT-CIRCUIT
 * (costOfBorrowingRatePercent below), not by this formula at all, so no such
 * weighting was ever needed or correct.
 */
function averageOutstandingBalance(rows: CobScheduleRow[]): number {
  return rows.reduce((sum, row) => sum + row.openingBalance, 0) / rows.length;
}

/**
 * Implements docs/new-req/006-cost-of-borrowing-disclosure.md end to end (rewritten
 * per doc 007's BRD reconciliation): a user-entered payment_amount (never solved),
 * day-count-prorated interest accrual, the interest -> fees -> principal payment
 * waterfall, financed fees already inside loan_amount, and the trigger rate / COB
 * rate outputs.
 */
export function calculateCobCanada(input: CobCanadaInput): CobCanadaResult {
  validateCobCanadaInput(input);

  const paymentsPerYear = PAYMENTS_PER_YEAR[input.paymentFrequency];

  const financedFees = totalFinancedFees(input.fees);
  const cashFees = totalCashFees(input.fees);

  // "Financed fees" (resolved, doc 007 finding #4): loan_amount is ALREADY
  // inclusive of financed fees -- amortized_principal is simply loan_amount, and
  // disbursal_amount only subtracts financed fees (cash fees never touch disbursal).
  const amortizedPrincipal = input.loanAmount;
  const disbursalAmount = input.loanAmount - financedFees;

  // Equations 1/2 -- m selected by product/rate type, then the frequency-equivalent
  // nominal rate (a decimal).
  const compoundingPeriodsPerYear = selectCompoundingPeriodsPerYear(
    input.productType,
    input.rateType,
    paymentsPerYear,
  );
  const calculatedRateDecimal = calculatedRate(input.contractRatePercent, compoundingPeriodsPerYear, paymentsPerYear);

  const startDate = input.flow === 'newMortgageOrLoan' ? input.disbursalDate! : input.renewalDate!;
  // carried_accrued_interest starts at the input accrued_interest for
  // renewal/paymentChange/variableRatePaymentChange flows, 0 for newMortgageOrLoan
  // (doc 007 finding #5 -- never capitalized into the opening balance).
  const initialCarriedAccruedInterest = input.flow === 'newMortgageOrLoan' ? 0 : (input.accruedInterest ?? 0);
  // fees_to_recover starts at the FINANCED fees only (spec 011 DEV-011-1, BRD IN-07 /
  // BR-04): non-financed fees are paid separately by the member, never enter the
  // waterfall, and count only in cobAmount / cobRatePercent below.
  const initialFeesToRecover = financedFees;

  const schedule = buildSchedule({
    loanAmount: amortizedPrincipal,
    calculatedRateDecimal,
    paymentAmount: input.paymentAmount,
    startDate,
    firstPaymentDate: input.firstPaymentDate,
    endDate: input.endDate,
    frequency: input.paymentFrequency,
    initialCarriedAccruedInterest,
    initialFeesToRecover,
  });

  if (schedule.length === 0) {
    throw new RangeError(
      'calculateCobCanada produced zero scheduled payments -- firstPaymentDate must fall before endDate',
    );
  }

  const lastRow = schedule[schedule.length - 1]!;

  const totalPayment = schedule.reduce((sum, row) => sum + row.paymentAmount, 0);
  const totalInterest = schedule.reduce((sum, row) => sum + row.interestPaid, 0);
  const feesRecovered = schedule.reduce((sum, row) => sum + row.feesPaid, 0);
  // Equation 4: principal_payment == total_payment - total_interest - fees_recovered,
  // reconciling exactly by construction (invariant #2) -- summed directly rather than
  // subtracted, so it holds even if a future change makes any individual row's
  // waterfall math imprecise.
  const principalPayment = schedule.reduce((sum, row) => sum + row.principalPortion, 0);

  // Equation 8 -- all fees, unconditionally (the only place non-financed fees enter,
  // with cobRatePercent through it -- spec 011).
  const cobDollarAmount = cobAmountEquation(totalInterest, financedFees, cashFees);

  // Equation 7 -- T = actual days from start_date to the LAST ROW ACTUALLY
  // GENERATED (not end_date itself), a PLAIN days/365 divide (VBA-confirmed NOT
  // leap-year-adjusted, unlike equation 3's period_interest); P = the simple average
  // of each row's opening balance. Both only matter for the general (fees > 0)
  // branch -- costOfBorrowingRatePercent short-circuits to calculatedRate x 100
  // whenever fees total $0, per doc 007's addendum.
  const finalPaymentDate = lastRow.date;
  const termDays = daysBetween(startDate, finalPaymentDate);
  const termYearsExact = termDays / 365;
  const averageOutstandingBalanceValue = averageOutstandingBalance(schedule);
  const cobRate = costOfBorrowingRatePercent(
    calculatedRateDecimal,
    financedFees,
    cashFees,
    cobDollarAmount,
    termYearsExact,
    averageOutstandingBalanceValue,
  );

  // Equation 6 -- mortgage + variable only. loan_amount = current outstanding
  // principal = amortizedPrincipal (== loanAmount at disbursal for new flows;
  // already the current balance for renewal/paymentChange flows).
  const triggerRate = flowComputesTriggerRate(input)
    ? triggerRatePercentEquation(input.paymentAmount, paymentsPerYear, amortizedPrincipal)
    : null;

  return {
    calculatedRatePercent: calculatedRateDecimal * 100,
    cobAmount: cobDollarAmount,
    cobRatePercent: cobRate,
    totalPayment,
    numberOfPayments: schedule.length,
    totalInterest,
    principalPayment,
    feesRecovered,
    triggerRatePercent: triggerRate,
    amortizationSchedule: schedule,
    termDays,
    disbursalAmount,
    amortizedPrincipal,
    endingBalance: lastRow.closingBalance,
  };
}
