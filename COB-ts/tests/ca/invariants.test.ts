import { describe, expect, it } from 'vitest';
import { calculateCobCanada } from '../../src/ca/cobCanada.js';
import { triggerRatePercent } from '../../src/ca/equations.js';
import type { CobCanadaInput, FeeSchedule } from '../../src/index.js';

/** A well-formed new fixed-rate mortgage, overridable per test. */
function fixedMortgageInput(overrides: Partial<CobCanadaInput> = {}): CobCanadaInput {
  return {
    flow: 'newMortgageOrLoan',
    productType: 'mortgage',
    rateType: 'fixed',
    loanAmount: 100000,
    fees: { fees: [] },
    contractRatePercent: 5,
    paymentAmount: 1000,
    paymentFrequency: 'monthly',
    termYears: 5,
    termMonths: 0,
    firstPaymentDate: new Date('2024-02-01'),
    endDate: new Date('2029-02-01'),
    disbursalDate: new Date('2024-01-01'),
    semiAnnualCompoundingDate: new Date('2024-01-01'),
    ...overrides,
  };
}

function personalLoanInput(overrides: Partial<CobCanadaInput> = {}): CobCanadaInput {
  return {
    flow: 'newMortgageOrLoan',
    productType: 'personalLoan',
    rateType: 'fixed',
    loanAmount: 20000,
    fees: { fees: [] },
    contractRatePercent: 8,
    paymentAmount: 700,
    paymentFrequency: 'monthly',
    termYears: 3,
    termMonths: 0,
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

describe('invariant #2: total_payment == total_interest + fees_recovered + principal_payment', () => {
  function withFees(financed: number, cash: number): FeeSchedule {
    return {
      fees: [
        { name: 'Financed fee', amount: financed, financed: true, includedInCob: false },
        { name: 'Cash fee', amount: cash, financed: false, includedInCob: false },
      ],
    };
  }

  it.each([
    ['fixed mortgage, no fees', fixedMortgageInput()],
    ['variable mortgage, no fees', fixedMortgageInput({ rateType: 'variable', semiAnnualCompoundingDate: undefined })],
    ['fixed personal loan, no fees', personalLoanInput({ rateType: 'fixed' })],
    ['variable personal loan, no fees', personalLoanInput({ rateType: 'variable' })],
    ['fixed mortgage with fees (fees_recovered > 0)', fixedMortgageInput({ fees: withFees(3000, 500) })],
  ] as const)('reconciles for %s', (_label, input) => {
    const result = calculateCobCanada(input);
    expect(result.totalInterest + result.feesRecovered + result.principalPayment).toBeCloseTo(
      result.totalPayment,
      6,
    );
  });

  it('fee-free case: fees_recovered == 0 and the identity collapses to the two-term form', () => {
    const result = calculateCobCanada(fixedMortgageInput());
    expect(result.feesRecovered).toBe(0);
    expect(result.totalInterest + result.principalPayment).toBeCloseTo(result.totalPayment, 6);
  });
});

describe('invariant #3: amortized_principal == loanAmount regardless of the financed/cash fee split', () => {
  function withFees(financed: number, cash: number): FeeSchedule {
    return {
      fees: [
        { name: 'Financed fee', amount: financed, financed: true, includedInCob: false },
        { name: 'Cash fee', amount: cash, financed: false, includedInCob: false },
      ],
    };
  }

  it('increasing total_financed_fees must not change amortized_principal; the fees paid reduce the balance, so total_interest is unchanged (spec 011 D9/D8)', () => {
    const smallerFee = calculateCobCanada(fixedMortgageInput({ fees: withFees(1000, 0) }));
    const largerFee = calculateCobCanada(fixedMortgageInput({ fees: withFees(5000, 0) }));
    expect(largerFee.amortizedPrincipal).toBe(smallerFee.amortizedPrincipal);
    expect(largerFee.totalInterest).toBeCloseTo(smallerFee.totalInterest, 6);
    expect(largerFee.feesRecovered - smallerFee.feesRecovered).toBeCloseTo(4000, 6);
    // Financed fees DO reduce disbursalAmount -- the larger the financed fee, the
    // smaller the cash actually advanced (doc 007 finding #4).
    expect(largerFee.disbursalAmount).toBeLessThan(smallerFee.disbursalAmount);
  });

  it('reclassifying the SAME total fee amount between financed and cash leaves amortized_principal unchanged -- disbursalAmount and the waterfall are split-sensitive (spec 011)', () => {
    const noFees = calculateCobCanada(fixedMortgageInput());
    const allCash = calculateCobCanada(fixedMortgageInput({ fees: withFees(0, 3000) }));
    const allFinanced = calculateCobCanada(fixedMortgageInput({ fees: withFees(3000, 0) }));
    expect(allFinanced.amortizedPrincipal).toBe(allCash.amortizedPrincipal);
    expect(allFinanced.disbursalAmount).toBeLessThan(allCash.disbursalAmount); // only financed fees reduce disbursal
    // Only financed fees enter the waterfall (DEV-011-1): cash fees leave interest untouched.
    // Financed fees are paid down inside the balance (D9/D8), so interest is unchanged too.
    expect(allCash.totalInterest).toBeCloseTo(noFees.totalInterest, 6);
    expect(allFinanced.totalInterest).toBeCloseTo(allCash.totalInterest, 6);
    expect(allFinanced.feesRecovered).toBeCloseTo(3000, 6);
    expect(allCash.feesRecovered).toBe(0);
  });

  it('increasing total_cash_fees must not change amortized_principal, disbursalAmount, total_interest or fees_recovered, but DOES increase cob_amount (spec 011)', () => {
    const smallerCash = calculateCobCanada(fixedMortgageInput({ fees: withFees(0, 500) }));
    const largerCash = calculateCobCanada(fixedMortgageInput({ fees: withFees(0, 3000) }));
    expect(largerCash.totalInterest).toBe(smallerCash.totalInterest);
    expect(largerCash.amortizedPrincipal).toBe(smallerCash.amortizedPrincipal);
    expect(largerCash.disbursalAmount).toBe(smallerCash.disbursalAmount); // cash fees never touch disbursal
    expect(largerCash.feesRecovered).toBe(0);
    expect(smallerCash.feesRecovered).toBe(0);
    expect(largerCash.cobAmount - smallerCash.cobAmount).toBeCloseTo(2500, 6);
  });
});

describe('term_days tracks the same day-count basis as cob_rate_percent\'s T (no longer isolated -- doc 007 finding #7)', () => {
  it('varying endDate (and therefore the schedule length / term_days) DOES change monetary outputs now', () => {
    const shorterTerm = calculateCobCanada(fixedMortgageInput({ endDate: new Date('2027-02-01') }));
    const longerTerm = calculateCobCanada(fixedMortgageInput({ endDate: new Date('2029-02-01') }));

    expect(shorterTerm.termDays).not.toBe(longerTerm.termDays);
    expect(shorterTerm.numberOfPayments).not.toBe(longerTerm.numberOfPayments);
    // Unlike the pre-rewrite model, a shorter schedule genuinely pays less total
    // interest/principal -- these are NOT invariant to term_days anymore.
    expect(shorterTerm.totalInterest).not.toBeCloseTo(longerTerm.totalInterest, 2);
  });
});

describe('invariant #5: semi-annual, m=n, and m=12 conversions produce different calculated rates', () => {
  it('a fixed-rate mortgage and a variable-rate mortgage at the same contract rate do not produce the same schedule', () => {
    const fixed = calculateCobCanada(fixedMortgageInput());
    const variable = calculateCobCanada(
      fixedMortgageInput({ rateType: 'variable', semiAnnualCompoundingDate: undefined }),
    );
    expect(fixed.totalInterest).not.toBeCloseTo(variable.totalInterest, 2);
  });
});

describe('invariant #6: trigger rate monotonicity (payment_amount and payments_per_year held fixed)', () => {
  it('increasing the equation-level loanAmount decreases trigger_rate_percent directly', () => {
    const paymentAmount = 2200;
    const paymentsPerYear = 12;
    const smallerBalance = triggerRatePercent(paymentAmount, paymentsPerYear, 250000);
    const largerBalance = triggerRatePercent(paymentAmount, paymentsPerYear, 300000);
    expect(largerBalance).toBeLessThan(smallerBalance);
  });

  it('confirms the engine-level version: payment_amount is a plain input, never re-derived from loanAmount, so varying loanAmount alone (payment fixed) changes trigger_rate_percent -- unlike the pre-rewrite model where payment was always re-solved from the same balance', () => {
    const smaller = calculateCobCanada(
      fixedMortgageInput({ rateType: 'variable', semiAnnualCompoundingDate: undefined, loanAmount: 250000 }),
    );
    const larger = calculateCobCanada(
      fixedMortgageInput({ rateType: 'variable', semiAnnualCompoundingDate: undefined, loanAmount: 300000 }),
    );
    // Same paymentAmount (1000/mo) in both cases (inherited from fixedMortgageInput),
    // held fixed independently of loanAmount -- this is exactly what finding #1
    // makes newly testable (see spec 006 invariant #6's "Note").
    expect(larger.triggerRatePercent!).toBeLessThan(smaller.triggerRatePercent!);
  });
});
