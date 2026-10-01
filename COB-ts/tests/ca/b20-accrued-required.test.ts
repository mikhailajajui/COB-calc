/**
 * B20 (COB-architecture.md §5 B20, revision 20; stakeholder decision 4, FB-4, FB-17; closes OQ-B /
 * BR-05 / doc finding F3): Accrued interest is REQUIRED for renewal, paymentChange and
 * variableRatePaymentChange; blank by default; $0 is a value. The new-loan flow is unchanged
 * (hidden, ignored). The workbook has no Accrued interest input (COB-user-stories.md §7.4), so
 * there is no Excel behaviour to match and no DEV ID. QA step written 2026-09-29, before the
 * developer step; the developer must not edit these assertions.
 *
 * Tests (19): B20-3 x3, B20-4 x3, B20-5, B20-6, B20-7 x2, B20-8 x3, B20-9 x3 + B20-9b, B20-10, B20-11.
 * (B20-1 / B20-2 are in flows-a6.test.ts; the type-level B20-T1..T4 are in
 * tests/types/a8-input-union.typecheck.ts; check order E13 / E14 and rows 18c are in
 * a9-input-issues.test.ts.)
 *
 * Interim message (Q-MSG, brief B20-R6): `flow '<flow>' requires accruedInterest (enter 0 if there
 * is none)`. A rewording is one string plus the edit list in the brief.
 *
 * Red before B20: B20-3 (x3), B20-6, B20-8c, B20-10, B20-11. Green before and after: the rest
 * (they pin what must NOT change: 0 and 0.01 valid, the new flow, the goldens' inputs, the mapping).
 * No date sequences asserted, so this file does not join `test:tz`.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { calculateCobCanada, collectInputIssues, FLOWS, requiresSemiAnnualDate } from '../../src/ca/index.js';
import type { CobCanadaInput, CobFlow, ProductType, RateType } from '../../src/ca/index.js';
import { validateCobCanadaInput } from '../../src/ca/validate.js';
import type * as View from '../../ui/ca-view.js';
import { ROOT } from '../architecture/support.js';
// @ts-ignore -- plain .mjs shared with the golden generators (no .d.ts); as in a9 / b8 / b10.
import * as corpusV1 from './fixtures/generate_golden.mjs';
// @ts-ignore -- plain .mjs (no .d.ts)
import * as corpusPc from './fixtures/generate_golden_pc.mjs';
import { asInput, utcDate } from './support/builders.js';
import { loadFixture } from './support/fixtures.js';
import { ON } from './support/uiSwitches.js';

const d = utcDate;
const NON_NEW: CobFlow[] = ['renewal', 'paymentChange', 'variableRatePaymentChange'];
const MSG = (flow: string) => `flow '${flow}' requires accruedInterest (enter 0 if there is none)`;

/** Valid existing-loan input: mortgage / variable (so it is valid for all three flows), monthly. */
function base(flow: CobFlow, over: Record<string, unknown> = {}): CobCanadaInput {
  const input: Record<string, unknown> = {
    flow,
    productType: 'mortgage',
    rateType: 'variable',
    loanAmount: 250000,
    fees: { fees: [] },
    contractRatePercent: 5.19,
    paymentAmount: 1300,
    paymentFrequency: 'monthly',
    firstPaymentDate: d('2027-02-01'),
    endDate: d('2028-02-01'),
    termYears: 1,
    termMonths: 0,
    ...(flow === 'newMortgageOrLoan' ? { disbursalDate: d('2027-01-01') } : { renewalDate: d('2027-01-15'), accruedInterest: 0 }),
    ...over,
  };
  for (const k of Object.keys(over)) if (over[k] === undefined) delete input[k];
  return asInput(input);
}

function thrownBy(fn: () => unknown): Error {
  try {
    fn();
  } catch (e) {
    return e as Error;
  }
  throw new Error('expected a throw');
}

describe('B20-3 absent accruedInterest is rejected for each existing-loan flow (validate, calculate; own messages kept)', () => {
  for (const flow of NON_NEW) {
    it(`B20-3: ${flow}: absent -> the B20 RangeError from both entry points; null / NaN / 'x' / -1 keep their own messages`, () => {
      const x = base(flow, { accruedInterest: undefined });
      for (const run of [() => validateCobCanadaInput(x), () => calculateCobCanada(x)]) {
        const e = thrownBy(run);
        expect(e).toBeInstanceOf(RangeError);
        expect(e.message).toBe(MSG(flow));
      }
      const OWN: [unknown, string][] = [
        [null, 'accruedInterest must be a finite number, got null'],
        [NaN, 'accruedInterest must be a finite number, got NaN'],
        ['x', 'accruedInterest must be a finite number, got x'],
        [-1, 'accruedInterest must be >= 0, got -1'],
      ];
      for (const [v, message] of OWN) {
        const e = thrownBy(() => calculateCobCanada(base(flow, { accruedInterest: v })));
        expect(e, String(v)).toBeInstanceOf(RangeError);
        expect(e.message, String(v)).toBe(message);
      }
    });
  }
});

describe('B20-4 zero and a positive amount are accepted (green before and after)', () => {
  for (const flow of NON_NEW) {
    it(`B20-4: ${flow}: accruedInterest 0 and 0.01 validate and calculate; 0 gives opening bucket 0, 500 gives 500`, () => {
      for (const v of [0, 0.01]) {
        expect(() => validateCobCanadaInput(base(flow, { accruedInterest: v })), String(v)).not.toThrow();
        expect(calculateCobCanada(base(flow, { accruedInterest: v })).amortizationSchedule.length, String(v)).toBeGreaterThan(0);
      }
      const zero = calculateCobCanada(base(flow, { accruedInterest: 0 }));
      const five = calculateCobCanada(base(flow, { accruedInterest: 500 }));
      expect(zero.amortizationSchedule[0]!.carriedAccruedInterestOpening).toBe(0);
      expect(five.amortizationSchedule[0]!.carriedAccruedInterestOpening).toBe(500);
    });
  }
});

describe('B20-5 the new-loan flow is unchanged (green before and after)', () => {
  it('B20-5: newMortgageOrLoan: absent accruedInterest is valid; a supplied 5000 is ignored (result JSON identical)', () => {
    const without = base('newMortgageOrLoan');
    expect('accruedInterest' in (without as object)).toBe(false);
    expect(() => validateCobCanadaInput(without)).not.toThrow();
    const withIt = base('newMortgageOrLoan', { accruedInterest: 5000 });
    expect(JSON.stringify(calculateCobCanada(withIt))).toBe(JSON.stringify(calculateCobCanada(without)));
  });
});

describe('B20-6 collectInputIssues', () => {
  it('B20-6: exactly one issue on accruedInterest for each existing-loan flow when absent; none for the new flow; none when 0', () => {
    for (const flow of NON_NEW) {
      const issues = collectInputIssues(base(flow, { accruedInterest: undefined }));
      expect(issues, flow).toEqual([{ field: 'accruedInterest', message: MSG(flow) }]);
      expect(collectInputIssues(base(flow, { accruedInterest: 0 })), `${flow} 0`).toEqual([]);
    }
    expect(collectInputIssues(base('newMortgageOrLoan'))).toEqual([]);
  });
});

describe('B20-7 both golden corpora always pass the field, so B20 cannot move either golden', () => {
  type P = Record<string, unknown>;
  const inputsOf = (c: { buildGroups(): { cases: { params: P }[] }[]; buildLongCases(): { params: P }[]; makeInput(p: P): unknown }) =>
    [...c.buildGroups().flatMap((g) => g.cases.map((k) => k.params)), ...c.buildLongCases().map((k) => k.params)].map(
      (p) => c.makeInput(p) as Record<string, unknown>,
    );
  for (const [name, corpus] of [['v1', corpusV1], ['PC / VRPC', corpusPc]] as const) {
    it(`B20-7: ${name} corpus: every non-new input carries a finite numeric accruedInterest (non-vacuous)`, () => {
      const inputs = inputsOf(corpus as never);
      const nonNew = inputs.filter((x) => x.flow !== 'newMortgageOrLoan');
      expect(nonNew.length).toBeGreaterThan(0);
      const bad = nonNew.filter((x) => typeof x.accruedInterest !== 'number' || !Number.isFinite(x.accruedInterest as number));
      expect(bad).toHaveLength(0);
    });
  }
});

// --- UI mapping (ca-view.js, DOM-free) ---
interface Scenario {
  id: string;
  raw: View.RawForm;
  error: string | null;
  modes: Record<string, unknown>;
}
const CAPTURE = loadFixture<{ scenarios: Scenario[] }>('a10_ui_capture_v1.json');
const scenario = (id: string): Scenario => {
  const s = CAPTURE.scenarios.find((x) => x.id === id);
  if (!s) throw new Error(`scenario ${id} missing from a10_ui_capture_v1.json`);
  return s;
};
const loadView = () => import('../../ui/ca-view.js') as Promise<typeof View>;
const ctxOf = (raw: View.RawForm): View.ViewContext => ({
  spec: FLOWS[raw.flow as CobFlow],
  semiAnnual: requiresSemiAnnualDate(raw.productType as ProductType, raw.rateType as RateType),
  switches: ON, // B23
});
/** One RawForm per flow, all from captured pages (accruedInterest is overridden per test). */
const RAW_BY_FLOW: Record<string, () => View.RawForm> = {
  renewal: () => scenario('RENEWAL').raw,
  paymentChange: () => ({ ...scenario('RENEWAL').raw, flow: 'paymentChange' }),
  variableRatePaymentChange: () => scenario('VRPC_zero_accrued').raw,
};

describe('B20-8 toInput: a blank is not sent, so the engine\'s B20 message is what the page shows', () => {
  it('B20-8a: blank and spaces send no accruedInterest key, for every existing-loan flow', async () => {
    const v = await loadView();
    for (const flow of NON_NEW) {
      const raw = RAW_BY_FLOW[flow]!();
      for (const blank of ['', '   ']) {
        expect('accruedInterest' in v.toInput({ ...raw, accruedInterest: blank }, ctxOf(raw)), `${flow} '${blank}'`).toBe(false);
      }
    }
  });
  it('B20-8b: 0, 0.00 and 125.50 send 0, 0 and 125.5 (a typed zero is a value)', async () => {
    const v = await loadView();
    for (const flow of NON_NEW) {
      const raw = RAW_BY_FLOW[flow]!();
      const at = (a: string) => v.toInput({ ...raw, accruedInterest: a }, ctxOf(raw)).accruedInterest;
      expect([at('0'), at('0.00'), at('125.50')], flow).toEqual([0, 0, 125.5]);
    }
  });
  it('B20-8c: the engine rejects the blank input toInput builds, with the B20 message, for every existing-loan flow', async () => {
    const v = await loadView();
    for (const flow of NON_NEW) {
      const raw = { ...RAW_BY_FLOW[flow]!(), accruedInterest: '' };
      const e = thrownBy(() => calculateCobCanada(v.toInput(raw, ctxOf(raw))));
      expect(e, flow).toBeInstanceOf(RangeError);
      expect(e.message, flow).toBe(MSG(flow));
    }
  });
});

// B24-R6: printInputRows takes the Contract term text as a required third argument; these tests do not look at that row.
const TERM_TEXT = '2 years, 11 months, 17 days';

describe('B20-9 printInputRows: the Accrued interest row is always present for the existing-loan flows', () => {
  const rowOf = (rows: [string, string][]) => rows.filter(([k]) => k === 'Accrued interest');
  for (const flow of NON_NEW) {
    it(`B20-9: ${flow}: typed 0 -> one row '$0.00'; 125.50 -> '$125.50'; 1,125.50 -> '$1,125.50'`, async () => {
      const v = await loadView();
      const raw = RAW_BY_FLOW[flow]!();
      const at = (a: string) => rowOf(v.printInputRows({ ...raw, accruedInterest: a }, ctxOf(raw), TERM_TEXT));
      expect(at('0')).toEqual([['Accrued interest', '$0.00']]);
      expect(at('0.00')).toEqual([['Accrued interest', '$0.00']]);
      expect(at('125.50')).toEqual([['Accrued interest', '$125.50']]);
      expect(at('1,125.50')).toEqual([['Accrued interest', '$1,125.50']]);
      // B20-R4(c): the row is always present, even for a blank (only presence is pinned, not its text).
      // Asserted in the renewal test only, so b20 has exactly 8 red tests (brief count).
      if (flow === 'renewal') expect(at('')).toHaveLength(1);
    });
  }
  it('B20-9b: newMortgageOrLoan: no Accrued interest row, whatever the field holds', async () => {
    const v = await loadView();
    const raw = scenario('REF-01').raw;
    for (const a of ['', '0.00', '5']) {
      expect(rowOf(v.printInputRows({ ...raw, accruedInterest: a }, ctxOf(raw), TERM_TEXT)), `'${a}'`).toEqual([]);
    }
  });
});

describe('B20-10 ui/ca.html: the field opens blank', () => {
  it('B20-10: the #accruedInterest input has no non-empty value attribute', () => {
    const html = readFileSync(`${ROOT}/ui/ca.html`, 'utf8').replace(/<!--[\s\S]*?-->/g, '');
    const tags = [...html.matchAll(/<input\b[^>]*\bid="accruedInterest"[^>]*>/g)].map((m) => m[0]);
    expect(tags).toHaveLength(1);
    const value = /\bvalue="([^"]*)"/.exec(tags[0]!);
    expect(value === null || value[1] === '').toBe(true);
  });
});

describe('B20-11 the A10 capture fixture (B20-FIX, user-approved 2026-09-29)', () => {
  it('B20-11: VRPC_blank_accrued is an error case with the B20 message and no modes, and the engine agrees; VRPC_zero_accrued calculates; the new-flow hidden field is blank', async () => {
    const v = await loadView();
    const blank = scenario('VRPC_blank_accrued');
    expect(blank.raw.accruedInterest).toBe('');
    expect(blank.error).toBe(MSG('variableRatePaymentChange'));
    expect(blank.modes).toEqual({});
    // The fixture agrees with the live engine + view (red until the UI/engine change lands).
    const e = thrownBy(() => calculateCobCanada(v.toInput(blank.raw, ctxOf(blank.raw))));
    expect(e.message).toBe(blank.error);

    const zero = scenario('VRPC_zero_accrued');
    expect(zero.raw.accruedInterest).toBe('0.00');
    expect(zero.error).toBeNull();
    expect(Object.keys(zero.modes)).toEqual(['all', 'compact']);
    expect(() => calculateCobCanada(v.toInput(zero.raw, ctxOf(zero.raw)))).not.toThrow();

    for (const id of ['REF-01', 'S1_fees', 'ERR_blank_rate']) expect(scenario(id).raw.accruedInterest, id).toBe('');
    expect(CAPTURE.scenarios.map((s) => s.id)).toEqual([
      'REF-01', 'S1_fees', 'RENEWAL', 'VRPC_blank_accrued', 'VRPC_zero_accrued', 'ERR_blank_rate',
    ]);
  });
});
