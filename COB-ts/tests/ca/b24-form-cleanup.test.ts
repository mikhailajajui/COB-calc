/**
 * B24 views and static half (COB-architecture.md section 5 B24, revision 31; DEV-OQP; user decisions 2026-09-30):
 *   A. the Contract date field is hidden behind `UI_SWITCHES.contractDateField` (shipped off);
 *   B. the Semi-annual compounding date is required only while `SEMI_ANNUAL_DATE_REQUIRED` is on (engine switch, shipped
 *      off, decision Q-SACD) and the UI follows `requiresSemiAnnualDate(...)`;
 *   C. Term years / Term months are removed; ONE read-only `#contractTerm` shows the derived Contract term.
 *
 *   T6 views + static page: contractTermParts / contractTermText / contractTermHint, toInput, printInputRows, ca.html, ca.js.
 *   T7 part A (both switch states).   T8 part B (both switch states).   T9 the three Chrome scripts.
 *
 * Expected strings are literals typed by QA from the brief and the user's decisions, not imported from the view.
 * New view exports are read at call time through `loadView`, so each test fails on its own while the code is missing.
 * Written before the developer step; sr-dev must not edit these assertions. The Chrome half (the page really loads, the
 * field shows, blank before) is in the three scripts: capture_a10_ui.mjs, check_print_width.mjs, check_page_smoke.mjs.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as ca from '../../src/ca/index.js';
import type { CobFlow, ProductType, RateType } from '../../src/ca/index.js';
import type * as View from '../../ui/ca-view.js';
import { ROOT, stripComments } from '../architecture/support.js';
import { asInput, utcDate } from './support/builders.js';
import { loadFixture } from './support/fixtures.js';
import { BOTH_SEMI, SHIPPED_SEMI_REQUIRED, loadValidate } from './support/semiSwitch.js';
import { BOTH_CONTRACT_DATE, CONTRACT_DATE_OFF, CONTRACT_DATE_ON, OFF } from './support/uiSwitches.js';
import type { TestUiSwitches } from './support/uiSwitches.js';

const d = utcDate;
const loadView = () => import('../../ui/ca-view.js') as Promise<typeof View>;
const FLOW_IDS: CobFlow[] = ['newMortgageOrLoan', 'renewal', 'paymentChange', 'variableRatePaymentChange'];

interface Capture { scenarios: { id: string; raw: View.RawForm }[] }
const CAPTURE = loadFixture<Capture>('a10_ui_capture_v1.json');
const rawOf = (id: string): View.RawForm => ({ ...CAPTURE.scenarios.find((s) => s.id === id)!.raw, fees: [] });
/** One raw form per flow (mortgage; fixed for new/renewal/PC, variable for VRPC), from the captured pages. */
const RAW_FLOW: Record<CobFlow, () => View.RawForm> = {
  newMortgageOrLoan: () => rawOf('REF-01'),
  renewal: () => rawOf('RENEWAL'),
  paymentChange: () => ({ ...rawOf('RENEWAL'), flow: 'paymentChange' }),
  variableRatePaymentChange: () => rawOf('VRPC_zero_accrued'),
};
const ctxOf = (raw: View.RawForm, switches: TestUiSwitches = OFF, semiAnnual?: boolean): View.ViewContext => ({
  spec: ca.FLOWS[raw.flow as CobFlow],
  semiAnnual: semiAnnual ?? ca.requiresSemiAnnualDate(raw.productType as ProductType, raw.rateType as RateType),
  switches,
});
const code = (file: string): string => stripComments(readFileSync(`${ROOT}/${file}`, 'utf8'));
const html = (): string => readFileSync(`${ROOT}/ui/ca.html`, 'utf8').replace(/<!--[\s\S]*?-->/g, '');

// ---------------------------------------------------------------------------------------------------------------
// T6 the text of the term: parts, text, hint
// ---------------------------------------------------------------------------------------------------------------
const TERM_TABLE: [string, { years: number; months: number; days: number }, [string, string, string], string][] = [
  ['REF-01', { years: 2, months: 11, days: 17 }, ['2 years', '11 months', '17 days'], '2 years, 11 months, 17 days'],
  ['all ones: singular only for 1', { years: 1, months: 1, days: 1 }, ['1 year', '1 month', '1 day'], '1 year, 1 month, 1 day'],
  ['the decided example (under a month)', { years: 0, months: 0, days: 20 }, ['0 years', '0 months', '20 days'], '0 years, 0 months, 20 days'],
  ['all zero: zero parts are always shown', { years: 0, months: 0, days: 0 }, ['0 years', '0 months', '0 days'], '0 years, 0 months, 0 days'],
  ['one year exactly (the printed "1 years" defect is gone)', { years: 1, months: 0, days: 0 }, ['1 year', '0 months', '0 days'], '1 year, 0 months, 0 days'],
  ['RENEWAL', { years: 2, months: 5, days: 0 }, ['2 years', '5 months', '0 days'], '2 years, 5 months, 0 days'],
  ['widest', { years: 40, months: 11, days: 30 }, ['40 years', '11 months', '30 days'], '40 years, 11 months, 30 days'],
];

describe('B24-T6 contractTermParts / contractTermText (B24-R6)', () => {
  it.each(TERM_TABLE)('parts: %s', async (_n, term, parts) => {
    const v = await loadView();
    expect(v.contractTermParts(term)).toEqual(parts);
  });
  it.each(TERM_TABLE)('text: %s', async (_n, term, _parts, text) => {
    const v = await loadView();
    expect(v.contractTermText(term)).toBe(text);
  });
});

// B32 (DEC-B32-TERM): the hint names the flow's START date (was the first payment date label).
// B34 (DEC-B34-TERM, revision 53): re-baselined to "From the {start date}; part months count as a full month." (interim, Q-MSG).
describe('B24-T6 contractTermHint (B24-R6, interim wording Q-MSG; start label B32; text B34) per flow', () => {
  it.each([
    ['newMortgageOrLoan', 'From the disbursal date; part months count as a full month.'],
    ['renewal', 'From the renewal date; part months count as a full month.'],
    ['paymentChange', 'From the date of change; part months count as a full month.'],
    ['variableRatePaymentChange', 'From the date of change; part months count as a full month.'],
  ] as const)('%s: "%s" (label = flowLabels(...).startDate, lower-cased)', async (flow, want) => {
    const v = await loadView();
    const label = v.flowLabels(flow, ca.FLOWS[flow]).startDate.toLowerCase();
    expect(v.contractTermHint(label)).toBe(want);
  });

  it('the hint is built from the label passed in (a literal "first payment date" for every flow would be wrong)', async () => {
    const v = await loadView();
    expect(v.contractTermHint('some label')).toBe('From the some label; part months count as a full month.'); // B34 (DEC-B34-TERM)
  });
});

// ---------------------------------------------------------------------------------------------------------------
// T6 toInput and printInputRows
// ---------------------------------------------------------------------------------------------------------------
describe('B24-T6 toInput sends neither termYears nor termMonths (B24-R6)', () => {
  it.each(FLOW_IDS)('%s: the keys are absent even if the raw form still carries them (they are not read)', async (flow) => {
    const v = await loadView();
    const raw = { ...RAW_FLOW[flow](), termYears: '3', termMonths: '4' } as View.RawForm;
    const input = v.toInput(raw, ctxOf(raw)) as unknown as Record<string, unknown>;
    expect('termYears' in input).toBe(false);
    expect('termMonths' in input).toBe(false);
  });

  it.each([true, false])('semiAnnualCompoundingDate is sent only when ctx.semiAnnual is true (here %s), and a raw form without the key works', async (semi) => {
    const v = await loadView();
    const raw = { ...rawOf('REF-01'), semiAnnualCompoundingDate: '2026-03-17' };
    const input = v.toInput(raw, ctxOf(raw, OFF, semi)) as unknown as Record<string, unknown>;
    expect('semiAnnualCompoundingDate' in input).toBe(semi);
    if (semi) expect((input['semiAnnualCompoundingDate'] as Date).toISOString()).toBe('2026-03-17T00:00:00.000Z');
    const { semiAnnualCompoundingDate: _s, contractDate: _c, ...without } = raw as View.RawForm & { contractDate?: string };
    expect(() => v.toInput(without as View.RawForm, ctxOf(without as View.RawForm, OFF, semi))).not.toThrow();
  });
});

describe('B24-T6 printInputRows carries the Contract term text it is given (B24-R6)', () => {
  // B32 (DEC-B32-TERM): the row is located by flowLabels(flow).contractTerm ("Remaining contract term" for renewal and
  // paymentChange, "Contract term" otherwise), typed here as literals.
  const TERM_LABEL: Record<CobFlow, string> = {
    newMortgageOrLoan: 'Contract term', renewal: 'Remaining contract term', paymentChange: 'Remaining contract term', variableRatePaymentChange: 'Contract term',
  };
  it.each(FLOW_IDS)('%s: exactly one term row (per-flow label), directly after "End date", with the given text verbatim', async (flow) => {
    const v = await loadView();
    const raw = RAW_FLOW[flow]();
    const rows = v.printInputRows(raw, ctxOf(raw), 'A-verbatim-text');
    const lbl = (v.flowLabels(flow, ca.FLOWS[flow]) as unknown as Record<string, unknown>)['contractTerm'];
    expect(lbl).toBe(TERM_LABEL[flow]);
    const at = rows.findIndex(([k]) => k === lbl);
    expect(rows.filter(([k]) => k === lbl)).toHaveLength(1);
    expect(rows[at]).toEqual([TERM_LABEL[flow], 'A-verbatim-text']);
    expect(rows[at - 1]![0]).toBe('End date');
  });

  it('print and tile share one formatter: the row text for the REF-01 term is "2 years, 11 months, 17 days" (no "1 years")', async () => {
    const v = await loadView();
    const raw = rawOf('REF-01');
    const text = v.contractTermText({ years: 1, months: 0, days: 0 });
    expect(v.printInputRows(raw, ctxOf(raw), text).find(([k]) => k === 'Contract term')).toEqual(['Contract term', '1 year, 0 months, 0 days']);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// T6 static page: ui/ca.html and ui/ca.js
// ---------------------------------------------------------------------------------------------------------------
const attrsOf = (tag: string): Map<string, string | true> => {
  const m = new Map<string, string | true>();
  for (const a of tag.replace(/^<input\b|\/?>$/g, '').matchAll(/([\w-]+)(?:="([^"]*)")?/g)) m.set(a[1]!, a[2] ?? true);
  return m;
};

describe('B24-T6 ui/ca.html (static)', () => {
  it('no Term years / Term months inputs, no #term-hint, no .unit-pair group in the markup', () => {
    const src = html();
    expect(src).not.toMatch(/id="termYears"/);
    expect(src).not.toMatch(/id="termMonths"/);
    expect(src).not.toMatch(/id="term-hint"/);
    expect(src).not.toMatch(/id="term-label"/);
    expect(src).not.toMatch(/class="unit-pair"/);
  });

  it('one read-only text input #contractTerm with its label "Contract term" and a hint element; no aria-live', () => {
    const src = html();
    const inputs = [...src.matchAll(/<input\b[^>]*>/g)].map((m) => attrsOf(m[0]));
    const term = inputs.filter((a) => a.get('id') === 'contractTerm');
    expect(term).toHaveLength(1);
    const a = term[0]!;
    expect(a.has('readonly')).toBe(true);
    expect(a.get('type')).toBe('text');
    expect(a.get('aria-describedby')).toBe('contractTerm-hint');
    expect(a.has('aria-live')).toBe(false);
    expect(src).toContain('<label for="contractTerm" id="contractTerm-label">Contract term</label>'); // B32 (DEC-B32-TERM): label id (R6)
    expect(src).toMatch(/<span class="hint" id="contractTerm-hint">[^<]*<\/span>/);
    // it never carries a value of its own in the markup (the page fills it after a calculation)
    expect(a.get('value') ?? '').toBe('');
  });

  it('#contractTerm is placed directly after the End date field (after #endDate, before the flow fieldsets)', () => {
    const src = html();
    const end = src.indexOf('id="endDate"');
    const term = src.indexOf('id="contractTerm"');
    const nextFieldset = src.indexOf('<fieldset class="conditional" id="newFlowFields"');
    expect(end).toBeGreaterThan(0);
    expect(term).toBeGreaterThan(end);
    expect(term).toBeLessThan(nextFieldset);
    // nothing but the End date field's own markup and the field wrapper between them: no other input in between
    expect(src.slice(end, src.lastIndexOf('<input', term)).match(/<input\b/g) ?? []).toHaveLength(0);
  });

  it('the End date field stays (End Date is mandatory)', () => {
    expect(html()).toMatch(/<input type="date" id="endDate"/);
  });
});

describe('B24-T6 ui/ca.js (static)', () => {
  it('no termYears / termMonths token remains (readForm, renderContractTerms, plural use)', () => {
    const src = code('ui/ca.js');
    expect(src).not.toMatch(/\btermYears\b/);
    expect(src).not.toMatch(/\btermMonths\b/);
  });

  // B34 (DEC-B34-TERM): re-baselined; the page imports contractTermOptions (B34-R5) instead of contractTerm.
  it('imports contractTermOptions from the barrel /dist/ca/index.js only (F2)', () => {
    const src = code('ui/ca.js');
    const imports = [...src.matchAll(/import\s*\{([^}]*)\}\s*from\s*'([^']+)'/g)];
    const fromBarrel = imports.filter((m) => m[2] === '/dist/ca/index.js').flatMap((m) => m[1]!.split(',').map((x) => x.trim()));
    expect(fromBarrel).toContain('contractTermOptions');
    for (const m of imports) expect(['/dist/ca/index.js', '/ui/ca-view.js', './ca-view.js']).toContain(m[2]);
  });

  // B34 (DEC-B34-TERM): re-baselined; the text is the picked rule's value, contractTermChoice(contractTermOptions(input, result), pick).text (B34-R5).
  it('fills the field after a successful calculation: contractTermChoice(contractTermOptions(input, result), ...) is written to a #contractTerm element', () => {
    const src = code('ui/ca.js');
    expect(src).toMatch(/getElementById\('contractTerm'\)/);
    // the text is built from contractTermOptions(input, result) by contractTermChoice, and written to the field (directly or through a variable)
    // B32 (DEC-B32-TERM): two-argument call (B32-R1, R6); was contractTerm(result). B34: contractTermOptions (was contractTermText(contractTerm(...))).
    expect(src).toMatch(/contractTermChoice\(\s*contractTermOptions\(\s*input\s*,\s*result\s*\)\s*,/);
    expect(src).toMatch(/\b\w*[cC]ontractTerm\w*\.value\s*=\s*[^'";\s]/);
  });

  it('clears the field in the catch branch of recompute (a failed calculation leaves no stale value)', () => {
    const src = code('ui/ca.js');
    const at = src.indexOf('function recompute()');
    const tail = src.slice(at);
    const catchAt = tail.indexOf('} catch');
    expect(catchAt).toBeGreaterThan(0);
    const catchBody = tail.slice(catchAt, tail.indexOf('\n}\n', catchAt));
    expect(catchBody).toMatch(/\b\w*[cC]ontractTerm\w*\.value\s*=\s*(''|"")/);
    // and the success branch (before the catch) sets it. B34 (DEC-B34-TERM): from contractTermChoice (was contractTermText).
    expect(tail.slice(0, catchAt)).toMatch(/contractTermChoice\(/);
  });

  it('passes the same text to printInputRows (a required third argument) and to renderContractTerms', () => {
    const src = code('ui/ca.js');
    expect(src).toMatch(/printInputRows\(\s*raw\s*,\s*ctx\s*,\s*[^)\s][^)]*\)/);
    // renderContractTerms(...) now takes the text too: at least 4 top-level arguments (it had 3: input, contractDate, ctx)
    const call = /renderContractTerms\(([^;]*)\);/.exec(src.slice(src.indexOf('function recompute')))?.[1] ?? '';
    let depth = 0;
    let args = call.trim() === '' ? 0 : 1;
    for (const ch of call) {
      if (ch === '(' || ch === '[' || ch === '{') depth++;
      else if (ch === ')' || ch === ']' || ch === '}') depth--;
      else if (ch === ',' && depth === 0) args++;
    }
    expect(args).toBeGreaterThanOrEqual(4);
  });

  it('refreshes the field hint with the flow labels (contractTermHint is called)', () => {
    expect(code('ui/ca.js')).toMatch(/contractTermHint\(/);
  });

  it('plural moved out of ca.js: it is no longer defined there, and ca-view.js defines it without exporting it', () => {
    expect(code('ui/ca.js')).not.toMatch(/\bfunction\s+plural\b/);
    expect(code('ui/ca-view.js')).toMatch(/\bfunction\s+plural\b|\bconst\s+plural\b/);
    expect(code('ui/ca-view.js')).not.toMatch(/export\s+(function|const)\s+plural\b/);
  });

  it('every use of the nodes that a switch or the removal can take away is null-safe (risk 6 and 7 of the brief)', () => {
    const src = code('ui/ca.js');
    for (const name of ['contractDateEl', 'semiAnnualCompoundingDateEl', 'contractTermsDateEl']) {
      const lines = src.split('\n');
      const guard = new RegExp(`\\b${name}\\s*&&|\\bif\\s*\\(\\s*${name}\\b|\\b${name}\\s*\\?\\s`);
      const bad = lines.flatMap((line, i) => {
        if (!new RegExp(`\\b${name}\\.`).test(line)) return [];
        // guarded on this line or by an `if (name)` / `name &&` in the three lines above it
        const near = lines.slice(Math.max(0, i - 3), i + 1).some((l) => guard.test(l));
        return near ? [] : [`${i + 1}: ${line.trim()}`];
      });
      expect(bad, name).toEqual([]);
    }
  });

  // B32 (DEC-B32-TERM): the tile label comes from texts.contractTerm (per flow); ca.js holds no 'Contract term' literal (B32-R6).
  // B34 (DEC-B34-TERM): re-baselined; the tile takes the choice's parts (B34-R5 termParts), no longer contractTermParts.
  it('the tile takes its label from texts.contractTerm and the picked rule\'s parts with a non-breaking space in each part', () => {
    const src = code('ui/ca.js');
    expect(src).toMatch(/\[\s*texts\.contractTerm\s*,\s*termParts\.map\(noBreak\)/);
    expect(src).not.toMatch(/contractTermParts\(/);
    expect(src).toMatch(/\\u00a0|&nbsp;/);
  });

  it('the page still passes ctx.switches from UI_SWITCHES (the shipped values) to every view function', () => {
    expect(code('ui/ca.js')).toMatch(/switches:\s*UI_SWITCHES/);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// T7 part A: the Contract date field behind UI_SWITCHES.contractDateField
// ---------------------------------------------------------------------------------------------------------------
describe('B24-T7 part A: UI_SWITCHES.contractDateField (shipped off)', () => {
  it('value pin: shipped false, in the frozen object; the decision JSDoc names the ADR-14 pattern', async () => {
    const v = await loadView();
    expect(v.UI_SWITCHES.contractDateField).toBe(false);
    expect(Object.isFrozen(v.UI_SWITCHES)).toBe(true);
    expect(Object.keys(v.UI_SWITCHES).sort()).toEqual(['acceleratedFrequencies', 'contractDateField', 'financedOption', 'variableRatePaymentChangeFlow']);
    expect(readFileSync(`${ROOT}/ui/ca-view.js`, 'utf8')).toContain('contractDateField');
  });

  it.each(BOTH_CONTRACT_DATE)('%s: switchedOut(ctx, "contractDateField") follows the switch', async (_l, sw) => {
    const v = await loadView();
    const raw = rawOf('REF-01');
    expect(v.switchedOut(ctxOf(raw, sw), 'contractDateField')).toBe(!sw.contractDateField);
  });

  it.each(BOTH_CONTRACT_DATE)('%s: the print record has a "Contract date" row first iff the switch is on, with today\'s text', async (_l, sw) => {
    const v = await loadView();
    const raw = { ...rawOf('REF-01'), contractDate: '2026-03-10' };
    const rows = v.printInputRows(raw, ctxOf(raw, sw), '2 years, 11 months, 17 days');
    expect(rows.some(([k]) => k === 'Contract date')).toBe(sw.contractDateField);
    if (sw.contractDateField) expect(rows[0]).toEqual(['Contract date', 'Mar 10, 2026']);
    else expect(rows[0]![0]).toBe('Use case');
  });

  it('the switch off removes exactly one row from the on-state print record, nothing else changes', async () => {
    const v = await loadView();
    const raw = { ...rawOf('RENEWAL'), contractDate: '2026-03-10' };
    const on = v.printInputRows(raw, ctxOf(raw, CONTRACT_DATE_ON), 'T');
    const off = v.printInputRows(raw, ctxOf(raw, CONTRACT_DATE_OFF), 'T');
    expect(on.filter(([k]) => k !== 'Contract date')).toEqual(off);
  });

  it('ca.html: the Contract date field carries data-switch="contractDateField" on its .field, so the existing loop removes it', () => {
    const src = html();
    expect(src).toMatch(/<div class="field"[^>]*\bdata-switch="contractDateField"[^>]*>\s*<label for="contractDate">Contract date<\/label>/);
  });

  it('ca.html: the tile heading reads "Contract terms" and the " — as of <date>" part sits in a data-switch span', () => {
    const h3 = /<h3 id="contractTerms-heading">([\s\S]*?)<\/h3>/.exec(html())?.[1] ?? '';
    expect(h3).toMatch(/^\s*Contract terms\s*<span\b[^>]*\bdata-switch="contractDateField"[^>]*>\s*— as of <span id="contractTermsDate"><\/span>\s*<\/span>\s*$/);
  });

  it('ca.js no longer sets the Contract date to today unguarded (the node may be gone)', () => {
    const src = code('ui/ca.js');
    expect(src).not.toMatch(/^\s*contractDateEl\.value\s*=\s*todayLocalIso\(\)/m);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// T8 part B: SEMI_ANNUAL_DATE_REQUIRED (engine switch, Q-SACD) and what the UI does with it
// ---------------------------------------------------------------------------------------------------------------
const PAIRS: [ProductType, RateType][] = [['mortgage', 'fixed'], ['mortgage', 'variable'], ['personalLoan', 'fixed'], ['personalLoan', 'variable']];
type Requires = (p: ProductType, r: RateType, required?: boolean) => boolean;
const requires = ca.requiresSemiAnnualDate as unknown as Requires;

describe('B24-T8 part B: the switch and the rule function', () => {
  it('value pin: SEMI_ANNUAL_DATE_REQUIRED ships false, is a plain literal (no type annotation), with JSDoc @decision Q-SACD and the ADR-14 sentence', async () => {
    const mod = (await import('../../src/ca/policies.js')) as Record<string, unknown>;
    expect(mod['SEMI_ANNUAL_DATE_REQUIRED']).toBe(SHIPPED_SEMI_REQUIRED);
    expect(mod['SEMI_ANNUAL_DATE_REQUIRED']).toBe(false);
    const src = readFileSync(`${ROOT}/src/ca/policies.ts`, 'utf8');
    expect(src).toMatch(/\/\*\*(?:(?!\*\/)[\s\S])*@decision\s+Q-SACD\b(?:(?!\*\/)[\s\S])*\*\/\s*export const SEMI_ANNUAL_DATE_REQUIRED\s*=\s*false;/);
    expect(src).toMatch(/Switch \(ADR-14\): shipped `false`; the other branch `true` is built and tested\./);
  });

  it.each(PAIRS)('requiresSemiAnnualDate(%s, %s): shipped default is false, passing true gives the old rule, passing false gives false', (p, r) => {
    const fixedMortgage = p === 'mortgage' && r === 'fixed';
    expect(requires(p, r)).toBe(SHIPPED_SEMI_REQUIRED && fixedMortgage); // false for every pair
    expect(requires(p, r)).toBe(false);
    expect(requires(p, r, true)).toBe(fixedMortgage);
    expect(requires(p, r, false)).toBe(false);
  });

  it('root and CA barrels export the same requiresSemiAnnualDate (the third parameter is additive)', async () => {
    const root = await import('../../src/index.js');
    expect(root.requiresSemiAnnualDate).toBe(ca.requiresSemiAnnualDate);
  });
});

describe('B24-T8 part B: validation in both states (a present-but-invalid date is rejected in either; only "absent" changes)', () => {
  const base = (over: Record<string, unknown> = {}) => asInput({
    flow: 'newMortgageOrLoan', productType: 'mortgage', rateType: 'fixed', loanAmount: 250000, contractRatePercent: 5.19,
    paymentAmount: 1300, paymentFrequency: 'monthly', fees: { fees: [] }, disbursalDate: d('2027-01-01'),
    firstPaymentDate: d('2027-02-01'), endDate: d('2028-02-01'), ...over,
  });
  const BAD: [string, unknown][] = [['Invalid Date', new Date(NaN)], ['ISO string', '2027-01-01'], ['null', null], ['object with getTime', { getTime: () => 0 }], ['epoch number', 0]];

  it.each(BOTH_SEMI.flatMap(([l, on]) => BAD.map(([n, v]) => [l, on, n, v] as const)))('%s: %s present and invalid -> RangeError "semiAnnualCompoundingDate must be a valid Date"', async (_l, required, _n, value) => {
    const api = await loadValidate(required);
    expect(() => api.validateCobCanadaInput(base({ semiAnnualCompoundingDate: value }))).toThrow(new RangeError('semiAnnualCompoundingDate must be a valid Date'));
    expect(api.collectInputIssues(base({ semiAnnualCompoundingDate: value }))).toEqual([{ field: 'semiAnnualCompoundingDate', message: 'semiAnnualCompoundingDate must be a valid Date' }]);
  });

  it.each(BOTH_SEMI)('%s: a valid date is accepted', async (_l, required) => {
    const api = await loadValidate(required);
    expect(() => api.validateCobCanadaInput(base({ semiAnnualCompoundingDate: d('2027-01-01') }))).not.toThrow();
    expect(api.collectInputIssues(base({ semiAnnualCompoundingDate: d('2027-01-01') }))).toEqual([]);
  });

  it.each(BOTH_SEMI)('%s: a variable mortgage and a personal loan never need the date and ignore an invalid one', async (_l, required) => {
    const api = await loadValidate(required);
    for (const over of [{ rateType: 'variable' }, { productType: 'personalLoan', rateType: 'variable' }, { productType: 'personalLoan', rateType: 'fixed' }]) {
      expect(api.collectInputIssues(base(over)), JSON.stringify(over)).toEqual([]);
      expect(api.collectInputIssues(base({ ...over, semiAnnualCompoundingDate: new Date(NaN) })), JSON.stringify(over)).toEqual([]);
    }
  });

  it.each(BOTH_SEMI)('%s: the start-date check still comes before the semi-annual check (check order unchanged)', async (_l, required) => {
    const api = await loadValidate(required);
    const x = base({ disbursalDate: undefined });
    const issues = api.collectInputIssues(x);
    expect(issues[0]).toEqual({ field: 'disbursalDate', message: "flow 'newMortgageOrLoan' requires disbursalDate" });
    expect(issues.some((i) => i.field === 'semiAnnualCompoundingDate')).toBe(required);
  });

  it('switch off: an absent date is accepted and the result is identical to the same input WITH a date (the engine never reads it)', async () => {
    const api = await loadValidate(false);
    const without = api.calculateCobCanada(base());
    const withDate = api.calculateCobCanada(base({ semiAnnualCompoundingDate: d('2026-12-15') }));
    expect(JSON.stringify(without)).toBe(JSON.stringify(withDate));
  });

  it('switch on: an absent date is rejected with the existing message, and with a date the result is the same as off', async () => {
    const on = await loadValidate(true);
    expect(() => on.calculateCobCanada(base())).toThrow(/requires semiAnnualCompoundingDate/);
    const off = await loadValidate(false);
    expect(JSON.stringify(on.calculateCobCanada(base({ semiAnnualCompoundingDate: d('2026-12-15') })))).toBe(
      JSON.stringify(off.calculateCobCanada(base({ semiAnnualCompoundingDate: d('2026-12-15') }))),
    );
  });
});

describe('B24-T8 part B: the UI follows requiresSemiAnnualDate(...) (hidden / not sent / not printed when off)', () => {
  it.each([true, false])('ctx.semiAnnual = %s: the print record has the "Semi-annual compounding reference date" row last iff true', async (semi) => {
    const v = await loadView();
    const raw = { ...rawOf('REF-01'), semiAnnualCompoundingDate: '2026-03-17' };
    const rows = v.printInputRows(raw, ctxOf(raw, OFF, semi), 'T');
    const row = rows.find(([k]) => k === 'Semi-annual compounding reference date');
    expect(row !== undefined).toBe(semi);
    if (semi) expect(row).toEqual(['Semi-annual compounding reference date', 'Mar 17, 2026']);
    if (semi) expect(rows[rows.length - 1]).toEqual(row);
  });

  it('the shipped page state: requiresSemiAnnualDate is false for every captured scenario, so none of them sends or prints the date', async () => {
    const v = await loadView();
    for (const s of CAPTURE.scenarios) {
      const raw = s.raw;
      const ctx = ctxOf(raw);
      expect(ctx.semiAnnual, s.id).toBe(false);
      expect(v.printInputRows(raw, ctx, 'T').some(([k]) => k === 'Semi-annual compounding reference date'), s.id).toBe(false);
    }
  });

  it('ca.js hides the fieldset from requiresSemiAnnualDate (display none when false)', () => {
    expect(code('ui/ca.js')).toMatch(/semiAnnualFieldEl\.style\.display\s*=\s*requiresSemiAnnualDate\(/);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// T9 the three Chrome scripts
// ---------------------------------------------------------------------------------------------------------------
describe('B24-T9 the Chrome scripts no longer fill or read the removed / hidden fields', () => {
  const SCRIPTS = ['tests/ca/fixtures/capture_a10_ui.mjs', 'tests/ui/check_print_width.mjs', 'tests/ui/check_page_smoke.mjs'];
  const OLD = /\b(termYears|termMonths|contractDate|semiAnnualCompoundingDate)\s*:/; // a key of a fill list or a raw list
  it.each(SCRIPTS)('%s: no fill-list key for #termYears, #termMonths, #contractDate, #semiAnnualCompoundingDate', (file) => {
    const src = stripComments(readFileSync(`${ROOT}/${file}`, 'utf8'));
    const hits = src.split('\n').flatMap((l, i) => (OLD.test(l) ? [`${i + 1}: ${l.trim()}`] : []));
    expect(hits).toEqual([]);
  });
  it('capture_a10_ui.mjs: RAW_IDS holds none of the four and the script records contractTermField and termHint', () => {
    const src = readFileSync(`${ROOT}/tests/ca/fixtures/capture_a10_ui.mjs`, 'utf8');
    const raw = /const RAW_IDS = \[([^\]]*)\]/.exec(src)?.[1] ?? '';
    for (const id of ['termYears', 'termMonths', 'contractDate', 'semiAnnualCompoundingDate']) expect(raw).not.toContain(`'${id}'`);
    expect(src).toContain('contractTermField');
    expect(src).toContain('termHint');
    expect(src).toContain('#contractTerm');
  });
  it('check_page_smoke.mjs asserts the Contract term shows after a calculation and is blank after a failed one', () => {
    const src = readFileSync(`${ROOT}/tests/ui/check_page_smoke.mjs`, 'utf8');
    expect(src).toContain('contractTerm');
    expect(src).toContain('2 years, 11 months, 23 days'); // B32 (DEC-B32-TERM): REF-01 from the Disbursal date (was 17 days)
  });
});
