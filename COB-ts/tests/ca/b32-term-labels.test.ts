/**
 * B32 view and static half (COB-architecture.md section 5 B32-R3..R7, revision 50; user decision DEC-B32-TERM,
 * 2026-10-05, COB-user-stories.md section 7.5). QA red step, 2026-10-05.
 *
 * Label of the derived term: "Remaining contract term" for Renewal and Payment change, "Contract term" for New mortgage
 * or loan and the hidden Variable rate payment change; on the form field, the Contract terms tile and the print row,
 * from ONE source: flowLabels(flow, spec).contractTerm (five keys). Hint: "Calculated from the {start date label,
 * lower-cased} to the last scheduled payment date." The "Contract terms" heading is unchanged (Q-B32-HEADING default).
 *
 *   T7  B32-INV-LABEL   flowLabels: the label per flow, prototype keys, five keys in order, the other four unchanged.
 *   T8  B32-INV-HINT    contractTermHint fed the start date label.
 *   T9  B32-INV-PRINT   printInputRows: the term row carries the per-flow label; every other row as before B32
 *                       (pre-change pins b32_pre_label_pins.json, captured on the pre-B32 tree); both contractDateField states.
 *   T10 B32-INV-STATIC  ca.html label id; ca.js writes the label, feeds the hint the start label, calls contractTerm(input, result).
 *   T11 capture         a10_ui_capture_v1.json: flowScreens termLabel / termHint and each OK scenario's Contract term text,
 *                       print row and tile (red until QA regenerates the capture after sr-dev's step; approved 2026-10-05).
 *
 * Expected strings are literals typed from the decision, not imported from the view. Not time-zone sensitive.
 * sr-dev must not edit these assertions or the pins.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FLOWS, calculateCobCanada, contractTerm as engineContractTerm, requiresSemiAnnualDate } from '../../src/ca/index.js';
import type { CobFlow, ProductType, RateType } from '../../src/ca/index.js';
import type * as View from '../../ui/ca-view.js';
import { ROOT, stripComments } from '../architecture/support.js';
import { loadFixture } from './support/fixtures.js';
import { BOTH_CONTRACT_DATE, CONTRACT_DATE_OFF } from './support/uiSwitches.js';
import type { TestUiSwitches } from './support/uiSwitches.js';

const loadView = () => import('../../ui/ca-view.js') as Promise<typeof View>;
const FLOW_IDS: CobFlow[] = ['newMortgageOrLoan', 'renewal', 'paymentChange', 'variableRatePaymentChange'];
const REMAINING = 'Remaining contract term';
const PLAIN = 'Contract term';
// B32-R3 (DEC-B32-TERM): typed from the decision.
const WANT_LABEL: Record<CobFlow, string> = {
  newMortgageOrLoan: PLAIN,
  renewal: REMAINING,
  paymentChange: REMAINING,
  variableRatePaymentChange: PLAIN,
};
// B32-R4: the start date label, lower-cased.
const WANT_HINT: Record<CobFlow, string> = {
  newMortgageOrLoan: 'Calculated from the disbursal date to the last scheduled payment date.',
  renewal: 'Calculated from the renewal date to the last scheduled payment date.',
  paymentChange: 'Calculated from the date of change to the last scheduled payment date.',
  variableRatePaymentChange: 'Calculated from the date of change to the last scheduled payment date.',
};

interface PrePins {
  flowLabels: Record<CobFlow, Record<string, string | null>>;
  printRows: { id: string; state: string; moveNote: string; rows: [string, string][] }[];
}
const PRE = loadFixture<PrePins>('b32_pre_label_pins.json');
interface Capture {
  flowScreens: Record<string, Record<string, string>>;
  scenarios: { id: string; raw: View.RawForm; contractTermField: string; error: string | null; modes: Record<string, { html: Record<string, string> }> }[];
}
const CAP = loadFixture<Capture>('a10_ui_capture_v1.json');
const ctxOf = (raw: View.RawForm, switches: TestUiSwitches): View.ViewContext => ({
  spec: FLOWS[raw.flow as CobFlow],
  semiAnnual: requiresSemiAnnualDate(raw.productType as ProductType, raw.rateType as RateType),
  switches,
});
/** flowLabels(...).contractTerm read without relying on the pre-B32 type (undefined before B32). */
const termLabelOf = (t: View.FlowLabels): unknown => (t as unknown as Record<string, unknown>)['contractTerm'];

// ---------------------------------------------------------------------------------------------------------------
// T7 flowLabels
// ---------------------------------------------------------------------------------------------------------------
describe('B32-T7 INV-LABEL: flowLabels(flow, spec).contractTerm (one source for field, tile and print row)', () => {
  it.each(FLOW_IDS)('%s: the label per DEC-B32-TERM', async (flow) => {
    const v = await loadView();
    expect(termLabelOf(v.flowLabels(flow, FLOWS[flow]))).toBe(WANT_LABEL[flow]);
  });

  it.each(FLOW_IDS)('%s: exactly the five keys of B32-R3, in order; the other four values equal the pre-B32 pins', async (flow) => {
    const v = await loadView();
    const t = v.flowLabels(flow, FLOWS[flow]) as unknown as Record<string, unknown>;
    expect(Object.keys(t)).toEqual(['legend', 'startDate', 'firstPaymentDate', 'contractTerm', 'accruedHint']);
    const { contractTerm: _c, ...rest } = t;
    expect(rest).toStrictEqual(PRE.flowLabels[flow]);
  });

  it('the label is keyed by the flow id, not by the spec: renewal with the New spec still reads "Remaining contract term"', async () => {
    const v = await loadView();
    expect(termLabelOf(v.flowLabels('renewal', FLOWS.newMortgageOrLoan))).toBe(REMAINING);
    expect(termLabelOf(v.flowLabels('newMortgageOrLoan', FLOWS.renewal))).toBe(PLAIN);
  });

  it.each(['toString', 'constructor', 'hasOwnProperty', '__proto__', 'valueOf', 'bogus', ''])(
    'an unknown or prototype key %j falls back to "Contract term" (never a function or object)', async (flow) => {
      const v = await loadView();
      expect(termLabelOf(v.flowLabels(flow, FLOWS.renewal))).toBe(PLAIN);
    });

  it('exact case and wording (no "Remaining Contract Term", no trailing space)', async () => {
    const v = await loadView();
    for (const flow of FLOW_IDS) expect(termLabelOf(v.flowLabels(flow, FLOWS[flow]))).toMatch(/^(Remaining contract term|Contract term)$/);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// T8 hint
// ---------------------------------------------------------------------------------------------------------------
describe('B32-T8 INV-HINT: the hint names the start date (flowLabels(...).startDate lower-cased)', () => {
  it.each(FLOW_IDS)('%s', async (flow) => {
    const v = await loadView();
    expect(v.contractTermHint(v.flowLabels(flow, FLOWS[flow]).startDate.toLowerCase())).toBe(WANT_HINT[flow]);
  });

  it('the hint is built from the label passed in', async () => {
    const v = await loadView();
    expect(v.contractTermHint('some label')).toBe('Calculated from the some label to the last scheduled payment date.');
  });
});

// ---------------------------------------------------------------------------------------------------------------
// T9 print row
// ---------------------------------------------------------------------------------------------------------------
describe('B32-T9 INV-PRINT: printInputRows term row carries the per-flow label; every other row unchanged', () => {
  const cases = CAP.scenarios.flatMap((s) => BOTH_CONTRACT_DATE.flatMap(([state, sw]) =>
    ['', 'M'].map((moveNote) => [`${s.id} (${s.raw.flow}) ${state}${moveNote ? ' with a move note' : ''}`, s, state, sw, moveNote] as const)));

  // B33 (DEC-B33-FREQ, B33-R9): the capture gains PL_WEEKLY (24 -> 28 records). b32_pre_label_pins.json is unchanged and has
  // no PL_WEEKLY record, so for it the label and position are checked, and its other rows equal REF-01's row labels.
  it('non-vacuity: every capture scenario x both switch states x with and without a move note (28 records; 24 pinned before B32)', () => {
    expect(cases).toHaveLength(28);
    expect(PRE.printRows).toHaveLength(24);
    expect(cases.filter(([, s]) => s.id !== 'PL_WEEKLY')).toHaveLength(24);
    expect(PRE.printRows.some((p) => p.id === 'PL_WEEKLY')).toBe(false);
  });

  it.each(cases)('%s', async (_n, s, state, sw, moveNote) => {
    const v = await loadView();
    const raw = { ...s.raw, contractDate: '2026-03-10' };
    const rows = moveNote ? v.printInputRows(raw, ctxOf(raw, sw), 'X', moveNote) : v.printInputRows(raw, ctxOf(raw, sw), 'X');
    // B33: PL_WEEKLY has no pre-B32 record; it is a new-loan scenario like REF-01, so its row labels are REF-01's.
    const preId = s.id === 'PL_WEEKLY' ? 'REF-01' : s.id;
    const pre = PRE.printRows.find((p) => p.id === preId && p.state === state && p.moveNote === moveNote)!.rows;
    const at = rows.findIndex(([, val]) => val === 'X');
    expect(rows.filter(([, val]) => val === 'X'), 'exactly one row carries the term text').toHaveLength(1);
    expect(rows[at]![0]).toBe(WANT_LABEL[s.raw.flow as CobFlow]);
    expect(rows[at]![0]).toBe(termLabelOf(v.flowLabels(s.raw.flow, FLOWS[s.raw.flow as CobFlow])));
    expect(rows[at - 1]![0], 'directly after End date').toBe('End date');
    const preAt = pre.findIndex(([, val]) => val === 'X');
    expect(at, 'same position as before B32').toBe(preAt);
    if (s.id === 'PL_WEEKLY') {
      expect(rows.map(([l]) => l), 'B33: PL_WEEKLY row labels = REF-01 row labels').toEqual(pre.map(([l]) => l));
    } else {
      expect(rows.filter((_r, i) => i !== at), 'every other row as before B32').toEqual(pre.filter((_r, i) => i !== preAt));
    }
  });
});

// ---------------------------------------------------------------------------------------------------------------
// T10 static page
// ---------------------------------------------------------------------------------------------------------------
describe('B32-T10 INV-STATIC: ca.html and ca.js', () => {
  const html = readFileSync(`${ROOT}/ui/ca.html`, 'utf8');
  const js = stripComments(readFileSync(`${ROOT}/ui/ca.js`, 'utf8'));
  const count = (s: string, sub: string): number => s.split(sub).length - 1;

  it('ca.html: <label for="contractTerm" id="contractTerm-label">Contract term</label> exactly once (New-flow static text)', () => {
    expect(count(html, '<label for="contractTerm" id="contractTerm-label">Contract term</label>')).toBe(1);
    expect(count(html, 'id="contractTerm-label"')).toBe(1);
  });

  it('ca.html: the "Contract terms" section heading is unchanged (Q-B32-HEADING default)', () => {
    expect(html).toMatch(/<h3 id="contractTerms-heading">Contract terms<span data-switch="contractDateField">/);
  });

  it('ca.js looks up #contractTerm-label and writes texts.contractTerm to it', () => {
    expect(js).toMatch(/const\s+contractTermLabelEl\s*=\s*document\.getElementById\('contractTerm-label'\)/);
    expect(js).toMatch(/contractTermLabelEl\.textContent\s*=\s*texts\.contractTerm\s*;/);
  });

  it('ca.js uses texts.contractTerm at least twice (field label and tile)', () => {
    expect(count(js, 'texts.contractTerm')).toBeGreaterThanOrEqual(2);
  });

  it('ca.js feeds the hint the start date label: contractTermHint(texts.startDate.toLowerCase()), never the first payment label', () => {
    expect(js).toContain('contractTermHint(texts.startDate.toLowerCase())');
    expect(js).not.toContain('texts.firstPaymentDate.toLowerCase()');
  });

  it('ca.js calls contractTerm(input, result) twice and never the one-argument or swapped form', () => {
    expect(count(js, 'contractTerm(input, result)')).toBe(2);
    expect(js).not.toMatch(/\bcontractTerm\(\s*result\s*\)/);
    expect(js).not.toMatch(/\bcontractTerm\(\s*result\s*,/);
  });

  it('ca.js holds no "Contract term" / "Remaining contract term" literal in any quote style', () => {
    for (const s of [PLAIN, REMAINING]) expect(js).not.toMatch(new RegExp(`['"\`]${s}['"\`]`));
  });

  it('ca-view.js: printInputRows has no "Contract term" literal row any more (the label comes from texts.contractTerm)', () => {
    const view = stripComments(readFileSync(`${ROOT}/ui/ca-view.js`, 'utf8'));
    expect(view).not.toContain("['Contract term', termText]");
    expect(view).toContain('[texts.contractTerm, termText]');
  });

  it('ca-view.d.ts (QA-owned, B32-R7): FlowLabels carries contractTerm; contractTermHint takes startDateLabel', () => {
    const dts = readFileSync(`${ROOT}/ui/ca-view.d.ts`, 'utf8');
    expect(dts).toMatch(/export interface FlowLabels \{ legend: string; startDate: string; firstPaymentDate: string; contractTerm: string; accruedHint: string \| null \}/);
    expect(dts).toMatch(/export function contractTermHint\(startDateLabel: string\): string;/);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// T11 the Chrome capture (red until the capture is regenerated after sr-dev's step)
// ---------------------------------------------------------------------------------------------------------------
describe('B32-T11 capture a10_ui_capture_v1.json: what Chrome showed', () => {
  it.each(FLOW_IDS)('%s: flowScreens termLabel and termHint per R3 / R4; termLabel is the key right after termHint', (flow) => {
    const fs = CAP.flowScreens[flow]!;
    expect(fs['termHint']).toBe(WANT_HINT[flow]);
    expect(fs['termLabel']).toBe(WANT_LABEL[flow]);
    const keys = Object.keys(fs);
    expect(keys.indexOf('termLabel')).toBe(keys.indexOf('termHint') + 1);
    expect(keys.at(-1)).toBe('termLabel');
  });

  // The four successful scenarios and their new Contract term (brief's vectors table).
  const OK: [string, string][] = [
    ['REF-01', '2 years, 11 months, 23 days'],
    ['S1_fees', '2 years, 11 months, 23 days'],
    ['RENEWAL', '2 years, 6 months, 0 days'],
    ['VRPC_zero_accrued', '4 years, 11 months, 22 days'],
    ['PL_WEEKLY', '2 years, 10 months, 13 days'], // B33 (DEC-B33-FREQ, B33-R9): 2026-03-17 -> 2029-01-30
  ];

  it('the successful scenarios are exactly these five (B33 adds PL_WEEKLY; the two error scenarios show no term)', () => {
    expect(CAP.scenarios.filter((s) => s.contractTermField !== '').map((s) => s.id)).toEqual(OK.map(([id]) => id));
  });

  it.each(OK)('%s: contractTermField is %j = contractTermText(contractTerm(toInput(raw, ctx), result))', async (id, want) => {
    const v = await loadView();
    const s = CAP.scenarios.find((x) => x.id === id)!;
    expect(s.contractTermField).toBe(want);
    const ctx = ctxOf(s.raw, CONTRACT_DATE_OFF);
    const input = v.toInput(s.raw, ctx);
    const r = calculateCobCanada(input);
    const term = (engineContractTerm as unknown as (i: unknown, r: unknown) => { years: number; months: number; days: number })(input, r);
    expect(s.contractTermField).toBe(v.contractTermText(term));
  });

  it.each(OK)('%s: in both modes the printed row and the tile carry the per-flow label and the field text', (id, want) => {
    const s = CAP.scenarios.find((x) => x.id === id)!;
    const lbl = WANT_LABEL[s.raw.flow as CobFlow];
    const tile = want.replace(/(\d+) (year|month|day)/g, '$1&nbsp;$2'); // innerHTML serialises the no-break space as &nbsp;
    expect(Object.keys(s.modes)).toEqual(['all', 'compact']);
    for (const [mode, m] of Object.entries(s.modes)) {
      expect(m.html['printInputs'], `${mode} printInputs`).toContain(`<dt>${lbl}</dt><dd>${want}</dd>`);
      expect(m.html['contractTermsList'], `${mode} tile label`).toContain(`<dt class="term-label">${lbl}</dt>`);
      expect(m.html['contractTermsList'], `${mode} tile value`).toContain(tile);
    }
  });
});
