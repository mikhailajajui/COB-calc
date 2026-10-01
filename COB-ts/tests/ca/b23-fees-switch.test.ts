/**
 * B23 (COB-architecture.md §5 B23, revision 24; stakeholder decisions 6 and 7, Q-FEE-CSV, F44):
 * the Financed option is a UI switch, `UI_SWITCHES = { financedOption: false }` in ui/ca-view.js.
 * Off: every fee is sent as non-financed; the print fee table loses its Financed column and
 * subtotal; the three fee schedule columns go (screen, print, CSV); the "Fees recovered" and
 * "Disbursal amount" figures go. On: today's page, byte for byte (pinned in a10-ca-view.test.ts
 * A10-C1..C8 by b23_on_state_pins.json; the exact-string tests below).
 *
 * QA red tests, 2026-09-30. Ids: B23-PIN-1..3, T1..T5, T7, T8, T9 (T6 is in a10-ca-view.test.ts,
 * T10 and T11 are Chrome checks run at verify). Both switch states run via `it.each(BOTH)`; the
 * functions take the switches through `ctx.switches`, so vitest reaches both.
 * B23-T8 and the OFF half of T6 wait for the regenerated capture fixture (approved 2026-09-30).
 * The byte-copy fixture a10_ui_capture_financed_on_v1.json was DECLINED by the user (Q-B23-FIX),
 * so the switch-on page is pinned by hashes (b23_on_state_pins.json) and by the exact strings here.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { calculateCobCanada, FLOWS, requiresSemiAnnualDate } from '../../src/ca/index.js';
import type { CobCanadaResult, CobFlow, ProductType, RateType } from '../../src/ca/index.js';
import type * as View from '../../ui/ca-view.js';
import { ROOT, stripComments } from '../architecture/support.js';
import { loadFixture } from './support/fixtures.js';
import { BOTH, OFF, ON } from './support/uiSwitches.js';
import type { TestUiSwitches } from './support/uiSwitches.js';

const loadView = () => import('../../ui/ca-view.js') as Promise<typeof View>;

// --- inputs: the A10 capture's raw forms (REF-01, RENEWAL, VRPC_zero_accrued), with fees added ---

interface Capture { scenarios: { id: string; raw: View.RawForm }[] }
const CAPTURE = loadFixture<Capture>('a10_ui_capture_v1.json');
const rawOf = (id: string): View.RawForm => ({ ...CAPTURE.scenarios.find((s) => s.id === id)!.raw, fees: [] });

const FEES: View.RawFee[] = [
  { name: 'Premium fee', amount: '2,000.00', financed: true },
  { name: 'Cash fee', amount: '500', financed: false },
];
const CASH_FEES: View.RawFee[] = [
  { name: 'Cash fee', amount: '500', financed: false },
  { name: 'Other cash fee', amount: '250', financed: false },
];

const ctxOf = (raw: View.RawForm, switches: TestUiSwitches): View.ViewContext => ({
  spec: FLOWS[raw.flow as CobFlow],
  semiAnnual: requiresSemiAnnualDate(raw.productType as ProductType, raw.rateType as RateType),
  switches,
});

/** The engine result for a raw form, built through toInput under the ON switches (so a financed fee reaches the engine). */
async function resultOf(raw: View.RawForm): Promise<CobCanadaResult> {
  const v = await loadView();
  return calculateCobCanada(v.toInput(raw, ctxOf(raw, ON)));
}

const NEW_RAW = (fees: View.RawFee[]): View.RawForm => ({ ...rawOf('REF-01'), fees });
const RENEWAL_RAW = (fees: View.RawFee[]): View.RawForm => ({ ...rawOf('RENEWAL'), fees });

// --- B23-PIN ---

describe('B23-PIN: the switch object', () => {
  it('B23-PIN-1: UI_SWITCHES.financedOption is false (shipped off) and the object is frozen (B28-R6: the whole-object pin moved to B28-PIN-1)', async () => {
    const v = await loadView();
    expect(v.UI_SWITCHES.financedOption).toBe(false);
    expect(Object.isFrozen(v.UI_SWITCHES)).toBe(true);
  });

  it('B23-PIN-2: the source JSDoc names the switch pattern and the decision', () => {
    const src = readFileSync(`${ROOT}/ui/ca-view.js`, 'utf8');
    expect(src).toContain('Switch (ADR-14): shipped false');
    expect(src).toContain('stakeholder decision 7');
    expect(src).toMatch(/export const UI_SWITCHES\s*=\s*Object\.freeze\(\{\s*financedOption:\s*false\b/); // B28-R6: the whole-object form moved to B28-PIN-1 / PIN-2
  });

  it('B23-PIN-3: FEE_KEYS is exported, frozen, and is exactly the three fee schedule keys; the full column lists stay full', async () => {
    const v = await loadView();
    expect(v.FEE_KEYS).toEqual(['feesOpening', 'feesPaid', 'feesClosing']);
    expect(Object.isFrozen(v.FEE_KEYS)).toBe(true);
    expect(v.COLUMNS).toHaveLength(14);
    expect(v.CSV_COLUMNS).toHaveLength(14);
    expect(v.COMPACT_KEYS).toHaveLength(7);
    expect(v.COMPACT_KEYS).toContain('feesPaid');
  });
});

// --- B23-T1 toInput ---

describe('B23-T1 toInput: financed is sent only while the switch is on', () => {
  it.each(BOTH)('%s', async (_name, sw) => {
    const v = await loadView();
    const raw = NEW_RAW(FEES);
    const sent = v.toInput(raw, ctxOf(raw, sw)).fees!.fees;
    expect(sent.map((f) => f.financed)).toEqual([sw.financedOption, false]);
    expect(sent.map((f) => f.name)).toEqual(['Premium fee', 'Cash fee']);
    expect(sent.map((f) => f.amount)).toEqual([2000, 500]);
  });

  it.each(BOTH)('%s: a non-financed fee is non-financed in both states, and B23-INV-off: off never sends financed true', async (_name, sw) => {
    const v = await loadView();
    const raw = NEW_RAW([{ name: '', amount: '', financed: true }, { name: 'B', amount: '1', financed: false }]);
    const sent = v.toInput(raw, ctxOf(raw, sw)).fees!.fees;
    expect(sent[1]?.financed).toBe(false);
    if (!sw.financedOption) expect(sent.every((f) => f.financed === false)).toBe(true);
  });
});

// --- B23-T2 printFeesNodes ---

describe('B23-T2 printFeesNodes', () => {
  const ON_HTML =
    '<table class="print-fees"><thead><tr><th scope="col">Fee</th><th class="num" scope="col">Amount</th><th scope="col">Financed</th></tr></thead>' +
    '<tbody><tr><td>Premium fee</td><td class="num">$2,000.00</td><td>Yes</td></tr><tr><td>Cash fee</td><td class="num">$500.00</td><td>No</td></tr></tbody></table>' +
    '<p class="fee-subtotals">Financed $2,000.00 · Not financed $500.00</p>';
  const OFF_HTML =
    '<table class="print-fees"><thead><tr><th scope="col">Fee</th><th class="num" scope="col">Amount</th></tr></thead>' +
    '<tbody><tr><td>Premium fee</td><td class="num">$2,000.00</td></tr><tr><td>Cash fee</td><td class="num">$500.00</td></tr></tbody></table>';

  it.each(BOTH)('%s: the printed fee table is exactly the expected HTML', async (_name, sw) => {
    const v = await loadView();
    const out = v.html(v.printFeesNodes(FEES, ctxOf(NEW_RAW(FEES), sw)));
    // The nbsp in "Financed $2,000.00 · Not financed" is how html() serialises spaces.
    const expected = sw.financedOption ? ON_HTML : OFF_HTML;
    expect(out.replace(/ /g, ' ')).toBe(expected.replace(/ /g, ' '));
  });

  it.each(BOTH)('%s: no fees prints "No fees."', async (_name, sw) => {
    const v = await loadView();
    expect(v.html(v.printFeesNodes([], ctxOf(NEW_RAW([]), sw)))).toBe('<p>No fees.</p>');
  });

  it('B23-INV-off: off, the fee HTML holds no "Financed", no "Yes"/"No" cell and no fee-subtotals', async () => {
    const v = await loadView();
    const out = v.html(v.printFeesNodes(FEES, ctxOf(NEW_RAW(FEES), OFF)));
    expect(out).not.toMatch(/Financed|fee-subtotals|Not financed|Not financed|<td>(Yes|No)<\/td>/);
    expect((out.match(/<th /g) ?? []).length).toBe(2);
  });
});

// --- B23-T3 figures ---

describe('B23-T3 moreFigures and printFigures', () => {
  const FLOW_CASES: [string, View.RawForm][] = [['New', NEW_RAW(CASH_FEES)], ['Renewal', RENEWAL_RAW(CASH_FEES)]];

  it.each(BOTH.flatMap(([n, sw]) => FLOW_CASES.map(([f, raw]) => [`${n} / ${f}`, sw, raw] as const)))(
    '%s: exact label list of moreFigures; Disbursal amount only on New and only on; printFigures = headline + main + more',
    async (_name, sw, raw) => {
      const v = await loadView();
      const r = await resultOf(raw);
      const ctx = ctxOf(raw, sw);
      const isNew = raw.flow === 'newMortgageOrLoan';
      const expected = sw.financedOption
        ? ['Fees recovered through payments', 'Balance at end date', ...(isNew ? ['Disbursal amount'] : []), 'Term in days']
        : ['Balance at end date', 'Term in days'];
      const more = v.moreFigures(r, ctx);
      expect(more.map((f) => f[0])).toEqual(expected);
      expect(v.printFigures(r, ctx)).toEqual([...v.headlineFigures(r), ...v.mainFigures(r), ...more]);
      // values are the engine's, unchanged by the switch
      const byLabel = Object.fromEntries(more.map((f) => [f[0], f[1]]));
      expect(byLabel['Balance at end date']).toMatch(/^\$[\d,]+\.\d{2}$/);
      expect(byLabel['Term in days']).toBe(`${new Intl.NumberFormat('en-CA').format(r.termDays)} days`);
    },
  );

  it('B23-INV-on: on, the hint and value of Disbursal amount are today\'s', async () => {
    const v = await loadView();
    const raw = NEW_RAW(FEES);
    const r = await resultOf(raw);
    const d = v.moreFigures(r, ctxOf(raw, ON)).find((f) => f[0] === 'Disbursal amount')!;
    expect(d[2]).toBe('Loan amount less financed fees.');
    expect(d[1]).toBe(v.formatCurrency(r.disbursalAmount));
  });
});

// --- B23-T4 scheduleTableNodes ---

const attr = (n: View.ViewNode, name: string): string | undefined => n.attrs.find(([k]) => k === name)?.[1];
const textOf = (x: View.ViewNode | string): string => (typeof x === 'string' ? x : x.children.map(textOf).join(''));
const kids = (n: View.ViewNode, tag: string): View.ViewNode[] => n.children.filter((c): c is View.ViewNode => typeof c !== 'string' && c.tag === tag);
const colKey = (n: View.ViewNode): string => (attr(n, 'class') ?? '').split(' ').find((c) => c.startsWith('col-') && c !== 'col-extra')!.slice(4);

interface Parsed {
  groupRow: [string, string | undefined][];
  leafKeys: string[];
  topKeys: string[]; // rowspan-2 headings (#, Date, Days)
  bodyRows: View.ViewNode[][];
  yearSpans: string[];
  foot: View.ViewNode[];
  groupNodes: View.ViewNode[];
}
function parse(nodes: View.ViewNode[]): Parsed {
  const thead = nodes.find((n) => n.tag === 'thead')!;
  const [groups, leaves] = kids(thead, 'tr') as [View.ViewNode, View.ViewNode];
  const footRow = kids(nodes.find((n) => n.tag === 'tfoot')!, 'tr')[0]!;
  const groupCells = kids(groups, 'th');
  const tbodies = nodes.filter((n) => n.tag === 'tbody');
  const bodyRows: View.ViewNode[][] = [];
  const yearSpans: string[] = [];
  for (const tb of tbodies) {
    const [yr, ...rest] = kids(tb, 'tr') as [View.ViewNode, ...View.ViewNode[]];
    yearSpans.push(attr(kids(yr, 'th')[0]!, 'colspan')!);
    for (const tr of rest) bodyRows.push(tr.children.filter((c): c is View.ViewNode => typeof c !== 'string'));
  }
  return {
    groupRow: groupCells.filter((c) => attr(c, 'scope') === 'colgroup').map((c) => [textOf(c), attr(c, 'colspan')]),
    topKeys: groupCells.filter((c) => attr(c, 'scope') === 'col').map(colKey),
    leafKeys: kids(leaves, 'th').map(colKey),
    bodyRows,
    yearSpans,
    foot: footRow.children.filter((c): c is View.ViewNode => typeof c !== 'string'),
    groupNodes: groupCells.filter((c) => attr(c, 'scope') === 'colgroup'),
  };
}

const ALL_KEYS_ON = ['period', 'date', 'daysInPeriod', 'openingBalance', 'feesOpening', 'periodInterest', 'carriedAccruedInterestOpening',
  'paymentAmount', 'interestPaid', 'feesPaid', 'principalPortion', 'carriedAccruedInterestClosing', 'feesClosing', 'closingBalance'];
const FEE = ['feesOpening', 'feesPaid', 'feesClosing'];
const COMPACT_ON = ['period', 'date', 'paymentAmount', 'interestPaid', 'feesPaid', 'principalPortion', 'closingBalance'];

describe('B23-T4 scheduleTableNodes: the fee columns are removed before anything else', () => {
  const cases = BOTH.flatMap(([n, sw]) =>
    (['screen', 'print'] as const).flatMap((target) =>
      (['all', 'compact'] as const).map((mode) => [`${n} / ${target} / ${mode}`, sw, target, mode] as const)),
  );

  it.each(cases)('%s: leaf keys, group headings and spans, year rows, body cells and tfoot all follow the column count', async (_name, sw, target, mode) => {
    const v = await loadView();
    const raw = NEW_RAW(FEES);
    const r = await resultOf(raw);
    const nodes = v.scheduleTableNodes(r, target, mode, ctxOf(raw, sw));
    const p = parse(nodes);

    const keysAll = sw.financedOption ? ALL_KEYS_ON : ALL_KEYS_ON.filter((k) => !FEE.includes(k));
    const keysShown = mode === 'compact' ? (sw.financedOption ? COMPACT_ON : COMPACT_ON.filter((k) => !FEE.includes(k))) : keysAll;
    // print builds only the shown columns; the screen builds every column (CSS hides col-extra in compact)
    const built = target === 'print' ? keysShown : keysAll;

    expect([...p.topKeys, ...p.leafKeys].sort()).toEqual([...built].sort());
    // every body row and the tfoot carry one cell per built column, in column order
    const n = built.length;
    expect(p.bodyRows.length).toBe(r.amortizationSchedule.length);
    for (const row of p.bodyRows) expect(row.map(colKey)).toEqual(built);
    expect(p.foot.map(colKey)).toEqual(built);
    expect(p.yearSpans.every((s) => s === String(n))).toBe(true);
    // the headline column counts
    expect(n).toBe(target === 'print' ? (mode === 'all' ? (sw.financedOption ? 14 : 11) : (sw.financedOption ? 7 : 6)) : (sw.financedOption ? 14 : 11));
    if (!sw.financedOption) {
      expect(v.html(nodes)).not.toMatch(/Fees|col-fees/);
    }
  });

  it.each(BOTH)('%s: print / all group headings and colspans (exact)', async (_name, sw) => {
    const v = await loadView();
    const raw = NEW_RAW(FEES);
    const p = parse(v.scheduleTableNodes(await resultOf(raw), 'print', 'all', ctxOf(raw, sw)));
    expect(p.groupRow).toEqual(
      sw.financedOption
        ? [['Opening', '2'], ['Interest', '2'], ['Payment breakdown', '4'], ['Closing', '3']]
        : [['Opening', undefined], ['Interest', '2'], ['Payment breakdown', '3'], ['Closing', '2']],
    );
  });

  it.each(BOTH)('%s: print / compact group headings and colspans (exact)', async (_name, sw) => {
    const v = await loadView();
    const raw = NEW_RAW(FEES);
    const p = parse(v.scheduleTableNodes(await resultOf(raw), 'print', 'compact', ctxOf(raw, sw)));
    expect(p.groupRow).toEqual(
      sw.financedOption
        ? [['Payment breakdown', '4'], ['Closing', undefined]]
        : [['Payment breakdown', '3'], ['Closing', undefined]],
    );
    expect(p.leafKeys).toEqual(sw.financedOption ? ['paymentAmount', 'interestPaid', 'feesPaid', 'principalPortion', 'closingBalance'] : ['paymentAmount', 'interestPaid', 'principalPortion', 'closingBalance']);
  });

  it.each(BOTH)('%s: screen / compact shows 7 (on) or 6 (off) columns after CSS, and the group colspans add up to them', async (_name, sw) => {
    const v = await loadView();
    const raw = NEW_RAW(FEES);
    const p = parse(v.scheduleTableNodes(await resultOf(raw), 'screen', 'compact', ctxOf(raw, sw)));
    const visibleBody = p.bodyRows[0]!.filter((c) => !(attr(c, 'class') ?? '').includes('col-extra')).map(colKey);
    expect(visibleBody).toEqual(sw.financedOption ? COMPACT_ON : COMPACT_ON.filter((k) => !FEE.includes(k)));
    const visibleTop = p.topKeys.filter((k) => ['period', 'date'].includes(k)).length;
    const groupSum = p.groupNodes
      .filter((g) => !(attr(g, 'class') ?? '').includes('col-extra'))
      .reduce((a, g) => a + Number(attr(g, 'colspan')), 0);
    expect(visibleTop + groupSum).toBe(sw.financedOption ? 7 : 6);
  });

  it('B23-INV-off: the non-fee cell texts equal the on-state\'s, column by column, row by row (screen and print, all)', async () => {
    const v = await loadView();
    const raw = NEW_RAW(FEES);
    const r = await resultOf(raw);
    for (const target of ['screen', 'print'] as const) {
      const on = parse(v.scheduleTableNodes(r, target, 'all', ctxOf(raw, ON)));
      const off = parse(v.scheduleTableNodes(r, target, 'all', ctxOf(raw, OFF)));
      expect(off.bodyRows.length).toBe(on.bodyRows.length);
      on.bodyRows.forEach((row, i) => {
        const offByKey = new Map(off.bodyRows[i]!.map((c) => [colKey(c), textOf(c)]));
        for (const c of row) if (!FEE.includes(colKey(c))) expect(offByKey.get(colKey(c)), `${target} row ${i} ${colKey(c)}`).toBe(textOf(c));
      });
      const offFoot = new Map(off.foot.map((c) => [colKey(c), textOf(c)]));
      for (const c of on.foot) if (!FEE.includes(colKey(c))) expect(offFoot.get(colKey(c))).toBe(textOf(c));
    }
  });
});

// --- B23-T5 scheduleCsv ---

describe('B23-T5 scheduleCsv: the CSV drops the fee columns while Financed is off (Q-FEE-CSV)', () => {
  const HEAD_ON_ALL =
    '#,Date,Days,Opening balance,Period interest,Accrued interest (open),Fees (open),Payment,Interest paid,Fees paid,Principal,Accrued interest (close),Fees (close),Balance';
  const HEAD_OFF_ALL = '#,Date,Days,Opening balance,Period interest,Accrued interest (open),Payment,Interest paid,Principal,Accrued interest (close),Balance';
  const HEAD_ON_COMPACT = '#,Date,Payment,Interest paid,Fees paid,Principal,Balance';
  const HEAD_OFF_COMPACT = '#,Date,Payment,Interest paid,Principal,Balance';

  const cases = BOTH.flatMap(([n, sw]) => (['all', 'compact'] as const).map((mode) => [`${n} / ${mode}`, sw, mode] as const));

  it.each(cases)('%s: exact header line; every data line has as many fields as the header; no "Fees" header while off', async (_name, sw, mode) => {
    const v = await loadView();
    const raw = NEW_RAW(FEES);
    const rows = (await resultOf(raw)).amortizationSchedule;
    const csv = v.scheduleCsv(rows, mode, ctxOf(raw, sw));
    const lines = csv.split('\r\n');
    expect(lines.pop()).toBe(''); // every line ends in CRLF
    const head = sw.financedOption ? (mode === 'all' ? HEAD_ON_ALL : HEAD_ON_COMPACT) : mode === 'all' ? HEAD_OFF_ALL : HEAD_OFF_COMPACT;
    expect(lines[0]).toBe(head);
    expect(lines).toHaveLength(rows.length + 1);
    for (const line of lines) expect(line.split(',').length).toBe(head.split(',').length);
    if (!sw.financedOption) expect(lines[0]).not.toMatch(/Fees/);
  });

  it.each(['all', 'compact'] as const)('B23-INV-off / %s: off, the remaining columns keep their order and values (on-state minus the fee fields)', async (mode) => {
    const v = await loadView();
    const raw = NEW_RAW(FEES);
    const rows = (await resultOf(raw)).amortizationSchedule;
    const parseCsv = (s: string) => s.split('\r\n').filter(Boolean).map((l) => l.split(','));
    const on = parseCsv(v.scheduleCsv(rows, mode, ctxOf(raw, ON)));
    const off = parseCsv(v.scheduleCsv(rows, mode, ctxOf(raw, OFF)));
    const drop = on[0]!.map((h, i) => (/^Fees/.test(h) ? i : -1)).filter((i) => i >= 0);
    expect(drop).toHaveLength(mode === 'all' ? 3 : 1);
    expect(off).toEqual(on.map((line) => line.filter((_c, i) => !drop.includes(i))));
    // non-vacuous: the dropped on-state fee cells are non-zero somewhere (a financed fee is in the loan)
    expect(on.slice(1).some((line) => drop.some((i) => Number(line[i]) !== 0))).toBe(true);
  });

  it.each(BOTH)('%s: file name unchanged', async (_name, _sw) => {
    const v = await loadView();
    expect(v.csvFileName('2026-03-23')).toBe('cost-of-borrowing-schedule-2026-03-23.csv');
  });
});

// --- B23-T7 static page checks ---

describe('B23-T7 static: the page source (ui/ca.js, ui/ca.html, ui/ca-view.js)', () => {
  const js = stripComments(readFileSync(`${ROOT}/ui/ca.js`, 'utf8'));
  const page = readFileSync(`${ROOT}/ui/ca.html`, 'utf8');
  const view = stripComments(readFileSync(`${ROOT}/ui/ca-view.js`, 'utf8'));

  /** Argument texts of every `name(…)` call (paren-balanced, strings ignored), excluding declarations. */
  function callsOf(code: string, name: string): string[][] {
    const out: string[][] = [];
    const re = new RegExp(`(?<!function\\s)(?<![\\w$.])${name}\\s*\\(`, 'g');
    for (let m = re.exec(code); m; m = re.exec(code)) {
      let i = m.index + m[0].length;
      let depth = 1;
      let cur = '';
      const args: string[] = [];
      while (i < code.length && depth > 0) {
        const c = code[i];
        if (c === '(' || c === '[' || c === '{') depth += 1;
        if (c === ')' || c === ']' || c === '}') depth -= 1;
        if (depth === 0) break;
        if (c === ',' && depth === 1) { args.push(cur.trim()); cur = ''; } else cur += c;
        i += 1;
      }
      if (cur.trim()) args.push(cur.trim());
      out.push(args);
    }
    return out;
  }

  it('B23-T7a (R1): ui/ca.js has no addFeeRow( call with an argument and none at top level; the only call is the Add fee click handler', () => {
    const calls = callsOf(js, 'addFeeRow');
    expect(calls).toEqual([[]]);
    expect(js).toMatch(/addFeeBtn\.addEventListener\(\s*['"]click['"]\s*,\s*\(\)\s*=>\s*\{\s*addFeeRow\(\);/);
    expect(js).not.toMatch(/CMHC|Appraisal fee/);
  });

  it('B23-T7b (R2): ui/ca.html has no fees-explain block, no CSS rule for it, and no Financed / Not financed explanation', () => {
    expect(page).not.toContain('fees-explain');
    expect(page).not.toContain('the member pays the fee separately');
    expect(page).not.toContain('deducted from the advance');
    expect(page).not.toContain('not added to the principal');
  });

  it('B23-T7c (R4, R5): ui/ca.js passes ctx as the last argument to each changed function at every call site', () => {
    const expectedCounts: Record<string, number> = { scheduleCsv: 1, scheduleTableNodes: 2, printFeesNodes: 1, printFigures: 1, moreFigures: 1, toInput: 1 };
    for (const [name, count] of Object.entries(expectedCounts)) {
      const calls = callsOf(js, name);
      expect(calls, name).toHaveLength(count);
      const arity = name === 'scheduleCsv' || name === 'printFeesNodes' ? (name === 'scheduleCsv' ? 3 : 2) : name === 'scheduleTableNodes' ? 4 : 2;
      for (const args of calls) {
        expect(args, `${name}(${args.join(', ')})`).toHaveLength(arity);
        expect(args[args.length - 1], `${name} last argument`).toMatch(/ctx/i);
      }
    }
  });

  it('B23-T7d (R3): ui/ca.js reads UI_SWITCHES only inside viewContext, which returns switches: UI_SWITCHES', () => {
    expect(js).toMatch(/\bUI_SWITCHES\b/);
    const body = js.match(/function viewContext\s*\([^)]*\)\s*\{([\s\S]*?)\n\}/)?.[1] ?? '';
    expect(body).toMatch(/switches:\s*UI_SWITCHES\b/);
    const outside = js.replace(/function viewContext\s*\([^)]*\)\s*\{[\s\S]*?\n\}/, '').replace(/import\s*\{[^}]*\}\s*from\s*'\.\/ca-view\.js';/, '');
    expect(outside).not.toMatch(/\bUI_SWITCHES\b/);
  });

  it('B23-T7e (R5): the Financed header carries data-switch="financedOption"', () => {
    expect(page).toMatch(/<th[^>]*data-switch="financedOption"[^>]*>\s*Financed\?\s*<\/th>/);
  });

  it('B23-T7f (A10-P1 stays): ui/ca-view.js has no import, no DOM reference, and reads the switch from ctx', () => {
    expect(view).not.toMatch(/^\s*import\s/m);
    expect(view).not.toMatch(/\b(document|window|localStorage|sessionStorage|navigator|Blob)\b/);
    expect(view).toMatch(/ctx\.switches/);
  });
});

// --- B23-T8 the regenerated capture (waits for QA's regeneration after sr-dev) ---

describe('B23-T8 formDefaults in the regenerated capture', () => {
  it('B23-T8: a fresh page has 0 fee rows, 0 Financed controls, Name / Amount / Actions headers and no fee explanation', () => {
    const cap = loadFixture<{ formDefaults?: Record<string, unknown>; provenance: { tree: string } }>('a10_ui_capture_v1.json');
    expect(cap.provenance.tree).toBe('post-B24 (Contract term derived; Contract date and Semi-annual date hidden)'); // B24: written by capture_a10_ui.mjs at the regeneration; red until then
    expect(Object.keys(cap.formDefaults ?? {}).sort()).toEqual(['feeRows', 'feeTableHeaders', 'financedControls', 'printFeeExplanation']);
    expect(cap.formDefaults!.feeRows).toBe(0);
    expect(cap.formDefaults!.financedControls).toBe(0);
    expect(cap.formDefaults!.printFeeExplanation).toBe(false);
    // measured on the page 2026-09-30 (the brief's third entry "" is the visually-hidden Actions header)
    expect(cap.formDefaults!.feeTableHeaders).toEqual(['Name', 'Amount ($)', 'Actions']);
  });
});

// --- B23-T9 engine fact (passes already) ---

describe('B23-T9 engine fact: with only non-financed fees the hidden columns and figures hold nothing', () => {
  const CASES: [string, () => View.RawForm][] = [
    ['New mortgage', () => NEW_RAW([])],
    ['New personal loan', () => ({ ...rawOf('ERR_blank_rate'), contractRatePercent: '6.5', fees: [] })],
    ['Renewal', () => RENEWAL_RAW([])],
    ['Payment Change', () => ({ ...RENEWAL_RAW([]), flow: 'paymentChange' })],
    ['VRPC', () => ({ ...rawOf('VRPC_zero_accrued') })],
    ['semi-monthly', () => ({ ...NEW_RAW([]), paymentFrequency: 'semiMonthly', firstPaymentDate: '2026-04-01' })],
  ];

  it.each(CASES)('%s: cash fees only -> feesOpening / feesPaid / feesClosing 0 on every row, feesRecovered 0, disbursal = loan', async (_name, make) => {
    const raw = { ...make(), fees: CASH_FEES };
    const r = await resultOf(raw);
    for (const row of r.amortizationSchedule) {
      expect(row.feesOpening).toBe(0);
      expect(row.feesPaid).toBe(0);
      expect(row.feesClosing).toBe(0);
    }
    expect(r.feesRecovered).toBe(0);
    if (raw.flow === 'newMortgageOrLoan') expect(r.disbursalAmount).toBe(Number(raw.loanAmount.replace(/,/g, '')));
  });

  it.each(CASES.filter(([n]) => n !== 'VRPC' && n !== 'Payment Change'))('%s: one financed fee makes the same columns non-zero (the engine still produces them)', async (_name, make) => {
    const raw = { ...make(), fees: [{ name: 'Financed', amount: '500', financed: true }] };
    const r = await resultOf(raw);
    expect(Math.max(...r.amortizationSchedule.map((row) => row.feesOpening))).toBeGreaterThan(0);
    expect(Math.max(...r.amortizationSchedule.map((row) => row.feesPaid))).toBeGreaterThan(0);
    expect(r.feesRecovered).toBeGreaterThan(0);
  });
});
