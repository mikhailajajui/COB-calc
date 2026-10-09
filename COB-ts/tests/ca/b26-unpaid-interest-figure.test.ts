/**
 * B26 (COB-architecture.md section 5 B26, revision 31; user decision Q-B19-ENDACC = yes, 2026-09-29):
 * the on-screen and printed figures gain ONE line, "Unpaid interest at end date" (hint "Unpaid after the last payment; interest since then is not included",
 * changed from "Owed in addition to the balance at end date" by B26-HINT, user 2026-09-30; interim under Q-MSG), ONLY when the last schedule row's
 * `carriedAccruedInterestClosing` is strictly > 0 on the raw number (B26-R3, Q-B26-CENT: no tolerance).
 * UI only: one conditional entry in `moreFigures` (ui/ca-view.js); `printFigures` spreads it. No switch
 * (B26-R8); the line does not read the Financed switch, the flow, the product or the frequency (B26-R5).
 *
 * QA red tests, 2026-09-30. Ids: B26-T1 .. T8, B26-STATIC, B26-FLOWS. Expected labels, hints and
 * strings are literals typed here from the user's decision and from runs of the built engine; nothing
 * is imported from the view. The Chrome steps (capture_a10_ui.mjs, check_print_width.mjs) are the
 * browser half of this task; they are not vitest.
 *
 * B31 edits (QA, 2026-10-05; COB-architecture.md §5 B31, revision 49; DEC-B31-LAYOUT): `printFigures`
 * returns { left, right }; the line is in `left` (= [APR, ...moreFigures]). moreFigures now starts with
 * Calculated rate, Number of payments, Term in days, Balance at end date; the switch-on order is
 * Balance, Unpaid interest, Fees recovered, Disbursal amount (Q-B31-ON-ORDER). The rule "directly
 * after Balance at end date" is unchanged.
 */
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { calculateCobCanada, FLOWS, requiresSemiAnnualDate } from '../../src/ca/index.js';
import type { CobCanadaInput, CobCanadaResult, CobFlow, ProductType, RateType } from '../../src/ca/index.js';
import type * as View from '../../ui/ca-view.js';
import { ROOT } from '../architecture/support.js';
import { utcDate } from './support/builders.js';
import { loadFixture } from './support/fixtures.js';
import { LEAP_OFF, SHIPPED, calculateWith } from './support/switches.js';
import { BOTH, OFF, ON } from './support/uiSwitches.js';
import type { TestUiSwitches } from './support/uiSwitches.js';
// @ts-ignore -- plain .mjs shared with the generators (no .d.ts).
import * as corpusV1 from './fixtures/generate_golden.mjs';
// @ts-ignore -- plain .mjs shared with the generators (no .d.ts).
import * as corpusPc from './fixtures/generate_golden_pc.mjs';

const loadView = () => import('../../ui/ca-view.js') as Promise<typeof View>;

const LABEL = 'Unpaid interest at end date';
const HINT = 'Unpaid after the last payment; interest since then is not included';
const OLD_HINT = 'Owed in addition to the balance at end date';

// --- inputs and contexts ---

interface Capture { scenarios: { id: string; raw: View.RawForm }[] }
const CAPTURE = loadFixture<Capture>('a10_ui_capture_v1.json');
const rawOf = (id: string): View.RawForm => ({ ...CAPTURE.scenarios.find((s) => s.id === id)!.raw });

const ctxFor = (flow: CobFlow, productType: ProductType, rateType: RateType, switches: TestUiSwitches): View.ViewContext => ({
  spec: FLOWS[flow],
  semiAnnual: requiresSemiAnnualDate(productType, rateType),
  switches,
});
const ctxOfRaw = (raw: View.RawForm, switches: TestUiSwitches): View.ViewContext =>
  ctxFor(raw.flow as CobFlow, raw.productType as ProductType, raw.rateType as RateType, switches);

/** The shortfall example of the brief and of the Chrome steps: 200,000 at 5%, monthly, payment 700. */
const SHORTFALL_RAW: View.RawForm = {
  flow: 'newMortgageOrLoan', productType: 'mortgage', rateType: 'fixed', contractDate: '2026-03-10',
  loanAmount: '200000', contractRatePercent: '5', paymentAmount: '700', paymentFrequency: 'monthly',
  firstPaymentDate: '2026-05-01', endDate: '2028-04-15', // B24: no term keys in RawForm
  disbursalDate: '2026-04-01', renewalDate: '2026-01-01', accruedInterest: '', semiAnnualCompoundingDate: '2026-04-01', fees: [],
};
const SHORTFALL_RENEWAL_RAW: View.RawForm = { ...SHORTFALL_RAW, flow: 'renewal', renewalDate: '2026-04-01', accruedInterest: '125.50' };

async function engineResult(raw: View.RawForm, switches: TestUiSwitches = ON): Promise<CobCanadaResult> {
  const v = await loadView();
  return calculateCobCanada(v.toInput(raw, ctxOfRaw(raw, switches)));
}

/** A result whose LAST row holds `value`; every earlier row holds a different positive value (so reading any other row is caught). */
function withLastClosing(result: CobCanadaResult, value: number): CobCanadaResult {
  const rows = result.amortizationSchedule.map((row, i, all) =>
    i === all.length - 1 ? { ...row, carriedAccruedInterestClosing: value } : { ...row, carriedAccruedInterestClosing: 99.99, carriedAccruedInterestOpening: 88.88 });
  return { ...result, amortizationSchedule: rows };
}

const names = (list: View.Figure[]) => list.map((f) => f[0]);
/** B31: both printed columns, left then right (for "contained / not contained" checks). */
const printedAll = (c: View.FigureColumns): View.Figure[] => [...c.left, ...c.right];
/** B31-R2: the fixed head of moreFigures. */
const MORE_HEAD = ['Calculated rate', 'Number of payments', 'Term in days', 'Balance at end date'];
const without = (list: View.Figure[]) => list.filter((f) => f[0] !== LABEL);

// --- B26-T1: the value table, both Financed states ---

// [label of the case, last closing value, line expected, expected value text]
const VALUES: [string, number, boolean, string][] = [
  ['zero', 0, false, ''],
  ['negative zero', -0, false, ''],
  ['negative', -5, false, ''],
  ['NaN', Number.NaN, false, ''],
  ['sub-cent, strict > 0 (Q-B26-CENT)', 0.004, true, '$0.00'],
  ['one cent', 0.01, true, '$0.01'],
  ['12.34', 12.34, true, '$12.34'],
  ['IN-11 only', 125.5, true, '$125.50'],
  ['the shortfall example', 3015.1683939843015, true, '$3,015.17'],
  ['IN-11 plus later shortfalls', 1234567.891, true, '$1,234,567.89'],
];

describe('B26-T1: the line appears iff the last row closing accrued interest is > 0 (raw number), in both Financed states', () => {
  const cases = VALUES.flatMap(([name, value, line, text]) => BOTH.map(([sw, s]) => [name, value, line, text, sw, s] as const));
  it.each(cases)('%s (%s -> line %s %s) [%s]', async (_name, value, line, text, _sw, s) => {
    const v = await loadView();
    const base = await engineResult(rawOf('REF-01'));
    const ctx = ctxOfRaw(rawOf('REF-01'), s);
    const list = v.moreFigures(withLastClosing(base, value), ctx);
    const found = list.filter((f) => f[0] === LABEL);
    if (!line) {
      expect(found).toEqual([]);
      return;
    }
    expect(found).toEqual([[LABEL, text, HINT]]);
  });
});

// --- B26-T2: text, shape, position ---

describe('B26-T2: the entry is a 3-tuple right after "Balance at end date"; the other entries do not change', () => {
  it.each(BOTH)('REF-01 shape with a shortfall [%s]', async (_sw, s) => {
    const v = await loadView();
    const base = await engineResult(rawOf('REF-01'));
    const ctx = ctxOfRaw(rawOf('REF-01'), s);
    const list = v.moreFigures(withLastClosing(base, 500), ctx);
    const i = names(list).indexOf('Balance at end date');
    expect(i).toBeGreaterThanOrEqual(0);
    expect(list[i + 1]).toEqual([LABEL, '$500.00', HINT]);
    expect(list[i + 1]).toHaveLength(3);
    expect(list.filter((f) => f[0] === LABEL)).toHaveLength(1);
    // everything else is what the list is at $0, the line removed
    expect(without(list)).toEqual(v.moreFigures(withLastClosing(base, 0), ctx));
  });

  it('Financed on, New flow (B31, Q-B31-ON-ORDER): order is ..., Balance, Unpaid interest, Fees recovered, Disbursal amount', async () => {
    const v = await loadView();
    const raw = { ...rawOf('REF-01'), fees: [{ name: 'Premium fee', amount: '2,000.00', financed: true }] };
    const list = v.moreFigures(withLastClosing(await engineResult(raw), 321.5), ctxOfRaw(raw, ON));
    expect(names(list)).toEqual([...MORE_HEAD, LABEL, 'Fees recovered through payments', 'Disbursal amount']);
  });

  it('Financed off (shipped), New flow (B31): order is ..., Balance, Unpaid interest', async () => {
    const v = await loadView();
    const list = v.moreFigures(withLastClosing(await engineResult(rawOf('REF-01')), 321.5), ctxOfRaw(rawOf('REF-01'), OFF));
    expect(names(list)).toEqual([...MORE_HEAD, LABEL]);
  });

  it('Financed on, Renewal flow (no Disbursal amount; B31): ..., Balance, Unpaid interest, Fees recovered', async () => {
    const v = await loadView();
    const raw = rawOf('RENEWAL');
    const list = v.moreFigures(withLastClosing(await engineResult(raw), 321.5), ctxOfRaw(raw, ON));
    expect(names(list)).toEqual([...MORE_HEAD, LABEL, 'Fees recovered through payments']);
  });
});

// --- B26-T3: print equals screen ---

describe('B26-T3: printFigures (left column, B31) carries the same entry, at the same relative place, exactly when moreFigures does', () => {
  it.each(BOTH)('with a shortfall [%s]', async (_sw, s) => {
    const v = await loadView();
    const result = withLastClosing(await engineResult(rawOf('REF-01')), 3015.1683939843015);
    const ctx = ctxOfRaw(rawOf('REF-01'), s);
    const screen = v.moreFigures(result, ctx);
    const columns = v.printFigures(result, ctx);
    const print = columns.left;
    expect(printedAll(columns).filter((f) => f[0] === LABEL)).toEqual([[LABEL, '$3,015.17', HINT]]);
    expect(names(columns.right)).not.toContain(LABEL);
    expect(print.slice(1)).toEqual(screen); // B31: the left column under the APR is the screen "More figures" list
    const p = names(print);
    expect(p[p.indexOf('Balance at end date') + 1]).toBe(LABEL);
  });

  it.each(BOTH)('without one: no line in either list [%s]', async (_sw, s) => {
    const v = await loadView();
    const result = withLastClosing(await engineResult(rawOf('REF-01')), 0);
    const ctx = ctxOfRaw(rawOf('REF-01'), s);
    expect(names(v.moreFigures(result, ctx))).not.toContain(LABEL);
    expect(names(printedAll(v.printFigures(result, ctx)))).not.toContain(LABEL);
  });

  it('figureNodes renders the hint as span.figure-hint inside the label, and the value in dd.figure-value', async () => {
    const v = await loadView();
    const result = withLastClosing(await engineResult(rawOf('REF-01')), 3015.1683939843015);
    const entry = v.moreFigures(result, ctxOfRaw(rawOf('REF-01'), OFF)).filter((f) => f[0] === LABEL);
    const html = v.html(v.figureNodes(entry));
    expect(html).toContain(`<span class="figure-hint">${HINT}</span>`);
    expect(html).toContain('<dd class="figure-value">$3,015.17</dd>');
    expect(html).toContain(`>${LABEL}<`);
  });
});

// --- B26-T4: real engine, the shortfall example ---

describe('B26-T4: real engine, the shortfall example (200,000 at 5% monthly, payment 700, first payment 2026-05-01, End 2028-04-15)', () => {
  it.each(BOTH)('last row 2028-04-01, line $3,015.17, balance $200,000.00 before it [%s]', async (_sw, s) => {
    const v = await loadView();
    const result = await engineResult(SHORTFALL_RAW, s);
    const last = result.amortizationSchedule.at(-1)!;
    expect(last.date.toISOString().slice(0, 10)).toBe('2028-04-01'); // the engine facts the figure relies on
    expect(result.amortizationSchedule).toHaveLength(24);
    const list = v.moreFigures(result, ctxOfRaw(SHORTFALL_RAW, s));
    const i = names(list).indexOf('Balance at end date');
    expect(list[i]).toEqual(['Balance at end date', '$200,000.00']);
    expect(list[i + 1]).toEqual([LABEL, '$3,015.17', HINT]);
    const printed = v.printFigures(result, ctxOfRaw(SHORTFALL_RAW, s));
    expect(printedAll(printed).filter((f) => f[0] === LABEL)).toEqual([[LABEL, '$3,015.17', HINT]]);
    const left = names(printed.left);
    expect(left[left.indexOf('Balance at end date') + 1]).toBe(LABEL); // B31-INV-UNPAID: $3,015.17 after $200,000.00 in print left
  });
});

// --- B26-T5: real engine, the capture scenarios with no unpaid interest ---

describe('B26-T5: the four non-error capture scenarios end with no unpaid interest: no line, list as before, both Financed states', () => {
  const ids = ['REF-01', 'S1_fees', 'RENEWAL', 'VRPC_zero_accrued'];
  const cases = ids.flatMap((id) => BOTH.map(([sw, s]) => [id, sw, s] as const));
  it.each(cases)('%s [%s]', async (id, _sw, s) => {
    const v = await loadView();
    const raw = rawOf(id);
    const result = await engineResult(raw, s);
    expect(result.amortizationSchedule.at(-1)!.carriedAccruedInterestClosing).toBe(0); // the premise, measured 2026-09-30
    const ctx = ctxOfRaw(raw, s);
    const list = v.moreFigures(result, ctx);
    expect(names(list)).not.toContain(LABEL);
    expect(names(printedAll(v.printFigures(result, ctx)))).not.toContain(LABEL);
    expect(names(list).slice(0, MORE_HEAD.length)).toEqual(MORE_HEAD); // B31-R2: Term in days now precedes Balance at end date
  });
});

// --- B26-FLOWS: Renewal, Payment Change, VRPC, personal loan, weekly; the flows do not matter (B26-R5) ---

const U = utcDate;
const SHORT_BASE = {
  productType: 'mortgage', rateType: 'fixed', loanAmount: 200000, fees: { fees: [] }, contractRatePercent: 5, paymentAmount: 700,
  paymentFrequency: 'monthly', termYears: 2, termMonths: 0, firstPaymentDate: U('2026-05-01'), endDate: U('2028-04-15'),
  semiAnnualCompoundingDate: U('2026-04-01'),
};
// [name, engine input, expected value text] -- the texts are from runs of the built engine, 2026-09-30.
// The renewal value is the new-flow shortfall 3,015.17 plus the IN-11 accrued interest 125.50 (3,140.67).
const FLOW_CASES: [string, object, string][] = [
  ['Renewal, accrued interest 125.50', { ...SHORT_BASE, flow: 'renewal', renewalDate: U('2026-04-01'), accruedInterest: 125.5 }, '$3,140.67'],
  ['Payment Change, variable, accrued 0', { ...SHORT_BASE, flow: 'paymentChange', rateType: 'variable', semiAnnualCompoundingDate: undefined, renewalDate: U('2026-04-01'), accruedInterest: 0 }, '$3,220.59'],
  ['VRPC, accrued 250.25', { ...SHORT_BASE, flow: 'variableRatePaymentChange', rateType: 'variable', renewalDate: U('2026-04-01'), accruedInterest: 250.25 }, '$3,470.84'],
  ['New personal loan (Monthly only, B27): 10,000 at 12%, payment 30', { ...SHORT_BASE, flow: 'newMortgageOrLoan', productType: 'personalLoan', rateType: 'variable', semiAnnualCompoundingDate: undefined, disbursalDate: U('2026-04-01'), loanAmount: 10000, paymentAmount: 30, contractRatePercent: 12 }, '$1,682.47'],
  ['New mortgage, weekly payment 150', { ...SHORT_BASE, flow: 'newMortgageOrLoan', paymentFrequency: 'weekly', paymentAmount: 150, disbursalDate: U('2026-04-01') }, '$4,684.81'],
];

describe('B26-FLOWS: the figure appears in every flow, product and frequency; the amount is the last row closing value', () => {
  const cases = FLOW_CASES.flatMap(([name, input, text]) => BOTH.map(([sw, s]) => [name, sw, input, text, s] as const));
  it.each(cases)('%s [%s]', async (_name, _sw, input, text, s) => {
    const v = await loadView();
    const i = input as CobCanadaInput;
    // B37 (DEC-B37-LEAP-N): workbook converter (n = 52/26), switch off (the texts are pre-B37 engine runs; only the
    // fixed-mortgage weekly case moves with the leap switch on).
    const result = calculateWith(i, SHIPPED, LEAP_OFF);
    const last = result.amortizationSchedule.at(-1)!;
    expect(last.carriedAccruedInterestClosing).toBeGreaterThan(0);
    const ctx = ctxFor(i.flow as CobFlow, i.productType as ProductType, i.rateType as RateType, s);
    const list = v.moreFigures(result, ctx);
    expect(list.filter((f) => f[0] === LABEL)).toEqual([[LABEL, text, HINT]]);
    expect(names(v.printFigures(result, ctx).left)).toContain(LABEL);
    // it is the bucket alone: not the total interest, not the balance
    expect(list.find((f) => f[0] === LABEL)![1]).not.toBe(v.formatCurrency(result.totalInterest));
  });

  it('Renewal: the new-flow shortfall is raised by exactly the IN-11 accrued interest (125.50), so the figure is the whole bucket', async () => {
    const renewal = calculateCobCanada(FLOW_CASES[0]![1] as CobCanadaInput).amortizationSchedule.at(-1)!.carriedAccruedInterestClosing;
    const fresh = (await engineResult(SHORTFALL_RAW)).amortizationSchedule.at(-1)!.carriedAccruedInterestClosing;
    expect(renewal - fresh).toBeCloseTo(125.5, 9);
  });
});

// --- B26-T6: the golden corpora ---

interface Corpus {
  buildGroups(): { key: string; cases: { label: string; params: object }[] }[];
  makeInput(params: object): CobCanadaInput;
}
interface Swept { key: string; label: string; input: CobCanadaInput; result: CobCanadaResult; value: number }
const sweep = (corpus: Corpus): Swept[] =>
  corpus.buildGroups().flatMap((g) =>
    g.cases.map((c) => {
      const input = corpus.makeInput(c.params);
      const result = calculateCobCanada(input);
      return { key: g.key, label: c.label, input, result, value: result.amortizationSchedule.at(-1)!.carriedAccruedInterestClosing };
    }));

describe('B26-T6: golden-corpus sweep (v1 and Payment Change): the line is present iff the last closing accrued interest is > 0', () => {
  const swept: Record<string, Swept[]> = {};
  beforeAll(() => {
    swept.v1 = sweep(corpusV1 as unknown as Corpus);
    swept.pc = sweep(corpusPc as unknown as Corpus);
  }, 120_000);

  const check = async (cases: Swept[], s: TestUiSwitches) => {
    const v = await loadView();
    let present = 0;
    const bad: string[] = [];
    for (const c of cases) {
      const i = c.input;
      const list = v.moreFigures(c.result, ctxFor(i.flow as CobFlow, i.productType as ProductType, i.rateType as RateType, s));
      const found = list.filter((f) => f[0] === LABEL);
      if (c.value > 0) {
        present++;
        if (found.length !== 1 || found[0]![1] !== v.formatCurrency(c.value) || found[0]![2] !== HINT) bad.push(`${c.key} ${c.label}`);
      } else if (found.length !== 0) bad.push(`${c.key} ${c.label} (unexpected line)`);
    }
    return { present, bad };
  };

  // B33 (DEC-B33-FREQ): the goldens regain the weekly / bi-weekly / semi-monthly personal-loan cases (B33-R8):
  // v1 2,817 -> 4,455 cases, 390 -> 624 positive; PC 2,444 -> 3,536, 260 -> 416. The positive groups are unchanged.
  it.each(BOTH)('v1 corpus (4,455 cases; B33, was 2,817): 624 positive (was 390), line iff > 0, value = the formatted number [%s]', async (_sw, s) => {
    const { present, bad } = await check(swept.v1!, s);
    expect(swept.v1).toHaveLength(4455);
    expect(bad.slice(0, 5)).toEqual([]);
    expect(present).toBe(624);
  }, 60_000);

  it.each(BOTH)('Payment Change corpus (3,536 cases; B33, was 2,444): 416 positive (was 260), line iff > 0, value = the formatted number [%s]', async (_sw, s) => {
    const { present, bad } = await check(swept.pc!, s);
    expect(swept.pc).toHaveLength(3536);
    expect(bad.slice(0, 5)).toEqual([]);
    expect(present).toBe(416);
  }, 60_000);

  it('the positive cases sit in exactly these groups (a corpus change is noticed)', () => {
    const keysOf = (c: Swept[]) => [...new Set(c.filter((x) => x.value > 0).map((x) => x.key))].sort();
    expect(keysOf(swept.v1!)).toEqual(['extra:minimumPayment', 'extra:underpayment']);
    expect(keysOf(swept.pc!)).toEqual(['pcx:underpayment', 'vrpcx:minimumPayment']);
  });

  // B33 (DEC-B33-FREQ): the restored weekly personal-loan underpayment cases have real positive values from 5,092.19, so the
  // old bound (0, 18775) is restated as the risk the test names: no value in (0, 0.005), i.e. nothing that prints as $0.00
  // while the line is shown; plus the measured minimum as a pin (QA, sweep of both corpora on the B33 tree).
  it('no value in (0, 0.005): the engine leaves no float residue that the strict test could show as $0.00; minimum positive pinned', () => {
    const all = [...swept.v1!, ...swept.pc!];
    const tiny = all.filter((c) => c.value > 0 && c.value < 0.005);
    expect(tiny.map((c) => `${c.key} ${c.label} ${c.value}`)).toEqual([]);
    const min = all.filter((c) => c.value > 0).reduce((a, c) => (c.value < a.value ? c : a));
    expect(min.value).toBe(5092.19178082191);
    expect(`${min.key} ${min.label}`).toBe('pcx:underpayment first=2027-07-23 weekly personalLoan/fixed fees=fin2000 flow=pc acc0 payment=200');
  });

  it('named case: first=2028-02-11 monthly mortgage/variable fees=fin2000cash400 flow=renewal850 payment=0.01 shows $27,158.49', async () => {
    const v = await loadView();
    const c = swept.v1!.find((x) => x.label === 'first=2028-02-11 monthly mortgage/variable fees=fin2000cash400 flow=renewal850 payment=0.01');
    expect(c).toBeDefined();
    const i = c!.input;
    const list = v.moreFigures(c!.result, ctxFor(i.flow as CobFlow, i.productType as ProductType, i.rateType as RateType, OFF));
    expect(list.find((f) => f[0] === LABEL)![1]).toBe('$27,158.49');
    // the balance is principal only and is not the unpaid interest (B19)
    expect(list.find((f) => f[0] === 'Balance at end date')![1]).not.toBe('$27,158.49');
  });

  it('named Payment Change case: first=2027-01-01 monthly personalLoan/fixed fees=fin2000 flow=pc acc850 payment=300 shows $20,402.24 and balance $250,000.00 (pcx:underpayment)', async () => {
    const v = await loadView();
    const c = swept.pc!.find((x) => x.label === 'first=2027-01-01 monthly personalLoan/fixed fees=fin2000 flow=pc acc850 payment=300');
    expect(c).toBeDefined();
    const i = c!.input;
    const list = v.moreFigures(c!.result, ctxFor(i.flow as CobFlow, i.productType as ProductType, i.rateType as RateType, OFF));
    expect(list.find((f) => f[0] === LABEL)).toEqual([LABEL, '$20,402.24', HINT]);
    expect(list.find((f) => f[0] === 'Balance at end date')![1]).toBe('$250,000.00');
  });
});

// --- B26-T7: the CSV is unchanged ---

describe('B26-T7: scheduleCsv is unchanged; the last row Accrued (close) cell is the unformatted number behind the figure', () => {
  it.each(BOTH)('one row per payment, same header, last cell = the raw number [%s]', async (_sw, s) => {
    const v = await loadView();
    const result = await engineResult(SHORTFALL_RAW, s);
    const csv = v.scheduleCsv(result.amortizationSchedule, 'all', ctxOfRaw(SHORTFALL_RAW, s));
    const lines = csv.split('\r\n');
    expect(lines.pop()).toBe(''); // every line ends in CRLF
    expect(lines).toHaveLength(1 + 24);
    const header = lines[0]!.split(',');
    const col = header.indexOf('Accrued interest (closing)') >= 0 ? header.indexOf('Accrued interest (closing)') : header.findIndex((h) => /accrued/i.test(h) && /clos/i.test(h));
    expect(col).toBeGreaterThanOrEqual(0);
    expect(lines.at(-1)!.split(',')[col]).toBe(String(3015.1683939843015));
    expect(csv).not.toContain(LABEL);
  });
});

// --- B26-STATIC: what the change must and must not touch ---

describe('B26-STATIC: source facts', () => {
  const src = () => readFileSync(`${ROOT}/ui/ca-view.js`, 'utf8');

  it('the label and the hint are each written once in ca-view.js (two constants; Q-MSG changes one line each)', () => {
    const s = src();
    expect(s.split(LABEL).length - 1).toBe(1);
    expect(s.split(HINT).length - 1).toBe(1);
  });

  it('B26-HINT: the old hint literal is gone from ca-view.js', () => {
    expect(src()).not.toContain(OLD_HINT);
  });

  it('the condition is the raw comparison "> 0" on carriedAccruedInterestClosing: no tolerance, no rounding (B26-R3)', () => {
    const s = src();
    const body = s.slice(s.indexOf('export function moreFigures'), s.indexOf('export function printFigures'));
    expect(body).toContain('carriedAccruedInterestClosing');
    expect(body).toMatch(/[^>=!]>\s*0(?![.\d])/);
    expect(body).not.toMatch(/Math\.(round|abs|floor|ceil)|toFixed|EPS|epsilon|0\.005|>=\s*0(?![.\d])|!==?\s*0\b/);
  });

  it('no new switch: UI_SWITCHES keeps its two keys (B26-R8); B24 adds contractDateField, VRPC-hide adds variableRatePaymentChangeFlow', async () => {
    const v = await loadView();
    expect(Object.keys(v.UI_SWITCHES).sort()).toEqual(['acceleratedFrequencies', 'contractDateField', 'financedOption', 'variableRatePaymentChangeFlow']);
  });

  it('the page code is not edited for B26: ca.js calls moreFigures and printFigures and builds no unpaid-interest text of its own (B26-R1)', () => {
    const js = readFileSync(`${ROOT}/ui/ca.js`, 'utf8');
    expect(js).not.toContain('Unpaid interest');
    expect(js).not.toContain('carriedAccruedInterestClosing');
    expect(readFileSync(`${ROOT}/ui/ca.html`, 'utf8')).not.toContain('Unpaid interest');
  });
});
