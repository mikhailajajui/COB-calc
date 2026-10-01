const ALLOWED_PAYMENT_FREQUENCIES = Object.freeze({
    mortgage: Object.freeze([
        'monthly',
        'semiMonthly',
        'biweekly',
        'weekly',
        'acceleratedBiweekly',
        'acceleratedWeekly',
    ]),
    personalLoan: Object.freeze(['monthly']),
});
export function allowedPaymentFrequencies(productType) {
    return ALLOWED_PAYMENT_FREQUENCIES[productType];
}
