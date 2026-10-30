import { describe, expect, it } from 'vitest';
import { calculateCobCanada } from '../../src/ca/index.js';
import { applyPaymentWaterfall, triggerRatePercent } from '../../src/ca/equations.js';
import { validateCobCanadaInput } from '../../src/ca/validate.js';
import type { CobCanadaInput } from '../../src/ca/index.js';
import { asInput, utcDate } from './support/builders.js';
import { expectRangeErrorMatching } from './support/compare.js';
import { rehome } from './support/rehome.js';

/**
 * B3a / 012 D-11 (COB-architecture.md §5 B3a, revisions 2-3): finite-number guard.
 * Rev 3 rulings pinned here: R1 (accruedInterest: null rejected), R2 (principalOutstanding
 * guard is finite-only, no sign check: a sub-cent negative is a valid-path value), and the
 * explicit scope (own-key enum allowlists, `fees` shape, numeric-before-derived order,
 * negative-value message text unchanged).
 * QA RED tests, 2026-09-27. Written before the fix; plain `it` (not `.fails`), so they
 * are red until the developer lands `isFiniteNumber` in types.ts and uses it in every
 * numeric guard in validate.ts, fees.ts (validateFee) and equations.ts (waterfall, trigger).
 *
 * Contract under test, per B3a: every non-number or non-finite numeric input is rejected
 * with a RangeError (the engine's only error type: validate.ts header, "plain RangeError,
 * no custom error classes") whose message names the field. Valid numbers, including 0
 * wherever 0 is allowed, are still accepted.
 *
 * Cases that already pass on the pre-B3a code are kept here as regression guards
 * (B24: termYears / termMonths are no longer validated; their rows were retired).
 * `flow: 'foo'`, `productType: 'car'`, `rateType: 'floating'`, `paymentFrequency: 'toString'`
 * and `fees: null` are pinned in defects012.test.ts (D-11 block) and not repeated here.
 */
const d = utcDate;

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

// B21 (decision 9): Renewal is mortgage-only, so this builder is a mortgage / variable renewal.
const renewal = (o: Record<string, unknown> = {}): CobCanadaInput =>
  newLoan({ flow: 'renewal', productType: 'mortgage', rateType: 'variable', disbursalDate: undefined, renewalDate: d('2026-01-01'), accruedInterest: 0, ...o });

const feeWith = (amount: unknown, financed: boolean) =>
  newLoan({ fees: { fees: [{ name: financed ? 'FinFee' : 'CashFee', amount, financed, includedInCob: true }] } });

/** Throws a RangeError whose message names `field` (a downstream RangeError can't stand in). */
const expectRangeErrorNaming = expectRangeErrorMatching;

type Bad = [label: string, value: unknown];
const NON_NUMBERS: Bad[] = [
  ["numeric string '465.46'", '465.46'],
  ["numeric string '0'", '0'],
  ["'' (empty string)", ''],
  ['true', true],
  ['false', false],
  ['[] (empty array)', []],
  ['[5] (single-element array)', [5]],
  ['{} (object)', {}],
];
const NON_FINITE: Bad[] = [
  ['NaN', NaN],
  ['Infinity', Infinity],
  ['-Infinity', -Infinity],
];
const NULLISH_REQUIRED: Bad[] = [
  ['null', null],
  ['undefined', undefined],
];
const ALL_BAD_REQUIRED = [...NON_NUMBERS, ...NON_FINITE, ...NULLISH_REQUIRED];

// Required CobCanadaInput numbers. Each is checked through validate and through the public entry point.
const REQUIRED_FIELDS: [field: string, build: (v: unknown) => CobCanadaInput][] = [
  ['loanAmount', (v) => newLoan({ loanAmount: v })],
  ['contractRatePercent', (v) => newLoan({ contractRatePercent: v })],
  ['paymentAmount', (v) => newLoan({ paymentAmount: v })],
  // B24 (user 2026-09-30): termYears / termMonths are optional, deprecated and never validated, so their 26 bad-value
  // rows (13 bad values x 2 fields) are retired; the same inputs are now accepted and ignored (b24-term-rule T4).
];

describe('B3a D-11: required numeric inputs reject non-numbers and non-finite numbers', () => {
  for (const [field, build] of REQUIRED_FIELDS) {
    for (const [label, v] of ALL_BAD_REQUIRED) {
      it(`${field} = ${label} -> RangeError naming ${field} (validate and calculate)`, () => {
        const re = new RegExp(field);
        expectRangeErrorNaming(() => validateCobCanadaInput(build(v)), re);
        expectRangeErrorNaming(() => calculateCobCanada(build(v)), re);
      });
    }
  }
});

describe('B3a D-11: fee amount rejects non-numbers, non-finite numbers and null', () => {
  for (const financed of [true, false]) {
    const name = financed ? 'FinFee' : 'CashFee';
    for (const [label, v] of ALL_BAD_REQUIRED) {
      it(`${financed ? 'financed' : 'cash'} fee amount = ${label} -> RangeError naming the fee amount`, () => {
        const re = new RegExp(`${name}.*amount`);
        expectRangeErrorNaming(() => validateCobCanadaInput(feeWith(v, financed)), re);
        expectRangeErrorNaming(() => calculateCobCanada(feeWith(v, financed)), re);
      });
    }
  }
});

describe('B3a D-11: accruedInterest (renewal flow; required since B20) rejects every present non-finite-number', () => {
  for (const [label, v] of [...NON_NUMBERS, ...NON_FINITE]) {
    it(`accruedInterest = ${label} -> RangeError naming accruedInterest`, () => {
      expectRangeErrorNaming(() => validateCobCanadaInput(renewal({ accruedInterest: v })), /accruedInterest/);
      expectRangeErrorNaming(() => calculateCobCanada(renewal({ accruedInterest: v })), /accruedInterest/);
    });
  }
  // Optional means absent (undefined). null is present-but-not-a-number, so under
  // isFiniteNumber it is rejected. Separate test so the decision stays visible.
  it('accruedInterest = null -> RangeError naming accruedInterest (only undefined is absent; null is present-but-bad)', () => {
    expectRangeErrorNaming(() => validateCobCanadaInput(renewal({ accruedInterest: null })), /accruedInterest/);
  });
});

// Equation-level guards that B3a names explicitly (waterfall and trigger rate).
describe('B3a D-11: applyPaymentWaterfall / triggerRatePercent numeric params', () => {
  const W = [100, 0, 0, 1000, 10000] as const; // periodInterest, carriedAccrued, feesOpening, payment, principalOutstanding
  const W_NAMES = ['periodInterestAmount', 'carriedAccruedInterestOpening', 'feesOpening', 'paymentAmount', 'principalOutstanding'];
  const waterfall = (i: number, v: unknown) => {
    const a: unknown[] = [...W];
    a[i] = v;
    return () => (applyPaymentWaterfall as (...x: unknown[]) => unknown)(...a);
  };
  W_NAMES.forEach((name, i) => {
    for (const [label, v] of ALL_BAD_REQUIRED) {
      it(`applyPaymentWaterfall ${name} = ${label} -> RangeError naming ${name}`, () => {
        expectRangeErrorNaming(waterfall(i, v), new RegExp(name));
      });
    }
  });

  const T = [1000, 12, 100000] as const;
  const T_NAMES = ['paymentAmount', 'paymentsPerYear', 'loanAmount'];
  const trigger = (i: number, v: unknown) => {
    const a: unknown[] = [...T];
    a[i] = v;
    return () => (triggerRatePercent as (...x: unknown[]) => unknown)(...a);
  };
  T_NAMES.forEach((name, i) => {
    for (const [label, v] of ALL_BAD_REQUIRED) {
      it(`triggerRatePercent ${name} = ${label} -> RangeError naming ${name}`, () => {
        expectRangeErrorNaming(trigger(i, v), new RegExp(name));
      });
    }
  });
});

describe('B3a D-11: valid numbers are still accepted (including 0 where allowed; B14: not for rate or payment)', () => {
  const finiteResult = (input: CobCanadaInput) => {
    expect(() => validateCobCanadaInput(input)).not.toThrow();
    const r = calculateCobCanada(input);
    for (const k of ['cobAmount', 'cobRatePercent', 'totalPayment', 'calculatedRatePercent'] as const) {
      expect(Number.isFinite(r[k]), k).toBe(true);
    }
  };
  it('baseline new loan', () => finiteResult(newLoan()));
  it('loanAmount 0.01 (smallest positive cent)', () => finiteResult(newLoan({ loanAmount: 0.01, paymentAmount: 1 })));
  // OQ-AA revised / OQ-Y revised (B14, 2026-09-28): 0 and -0 are no longer valid for the rate
  // or the payment (known_divergence DEV-OQAA / DEV-OQY). Smallest accepted edges pinned here;
  // the rejections are the next two tests, full set in b14-payment-rate-positive.test.ts.
  it('OQ-AA revised: contractRatePercent 0.001 is accepted', () => finiteResult(newLoan({ contractRatePercent: 0.001 })));
  it('OQ-Y revised: paymentAmount 0.01 is accepted', () => finiteResult(newLoan({ paymentAmount: 0.01 })));
  // known_divergence DEV-OQAA (B14-R1/R2): the macro accepts a 0% rate (IsNumeric only).
  it('OQ-AA revised: contractRatePercent 0 and -0 are rejected (validate and calculate)', () => {
    for (const v of [0, -0]) {
      expect(() => validateCobCanadaInput(newLoan({ contractRatePercent: v }))).toThrow(/^contractRatePercent must be > 0, got 0$/);
      expect(() => calculateCobCanada(newLoan({ contractRatePercent: v }))).toThrow(/^contractRatePercent must be > 0, got 0$/);
    }
  });
  // known_divergence DEV-OQY (B14-P1/P2): the macro accepts a $0 payment (IsNumeric only).
  it('OQ-Y revised: paymentAmount 0 and -0 are rejected (validate and calculate)', () => {
    for (const v of [0, -0]) {
      expect(() => validateCobCanadaInput(newLoan({ paymentAmount: v }))).toThrow(/^paymentAmount must be > 0, got 0$/);
      expect(() => calculateCobCanada(newLoan({ paymentAmount: v }))).toThrow(/^paymentAmount must be > 0, got 0$/);
    }
  });
  it('fee amount 0, financed and cash', () => {
    finiteResult(feeWith(0, true));
    finiteResult(feeWith(0, false));
  });
  it('fee amount 2000 financed and 400 cash', () => {
    finiteResult(
      newLoan({
        fees: {
          fees: [
            { name: 'F', amount: 2000, financed: true, includedInCob: true },
            { name: 'C', amount: 400, financed: false, includedInCob: true },
          ],
        },
      }),
    );
  });
  it('accruedInterest 0 and 850.25 give finite results; absent (undefined) is rejected since B20 (decision 4)', () => {
    finiteResult(renewal({ accruedInterest: 0 }));
    finiteResult(renewal({ accruedInterest: 850.25 }));
    expect(() => calculateCobCanada(renewal({ accruedInterest: undefined }))).toThrow(
      /flow 'renewal' requires accruedInterest \(enter 0 if there is none\)/,
    );
  });
  it('termYears 0 with termMonths 4; termYears 1 with termMonths 0 and 11', () => {
    finiteResult(newLoan({ termYears: 0, termMonths: 4 }));
    finiteResult(newLoan({ termYears: 1, termMonths: 0, endDate: d('2027-01-01') }));
    finiteResult(newLoan({ termYears: 1, termMonths: 11, endDate: d('2027-12-01') }));
  });
  it('equation-level zeros: waterfall with all-zero amounts, trigger rate with a $0 payment', () => {
    expect(() => applyPaymentWaterfall(0, 0, 0, 0, 0)).not.toThrow();
    expect(triggerRatePercent(0, 12, 100000)).toBe(0);
  });
  it('principalOutstanding may be 0 or negative-zero in the waterfall (finite)', () => {
    expect(() => applyPaymentWaterfall(100, 0, 0, 1000, 0)).not.toThrow();
    expect(() => applyPaymentWaterfall(100, 0, 0, 1000, -0)).not.toThrow();
  });
  // Ruling R2 (rev 3): the guard is isFiniteNumber only, no sign condition. This exact call is
  // reachable on a valid path (architect's ULP probe: loanAmount = financed fee + a few ULPs,
  // OQ-L capitalisation). A `>= 0` guard would pass every red test above and break this one.
  // Args: periodInterestAmount, carriedAccruedInterestOpening, feesOpening, paymentAmount,
  // principalOutstanding (equations.ts applyPaymentWaterfall signature).
  it('R2: sub-cent negative principalOutstanding is accepted (finite-only guard, no sign check)', () => {
    expect(() =>
      applyPaymentWaterfall(10542.892225726024, 231328.09997504807, 859377.58, 0, -8.731149137020111e-11),
    ).not.toThrow();
  });
});

// Rev 3 scope: enum checks are own-key allowlists. Inherited Object.prototype keys must not pass.
describe('B3a D-11: enum fields reject inherited Object.prototype keys (own-key allowlist)', () => {
  const INHERITED = ['toString', 'constructor', 'hasOwnProperty', 'valueOf', '__proto__'];
  // disbursalDate AND renewalDate both supplied so a flow-conditional date error can't stand in.
  const both = { renewalDate: d('2026-01-01'), disbursalDate: d('2026-01-01') };
  const ENUMS: [field: string, build: (v: string) => CobCanadaInput][] = [
    ['flow', (v) => newLoan({ ...both, flow: v })],
    ['productType', (v) => newLoan({ productType: v })],
    ['rateType', (v) => newLoan({ rateType: v })],
    ['paymentFrequency', (v) => newLoan({ paymentFrequency: v })],
  ];
  for (const [field, build] of ENUMS) {
    for (const v of INHERITED) {
      if (field === 'paymentFrequency' && v === 'toString') continue; // pinned in defects012.test.ts
      it(`${field} = '${v}' -> RangeError naming ${field}`, () => {
        const re = new RegExp(field);
        expectRangeErrorNaming(() => validateCobCanadaInput(build(v)), re);
        expectRangeErrorNaming(() => calculateCobCanada(build(v)), re);
      });
    }
  }
  it('every legal enum value still validates (allowlist not over-strict)', () => {
    for (const f of ['monthly', 'semiMonthly', 'biweekly', 'weekly']) {
      // B27: DEV-FB24 class A (the looped frequency is vehicle only; a personal loan pays Monthly, so the input is its twin)
      expect(() => validateCobCanadaInput(rehome(newLoan({ paymentFrequency: f }))), f).not.toThrow();
    }
    for (const flow of ['renewal', 'paymentChange']) {
      expect(() => validateCobCanadaInput(renewal({ flow })), flow).not.toThrow();
    }
    expect(() => validateCobCanadaInput(newLoan({ rateType: 'variable' }))).not.toThrow();
    expect(() => validateCobCanadaInput(newLoan({ productType: 'mortgage', rateType: 'variable' }))).not.toThrow();
    expect(() =>
      validateCobCanadaInput(newLoan({ productType: 'mortgage', rateType: 'fixed', semiAnnualCompoundingDate: d('2026-01-01') })),
    ).not.toThrow();
    expect(() =>
      validateCobCanadaInput(renewal({ flow: 'variableRatePaymentChange', productType: 'mortgage', rateType: 'variable' })),
    ).not.toThrow();
  });
});

// Rev 3 scope: `fees` must be a non-null object whose `fees` is an array; otherwise RangeError naming fees.
// (`fees: null` itself is pinned in defects012.test.ts.)
describe('B3a D-11: fees shape (object with an array `fees`)', () => {
  const SHAPES: [label: string, v: unknown][] = [
    ['undefined (key absent)', undefined],
    ['{} (no fees array)', {}],
    ['{ fees: null }', { fees: null }],
    ["{ fees: 'x' }", { fees: 'x' }],
    ['{ fees: {} }', { fees: {} }],
    ['[] (array instead of schedule)', []],
    ["'fees' (string)", 'fees'],
  ];
  for (const [label, v] of SHAPES) {
    it(`fees = ${label} -> RangeError naming fees`, () => {
      expectRangeErrorNaming(() => validateCobCanadaInput(newLoan({ fees: v })), /fees/);
      expectRangeErrorNaming(() => calculateCobCanada(newLoan({ fees: v })), /fees/);
    });
  }
});

// Rev 3 scope: numeric guards run before derived checks. A financed fee of Infinity/NaN must fail in
// validateFee naming the fee amount, not in the BRD §6 fee-limit check.
describe('B3a D-11: numeric guard precedes the fee-limit check', () => {
  for (const [label, v] of [['Infinity', Infinity], ['NaN', NaN], ["'5'", '5']] as Bad[]) {
    it(`financed fee amount ${label} -> fee-amount error, not the fee-limit error`, () => {
      let msg = '';
      try {
        validateCobCanadaInput(feeWith(v, true));
      } catch (e) {
        expect(e).toBeInstanceOf(RangeError);
        msg = (e as Error).message;
      }
      expect(msg).toMatch(/FinFee.*amount/);
      expect(msg).not.toMatch(/must be less than loanAmount/); // fee-limit error, old or Q-MSG interim wording
    });
  }
});

// Rev 3 scope: negative-value message text stays as it is today (spec011.test.ts:189 pins the fee one;
// these pin the rest so the new guard can't reword them). Green today; must stay green.
describe('B3a D-11: negative-value messages unchanged', () => {
  it('validate-level negatives keep their wording (B14 OQ-Y revised / OQ-AA revised: rate and payment say > 0)', () => {
    expect(() => validateCobCanadaInput(newLoan({ loanAmount: -1 }))).toThrow(/loanAmount must be > 0, got -1/);
    // B14 (OQ-AA revised / OQ-Y revised) supersedes the rev 3 "wording unchanged" note for these
    // two fields only: one `> 0` check gives one message, so negatives now say `must be > 0`.
    expect(() => validateCobCanadaInput(newLoan({ contractRatePercent: -1 }))).toThrow(
      /contractRatePercent must be > 0, got -1/,
    );
    expect(() => validateCobCanadaInput(newLoan({ paymentAmount: -1 }))).toThrow(/paymentAmount must be > 0, got -1/);
    expect(() => validateCobCanadaInput(renewal({ accruedInterest: -1 }))).toThrow(
      /accruedInterest must be >= 0, got -1/,
    );
  });
  it('waterfall negatives keep their current wording', () => {
    expect(() => applyPaymentWaterfall(-1, 0, 0, 0, 0)).toThrow(/periodInterestAmount must be >= 0, got -1/);
    expect(() => applyPaymentWaterfall(0, -1, 0, 0, 0)).toThrow(/carriedAccruedInterestOpening must be >= 0, got -1/);
    expect(() => applyPaymentWaterfall(0, 0, -1, 0, 0)).toThrow(/feesOpening must be >= 0, got -1/);
    expect(() => applyPaymentWaterfall(0, 0, 0, -1, 0)).toThrow(/paymentAmount must be >= 0, got -1/);
  });
  it('trigger-rate negatives keep their current wording', () => {
    expect(() => triggerRatePercent(-1, 12, 100000)).toThrow(/paymentAmount must be >= 0, got -1/);
    expect(() => triggerRatePercent(0, -1, 100000)).toThrow(/paymentsPerYear must be > 0, got -1/);
    expect(() => triggerRatePercent(0, 12, -1)).toThrow(/loanAmount must be > 0, got -1/);
  });
});
