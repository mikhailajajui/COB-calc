/**
 * Rounding policy: rates and intermediate ratios are kept at full floating-point
 * precision. Only currency amounts that are actually paid/owed (a computed payment,
 * or a schedule row's interest/principal/balance) are rounded to cents via round2().
 * This mirrors how a real amortization table behaves — balances are tracked in cents,
 * not fractional dollars — while avoiding compounding rounding error into the rate
 * math itself. No integer-cents/bigint representation is used; it isn't warranted for
 * a pure calculation library with no persistence/serialization concerns.
 */
export function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
