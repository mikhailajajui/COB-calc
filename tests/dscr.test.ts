import { describe, expect, it } from 'vitest';
import { debtServiceCoverageRatio } from '../src/dscr.js';

describe('debtServiceCoverageRatio', () => {
  it('matches a known example: NOI $120,000 vs annual debt service $90,000', () => {
    // Cross-checked against the lending skill's Example 4 (120000/90000).
    expect(debtServiceCoverageRatio(120000, 90000)).toBeCloseTo(1.3333, 4);
  });

  it('returns a ratio below 1 (marginal) without throwing when NOI < debt service', () => {
    expect(debtServiceCoverageRatio(80000, 90000)).toBeLessThan(1);
  });

  it('throws when annualDebtService is not positive', () => {
    expect(() => debtServiceCoverageRatio(120000, 0)).toThrow(RangeError);
    expect(() => debtServiceCoverageRatio(120000, -1000)).toThrow(RangeError);
  });
});
