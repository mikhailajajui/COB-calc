import { describe, expect, it } from 'vitest';
import { calculateCobCanada, FLOWS, requiresSemiAnnualDate } from '../../src/ca/index.js';
import type { CobCanadaInput, CobCanadaResult, CobFlow, ProductType, RateType } from '../../src/ca/index.js';
import type * as View from '../../ui/ca-view.js';
import { asInput, isoDay, utcDate, wireToInput } from './support/builders.js';
import { expectRangeErrorMatching, withinRel as withinRelTol } from './support/compare.js';
import { loadFixture as load } from './support/fixtures.js';
import { LEAP_OFF, SHIPPED, WORKBOOK, calculateWith } from './support/switches.js';
import type { Switches } from './support/switches.js';
import { ON } from './support/uiSwitches.js';

/**
 * TDD red tests for the macro-parity defect register (archive:
 * ~/Projects/cob_calculator/docs/new-req/012-cob-ts-macro-parity-defects.md; user decision
 * 2026-09-25: COB-ts is the macro-parity reference; every divergence is a defect).
 *
 * Every expected number comes from the archived oracle
 * (a VBA transliteration, NOT a live macro run), never from this engine:
 * - ca_defect_012_vectors.json (generate_defect_012_vectors.py) for the new vectors;
 * - ca_oracle_scenarios.json for the reused S1/S2/S4/S5/S6, with their request from
 *   ca_app_wire_vectors.json.
 * The validation defects (D-08, D-10, D-11, D-12) assert 012's "Expected" directly.
 * The UI defects D-06 and D-09 are tested through ui/ca-view.js `toInput` (the DOM-free form
 * mapping, A10) on raws captured from the page (a10_ui_capture_v1.json). D-13 (screen labels in
 * ui/ca.html) is covered by tests/ca/b22-use-case-labels.test.ts and the Chrome capture (B22 closed OQ-A).
 *
 * Each test is `it.fails` while its defect is open. When sr-dev fixes a defect, the
 * test starts passing, `it.fails` turns red, and the `.fails` must be removed.
 */

type Row = Record<string, number | string>;
interface Expected {
  totals: Record<string, number>;
  rows: Row[];
  converted_rate_pct: number;
}
interface DefectVector extends Expected {
  id: string;
  defect: string;
  request: Record<string, unknown>;
}

const TOL = 1e-9;
const defects = load('ca_defect_012_vectors.json') as { vectors: DefectVector[] };
const oracle = load('ca_oracle_scenarios.json') as { scenarios: (Expected & { inputs: { id: string } })[] };
const wire = load('ca_app_wire_vectors.json') as {
  totals_map: Record<string, string>;
  row_map: Record<string, string>;
  vectors: { id: string; request: Record<string, unknown> }[];
};

const toEngineInput = (request: Record<string, unknown>): CobCanadaInput => wireToInput(request);

/** A vector: request + oracle expectation, from the 012 fixture or the reused S-scenarios. */
function vector(id: string): { input: CobCanadaInput; expected: Expected } {
  const own = defects.vectors.find((v) => v.id === id);
  if (own) return { input: toEngineInput(own.request), expected: own };
  const sc = oracle.scenarios.find((s) => s.inputs.id === id);
  const req = wire.vectors.find((v) => v.id === id);
  if (!sc || !req) throw new Error(`no vector ${id}`);
  return { input: toEngineInput(req.request), expected: sc };
}

const iso = isoDay;

const withinRel = (actual: number, expected: number): boolean => withinRelTol(actual, expected, TOL);

interface CompareOpts {
  /** engine totals keys to compare (default: every key of wire.totals_map present in the fixture) */
  totals?: string[];
  /** engine row keys to compare (default: every key of wire.row_map) */
  rowFields?: string[];
  /** also compare calculatedRatePercent (default true) */
  rate?: boolean;
}

/** Every mismatch between the engine result and the oracle, as readable strings. */
function mismatches(result: CobCanadaResult, expected: Expected, opts: CompareOpts = {}): string[] {
  const out: string[] = [];
  const totals = opts.totals ?? Object.keys(wire.totals_map);
  for (const key of totals) {
    const fx = wire.totals_map[key]!;
    if (!(fx in expected.totals)) continue;
    const a = result[key as keyof CobCanadaResult] as number;
    if (!withinRel(a, expected.totals[fx]!)) out.push(`${key}: ${String(a)} vs ${expected.totals[fx]}`);
  }
  if ((opts.rate ?? true) && !withinRel(result.calculatedRatePercent, expected.converted_rate_pct)) {
    out.push(`calculatedRatePercent: ${result.calculatedRatePercent} vs ${expected.converted_rate_pct}`);
  }
  const rows = result.amortizationSchedule;
  if (rows.length !== expected.rows.length) out.push(`rows: ${rows.length} vs ${expected.rows.length}`);
  const fields = opts.rowFields ?? Object.keys(wire.row_map);
  for (let i = 0; i < Math.min(rows.length, expected.rows.length); i++) {
    const row = rows[i]!;
    const fx = expected.rows[i]!;
    for (const key of fields) {
      const f = wire.row_map[key]!;
      if (key === 'date') {
        if (iso(row.date) !== fx[f]) out.push(`row ${i + 1} date: ${iso(row.date)} vs ${String(fx[f])}`);
        continue;
      }
      const a = row[key as keyof typeof row] as number;
      if (!withinRel(a, fx[f] as number)) out.push(`row ${i + 1} ${key}: ${String(a)} vs ${String(fx[f])}`);
    }
  }
  return out;
}

const run = (id: string, opts?: CompareOpts) => {
  const { input, expected } = vector(id);
  // B37 (DEC-B37-LEAP-N): workbook converter (n = 52/26), switch off (012 vectors are workbook / macro-oracle output).
  return mismatches(calculateWith(input, SHIPPED, LEAP_OFF), expected, opts);
};

/** A valid 007-style new-mortgage input, for the validation defects. */
const d = utcDate;
function base(overrides: Record<string, unknown> = {}): CobCanadaInput {
  return asInput({
    flow: 'newMortgageOrLoan',
    productType: 'mortgage',
    rateType: 'fixed',
    loanAmount: 227829.65,
    contractRatePercent: 3.74,
    paymentAmount: 465.46,
    paymentFrequency: 'weekly',
    firstPaymentDate: d('2026-03-23'),
    endDate: d('2029-03-17'),
    termYears: 3,
    termMonths: 0,
    fees: { fees: [] },
    disbursalDate: d('2026-03-17'),
    semiAnnualCompoundingDate: d('2026-03-17'),
    ...overrides,
  });
}
const renewal = (overrides: Record<string, unknown> = {}) =>
  base({ flow: 'renewal', disbursalDate: undefined, renewalDate: d('2026-03-17'), accruedInterest: 0, ...overrides });
const fee = (amount: number, financed: boolean) => ({ name: financed ? 'Financed' : 'Cash', amount, financed, includedInCob: true });

/** Throws a RangeError whose message names `field` (so a downstream RangeError can't pass for it). */
const expectRangeErrorNaming = expectRangeErrorMatching;

describe('012 D-01 semi-monthly dates follow the 15th / month-end calendar (getNextSemiMonthly)', () => {
  // B25 (DEV-OQZ): a typed first date that is not the 15th / month-end is moved forward first. Those vectors are compared with the
  // macro CalculateAll run from the MOVED date (b25_semimonthly_move_vectors.json 'vectors', group D-01; known_divergence
  // DEV-OQZ); the others stay workbook truth from ca_defect_012_vectors.json.
  const moved = (load('b25_semimonthly_move_vectors.json') as { vectors: (DefectVector & { group: string; typed: string; moved: string })[] }).vectors.filter(
    (v) => v.group === 'D-01',
  );
  const movedIds = new Set(moved.map((v) => v.id));
  const ids = defects.vectors.filter((v) => v.defect === 'D-01').map((v) => v.id);
  for (const id of ids.filter((x) => !movedIds.has(x))) {
    // T4 2026-09-27: semi-monthly getNextSemiMonthly port (D-01 fixed, .fails removed)
    it(`${id}: dates, rows and totals match the oracle`, () => {
      expect(run(id)).toEqual([]);
    });
  }
  it('the 5 moved D-01 vectors are exactly those whose typed first date is not a 15th / month-end (2026-01-01, -10, -14, -20, -30)', () => {
    expect([...movedIds].sort()).toEqual(['D01_semi_2026-01-01', 'D01_semi_2026-01-10', 'D01_semi_2026-01-14', 'D01_semi_2026-01-20', 'D01_semi_2026-01-30']);
  });
  for (const v of moved) {
    it(`${v.id} [known_divergence DEV-OQZ]: typed ${v.typed} -> moved ${v.moved}; dates, rows and totals match the macro run from the moved date`, () => {
      expect(mismatches(calculateCobCanada(toEngineInput(v.request)), v)).toEqual([]);
    });
  }
  // T4 2026-09-27: semi-monthly getNextSemiMonthly port (D-01 fixed, .fails removed)
  it('S4_semimonthly: dates, rows and totals match the oracle', () => {
    expect(run('S4_semimonthly')).toEqual([]);
  });
});

describe('012 D-02 unpaid interest compounds; totalInterest / C / endingBalance count interest accrued', () => {
  // Only what the oracle fixes unambiguously (architect still settles row fields / invariant #2).
  // B19 (DEV-OQL): D-02 is the workbook's capitalisation, so it runs against the workbook branch by default.
  const check = (id: string, switches: Switches = WORKBOOK) => {
    const { input, expected } = vector(id);
    const r = calculateWith(input, switches, LEAP_OFF); // B37 (DEC-B37-LEAP-N): workbook converter (n = 52/26), switch off
    const out = mismatches(r, expected, { totals: [], rowFields: ['date', 'periodInterest'], rate: false });
    const accrued = expected.totals.total_interest!;
    if (!withinRel(r.totalInterest, accrued)) out.push(`totalInterest: ${r.totalInterest} vs ${accrued}`);
    if (!withinRel(r.cobAmount, expected.totals.cob_amount!)) out.push(`cobAmount: ${r.cobAmount} vs ${expected.totals.cob_amount}`);
    const ending = expected.rows[expected.rows.length - 1]!.close_loan as number;
    if (!withinRel(r.endingBalance, ending)) out.push(`endingBalance: ${r.endingBalance} vs ${ending}`);
    return out;
  };
  // T6 2026-09-27: OQ-L unpaid interest carried in balance (D-02 fixed, .fails removed)
  it('scenario A ($100k, 12%, monthly, $500): per-row interest, totalInterest, cobAmount, endingBalance', () => {
    expect(check('D02_scenarioA_underpay')).toEqual([]);
  });
  // T6 2026-09-27: OQ-L unpaid interest carried in balance (D-02 fixed, .fails removed)
  it('S6_underpay: per-row interest, totalInterest, cobAmount, endingBalance', () => {
    expect(check('S6_underpay')).toEqual([]);
  });
  // known_divergence DEV-OQL (B19, decision 1): the shipped branch charges no interest on unpaid
  // interest, so the workbook's compounding vectors no longer match it.
  it('known_divergence DEV-OQL scenario A: shipped does not match the workbook vector', () => {
    expect(check('D02_scenarioA_underpay', SHIPPED).length).toBeGreaterThan(0);
  });
  // known_divergence DEV-OQL (B19, decision 1): as above.
  it('known_divergence DEV-OQL S6_underpay: shipped does not match the workbook vector', () => {
    expect(check('S6_underpay', SHIPPED).length).toBeGreaterThan(0);
  });
});

describe('012 D-03 monthly dates clamp to month-end (DateAdd("m", k, first))', () => {
  // OQ-X (business decision 2026-09-27) intentionally departs from the workbook when the
  // First Payment Date is a month-end. The fixture keeps the workbook truth; the vectors
  // listed here get a split test instead of full parity (see below).
  const OQX_INTENTIONAL_DIVERGENCE = ['D03_monthly_rowcount_2028-02-29'];
  const ids = defects.vectors.filter((v) => v.defect === 'D-03').map((v) => v.id);
  for (const id of ids.filter((i) => !OQX_INTENTIONAL_DIVERGENCE.includes(i))) {
    // T3 2026-09-27: monthly DateAdd month-end clamp (D-03 fixed, .fails removed)
    it(`${id}: dates, rows and totals match the oracle`, () => {
      expect(run(id)).toEqual([]);
    });
  }
  for (const id of OQX_INTENTIONAL_DIVERGENCE) {
    // Holds before AND after OQ-X: the first row (its date is the input) and the row
    // count (13 under both rules: the workbook's 29ths and OQ-X's month-ends both end on
    // 2029-02-28) are not touched by the month-end rule.
    it(`${id}: row count, row 1 and last date match the workbook (unaffected by OQ-X)`, () => {
      const { input, expected } = vector(id);
      const r = calculateCobCanada(input);
      const one = { ...expected, rows: expected.rows.slice(0, 1), totals: {} };
      const out = mismatches({ ...r, amortizationSchedule: r.amortizationSchedule.slice(0, 1) }, one);
      if (r.amortizationSchedule.length !== expected.rows.length) out.push(`rows: ${r.amortizationSchedule.length} vs ${expected.rows.length}`);
      const last = r.amortizationSchedule[r.amortizationSchedule.length - 1];
      if (!last || iso(last.date) !== expected.rows[expected.rows.length - 1]!.date) out.push(`last date: ${last ? iso(last.date) : 'none'}`);
      expect(out).toEqual([]);
    });
    // OQ-X: intentional divergence from the workbook (month-end rule, 2026-09-27). Red
    // until OQ-X lands; then the workbook's Mar 29 ... Jan 29 dates must NOT be produced.
    // The positive OQ-X expectation for these inputs is monthlyMonthEnd-oqx.test.ts
    // (OQX_feb29_2028_to_feb28_2029). Never edit the fixture values: they are workbook truth.
    it.fails(`${id}: full workbook parity -- intentional divergence OQ-X`, () => {
      expect(run(id)).toEqual([]);
    });
  }
  // T3 2026-09-27: monthly DateAdd month-end clamp (D-03 fixed, .fails removed)
  it('S2_monthly_jan31: dates, rows and totals match the oracle', () => {
    expect(run('S2_monthly_jan31')).toEqual([]);
  });
});

describe('012 D-04 COB-rate P averages principal only (openingBalance - feesOpening)', () => {
  // 012 D-04: remove .fails when fixed
  it.fails('007 inputs + $2,000 financed fee: cobRatePercent (and every row/total) match the oracle', () => {
    expect(run('D04_007_fin2000')).toEqual([]);
  });
});

/**
 * DEV-OQS (OQ-S decided for the BRD 2026-09-27; B6 retired 012 D-05; same rule as spec 011
 * DEV-011-1 / DQ-27). Intentional difference from Excel: non-financed (cash) fees stay out of
 * principal and the payment waterfall and count only in C (and so in the COB rate).
 *
 * Two parts:
 * - known_divergence DEV-OQS: the workbook values for S1_fees (ca_oracle_scenarios.json, macro
 *   oracle, never edited) stay here to document the Excel behaviour. The macro puts F + N = 2500
 *   into the fee bucket and takes it from principal first; the engine recovers F = 2000 only. The
 *   test pins WHERE the two differ, so it goes red if the engine drifts back to Excel or starts
 *   differing anywhere else.
 * - BRD behaviour: S1_fees must equal the macro oracle run with the cash fee removed
 *   (d9_oracle_vectors.json S1_financed_only, the archived oracle run with non_fin_fee=0), with
 *   N = 500 added to C only.
 */
describe('DEV-OQS (OQ-S, was 012 D-05): cash fees stay out of principal and the waterfall', () => {
  const S1_FIN = 2000;
  const S1_CASH = 500;
  const d9 = load('d9_oracle_vectors.json') as {
    cases: { id: string; request: Record<string, unknown>; totals: Record<string, number>; rows: Row[] }[];
  };
  const brd = d9.cases.find((c) => c.id === 'S1_financed_only')!;
  const workbook = oracle.scenarios.find((s) => s.inputs.id === 'S1_fees')!;
  // B37 (DEC-B37-LEAP-N): workbook converter (n = 52/26), switch off (S1_fees is fixed weekly; the oracle is the macro).
  const s1 = () => calculateWith(vector('S1_fees').input, SHIPPED, LEAP_OFF);

  // known_divergence DEV-OQS: workbook fixture values kept; the difference is asserted, not hidden.
  it('known_divergence DEV-OQS: S1_fees differs from the workbook only in the fee/principal split', () => {
    // cobRatePercent left out: it also depends on 012 D-04 (P definition).
    const diffs = run('S1_fees', {
      totals: ['numberOfPayments', 'cobAmount', 'totalPayment', 'totalInterest', 'termDays'],
    });
    expect(diffs.length).toBeGreaterThan(0);
    const allowed = /^row \d+ (feesOpening|feesPaid|feesClosing|principalPortion):/;
    expect(diffs.filter((m) => !allowed.test(m))).toEqual([]);
    // Excel (macro lines 387-388): row 1 fee bucket = F + N and principal = loan - F - N.
    expect(workbook.rows[0]!.open_fees).toBe(S1_FIN + S1_CASH);
    expect(workbook.rows[0]!.open_principal).toBeCloseTo(227829.65 - S1_FIN - S1_CASH, 9);
    // BRD (engine): the fee bucket is F only; disbursal and principal ignore N.
    const r = s1();
    expect(r.amortizationSchedule[0]!.feesOpening).toBe(S1_FIN);
    expect(r.disbursalAmount).toBeCloseTo(227829.65 - S1_FIN, 9);
  });

  it('BRD: S1_fees schedule equals the macro oracle with the cash fee removed (every row, every field)', () => {
    expect(mismatches(s1(), brd as unknown as Expected, { rate: false, totals: [] })).toEqual([]);
  });

  it('BRD: the cash fee is not recovered through the waterfall and is not in principal', () => {
    const r = s1();
    const rows = r.amortizationSchedule;
    for (const row of rows) expect(row.feesOpening).toBeLessThanOrEqual(S1_FIN);
    expect(withinRel(rows.reduce((s, x) => s + x.feesPaid, 0), S1_FIN)).toBe(true);
    expect(withinRel(r.feesRecovered, S1_FIN)).toBe(true);
    expect(r.amortizedPrincipal).toBe(227829.65);
    expect(withinRel(r.disbursalAmount, 227829.65 - S1_FIN)).toBe(true);
  });

  it('BRD: the cash fee is not charged interest (periodInterest and totalInterest equal the no-cash-fee oracle)', () => {
    const r = s1();
    r.amortizationSchedule.forEach((row, i) => {
      expect(withinRel(row.periodInterest, brd.rows[i]!.new_int as number)).toBe(true);
    });
    expect(withinRel(r.totalInterest, brd.totals.total_interest!)).toBe(true);
    expect(withinRel(r.totalPayment, brd.totals.total_payment!)).toBe(true);
    expect(r.numberOfPayments).toBe(brd.totals.n);
    expect(r.termDays).toBe(brd.totals.term_days);
  });

  it('BRD: the cash fee counts in C and in the COB rate (C = oracle interest + F + N)', () => {
    const r = s1();
    const cOracle = brd.totals.total_interest! + S1_FIN + S1_CASH;
    expect(withinRel(r.cobAmount, cOracle)).toBe(true);
    // Same schedule (so same T and P, whatever P's definition after D-04), so the COB rate
    // scales with C alone: rate(F + N) / rate(F) = (I + F + N) / (I + F).
    const financedOnly = calculateWith(toEngineInput(brd.request), SHIPPED, LEAP_OFF); // B37: same (off) state as s1()
    const ratio = cOracle / (brd.totals.total_interest! + S1_FIN);
    expect(withinRel(r.cobRatePercent / financedOnly.cobRatePercent, ratio)).toBe(true);
    expect(r.cobRatePercent).toBeGreaterThan(financedOnly.cobRatePercent);
    // The contract-rate conversion is untouched by fees.
    expect(r.calculatedRatePercent).toBe(financedOnly.calculatedRatePercent);
  });
});

// D-06 and D-09 (A10 step 2, COB-architecture.md §5 A10, revision 15): the form strings go through
// ui/ca-view.js toInput(raw, ctx) exactly as the page sends them, then through the engine.
const a10Capture = load('a10_ui_capture_v1.json') as { scenarios: { id: string; raw: View.RawForm }[] };
const capturedRaw = (id: string): View.RawForm => {
  const s = a10Capture.scenarios.find((x) => x.id === id);
  if (!s) throw new Error(`scenario ${id} missing from a10_ui_capture_v1.json`);
  return s.raw;
};
const loadView = () => import('../../ui/ca-view.js') as Promise<typeof View>;
const viewCtx = (raw: View.RawForm): View.ViewContext => ({
  spec: FLOWS[raw.flow as CobFlow],
  semiAnnual: requiresSemiAnnualDate(raw.productType as ProductType, raw.rateType as RateType),
  switches: ON, // B23: the pre-B23 page (financedOption on); the defects characterised here do not depend on it
});
/** The engine's message for a form, or null when the calculation succeeds. */
const formMessage = async (raw: View.RawForm): Promise<string | null> => {
  const { toInput } = await loadView();
  try {
    calculateCobCanada(toInput(raw, viewCtx(raw)));
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
};

describe('012 D-06 UI: blank contract rate is rejected, not run at 0%', () => {
  // Delivered by B14 (OQ-AA revised); green at once.
  it('D06a: a blank rate is rejected with the finite-number message', async () => {
    expect(await formMessage({ ...capturedRaw('REF-01'), contractRatePercent: '' })).toBe(
      'contractRatePercent must be a finite number, got NaN',
    );
  });
  it('D06b: a typed 0 rate is rejected with the > 0 message (OQ-AA revised)', async () => {
    expect(await formMessage({ ...capturedRaw('REF-01'), contractRatePercent: '0' })).toBe(
      'contractRatePercent must be > 0, got 0',
    );
  });
});

describe('012 D-07 payoff row records the principal only as paymentAmount', () => {
  // OQ-K/OQ-T 2026-09-27: workbook rule replaces DQ-28 (D-07 fixed, .fails removed)
  it('S5_payoff: every row and totals match the oracle', () => {
    expect(run('S5_payoff')).toEqual([]);
  });
});

describe('012 D-08 fee limit counts financed + cash fees', () => {
  const loan = (fees: unknown[]) => base({ loanAmount: 1000, paymentAmount: 50, fees: { fees } });
  // B2 (012 D-08, OQ-M) 2026-09-27: fixed, .fails removed
  it('loan 1000, 600 financed + 600 cash -> RangeError', () => {
    expectRangeErrorNaming(() => calculateCobCanada(loan([fee(600, true), fee(600, false)])), /fee/i);
  });
  // B2 (012 D-08, OQ-M) 2026-09-27: fixed, .fails removed
  it('loan 1000, 500 financed + 500 cash (total == loan) -> RangeError', () => {
    expectRangeErrorNaming(() => calculateCobCanada(loan([fee(500, true), fee(500, false)])), /fee/i);
  });
});

describe('012 D-09 UI (B24: D09a, D09b, D09c retired; the term inputs are gone from the page)', () => {
  // D09a (blank years rejected), D09b (blank months rejected) and D09c (typed 0 years, 6 months sent as 0) pinned the
  // Term years / Term months inputs, which B24 removes (user 2026-09-30). `toInput` sends neither key: b24-form-cleanup T6.
  it('D09d: A10-R6 unchanged, B20 (decision 4): a blank accrued interest sends no key and the engine rejects it; a typed 0 is accepted', async () => {
    const { toInput } = await loadView();
    const renewal = capturedRaw('RENEWAL');
    const blank = toInput({ ...renewal, accruedInterest: '' }, viewCtx(renewal));
    const zero = toInput({ ...renewal, accruedInterest: '0' }, viewCtx(renewal));
    expect('accruedInterest' in blank).toBe(false);
    expect(zero.accruedInterest).toBe(0);
    expect(() => calculateCobCanada(blank)).toThrow(/requires accruedInterest/);
    expect(() => calculateCobCanada(zero)).not.toThrow();
  });
});

describe('012 D-10 fee totals are unrounded sums', () => {
  // B1 2026-09-27: OQ-H unrounded fee totals (D-10 fixed, .fails removed)
  it('financed fee 999.996 on a $1,000 loan is accepted', () => {
    expect(() =>
      calculateCobCanada(base({ loanAmount: 1000, paymentAmount: 50, fees: { fees: [fee(999.996, true)] } })),
    ).not.toThrow();
  });
  // B1 2026-09-27: OQ-H unrounded fee totals (D-10 fixed, .fails removed)
  it('financed fee 100.004: cobAmount - totalInterest == 100.004', () => {
    const r = calculateCobCanada(base({ fees: { fees: [fee(100.004, true)] } }));
    expect(Math.abs(r.cobAmount - r.totalInterest - 100.004)).toBeLessThan(1e-9);
  });
});

describe('012 D-11 non-finite numbers, non-number types and unknown enum strings -> RangeError', () => {
  const cases: [string, () => CobCanadaInput, RegExp][] = [
    ['loanAmount Infinity', () => base({ loanAmount: Infinity }), /loanAmount/],
    ['contractRatePercent Infinity', () => base({ contractRatePercent: Infinity }), /contractRatePercent/],
    ['accruedInterest Infinity (renewal)', () => renewal({ accruedInterest: Infinity }), /accruedInterest/],
    ['cash fee amount Infinity', () => base({ fees: { fees: [fee(Infinity, false)] } }), /amount/],
    ['paymentAmount as a string', () => base({ paymentAmount: '465.46' }), /paymentAmount/],
    // renewalDate supplied too, so the missing-renewalDate RangeError can't stand in for the flow check.
    ['flow "foo"', () => base({ flow: 'foo', renewalDate: d('2026-03-17') }), /flow/],
    ['productType "car"', () => base({ productType: 'car' }), /productType/],
    ['rateType "floating"', () => base({ rateType: 'floating' }), /rateType/],
    ['paymentFrequency "toString"', () => base({ paymentFrequency: 'toString' }), /paymentFrequency/],
    ['fees null', () => base({ fees: null }), /fees/],
  ];
  for (const [name, input, field] of cases) {
    it(`${name} -> RangeError naming the field`, () => {
      expectRangeErrorNaming(() => calculateCobCanada(input()), field);
    });
  }
});

describe('012 D-12 dates validated by name, ordering compared on UTC calendar dates', () => {
  // B3b (012 D-12) 2026-09-27: fixed, .fails removed
  it('Invalid Date disbursalDate -> RangeError naming disbursalDate', () => {
    expectRangeErrorNaming(() => calculateCobCanada(base({ disbursalDate: new Date(NaN) })), /disbursalDate/);
  });
  // B3b (012 D-12) 2026-09-27: fixed, .fails removed
  it('Invalid Date renewalDate -> RangeError naming renewalDate', () => {
    expectRangeErrorNaming(() => calculateCobCanada(renewal({ renewalDate: new Date(NaN) })), /renewalDate/);
  });
  // B3b (012 D-12) 2026-09-27: fixed, .fails removed
  it('string disbursalDate -> RangeError naming disbursalDate (not TypeError)', () => {
    expectRangeErrorNaming(() => calculateCobCanada(base({ disbursalDate: '2026-03-17' })), /disbursalDate/);
  });
  // B3b (012 D-12) 2026-09-27: fixed, .fails removed
  it('null disbursalDate -> RangeError naming disbursalDate (not TypeError)', () => {
    expectRangeErrorNaming(() => calculateCobCanada(base({ disbursalDate: null })), /disbursalDate/);
  });
  // B3b (012 D-12) 2026-09-27: fixed, .fails removed
  it('disbursalDate later the same UTC day as firstPaymentDate is accepted (calendar-date compare)', () => {
    expect(() =>
      calculateCobCanada(base({ disbursalDate: new Date('2026-03-23T12:00:00Z'), firstPaymentDate: d('2026-03-23') })),
    ).not.toThrow();
  });
  // B3b (012 D-12) 2026-09-27: fixed, .fails removed
  it('endDate on the same UTC day as firstPaymentDate (later time) -> RangeError naming endDate', () => {
    expectRangeErrorNaming(
      () => calculateCobCanada(base({ endDate: new Date('2026-03-23T18:00:00Z'), firstPaymentDate: d('2026-03-23') })),
      /endDate/,
    );
  });
  // B3b (012 D-12) 2026-09-27: fixed, .fails removed
  it('endDate == firstPaymentDate is rejected without claiming zero rows (the inclusive rule gives one)', () => {
    let msg = '';
    try {
      calculateCobCanada(base({ endDate: d('2026-03-23') }));
    } catch (e) {
      expect(e).toBeInstanceOf(RangeError);
      msg = (e as Error).message;
    }
    expect(msg).toMatch(/endDate/);
    expect(msg).not.toMatch(/zero/i);
  });
});
