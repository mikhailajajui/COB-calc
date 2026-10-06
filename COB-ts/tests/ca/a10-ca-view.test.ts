/**
 * A10 step 1 (COB-architecture.md §5 A10, revision 15): the DOM-free half of ui/ca.js moves into
 * ui/ca-view.js (29 exports, no imports, one schedule-table builder). QA red / characterisation
 * tests, 2026-09-29, written before the developer step. Step 1 is behaviour-preserving.
 *
 * Characterisation source: tests/ca/fixtures/a10_ui_capture_v1.json, captured from the running
 * page of the post-A12b, pre-A10 tree (Chrome, headless) by tests/ca/fixtures/capture_a10_ui.mjs
 * (procedure A10-CAP). Every string below is what the browser rendered before any code moved.
 *
 * Tests: A10-C1…C9 (characterisation), A10-T1 (A10-R6: accrued interest mapping unchanged; since B20 the engine rejects the blank it sends no key for),
 * A10-T2 (today's blank mapping of fields step 2 does not touch; Q-A10-1 is open, so a blank Loan
 * amount / fee amount is characterised, not changed), A10-P1 (A10-R1), A10-P2 (A10-R5),
 * A10-P3 (A10-R2). Each ca-view import is a per-test dynamic import, so each test fails on its own
 * while ui/ca-view.js is missing. contractTermsList and headlineFigures stay DOM-built and are
 * checked by rerunning the capture (A10-CAP2), not here.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { calculateCobCanada, FLOWS, requiresSemiAnnualDate } from '../../src/ca/index.js';
import type { CobFlow, ProductType, RateType } from '../../src/ca/index.js';
import type * as View from '../../ui/ca-view.js';
import { ROOT, stripComments } from '../architecture/support.js';
import { loadFixture } from './support/fixtures.js';
import { ON, OFF } from './support/uiSwitches.js';
import type { TestUiSwitches } from './support/uiSwitches.js';
import { createHash } from 'node:crypto';
import { LEGACY_MORE, LEGACY_PRINT, inLegacyOrder } from './support/legacyFigureOrder.js';

interface CapturedMode {
  html: Record<string, string>;
  figures: View.Figure[];
  csvFileName: string;
  csvBase64: string;
}
interface CapturedScenario {
  id: string;
  raw: View.RawForm;
  error: string | null;
  /** B24-R6: the read-only #contractTerm field's value (added to the capture by the B24 regeneration). */
  contractTermField?: string;
  modes: Partial<Record<View.ColumnsMode, CapturedMode>>;
}
interface Capture {
  provenance: Record<string, string>;
  flowScreens: Record<string, Record<string, string>>; // B22-R8; checked in b22-use-case-labels.test.ts
  scenarios: CapturedScenario[];
}

const CAPTURE = loadFixture<Capture>('a10_ui_capture_v1.json');
const scenario = (id: string): CapturedScenario => {
  const s = CAPTURE.scenarios.find((x) => x.id === id);
  if (!s) throw new Error(`scenario ${id} missing from a10_ui_capture_v1.json`);
  return s;
};

const loadView = () => import('../../ui/ca-view.js') as Promise<typeof View>;

/** ViewContext exactly as ui/ca.js builds it (A10-R2): the flow spec and the semi-annual flag. */
const ctxOf = (raw: View.RawForm, switches: TestUiSwitches = ON): View.ViewContext => {
  const spec = FLOWS[raw.flow as CobFlow];
  if (!spec) throw new Error(`unknown flow ${raw.flow}`);
  return { spec, semiAnnual: requiresSemiAnnualDate(raw.productType as ProductType, raw.rateType as RateType), switches };
};

// B20 (decision 4): VRPC_blank_accrued is now an error case (the engine rejects the blank); the
// printed VRPC page is captured by the new VRPC_zero_accrued scenario.
// B33 (DEC-B33-FREQ, B33-R9): the capture gains PL_WEEKLY last (a weekly personal loan). It has no pre-B23 ON pin
// (b23_on_state_pins.json is unchanged), so it joins the shipped (OFF) replay only: OFF_IDS.
const CAPTURED_IDS = ['REF-01', 'S1_fees', 'RENEWAL', 'VRPC_blank_accrued', 'VRPC_zero_accrued', 'ERR_blank_rate', 'PL_WEEKLY'];
const OK_IDS = ['REF-01', 'S1_fees', 'RENEWAL', 'VRPC_zero_accrued'];
const OFF_IDS = [...OK_IDS, 'PL_WEEKLY'];
const MODES: View.ColumnsMode[] = ['all', 'compact'];

interface OnPins {
  scenarios: { id: string; raw: View.RawForm; modes: Record<string, Record<string, string>> }[];
}
const ON_PINS = loadFixture<OnPins>('b23_on_state_pins.json');
const sha = (text: string): string => createHash('sha256').update(text).digest('hex');

describe('A10-C characterisation: ca-view reproduces the page byte for byte', () => {
  // B23-T6. ON: the pre-B23 page, pinned by sha256 of every replayed output (b23_on_state_pins.json,
  // made from the post-B22 capture; the user declined a full byte copy of it, Q-B23-FIX 2026-09-30).
  // This half stays green before and after the capture is regenerated.
  let k = 0;
  for (const id of OK_IDS) {
    for (const mode of MODES) {
      k += 1;
      it(`A10-C${k} (switch on): ${id} / ${mode}: every ca-view output hashes to the pre-B23 page`, async () => {
        const v = await loadView();
        const pin = ON_PINS.scenarios.find((x) => x.id === id)!;
        const p = pin.modes[mode]!;
        const raw = pin.raw;
        const ctx = ctxOf(raw, ON);
        const r = calculateCobCanada(v.toInput(raw, ctx));
        // B31 (DEC-B31-LAYOUT): the figure lists are re-arranged, not changed; replayed in the pre-B31
        // order (tests/ca/support/legacyFigureOrder.ts) they still hash to the untouched pre-B23 pins.
        const { left, right } = v.printFigures(r, ctx);
        const printed = inLegacyOrder([...left, ...right], LEGACY_PRINT);
        expect(printed, 'every printed figure has a legacy place').toHaveLength(left.length + right.length);
        const screen = [...v.mainFigures(r), ...v.moreFigures(r, ctx)];
        expect(sha(v.html(v.printFeesNodes(raw.fees, ctx))), 'printFees').toBe(p.printFees);
        expect(sha(v.html(v.figureNodes(printed))), 'printFigures (legacy order)').toBe(p.printFigures);
        expect(sha(v.html(v.figureNodes(inLegacyOrder(screen, LEGACY_MORE)))), 'moreFigures (legacy order)').toBe(p.moreFigures);
        expect(sha(v.html(v.scheduleTableNodes(r, 'print', mode as View.ColumnsMode, ctx))), 'printScheduleTable').toBe(p.printScheduleTable);
        expect(sha(v.html(v.scheduleTableNodes(r, 'screen', mode as View.ColumnsMode, ctx))), 'scheduleTable').toBe(p.scheduleTable);
        expect(sha(JSON.stringify(printed)), 'figures list (legacy order)').toBe(p.figures);
        expect(sha(v.scheduleCsv(r.amortizationSchedule, mode as View.ColumnsMode, ctx)), 'CSV').toBe(p.csv);
        expect(v.csvFileName(raw.firstPaymentDate), 'CSV file name').toBe(p.csvFileName);
      });
    }
  }

  // B23-T6 OFF: the shipped page, against the capture. B31 (revision 49): the print figures are two
  // elements (#printFiguresLeft, #printFiguresRight) and the captured `figures` list is left then right.
  // RED until QA regenerates a10_ui_capture_v1.json after sr-dev's B31 code (approved 2026-10-05,
  // order and structure only; the pre-B31 strings are pinned in b31_pre_layout_pins.json, B31-T4).
  k = 9; // A10-C9 below is the error scenario
  for (const id of OFF_IDS) {
    for (const mode of MODES) {
      k += 1;
      it(`A10-C${k} (switch off, shipped): ${id} / ${mode}: print record, figures, both schedule tables, counts and CSV equal the capture`, async () => {
        const v = await loadView();
        const { raw, modes, contractTermField } = scenario(id);
        const cap = modes[mode]!;
        const ctx = ctxOf(raw, OFF);
        const r = calculateCobCanada(v.toInput(raw, ctx));
        const n = r.amortizationSchedule.length;

        expect(v.html(v.printInputNodes(v.printInputRows(raw, ctx, contractTermField as string))), 'printInputs').toBe(cap.html.printInputs);
        expect(v.html(v.printFeesNodes(raw.fees, ctx)), 'printFees').toBe(cap.html.printFees);
        const columns = v.printFigures(r, ctx);
        expect(cap.html.printFigures, 'the capture no longer has a single print figure list (B31-R9a)').toBeUndefined();
        expect(v.html(v.figureNodes(columns.left)), 'printFiguresLeft').toBe(cap.html.printFiguresLeft);
        expect(v.html(v.figureNodes(columns.right)), 'printFiguresRight').toBe(cap.html.printFiguresRight);
        expect(v.html(v.figureNodes(v.mainFigures(r))), 'mainFigures').toBe(cap.html.mainFigures);
        expect(v.html(v.figureNodes(v.moreFigures(r, ctx))), 'moreFigures').toBe(cap.html.moreFigures);
        expect(v.html(v.scheduleTableNodes(r, 'print', mode, ctx)), 'printScheduleTable').toBe(cap.html.printScheduleTable);
        expect(v.html(v.scheduleTableNodes(r, 'screen', mode, ctx)), 'scheduleTable').toBe(cap.html.scheduleTable);
        expect(v.paymentsText(n), 'printScheduleCount').toBe(cap.html.printScheduleCount);
        expect(v.paymentsText(n), 'scheduleCount').toBe(cap.html.scheduleCount);
        expect([...columns.left, ...columns.right], 'figures list (print left then right)').toEqual(cap.figures);
        expect(v.scheduleCsv(r.amortizationSchedule, mode, ctx), 'CSV').toBe(Buffer.from(cap.csvBase64, 'base64').toString('utf8'));
        expect(v.csvFileName(raw.firstPaymentDate), 'CSV file name').toBe(cap.csvFileName);
      });
    }
  }

  it('A10-C9: ERR_blank_rate: the engine rejects toInput(raw) with the captured #error text', async () => {
    // Fixture shape first (a truncated or re-captured fixture must not pass quietly).
    expect(CAPTURE.scenarios.map((s) => s.id)).toEqual(CAPTURED_IDS);
    for (const id of OFF_IDS) {
      expect(scenario(id).error, id).toBeNull();
      expect(Object.keys(scenario(id).modes), id).toEqual(MODES);
    }
    expect(scenario('ERR_blank_rate').modes).toEqual({});
    const v = await loadView();
    const { raw, error } = scenario('ERR_blank_rate');
    let message: string | undefined;
    try {
      calculateCobCanada(v.toInput(raw, ctxOf(raw)));
    } catch (e) {
      message = e instanceof Error ? e.message : String(e);
    }
    expect(message).toBe(error);
  });
});

describe('A10-T1 (A10-R6; B20): accrued interest mapping is unchanged, the blank is rejected by the engine', () => {
  it('A10-T1: blank accrued sends no key and the engine rejects it; a typed 0 is accepted; 125.50 -> 125.5; VRPC blank and a new loan send none', async () => {
    const v = await loadView();
    const renewal = scenario('RENEWAL').raw;
    const ctx = ctxOf(renewal);

    const blank = v.toInput({ ...renewal, accruedInterest: '' }, ctx);
    const zero = v.toInput({ ...renewal, accruedInterest: '0' }, ctx);
    expect('accruedInterest' in blank).toBe(false);
    expect(zero.accruedInterest).toBe(0);
    // B20 (decision 4): a blank is no longer "equal to 0"; it is rejected, and a typed 0 is accepted.
    expect(() => calculateCobCanada(blank)).toThrow(RangeError);
    expect(() => calculateCobCanada(blank)).toThrow(/requires accruedInterest/);
    expect(() => calculateCobCanada(zero)).not.toThrow();

    const typed = v.toInput(renewal, ctx);
    expect(renewal.accruedInterest).toBe('125.50');
    expect(typed.accruedInterest).toBe(125.5);
    // buildInput's key order for an existing loan (start date, then accrued). B24: toInput sends no termYears / termMonths,
    // and no semiAnnualCompoundingDate while SEMI_ANNUAL_DATE_REQUIRED is off (ctx.semiAnnual is then false).
    expect(Object.keys(typed)).toEqual([
      'flow', 'productType', 'rateType', 'loanAmount', 'fees', 'contractRatePercent', 'paymentAmount',
      'paymentFrequency', 'firstPaymentDate', 'endDate', 'renewalDate',
      'accruedInterest',
    ]);

    const vrpc = scenario('VRPC_blank_accrued').raw;
    expect(vrpc.accruedInterest).toBe('');
    expect('accruedInterest' in v.toInput(vrpc, ctxOf(vrpc))).toBe(false);

    const ref = scenario('REF-01').raw;
    expect('accruedInterest' in v.toInput({ ...ref, accruedInterest: '5' }, ctxOf(ref))).toBe(false);
  });
});

describe('A10-T2: today\'s blank mapping for the fields step 2 does not touch (Q-A10-1 open)', () => {
  it('A10-T2: rate/payment blank -> NaN; loan blank -> 0; blank fee -> Fee $0; blank dates -> Invalid Date or no key', async () => {
    const v = await loadView();
    const raw = scenario('REF-01').raw;
    const ctx = ctxOf(raw);
    const at = (patch: Partial<View.RawForm>) => v.toInput({ ...raw, ...patch }, ctx);

    expect(at({ contractRatePercent: '' }).contractRatePercent).toBeNaN();
    expect(at({ contractRatePercent: '0' }).contractRatePercent).toBe(0);
    expect(at({ paymentAmount: '' }).paymentAmount).toBeNaN();
    // Q-A10-1 (open): a blank Loan amount is Number('') = 0 today.
    expect(at({ loanAmount: '' }).loanAmount).toBe(0);
    // Q-A10-1 (open): a blank fee row is a silent $0 fee named 'Fee' today.
    expect(at({ fees: [{ name: '', amount: '', financed: false }] }).fees).toEqual({
      fees: [{ name: 'Fee', amount: 0, financed: false }],
    });

    for (const key of ['firstPaymentDate', 'endDate'] as const) {
      const d = at({ [key]: '' })[key];
      expect(d, key).toBeInstanceOf(Date);
      expect(Number.isNaN(d.getTime()), key).toBe(true);
    }
    expect('disbursalDate' in at({ disbursalDate: '' })).toBe(false);
    expect('semiAnnualCompoundingDate' in at({ semiAnnualCompoundingDate: '' })).toBe(false);

    // The filled form: UTC-midnight dates and buildInput's key order for a new loan.
    const full = v.toInput(raw, ctx);
    expect(full.firstPaymentDate.getTime()).toBe(Date.UTC(2026, 2, 23));
    expect(Object.keys(full)).toEqual([
      'flow', 'productType', 'rateType', 'loanAmount', 'fees', 'contractRatePercent', 'paymentAmount',
      'paymentFrequency', 'firstPaymentDate', 'endDate', 'disbursalDate',
    ]);
  });
});

const readUi = (name: string) => stripComments(readFileSync(`${ROOT}/ui/${name}`, 'utf8'));
const hitsOf = (code: string, re: RegExp) =>
  code.split('\n').flatMap((l, i) => (re.test(l) ? [`${i + 1}: ${l.trim()}`] : []));

describe('A10-P source guards', () => {
  it('A10-P1 (A10-R1): ui/ca-view.js has no import, no re-export, no DOM identifier and no local-time API', () => {
    const code = readUi('ca-view.js');
    const PATTERNS: [string, RegExp][] = [
      ['import', /(?<![.\w$])import\b/],
      ['export … from', /\bexport\s*(?:type\s*)?(?:\*|\{[^}]*\})\s*(?:as\s+[\w$]+\s*)?from\s*['"`]/],
      ['DOM identifier', /\b(?:document|window|navigator|location|localStorage|sessionStorage|fetch|Blob|HTMLElement|Element)\b/],
      ['local-time Date getter/setter', /\.(get|set)(FullYear|Month|Date|Day|Hours|Minutes|Seconds|Milliseconds)\(/],
      ['toLocale*', /toLocale/],
      ['getTimezoneOffset', /getTimezoneOffset/],
      ['Date.now', /Date\.now\b/],
      ['new Date() with no arguments', /new\s+Date\s*\(\s*\)/],
      ['Date.parse', /Date\.parse\b/],
      ['Math.random', /Math\.random\b/],
    ];
    const hits = PATTERNS.flatMap(([name, re]) => hitsOf(code, re).map((h) => `${name} @ ${h}`));
    // `export … from` may span lines: check the whole text too.
    if (/\bexport\s*(?:type\s*)?(?:\*|\{[^}]*\})\s*(?:as\s+[\w$]+\s*)?from\s*['"`]/.test(code)) hits.push('export … from (multi-line)');
    expect(hits).toEqual([]);
  });

  it('A10-P2 (A10-R5): ui/ca.js declares none of the moved names and builds no table element', () => {
    const code = readUi('ca.js');
    const MOVED = [
      'buildInput', 'parseDateInput', 'numOrUndefined', 'CSV_COLUMNS', 'PRINT_COLUMNS', 'PRINT_USE_CASES',
      'PRINT_PRODUCT_TYPES', 'PRINT_RATE_TYPES', 'PRINT_FREQUENCIES', 'COMPACT_KEYS', 'csvCell', 'scheduleCsv',
      'printInputRows', 'headlineFigures', 'mainFigures', 'moreFigures', 'printFigures', 'figureRows', 'printCell',
      'printTotal', 'printColClass', 'screenColClass', 'showColumn', 'formatIsoDate', 'formatRate', 'typedMoney',
      'parseMoney', 'isoDay', 'inputDateFmt', 'printCurrency', 'printRate', 'printCount', 'printShortDate', 'dateFmt',
      'currency',
    ];
    expect(MOVED).toHaveLength(35);
    const declared = MOVED.filter((name) => new RegExp(`\\b(const|let|var|function)\\s+${name}\\b`).test(code));
    expect(declared).toEqual([]);
    const tableBuilds = [...code.matchAll(/\b(?:el|createElement)\(\s*['"`](table|thead|tbody|tfoot|th|td|caption)['"`]/g)].map((m) => m[0]);
    expect(tableBuilds).toEqual([]);
  });

  it('A10-P3 (A10-R2): ui/ca-view.js exports exactly the 39 names of ui/ca-view.d.ts (B22 adds flowLabels, B23 adds UI_SWITCHES and FEE_KEYS, B28 adds switchedOut, B27 added frequencyLock and FREQUENCY_LOCK_HINT and B33 (DEC-B33-FREQ) removed them, B24 adds contractTermParts, contractTermText and contractTermHint, B25 adds firstDateMoveNote), and pins the branches no capture reaches', async () => {
    const v = await loadView();
    // Pre-A10 values (ui/ca.js) for branches the 5 captured scenarios never take; the escaping
    // string is Chrome 154's own outerHTML of the same td (checked 2026-09-29), i.e. A10-R3.
    expect(v.paymentsText(1)).toBe('1 payment');
    expect(v.paymentsText(0)).toBe('0 payments');
    expect(v.paymentsText(1234)).toBe('1,234 payments');
    expect(v.html([v.h('td', [['class', 'a&b\u00a0"c"<d>\'e']], ['x&y\u00a0<z>"q"\'r'])])).toBe(
      '<td class="a&amp;b&nbsp;&quot;c&quot;&lt;d&gt;\'e">x&amp;y&nbsp;&lt;z&gt;"q"\'r</td>',
    );
    expect(v.formatInputDate(undefined)).toBe('Not entered');
    expect(v.formatInputDate(new Date(Date.UTC(2026, 2, 23)))).toBe('Mar 23, 2026');
    expect(v.label('flow', 'notAFlow')).toBe('notAFlow');
    expect(v.label('paymentFrequency', 'acceleratedBiweekly')).toBe('Accelerated Bi-weekly');
    expect(v.formatCurrency(-1234.5)).toBe('-$1,234.50');
    expect(v.csvFileName('2026-03-23')).toBe('cost-of-borrowing-schedule-2026-03-23.csv');

    expect(Object.keys(v).sort()).toEqual(
      [
        'COLUMNS', 'COMPACT_KEYS', 'CSV_COLUMNS', 'FEE_KEYS', 'LABELS', 'UI_SWITCHES', 'csvFileName', 'figureNodes', 'formatAmount', 'formatCurrency',
        'flowLabels', 'formatInputDate', 'formatIsoDate', 'formatRate', 'h', 'headlineFigures', 'html', 'isoDay', 'label',
        'mainFigures', 'moreFigures', 'numOrUndefined', 'parseAmount', 'parseDateInput', 'parseMoney', 'paymentsText',
        'printFeesNodes', 'printFigures', 'printInputNodes', 'printInputRows', 'scheduleCsv', 'scheduleTableNodes',
        'switchedOut', 'toInput', 'typedMoney', 'contractTermParts', 'contractTermText', 'contractTermHint', 'firstDateMoveNote',
      ].sort(),
    );
  });
});
