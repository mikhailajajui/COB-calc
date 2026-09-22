import { describe, expect, it } from 'vitest';
import { validateCobCanadaInput } from '../../src/ca/validate.js';
import type { CobCanadaInput } from '../../src/ca/types.js';

function baseInput(overrides: Partial<CobCanadaInput> = {}): CobCanadaInput {
  return {
    flow: 'newMortgage',
    productType: 'mortgage',
    rateType: 'fixed',
    loanAmount: 500000,
    fees: { fees: [] },
    contractRatePercent: 5,
    paymentFrequency: 'monthly',
    termYears: 5,
    termMonths: 0,
    remainingAmortizationYears: 25,
    remainingAmortizationMonths: 0,
    firstPaymentDate: new Date('2024-02-01'),
    endDate: new Date('2029-01-01'),
    disbursalDate: new Date('2024-01-01'),
    semiAnnualCompoundingDate: new Date('2024-01-01'),
    ...overrides,
  };
}

describe('validateCobCanadaInput', () => {
  it('happy path: a well-formed new-mortgage input passes', () => {
    expect(() => validateCobCanadaInput(baseInput())).not.toThrow();
  });

  it('edge case: term exactly equal to remaining amortization is allowed (boundary)', () => {
    expect(() =>
      validateCobCanadaInput(baseInput({ termYears: 25, remainingAmortizationYears: 25 })),
    ).not.toThrow();
  });

  it('throws RangeError when the term exceeds the remaining amortization', () => {
    expect(() =>
      validateCobCanadaInput(baseInput({ termYears: 26, remainingAmortizationYears: 25 })),
    ).toThrow(RangeError);
  });

  it('throws RangeError on non-positive loanAmount', () => {
    expect(() => validateCobCanadaInput(baseInput({ loanAmount: 0 }))).toThrow(RangeError);
  });

  it('throws RangeError when term_years/term_months are both 0', () => {
    expect(() => validateCobCanadaInput(baseInput({ termYears: 0, termMonths: 0 }))).toThrow(RangeError);
  });

  it('throws RangeError on an unrecognized paymentFrequency', () => {
    expect(() =>
      validateCobCanadaInput(baseInput({ paymentFrequency: 'daily' as CobCanadaInput['paymentFrequency'] })),
    ).toThrow(RangeError);
  });

  it("throws RangeError when flow 'newMortgage' is combined with productType 'personalLoan'", () => {
    expect(() => validateCobCanadaInput(baseInput({ productType: 'personalLoan' }))).toThrow(RangeError);
  });

  it("throws RangeError when flow 'variableRatePaymentChange' isn't mortgage+variable", () => {
    expect(() =>
      validateCobCanadaInput(
        baseInput({ flow: 'variableRatePaymentChange', rateType: 'fixed', renewalDate: new Date('2029-01-01') }),
      ),
    ).toThrow(RangeError);
  });

  it('throws RangeError when a new flow is missing disbursalDate', () => {
    const input = baseInput();
    delete (input as { disbursalDate?: Date }).disbursalDate;
    expect(() => validateCobCanadaInput(input)).toThrow(RangeError);
  });

  it('throws RangeError when an existing flow is missing renewalDate', () => {
    expect(() =>
      validateCobCanadaInput(
        baseInput({ flow: 'existingMortgage', disbursalDate: undefined, accruedInterest: 100 }),
      ),
    ).toThrow(RangeError);
  });

  it('throws RangeError when a fixed-rate mortgage is missing semiAnnualCompoundingDate', () => {
    const input = baseInput();
    delete (input as { semiAnnualCompoundingDate?: Date }).semiAnnualCompoundingDate;
    expect(() => validateCobCanadaInput(input)).toThrow(RangeError);
  });

  it('does not require semiAnnualCompoundingDate for a variable-rate mortgage', () => {
    expect(() =>
      validateCobCanadaInput(baseInput({ rateType: 'variable', semiAnnualCompoundingDate: undefined })),
    ).not.toThrow();
  });

  it('propagates a fee-schedule validation failure (invalid Fee) as a RangeError', () => {
    expect(() =>
      validateCobCanadaInput(
        baseInput({ fees: { fees: [{ name: 'Bad fee', amount: -1, financed: false, includedInCob: false }] } }),
      ),
    ).toThrow(RangeError);
  });
});
