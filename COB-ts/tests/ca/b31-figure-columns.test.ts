/**
 * B31 (COB-architecture.md §5 B31, revision 49; user decision DEC-B31-LAYOUT, COB-user-stories.md §7.5,
 * screen part as changed by the user 2026-10-05; Q-B31-DUP-HINT and Q-B31-ON-ORDER resolved):
 * the result figures in two columns on the printout; the screen keeps its main list and the collapsed
 * "More figures", regrouped. UI only; engine, CSV, labels, hints, values and conditions unchanged.
 *
 * Requirement (the oracle of this file; typed from the decision, nothing imported from the view):
 *   print left  = APR; Calculated rate; Number of payments; Term in days; Balance at end date;
 *                 [Unpaid interest at end date, last row carriedAccruedInterestClosing > 0];
 *                 [financedOption on: Fees recovered through payments; Disbursal amount (New flow only)]
 *   print right = Total of all payments; Cost of borrowing amount (with hint); Total principal paid;
 *                 Total interest; [Trigger rate, triggerRatePercent !== null]
 *   screen main = print right, Cost of borrowing amount WITHOUT its hint (2-tuple)
 *   screen more = print left without the APR
 *
 * QA red tests, 2026-10-05, written before any product change. Ids: B31-T1 .. B31-T11 (B31-T11 is
 * B31-INV-HINT, view part; the Chrome part is in tests/ui/check_page_smoke.mjs and
 * tests/ui/check_print_width.mjs). Pins: b31_pre_layout_pins.json (switch off, made from the
 * pre-B31 capture) and b23_on_state_pins.json (switch on), replayed in the legacy order
 * (tests/ca/support/legacyFigureOrder.ts). The developer must not edit this file.
 */
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { calculateCobCanada, FLOWS, requiresSemiAnnualDate } from '../../src/ca/index.js';
import type { CobCanadaResult, CobFlow, ProductType, RateType } from '../../src/ca/index.js';
import type * as View from '../../ui/ca-view.js';
import { ROOT, stripComments } from '../architecture/support.js';
import { loadFixture } from './support/fixtures.js';
import { BOTH, OFF, ON } from './support/uiSwitches.js';
import type { TestUiSwitches } from './support/uiSwitches.js';
import { LEGACY_MAIN, LEGACY_MORE, LEGACY_PRINT, inLegacyOrder } from './support/legacyFigureOrder.js';

const loadView = () => import('../../ui/ca-view.js') as Promise<typeof View>;
const sha = (text: string): string => createHash('sha256').update(text).digest('hex');

// --- labels and hints, typed from the decision ---

const APR = 'Cost of borrowing rate (APR)';
const COB_AMOUNT = 'Cost of borrowing amount';
const COB_HINT = 'Interest plus all fees over the term.';
const CALC = 'Calculated rate';
const NPAY = 'Number of payments';
const TERM = 'Term in days';
const BAL = 'Balance at end date';
const UNPAID = 'Unpaid interest at end date';
const UNPAID_HINT = 'Unpaid after the last payment; interest since then is not included';
const FEES_REC = 'Fees recovered through payments';
const DISB = 'Disbursal amount';
const TOTPAY = 'Total of all payments';
const TOTPRIN = 'Total principal paid';
const TOTINT = 'Total interest';
const TRIGGER = 'Trigger rate';
const TRIGGER_HINT = 'If the contract rate rises above this, the payment no longer covers the interest.';

const LEFT_HEAD = [APR, CALC, NPAY, TERM, BAL];
const RIGHT_HEAD = [TOTPAY, COB_AMOUNT, TOTPRIN, TOTINT];

// --- inputs ---

interface PreLayoutMode { figures: string; figuresCount: number; printFigures: string; mainFigures: string; moreFigures: string; mainCount: number; moreCount: number }
interface PreLayoutPins { scenarios: { id: string; raw: View.RawForm; modes: Record<string, PreLayoutMode> }[] }
interface OnPins { scenarios: { id: string; raw: View.RawForm; modes: Record<string, Record<string, string>> }[] }
const PRE = loadFixture<PreLayoutPins>('b31_pre_layout_pins.json');
const ON_PINS = loadFixture<OnPins>('b23_on_state_pins.json');

const OK_IDS = ['REF-01', 'S1_fees', 'RENEWAL', 'VRPC_zero_accrued'];
const MODES = ['all', 'compact'];
const rawOf = (id: string): View.RawForm => {
  const s = PRE.scenarios.find((x) => x.id === id);
  if (!s) throw new Error(`scenario ${id} missing from b31_pre_layout_pins.json`);
  return { ...s.raw, fees: s.raw.fees.map((f) => ({ ...f })) };
};

/** ViewContext exactly as ui/ca.js builds it. */
const ctxOf = (raw: View.RawForm, switches: TestUiSwitches): View.ViewContext => ({
  spec: FLOWS[raw.flow as CobFlow],
  semiAnnual: requiresSemiAnnualDate(raw.productType as ProductType, raw.rateType as RateType),
  switches,
});

async function resultOf(raw: View.RawForm, switches: TestUiSwitches): Promise<CobCanadaResult> {
  const v = await loadView();
  return calculateCobCanada(v.toInput(raw, ctxOf(raw, switches)));
}

/** The B26 shortfall page: 200,000 at 5%, monthly, payment 700 (last row unpaid interest $3,015.17, balance $200,000.00). */
const SHORTFALL_RAW: View.RawForm = {
  flow: 'newMortgageOrLoan', productType: 'mortgage', rateType: 'fixed', contractDate: '2026-03-10',
  loanAmount: '200000', contractRatePercent: '5', paymentAmount: '700', paymentFrequency: 'monthly',
  firstPaymentDate: '2026-05-01', endDate: '2028-04-15',
  disbursalDate: '2026-04-01', renewalDate: '2026-01-01', accruedInterest: '', semiAnnualCompoundingDate: '2026-04-01', fees: [],
};

/** A result whose last schedule row holds `value` as carriedAccruedInterestClosing. */
function withLastClosing(result: CobCanadaResult, value: number): CobCanadaResult {
  const rows = result.amortizationSchedule.map((row, i, all) => (i === all.length - 1 ? { ...row, carriedAccruedInterestClosing: value } : row));
  return { ...result, amortizationSchedule: rows };
}

const names = (list: readonly View.Figure[]) => list.map((f) => f[0]);

/** The oracle: the expected label lists for one result and switch state (B31-R2). */
function expectedLabels(r: CobCanadaResult, raw: View.RawForm, sw: TestUiSwitches) {
  const unpaid = r.amortizationSchedule[r.amortizationSchedule.length - 1]!.carriedAccruedInterestClosing > 0;
  const isNew = FLOWS[raw.flow as CobFlow].startDateField === 'disbursalDate';
  const left = [
    ...LEFT_HEAD,
    ...(unpaid ? [UNPAID] : []),
    ...(sw.financedOption ? [FEES_REC] : []),
    ...(sw.financedOption && isNew ? [DISB] : []),
  ];
  const right = [...RIGHT_HEAD, ...(r.triggerRatePercent !== null ? [TRIGGER] : [])];
  return { left, right, more: left.slice(1), main: right };
}

// =================================================================================================== T1
describe('B31-T1 (B31-R3): API', () => {
  // B33 (DEC-B33-FREQ, B33-R5): 41 -> 39 (frequencyLock and FREQUENCY_LOCK_HINT removed).
  // B34 (DEC-B34-TERM, B34-R3): 39 -> 41 (contractTermMonthsParts and contractTermChoice added).
  it('B31-T1a: 41 exports; mainFigures, moreFigures, printFigures present; no figureColumns / amountFigures export', async () => {
    const v = await loadView();
    expect(Object.keys(v)).toHaveLength(41);
    for (const name of ['headlineFigures', 'mainFigures', 'moreFigures', 'printFigures', 'figureNodes']) {
      expect(typeof (v as Record<string, unknown>)[name], name).toBe('function');
    }
    expect(Object.keys(v)).not.toContain('figureColumns');
    expect(Object.keys(v)).not.toContain('amountFigures');
  });

  it.each(BOTH)('B31-T1b [%s]: printFigures returns an object with exactly the keys left, right (arrays of figures)', async (_n, sw) => {
    const v = await loadView();
    const raw = rawOf('REF-01');
    const r = await resultOf(raw, sw);
    const p = v.printFigures(r, ctxOf(raw, sw)) as unknown;
    expect(Array.isArray(p), 'printFigures no longer returns a flat list').toBe(false);
    expect(p).toBeTypeOf('object');
    expect(Object.keys(p as object).sort()).toEqual(['left', 'right']);
    const { left, right } = p as View.FigureColumns;
    expect(Array.isArray(left)).toBe(true);
    expect(Array.isArray(right)).toBe(true);
    for (const f of [...left, ...right]) {
      expect(Array.isArray(f)).toBe(true);
      expect([2, 3]).toContain(f.length);
      for (const s of f) expect(typeof s).toBe('string');
    }
  });
});

// =================================================================================================== T2
describe('B31-T2 (B31-INV-ORDER, B31-R2): exact order per capture scenario, both switch states', () => {
  it('B31-T2 literal: REF-01, switch off (shipped): the four lists exactly', async () => {
    const v = await loadView();
    const raw = rawOf('REF-01');
    const ctx = ctxOf(raw, OFF);
    const r = await resultOf(raw, OFF);
    const { left, right } = v.printFigures(r, ctx);
    expect(names(left)).toEqual(['Cost of borrowing rate (APR)', 'Calculated rate', 'Number of payments', 'Term in days', 'Balance at end date']);
    expect(names(right)).toEqual(['Total of all payments', 'Cost of borrowing amount', 'Total principal paid', 'Total interest']);
    expect(names(v.mainFigures(r))).toEqual(['Total of all payments', 'Cost of borrowing amount', 'Total principal paid', 'Total interest']);
    expect(names(v.moreFigures(r, ctx))).toEqual(['Calculated rate', 'Number of payments', 'Term in days', 'Balance at end date']);
  });

  it('B31-T2 literal: VRPC_zero_accrued (variable mortgage), switch off: right and main end with Trigger rate; left and more hold none', async () => {
    const v = await loadView();
    const raw = rawOf('VRPC_zero_accrued');
    const ctx = ctxOf(raw, OFF);
    const r = await resultOf(raw, OFF);
    expect(r.triggerRatePercent).not.toBeNull();
    const { left, right } = v.printFigures(r, ctx);
    expect(names(right)).toEqual([...RIGHT_HEAD, TRIGGER]);
    expect(names(v.mainFigures(r))).toEqual([...RIGHT_HEAD, TRIGGER]);
    expect(names(left)).toEqual(LEFT_HEAD);
    expect(names(v.moreFigures(r, ctx))).toEqual(LEFT_HEAD.slice(1));
  });

  const cases = OK_IDS.flatMap((id) => BOTH.map(([n, sw]) => [id, n, sw] as const));
  it.each(cases)('B31-T2 %s [%s]: left, right, main, more label lists equal the oracle', async (id, _n, sw) => {
    const v = await loadView();
    const raw = rawOf(id);
    const ctx = ctxOf(raw, sw);
    const r = await resultOf(raw, sw);
    const want = expectedLabels(r, raw, sw);
    const { left, right } = v.printFigures(r, ctx);
    expect(names(left), 'print left').toEqual(want.left);
    expect(names(right), 'print right').toEqual(want.right);
    expect(names(v.mainFigures(r)), 'screen main').toEqual(want.main);
    expect(names(v.moreFigures(r, ctx)), 'screen more').toEqual(want.more);
  });
});

// =================================================================================================== T3
describe('B31-T3 (B31-INV-SCREEN): screen = print minus the APR (more) / minus the Cost of borrowing amount hint (main)', () => {
  const RAWS: [string, View.RawForm][] = [...OK_IDS.map((id) => [id, rawOf(id)] as [string, View.RawForm]), ['B26 shortfall', SHORTFALL_RAW]];
  const cases = RAWS.flatMap(([id, raw]) => BOTH.map(([n, sw]) => [id, n, raw, sw] as const));
  it.each(cases)('B31-T3 %s [%s]', async (_id, _n, raw, sw) => {
    const v = await loadView();
    const ctx = ctxOf(raw, sw);
    const r = await resultOf(raw, sw);
    const head = v.headlineFigures(r);
    const { left, right } = v.printFigures(r, ctx);
    const main = v.mainFigures(r);
    expect(v.moreFigures(r, ctx)).toEqual(left.slice(1));
    expect(left[0]).toEqual(head[0]);
    expect(right[1]).toEqual(head[1]);
    expect(right[1]).toEqual([COB_AMOUNT, v.formatCurrency(r.cobAmount), COB_HINT]);
    expect(main).toEqual(right.map((f, i) => (i === 1 ? head[1]!.slice(0, 2) : f)));
    expect(main[1]).toHaveLength(2);
    expect(main[1]).toEqual([COB_AMOUNT, v.formatCurrency(r.cobAmount)]);
  });
});

// =================================================================================================== T4
describe('B31-T4 (B31-INV-SAMESET): the same figures as before B31, only re-arranged (legacy-order replay against the pins)', () => {
  it('B31-T4 fixture shape: both pin files have the four OK scenarios, two modes each', () => {
    expect(PRE.scenarios.map((s) => s.id)).toEqual(OK_IDS);
    for (const s of PRE.scenarios) expect(Object.keys(s.modes), s.id).toEqual(MODES);
    for (const id of OK_IDS) expect(ON_PINS.scenarios.find((s) => s.id === id), id).toBeDefined();
  });

  const cases = OK_IDS.flatMap((id) => MODES.map((m) => [id, m] as const));

  it.each(cases)('B31-T4 switch on (b23_on_state_pins.json): %s / %s', async (id, mode) => {
    const v = await loadView();
    const pin = ON_PINS.scenarios.find((x) => x.id === id)!;
    const p = pin.modes[mode]!;
    const ctx = ctxOf(pin.raw, ON);
    const r = calculateCobCanada(v.toInput(pin.raw, ctx));
    const { left, right } = v.printFigures(r, ctx);
    const printed = inLegacyOrder([...left, ...right], LEGACY_PRINT);
    expect(printed).toHaveLength(left.length + right.length);
    const screen = [...v.mainFigures(r), ...v.moreFigures(r, ctx)];
    expect(sha(JSON.stringify(printed)), 'figures').toBe(p.figures);
    expect(sha(v.html(v.figureNodes(printed))), 'printFigures').toBe(p.printFigures);
    expect(sha(v.html(v.figureNodes(inLegacyOrder(screen, LEGACY_MORE)))), 'moreFigures').toBe(p.moreFigures);
  });

  it.each(cases)('B31-T4 switch off (b31_pre_layout_pins.json): %s / %s', async (id, mode) => {
    const v = await loadView();
    const pin = PRE.scenarios.find((x) => x.id === id)!;
    const p = pin.modes[mode]!;
    const ctx = ctxOf(pin.raw, OFF);
    const r = calculateCobCanada(v.toInput(pin.raw, ctx));
    const { left, right } = v.printFigures(r, ctx);
    const main = v.mainFigures(r);
    const more = v.moreFigures(r, ctx);
    const printed = inLegacyOrder([...left, ...right], LEGACY_PRINT);
    const screen = [...main, ...more];
    expect(left.length + right.length, 'print count = the old print count').toBe(p.figuresCount);
    expect(printed).toHaveLength(p.figuresCount);
    expect(main.length + more.length, 'screen count = old main + old more + the hintless Cost of borrowing amount').toBe(p.mainCount + p.moreCount + 1);
    expect(sha(JSON.stringify(printed)), 'figures').toBe(p.figures);
    expect(sha(v.html(v.figureNodes(printed))), 'printFigures').toBe(p.printFigures);
    expect(sha(v.html(v.figureNodes(inLegacyOrder(screen, LEGACY_MAIN)))), 'mainFigures').toBe(p.mainFigures);
    expect(sha(v.html(v.figureNodes(inLegacyOrder(screen, LEGACY_MORE)))), 'moreFigures').toBe(p.moreFigures);
  });
});

// =================================================================================================== T5
describe('B31-T5 (B31-INV-UNPAID): Unpaid interest at end date sits directly after Balance at end date, in print left and in More figures', () => {
  it.each(BOTH)('B31-T5a [%s]: 321.5 -> the 3-tuple directly after Balance at end date; never in right or main', async (_n, sw) => {
    const v = await loadView();
    const raw = rawOf('REF-01');
    const ctx = ctxOf(raw, sw);
    const r = withLastClosing(await resultOf(raw, sw), 321.5);
    const entry = [UNPAID, '$321.50', UNPAID_HINT];
    const { left, right } = v.printFigures(r, ctx);
    const more = v.moreFigures(r, ctx);
    for (const [where, list] of [['print left', left], ['more', more]] as const) {
      const i = names(list).indexOf(BAL);
      expect(i, where).toBeGreaterThanOrEqual(0);
      expect(list[i + 1], where).toEqual(entry);
      expect(list.filter((f) => f[0] === UNPAID), where).toHaveLength(1);
    }
    expect(names(right)).not.toContain(UNPAID);
    expect(names(v.mainFigures(r))).not.toContain(UNPAID);
  });

  const EDGE: [string, number, boolean][] = [['0', 0, false], ['-0.01', -0.01, false], ['Number.MIN_VALUE', Number.MIN_VALUE, true]];
  const edgeCases = EDGE.flatMap(([n, val, present]) => BOTH.map(([s, sw]) => [n, s, val, present, sw] as const));
  it.each(edgeCases)('B31-T5b last closing %s [%s]: present iff > 0 (raw number)', async (_n, _s, val, present, sw) => {
    const v = await loadView();
    const raw = rawOf('REF-01');
    const ctx = ctxOf(raw, sw);
    const r = withLastClosing(await resultOf(raw, sw), val);
    const { left, right } = v.printFigures(r, ctx);
    const all = [...left, ...right, ...v.mainFigures(r), ...v.moreFigures(r, ctx)];
    if (present) {
      expect(left.filter((f) => f[0] === UNPAID)).toEqual([[UNPAID, '$0.00', UNPAID_HINT]]);
      expect(v.moreFigures(r, ctx).filter((f) => f[0] === UNPAID)).toEqual([[UNPAID, '$0.00', UNPAID_HINT]]);
    } else {
      expect(names(all)).not.toContain(UNPAID);
    }
  });

  it.each(BOTH)('B31-T5c [%s]: the B26 shortfall page: $3,015.17 directly after $200,000.00 in print left and More figures', async (_n, sw) => {
    const v = await loadView();
    const ctx = ctxOf(SHORTFALL_RAW, sw);
    const r = await resultOf(SHORTFALL_RAW, sw);
    for (const list of [v.printFigures(r, ctx).left, v.moreFigures(r, ctx)]) {
      const i = names(list).indexOf(BAL);
      expect(list[i]).toEqual([BAL, '$200,000.00']);
      expect(list[i + 1]).toEqual([UNPAID, '$3,015.17', UNPAID_HINT]);
    }
  });
});

// =================================================================================================== T6
describe('B31-T6 (B31-INV-TRIGGER; BR-08): Trigger rate is last in the right column and the main list, exactly when triggerRatePercent !== null', () => {
  it.each(BOTH)('B31-T6a [%s]: a cloned result with 4.2 -> right and main end with the trigger tuple; never in left or more', async (_n, sw) => {
    const v = await loadView();
    const raw = rawOf('REF-01');
    const ctx = ctxOf(raw, sw);
    const r = { ...(await resultOf(raw, sw)), triggerRatePercent: 4.2 };
    const entry = [TRIGGER, '4.20000%', TRIGGER_HINT];
    const { left, right } = v.printFigures(r, ctx);
    expect(right.at(-1)).toEqual(entry);
    expect(v.mainFigures(r).at(-1)).toEqual(entry);
    expect(names(left)).not.toContain(TRIGGER);
    expect(names(v.moreFigures(r, ctx))).not.toContain(TRIGGER);
  });

  it.each(BOTH)('B31-T6b [%s]: a cloned variable result with null -> no list holds Trigger rate', async (_n, sw) => {
    const v = await loadView();
    const raw = rawOf('VRPC_zero_accrued');
    const ctx = ctxOf(raw, sw);
    const r = { ...(await resultOf(raw, sw)), triggerRatePercent: null };
    const { left, right } = v.printFigures(r, ctx);
    expect(names([...left, ...right, ...v.mainFigures(r), ...v.moreFigures(r, ctx)])).not.toContain(TRIGGER);
  });

  it('B31-T6c engine sweep: 4 capture bases x 4 flows x 2 products x 2 rate types x both switch states; Trigger rate exactly for mortgage + variable', async () => {
    const v = await loadView();
    let valid = 0;
    let rejected = 0;
    let withTrigger = 0;
    const bad: string[] = [];
    for (const id of OK_IDS) {
      for (const flow of Object.keys(FLOWS) as CobFlow[]) {
        for (const productType of ['mortgage', 'personalLoan'] as ProductType[]) {
          for (const rateType of ['fixed', 'variable'] as RateType[]) {
            for (const [, sw] of BOTH) {
              const base = rawOf(id);
              const raw: View.RawForm = {
                ...base, flow, productType, rateType, accruedInterest: base.accruedInterest || '0',
                paymentFrequency: productType === 'personalLoan' ? 'monthly' : base.paymentFrequency,
              };
              const ctx = ctxOf(raw, sw);
              let r: CobCanadaResult;
              try {
                r = calculateCobCanada(v.toInput(raw, ctx));
              } catch (e) {
                rejected += 1;
                expect(String(e)).toMatch(/variableRatePaymentChange/); // only VRPC on a non-variable-mortgage is invalid
                continue;
              }
              valid += 1;
              const want = productType === 'mortgage' && rateType === 'variable';
              const { left, right } = v.printFigures(r, ctx);
              const main = v.mainFigures(r);
              const more = v.moreFigures(r, ctx);
              const tag = `${id} ${flow} ${productType}/${rateType} ${sw.financedOption ? 'on' : 'off'}`;
              if ((r.triggerRatePercent !== null) !== want) bad.push(`${tag}: engine trigger ${r.triggerRatePercent}`);
              if (want) {
                withTrigger += 1;
                if (right.at(-1)?.[0] !== TRIGGER || main.at(-1)?.[0] !== TRIGGER) bad.push(`${tag}: trigger not last`);
              } else if (names([...right, ...main]).includes(TRIGGER)) bad.push(`${tag}: unexpected trigger`);
              if (names([...left, ...more]).includes(TRIGGER)) bad.push(`${tag}: trigger on the left`);
            }
          }
        }
      }
    }
    expect(bad).toEqual([]);
    expect(valid).toBe(104);
    expect(rejected).toBe(24);
    expect(withTrigger).toBe(32);
  });
});

// =================================================================================================== T7
describe('B31-T7 (B31-INV-FIN; Q-B31-ON-ORDER): the financed figures follow Balance at end date [and Unpaid interest]; none when off', () => {
  const FIN_CASES: [string, View.RawForm, string[]][] = [
    ['New, no shortfall', rawOf('REF-01'), [BAL, FEES_REC, DISB]],
    ['Renewal', rawOf('RENEWAL'), [BAL, FEES_REC]],
    ['New, shortfall', SHORTFALL_RAW, [BAL, UNPAID, FEES_REC, DISB]],
  ];
  const cases = FIN_CASES.flatMap(([n, raw, tail]) => BOTH.map(([s, sw]) => [n, s, raw, tail, sw] as const));
  it.each(cases)('B31-T7 %s [%s]', async (_n, _s, raw, tail, sw) => {
    const v = await loadView();
    const ctx = ctxOf(raw, sw);
    const r = await resultOf(raw, sw);
    const { left, right } = v.printFigures(r, ctx);
    const more = names(v.moreFigures(r, ctx));
    if (sw.financedOption) {
      expect(more.slice(-tail.length)).toEqual(tail);
      expect(names(left).slice(-tail.length)).toEqual(tail);
      expect(more).toEqual([CALC, NPAY, TERM, ...tail]);
    } else {
      const shipped = tail.filter((l) => l !== FEES_REC && l !== DISB);
      expect(more).toEqual([CALC, NPAY, TERM, ...shipped]);
      const all = names([...left, ...right, ...v.mainFigures(r), ...v.moreFigures(r, ctx)]);
      expect(all).not.toContain(FEES_REC);
      expect(all).not.toContain(DISB);
    }
    expect(names(right)).not.toContain(FEES_REC);
    expect(names(right)).not.toContain(DISB);
  });
});

// =================================================================================================== T8
/** A minimal HTML element tree (ca.html is hand-written and well formed; comments, script and style bodies skipped). */
interface El { tag: string; attrs: Record<string, string>; children: El[]; text: string; parent: El | null }
const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
function parseHtml(src: string): El {
  const text = src.replace(/<!--[\s\S]*?-->/g, '').replace(/<(script|style)\b([^>]*)>[\s\S]*?<\/\1>/gi, '<$1$2></$1>');
  const root: El = { tag: '#root', attrs: {}, children: [], text: '', parent: null };
  let cur = root;
  const re = /<(\/?)([a-zA-Z][\w-]*)((?:\s+[^\s=>/]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*(\/?)>|([^<]+)/g;
  for (const m of text.matchAll(re)) {
    if (m[5] !== undefined) {
      for (let e: El | null = cur; e; e = e.parent) e.text += m[5];
      continue;
    }
    const tag = m[2]!.toLowerCase();
    if (m[1]) {
      let e: El | null = cur;
      while (e && e.tag !== tag) e = e.parent;
      if (e && e.parent) cur = e.parent;
      continue;
    }
    const attrs: Record<string, string> = {};
    for (const a of m[3]!.matchAll(/([^\s=>/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) attrs[a[1]!.toLowerCase()] = a[2] ?? a[3] ?? a[4] ?? '';
    const el: El = { tag, attrs, children: [], text: '', parent: cur };
    cur.children.push(el);
    if (!VOID.has(tag) && !m[4]) cur = el;
  }
  return root;
}
const all = (e: El): El[] => e.children.flatMap((c) => [c, ...all(c)]);
const classes = (e: El) => (e.attrs.class ?? '').split(/\s+/).filter(Boolean);
const sig = (e: El) => `${e.tag}#${e.attrs.id ?? ''}.${classes(e).sort().join('.')}`;
const isInside = (e: El, ancestor: El) => {
  for (let p = e.parent; p; p = p.parent) if (p === ancestor) return true;
  return false;
};

/** CSS rules of the page's <style> blocks, with the @media they sit in. */
interface Rule { media: string | null; selector: string; body: string }
function cssRules(css: string, media: string | null = null): Rule[] {
  const out: Rule[] = [];
  let i = 0;
  while (i < css.length) {
    const open = css.indexOf('{', i);
    if (open < 0) break;
    const prelude = css.slice(i, open).trim();
    let depth = 1;
    let j = open + 1;
    while (j < css.length && depth > 0) {
      if (css[j] === '{') depth += 1;
      else if (css[j] === '}') depth -= 1;
      j += 1;
    }
    const body = css.slice(open + 1, j - 1);
    if (prelude.startsWith('@media')) out.push(...cssRules(body, prelude));
    else if (!prelude.startsWith('@')) out.push({ media, selector: prelude.replace(/\s+/g, ' '), body });
    i = j;
  }
  return out;
}

describe('B31-T8 (B31-INV-DOM, B31-R5, B31-R6, B31-R8): ui/ca.html, static', () => {
  const page = readFileSync(`${ROOT}/ui/ca.html`, 'utf8');
  const doc = parseHtml(page);
  const els = all(doc);
  const byId = (id: string) => els.filter((e) => e.attrs.id === id);
  const css = [...page.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1]!).join('\n').replace(/\/\*[\s\S]*?\*\//g, '');
  const rules = cssRules(css);
  const isPrint = (r: Rule) => r.media !== null && /\bprint\b/.test(r.media);
  const selectorsOf = (r: Rule) => r.selector.split(',').map((s) => s.trim());

  it('B31-T8a: print: div#printFigures.figure-columns holds exactly dl#printFiguresLeft.figures then dl#printFiguresRight.figures; no dl#printFigures', () => {
    const wrap = byId('printFigures');
    expect(wrap, 'exactly one element with id printFigures').toHaveLength(1);
    expect(wrap[0]!.tag, 'the wrapper is a div, not the old dl').toBe('div');
    expect(classes(wrap[0]!)).toContain('figure-columns');
    expect(wrap[0]!.children.map(sig)).toEqual(['dl#printFiguresLeft.figures', 'dl#printFiguresRight.figures']);
    expect(byId('printFiguresLeft')).toHaveLength(1);
    expect(byId('printFiguresRight')).toHaveLength(1);
    expect(page).not.toMatch(/<dl\b[^>]*\bid="printFigures"/);
  });

  it('B31-T8b: the wrapper is inside #printBody, directly after <h2>Results</h2>; no heading, caption or aria-label added', () => {
    const body = byId('printBody')[0]!;
    const wrap = byId('printFigures')[0]!;
    expect(wrap.parent).toBe(body);
    const i = body.children.indexOf(wrap);
    expect(body.children[i - 1]!.tag).toBe('h2');
    expect(body.children[i - 1]!.text.trim()).toBe('Results');
    expect(i).toBe(body.children.length - 1);
    for (const e of [wrap, ...all(wrap)]) {
      expect(Object.keys(e.attrs).filter((a) => a.startsWith('aria-') || a === 'role'), sig(e)).toEqual([]);
    }
  });

  it('B31-T8c: screen block unchanged: #headlineFigures, dl#mainFigures.figures, closed details.disclosure.more-figures, its summary "More figures", dl#moreFigures.figures', () => {
    const order = ['headlineFigures', 'mainFigures', 'moreFigures'].map((id) => byId(id));
    for (const list of order) expect(list).toHaveLength(1);
    const [head, main, more] = order.map((l) => l[0]!);
    expect(sig(main!)).toBe('dl#mainFigures.figures');
    expect(sig(more!)).toBe('dl#moreFigures.figures');
    const details = els.filter((e) => e.tag === 'details' && classes(e).includes('more-figures'));
    expect(details).toHaveLength(1);
    const d = details[0]!;
    expect(classes(d)).toContain('disclosure');
    expect('open' in d.attrs, 'More figures stays collapsed on load').toBe(false);
    const summary = d.children[0]!;
    expect(summary.tag).toBe('summary');
    expect(classes(summary)).toContain('disclosure-summary');
    expect(summary.text.trim()).toBe('More figures');
    expect(isInside(more!, d)).toBe(true);
    expect(isInside(main!, d)).toBe(false);
    const idx = (e: El) => els.indexOf(e);
    expect(idx(head!)).toBeLessThan(idx(main!));
    expect(idx(main!)).toBeLessThan(idx(d));
    expect(idx(d)).toBeLessThan(idx(more!));
    expect(main!.parent).toBe(d.parent);
  });

  it('B31-T8d: CSS: .disclosure-summary and .disclosure-body rules still exist (screen)', () => {
    expect(rules.some((r) => selectorsOf(r).includes('.disclosure-summary'))).toBe(true);
    expect(rules.some((r) => selectorsOf(r).includes('.disclosure-body'))).toBe(true);
  });

  it('B31-T8e: CSS: the print grid selector is ".print-record .print-inputs, .print-record .figure-columns"; ".print-record .figures" is in no grid rule', () => {
    const grids = rules.filter((r) => isPrint(r) && /display\s*:\s*grid/.test(r.body));
    const target = grids.filter((r) => selectorsOf(r).includes('.print-record .figure-columns'));
    expect(target).toHaveLength(1);
    expect(selectorsOf(target[0]!)).toEqual(['.print-record .print-inputs', '.print-record .figure-columns']);
    expect(target[0]!.body).toMatch(/grid-template-columns\s*:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/);
    const gridAny = rules.filter((r) => /\bgrid\b|grid-template/.test(r.body));
    for (const r of gridAny) expect(selectorsOf(r), r.selector).not.toContain('.print-record .figures');
  });

  it('B31-T8f: CSS: no .figure-columns rule outside the print block; no order / grid-auto-flow / direction / absolute positioning in any rule naming the figure columns', () => {
    const naming = rules.filter((r) => /figure-columns|#printFigures(?:Left|Right)?\b/.test(r.selector));
    expect(naming.filter((r) => !isPrint(r)).map((r) => r.selector)).toEqual([]);
    for (const r of naming) {
      expect(r.body, r.selector).not.toMatch(/(?:^|[;\s{])order\s*:|grid-auto-flow|(?:^|[;\s{])direction\s*:|position\s*:\s*(?:absolute|fixed)/);
    }
    // no inline style on the print figure elements either
    for (const id of ['printFigures', 'printFiguresLeft', 'printFiguresRight']) expect(byId(id)[0]?.attrs.style, id).toBeUndefined();
  });
});

// =================================================================================================== T9
describe('B31-T9 (B31-R7): ui/ca.js, static', () => {
  const js = stripComments(readFileSync(`${ROOT}/ui/ca.js`, 'utf8'));
  const importNames = () => {
    const m = js.match(/import\s*\{([^}]*)\}\s*from\s*'\.\/ca-view\.js';/);
    return (m?.[1] ?? '').split(',').map((s) => s.trim()).filter(Boolean).sort();
  };

  it('B31-T9a: the ca-view import list is unchanged (names mainFigures, moreFigures, printFigures; no figureColumns)', () => {
    // B34 (DEC-B34-TERM, B34-R5): the page imports contractTermChoice instead of contractTermParts / contractTermText.
    expect(importNames()).toEqual([
      'contractTermChoice', 'contractTermHint', 'csvFileName', 'firstDateMoveNote', 'isoDay', 'figureNodes', 'flowLabels',
      'formatAmount', 'formatCurrency', 'formatInputDate', 'headlineFigures', 'html', 'label', 'mainFigures', // B33 (DEC-B33-FREQ): frequencyLock removed from the import list
      'moreFigures', 'parseDateInput', 'paymentsText', 'printFeesNodes', 'printFigures', 'printInputNodes', 'printInputRows', 'scheduleCsv',
      'scheduleTableNodes', 'toInput', 'switchedOut', 'UI_SWITCHES',
    ].sort());
    expect(js).not.toMatch(/\bfigureColumns\b|\bamountFigures\b/);
  });

  it("B31-T9b: getElementById('printFiguresLeft') and ('printFiguresRight') bound to printFiguresLeftEl / printFiguresRightEl; no getElementById('printFigures')", () => {
    expect(js).toMatch(/const\s+printFiguresLeftEl\s*=\s*document\.getElementById\(\s*['"]printFiguresLeft['"]\s*\)/);
    expect(js).toMatch(/const\s+printFiguresRightEl\s*=\s*document\.getElementById\(\s*['"]printFiguresRight['"]\s*\)/);
    expect(js).not.toMatch(/getElementById\(\s*['"]printFigures['"]\s*\)/);
    expect(js).not.toMatch(/\bprintFiguresEl\b/);
  });

  it('B31-T9c: renderPrintRecord calls printFigures once with ctx last and renders .left into the left element, .right into the right one', () => {
    expect(js.match(/\bprintFigures\(/g)).toHaveLength(1);
    expect(js).toMatch(/const\s+printColumns\s*=\s*printFigures\(\s*result\s*,\s*ctx\s*\)/);
    expect(js).toMatch(/printFiguresLeftEl\.innerHTML\s*=\s*html\(\s*figureNodes\(\s*printColumns\.left\s*\)\s*\)/);
    expect(js).toMatch(/printFiguresRightEl\.innerHTML\s*=\s*html\(\s*figureNodes\(\s*printColumns\.right\s*\)\s*\)/);
    expect(js).not.toMatch(/printFiguresLeftEl\.innerHTML\s*=[^;]*\.right/);
    expect(js).not.toMatch(/printFiguresRightEl\.innerHTML\s*=[^;]*\.left/);
  });

  it('B31-T9d: the screen code is unchanged: mainFigures into #mainFigures, moreFigures into #moreFigures', () => {
    expect(js).toMatch(/const\s+mainFiguresEl\s*=\s*document\.getElementById\(\s*['"]mainFigures['"]\s*\)/);
    expect(js).toMatch(/const\s+moreFiguresEl\s*=\s*document\.getElementById\(\s*['"]moreFigures['"]\s*\)/);
    expect(js).toMatch(/mainFiguresEl\.innerHTML\s*=\s*html\(\s*figureNodes\(\s*mainFigures\(\s*result\s*\)\s*\)\s*\)/);
    expect(js).toMatch(/moreFiguresEl\.innerHTML\s*=\s*html\(\s*figureNodes\(\s*moreFigures\(\s*result\s*,\s*ctx\s*\)\s*\)\s*\)/);
    expect(js.match(/\bmainFigures\(/g)).toHaveLength(1);
    expect(js.match(/\bmoreFigures\(/g)).toHaveLength(1);
  });
});

// =================================================================================================== T10
describe('B31-T10: every call returns fresh arrays', () => {
  it.each(BOTH)('B31-T10 [%s]: mutating one call\'s output (incl. the hintless tuple) changes neither the next call nor headlineFigures', async (_n, sw) => {
    const v = await loadView();
    const raw = rawOf('VRPC_zero_accrued');
    const ctx = ctxOf(raw, sw);
    const r = await resultOf(raw, sw);
    const snap = () => JSON.stringify([v.printFigures(r, ctx), v.mainFigures(r), v.moreFigures(r, ctx), v.headlineFigures(r)]);
    const before = snap();

    const p = v.printFigures(r, ctx);
    const main = v.mainFigures(r);
    const more = v.moreFigures(r, ctx);
    const head = v.headlineFigures(r);
    p.left[0]![1] = 'X';
    p.right[1]![1] = 'X';
    p.right[1]![0] = 'X';
    p.left.push(['junk', 'junk']);
    p.right.reverse();
    main[1]![1] = 'X';
    (main[1] as string[]).push('a hint');
    main.push(['junk', 'junk']);
    more[0]![1] = 'X';
    more.push(['junk', 'junk']);
    head[1]![1] = 'X';
    head.length = 0;
    expect(snap()).toBe(before);

    // the hintless tuple is not shared with the headline tuple
    const h2 = v.headlineFigures(r);
    const m2 = v.mainFigures(r);
    expect(m2[1]).not.toBe(h2[1]);
    expect(v.printFigures(r, ctx).right[1]).not.toBe(m2[1]);
  });
});

// =================================================================================================== T11
describe('B31-T11 (B31-INV-HINT, view part; Q-B31-DUP-HINT): the Cost of borrowing amount hint is on the printout once and not in the screen list', () => {
  const RAWS: [string, View.RawForm][] = [...OK_IDS.map((id) => [id, rawOf(id)] as [string, View.RawForm]), ['B26 shortfall', SHORTFALL_RAW]];
  const cases = RAWS.flatMap(([id, raw]) => BOTH.map(([n, sw]) => [id, n, raw, sw] as const));
  const count = (hay: string, needle: string) => hay.split(needle).length - 1;
  it.each(cases)('B31-T11 %s [%s]', async (_id, _n, raw, sw) => {
    const v = await loadView();
    const ctx = ctxOf(raw, sw);
    const r = await resultOf(raw, sw);
    const { left, right } = v.printFigures(r, ctx);
    const mainHtml = v.html(v.figureNodes(v.mainFigures(r)));
    const rightHtml = v.html(v.figureNodes(right));
    const leftHtml = v.html(v.figureNodes(left));
    const moreHtml = v.html(v.figureNodes(v.moreFigures(r, ctx)));
    expect(count(mainHtml, COB_HINT), 'main list: no Cost of borrowing amount hint').toBe(0);
    expect(count(mainHtml, `<dt class="figure-label">${COB_AMOUNT}</dt>`), 'main list: the label, with no hint span').toBe(1);
    expect(count(rightHtml, COB_HINT), 'print right: the hint once').toBe(1);
    expect(count(rightHtml, `<span class="figure-hint">${COB_HINT}</span>`)).toBe(1);
    expect(count(rightHtml, COB_AMOUNT)).toBe(1);
    expect(leftHtml).not.toContain(COB_AMOUNT);
    expect(moreHtml).not.toContain(COB_AMOUNT);
    expect(leftHtml + moreHtml).not.toContain(COB_HINT);
    // the printout as a whole: the label and the hint once each
    expect(count(leftHtml + rightHtml, COB_AMOUNT)).toBe(1);
    expect(count(leftHtml + rightHtml, COB_HINT)).toBe(1);
  });
});
