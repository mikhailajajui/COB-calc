import { describe, expect, it } from 'vitest';
import { calculateCobCanada } from '../../src/ca/index.js';
import { applyPaymentWaterfall } from '../../src/ca/equations.js';
import { validateCobCanadaInput } from '../../src/ca/validate.js';
import type { CobCanadaInput } from '../../src/ca/index.js';
import { asInput, utcDate, wireToInput } from './support/builders.js';
import { loadFixture } from './support/fixtures.js';

/**
 * B14 (QA 2026-09-28): OQ-Y revised (user 2026-09-28, COB-user-stories.md section 7.5).
 * The payment amount must be > 0. This reverses T7 / OQ-Y ("a $0 payment is allowed, as in
 * Excel") and is a named intentional difference from Excel: known_divergence DEV-OQY
 * (COB-architecture.md section 2.1). The macro's ValidateInput only checks IsNumeric(pymtAmnt)
 * (macro lines 315-320), so the workbook runs a full schedule with nothing paid.
 *
 * The workbook truth is kept unchanged in fixtures/ca_oqy_zero_payment_vectors.json (written
 * by fixtures/generate_oqy_zero_payment_vectors.py on top of the trust-checked CalculateAll
 * transliteration). The fixture tests below check that the workbook oracle holds a finished
 * $0 schedule, and that the engine now rejects the same request with
 * `paymentAmount must be > 0, got 0`.
 *
 * Retired by B14 (spec item T1): the 20 engine-output tests for a $0 payment (oracle rows and
 * totals x8, the Z0 4-month example, OQ-L compounding, C/APR x3, Payment column x4, trigger
 * 0%, OQ-W interim $0 x2). Also retired: the OQ-Q `it.fails` on Z1's workbook P basis, which
 * would otherwise keep "failing" for the wrong reason (the validation error); OQ-Q stays
 * covered by 012 D-04 in defects012.test.ts. OQ-L and OQ-W interim stay reachable with a
 * payment > 0 (golden extra:minimumPayment, loopEquations-a5 minPay cases, engineRules-t5).
 */

interface Row {
  n: number;
  date: string;
  days: number;
  open_loan: number;
  open_fees: number;
  new_int: number;
  payment: number;
  interest_paid: number;
  fees_paid: number;
  principal_paid: number;
  close_fees: number;
  close_loan: number;
  unpaid_int_close: number;
}
interface Vector {
  id: string;
  what: string;
  converted_rate_pct: number;
  inputs: { loan: number; fin: number; non_fin: number; end: string };
  request: Record<string, unknown>;
  totals: {
    n: number;
    term_days: number;
    total_payment: number;
    total_interest: number;
    cob_amount: number;
    avg_opening_balance_engine_p: number;
    avg_opening_principal_workbook_p: number;
    cob_rate_pct_engine_p: number;
    cob_rate_pct_workbook_p: number;
    ending_balance: number;
    unpaid_interest_at_end: number;
  };
  rows: Row[];
}
interface WRow {
  n: number;
  date: string;
  days: number;
  open_loan: number;
  carried_open: number;
  new_int: number;
  carried_close: number;
  close_loan: number;
}
const fx = loadFixture('ca_oqy_zero_payment_vectors.json') as {
  tolerance_rel: number;
  vectors: Vector[];
  oqw_interim: {
    inputs: { loan: number; accrued_interest: number };
    request: Record<string, unknown>;
    totals: {
      n: number;
      term_days: number;
      total_interest: number;
      cob_amount: number;
      cob_rate_pct: number;
      ending_balance: number;
      carried_at_end: number;
    };
    rows: WRow[];
  };
};
const TOL = fx.tolerance_rel;
const d = utcDate;

const toInput = (req: Record<string, unknown>): CobCanadaInput => wireToInput(req);

const vec = (id: string): Vector => {
  const v = fx.vectors.find((x) => x.id === id);
  if (!v) throw new Error(`no vector ${id}`);
  return v;
};
const run = (id: string) => calculateCobCanada(toInput(vec(id).request));

const ZERO_VECTORS = ['Z0_no_fees_monthly', 'Z1_financed_fee_monthly', 'Z1b_financed_and_non_financed', 'Z2_mortgage_weekly_into_leap'];
const PAY0 = /^paymentAmount must be > 0, got 0$/;

describe('OQ-Y revised: fixture sanity (no engine call)', () => {
  it('the fixture uses the project tolerance and pins the 4-month example at 104,003.92', () => {
    expect(TOL).toBe(1e-9);
    const z0 = vec('Z0_no_fees_monthly');
    expect(z0.rows.length).toBe(4);
    expect(Math.round(z0.totals.ending_balance * 100) / 100).toBe(104003.92);
  });
});

describe('OQ-Y revised: a $0 payment is rejected (known_divergence DEV-OQY)', () => {
  // OQ-Y revised, known_divergence DEV-OQY (B14-P1): the macro accepts it (IsNumeric only).
  it('validateCobCanadaInput rejects paymentAmount 0 with `paymentAmount must be > 0, got 0`', () => {
    const input = toInput(vec('Z0_no_fees_monthly').request);
    expect(() => validateCobCanadaInput(input)).toThrow(RangeError);
    expect(() => validateCobCanadaInput(input)).toThrow(PAY0);
  });

  it('calculateCobCanada rejects paymentAmount 0 (new loan, no fees)', () => {
    expect(() => run('Z0_no_fees_monthly')).toThrow(RangeError);
    expect(() => run('Z0_no_fees_monthly')).toThrow(PAY0);
  });

  // Unit contract unchanged by B14 (the equation guards stay `>= 0`).
  it('applyPaymentWaterfall with payment 0: nothing is paid, all interest due is carried, fees stay', () => {
    const w = applyPaymentWaterfall(100, 20, 50, 0, 10000);
    expect(w.totalInterestDue).toBe(120);
    expect(w.interestPaid).toBe(0);
    expect(w.carriedAccruedInterestClosing).toBe(120);
    expect(w.feesPaid).toBe(0);
    expect(w.feesClosing).toBe(50);
    expect(w.principalPortion).toBe(0);
    expect(w.amountPaid).toBe(0);
  });
});

describe('OQ-Y revised: the workbook runs $0, the engine rejects it (known_divergence DEV-OQY)', () => {
  for (const id of ZERO_VECTORS) {
    // known_divergence DEV-OQY: the macro oracle holds a finished schedule at $0.
    it(`${id}: the macro oracle holds a finished $0 schedule; the engine throws paymentAmount must be > 0`, () => {
      const v = vec(id);
      expect(v.request.paymentAmount).toBe(0);
      expect(v.rows.length).toBe(v.totals.n);
      expect(v.rows.length).toBeGreaterThan(0);
      expect(v.rows.every((r) => r.payment === 0)).toBe(true);
      expect(v.totals.total_payment).toBe(0);
      expect(() => calculateCobCanada(toInput(v.request))).toThrow(PAY0);
    });
  }

  // known_divergence DEV-OQY: the OQ-W interim $0 renewal vector (workbook output kept).
  it('oqw_interim (renewal, IN-11 > 0, $0): the oracle holds a finished schedule; the engine throws', () => {
    const w = fx.oqw_interim;
    expect(w.request.paymentAmount).toBe(0);
    expect(w.rows.length).toBe(w.totals.n);
    expect(w.rows.length).toBeGreaterThan(0);
    expect(() => calculateCobCanada(toInput(w.request))).toThrow(PAY0);
  });

  // known_divergence DEV-OQY: the variable-rate $0 case used to give a 0% trigger rate.
  it('variable-rate mortgage with a $0 payment is rejected (the 0% trigger rate is unreachable)', () => {
    const req = { ...vec('Z0_no_fees_monthly').request, productType: 'mortgage', rateType: 'variable', semiAnnualCompoundingDate: '2026-01-01' };
    expect(() => calculateCobCanada(toInput(req))).toThrow(PAY0);
  });
});

describe('OQ-Y revised: still rejected', () => {
  const base = () => toInput(vec('Z0_no_fees_monthly').request);
  const bad: [string, unknown][] = [
    ['0', 0],
    ['-0', -0],
    ['-0.01', -0.01],
    ['-100', -100],
    ['NaN', Number.NaN],
    ['undefined', undefined],
    // `null >= 0` is true in JS, so a bare `> 0` -> `>= 0` change would let null through.
    ['null', null],
    ["the string 'abc'", 'abc'],
    // A numeric string ('465.46') is 012 D-11 (open, defects012.test.ts), not repeated here.
    ['-Infinity', Number.NEGATIVE_INFINITY],
  ];
  for (const [label, value] of bad) {
    it(`paymentAmount ${label} is rejected (validate and calculate)`, () => {
      const input = asInput({ ...base(), paymentAmount: value });
      expect(() => validateCobCanadaInput(input)).toThrow(RangeError);
      expect(() => calculateCobCanada(input)).toThrow(RangeError);
    });
  }

  it('applyPaymentWaterfall still rejects a negative or NaN payment', () => {
    expect(() => applyPaymentWaterfall(100, 0, 0, -1, 10000)).toThrow(RangeError);
    expect(() => applyPaymentWaterfall(100, 0, 0, Number.NaN, 10000)).toThrow(RangeError);
  });
});
