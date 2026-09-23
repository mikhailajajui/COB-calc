import { describe, expect, it } from 'vitest';
import { validateCobCanadaInput } from '../../src/ca/validate.js';
import type { CobCanadaInput } from '../../src/ca/types.js';

function baseInput(overrides: Partial<CobCanadaInput> = {}): CobCanadaInput {
  return {
    flow: 'newMortgageOrLoan',
    productType: 'mortgage',
    rateType: 'fixed',
    loanAmount: 500000,
    fees: { fees: [] },
    contractRatePercent: 5,
    paymentAmount: 2908.02,
    paymentFrequency: 'monthly',
    termYears: 5,
    termMonths: 0,
    firstPaymentDate: new Date('2024-02-01'),
    endDate: new Date('2029-01-01'),
    disbursalDate: new Date('2024-01-01'),
    semiAnnualCompoundingDate: new Date('2024-01-01'),
    ...overrides,
  };
}

describe('validateCobCanadaInput', () => {
  it('happy path: a well-formed newMortgageOrLoan input passes', () => {
    expect(() => validateCobCanadaInput(baseInput())).not.toThrow();
  });

  it('happy path: a well-formed renewal input (with accruedInterest) passes', () => {
    expect(() =>
      validateCobCanadaInput(
        baseInput({
          flow: 'renewal',
          disbursalDate: undefined,
          renewalDate: new Date('2024-01-01'),
          accruedInterest: 250,
        }),
      ),
    ).not.toThrow();
  });

  it('throws RangeError on non-positive loanAmount', () => {
    expect(() => validateCobCanadaInput(baseInput({ loanAmount: 0 }))).toThrow(RangeError);
  });

  it('throws RangeError on non-positive paymentAmount', () => {
    expect(() => validateCobCanadaInput(baseInput({ paymentAmount: 0 }))).toThrow(RangeError);
  });

  it('throws RangeError when term_years/term_months are both 0', () => {
    expect(() => validateCobCanadaInput(baseInput({ termYears: 0, termMonths: 0 }))).toThrow(RangeError);
  });

  it('throws RangeError on an unrecognized paymentFrequency', () => {
    expect(() =>
      validateCobCanadaInput(baseInput({ paymentFrequency: 'daily' as CobCanadaInput['paymentFrequency'] })),
    ).toThrow(RangeError);
  });

  it('does NOT require productType mortgage for flow newMortgageOrLoan -- flow no longer implies product type', () => {
    expect(() => validateCobCanadaInput(baseInput({ productType: 'personalLoan' }))).not.toThrow();
  });

  it("throws RangeError when flow 'variableRatePaymentChange' isn't mortgage+variable", () => {
    expect(() =>
      validateCobCanadaInput(
        baseInput({
          flow: 'variableRatePaymentChange',
          rateType: 'fixed',
          disbursalDate: undefined,
          renewalDate: new Date('2024-01-01'),
        }),
      ),
    ).toThrow(RangeError);
  });

  it("allows flow 'variableRatePaymentChange' when mortgage+variable", () => {
    expect(() =>
      validateCobCanadaInput(
        baseInput({
          flow: 'variableRatePaymentChange',
          rateType: 'variable',
          semiAnnualCompoundingDate: undefined,
          disbursalDate: undefined,
          renewalDate: new Date('2024-01-01'),
        }),
      ),
    ).not.toThrow();
  });

  it('throws RangeError when a newMortgageOrLoan flow is missing disbursalDate', () => {
    const input = baseInput();
    delete (input as { disbursalDate?: Date }).disbursalDate;
    expect(() => validateCobCanadaInput(input)).toThrow(RangeError);
  });

  it('throws RangeError when a renewal flow is missing renewalDate', () => {
    expect(() =>
      validateCobCanadaInput(baseInput({ flow: 'renewal', disbursalDate: undefined, accruedInterest: 100 })),
    ).toThrow(RangeError);
  });

  it('throws RangeError when disbursalDate is after firstPaymentDate', () => {
    expect(() =>
      validateCobCanadaInput(baseInput({ disbursalDate: new Date('2024-03-01') })),
    ).toThrow(RangeError);
  });

  it('throws RangeError when endDate is not after firstPaymentDate', () => {
    expect(() => validateCobCanadaInput(baseInput({ endDate: new Date('2024-02-01') }))).toThrow(RangeError);
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

  it('does not require semiAnnualCompoundingDate for a personal loan', () => {
    expect(() =>
      validateCobCanadaInput(
        baseInput({ productType: 'personalLoan', semiAnnualCompoundingDate: undefined }),
      ),
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
