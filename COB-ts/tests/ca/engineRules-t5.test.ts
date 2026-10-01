import { describe, expect, it } from 'vitest';
import { calculateCobCanada } from '../../src/ca/index.js';
import { dayCountFraction } from '../../src/ca/equations.js';
import type { CobCanadaInput, CobCanadaResult, CobScheduleRow } from '../../src/ca/index.js';
import { isoDay, utcDate, wireToInput } from './support/builders.js';
import { withinRel as withinRelTol } from './support/compare.js';
import { loadFixture } from './support/fixtures.js';
import { rehome } from './support/rehome.js';
import { SHIPPED, WORKBOOK, calculateWith } from './support/switches.js';
import type { Switches } from './support/switches.js';

/**
 * T5 (QA 2026-09-27), checklist Phase 2c rules not yet pinned:
 *  - the leap-year day-count split vs the macro's getRate / crossesLeapYear (periods into
 *    and out of a leap year, periods starting Dec 31, multi-year single periods that hit
 *    getRate's middle-year `ratePart = ANNUALRATE` branch, a multi-year non-leap span);
 *  - OQ-L (resolved: workbook behaviour): unpaid interest carries forward, stays in the
 *    Loan balance (newBalance = newFees + newPrinciple + intAccrued - totalInterestPaid)
 *    and is charged interest next period (newInt = openingBalance x rate).
 *
 * Expected values: fixtures/ca_t5_engine_rules_vectors.json from the QA oracle
 * fixtures/generate_t5_engine_rules.py (line-for-line CalculateAll / getRate /
 * crossesLeapYear), trust-checked exactly (==) against S0_007, S3_leap_weekly,
 * S6_underpay, S7_biweekly, D02_scenarioA_underpay, D03_monthly_rowcount_2028-02-29 and
 * REF-01 (real Excel output). All vectors are fixed-rate personal loans, so the
 * calculated rate is the contract rate itself (OQ-C, MONTHLY basis).
 *
 * B19 (DEV-OQL, 2026-09-29): the N1-N3 vectors are the workbook's capitalisation, so they run
 * against the workbook branch (`UNPAID_INTEREST_CAPITALISED = true`, `WORKBOOK`); each also has one
 * `known_divergence DEV-OQL` test against the shipped branch (no interest on unpaid interest).
 * The leap-split vectors have no shortfall and run against the shipped `calculateCobCanada`.
 */
interface Row extends Record<string, number | string> {
  n: number;
  date: string;
  days: number;
  applied_rate: number;
}
interface Vector {
  id: string;
  what: string;
  converted_rate_pct: number;
  request: Record<string, unknown>;
  totals: Record<string, number>;
  rows: Row[];
  first_period: { crossesLeapYear: boolean; vba_fraction: number; plain_fraction: number };
}
const fx = loadFixture('ca_t5_engine_rules_vectors.json') as {
  tolerance_rel: number;
  branches_hit: Record<string, number>;
  leap_quirk_scan: { pairs: number; max_rel_diff_vs_plain_split: { rel: number } };
  vectors: Vector[];
};
const TOL = fx.tolerance_rel;
const iso = isoDay;
const d = utcDate;

const withinRel = (actual: number, expected: number): boolean => withinRelTol(actual, expected, TOL);

const toInput = (req: Record<string, unknown>): CobCanadaInput => wireToInput(rehome(req)); // B27: DEV-FB24 class B (personal loan at weekly/biweekly -> mortgage/variable twin)

const vec = (id: string) => {
  const v = fx.vectors.find((x) => x.id === id);
  if (!v) throw new Error(`no vector ${id}`);
  return v;
};

type Getter = (r: CobScheduleRow) => number;
const ROW_FIELDS: [string, string, Getter][] = [
  ['openingBalance', 'open_loan', (r) => r.openingBalance],
  ['feesOpening', 'open_fees', (r) => r.feesOpening],
  ['periodInterest', 'new_int', (r) => r.periodInterest],
  ['paymentAmount', 'payment', (r) => r.paymentAmount],
  ['interestPaid', 'interest_paid', (r) => r.interestPaid],
  ['feesPaid', 'fees_paid', (r) => r.feesPaid],
  ['principalPortion', 'principal_paid', (r) => r.principalPortion],
  ['feesClosing', 'close_fees', (r) => r.feesClosing],
  ['carriedAccruedInterestClosing', 'unpaid_int_close', (r) => r.carriedAccruedInterestClosing],
  ['closingBalance', 'close_loan', (r) => r.closingBalance],
];
const TOTALS: [string, string, (r: CobCanadaResult) => number][] = [
  ['numberOfPayments', 'n', (r) => r.numberOfPayments],
  ['totalPayment', 'total_payment', (r) => r.totalPayment],
  ['cobAmount', 'cob_amount', (r) => r.cobAmount],
  ['cobRatePercent', 'cob_rate', (r) => r.cobRatePercent],
  ['termDays', 'term_days', (r) => r.termDays],
];

/** Every mismatch (rows, dates, totals, ending balance), as readable strings. */
function mismatches(v: Vector, opts: { rows?: number; totalInterestAccrued?: boolean; switches?: Switches } = {}): string[] {
  const r = opts.switches ? calculateWith(toInput(v.request), opts.switches) : calculateCobCanada(toInput(v.request));
  const rows = r.amortizationSchedule;
  const out: string[] = [];
  if (opts.rows === undefined && rows.length !== v.rows.length) out.push(`rows: ${rows.length} vs ${v.rows.length}`);
  const n = Math.min(opts.rows ?? v.rows.length, rows.length, v.rows.length);
  for (let i = 0; i < n; i++) {
    const a = rows[i]!;
    const e = v.rows[i]!;
    if (iso(a.date) !== e.date) out.push(`row ${i + 1} date: ${iso(a.date)} vs ${e.date}`);
    for (const [name, key, get] of ROW_FIELDS) {
      if (!withinRel(get(a), e[key] as number)) out.push(`row ${i + 1} ${name}: ${get(a)} vs ${String(e[key])}`);
    }
  }
  if (opts.rows === undefined) {
    for (const [name, key, get] of TOTALS) {
      if (!withinRel(get(r), v.totals[key]!)) out.push(`${name}: ${get(r)} vs ${v.totals[key]}`);
    }
    if (!withinRel(r.calculatedRatePercent, v.converted_rate_pct)) {
      out.push(`calculatedRatePercent: ${r.calculatedRatePercent} vs ${v.converted_rate_pct}`);
    }
    const ending = v.rows.at(-1)!.close_loan as number;
    if (!withinRel(r.endingBalance, ending)) out.push(`endingBalance: ${r.endingBalance} vs ${ending}`);
    if (opts.totalInterestAccrued && !withinRel(r.totalInterest, v.totals.total_interest!)) {
      out.push(`totalInterest (accrued): ${r.totalInterest} vs ${v.totals.total_interest}`);
    }
  }
  return out;
}

describe('T5 oracle fixture sanity', () => {
  it('covers every getRate branch, including the middle-year ratePart = ANNUALRATE', () => {
    expect(fx.branches_hit.split).toBeGreaterThan(0);
    expect(fx.branches_hit.no_split).toBeGreaterThan(0);
    expect(fx.branches_hit.middle_year).toBeGreaterThan(0);
  });
  it('first periods: L1 into leap, L3/L4 start Dec 31, L5/L6 middle-year branch, L7 multi-year non-leap', () => {
    expect(vec('L1_into_leap_monthly').first_period.crossesLeapYear).toBe(true);
    expect(vec('L3_dec31_start_nonleap').rows[0]!.days).toBe(7);
    expect(vec('L4_dec31_start_leap').first_period.crossesLeapYear).toBe(true);
    expect(vec('L5_multiyear_middle_leap').first_period.vba_fraction).toBeGreaterThan(1);
    expect(vec('L6_multiyear_from_leap').first_period.vba_fraction).toBeGreaterThan(1);
    expect(vec('L7_multiyear_no_leap').first_period.crossesLeapYear).toBe(false);
    expect(vec('L2_out_of_leap_monthly').rows[1]!.date).toBe('2029-01-10');
  });
  it('quirk scan: VBA getRate == plain 365/366 actual-day split over 2.3M (start, end) pairs (<= 1e-12 rel)', () => {
    expect(fx.leap_quirk_scan.pairs).toBeGreaterThan(2_000_000);
    expect(fx.leap_quirk_scan.max_rel_diff_vs_plain_split.rel).toBeLessThan(1e-12);
  });
});

describe('T5 leap split: engine dayCountFraction == VBA getRate / rate, every row of every vector', () => {
  for (const v of fx.vectors) {
    it(`${v.id}`, () => {
      const bad: string[] = [];
      let prev = d(v.request.disbursalDate as string);
      for (const row of v.rows) {
        const end = d(row.date);
        const f = dayCountFraction(prev, end);
        const vba = row.applied_rate / (v.converted_rate_pct / 100);
        if (!withinRel(f, vba)) bad.push(`${iso(prev)} -> ${row.date}: ${f} vs ${vba}`);
        prev = end;
      }
      expect(bad).toEqual([]);
    });
  }
});

describe('T5 leap split: full schedule parity with the VBA oracle (payment covers interest)', () => {
  for (const id of [
    'L1_into_leap_monthly',
    'L2_out_of_leap_monthly',
    'L3_dec31_start_nonleap',
    'L4_dec31_start_leap',
    'L5_multiyear_middle_leap',
    'L6_multiyear_from_leap',
    'L7_multiyear_no_leap',
  ]) {
    it(`${id}: every row, date and total within 1e-9`, () => {
      expect(mismatches(vec(id))).toEqual([]);
    });
  }
});

describe('T5 OQ-L unpaid interest is capitalised (negative amortization), row by row (workbook branch, B19)', () => {
  it('N1 fixture: every row underpays and the Loan balance grows by the unpaid interest', () => {
    const v = vec('N1_negam_monthly');
    expect(v.rows.length).toBeGreaterThanOrEqual(4);
    for (const r of v.rows) {
      expect(r.interest_paid).toBe(500);
      expect(r.close_loan).toBeGreaterThan(r.open_loan as number);
    }
  });

  for (const id of ['N1_negam_monthly', 'N2_negam_weekly_leap', 'N3_negam_then_covered']) {
    it(`${id}: first 4 rows -- Loan balance includes unpaid interest, next interest charged on it`, () => {
      expect(mismatches(vec(id), { rows: 4, switches: WORKBOOK })).toEqual([]);
    });
    it(`${id}: every row, totals, endingBalance and totalInterest (= interest accrued)`, () => {
      expect(mismatches(vec(id), { totalInterestAccrued: true, switches: WORKBOOK })).toEqual([]);
    });
  }

  it('N1 row 2 interest is charged on the capitalised balance (hand check: B2 x 12% x 28/365)', () => {
    const v = vec('N1_negam_monthly');
    const rows = calculateWith(toInput(v.request), WORKBOOK).amortizationSchedule;
    const b2 = 100000 + (100000 * 0.12 * 31) / 365 - 500; // row-1 closing Loan = opening row 2
    expect(rows[1]!.openingBalance).toBeCloseTo(b2, 9);
    expect(rows[1]!.periodInterest).toBeCloseTo((b2 * 0.12 * 28) / 365, 9);
  });
});

describe('T5 N1-N3 against the shipped branch (B19)', () => {
  for (const id of ['N1_negam_monthly', 'N2_negam_weekly_leap', 'N3_negam_then_covered']) {
    // known_divergence DEV-OQL: the workbook capitalises unpaid interest; the shipped engine does not.
    it(`known_divergence DEV-OQL ${id}: shipped does not match the workbook vector; balance never grows; C = sum of period interest`, () => {
      const v = vec(id);
      expect(mismatches(v, { switches: SHIPPED, totalInterestAccrued: true }).length).toBeGreaterThan(0);
      const r = calculateWith(toInput(v.request), SHIPPED);
      for (const row of r.amortizationSchedule) expect(row.closingBalance).toBeLessThanOrEqual(row.openingBalance);
      const periodTotal = r.amortizationSchedule.reduce((sum, row) => sum + row.periodInterest, 0);
      expect(withinRel(r.totalInterest, periodTotal)).toBe(true);
    });
  }
});
