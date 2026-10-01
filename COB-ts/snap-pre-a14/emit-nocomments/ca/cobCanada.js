import { daysBetween, effectiveFirstPaymentDate, periodDateFor, termBetween } from './calendar.js';
import { totalCashFees, totalFinancedFees } from './fees.js';
import { FLOWS, computesTriggerRate } from './flows.js';
import { PRINCIPAL_PAID, PRIOR_ACCRUED_IN_COB, PRIOR_ACCRUED_IN_P, P_BASIS, UNPAID_INTEREST_CAPITALISED, } from './policies.js';
import { applyPaymentWaterfall, calculatedRateFor, cobAmount as cobAmountEquation, costOfBorrowingRatePercent, periodInterest, triggerRatePercent as triggerRatePercentEquation, } from './equations.js';
import { PAYMENTS_PER_YEAR } from './types.js';
import { validateCobCanadaInput } from './validate.js';
const MAX_SCHEDULE_ROWS_SAFETY_CAP = 20000;
function buildSchedule(args) {
    const { loanAmount, calculatedRateDecimal, paymentAmount, startDate, firstPaymentDate, endDate, frequency, initialPastAccruedInterest, initialFeesToRecover, unpaidInterestCapitalised, } = args;
    const rows = [];
    let openingBalance = loanAmount;
    let feesToRecover = initialFeesToRecover;
    let priorDate = startDate;
    let pastAccruedInterest = initialPastAccruedInterest;
    let unpaidPeriodInterest = 0;
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
        const waterfall = applyPaymentWaterfall(periodInterestAmount, carriedAccruedInterest, feesToRecover, paymentAmount, unpaidInterestCapitalised
            ? openingBalance - feesToRecover - unpaidPeriodInterest
            : openingBalance - feesToRecover);
        let closingBalance;
        if (unpaidInterestCapitalised) {
            const unpaidPeriodInterestClosing = pastAccruedInterest > 0 ? 0 : waterfall.carriedAccruedInterestClosing;
            closingBalance =
                openingBalance -
                    waterfall.feesPaid -
                    waterfall.principalPortion -
                    unpaidPeriodInterest +
                    unpaidPeriodInterestClosing;
            pastAccruedInterest = pastAccruedInterest > 0 ? waterfall.carriedAccruedInterestClosing : 0;
            unpaidPeriodInterest = unpaidPeriodInterestClosing;
        }
        else {
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
function averageOutstandingBalance(rows) {
    P_BASIS;
    PRIOR_ACCRUED_IN_P;
    return rows.reduce((sum, row) => sum + row.openingBalance, 0) / rows.length;
}
export const SHIPPED_SWITCHES = Object.freeze({
    unpaidInterestCapitalised: UNPAID_INTEREST_CAPITALISED,
});
export function calculateCobCanada(input) {
    return calculateCobCanadaWith(input, SHIPPED_SWITCHES);
}
export function calculateCobCanadaWith(input, switches) {
    const { startDate } = validateCobCanadaInput(input);
    const paymentsPerYear = PAYMENTS_PER_YEAR[input.paymentFrequency];
    const financedFees = totalFinancedFees(input.fees);
    const cashFees = totalCashFees(input.fees);
    const amortizedPrincipal = input.loanAmount;
    const disbursalAmount = input.loanAmount - financedFees;
    const { percent: calculatedRatePercent, decimal: calculatedRateDecimal } = calculatedRateFor(input.productType, input.rateType, input.contractRatePercent, paymentsPerYear);
    const flowSpec = FLOWS[input.flow];
    const initialPastAccruedInterest = flowSpec.accruedInterest === 'hidden' ? 0 : (input.accruedInterest ?? 0);
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
        throw new RangeError('calculateCobCanada produced zero scheduled payments -- firstPaymentDate must fall before endDate');
    }
    const lastRow = schedule[schedule.length - 1];
    const totalPayment = schedule.reduce((sum, row) => sum + row.paymentAmount, 0);
    PRIOR_ACCRUED_IN_COB;
    const totalInterest = schedule.reduce((sum, row) => sum + row.interestPaid, 0) + unpaidPeriodInterestAtEnd;
    const feesRecovered = schedule.reduce((sum, row) => sum + row.feesPaid, 0);
    PRINCIPAL_PAID;
    const principalPayment = schedule.reduce((sum, row) => sum + row.principalPortion, 0);
    const cobDollarAmount = cobAmountEquation(totalInterest, financedFees, cashFees);
    const finalPaymentDate = lastRow.date;
    const termDays = daysBetween(startDate, finalPaymentDate);
    if (termDays === 0 && !(financedFees + cashFees === 0)) {
        const startField = flowSpec.startDateField;
        throw new RangeError(`${startField} is the same day as the only payment date, so the COB-rate term is 0 days; with fees the term must be at least 1 day`);
    }
    const termYearsExact = termDays / 365;
    const averageOutstandingBalanceValue = averageOutstandingBalance(schedule);
    const cobRate = costOfBorrowingRatePercent(calculatedRateDecimal, financedFees, cashFees, cobDollarAmount, termYearsExact, averageOutstandingBalanceValue);
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
export function contractTerm(result) {
    const schedule = result.amortizationSchedule;
    const first = schedule[0];
    const last = schedule[schedule.length - 1];
    if (first === undefined || last === undefined) {
        throw new RangeError('amortizationSchedule must have at least one row');
    }
    return termBetween(first.date, last.date);
}
