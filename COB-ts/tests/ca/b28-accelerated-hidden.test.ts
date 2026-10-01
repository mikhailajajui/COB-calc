/**
 * B28 (COB-architecture.md section 5 B28, revision 28; user decision 2026-09-30 "Accelerated frequencies hidden"):
 * the Payment frequency dropdown offers Weekly, Bi-weekly, Semi-monthly, Monthly while the UI switch
 * `UI_SWITCHES.acceleratedFrequencies` (shipped false) is off; the two accelerated options come back with one
 * value change. UI only: the engine, goldens, dist/ and the capture fixture are untouched.
 * No hint text where the options were (user, 2026-09-30). Not a deviation from Excel (no DEV ID).
 *
 * QA red tests, 2026-09-30. Ids: B28-PIN-1, PIN-2, T1 to T5. (PIN-3 is the A10-P3 edit; T6 joins B27's file;
 * T7 is the Chrome scripts, recorded at verify.) Both switch states run via `it.each(BOTH_ACCEL)`.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { calculateCobCanada, FLOWS, requiresSemiAnnualDate } from '../../src/ca/index.js';
import type { CobFlow, ProductType, RateType } from '../../src/ca/index.js';
import type * as View from '../../ui/ca-view.js';
import { ROOT, stripComments } from '../architecture/support.js';
import { loadFixture } from './support/fixtures.js';
import { ACCEL_OFF, ACCEL_ON, BOTH_ACCEL } from './support/uiSwitches.js';
import type { TestUiSwitches } from './support/uiSwitches.js';

const loadView = () => import('../../ui/ca-view.js') as Promise<typeof View>;
const html = readFileSync(`${ROOT}/ui/ca.html`, 'utf8');
const js = readFileSync(`${ROOT}/ui/ca.js`, 'utf8');
const viewSrc = readFileSync(`${ROOT}/ui/ca-view.js`, 'utf8');

// --- the <select id="paymentFrequency"> block of ca.html, parsed from text ---

interface Opt { value: string; text: string; selected: boolean; dataSwitch: string | null }
function paymentFrequencyOptions(): Opt[] {
  const block = /<select\b[^>]*\bid="paymentFrequency"[^>]*>([\s\S]*?)<\/select>/.exec(html);
  if (!block) throw new Error('select#paymentFrequency not found in ui/ca.html');
  return [...block[1]!.matchAll(/<option\b([^>]*)>([^<]*)<\/option>/g)].map((m) => ({
    value: /\bvalue="([^"]*)"/.exec(m[1]!)?.[1] ?? '',
    text: m[2]!.trim(),
    selected: /\bselected\b/.test(m[1]!),
    dataSwitch: /\bdata-switch="([^"]*)"/.exec(m[1]!)?.[1] ?? null,
  }));
}

const OFF_LIST: [string, string][] = [
  ['weekly', 'Weekly (52/yr)'],
  ['biweekly', 'Bi-weekly (26/yr)'],
  ['semiMonthly', 'Semi-monthly (24/yr)'],
  ['monthly', 'Monthly (12/yr)'],
];
const ON_LIST: [string, string][] = [
  ['weekly', 'Weekly (52/yr)'],
  ['acceleratedWeekly', 'Accelerated Weekly (52/yr)'],
  ['biweekly', 'Bi-weekly (26/yr)'],
  ['acceleratedBiweekly', 'Accelerated Bi-weekly (26/yr)'],
  ['semiMonthly', 'Semi-monthly (24/yr)'],
  ['monthly', 'Monthly (12/yr)'],
];

const ctxFor = (raw: View.RawForm, switches: TestUiSwitches): View.ViewContext => ({
  spec: FLOWS[raw.flow as CobFlow],
  semiAnnual: requiresSemiAnnualDate(raw.productType as ProductType, raw.rateType as RateType),
  switches,
});

describe('B28-PIN: the switch object', () => {
  it('B28-PIN-1: UI_SWITCHES deep-equals { financedOption: false, acceleratedFrequencies: false, contractDateField: false, variableRatePaymentChangeFlow: false } and is frozen (value pin; B24 adds contractDateField)', async () => {
    const v = await loadView();
    expect(v.UI_SWITCHES).toEqual({ financedOption: false, acceleratedFrequencies: false, contractDateField: false, variableRatePaymentChangeFlow: false });
    expect(Object.isFrozen(v.UI_SWITCHES)).toBe(true);
  });

  it('B28-PIN-2: the source holds the "Switch (ADR-14): shipped false" line at least twice and names the decision', () => {
    // B24 adds a third UI switch (contractDateField): the sentence may appear for it too, so the pin is 'at least the two'.
    expect(viewSrc.split('Switch (ADR-14): shipped false').length - 1).toBeGreaterThanOrEqual(2);
    expect(viewSrc).toContain('Accelerated frequencies hidden');
    // B24: a third key joins; order-independent (the brief fixes the key name and shipped value, not the position).
    const body = /export const UI_SWITCHES\s*=\s*Object\.freeze\(\{([^}]*)\}\)/.exec(viewSrc)?.[1] ?? '';
    const keys = [...body.matchAll(/(\w+):\s*(true|false)\b/g)].map((m) => `${m[1]}=${m[2]}`).sort();
    expect(keys).toEqual(['acceleratedFrequencies=false', 'contractDateField=false', 'financedOption=false', 'variableRatePaymentChangeFlow=false']);
  });
});

describe('B28-T1: switchedOut(ctx, name)', () => {
  it.each(BOTH_ACCEL)('%s: acceleratedFrequencies follows its own switch, financedOption is unaffected', async (_l, sw) => {
    const v = await loadView();
    const ctx = ctxFor({ flow: 'newMortgageOrLoan', productType: 'mortgage', rateType: 'fixed' } as View.RawForm, sw);
    expect(v.switchedOut(ctx, 'acceleratedFrequencies')).toBe(!sw.acceleratedFrequencies);
    expect(v.switchedOut(ctx, 'financedOption')).toBe(true); // financedOption is shipped off in both ACCEL states
  });

  it.each(BOTH_ACCEL)('%s: financedOption on does not bring the accelerated options back, and the reverse', async (_l, sw) => {
    const v = await loadView();
    const raw = { flow: 'newMortgageOrLoan', productType: 'mortgage', rateType: 'fixed' } as View.RawForm;
    const both = ctxFor(raw, { financedOption: true, acceleratedFrequencies: sw.acceleratedFrequencies, contractDateField: false });
    expect(v.switchedOut(both, 'financedOption')).toBe(false);
    expect(v.switchedOut(both, 'acceleratedFrequencies')).toBe(!sw.acceleratedFrequencies);
  });

  it('an unknown switch name counts as off (a typo never shows a node), in both states', async () => {
    const v = await loadView();
    const raw = { flow: 'newMortgageOrLoan', productType: 'mortgage', rateType: 'fixed' } as View.RawForm;
    for (const sw of [ACCEL_ON, ACCEL_OFF]) {
      expect(v.switchedOut(ctxFor(raw, sw), 'noSuchSwitch')).toBe(true);
      expect(v.switchedOut(ctxFor(raw, sw), 'toString')).toBe(true);
    }
  });
});

describe('B28-T2: the option list on the real ca.html, both states', () => {
  it.each(BOTH_ACCEL)('%s: options left after the data-switch loop are the exact list, weekly selected', async (_l, sw) => {
    const v = await loadView();
    const ctx = ctxFor({ flow: 'newMortgageOrLoan', productType: 'mortgage', rateType: 'fixed' } as View.RawForm, sw);
    const kept = paymentFrequencyOptions().filter((o) => !(o.dataSwitch !== null && v.switchedOut(ctx, o.dataSwitch)));
    expect(kept.map((o) => [o.value, o.text])).toEqual(sw.acceleratedFrequencies ? ON_LIST : OFF_LIST);
    expect(kept.filter((o) => o.selected).map((o) => o.value)).toEqual(['weekly']);
  });
});

describe('B28-T3: data-switch attributes in ca.html', () => {
  it('exactly two elements carry data-switch="acceleratedFrequencies" and they are the two accelerated options', () => {
    expect([...html.matchAll(/data-switch="acceleratedFrequencies"/g)]).toHaveLength(2);
    expect(paymentFrequencyOptions().filter((o) => o.dataSwitch === 'acceleratedFrequencies').map((o) => o.value))
      .toEqual(['acceleratedWeekly', 'acceleratedBiweekly']);
  });

  it('every data-switch value in the page is a key of UI_SWITCHES (a typo would silently remove a node)', async () => {
    const v = await loadView();
    const names = [...html.matchAll(/\bdata-switch="([^"]*)"/g)].map((m) => m[1]);
    expect(names.length).toBeGreaterThan(2);
    for (const n of names) expect(Object.keys(v.UI_SWITCHES)).toContain(n);
  });
});

describe('B28-T4: ca.js and ca-view.js source', () => {
  const code = stripComments(js);

  it('ca.js removes switched-out nodes through switchedOut, holds no accelerated literal, and builds no options from allowedPaymentFrequencies', () => {
    expect(code).toMatch(/\bswitchedOut\(/);
    expect(code).toMatch(/\[data-switch\]/);
    expect(code).not.toMatch(/accelerated/i);
    // B27 (B27-R7): ca.js now imports allowedPaymentFrequencies for the Payment frequency LOCK (frequencyLock), which
    // is not the option list: it may be imported and called as the lock's argument, nowhere else. The options still
    // come from ca.html (this test's other half), never from the catalogue.
    const uses = [...code.matchAll(/allowedPaymentFrequencies/g)].length;
    const inImport = /import \{[^}]*\ballowedPaymentFrequencies\b[^}]*\} from '\/dist\/ca\/index\.js'/.test(code) ? 1 : 0;
    const asLockArgument = [...code.matchAll(/frequencyLock\(\s*[\w.]+\s*,\s*allowedPaymentFrequencies\(/g)].length;
    expect(uses).toBe(inImport + asLockArgument);
    expect(code).not.toMatch(/createElement\(\s*['"]option['"]/);
    expect(code).not.toMatch(/\.add\(\s*new Option|new Option\(|\.options\b/);
  });

  it('ca-view.js still has no DOM reference and no import (A10-P1, P2)', () => {
    const src = stripComments(viewSrc);
    expect(src).not.toMatch(/\b(document|window|localStorage|sessionStorage|HTMLElement)\b/);
    expect(src).not.toMatch(/^\s*import\s/m);
  });
});

describe('B28-T5: toInput passes the accelerated values through unchanged (BR-09 guard), both states', () => {
  const CAPTURE = loadFixture<{ scenarios: { id: string; raw: View.RawForm }[] }>('a10_ui_capture_v1.json');
  const base = { ...CAPTURE.scenarios.find((s) => s.id === 'REF-01')!.raw, fees: [] };
  const PAIRS = [['acceleratedWeekly', 'weekly'], ['acceleratedBiweekly', 'biweekly']] as const;

  it.each(BOTH_ACCEL.flatMap(([l, sw]) => PAIRS.map(([acc, reg]) => [l, sw, acc, reg] as const)))(
    '%s: %s is sent unchanged and calculates exactly like %s',
    async (_l, sw, acc, reg) => {
      const v = await loadView();
      const a = v.toInput({ ...base, paymentFrequency: acc }, ctxFor(base, sw));
      const r = v.toInput({ ...base, paymentFrequency: reg }, ctxFor(base, sw));
      expect(a.paymentFrequency).toBe(acc);
      expect(JSON.stringify(calculateCobCanada(a))).toBe(JSON.stringify(calculateCobCanada(r)));
    },
  );
});

// QA verify addition (2026-09-30): brief MUT-7 named "the existing A10 label test", but no test reads the two
// accelerated LABELS entries (no captured scenario selects them). Without this the entry can be deleted unseen, and a
// member's printout for an accelerated value sent through the API/switch-on page would show the raw key.
describe('B28-T8: the print labels for the two accelerated values stay (API / switch-on page), both states', () => {
  const CAPTURE = loadFixture<{ scenarios: { id: string; raw: View.RawForm }[] }>('a10_ui_capture_v1.json');
  const base = { ...CAPTURE.scenarios.find((s) => s.id === 'REF-01')!.raw, fees: [] };
  const EXPECT = [['weekly', 'Weekly'], ['biweekly', 'Bi-weekly'], ['semiMonthly', 'Semi-monthly'], ['monthly', 'Monthly'],
    ['acceleratedWeekly', 'Accelerated Weekly'], ['acceleratedBiweekly', 'Accelerated Bi-weekly']] as const;

  it.each(BOTH_ACCEL.flatMap(([l, sw]) => EXPECT.map(([k, t]) => [l, sw, k, t] as const)))(
    '%s: printInputRows shows "%s" -> "%s"',
    async (_l, sw, key, text) => {
      const v = await loadView();
      const rows = v.printInputRows({ ...base, paymentFrequency: key }, ctxFor(base, sw), '2 years, 11 months, 17 days') as unknown as [string, string][];
      expect(rows.find((r) => r[0] === 'Payment frequency')).toEqual(['Payment frequency', text]);
    },
  );
});
