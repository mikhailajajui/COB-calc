import { daysBetween, effectiveFirstPaymentDate, periodDateFor, roundUpToWholeMonths, termBetween } from './calendar.js';
import { totalCashFees, totalFinancedFees } from './fees.js';
import { FLOWS, FLOW_IDS, computesTriggerRate } from './flows.js';
import {
  PRINCIPAL_PAID,
  PRIOR_ACCRUED_IN_COB,
  PRIOR_ACCRUED_IN_P,
  LEAP_AWARE_PAYMENTS_PER_YEAR,
  P_BASIS,
  UNPAID_INTEREST_CAPITALISED,
} from './policies.js';
import {
  applyPaymentWaterfall,
  calculatedRateFor,
  conversionPaymentsPerYear,
  cobAmount as cobAmountEquation,
  costOfBorrowingRatePercent,
  periodInterest,
  triggerRatePercent as triggerRatePercentEquation,
} from './equations.js';
import type { CobCanadaInput, CobCanadaResult, CobScheduleRow, ContractTerm, ContractTermOptions, PaymentFrequency } from './types.js';
import { PAYMENTS_PER_YEAR } from './types.js';
import { validateCobCanadaInput } from './validate.js';

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
  initialPastAccruedInterest: number;
  initialFeesToRecover: number;
  unpaidInterestCapitalised: boolean;
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
 *
 * Unpaid interest, shipped branch (UNPAID_INTEREST_CAPITALISED false, DEV-OQL). The
 * interest base is openingBalance = principal + unrecovered financed fees; it never holds
 * unpaid interest (B19-R1). Unpaid interest (IN-11 and period shortfalls) is one bucket
 * outside the balance that earns nothing; the waterfall pays it, and this period's
 * interest, first, and its own closing value is the next bucket (B19-R2). Payments clear
 * IN-11 first (oldest first, Q-W4-INT), tracked as `priorAccruedOwed` (B19-R3). The
 * bucket minus the IN-11 still owed is the period interest unpaid at the end, which
 * counts in C as charged (B19-R4). closingBalance excludes interest (B19-R5).
 *
 * Workbook branch (true): unpaid period interest, OQ-L. A shortfall stays owing, is paid
 * first from later payments, is part of the Loan balance (closing and next opening), and
 * is charged interest next period. CalculateAll: `newInt = openingBalance * appliedRate`,
 * `intAccrued = intAccrued + newInt`, `newBalance = newFees + newPrinciple + intAccrued -
 * totalInterestPaid`, `openingBalance = newBalance`. Past accrued interest, IN-11, is
 * carried outside the balance, earning nothing; while any is outstanding, an interest
 * shortfall is carried with it (OQ-W interim). Only one of the two is ever nonzero, so
 * the waterfall sees their sum.
 */
function buildSchedule(args: BuildScheduleArgs): { schedule: CobScheduleRow[]; unpaidPeriodInterestAtEnd: number } {
  const {
    loanAmount,
    calculatedRateDecimal,
    paymentAmount,
    startDate,
    firstPaymentDate,
    endDate,
    frequency,
    initialPastAccruedInterest,
    initialFeesToRecover,
    unpaidInterestCapitalised,
  } = args;

  const rows: CobScheduleRow[] = [];
  let openingBalance = loanAmount;
  let feesToRecover = initialFeesToRecover;
  let priorDate = startDate;
  // Workbook branch (UNPAID_INTEREST_CAPITALISED true): T6 / OQ-L plus the OQ-W interim rule.
  let pastAccruedInterest = initialPastAccruedInterest;
  let unpaidPeriodInterest = 0;
  // Shipped branch (false, DEV-OQL): one bucket of unpaid interest outside the balance.
  let accruedBucket = initialPastAccruedInterest;
  let priorAccruedOwed = initialPastAccruedInterest;

  for (let index = 0; index < MAX_SCHEDULE_ROWS_SAFETY_CAP; index += 1) {
    const rowDate = periodDateFor(frequency, firstPaymentDate, index, priorDate);
    if (rowDate.getTime() > endDate.getTime()) {
      break;
    }

    const daysInPeriod = daysBetween(priorDate, rowDate);
    const periodInterestAmount = periodInterest(openingBalance, calculatedRateDecimal, priorDate, rowDate);

    const carriedAccruedInterest = unpaidInterestCapitalised
      ? pastAccruedInterest + unpaidPeriodInterest
      : accruedBucket;
    const waterfall = applyPaymentWaterfall(
      periodInterestAmount,
      carriedAccruedInterest,
      feesToRecover,
      paymentAmount,
      unpaidInterestCapitalised
        ? openingBalance - feesToRecover - unpaidPeriodInterest
        : openingBalance - feesToRecover,
    );
    let closingBalance: number;
    if (unpaidInterestCapitalised) {
      const unpaidPeriodInterestClosing = pastAccruedInterest > 0 ? 0 : waterfall.carriedAccruedInterestClosing;
    // Spec 011 D9/D8 (DEV-011-2): financed fees are inside openingBalance, so the fees
    // paid reduce it as well as the principal paid. OQ-L: so is unpaid period interest.
      closingBalance =
        openingBalance -
        waterfall.feesPaid -
        waterfall.principalPortion -
        unpaidPeriodInterest +
        unpaidPeriodInterestClosing;
      pastAccruedInterest = pastAccruedInterest > 0 ? waterfall.carriedAccruedInterestClosing : 0;
      unpaidPeriodInterest = unpaidPeriodInterestClosing;
    } else {
      closingBalance = openingBalance - waterfall.feesPaid - waterfall.principalPortion;
      priorAccruedOwed = priorAccruedOwed - Math.min(waterfall.interestPaid, priorAccruedOwed);
      accruedBucket = waterfall.carriedAccruedInterestClosing;
    }

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
    feesToRecover = waterfall.feesClosing;
    priorDate = rowDate;

    if (closingBalance <= 0) {
      break;
    }
  }

  return {
    schedule: rows,
    unpaidPeriodInterestAtEnd: unpaidInterestCapitalised ? unpaidPeriodInterest : accruedBucket - priorAccruedOwed,
  };
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
  P_BASIS satisfies 'openingBalance'; // OQ-Q
  PRIOR_ACCRUED_IN_P satisfies false; // OQ-W3
  return rows.reduce((sum, row) => sum + row.openingBalance, 0) / rows.length;
}

/**
 * Implements BRD §3.3, §4 and Appendix B end to end: a user-entered payment_amount (never solved),
 * day-count-prorated interest accrual, the interest -> fees -> principal payment
 * waterfall, financed fees already inside loan_amount, and the trigger rate / COB
 * rate outputs.
 */
export interface EngineSwitches {
  readonly unpaidInterestCapitalised: boolean;
}

export const SHIPPED_SWITCHES: EngineSwitches = Object.freeze({
  unpaidInterestCapitalised: UNPAID_INTEREST_CAPITALISED,
});

export function calculateCobCanada(input: CobCanadaInput): CobCanadaResult {
  return calculateCobCanadaWith(input, SHIPPED_SWITCHES);
}

export function calculateCobCanadaWith(
  input: CobCanadaInput,
  switches: EngineSwitches,
  leapAware: boolean = LEAP_AWARE_PAYMENTS_PER_YEAR,
): CobCanadaResult {
  const { startDate } = validateCobCanadaInput(input);

  const paymentsPerYear = PAYMENTS_PER_YEAR[input.paymentFrequency];

  const financedFees = totalFinancedFees(input.fees);
  const cashFees = totalCashFees(input.fees);

  // "Financed fees" (resolved, doc 007 finding #4): loan_amount is ALREADY
  // inclusive of financed fees -- amortized_principal is simply loan_amount, and
  // disbursal_amount only subtracts financed fees (cash fees never touch disbursal).
  const amortizedPrincipal = input.loanAmount;
  const disbursalAmount = input.loanAmount - financedFees;

  // Equations 1/2 -- the Calculated Rate by rate basis (OQ-C): the contract rate
  // as entered (MONTHLY) or converted at m = 2 (SEMI-ANNUAL, fixed mortgage).
  // B37 (DEC-B37-LEAP-N): n for equation 1 (leap-aware for the 7/14-day frequencies of a fixed-rate mortgage).
  const nForRate = conversionPaymentsPerYear(
    input.productType,
    input.rateType,
    input.paymentFrequency,
    startDate,
    input.endDate,
    leapAware,
  );
  const { percent: calculatedRatePercent, decimal: calculatedRateDecimal } = calculatedRateFor(
    input.productType,
    input.rateType,
    input.contractRatePercent,
    nForRate,
  );

  const flowSpec = FLOWS[input.flow];
  // Past accrued interest (IN-11) starts at the input accrued_interest for
  // renewal/paymentChange/variableRatePaymentChange flows, 0 for newMortgageOrLoan
  // (doc 007 finding #5 -- never capitalized into the opening balance; OQ-W open).
  // Required since B20; the `?? 0` only satisfies the union type.
  const initialPastAccruedInterest = flowSpec.accruedInterest === 'hidden' ? 0 : (input.accruedInterest ?? 0);
  // fees_to_recover starts at the FINANCED fees only (spec 011 DEV-011-1, BRD IN-07 /
  // BR-04): non-financed fees are paid separately by the member, never enter the
  // waterfall, and count only in cobAmount / cobRatePercent below.
  const initialFeesToRecover = financedFees;

  const { schedule, unpaidPeriodInterestAtEnd } = buildSchedule({
    loanAmount: amortizedPrincipal,
    calculatedRateDecimal,
    paymentAmount: input.paymentAmount,
    startDate,
    firstPaymentDate: effectiveFirstPaymentDate(input.paymentFrequency, input.firstPaymentDate),
    endDate: input.endDate,
    frequency: input.paymentFrequency,
    initialPastAccruedInterest,
    initialFeesToRecover,
    unpaidInterestCapitalised: switches.unpaidInterestCapitalised,
  });

  if (schedule.length === 0) {
    throw new RangeError(
      'calculateCobCanada produced zero scheduled payments -- firstPaymentDate must fall before endDate',
    );
  }

  const lastRow = schedule[schedule.length - 1]!;

  const totalPayment = schedule.reduce((sum, row) => sum + row.paymentAmount, 0);
  // Total interest counts period interest as charged (OQ-L / DEV-OQL; CalculateAll:
  // `TOTALINTERESTCELL = intAccrued`), so the period interest still unpaid at the end is
  // added. IN-11 past accrued interest still counts only as it is paid (W2).
  PRIOR_ACCRUED_IN_COB satisfies 'whenPaid'; // OQ-W2
  const totalInterest = schedule.reduce((sum, row) => sum + row.interestPaid, 0) + unpaidPeriodInterestAtEnd;
  const feesRecovered = schedule.reduce((sum, row) => sum + row.feesPaid, 0);
  // Equation 4: principal_payment == total_payment - sum(interest_paid) - fees_recovered,
  // reconciling exactly by construction (invariant #2) -- summed directly rather than
  // subtracted, so it holds even if a future change makes any individual row's
  // waterfall math imprecise.
  PRINCIPAL_PAID satisfies 'sumOfPrincipalPortion'; // OQ-R
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
  if (termDays === 0 && !(financedFees + cashFees === 0)) {
    const startField = flowSpec.startDateField;
    throw new RangeError(
      `${startField} is the same day as the only payment date, so the COB-rate term is 0 days; with fees the term must be at least 1 day`,
    );
  }
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
  const triggerRate = computesTriggerRate(input.productType, input.rateType)
    ? triggerRatePercentEquation(input.paymentAmount, paymentsPerYear, amortizedPrincipal)
    : null;

  return {
    calculatedRatePercent,
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

/**
 * The contract term (B24; start point changed by B32, DEC-B32-TERM): whole years, months and
 * leftover days from the flow's start date (input[FLOWS[flow].startDateField]: Disbursal date,
 * Renewal date or Date of change) to the last row of the calculated schedule. Same span as
 * `termDays`: daysBetween(start, last row) === result.termDays for a pair from calculateCobCanada.
 * RangeError for an empty schedule, an unknown flow, a start date that is not a valid Date, or a
 * start date after the last row (none of which calculateCobCanada can produce).
 */
export function contractTerm(
  input: CobCanadaInput,
  result: Pick<CobCanadaResult, 'amortizationSchedule'>,
): ContractTerm {
  const schedule = result.amortizationSchedule;
  const last = schedule[schedule.length - 1];
  if (last === undefined) {
    throw new RangeError('amortizationSchedule must have at least one row');
  }
  if (!FLOW_IDS.includes(input.flow)) {
    throw new RangeError(`flow must be one of ${FLOW_IDS.join('/')}`);
  }
  const startField = FLOWS[input.flow].startDateField;
  const start: unknown = input[startField];
  if (!(start instanceof Date) || Number.isNaN(start.getTime())) {
    throw new RangeError(`${startField} must be a valid Date`);
  }
  return termBetween(start, last.date);
}

/**
 * The two contract terms of DEC-B34-TERM (B34), both from the flow's start date and rounded up
 * to whole months: `lastPayment` to the last row of the schedule (contractTerm), `endDate` to
 * input.endDate. For a pair from calculateCobCanada, endDate >= lastPayment and endDate >= 1 month.
 * RangeError: every case of contractTerm first (same messages, same order), then an endDate that
 * is not a valid Date, then an endDate before the start date (termBetween).
 */
export function contractTermOptions(
  input: CobCanadaInput,
  result: Pick<CobCanadaResult, 'amortizationSchedule'>,
): ContractTermOptions {
  const toLastPayment = contractTerm(input, result);
  const start = input[FLOWS[input.flow].startDateField] as Date;
  const end: unknown = input.endDate;
  if (!(end instanceof Date) || Number.isNaN(end.getTime())) {
    throw new RangeError('endDate must be a valid Date');
  }
  return {
    lastPayment: roundUpToWholeMonths(toLastPayment),
    endDate: roundUpToWholeMonths(termBetween(start, end)),
  };
}

/**
 * B37 addendum (Q-B37-LABEL): the payments per year n that equation 1 uses for `input` at `paymentFrequency`, with the
 * shipped LEAP_AWARE_PAYMENTS_PER_YEAR. Reads only flow, productType, rateType, the flow's start date and endDate; the
 * rest of `input` may be invalid. Never throws for any form state (unknown flow or missing/invalid date -> 52/26/24/12);
 * RangeError only for a frequency outside PaymentFrequency.
 */
export function paymentsPerYearFor(input: CobCanadaInput, paymentFrequency: PaymentFrequency): number {
  const start: unknown = FLOW_IDS.includes(input.flow) ? input[FLOWS[input.flow].startDateField] : undefined;
  return conversionPaymentsPerYear(
    input.productType,
    input.rateType,
    paymentFrequency,
    start instanceof Date ? start : undefined,
    input.endDate,
    LEAP_AWARE_PAYMENTS_PER_YEAR,
  );
}
