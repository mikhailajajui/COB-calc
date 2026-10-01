import { describe, expect, it } from 'vitest';
import { validateCobCanadaInput } from '../../src/ca/validate.js';
import type { CobCanadaInput } from '../../src/ca/index.js';
import { BOTH_SEMI, loadValidate } from './support/semiSwitch.js';

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
  } as CobCanadaInput;
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

  it('negative payment rejected', () => {
    // OQ-Y revised 2026-09-28 (B14): payment must be > 0; negative, 0 and -0 rejected
    // (0 / -0: numericGuard-b3a.test.ts, zeroPayment-oqy.test.ts, b14-payment-rate-positive.test.ts)
    expect(() => validateCobCanadaInput(baseInput({ paymentAmount: -1 }))).toThrow(RangeError);
  });

  // B24: the 'term_years/term_months both 0' test is retired (the term fields are never validated; b24-term-rule T4).

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
          accruedInterest: 0, // required since B20 (decision 4)
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

  it.each(BOTH_SEMI)('%s: a fixed-rate mortgage missing semiAnnualCompoundingDate throws RangeError when on (Q-SACD), is accepted when off', async (_l, required) => {
    const api = await loadValidate(required);
    const input = baseInput();
    delete (input as { semiAnnualCompoundingDate?: Date }).semiAnnualCompoundingDate;
    if (required) expect(() => api.validateCobCanadaInput(input)).toThrow(RangeError);
    else expect(() => api.validateCobCanadaInput(input)).not.toThrow();
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

describe('BRD §6: total fees (financed + non-financed) must be less than loanAmount', () => {
  // QA F1 reproduction: personal loan of 1000 with a 1500 financed fee.
  function qaInput(amount: number, financed = true): CobCanadaInput {
    return baseInput({
      productType: 'personalLoan',
      loanAmount: 1000,
      contractRatePercent: 6,
      paymentAmount: 100,
      disbursalDate: new Date('2026-01-01'),
      firstPaymentDate: new Date('2026-02-01'),
      endDate: new Date('2026-12-01'),
      termYears: 1,
      termMonths: 0,
      semiAnnualCompoundingDate: undefined,
      fees: { fees: [{ name: 'Admin', amount, financed, includedInCob: true }] },
    });
  }

  // B2 2026-09-27 (QA): the ONE exact-text pin for the fee-limit message. Wording is the user's
  // "Q-MSG interim (fee limit)" decision (COB-user-stories.md §7.5), X = grouped fee total
  // (B2-R1), Y = loanAmount, raw number formatting as before. Red until B2.
  // Mixed groups (600 financed + 900 non-financed) so X must be the grouped total, not financed only.
  it('rejects fees above the loan amount with the Q-MSG interim wording (B2)', () => {
    const input = qaInput(600);
    input.fees.fees.push({ name: 'Appraisal', amount: 900, financed: false, includedInCob: true });
    expect(() => validateCobCanadaInput(input)).toThrow(
      new RangeError('total fees (financed + non-financed) (1500) must be less than loanAmount (1000)'),
    );
  });

  // Fee-limit fires; message text is pinned once, above.
  it('rejects financed fees equal to the loan amount', () => {
    expect(() => validateCobCanadaInput(qaInput(1000))).toThrow(RangeError);
    expect(() => validateCobCanadaInput(qaInput(1000))).toThrow(/fee/i);
  });

  it('sums every financed fee', () => {
    const input = qaInput(600);
    input.fees.fees.push({ name: 'Legal', amount: 400, financed: true, includedInCob: true });
    expect(() => validateCobCanadaInput(input)).toThrow(RangeError);
    expect(() => validateCobCanadaInput(input)).toThrow(/fee/i);
  });

  it('accepts financed fees of loanAmount - 0.01', () => {
    expect(() => validateCobCanadaInput(qaInput(999.99))).not.toThrow();
  });

  // B2 2026-09-27 (QA): OQ-M decided -- non-financed fees DO count (macro `(finFee + nonFinFee) >= loanAmt`).
  // Replaces the pre-decision "does not count non-financed fees" pin. Red until B2; message not pinned (Q-MSG).
  it('counts non-financed fees (OQ-M, B2 / 012 D-08)', () => {
    expect(() => validateCobCanadaInput(qaInput(1500, false))).toThrow(RangeError);
    const input = qaInput(999.99);
    input.fees.fees.push({ name: 'Appraisal', amount: 5000, financed: false, includedInCob: true });
    expect(() => validateCobCanadaInput(input)).toThrow(RangeError);
  });
});
