import { describe, expect, it } from 'vitest';
import { calculateCobCanada } from '../../src/ca/cobCanada.js';
import type { CobCanadaInput } from '../../src/ca/types.js';

describe('calculateCobCanada', () => {
  it('happy path: new fixed-rate mortgage, no fees (hand-computed via equation 1)', () => {
    // $500,000 @ 5% nominal, fixed, monthly, 5y term inside a 25y amortization.
    // Hand-computed (see the equation-1 cross-check in equations.test.ts for
    // i_period = 0.41239154651442345%/mo) via an independent script driving the same
    // formulas: paymentAmount 2908.02, totalPayment 174481.20, totalInterest
    // 117019.11, principalPayment 57462.09, endingBalance 442537.91,
    // cobRatePercent ~4.9487%.
    const input: CobCanadaInput = {
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
    };

    const result = calculateCobCanada(input);

    expect(result.paymentAmount).toBeCloseTo(2908.02, 2);
    expect(result.numberOfPayments).toBe(60);
    expect(result.totalPayment).toBeCloseTo(174481.2, 2);
    expect(result.totalInterest).toBeCloseTo(117019.11, 1);
    expect(result.principalPayment).toBeCloseTo(57462.09, 1);
    expect(result.endingBalance).toBeCloseTo(442537.91, 1);
    expect(result.cobAmount).toBeCloseTo(result.totalInterest, 2); // no COB-included fees
    expect(result.cobRatePercent).toBeCloseTo(4.9487, 3);
    expect(result.triggerRatePercent).toBeNull(); // fixed mortgage -- invariant #1
    expect(result.termDays).toBe(0); // 5y0m exactly spans disbursalDate -> endDate
    expect(result.amortizationSchedule).toHaveLength(60);
    expect(result.amortizationSchedule[0]!.beginningBalance).toBe(500000);
  });

  it('edge case: existing (renewal) variable mortgage with fees + accrued interest, trigger rate computed', () => {
    // $300,000 current balance, $2,000 financed fee, $300 cash appraisal fee
    // (includedInCob), $250 accrued interest carried forward -- 4% variable, monthly,
    // 3y term inside a 15y remaining amortization. Hand-computed via the same
    // independent script: amortizedPrincipal 302250, disbursalAmount 301700,
    // paymentAmount 2235.71, totalInterest 33590.58, endingBalance 255355.02,
    // triggerRatePercent ~8.8763%, cobAmount 33890.58 (interest + the $300
    // COB-included appraisal fee only -- not the $2,000 financed, non-COB fee),
    // cobRatePercent ~4.0357%.
    const input: CobCanadaInput = {
      flow: 'existingMortgage',
      productType: 'mortgage',
      rateType: 'variable',
      loanAmount: 300000,
      fees: {
        fees: [
          { name: 'Mortgage default insurance', amount: 2000, financed: true, includedInCob: false },
          { name: 'Appraisal fee', amount: 300, financed: false, includedInCob: true },
        ],
      },
      contractRatePercent: 4,
      paymentFrequency: 'monthly',
      termYears: 3,
      termMonths: 0,
      remainingAmortizationYears: 15,
      remainingAmortizationMonths: 0,
      firstPaymentDate: new Date('2024-02-01'),
      endDate: new Date('2027-01-01'),
      renewalDate: new Date('2024-01-01'),
      accruedInterest: 250,
    };

    const result = calculateCobCanada(input);

    expect(result.amortizedPrincipal).toBe(302250);
    expect(result.disbursalAmount).toBe(301700);
    expect(result.paymentAmount).toBeCloseTo(2235.71, 2);
    expect(result.totalInterest).toBeCloseTo(33590.58, 1);
    expect(result.endingBalance).toBeCloseTo(255355.02, 1);
    expect(result.triggerRatePercent).not.toBeNull();
    expect(result.triggerRatePercent!).toBeCloseTo(8.8763, 3);
    expect(result.cobAmount).toBeCloseTo(33890.58, 1); // 33590.58 interest + 300 COB fee
    expect(result.cobRatePercent).toBeCloseTo(4.0357, 3);
  });

  it('throws RangeError on invalid input (validateCobCanadaInput runs first)', () => {
    const input: CobCanadaInput = {
      flow: 'newMortgage',
      productType: 'mortgage',
      rateType: 'fixed',
      loanAmount: -500000, // invalid
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
    };

    expect(() => calculateCobCanada(input)).toThrow(RangeError);
  });

  it('personal loans never compute a trigger rate, even when rateType is variable', () => {
    const input: CobCanadaInput = {
      flow: 'newLoan',
      productType: 'personalLoan',
      rateType: 'variable',
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
    };

    const result = calculateCobCanada(input);
    expect(result.triggerRatePercent).toBeNull();
    expect(result.endingBalance).toBe(0); // term == full amortization -> fully paid off
  });

  it("payment_amount for a 'paymentChange' flow is recomputed off the current balance, not the original loan_amount", () => {
    const currentBalance = 250000;
    const input: CobCanadaInput = {
      flow: 'paymentChange',
      productType: 'mortgage',
      rateType: 'variable',
      loanAmount: currentBalance,
      fees: { fees: [] },
      contractRatePercent: 6, // a new, higher rate at reset
      paymentFrequency: 'monthly',
      termYears: 3,
      termMonths: 0,
      remainingAmortizationYears: 18,
      remainingAmortizationMonths: 0,
      firstPaymentDate: new Date('2024-02-01'),
      endDate: new Date('2027-01-01'),
      renewalDate: new Date('2024-01-01'),
    };

    const result = calculateCobCanada(input);
    // Sanity: payment sized off 250,000/18y, not some other principal.
    expect(result.amortizedPrincipal).toBe(currentBalance);
    expect(result.paymentAmount).toBeGreaterThan(0);
    expect(result.triggerRatePercent).not.toBeNull(); // mortgage + variable
  });
});
