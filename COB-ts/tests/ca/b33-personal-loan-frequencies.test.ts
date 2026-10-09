/**
 * B33 (COB-architecture.md section 5 B33, revision 51; user decision DEC-B33-FREQ, 2026-10-05, COB-user-stories.md 7.5):
 * personal loans at every payment frequency. B27's Monthly-only rule (FB-24 / DEV-FB24) is removed outright, no switch.
 *
 * Engine facts pinned here:
 *   - the catalogue `allowedPaymentFrequencies` stays exported on both barrels and returns the SAME frozen six-item list for
 *     both products (B33-R1, D2); validation no longer consults it (B33-R2);
 *   - a personal loan is accepted at all six frequencies in New, Renewal and Payment change (VRPC stays mortgage + variable);
 *   - the rate rule is unchanged: only a fixed mortgage converts the contract rate (equation 1, m = 2); a personal loan (fixed
 *     or variable) and a variable mortgage use the contract rate as entered at every frequency (workbook D10, MONTHLY basis);
 *   - a personal loan's result equals its mortgage / variable twin except `triggerRatePercent` (null);
 *   - the workbook oracle vectors L3 / L4 / L7 (weekly / bi-weekly personal loans) now run directly, with no `rehome`;
 *   - the goldens are regenerated per B33-R8 (unchanged groups compared with QA's pre-B33 pin).
 *
 * QA red tests, 2026-10-05. Ids B33-T1 .. T8 (T9 / T10 are in b33-frequency-unlocked.test.ts). Red until sr-dev applies
 * B33-R1 / R2 and regenerates the goldens (R8). Independent oracles: the rate formula below (from the brief / Interest Act
 * s. 6), a day-count interest check, the twin, and the workbook vectors of ca_t5_engine_rules_vectors.json.
 */
import { createHash } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import * as ca from '../../src/ca/index.js';
import * as root from '../../src/index.js';
import { PAYMENTS_PER_YEAR, calculateCobCanada, collectInputIssues } from '../../src/ca/index.js';
import type { CobCanadaInput, CobCanadaResult, CobFlow, PaymentFrequency, ProductType, RateType } from '../../src/ca/index.js';
import { asInput, isoDay, utcDate, wireToInput } from './support/builders.js';
import { withinRel } from './support/compare.js';
import { loadFixture } from './support/fixtures.js';
import { preB37GoldenText } from './support/preB37Golden.js';
import { LEAP_OFF, SHIPPED, calculateWith } from './support/switches.js';
// @ts-ignore -- plain .mjs (no .d.ts): the live generators.
import * as gen1 from './fixtures/generate_golden.mjs';
// @ts-ignore -- plain .mjs (no .d.ts).
import * as genPc from './fixtures/generate_golden_pc.mjs';

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
const ALL_FREQS = Object.keys(PAYMENTS_PER_YEAR) as PaymentFrequency[];
const SIX = ['monthly', 'semiMonthly', 'biweekly', 'weekly', 'acceleratedBiweekly', 'acceleratedWeekly'];
const RATES: RateType[] = ['fixed', 'variable'];
const PRODUCTS: ProductType[] = ['mortgage', 'personalLoan'];
const OPEN_FLOWS: CobFlow[] = ['newMortgageOrLoan', 'renewal', 'paymentChange'];
const FLOW_IDS: CobFlow[] = [...OPEN_FLOWS, 'variableRatePaymentChange'];

/** The INV-ACCEPT base input (brief): loan 10000, 8 %, payment 300, start 2027-01-01, first 2027-01-10, end 2030-01-15. */
function input(flow: CobFlow, productType: ProductType, rateType: RateType, paymentFrequency: string, over: Record<string, unknown> = {}): CobCanadaInput {
  const start = utcDate('2027-01-01');
  return asInput({
    flow,
    productType,
    rateType,
    loanAmount: 10000,
    fees: { fees: [] },
    contractRatePercent: 8,
    paymentAmount: 300,
    paymentFrequency,
    firstPaymentDate: utcDate('2027-01-10'),
    endDate: utcDate('2030-01-15'),
    ...(flow === 'newMortgageOrLoan' ? { disbursalDate: start } : { renewalDate: start, accruedInterest: 12.5 }),
    ...over,
  });
}

/** Independent rate oracle (Interest Act s. 6 / workbook r_EquivalentRate): fixed mortgage only; everything else unconverted. */
function expectedRatePercent(productType: ProductType, rateType: RateType, contract: number, f: PaymentFrequency): number {
  if (productType !== 'mortgage' || rateType !== 'fixed') return contract;
  const n = PAYMENTS_PER_YEAR[f];
  return n * ((1 + contract / 200) ** (2 / n) - 1) * 100;
}

/** The prototype sweep: 3 flows x 6 frequencies x 2 rate types x 4 rates x 3 (loan, payment) = 432 personal-loan cases. */
const SWEEP_RATES = [0.5, 6, 8, 19.99];
const SWEEP_AMOUNTS: [number, number][] = [[10000, 300], [250000, 600], [50000, 60]];
const SWEEP: [CobFlow, PaymentFrequency, RateType, number, number, number][] = OPEN_FLOWS.flatMap((fl) =>
  ALL_FREQS.flatMap((f) => RATES.flatMap((r) => SWEEP_RATES.flatMap((rate) => SWEEP_AMOUNTS.map(([loan, pay]) => [fl, f, r, rate, loan, pay] as [CobFlow, PaymentFrequency, RateType, number, number, number])))),
);
const sweepInput = (fl: CobFlow, p: ProductType, r: RateType, f: PaymentFrequency, rate: number, loan: number, pay: number) =>
  input(fl, p, r, f, { contractRatePercent: rate, loanAmount: loan, paymentAmount: pay });

// ---------------------------------------------------------------------------------------------------------------
describe('B33-T1 INV-CATALOGUE: allowedPaymentFrequencies returns the same frozen six for both products', () => {
  const fn = (ca as unknown as { allowedPaymentFrequencies: (p: ProductType) => readonly string[] }).allowedPaymentFrequencies;

  it('personal loan and mortgage: the same array object, frozen, the six frequencies in PAYMENTS_PER_YEAR order', () => {
    const pl = fn('personalLoan');
    const m = fn('mortgage');
    expect(pl).toBe(m);
    expect(Object.isFrozen(pl)).toBe(true);
    expect([...pl]).toEqual(SIX);
    expect([...pl]).toEqual(Object.keys(PAYMENTS_PER_YEAR));
  });

  // B34 (DEC-B34-TERM): re-baselined, + contractTermOptions (ADR-13(i), additive; 7 -> 8 runtime names). B33 itself changed no export.
  // B37 addendum (ADR-13(j), re-baselined by QA 2026-10-09): + paymentsPerYearFor (9 names).
  it('the same binding on both barrels; both barrels export exactly the 9 runtime names (B33: no public-API change; B34: + contractTermOptions; B37: + paymentsPerYearFor)', () => {
    expect((root as Record<string, unknown>)['allowedPaymentFrequencies']).toBe((ca as Record<string, unknown>)['allowedPaymentFrequencies']);
    const NAMES = ['FLOWS', 'PAYMENTS_PER_YEAR', 'allowedPaymentFrequencies', 'calculateCobCanada', 'collectInputIssues', 'contractTerm', 'contractTermOptions', 'paymentsPerYearFor', 'requiresSemiAnnualDate'];
    expect(Object.keys(ca).sort()).toEqual(NAMES);
    expect(Object.keys(root).sort()).toEqual(NAMES);
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe('B33-T2 INV-ACCEPT: personal loan x 6 frequencies x fixed/variable x New/Renewal/Payment change (36) is valid and calculates', () => {
  const CASES = ALL_FREQS.flatMap((f) => RATES.flatMap((r) => OPEN_FLOWS.map((fl) => [f, r, fl] as [PaymentFrequency, RateType, CobFlow])));
  it('36 cases', () => expect(CASES).toHaveLength(36));

  it.each(CASES)('personal loan %s / %s / %s: no issue, calculates, no trigger rate', (f, r, fl) => {
    const x = input(fl, 'personalLoan', r, f);
    expect(collectInputIssues(x)).toEqual([]);
    const res = calculateCobCanada(x);
    expect(res.amortizationSchedule.length).toBeGreaterThan(0);
    expect(res.triggerRatePercent).toBeNull();
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe('B33-T3 INV-ORDER: the whole cross product (4 flows x 2 products x 2 rates x 6 frequencies = 96)', () => {
  it('issue fields are exactly [flow] for VRPC with a pair other than mortgage/variable, else []; no catalogue message anywhere', () => {
    let n = 0;
    let flowIssues = 0;
    for (const fl of FLOW_IDS)
      for (const p of PRODUCTS)
        for (const r of RATES)
          for (const f of ALL_FREQS) {
            const want = fl === 'variableRatePaymentChange' && !(p === 'mortgage' && r === 'variable') ? ['flow'] : [];
            const issues = collectInputIssues(input(fl, p, r, f));
            expect(issues.map((i) => i.field), `${fl}/${p}/${r}/${f}`).toEqual(want);
            for (const i of issues) expect(i.message).not.toContain('is not allowed for productType');
            n += 1;
            if (want.length > 0) flowIssues += 1;
          }
    expect(n).toBe(96);
    expect(flowIssues).toBe(3 * 6); // VRPC x (mortgage/fixed, personalLoan/fixed, personalLoan/variable) x 6
  });

  it('VRPC + personal loan (variable) + weekly: exactly the flow issue, with the flow message', () => {
    expect(collectInputIssues(input('variableRatePaymentChange', 'personalLoan', 'variable', 'weekly'))).toEqual([
      { field: 'flow', message: "flow 'variableRatePaymentChange' is mortgage + variable-rate only, got productType='personalLoan', rateType='variable'" },
    ]);
  });

  it("'fortnightly' gives only the existing enum message, for both products", () => {
    const message = 'paymentFrequency must be one of monthly/semiMonthly/biweekly/weekly/acceleratedBiweekly/acceleratedWeekly, got fortnightly';
    for (const p of PRODUCTS) expect(collectInputIssues(input('newMortgageOrLoan', p, 'variable', 'fortnightly'))).toEqual([{ field: 'paymentFrequency', message }]);
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe('B33-T4 INV-RATE: only a fixed mortgage converts the contract rate', () => {
  it('vectors: personal loan fixed 8 % weekly -> Calculated rate 8 and row 1 interest 10000 x 0.08 x 7/365; mortgage fixed 8 % weekly -> 52 x (1.04^(2/52) - 1)', () => {
    const pl = calculateCobCanada(input('newMortgageOrLoan', 'personalLoan', 'fixed', 'weekly', { firstPaymentDate: utcDate('2027-01-08') }));
    expect(pl.calculatedRatePercent).toBe(8);
    expect(isoDay(pl.amortizationSchedule[0]!.date)).toBe('2027-01-08');
    expect(withinRel(pl.amortizationSchedule[0]!.periodInterest, (10000 * 0.08 * 7) / 365, 1e-12)).toBe(true);
    expect(pl.amortizationSchedule[0]!.periodInterest).toBe(15.342465753424658);
    // B37 (DEC-B37-LEAP-N): workbook converter (n = 52/26), switch off (the expected value is equation 1 at n = 52).
    const m = calculateWith(input('newMortgageOrLoan', 'mortgage', 'fixed', 'weekly'), SHIPPED, LEAP_OFF);
    expect(withinRel(m.calculatedRatePercent, 52 * (1.04 ** (2 / 52) - 1) * 100, 1e-12)).toBe(true);
    expect(m.calculatedRatePercent).toBe(7.850062008028846);
  });

  it('the 432-case sweep: personal loan (both types) and variable mortgage === contract rate exactly; fixed mortgage = equation 1 within 1e-12', () => {
    let checked = 0;
    for (const [fl, f, r, rate, loan, pay] of SWEEP) {
      const pl = calculateCobCanada(sweepInput(fl, 'personalLoan', r, f, rate, loan, pay));
      expect(pl.calculatedRatePercent, `PL ${fl}/${f}/${r}/${rate}`).toBe(rate);
      const vm = calculateCobCanada(sweepInput(fl, 'mortgage', 'variable', f, rate, loan, pay));
      expect(vm.calculatedRatePercent).toBe(rate);
      // B37 (DEC-B37-LEAP-N): workbook converter (n = 52/26), switch off (expectedRatePercent uses PAYMENTS_PER_YEAR).
      const fm = calculateWith(sweepInput(fl, 'mortgage', 'fixed', f, rate, loan, pay), SHIPPED, LEAP_OFF);
      expect(withinRel(fm.calculatedRatePercent, expectedRatePercent('mortgage', 'fixed', rate, f), 1e-12), `FM ${fl}/${f}/${rate}`).toBe(true);
      expect(fm.calculatedRatePercent).not.toBe(rate); // converted at every n (never semi-annual payments here)
      checked += 1;
    }
    expect(checked).toBe(432);
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe('B33-T5 INV-TWIN: a personal loan equals its mortgage / variable twin except the trigger rate (432 cases)', () => {
  it('{ ...personalLoan, triggerRatePercent: null } deep-equals { ...twin, triggerRatePercent: null }; personal loan trigger rate null', () => {
    let n = 0;
    for (const [fl, f, r, rate, loan, pay] of SWEEP) {
      const pl = calculateCobCanada(sweepInput(fl, 'personalLoan', r, f, rate, loan, pay));
      const tw = calculateCobCanada(sweepInput(fl, 'mortgage', 'variable', f, rate, loan, pay));
      expect(pl.triggerRatePercent, `${fl}/${f}/${r}/${rate}/${loan}`).toBeNull();
      expect({ ...pl, triggerRatePercent: null }).toEqual({ ...tw, triggerRatePercent: null });
      n += 1;
    }
    expect(n).toBe(432);
  });
});

// ---------------------------------------------------------------------------------------------------------------
type Row = Record<string, number | string>;
type Vector = { id: string; request: Record<string, unknown>; converted_rate_pct: number; totals: Record<string, number>; rows: Row[] };
describe('B33-T6 INV-WORKBOOK: workbook oracle vectors L3, L4, L7 run directly as personal loans (no rehome)', () => {
  const fx = loadFixture<{ vectors: Vector[] }>('ca_t5_engine_rules_vectors.json');
  const TOL = 1e-9;
  const ROWS: [string, (r: CobCanadaResult['amortizationSchedule'][number]) => number][] = [
    ['open_loan', (r) => r.openingBalance],
    ['new_int', (r) => r.periodInterest],
    ['payment', (r) => r.paymentAmount],
    ['interest_paid', (r) => r.interestPaid],
    ['principal_paid', (r) => r.principalPortion],
    ['close_loan', (r) => r.closingBalance],
  ];
  const TOTALS: [string, (r: CobCanadaResult) => number][] = [
    ['n', (r) => r.numberOfPayments],
    ['total_payment', (r) => r.totalPayment],
    ['cob_amount', (r) => r.cobAmount],
    ['cob_rate', (r) => r.cobRatePercent],
    ['term_days', (r) => r.termDays],
  ];

  it.each(['L3_dec31_start_nonleap', 'L4_dec31_start_leap', 'L7_multiyear_no_leap'])('%s', (id) => {
    const v = fx.vectors.find((x) => x.id === id)!;
    expect(v.request['productType']).toBe('personalLoan');
    expect(v.request['paymentFrequency']).not.toBe('monthly');
    const x = wireToInput(v.request);
    expect(collectInputIssues(x)).toEqual([]);
    const r = calculateCobCanada(x);
    expect(r.triggerRatePercent).toBeNull();
    expect(r.calculatedRatePercent).toBe(5);
    expect(v.converted_rate_pct).toBe(5);
    expect(r.amortizationSchedule).toHaveLength(v.rows.length);
    const bad: string[] = [];
    v.rows.forEach((e, i) => {
      const a = r.amortizationSchedule[i]!;
      if (isoDay(a.date) !== e['date']) bad.push(`row ${i + 1} date ${isoDay(a.date)} vs ${String(e['date'])}`);
      for (const [k, get] of ROWS) if (!withinRel(get(a), e[k] as number, TOL)) bad.push(`row ${i + 1} ${k}: ${get(a)} vs ${String(e[k])}`);
    });
    for (const [k, get] of TOTALS) if (!withinRel(get(r), v.totals[k]!, TOL)) bad.push(`${k}: ${get(r)} vs ${v.totals[k]}`);
    if (!withinRel(r.endingBalance, v.rows.at(-1)!['close_loan'] as number, TOL)) bad.push(`endingBalance ${r.endingBalance}`);
    expect(bad).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe('B33-T7 INV-SEMI: the B25 semi-monthly move applies to a personal loan as to any product', () => {
  it('New, personal loan variable 8 % semi-monthly, typed first 2027-01-10 -> rows 2027-01-15, 2027-01-31', () => {
    const r = calculateCobCanada(input('newMortgageOrLoan', 'personalLoan', 'variable', 'semiMonthly'));
    expect(r.amortizationSchedule.slice(0, 2).map((row) => isoDay(row.date))).toEqual(['2027-01-15', '2027-01-31']);
    expect(r.calculatedRatePercent).toBe(8);
  });

  it('Payment change, personal loan fixed semi-monthly, typed next payment 2027-01-20 -> first row 2027-01-31', () => {
    const r = calculateCobCanada(input('paymentChange', 'personalLoan', 'fixed', 'semiMonthly', { firstPaymentDate: utcDate('2027-01-20') }));
    expect(isoDay(r.amortizationSchedule[0]!.date)).toBe('2027-01-31');
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe('B33-T8 INV-GOLD: the goldens equal B33-R8 (red until sr-dev regenerates); unchanged groups equal QA\'s pre-B33 pin', () => {
  type Fixture = { version: string; note: string; caseFields: string[]; groups: Record<string, { hash: string; n: number }>; long: Record<string, unknown> };
  type PinSide = { version: string; note: string; caseFields: string[]; groups: Record<string, { hash: string; n: number }>; long: Record<string, string> };
  const pin = loadFixture<{ v1: PinSide; pc: PinSide }>('b33_pre_golden_group_hashes.json');
  // B37 (DEC-B37-LEAP-N): workbook converter (n = 52/26), switch off. B37 regenerates both goldens (approved 2026-10-09),
  // so these B33 facts are checked on the pre-B37 goldens, rebuilt byte for byte by the leap-off replay
  // (support/preB37Golden.ts), instead of on the live files. No assertion value changes.
  const raw = (name: string): string => {
    if (name === 'golden_engine_v1.json') return preB37GoldenText('v1');
    if (name === 'golden_engine_pc_v1.json') return preB37GoldenText('pc');
    throw new Error(`B37: B33-T8 reads only the two golden fixtures, got ${name}`);
  };
  beforeAll(() => {
    preB37GoldenText('v1');
    preB37GoldenText('pc');
  }, 120_000);
  const fix = (name: string) => JSON.parse(raw(name)) as Fixture;
  const FEES = ['none', 'fin2000', 'fin2000cash400'];
  const ADDED_V1 = ['weekly', 'biweekly', 'semiMonthly'].flatMap((f) =>
    RATES.flatMap((r) => FEES.flatMap((fee) => ['new', 'renewal0', 'renewal850'].map((fl) => `${f}|personalLoan/${r}|${fee}|${fl}`))),
  );
  const ADDED_PC = ['weekly', 'biweekly', 'semiMonthly'].flatMap((f) =>
    RATES.flatMap((r) => FEES.flatMap((fee) => ['acc0', 'acc850'].map((a) => `pc|${f}|personalLoan/${r}|${fee}|${a}`))),
  );

  it('the pre-B33 pin is the fixture QA pinned (94 / 86 groups; shas 249651b2... / acfe374c...)', () => {
    expect(Object.keys(pin.v1.groups)).toHaveLength(94);
    expect(Object.keys(pin.pc.groups)).toHaveLength(86);
    expect((pin.v1 as unknown as { fileSha256: string }).fileSha256).toBe('249651b25b33cb9c1b5480d2ee1a26404d64f3321ea980de2bd3e23193e6cf11');
    expect((pin.pc as unknown as { fileSha256: string }).fileSha256).toBe('acfe374c6def2cea5bb723c8c639a72e0088aed7f8c952b561d724bd8d26d23e');
  });

  it('file shas = B33-R8 (v1 922fd695...3aee; PC 5ab1c6a6...a7df5, which is the archived pre-B27 PC fixture byte for byte)', () => {
    expect(sha256(raw('golden_engine_v1.json'))).toBe('922fd69580e420957bfaa928a60b553fdbff07b4e92215de81422e901cc93aee');
    expect(sha256(raw('golden_engine_pc_v1.json'))).toBe('5ab1c6a6c086ba737d790bb1e42f2eb36ccd61c3c256e2634a6d5cc312fa7df5');
  });

  it('v1: 148 groups / 4,455 cases; keys = the generator order; the pre-B33 keys keep their relative order; 54 added', () => {
    const f = fix('golden_engine_v1.json');
    const keys = Object.keys(f.groups);
    expect(keys).toHaveLength(148);
    expect(Object.values(f.groups).reduce((s, g) => s + g.n, 0)).toBe(4455);
    expect(keys).toEqual((gen1.buildGroups() as { key: string }[]).map((g) => g.key));
    expect(keys.filter((k) => k in pin.v1.groups)).toEqual(Object.keys(pin.v1.groups));
    expect(keys.filter((k) => !(k in pin.v1.groups)).sort()).toEqual([...ADDED_V1].sort());
    for (const k of ADDED_V1) expect(f.groups[k]!.n, k).toBe(26);
  });

  it('v1: the 93 other pre-B33 groups are byte-identical (hash and n); extra:underpayment 78 -> 312 (5c2c9516... -> 8ec54eda...); long cases unchanged', () => {
    const f = fix('golden_engine_v1.json');
    const others = Object.keys(pin.v1.groups).filter((k) => k !== 'extra:underpayment');
    expect(others).toHaveLength(93);
    for (const k of others) expect(f.groups[k], k).toMatchObject(pin.v1.groups[k]!);
    const u = f.groups['extra:underpayment']!;
    expect(pin.v1.groups['extra:underpayment']!.n).toBe(78);
    expect(pin.v1.groups['extra:underpayment']!.hash.startsWith('5c2c9516')).toBe(true);
    expect(u.n).toBe(312);
    expect(u.hash.startsWith('8ec54eda')).toBe(true);
    expect(Object.keys(f.long)).toEqual(Object.keys(pin.v1.long));
    for (const k of Object.keys(f.long)) expect(sha256(JSON.stringify(f.long[k])), k).toBe(pin.v1.long[k]);
    expect([f.version, f.note, f.caseFields]).toEqual([pin.v1.version, pin.v1.note, pin.v1.caseFields]);
  });

  it('PC: 122 groups / 3,536 cases; 36 added; the 85 other pre-B33 groups byte-identical; pcx:underpayment 52 -> 208 (3349478a... -> 85aa04e4...)', () => {
    const f = fix('golden_engine_pc_v1.json');
    const keys = Object.keys(f.groups);
    expect(keys).toHaveLength(122);
    expect(Object.values(f.groups).reduce((s, g) => s + g.n, 0)).toBe(3536);
    expect(keys).toEqual((genPc.buildGroups() as { key: string }[]).map((g) => g.key));
    expect(keys.filter((k) => k in pin.pc.groups)).toEqual(Object.keys(pin.pc.groups));
    expect(keys.filter((k) => !(k in pin.pc.groups)).sort()).toEqual([...ADDED_PC].sort());
    const others = Object.keys(pin.pc.groups).filter((k) => k !== 'pcx:underpayment');
    expect(others).toHaveLength(85);
    for (const k of others) expect(f.groups[k], k).toMatchObject(pin.pc.groups[k]!);
    expect(pin.pc.groups['pcx:underpayment']!.n).toBe(52);
    expect(pin.pc.groups['pcx:underpayment']!.hash.startsWith('3349478a')).toBe(true);
    expect(f.groups['pcx:underpayment']!.n).toBe(208);
    expect(f.groups['pcx:underpayment']!.hash.startsWith('85aa04e4')).toBe(true);
    expect([f.version, f.note, f.caseFields]).toEqual([pin.pc.version, pin.pc.note, pin.pc.caseFields]);
  });

  it('PC long cases: long:vrpc:monthly:acc850 unchanged; the personal-loan case is weekly again (long:pc:weekly:acc850:underpayment, payment 200)', () => {
    const f = fix('golden_engine_pc_v1.json');
    expect(Object.keys(f.long)).toEqual(['long:vrpc:monthly:acc850', 'long:pc:weekly:acc850:underpayment']);
    expect(sha256(JSON.stringify(f.long['long:vrpc:monthly:acc850']))).toBe(pin.pc.long['long:vrpc:monthly:acc850']);
    const longs = genPc.buildLongCases() as { key: string; params: Record<string, unknown> }[];
    expect(longs.map((c) => c.key)).toEqual(Object.keys(f.long));
    expect(longs[1]!.params).toMatchObject({ frequency: 'weekly', productType: 'personalLoan', rateType: 'fixed', feeSet: 'fin2000', flowKey: 'pc', accKey: 'acc850', payment: 200, years: 30 });
  });

  it('every corpus input (all group cases and long cases of both generators) validates on the shipped engine', () => {
    let n = 0;
    for (const gen of [gen1, genPc]) {
      const groups = gen.buildGroups() as { key: string; cases: { label: string; params: unknown }[] }[];
      const inputs = [
        ...groups.flatMap((g) => g.cases.map((c) => ({ k: `${g.key} ${c.label}`, p: c.params }))),
        ...(gen.buildLongCases() as { key: string; params: unknown }[]).map((c) => ({ k: c.key, p: c.params })),
      ];
      for (const { k, p } of inputs) {
        const issues = collectInputIssues(gen.makeInput(p) as CobCanadaInput);
        if (issues.length > 0) expect(issues, k).toEqual([]);
        n += 1;
      }
    }
    expect(n).toBe(4455 + 6 + 3536 + 2);
  });
});
