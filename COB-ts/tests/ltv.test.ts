import { describe, expect, it } from 'vitest';
import { combinedLoanToValue, loanToValue } from '../src/ltv.js';

describe('loanToValue', () => {
  it('matches a known example: $450,000 loan on a $500,000 property', () => {
    expect(loanToValue(450000, 500000)).toBe(0.9);
  });

  it('returns a ratio greater than 1 for an underwater loan without throwing', () => {
    expect(loanToValue(550000, 500000)).toBeCloseTo(1.1, 5);
  });

  it('throws when propertyValue is not positive', () => {
    expect(() => loanToValue(450000, 0)).toThrow(RangeError);
    expect(() => loanToValue(450000, -100)).toThrow(RangeError);
  });
});

describe('combinedLoanToValue', () => {
  it('matches a known example: $400,000 first lien + $50,000 HELOC on a $500,000 property', () => {
    expect(combinedLoanToValue(400000, 50000, 500000)).toBe(0.9);
  });

  it('returns a ratio greater than 1 when combined liens exceed property value', () => {
    expect(combinedLoanToValue(450000, 100000, 500000)).toBeCloseTo(1.1, 5);
  });

  it('throws when propertyValue is not positive', () => {
    expect(() => combinedLoanToValue(400000, 50000, 0)).toThrow(RangeError);
  });
});
