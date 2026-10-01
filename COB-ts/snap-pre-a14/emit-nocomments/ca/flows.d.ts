import type { CobFlow, ProductType, RateType } from './types.js';
export interface FlowSpec {
    readonly startDateField: 'disbursalDate' | 'renewalDate';
    readonly accruedInterest: 'hidden' | 'required';
    readonly forcedProductType: ProductType | null;
    readonly forcedRateType: RateType | null;
    readonly startDateLabel: string;
    readonly firstPaymentDateLabel: string;
}
export declare const FLOW_IDS: readonly CobFlow[];
export declare const FLOWS: Readonly<Record<CobFlow, FlowSpec>>;
export declare function computesTriggerRate(productType: ProductType, rateType: RateType): boolean;
export declare function requiresSemiAnnualDate(productType: ProductType, rateType: RateType, required?: boolean): boolean;
