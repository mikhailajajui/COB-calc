import { describe, expect, it } from 'vitest';
import { calculateCobCanada } from '../../src/ca/index.js';
import type { CobCanadaInput, CobCanadaResult } from '../../src/ca/index.js';
import { isoDay, utcDate, wireToInput } from './support/builders.js';
import { withinRel } from './support/compare.js';
import { rehome } from './support/rehome.js';
import { loadFixture as load } from './support/fixtures.js';

/**
 * T4 2026-09-27: semi-monthly payment dates follow the workbook's getNextSemiMonthly
 * exactly (reference/workbook-macro-source.txt ~line 844, getNextEOM ~line 895).
 *
 *   - CHAINED: payment #1 is the First Payment Date; payment #k+1 is
 *     getNextSemiMonthly(firstPaymentDate, payment #k). Not evenly spaced
 *     (the old addUtcDays(first, round(i x 365.25 / 24)) approximation is gone).
 *   - isEOM = first date is the last day of its month OR the 15th. Then the dates
 *     alternate 15th / last day of month (Feb 28 or 29).
 *   - Otherwise day1 = first day (minus 15 when >= 15). A date <= 15th moves 15 days,
 *     capped at its month-end; a date > 15th moves to day1 of the next month. So the
 *     1st -> 1st / 16th, 10th -> 10th / 25th, 16th -> 1st / 16th, 20th -> 5th / 20th,
 *     30th of a 31-day month -> 15th / 30th (Feb capped to 28/29), 14th -> 14th / 29th
 *     (Feb capped), Feb 28 2028 (NOT month-end, leap year) -> 13th / 28th.
 *   - The monthly month-end rule OQ-X does NOT apply to semi-monthly.
 *   - End Date exit unchanged: a payment ON the End Date is kept; exit only when AFTER.
 *
 * Expected date lists below are hand-derived from the VBA. Full-row vectors and the
 * 731-date sweep come from the QA oracle fixtures/generate_semimonthly_vectors.py (line-
 * for-line transliteration; its trust check reproduces every D-01 vector and
 * S4_semimonthly exactly). Assertions use the public engine output only.
 */

const iso = isoDay;
const utc = utcDate;

/** Variable mortgage (contract rate used as-is, OQ-C), no fees, 12%, 500 on 10,000.
 *  B27: DEV-FB24 class B -- was a personal loan; a personal loan may no longer pay semi-monthly and
 *  the variable mortgage is its exact twin (same rate basis), so every expected value is unchanged. */
function semi(firstPaymentDate: string, endDate: string, disbursalDate?: string): CobCanadaInput {
  return {
    flow: 'newMortgageOrLoan',
    productType: 'mortgage', // B27: DEV-FB24 class B
    rateType: 'variable', // B27: DEV-FB24 class B
    loanAmount: 10000,
    contractRatePercent: 12,
    paymentAmount: 500,
    paymentFrequency: 'semiMonthly',
    disbursalDate: utc(disbursalDate ?? firstPaymentDate),
    firstPaymentDate: utc(firstPaymentDate),
    endDate: utc(endDate),
    termYears: 1,
    termMonths: 0,
    fees: { fees: [] },
  };
}

const datesOf = (first: string, end: string): string[] =>
  calculateCobCanada(semi(first, end)).amortizationSchedule.map((r) => iso(r.date));

describe('T4 semi-monthly: first payment on the 15th or a month-end (isEOM) -> 15th / month-end', () => {
  it('15th: Jan 15 2027 -> Jan 31 -> Feb 15 -> Feb 28 -> Mar 15 -> Mar 31 -> Apr 15 -> Apr 30', () => {
    expect(datesOf('2027-01-15', '2027-04-30')).toEqual([
      '2027-01-15', '2027-01-31', '2027-02-15', '2027-02-28', '2027-03-15', '2027-03-31', '2027-04-15', '2027-04-30',
    ]);
  });

  it('31st: Jan 31 2027 -> Feb 15 -> Feb 28 -> Mar 15 -> Mar 31 -> Apr 15 -> Apr 30', () => {
    expect(datesOf('2027-01-31', '2027-04-30')).toEqual([
      '2027-01-31', '2027-02-15', '2027-02-28', '2027-03-15', '2027-03-31', '2027-04-15', '2027-04-30',
    ]);
  });

  it('30th of a 30-day month (month-end): Apr 30 2027 -> May 15 -> May 31 -> Jun 15 -> Jun 30 -> Jul 15 -> Jul 31', () => {
    expect(datesOf('2027-04-30', '2027-07-31')).toEqual([
      '2027-04-30', '2027-05-15', '2027-05-31', '2027-06-15', '2027-06-30', '2027-07-15', '2027-07-31',
    ]);
  });

  it('Feb 28 2027 (non-leap month-end) -> Mar 15 -> Mar 31 -> Apr 15 -> Apr 30', () => {
    expect(datesOf('2027-02-28', '2027-04-30')).toEqual(['2027-02-28', '2027-03-15', '2027-03-31', '2027-04-15', '2027-04-30']);
  });

  it('Feb 29 2028 (leap month-end) -> Mar 15 -> Mar 31 -> Apr 15 -> Apr 30', () => {
    expect(datesOf('2028-02-29', '2028-04-30')).toEqual(['2028-02-29', '2028-03-15', '2028-03-31', '2028-04-15', '2028-04-30']);
  });

  it('15th into a leap February: Jan 15 2028 -> Jan 31 -> Feb 15 -> Feb 29 -> Mar 15', () => {
    expect(datesOf('2028-01-15', '2028-03-15')).toEqual(['2028-01-15', '2028-01-31', '2028-02-15', '2028-02-29', '2028-03-15']);
  });
});

describe('T4 semi-monthly: any other first day keeps its pair of days (not month-end)', () => {
  it('1st: Jan 1 2027 -> Jan 16 -> Feb 1 -> Feb 16 -> Mar 1 -> Mar 16', () => {
    expect(datesOf('2027-01-01', '2027-03-16')).toEqual(['2027-01-01', '2027-01-16', '2027-02-01', '2027-02-16', '2027-03-01', '2027-03-16']);
  });

  it('10th: Jan 10 2027 -> Jan 25 -> Feb 10 -> Feb 25 -> Mar 10 -> Mar 25', () => {
    expect(datesOf('2027-01-10', '2027-03-25')).toEqual(['2027-01-10', '2027-01-25', '2027-02-10', '2027-02-25', '2027-03-10', '2027-03-25']);
  });

  it('16th (day1 = 1): Jan 16 2027 -> Feb 1 -> Feb 16 -> Mar 1 -> Mar 16', () => {
    expect(datesOf('2027-01-16', '2027-03-16')).toEqual(['2027-01-16', '2027-02-01', '2027-02-16', '2027-03-01', '2027-03-16']);
  });

  it('20th (day1 = 5): Jan 20 2027 -> Feb 5 -> Feb 20 -> Mar 5 -> Mar 20', () => {
    expect(datesOf('2027-01-20', '2027-03-20')).toEqual(['2027-01-20', '2027-02-05', '2027-02-20', '2027-03-05', '2027-03-20']);
  });

  it('30th of a 31-day month (NOT month-end, day1 = 15): Jan 30 2027 -> Feb 15 -> Feb 28 -> Mar 15 -> Mar 30 (not Mar 31) -> Apr 15 -> Apr 30 -> May 15 -> May 30', () => {
    expect(datesOf('2027-01-30', '2027-05-30')).toEqual([
      '2027-01-30', '2027-02-15', '2027-02-28', '2027-03-15', '2027-03-30', '2027-04-15', '2027-04-30', '2027-05-15', '2027-05-30',
    ]);
  });

  it('30th of a 31-day month into leap Feb: Jan 30 2028 -> Feb 15 -> Feb 29 -> Mar 15 -> Mar 30', () => {
    expect(datesOf('2028-01-30', '2028-03-30')).toEqual(['2028-01-30', '2028-02-15', '2028-02-29', '2028-03-15', '2028-03-30']);
  });

  it('14th, February cap (14 + 15 = 29 > 28): Jan 14 2027 -> Jan 29 -> Feb 14 -> Feb 28 -> Mar 14 -> Mar 29', () => {
    expect(datesOf('2027-01-14', '2027-03-29')).toEqual(['2027-01-14', '2027-01-29', '2027-02-14', '2027-02-28', '2027-03-14', '2027-03-29']);
  });

  it('14th, leap February not capped: Jan 14 2028 -> Jan 29 -> Feb 14 -> Feb 29 -> Mar 14', () => {
    expect(datesOf('2028-01-14', '2028-03-14')).toEqual(['2028-01-14', '2028-01-29', '2028-02-14', '2028-02-29', '2028-03-14']);
  });

  it('29th (day1 = 14), Feb capped: Jan 29 2027 -> Feb 14 -> Feb 28 -> Mar 14 -> Mar 29', () => {
    expect(datesOf('2027-01-29', '2027-03-29')).toEqual(['2027-01-29', '2027-02-14', '2027-02-28', '2027-03-14', '2027-03-29']);
  });

  it('Feb 28 2028 is NOT month-end (leap year): -> Mar 13 -> Mar 28 -> Apr 13 -> Apr 28', () => {
    expect(datesOf('2028-02-28', '2028-04-28')).toEqual(['2028-02-28', '2028-03-13', '2028-03-28', '2028-04-13', '2028-04-28']);
  });

  it('crosses a year end: Dec 20 2027 -> Jan 5 2028 -> Jan 20 -> Feb 5 -> Feb 20', () => {
    expect(datesOf('2027-12-20', '2028-02-20')).toEqual(['2027-12-20', '2028-01-05', '2028-01-20', '2028-02-05', '2028-02-20']);
  });
});

describe('T4 semi-monthly: interest follows the irregular period lengths', () => {
  // Jan 30 2027 start, disbursal = first payment: row 1 is 0 days, row 2 Jan 30 -> Feb 15
  // (16 days), row 3 Feb 15 -> Feb 28 (13 days). All in 2027 -> days / 365.
  //   row 2: 9500 x 0.12 x 16/365                          = 49.97260273972603
  //   row 3 opening: 9500 - (500 - 49.97260273972603)      = 9049.972602739726
  //   row 3: 9049.972602739726 x 0.12 x 13/365             = 38.679334959654724
  const r = () => calculateCobCanada(semi('2027-01-30', '2027-03-30')).amortizationSchedule;
  const rel = (a: number, e: number) => Math.abs(a - e) / Math.abs(e);

  it('row 2: Feb 15 2027, 16 days, interest 9500 x 0.12 x 16/365', () => {
    const row = r()[1]!;
    expect(iso(row.date)).toBe('2027-02-15');
    expect(row.daysInPeriod).toBe(16);
    expect(row.openingBalance).toBe(9500);
    expect(rel(row.periodInterest, 49.97260273972603)).toBeLessThanOrEqual(1e-12);
  });

  it('row 3: Feb 28 2027, 13 days, interest 9049.9726... x 0.12 x 13/365', () => {
    const row = r()[2]!;
    expect(iso(row.date)).toBe('2027-02-28');
    expect(row.daysInPeriod).toBe(13);
    expect(rel(row.openingBalance, 9049.972602739726)).toBeLessThanOrEqual(1e-12);
    expect(rel(row.periodInterest, 38.679334959654724)).toBeLessThanOrEqual(1e-12);
  });
});

describe('T4 semi-monthly: End Date exit (a payment ON the End Date is kept)', () => {
  it('15th start, End Date = Mar 15 2027 (a payment date): last row is Mar 15', () => {
    const d = datesOf('2027-01-15', '2027-03-15');
    expect(d).toEqual(['2027-01-15', '2027-01-31', '2027-02-15', '2027-02-28', '2027-03-15']);
  });

  it('15th start, End Date = Mar 30 2027 (the day before Mar 31): Mar 31 is not generated', () => {
    expect(datesOf('2027-01-15', '2027-03-30').at(-1)).toBe('2027-03-15');
  });

  it('15th start, End Date = Mar 31 2027: Mar 31 is kept', () => {
    expect(datesOf('2027-01-15', '2027-03-31').at(-1)).toBe('2027-03-31');
  });

  it('10th start, End Date = Mar 24 2027: last row Mar 10; End Date = Mar 25: last row Mar 25', () => {
    expect(datesOf('2027-01-10', '2027-03-24').at(-1)).toBe('2027-03-10');
    expect(datesOf('2027-01-10', '2027-03-25').at(-1)).toBe('2027-03-25');
  });

  it('20th start, End Date = Feb 4 2027 (before the 2nd payment Feb 5): a single row', () => {
    expect(datesOf('2027-01-20', '2027-02-04')).toEqual(['2027-01-20']);
  });

  it('termDays and numberOfPayments follow the chained dates (Jan 30 2027 -> May 30 2027, 9 rows)', () => {
    const res = calculateCobCanada(semi('2027-01-30', '2027-05-30'));
    expect(res.numberOfPayments).toBe(9);
    expect(res.termDays).toBe(120); // Jan 30 -> May 30 2027
  });
});

// ---- oracle fixture: full-row vectors and the 731-date sweep ----

const fx = load('ca_semimonthly_vectors.json') as {
  tolerance_rel: number;
  vectors: {
    id: string;
    request: Record<string, unknown>;
    totals: Record<string, number>;
    rows: Record<string, number | string>[];
    converted_rate_pct: number;
  }[];
  sweep_request: Record<string, unknown>;
  sweep: { first: string; end: string; dates: string[] }[];
};
const wire = load('ca_app_wire_vectors.json') as { totals_map: Record<string, string>; row_map: Record<string, string> };
const toEngineInput = (request: Record<string, unknown>): CobCanadaInput => wireToInput(rehome(request)); // B27: DEV-FB24 class B

function mismatches(r: CobCanadaResult, v: (typeof fx.vectors)[number]): string[] {
  const tol = fx.tolerance_rel;
  const out: string[] = [];
  for (const [k, f] of Object.entries(wire.totals_map)) {
    if (!(f in v.totals)) continue;
    const a = r[k as keyof CobCanadaResult] as number;
    if (!withinRel(a, v.totals[f]!, tol)) out.push(`${k}: ${a} vs ${v.totals[f]}`);
  }
  if (!withinRel(r.calculatedRatePercent, v.converted_rate_pct, tol)) out.push('calculatedRatePercent');
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

describe('T4 full-row parity with the QA getNextSemiMonthly oracle (1e-9 relative, every row and total)', () => {
  it('fixture has the expected vectors', () => {
    expect(fx.vectors.map((v) => v.id)).toEqual([
      'T4_jan30_2027',
      'T4_feb29_2028',
      'T4_feb28_2028_not_eom',
      'T4_jan16_2027',
      'T4_dec20_2027_yearcross',
      'T4_jan14_2028_febcap',
      'T4_jun30_2027_eom',
    ]);
  });
  for (const v of fx.vectors) {
    it(`${v.id}: every row and total`, () => {
      expect(mismatches(calculateCobCanada(toEngineInput(v.request)), v)).toEqual([]);
    });
  }
});

describe('T4 sweep: every first payment date 2027-01-01 .. 2028-12-31, End Date = first + 730 days', () => {
  it('fixture covers 731 consecutive first dates including Feb 29 2028', () => {
    expect(fx.sweep.length).toBe(731);
    expect(fx.sweep[0]!.first).toBe('2027-01-01');
    expect(fx.sweep.at(-1)!.first).toBe('2028-12-31');
    expect(fx.sweep.some((s) => s.first === '2028-02-29')).toBe(true);
  });

  const byMonth = new Map<string, typeof fx.sweep>();
  for (const s of fx.sweep) {
    const key = s.first.slice(0, 7);
    byMonth.set(key, [...(byMonth.get(key) ?? []), s]);
  }
  for (const [month, cases] of byMonth) {
    it(`first dates in ${month}: every schedule date matches the oracle`, () => {
      const bad: string[] = [];
      for (const s of cases) {
        const { note: _note, ...request } = fx.sweep_request;
        const input = toEngineInput({
          ...request,
          disbursalDate: s.first,
          firstPaymentDate: s.first,
          endDate: s.end,
        });
        const got = calculateCobCanada(input).amortizationSchedule.map((r) => iso(r.date));
        if (got.length !== s.dates.length || got.some((d, i) => d !== s.dates[i])) {
          const i = got.findIndex((d, k) => d !== s.dates[k]);
          bad.push(`${s.first}: rows ${got.length} vs ${s.dates.length}, first diff row ${i + 1}: ${got[i]} vs ${s.dates[i]}`);
        }
      }
      expect(bad.slice(0, 5), `${bad.length} of ${cases.length} first dates differ`).toEqual([]);
    });
  }
});
