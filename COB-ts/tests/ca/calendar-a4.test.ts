/**
 * A4 (COB-architecture.md §5 A4, revision 6): extract src/ca/calendar.ts. R item: behaviour
 * is byte-identical, golden unchanged. QA step written 2026-09-28, before the developer step.
 *
 * Three parts:
 *   1. ENGINE characterisation (green now, must stay green): date behaviour observed through
 *      the public daysBetween / dayCountFraction (equations.js) and calculateCobCanada's
 *      schedule row dates, including time-of-day behaviour. A4 pinned "a semi-monthly FIRST
 *      row keeps the input's time of day"; B15 (QA 2026-09-28) deliberately changed the two
 *      tests to "every row is UTC midnight" (tagged B15).
 *   2. calendar.ts (red until the file exists): (a) the exact 11 exports, (b) equations
 *      re-exports the same bindings, (c) the spec's characterisation table, called on
 *      calendar.ts directly. If the module cannot be loaded, every test here fails with the
 *      message "A4 not landed: src/ca/calendar.ts cannot be imported"; the rest of the suite
 *      is unaffected (dynamic import, caught).
 *   3. Source guards (red until A4): validate.ts has no utcCalendarDay and no Date.UTC(; in
 *      src/ca, Date.UTC( and getUTC occur only in calendar.ts (comments stripped).
 *
 * Expected values were computed by QA on 2026-09-28 from the current build (helpers exported
 * in a scratch copy only; src/ was not edited). They are identical under TZ=UTC,
 * America/Toronto and Pacific/Kiritimati. This file is in `test:tz` (A4 Goal 7).
 * Dates are compared with toISOString(), so exact to the millisecond.
 *
 * Note on the spec table's last row: its index-1 list "(01-22, 01-29, 01-31, 02-15)" is in the
 * order weekly, biweekly, semiMonthly, monthly. The build gives monthly 2027-02-15 and
 * semiMonthly 2027-01-31; this file pins those (per frequency).
 */
import { fileURLToPath } from 'node:url';
import { describe, expect, it, beforeAll } from 'vitest';
import * as equations from '../../src/ca/equations.js';
import { calculateCobCanada } from '../../src/ca/index.js';
import type { CobCanadaInput, PaymentFrequency } from '../../src/ca/index.js';
import { SRC_CA, grepCode, listFiles, read, stripComments } from '../architecture/support.js';
import { asInput, utcDate } from './support/builders.js';
import { expectRangeErrorMatching } from './support/compare.js';
import { oracleYearFracBasis1 } from './support/leapNOracle.js';

const d = utcDate;
const iso = (x: Date) => x.toISOString();
const mid = (s: string) => `${s}T00:00:00.000Z`;

// ---------------------------------------------------------------------------------------
// 1. Engine characterisation (green now)
// ---------------------------------------------------------------------------------------

function input(frequency: PaymentFrequency, first: Date): CobCanadaInput {
  return asInput({
    flow: 'newMortgageOrLoan',
    productType: 'mortgage',
    rateType: 'fixed',
    loanAmount: 100000,
    contractRatePercent: 5,
    paymentAmount: 2000,
    paymentFrequency: frequency,
    firstPaymentDate: first,
    endDate: d('2027-12-31'),
    termYears: 1,
    termMonths: 0,
    fees: { fees: [] },
    disbursalDate: d('2027-01-05'),
    semiAnnualCompoundingDate: d('2027-01-05'),
  });
}
const rowDates = (frequency: PaymentFrequency, first: Date, n: number) =>
  calculateCobCanada(input(frequency, first)).amortizationSchedule.slice(0, n).map((r) => iso(r.date));

describe('A4 characterisation through the public engine (green before and after A4)', () => {
  it('daysBetween (equations.js): leap day, Toronto DST day, 1 ms before midnight', () => {
    expect(equations.daysBetween(d('2028-02-28'), d('2028-03-01'))).toBe(2);
    expect(equations.daysBetween(d('2026-03-08'), d('2026-03-09'))).toBe(1);
    expect(equations.daysBetween(new Date('2027-01-01T23:59:59.999Z'), new Date('2027-01-02T00:00:00Z'))).toBe(1);
  });

  it('dayCountFraction (equations.js): year split, whole leap year, empty span', () => {
    expect(equations.dayCountFraction(d('2027-12-31'), d('2028-01-02'))).toBe(1 / 365 + 1 / 366);
    expect(equations.dayCountFraction(d('2027-12-31'), d('2028-01-02'))).toBe(0.005471966464555731);
    expect(equations.dayCountFraction(d('2028-01-01'), d('2029-01-01'))).toBe(1);
    expect(equations.dayCountFraction(d('2027-01-01'), d('2027-01-01'))).toBe(0);
  });

  it('schedule dates: monthly OQ-X (Apr 30 -> May 31 ... Feb 29 2028) and T3 clamp (Jan 30 -> Feb 28)', () => {
    const oqx = calculateCobCanada({ ...input('monthly', d('2027-04-30')), endDate: d('2028-06-30') } as CobCanadaInput)
      .amortizationSchedule.map((r) => iso(r.date));
    expect(oqx[1]).toBe(mid('2027-05-31'));
    expect(oqx[10]).toBe(mid('2028-02-29'));
    expect(rowDates('monthly', d('2027-01-30'), 3)).toEqual([mid('2027-01-30'), mid('2027-02-28'), mid('2027-03-30')]);
  });

  it('schedule dates: bi-weekly across the year end', () => {
    expect(rowDates('biweekly', d('2027-12-24'), 1)).toEqual([mid('2027-12-24')]);
    const r = calculateCobCanada({ ...input('biweekly', d('2027-12-24')), endDate: d('2028-06-30') } as CobCanadaInput);
    expect(iso(r.amortizationSchedule[1]!.date)).toBe(mid('2028-01-07'));
  });

  it('schedule dates: semi-monthly chains (T4 getNextSemiMonthly port)', () => {
    expect(rowDates('semiMonthly', d('2027-01-15'), 6)).toEqual(
      ['2027-01-15', '2027-01-31', '2027-02-15', '2027-02-28', '2027-03-15', '2027-03-31'].map(mid),
    );
    const leap = calculateCobCanada({ ...input('semiMonthly', d('2028-01-31')), endDate: d('2028-12-31') } as CobCanadaInput);
    expect(leap.amortizationSchedule.slice(0, 6).map((r) => iso(r.date))).toEqual(
      ['2028-01-31', '2028-02-15', '2028-02-29', '2028-03-15', '2028-03-31', '2028-04-15'].map(mid),
    );
    // known_divergence DEV-OQZ (B25): a typed 14th is moved to the 15th; the macro would run 14th / 28th / 14th / 29th ...
    // (workbook), the shipped schedule runs 15th / month-end from the moved date.
    expect(rowDates('semiMonthly', d('2027-02-14'), 6)).toEqual(
      ['2027-02-15', '2027-02-28', '2027-03-15', '2027-03-31', '2027-04-15', '2027-04-30'].map(mid),
    );
  });

  // B15 (COB-architecture.md §5 B15, B15-5; QA 2026-09-28): was "PINNED AS-IS" at A4 (the
  // semi-monthly first row kept 12:00Z). B15 deliberately changes it: every row of every
  // frequency is the input's UTC calendar date at midnight (ADR-03, B3b / D-12 precedent).
  it('time of day: every row of every frequency is UTC midnight, including the semi-monthly FIRST row (B15)', () => {
    const f = new Date('2027-01-15T12:00:00Z');
    expect(rowDates('weekly', f, 2)).toEqual([mid('2027-01-15'), mid('2027-01-22')]);
    expect(rowDates('biweekly', f, 2)).toEqual([mid('2027-01-15'), mid('2027-01-29')]);
    expect(rowDates('monthly', f, 2)).toEqual([mid('2027-01-15'), mid('2027-02-15')]);
    expect(rowDates('semiMonthly', f, 2)).toEqual([mid('2027-01-15'), mid('2027-01-31')]); // B15
  });
});

// ---------------------------------------------------------------------------------------
// 2. calendar.ts (red until A4 creates it)
// ---------------------------------------------------------------------------------------

const EXPORTS = [
  'addMonthsClamped', 'addUtcDays', 'dayCountFraction', 'daysBetween', 'daysInUtcMonth', 'effectiveFirstPaymentDate', 'endOfUtcMonth',
  'isLastDayOfMonth', 'isLeapYear', 'nextSemiMonthlyDate', 'periodDateFor', 'termBetween', 'utcDateOnly', // B24-R1 adds termBetween; B25-R2 adds effectiveFirstPaymentDate
  'roundUpToWholeMonths', // B34 (DEC-B34-TERM, B34-R2): the display-only rounding of a term, internal to src/ca
  'paymentPeriodDays', // B37 (DEC-B37-LEAP-N, B37-R2): 7 / 14 days per period, null for Monthly / Semi-monthly; internal to src/ca
  'excelYearFracBasis1', // B38 (DEC-B38-YEARFRAC-ROUND, E-B38-1): Excel YEARFRAC basis 1, Y of the leap-aware n; internal to src/ca
].sort();

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Cal = Record<string, any>;
let calendar: Cal | undefined;
let loadError = '';
beforeAll(async () => {
  try {
    // Path built at runtime (not a literal specifier) so F10 (imports resolve) stays green
    // before A4; vite-node maps the absolute path to the same module instance equations.js uses.
    const path = fileURLToPath(new URL('../../src/ca/calendar.ts', import.meta.url));
    calendar = (await import(/* @vite-ignore */ path)) as Cal;
  } catch (e) {
    loadError = e instanceof Error ? e.message.split('\n')[0]! : String(e);
  }
});
function cal(): Cal {
  if (!calendar) throw new Error(`A4 not landed: src/ca/calendar.ts cannot be imported (${loadError})`);
  return calendar;
}

describe('A4 calendar.ts module', () => {
  it('a. exports exactly the 11 functions of Goal 4 plus termBetween (B24-R1), effectiveFirstPaymentDate (B25-R2), roundUpToWholeMonths (B34-R2), paymentPeriodDays (B37-R2) and excelYearFracBasis1 (B38, E-B38-1) (MS_PER_DAY stays private)', () => {
    const c = cal();
    expect(Object.keys(c).sort()).toEqual(EXPORTS);
    for (const k of EXPORTS) expect(typeof c[k], k).toBe('function');
  });

  it('b. equations.js re-exports the same daysBetween / dayCountFraction bindings', () => {
    const c = cal();
    expect(equations.daysBetween).toBe(c.daysBetween);
    expect(equations.dayCountFraction).toBe(c.dayCountFraction);
  });
});

describe('A4 calendar.ts characterisation table (spec step 2c; values from the pre-A4 build)', () => {
  it('daysBetween', () => {
    const c = cal();
    expect(c.daysBetween(d('2028-02-28'), d('2028-03-01'))).toBe(2);
    expect(c.daysBetween(d('2026-03-08'), d('2026-03-09'))).toBe(1);
    expect(c.daysBetween(new Date('2027-01-01T23:59:59.999Z'), new Date('2027-01-02T00:00:00Z'))).toBe(1);
  });

  it('dayCountFraction', () => {
    const c = cal();
    expect(c.dayCountFraction(d('2027-12-31'), d('2028-01-02'))).toBe(1 / 365 + 1 / 366);
    expect(c.dayCountFraction(d('2027-12-31'), d('2028-01-02'))).toBe(0.005471966464555731);
    expect(c.dayCountFraction(d('2028-01-01'), d('2029-01-01'))).toBe(1);
    expect(c.dayCountFraction(d('2027-01-01'), d('2027-01-01'))).toBe(0);
  });

  it('utcDateOnly and isLeapYear', () => {
    const c = cal();
    expect(c.utcDateOnly(new Date('2026-03-23T23:59:59.999Z'))).toBe(Date.UTC(2026, 2, 23));
    expect(c.utcDateOnly(new Date('2026-03-23T23:59:59.999Z'))).toBe(1774224000000);
    expect([1900, 2000, 2028, 2027].map((y) => c.isLeapYear(y))).toEqual([false, true, true, false]);
  });

  it('addUtcDays (time of day dropped), daysInUtcMonth, isLastDayOfMonth, endOfUtcMonth', () => {
    const c = cal();
    expect(iso(c.addUtcDays(d('2028-02-28'), 1))).toBe(mid('2028-02-29'));
    expect(iso(c.addUtcDays(new Date('2027-01-01T12:00:00Z'), 7))).toBe(mid('2027-01-08'));
    expect([c.daysInUtcMonth(2028, 1), c.daysInUtcMonth(2100, 1)]).toEqual([29, 28]);
    expect([c.isLastDayOfMonth(d('2027-04-30')), c.isLastDayOfMonth(d('2028-02-28'))]).toEqual([true, false]);
    expect(iso(c.endOfUtcMonth(d('2028-02-10')))).toBe(mid('2028-02-29'));
  });

  it('addMonthsClamped (T3 clamp)', () => {
    const c = cal();
    expect(iso(c.addMonthsClamped(d('2027-01-31'), 1))).toBe(mid('2027-02-28'));
    expect(iso(c.addMonthsClamped(d('2028-01-31'), 1))).toBe(mid('2028-02-29'));
    expect(iso(c.addMonthsClamped(d('2027-01-30'), 1))).toBe(mid('2027-02-28'));
  });

  it('periodDateFor monthly (OQ-X) and bi-weekly', () => {
    const c = cal();
    expect(iso(c.periodDateFor('monthly', d('2027-04-30'), 1, d('2027-04-30')))).toBe(mid('2027-05-31'));
    expect(iso(c.periodDateFor('monthly', d('2027-04-30'), 10, d('2027-04-30')))).toBe(mid('2028-02-29'));
    expect(iso(c.periodDateFor('monthly', d('2027-01-30'), 1, d('2027-01-30')))).toBe(mid('2027-02-28'));
    expect(iso(c.periodDateFor('biweekly', d('2027-12-24'), 1, d('2027-12-24')))).toBe(mid('2028-01-07'));
  });

  it('periodDateFor semi-monthly chains (index i uses the previous result; T4)', () => {
    const c = cal();
    const chain = (first: string) => {
      const f = d(first);
      const out: string[] = [];
      let prev = f;
      for (let i = 0; i < 6; i++) {
        prev = c.periodDateFor('semiMonthly', f, i, prev);
        out.push(iso(prev));
      }
      return out;
    };
    expect(chain('2027-01-15')).toEqual(['2027-01-15', '2027-01-31', '2027-02-15', '2027-02-28', '2027-03-15', '2027-03-31'].map(mid));
    expect(chain('2028-01-31')).toEqual(['2028-01-31', '2028-02-15', '2028-02-29', '2028-03-15', '2028-03-31', '2028-04-15'].map(mid));
    expect(chain('2027-02-14')).toEqual(['2027-02-14', '2027-02-28', '2027-03-14', '2027-03-29', '2027-04-14', '2027-04-29'].map(mid));
    // nextSemiMonthlyDate directly (same port): 2027-01-15 -> 2027-01-31.
    expect(iso(c.nextSemiMonthlyDate(d('2027-01-15'), d('2027-01-15')))).toBe(mid('2027-01-31'));
  });

  // B15 (B15-8; QA 2026-09-28): was "PINNED AS-IS" at A4 (semiMonthly index 0 returned the
  // caller's Date object, 12:00 kept). B15: a fresh Date at the UTC calendar date's midnight.
  it('periodDateFor time of day: index 0 is a fresh UTC-midnight Date for every frequency (B15); index 1 is midnight', () => {
    const c = cal();
    const f = new Date('2027-01-15T12:00:00Z');
    const want: Record<string, string> = { weekly: '2027-01-22', biweekly: '2027-01-29', monthly: '2027-02-15', semiMonthly: '2027-01-31' };
    for (const q of ['weekly', 'biweekly', 'monthly'] as const) {
      const r0 = c.periodDateFor(q, f, 0, d('2027-01-05'));
      expect(iso(r0), q).toBe(mid('2027-01-15'));
      expect(r0, q).not.toBe(f);
      expect(iso(c.periodDateFor(q, f, 1, r0)), q).toBe(mid(want[q]!));
    }
    const s0 = c.periodDateFor('semiMonthly', f, 0, d('2027-01-05'));
    expect(s0).not.toBe(f); // B15
    expect(iso(s0)).toBe(mid('2027-01-15')); // B15
    expect(iso(f)).toBe('2027-01-15T12:00:00.000Z'); // caller's Date not mutated
    expect(iso(c.periodDateFor('semiMonthly', f, 1, s0))).toBe(mid(want.semiMonthly!));
  });
});

// ---------------------------------------------------------------------------------------
// 3. Source guards (red until A4)
// ---------------------------------------------------------------------------------------

describe('A4 source guards (comments stripped)', () => {
  it('d. validate.ts contains neither utcCalendarDay nor Date.UTC(', () => {
    const code = stripComments(read(`${SRC_CA}/validate.ts`));
    expect(code.includes('utcCalendarDay'), 'utcCalendarDay in validate.ts').toBe(false);
    expect(code.includes('Date.UTC('), 'Date.UTC( in validate.ts').toBe(false);
  });

  it('d. within src/ca, Date.UTC( and getUTC occur only in calendar.ts', () => {
    const files = listFiles(SRC_CA, /\.ts$/);
    expect(files.some((f) => f.endsWith('/calendar.ts')), 'src/ca/calendar.ts exists').toBe(true);
    const hits = grepCode(files, /Date\.UTC\(|getUTC/).filter((h) => h.file !== 'src/ca/calendar.ts');
    expect(hits.map((h) => `${h.file}:${h.line} ${h.text}`)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------
// 4. B38 (spec 013 E-B38-1, DEC-B38-YEARFRAC-ROUND): excelYearFracBasis1 = Excel YEARFRAC(start, end, 1)
// ---------------------------------------------------------------------------------------

describe('B38 INV-B38-YF excelYearFracBasis1 (Excel YEARFRAC basis 1)', () => {
  const T: [string, string, string, number][] = [
    ['2026-10-08', '2029-09-23', 'multi (4 years, one leap)', 2.9596167008898013],
    ['2026-10-08', '2031-03-27', 'multi (6 years, one leap)', 4.466453674121405],
    ['2000-01-01', '2004-01-31', 'multi (two leaps)', 4.080459770114943],
    ['2000-01-01', '2000-01-02', 'same year, leap', 1 / 366],
    ['2028-01-10', '2028-12-18', 'same year, leap', 343 / 366],
    ['2100-01-04', '2100-12-27', 'same year, 2100 not leap', 357 / 365],
    ['2027-06-01', '2028-03-15', 'cross, Feb 29 2028 inside', 288 / 366],
    ['2027-06-01', '2028-02-28', 'cross, no Feb 29', 272 / 365],
    ['2027-06-01', '2028-02-29', 'cross, end = Feb 29', 273 / 366],
    ['2028-03-01', '2029-02-28', 'cross, start after Feb 29', 364 / 365],
    ['2028-02-29', '2029-02-28', 'cross, start = Feb 29', 365 / 366],
    ['2027-12-31', '2028-01-01', 'cross, Feb 29 2028 not reached', 1 / 365],
    ['2028-12-31', '2029-01-01', 'cross, Feb 29 2028 behind start', 1 / 365],
    ['2000-01-01', '2001-01-01', 'exactly one year', 1],
    ['2027-12-15', '2028-12-15', 'exactly one year', 1],
    ['2028-02-29', '2029-03-01', 'multi (not within a year)', 366 / 365.5],
    ['2028-03-01', '2028-12-01', 'same year, no Feb 29 inside (366, not 365)', 275 / 366],
  ];
  it.each(T)('%s -> %s (%s) is %f exactly, and the oracle agrees', (s, e, _branch, y) => {
    expect(Object.is(cal().excelYearFracBasis1(utcDate(s), utcDate(e)), y)).toBe(true);
    expect(Object.is(oracleYearFracBasis1(s, e), y)).toBe(true);
  });

  it('Wheeler\'s 10-digit figure: 2000-01-01 -> 2004-01-31 is 4.080459770 (1e-9)', () => {
    expect(Math.abs(cal().excelYearFracBasis1(utcDate('2000-01-01'), utcDate('2004-01-31')) - 4.08045977)).toBeLessThan(1e-9);
  });

  it('start = end is 0; start after end and an invalid Date are RangeErrors; 2000 is leap and 2100 is not', () => {
    expect(cal().excelYearFracBasis1(utcDate('2026-10-08'), utcDate('2026-10-08'))).toBe(0);
    expectRangeErrorMatching(() => cal().excelYearFracBasis1(utcDate('2026-10-09'), utcDate('2026-10-08')), /^start must be on or before end$/);
    expectRangeErrorMatching(() => cal().excelYearFracBasis1(new Date(NaN), utcDate('2026-10-08')), /^start\/end must be valid Dates$/);
    expectRangeErrorMatching(() => cal().excelYearFracBasis1(utcDate('2026-10-08'), new Date(NaN)), /^start\/end must be valid Dates$/);
    expect(cal().excelYearFracBasis1(utcDate('2000-02-01'), utcDate('2000-03-01'))).toBe(29 / 366);
    expect(cal().excelYearFracBasis1(utcDate('2100-02-01'), utcDate('2100-03-01'))).toBe(28 / 365);
  });

  it('a time of day is ignored (UTC calendar days)', () => {
    const a = new Date('2027-06-01T23:59:00Z');
    const b = new Date('2028-03-15T00:01:00Z');
    expect(cal().excelYearFracBasis1(a, b)).toBe(288 / 366);
  });
});
