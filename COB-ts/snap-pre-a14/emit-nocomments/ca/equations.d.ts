import type { ProductType, RateType } from './types.js';
export declare function calculatedRate(contractRatePercent: number, compoundingPeriodsPerYear: number, paymentsPerYear: number): number;
export type RateBasis = 'MONTHLY' | 'SEMI-ANNUAL';
export declare function selectRateBasis(productType: ProductType, rateType: RateType): RateBasis;
export declare function selectCompoundingPeriodsPerYear(productType: ProductType, rateType: RateType, paymentsPerYear: number): number;
export declare function calculatedRateFor(productType: ProductType, rateType: RateType, contractRatePercent: number, paymentsPerYear: number): {
    percent: number;
    decimal: number;
};
export { daysBetween, dayCountFraction } from './calendar.js';
export declare function periodInterest(openingBalance: number, calculatedRateDecimal: number, periodStart: Date, periodEnd: Date): number;
export interface PaymentWaterfallResult {
    totalInterestDue: number;
    interestPaid: number;
    carriedAccruedInterestClosing: number;
    feesPaid: number;
    feesClosing: number;
    principalPortion: number;
    amountPaid: number;
}
export declare function applyPaymentWaterfall(periodInterestAmount: number, carriedAccruedInterestOpening: number, feesOpening: number, paymentAmount: number, principalOutstanding: number): PaymentWaterfallResult;
export declare function triggerRatePercent(paymentAmount: number, paymentsPerYear: number, loanAmount: number): number;
export declare function cobRatePercent(costOfBorrowing: number, termYears: number, averagePrincipalOutstanding: number): number;
export declare function costOfBorrowingRatePercent(calculatedRateDecimal: number, totalFinancedFees: number, totalCashFees: number, costOfBorrowing: number, termYears: number, averagePrincipalOutstanding: number): number;
export declare function cobAmount(totalInterest: number, totalFinancedFees: number, totalCashFees: number): number;
