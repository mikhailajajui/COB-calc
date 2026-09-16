import { describe, expect, it } from 'vitest';
import { importOverridesFromCsv, importOverridesFromJson } from '../src/importOverrides.js';
import { summarizeMortgage } from '../src/mortgage.js';
import type { Segment } from '../src/types.js';

describe('importOverridesFromJson', () => {
  it('parses a 2-row JSON statement and feeds it into summarizeMortgage, threading overrideReason through', () => {
    const json = JSON.stringify([
      { paymentNumber: 5, interestPortion: 950, principalPortion: 250, reason: 'bank fee adjustment' },
      { paymentNumber: 10, remainingBalance: 195000, reason: 'statement reconciliation' },
    ]);
    const overrides = importOverridesFromJson(json);
    expect(overrides).toHaveLength(2);
    expect(overrides[0]).toMatchObject({
      paymentNumber: 5,
      interestPortion: 950,
      principalPortion: 250,
      reason: 'bank fee adjustment',
    });

    const segment: Segment = {
      startDate: new Date('2020-01-01'),
      annualInterestRatePercent: 6,
      amortizationMonthsRemaining: 360,
      startingBalance: 200000,
    };
    const summary = summarizeMortgage({ segments: [segment], manualOverrides: overrides });

    const row5 = summary.schedule[4]!;
    expect(row5.isManualOverride).toBe(true);
    expect(row5.interestPortion).toBe(950);
    expect(row5.principalPortion).toBe(250);
    expect(row5.overrideReason).toBe('bank fee adjustment');
  });
});

describe('importOverridesFromCsv', () => {
  it('parses a blank optional cell as undefined and derives principal from remainingBalance', () => {
    const csv = [
      'paymentNumber,paymentAmount,interestPortion,principalPortion,remainingBalance,reason',
      '7,,,,190000,csv import',
    ].join('\n');
    const overrides = importOverridesFromCsv(csv);
    expect(overrides).toHaveLength(1);
    expect(overrides[0]).toMatchObject({
      paymentNumber: 7,
      paymentAmount: undefined,
      remainingBalance: 190000,
      reason: 'csv import',
    });

    const segment: Segment = {
      startDate: new Date('2020-01-01'),
      annualInterestRatePercent: 6,
      amortizationMonthsRemaining: 360,
      startingBalance: 200000,
    };
    const summary = summarizeMortgage({ segments: [segment], manualOverrides: overrides });
    const row7 = summary.schedule[6]!;
    expect(row7.remainingBalance).toBe(190000);
    expect(row7.overrideReason).toBe('csv import');
  });

  it('throws on a duplicate paymentNumber within the same import', () => {
    const csv = [
      'paymentNumber,remainingBalance',
      '3,190000',
      '3,180000',
    ].join('\n');
    expect(() => importOverridesFromCsv(csv)).toThrow(RangeError);
  });
});
