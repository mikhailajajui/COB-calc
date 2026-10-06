import type { PaymentFrequency, ProductType } from './types.js';

/**
 * The product catalogue: the payment frequencies each product type accepts.
 * Both product types accept all six payment frequencies (DEC-B33-FREQ, 2026-10-05: the user
 * removed the personal-loan Monthly-only rule of B27 / DEV-FB24 outright, no switch). Kept as a
 * read-only public description (ADR-13); validation does not consult it, because the
 * payment-frequency enum check already admits exactly these six for every product.
 */
const ALL_PAYMENT_FREQUENCIES: readonly PaymentFrequency[] = Object.freeze([
  'monthly',
  'semiMonthly',
  'biweekly',
  'weekly',
  'acceleratedBiweekly',
  'acceleratedWeekly',
] as const);

const ALLOWED_PAYMENT_FREQUENCIES: Readonly<Record<ProductType, readonly PaymentFrequency[]>> = Object.freeze({
  mortgage: ALL_PAYMENT_FREQUENCIES,
  personalLoan: ALL_PAYMENT_FREQUENCIES,
});

/** The payment frequencies allowed for `productType` (the catalogue's own list; do not mutate). */
export function allowedPaymentFrequencies(productType: ProductType): readonly PaymentFrequency[] {
  return ALLOWED_PAYMENT_FREQUENCIES[productType];
}
