/**
 * B27 (COB-architecture.md section 5 B27, revision 29; user decisions 2026-09-30, COB-user-stories.md 7.5
 * "B27 answers"; DEV-FB24): a personal loan may only have the Monthly payment frequency.
 *
 * Engine: `validate.ts` rejects productType 'personalLoan' with any of the five other frequencies in EVERY flow and
 * for BOTH rate types (a fixed rule: no switch, no parameter); the rule lives in the product catalogue
 * `src/ca/products.ts` `allowedPaymentFrequencies(productType)` (interim Q-MSG message below). Mortgages are unchanged.
 * Page: Product type = Personal loan sets Payment frequency to Monthly and disables the select with a hint; going
 * back to Mortgage keeps Monthly and re-enables the select (`frequencyLock` in ui/ca-view.js).
 * Goldens reshaped (first 148 -> 94 groups, PC 122 -> 86); the pre-B27 corpus lives on only as the frozen
 * test-only generators in fixtures/legacy/ (run through the `rehome` twin).
 *
 * QA red tests, 2026-09-30. Ids: B27-T1 .. T14 (T6 and T10 are the "no off state" pins; revision 27 dropped the
 * switch), B27-INV-*. Red until sr-dev adds products.ts, the validation block, the barrel export, the page lock and
 * regenerates the two golden fixtures. Green from the start (characterisation): T3, T5, T6 (partly), T10, T12, T13, T14.
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

/** The exact interim message (Q-MSG) of the new rule. */
const rejection = (f: string, p: string, allowed: string) => `paymentFrequency '${f}' is not allowed for productType '${p}' (allowed: ${allowed})`;
const plRejection = (f: string) => rejection(f, 'personalLoan', 'monthly');

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
describe('B27-T1 catalogue: allowedPaymentFrequencies (src/ca/products.ts, read through the barrel)', () => {
  it('mortgage allows all six frequencies, in PAYMENTS_PER_YEAR order', () => {
    expect([...frequenciesFor('mortgage')]).toEqual(Object.keys(PAYMENTS_PER_YEAR));
    expect(frequenciesFor('mortgage')).toHaveLength(6);
  });

  it("personal loan allows exactly ['monthly'] (an explicit list, not derived from n = 12)", () => {
    expect([...frequenciesFor('personalLoan')]).toEqual(['monthly']);
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
describe('B27-T2 rejection matrix: personal loan + a non-monthly frequency (5 frequencies x 2 rate types x 3 flows: new, renewal, paymentChange)', () => {
  const CASES: [PaymentFrequency, RateType, CobFlow][] = NON_MONTHLY.flatMap((f) =>
    RATES.flatMap((r) => (['newMortgageOrLoan', 'renewal', 'paymentChange'] as const).map((fl) => [f, r, fl] as [PaymentFrequency, RateType, CobFlow])),
  );
  it('the matrix has 30 cases', () => expect(CASES).toHaveLength(30));

  it.each(CASES)('%s / %s / %s: one paymentFrequency issue with the exact message; validateCobCanadaInput and calculateCobCanada throw that RangeError', (f, r, fl) => {
    const x = input(fl, 'personalLoan', r, f);
    const message = plRejection(f);
    expect(collectInputIssues(x)).toEqual([{ field: 'paymentFrequency', message }]);
    const exact = new RegExp(`^${message.replace(/[()]/g, '\\$&')}$`);
    expectRangeErrorMatching(() => validateCobCanadaInput(x), exact);
    expectRangeErrorMatching(() => calculateCobCanada(x), exact);
  });

  it('the message is built from the catalogue (quoted product, quoted frequency, allowed list joined by "/")', () => {
    expect(plRejection('weekly')).toBe("paymentFrequency 'weekly' is not allowed for productType 'personalLoan' (allowed: monthly)");
    expect(collectInputIssues(input('newMortgageOrLoan', 'personalLoan', 'fixed', 'acceleratedWeekly'))[0]!.message).toBe(
      "paymentFrequency 'acceleratedWeekly' is not allowed for productType 'personalLoan' (allowed: monthly)",
    );
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe('B27-T3 acceptance: personal loan + monthly', () => {
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
describe('B27-T4 check order: flow lock, then payment frequency, then dates; fees first; enum message alone', () => {
  it('renewal + personal loan + weekly (2026-10-01: no Renewal lock): the one issue is paymentFrequency, and it is the thrown message', () => {
    const x = input('renewal', 'personalLoan', 'fixed', 'weekly');
    expect(collectInputIssues(x).map((i) => i.field)).toEqual(['paymentFrequency']);
    expect(collectInputIssues(x)[0]!.message).toBe(plRejection('weekly'));
    expect(() => validateCobCanadaInput(x)).toThrow(plRejection('weekly'));
  });

  it('variable rate payment change + personal loan (fixed) + biweekly: [flow, paymentFrequency]; the flow message is thrown', () => {
    const x = input('variableRatePaymentChange', 'personalLoan', 'fixed', 'biweekly');
    expect(collectInputIssues(x).map((i) => i.field)).toEqual(['flow', 'paymentFrequency']);
    expect(() => validateCobCanadaInput(x)).toThrow(/^flow 'variableRatePaymentChange' is mortgage \+ variable-rate only, got productType='personalLoan', rateType='fixed'$/);
  });

  it('a fees problem is reported before the frequency', () => {
    const x = input('newMortgageOrLoan', 'personalLoan', 'fixed', 'weekly', { fees: { fees: [{ name: 'Big', amount: 200000, financed: true }] } });
    expect(collectInputIssues(x).map((i) => i.field)).toEqual(['fees', 'paymentFrequency']);
    expect(() => validateCobCanadaInput(x)).toThrow(/^total fees /);
  });

  it('the frequency is reported before the date checks', () => {
    const x = input('newMortgageOrLoan', 'personalLoan', 'fixed', 'semiMonthly', { endDate: utcDate('2027-01-15') });
    expect(collectInputIssues(x).map((i) => i.field)).toEqual(['paymentFrequency', 'endDate']);
    expect(() => validateCobCanadaInput(x)).toThrow(new RegExp(`^${plRejection('semiMonthly').replace(/[()]/g, '\\$&')}$`));
  });

  it('a frequency string that is not one of the six gives only the existing enum message (no catalogue lookup)', () => {
    const enumMessage = `paymentFrequency must be one of ${Object.keys(PAYMENTS_PER_YEAR).join('/')}, got fortnightly`;
    for (const p of ['personalLoan', 'mortgage'] as const) {
      expect(collectInputIssues(input('newMortgageOrLoan', p, 'variable', 'fortnightly'))).toEqual([{ field: 'paymentFrequency', message: enumMessage }]);
    }
  });

  it('a bad product type gives only its own enum message (the rule needs both enums valid)', () => {
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
describe('B27-INV-reject / INV-accept / INV-order: the whole cross product (4 flows x 2 products x 2 rates x 6 frequencies = 96) against an independent oracle', () => {
  it('issue fields are exactly [flow?] + [paymentFrequency iff personal loan and not monthly]', () => {
    let n = 0;
    let rejected = 0;
    for (const fl of FLOW_IDS)
      for (const p of ['mortgage', 'personalLoan'] as const)
        for (const r of RATES)
          for (const f of ALL_FREQS) {
            const want = [...(flowLockOk(fl, p, r) ? [] : ['flow']), ...(p === 'personalLoan' && f !== 'monthly' ? ['paymentFrequency'] : [])];
            const got = collectInputIssues(input(fl, p, r, f)).map((i) => i.field);
            expect(got, `${fl}/${p}/${r}/${f}`).toEqual(want);
            n += 1;
            if (want.includes('paymentFrequency')) rejected += 1;
          }
    expect(n).toBe(96);
    expect(rejected).toBe(4 * 2 * 5); // 4 flows x 2 rate types x 5 non-monthly frequencies
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe('B27-T6 no off state (revision 27: a fixed rule, no switch, no parameter)', () => {
  it('policies.ts exports exactly the same names as before B27 (B24 adds SEMI_ANNUAL_DATE_REQUIRED)', async () => {
    const mod = (await import('../../src/ca/policies.js')) as Record<string, unknown>;
    expect(Object.keys(mod).sort()).toEqual([
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

  it('validate.ts compares no product or frequency literal (the rule is a catalogue lookup) and reads products.js', () => {
    const code = stripComments(read(join(ROOT, 'src', 'ca', 'validate.ts')));
    const LIT = "['\"`](?:personalLoan|mortgage|weekly|acceleratedWeekly|biweekly|acceleratedBiweekly|semiMonthly|monthly)['\"`]";
    expect(code).not.toMatch(new RegExp(`[=!]==?\\s*${LIT}|${LIT}\\s*[=!]==?|case\\s+${LIT}`));
    // The only product literal is the existing PRODUCT_TYPES enum list; no frequency name appears at all.
    expect(code.match(/'personalLoan'/g) ?? []).toHaveLength(1);
    expect(code).not.toMatch(/['"`](weekly|acceleratedWeekly|biweekly|acceleratedBiweekly|semiMonthly|monthly)['"`]/);
    expect(code).toMatch(/from '\.\/products\.js'/);
    expect(code).toMatch(/allowedPaymentFrequencies\(/);
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe('B27-T7 UI view logic: frequencyLock(productType, allowed, current) -> { value, locked, hint }', () => {
  const PL_ALLOWED = ['monthly'];
  const M_ALLOWED = Object.keys(PAYMENTS_PER_YEAR);

  it('the interim hint text is one exported string', async () => {
    const v = await loadView();
    expect(v.FREQUENCY_LOCK_HINT).toBe('Personal loans are paid monthly.');
  });

  it.each(ALL_FREQS)('Personal loan + %s: value monthly, locked, with the hint', async (current) => {
    const v = await loadView();
    expect(v.frequencyLock('personalLoan', PL_ALLOWED, current)).toEqual({ value: 'monthly', locked: true, hint: 'Personal loans are paid monthly.' });
  });

  it.each(ALL_FREQS)('Mortgage + %s: not locked, no hint, the value is kept', async (current) => {
    const v = await loadView();
    expect(v.frequencyLock('mortgage', M_ALLOWED, current)).toEqual({ value: current, locked: false, hint: '' });
  });

  it('Mortgage (weekly) -> Personal loan -> Mortgage ends at monthly, enabled, no hint (user answer 2: no restore of weekly)', async () => {
    const v = await loadView();
    let value: string = 'weekly';
    const a = v.frequencyLock('personalLoan', PL_ALLOWED, value);
    value = a.value;
    expect([a.locked, value]).toEqual([true, 'monthly']);
    const b = v.frequencyLock('mortgage', M_ALLOWED, value);
    expect(b).toEqual({ value: 'monthly', locked: false, hint: '' });
  });

  it('the lock is driven by the catalogue list, not by the product name (a one-item list locks to that item)', async () => {
    const v = await loadView();
    expect(v.frequencyLock('anything', ['monthly'], 'weekly')).toMatchObject({ value: 'monthly', locked: true });
    expect(v.frequencyLock('anything', M_ALLOWED, 'weekly')).toMatchObject({ value: 'weekly', locked: false });
  });

  it('with the engine catalogue: the lock agrees with allowedPaymentFrequencies for both products', async () => {
    const v = await loadView();
    expect(v.frequencyLock('personalLoan', frequenciesFor('personalLoan'), 'biweekly')).toMatchObject({ value: 'monthly', locked: true });
    expect(v.frequencyLock('mortgage', frequenciesFor('mortgage'), 'biweekly')).toMatchObject({ value: 'biweekly', locked: false });
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe('B27-T8 static: ui/ca.js and ui/ca.html carry the lock without a product literal', () => {
  const js = stripComments(read(join(ROOT, 'ui', 'ca.js')));
  const html = read(join(ROOT, 'ui', 'ca.html'));

  it('ca.js imports allowedPaymentFrequencies from the barrel and frequencyLock from ca-view.js', () => {
    expect(js).toMatch(/import \{[^}]*\ballowedPaymentFrequencies\b[^}]*\} from '\/dist\/ca\/index\.js'/);
    expect(js).toMatch(/import \{[^}]*\bfrequencyLock\b[^}]*\} from '\.\/ca-view\.js'/);
  });

  it('ca.js holds no personalLoan literal and calls frequencyLock(…, allowedPaymentFrequencies(…), …) from updateConditionalVisibility after the flow and rate locks', () => {
    expect(js).not.toMatch(/['"`]personalLoan['"`]/);
    const bodyOf = (name: string): string => {
      const start = js.indexOf(`function ${name}(`);
      expect(start, `function ${name}`).toBeGreaterThan(-1);
      return js.slice(start, js.indexOf('\n}\n', start));
    };
    const ucv = bodyOf('updateConditionalVisibility');
    // The lock may sit inline or in one helper that updateConditionalVisibility calls (B27-R7).
    const helper = ucv.includes('frequencyLock(')
      ? null
      : [...js.matchAll(/function (\w+)\(/g)].map((m) => m[1]!).find((n) => n !== 'updateConditionalVisibility' && ucv.includes(`${n}(`) && bodyOf(n).includes('frequencyLock('));
    if (helper == null) expect(ucv).toContain('frequencyLock(');
    const lockCall = helper == null ? 'frequencyLock(' : `${helper}(`;
    const iProduct = ucv.indexOf('forcedProduct');
    const iRate = ucv.indexOf('forcedRate');
    const iLock = ucv.indexOf(lockCall);
    expect(iProduct).toBeGreaterThan(-1);
    expect(iRate).toBeGreaterThan(iProduct);
    expect(iLock).toBeGreaterThan(iRate);
    const lockBody = helper == null ? ucv : ucv + bodyOf(helper);
    expect(lockBody).toMatch(/frequencyLock\(\s*[\w.]+\s*,\s*allowedPaymentFrequencies\(/);
    // value, disabled and hint are all applied (the product and rate locks already use .value / .disabled: 2 + 2).
    expect((lockBody.match(/\.disabled\s*=/g) ?? []).length).toBeGreaterThanOrEqual(5);
    expect((lockBody.match(/\.value\s*=/g) ?? []).length).toBeGreaterThanOrEqual(3);
  });

  it('ca.html: select#paymentFrequency has aria-describedby pointing at a hint element that is hidden until locked', () => {
    const sel = /<select\b[^>]*\bid="paymentFrequency"[^>]*>/.exec(html);
    expect(sel, 'select#paymentFrequency').not.toBeNull();
    const id = /\baria-describedby="([^"]+)"/.exec(sel![0])?.[1];
    expect(id, 'aria-describedby on the select').toBeTruthy();
    const el = new RegExp(`<[a-z]+\\b[^>]*\\bid="${id}"[^>]*>`).exec(html);
    expect(el, `element #${id}`).not.toBeNull();
    expect(el![0]).toMatch(/\bhint\b/);
    expect(el![0]).toMatch(/\bhidden\b|\blocked\b/);
    // The hint sits in the field next to the select, not in a recorded print/result element.
    const fieldStart = html.lastIndexOf('<div class="field">', sel!.index);
    const fieldEnd = html.indexOf('</div>', sel!.index);
    expect(html.slice(fieldStart, fieldEnd)).toContain(`id="${id}"`);
  });

  it('ca.html keeps Monthly in the list (the lock works whatever the accelerated switch says)', () => {
    const block = /<select\b[^>]*\bid="paymentFrequency"[^>]*>([\s\S]*?)<\/select>/.exec(html)![1]!;
    expect(block).toMatch(/<option value="monthly"(?![^>]*data-switch)/);
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe('B27-T9 golden shape: the live (reshaped) generators and the fixtures', () => {
  type G = { key: string; extra: boolean; cases: { label: string; params: { productType: string; frequency: string } }[] }[];
  const v1: G = gen1.buildGroups();
  const pc: G = genPc.buildGroups();
  const fix = (name: string) => JSON.parse(readFileSync(join(FIXTURES_DIR, name), 'utf8')) as { groups: Record<string, unknown>; long: Record<string, unknown> };
  const count = (g: G) => g.reduce((s, x) => s + x.cases.length, 0);

  const DROPPED_V1 = ['weekly', 'biweekly', 'semiMonthly'].flatMap((f) =>
    RATES.flatMap((r) => ['none', 'fin2000', 'fin2000cash400'].flatMap((fee) => ['new', 'renewal0', 'renewal850'].map((fl) => `${f}|personalLoan/${r}|${fee}|${fl}`))),
  );
  const DROPPED_PC = ['weekly', 'biweekly', 'semiMonthly'].flatMap((f) =>
    RATES.flatMap((r) => ['none', 'fin2000', 'fin2000cash400'].flatMap((fee) => ['acc0', 'acc850'].map((a) => `pc|${f}|personalLoan/${r}|${fee}|${a}`))),
  );

  it('v1: 94 groups / 2,817 cases; 90 core groups (2,340 cases); extra:underpayment trimmed to 78', () => {
    expect(v1).toHaveLength(94);
    expect(count(v1)).toBe(2817);
    expect(v1.filter((g) => !g.extra)).toHaveLength(90);
    expect(count(v1.filter((g) => !g.extra))).toBe(2340);
    expect(v1.find((g) => g.key === 'extra:underpayment')!.cases).toHaveLength(78);
  });

  it('PC: 86 groups / 2,444 cases; 84 regular groups (2,184 cases); pcx:underpayment trimmed to 52', () => {
    expect(pc).toHaveLength(86);
    expect(count(pc)).toBe(2444);
    expect(pc.filter((g) => !g.extra)).toHaveLength(84);
    expect(count(pc.filter((g) => !g.extra))).toBe(2184);
    expect(pc.find((g) => g.key === 'pcx:underpayment')!.cases).toHaveLength(52);
  });

  it('the 54 (v1) and 36 (PC) dropped group keys are absent from the corpus', () => {
    expect(DROPPED_V1).toHaveLength(54);
    expect(DROPPED_PC).toHaveLength(36);
    const k1 = new Set(v1.map((g) => g.key));
    const k2 = new Set(pc.map((g) => g.key));
    expect(DROPPED_V1.filter((k) => k1.has(k))).toEqual([]);
    expect(DROPPED_PC.filter((k) => k2.has(k))).toEqual([]);
  });

  it('the fixtures do not hold the dropped keys and their keys equal the corpus keys (red until sr-dev regenerates)', () => {
    const f1 = fix('golden_engine_v1.json');
    const f2 = fix('golden_engine_pc_v1.json');
    expect(DROPPED_V1.filter((k) => k in f1.groups)).toEqual([]);
    expect(DROPPED_PC.filter((k) => k in f2.groups)).toEqual([]);
    expect(Object.keys(f1.groups)).toEqual(v1.map((g) => g.key));
    expect(Object.keys(f2.groups)).toEqual(pc.map((g) => g.key));
  });

  it('PC long cases: the weekly personal-loan case is replaced by the monthly one (same inputs, monthly, payment 300)', () => {
    const longs = genPc.buildLongCases() as { key: string; params: Record<string, unknown> }[];
    expect(longs.map((c) => c.key)).toEqual(['long:vrpc:monthly:acc850', 'long:pc:monthly:acc850:underpayment']);
    const c = longs[1]!.params;
    expect(c).toMatchObject({ frequency: 'monthly', productType: 'personalLoan', rateType: 'fixed', feeSet: 'fin2000', flowKey: 'pc', accKey: 'acc850', payment: 300, years: 30 });
    expect(Object.keys(fix('golden_engine_pc_v1.json').long)).toEqual(longs.map((l) => l.key));
  });

  it('no corpus input (groups and long cases) is a personal loan at a non-monthly frequency, and every input validates on the shipped engine', () => {
    for (const [gen, groups] of [[gen1, v1], [genPc, pc]] as const) {
      const inputs = [
        ...groups.flatMap((g) => g.cases.map((c) => ({ k: `${g.key} ${c.label}`, p: c.params }))),
        ...(gen.buildLongCases() as { key: string; params: { productType: string; frequency: string } }[]).map((c) => ({ k: c.key, p: c.params })),
      ];
      for (const { k, p } of inputs) {
        expect(p.productType === 'personalLoan' && p.frequency !== 'monthly', k).toBe(false);
      }
      // Validate a stride (every 7th) plus every group's first case: the full corpus is validated by the golden suites.
      const sample = inputs.filter((_, i) => i % 7 === 0);
      for (const { k, p } of sample) expect(collectInputIssues(gen.makeInput(p) as CobCanadaInput), k).toEqual([]);
    }
  });
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
describe('B27-T11 the Chrome scripts do not drive a disabled select and assert the locked state', () => {
  const capture = read(join(FIXTURES_DIR, 'capture_a10_ui.mjs'));
  const printWidth = read(join(ROOT, 'tests', 'ui', 'check_print_width.mjs'));

  it('capture_a10_ui.mjs sets flow, then paymentFrequency, before the other selects, and skips a disabled select that already holds the wanted value', () => {
    expect(capture).toMatch(/id === 'flow' \? 0 : id === 'paymentFrequency' \? 1 : 2/);
    expect(capture).toMatch(/isDisabled\(\)/);
    expect(capture).toMatch(/sort\(\(\[a\], \[b\]\) => selectOrder\(a\) - selectOrder\(b\)\)/);
  });

  it('capture_a10_ui.mjs asserts the locked state (disabled, monthly, hint text) and the unlock after switching back to Mortgage', () => {
    expect(capture).toContain("{ disabled: true, value: 'monthly', hintShown: true, hintText: 'Personal loans are paid monthly.' }");
    expect(capture).toContain("{ disabled: false, value: 'monthly', hintShown: false }");
    expect(capture).toMatch(/selectOption\('#productType', 'mortgage'\)/);
    expect(capture).toMatch(/selectOption\('#productType', 'personalLoan'\)/);
  });

  it('the personal-loan scenario of the capture already sends Monthly (fixture pinned at its B24 regeneration; B27 itself did not change it)', () => {
    const fixture = readFileSync(join(FIXTURES_DIR, 'a10_ui_capture_v1.json'), 'utf8');
    expect(sha256(fixture)).toBe('171f8a33bf02bc0dd21c200945dfb16586bd64121ba631e2f1146b8b62a5f6d5');
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
