/**
 * B13 (COB-architecture.md §5 B13, revision 6): a zero-day COB-rate term says why it is rejected.
 * Message-only change (parity: the macro divides by zero at line 569 because termDay, line 554,
 * is 0; line 271 allows first payment = disbursal date). Wording is interim under Q-MSG, so the
 * tests match /COB-rate term is 0 days/ and /disbursalDate|renewalDate/, never the full string.
 * QA step written 2026-09-28, before the developer step.
 *
 * Red before B13: B13-1 ... B13-5 (today they throw "termYears must be > 0, got 0" from
 * cobRatePercent). Green before and after: B13-6 ... B13-8.
 *
 * Base inputs (spec): loan 250,000, mortgage/variable, 5.19%, termYears 5, termMonths 0,
 * monthly 1,300 unless stated; F = one financed fee of 2,000.
 */
import { describe, expect, it } from 'vitest';
import { calculateCobCanada } from '../../src/ca/index.js';
import type { CobCanadaInput, Fee } from '../../src/ca/index.js';
import { utcDate } from './support/builders.js';

const d = utcDate;
const F: Fee = { name: 'F', amount: 2000, financed: true, includedInCob: true };
const CASH500: Fee = { name: 'C', amount: 500, financed: false, includedInCob: true };

function input(over: Omit<Partial<CobCanadaInput>, 'fees'> & { fees?: Fee[] } = {}): CobCanadaInput {
  const { fees, ...rest } = over;
  return {
    flow: 'newMortgageOrLoan',
    productType: 'mortgage',
    rateType: 'variable',
    contractRatePercent: 5.19,
    paymentFrequency: 'monthly',
    paymentAmount: 1300,
    loanAmount: 250000,
    fees: { fees: fees ?? [F] },
    disbursalDate: d('2027-01-01'),
    firstPaymentDate: d('2027-01-01'),
    endDate: d('2027-01-02'),
    termYears: 5,
    termMonths: 0,
    ...rest,
  } as CobCanadaInput;
}

/** Runs the engine and returns the thrown error (fails the test if nothing is thrown). */
function thrown(inp: CobCanadaInput): Error {
  try {
    calculateCobCanada(inp);
  } catch (e) {
    return e as Error;
  }
  throw new Error('expected calculateCobCanada to throw, but it returned');
}

/** "Throws B13": a RangeError matching both interim regexes (spec B13 invariants preamble). */
function expectB13(err: Error): void {
  expect(err).toBeInstanceOf(RangeError);
  expect(err.message).toMatch(/COB-rate term is 0 days/);
  expect(err.message).toMatch(/disbursalDate|renewalDate/);
  expect(err.message).not.toMatch(/termYears must be > 0/);
}

describe('B13 red: start date = only payment date with fees -> a RangeError naming the cause (was "termYears must be > 0, got 0")', () => {
  it('B13-1: F, disbursal = first = 2027-01-01, end 2027-01-02 -> throws B13 naming disbursalDate', () => {
    const err = thrown(input());
    expectB13(err);
    expect(err.message).toMatch(/disbursalDate/);
    expect(err.message).not.toMatch(/renewalDate/);
  });

  it('B13-2: F, disbursal = first, end 2027-01-31 (one monthly row) -> throws B13', () => {
    expectB13(thrown(input({ endDate: d('2027-01-31') })));
  });

  it('B13-3: F, disbursal = first, weekly 300, end 2027-01-07 -> throws B13', () => {
    expectB13(thrown(input({ paymentFrequency: 'weekly', paymentAmount: 300, endDate: d('2027-01-07') })));
  });

  it('B13-4: a cash fee of 500 only, disbursal = first, end 2027-01-02 -> throws B13', () => {
    expectB13(thrown(input({ fees: [CASH500] })));
  });

  it('B13-5: flow renewal, F, renewal = first = 2027-01-01, end 2027-01-02 -> throws B13 naming renewalDate', () => {
    const err = thrown(input({ flow: 'renewal', disbursalDate: undefined, renewalDate: d('2027-01-01'), accruedInterest: 0 }));
    expectB13(err);
    expect(err.message).toMatch(/renewalDate/);
    expect(err.message).not.toMatch(/disbursalDate/);
  });
});

describe('B13 unchanged (green before and after)', () => {
  it('B13-6: no fees, disbursal = first, end 2027-01-02 -> 1 row, termDays 0, cobRatePercent 5.19', () => {
    const r = calculateCobCanada(input({ fees: [] }));
    expect(r.numberOfPayments).toBe(1);
    expect(r.amortizationSchedule).toHaveLength(1);
    expect(r.termDays).toBe(0);
    // zero-fee short-circuit: calculatedRateDecimal * 100 (monthly basis, 5.19 / 100 * 100)
    expect(r.cobRatePercent).toBeCloseTo(5.19, 12);
  });

  it('B13-7: F, disbursal = 2026-12-31, end 2027-01-02 -> 1 row, termDays 1, no throw', () => {
    const r = calculateCobCanada(input({ disbursalDate: d('2026-12-31') }));
    expect(r.numberOfPayments).toBe(1);
    expect(r.termDays).toBe(1);
    expect(Number.isFinite(r.cobRatePercent)).toBe(true);
  });

  it('B13-8: F, disbursal = first, end 2027-02-10 -> 2 rows, termDays 31, no throw', () => {
    const r = calculateCobCanada(input({ endDate: d('2027-02-10') }));
    expect(r.numberOfPayments).toBe(2);
    expect(r.termDays).toBe(31);
    expect(Number.isFinite(r.cobRatePercent)).toBe(true);
  });
});
