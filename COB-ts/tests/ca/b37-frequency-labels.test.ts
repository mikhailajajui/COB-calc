/**
 * B37-T10 (COB-architecture.md §5 B37 addendum, revision 57: rules B37-L4 / L5; user answers Q-B37-LABEL and, mid-task on
 * 2026-10-09, "DEC-B37-LEAP-N: label format" = NO DECIMALS, which supersedes the addendum's interim 2-decimal default).
 * QA-owned; the developer must not edit this file.
 *
 * The per-year figure in each Payment frequency option is the engine's n for the current inputs (paymentsPerYearFor from
 * the public barrel), shown rounded to the nearest whole number (display only, never read back). Because the leap-aware
 * n always lies in 52.14..52.29 (weekly) and 26.07..26.14 (bi-weekly), the visible texts equal today's static labels; the
 * tests therefore pin (a) the formatter on numbers that DO round differently (so the text is computed from its argument,
 * not hard-coded), (b) that the label number is Math.round of the engine's n, and (c) source guards that ca.js feeds
 * every option from paymentsPerYearFor. Not in test:tz (no local-time dates).
 *
 * Invariants: INV-LABEL-TEXT, INV-LABEL-STATIC, INV-LABEL-UI, and the page texts per leap state (it.each(BOTH_LEAP)).
 * Red until sr-dev adds frequencyOptionText (ca-view.js), paymentsPerYearFor (barrel) and renderFrequencyLabels (ca.js).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as ca from '../../src/ca/index.js';
import { PAYMENTS_PER_YEAR } from '../../src/ca/index.js';
import type { CobCanadaInput, PaymentFrequency } from '../../src/ca/index.js';
import * as equations from '../../src/ca/equations.js';
import type * as View from '../../ui/ca-view.js';
import { ROOT, stripComments } from '../architecture/support.js';
import { asInput, utcDate } from './support/builders.js';
import { BOTH_LEAP } from './support/switches.js';

const loadView = () => import('../../ui/ca-view.js') as Promise<typeof View>;
const html = readFileSync(`${ROOT}/ui/ca.html`, 'utf8');
const js = stripComments(readFileSync(`${ROOT}/ui/ca.js`, 'utf8'));
const viewSrc = stripComments(readFileSync(`${ROOT}/ui/ca-view.js`, 'utf8'));

type Fn = (...args: never[]) => unknown;
function fnOf<T extends Fn>(mod: object, name: string): T {
  const f = (mod as Record<string, unknown>)[name];
  if (typeof f !== 'function') throw new Error(`B37: ${name} is not exported yet`);
  return f as T;
}
const paymentsPerYearFor = (x: CobCanadaInput, f: string): number => fnOf<(x: CobCanadaInput, f: string) => number>(ca, 'paymentsPerYearFor')(x, f);
const conversionPaymentsPerYear = (x: CobCanadaInput, f: PaymentFrequency, leap: boolean): number =>
  fnOf<(p: string, r: string, f: string, s: Date | undefined, e: Date | undefined, l: boolean) => number>(equations, 'conversionPaymentsPerYear')(
    x.productType,
    x.rateType,
    f,
    x.flow === 'newMortgageOrLoan' ? x.disbursalDate : x.renewalDate,
    x.endDate,
    leap,
  );
const text = async (f: string, n: number): Promise<string> => {
  const v = await loadView();
  return fnOf<(f: string, n: number) => string>(v, 'frequencyOptionText')(f, n);
};

interface Opt { value: string; text: string; attrs: string }
function paymentFrequencyOptions(): Opt[] {
  const block = /<select\b[^>]*\bid="paymentFrequency"[^>]*>([\s\S]*?)<\/select>/.exec(html);
  if (!block) throw new Error('select#paymentFrequency not found in ui/ca.html');
  return [...block[1]!.matchAll(/<option\b([^>]*)>([^<]*)<\/option>/g)].map((m) => ({
    value: /\bvalue="([^"]*)"/.exec(m[1]!)?.[1] ?? '',
    text: m[2]!.trim(),
    attrs: m[1]!,
  }));
}

/** The page's default inputs = REF-01 (New mortgage, fixed, Disbursal 2026-03-17, End 2029-03-17). */
const REF01: CobCanadaInput = asInput({
  flow: 'newMortgageOrLoan', productType: 'mortgage', rateType: 'fixed', loanAmount: 227829.65, contractRatePercent: 3.74,
  paymentAmount: 465.46, paymentFrequency: 'weekly', disbursalDate: utcDate('2026-03-17'), firstPaymentDate: utcDate('2026-03-23'),
  endDate: utcDate('2029-03-17'), fees: { fees: [] },
});
const SHOWN: PaymentFrequency[] = ['weekly', 'biweekly', 'semiMonthly', 'monthly'];

// ================================================================================================ INV-LABEL-TEXT
describe('B37-T10 INV-LABEL-TEXT: frequencyOptionText(frequency, n) = `${label} (${Math.round(n)}/yr)` (no decimals)', () => {
  it.each([
    ['weekly', 52, 'Weekly (52/yr)'],
    ['biweekly', 26, 'Bi-weekly (26/yr)'],
    ['semiMonthly', 24, 'Semi-monthly (24/yr)'],
    ['monthly', 12, 'Monthly (12/yr)'],
    ['acceleratedWeekly', 52, 'Accelerated Weekly (52/yr)'],
    ['acceleratedBiweekly', 26, 'Accelerated Bi-weekly (26/yr)'],
    // leap-aware n (the brief's C3 values): whole numbers, no decimals
    ['biweekly', 26.095568783068778, 'Bi-weekly (26/yr)'],
    ['weekly', 52.191137566137556, 'Weekly (52/yr)'],
    ['biweekly', 26.087423312883434, 'Bi-weekly (26/yr)'],
    ['weekly', 52.1904761904762, 'Weekly (52/yr)'],
    ['weekly', 52.285714285714285, 'Weekly (52/yr)'],
    ['biweekly', 26.142857142857142, 'Bi-weekly (26/yr)'],
    ['biweekly', 26.071428571428573, 'Bi-weekly (26/yr)'],
    ['acceleratedBiweekly', 26.085714285714282, 'Accelerated Bi-weekly (26/yr)'],
    // computed from the argument, not a fixed table: numbers that round elsewhere
    ['weekly', 53.4, 'Weekly (53/yr)'],
    ['weekly', 51.6, 'Weekly (52/yr)'],
    ['weekly', 51.4, 'Weekly (51/yr)'],
    ['biweekly', 26.6, 'Bi-weekly (27/yr)'],
    ['biweekly', 25.2, 'Bi-weekly (25/yr)'],
    ['monthly', 13, 'Monthly (13/yr)'],
    ['semiMonthly', 23.7, 'Semi-monthly (24/yr)'],
    ['xyz', 52, 'xyz (52/yr)'], // label fallback
  ] as const)('(%s, %f) -> %s', async (f, n, expected) => {
    expect(await text(f, n)).toBe(expected);
  });

  it('for every n in [365/14, 366/7] (2,000 steps): the text is the label plus Math.round(n), with no decimal point', async () => {
    const v = await loadView();
    const bad: string[] = [];
    for (let i = 0; i <= 2000; i += 1) {
      const n = 365 / 14 + ((366 / 7 - 365 / 14) * i) / 2000;
      for (const f of ['weekly', 'biweekly'] as const) {
        const t = await text(f, n);
        if (t !== `${v.label('paymentFrequency', f)} (${Math.round(n)}/yr)` || t.includes('.')) bad.push(`${f} ${n}: ${t}`);
      }
    }
    expect(bad.slice(0, 5)).toEqual([]);
  });
});

// ================================================================================================ INV-LABEL-STATIC
describe('B37-T10 INV-LABEL-STATIC: ui/ca.html keeps its static texts, equal to frequencyOptionText(value, PAYMENTS_PER_YEAR[value])', () => {
  it('six options, each text equal to the formatter at the base n (the no-script and switch-off texts)', async () => {
    const opts = paymentFrequencyOptions();
    expect(opts.map((o) => o.value)).toEqual(['weekly', 'acceleratedWeekly', 'biweekly', 'acceleratedBiweekly', 'semiMonthly', 'monthly']);
    for (const o of opts) expect(o.text, o.value).toBe(await text(o.value, PAYMENTS_PER_YEAR[o.value as PaymentFrequency]));
  });
});

// ================================================================================================ page texts per state
describe('B37-T10 page texts on the default inputs (REF-01 dates), both leap states', () => {
  it.each(BOTH_LEAP)('[%s] Weekly (52/yr), Bi-weekly (26/yr), Semi-monthly (24/yr), Monthly (12/yr); each number is Math.round of the engine n', async (_label, leap) => {
    const texts: string[] = [];
    for (const f of SHOWN) {
      const n = leap ? paymentsPerYearFor(REF01, f) : conversionPaymentsPerYear(REF01, f, false);
      expect(Math.round(n), f).toBe(PAYMENTS_PER_YEAR[f]);
      texts.push(await text(f, n));
    }
    expect(texts).toEqual(['Weekly (52/yr)', 'Bi-weekly (26/yr)', 'Semi-monthly (24/yr)', 'Monthly (12/yr)']);
    if (leap) {
      // the on-state numbers are the leap-aware n (not integers), so the label really is computed and rounded
      expect(paymentsPerYearFor(REF01, 'weekly')).toBe(52.1904761904762);
      expect(paymentsPerYearFor(REF01, 'biweekly')).toBe(26.0952380952381);
    } else {
      expect(conversionPaymentsPerYear(REF01, 'weekly', false)).toBe(52);
      expect(conversionPaymentsPerYear(REF01, 'biweekly', false)).toBe(26);
    }
  });
});

// ================================================================================================ INV-LABEL-UI
describe('B37-T10 INV-LABEL-UI source guards (ca.js / ca-view.js / ca.html)', () => {
  const importList = (re: RegExp): string[] => {
    const m = re.exec(js);
    if (!m) return [];
    return m[1]!.split(',').map((s) => s.trim()).filter(Boolean);
  };

  it('ca.js imports paymentsPerYearFor only from /dist/ca/index.js and frequencyOptionText from ./ca-view.js', () => {
    expect(importList(/import\s*\{([^}]*)\}\s*from\s*'\/dist\/ca\/index\.js';/)).toContain('paymentsPerYearFor');
    expect(importList(/import\s*\{([^}]*)\}\s*from\s*'\.\/ca-view\.js';/)).toContain('frequencyOptionText');
    expect(js.match(/\bpaymentsPerYearFor\b/g)?.length ?? 0).toBe(2); // the import and the one call
  });

  it('renderFrequencyLabels(input) is called in recompute after toInput( and before calculateCobCanada(', () => {
    const start = js.indexOf('function recompute(');
    expect(start).toBeGreaterThan(-1);
    const body = js.slice(start, js.indexOf('\n}', start));
    const a = body.indexOf('toInput(');
    const b = body.indexOf('renderFrequencyLabels(input)');
    const c = body.indexOf('calculateCobCanada(');
    expect(a).toBeGreaterThan(-1);
    expect(b).toBeGreaterThan(a);
    expect(c).toBeGreaterThan(b);
  });

  it('renderFrequencyLabels sets every option\'s textContent from frequencyOptionText(option.value, paymentsPerYearFor(input, option.value)) and nothing else', () => {
    const start = js.indexOf('function renderFrequencyLabels(input)');
    expect(start).toBeGreaterThan(-1);
    const body = js.slice(start, js.indexOf('\n}', start));
    expect(body).toMatch(/paymentFrequencyEl\.querySelectorAll\('option'\)/);
    expect(body).toMatch(/\.textContent\s*=\s*frequencyOptionText\(\s*option\.value\s*,\s*paymentsPerYearFor\(\s*input\s*,\s*option\.value\s*\)\s*\)/);
    expect(body).not.toMatch(/innerHTML|\.value\s*=[^=]|selected|\.selectedIndex|createElement|appendChild|\.add\(/);
  });

  it('no second formula in the UI: ca.js and ca-view.js contain no 365, 366, dayCountFraction, daysBetween, leapAware', () => {
    for (const [name, src] of [['ca.js', js], ['ca-view.js', viewSrc]] as const) {
      expect(src, name).not.toMatch(/\b36[56]\b|dayCountFraction|daysBetween|leapAware/);
    }
  });

  it('the option text is never read back: ca.js has no selectedText(paymentFrequencyEl); ca.html gives #paymentFrequency no aria-label / aria-live', () => {
    expect(js).not.toMatch(/selectedText\(\s*paymentFrequencyEl\s*\)/);
    const sel = /<select\b([^>]*)\bid="paymentFrequency"([^>]*)>/.exec(html);
    expect(sel).not.toBeNull();
    expect(`${sel![1]}${sel![2]}`).not.toMatch(/aria-label|aria-live/);
    for (const o of paymentFrequencyOptions()) expect(o.attrs, o.value).not.toMatch(/aria-/);
    expect(html).toMatch(/<label for="paymentFrequency">Payment frequency<\/label>/);
  });

  it('frequencyOptionText is pure: no import in ca-view.js, and it shows no decimals (no toFixed / fraction digits for the label)', () => {
    expect(viewSrc).not.toMatch(/^\s*import\b/m);
    const start = viewSrc.indexOf('export function frequencyOptionText(');
    expect(start).toBeGreaterThan(-1);
    const body = viewSrc.slice(start, viewSrc.indexOf('\n}', start));
    expect(body).not.toMatch(/toFixed|FractionDigits/);
  });
});
