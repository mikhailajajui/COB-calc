import { describe, expect, it } from 'vitest';
import { computeMortgageSchedule, summarizeMortgage } from '../src/mortgage.js';
import { addMonths } from '../src/segment.js';
import type { MortgageInput, Segment } from '../src/types.js';

describe('summarizeMortgage — renewal', () => {
  const segment1: Segment = {
    startDate: new Date('2015-01-01'),
    annualInterestRatePercent: 5,
    amortizationMonthsRemaining: 300, // 25-year amortization
    termMonths: 60, // 5-year term
    startingBalance: 200000,
  };
  const segment2: Segment = {
    startDate: new Date('2020-01-01'),
    annualInterestRatePercent: 4, // renewed at a new rate
    amortizationMonthsRemaining: 240, // remaining 20 years
    // no termMonths: runs to payoff
  };
  const input: MortgageInput = { segments: [segment1, segment2] };

  it("carries segment 1's ending balance into segment 2's starting balance", () => {
    const summary = summarizeMortgage(input);
    expect(summary.segmentSummaries[0]!.endingBalance).toBe(
      summary.segmentSummaries[1]!.startingBalance,
    );
    expect(summary.segmentSummaries[0]!.endingBalance).toBeGreaterThan(0);
  });

  it('only reaches zero balance at the very last row of the whole schedule', () => {
    const summary = summarizeMortgage(input);
    const row60 = summary.schedule[59]!; // last row of segment 1
    expect(row60.remainingBalance).toBeGreaterThan(0);

    const lastRow = summary.schedule[summary.schedule.length - 1]!;
    expect(lastRow.remainingBalance).toBe(0);
    expect(summary.payoffDate).toEqual(lastRow.paymentDate);
  });

  it('numbers payments globally and continuously across the renewal boundary', () => {
    const summary = summarizeMortgage(input);
    expect(summary.schedule[59]!.paymentNumber).toBe(60);
    expect(summary.schedule[60]!.paymentNumber).toBe(61);
    expect(summary.schedule[59]!.segmentIndex).toBe(0);
    expect(summary.schedule[60]!.segmentIndex).toBe(1);
  });
});

describe('summarizeMortgage — payment change', () => {
  const base: Segment = {
    startDate: new Date('2020-01-01'),
    annualInterestRatePercent: 5,
    amortizationMonthsRemaining: 300,
    termMonths: 12,
    startingBalance: 200000,
  };

  it('a manually higher payment in the renewal segment pays off faster than the unchanged control', () => {
    const controlSegment2: Segment = {
      startDate: addMonths(base.startDate, 12),
      annualInterestRatePercent: 5,
      amortizationMonthsRemaining: 288,
      // no termMonths: runs to payoff at the formula-derived payment
    };
    const changedSegment2: Segment = {
      ...controlSegment2,
      paymentAmount: 1800, // higher than the amortization-derived payment
      amortizationMonthsRemaining: undefined,
    };

    const controlSchedule = computeMortgageSchedule({ segments: [base, controlSegment2] });
    const changedSchedule = computeMortgageSchedule({ segments: [base, changedSegment2] });

    expect(changedSchedule.length).toBeLessThan(controlSchedule.length);
    expect(changedSchedule[changedSchedule.length - 1]!.remainingBalance).toBe(0);
  });
});

describe('summarizeMortgage — variable rate change mid-term', () => {
  it('starts a new segment before the nominal term would have finished, with clean continuity', () => {
    const segment1: Segment = {
      startDate: new Date('2020-01-01'),
      annualInterestRatePercent: 3,
      amortizationMonthsRemaining: 300,
      termMonths: 13, // shorter than a typical 5-year renewal
      startingBalance: 200000,
    };
    const segment2: Segment = {
      startDate: addMonths(segment1.startDate, 13),
      annualInterestRatePercent: 5, // the variable rate moved up
      amortizationMonthsRemaining: 287,
    };

    const summary = summarizeMortgage({ segments: [segment1, segment2] });
    expect(summary.schedule[12]!.segmentIndex).toBe(0); // 13th payment, 0-indexed
    expect(summary.schedule[13]!.segmentIndex).toBe(1);
    expect(summary.schedule[13]!.paymentDate).toEqual(segment2.startDate);
    expect(summary.segmentSummaries[1]!.startingBalance).toBe(
      summary.segmentSummaries[0]!.endingBalance,
    );
  });
});

describe('summarizeMortgage — manual row override', () => {
  const input: MortgageInput = {
    segments: [
      {
        startDate: new Date('2020-01-01'),
        annualInterestRatePercent: 6,
        amortizationMonthsRemaining: 360,
        startingBalance: 200000,
      },
    ],
    manualOverrides: [{ paymentNumber: 5, interestPortion: 950, principalPortion: 250 }],
  };

  it('applies the override to the specified row and propagates the resulting balance forward', () => {
    const summary = summarizeMortgage(input);
    const overriddenRow = summary.schedule[4]!; // payment #5
    expect(overriddenRow.isManualOverride).toBe(true);
    expect(overriddenRow.interestPortion).toBe(950);
    expect(overriddenRow.principalPortion).toBe(250);
    expect(overriddenRow.paymentAmount).toBe(1200);

    const nextRow = summary.schedule[5]!; // payment #6, computed normally from the override's balance
    const r = 6 / 100 / 12;
    expect(nextRow.interestPortion).toBeCloseTo(overriddenRow.remainingBalance * r, 2);
    expect(nextRow.isManualOverride).toBe(false);
  });

  it('still reaches exactly zero balance at the final payment despite the mid-schedule override', () => {
    const summary = summarizeMortgage(input);
    const lastRow = summary.schedule[summary.schedule.length - 1]!;
    expect(lastRow.remainingBalance).toBe(0);
  });
});

describe('summarizeMortgage — fundamental payment identity holds across segments/overrides', () => {
  it('totalOfPayments === totalInterestPaid + original principal, with a renewal and an override', () => {
    const segment1: Segment = {
      startDate: new Date('2018-01-01'),
      annualInterestRatePercent: 4,
      amortizationMonthsRemaining: 300,
      termMonths: 24,
      startingBalance: 150000,
    };
    const segment2: Segment = {
      startDate: addMonths(segment1.startDate, 24),
      annualInterestRatePercent: 5,
      amortizationMonthsRemaining: 276,
    };
    const summary = summarizeMortgage({
      segments: [segment1, segment2],
      manualOverrides: [{ paymentNumber: 10, remainingBalance: 145000 }],
    });

    expect(summary.totalOfPayments).toBeCloseTo(
      summary.totalInterestPaid + segment1.startingBalance!,
      2,
    );
  });
});

describe('summarizeMortgage — lump sum payments', () => {
  const segment1: Segment = {
    startDate: new Date('2015-01-01'),
    annualInterestRatePercent: 5,
    amortizationMonthsRemaining: 300,
    termMonths: 60,
    startingBalance: 200000,
  };
  const segment2WithAmortization: Segment = {
    startDate: addMonths(segment1.startDate, 60),
    annualInterestRatePercent: 4,
    amortizationMonthsRemaining: 240,
  };

  it("applies a lump sum at a renewal boundary, curtailing the next segment's starting balance and shortening its payoff", () => {
    const lumpSumAmount = 20000;

    // Derive a representative fixed renewal payment from an un-lumped run first, so
    // the renewal segment below is open-ended at a *fixed* payment (paymentAmount) —
    // isolating the lump sum's effect on payoff length, rather than on the
    // amortizationMonthsRemaining case, where the payment is re-sized to still span
    // exactly the chosen number of months regardless of starting balance.
    const probe = summarizeMortgage({ segments: [segment1, segment2WithAmortization] });
    const renewalPayment = probe.segmentSummaries[1]!.monthlyPayment;
    const segment2: Segment = {
      startDate: addMonths(segment1.startDate, 60),
      annualInterestRatePercent: 4,
      paymentAmount: renewalPayment,
    };

    const control = summarizeMortgage({ segments: [segment1, segment2] });
    const withLumpSum = summarizeMortgage({
      segments: [segment1, segment2],
      lumpSumPayments: [{ afterPaymentNumber: 60, amount: lumpSumAmount }],
    });

    expect(withLumpSum.segmentSummaries[1]!.startingBalance).toBeCloseTo(
      control.segmentSummaries[0]!.endingBalance - lumpSumAmount,
      2,
    );
    expect(withLumpSum.numberOfPayments).toBeLessThan(control.numberOfPayments);
  });

  it('fully pays off the loan at the boundary when the lump sum exceeds the balance owed', () => {
    const shortSegment1: Segment = {
      startDate: new Date('2022-01-01'),
      annualInterestRatePercent: 6,
      amortizationMonthsRemaining: 360,
      termMonths: 12,
      startingBalance: 200000,
    };
    const shortSegment2: Segment = {
      startDate: addMonths(shortSegment1.startDate, 12),
      annualInterestRatePercent: 5,
      amortizationMonthsRemaining: 348,
    };

    const result = summarizeMortgage({
      segments: [shortSegment1, shortSegment2],
      lumpSumPayments: [{ afterPaymentNumber: 12, amount: 10_000_000 }],
    });

    expect(result.numberOfPayments).toBe(12);
    expect(result.schedule[result.schedule.length - 1]!.remainingBalance).toBe(0);
    expect(result.payoffDate).toEqual(result.schedule[11]!.paymentDate);
  });

  it('throws when afterPaymentNumber does not land on a segment boundary', () => {
    expect(() =>
      summarizeMortgage({
        segments: [segment1, segment2WithAmortization],
        lumpSumPayments: [{ afterPaymentNumber: 45, amount: 1000 }],
      }),
    ).toThrow(RangeError);
  });
});

describe('summarizeMortgage — balloon payment', () => {
  it('reports the standard remaining-balance formula as balloonPaymentDue', () => {
    const segment: Segment = {
      startDate: new Date('2020-01-01'),
      annualInterestRatePercent: 6,
      amortizationMonthsRemaining: 360,
      termMonths: 84,
      startingBalance: 500000,
      balloon: true,
    };
    const summary = summarizeMortgage({ segments: [segment] });

    const M = summary.segmentSummaries[0]!.monthlyPayment;
    const r = 6 / 100 / 12;
    const factor = Math.pow(1 + r, 84);
    const expectedBalance = 500000 * factor - M * ((factor - 1) / r);

    expect(summary.balloonPaymentDue).toBeDefined();
    expect(summary.balloonPaymentDue!.amount).toBeCloseTo(expectedBalance, 0);
    expect(summary.balloonPaymentDue!.amount).toBeGreaterThan(0);
    expect(summary.balloonPaymentDue!.segmentIndex).toBe(0);
    expect(summary.balloonPaymentDue!.dueDate).toEqual(
      summary.schedule[summary.schedule.length - 1]!.paymentDate,
    );
  });

  it('still reports balloonPaymentDue (~0) when termMonths equals the full amortization length', () => {
    const segment: Segment = {
      startDate: new Date('2020-01-01'),
      annualInterestRatePercent: 6,
      amortizationMonthsRemaining: 360,
      termMonths: 360,
      startingBalance: 200000,
      balloon: true,
    };
    const summary = summarizeMortgage({ segments: [segment] });
    expect(summary.balloonPaymentDue).toBeDefined();
    // No forced-zero final row applies here (isFinalSegment is false for a balloon
    // segment), so cent rounding accumulated over 360 payments can leave a small
    // residual rather than exactly 0 — assert it's small relative to the loan size.
    expect(Math.abs(summary.balloonPaymentDue!.amount)).toBeLessThan(5);
  });

  it('throws when balloon is true without termMonths', () => {
    const segment: Segment = {
      startDate: new Date('2020-01-01'),
      annualInterestRatePercent: 6,
      amortizationMonthsRemaining: 360,
      startingBalance: 500000,
      balloon: true,
    };
    expect(() => summarizeMortgage({ segments: [segment] })).toThrow(RangeError);
  });
});

describe('summarizeMortgage — PMI auto-drop at 80% LTV', () => {
  const baseSegment: Segment = {
    startDate: new Date('2020-01-01'),
    annualInterestRatePercent: 6,
    amortizationMonthsRemaining: 360,
    startingBalance: 450000,
  };

  it('charges PMI while LTV > 80% and drops it once the balance falls to 80% LTV', () => {
    const summary = summarizeMortgage({
      segments: [baseSegment],
      pmi: { annualRatePercent: 0.8, propertyValue: 500000 },
    });

    expect(summary.schedule[0]!.pmiPortion).toBe(300); // 450000 * 0.008 / 12
    expect(summary.costBreakdown!.pmiDroppedAtPaymentNumber).toBeDefined();

    const dropRow = summary.costBreakdown!.pmiDroppedAtPaymentNumber!;
    expect(summary.schedule[dropRow - 1]!.pmiPortion).toBe(0);
    expect(summary.schedule[dropRow - 2]!.pmiPortion).toBeGreaterThan(0);
  });

  it('never charges PMI when starting LTV is already at or under 80%', () => {
    const summary = summarizeMortgage({
      segments: [{ ...baseSegment, startingBalance: 380000 }], // 380000/500000 = 76%
      pmi: { annualRatePercent: 0.8, propertyValue: 500000 },
    });

    expect(summary.schedule[0]!.pmiPortion).toBe(0);
    expect(summary.costBreakdown!.pmiDroppedAtPaymentNumber).toBeUndefined();
  });

  it("doesn't change totalOfPayments/totalInterestPaid (P&I) versus a run without pmi/recurringCosts", () => {
    const withPmi = summarizeMortgage({
      segments: [baseSegment],
      pmi: { annualRatePercent: 0.8, propertyValue: 500000 },
      recurringCosts: { propertyTax: { annualAmount: 3600 } },
    });
    const withoutPmi = summarizeMortgage({ segments: [baseSegment] });

    expect(withPmi.totalOfPayments).toBe(withoutPmi.totalOfPayments);
    expect(withPmi.totalInterestPaid).toBe(withoutPmi.totalInterestPaid);
  });

  it('throws when pmi.propertyValue is not positive', () => {
    expect(() =>
      summarizeMortgage({
        segments: [baseSegment],
        pmi: { annualRatePercent: 0.8, propertyValue: 0 },
      }),
    ).toThrow(RangeError);
  });
});

describe('summarizeMortgage — a bounded segment paid off before its renewal', () => {
  it('stops the whole mortgage at exact payoff instead of running the renewal against a negative balance', () => {
    // Regression, composed at the mortgage level: segment 1's overpayment retires the
    // loan well before its 24-month term; segment 2 (a renewal) must never run.
    const segment1: Segment = {
      startDate: new Date('2020-01-01'),
      annualInterestRatePercent: 6,
      paymentAmount: 2200,
      startingBalance: 20000,
      termMonths: 24,
    };
    const segment2: Segment = {
      startDate: addMonths(segment1.startDate, 24),
      annualInterestRatePercent: 5,
      amortizationMonthsRemaining: 120,
    };

    const summary = summarizeMortgage({ segments: [segment1, segment2] });

    expect(summary.numberOfPayments).toBeLessThan(24);
    expect(summary.schedule[summary.schedule.length - 1]!.remainingBalance).toBe(0);
    expect(summary.schedule.every((row) => row.remainingBalance >= 0)).toBe(true);
    expect(summary.schedule.every((row) => row.interestPortion >= 0)).toBe(true);
    expect(summary.schedule.every((row) => row.segmentIndex === 0)).toBe(true);
    expect(summary.segmentSummaries).toHaveLength(1); // segment 2 (the renewal) never ran
  });
});

describe('MortgageInput validation', () => {
  it('throws when a non-last segment is missing termMonths', () => {
    const segments: Segment[] = [
      {
        startDate: new Date('2020-01-01'),
        annualInterestRatePercent: 5,
        amortizationMonthsRemaining: 300,
        startingBalance: 200000,
        // missing termMonths, but this is not the last segment
      },
      {
        startDate: new Date('2025-01-01'),
        annualInterestRatePercent: 4,
        amortizationMonthsRemaining: 240,
      },
    ];
    expect(() => computeMortgageSchedule({ segments })).toThrow(RangeError);
  });

  it('throws when a segment specifies neither paymentAmount nor amortizationMonthsRemaining', () => {
    const segments: Segment[] = [
      {
        startDate: new Date('2020-01-01'),
        annualInterestRatePercent: 5,
        startingBalance: 200000,
      },
    ];
    expect(() => computeMortgageSchedule({ segments })).toThrow(RangeError);
  });

  it('throws when startingBalance is set on a non-first segment', () => {
    const segments: Segment[] = [
      {
        startDate: new Date('2020-01-01'),
        annualInterestRatePercent: 5,
        amortizationMonthsRemaining: 300,
        termMonths: 60,
        startingBalance: 200000,
      },
      {
        startDate: new Date('2025-01-01'),
        annualInterestRatePercent: 4,
        amortizationMonthsRemaining: 240,
        startingBalance: 999999,
      },
    ];
    expect(() => computeMortgageSchedule({ segments })).toThrow(RangeError);
  });

  it('throws when a manual override references a payment number beyond the schedule length', () => {
    const segments: Segment[] = [
      {
        startDate: new Date('2020-01-01'),
        annualInterestRatePercent: 5,
        amortizationMonthsRemaining: 12,
        startingBalance: 20000,
      },
    ];
    expect(() =>
      computeMortgageSchedule({ segments, manualOverrides: [{ paymentNumber: 999 }] }),
    ).toThrow(RangeError);
  });

  it('throws when the last segment has a termMonths, instead of silently leaving the loan unpaid', () => {
    // Regression case: a single segment with a manual payment and a termMonths cap
    // used to stop partway through with a large nonzero balance while summarizeMortgage
    // still reported a "payoff date" and totals as if the loan were fully paid off.
    const segments: Segment[] = [
      {
        startDate: new Date('2024-01-01'),
        annualInterestRatePercent: 6,
        paymentAmount: 1199,
        startingBalance: 200000,
        termMonths: 10,
      },
    ];
    expect(() => computeMortgageSchedule({ segments })).toThrow(
      /must be omitted on the last segment/,
    );
  });
});
