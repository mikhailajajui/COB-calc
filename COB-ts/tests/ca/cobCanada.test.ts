import { describe, expect, it } from 'vitest';
import { calculateCobCanada } from '../../src/ca/cobCanada.js';
import type { CobCanadaInput } from '../../src/ca/types.js';

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

describe('calculateCobCanada -- doc 007 worked validation vector (permanent regression test)', () => {
  // docs/new-req/007-cob-canada-brd-reconciliation.md's "Worked validation vector" --
  // the actual Calculator sheet example saved in the live Alterna workbook. Every
  // expected value below is quoted directly from that doc.
  it('reproduces the live Alterna workbook example exactly (within cent-level tolerance)', () => {
    const input: CobCanadaInput = {
      flow: 'newMortgageOrLoan',
      productType: 'mortgage',
      rateType: 'fixed',
      loanAmount: 227829.65,
      fees: { fees: [] }, // financed_required_fees = 0, non_financed_required_fees = 0
      contractRatePercent: 3.74,
      paymentAmount: 465.46,
      paymentFrequency: 'weekly', // "Accelerated Weekly" == plain Weekly for rate/day-count purposes
      termYears: 3,
      termMonths: 0,
      disbursalDate: new Date('2026-03-17'),
      firstPaymentDate: new Date('2026-03-23'),
      endDate: new Date('2029-03-17'),
      semiAnnualCompoundingDate: new Date('2026-03-17'),
    };

    const result = calculateCobCanada(input);

    expect(result.numberOfPayments).toBe(156);

    const payment1 = result.amortizationSchedule[0]!;
    expect(payment1.date.getTime()).toBe(new Date('2026-03-23').getTime());
    expect(payment1.daysInPeriod).toBe(6);
    expect(payment1.interestPaid).toBeCloseTo(138.82433838712447, 6);
    expect(payment1.principalPortion).toBeCloseTo(326.63566161287554, 6);
    expect(payment1.closingBalance).toBeCloseTo(227503.01433838712, 4);

    const finalPayment = result.amortizationSchedule[result.amortizationSchedule.length - 1]!;
    expect(finalPayment.date.getTime()).toBe(new Date('2029-03-12').getTime());
    expect(finalPayment.interestPaid).toBeCloseTo(126.58872704555324, 5);
    // Not zero -- the term ends before full payoff (doc 007 finding #2).
    expect(finalPayment.closingBalance).toBeCloseTo(177731.99591158231, 3);

    expect(result.totalPayment).toBeCloseTo(72611.76, 2);
    expect(result.totalInterest).toBeCloseTo(22514.10591158249, 4);
    expect(result.principalPayment).toBeCloseTo(50097.654088417505, 4);
    expect(result.cobAmount).toBeCloseTo(22514.10591158249, 4);
    expect(result.cobRatePercent).toBeCloseTo(3.706781471105014, 6);
    // JUDGMENT CALL: doc 007's worked vector is a raw cell dump from the live
    // workbook and happens to include a Trigger Rate cell value
    // (465.46 x 52 / 227829.65 x 100 = 10.623691868025078%) even though this
    // specific example's rate_type is Fixed -- that raw cell is apparently
    // unconditionally computed by the workbook regardless of rate type. Spec 006
    // itself is unambiguous and repeated on this point (Conditional calculation
    // paths table: "Mortgage | Fixed | ... | No -- fixed payment always covers
    // interest by construction"; invariant #1: "Fixed-rate mortgage => trigger rate
    // is N/A, never computed or displayed"), and this rewrite was explicitly
    // instructed to keep that mortgage+variable-only scoping unchanged. This engine
    // therefore returns null here, per the spec's invariant, not the raw cell value
    // -- the underlying ratio itself is still cross-checked exactly against
    // 10.623691868025078 in equations.test.ts's triggerRatePercent tests.
    expect(result.triggerRatePercent).toBeNull();
    expect(result.endingBalance).toBeCloseTo(177731.99591158231, 3);
    expect(result.feesRecovered).toBe(0);
  });
});

describe('calculateCobCanada', () => {
  it('happy path: new fixed-rate mortgage, no fees, monthly -- also exercises the inclusive end_date boundary', () => {
    // endDate (2029-02-01) lands EXACTLY on what would be the 61st scheduled payment
    // date -- per equation 5's corrected (inclusive) stop condition, that row IS
    // generated (61 payments, not 60; doc 007's "Addendum: VBA macro source review"
    // finding #4 -- the real macro's exit check is strictly-after, not on-or-after).
    // Hand-computed via an independent script driving the same equations (calculated
    // rate 4.948698558173083%).
    const result = calculateCobCanada(fixedMortgageInput());

    expect(result.numberOfPayments).toBe(61);
    expect(result.amortizationSchedule[result.amortizationSchedule.length - 1]!.date.getTime()).toBe(
      new Date('2029-02-01').getTime(),
    );
    expect(result.amortizationSchedule[0]!.openingBalance).toBe(100000);
    expect(result.amortizationSchedule[0]!.interestPaid).toBeCloseTo(419.1520636703976, 4);
    expect(result.amortizationSchedule[0]!.principalPortion).toBeCloseTo(580.8479363296024, 4);
    expect(result.totalPayment).toBeCloseTo(61000, 6);
    expect(result.totalInterest).toBeCloseTo(20337.921199358494, 3);
    expect(result.principalPayment).toBeCloseTo(40662.07880064151, 3);
    expect(result.endingBalance).toBeCloseTo(59337.92119935853, 3);
    expect(result.cobAmount).toBeCloseTo(result.totalInterest, 6); // no fees
    // fees === 0 -> equation 7's short-circuit: cob_rate_percent === calculated_rate
    // x 100 exactly (no T/P involved at all).
    expect(result.cobRatePercent).toBeCloseTo(4.948698558173083, 10);
    expect(result.triggerRatePercent).toBeNull(); // fixed mortgage -- invariant #1
    expect(result.amortizedPrincipal).toBe(100000);
    expect(result.disbursalAmount).toBe(100000);
  });

  it('edge case: renewal variable mortgage with fees + accrued interest, trigger rate computed', () => {
    // $300,000 current balance, $2,000 financed fee, $300 cash appraisal fee, $250
    // accrued interest carried forward -- 4% variable, monthly, $2,200/mo payment.
    // Hand-computed via the same independent script: rate 4% exactly (m=n for a
    // variable mortgage), 36 payments generated (end_date lands exactly on payment
    // #36's date, and equation 5's corrected boundary is INCLUSIVE of end_date --
    // see doc 007's addendum finding #4 -- so that row IS generated), totalInterest
    // 33935.54168933623, feesRecovered 2300 (both fee types) under 006. Spec 011
    // (DEV-011-1): only the financed 2000 enters the waterfall; the 300 cash fee
    // counts in cobAmount only. Spec 011 D9/D8: the fees paid reduce the balance, so
    // totals were recomputed (engine and an independent Python model of 011 agree).
    const input: CobCanadaInput = {
      flow: 'renewal',
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
      paymentAmount: 2200,
      paymentFrequency: 'monthly',
      termYears: 3,
      termMonths: 0,
      firstPaymentDate: new Date('2024-02-01'),
      endDate: new Date('2027-01-01'),
      renewalDate: new Date('2024-01-01'),
      accruedInterest: 250,
    };

    const result = calculateCobCanada(input);

    expect(result.amortizedPrincipal).toBe(300000); // financed fees do NOT add on top (doc 007 finding #4)
    expect(result.disbursalAmount).toBe(298000); // 300000 - financed(2000); cash fee untouched
    expect(result.numberOfPayments).toBe(36);
    expect(result.amortizationSchedule[result.amortizationSchedule.length - 1]!.date.getTime()).toBe(
      new Date('2027-01-01').getTime(),
    );
    // Row 1: this period's own new interest is 1016.39, PLUS the 250 carried accrued
    // interest, so interestPaid on row 1 exceeds the period's own accrual.
    const row1 = result.amortizationSchedule[0]!;
    expect(row1.periodInterest).toBeCloseTo(1016.3934426229742, 3);
    expect(row1.carriedAccruedInterestOpening).toBe(250);
    expect(row1.interestPaid).toBeCloseTo(1266.3934426229744, 3);
    expect(row1.carriedAccruedInterestClosing).toBe(0);
    expect(row1.feesOpening).toBe(2000);
    expect(row1.feesPaid).toBeCloseTo(933.6065573770256, 3);
    expect(row1.principalPortion).toBe(0); // payment fully absorbed by interest + fees this row

    expect(row1.closingBalance).toBeCloseTo(299066.39344262297, 3); // fees paid reduce it (D9/D8)

    expect(result.totalInterest).toBeCloseTo(33656.864360184074, 3);
    expect(result.feesRecovered).toBeCloseTo(2000, 6); // financed fees only (spec 011)
    expect(result.principalPayment).toBeCloseTo(43543.135639815926, 3);
    expect(result.cobAmount).toBeCloseTo(33656.864360184074 + 2000 + 300, 3);
    expect(result.triggerRatePercent).not.toBeNull();
    expect(result.triggerRatePercent!).toBeCloseTo(8.8, 6); // 2200*12/300000*100
    // fees > 0 -> equation 7's GENERAL branch: (cob_amount / (T x P)) x 100, with a
    // PLAIN (non-leap-adjusted) T and a SIMPLE (unweighted) average P.
    expect(result.cobRatePercent).toBeCloseTo(4.300959303519965, 3);

    // Invariant #2: total_payment == total_interest + fees_recovered + principal_payment.
    expect(result.totalPayment).toBeCloseTo(
      result.totalInterest + result.feesRecovered + result.principalPayment,
      6,
    );
  });

  it('throws RangeError on invalid input (validateCobCanadaInput runs first)', () => {
    const input = fixedMortgageInput({ loanAmount: -500000 });
    expect(() => calculateCobCanada(input)).toThrow(RangeError);
  });

  it('equation 5 stop condition is INCLUSIVE of end_date: a candidate row landing exactly on end_date IS generated', () => {
    // doc 007's "Addendum: VBA macro source review" finding #4 -- the real macro's
    // exit check is `DateDiff("d", endDate, candidateDate) > 0` (strictly after), so
    // an exact-end_date row is generated and only the NEXT candidate (strictly after
    // end_date) is excluded. firstPaymentDate 2024-02-01, weekly -> row 8 falls
    // exactly on 2024-03-21 (7 weeks later); endDate is set to exactly that date.
    const input: CobCanadaInput = {
      flow: 'newMortgageOrLoan',
      productType: 'personalLoan',
      rateType: 'fixed',
      loanAmount: 10000,
      fees: { fees: [] },
      contractRatePercent: 6,
      paymentAmount: 300,
      paymentFrequency: 'weekly',
      termYears: 1,
      termMonths: 0,
      firstPaymentDate: new Date('2024-02-01'),
      endDate: new Date('2024-03-21'), // exactly 7 weeks after firstPaymentDate
      disbursalDate: new Date('2024-01-25'),
    };

    const result = calculateCobCanada(input);
    expect(result.numberOfPayments).toBe(8); // NOT 7 -- the end_date row is included
    const lastRow = result.amortizationSchedule[result.amortizationSchedule.length - 1]!;
    expect(lastRow.date.getTime()).toBe(new Date('2024-03-21').getTime());
  });

  it('personal loans never compute a trigger rate, even when rateType is variable', () => {
    const input: CobCanadaInput = {
      flow: 'newMortgageOrLoan',
      productType: 'personalLoan',
      rateType: 'variable',
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
    };

    const result = calculateCobCanada(input);
    expect(result.triggerRatePercent).toBeNull();
  });

  it("paymentChange flow seeds the schedule from the current balance and carries accrued interest forward, never capitalizing it into the opening balance", () => {
    const currentBalance = 250000;
    const input: CobCanadaInput = {
      flow: 'paymentChange',
      productType: 'mortgage',
      rateType: 'variable',
      loanAmount: currentBalance,
      fees: { fees: [] },
      contractRatePercent: 6,
      paymentAmount: 1800,
      paymentFrequency: 'monthly',
      termYears: 3,
      termMonths: 0,
      firstPaymentDate: new Date('2024-02-01'),
      endDate: new Date('2027-01-01'),
      renewalDate: new Date('2024-01-01'),
      accruedInterest: 400,
    };

    const result = calculateCobCanada(input);
    expect(result.amortizedPrincipal).toBe(currentBalance); // opening balance == current balance, not inflated
    expect(result.amortizationSchedule[0]!.openingBalance).toBe(currentBalance); // accrued interest NOT capitalized in
    expect(result.amortizationSchedule[0]!.carriedAccruedInterestOpening).toBe(400);
    expect(result.triggerRatePercent).not.toBeNull(); // mortgage + variable
  });

  it('a schedule that straddles a leap-year boundary (Dec 31 / Jan 1 into 2028) prorates interest with a split 365/366 day count', () => {
    // 50,000 personal loan (fixed, m=12), weekly, 6% nominal -- period #5 runs
    // 2027-12-29 -> 2028-01-05 (7 actual days: 3 in 2027, 4 in 2028, a leap year).
    // Hand-computed via the same independent script (dayCountFraction cross-checked
    // directly in equations.test.ts).
    const input: CobCanadaInput = {
      flow: 'newMortgageOrLoan',
      productType: 'personalLoan',
      rateType: 'fixed',
      loanAmount: 50000,
      fees: { fees: [] },
      contractRatePercent: 6,
      paymentAmount: 1000,
      paymentFrequency: 'weekly',
      termYears: 1,
      termMonths: 0,
      firstPaymentDate: new Date('2027-12-08'),
      endDate: new Date('2028-02-01'),
      disbursalDate: new Date('2027-12-01'),
    };

    const result = calculateCobCanada(input);
    expect(result.numberOfPayments).toBe(8);

    const row5 = result.amortizationSchedule[4]!;
    expect(row5.date.getTime()).toBe(new Date('2028-01-05').getTime());
    expect(row5.daysInPeriod).toBe(7); // plain calendar days, NOT leap-split
    // periodInterest DOES reflect the leap split: 3/365 + 4/366, not a flat 7/365.
    expect(row5.periodInterest).toBeCloseTo(53.0034672709, 4);
    expect(row5.openingBalance).toBeCloseTo(46223.195571, 3);
  });

  describe('invariant #3: amortized_principal never changes with the financed/cash fee split', () => {
    function withFees(financed: number, cash: number) {
      return {
        fees: [
          { name: 'Financed fee', amount: financed, financed: true, includedInCob: false },
          { name: 'Cash fee', amount: cash, financed: false, includedInCob: false },
        ],
      };
    }

    it('reclassifying the SAME total fee amount from cash to financed leaves amortizedPrincipal untouched -- disbursalAmount and the waterfall split move (spec 011)', () => {
      // feesToRecover (equation 4's waterfall input) is the financed fees only
      // (spec 011 DEV-011-1), so moving a fee to financed moves payment dollars from
      // principal to fees; disbursalAmount (loanAmount - financedFees) drops. The fees
      // paid reduce the balance (spec 011 D9/D8), so interest is unchanged.
      const allCash = calculateCobCanada(fixedMortgageInput({ fees: withFees(0, 5000) }));
      const allFinanced = calculateCobCanada(fixedMortgageInput({ fees: withFees(5000, 0) }));
      expect(allFinanced.amortizedPrincipal).toBe(allCash.amortizedPrincipal);
      expect(allFinanced.feesRecovered).toBeCloseTo(5000, 6);
      expect(allCash.feesRecovered).toBe(0);
      expect(allFinanced.principalPayment).toBeCloseTo(allCash.principalPayment - 5000, 6);
      expect(allFinanced.totalInterest).toBeCloseTo(allCash.totalInterest, 6);
      expect(allFinanced.disbursalAmount).toBeLessThan(allCash.disbursalAmount);
    });

    it('financed fees are inside loanAmount and paid down with it: while every payment covers interest, total_interest equals the no-fee result (spec 011 D9/D8)', () => {
      const noFees = calculateCobCanada(fixedMortgageInput({ fees: { fees: [] } }));
      const withFees5000 = calculateCobCanada(fixedMortgageInput({ fees: withFees(5000, 0) }));
      expect(withFees5000.totalInterest).toBeCloseTo(noFees.totalInterest, 6);
      expect(withFees5000.endingBalance).toBeCloseTo(noFees.endingBalance, 6);
      expect(withFees5000.amortizedPrincipal).toBe(noFees.amortizedPrincipal); // still untouched
    });

    it('financed fees reduce disbursalAmount; cash fees never touch it', () => {
      const financed = calculateCobCanada(fixedMortgageInput({ fees: withFees(5000, 0) }));
      const cash = calculateCobCanada(fixedMortgageInput({ fees: withFees(0, 5000) }));
      expect(financed.disbursalAmount).toBe(95000); // loanAmount - financedFees
      expect(cash.disbursalAmount).toBe(100000); // cash fees don't reduce disbursal
    });

    it('cob_amount includes both fee types unconditionally', () => {
      const financed = calculateCobCanada(fixedMortgageInput({ fees: withFees(5000, 0) }));
      const cash = calculateCobCanada(fixedMortgageInput({ fees: withFees(0, 5000) }));
      expect(financed.cobAmount).toBeCloseTo(financed.totalInterest + 5000, 6);
      expect(cash.cobAmount).toBeCloseTo(cash.totalInterest + 5000, 6);
    });
  });
});
