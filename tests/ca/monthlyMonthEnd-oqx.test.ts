import { describe, expect, it } from 'vitest';
import { calculateCobCanada } from '../../src/ca/index.js';
import type { CobCanadaInput, CobCanadaResult } from '../../src/ca/index.js';
import { isoDay, utcDate, wireToInput } from './support/builders.js';
import { withinRel } from './support/compare.js';
import { loadFixture as load } from './support/fixtures.js';

/**
 * T3b / OQ-X (business decision 2026-09-27): the monthly month-end rule.
 * INTENTIONAL DIFFERENCE FROM THE WORKBOOK (the macro uses DateAdd("m", k, first), see
 * monthlyDates-t3.test.ts, which stays the rule for every non-month-end first date).
 *
 *   - First Payment Date on the LAST day of its month -> every monthly payment falls on
 *     the last day of its month (Apr 30 -> May 31 -> Jun 30; Feb 28 2027 -> Mar 31;
 *     Feb 29 2028 -> Mar 31 ... Feb 28 2029).
 *   - Otherwise the day of month is kept and clamped in shorter months (T3, unchanged):
 *     Jan 30 -> Feb 28 -> Mar 30. Feb 28 2028 is NOT month-end (leap year) -> Mar 28.
 *   - Dates are counted from the First Payment Date (row k = month k of the first date),
 *     never chained from the previous row.
 *   - Interest day counts follow the new dates; the End Date exit is unchanged
 *     (a payment ON the End Date is included, exit only when AFTER it).
 *
 * Expected date lists are literals, hand-derived from the rule. Full-row vectors come
 * from the QA oracle fixtures/generate_oqx_vectors.py (transliterated CalculateAll with
 * only the monthly date function swapped; its workbook mode reproduces
 * D03_monthly_rowcount_2028-02-29 exactly). Assertions use the public engine output only.
 *
 * Personal loan (MONTHLY rate basis, OQ-C): 12% contract rate used as-is, no fees,
 * payment 500 on 10,000 -- no payoff inside any window here.
 */

const iso = isoDay;
const utc = utcDate;

function monthly(firstPaymentDate: string, endDate: string, disbursalDate?: string): CobCanadaInput {
  return {
    flow: 'newMortgageOrLoan',
    productType: 'personalLoan',
    rateType: 'fixed',
    loanAmount: 10000,
    contractRatePercent: 12,
    paymentAmount: 500,
    paymentFrequency: 'monthly',
    disbursalDate: utc(disbursalDate ?? firstPaymentDate),
    firstPaymentDate: utc(firstPaymentDate),
    endDate: utc(endDate),
    termYears: 1,
    termMonths: 0,
    fees: { fees: [] },
  };
}

function datesOf(firstPaymentDate: string, endDate: string, disbursalDate?: string): string[] {
  return calculateCobCanada(monthly(firstPaymentDate, endDate, disbursalDate)).amortizationSchedule.map((r) =>
    iso(r.date),
  );
}

describe('OQ-X first payment on the last day of its month: every payment on month-end', () => {
  it('Apr 30 2027 -> May 31 -> Jun 30 -> Jul 31', () => {
    expect(datesOf('2027-04-30', '2027-07-31')).toEqual(['2027-04-30', '2027-05-31', '2027-06-30', '2027-07-31']);
  });

  it('Feb 28 2027 (non-leap, month-end) -> Mar 31 -> Apr 30', () => {
    expect(datesOf('2027-02-28', '2027-04-30')).toEqual(['2027-02-28', '2027-03-31', '2027-04-30']);
  });

  it('Feb 29 2028 -> Mar 31 -> Apr 30 -> ... -> Jan 31 2029 -> Feb 28 2029 (13 rows)', () => {
    expect(datesOf('2028-02-29', '2029-02-28')).toEqual([
      '2028-02-29',
      '2028-03-31',
      '2028-04-30',
      '2028-05-31',
      '2028-06-30',
      '2028-07-31',
      '2028-08-31',
      '2028-09-30',
      '2028-10-31',
      '2028-11-30',
      '2028-12-31',
      '2029-01-31',
      '2029-02-28',
    ]);
  });

  it('Nov 30 2027 -> Dec 31 -> Jan 31 2028 -> Feb 29 2028 -> Mar 31', () => {
    expect(datesOf('2027-11-30', '2028-03-31')).toEqual([
      '2027-11-30',
      '2027-12-31',
      '2028-01-31',
      '2028-02-29',
      '2028-03-31',
    ]);
  });

  it('Sep 30 2026 across a year end into a non-leap Feb: ... Dec 31 -> Jan 31 -> Feb 28 2027 -> Mar 31', () => {
    expect(datesOf('2026-09-30', '2027-03-31')).toEqual([
      '2026-09-30',
      '2026-10-31',
      '2026-11-30',
      '2026-12-31',
      '2027-01-31',
      '2027-02-28',
      '2027-03-31',
    ]);
  });

  it('Jan 31 is unchanged from T3: Jan 31 -> Feb 28 -> Mar 31 (2027) and Jan 31 -> Feb 29 -> Mar 31 (2028)', () => {
    expect(datesOf('2027-01-31', '2027-03-31')).toEqual(['2027-01-31', '2027-02-28', '2027-03-31']);
    expect(datesOf('2028-01-31', '2028-03-31')).toEqual(['2028-01-31', '2028-02-29', '2028-03-31']);
  });
});

describe('OQ-X regression guard: a first date that is not month-end keeps T3 behaviour', () => {
  it('15th: every row on the 15th', () => {
    expect(datesOf('2027-04-15', '2027-07-31')).toEqual(['2027-04-15', '2027-05-15', '2027-06-15', '2027-07-15']);
  });

  it('Feb 28 2028 is NOT month-end (leap year): stays on the 28th -> Mar 28 -> Apr 28', () => {
    expect(datesOf('2028-02-28', '2028-04-30')).toEqual(['2028-02-28', '2028-03-28', '2028-04-28']);
  });

  it('Jan 30 2027 -> Feb 28 -> Mar 30 -> Apr 30 -> May 30 (counted from the first date; the Apr 30 row does not switch to month-end)', () => {
    expect(datesOf('2027-01-30', '2027-05-31')).toEqual([
      '2027-01-30',
      '2027-02-28',
      '2027-03-30',
      '2027-04-30',
      '2027-05-30',
    ]);
  });

  it('Jan 29 2028 -> Feb 29 (a month-end row) -> Mar 29: the rule looks at the First Payment Date only', () => {
    expect(datesOf('2028-01-29', '2028-04-30')).toEqual(['2028-01-29', '2028-02-29', '2028-03-29', '2028-04-29']);
  });

  it('Apr 29 2027 (not month-end) -> May 29 -> Jun 29', () => {
    expect(datesOf('2027-04-29', '2027-06-30')).toEqual(['2027-04-29', '2027-05-29', '2027-06-29']);
  });
});

describe('OQ-X interest day counts follow the new dates (hand-computed)', () => {
  // 10,000 at 12% (MONTHLY basis, rate used as-is), payment 500, disbursal 2027-04-01:
  //   2027-04-01 -> 2027-04-30: 29 days, I1 = 10000 x 0.12 x 29/365 = 95.34246575342466
  //     B1 = 10000 + I1 - 500 = 9595.342465753425
  //   2027-04-30 -> 2027-05-31: 31 days (workbook: May 30, 30 days)
  //     I2 = B1 x 0.12 x 31/365 = 97.79362732219928, B2 = 9193.136093075624
  //   2027-05-31 -> 2027-06-30: 30 days, I3 = B2 x 0.12 x 30/365 = 90.672027219376
  const REL = 1e-12;
  const rel = (a: number, e: number) => Math.abs(a - e) / Math.abs(e);

  it('Apr 30 -> May 31 is 31 days, interest 97.79362732219928; May 31 -> Jun 30 is 30 days, 90.672027219376', () => {
    const rows = calculateCobCanada(monthly('2027-04-30', '2027-06-30', '2027-04-01')).amortizationSchedule;
    expect(rows[0]!.daysInPeriod).toBe(29);
    expect(rel(rows[0]!.periodInterest, 95.34246575342466)).toBeLessThanOrEqual(REL);

    expect(iso(rows[1]!.date)).toBe('2027-05-31');
    expect(rows[1]!.daysInPeriod).toBe(31);
    expect(rel(rows[1]!.openingBalance, 9595.342465753425)).toBeLessThanOrEqual(REL);
    expect(rel(rows[1]!.periodInterest, 97.79362732219928)).toBeLessThanOrEqual(REL);

    expect(iso(rows[2]!.date)).toBe('2027-06-30');
    expect(rows[2]!.daysInPeriod).toBe(30);
    expect(rel(rows[2]!.openingBalance, 9193.136093075624)).toBeLessThanOrEqual(REL);
    expect(rel(rows[2]!.periodInterest, 90.672027219376)).toBeLessThanOrEqual(REL);
  });

  it('Feb 28 2027 -> Mar 31 is 31 days, interest 97.72661287295927 (workbook: Mar 28, 28 days)', () => {
    // disbursal 2027-02-01 -> 2027-02-28: 27 days, I1 = 88.76712328767124, B1 = 9588.767123287671
    // I2 = B1 x 0.12 x 31/365 = 97.72661287295927
    const rows = calculateCobCanada(monthly('2027-02-28', '2027-04-30', '2027-02-01')).amortizationSchedule;
    expect(iso(rows[1]!.date)).toBe('2027-03-31');
    expect(rows[1]!.daysInPeriod).toBe(31);
    expect(rel(rows[1]!.openingBalance, 9588.767123287671)).toBeLessThanOrEqual(REL);
    expect(rel(rows[1]!.periodInterest, 97.72661287295927)).toBeLessThanOrEqual(REL);
  });
});

describe('OQ-X End Date exit (inclusive: exit only when the next date is AFTER the End Date)', () => {
  it('End Date = the month-end May 31: included (2 rows)', () => {
    const res = calculateCobCanada(monthly('2027-04-30', '2027-05-31'));
    expect(res.amortizationSchedule.map((r) => iso(r.date))).toEqual(['2027-04-30', '2027-05-31']);
    expect(res.numberOfPayments).toBe(2);
  });

  it('End Date May 30 (one day before the month-end payment): May 31 excluded (1 row)', () => {
    const res = calculateCobCanada(monthly('2027-04-30', '2027-05-30'));
    expect(res.amortizationSchedule.map((r) => iso(r.date))).toEqual(['2027-04-30']);
    expect(res.numberOfPayments).toBe(1);
  });

  it('First Feb 29 2028, End Date Mar 30 2028: Mar 31 excluded (1 row; the workbook would add Mar 29)', () => {
    const res = calculateCobCanada(monthly('2028-02-29', '2028-03-30'));
    expect(res.amortizationSchedule.map((r) => iso(r.date))).toEqual(['2028-02-29']);
    expect(res.numberOfPayments).toBe(1);
  });

  it('First Feb 29 2028, End Date Feb 28 2029: the Feb 28 2029 payment is included (13 rows)', () => {
    const res = calculateCobCanada(monthly('2028-02-29', '2029-02-28'));
    expect(res.numberOfPayments).toBe(13);
    expect(iso(res.amortizationSchedule[12]!.date)).toBe('2029-02-28');
  });
});

// ---- full-row parity against the QA OQ-X oracle (fixtures/ca_oqx_vectors.json) ----

const oqx = load('ca_oqx_vectors.json') as {
  tolerance_rel: number;
  vectors: {
    id: string;
    request: Record<string, unknown>;
    totals: Record<string, number>;
    rows: Record<string, number | string>[];
    converted_rate_pct: number;
    workbook_dates: string[];
  }[];
};
const wire = load('ca_app_wire_vectors.json') as { totals_map: Record<string, string>; row_map: Record<string, string> };
const toEngineInput = (request: Record<string, unknown>): CobCanadaInput => wireToInput(request);

function mismatches(r: CobCanadaResult, v: (typeof oqx.vectors)[number]): string[] {
  const tol = oqx.tolerance_rel;
  const out: string[] = [];
  for (const [k, f] of Object.entries(wire.totals_map)) {
    if (!(f in v.totals)) continue;
    const a = r[k as keyof CobCanadaResult] as number;
    if (!withinRel(a, v.totals[f]!, tol)) out.push(`${k}: ${a} vs ${v.totals[f]}`);
  }
  if (!withinRel(r.calculatedRatePercent, v.converted_rate_pct, tol)) out.push(`calculatedRatePercent`);
  const rows = r.amortizationSchedule;
  if (rows.length !== v.rows.length) out.push(`rows: ${rows.length} vs ${v.rows.length}`);
  for (let i = 0; i < Math.min(rows.length, v.rows.length); i++) {
    for (const [k, f] of Object.entries(wire.row_map)) {
      if (!(f in v.rows[i]!)) continue;
      if (k === 'date') {
        if (iso(rows[i]!.date) !== v.rows[i]![f]) out.push(`row ${i + 1} date: ${iso(rows[i]!.date)} vs ${String(v.rows[i]![f])}`);
        continue;
      }
      const a = rows[i]![k as keyof (typeof rows)[number]] as number;
      if (!withinRel(a, v.rows[i]![f] as number, tol)) out.push(`row ${i + 1} ${k}: ${a} vs ${String(v.rows[i]![f])}`);
    }
  }
  return out;
}

describe('OQ-X full-row parity with the QA oracle (1e-9 relative, every row and total)', () => {
  it('fixture sanity: every OQ-X vector really diverges from the workbook dates', () => {
    for (const v of oqx.vectors) expect(v.rows.map((r) => r.date)).not.toEqual(v.workbook_dates);
  });
  for (const v of oqx.vectors) {
    it(`${v.id}: dates, rows and totals match the OQ-X oracle`, () => {
      expect(mismatches(calculateCobCanada(toEngineInput(v.request)), v)).toEqual([]);
    });
  }
});
