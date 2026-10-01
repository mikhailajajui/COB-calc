/**
 * A9 (COB-architecture.md §5 A9, rules A9-R1..R4, revision 13; §3.5 Errors; ADR-13(f)):
 * `collectInputIssues(input)` returns every input issue as `{ field, message }` in check order;
 * `validateCobCanadaInput` still returns `{ startDate }` or throws `RangeError(issues[0].message)`
 * with today's messages, and evaluates no check after the first failing one (A9-R3).
 * `collectInputIssues` never catches. `validateFee` / `validateFeeSchedule` take an optional
 * reporter (default: throw, as today).
 * QA step written 2026-09-29, before the developer step. The developer must not edit these
 * assertions or their expected values. The type-level cases (T1-T3) are in
 * tests/types/a9-input-issues.typecheck.ts.
 *
 * B24 (user 2026-09-30, Q-CT-*): the term checks are gone (rows 8, 9, 10 and vector E8 retired: 7 tests; the same inputs
 * are accepted and ignored, see b24-term-rule T4) and the Semi-annual date is required only when
 * SEMI_ANNUAL_DATE_REQUIRED is on (Q-SACD, shipped off): row 19a, E11 and E13 run as on / off pairs through
 * tests/ca/support/semiSwitch.ts. A9-5 / A9-5b use a Symbol in a fee name (the old vehicle termYears is not read).
 *
 * Tests (83 before B20; B20 adds 3 ROWS (18c) x 2 and vectors E13, E14 = 8 more):
 *   A9-1  (31 + 1 coverage check; green before and after) one row per branch of the §5 A9 check table: base B with
 *         the minimal override -> validateCobCanadaInput throws RangeError with the exact message,
 *         measured on the pre-A9 build (2026-09-29). Row 13 needs two overrides (flow + a product
 *         that the flow does not allow); every other row changes one field (row 10: the pair).
 *   A9-2  (31; red) for each A9-1 row, collectInputIssues(x) is exactly [{ field, message }].
 *   A9-3  (13; red) exact multi-issue and gate vectors E1-E12, E4b (from the brief, first message
 *         re-measured on the pre-A9 build), each also checking validateCobCanadaInput against it.
 *   A9-4  (1; red) consistency sweep: every 10th golden-corpus input x (unmodified + 24 single-field
 *         corruptions covering all 19 table rows + 6 multi-field combinations).
 *   A9-5  (1; green before and after) A9-R3 laziness: a Symbol in termYears is never formatted
 *         when loanAmount already fails.
 *   A9-5b (1; red) collectInputIssues on that input throws the TypeError (it never catches).
 *   A9-6  (2; red) reporter mode of validateFeeSchedule.
 *   A9-7  (2; red) both barrels export the validate.ts function.
 *
 * The new functions are reached through namespace imports and local signatures so that, before
 * the developer step, this file still compiles under `typecheck:tests` and fails at run time
 * (the type-level red is confined to the .typecheck.ts file, as the brief requires).
 *
 * Pending decisions, NOT settled here: Q-MSG (wording; every message is today's), OQ-A, OQ-B,
 * OQ-P, Q-SACD. No date sequences asserted, so this file does not join `test:tz`.
 */
import { describe, expect, it } from 'vitest';
import * as validateModule from '../../src/ca/validate.js';
import * as feesModule from '../../src/ca/fees.js';
import * as ca from '../../src/ca/index.js';
import * as root from '../../src/index.js';
import { validateCobCanadaInput } from '../../src/ca/validate.js';
import type { CobCanadaInput } from '../../src/ca/index.js';
// @ts-ignore -- plain .mjs shared with the golden generator (no .d.ts); as in b8/b10/f6.
import * as corpus from './fixtures/generate_golden.mjs';
import { asInput, utcDate } from './support/builders.js';
import { BOTH_SEMI, loadValidate } from './support/semiSwitch.js';

type Issue = { field: string; message: string };
type Collect = (input: unknown) => Issue[];
type Report = (message: string) => void;
type FeeScheduleWithReporter = (schedule: unknown, report?: Report) => unknown;

/** The A9 function, looked up at call time so a missing export fails the test, not the file. */
function collect(input: unknown): Issue[] {
  const fn = (validateModule as Record<string, unknown>)['collectInputIssues'];
  expect(typeof fn, 'collectInputIssues must be exported by src/ca/validate.ts').toBe('function');
  return (fn as Collect)(input);
}

const validate = (x: unknown) => validateCobCanadaInput(x as CobCanadaInput);

const utc = utcDate;

/** Base input B (renewal): mortgage / variable, loan 250,000, no fees, 5.19%, 1,300 monthly,
 *  first payment 2027-02-01, end 2028-02-01, term 1y 0m, renewalDate 2027-01-15 (UTC). */
function B(): Record<string, unknown> {
  return {
    flow: 'renewal',
    productType: 'mortgage',
    rateType: 'variable',
    loanAmount: 250000,
    fees: { fees: [] },
    contractRatePercent: 5.19,
    paymentAmount: 1300,
    paymentFrequency: 'monthly',
    firstPaymentDate: utc('2027-02-01'),
    endDate: utc('2028-02-01'),
    termYears: 1,
    termMonths: 0,
    renewalDate: utc('2027-01-15'),
    accruedInterest: 0, // required for renewal / paymentChange / VRPC since B20 (decision 4)
  };
}
const withB = (o: Record<string, unknown>) => ({ ...B(), ...o });

const SEMI =
  "productType 'mortgage' with rateType 'fixed' requires semiAnnualCompoundingDate " +
  '(the semi-annual compounding reference anchor -- equation 1)';
const FLOW_LIST = 'flow must be one of newMortgageOrLoan/renewal/paymentChange/variableRatePaymentChange, got bad';

/** [id, table row's field, override, exact message (pre-A9 build, 2026-09-29)] */
const ROWS: [string, string, Record<string, unknown>, string][] = [
  ['1a finite', 'loanAmount', { loanAmount: 'x' }, 'loanAmount must be a finite number, got x'],
  ['1b > 0', 'loanAmount', { loanAmount: 0 }, 'loanAmount must be > 0, got 0'],
  ['2a finite', 'contractRatePercent', { contractRatePercent: NaN }, 'contractRatePercent must be a finite number, got NaN'],
  ['2b > 0', 'contractRatePercent', { contractRatePercent: -1 }, 'contractRatePercent must be > 0, got -1'],
  ['3a finite', 'paymentAmount', { paymentAmount: Infinity }, 'paymentAmount must be a finite number, got Infinity'],
  ['3b > 0', 'paymentAmount', { paymentAmount: 0 }, 'paymentAmount must be > 0, got 0'],
  [
    '4 own key',
    'paymentFrequency',
    { paymentFrequency: 'toString' },
    'paymentFrequency must be one of monthly/semiMonthly/biweekly/weekly/acceleratedBiweekly/acceleratedWeekly, got toString',
  ],
  ['5 flow list', 'flow', { flow: 'bad' }, FLOW_LIST],
  ['6 productType list', 'productType', { productType: 'bad' }, 'productType must be one of mortgage/personalLoan, got bad'],
  ['7 rateType list', 'rateType', { rateType: 'bad' }, 'rateType must be one of variable/fixed, got bad'],
  // B24: rows 8, 9, 10 (the three term checks) are retired.
  ['11a schedule shape', 'fees', { fees: null }, 'fees must be an object with a fees array'],
  ['11b fee object', 'fees', { fees: { fees: [null] } }, 'fees.fees[0] must be a fee object, got null'],
  [
    '11c fee amount finite',
    'fees',
    { fees: { fees: [{ name: 'Admin', amount: 'x', financed: true }] } },
    'Admin amount must be a finite number, got x',
  ],
  ['11d fee amount >= 0', 'fees', { fees: { fees: [{ amount: -1, financed: true }] } }, 'fees.fees[0] amount must be >= 0, got -1'],
  [
    '11e fee financed',
    'fees',
    { fees: { fees: [{ name: 'Admin', amount: 5, financed: 'yes' }] } },
    'Admin.financed must be a boolean, got yes',
  ],
  [
    '11f fee includedInCob',
    'fees',
    { fees: { fees: [{ name: 'Admin', amount: 5, financed: false, includedInCob: 'yes' }] } },
    'Admin.includedInCob must be a boolean if present, got yes',
  ],
  [
    '12 fee limit',
    'fees',
    { fees: { fees: [{ name: 'Admin', amount: 250000, financed: true }] } },
    'total fees (financed + non-financed) (250000) must be less than loanAmount (250000)',
  ],
  [
    '13 VRPC lock',
    'flow',
    { flow: 'variableRatePaymentChange', productType: 'personalLoan' },
    // B21 (R3): generalised wording; the old parenthesis is dropped.
    "flow 'variableRatePaymentChange' is mortgage + variable-rate only, got productType='personalLoan', rateType='variable'",
  ],
  [
    '13b Renewal lock',
    'flow',
    { productType: 'personalLoan' }, // base B is a renewal, mortgage / variable
    "flow 'renewal' is mortgage only, got productType='personalLoan', rateType='variable'",
  ],
  ['14 firstPaymentDate valid', 'firstPaymentDate', { firstPaymentDate: new Date(NaN) }, 'firstPaymentDate must be a valid Date'],
  ['15 endDate valid', 'endDate', { endDate: new Date(NaN) }, 'endDate must be a valid Date'],
  [
    '16 endDate order',
    'endDate',
    { endDate: utc('2027-02-01') },
    'endDate must be after firstPaymentDate (compared as UTC calendar dates)',
  ],
  ['17a start absent', 'renewalDate', { renewalDate: undefined }, "flow 'renewal' requires renewalDate"],
  ['17b start valid', 'renewalDate', { renewalDate: '2027-01-15' }, 'renewalDate must be a valid Date'],
  ['17c start order', 'renewalDate', { renewalDate: utc('2027-02-02') }, 'renewalDate must be on or before firstPaymentDate'],
  ['18a accrued finite', 'accruedInterest', { accruedInterest: 'x' }, 'accruedInterest must be a finite number, got x'],
  ['18b accrued >= 0', 'accruedInterest', { accruedInterest: -1 }, 'accruedInterest must be >= 0, got -1'],
  // B20 (decision 4): 18c is the "required" branch; the three rows run on the three flows that need it.
  ['18c accrued required (renewal)', 'accruedInterest', { accruedInterest: undefined }, "flow 'renewal' requires accruedInterest (enter 0 if there is none)"],
  [
    '18c accrued required (paymentChange)',
    'accruedInterest',
    { flow: 'paymentChange', accruedInterest: undefined },
    "flow 'paymentChange' requires accruedInterest (enter 0 if there is none)",
  ],
  [
    '18c accrued required (VRPC)',
    'accruedInterest',
    { flow: 'variableRatePaymentChange', accruedInterest: undefined },
    "flow 'variableRatePaymentChange' requires accruedInterest (enter 0 if there is none)",
  ],
  // B24: row 19a (semi absent) is a pair below (A9-1b / A9-2b), because absent is rejected only when the switch is on.
  [
    '19b semi valid',
    'semiAnnualCompoundingDate',
    { rateType: 'fixed', semiAnnualCompoundingDate: { getTime: () => 0 } },
    'semiAnnualCompoundingDate must be a valid Date',
  ],
];

/** Asserts validateCobCanadaInput throws exactly RangeError(message). */
function expectThrowsExactly(x: unknown, message: string): void {
  let caught: unknown;
  try {
    validate(x);
  } catch (e) {
    caught = e;
  }
  expect(caught).toBeInstanceOf(RangeError);
  expect((caught as Error).constructor).toBe(RangeError);
  expect((caught as Error).message).toBe(message);
}

/** A9 consistency: returns <=> [] and otherwise thrown message === issues[0].message. */
function expectConsistent(x: unknown, issues: Issue[]): void {
  if (issues.length === 0) {
    expect(() => validate(x)).not.toThrow();
  } else {
    expectThrowsExactly(x, issues[0]!.message);
  }
}

describe('A9-1 characterisation: each check-table branch throws today\'s message (green before and after)', () => {
  it('has 31 rows covering the 15 table rows that remain (8, 9, 10 retired; 19a is the pair below)', () => {
    expect(ROWS).toHaveLength(31);
    expect(new Set(ROWS.map(([id]) => id.split(/[a-z ]/)[0])).size).toBe(16);
  });
  it.each(ROWS)('row %s (%s)', (_id, _field, override, message) => {
    expectThrowsExactly(withB(override), message);
  });
});

describe('A9-2 collectInputIssues gives exactly one issue for each A9-1 row (red until dev)', () => {
  it.each(ROWS)('row %s (%s)', (_id, field, override, message) => {
    expect(collect(withB(override))).toEqual([{ field, message }]);
  });
});

describe('A9-1b / A9-2b row 19a (B24, Q-SACD): a fixed mortgage without the Semi-annual date, both switch states', () => {
  it.each(BOTH_SEMI)('%s: validate throws the row message when on, accepts when off', async (_label, required) => {
    const api = await loadValidate(required);
    const x = asInput(withB({ rateType: 'fixed' }));
    if (required) {
      let caught: unknown;
      try {
        api.validateCobCanadaInput(x);
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(RangeError);
      expect((caught as Error).message).toBe(SEMI);
    } else {
      expect(() => api.validateCobCanadaInput(x)).not.toThrow();
    }
  });
  it.each(BOTH_SEMI)('%s: collectInputIssues gives the one issue when on, none when off', async (_label, required) => {
    const api = await loadValidate(required);
    const issues = api.collectInputIssues(withB({ rateType: 'fixed' }));
    expect(issues).toEqual(required ? [{ field: 'semiAnnualCompoundingDate', message: SEMI }] : []);
  });
});

const hole: unknown[] = [];
hole[1] = { amount: -2, financed: true };

/** [id, override, exact expected issues] (the brief's E vectors, measured on the prototype). */
const E: [string, Record<string, unknown>, Issue[]][] = [
  ['E1 valid', {}, []],
  [
    'E2 three scalar issues',
    { loanAmount: 0, paymentAmount: NaN, rateType: 'bad' },
    [
      { field: 'loanAmount', message: 'loanAmount must be > 0, got 0' },
      { field: 'paymentAmount', message: 'paymentAmount must be a finite number, got NaN' },
      { field: 'rateType', message: 'rateType must be one of variable/fixed, got bad' },
    ],
  ],
  [
    'E3 one issue per failing fee, no limit issue',
    { fees: { fees: [null, { name: 'Admin', amount: -5, financed: true }, { amount: 10, financed: false }] } },
    [
      { field: 'fees', message: 'fees.fees[0] must be a fee object, got null' },
      { field: 'fees', message: 'Admin amount must be >= 0, got -5' },
    ],
  ],
  [
    'E4 fee limit gated on loanAmount',
    { loanAmount: 'x', fees: { fees: [{ amount: 1e9, financed: true }] } },
    [{ field: 'loanAmount', message: 'loanAmount must be a finite number, got x' }],
  ],
  [
    'E4b fee limit alone',
    { fees: { fees: [{ amount: 200000, financed: true }, { amount: 50000, financed: false }] } },
    [{ field: 'fees', message: 'total fees (financed + non-financed) (250000) must be less than loanAmount (250000)' }],
  ],
  [
    'E5 VRPC lock gated on productType',
    { flow: 'variableRatePaymentChange', productType: 'bad', rateType: 'fixed' },
    [{ field: 'productType', message: 'productType must be one of mortgage/personalLoan, got bad' }],
  ],
  [
    'E6 date orders gated on firstPaymentDate',
    { firstPaymentDate: new Date(NaN), renewalDate: utc('2099-01-01') },
    [{ field: 'firstPaymentDate', message: 'firstPaymentDate must be a valid Date' }],
  ],
  ['E7 start field gated on flow', { flow: 'bad', renewalDate: undefined }, [{ field: 'flow', message: FLOW_LIST }]],
  // B24: vector E8 (zero term) is retired.
  ['E9 hole skipped', { fees: { fees: hole } }, [{ field: 'fees', message: 'fees.fees[1] amount must be >= 0, got -2' }]],
  [
    'E10 new loan without disbursalDate, bad accrued',
    { flow: 'newMortgageOrLoan', accruedInterest: 'x' },
    [
      { field: 'disbursalDate', message: "flow 'newMortgageOrLoan' requires disbursalDate" },
      { field: 'accruedInterest', message: 'accruedInterest must be a finite number, got x' },
    ],
  ],
  [
    'E11 end order, accrued, semi',
    { rateType: 'fixed', endDate: utc('2027-01-01'), accruedInterest: -1 },
    [
      { field: 'endDate', message: 'endDate must be after firstPaymentDate (compared as UTC calendar dates)' },
      { field: 'accruedInterest', message: 'accruedInterest must be >= 0, got -1' },
      { field: 'semiAnnualCompoundingDate', message: SEMI },
    ],
  ],
  [
    'E13 B20: end order, accrued required, semi (check order)',
    { rateType: 'fixed', endDate: utc('2027-01-01'), accruedInterest: undefined },
    [
      { field: 'endDate', message: 'endDate must be after firstPaymentDate (compared as UTC calendar dates)' },
      { field: 'accruedInterest', message: "flow 'renewal' requires accruedInterest (enter 0 if there is none)" },
      { field: 'semiAnnualCompoundingDate', message: SEMI },
    ],
  ],
  [
    'E14 B20: accrued required is gated on a valid flow',
    { flow: 'bad', accruedInterest: undefined },
    [{ field: 'flow', message: FLOW_LIST }],
  ],
  [
    'E12 loanAmount then fee shape',
    { fees: null, loanAmount: -1 },
    [
      { field: 'loanAmount', message: 'loanAmount must be > 0, got -1' },
      { field: 'fees', message: 'fees must be an object with a fees array' },
    ],
  ],
];

describe('A9-3 multi-issue and gate vectors (red until dev)', () => {
  // E11 and E13 list the semi issue as they did when the date was always required: the on state.
  const SEMI_IDS = new Set(['E11 end order, accrued, semi', 'E13 B20: end order, accrued required, semi (check order)']);
  it.each(E.filter(([id]) => !SEMI_IDS.has(id)))('%s', (_id, override, expected) => {
    const x = withB(override);
    // The first message is today's (pre-A9 build); checked before the list so a regression shows here.
    expectConsistent(x, expected);
    expect(collect(x)).toEqual(expected);
    if (expected.length === 0) {
      expect(validate(x).startDate).toBe(x.renewalDate);
    }
  });
  // B24 pairs: with the switch off the semi issue disappears and nothing else changes.
  describe.each(E.filter(([id]) => SEMI_IDS.has(id)))('%s', (_id, override, expectedOn) => {
    it.each(BOTH_SEMI)('%s', async (_label, required) => {
      const api = await loadValidate(required);
      const expected = required ? expectedOn : expectedOn.filter((i) => i.field !== 'semiAnnualCompoundingDate');
      const x = withB(override);
      expect(api.collectInputIssues(x)).toEqual(expected);
      expect(() => api.validateCobCanadaInput(asInput(x))).toThrow(new RangeError(expected[0]!.message));
    });
  });
});

type Params = Record<string, unknown>;
const corpusInputs: Record<string, unknown>[] = [
  ...(corpus.buildGroups() as { cases: { params: Params }[] }[]).flatMap((g) => g.cases.map((c) => c.params)),
  ...(corpus.buildLongCases() as { params: Params }[]).map((c) => c.params),
].map((p) => corpus.makeInput(p) as Record<string, unknown>);

const startField = (x: Record<string, unknown>) => (x.flow === 'newMortgageOrLoan' ? 'disbursalDate' : 'renewalDate');

/** Single-field (or minimal) corruptions: [name, table rows hit, corrupt] (mutates a fresh copy). */
const CORRUPTIONS: [string, number[], (x: Record<string, unknown>) => void][] = [
  ['loanAmount NaN', [1], (x) => { x.loanAmount = NaN; }],
  ['loanAmount -0', [1], (x) => { x.loanAmount = -0; }],
  ['contractRatePercent null', [2], (x) => { x.contractRatePercent = null; }],
  ['paymentAmount -5', [3], (x) => { x.paymentAmount = -5; }],
  ['paymentFrequency hasOwnProperty', [4], (x) => { x.paymentFrequency = 'hasOwnProperty'; }],
  ['flow constructor', [5], (x) => { x.flow = 'constructor'; }],
  ['productType Mortgage', [6], (x) => { x.productType = 'Mortgage'; }],
  ['rateType undefined', [7], (x) => { x.rateType = undefined; }],
  // B24: the three term corruptions (rows 8, 9, 10) are retired; the swept rows are the 16 that remain.
  ['fees array', [11], (x) => { x.fees = []; }],
  ['fees mixed', [11], (x) => { x.fees = { fees: [{ amount: 1, financed: true }, 7, { name: 'N', amount: -0.01, financed: false }] }; }],
  ['fee limit', [12], (x) => { x.fees = { fees: [{ amount: 125000, financed: true }, { amount: 125000, financed: false }] }; }],
  ['VRPC lock', [13], (x) => { x.flow = 'variableRatePaymentChange'; x.rateType = 'fixed'; }],
  ['firstPaymentDate string', [14], (x) => { x.firstPaymentDate = '2027-01-01'; }],
  ['endDate Invalid', [15], (x) => { x.endDate = new Date(NaN); }],
  ['endDate same day', [16], (x) => { x.endDate = new Date((x.firstPaymentDate as Date).getTime() + 3_600_000); }],
  ['start absent', [17], (x) => { delete x[startField(x)]; }],
  ['start invalid', [17], (x) => { x[startField(x)] = new Date(NaN); }],
  ['start late', [17], (x) => { x[startField(x)] = new Date((x.firstPaymentDate as Date).getTime() + 86_400_000); }],
  ['flow swap', [17], (x) => { x.flow = x.flow === 'newMortgageOrLoan' ? 'paymentChange' : 'newMortgageOrLoan'; }],
  ['accruedInterest Infinity', [18], (x) => { x.accruedInterest = Infinity; }],
  ['semi absent or invalid', [19], (x) => {
    x.productType = 'mortgage';
    x.rateType = 'fixed';
    x.semiAnnualCompoundingDate = x.semiAnnualCompoundingDate === undefined ? undefined : 'x';
  }],
];

/** Multi-field combinations (several issues at once, including gated rows). */
const COMBOS: string[][] = [
  ['loanAmount NaN', 'fee limit', 'endDate Invalid'],
  ['paymentAmount -5', 'accruedInterest Infinity', 'semi absent or invalid'],
  ['flow constructor', 'start absent', 'fees mixed'],
  // 'start late' reads the real firstPaymentDate, so it is applied before that date is broken
  // (fixture order fix 2026-09-29; the resulting input is the one intended: late start, bad FP).
  ['start late', 'firstPaymentDate string', 'rateType undefined'],
  ['loanAmount -0', 'contractRatePercent null', 'paymentFrequency hasOwnProperty', 'productType Mortgage'],
  ['endDate same day', 'start invalid', 'fees array', 'VRPC lock'],
];

describe('A9-4 consistency sweep over the golden corpus (red until dev)', () => {
  it('validate returns <=> collectInputIssues is []; else the thrown message is issues[0].message', () => {
    expect(new Set(CORRUPTIONS.flatMap(([, rows]) => rows))).toEqual(new Set(Array.from({ length: 19 }, (_, i) => i + 1).filter((r) => r < 8 || r > 10)));
    const byName = new Map(CORRUPTIONS.map(([n, , f]) => [n, f]));
    let checked = 0;
    let multi = 0;
    let valid = 0;
    for (let i = 0; i < corpusInputs.length; i += 10) {
      const base = corpusInputs[i]!;
      const variants: (() => Record<string, unknown>)[] = [
        () => ({ ...base }),
        ...CORRUPTIONS.map(([, , f]) => () => { const x = { ...base }; f(x); return x; }),
        ...COMBOS.map((names) => () => { const x = { ...base }; for (const n of names) byName.get(n)!(x); return x; }),
      ];
      for (const make of variants) {
        const x = make();
        const issues = collect(x);
        // Re-read with a fresh copy for the throwing validator (collect must not mutate, but be safe).
        expectConsistent(make(), issues);
        for (const issue of issues) {
          expect(typeof issue.field).toBe('string');
          expect(typeof issue.message).toBe('string');
          expect(Object.keys(issue).sort()).toEqual(['field', 'message']);
        }
        checked++;
        if (issues.length > 1) multi++;
        if (issues.length === 0) valid++;
      }
    }
    expect(checked).toBe(Math.ceil(corpusInputs.length / 10) * (1 + CORRUPTIONS.length + COMBOS.length));
    expect(valid).toBeGreaterThan(0);
    expect(multi).toBeGreaterThan(0);
  });
});

describe('A9-5 laziness (A9-R3) and A9-5b collectInputIssues never catches', () => {
  // B24: the vehicle is a Symbol in a fee name (termYears is no longer read); a Symbol fee name also raises a TypeError (B3a note).
  const lazy = () => withB({ loanAmount: 'x', fees: { fees: [{ name: Symbol('s'), amount: -1, financed: true }] } });

  it('A9-5 (green before and after): validateCobCanadaInput throws the loanAmount RangeError, never formats the fee name', () => {
    expectThrowsExactly(lazy(), 'loanAmount must be a finite number, got x');
  });

  it('A9-5b (red until dev): collectInputIssues propagates the TypeError from formatting the Symbol', () => {
    let caught: unknown;
    try {
      collect(lazy());
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(TypeError);
    // Not "collectInputIssues is not a function": the error comes from converting the Symbol.
    expect((caught as Error).message).toMatch(/Symbol/);
  });
});

describe('A9-6 reporter mode of validateFeeSchedule (A9-R1; red until dev)', () => {
  const vfs = feesModule.validateFeeSchedule as unknown as FeeScheduleWithReporter;

  it("E3's fees: returns false and reports the two messages in index order, without throwing", () => {
    const ms: string[] = [];
    const schedule = { fees: [null, { name: 'Admin', amount: -5, financed: true }, { amount: 10, financed: false }] };
    expect(vfs(schedule, (m) => ms.push(m))).toBe(false);
    expect(ms).toEqual(['fees.fees[0] must be a fee object, got null', 'Admin amount must be >= 0, got -5']);
  });

  it('an empty schedule returns true and never calls the reporter', () => {
    let calls = 0;
    expect(vfs({ fees: [] }, () => { calls++; })).toBe(true);
    expect(calls).toBe(0);
  });
});

describe('A9-7 barrels (ADR-13(f); red until dev)', () => {
  const fromValidate = () => (validateModule as Record<string, unknown>)['collectInputIssues'];

  it('src/ca/index.ts exports the validate.ts collectInputIssues', () => {
    expect(typeof fromValidate()).toBe('function');
    expect((ca as Record<string, unknown>)['collectInputIssues']).toBe(fromValidate());
  });

  it('src/index.ts exports the same collectInputIssues', () => {
    expect(typeof fromValidate()).toBe('function');
    expect((root as Record<string, unknown>)['collectInputIssues']).toBe(fromValidate());
  });
});
