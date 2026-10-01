import { dayCountFraction } from './calendar.js';
import { isFiniteNumber } from './types.js';
export function calculatedRate(contractRatePercent, compoundingPeriodsPerYear, paymentsPerYear) {
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
    return (paymentsPerYear *
        (Math.pow(1 + annualRate / compoundingPeriodsPerYear, compoundingPeriodsPerYear / paymentsPerYear) - 1));
}
export function selectRateBasis(productType, rateType) {
    return productType === 'mortgage' && rateType === 'fixed' ? 'SEMI-ANNUAL' : 'MONTHLY';
}
export function selectCompoundingPeriodsPerYear(productType, rateType, paymentsPerYear) {
    if (!(paymentsPerYear > 0)) {
        throw new RangeError(`paymentsPerYear must be > 0, got ${paymentsPerYear}`);
    }
    return selectRateBasis(productType, rateType) === 'SEMI-ANNUAL' ? 2 : paymentsPerYear;
}
export function calculatedRateFor(productType, rateType, contractRatePercent, paymentsPerYear) {
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
export function periodInterest(openingBalance, calculatedRateDecimal, periodStart, periodEnd) {
    if (!(openingBalance >= 0)) {
        throw new RangeError(`openingBalance must be >= 0, got ${openingBalance}`);
    }
    if (!(calculatedRateDecimal >= 0)) {
        throw new RangeError(`calculatedRateDecimal must be >= 0, got ${calculatedRateDecimal}`);
    }
    return openingBalance * calculatedRateDecimal * dayCountFraction(periodStart, periodEnd);
}
export function applyPaymentWaterfall(periodInterestAmount, carriedAccruedInterestOpening, feesOpening, paymentAmount, principalOutstanding) {
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
export function triggerRatePercent(paymentAmount, paymentsPerYear, loanAmount) {
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
export function cobRatePercent(costOfBorrowing, termYears, averagePrincipalOutstanding) {
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
export function costOfBorrowingRatePercent(calculatedRateDecimal, totalFinancedFees, totalCashFees, costOfBorrowing, termYears, averagePrincipalOutstanding) {
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
export function cobAmount(totalInterest, totalFinancedFees, totalCashFees) {
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
