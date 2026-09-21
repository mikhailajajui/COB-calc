import { describe, expect, it } from 'vitest';
import { calculatePmiPayment } from '../src/pmi.js';

describe('calculatePmiPayment', () => {
  it('matches a known example: $450,000 loan at 0.8% annual PMI', () => {
    // Cross-checked against the lending skill's Example 3 ($450,000 * 0.008 / 12 = $300).
    expect(calculatePmiPayment(450000, 0.8)).toBe(300);
  });

  it('returns 0 for a zero balance without throwing', () => {
    expect(calculatePmiPayment(0, 0.8)).toBe(0);
  });

  it('throws when annualRatePercent is negative', () => {
    expect(() => calculatePmiPayment(450000, -0.5)).toThrow(RangeError);
  });
});
