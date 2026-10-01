import type { PaymentFrequency, ProductType } from './types.js';

/**
 * The product catalogue: the payment frequencies each product type accepts.
 * @decision FB-24 (B27, DEV-FB24): a personal loan is paid monthly only, in every flow and
 * rate type. Fixed rule (no switch); the engine rejects any other frequency in validation.
 * A mortgage accepts all six payment frequencies.
 */
const ALLOWED_PAYMENT_FREQUENCIES: Readonly<Record<ProductType, readonly PaymentFrequency[]>> = Object.freeze({
  mortgage: Object.freeze([
    'monthly',
    'semiMonthly',
    'biweekly',
    'weekly',
    'acceleratedBiweekly',
    'acceleratedWeekly',
  ] as const),
  personalLoan: Object.freeze(['monthly'] as const),
});

/** The payment frequencies allowed for `productType` (the catalogue's own list; do not mutate). */
export function allowedPaymentFrequencies(productType: ProductType): readonly PaymentFrequency[] {
  return ALLOWED_PAYMENT_FREQUENCIES[productType];
}
