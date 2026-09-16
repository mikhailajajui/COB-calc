import { describe, expect, it } from 'vitest';
import { applyRecurringCosts } from '../src/costs.js';
import type { AmortizationEntry } from '../src/types.js';

function fixtureRows(count: number, startingBalance = 200000): AmortizationEntry[] {
  const rows: AmortizationEntry[] = [];
  let balance = startingBalance;
  for (let i = 1; i <= count; i += 1) {
    const principalPortion = 500;
    const interestPortion = 800;
    rows.push({
      paymentNumber: i,
      segmentIndex: 0,
      paymentDate: new Date(2020, i - 1, 1),
      paymentAmount: principalPortion + interestPortion,
      interestPortion,
      principalPortion,
      remainingBalance: balance - principalPortion,
      isManualOverride: false,
    });
    balance -= principalPortion;
  }
  return rows;
}

describe('applyRecurringCosts', () => {
  it('applies a flat $3,600/year property tax as $300/month on every row', () => {
    const rows = fixtureRows(12);
    const { rows: result } = applyRecurringCosts(
      rows,
      { propertyTax: { annualAmount: 3600 } },
      undefined,
    );
    expect(result.every((row) => row.taxPortion === 300)).toBe(true);
  });

  it('escalates the monthly amount at each 12-payment anniversary', () => {
    const rows = fixtureRows(15);
    const { rows: result } = applyRecurringCosts(
      rows,
      { propertyTax: { annualAmount: 1200, annualIncreasePercent: 10 } },
      undefined,
    );
    // Payments 1-12 (year 0): 1200/12 = 100.
    expect(result[9]!.taxPortion).toBe(100); // paymentNumber 10
    // Payments 13+ (year 1 anniversary): 1200*1.10/12 = 110.
    expect(result[12]!.taxPortion).toBe(110); // paymentNumber 13
  });

  it('throws when a recurring cost annualAmount is negative', () => {
    const rows = fixtureRows(3);
    expect(() =>
      applyRecurringCosts(rows, { hoa: { annualAmount: -50 } }, undefined),
    ).toThrow(RangeError);
  });
});
