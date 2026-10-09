/**
 * B27 rule reversed by B33 (DEC-B33-FREQ, 2026-10-05). This file keeps its name (Q-B33-B27FILE default: rewritten in place,
 * no rename or deletion); its tests now pin the B33 facts where B27's rule was, and keep B27's still-true pins.
 *
 * History: B27 (COB-architecture.md section 5 B27, revision 29; user decisions 2026-09-30; DEV-FB24) made a personal loan
 * Monthly only (engine rejection in validate.ts through the catalogue src/ca/products.ts, page lock `frequencyLock` with the
 * hint "Personal loans are paid monthly.", goldens reshaped 148 -> 94 / 122 -> 86 groups). B33 (section 5 B33, revision 51)
 * removes the rule outright, no switch: the catalogue `allowedPaymentFrequencies` stays exported and gives the same six
 * frequencies for both products; validate.ts no longer reads it; the page lock, its hint and the hint span are deleted;
 * the goldens regain the personal-loan groups (the Payment Change golden equals the archived pre-B27 fixture again).
 *
 * Kept as they were (still true after B33): T5 (mortgages), T10 (no full mode in the live generators), T12 (rehome helper,
 * Q-B33-LEGACY), T13 (frozen pre-B27 generators), T14 (equation basis). Inverted to B33 (QA red step, 2026-10-05): T1, T2,
 * T3, T4, INV, T6 (last test), T7, T8, T9, T11. Red until sr-dev applies B33-R1 / R2 / R5 and regenerates the goldens (R8).
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PAYMENTS_PER_YEAR, calculateCobCanada, collectInputIssues } from '../../src/ca/index.js';
import type { CobCanadaInput, CobFlow, PaymentFrequency, ProductType, RateType } from '../../src/ca/index.js';
import { calculatedRateFor, selectCompoundingPeriodsPerYear, selectRateBasis } from '../../src/ca/equations.js';
import { validateCobCanadaInput } from '../../src/ca/validate.js';
import type * as View from '../../ui/ca-view.js';
import { ROOT, listFiles, read, rel, stripComments } from '../architecture/support.js';
import { asInput, utcDate } from './support/builders.js';
import { expectRangeErrorMatching } from './support/compare.js';
import { FIXTURES_DIR } from './support/fixtures.js';
import { frequenciesFor } from './support/products.js';
import { preB37GoldenText } from './support/preB37Golden.js';
import { rehome, rehomeCase } from './support/rehome.js';
// @ts-ignore -- plain .mjs (no .d.ts): the LIVE (reshaped) generators.
import * as gen1 from './fixtures/generate_golden.mjs';
// @ts-ignore -- plain .mjs (no .d.ts).
import * as genPc from './fixtures/generate_golden_pc.mjs';

const loadView = () => import('../../ui/ca-view.js') as Promise<typeof View>;
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

const ALL_FREQS = Object.keys(PAYMENTS_PER_YEAR) as PaymentFrequency[];
const NON_MONTHLY = ALL_FREQS.filter((f) => f !== 'monthly');
const FLOW_IDS: CobFlow[] = ['newMortgageOrLoan', 'renewal', 'paymentChange', 'variableRatePaymentChange'];
const RATES: RateType[] = ['fixed', 'variable'];

// B33 (DEC-B33-FREQ): B27's interim message "paymentFrequency '<f>' is not allowed for productType '<p>' (allowed: ...)" is retired.

/** A valid input for (flow, product, rate, frequency); fixed mortgages carry their semi-annual date. */
function input(flow: CobFlow, productType: ProductType, rateType: RateType, paymentFrequency: string, over: Record<string, unknown> = {}): CobCanadaInput {
  const start = utcDate('2027-01-01');
  return asInput({
    flow,
    productType,
    rateType,
    loanAmount: 100000,
    fees: { fees: [] },
    contractRatePercent: 6,
    paymentAmount: 600,
    paymentFrequency,
    firstPaymentDate: utcDate('2027-02-01'),
    endDate: utcDate('2028-02-01'),
    termYears: 1,
    termMonths: 0,
    ...(flow === 'newMortgageOrLoan' ? { disbursalDate: start } : { renewalDate: start, accruedInterest: 0 }),
    ...(productType === 'mortgage' && rateType === 'fixed' ? { semiAnnualCompoundingDate: start } : {}),
    ...over,
  });
}

/** Independent oracle of the flow locks (VRPC: mortgage + variable; Renewal has no lock since 2026-10-01). */
function flowLockOk(flow: CobFlow, productType: ProductType, rateType: RateType): boolean {
  if (flow === 'variableRatePaymentChange') return productType === 'mortgage' && rateType === 'variable';
  return true;
}

// ---------------------------------------------------------------------------------------------------------------
describe('B27-T1 catalogue: allowedPaymentFrequencies (src/ca/products.ts, read through the barrel); B33 (DEC-B33-FREQ): both products give the six', () => {
  it('mortgage allows all six frequencies, in PAYMENTS_PER_YEAR order', () => {
    expect([...frequenciesFor('mortgage')]).toEqual(Object.keys(PAYMENTS_PER_YEAR));
    expect(frequenciesFor('mortgage')).toHaveLength(6);
  });

  // B33 (DEC-B33-FREQ): was ['monthly'] (B27). The personal loan's list is the mortgage's list, the same object.
  it('personal loan allows all six frequencies, the same list object as the mortgage', () => {
    expect([...frequenciesFor('personalLoan')]).toEqual(Object.keys(PAYMENTS_PER_YEAR));
    expect(frequenciesFor('personalLoan')).toBe(frequenciesFor('mortgage'));
  });

  it('every allowed frequency is a key of PAYMENTS_PER_YEAR', () => {
    for (const p of ['mortgage', 'personalLoan'] as const)
      for (const f of frequenciesFor(p)) expect(Object.hasOwn(PAYMENTS_PER_YEAR, f), `${p}/${f}`).toBe(true);
  });

  it('the catalogue function is on both barrels and is the same binding', async () => {
    const ca = (await import('../../src/ca/index.js')) as Record<string, unknown>;
    const root = (await import('../../src/index.js')) as Record<string, unknown>;
    expect(typeof ca['allowedPaymentFrequencies']).toBe('function');
    expect(root['allowedPaymentFrequencies']).toBe(ca['allowedPaymentFrequencies']);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// B33 (DEC-B33-FREQ): B27-T2 was the rejection matrix; the same 30 cases are now ACCEPTED, with the contract rate unconverted.
describe('B27-T2 (B33) acceptance matrix: personal loan + a non-monthly frequency (5 frequencies x 2 rate types x 3 flows: new, renewal, paymentChange)', () => {
  const CASES: [PaymentFrequency, RateType, CobFlow][] = NON_MONTHLY.flatMap((f) =>
    RATES.flatMap((r) => (['newMortgageOrLoan', 'renewal', 'paymentChange'] as const).map((fl) => [f, r, fl] as [PaymentFrequency, RateType, CobFlow])),
  );
  it('the matrix has 30 cases', () => expect(CASES).toHaveLength(30));

  it.each(CASES)('%s / %s / %s: no issue; validateCobCanadaInput does not throw; calculates with the contract rate exactly and no trigger rate', (f, r, fl) => {
    const x = input(fl, 'personalLoan', r, f);
    expect(collectInputIssues(x)).toEqual([]);
    expect(() => validateCobCanadaInput(x)).not.toThrow();
    const res = calculateCobCanada(x);
    expect(res.calculatedRatePercent).toBe(6);
    expect(res.triggerRatePercent).toBeNull();
  });

  it("B27's message is gone: no case of the matrix yields 'is not allowed for productType'", () => {
    for (const [f, r, fl] of CASES) for (const i of collectInputIssues(input(fl, 'personalLoan', r, f))) expect(i.message).not.toContain('is not allowed for productType');
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe('B27-T3 acceptance: personal loan + monthly (unchanged by B33)', () => {
  const CASES: [RateType, CobFlow][] = RATES.flatMap((r) => (['newMortgageOrLoan', 'renewal', 'paymentChange'] as const).map((fl) => [r, fl] as [RateType, CobFlow]));

  it.each(CASES)('%s / %s: valid, and the Calculated rate equals the contract rate exactly (MONTHLY basis)', (r, fl) => {
    const x = input(fl, 'personalLoan', r, 'monthly');
    expect(collectInputIssues(x)).toEqual([]);
    expect(() => validateCobCanadaInput(x)).not.toThrow();
    const res = calculateCobCanada(x);
    expect(res.calculatedRatePercent).toBe(6);
    expect(res.triggerRatePercent).toBeNull();
  });
});

// ---------------------------------------------------------------------------------------------------------------
// B33 (DEC-B33-FREQ): the B27 frequency issue no longer exists; what is left of the check order is the flow lock and the
// existing enum / fees / date checks.
describe('B27-T4 (B33) check order without the frequency rule: flow lock, fees, dates; enum message alone', () => {
  it('renewal + personal loan + weekly (no Renewal lock since 2026-10-01, no frequency rule since B33): no issue', () => {
    const x = input('renewal', 'personalLoan', 'fixed', 'weekly');
    expect(collectInputIssues(x)).toEqual([]);
    expect(() => validateCobCanadaInput(x)).not.toThrow();
  });

  it('variable rate payment change + personal loan (fixed) + biweekly: [flow] only; the flow message is thrown', () => {
    const x = input('variableRatePaymentChange', 'personalLoan', 'fixed', 'biweekly');
    expect(collectInputIssues(x).map((i) => i.field)).toEqual(['flow']);
    expectRangeErrorMatching(() => validateCobCanadaInput(x), /^flow 'variableRatePaymentChange' is mortgage \+ variable-rate only, got productType='personalLoan', rateType='fixed'$/);
  });

  it('a fees problem on a weekly personal loan is the only issue', () => {
    const x = input('newMortgageOrLoan', 'personalLoan', 'fixed', 'weekly', { fees: { fees: [{ name: 'Big', amount: 200000, financed: true }] } });
    expect(collectInputIssues(x).map((i) => i.field)).toEqual(['fees']);
    expect(() => validateCobCanadaInput(x)).toThrow(/^total fees /);
  });

  it('a semi-monthly personal loan with an end date before the first payment: the date issue only', () => {
    const x = input('newMortgageOrLoan', 'personalLoan', 'fixed', 'semiMonthly', { endDate: utcDate('2027-01-15') });
    expect(collectInputIssues(x).map((i) => i.field)).toEqual(['endDate']);
  });

  it('a frequency string that is not one of the six gives only the existing enum message', () => {
    const enumMessage = `paymentFrequency must be one of ${Object.keys(PAYMENTS_PER_YEAR).join('/')}, got fortnightly`;
    for (const p of ['personalLoan', 'mortgage'] as const) {
      expect(collectInputIssues(input('newMortgageOrLoan', p, 'variable', 'fortnightly'))).toEqual([{ field: 'paymentFrequency', message: enumMessage }]);
    }
  });

  it('a bad product type gives only its own enum message', () => {
    const issues = collectInputIssues(input('newMortgageOrLoan', 'car' as ProductType, 'variable', 'weekly'));
    expect(issues.map((i) => i.field)).toEqual(['productType']);
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe('B27-T5 mortgages are unchanged: all six frequencies x fixed/variable x the flows that accept a mortgage', () => {
  const CASES: [PaymentFrequency, RateType, CobFlow][] = ALL_FREQS.flatMap((f) =>
    RATES.flatMap((r) =>
      FLOW_IDS.filter((fl) => flowLockOk(fl, 'mortgage', r)).map((fl) => [f, r, fl] as [PaymentFrequency, RateType, CobFlow]),
    ),
  );
  it('the matrix has 6 x (3 + 4) = 42 cases (variable rate payment change is variable-only)', () => expect(CASES).toHaveLength(6 * 7));

  it.each(CASES)('mortgage %s / %s / %s is valid and calculates', (f, r, fl) => {
    const x = input(fl, 'mortgage', r, f);
    expect(collectInputIssues(x)).toEqual([]);
    expect(() => calculateCobCanada(x)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------------------------------------------
// B33 (DEC-B33-FREQ): the oracle loses the "[paymentFrequency iff personal loan and not monthly]" term; 0 rejections.
describe('B27-INV-reject / INV-accept / INV-order (B33): the whole cross product (4 flows x 2 products x 2 rates x 6 frequencies = 96) against an independent oracle', () => {
  it('issue fields are exactly [flow?]; no paymentFrequency issue for any product', () => {
    let n = 0;
    let rejected = 0;
    for (const fl of FLOW_IDS)
      for (const p of ['mortgage', 'personalLoan'] as const)
        for (const r of RATES)
          for (const f of ALL_FREQS) {
            const want = flowLockOk(fl, p, r) ? [] : ['flow'];
            const got = collectInputIssues(input(fl, p, r, f)).map((i) => i.field);
            expect(got, `${fl}/${p}/${r}/${f}`).toEqual(want);
            n += 1;
            if (want.includes('paymentFrequency')) rejected += 1;
          }
    expect(n).toBe(96);
    expect(rejected).toBe(0); // B33: was 4 flows x 2 rate types x 5 non-monthly frequencies = 40
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe('B27-T6 no off state (revision 27: a fixed rule, no switch, no parameter; B33-R10: the removal adds no switch either)', () => {
  // B37 (DEC-B37-LEAP-N, brief B37 test plan 6): + LEAP_AWARE_PAYMENTS_PER_YEAR (an ADR-14 engine switch of B37, not a B27
  // switch). Red until sr-dev adds it.
  it('policies.ts exports exactly the same names as before B27 (B24 adds SEMI_ANNUAL_DATE_REQUIRED, B37 LEAP_AWARE_PAYMENTS_PER_YEAR)', async () => {
    const mod = (await import('../../src/ca/policies.js')) as Record<string, unknown>;
    expect(Object.keys(mod).sort()).toEqual([
      'LEAP_AWARE_PAYMENTS_PER_YEAR',
      'PRINCIPAL_PAID',
      'PRIOR_ACCRUED_IN_COB',
      'PRIOR_ACCRUED_IN_P',
      'P_BASIS',
      'SEMI_ANNUAL_DATE_REQUIRED',
      'UNPAID_INTEREST_CAPITALISED',
    ]);
  });

  it('EngineSwitches and the test Switches type stay one field (unpaidInterestCapitalised); no B27 switch name anywhere in src', () => {
    const cob = stripComments(read(join(ROOT, 'src', 'ca', 'cobCanada.ts')));
    const iface = /export interface EngineSwitches \{([^}]*)\}/.exec(cob)![1]!;
    expect([...iface.matchAll(/readonly (\w+)/g)].map((m) => m[1])).toEqual(['unpaidInterestCapitalised']);
    const sw = stripComments(read(join(ROOT, 'tests', 'ca', 'support', 'switches.ts')));
    const swIface = /export interface Switches \{([^}]*)\}/.exec(sw)![1]!;
    expect([...swIface.matchAll(/readonly (\w+)/g)].map((m) => m[1])).toEqual(['unpaidInterestCapitalised']);
    const token = ['personalLoan' + 'MonthlyOnly', 'PERSONAL_LOAN' + '_MONTHLY_ONLY', 'OQ' + '-AB'];
    for (const f of listFiles(join(ROOT, 'src'), /\.ts$/)) for (const t of token) expect(read(f), `${rel(f)} ${t}`).not.toContain(t);
  });

  it('validateCobCanadaInput and collectInputIssues keep one parameter (no defaulted rule-off parameter)', () => {
    expect(validateCobCanadaInput.length).toBe(1);
    expect(collectInputIssues.length).toBe(1);
  });

  // B33 (DEC-B33-FREQ, B33-R2): validate.ts no longer imports products.js or calls the catalogue.
  it('validate.ts compares no product or frequency literal and no longer reads products.js (B33)', () => {
    const code = stripComments(read(join(ROOT, 'src', 'ca', 'validate.ts')));
    const LIT = "['\"`](?:personalLoan|mortgage|weekly|acceleratedWeekly|biweekly|acceleratedBiweekly|semiMonthly|monthly)['\"`]";
    expect(code).not.toMatch(new RegExp(`[=!]==?\\s*${LIT}|${LIT}\\s*[=!]==?|case\\s+${LIT}`));
    expect(code.match(/'personalLoan'/g) ?? []).toHaveLength(1);
    expect(code).not.toMatch(/['"`](weekly|acceleratedWeekly|biweekly|acceleratedBiweekly|semiMonthly|monthly)['"`]/);
    expect(code).not.toMatch(/products\.js/);
    expect(code).not.toMatch(/allowedPaymentFrequencies/);
    expect(code).not.toContain('is not allowed for productType');
  });
});

// ---------------------------------------------------------------------------------------------------------------
// B33 (DEC-B33-FREQ, B33-R5 / R6, D3): the lock is deleted, not neutralised. Was: frequencyLock / FREQUENCY_LOCK_HINT pins.
describe('B27-T7 (B33) UI view logic: frequencyLock and FREQUENCY_LOCK_HINT no longer exist', () => {
  it('ui/ca-view.js exports neither frequencyLock nor FREQUENCY_LOCK_HINT', async () => {
    const v = (await loadView()) as unknown as Record<string, unknown>;
    expect('frequencyLock' in v).toBe(false);
    expect('FREQUENCY_LOCK_HINT' in v).toBe(false);
  });

  it('ui/ca-view.d.ts declares neither (nor the FrequencyLock interface), and no ui/ calculator file holds the retired hint text', () => {
    const dts = read(join(ROOT, 'ui', 'ca-view.d.ts'));
    for (const t of ['frequencyLock', 'FREQUENCY_LOCK_HINT', 'FrequencyLock']) expect(dts, t).not.toContain(t);
    for (const name of ['ca.js', 'ca-view.js', 'ca.html']) expect(read(join(ROOT, 'ui', name)), name).not.toContain('Personal loans are paid monthly.');
  });
});

// ---------------------------------------------------------------------------------------------------------------
// B33 (DEC-B33-FREQ, B33-R5): was "ca.js and ca.html carry the lock"; now the lock is absent and the select is plain.
describe('B27-T8 (B33) static: ui/ca.js and ui/ca.html carry no lock', () => {
  const js = stripComments(read(join(ROOT, 'ui', 'ca.js')));
  const html = read(join(ROOT, 'ui', 'ca.html'));

  it('ca.js imports neither allowedPaymentFrequencies nor frequencyLock, and has no paymentFrequencyHint element', () => {
    expect(js).not.toMatch(/\ballowedPaymentFrequencies\b/);
    expect(js).not.toMatch(/\bfrequencyLock\b/);
    expect(js).not.toMatch(/paymentFrequencyHint/);
  });

  it('ca.js holds no personalLoan literal and updateConditionalVisibility still applies the flow and rate locks but never sets the Payment frequency select', () => {
    expect(js).not.toMatch(/['"`]personalLoan['"`]/);
    const start = js.indexOf('function updateConditionalVisibility(');
    expect(start).toBeGreaterThan(-1);
    const ucv = js.slice(start, js.indexOf('\n}\n', start));
    expect(ucv.indexOf('forcedProduct')).toBeGreaterThan(-1);
    expect(ucv.indexOf('forcedRate')).toBeGreaterThan(ucv.indexOf('forcedProduct'));
    expect(ucv).not.toMatch(/paymentFrequencyEl\.(?:value|disabled)\s*=/);
  });

  it('ca.html: select#paymentFrequency has no aria-describedby and there is no #paymentFrequencyHint element', () => {
    const sel = /<select\b[^>]*\bid="paymentFrequency"[^>]*>/.exec(html);
    expect(sel, 'select#paymentFrequency').not.toBeNull();
    expect(sel![0]).not.toMatch(/aria-describedby/);
    expect(html).not.toContain('id="paymentFrequencyHint"');
  });

  it('ca.html keeps Monthly in the list (not behind the accelerated switch)', () => {
    const block = /<select\b[^>]*\bid="paymentFrequency"[^>]*>([\s\S]*?)<\/select>/.exec(html)![1]!;
    expect(block).toMatch(/<option value="monthly"(?![^>]*data-switch)/);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// B33 (DEC-B33-FREQ, B33-R7 / R8): the B27 filter is gone; the shape is back to the full corpus (the R8 numbers). Was:
// v1 94 groups / 2,817 cases, PC 86 / 2,444, the 54 + 36 personal-loan groups dropped, PC long case monthly.
describe('B27-T9 (B33) golden shape: the live generators and the fixtures', () => {
  type G = { key: string; extra: boolean; cases: { label: string; params: { productType: string; frequency: string } }[] }[];
  const v1: G = gen1.buildGroups();
  const pc: G = genPc.buildGroups();
  const fix = (name: string) => JSON.parse(readFileSync(join(FIXTURES_DIR, name), 'utf8')) as { groups: Record<string, unknown>; long: Record<string, unknown> };
  const count = (g: G) => g.reduce((s, x) => s + x.cases.length, 0);

  const RESTORED_V1 = ['weekly', 'biweekly', 'semiMonthly'].flatMap((f) =>
    RATES.flatMap((r) => ['none', 'fin2000', 'fin2000cash400'].flatMap((fee) => ['new', 'renewal0', 'renewal850'].map((fl) => `${f}|personalLoan/${r}|${fee}|${fl}`))),
  );
  const RESTORED_PC = ['weekly', 'biweekly', 'semiMonthly'].flatMap((f) =>
    RATES.flatMap((r) => ['none', 'fin2000', 'fin2000cash400'].flatMap((fee) => ['acc0', 'acc850'].map((a) => `pc|${f}|personalLoan/${r}|${fee}|${a}`))),
  );

  it('v1: 148 groups / 4,455 cases; 144 core groups (3,744 cases); extra:underpayment 312', () => {
    expect(v1).toHaveLength(148);
    expect(count(v1)).toBe(4455);
    expect(v1.filter((g) => !g.extra)).toHaveLength(144);
    expect(count(v1.filter((g) => !g.extra))).toBe(3744);
    expect(v1.find((g) => g.key === 'extra:underpayment')!.cases).toHaveLength(312);
  });

  it('PC: 122 groups / 3,536 cases; 120 regular groups (3,120 cases); pcx:underpayment 208', () => {
    expect(pc).toHaveLength(122);
    expect(count(pc)).toBe(3536);
    expect(pc.filter((g) => !g.extra)).toHaveLength(120);
    expect(count(pc.filter((g) => !g.extra))).toBe(3120);
    expect(pc.find((g) => g.key === 'pcx:underpayment')!.cases).toHaveLength(208);
  });

  it('the 54 (v1) and 36 (PC) personal-loan group keys B27 dropped are back in the corpus', () => {
    expect(RESTORED_V1).toHaveLength(54);
    expect(RESTORED_PC).toHaveLength(36);
    const k1 = new Set(v1.map((g) => g.key));
    const k2 = new Set(pc.map((g) => g.key));
    expect(RESTORED_V1.filter((k) => !k1.has(k))).toEqual([]);
    expect(RESTORED_PC.filter((k) => !k2.has(k))).toEqual([]);
  });

  it('the fixtures hold the restored keys and their keys equal the corpus keys (red until sr-dev regenerates)', () => {
    const f1 = fix('golden_engine_v1.json');
    const f2 = fix('golden_engine_pc_v1.json');
    expect(RESTORED_V1.filter((k) => !(k in f1.groups))).toEqual([]);
    expect(RESTORED_PC.filter((k) => !(k in f2.groups))).toEqual([]);
    expect(Object.keys(f1.groups)).toEqual(v1.map((g) => g.key));
    expect(Object.keys(f2.groups)).toEqual(pc.map((g) => g.key));
  });

  it('PC long cases: the weekly personal-loan case is back (payment 200, as before B27)', () => {
    const longs = genPc.buildLongCases() as { key: string; params: Record<string, unknown> }[];
    expect(longs.map((c) => c.key)).toEqual(['long:vrpc:monthly:acc850', 'long:pc:weekly:acc850:underpayment']);
    const c = longs[1]!.params;
    expect(c).toMatchObject({ frequency: 'weekly', productType: 'personalLoan', rateType: 'fixed', feeSet: 'fin2000', flowKey: 'pc', accKey: 'acc850', payment: 200, years: 30 });
    expect(Object.keys(fix('golden_engine_pc_v1.json').long)).toEqual(longs.map((l) => l.key));
  });

  it('the corpus holds personal loans at non-monthly frequencies again (groups and the PC long case), and a stride of it validates on the shipped engine', () => {
    for (const [gen, groups] of [[gen1, v1], [genPc, pc]] as const) {
      const inputs = [
        ...groups.flatMap((g) => g.cases.map((c) => ({ k: `${g.key} ${c.label}`, p: c.params }))),
        ...(gen.buildLongCases() as { key: string; params: { productType: string; frequency: string } }[]).map((c) => ({ k: c.key, p: c.params })),
      ];
      expect(inputs.filter(({ p }) => p.productType === 'personalLoan' && p.frequency !== 'monthly').length).toBeGreaterThan(0);
      const sample = inputs.filter((_, i) => i % 7 === 0);
      for (const { k, p } of sample) expect(collectInputIssues(gen.makeInput(p) as CobCanadaInput), k).toEqual([]);
    }
  });

  // B37 (DEC-B37-LEAP-N): workbook converter (n = 52/26), switch off. B37 regenerates the PC golden (approved 2026-10-09),
  // so the history fact "the B33 PC golden equals the archived pre-B27 fixture" is checked on the pre-B37 PC golden,
  // rebuilt byte for byte by the leap-off replay (support/preB37Golden.ts), instead of on the live file.
  it('the Payment Change golden is byte-identical to the archived pre-B27 fixture again (B33-R8; B37: the pre-B37 golden, rebuilt with the leap switch off)', () => {
    const archived = readFileSync(join(ROOT, 'archive' + '/pre-b27', 'golden_engine_pc_v1.json'), 'utf8');
    expect(sha256(archived)).toBe('5ab1c6a6c086ba737d790bb1e42f2eb36ccd61c3c256e2634a6d5cc312fa7df5');
    expect(preB37GoldenText('pc') === archived).toBe(true);
  }, 120_000);
});

// ---------------------------------------------------------------------------------------------------------------
describe('B27-T10 the live generators have no "full" mode (revision 27: no rule-off replay)', () => {
  it('buildGroups takes no parameter and neither module exports anything named like a full/legacy mode', () => {
    for (const gen of [gen1, genPc]) {
      expect(gen.buildGroups.length).toBe(0);
      expect(gen.buildLongCases.length).toBe(0);
      expect(gen.computeGolden.length).toBe(1);
      expect(Object.keys(gen).filter((k) => /full|legacy|pre_?b27/i.test(k))).toEqual([]);
    }
  });

  it('the generator sources (comments stripped) have no `full` identifier and do not import the frozen copies', () => {
    for (const name of ['generate_golden.mjs', 'generate_golden_pc.mjs']) {
      const code = stripComments(read(join(FIXTURES_DIR, name)));
      expect(code, name).not.toMatch(/\bfull\b/);
      expect(code, name).not.toMatch(/legacy|pre_b27/);
    }
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe('B27-T11 (B33) the Chrome scripts do not drive a disabled select and assert the UNLOCKED state', () => {
  const capture = read(join(FIXTURES_DIR, 'capture_a10_ui.mjs'));
  const printWidth = read(join(ROOT, 'tests', 'ui', 'check_print_width.mjs'));

  it('capture_a10_ui.mjs sets flow, then paymentFrequency, before the other selects, and skips a disabled select that already holds the wanted value', () => {
    expect(capture).toMatch(/id === 'flow' \? 0 : id === 'paymentFrequency' \? 1 : 2/);
    expect(capture).toMatch(/isDisabled\(\)/);
    expect(capture).toMatch(/sort\(\(\[a\], \[b\]\) => selectOrder\(a\) - selectOrder\(b\)\)/);
  });

  // B33 (DEC-B33-FREQ, B33-R9): was "asserts the locked state (disabled, monthly, hint text)".
  it('capture_a10_ui.mjs asserts the unlocked state for a personal-loan scenario (enabled, no aria-describedby, the scenario frequency kept across Mortgage and back)', () => {
    expect(capture).not.toContain('Personal loans are paid monthly.');
    expect(capture).not.toMatch(/disabled: true/);
    expect(capture).toContain('const want = { disabled: false, value: sc.selects.paymentFrequency, describedBy: null, hintNode: 0 };');
    expect(capture).toMatch(/selectOption\('#productType', 'mortgage'\)/);
    expect(capture).toMatch(/selectOption\('#productType', 'personalLoan'\)/);
  });

  it('capture_a10_ui.mjs appends PL_WEEKLY last (personal loan, fixed, weekly) with its expected Contract term', () => {
    expect(capture).toMatch(/id: 'PL_WEEKLY',[^\n]*\n\s*selects: \{ flow: 'newMortgageOrLoan', productType: 'personalLoan', rateType: 'fixed', paymentFrequency: 'weekly' \}/);
    // B34 (DEC-B34-TERM, R8b): re-baselined; the expected field text is the End date rule in whole years and months (was 2 years, 10 months, 13 days).
    expect(capture).toContain("PL_WEEKLY: '3 years'");
    expect(capture.indexOf("id: 'PL_WEEKLY'")).toBeGreaterThan(capture.indexOf("id: 'ERR_blank_rate'"));
  });

  it('the capture fixture sha pin; ERR_blank_rate still sends a monthly personal loan (B33 re-pins the sha after the approved regeneration with PL_WEEKLY)', () => {
    const fixture = readFileSync(join(FIXTURES_DIR, 'a10_ui_capture_v1.json'), 'utf8');
    // Re-pinned 2026-10-05 by QA (B31 verify): capture regenerated for B31 (DEC-B31-LAYOUT, approved; result-figure order
    // and structure only, the personal-loan inputs unchanged); sha 171f8a33... -> ac76408a....
    // Re-pinned 2026-10-05 by QA (B32 verify, DEC-B32-TERM): capture regenerated (approved; term hint, label and value
    // strings only, the personal-loan inputs unchanged); sha ac76408a... -> 9877c0c6....
    // Re-pinned 2026-10-05 by QA (B33 verify, DEC-B33-FREQ): capture regenerated (approved; scenario PL_WEEKLY appended,
    // the six earlier scenarios unchanged); sha 9877c0c6... -> 4d5a64c1....
    // Re-pinned 2026-10-06 by QA (B34 verify, DEC-B34-TERM): capture regenerated (user approved Q-B34-FIX; term hint x4,
    // term value strings for 5 scenarios, new key contractTermChoice, nothing else); sha 4d5a64c1... -> 9577121c....
    // Re-pinned 2026-10-09 by QA (B37 verify, DEC-B37-LEAP-N): capture regenerated (user approved; REF-01 and S1_fees
    // figures, schedule digits and CSV only; DEV-B37-LEAPN); sha 9577121c... -> 6c3686d3....
    expect(sha256(fixture)).toBe('6c3686d387197b707518fd45e278414113c32846a04d8c1ac3c587a16d61b824');
    expect(capture).toMatch(/productType: 'personalLoan', rateType: 'variable', paymentFrequency: 'monthly'/);
  });

  it('check_print_width.mjs never selects a personal loan (no edit needed)', () => {
    expect(printWidth).not.toContain('personalLoan');
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe('B27-T12 rehome / rehomeCase (the twin helper)', () => {
  const pl = (fr: string, rate: RateType = 'fixed') => input('newMortgageOrLoan', 'personalLoan', rate, fr, { semiAnnualCompoundingDate: utcDate('2027-01-01') });

  it('a mortgage, or a personal loan at monthly, is returned untouched (same object)', () => {
    for (const x of [input('newMortgageOrLoan', 'mortgage', 'fixed', 'weekly'), input('paymentChange', 'mortgage', 'variable', 'semiMonthly'), pl('monthly'), pl('monthly', 'variable')])
      expect(rehome(x)).toBe(x);
  });

  it.each(NON_MONTHLY.flatMap((f) => RATES.map((r) => [f, r] as const)))('personal loan %s / %s -> mortgage / variable, same frequency, semiAnnualCompoundingDate dropped, every other field equal', (f, r) => {
    const x = pl(f, r);
    const t = rehome(x) as unknown as Record<string, unknown>;
    expect(t['productType']).toBe('mortgage');
    expect(t['rateType']).toBe('variable');
    expect(t['paymentFrequency']).toBe(f);
    expect('semiAnnualCompoundingDate' in t).toBe(false);
    const { productType: _p, rateType: _r, semiAnnualCompoundingDate: _s, ...restT } = t;
    const { productType: _p2, rateType: _r2, semiAnnualCompoundingDate: _s2, ...restX } = x as unknown as Record<string, unknown>;
    expect(restT).toEqual(restX);
    expect(x.productType).toBe('personalLoan'); // the original is not mutated
  });

  it('the twin keeps the flow (paymentChange stays paymentChange)', () => {
    const x = input('paymentChange', 'personalLoan', 'fixed', 'weekly');
    expect(rehome(x).flow).toBe('paymentChange');
  });

  it('rehomeCase.restore sets triggerRatePercent to null exactly when the ORIGINAL was a personal loan', () => {
    const res = { triggerRatePercent: 5.5, other: 1 };
    expect(rehomeCase(pl('weekly')).restore(res)).toEqual({ triggerRatePercent: null, other: 1 });
    expect(rehomeCase(pl('monthly')).restore(res)).toEqual({ triggerRatePercent: null, other: 1 });
    const m = input('newMortgageOrLoan', 'mortgage', 'variable', 'weekly');
    expect(rehomeCase(m).restore(res)).toBe(res);
    expect(res.triggerRatePercent).toBe(5.5); // the result is not mutated
  });

  it('restore keeps the key order (so a hash of the whole result is unchanged)', () => {
    const res = { a: 1, triggerRatePercent: 5.5, z: 2 };
    expect(Object.keys(rehomeCase(pl('biweekly')).restore(res))).toEqual(['a', 'triggerRatePercent', 'z']);
  });

  it('the twin is exact: personal loan result equals the twin result except triggerRatePercent (old-engine proof kept as a live check on the valid twin)', () => {
    // Monthly personal loan vs its mortgage/variable sibling at the same frequency (both valid on the shipped engine).
    for (const r of RATES) {
      const a = calculateCobCanada(input('newMortgageOrLoan', 'personalLoan', r, 'monthly'));
      const b = calculateCobCanada(input('newMortgageOrLoan', 'mortgage', 'variable', 'monthly'));
      const { triggerRatePercent: ta, ...ra } = a;
      const { triggerRatePercent: tb, ...rb } = b;
      expect(ra).toEqual(rb);
      expect(ta).toBeNull();
      expect(Number.isFinite(tb)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe('B27-T13 frozen pre-B27 generators: never write, imported only by the three named tests, never edited', () => {
  const LEGACY = join(FIXTURES_DIR, 'legacy');
  const FILES = ['generate_golden_pre_b27.mjs', 'generate_golden_pc_pre_b27.mjs'];
  // QA's pins of the frozen bodies (the text after the END-OF-HEADER line). Changing a frozen file changes this sha.
  const BODY_SHA: Record<string, string> = {
    'generate_golden_pre_b27.mjs': '229843d4fa9805161b1de03483bb6fb92cc01afdbbc5165166f2381a35b0c897',
    'generate_golden_pc_pre_b27.mjs': '56f63bf8ef103f78e3afd1d883dee8236364b52377041a79b2013288d10fb9db',
  };
  const ALLOWED_IMPORTERS = [
    'tests/ca/b10-includedincob-optional.test.ts',
    'tests/ca/b8-accelerated-frequencies.test.ts',
    'tests/ca/golden/b19-switch-on.test.ts',
    'tests/ca/b27-personal-loan-monthly-only.test.ts', // this file names them in strings only
  ];

  it('the legacy folder holds exactly the two frozen generators', () => {
    expect(listFiles(LEGACY, /.*/).map(rel).sort()).toEqual(FILES.map((f) => `tests/ca/fixtures/legacy/${f}`).sort());
  });

  it.each(FILES)('%s has no file-writing token (writeFileSync, writeFile, appendFile, createWriteStream, --write, --out, process.argv)', (name) => {
    const src = read(join(LEGACY, name));
    for (const t of ['writeFileSync', 'writeFile', 'appendFile', 'createWriteStream', 'mkdirSync', '--write', '--out', 'process.argv', 'node:fs'])
      expect(src, `${name}: ${t}`).not.toContain(t);
  });

  it.each(FILES)('%s is frozen: the header records the original sha and the body sha, and the body equals QA\'s pinned sha', (name) => {
    const src = read(join(LEGACY, name));
    const marker = '// END-OF-HEADER\n';
    const at = src.indexOf(marker);
    expect(at, 'END-OF-HEADER marker').toBeGreaterThan(-1);
    const body = src.slice(at + marker.length);
    const headerBody = /^\/\/ BODY-SHA256: ([0-9a-f]{64})$/m.exec(src.slice(0, at))?.[1];
    expect(/^\/\/ ORIGINAL-SHA256: [0-9a-f]{64}$/m.test(src.slice(0, at))).toBe(true);
    expect(headerBody).toBe(sha256(body));
    expect(sha256(body)).toBe(BODY_SHA[name]);
  });

  it('the frozen generators export only the builders (buildGroups, buildLongCases, computeGolden, serialise and the corpus constants)', async () => {
    for (const name of FILES) {
      const src = stripComments(read(join(LEGACY, name)));
      const exported = [...src.matchAll(/^export (?:const|function) (\w+)/gm)].map((m) => m[1]!);
      expect(exported, name).toEqual(expect.arrayContaining(['buildGroups', 'buildLongCases', 'computeGolden', 'serialise', 'makeInput']));
    }
  });

  it('only the three named tests (and this file) refer to the frozen generators; src, ui and the live generators do not', () => {
    const all = [
      ...listFiles(join(ROOT, 'tests'), /\.(ts|mjs|js|json)$/),
      ...listFiles(join(ROOT, 'src'), /\.ts$/),
      ...listFiles(join(ROOT, 'ui'), /\.(js|mjs|html|ts)$/),
    ].filter((f) => !rel(f).startsWith('tests/ca/fixtures/legacy/'));
    const refs = all.filter((f) => /_pre_b27|fixtures\/legacy|\.\/legacy\//.test(read(f))).map(rel).sort();
    expect(refs).toEqual([...ALLOWED_IMPORTERS].sort());
  });

  it('the frozen PC copy imports the frozen v1 copy, and no frozen file imports a live generator', () => {
    const pcSrc = stripComments(read(join(LEGACY, 'generate_golden_pc_pre_b27.mjs')));
    expect(pcSrc).toMatch(/await import\('\.\/generate_golden_pre_b27\.mjs'\)/);
    for (const name of FILES) expect(stripComments(read(join(LEGACY, name)))).not.toMatch(/(?:import\(|from\s+)\s*['"][^'"]*generate_golden(?:_pc)?\.mjs['"]/);
  });

  it('nothing in src, tests or ui refers to the archive folder (archive/pre-b27 is run by no test)', () => {
    const all = [...listFiles(join(ROOT, 'tests'), /\.(ts|mjs|js)$/), ...listFiles(join(ROOT, 'src'), /\.ts$/), ...listFiles(join(ROOT, 'ui'), /\.(js|mjs|html|ts)$/)];
    const self = 'tests/ca/b27-personal-loan-monthly-only.test.ts';
    const needle = 'archive' + '/pre-b27';
    const hits = all.filter((f) => rel(f) !== self && read(f).includes(needle)).map(rel);
    expect(hits).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe('B27-T14 equation level: a personal loan always has the MONTHLY rate basis, at every payments-per-year value', () => {
  const CASES = ALL_FREQS.flatMap((f) => RATES.map((r) => [f, r] as const));
  it('12 cases (6 frequencies x fixed/variable)', () => expect(CASES).toHaveLength(12));

  it.each(CASES)('%s / %s: basis MONTHLY, m = n, Calculated rate === contract rate exactly', (f, r) => {
    const n = PAYMENTS_PER_YEAR[f];
    expect(selectRateBasis('personalLoan', r)).toBe('MONTHLY');
    expect(selectCompoundingPeriodsPerYear('personalLoan', r, n)).toBe(n);
    for (const contract of [0.001, 5.19, 8, 24.99]) {
      expect(calculatedRateFor('personalLoan', r, contract, n)).toEqual({ percent: contract, decimal: contract / 100 });
    }
  });
});
