import { describe, expect, it } from 'vitest';
import { calculatePointsBreakeven } from '../src/points.js';
import { calculateMonthlyPayment } from '../src/payment.js';

describe('calculatePointsBreakeven', () => {
  it('matches a known example: 1 point on $400,000 at 6.5% reducing the rate by 0.25%', () => {
    const loanAmount = 400000;
    const points = 1;
    const rateReductionPercent = 0.25;
    const originalRatePercent = 6.5;
    const termMonths = 360;

    // Independently re-derive expected values instead of trusting the implementation.
    const expectedCost = (loanAmount * points) / 100;
    const pmtOld = calculateMonthlyPayment(loanAmount, originalRatePercent, termMonths);
    const pmtNew = calculateMonthlyPayment(
      loanAmount,
      originalRatePercent - rateReductionPercent,
      termMonths,
    );
    const expectedBreakeven = expectedCost / (pmtOld - pmtNew);

    const result = calculatePointsBreakeven({
      loanAmount,
      points,
      rateReductionPercent,
      originalRatePercent,
      termMonths,
    });

    expect(result.pointsCost).toBe(expectedCost);
    expect(result.breakevenMonths).toBeCloseTo(expectedBreakeven, 1);
  });

  it('returns Infinity breakeven (not a throw) when the rate reduction produces no savings', () => {
    const result = calculatePointsBreakeven({
      loanAmount: 400000,
      points: 1,
      rateReductionPercent: 0,
      originalRatePercent: 6.5,
      termMonths: 360,
    });
    expect(result.breakevenMonths).toBe(Infinity);
  });

  it('throws when rateReductionPercent exceeds originalRatePercent', () => {
    expect(() =>
      calculatePointsBreakeven({
        loanAmount: 400000,
        points: 1,
        rateReductionPercent: 7,
        originalRatePercent: 6.5,
        termMonths: 360,
      }),
    ).toThrow(RangeError);
  });
});
