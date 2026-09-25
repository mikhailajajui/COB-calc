import { describe, expect, it } from 'vitest';
import { calculateCobCanada } from '../../src/ca/cobCanada.js';
import type { CobCanadaInput, CobCanadaResult, Fee } from '../../src/index.js';

/**
 * Spec 011 (docs/new-req/011-app-engine-brd-changes.md) invariants I-011-1 ... I-011-9.
 * Expected values are the ones recorded in 011; tolerance 1e-9 relative (project
 * float tolerance). I-011-1's P1 numbers are recomputed after the D9/D8 and DQ-28
 * changes, as 011 requires: they equal both the engine and the macro oracle
 * (fixtures/d9_oracle_vectors.json, case P1_financed_only, which records C, P and the
 * COB rate derived from the oracle rows). I-011-10 ... I-011-14 are in spec011-d9.test.ts. I-011-8 / I-011-9 are PROVISIONAL (DQ-04 / DQ-05, OQ-011-2 /
 * OQ-011-3): flip or delete those two describe blocks if the answers change.
 */

const REL_TOL = 1e-9;

function expectRel(actual: number, expected: number): void {
  const scale = Math.max(Math.abs(expected), 1);
  expect(Math.abs(actual - expected) / scale).toBeLessThanOrEqual(REL_TOL);
}

/** 011 base input P0. */
function p0(overrides: Partial<CobCanadaInput> = {}): CobCanadaInput {
  return {
    flow: 'newMortgageOrLoan',
    productType: 'personalLoan',
    rateType: 'fixed',
    loanAmount: 10000,
    contractRatePercent: 6,
    paymentAmount: 500,
    paymentFrequency: 'monthly',
    disbursalDate: new Date('2026-01-01'),
    firstPaymentDate: new Date('2026-02-01'),
    endDate: new Date('2026-12-01'),
    termYears: 1,
    termMonths: 0,
    fees: { fees: [] },
    ...overrides,
  };
}

const ADMIN_FINANCED: Fee = { name: 'Admin', amount: 300, financed: true, includedInCob: true };
const APPRAISAL_NON_FINANCED: Fee = { name: 'Appraisal', amount: 200, financed: false, includedInCob: true };

function p1(includedInCob = true): CobCanadaInput {
  return p0({
    fees: {
      fees: [
        { ...ADMIN_FINANCED, includedInCob },
        { ...APPRAISAL_NON_FINANCED, includedInCob },
      ],
    },
  });
}

function p2(): CobCanadaInput {
  return p0({ fees: { fees: [APPRAISAL_NON_FINANCED] } });
}

/** 011 renewal input R (used by the provisional I-011-8 / I-011-9). */
function r(overrides: Partial<CobCanadaInput> = {}): CobCanadaInput {
  const base = p0({ flow: 'renewal', renewalDate: new Date('2026-01-01') });
  delete base.disbursalDate;
  return { ...base, ...overrides };
}

function averageOpeningBalance(result: CobCanadaResult): number {
  const rows = result.amortizationSchedule;
  return rows.reduce((sum, row) => sum + row.openingBalance, 0) / rows.length;
}

/** Every field except the two that N is allowed to move (cobAmount, cobRatePercent). */
function withoutCobFields(result: CobCanadaResult): Omit<CobCanadaResult, 'cobAmount' | 'cobRatePercent'> {
  const { cobAmount: _c, cobRatePercent: _r, ...rest } = result;
  return rest;
}

describe('011 P0 baseline (no fees)', () => {
  it('matches the P0 result recorded in 011', () => {
    const res = calculateCobCanada(p0());
    expect(res.numberOfPayments).toBe(11);
    expectRel(res.totalPayment, 5500);
    expectRel(res.totalInterest, 423.10535935910775);
    expect(res.feesRecovered).toBe(0);
    expectRel(res.principalPayment, 5076.894640640892);
    expectRel(res.cobAmount, 423.10535935910775);
    expectRel(res.cobRatePercent, 5.999999999999872);
    expect(res.termDays).toBe(334);
    expectRel(res.endingBalance, 4923.105359359108);
  });
});

describe('I-011-1 NONFIN-NOT-IN-WATERFALL (DQ-27, IN-07, BR-04)', () => {
  it('P1: only the financed fee is recovered through the waterfall', () => {
    const res = calculateCobCanada(p1());
    expect(res.numberOfPayments).toBe(11);
    expectRel(res.totalPayment, 5500);
    expectRel(res.totalInterest, 423.10535935910775);
    expectRel(res.feesRecovered, 300);
    expectRel(res.principalPayment, 4776.894640640891);
    expectRel(res.cobAmount, 923.1053593591078);
    expectRel(res.cobRatePercent, 13.076460766330712);
    expect(res.termDays).toBe(334);
    expect(res.disbursalAmount).toBe(9700);
    expect(res.amortizedPrincipal).toBe(10000);
    expectRel(res.endingBalance, 4923.105359359108);
    expectRel(averageOpeningBalance(res), 7714.494165652633);

    const row1 = res.amortizationSchedule[0]!;
    expect(row1.feesOpening).toBe(300);
    expectRel(row1.interestPaid, 50.958904109587955);
    expectRel(row1.feesPaid, 300);
    expectRel(row1.principalPortion, 149.04109589041207);
    expectRel(row1.closingBalance, 9550.958904109588);
  });

  it('every row carries feesOpening/feesPaid/feesClosing bounded by the financed fees only', () => {
    const res = calculateCobCanada(p1());
    for (const row of res.amortizationSchedule) {
      expect(row.feesOpening).toBeLessThanOrEqual(300);
      expect(row.feesPaid).toBeLessThanOrEqual(300);
      expect(row.feesClosing).toBeLessThanOrEqual(300);
    }
  });
});

describe('I-011-2 NONFIN-ONLY-IN-C (DQ-27)', () => {
  it('P2 (non-financed fee only): schedule and every non-COB field equal P0; C and COB rate recorded in 011', () => {
    const withFee = calculateCobCanada(p2());
    const without = calculateCobCanada(p0());
    expect(withoutCobFields(withFee)).toEqual(withoutCobFields(without));
    expect(withFee.disbursalAmount).toBe(10000);
    expectRel(withFee.cobAmount, 623.1053593591078);
    expectRel(withFee.cobAmount, without.totalInterest + 0 + 200);
    // General branch (F + N > 0), P = 7714.494165652633, T = 334/365.
    expectRel(averageOpeningBalance(withFee), 7714.494165652633);
    expectRel(withFee.cobRatePercent, 8.826741933994144);
  });

  it('P1 vs P1 with the non-financed fee removed: identical except cobAmount = totalInterest + F + N', () => {
    const withN = calculateCobCanada(p1());
    const withoutN = calculateCobCanada(p0({ fees: { fees: [ADMIN_FINANCED] } }));
    expect(withoutCobFields(withN)).toEqual(withoutCobFields(withoutN));
    expectRel(withN.cobAmount, withoutN.totalInterest + 300 + 200);
  });

  it('boundary: a $0 non-financed fee changes nothing, including the F + N = 0 short-circuit', () => {
    const zeroFee = calculateCobCanada(p0({ fees: { fees: [{ ...APPRAISAL_NON_FINANCED, amount: 0 }] } }));
    expect(zeroFee).toEqual(calculateCobCanada(p0()));
  });
});

describe('I-011-3 RECONCILIATION (006 invariant 2)', () => {
  it.each([
    ['P0', p0()],
    ['P1', p1()],
    ['P2', p2()],
  ] as const)('%s: totalPayment == totalInterest + feesRecovered + principalPayment', (_label, input) => {
    const res = calculateCobCanada(input);
    expectRel(res.totalInterest + res.feesRecovered + res.principalPayment, res.totalPayment);
  });
});

describe('I-011-4 DISBURSAL (IN-06, IN-07)', () => {
  it('disbursalAmount = loanAmount - F, independent of N', () => {
    expect(calculateCobCanada(p1()).disbursalAmount).toBe(9700);
    expect(calculateCobCanada(p2()).disbursalAmount).toBe(10000);
  });
});

describe('I-011-5 INCLUDEDINCOB-VALUE-IGNORED (DQ-02, B.7)', () => {
  it('P1 with includedInCob false on every fee is identical to P1', () => {
    expect(calculateCobCanada(p1(false))).toEqual(calculateCobCanada(p1(true)));
  });
});

describe('I-011-6 INCLUDEDINCOB-REQUIRED (DQ-02, 010 wire)', () => {
  it('a fee without includedInCob is rejected', () => {
    const fee = { name: 'X', amount: 1, financed: false } as Fee;
    expect(() => calculateCobCanada(p0({ fees: { fees: [fee] } }))).toThrow(RangeError);
    expect(() => calculateCobCanada(p0({ fees: { fees: [fee] } }))).toThrow(
      /X\.includedInCob must be explicitly true or false/,
    );
  });

  it('a negative fee amount is rejected', () => {
    const fee: Fee = { name: 'X', amount: -1, financed: false, includedInCob: true };
    expect(() => calculateCobCanada(p0({ fees: { fees: [fee] } }))).toThrow(RangeError);
    expect(() => calculateCobCanada(p0({ fees: { fees: [fee] } }))).toThrow(/X amount must be >= 0, got -1/);
  });
});

describe('I-011-7 REQUIRED-INPUTS (DQ-03)', () => {
  it('termYears 0 and termMonths 0 together are rejected', () => {
    expect(() => calculateCobCanada(p0({ termYears: 0, termMonths: 0 }))).toThrow(RangeError);
    expect(() => calculateCobCanada(p0({ termYears: 0, termMonths: 0 }))).toThrow(/must not both be 0/);
  });

  it('termMonths 12 is rejected', () => {
    expect(() => calculateCobCanada(p0({ termMonths: 12 }))).toThrow(/must be an integer in \[0, 11\]/);
  });

  it('missing termYears is rejected', () => {
    const input = p0() as Partial<CobCanadaInput>;
    delete input.termYears;
    expect(() => calculateCobCanada(input as CobCanadaInput)).toThrow(
      /must be a non-negative integer, got undefined/,
    );
  });

  it('missing endDate is rejected', () => {
    const input = p0() as Partial<CobCanadaInput>;
    delete input.endDate;
    expect(() => calculateCobCanada(input as CobCanadaInput)).toThrow(/endDate must be a valid Date/);
  });

  it('a fixed mortgage without semiAnnualCompoundingDate is rejected', () => {
    expect(() => calculateCobCanada(p0({ productType: 'mortgage' }))).toThrow(/requires semiAnnualCompoundingDate/);
  });

  it('a variable mortgage without semiAnnualCompoundingDate passes validation', () => {
    expect(() => calculateCobCanada(p0({ productType: 'mortgage', rateType: 'variable' }))).not.toThrow();
  });
});

describe('I-011-8 ACCRUED-DEFAULT [PROVISIONAL: DQ-04 / OQ-011-2]', () => {
  it('renewal without accruedInterest equals renewal with accruedInterest 0', () => {
    expect(calculateCobCanada(r())).toEqual(calculateCobCanada(r({ accruedInterest: 0 })));
  });

  it('renewal with accruedInterest 50 matches the values recorded in 011', () => {
    const res = calculateCobCanada(r({ accruedInterest: 50 }));
    const row1 = res.amortizationSchedule[0]!;
    expectRel(row1.interestPaid, 100.95890410958796);
    expectRel(row1.principalPortion, 399.04109589041207);
    expectRel(res.totalInterest, 475.65233184817885);
    expectRel(res.endingBalance, 4975.652331848177);
  });

  it('negative accruedInterest is rejected', () => {
    expect(() => calculateCobCanada(r({ accruedInterest: -0.01 }))).toThrow(RangeError);
  });

  it('accruedInterest is ignored for the new-mortgage flow', () => {
    expect(calculateCobCanada(p0({ accruedInterest: 50 }))).toEqual(calculateCobCanada(p0()));
  });
});

describe('I-011-9 PC-START-DATE [PROVISIONAL: DQ-05 / OQ-011-3]', () => {
  it('paymentChange starts at renewalDate, exactly like renewal', () => {
    expect(calculateCobCanada(r({ flow: 'paymentChange', accruedInterest: 50 }))).toEqual(
      calculateCobCanada(r({ accruedInterest: 50 })),
    );
  });

  it('paymentChange without renewalDate is rejected', () => {
    const input = r({ flow: 'paymentChange', accruedInterest: 50 });
    delete input.renewalDate;
    expect(() => calculateCobCanada(input)).toThrow(/flow 'paymentChange' requires renewalDate/);
  });

  it('paymentChange with renewalDate after firstPaymentDate is rejected', () => {
    const input = r({ flow: 'paymentChange', accruedInterest: 50, renewalDate: new Date('2026-02-02') });
    expect(() => calculateCobCanada(input)).toThrow(/renewalDate must be on or before firstPaymentDate/);
  });
});
