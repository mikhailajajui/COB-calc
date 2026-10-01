import { describe, expect, it } from 'vitest';
import { calculateCobCanada } from '../../src/ca/index.js';
import type { CobCanadaInput } from '../../src/ca/index.js';
import { asInput, utcDate } from './support/builders.js';

/**
 * QA B3a verification (2026-09-27). Pins behaviour found in the independent sweep that the
 * red set (numericGuard-b3a.test.ts) doesn't cover.
 */
const d = utcDate;
const base = (over: Record<string, unknown> = {}): CobCanadaInput =>
  asInput({
    flow: 'newMortgageOrLoan',
    productType: 'personalLoan',
    rateType: 'fixed',
    loanAmount: 100000,
    contractRatePercent: 12,
    paymentAmount: 2000,
    paymentFrequency: 'monthly',
    disbursalDate: d('2026-01-01'),
    firstPaymentDate: d('2026-02-01'),
    endDate: d('2027-01-01'),
    termYears: 1,
    termMonths: 0,
    fees: { fees: [] },
    ...over,
  });

describe('B3a ruling R2 end to end: a sub-cent negative principalOutstanding on a valid path', () => {
  // loanAmount is 1 ULP above the financed fee, OQ-L capitalisation. Under the pre-B3a
  // engine this input (then with a $0 payment) drove applyPaymentWaterfall with
  // principalOutstanding < 0 on 8 calls (min -1.75e-10), measured with an instrumented copy
  // of dist/ca. B14 (OQ-Y revised: payment > 0): the payment is now the minimum $0.01. QA
  // re-measured with an instrumented copy (2026-09-28): still 53 rows and 12 waterfall calls
  // with principalOutstanding < 0 (min -1.75e-10), so the input still exercises ruling R2.
  it('calculateCobCanada does not throw and produces the full schedule', () => {
    const input = base({
      productType: 'mortgage', // B27: DEV-FB24 class A (biweekly is vehicle only; twin of the personal loan)
      rateType: 'variable',
      loanAmount: 859377.5800000001,
      contractRatePercent: 25.27,
      paymentAmount: 0.01,
      paymentFrequency: 'biweekly',
      disbursalDate: d('2027-02-05'),
      firstPaymentDate: d('2027-02-15'),
      endDate: d('2029-02-15'),
      termYears: 2,
      termMonths: 0,
      fees: { fees: [{ name: 'F', amount: 859377.58, financed: true, includedInCob: true }] },
    });
    expect(input.loanAmount).toBeGreaterThan(859377.58);
    const r = calculateCobCanada(input);
    expect(r.amortizationSchedule).toHaveLength(53);
  });
});

describe('B3a: a non-object fee entry is a RangeError naming fees.fees[i]', () => {
  for (const [name, fee] of [
    ['null', null],
    ['number 5', 5],
    ['string', 'fee'],
    ['undefined', undefined],
  ] as const) {
    it(`fee entry ${name}`, () => {
      expect(() => calculateCobCanada(base({ fees: { fees: [fee] } }))).toThrow(RangeError);
      expect(() => calculateCobCanada(base({ fees: { fees: [fee] } }))).toThrow(/fees\.fees\[0\]/);
    });
  }
});

describe('B3a: prototype-less objects as numeric values are a RangeError naming the field', () => {
  // 012 D-11 (B3a QA finding): String(Object.create(null)) throws TypeError inside the
  // message builder, so the rejection surfaces as "TypeError: Cannot convert object to
  // primitive value" instead of a RangeError naming the field. Remove .fails when fixed.
  it.fails('loanAmount / contractRatePercent / paymentAmount / fee amount = Object.create(null)', () => {
    for (const over of [
      { loanAmount: Object.create(null) },
      { contractRatePercent: Object.create(null) },
      { paymentAmount: Object.create(null) },
      { fees: { fees: [{ name: 'A', amount: Object.create(null), financed: true, includedInCob: true }] } },
    ]) {
      const field = Object.keys(over)[0] === 'fees' ? /A amount/ : new RegExp(Object.keys(over)[0]!);
      expect(() => calculateCobCanada(base(over))).toThrow(RangeError);
      expect(() => calculateCobCanada(base(over))).toThrow(field);
    }
  });
});
