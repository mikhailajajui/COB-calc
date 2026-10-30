/**
 * B14 (COB-architecture.md §5 B14, revision 7): the payment amount and the contract rate must
 * be > 0. QA red tests, 2026-09-28, written before the developer step.
 *
 * Decisions: OQ-Y revised (payment > 0) and OQ-AA revised (rate > 0), both user 2026-09-28,
 * COB-user-stories.md §7.5. No minimum beyond > 0. Intentional differences from Excel:
 * known_divergence DEV-OQY and DEV-OQAA (§2.1): the macro's ValidateInput only checks
 * IsNumeric(pymtAmnt) (macro lines 315-320) and IsNumeric(mRate) (lines 187-192), so the
 * workbook runs both $0 and 0%.
 *
 * Contract (B14-R1): in validateCobCanadaInput, right after each field's B3a finite check,
 * `!(x > 0)` throws RangeError `<field> must be > 0, got <x>`. Order: loanAmount finite ->
 * loanAmount > 0 -> rate finite -> rate > 0 -> payment finite -> payment > 0 -> ... The
 * equation-level guards stay `>= 0` (unit contracts, B14-U).
 *
 * UI (B14-U1, ui/ca.js buildInput): a blank rate maps to NaN like a blank payment. Since A10 the
 * mapping lives in ui/ca-view.js `toInput`, tested directly (A10 replaced the former source regex);
 * the two UI mappings are also replayed through the engine (transliteration of numOrUndefined),
 * and the manual tests MT-06a-e (spec) cover the page.
 */
import { describe, expect, it } from 'vitest';
import { calculateCobCanada, FLOWS, requiresSemiAnnualDate } from '../../src/ca/index.js';
import { applyPaymentWaterfall, calculatedRateFor, triggerRatePercent } from '../../src/ca/equations.js';
import { validateCobCanadaInput } from '../../src/ca/validate.js';
import type { CobCanadaInput, CobFlow, ProductType, RateType } from '../../src/ca/index.js';
import type { RawForm } from '../../ui/ca-view.js';
import { asInput, utcDate } from './support/builders.js';
import { loadFixture } from './support/fixtures.js';
import { ON } from './support/uiSwitches.js';

const d = utcDate;
// Same base as numericGuard-b3a.test.ts newLoan (spec: "base input is newLoan").
const newLoan = (o: Record<string, unknown> = {}): CobCanadaInput =>
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
    endDate: d('2026-05-01'),
    termYears: 0,
    termMonths: 4,
    fees: { fees: [] },
    ...o,
  });

/** Both entry points (V+C) throw a RangeError whose message is exactly `msg`. */
function expectBoth(input: CobCanadaInput, msg: string): void {
  for (const fn of [validateCobCanadaInput, calculateCobCanada] as const) {
    let err: unknown;
    try {
      fn(input);
    } catch (e) {
      err = e;
    }
    expect(err, `${fn.name} should throw`).toBeInstanceOf(RangeError);
    expect((err as Error).message, fn.name).toBe(msg);
  }
}
function expectAccepted(input: CobCanadaInput): void {
  expect(() => validateCobCanadaInput(input)).not.toThrow();
  const r = calculateCobCanada(input);
  expect(r.amortizationSchedule.length).toBeGreaterThan(0);
  for (const k of ['cobAmount', 'cobRatePercent', 'totalPayment', 'calculatedRatePercent'] as const) {
    expect(Number.isFinite(r[k]), k).toBe(true);
  }
}

const PAY0 = 'paymentAmount must be > 0, got 0';
const RATE0 = 'contractRatePercent must be > 0, got 0';

// OQ-Y revised, known_divergence DEV-OQY (macro lines 315-320 accept any numeric payment).
describe('B14 OQ-Y revised: paymentAmount must be > 0 (known_divergence DEV-OQY)', () => {
  it('B14-P1: paymentAmount 0 -> `paymentAmount must be > 0, got 0`', () => expectBoth(newLoan({ paymentAmount: 0 }), PAY0));
  it('B14-P2: paymentAmount -0 -> the same message (prints "got 0")', () => expectBoth(newLoan({ paymentAmount: -0 }), PAY0));
  it('B14-P3: paymentAmount -1 -> `paymentAmount must be > 0, got -1`', () =>
    expectBoth(newLoan({ paymentAmount: -1 }), 'paymentAmount must be > 0, got -1'));
  it('B14-P3: paymentAmount -5e-324 -> `paymentAmount must be > 0, got -5e-324`', () =>
    expectBoth(newLoan({ paymentAmount: -5e-324 }), 'paymentAmount must be > 0, got -5e-324'));
  it('B14-P4: paymentAmount 0.01 and 5e-324 are accepted (no minimum beyond > 0)', () => {
    expectAccepted(newLoan({ paymentAmount: 0.01 }));
    expectAccepted(newLoan({ paymentAmount: 5e-324 }));
  });
  it('B14-P5: paymentAmount NaN keeps the B3a finite message (finite check first)', () =>
    expectBoth(newLoan({ paymentAmount: Number.NaN }), 'paymentAmount must be a finite number, got NaN'));
});

// OQ-AA revised, known_divergence DEV-OQAA (macro lines 187-192 accept any numeric rate).
describe('B14 OQ-AA revised: contractRatePercent must be > 0 (known_divergence DEV-OQAA)', () => {
  it('B14-R1: contractRatePercent 0 -> `contractRatePercent must be > 0, got 0`', () =>
    expectBoth(newLoan({ contractRatePercent: 0 }), RATE0));
  it('B14-R2: contractRatePercent -0 -> the same message (prints "got 0")', () =>
    expectBoth(newLoan({ contractRatePercent: -0 }), RATE0));
  it('B14-R3: contractRatePercent -1 -> `contractRatePercent must be > 0, got -1`', () =>
    expectBoth(newLoan({ contractRatePercent: -1 }), 'contractRatePercent must be > 0, got -1'));
  it('B14-R1: rate 0 is rejected for every product/rate pair (fixed mortgage m = 2 too)', () => {
    for (const [productType, rateType] of [
      ['personalLoan', 'fixed'], ['personalLoan', 'variable'], ['mortgage', 'fixed'], ['mortgage', 'variable'],
    ]) {
      expectBoth(newLoan({ productType, rateType, semiAnnualCompoundingDate: d('2026-01-01'), contractRatePercent: 0 }), RATE0);
    }
  });
  it('B14-R4: contractRatePercent 0.001 and 5e-324 are accepted (no minimum beyond > 0)', () => {
    expectAccepted(newLoan({ contractRatePercent: 0.001 }));
    expectAccepted(newLoan({ contractRatePercent: 5e-324 }));
  });
  it('B14-R5: contractRatePercent NaN keeps the B3a finite message (finite check first)', () =>
    expectBoth(newLoan({ contractRatePercent: Number.NaN }), 'contractRatePercent must be a finite number, got NaN'));
});

// OQ-Y revised / OQ-AA revised: check order (loan -> rate -> payment).
describe('B14 OQ-Y revised / OQ-AA revised: check order', () => {
  it('B14-O1: rate 0 and payment 0 -> the rate message', () =>
    expectBoth(newLoan({ contractRatePercent: 0, paymentAmount: 0 }), RATE0));
  it('B14-O2: rate 0 and payment NaN -> the rate message', () =>
    expectBoth(newLoan({ contractRatePercent: 0, paymentAmount: Number.NaN }), RATE0));
  it('B14-O3: loanAmount 0 and rate 0 -> `loanAmount must be > 0, got 0`', () =>
    expectBoth(newLoan({ loanAmount: 0, contractRatePercent: 0 }), 'loanAmount must be > 0, got 0'));
  it('B14-O4: rate NaN and payment 0 -> the rate finite message (rate before payment)', () =>
    expectBoth(newLoan({ contractRatePercent: Number.NaN, paymentAmount: 0 }), 'contractRatePercent must be a finite number, got NaN'));
  it('B14-O5: payment 0 comes before the enum checks (bad paymentFrequency)', () =>
    expectBoth(newLoan({ paymentAmount: 0, paymentFrequency: 'daily' }), PAY0));
});

// OQ-Y revised / OQ-AA revised: the equation-level guards are unit contracts and stay `>= 0`.
describe('B14-U OQ-Y revised / OQ-AA revised: equation unit contracts unchanged', () => {
  it('applyPaymentWaterfall(1, 0, 0, 0, 100) does not throw; amountPaid 0', () => {
    expect(applyPaymentWaterfall(1, 0, 0, 0, 100).amountPaid).toBe(0);
  });
  it('triggerRatePercent(0, 12, 1000) is 0', () => {
    expect(triggerRatePercent(0, 12, 1000)).toBe(0);
  });
  it("calculatedRateFor('mortgage', 'fixed', 0, 12) is { percent 0, decimal 0 } (m = 2 zero-rate edge, moved from A5)", () => {
    const r = calculatedRateFor('mortgage', 'fixed', 0, 12);
    expect(r.percent).toBe(0);
    expect(r.decimal).toBe(0);
    const v = calculatedRateFor('personalLoan', 'fixed', 0, 12);
    expect(v.percent).toBe(0);
    expect(v.decimal).toBe(0);
  });
});

// OQ-AA revised (B14-U1, the former B12): the UI maps a blank rate to NaN like a blank payment.
describe('B14-U1 OQ-AA revised: UI rate mapping (ui/ca.js)', () => {
  /** Transliteration of ui/ca.js numOrUndefined (unchanged by B14). */
  const numOrUndefined = (value: string | null | undefined) => {
    if (value === '' || value === null || value === undefined) return undefined;
    const n = Number(value);
    return Number.isNaN(n) ? undefined : n;
  };
  const fromForm = (rate: string, pay: string) =>
    newLoan({ contractRatePercent: numOrUndefined(rate) ?? NaN, paymentAmount: numOrUndefined(pay) ?? NaN });

  // A10 (COB-architecture.md §5 A10, revision 15): buildInput moved to ui/ca-view.js as toInput(raw, ctx),
  // so the former source regex becomes a behavioural test on the REF-01 raw captured from the page.
  it('toInput maps a blank rate and a blank payment to NaN (numOrUndefined ?? NaN)', async () => {
    const { toInput } = await import('../../ui/ca-view.js');
    const cap = loadFixture<{ scenarios: { id: string; raw: RawForm }[] }>('a10_ui_capture_v1.json');
    const raw = cap.scenarios.find((s) => s.id === 'REF-01')!.raw;
    const ctx = { spec: FLOWS[raw.flow as CobFlow], semiAnnual: requiresSemiAnnualDate(raw.productType as ProductType, raw.rateType as RateType), switches: ON };
    expect(toInput({ ...raw, contractRatePercent: '' }, ctx).contractRatePercent).toBeNaN();
    expect(toInput({ ...raw, paymentAmount: '' }, ctx).paymentAmount).toBeNaN();
    expect(toInput({ ...raw, contractRatePercent: '12' }, ctx).contractRatePercent).toBe(12);
    expect(toInput({ ...raw, paymentAmount: '12' }, ctx).paymentAmount).toBe(12);
  });
  it('MT-06a (engine side): blank rate -> the finite message', () =>
    expectBoth(fromForm('', '2000'), 'contractRatePercent must be a finite number, got NaN'));
  it('MT-06b (engine side): typed 0 rate -> `contractRatePercent must be > 0, got 0` (reversed from B12)', () =>
    expectBoth(fromForm('0', '2000'), RATE0));
  it('MT-06c (engine side): blank payment -> the finite message (unchanged)', () =>
    expectBoth(fromForm('12', ''), 'paymentAmount must be a finite number, got NaN'));
  it('MT-06d (engine side): typed 0 payment -> `paymentAmount must be > 0, got 0`', () =>
    expectBoth(fromForm('12', '0'), PAY0));
});
