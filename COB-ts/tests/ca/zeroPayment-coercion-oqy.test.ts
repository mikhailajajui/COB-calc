import { describe, expect, it } from 'vitest';
import { calculateCobCanada } from '../../src/ca/index.js';
import { applyPaymentWaterfall, triggerRatePercent } from '../../src/ca/equations.js';
import { validateCobCanadaInput } from '../../src/ca/validate.js';
import type { CobCanadaInput } from '../../src/ca/index.js';
import { asInput, utcDate } from './support/builders.js';

/**
 * T7 follow-up (QA 2026-09-27), updated for B14 (QA 2026-09-28). OQ-Y had relaxed the
 * payment guard to `>= 0`; JavaScript's `>=` coerces, so '' (-> 0), false (-> 0), [] (-> 0)
 * and Infinity could have passed as a payment. B3a (012 D-11, fixed) added a finite-number
 * check that rejects every non-number and non-finite value first, so these cases are plain
 * `it` tests (no longer `it.fails`).
 *
 * OQ-Y revised (user 2026-09-28, COB-user-stories.md section 7.5; B14, known_divergence
 * DEV-OQY): the payment must be > 0, so -0 is now rejected with `paymentAmount must be > 0,
 * got 0` (it closes B11's QA note "a -0 payment input passes validation"). The equation-level
 * guards (waterfall, trigger) stay `>= 0` as unit contracts (B14 spec).
 * ui/ca.js can't send any of these (numOrUndefined maps '' to undefined, then `?? NaN`).
 */
const d = utcDate;
const base = (paymentAmount: unknown): CobCanadaInput =>
  asInput({
    flow: 'newMortgageOrLoan',
    productType: 'personalLoan',
    rateType: 'fixed',
    loanAmount: 100000,
    contractRatePercent: 12,
    paymentAmount,
    paymentFrequency: 'monthly',
    disbursalDate: d('2026-01-01'),
    firstPaymentDate: d('2026-02-01'),
    endDate: d('2026-05-01'),
    termYears: 0,
    termMonths: 4,
    fees: { fees: [] },
  });

const coerced: [string, unknown][] = [
  ["'' (empty string)", ''],
  ['false', false],
  ['[] (empty array)', []],
  ['Infinity', Infinity],
];

describe('T7 OQ-Y follow-up: values that coerce past `>= 0` (012 D-11, fixed by B3a)', () => {
  for (const [name, v] of coerced) {
    it(`paymentAmount ${name} is rejected by validate, calculate, waterfall and trigger`, () => {
      expect(() => validateCobCanadaInput(base(v))).toThrow(/paymentAmount/);
      expect(() => calculateCobCanada(base(v))).toThrow(/paymentAmount/);
      expect(() => applyPaymentWaterfall(100, 0, 0, v as number, 10000)).toThrow(/paymentAmount/);
      expect(() => triggerRatePercent(v as number, 12, 100000)).toThrow(/paymentAmount/);
    });
  }

  // OQ-Y revised, known_divergence DEV-OQY (B14-P2): the macro accepts any numeric payment.
  it('OQ-Y revised: -0 is rejected like 0 (validate and calculate), and the message prints "got 0"', () => {
    expect(() => validateCobCanadaInput(base(-0))).toThrow(RangeError);
    expect(() => validateCobCanadaInput(base(-0))).toThrow(/^paymentAmount must be > 0, got 0$/);
    expect(() => calculateCobCanada(base(-0))).toThrow(/^paymentAmount must be > 0, got 0$/);
  });

  it('null, undefined and NaN are rejected at all four entry points', () => {
    for (const v of [null, undefined, NaN]) {
      expect(() => validateCobCanadaInput(base(v))).toThrow(RangeError);
      expect(() => calculateCobCanada(base(v))).toThrow(RangeError);
      expect(() => applyPaymentWaterfall(100, 0, 0, v as number, 10000)).toThrow(RangeError);
      expect(() => triggerRatePercent(v as number, 12, 100000)).toThrow(RangeError);
    }
  });
});
