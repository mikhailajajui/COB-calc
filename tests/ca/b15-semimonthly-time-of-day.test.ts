/**
 * B15 (COB-architecture.md §5 B15, revision 9): the semi-monthly schedule reads the First
 * Payment Date (and each previous payment date) as its UTC calendar date. Defect fix, no
 * user decision (BRD IN-10/12/13 are Dates; ADR-03 "UTC dates only"; B3b / D-12 already
 * accepts a time-bearing Date and uses its UTC calendar date). QA step written 2026-09-28,
 * before the developer step. The developer must not edit these assertions.
 *
 * Before B15, nextSemiMonthlyDate compared full timestamps (isEom, and "current is
 * month-end"), so a month-end first date with a time of day was not month-end and the
 * chain ran 02-16, 03-16 ...; and periodDateFor('semiMonthly', f, 0) returned `f` itself.
 *
 * Expected values:
 *   - B15-1..7, B15-9: the spec table, re-derived by QA from the macro's getNextSemiMonthly
 *     (reference/workbook-macro-source.txt lines 844-881) with an independent Python
 *     transliteration on calendar dates; all match the spec.
 *   - Sweep: fixtures/ca_semimonthly_vectors.json 'sweep' (T4 oracle, generate_semimonthly_
 *     vectors.py, trust-checked against D-01 and S4): for every first date 2027-01-01 ..
 *     2028-12-31 the macro's date list. A time-bearing first date must give exactly that
 *     list at UTC midnight. Midnight first dates are the green trust check.
 *   - B15-INV-calendar-date: the engine output for a time-bearing input equals the output
 *     for the same input at UTC midnight (JSON.stringify), probe corpus from the spec.
 * Dates compared with toISOString(), exact to the millisecond. In `test:tz` (A4 rule).
 */
import { describe, expect, it } from 'vitest';
import { nextSemiMonthlyDate, periodDateFor } from '../../src/ca/calendar.js';
import { calculateCobCanada } from '../../src/ca/index.js';
import type { CobCanadaInput, PaymentFrequency } from '../../src/ca/index.js';
import { asInput, utcDate } from './support/builders.js';
import { loadFixture } from './support/fixtures.js';

const DAY = 86_400_000;
const d = utcDate;
const mid = (s: string) => `${s}T00:00:00.000Z`;
const iso = (x: Date) => x.toISOString();

/** periodDateFor('semiMonthly', f, i, previous) for i = 0..n-1, chained like the engine. */
function chain(f: Date, n: number): string[] {
  const out: Date[] = [];
  let prev = f;
  for (let i = 0; i < n; i++) {
    prev = periodDateFor('semiMonthly', f, i, prev);
    out.push(prev);
  }
  return out.map(iso);
}

describe('B15 spec table: semi-monthly chains read the UTC calendar date (all rows T00:00:00.000Z)', () => {
  const table: [id: string, f: string, want: string[]][] = [
    ['B15-1', '2027-01-31T12:00:00Z', ['2027-01-31', '2027-02-15', '2027-02-28', '2027-03-15', '2027-03-31']],
    ['B15-2', '2027-02-28T00:00:01Z', ['2027-02-28', '2027-03-15', '2027-03-31', '2027-04-15', '2027-04-30']],
    ['B15-3', '2028-02-29T23:59:59.999Z', ['2028-02-29', '2028-03-15', '2028-03-31', '2028-04-15', '2028-04-30']],
    ['B15-4', '2027-04-30T06:00:00Z', ['2027-04-30', '2027-05-15', '2027-05-31', '2027-06-15', '2027-06-30']],
    ['B15-5', '2027-01-15T12:00:00Z', ['2027-01-15', '2027-01-31', '2027-02-15', '2027-02-28', '2027-03-15']],
    ['B15-6', '2027-01-16T12:00:00Z', ['2027-01-16', '2027-02-01', '2027-02-16', '2027-03-01', '2027-03-16']],
    ['B15-7', '2027-01-31T00:00:00Z', ['2027-01-31', '2027-02-15', '2027-02-28', '2027-03-15', '2027-03-31']],
  ];
  for (const [id, f, want] of table) {
    it(`${id}: ${f} -> ${want.join(', ')}`, () => {
      expect(chain(new Date(f), 5)).toEqual(want.map(mid));
    });
  }

  it('B15-8: periodDateFor semiMonthly index 0 is a fresh Date at the UTC date midnight; caller Date untouched', () => {
    for (const s of ['2027-01-31T12:00:00Z', '2027-01-15T00:00:00.001Z', '2028-02-29T23:59:59.999Z']) {
      const f = new Date(s);
      const r0 = periodDateFor('semiMonthly', f, 0, d('2027-01-01'));
      expect(r0, s).not.toBe(f);
      expect(iso(r0), s).toBe(mid(s.slice(0, 10)));
      expect(iso(f), s).toBe(new Date(s).toISOString());
    }
    // A midnight first date: still a fresh object with the same value.
    const m = d('2027-01-31');
    const r = periodDateFor('semiMonthly', m, 0, d('2027-01-01'));
    expect(r).not.toBe(m);
    expect(iso(r)).toBe(mid('2027-01-31'));
  });

  it('B15-9: nextSemiMonthlyDate(2027-01-31T12:00Z, 2027-01-31T12:00Z) -> 2027-02-15 (was 02-16)', () => {
    const t = new Date('2027-01-31T12:00:00Z');
    expect(iso(nextSemiMonthlyDate(t, new Date(t.getTime())))).toBe(mid('2027-02-15'));
  });

  it('B15-10: a time of day on currentDate only (midnight first) is read as its calendar date', () => {
    // isEom first, month-end current with 12:00 -> 15th of next month (was 03-16 via day1 = 16).
    expect(iso(nextSemiMonthlyDate(d('2027-01-31'), new Date('2027-02-28T12:00:00Z')))).toBe(mid('2027-03-15'));
    // isEom first, 15th current with 23:59:59.999 -> that month-end.
    expect(iso(nextSemiMonthlyDate(d('2027-01-31'), new Date('2027-02-15T23:59:59.999Z')))).toBe(mid('2027-02-28'));
    // non-isEom first (14th), current 02-14 with a time: +15 days capped at Feb 28.
    expect(iso(nextSemiMonthlyDate(d('2027-01-14'), new Date('2027-02-14T18:00:00Z')))).toBe(mid('2027-02-28'));
  });
});

// ---------------------------------------------------------------------------------------
// Sweep against the T4 macro oracle (731 first dates, full 2-year date lists)
// ---------------------------------------------------------------------------------------
const sweep = (loadFixture('ca_semimonthly_vectors.json') as { sweep: { first: string; dates: string[] }[] }).sweep;

describe('B15 sweep: semi-monthly chains vs the macro oracle (fixtures/ca_semimonthly_vectors.json)', () => {
  it('fixture shape: 731 first dates 2027-01-01 .. 2028-12-31', () => {
    expect(sweep.length).toBe(731);
    expect(sweep[0]!.first).toBe('2027-01-01');
    expect(sweep[730]!.first).toBe('2028-12-31');
  });

  it('trust check (green before B15): midnight first dates give the oracle list exactly', () => {
    const bad = sweep.filter((v) => chain(d(v.first), v.dates.length).join() !== v.dates.map(mid).join());
    expect(bad.map((v) => v.first)).toEqual([]);
  });

  for (const [label, off] of [['+1 ms', 1], ['+12 h', 12 * 3_600_000], ['+24 h - 1 ms', DAY - 1]] as const) {
    it(`first date ${label}: every chain equals the oracle list at UTC midnight`, () => {
      const bad = sweep.filter(
        (v) => chain(new Date(d(v.first).getTime() + off), v.dates.length).join() !== v.dates.map(mid).join(),
      );
      expect(bad.length).toBe(0);
    });
  }
});

// ---------------------------------------------------------------------------------------
// B15-INV-calendar-date through the public engine
// ---------------------------------------------------------------------------------------
function probe(frequency: PaymentFrequency, firstMs: number, off: number): CobCanadaInput {
  return asInput({
    flow: 'newMortgageOrLoan',
    productType: 'mortgage',
    rateType: 'variable',
    loanAmount: 250000,
    contractRatePercent: 5.19,
    paymentAmount: 1300,
    paymentFrequency: frequency,
    fees: { fees: [{ name: 'F', amount: 2000, financed: true, includedInCob: true }] },
    disbursalDate: new Date(firstMs - 10 * DAY + off),
    firstPaymentDate: new Date(firstMs + off),
    endDate: new Date(firstMs + 730 * DAY + off),
    termYears: 2,
    termMonths: 0,
  });
}
const run = (x: CobCanadaInput) => {
  try {
    return JSON.stringify(calculateCobCanada(x));
  } catch (e) {
    return `ERR:${(e as Error).message}`;
  }
};
const OFFSETS = [1, 12 * 3_600_000, DAY - 1];
const FIRSTS: number[] = [];
for (let t = Date.UTC(2027, 0, 1); t <= Date.UTC(2028, 11, 31); t += DAY) FIRSTS.push(t);

describe('B15-INV-calendar-date: engine output for a time-bearing input equals its UTC-midnight twin', () => {
  it('corpus: 731 first dates', () => expect(FIRSTS.length).toBe(731));

  it('B15-1 through the engine: 2027-01-31T12:00Z semi-monthly rows 02-15, 02-28, 03-15 (all midnight)', () => {
    const rows = calculateCobCanada(probe('semiMonthly', Date.UTC(2027, 0, 31), 12 * 3_600_000)).amortizationSchedule;
    expect(rows.slice(0, 5).map((r) => iso(r.date))).toEqual(
      ['2027-01-31', '2027-02-15', '2027-02-28', '2027-03-15', '2027-03-31'].map(mid),
    );
  });

  it('semiMonthly: 731 x 3 offsets (disbursal, first, end all offset) -> 0 differences', () => {
    const diffs: string[] = [];
    for (const t of FIRSTS) {
      const base = run(probe('semiMonthly', t, 0));
      expect(base.startsWith('ERR'), new Date(t).toISOString()).toBe(false);
      for (const o of OFFSETS) if (run(probe('semiMonthly', t, o)) !== base) diffs.push(`${new Date(t).toISOString().slice(0, 10)}+${o}`);
    }
    expect(diffs.length).toBe(0);
  });

  it('weekly / biweekly / monthly (characterisation, green before and after): 731 x 3 offsets -> 0 differences', () => {
    const diffs: string[] = [];
    for (const q of ['weekly', 'biweekly', 'monthly'] as const) {
      for (const t of FIRSTS) {
        const base = run(probe(q, t, 0));
        for (const o of OFFSETS) if (run(probe(q, t, o)) !== base) diffs.push(`${q} ${new Date(t).toISOString().slice(0, 10)}+${o}`);
      }
    }
    expect(diffs).toEqual([]);
  });
});
