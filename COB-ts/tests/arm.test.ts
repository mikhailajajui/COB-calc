import { describe, expect, it } from 'vitest';
import { calculateArmResetRate } from '../src/arm.js';

describe('calculateArmResetRate', () => {
  it('matches a known example: index 5.0% + margin 2.75%, uncapped by a 5% lifetime cap', () => {
    // Cross-checked against the lending skill's own ARM reset demo.
    const result = calculateArmResetRate({
      previousRatePercent: 4.5,
      initialRatePercent: 4.5,
      indexRatePercent: 5.0,
      marginPercent: 2.75,
      lifetimeCapPercent: 5,
      isFirstReset: true,
    });
    expect(result.fullyIndexedRatePercent).toBeCloseTo(7.75, 6);
    // Lifetime cap allows up to initialRate + 5 = 9.5%, which exceeds the fully
    // indexed rate, so the cap does not bind.
    expect(result.cappedRatePercent).toBeCloseTo(7.75, 6);
  });

  it('binds the periodic cap even though the fully indexed rate is higher', () => {
    const result = calculateArmResetRate({
      previousRatePercent: 4.5,
      initialRatePercent: 4.5,
      indexRatePercent: 5.0,
      marginPercent: 2.75,
      periodicCapPercent: 2,
      isFirstReset: false,
    });
    expect(result.fullyIndexedRatePercent).toBeCloseTo(7.75, 6);
    expect(result.cappedRatePercent).toBeCloseTo(6.5, 6); // previousRate 4.5 + cap 2
  });

  it('throws when marginPercent is negative', () => {
    expect(() =>
      calculateArmResetRate({
        previousRatePercent: 4.5,
        initialRatePercent: 4.5,
        indexRatePercent: 5.0,
        marginPercent: -1,
        isFirstReset: true,
      }),
    ).toThrow(RangeError);
  });
});
