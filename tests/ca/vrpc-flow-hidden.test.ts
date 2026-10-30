/**
 * VRPC-hide (user decision 2026-10-01): the "Variable rate payment change" option of the Flow dropdown is hidden behind
 * `UI_SWITCHES.variableRatePaymentChangeFlow` (shipped false), same mechanism as B28 (a data-switch attribute on the
 * <option>, removed by the existing loop in ui/ca.js through switchedOut). Payment Change already allows mortgage + variable.
 * UI only: the engine flow 'variableRatePaymentChange', its validation and golden_engine_pc_v1.json are untouched.
 *
 * QA red tests, 2026-10-01. Ids: VRPC-PIN-1, PIN-2, T1 to T4. Both switch states run via `it.each(BOTH_VRPC)`.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { calculateCobCanada, FLOWS, requiresSemiAnnualDate } from '../../src/ca/index.js';
import type { CobFlow, ProductType, RateType } from '../../src/ca/index.js';
import type * as View from '../../ui/ca-view.js';
import { ROOT, stripComments } from '../architecture/support.js';
import { loadFixture } from './support/fixtures.js';
import { BOTH_VRPC } from './support/uiSwitches.js';
import type { TestUiSwitches } from './support/uiSwitches.js';

const loadView = () => import('../../ui/ca-view.js') as Promise<typeof View>;
const html = readFileSync(`${ROOT}/ui/ca.html`, 'utf8');
const js = readFileSync(`${ROOT}/ui/ca.js`, 'utf8');
const viewSrc = readFileSync(`${ROOT}/ui/ca-view.js`, 'utf8');
const SW = 'variableRatePaymentChangeFlow';

interface Opt { value: string; text: string; selected: boolean; dataSwitch: string | null }
function flowOptions(): Opt[] {
  const block = /<select\b[^>]*\bid="flow"[^>]*>([\s\S]*?)<\/select>/.exec(html.replace(/<!--[\s\S]*?-->/g, ''));
  if (!block) throw new Error('select#flow not found in ui/ca.html');
  return [...block[1]!.matchAll(/<option\b([^>]*)>([^<]*)<\/option>/g)].map((m) => ({
    value: /\bvalue="([^"]*)"/.exec(m[1]!)?.[1] ?? '',
    text: m[2]!.trim(),
    selected: /\bselected\b/.test(m[1]!),
    dataSwitch: /\bdata-switch="([^"]*)"/.exec(m[1]!)?.[1] ?? null,
  }));
}

const OFF_LIST = ['newMortgageOrLoan', 'renewal', 'paymentChange'];
const ON_LIST = [...OFF_LIST, 'variableRatePaymentChange'];

const ctxFor = (raw: View.RawForm, switches: TestUiSwitches): View.ViewContext => ({
  spec: FLOWS[raw.flow as CobFlow],
  semiAnnual: requiresSemiAnnualDate(raw.productType as ProductType, raw.rateType as RateType),
  switches,
});

describe('VRPC-PIN: the switch object', () => {
  it('VRPC-PIN-1: UI_SWITCHES.variableRatePaymentChangeFlow is false (shipped off), the object is frozen, the other three keys keep their values', async () => {
    const v = await loadView();
    expect(v.UI_SWITCHES).toEqual({ financedOption: false, acceleratedFrequencies: false, contractDateField: false, variableRatePaymentChangeFlow: false });
    expect(Object.isFrozen(v.UI_SWITCHES)).toBe(true);
  });

  it('VRPC-PIN-2: the source declares the key false in UI_SWITCHES, with an ADR-14 comment naming the 2026-10-01 decision', () => {
    const body = /export const UI_SWITCHES\s*=\s*Object\.freeze\(\{([^}]*)\}\)/.exec(viewSrc)?.[1] ?? '';
    const keys = [...body.matchAll(/(\w+):\s*(true|false)\b/g)].map((m) => `${m[1]}=${m[2]}`).sort();
    expect(keys).toEqual(['acceleratedFrequencies=false', 'contractDateField=false', 'financedOption=false', `${SW}=false`]);
    expect(viewSrc).toMatch(/Variable rate payment change[^\n]*hidden|VRPC[^\n]*hidden/i);
  });
});

describe('VRPC-T1: switchedOut follows the new key only', () => {
  it.each(BOTH_VRPC)('%s', async (_l, sw) => {
    const v = await loadView();
    const ctx = ctxFor({ flow: 'newMortgageOrLoan', productType: 'mortgage', rateType: 'fixed' } as View.RawForm, sw);
    expect(v.switchedOut(ctx, SW)).toBe(!sw[SW]);
    expect(v.switchedOut(ctx, 'financedOption')).toBe(true);
    expect(v.switchedOut(ctx, 'acceleratedFrequencies')).toBe(true);
    expect(v.switchedOut(ctx, 'contractDateField')).toBe(true);
  });
});

describe('VRPC-T2: the Flow dropdown on the real ca.html, both states (value pin)', () => {
  it.each(BOTH_VRPC)('%s: options left after the data-switch loop are exactly the expected list, in order', async (_l, sw) => {
    const v = await loadView();
    const ctx = ctxFor({ flow: 'newMortgageOrLoan', productType: 'mortgage', rateType: 'fixed' } as View.RawForm, sw);
    const kept = flowOptions().filter((o) => !(o.dataSwitch !== null && v.switchedOut(ctx, o.dataSwitch)));
    expect(kept.map((o) => o.value)).toEqual(sw[SW] ? ON_LIST : OFF_LIST);
    expect(kept.find((o) => o.value === 'variableRatePaymentChange')?.text).toBe(sw[SW] ? 'Variable rate payment change' : undefined);
  });

  it('shipped (UI_SWITCHES as is): exactly newMortgageOrLoan, renewal, paymentChange', async () => {
    const v = await loadView();
    const ctx = ctxFor({ flow: 'newMortgageOrLoan', productType: 'mortgage', rateType: 'fixed' } as View.RawForm, v.UI_SWITCHES);
    const kept = flowOptions().filter((o) => !(o.dataSwitch !== null && v.switchedOut(ctx, o.dataSwitch)));
    expect(kept.map((o) => o.value)).toEqual(['newMortgageOrLoan', 'renewal', 'paymentChange']);
  });

  it('the first option stays the default and no other flow option carries a data-switch', () => {
    const o = flowOptions();
    expect(o[0]!.value).toBe('newMortgageOrLoan');
    expect(o.filter((x) => x.dataSwitch !== null).map((x) => [x.value, x.dataSwitch])).toEqual([['variableRatePaymentChange', SW]]);
  });
});

describe('VRPC-T3: page and source', () => {
  it('exactly one element in ca.html carries data-switch for the new key', () => {
    expect([...html.matchAll(new RegExp(`data-switch="${SW}"`, 'g'))]).toHaveLength(1);
  });

  it('ca.js holds no VRPC-specific hiding code (the generic data-switch loop does it) and ca-view.js stays DOM-free', () => {
    expect(stripComments(js)).not.toMatch(new RegExp(SW));
    expect(stripComments(viewSrc)).not.toMatch(/\b(document|window|localStorage|sessionStorage|HTMLElement)\b/);
  });

  it('the label for the flow stays in LABELS (print/API for a VRPC calculation), both states', async () => {
    const v = await loadView();
    expect(v.label('flow', 'variableRatePaymentChange')).toBe('Variable rate payment change');
  });
});

describe('VRPC-T4: engine guard, the VRPC flow still calculates (engine unchanged), both states', () => {
  const CAPTURE = loadFixture<{ scenarios: { id: string; raw: View.RawForm }[] }>('a10_ui_capture_v1.json');
  const raw = CAPTURE.scenarios.find((s) => s.id === 'VRPC_zero_accrued')!.raw;

  it('FLOWS still lists variableRatePaymentChange', () => {
    expect(Object.keys(FLOWS)).toContain('variableRatePaymentChange');
  });

  it.each(BOTH_VRPC)('%s: toInput + calculateCobCanada on the captured VRPC scenario succeeds with a schedule', async (_l, sw) => {
    const v = await loadView();
    const res = calculateCobCanada(v.toInput(raw, ctxFor(raw, sw)));
    expect(res.amortizationSchedule.length).toBeGreaterThan(0);
  });

  it('the result is identical in both states (the switch never reaches the engine)', async () => {
    const v = await loadView();
    const [a, b] = BOTH_VRPC.map(([, sw]) => JSON.stringify(calculateCobCanada(v.toInput(raw, ctxFor(raw, sw)))));
    expect(a).toBe(b);
  });
});
