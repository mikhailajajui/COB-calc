export type CobFlow = 'newMortgageOrLoan' | 'renewal' | 'paymentChange' | 'variableRatePaymentChange';
export type ProductType = 'mortgage' | 'personalLoan';
export type RateType = 'variable' | 'fixed';
export type PaymentFrequency = 'monthly' | 'semiMonthly' | 'biweekly' | 'weekly' | 'acceleratedBiweekly' | 'acceleratedWeekly';
export declare const PAYMENTS_PER_YEAR: Record<PaymentFrequency, number>;
export declare function isFiniteNumber(x: unknown): x is number;
export interface Fee {
    name: string;
    amount: number;
    financed: boolean;
    includedInCob?: boolean;
}
export interface FeeSchedule {
    fees: Fee[];
}
export interface CobInputCommon {
    productType: ProductType;
    rateType: RateType;
    loanAmount: number;
    fees: FeeSchedule;
    contractRatePercent: number;
    paymentAmount: number;
    paymentFrequency: PaymentFrequency;
    firstPaymentDate: Date;
    endDate: Date;
    termYears?: number;
    termMonths?: number;
    semiAnnualCompoundingDate?: Date;
}
export interface NewLoanInput extends CobInputCommon {
    flow: 'newMortgageOrLoan';
    disbursalDate: Date;
    renewalDate?: undefined;
    accruedInterest?: undefined;
}
export interface ExistingLoanInput extends CobInputCommon {
    flow: 'renewal' | 'paymentChange' | 'variableRatePaymentChange';
    renewalDate: Date;
    disbursalDate?: undefined;
    accruedInterest: number;
}
export type CobCanadaInput = NewLoanInput | ExistingLoanInput;
export interface ContractTerm {
    years: number;
    months: number;
    days: number;
}
export interface CobScheduleRow {
    period: number;
    date: Date;
    daysInPeriod: number;
    openingBalance: number;
    periodInterest: number;
    carriedAccruedInterestOpening: number;
    feesOpening: number;
    paymentAmount: number;
    interestPaid: number;
    feesPaid: number;
    principalPortion: number;
    carriedAccruedInterestClosing: number;
    feesClosing: number;
    closingBalance: number;
}
export interface CobCanadaResult {
    calculatedRatePercent: number;
    cobAmount: number;
    cobRatePercent: number;
    totalPayment: number;
    numberOfPayments: number;
    totalInterest: number;
    principalPayment: number;
    feesRecovered: number;
    triggerRatePercent: number | null;
    amortizationSchedule: CobScheduleRow[];
    termDays: number;
    disbursalAmount: number;
    amortizedPrincipal: number;
    endingBalance: number;
}
