import { describe, expect, it } from 'vitest';
import {
  totalCashFees,
  totalFees,
  totalFeesIncludedInCob,
  totalFinancedFees,
  validateFee,
  validateFeeSchedule,
} from '../../src/ca/fees.js';
import type { Fee, FeeSchedule } from '../../src/ca/fees.js';

// A schedule deliberately mirroring spec 006's own example (mortgage default
// insurance: financed but NOT COB-included; an appraisal fee: COB-included but NOT
// financed) so the two flags visibly don't coincide.
const schedule: FeeSchedule = {
  fees: [
    { name: 'CMHC premium', amount: 19000, financed: true, includedInCob: false },
    { name: 'Appraisal fee', amount: 400, financed: false, includedInCob: true },
    { name: 'Discharge fee (prior lender)', amount: 250, financed: false, includedInCob: false },
  ],
};

describe('FeeSchedule aggregates', () => {
  it('happy path: sums each aggregate independently by its own flag', () => {
    expect(totalFees(schedule)).toBe(19650);
    expect(totalFinancedFees(schedule)).toBe(19000);
    expect(totalCashFees(schedule)).toBe(650);
    expect(totalFeesIncludedInCob(schedule)).toBe(400);
  });

  it('edge case: an empty fee list totals to zero everywhere', () => {
    const empty: FeeSchedule = { fees: [] };
    expect(totalFees(empty)).toBe(0);
    expect(totalFinancedFees(empty)).toBe(0);
    expect(totalCashFees(empty)).toBe(0);
    expect(totalFeesIncludedInCob(empty)).toBe(0);
  });

  it('a fee with includedInCob left undefined contributes 0 to totalFeesIncludedInCob', () => {
    const withUnset: FeeSchedule = {
      fees: [{ name: 'Legacy US-style fee', amount: 500, financed: false }],
    };
    expect(totalFeesIncludedInCob(withUnset)).toBe(0);
    expect(totalCashFees(withUnset)).toBe(500);
  });
});

describe('validateFee', () => {
  it('happy path: a fully-specified fee passes', () => {
    expect(() => validateFee({ name: 'Appraisal', amount: 400, financed: false, includedInCob: true }, 0)).not.toThrow();
  });

  it('edge case: a zero-amount fee is valid (boundary, not negative)', () => {
    expect(() => validateFee({ name: 'Waived fee', amount: 0, financed: false, includedInCob: false }, 0)).not.toThrow();
  });

  it('throws RangeError on a negative amount', () => {
    expect(() => validateFee({ name: 'Bad fee', amount: -1, financed: false, includedInCob: false }, 0)).toThrow(
      RangeError,
    );
  });

  it('throws RangeError when includedInCob is left unset -- no safe default for a Canadian flow', () => {
    const fee = { name: 'Ambiguous fee', amount: 100, financed: false } as Fee;
    expect(() => validateFee(fee, 0)).toThrow(RangeError);
  });

  it('validateFeeSchedule validates every fee in the list', () => {
    const bad: FeeSchedule = {
      fees: [
        { name: 'Ok fee', amount: 100, financed: false, includedInCob: true },
        { name: 'Bad fee', amount: -5, financed: false, includedInCob: true },
      ],
    };
    expect(() => validateFeeSchedule(bad)).toThrow(RangeError);
  });
});
