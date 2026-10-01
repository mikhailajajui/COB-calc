import { describe, expect, it } from 'vitest';
import { calculateCobCanada } from '../../src/ca/index.js';
import { applyPaymentWaterfall } from '../../src/ca/equations.js';
import type { CobCanadaInput, CobCanadaResult } from '../../src/ca/index.js';
import { expectRelFloor1 } from './support/compare.js';

/**
 * OQ-K / OQ-T (decision 2026-09-27: follow the workbook exactly). On the payoff row,
 * interest and fees are paid normally, principal paid = the remaining principal, and
 * the row's Payment = the remaining principal ONLY (macro CalculateAll:
 * `pymtAmnt = currPrinciple`). Total Payments sums that displayed Payment.
 * Tolerance 1e-9 relative.
 */

const REL_TOL = 1e-9;

const expectRel = (actual: number, expected: number): void => expectRelFloor1(actual, expected, REL_TOL);

const financed = (amount: number) => ({ name: 'Admin', amount, financed: true, includedInCob: true });
const nonFinanced = (amount: number) => ({ name: 'Appraisal', amount, financed: false, includedInCob: true });

/** Personal loan, monthly: m = n = 12, so the calculated rate equals the contract rate.
 *  36.5% makes period interest = balance x 0.001 x days (dayCountFraction = days / 365,
 *  no leap year in 2026). */
function loan(overrides: Partial<CobCanadaInput> = {}): CobCanadaInput {
  return {
    flow: 'newMortgageOrLoan',
    productType: 'personalLoan',
    rateType: 'fixed',
    loanAmount: 1000,
    contractRatePercent: 36.5,
    paymentAmount: 500,
    paymentFrequency: 'monthly',
    disbursalDate: new Date('2026-01-01'),
    firstPaymentDate: new Date('2026-02-01'),
    endDate: new Date('2026-12-01'),
    termYears: 1,
    termMonths: 0,
    fees: { fees: [financed(100)] },
    ...overrides,
  } as CobCanadaInput;
}

describe('OQ-K / OQ-T last payment = remaining principal (workbook rule)', () => {
  it('three-row payoff with a financed fee: hand-computed rows and totals', () => {
    // Row 1 (Jan 1 -> Feb 1, 31 d): interest 1000 x 0.031 = 31; fees 100;
    //   principal 500 - 31 - 100 = 369; closing 1000 - 100 - 369 = 531.
    // Row 2 (Feb 1 -> Mar 1, 28 d): interest 531 x 0.028 = 14.868; principal
    //   500 - 14.868 = 485.132 (< 531, not a payoff); closing 45.868.
    // Row 3 (Mar 1 -> Apr 1, 31 d): interest 45.868 x 0.031 = 1.421908; left after
    //   interest 498.578092 > 45.868 -> payoff. Principal 45.868, Payment 45.868
    //   (not 45.868 + 1.421908 = 47.289908); closing 0.
    // Total Payments = 500 + 500 + 45.868 = 1045.868.
    const res = calculateCobCanada(loan());
    const rows = res.amortizationSchedule;
    expect(res.numberOfPayments).toBe(3);
    expect(rows[0]!.paymentAmount).toBe(500);
    expect(rows[1]!.paymentAmount).toBe(500);
    const last = rows[2]!;
    expectRel(last.interestPaid, 1.421908);
    expect(last.feesPaid).toBe(0);
    expectRel(last.principalPortion, 45.868);
    expectRel(last.paymentAmount, 45.868);
    expect(last.closingBalance).toBe(0);
    expectRel(res.totalPayment, 1045.868);
    expectRel(res.totalInterest, 31 + 14.868 + 1.421908);
    expect(res.feesRecovered).toBe(100);
    expectRel(res.principalPayment, 900);
    expect(res.endingBalance).toBe(0);
  });

  it('edge: payoff on row 1 pays the fee and interest normally, but Payment shows the principal only', () => {
    // Row 1: interest 1000 x 0.031 = 31; fees 100; left 5000 - 131 = 4869 > 900 ->
    // payoff. Principal 900, Payment 900; closing 1000 - 100 - 900 = 0.
    const res = calculateCobCanada(loan({ paymentAmount: 5000 }));
    const [row] = res.amortizationSchedule;
    expect(res.numberOfPayments).toBe(1);
    expectRel(row!.interestPaid, 31);
    expect(row!.feesPaid).toBe(100);
    expect(row!.principalPortion).toBe(900);
    expect(row!.paymentAmount).toBe(900);
    expect(row!.closingBalance).toBe(0);
    expect(res.totalPayment).toBe(900);
  });

  it('boundary: money left after interest and fees exactly equal to the principal is not a payoff (Payment stays the input)', () => {
    // VBA: `If currPrinciple >= moneyLeft Then principlePaid = moneyLeft` -- the input
    // payment is kept. 10 + 50 + 200 = 260.
    const w = applyPaymentWaterfall(10, 0, 50, 260, 200);
    expect(w.principalPortion).toBe(200);
    expect(w.amountPaid).toBe(260);
  });

  it('waterfall: a payoff row records the remaining principal as amountPaid', () => {
    // 10 interest + 50 fees paid; 940 left > 200 principal -> Payment 200.
    const w = applyPaymentWaterfall(10, 0, 50, 1000, 200);
    expect(w.interestPaid).toBe(10);
    expect(w.feesPaid).toBe(50);
    expect(w.feesClosing).toBe(0);
    expect(w.principalPortion).toBe(200);
    expect(w.amountPaid).toBe(200);
  });

  it('negative payment rejected', () => {
    // OQ-Y 2026-09-27: $0 payment allowed; negative still rejected
    expect(() => calculateCobCanada(loan({ paymentAmount: -1 }))).toThrow(RangeError);
  });
});

describe('OQ-K / OQ-T invariants', () => {
  const INPUTS: [string, CobCanadaInput][] = [
    ['three-row payoff with a financed fee', loan()],
    ['row-1 payoff', loan({ paymentAmount: 5000 })],
    ['payoff with a non-financed fee', loan({ fees: { fees: [financed(100), nonFinanced(50)] } })],
    ['no payoff (term ends first)', loan({ loanAmount: 100000, paymentAmount: 3500, fees: { fees: [] } })],
  ];

  const payoffHappened = (res: CobCanadaResult) => res.amortizationSchedule.at(-1)!.closingBalance === 0;

  it.each(INPUTS)('%s: sum of the Payment column == Total of all payments', (_label, input) => {
    const res = calculateCobCanada(input);
    const sum = res.amortizationSchedule.reduce((s, r) => s + r.paymentAmount, 0);
    expectRel(res.totalPayment, sum);
  });

  it.each(INPUTS)('%s: every row but a payoff row pays the input payment; a payoff row pays its principal', (_label, input) => {
    const res = calculateCobCanada(input);
    const rows = res.amortizationSchedule;
    rows.forEach((row, i) => {
      if (i === rows.length - 1 && payoffHappened(res)) {
        expect(row.paymentAmount).toBe(row.principalPortion);
      } else {
        expect(row.paymentAmount).toBe(input.paymentAmount);
      }
    });
  });

  it.each(INPUTS)('%s: Total of all payments == total paid - the payoff row\'s interest and fees', (_label, input) => {
    const res = calculateCobCanada(input);
    const last = res.amortizationSchedule.at(-1)!;
    const dropped = payoffHappened(res) ? last.interestPaid + last.feesPaid : 0;
    expectRel(res.totalPayment, res.totalInterest + res.feesRecovered + res.principalPayment - dropped);
  });
});
