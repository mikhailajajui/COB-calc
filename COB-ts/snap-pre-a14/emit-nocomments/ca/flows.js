import { SEMI_ANNUAL_DATE_REQUIRED } from './policies.js';
export const FLOW_IDS = Object.freeze([
    'newMortgageOrLoan',
    'renewal',
    'paymentChange',
    'variableRatePaymentChange',
]);
export const FLOWS = Object.freeze({
    newMortgageOrLoan: Object.freeze({
        startDateField: 'disbursalDate',
        accruedInterest: 'hidden',
        forcedProductType: null,
        forcedRateType: null,
        startDateLabel: 'Disbursal date',
        firstPaymentDateLabel: 'First payment date',
    }),
    renewal: Object.freeze({
        startDateField: 'renewalDate',
        accruedInterest: 'required',
        forcedProductType: null,
        forcedRateType: null,
        startDateLabel: 'Renewal date',
        firstPaymentDateLabel: 'First payment date',
    }),
    paymentChange: Object.freeze({
        startDateField: 'renewalDate',
        accruedInterest: 'required',
        forcedProductType: null,
        forcedRateType: null,
        startDateLabel: 'Date of change',
        firstPaymentDateLabel: 'Next payment date',
    }),
    variableRatePaymentChange: Object.freeze({
        startDateField: 'renewalDate',
        accruedInterest: 'required',
        forcedProductType: 'mortgage',
        forcedRateType: 'variable',
        startDateLabel: 'Date of change',
        firstPaymentDateLabel: 'Next payment date',
    }),
});
export function computesTriggerRate(productType, rateType) {
    return productType === 'mortgage' && rateType === 'variable';
}
function semiAnnualDateApplies(productType, rateType) {
    return productType === 'mortgage' && rateType === 'fixed';
}
export function requiresSemiAnnualDate(productType, rateType, required = SEMI_ANNUAL_DATE_REQUIRED) {
    return required && semiAnnualDateApplies(productType, rateType);
}
