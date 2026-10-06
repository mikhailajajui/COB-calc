/**
 * B25 UI step (COB-architecture.md section 5 B25-R6..R8, B25-T6 / T7; user decisions 2026-10-01). QA red tests.
 *
 * Decisions: when the semi-monthly first payment date is moved (typed date vs result.amortizationSchedule[0].date; no new result
 * field) a note is shown: 'First payment moved to Jan 15, 2027 (semi-monthly payments fall on the 15th and month-end)'; on the
 * "Next payment" flows the first words follow the flow label ('Next payment moved to ...'). Date format = formatInputDate
 * (with the year, Q-SEMI-DETAIL-4 default approved). Printed input rows and the Contract terms tile keep the typed date and show the
 * same note only when moved; the CSV file name uses the ISO date of the schedule's first row. Nothing changes when not moved
 * (B25-INV-capture). No UI switch.
 *
 * The browser half is tests/ui/check_semimonthly_move.mjs (F17, Chrome, not vitest).
 * Contract chosen by QA for the parts the brief leaves open (sr-dev: only these names are pinned):
 *   - view: export firstDateMoveNote(label, typedIso, firstRowDate); printInputRows(raw, ctx, termText, moveNote = '') puts ONE extra row
 *     [<any string>, moveNote] directly after the first-payment row when moveNote is non-empty, nothing extra otherwise.
 *   - ca.html: <p class="hint" id="firstDateNote" role="status" hidden> inside the First payment date field, after the input;
 *     <p id="contractTermsNote" hidden> inside section#contractTerms after the <dl id="contractTermsList">.
 *   - ca.js: sets both with textContent; the CSV name comes from isoDay(first schedule row date).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { calculateCobCanada, contractTerm, FLOWS, requiresSemiAnnualDate } from '../../src/ca/index.js';
import type { CobFlow, ProductType, RateType } from '../../src/ca/index.js';
import type * as View from '../../ui/ca-view.js';
import { ROOT, stripComments } from '../architecture/support.js';
import { utcDate as utc } from './support/builders.js';

const loadView = () => import('../../ui/ca-view.js') as Promise<typeof View>;
const html = readFileSync(`${ROOT}/ui/ca.html`, 'utf8');
const js = readFileSync(`${ROOT}/ui/ca.js`, 'utf8');
const viewSrc = readFileSync(`${ROOT}/ui/ca-view.js`, 'utf8');
const SHIPPED = Object.freeze({ financedOption: false, acceleratedFrequencies: false, contractDateField: false });

const NOTE_TAIL = '(semi-monthly payments fall on the 15th and month-end)';

const rawFor = (over: Partial<View.RawForm> = {}): View.RawForm => ({
  flow: 'newMortgageOrLoan', productType: 'mortgage', rateType: 'fixed',
  loanAmount: '100,000.00', contractRatePercent: '5', paymentAmount: '1,000.00', paymentFrequency: 'semiMonthly',
  firstPaymentDate: '2027-01-10', endDate: '2029-01-15', disbursalDate: '2027-01-01', renewalDate: '', accruedInterest: '',
  semiAnnualCompoundingDate: '2026-12-15', fees: [], ...over,
});
const ctxFor = (raw: View.RawForm): View.ViewContext => ({
  spec: FLOWS[raw.flow as CobFlow],
  semiAnnual: requiresSemiAnnualDate(raw.productType as ProductType, raw.rateType as RateType),
  switches: SHIPPED,
});
async function run(over: Partial<View.RawForm> = {}) {
  const v = await loadView();
  const raw = rawFor(over);
  const ctx = ctxFor(raw);
  const result = calculateCobCanada(v.toInput(raw, ctx));
  return { v, raw, ctx, result };
}

describe('B25-T6: firstDateMoveNote (pure view function)', () => {
  it('is exported and typed in the QA-owned ca-view.d.ts', async () => {
    const v = await loadView();
    expect(typeof v.firstDateMoveNote).toBe('function');
    expect(readFileSync(`${ROOT}/ui/ca-view.d.ts`, 'utf8')).toMatch(/export function firstDateMoveNote\(/);
  });

  it('moved date, First payment label: the exact user-approved sentence (date with the year)', async () => {
    const v = await loadView();
    expect(v.formatInputDate(utc('2027-01-15'))).toBe('Jan 15, 2027'); // the page's own format, year included
    expect(v.firstDateMoveNote('First payment date', '2027-01-10', utc('2027-01-15')))
      .toBe('First payment moved to Jan 15, 2027 (semi-monthly payments fall on the 15th and month-end)');
  });

  it('Next payment flows: the first words follow the label', async () => {
    const v = await loadView();
    expect(v.firstDateMoveNote('Next payment date', '2027-01-20', utc('2027-01-31')))
      .toBe('Next payment moved to Jan 31, 2027 (semi-monthly payments fall on the 15th and month-end)');
  });

  it('uses the label of every flow (label minus its trailing " date")', async () => {
    const v = await loadView();
    for (const flow of Object.keys(FLOWS) as CobFlow[]) {
      const lab = FLOWS[flow].firstPaymentDateLabel;
      const word = lab.replace(/ date$/, '');
      expect(v.firstDateMoveNote(lab, '2027-02-01', utc('2027-02-15'))).toBe(`${word} moved to ${v.formatInputDate(utc('2027-02-15'))} ${NOTE_TAIL}`);
    }
  });

  it('empty when the typed date equals the first row, or the row is missing', async () => {
    const v = await loadView();
    expect(v.firstDateMoveNote('First payment date', '2027-01-15', utc('2027-01-15'))).toBe('');
    expect(v.firstDateMoveNote('First payment date', '2027-01-31', utc('2027-01-31'))).toBe('');
    expect(v.firstDateMoveNote('First payment date', '2027-01-10', undefined)).toBe('');
  });

  it('month-end move (Feb 2027, typed the 20th -> the 28th) and a year roll (Dec 20 -> Dec 31; 2027-12-31 stays)', async () => {
    const v = await loadView();
    expect(v.firstDateMoveNote('First payment date', '2027-02-20', utc('2027-02-28'))).toBe(`First payment moved to Feb 28, 2027 ${NOTE_TAIL}`);
    expect(v.firstDateMoveNote('First payment date', '2027-12-20', utc('2027-12-31'))).toBe(`First payment moved to Dec 31, 2027 ${NOTE_TAIL}`);
  });

  // B32 (DEC-B32-TERM): the Contract term runs from the Disbursal date 2027-01-01, contractTerm(input, result) (was from the moved date).
  it('with the real engine: semi-monthly typed 2027-01-10 -> row 1 is Jan 15 and the note says so; Contract term runs from the disbursal date', async () => {
    const { v, raw, ctx, result } = await run();
    expect(v.isoDay(result.amortizationSchedule[0]!.date)).toBe('2027-01-15');
    expect(v.firstDateMoveNote(FLOWS[raw.flow as CobFlow].firstPaymentDateLabel, raw.firstPaymentDate, result.amortizationSchedule[0]!.date))
      .toBe(`First payment moved to Jan 15, 2027 ${NOTE_TAIL}`);
    const term2 = contractTerm as unknown as (i: unknown, r: unknown) => { years: number; months: number; days: number };
    expect(v.contractTermText(term2(v.toInput(raw, ctx), result))).toBe('2 years, 0 months, 14 days');
    expect(ctx.spec.firstPaymentDateLabel).toBe('First payment date');
  });

  it('with the real engine: typed on the 15th or month-end -> ""', async () => {
    for (const d of ['2027-01-15', '2027-01-31']) {
      const { v, raw, result } = await run({ firstPaymentDate: d });
      expect(v.firstDateMoveNote('First payment date', raw.firstPaymentDate, result.amortizationSchedule[0]!.date)).toBe('');
    }
  });

  it('with the real engine: weekly, biweekly and monthly with the same typed date -> "" (no move)', async () => {
    for (const f of ['weekly', 'biweekly', 'monthly']) {
      const { v, raw, result } = await run({ paymentFrequency: f, paymentAmount: '600.00' });
      expect(v.isoDay(result.amortizationSchedule[0]!.date), f).toBe('2027-01-10');
      expect(v.firstDateMoveNote('First payment date', raw.firstPaymentDate, result.amortizationSchedule[0]!.date), f).toBe('');
    }
  });

  it('with the real engine: Payment Change flow, semi-monthly, typed 2027-01-20 -> "Next payment moved to Jan 31, 2027 ..."', async () => {
    const { v, raw, result } = await run({
      flow: 'paymentChange', renewalDate: '2027-01-01', disbursalDate: '', firstPaymentDate: '2027-01-20', accruedInterest: '0',
    });
    expect(v.isoDay(result.amortizationSchedule[0]!.date)).toBe('2027-01-31');
    expect(v.firstDateMoveNote(FLOWS.paymentChange.firstPaymentDateLabel, raw.firstPaymentDate, result.amortizationSchedule[0]!.date))
      .toBe(`Next payment moved to Jan 31, 2027 ${NOTE_TAIL}`);
  });

  it('is pure: it does not mutate its Date argument', async () => {
    const v = await loadView();
    const d = utc('2027-01-15');
    v.firstDateMoveNote('First payment date', '2027-01-10', d);
    expect(d.toISOString()).toBe('2027-01-15T00:00:00.000Z');
  });
});

describe('B25-R8: printed input rows keep the typed date and add the note only when moved', () => {
  const NOTE = `First payment moved to Jan 15, 2027 ${NOTE_TAIL}`;

  it('no 4th argument, or an empty one: byte-identical rows to today (no extra row)', async () => {
    const v = await loadView();
    const raw = rawFor();
    const ctx = ctxFor(raw);
    const base = v.printInputRows(raw, ctx, '2 years, 0 months, 0 days');
    expect(v.printInputRows(raw, ctx, '2 years, 0 months, 0 days', '')).toEqual(base);
    expect(base.some(([, val]) => val.includes('moved to'))).toBe(false);
  });

  it('a note: exactly one extra row, directly under the First payment date row, which still shows the typed date', async () => {
    const v = await loadView();
    const raw = rawFor();
    const ctx = ctxFor(raw);
    const base = v.printInputRows(raw, ctx, 'T');
    const rows = v.printInputRows(raw, ctx, 'T', NOTE);
    expect(rows.length).toBe(base.length + 1);
    const i = rows.findIndex(([k]) => k === 'First payment date');
    expect(rows[i]).toEqual(['First payment date', 'Jan 10, 2027']); // typed date kept
    expect(rows[i + 1]![1]).toBe(NOTE);
    expect([...rows.slice(0, i + 1), ...rows.slice(i + 2)]).toEqual(base);
  });

  it('on the Next payment flows the printed label row stays "Next payment date" and the note follows it', async () => {
    const v = await loadView();
    const raw = rawFor({ flow: 'paymentChange', renewalDate: '2027-01-01', disbursalDate: '', firstPaymentDate: '2027-01-20', accruedInterest: '0' });
    const note = `Next payment moved to Jan 31, 2027 ${NOTE_TAIL}`;
    const rows = v.printInputRows(raw, ctxFor(raw), 'T', note);
    const i = rows.findIndex(([k]) => k === 'Next payment date');
    expect(i).toBeGreaterThan(-1);
    expect(rows[i + 1]![1]).toBe(note);
  });

  it('printInputNodes renders the extra row like the others (one dt/dd pair more)', async () => {
    const v = await loadView();
    const raw = rawFor();
    const ctx = ctxFor(raw);
    const a = v.printInputNodes(v.printInputRows(raw, ctx, 'T'));
    const b = v.printInputNodes(v.printInputRows(raw, ctx, 'T', NOTE));
    expect(b.length).toBe(a.length + 1);
    expect(v.html(b)).toContain('moved to Jan 15, 2027');
  });
});

describe('B25-R8: the CSV file name is the schedule\'s first (moved) date', () => {
  it('csvFileName(isoDay(row 1 date)) is the moved date and equals the first CSV data row date', async () => {
    const { v, result } = await run();
    const rows = result.amortizationSchedule;
    expect(v.csvFileName(v.isoDay(rows[0]!.date))).toBe('cost-of-borrowing-schedule-2027-01-15.csv');
    const csv = v.scheduleCsv(rows, 'all', ctxFor(rawFor()));
    expect(csv.split('\r\n')[1]!).toContain('2027-01-15');
  });

  it('unmoved: the name keeps the typed date (unchanged behaviour)', async () => {
    const { v, result } = await run({ firstPaymentDate: '2027-01-15' });
    expect(v.csvFileName(v.isoDay(result.amortizationSchedule[0]!.date))).toBe('cost-of-borrowing-schedule-2027-01-15.csv');
    expect(v.csvFileName('2026-03-23')).toBe('cost-of-borrowing-schedule-2026-03-23.csv');
  });
});

describe('B25-T7: static page and wiring pins', () => {
  const field = /<div class="field">\s*<label for="firstPaymentDate"[\s\S]*?<\/div>/.exec(html)?.[0] ?? '';

  it('#firstDateNote exists exactly once, a hidden p.hint with role="status", after the input inside the First payment date field, no data-switch', () => {
    expect(html.match(/id="firstDateNote"/g)?.length).toBe(1);
    const tag = /<p\b[^>]*\bid="firstDateNote"[^>]*>/.exec(html)?.[0] ?? '';
    expect(tag).toMatch(/class="hint"/);
    expect(tag).toMatch(/role="status"/);
    expect(tag).toMatch(/\bhidden\b/);
    expect(tag).not.toMatch(/data-switch/);
    expect(field).toContain('id="firstDateNote"');
    expect(field.indexOf('id="firstPaymentDate"')).toBeGreaterThan(-1);
    expect(field.indexOf('id="firstDateNote"')).toBeGreaterThan(field.indexOf('<input'));
  });

  it('#contractTermsNote exists exactly once, hidden, inside section#contractTerms after the tile list', () => {
    expect(html.match(/id="contractTermsNote"/g)?.length).toBe(1);
    const tag = /<p\b[^>]*\bid="contractTermsNote"[^>]*>/.exec(html)?.[0] ?? '';
    expect(tag).toMatch(/\bhidden\b/);
    expect(tag).not.toMatch(/data-switch/);
    const sec = /<section[^>]*id="contractTerms"[\s\S]*?<\/section>/.exec(html)?.[0] ?? '';
    expect(sec.indexOf('id="contractTermsNote"')).toBeGreaterThan(sec.indexOf('id="contractTermsList"'));
  });

  it('the typed input stays a plain input: its value is never rewritten by ca.js', () => {
    expect(stripComments(js)).not.toMatch(/firstPaymentDateEl\.value\s*=(?!=)/);
  });

  it('ca.js imports firstDateMoveNote and isoDay from ./ca-view.js and no new import appears', () => {
    const imp = /import \{([^}]*)\} from '\.\/ca-view\.js';/.exec(js)?.[1] ?? '';
    expect(imp).toMatch(/\bfirstDateMoveNote\b/);
    expect(imp).toMatch(/\bisoDay\b/);
    expect(js.match(/^import /gm)?.length).toBe(2);
  });

  it('ca.js derives the note from the result (row 1) and the typed value, with the flow label', () => {
    const code = stripComments(js);
    expect(code).toMatch(/firstDateMoveNote\([^)]*firstPaymentDateLabel[^)]*\)|firstDateMoveNote\([^)]*texts\.firstPaymentDate[^)]*\)/);
    expect(code).toMatch(/amortizationSchedule\[0\]/);
  });

  it('ca.js writes the notes with textContent, never innerHTML', () => {
    const code = stripComments(js);
    expect(code).toMatch(/firstDateNote[\s\S]{0,200}textContent|textContent[\s\S]{0,200}firstDateNote/);
    expect(code).toMatch(/contractTermsNote[\s\S]{0,200}textContent|textContent[\s\S]{0,200}contractTermsNote/);
    expect(code).not.toMatch(/(firstDateNote|contractTermsNote)\w*\.innerHTML/);
  });

  it('ca.js hands the first schedule row date (ISO) to setCurrentResult, not the typed value', () => {
    const code = stripComments(js);
    expect(code).not.toMatch(/setCurrentResult\(result\.amortizationSchedule,\s*raw\.firstPaymentDate/);
    expect(code).toMatch(/setCurrentResult\(result\.amortizationSchedule,\s*isoDay\(/);
  });

  it('ca.js clears and hides both notes in the error path (the catch block mentions both)', () => {
    const catchBlock = /catch \(err\) \{([\s\S]*?)\n  \}\n\}/.exec(stripComments(js))?.[1] ?? '';
    expect(catchBlock).toMatch(/firstDateNote/);
    expect(catchBlock).toMatch(/contractTermsNote/);
  });

  it('no UI switch and no policy constant for the note (B25-R9): UI_SWITCHES keys unchanged', () => {
    const body = /export const UI_SWITCHES\s*=\s*Object\.freeze\(\{([^}]*)\}\)/.exec(viewSrc)?.[1] ?? '';
    expect([...body.matchAll(/(\w+):\s*(true|false)\b/g)].map((m) => m[1]).sort())
      .toEqual(['acceleratedFrequencies', 'contractDateField', 'financedOption', 'variableRatePaymentChangeFlow']);
  });
});
