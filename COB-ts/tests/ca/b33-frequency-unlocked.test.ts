/**
 * B33 (COB-architecture.md section 5 B33, revision 51; user decision DEC-B33-FREQ, 2026-10-05): the page no longer locks
 * Payment frequency for a personal loan. B27's `frequencyLock`, `FREQUENCY_LOCK_HINT`, the hint span
 * `#paymentFrequencyHint` and the select's `aria-describedby` are deleted (B33-R5, D3); `ui/ca.js` no longer imports
 * `allowedPaymentFrequencies`. A product change does not touch the Payment frequency select.
 *
 * QA red tests, 2026-10-05: B33-T9 (INV-UI: view exports, d.ts, ca.js imports, static absences, ca.html select markup)
 * and B33-T10 (the page capture gains scenario PL_WEEKLY, B33-R9; the six earlier scenarios unchanged). Red until sr-dev
 * applies B33-R5 (T9) and QA regenerates the capture in the verify step (T10).
 */
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type * as View from '../../ui/ca-view.js';
import { ROOT, read, stripComments } from '../architecture/support.js';
import { FIXTURES_DIR, loadFixture } from './support/fixtures.js';

const loadView = () => import('../../ui/ca-view.js') as Promise<typeof View>;
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

/** The 39 names of ui/ca-view.d.ts after B33-R6 (B27's frequencyLock and FREQUENCY_LOCK_HINT removed). */
const VIEW_EXPORTS_39 = [
  'COLUMNS', 'COMPACT_KEYS', 'CSV_COLUMNS', 'FEE_KEYS', 'LABELS', 'UI_SWITCHES', 'csvFileName', 'figureNodes', 'formatAmount', 'formatCurrency',
  'flowLabels', 'formatInputDate', 'formatIsoDate', 'formatRate', 'h', 'headlineFigures', 'html', 'isoDay', 'label',
  'mainFigures', 'moreFigures', 'numOrUndefined', 'parseAmount', 'parseDateInput', 'parseMoney', 'paymentsText',
  'printFeesNodes', 'printFigures', 'printInputNodes', 'printInputRows', 'scheduleCsv', 'scheduleTableNodes',
  'switchedOut', 'toInput', 'typedMoney', 'contractTermParts', 'contractTermText', 'contractTermHint', 'firstDateMoveNote',
].sort();

const GONE = ['frequencyLock', 'FREQUENCY_LOCK_HINT', 'paymentFrequencyHint', 'Personal loans are paid monthly.'];

// ---------------------------------------------------------------------------------------------------------------
describe('B33-T9 INV-UI: no Payment frequency lock in ui/', () => {
  it('ui/ca-view.js exports exactly 39 names, without frequencyLock / FREQUENCY_LOCK_HINT', async () => {
    const v = await loadView();
    expect(VIEW_EXPORTS_39).toHaveLength(39);
    expect(Object.keys(v).sort()).toEqual(VIEW_EXPORTS_39);
  });

  it('ui/ca-view.d.ts declares exactly the same 39 names (QA-owned, B33-R6)', () => {
    const dts = stripComments(read(join(ROOT, 'ui', 'ca-view.d.ts')));
    const declared = [...dts.matchAll(/^export (?:declare )?(?:const|function|let) (\w+)/gm)].map((m) => m[1]!);
    expect([...new Set(declared)].sort()).toEqual(VIEW_EXPORTS_39);
    expect(dts).not.toMatch(/\bFrequencyLock\b/);
  });

  it('ui/ca.js: the barrel import is exactly calculateCobCanada, contractTerm, FLOWS, requiresSemiAnnualDate (B33-R5)', () => {
    const js = stripComments(read(join(ROOT, 'ui', 'ca.js')));
    const m = /import\s*\{([^}]*)\}\s*from\s*'\/dist\/ca\/index\.js';/.exec(js);
    expect(m).not.toBeNull();
    expect(m![1]!.split(',').map((s) => s.trim()).filter(Boolean)).toEqual(['calculateCobCanada', 'contractTerm', 'FLOWS', 'requiresSemiAnnualDate']);
    expect(js).not.toMatch(/\ballowedPaymentFrequencies\b/);
  });

  it('ui/ca.js: the ca-view import list has no frequencyLock; formatAmount is followed by formatCurrency', () => {
    const js = stripComments(read(join(ROOT, 'ui', 'ca.js')));
    const m = /import\s*\{([^}]*)\}\s*from\s*'\.\/ca-view\.js';/.exec(js);
    const names = m![1]!.split(',').map((s) => s.trim()).filter(Boolean);
    expect(names).not.toContain('frequencyLock');
    expect(names.indexOf('formatCurrency')).toBe(names.indexOf('formatAmount') + 1);
    for (const n of names) expect(VIEW_EXPORTS_39, n).toContain(n);
  });

  it('updateConditionalVisibility assigns neither paymentFrequencyEl.value nor paymentFrequencyEl.disabled (a product change does not touch the select)', () => {
    const js = stripComments(read(join(ROOT, 'ui', 'ca.js')));
    const start = js.indexOf('function updateConditionalVisibility(');
    expect(start).toBeGreaterThan(-1);
    const body = js.slice(start, js.indexOf('\n}\n', start));
    expect(body).not.toMatch(/paymentFrequencyEl\.(value|disabled)\s*=/);
    // Nowhere in ca.js is the select disabled, and nothing writes a frequency literal into it.
    expect(js).not.toMatch(/paymentFrequencyEl\.disabled\s*=/);
    expect(js).not.toMatch(/paymentFrequencyEl\.value\s*=\s*['"`]/);
    expect(js).not.toMatch(/['"`]personalLoan['"`]/);
  });

  it('ca.html: <select id="paymentFrequency"> has no attribute but its id; its field has no hint element; six options, two behind the accelerated switch', () => {
    const html = read(join(ROOT, 'ui', 'ca.html'));
    expect(html).toContain('<select id="paymentFrequency">');
    const sel = /<select\b[^>]*\bid="paymentFrequency"[^>]*>/.exec(html)!;
    expect(sel[0]).toBe('<select id="paymentFrequency">');
    const fieldStart = html.lastIndexOf('<div class="field">', sel.index);
    const fieldEnd = html.indexOf('</div>', sel.index);
    const field = html.slice(fieldStart, fieldEnd);
    expect(field).not.toMatch(/class="hint"/);
    const options = [...field.matchAll(/<option value="(\w+)"([^>]*)>/g)].map((m) => [m[1], /data-switch="acceleratedFrequencies"/.test(m[2]!)]);
    expect(options).toEqual([
      ['weekly', false], ['acceleratedWeekly', true], ['biweekly', false], ['acceleratedBiweekly', true], ['semiMonthly', false], ['monthly', false],
    ]);
  });

  it('none of the calculator page files (ca.html, ca.js, ca-view.js, ca-view.d.ts, serve.mjs) names frequencyLock, FREQUENCY_LOCK_HINT, paymentFrequencyHint or the hint text', () => {
    // Named files, not a folder scan: the generated documentation page in ui/ is rebuilt by the doc step, not by sr-dev.
    for (const name of ['ca.html', 'ca.js', 'ca-view.js', 'ca-view.d.ts', 'serve.mjs']) {
      const src = read(join(ROOT, 'ui', name));
      for (const t of GONE) expect(src, `ui/${name}: ${t}`).not.toContain(t);
    }
  });
});

// ---------------------------------------------------------------------------------------------------------------
type Scenario = { id: string; raw: Record<string, unknown>; contractTermField: string; error: string | null; modes: Record<string, { figures: string[][]; csvFileName: string }> };
describe('B33-T10 capture: scenario PL_WEEKLY appended (B33-R9); the six earlier scenarios unchanged (red until the capture is regenerated)', () => {
  const cap = JSON.parse(readFileSync(join(FIXTURES_DIR, 'a10_ui_capture_v1.json'), 'utf8')) as { formDefaults: unknown; flowScreens: unknown; scenarios: Scenario[] };
  const pin = loadFixture<{ capture: { scenarioIds: string[]; scenariosSha256: string; formDefaultsSha256: string; flowScreensSha256: string } }>('b33_pre_golden_group_hashes.json').capture;
  const CALC_HINT = 'Fixed-rate mortgages: contract rate converted to the payment frequency. Otherwise the contract rate.';

  it('seven scenarios; scenarios[0..5], formDefaults and flowScreens equal QA\'s pre-B33 pin', () => {
    expect(cap.scenarios.map((s) => s.id)).toEqual([...pin.scenarioIds, 'PL_WEEKLY']);
    expect(sha256(JSON.stringify(cap.scenarios.slice(0, 6)))).toBe(pin.scenariosSha256);
    expect(sha256(JSON.stringify(cap.formDefaults))).toBe(pin.formDefaultsSha256);
    expect(sha256(JSON.stringify(cap.flowScreens))).toBe(pin.flowScreensSha256);
  });

  it('PL_WEEKLY: raw personal loan / fixed / weekly, no error, Contract term 2 years, 10 months, 13 days, the R9 figures in both modes', () => {
    const s = cap.scenarios[6]!;
    expect(s.id).toBe('PL_WEEKLY');
    expect(s.raw).toMatchObject({ flow: 'newMortgageOrLoan', productType: 'personalLoan', rateType: 'fixed', paymentFrequency: 'weekly' });
    expect(s.error).toBeNull();
    expect(s.contractTermField).toBe('2 years, 10 months, 13 days');
    expect(Object.keys(s.modes)).toEqual(['all', 'compact']);
    for (const mode of ['all', 'compact']) {
      const m = s.modes[mode]!;
      expect(m.csvFileName).toBe('cost-of-borrowing-schedule-2026-03-24.csv');
      const byLabel = Object.fromEntries(m.figures.map((f) => [f[0], f.slice(1)]));
      expect(m.figures).toHaveLength(9);
      expect(byLabel['Cost of borrowing rate (APR)']).toEqual(['8.00000%']);
      expect(byLabel['Calculated rate']).toEqual(['8.00000%', CALC_HINT]);
      expect(byLabel['Number of payments']).toEqual(['150']);
      expect(byLabel['Term in days']).toEqual(['1,050 days']);
      expect(byLabel['Balance at end date']).toEqual(['$0.00']);
      expect(byLabel['Total of all payments']).toEqual(['$11,196.00']);
      expect(byLabel['Cost of borrowing amount']![0]).toBe('$1,196.03');
      expect(byLabel['Total principal paid']).toEqual(['$10,000.00']);
      expect(byLabel['Total interest']![0]).toBe('$1,196.03');
    }
  });
});
