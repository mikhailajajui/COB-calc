import { calculateMonthlyPayment } from './payment.js';
import { round2 } from './money.js';
import { addMonths } from './segment.js';
import { summarizeLoan } from './loan.js';
import { validatePaymentFrequencyScheduleInput } from './validate.js';
import type {
  PaymentFrequency,
  PaymentFrequencyScheduleInput,
  PaymentFrequencyScheduleResult,
  PeriodAmortizationEntry,
} from './types.js';

/**
 * paymentFraction: what fraction of the monthly payment is paid at each occurrence
 * (e.g. half the monthly payment every 2 weeks for 'biweekly') — this is the standard
 * real-world "pay half your bill every 2 weeks" acceleration program, not a fresh
 * annuity computed at the period cadence.
 */
const FREQUENCY_CONFIG: Record<PaymentFrequency, { paymentsPerYear: number; paymentFraction: number }> = {
  monthly: { paymentsPerYear: 12, paymentFraction: 1 },
  semiMonthly: { paymentsPerYear: 24, paymentFraction: 1 / 2 },
  biweekly: { paymentsPerYear: 26, paymentFraction: 1 / 2 },
  weekly: { paymentsPerYear: 52, paymentFraction: 1 / 4 },
};

/** 100 years' worth of weekly periods — a generous safety cap against a period
 *  payment that doesn't cover interest. */
const MAX_PERIODS_SAFETY_CAP = 5200;

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

/** periodDate for period index i (0-based). monthly reuses the engine's addMonths for
 *  exact parity with the standard monthly schedule; weekly/biweekly use exact 7/14-day
 *  steps; semiMonthly is evenly spaced (an approximation of the "1st & 15th" convention
 *  some lenders use — see docs/spec.md §3.3). */
function periodDateFor(frequency: PaymentFrequency, startDate: Date, index: number): Date {
  switch (frequency) {
    case 'monthly':
      return addMonths(startDate, index);
    case 'weekly':
      return addDays(startDate, index * 7);
    case 'biweekly':
      return addDays(startDate, index * 14);
    case 'semiMonthly':
      return addDays(startDate, Math.round((index * 365.25) / 24));
  }
}

/**
 * Generates a genuine per-period amortization schedule: interest accrues each period
 * at annualInterestRatePercent / paymentsPerYear against the real outstanding balance,
 * with real calendar dates. Runs until the balance is paid off (forced to clear exactly
 * on the row that would otherwise go negative), bounded by MAX_PERIODS_SAFETY_CAP.
 */
function generatePeriodSchedule(
  loanAmount: number,
  annualInterestRatePercent: number,
  periodPaymentAmount: number,
  paymentsPerYear: number,
  frequency: PaymentFrequency,
  startDate: Date,
): PeriodAmortizationEntry[] {
  const rPeriod = annualInterestRatePercent / 100 / paymentsPerYear;
  const rows: PeriodAmortizationEntry[] = [];
  let balance = round2(loanAmount);
  let index = 0;

  while (balance > 0) {
    if (index >= MAX_PERIODS_SAFETY_CAP) {
      throw new Error(
        `Payment frequency schedule did not amortize to zero within ${MAX_PERIODS_SAFETY_CAP} periods — ` +
          `periodPaymentAmount ${periodPaymentAmount} may be insufficient to cover interest.`,
      );
    }

    const interestPortion = round2(balance * rPeriod);
    if (periodPaymentAmount <= interestPortion) {
      throw new Error(
        `Payment frequency schedule's period payment ${periodPaymentAmount} does not cover this ` +
          `period's interest (${interestPortion}) — this loan would never amortize.`,
      );
    }

    let principalPortion = round2(periodPaymentAmount - interestPortion);
    let paymentAmount = periodPaymentAmount;
    let remainingBalance = round2(balance - principalPortion);

    if (remainingBalance <= 0) {
      principalPortion = balance;
      paymentAmount = round2(interestPortion + principalPortion);
      remainingBalance = 0;
    }

    rows.push({
      periodNumber: index + 1,
      periodDate: periodDateFor(frequency, startDate, index),
      paymentAmount,
      interestPortion,
      principalPortion,
      remainingBalance,
    });

    balance = remainingBalance;
    index += 1;
  }

  return rows;
}

export function calculatePaymentFrequencySchedule(
  input: PaymentFrequencyScheduleInput,
): PaymentFrequencyScheduleResult {
  validatePaymentFrequencyScheduleInput(input);

  const startDate = input.startDate ?? new Date();
  const { paymentsPerYear, paymentFraction } = FREQUENCY_CONFIG[input.frequency];
  const monthlyPayment = calculateMonthlyPayment(
    input.loanAmount,
    input.annualInterestRatePercent,
    input.termMonths,
  );
  const periodPaymentAmount = round2(monthlyPayment * paymentFraction);

  const annualEquivalentPayments = paymentsPerYear * paymentFraction;
  const effectiveExtraMonthlyPayment = round2(
    (monthlyPayment * (annualEquivalentPayments - 12)) / 12,
  );

  // Baseline: the standard, exact monthly schedule (unchanged, not an approximation).
  const baseline = summarizeLoan({
    loanAmount: input.loanAmount,
    annualInterestRatePercent: input.annualInterestRatePercent,
    termYears: input.termMonths / 12,
    startDate,
  });

  // Detail: a genuine per-period schedule at the chosen frequency's real cadence —
  // this is what actually determines newMonths/newTotalInterest/interestSaved below,
  // not a monthly-equivalent shortcut. 'monthly' reuses the baseline's own schedule
  // directly rather than re-deriving it through a second, independent dynamic loop —
  // two independently-rounded implementations of the identical math can otherwise
  // land one payment apart from pure cent-rounding, which would make "monthly vs.
  // monthly" show a nonzero difference where there must be none.
  const schedule: PeriodAmortizationEntry[] =
    input.frequency === 'monthly'
      ? baseline.schedule.map((row) => ({
          periodNumber: row.paymentNumber,
          periodDate: row.paymentDate,
          paymentAmount: row.paymentAmount,
          interestPortion: row.interestPortion,
          principalPortion: row.principalPortion,
          remainingBalance: row.remainingBalance,
        }))
      : generatePeriodSchedule(
          input.loanAmount,
          input.annualInterestRatePercent,
          periodPaymentAmount,
          paymentsPerYear,
          input.frequency,
          startDate,
        );
  const lastRow = schedule[schedule.length - 1]!;
  const newTotalInterest = round2(schedule.reduce((sum, row) => sum + row.interestPortion, 0));
  // Expressed as elapsed years (periods / paymentsPerYear) converted to months, rather
  // than derived from calendar dates — dimensionally consistent and exact for
  // 'monthly' by construction (numberOfPeriods / 12 * 12 === numberOfPeriods), instead
  // of an off-by-one-prone date-field subtraction.
  const newMonths = Math.round((schedule.length / paymentsPerYear) * 12);

  return {
    frequency: input.frequency,
    paymentsPerYear,
    monthlyPayment,
    periodPaymentAmount,
    schedule,
    numberOfPeriods: schedule.length,
    payoffDate: lastRow.periodDate,
    effectiveExtraMonthlyPayment,
    originalMonths: baseline.numberOfPayments,
    newMonths,
    monthsSaved: baseline.numberOfPayments - newMonths,
    originalTotalInterest: baseline.totalInterestPaid,
    newTotalInterest,
    interestSaved: round2(baseline.totalInterestPaid - newTotalInterest),
  };
}
