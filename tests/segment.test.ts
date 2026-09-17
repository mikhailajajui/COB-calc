import { describe, expect, it } from 'vitest';
import { computeSegmentSchedule } from '../src/segment.js';
import { calculateMonthlyPayment } from '../src/payment.js';
import { summarizeMortgage } from '../src/mortgage.js';
import { round2 } from '../src/money.js';
import type { ManualPaymentOverride, Segment } from '../src/types.js';

const noOverrides = () => new Map<number, ManualPaymentOverride>();

describe('computeSegmentSchedule — open-ended segment (no termMonths)', () => {
  const segment: Segment = {
    startDate: new Date('2020-01-01'),
    annualInterestRatePercent: 6,
    amortizationMonthsRemaining: 360,
    startingBalance: 200000,
  };

  it('runs to exact payoff: 360 rows, final balance exactly 0', () => {
    const { rows, endingBalance } = computeSegmentSchedule(segment, 0, 200000, 1, noOverrides());
    expect(rows).toHaveLength(360);
    expect(endingBalance).toBe(0);
    expect(rows[rows.length - 1]!.remainingBalance).toBe(0);
  });

  it('sums principal across the schedule to the original balance', () => {
    const { rows } = computeSegmentSchedule(segment, 0, 200000, 1, noOverrides());
    const totalPrincipal = round2(rows.reduce((sum, row) => sum + row.principalPortion, 0));
    expect(totalPrincipal).toBe(200000);
  });

  it("first row's interest matches balance * monthly rate", () => {
    const { rows } = computeSegmentSchedule(segment, 0, 200000, 1, noOverrides());
    const r = 6 / 100 / 12;
    expect(rows[0]!.interestPortion).toBe(round2(200000 * r));
  });

  it('throws when the payment does not cover interest (negative amortization guard)', () => {
    const brokenSegment: Segment = {
      startDate: new Date('2020-01-01'),
      annualInterestRatePercent: 6,
      paymentAmount: 500, // 500 < 200000 * 0.005 = 1000 of interest
      startingBalance: 200000,
    };
    expect(() =>
      computeSegmentSchedule(brokenSegment, 0, 200000, 1, noOverrides()),
    ).toThrow(/never amortize/);
  });
});

describe('computeSegmentSchedule — bounded segment (termMonths set, e.g. a term before renewal)', () => {
  const segment: Segment = {
    startDate: new Date('2020-01-01'),
    annualInterestRatePercent: 6,
    amortizationMonthsRemaining: 300, // 25-year amortization
    termMonths: 60, // 5-year term
    startingBalance: 200000,
  };

  it('stops at exactly termMonths rows with a non-zero ending balance', () => {
    const { rows, endingBalance } = computeSegmentSchedule(segment, 0, 200000, 1, noOverrides());
    expect(rows).toHaveLength(60);
    expect(endingBalance).toBeGreaterThan(0);
  });

  it('matches the standard remaining-balance formula computed independently', () => {
    const { rows, endingBalance, monthlyPayment } = computeSegmentSchedule(
      segment,
      0,
      200000,
      1,
      noOverrides(),
    );
    const M = calculateMonthlyPayment(200000, 6, 300);
    expect(monthlyPayment).toBe(M);

    const r = 6 / 100 / 12;
    const k = 60;
    const factor = Math.pow(1 + r, k);
    // Standard closed-form remaining balance after k payments.
    const expectedBalance = round2(200000 * factor - M * ((factor - 1) / r));

    expect(endingBalance).toBeCloseTo(expectedBalance, 0); // within $1 of accumulated rounding
    expect(rows[rows.length - 1]!.remainingBalance).toBe(endingBalance);
  });
});

describe('computeSegmentSchedule — bounded segment overpaid before termMonths (early payoff)', () => {
  it('stops exactly at $0 instead of continuing into a negative balance with negative interest', () => {
    // Regression: a bounded (non-final) segment's payment large enough to retire the
    // balance before termMonths previously had no zero-forcing at all (isForcedFinalRow
    // was gated behind isFinalSegment), so it kept generating full payments past
    // payoff — driving the balance, and therefore interest (balance * r), negative.
    const segment: Segment = {
      startDate: new Date('2020-01-01'),
      annualInterestRatePercent: 6,
      paymentAmount: 2200,
      startingBalance: 20000,
      termMonths: 24, // far more months than needed to pay off $20,000 at $2,200/mo
    };
    const { rows, endingBalance } = computeSegmentSchedule(segment, 0, 20000, 1, noOverrides());

    expect(rows.length).toBeLessThan(24);
    expect(endingBalance).toBe(0);
    expect(rows[rows.length - 1]!.remainingBalance).toBe(0);
    expect(rows[rows.length - 1]!.principalPortion).toBeLessThanOrEqual(2200);
    expect(rows.every((row) => row.remainingBalance >= 0)).toBe(true);
    expect(rows.every((row) => row.interestPortion >= 0)).toBe(true);
  });
});

describe('computeSegmentSchedule — interest-only segment', () => {
  const segment: Segment = {
    startDate: new Date('2020-01-01'),
    annualInterestRatePercent: 6,
    termMonths: 12,
    startingBalance: 200000,
    interestOnly: true,
  };

  it('keeps principal at 0 and balance unchanged across every row', () => {
    const { rows, endingBalance, monthlyPayment } = computeSegmentSchedule(
      segment,
      0,
      200000,
      1,
      noOverrides(),
    );
    const r = 6 / 100 / 12;
    expect(rows).toHaveLength(12);
    expect(monthlyPayment).toBe(round2(200000 * r));
    expect(rows.every((row) => row.principalPortion === 0)).toBe(true);
    expect(rows.every((row) => row.remainingBalance === 200000)).toBe(true);
    expect(endingBalance).toBe(200000);
  });

  it("leaves a following renewal segment's startingBalance unchanged from the original principal", () => {
    const renewalSegment: Segment = {
      startDate: new Date('2021-01-01'),
      annualInterestRatePercent: 6,
      amortizationMonthsRemaining: 348,
    };
    const summary = summarizeMortgage({
      segments: [{ ...segment, startingBalance: 200000 }, renewalSegment],
    });
    expect(summary.segmentSummaries[1]!.startingBalance).toBe(200000);
  });

  it('throws when interestOnly is set without termMonths', () => {
    // Segment-level validation (validateSegment) runs in the mortgage engine, not in
    // computeSegmentSchedule itself — exercise it via summarizeMortgage.
    const invalidSegment: Segment = {
      startDate: new Date('2020-01-01'),
      annualInterestRatePercent: 6,
      startingBalance: 200000,
      interestOnly: true,
      // termMonths intentionally omitted
    };
    expect(() => summarizeMortgage({ segments: [invalidSegment] })).toThrow(RangeError);
  });
});

describe('computeSegmentSchedule — manual payment (payment-change case)', () => {
  it('uses the supplied payment as-is and pays down faster than the computed default', () => {
    const defaultSegment: Segment = {
      startDate: new Date('2020-01-01'),
      annualInterestRatePercent: 6,
      amortizationMonthsRemaining: 300,
      termMonths: 12,
      startingBalance: 200000,
    };
    const higherPaymentSegment: Segment = {
      ...defaultSegment,
      paymentAmount: 2000, // higher than the ~1288 the formula would compute
    };

    const { endingBalance: defaultEnding } = computeSegmentSchedule(
      defaultSegment,
      0,
      200000,
      1,
      noOverrides(),
    );
    const { rows, endingBalance: fasterEnding, monthlyPayment } = computeSegmentSchedule(
      higherPaymentSegment,
      0,
      200000,
      1,
      noOverrides(),
    );

    expect(monthlyPayment).toBe(2000);
    expect(rows.every((row) => row.paymentAmount === 2000)).toBe(true);
    expect(fasterEnding).toBeLessThan(defaultEnding);
  });
});
