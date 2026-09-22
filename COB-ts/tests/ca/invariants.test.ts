import { describe, expect, it } from 'vitest';
import { calculateCobCanada } from '../../src/ca/cobCanada.js';
import { triggerRatePercent } from '../../src/ca/equations.js';
import type { CobCanadaInput, FeeSchedule } from '../../src/index.js';

/** A well-formed new fixed-rate mortgage, overridable per test. */
function fixedMortgageInput(overrides: Partial<CobCanadaInput> = {}): CobCanadaInput {
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

function personalLoanInput(overrides: Partial<CobCanadaInput> = {}): CobCanadaInput {
  return {
    flow: 'newLoan',
    productType: 'personalLoan',
    rateType: 'fixed',
    loanAmount: 20000,
    fees: { fees: [] },
    contractRatePercent: 8,
    paymentFrequency: 'monthly',
    termYears: 3,
    termMonths: 0,
    remainingAmortizationYears: 3,
    remainingAmortizationMonths: 0,
    firstPaymentDate: new Date('2024-02-01'),
    endDate: new Date('2027-01-01'),
    disbursalDate: new Date('2024-01-01'),
    ...overrides,
  };
}

describe('invariant #1: fixed-rate mortgage / any personal loan -> trigger rate is N/A', () => {
  it('a fixed-rate mortgage never computes a trigger rate', () => {
    expect(calculateCobCanada(fixedMortgageInput()).triggerRatePercent).toBeNull();
  });

  it('a personal loan never computes a trigger rate, fixed or variable', () => {
    expect(calculateCobCanada(personalLoanInput({ rateType: 'fixed' })).triggerRatePercent).toBeNull();
    expect(calculateCobCanada(personalLoanInput({ rateType: 'variable' })).triggerRatePercent).toBeNull();
  });
});

describe('invariant #2: principal_payment + total_interest == total_payment exactly', () => {
  it.each([
    ['fixed mortgage', fixedMortgageInput()],
    ['variable mortgage', fixedMortgageInput({ rateType: 'variable', semiAnnualCompoundingDate: undefined })],
    ['fixed personal loan', personalLoanInput({ rateType: 'fixed' })],
    ['variable personal loan', personalLoanInput({ rateType: 'variable' })],
  ] as const)('reconciles for %s', (_label, input) => {
    const result = calculateCobCanada(input);
    expect(result.principalPayment + result.totalInterest).toBeCloseTo(result.totalPayment, 6);
  });
});

describe('invariant #3: financed fees increase the amortized principal (never disbursal); cash fees do the opposite', () => {
  function withFees(financed: number, cash: number): FeeSchedule {
    return {
      fees: [
        { name: 'Financed fee', amount: financed, financed: true, includedInCob: false },
        { name: 'Cash fee', amount: cash, financed: false, includedInCob: false },
      ],
    };
  }

  it('increasing total_financed_fees must not decrease total_interest', () => {
    const smallerFee = calculateCobCanada(fixedMortgageInput({ fees: withFees(1000, 0) }));
    const largerFee = calculateCobCanada(fixedMortgageInput({ fees: withFees(5000, 0) }));
    expect(largerFee.totalInterest).toBeGreaterThan(smallerFee.totalInterest);
    expect(largerFee.amortizedPrincipal).toBeGreaterThan(smallerFee.amortizedPrincipal);
    // Financed fees layer on top of loanAmount for BOTH amortizedPrincipal and
    // disbursalAmount (disbursalAmount = loanAmount + total_financed_fees -
    // total_cash_fees, per the resolved carve-out direction -- see "Financed fees" in
    // the spec) -- a financed fee is never "carved out" of disbursal, it's added on
    // top of it just like it's added on top of the amortized principal. What financed
    // fees never do is REDUCE disbursal -- that's cash fees' job (see the next test).
    expect(largerFee.disbursalAmount).toBeGreaterThan(smallerFee.disbursalAmount);
  });

  it('increasing total_cash_fees must not change total_interest at all', () => {
    const smallerCash = calculateCobCanada(fixedMortgageInput({ fees: withFees(0, 500) }));
    const largerCash = calculateCobCanada(fixedMortgageInput({ fees: withFees(0, 3000) }));
    expect(largerCash.totalInterest).toBe(smallerCash.totalInterest);
    expect(largerCash.amortizedPrincipal).toBe(smallerCash.amortizedPrincipal); // cash fees never touch principal
    expect(largerCash.disbursalAmount).toBeLessThan(smallerCash.disbursalAmount); // only disbursal moves
  });
});

describe('invariant #4: term_days never changes any monetary output', () => {
  it('varying only end_date (and therefore term_days) leaves every monetary output byte-identical', () => {
    const shortTermDays = calculateCobCanada(fixedMortgageInput({ endDate: new Date('2029-01-01') }));
    const longerTermDays = calculateCobCanada(fixedMortgageInput({ endDate: new Date('2029-03-15') }));

    expect(shortTermDays.termDays).not.toBe(longerTermDays.termDays);
    expect(shortTermDays.paymentAmount).toBe(longerTermDays.paymentAmount);
    expect(shortTermDays.totalInterest).toBe(longerTermDays.totalInterest);
    expect(shortTermDays.totalPayment).toBe(longerTermDays.totalPayment);
    expect(shortTermDays.cobAmount).toBe(longerTermDays.cobAmount);
    expect(shortTermDays.cobRatePercent).toBe(longerTermDays.cobRatePercent);
  });
});

describe('invariant #5: semi-annual vs. monthly compounding produce different payments at the same nominal rate', () => {
  it('a fixed-rate mortgage and a variable-rate mortgage at the same contract rate do not produce the same payment', () => {
    // Direction is NOT asserted here: the spec's own invariant #5 prose claims
    // semi-annual is "more expensive," which is backwards (semi-annual is actually
    // cheaper at the same nominal rate -- see equations.test.ts's cross-check and the
    // spec's own "Excel implementation notes" judgment-call #7, which flags this as a
    // documented error in the spec's prose). Only the direction-agnostic, actually
    // testable claim -- that the two conventions differ -- is asserted.
    const fixed = calculateCobCanada(fixedMortgageInput());
    const variable = calculateCobCanada(
      fixedMortgageInput({ rateType: 'variable', semiAnnualCompoundingDate: undefined }),
    );
    expect(fixed.paymentAmount).not.toBe(variable.paymentAmount);
  });
});

describe('invariant #6: trigger rate monotonicity (payment_amount and payments_per_year held fixed)', () => {
  it('increasing total_borrowed decreases trigger_rate_percent when payment is not re-derived from the new balance', () => {
    // This is deliberately checked against the trigger-rate equation directly rather
    // than through calculateCobCanada end to end: the engine always recomputes
    // payment_amount from the same balance used as total_borrowed (equation 3), so
    // scaling loanAmount up while letting the engine also recompute the payment
    // leaves trigger_rate_percent UNCHANGED, not decreased -- this is not a bug, it's
    // the Bank of Canada's own origination-time finding cited in equation 4's sourcing
    // ("at origination, the trigger rate does not depend on the size of the loan").
    // Invariant #6's actual premise -- payment held fixed, balance varying
    // independently (e.g. an existing, already-amortized loan checked against its
    // original scheduled payment) -- is what's verified here.
    const paymentAmount = 2235.71;
    const paymentsPerYear = 12;
    const smallerBalance = triggerRatePercent(paymentAmount, paymentsPerYear, 250000);
    const largerBalance = triggerRatePercent(paymentAmount, paymentsPerYear, 300000);
    expect(largerBalance).toBeLessThan(smallerBalance);
  });

  it('confirms the engine-level corollary: scaling loanAmount leaves trigger_rate_percent unchanged at origination', () => {
    const smaller = calculateCobCanada(
      fixedMortgageInput({ rateType: 'variable', semiAnnualCompoundingDate: undefined, loanAmount: 500000 }),
    );
    const larger = calculateCobCanada(
      fixedMortgageInput({ rateType: 'variable', semiAnnualCompoundingDate: undefined, loanAmount: 1000000 }),
    );
    expect(larger.triggerRatePercent).toBeCloseTo(smaller.triggerRatePercent!, 9);
  });
});
