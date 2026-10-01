/**
 * A6 (COB-architecture.md §5 A6, revision 8): `src/ca/flows.ts`, the use-case catalogue that
 * the engine and the UI read (ADR-07 single source of truth; ADR-13(c) for the barrel).
 * QA step written 2026-09-28, before the developer step. Pure move: engine output, every
 * thrown message and its order, and the UI DOM stay identical.
 *
 * Decisions settled since A6 (the table below pins them):
 * - OQ-A (Start Date label per use case) settled by B22, stakeholder decisions 2 and 5: Payment
 *   Change and VRPC start at the "Date of change" and pay next on the "Next payment date"; the
 *   form, the contract-terms tiles and the print record read these labels (closes finding F1).
 * - (OQ-B / BR-05 settled by B20, stakeholder decision 4: `accruedInterest` is 'required' for
 *   renewal, paymentChange and VRPC, 'hidden' for the new flow; see B20-1 / B20-2 below.)
 *
 * Red until the developer lands A6: A6-1, A6-2, A6-3, A6-4 (flows.ts does not exist) and A6-7
 * (source guard). Green now and must stay green: A6-5 and A6-6 (characterisation).
 *
 * All dates are UTC midnight and at least 5 days apart, so nothing here is time-zone
 * sensitive (this file is deliberately not in `test:tz`).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { calculateCobCanada } from '../../src/ca/index.js';
import { selectRateBasis } from '../../src/ca/equations.js';
import type { CobCanadaInput, CobFlow, ProductType, RateType } from '../../src/ca/index.js';
import { validateCobCanadaInput } from '../../src/ca/validate.js';
import { ROOT, stripComments } from '../architecture/support.js';
import { asInput, utcDate } from './support/builders.js';
import { BOTH_SEMI, loadValidate } from './support/semiSwitch.js';

// ---------------------------------------------------------------------------------------------
// flows.ts is loaded lazily so that A6-5/A6-6 run (green) while the module does not exist yet.

interface FlowSpecShape {
  startDateField: 'disbursalDate' | 'renewalDate';
  accruedInterest: 'hidden' | 'required';
  forcedProductType: ProductType | null;
  forcedRateType: RateType | null;
  startDateLabel: string;
  firstPaymentDateLabel: string;
}
interface FlowsModule {
  FLOW_IDS: readonly CobFlow[];
  FLOWS: Readonly<Record<CobFlow, FlowSpecShape>>;
  computesTriggerRate(productType: ProductType, rateType: RateType): boolean;
  requiresSemiAnnualDate(productType: ProductType, rateType: RateType, required?: boolean): boolean;
}
// A variable specifier, so F10 (every literal relative import resolves) stays green while
// flows.ts does not exist yet; A6-1 is what fails if the module is missing or misnamed.
const FLOWS_MODULE = '../../src/ca/flows.js';
const loadFlows = async (): Promise<FlowsModule> => (await import(/* @vite-ignore */ FLOWS_MODULE)) as FlowsModule;

const FLOW_IDS_EXPECTED: CobFlow[] = ['newMortgageOrLoan', 'renewal', 'paymentChange', 'variableRatePaymentChange'];
const PAIRS: [ProductType, RateType][] = [
  ['mortgage', 'fixed'],
  ['mortgage', 'variable'],
  ['personalLoan', 'fixed'],
  ['personalLoan', 'variable'],
];

// A6-2: the table in the brief, verbatim.
const FLOWS_EXPECTED: Record<CobFlow, FlowSpecShape> = {
  newMortgageOrLoan: {
    startDateField: 'disbursalDate',
    accruedInterest: 'hidden',
    forcedProductType: null,
    forcedRateType: null,
    startDateLabel: 'Disbursal date',
    firstPaymentDateLabel: 'First payment date',
  },
  renewal: {
    startDateField: 'renewalDate',
    accruedInterest: 'required', // decision 4 (B20)
    forcedProductType: null, // 2026-10-01: Renewal allows a personal loan again (reverses decision 9 / B21)
    forcedRateType: null,
    startDateLabel: 'Renewal date', // decision 5 (B22)
    firstPaymentDateLabel: 'First payment date', // decision 5 (B22)
  },
  paymentChange: {
    startDateField: 'renewalDate',
    accruedInterest: 'required', // decision 4 (B20)
    forcedProductType: null,
    forcedRateType: null,
    startDateLabel: 'Date of change', // 2026-10-01 (was 'Last payment date' B22, 'Payment change date' before)
    firstPaymentDateLabel: 'Next payment date', // decision 5 (B22)
  },
  variableRatePaymentChange: {
    startDateField: 'renewalDate',
    accruedInterest: 'required', // decision 4 (B20)
    forcedProductType: 'mortgage',
    forcedRateType: 'variable',
    startDateLabel: 'Date of change', // 2026-10-01 (was 'Last payment date' B22, 'Payment change date' before)
    firstPaymentDateLabel: 'Next payment date', // decision 5 (B22)
  },
};

// ---------------------------------------------------------------------------------------------
// Engine fixtures (A6-5, A6-6).

const d = utcDate;
const NEW: CobFlow = 'newMortgageOrLoan';

/** Valid base: loan 250,000, 5.19%, monthly 1,300, one financed fee; dates >= 5 days apart. */
function base(over: Record<string, unknown> = {}): CobCanadaInput {
  const flow = (over.flow as CobFlow | undefined) ?? NEW;
  const start = flow === NEW ? { disbursalDate: d('2027-01-01') } : { renewalDate: d('2027-01-01') };
  const input: Record<string, unknown> = {
    flow,
    productType: 'mortgage',
    rateType: 'variable',
    contractRatePercent: 5.19,
    paymentFrequency: 'monthly',
    paymentAmount: 1300,
    loanAmount: 250000,
    fees: { fees: [{ name: 'F', amount: 2000, financed: true, includedInCob: true }] },
    ...(flow === NEW ? {} : { accruedInterest: 0 }), // required since B20
    ...start,
    firstPaymentDate: d('2027-02-01'),
    endDate: d('2029-02-01'),
    termYears: 2,
    termMonths: 0,
    ...over,
  };
  // An override of `undefined` removes the key (a missing field, not a present-but-undefined one).
  for (const k of Object.keys(over)) if (over[k] === undefined) delete input[k];
  return asInput(input);
}

/** Both entry points throw the same RangeError with exactly this message. */
function expectBothThrow(input: CobCanadaInput, message: string): void {
  let v: unknown;
  try {
    validateCobCanadaInput(input);
  } catch (e) {
    v = e;
  }
  expect(v, 'validateCobCanadaInput must throw').toBeInstanceOf(RangeError);
  expect((v as Error).message).toBe(message);
  let c: unknown;
  try {
    calculateCobCanada(input);
  } catch (e) {
    c = e;
  }
  expect(c, 'calculateCobCanada must throw').toBeInstanceOf(RangeError);
  expect((c as Error).message).toBe(message);
}

function expectAccepted(input: CobCanadaInput): void {
  expect(() => validateCobCanadaInput(input)).not.toThrow();
  expect(calculateCobCanada(input).amortizationSchedule.length).toBeGreaterThan(0);
}

const run = (input: CobCanadaInput) => JSON.stringify(calculateCobCanada(input));

const FLOW_MSG = (got: string) =>
  `flow must be one of newMortgageOrLoan/renewal/paymentChange/variableRatePaymentChange, got ${got}`;
// B21 (R3): one message built from the catalogue; VRPC's old parenthesis is dropped.
const VRPC_LOCK = (p: string, r: string) =>
  `flow 'variableRatePaymentChange' is mortgage + variable-rate only, got productType='${p}', rateType='${r}'`;
const SEMI_MSG =
  "productType 'mortgage' with rateType 'fixed' requires semiAnnualCompoundingDate " +
  '(the semi-annual compounding reference anchor -- equation 1)';
const NON_NEW: CobFlow[] = ['renewal', 'paymentChange', 'variableRatePaymentChange'];
const NOT_VRPC: CobFlow[] = ['newMortgageOrLoan', 'renewal', 'paymentChange'];
const startFieldOf = (flow: CobFlow) => (flow === NEW ? 'disbursalDate' : 'renewalDate');

// =============================================================================================

describe('A6-1 red: flows.ts exports exactly the catalogue, frozen', () => {
  it('A6-1: runtime exports are exactly FLOWS, FLOW_IDS, computesTriggerRate, requiresSemiAnnualDate', async () => {
    const mod = await import(/* @vite-ignore */ FLOWS_MODULE);
    expect(Object.keys(mod).sort()).toEqual(['FLOWS', 'FLOW_IDS', 'computesTriggerRate', 'requiresSemiAnnualDate']);
  });

  it('A6-1: FLOW_IDS is exactly the four flows in the load-bearing order', async () => {
    const { FLOW_IDS } = await loadFlows();
    expect(Array.isArray(FLOW_IDS)).toBe(true);
    expect([...FLOW_IDS]).toEqual(FLOW_IDS_EXPECTED);
  });

  it('A6-1: Object.keys(FLOWS) equals FLOW_IDS (same order)', async () => {
    const { FLOWS, FLOW_IDS } = await loadFlows();
    expect(Object.keys(FLOWS)).toEqual([...FLOW_IDS]);
  });

  it('A6-1: FLOW_IDS, FLOWS and every FLOWS entry are frozen', async () => {
    const { FLOWS, FLOW_IDS } = await loadFlows();
    expect(Object.isFrozen(FLOW_IDS)).toBe(true);
    expect(Object.isFrozen(FLOWS)).toBe(true);
    for (const id of FLOW_IDS_EXPECTED) expect(Object.isFrozen(FLOWS[id]), id).toBe(true);
  });

  it('A6-1 (module shape): flows.ts imports only `import type` from ./types.js and (B24-R5) SEMI_ANNUAL_DATE_REQUIRED from ./policies.js; exports type FlowSpec; no @pending tag is left (OQ-B closed by B20, OQ-A by B22)', () => {
    const raw = readFileSync(`${ROOT}/src/ca/flows.ts`, 'utf8');
    const code = stripComments(raw);
    const imports = [...code.matchAll(/^\s*import\b[^;]*;/gm)].map((m) => m[0].replace(/\s+/g, ' ').trim());
    expect(imports).toHaveLength(2);
    expect(imports.filter((i) => /^import type \{[^}]*\} from '\.\/types\.js';$/.test(i))).toHaveLength(1);
    expect(imports.filter((i) => /^import \{\s*SEMI_ANNUAL_DATE_REQUIRED\s*\} from '\.\/policies\.js';$/.test(i))).toHaveLength(1);
    expect(code).toMatch(/export\s+(interface|type)\s+FlowSpec\b/);
    expect(raw).not.toMatch(/@pending/);
  });
});

describe('A6-2 red: FLOWS deep-equals the brief table (labels per decisions 2 and 5, B22; accruedInterest per decision 4, B20)', () => {
  it('A6-2: FLOWS strictly equals the table', async () => {
    const { FLOWS } = await loadFlows();
    expect(FLOWS).toStrictEqual(FLOWS_EXPECTED);
  });

  for (const id of FLOW_IDS_EXPECTED) {
    it(`A6-2: FLOWS.${id} field by field`, async () => {
      const { FLOWS } = await loadFlows();
      const e = FLOWS_EXPECTED[id];
      const a = FLOWS[id];
      expect(Object.keys(a).sort()).toEqual(Object.keys(e).sort());
      expect(a.startDateField).toBe(e.startDateField);
      expect(a.accruedInterest).toBe(e.accruedInterest);
      expect(a.forcedProductType).toBe(e.forcedProductType);
      expect(a.forcedRateType).toBe(e.forcedRateType);
      expect(a.startDateLabel).toBe(e.startDateLabel);
      expect(a.firstPaymentDateLabel).toBe(e.firstPaymentDateLabel);
    });
  }

  it("B20-1: accruedInterest is 'required' for renewal, paymentChange and VRPC, 'hidden' for the new flow (decision 4)", async () => {
    const { FLOWS } = await loadFlows();
    expect(FLOWS.newMortgageOrLoan.accruedInterest).toBe('hidden');
    for (const id of NON_NEW) expect(FLOWS[id].accruedInterest, id).toBe('required');
    for (const id of FLOW_IDS_EXPECTED) expect(FLOWS[id].accruedInterest, id).not.toBe('optional');
  });
});

describe('A6-3 red: product/rate predicates over the 4 pairs', () => {
  for (const [p, r] of PAIRS) {
    it(`A6-3: ${p}/${r}: computesTriggerRate = ${p === 'mortgage' && r === 'variable'}, requiresSemiAnnualDate = ${p === 'mortgage' && r === 'fixed'}`, async () => {
      const { computesTriggerRate, requiresSemiAnnualDate } = await loadFlows();
      expect(computesTriggerRate(p, r)).toBe(p === 'mortgage' && r === 'variable');
      // B24-R5: the rule itself is read with the switch on (third argument true); the shipped default is pinned in b24-form-cleanup.
      expect(requiresSemiAnnualDate(p, r, true)).toBe(p === 'mortgage' && r === 'fixed');
    });
  }
});

describe('A6-4 red: requiresSemiAnnualDate (Q-SACD) coincides with selectRateBasis (OQ-C) today', () => {
  // Two separate rules that agree today. Revisit this test if Q-SACD or OQ-C changes.
  for (const [p, r] of PAIRS) {
    it(`A6-4: ${p}/${r}`, async () => {
      const { requiresSemiAnnualDate } = await loadFlows();
      expect(requiresSemiAnnualDate(p, r, true)).toBe(selectRateBasis(p, r) === 'SEMI-ANNUAL');
    });
  }
});

describe('A6-5 green (characterisation): exact RangeError messages and their order, validate and calculate', () => {
  it('A6-5: the base inputs are valid for every flow (non-vacuity)', () => {
    for (const flow of FLOW_IDS_EXPECTED) expectAccepted(base({ flow }));
  });

  it("A6-5: flow 'bogus' and 'toString' are rejected with the FLOW_IDS-joined message", () => {
    expectBothThrow(base({ flow: 'bogus', disbursalDate: d('2027-01-01') }), FLOW_MSG('bogus'));
    expectBothThrow(base({ flow: 'toString', disbursalDate: d('2027-01-01') }), FLOW_MSG('toString'));
  });

  it('A6-5: VRPC with personalLoan/variable and with mortgage/fixed gives the lock message', () => {
    const vrpc = 'variableRatePaymentChange';
    expectBothThrow(base({ flow: vrpc, productType: 'personalLoan', rateType: 'variable' }), VRPC_LOCK('personalLoan', 'variable'));
    expectBothThrow(
      base({ flow: vrpc, productType: 'mortgage', rateType: 'fixed', semiAnnualCompoundingDate: d('2026-12-15') }),
      VRPC_LOCK('mortgage', 'fixed'),
    );
    expectBothThrow(base({ flow: vrpc, productType: 'personalLoan', rateType: 'fixed' }), VRPC_LOCK('personalLoan', 'fixed'));
  });

  it('A6-5: the VRPC lock comes before the start-date checks (personalLoan and no renewalDate)', () => {
    expectBothThrow(
      base({ flow: 'variableRatePaymentChange', productType: 'personalLoan', renewalDate: undefined }),
      VRPC_LOCK('personalLoan', 'variable'),
    );
    // Also before a start date that is invalid or after the first payment.
    expectBothThrow(
      base({ flow: 'variableRatePaymentChange', productType: 'personalLoan', renewalDate: new Date(NaN) }),
      VRPC_LOCK('personalLoan', 'variable'),
    );
  });

  it('A6-5: the flow check comes before the productType check', () => {
    expectBothThrow(base({ flow: 'bogus', productType: 'car' }), FLOW_MSG('bogus'));
  });

  it("A6-5: new flow with no disbursalDate (even with renewalDate set) -> requires disbursalDate", () => {
    expectBothThrow(base({ disbursalDate: undefined }), "flow 'newMortgageOrLoan' requires disbursalDate");
    expectBothThrow(
      base({ disbursalDate: undefined, renewalDate: d('2027-01-01') }),
      "flow 'newMortgageOrLoan' requires disbursalDate",
    );
  });

  for (const flow of NON_NEW) {
    it(`A6-5: ${flow} with no renewalDate (even with disbursalDate set) -> requires renewalDate`, () => {
      expectBothThrow(base({ flow, renewalDate: undefined }), `flow '${flow}' requires renewalDate`);
      expectBothThrow(
        base({ flow, renewalDate: undefined, disbursalDate: d('2027-01-01') }),
        `flow '${flow}' requires renewalDate`,
      );
    });
  }

  for (const flow of FLOW_IDS_EXPECTED) {
    const field = startFieldOf(flow);
    it(`A6-5: ${flow}: ${field} = new Date(NaN) -> '${field} must be a valid Date'`, () => {
      expectBothThrow(base({ flow, [field]: new Date(NaN) }), `${field} must be a valid Date`);
    });

    it(`A6-5: ${flow}: ${field} 5 days after the first payment -> '${field} must be on or before firstPaymentDate'`, () => {
      expectBothThrow(base({ flow, [field]: d('2027-02-06') }), `${field} must be on or before firstPaymentDate`);
    });

    it(`A6-5: ${flow}: only ${field} is checked (the other start field may be invalid or late)`, () => {
      const other = field === 'disbursalDate' ? 'renewalDate' : 'disbursalDate';
      expectAccepted(base({ flow, [other]: new Date(NaN) }));
      expectAccepted(base({ flow, [other]: d('2027-02-06') }));
    });
  }

  for (const flow of NOT_VRPC) {
    // B24-R5 (Q-SACD): an absent date is rejected only when SEMI_ANNUAL_DATE_REQUIRED is on; off, it is accepted.
    it.each(BOTH_SEMI)(`A6-5: ${flow}: mortgage/fixed with no semiAnnualCompoundingDate -> Q-SACD message when on, accepted when off (%s)`, async (_l, required) => {
      const api = await loadValidate(required);
      const input = base({ flow, rateType: 'fixed' });
      if (required) {
        expect(() => api.validateCobCanadaInput(input)).toThrow(new RangeError(SEMI_MSG));
        expect(() => api.calculateCobCanada(input)).toThrow(new RangeError(SEMI_MSG));
      } else {
        expect(() => api.validateCobCanadaInput(input)).not.toThrow();
        expect(() => api.calculateCobCanada(input)).not.toThrow();
      }
    });

    it(`A6-5: ${flow}: mortgage/fixed with semiAnnualCompoundingDate = new Date(NaN) -> must be a valid Date`, () => {
      expectBothThrow(
        base({ flow, rateType: 'fixed', semiAnnualCompoundingDate: new Date(NaN) }),
        'semiAnnualCompoundingDate must be a valid Date',
      );
    });

    it(`A6-5: ${flow}: personalLoan/fixed with no semiAnnualCompoundingDate is accepted (Renewal too since 2026-10-01)`, () => {
      const input = base({ flow, productType: 'personalLoan', rateType: 'fixed' });
      expectAccepted(input);
    });

    it(`A6-5: ${flow}: mortgage/fixed with a valid semiAnnualCompoundingDate is accepted (non-vacuity)`, () => {
      expectAccepted(base({ flow, rateType: 'fixed', semiAnnualCompoundingDate: d('2026-12-15') }));
    });

    it(`A6-5: ${flow}: the start-date check comes before the semi-annual check`, () => {
      const field = startFieldOf(flow);
      expectBothThrow(base({ flow, rateType: 'fixed', [field]: undefined }), `flow '${flow}' requires ${field}`);
    });
  }

  it('A6-5: a semi-annual date on a non-(mortgage/fixed) pair is ignored, even if invalid', () => {
    for (const [p, r] of PAIRS.filter(([p, r]) => !(p === 'mortgage' && r === 'fixed'))) {
      expectAccepted(base({ productType: p, rateType: r, semiAnnualCompoundingDate: new Date(NaN) }));
    }
  });
});

describe('A6-6 green (characterisation): which inputs the engine reads per flow (JSON.stringify)', () => {
  for (const [p, r] of PAIRS) {
    const semi = p === 'mortgage' && r === 'fixed' ? { semiAnnualCompoundingDate: d('2026-12-15') } : {};
    it(`A6-6: new flow ${p}/${r}: accruedInterest 5000 is ignored (accruedInterest 'hidden')`, () => {
      const without = base({ productType: p, rateType: r, ...semi });
      expect(run(base({ productType: p, rateType: r, ...semi, accruedInterest: 5000 }))).toBe(run(without));
    });
  }

  it('A6-6 non-vacuity: for renewal, accruedInterest 5000 changes the result', () => {
    expect(run(base({ flow: 'renewal', accruedInterest: 5000 }))).not.toBe(run(base({ flow: 'renewal' })));
  });

  for (const flow of NON_NEW) {
    it(`A6-6: ${flow}: an extra valid disbursalDate is ignored (start date = renewalDate)`, () => {
      expect(run(base({ flow, disbursalDate: d('2026-12-01') }))).toBe(run(base({ flow })));
    });
  }

  it('A6-6: new flow: an extra renewalDate is ignored (start date = disbursalDate)', () => {
    expect(run(base({ renewalDate: d('2026-12-01') }))).toBe(run(base()));
  });

  it('A6-6 non-vacuity: moving the start date changes the result (renewal and new flow)', () => {
    expect(run(base({ flow: 'renewal', renewalDate: d('2026-12-01') }))).not.toBe(run(base({ flow: 'renewal' })));
    expect(run(base({ disbursalDate: d('2026-12-01') }))).not.toBe(run(base()));
  });

  for (const flow of NON_NEW) {
    it(`B20-2: ${flow}: absent accruedInterest is rejected with the B20 message (was: equals 0)`, () => {
      expectBothThrow(
        base({ flow, accruedInterest: undefined }),
        `flow '${flow}' requires accruedInterest (enter 0 if there is none)`,
      );
    });
  }

  it('A6-6: triggerRatePercent !== null iff mortgage/variable, over the 13 flow/pair combinations that validate (VRPC only mortgage/variable; Renewal + personal loan allowed since 2026-10-01)', () => {
    let n = 0;
    for (const flow of FLOW_IDS_EXPECTED) {
      for (const [p, r] of PAIRS) {
        if (flow === 'variableRatePaymentChange' && !(p === 'mortgage' && r === 'variable')) continue;
        const semi = p === 'mortgage' && r === 'fixed' ? { semiAnnualCompoundingDate: d('2026-12-15') } : {};
        const res = calculateCobCanada(base({ flow, productType: p, rateType: r, ...semi }));
        expect(res.triggerRatePercent !== null, `${flow} ${p}/${r}`).toBe(p === 'mortgage' && r === 'variable');
        if (res.triggerRatePercent !== null) expect(Number.isFinite(res.triggerRatePercent)).toBe(true);
        n++;
      }
    }
    expect(n).toBe(13);
  });
});

describe('A6-7 red: no flow/product/rate literal comparisons outside flows.ts (source guard)', () => {
  const GUARD =
    /[!=]==\s*'(newMortgageOrLoan|renewal|paymentChange|variableRatePaymentChange|mortgage|personalLoan|fixed|variable)'/;
  for (const file of ['src/ca/cobCanada.ts', 'src/ca/validate.ts', 'ui/ca.js', 'ui/ca-view.js']) {
    it(`A6-7: ${file} compares no flow/product/rate literal (after stripComments)`, () => {
      const lines = stripComments(readFileSync(`${ROOT}/${file}`, 'utf8')).split('\n');
      const hits = lines.flatMap((l, i) => (GUARD.test(l) ? [`${file}:${i + 1}: ${l.trim()}`] : []));
      expect(hits).toEqual([]);
    });
  }

  it('A6-7: ui/ca.js defines none of FORCED_PRODUCT_TYPE, FORCED_RATE_TYPE, isNewFlow, isChangeFlow, startDateLabel', () => {
    const code = stripComments(readFileSync(`${ROOT}/ui/ca.js`, 'utf8'));
    const defs = [
      ...code.matchAll(
        /\b(?:const|let|var|function\*?|class)\s+(FORCED_PRODUCT_TYPE|FORCED_RATE_TYPE|isNewFlow|isChangeFlow|startDateLabel)\b/g,
      ),
    ].map((m) => m[1]);
    // Also catch plain assignments and destructured definitions of those names.
    const assigned = [
      ...code.matchAll(/(?:^|[^.\w$])(FORCED_PRODUCT_TYPE|FORCED_RATE_TYPE|isNewFlow|isChangeFlow)\s*=[^=]/gm),
    ].map((m) => m[1]);
    expect([...defs, ...assigned]).toEqual([]);
  });
});
