/**
 * B34 view and static half (COB-architecture.md section 5 B34-R3..R8, revision 53; user decision DEC-B34-TERM and the
 * answers to Q-B34-ZERO / KEEP / ORDER / TEXT, 2026-10-06, COB-user-stories.md section 7.5). QA red step, 2026-10-06.
 *
 * The page shows the Contract term in whole years and months only (zero parts left out; a zero term reads "0 months").
 * When the two rounded values differ, a radio group "Term based on" offers "Start date to end date: {term}" (first,
 * pre-selected on a fresh page) and "Start date to final payment: {term}"; the field, the tile and the printout show the
 * picked rule's value. The pick is a rule: recalculation never changes it (Q-B34-KEEP); only a page load does.
 * Hint: "From the {start date}; part months count as a full month." (interim, Q-MSG).
 *
 *   T8  B34-INV-PARTS    contractTermMonthsParts (brief rows + B34-BV-75 / 76).
 *   T9  B34-INV-CHOICE   contractTermChoice: pick robustness, order, labels, equality by months; INV-KEEP pure part.
 *   T10 B34-INV-HINT     contractTermHint per flow.
 *   T11 B34-INV-STATIC   ca.html fieldset / radios / CSS; ca.js wiring; ca-view.js keeps the Y/M/D helpers.
 *   T12 B34-INV-VECTORS  view part, over every row of b34_term_vectors.json.
 *   T13 capture          a10_ui_capture_v1.json: termHint, contractTermField, the new contractTermChoice key, print row and
 *                        tile (red until QA regenerates the capture after sr-dev's step, with the user's approval of R8b).
 *
 * Expected strings are literals typed from the decision and the brief (or the fixture typed from them), never imported
 * from the view. Not time-zone sensitive. sr-dev must not edit these assertions or the fixture.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FLOWS, calculateCobCanada, requiresSemiAnnualDate } from '../../src/ca/index.js';
import * as ca from '../../src/ca/index.js';
import type { CobFlow, ProductType, RateType } from '../../src/ca/index.js';
import type * as View from '../../ui/ca-view.js';
import { ROOT, stripComments } from '../architecture/support.js';
import { loadFixture } from './support/fixtures.js';
import { CONTRACT_DATE_OFF } from './support/uiSwitches.js';
import type { Months } from './support/termMonthsOracle.js';

const loadView = () => import('../../ui/ca-view.js') as Promise<typeof View>;
const FLOW_IDS: CobFlow[] = ['newMortgageOrLoan', 'renewal', 'paymentChange', 'variableRatePaymentChange'];
const M = (years: number, months: number): Months => ({ years, months });
type Options = { lastPayment: Months; endDate: Months };
const O = (lastPayment: Months, endDate: Months): Options => ({ lastPayment, endDate });

// B34-R3 / Q-B34-TEXT (user, 2026-10-06), typed from the decision.
const END_LABEL = (t: string): string => `Start date to end date: ${t}`;
const LAST_LABEL = (t: string): string => `Start date to final payment: ${t}`;
const LEGEND = 'Term based on';
const WANT_HINT: Record<CobFlow, string> = {
  newMortgageOrLoan: 'From the disbursal date; part months count as a full month.',
  renewal: 'From the renewal date; part months count as a full month.',
  paymentChange: 'From the date of change; part months count as a full month.',
  variableRatePaymentChange: 'From the date of change; part months count as a full month.',
};
const WANT_LABEL: Record<CobFlow, string> = {
  newMortgageOrLoan: 'Contract term', renewal: 'Remaining contract term', paymentChange: 'Remaining contract term', variableRatePaymentChange: 'Contract term',
};

// ---------------------------------------------------------------------------------------------------------------
// T8 parts
// ---------------------------------------------------------------------------------------------------------------
describe('B34-T8 INV-PARTS: contractTermMonthsParts (zero parts left out; singular only for 1; Q-B34-ZERO)', () => {
  const ROWS: [Months, string[]][] = [
    // B34-INV-PARTS (brief)
    [M(3, 0), ['3 years']],
    [M(2, 6), ['2 years', '6 months']],
    [M(1, 1), ['1 year', '1 month']],
    [M(0, 1), ['1 month']],
    [M(0, 0), ['0 months']],
    [M(0, 11), ['11 months']],
    [M(1, 0), ['1 year']],
    // B34-BV-75 (BA) extra rows
    [M(0, 2), ['2 months']],
    [M(1, 2), ['1 year', '2 months']],
    [M(2, 1), ['2 years', '1 month']],
    [M(30, 0), ['30 years']],
    [M(30, 1), ['30 years', '1 month']],
    [M(2, 11), ['2 years', '11 months']],
  ];

  it.each(ROWS.map(([t, want]) => [`{${t.years}, ${t.months}}`, t, want] as const))('%s', async (_n, t, want) => {
    const v = await loadView();
    expect(v.contractTermMonthsParts(t)).toStrictEqual(want);
  });

  it('never "0 years", a "0 months" beside years, "1 years", "1 months", or a "day" (sweep 0..40 years x 0..11 months)', async () => {
    const v = await loadView();
    const bad: string[] = [];
    for (let y = 0; y <= 40; y += 1) {
      for (let m = 0; m <= 11; m += 1) {
        const p = v.contractTermMonthsParts(M(y, m));
        const s = p.join(', ');
        if (/\b0 years?\b/.test(s) || /\b1 years\b|\b1 months\b/.test(s) || /day/.test(s) || (y > 0 && /\b0 months\b/.test(s))) bad.push(`${y},${m}: ${s}`);
        if (p.length !== (y > 0 && m > 0 ? 2 : 1)) bad.push(`${y},${m}: ${p.length} parts`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('does not mutate its argument; returns a new array each call', async () => {
    const v = await loadView();
    const t = Object.freeze(M(2, 6));
    const a = v.contractTermMonthsParts(t);
    expect(v.contractTermMonthsParts(t)).not.toBe(a);
    expect(t).toEqual(M(2, 6));
  });

  it('the Y/M/D helpers stay exported and unchanged (B34-D2: showing days again stays a small UI change)', async () => {
    const v = await loadView();
    expect(v.contractTermParts({ years: 2, months: 11, days: 17 })).toEqual(['2 years', '11 months', '17 days']);
    expect(v.contractTermText({ years: 0, months: 0, days: 20 })).toBe('0 years, 0 months, 20 days');
  });
});

// ---------------------------------------------------------------------------------------------------------------
// T9 choice
// ---------------------------------------------------------------------------------------------------------------
describe('B34-T9 INV-CHOICE and INV-KEEP (pure part): contractTermChoice(options, selected)', () => {
  const DIFF = O(M(2, 11), M(3, 0)); // PL_WEEKLY
  const PL_WEEKLY_CHOICES = [
    { value: 'endDate', label: 'Start date to end date: 3 years', checked: true },
    { value: 'lastPayment', label: 'Start date to final payment: 2 years, 11 months', checked: false },
  ];

  it.each([undefined, null, '', 'endDate', 'bogus', 'toString', '__proto__', 'LASTPAYMENT', 'lastPayment ', 'constructor', 'hasOwnProperty'])(
    'values differ, selected %j: the End date rule (basis endDate, text "3 years")', async (selected) => {
      const v = await loadView();
      const c = v.contractTermChoice(DIFF, selected as string | null | undefined);
      expect(c.basis).toBe('endDate');
      expect(c.text).toBe('3 years');
      expect(c.parts).toStrictEqual(['3 years']);
      expect(c.choices).toStrictEqual(PL_WEEKLY_CHOICES);
    });

  it('values differ, selected "lastPayment": basis lastPayment, text "2 years, 11 months"; same labels, checked false / true', async () => {
    const v = await loadView();
    const c = v.contractTermChoice(DIFF, 'lastPayment');
    expect(c.basis).toBe('lastPayment');
    expect(c.text).toBe('2 years, 11 months');
    expect(c.parts).toStrictEqual(['2 years', '11 months']);
    expect(c.choices).toStrictEqual([{ ...PL_WEEKLY_CHOICES[0], checked: false }, { ...PL_WEEKLY_CHOICES[1], checked: true }]);
  });

  it('exactly the four keys basis, parts, text, choices; text = parts joined with ", " (B34-BV-76)', async () => {
    const v = await loadView();
    for (const sel of ['endDate', 'lastPayment']) {
      const c = v.contractTermChoice(DIFF, sel);
      expect(Object.keys(c).sort()).toEqual(['basis', 'choices', 'parts', 'text']);
      expect(c.text).toBe(c.parts.join(', '));
      expect(c.choices!.filter((x) => x.checked)).toHaveLength(1);
      for (const x of c.choices!) expect(Object.keys(x)).toEqual(['value', 'label', 'checked']);
    }
  });

  it('order (Q-B34-ORDER): the End date option first, the final-payment option second, under either pick', async () => {
    const v = await loadView();
    for (const sel of [undefined, 'lastPayment']) expect(v.contractTermChoice(DIFF, sel).choices!.map((x) => x.value)).toEqual(['endDate', 'lastPayment']);
  });

  it('labels (Q-B34-TEXT): each label names its rule and carries that rule\'s value, never the other one (M24, M25)', async () => {
    const v = await loadView();
    const c = v.contractTermChoice(O(M(0, 6), M(3, 0)), undefined);
    expect(c.choices!.map((x) => x.label)).toEqual([END_LABEL('3 years'), LAST_LABEL('6 months')]);
    for (const x of c.choices!) expect(x.label).not.toMatch(/^To the |day/);
  });

  it('equal ({3,0}, {3,0}): no choice; the pick is reported as given (revision 53: not reset), text "3 years" under both', async () => {
    const v = await loadView();
    const eq = O(M(3, 0), M(3, 0));
    expect(v.contractTermChoice(eq, 'lastPayment')).toStrictEqual({ basis: 'lastPayment', parts: ['3 years'], text: '3 years', choices: null });
    expect(v.contractTermChoice(eq, undefined)).toStrictEqual({ basis: 'endDate', parts: ['3 years'], text: '3 years', choices: null });
    expect(v.contractTermChoice(eq, 'endDate')).toStrictEqual({ basis: 'endDate', parts: ['3 years'], text: '3 years', choices: null });
  });

  it('equality is by month count, not by object identity or Y/M/D (M9): ({1,0}, {0,12}) -> no choice; ({2,11}, {3,0}) -> choice', async () => {
    const v = await loadView();
    expect(v.contractTermChoice(O(M(1, 0), M(0, 12)), undefined).choices).toBeNull();
    expect(v.contractTermChoice(O(M(2, 11), M(3, 0)), undefined).choices).not.toBeNull();
    const same = M(2, 6);
    expect(v.contractTermChoice(O(same, M(2, 6)), undefined).choices).toBeNull(); // distinct objects, equal values
  });

  it('a zero option 1 (same-day start, B34-BV-65 / 61): "Start date to final payment: 0 months"; picked -> text "0 months"', async () => {
    const v = await loadView();
    const o = O(M(0, 0), M(0, 1));
    expect(v.contractTermChoice(o, undefined).choices!.map((x) => x.label)).toEqual([END_LABEL('1 month'), LAST_LABEL('0 months')]);
    expect(v.contractTermChoice(o, undefined).text).toBe('1 month');
    expect(v.contractTermChoice(o, 'lastPayment').text).toBe('0 months');
  });

  it('does not mutate the options (deep-frozen input accepted)', async () => {
    const v = await loadView();
    const o = Object.freeze({ lastPayment: Object.freeze(M(2, 11)), endDate: Object.freeze(M(3, 0)) });
    expect(() => v.contractTermChoice(o, 'lastPayment')).not.toThrow();
    expect(o).toEqual(DIFF);
  });

  // B34-INV-KEEP (pure part): for every vector row and both picks, basis === pick whether or not the values agree.
  interface Row { id: string; lastPayment: Months; endDate: Months; choice: boolean }
  const FIX = loadFixture<{ vectors: Row[]; boundaries: Row[] }>('b34_term_vectors.json');
  const ROWS = [...FIX.vectors, ...FIX.boundaries];

  it('INV-KEEP: for every fixture row (91) and both picks, basis is the pick as given, also when the values agree', async () => {
    const v = await loadView();
    const bad: string[] = [];
    for (const r of ROWS) {
      for (const pick of ['endDate', 'lastPayment'] as const) {
        const c = v.contractTermChoice({ lastPayment: r.lastPayment, endDate: r.endDate }, pick);
        if (c.basis !== pick) bad.push(`${r.id} ${pick} -> ${c.basis}`);
        if (c.choices !== null && c.choices.find((x) => x.checked)!.value !== pick) bad.push(`${r.id} ${pick}: checked radio`);
      }
    }
    expect(ROWS).toHaveLength(91);
    expect(ROWS.filter((r) => !r.choice).length).toBeGreaterThan(40);
    expect(bad).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// T10 hint
// ---------------------------------------------------------------------------------------------------------------
describe('B34-T10 INV-HINT: contractTermHint(start date label, lower-cased)', () => {
  it.each(FLOW_IDS)('%s', async (flow) => {
    const v = await loadView();
    expect(v.contractTermHint(v.flowLabels(flow, FLOWS[flow]).startDate.toLowerCase())).toBe(WANT_HINT[flow]);
  });

  it('built from the label passed in; names no end point (it depends on the choice)', async () => {
    const v = await loadView();
    expect(v.contractTermHint('some label')).toBe('From the some label; part months count as a full month.');
    expect(v.contractTermHint('x')).not.toMatch(/last scheduled payment|end date|final payment/i);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// T11 static page
// ---------------------------------------------------------------------------------------------------------------
describe('B34-T11 INV-STATIC: ca.html, ca.js, ca-view.js', () => {
  const html = readFileSync(`${ROOT}/ui/ca.html`, 'utf8');
  const js = stripComments(readFileSync(`${ROOT}/ui/ca.js`, 'utf8'));
  const view = stripComments(readFileSync(`${ROOT}/ui/ca-view.js`, 'utf8'));
  const count = (s: string, sub: string): number => s.split(sub).length - 1;
  const fieldsetStart = html.indexOf('<fieldset class="choice-group term-choice" id="contractTermChoice"');
  const fieldset = fieldsetStart < 0 ? '' : html.slice(fieldsetStart, html.indexOf('</fieldset>', fieldsetStart) + '</fieldset>'.length);
  const inputs = [...fieldset.matchAll(/<input\b[^>]*>/g)].map((m) => m[0]);
  const attr = (tag: string, name: string): string | null => {
    const m = tag.match(new RegExp(`\\s${name}(?:="([^"]*)")?(?=[\\s/>])`));
    return m ? (m[1] ?? '') : null;
  };

  it('ca.html: the R4 fieldset exactly once: class "choice-group term-choice", aria-describedby the shared hint, hidden', () => {
    expect(count(html, 'id="contractTermChoice"')).toBe(1);
    expect(fieldset).not.toBe('');
    const open = fieldset.slice(0, fieldset.indexOf('>') + 1);
    expect(open).toBe('<fieldset class="choice-group term-choice" id="contractTermChoice" aria-describedby="contractTerm-hint" hidden>');
  });

  it('ca.html: inside the Contract term .field, directly after #contractTerm-hint and before the field closes', () => {
    const hintEnd = html.indexOf('<span class="hint" id="contractTerm-hint"></span>') + '<span class="hint" id="contractTerm-hint"></span>'.length;
    expect(hintEnd).toBeGreaterThan(100);
    expect(html.slice(hintEnd, fieldsetStart).trim()).toBe('');
    const fieldOpen = html.lastIndexOf('<div class="field">', fieldsetStart);
    expect(html.slice(fieldOpen, fieldsetStart)).toContain('id="contractTerm-label"');
    expect(html.slice(fieldsetStart + fieldset.length).trimStart().startsWith('</div>')).toBe(true);
  });

  it('ca.html: legend exactly "Term based on" (class choice-legend)', () => {
    expect(fieldset).toContain(`<legend class="choice-legend">${LEGEND}</legend>`);
    expect(count(fieldset, '<legend')).toBe(1);
  });

  it('ca.html: two radios named contractTermBasis, values endDate then lastPayment; only endDate checked; both autocomplete="off" (M15, M20, M21)', () => {
    expect(inputs).toHaveLength(2);
    expect(inputs.map((t) => attr(t, 'type'))).toEqual(['radio', 'radio']);
    expect(inputs.map((t) => attr(t, 'name'))).toEqual(['contractTermBasis', 'contractTermBasis']);
    expect(inputs.map((t) => attr(t, 'value'))).toEqual(['endDate', 'lastPayment']);
    expect(inputs.map((t) => attr(t, 'id'))).toEqual(['contractTermBasis-endDate', 'contractTermBasis-lastPayment']);
    expect(inputs.map((t) => attr(t, 'checked') !== null)).toEqual([true, false]);
    expect(inputs.map((t) => attr(t, 'autocomplete'))).toEqual(['off', 'off']);
    expect(count(html, 'name="contractTermBasis"')).toBe(2);
  });

  it('ca.html: each radio sits in a label.choice for it, with an empty span for its text (labels come from the view)', () => {
    for (const v of ['endDate', 'lastPayment']) {
      expect(fieldset).toMatch(new RegExp(`<label for="contractTermBasis-${v}" class="choice">\\s*<input [^>]*id="contractTermBasis-${v}"[^>]*>\\s*<span class="choice-label" id="contractTermBasis-${v}-text"></span>\\s*</label>`));
    }
    expect(html).not.toContain('Start date to end date');
    expect(html).not.toContain('Start date to final payment');
  });

  it('ca.html: the four R4 CSS rules, inside @media screen (after the column-toggle rules)', () => {
    const screenAt = html.indexOf('.column-toggle .choice-options { flex-direction: row; }');
    expect(screenAt).toBeGreaterThan(0);
    const after = html.slice(screenAt);
    const mediaOpen = html.lastIndexOf('@media screen', screenAt);
    expect(mediaOpen).toBeGreaterThan(0);
    for (const rule of [
      '#contractTermChoice[hidden] { display: none; }',
      '.term-choice { margin-top: 8px; }',
      '.term-choice .choice-options { flex-direction: column; gap: 4px; }',
      '.field .term-choice .choice { display: inline-flex; margin-bottom: 0; font-weight: 400; }',
    ]) {
      expect(count(html, rule), rule).toBe(1);
      expect(after.indexOf(rule), rule).toBeGreaterThan(0);
    }
  });

  it('ca.js imports contractTermOptions from the engine and contractTermChoice from the view; no contractTermText / contractTermParts', () => {
    const engineImport = js.match(/import\s*\{([^}]*)\}\s*from\s*'\/dist\/ca\/index\.js'/)?.[1] ?? '';
    const viewImport = js.match(/import\s*\{([^}]*)\}\s*from\s*'\.\/ca-view\.js'/)?.[1] ?? '';
    expect(engineImport.split(',').map((x) => x.trim())).toContain('contractTermOptions');
    expect(engineImport.split(',').map((x) => x.trim())).not.toContain('contractTerm');
    expect(viewImport.split(',').map((x) => x.trim())).toContain('contractTermChoice');
    expect(viewImport).not.toMatch(/\bcontractTermText\b|\bcontractTermParts\b/);
  });

  it('ca.js: contractTermOptions(input, result) once, fed with the pick read from the form every time (M23), no contractTerm( call', () => {
    expect(count(js, 'contractTermOptions(input, result)')).toBe(1);
    expect(js).toMatch(/contractTermChoice\(\s*contractTermOptions\(input, result\),\s*form\.elements\.contractTermBasis\.value\s*\)/);
    expect(js).not.toMatch(/\bcontractTerm\(/);
    expect(js).not.toMatch(/\bcontractTermText\(|\bcontractTermParts\(/);
  });

  it('ca.js: no option label literal ("Start date to end date" / "Start date to final payment" / "Term based on")', () => {
    for (const s of ['Start date to end date', 'Start date to final payment', LEGEND]) expect(js).not.toContain(s);
  });

  it('ca.js: renderTermChoice(choice) exists; hiding never touches the pick (no .checked = before its early return; M16); textContent, no innerHTML', () => {
    const at = js.indexOf('function renderTermChoice(');
    expect(at).toBeGreaterThan(0);
    const end = js.indexOf('\n}', at);
    const body = js.slice(at, end);
    const ret = body.indexOf('return;');
    expect(ret).toBeGreaterThan(0);
    expect(body.slice(0, ret)).not.toMatch(/\.checked\s*=/);
    expect(body.slice(0, ret)).toMatch(/contractTermChoiceEl\.hidden\s*=\s*true/);
    expect(body).not.toContain('innerHTML');
    expect(body).toMatch(/\.textContent\s*=/);
    expect(body).toMatch(/contractTermChoiceEl\.hidden\s*=\s*false/);
  });

  it('ca.js: the catch block hides the group with renderTermChoice(null) next to emptying the field (M19)', () => {
    const catchAt = js.indexOf('} catch (err) {', js.indexOf('function recompute('));
    expect(catchAt).toBeGreaterThan(0);
    const catchBody = js.slice(catchAt, js.indexOf('\n  }\n', catchAt));
    expect(catchBody).toContain('renderTermChoice(null)');
    expect(catchBody).toContain("contractTermEl.value = ''");
  });

  it('ca.js: the tile, the field and the print record take the same choice (no Y/M/D path left; M17, M18)', () => {
    expect(js).toMatch(/renderTermChoice\(choice\)/);
    expect(js).toMatch(/const termText = choice\.text;/);
    expect(js).toMatch(/renderContractTerms\(input, parseDateInput\(raw\.contractDate\), ctx, choice\.parts\)/);
    expect(js).toMatch(/termParts\.map\(noBreak\)\.join\(', '\)/);
  });

  it('ca.js: readForm does not read the radios (the term choice is not an engine input; CSV untouched)', () => {
    const at = js.indexOf('function readForm(');
    expect(at).toBeGreaterThan(0);
    expect(js.slice(at, js.indexOf('\n}', at))).not.toContain('contractTermBasis');
  });

  it('ca-view.js exports contractTermMonthsParts and contractTermChoice; label literals only there', () => {
    expect(view).toMatch(/export function contractTermMonthsParts\(term\)/);
    expect(view).toMatch(/export function contractTermChoice\(options, selected\)/);
    expect(view).toContain('Start date to end date: ');
    expect(view).toContain('Start date to final payment: ');
  });

  it('ca-view.d.ts (QA-owned, B34-R7) declares the new view API', () => {
    const dts = readFileSync(`${ROOT}/ui/ca-view.d.ts`, 'utf8');
    expect(dts).toContain('export interface ContractTermMonthsLike { years: number; months: number }');
    expect(dts).toContain('export function contractTermMonthsParts(term: ContractTermMonthsLike): [string] | [string, string];');
    expect(dts).toContain("export interface ContractTermChoiceOption { value: 'lastPayment' | 'endDate'; label: string; checked: boolean }");
    expect(dts).toMatch(/export function contractTermChoice\(\s*options: \{ lastPayment: ContractTermMonthsLike; endDate: ContractTermMonthsLike \},\s*selected: string \| null \| undefined,\s*\): ContractTermChoice;/);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// T12 vectors, view part
// ---------------------------------------------------------------------------------------------------------------
describe('B34-T12 INV-VECTORS (view): every fixture row through contractTermChoice', () => {
  interface Row { id: string; lastPayment: Months; endDate: Months; lastPaymentText: string; endDateText: string; choice: boolean }
  const FIX = loadFixture<{ vectors: Row[]; boundaries: Row[] }>('b34_term_vectors.json');
  const ROWS = [...FIX.vectors, ...FIX.boundaries];

  it.each(ROWS.map((r) => [r.id, r] as const))('%s', async (_id, r) => {
    const v = await loadView();
    const o = { lastPayment: r.lastPayment, endDate: r.endDate };
    const fresh = v.contractTermChoice(o, undefined);
    expect(fresh.text, 'fresh page: the End date rule').toBe(r.endDateText);
    expect(v.contractTermChoice(o, 'lastPayment').text, 'final payment picked').toBe(r.lastPaymentText);
    expect(fresh.choices === null, 'choice shown').toBe(!r.choice);
    if (r.choice) {
      expect(fresh.choices).toStrictEqual([
        { value: 'endDate', label: END_LABEL(r.endDateText), checked: true },
        { value: 'lastPayment', label: LAST_LABEL(r.lastPaymentText), checked: false },
      ]);
    } else {
      expect(r.lastPaymentText).toBe(r.endDateText);
    }
  });
});

// ---------------------------------------------------------------------------------------------------------------
// T13 the Chrome capture (red until the capture is regenerated after sr-dev's step, R8b approval)
// ---------------------------------------------------------------------------------------------------------------
interface CapScenario {
  id: string; raw: View.RawForm; contractTermField: string; contractTermChoice?: unknown; error: string | null;
  modes: Record<string, { html: Record<string, string>; csvFileName: string }>;
}
const CAP = loadFixture<{ flowScreens: Record<string, Record<string, string>>; scenarios: CapScenario[] }>('a10_ui_capture_v1.json');
const ctxOf = (raw: View.RawForm): View.ViewContext => ({
  spec: FLOWS[raw.flow as CobFlow],
  semiAnnual: requiresSemiAnnualDate(raw.productType as ProductType, raw.rateType as RateType),
  switches: CONTRACT_DATE_OFF,
});
type OptionsFn = (input: unknown, result: unknown) => Options;
const contractTermOptions: OptionsFn = (i, r) => ((ca as unknown as Record<string, OptionsFn>)['contractTermOptions']!)(i, r);

describe('B34-T13 capture a10_ui_capture_v1.json: what Chrome showed (R8b)', () => {
  // R8b, typed from the brief (field = the End date rule, since the capture never clicks the radios).
  const OK: [string, string, unknown][] = [
    ['REF-01', '3 years', null],
    ['S1_fees', '3 years', null],
    ['RENEWAL', '2 years, 6 months', null],
    ['VRPC_zero_accrued', '5 years', null],
    ['PL_WEEKLY', '3 years', [
      { value: 'endDate', label: 'Start date to end date: 3 years', checked: true },
      { value: 'lastPayment', label: 'Start date to final payment: 2 years, 11 months', checked: false },
    ]],
  ];

  it.each(FLOW_IDS)('%s: flowScreens termHint is the B34 hint', (flow) => {
    expect(CAP.flowScreens[flow]!['termHint']).toBe(WANT_HINT[flow]);
  });

  it('the successful scenarios are exactly these five; the error scenarios have no contractTermChoice key', () => {
    expect(CAP.scenarios.filter((s) => s.contractTermField !== '').map((s) => s.id)).toEqual(OK.map(([id]) => id));
    for (const s of CAP.scenarios.filter((x) => x.contractTermField === '')) expect(Object.keys(s), s.id).toEqual(['id', 'raw', 'contractTermField', 'error', 'modes']);
  });

  it.each(OK)('%s: contractTermField %j; contractTermChoice right after it, as R8b', (id, want, choice) => {
    const s = CAP.scenarios.find((x) => x.id === id)!;
    expect(s.contractTermField).toBe(want);
    expect(Object.keys(s)).toEqual(['id', 'raw', 'contractTermField', 'contractTermChoice', 'error', 'modes']);
    expect(s.contractTermChoice).toStrictEqual(choice);
  });

  it.each(OK)('%s: the capture equals contractTermChoice(contractTermOptions(toInput(raw, ctx), result), "endDate")', async (id) => {
    const v = await loadView();
    const s = CAP.scenarios.find((x) => x.id === id)!;
    const input = v.toInput(s.raw, ctxOf(s.raw));
    const c = v.contractTermChoice(contractTermOptions(input, calculateCobCanada(input)), 'endDate');
    expect(s.contractTermField).toBe(c.text);
    expect(s.contractTermChoice).toStrictEqual(c.choices);
  });

  it.each(OK)('%s: in both modes the print row and the tile carry exactly the field text (tile: U+00A0 inside each part; B34-BV-77)', (id, want) => {
    const s = CAP.scenarios.find((x) => x.id === id)!;
    const lbl = WANT_LABEL[s.raw.flow as CobFlow];
    const tile = want.replace(/(\d+) (year|month)/g, '$1&nbsp;$2'); // innerHTML serialises U+00A0 as &nbsp;
    expect(Object.keys(s.modes)).toEqual(['all', 'compact']);
    expect(want).not.toContain('\u00a0');
    for (const [mode, m] of Object.entries(s.modes)) {
      expect(m.html['printInputs'], `${mode} printInputs`).toContain(`<dt>${lbl}</dt><dd>${want}</dd>`);
      expect(m.html['contractTermsList'], `${mode} tile`).toContain(`<dt class="term-label">${lbl}</dt><dd class="term-data"><span class="term-value">${tile}</span></dd>`);
      expect(`${m.html['printInputs']}${m.html['contractTermsList']}`, `${mode}: no days, no radio text`).not.toMatch(/\d+(&nbsp;| )days?\b|Start date to|Term based on/);
    }
  });

  it('the CSV file names are unchanged by B34 (Q-B34-CSV): cost-of-borrowing-schedule-<first payment>.csv', () => {
    for (const s of CAP.scenarios.filter((x) => x.contractTermField !== '')) {
      for (const m of Object.values(s.modes)) expect(m.csvFileName).toBe(`cost-of-borrowing-schedule-${s.raw.firstPaymentDate}.csv`);
    }
  });
});
