import { round2 } from '../money.js';
import { annuityPaymentFromPeriodicRate } from '../payment.js';
import { addMonths } from '../segment.js';
import type { PaymentFrequency } from '../types.js';
import { totalCashFees, totalFeesIncludedInCob, totalFinancedFees } from './fees.js';
import {
  calculateTermDaysDisplay,
  cobAmount as cobAmountEquation,
  cobRatePercent as cobRatePercentEquation,
  periodicRateFromNominalPerPeriod,
  periodicRateFromSemiAnnualNominal,
  totalPeriodsFromYearsMonths,
  triggerRatePercent as triggerRatePercentEquation,
} from './equations.js';
import type { CobCanadaInput, CobCanadaResult, CobScheduleRow } from './types.js';
import { PAYMENTS_PER_YEAR } from './types.js';
import { validateCobCanadaInput } from './validate.js';

function isExistingFlow(flow: CobCanadaInput['flow']): boolean {
  return flow !== 'newMortgage' && flow !== 'newLoan';
}

/**
 * Table from spec 006's "Presentation layer" section: which flow/product/rate-type
 * combinations compute a trigger rate. Loans never do (personal loans have no trigger
 * rate concept); fixed-rate mortgages never do (a fixed payment on a fixed rate always
 * covers interest by construction -- invariant #1).
 */
function flowComputesTriggerRate(input: CobCanadaInput): boolean {
  if (input.productType !== 'mortgage' || input.rateType !== 'variable') {
    return false;
  }
  switch (input.flow) {
    case 'newMortgage':
    case 'existingMortgage':
    case 'paymentChange':
    case 'variableRatePaymentChange':
      return true;
    case 'newLoan':
    case 'existingLoan':
      return false;
  }
}

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

/**
 * Mirrors paymentFrequency.ts's private periodDateFor exactly (0-based index), kept as
 * its own copy here since that function isn't exported and this module's
 * schedule-building loop has different termination logic (a fixed term length, not
 * "run until paid off").
 */
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

interface BuildTermScheduleArgs {
  principal: number;
  periodicRate: number;
  paymentAmount: number;
  termPeriods: number;
  totalAmortizationPeriods: number;
  firstPaymentDate: Date;
  frequency: PaymentFrequency;
}

/**
 * Builds the amortization schedule for just the current contract term (see spec 006's
 * "Term vs. amortization scoping"): payment_amount was already solved against the full
 * remaining amortization (equation 3), but only `termPeriods` rows are generated/
 * summed/scheduled here. The final row is force-cleared to a zero balance only if this
 * term happens to run all the way to the end of the full amortization
 * (isFinalAmortizationRow) -- otherwise the term ends mid-amortization and the last
 * row's remainingBalance carries forward as the next renewal's opening balance.
 */
function buildTermSchedule(args: BuildTermScheduleArgs): CobScheduleRow[] {
  const { principal, periodicRate, paymentAmount, termPeriods, totalAmortizationPeriods, firstPaymentDate, frequency } =
    args;
  const rows: CobScheduleRow[] = [];
  let balance = round2(principal);

  for (let index = 0; index < termPeriods; index += 1) {
    const periodNumber = index + 1;
    const beginningBalance = balance;
    const interestPortion = round2(balance * periodicRate);
    let principalPortion = round2(paymentAmount - interestPortion);
    let rowPaymentAmount = paymentAmount;
    let remainingBalance = round2(balance - principalPortion);

    const isFinalAmortizationRow = periodNumber === totalAmortizationPeriods;
    if (remainingBalance <= 0 || isFinalAmortizationRow) {
      // Either the natural math already clears the balance this row, or this term is
      // scheduled to reach the very last payment of the full amortization -- force an
      // exact clear rather than trusting rounding to land on zero, same pattern as
      // segment.ts's final-row handling.
      principalPortion = balance;
      rowPaymentAmount = round2(interestPortion + principalPortion);
      remainingBalance = 0;
    }

    rows.push({
      periodNumber,
      periodDate: periodDateFor(frequency, firstPaymentDate, index),
      beginningBalance,
      paymentAmount: rowPaymentAmount,
      interestPortion,
      principalPortion,
      remainingBalance,
    });

    balance = remainingBalance;
    if (balance === 0) {
      break;
    }
  }

  return rows;
}

/**
 * Implements docs/new-req/006-cost-of-borrowing-disclosure.md end to end: the six
 * dropdown-driven flows, the compounding-convention split (semi-annual for fixed
 * mortgages, nominal/n for everything else), the trigger rate, and the regulatory
 * average-balance COB rate/amount -- all scoped to the current contract term, not the
 * full amortization (payment_amount itself is sized against the full remaining
 * amortization, per equation 3).
 */
export function calculateCobCanada(input: CobCanadaInput): CobCanadaResult {
  validateCobCanadaInput(input);

  const paymentsPerYear = PAYMENTS_PER_YEAR[input.paymentFrequency];

  // "Financed fees" (Conditional calculation paths, resolved): financed fees layer on
  // top of loanAmount; only cash fees reduce disbursal. Accrued interest
  // (existing/renewal flows) is capitalized into the opening balance alongside
  // financed fees -- a documented judgment call mirroring the COB-xlsx reference
  // implementation (spec 006 doesn't pin down accrued-interest mechanics beyond
  // "carried into this calculation").
  const financedFees = totalFinancedFees(input.fees);
  const cashFees = totalCashFees(input.fees);
  const feesIncludedInCob = totalFeesIncludedInCob(input.fees);
  const accruedInterest = isExistingFlow(input.flow) ? (input.accruedInterest ?? 0) : 0;

  const amortizedPrincipal = round2(input.loanAmount + financedFees + accruedInterest);
  const disbursalAmount = round2(input.loanAmount + financedFees - cashFees);

  // Compounding rule: fixed-rate mortgages use equation 1 (semi-annual); every other
  // combination (variable mortgage, any personal loan) uses equation 2 (nominal/n).
  const usesSemiAnnualCompounding = input.productType === 'mortgage' && input.rateType === 'fixed';
  const periodicRate = usesSemiAnnualCompounding
    ? periodicRateFromSemiAnnualNominal(input.contractRatePercent, paymentsPerYear)
    : periodicRateFromNominalPerPeriod(input.contractRatePercent, paymentsPerYear);

  const totalAmortizationPeriods = totalPeriodsFromYearsMonths(
    input.remainingAmortizationYears,
    input.remainingAmortizationMonths,
    paymentsPerYear,
  );
  const termPeriods = totalPeriodsFromYearsMonths(input.termYears, input.termMonths, paymentsPerYear);

  // Equation 3 -- payment_amount is always computed (never a direct input, including
  // for payment-change/variable-rate-payment-change flows), solved via the annuity
  // formula using the REMAINING AMORTIZATION as n, not the term.
  const paymentAmount = annuityPaymentFromPeriodicRate(amortizedPrincipal, periodicRate, totalAmortizationPeriods);

  // Term-vs-amortization scoping: only the term's own payments are scheduled/summed.
  const schedule = buildTermSchedule({
    principal: amortizedPrincipal,
    periodicRate,
    paymentAmount,
    termPeriods,
    totalAmortizationPeriods,
    firstPaymentDate: input.firstPaymentDate,
    frequency: input.paymentFrequency,
  });
  const lastRow = schedule[schedule.length - 1]!;

  const totalPayment = round2(schedule.reduce((sum, row) => sum + row.paymentAmount, 0));
  const totalInterest = round2(schedule.reduce((sum, row) => sum + row.interestPortion, 0));
  // Equation 5: principal_payment == total_payment - total_interest, reconciling
  // exactly by construction (every row's paymentAmount === interestPortion +
  // principalPortion) -- invariant #2.
  const principalPayment = round2(totalPayment - totalInterest);

  // Equation 7.
  const cobDollarAmount = cobAmountEquation(totalInterest, feesIncludedInCob);

  // Equation 6 -- T in years (>= 2 decimal places per s.47(2)(a)); P = average
  // beginning-of-period balance across the term's counted rows.
  const termYearsExact = input.termYears + input.termMonths / 12;
  const averageOutstandingBalance = schedule.reduce((sum, row) => sum + row.beginningBalance, 0) / schedule.length;
  const cobRate = cobRatePercentEquation(cobDollarAmount, termYearsExact, averageOutstandingBalance);

  // Equation 4 -- mortgage + variable only. total_borrowed = current outstanding
  // balance = amortizedPrincipal (equal to loanAmount at disbursal for new flows;
  // already the current balance for existing/renewal flows).
  const triggerRate = flowComputesTriggerRate(input)
    ? triggerRatePercentEquation(paymentAmount, paymentsPerYear, amortizedPrincipal)
    : null;

  // Equation 8 -- display only, never read back into any of the above.
  const termStartDate = input.disbursalDate ?? input.renewalDate ?? input.firstPaymentDate;
  const termDays = calculateTermDaysDisplay(termStartDate, input.endDate, input.termYears, input.termMonths);

  return {
    paymentAmount,
    cobAmount: cobDollarAmount,
    cobRatePercent: cobRate,
    totalPayment,
    numberOfPayments: schedule.length,
    totalInterest,
    principalPayment,
    triggerRatePercent: triggerRate,
    amortizationSchedule: schedule,
    termDays,
    disbursalAmount,
    amortizedPrincipal,
    endingBalance: lastRow.remainingBalance,
  };
}
