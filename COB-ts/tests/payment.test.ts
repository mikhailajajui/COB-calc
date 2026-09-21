import { describe, expect, it } from 'vitest';
import { calculateMonthlyPayment } from '../src/payment.js';

describe('calculateMonthlyPayment', () => {
  it('matches a known example: $200,000 at 6% for 30 years', () => {
    // r = 0.06/12 = 0.005, n = 360
    expect(calculateMonthlyPayment(200000, 6, 360)).toBeCloseTo(1199.1, 1);
  });

  it('matches a known example: $100,000 at 5% for 15 years', () => {
    // r = 0.05/12, n = 180
    expect(calculateMonthlyPayment(100000, 5, 180)).toBeCloseTo(790.79, 1);
  });

  it('handles the zero-interest edge case as principal / n', () => {
    expect(calculateMonthlyPayment(120000, 0, 120)).toBe(1000);
  });

  it('handles the single-payment edge case (n = 1)', () => {
    // Pays off principal plus one period's interest in full.
    const principal = 10000;
    const rate = 6;
    const r = rate / 100 / 12;
    expect(calculateMonthlyPayment(principal, rate, 1)).toBeCloseTo(principal * (1 + r), 2);
  });

  it('throws on non-positive principal', () => {
    expect(() => calculateMonthlyPayment(0, 5, 360)).toThrow(RangeError);
    expect(() => calculateMonthlyPayment(-100, 5, 360)).toThrow(RangeError);
  });

  it('throws on non-positive number of payments', () => {
    expect(() => calculateMonthlyPayment(100000, 5, 0)).toThrow(RangeError);
    expect(() => calculateMonthlyPayment(100000, 5, -12)).toThrow(RangeError);
  });

  it('throws on negative interest rate', () => {
    expect(() => calculateMonthlyPayment(100000, -1, 360)).toThrow(RangeError);
  });
});
