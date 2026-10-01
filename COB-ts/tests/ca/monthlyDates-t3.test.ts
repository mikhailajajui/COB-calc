import { describe, expect, it } from 'vitest';
import { calculateCobCanada } from '../../src/ca/index.js';
import type { CobCanadaInput } from '../../src/ca/index.js';
import { isoDay, utcDate } from './support/builders.js';

/**
 * T3 / 008 E1 / 012 D-03: monthly payment dates on month-end days follow the workbook.
 *
 * Reference (workbook-macro-source.txt, CalculateAll + getNextMonthly):
 *   nextDate = getNextMonthly(firstPymtDate, startDate)
 *   Function getNextMonthly(firstPymtDate, currentDate)
 *     getDate = firstPymtDate : mths = 0
 *     Do Until getDate > currentDate
 *       getDate = DateAdd("m", mths, firstPymtDate) : mths = mths + 1
 *     Loop
 *   checkToExit = DateDiff("d", eDate, nextDate) > 0      ' exit only when AFTER End Date
 *
 * VBA DateAdd("m", k, d) CLAMPS the day to the last day of the target month, and every
 * date is computed from the First Payment Date (not chained from the previous row), so
 * a first payment on Jan 31 gives Jan 31, Feb 28 (Feb 29 in a leap year), Mar 31,
 * Apr 30, ... -- the 31st comes back after a short month. JavaScript's
 * Date.UTC(y, m + k, d) overflows instead (Jan 31 + 1 month = Mar 3).
 *
 * Every expected date list below is a literal, hand-derived from the rule above (and
 * cross-checked with a scratch Python transliteration using calendar.monthrange).
 * Assertions go through the public engine output only (schedule row dates).
 *
 * Personal loan (MONTHLY rate basis, OQ-C) so the rate is the contract rate exactly and
 * row interest is hand-computable: 12% nominal, no fees, payment 500 on 10,000 -- no
 * payoff inside any window used here.
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

describe('T3 first payment on the 31st: clamps to month-end, returns to the 31st', () => {
  it('non-leap 2027: Jan 31 -> Feb 28 -> Mar 31 ... Dec 31 (12 rows, End Date Dec 31 included)', () => {
    expect(datesOf('2027-01-31', '2027-12-31')).toEqual([
      '2027-01-31',
      '2027-02-28',
      '2027-03-31',
      '2027-04-30',
      '2027-05-31',
      '2027-06-30',
      '2027-07-31',
      '2027-08-31',
      '2027-09-30',
      '2027-10-31',
      '2027-11-30',
      '2027-12-31',
    ]);
  });

  it('leap 2028: Jan 31 -> Feb 29 -> Mar 31 -> Apr 30 -> May 31 -> Jun 30', () => {
    expect(datesOf('2028-01-31', '2028-06-30')).toEqual([
      '2028-01-31',
      '2028-02-29',
      '2028-03-31',
      '2028-04-30',
      '2028-05-31',
      '2028-06-30',
    ]);
  });

  it('across a year end into a leap Feb: Oct 31 2027 -> Nov 30 -> Dec 31 -> Jan 31 -> Feb 29 2028 -> Mar 31', () => {
    expect(datesOf('2027-10-31', '2028-03-31')).toEqual([
      '2027-10-31',
      '2027-11-30',
      '2027-12-31',
      '2028-01-31',
      '2028-02-29',
      '2028-03-31',
    ]);
  });
});

describe('T3 first payment on the 30th and 29th: Feb clamps, other months keep the day', () => {
  it('30th, non-leap 2027: Feb 28, then back to the 30th', () => {
    expect(datesOf('2027-01-30', '2027-06-30')).toEqual([
      '2027-01-30',
      '2027-02-28',
      '2027-03-30',
      '2027-04-30',
      '2027-05-30',
      '2027-06-30',
    ]);
  });

  it('30th, leap 2028: Feb 29, then back to the 30th', () => {
    expect(datesOf('2028-01-30', '2028-04-30')).toEqual(['2028-01-30', '2028-02-29', '2028-03-30', '2028-04-30']);
  });

  it('29th, non-leap 2027: Feb 28, then back to the 29th', () => {
    expect(datesOf('2027-01-29', '2027-04-30')).toEqual(['2027-01-29', '2027-02-28', '2027-03-29', '2027-04-29']);
  });

  it('29th, leap 2028: Feb 29 exists, no clamp (regression guard)', () => {
    expect(datesOf('2028-01-29', '2028-04-30')).toEqual(['2028-01-29', '2028-02-29', '2028-03-29', '2028-04-29']);
  });
});

describe('T3 regression guard: days that exist in every month are unchanged', () => {
  it('28th: every row on the 28th', () => {
    expect(datesOf('2027-01-28', '2027-06-30')).toEqual([
      '2027-01-28',
      '2027-02-28',
      '2027-03-28',
      '2027-04-28',
      '2027-05-28',
      '2027-06-28',
    ]);
  });

  it('15th: every row on the 15th', () => {
    expect(datesOf('2027-01-15', '2027-06-30')).toEqual([
      '2027-01-15',
      '2027-02-15',
      '2027-03-15',
      '2027-04-15',
      '2027-05-15',
      '2027-06-15',
    ]);
  });
});

describe('T3 interest on a clamped period uses the actual days', () => {
  // Hand-computed, 10,000 at 12% (contract rate, MONTHLY basis), payment 500:
  //   disbursal 2027-01-01 -> 2027-01-31: 30 days
  //     I1 = 10000 x 0.12 x 30/365 = 98.63013698630137, B1 = 9598.630136986301
  //   2027-01-31 -> 2027-02-28: 28 days (clamped; overflow would give Mar 3 = 31 days)
  //     I2 = B1 x 0.12 x 28/365 = 88.35999249390129,  B2 = 9186.990129480202
  //   2027-02-28 -> 2027-03-31: 31 days
  //     I3 = B2 x 0.12 x 31/365 = 93.63178981278452
  const REL = 1e-12;
  const rel = (a: number, e: number) => Math.abs(a - e) / Math.abs(e);

  it('non-leap: row 2 is Feb 28, 28 days, interest 88.35999249390129; row 3 is Mar 31, 31 days, 93.63178981278452', () => {
    const rows = calculateCobCanada(monthly('2027-01-31', '2027-06-30', '2027-01-01')).amortizationSchedule;
    expect(rows[0]!.daysInPeriod).toBe(30);
    expect(rel(rows[0]!.periodInterest, 98.63013698630137)).toBeLessThanOrEqual(REL);

    expect(iso(rows[1]!.date)).toBe('2027-02-28');
    expect(rows[1]!.daysInPeriod).toBe(28);
    expect(rel(rows[1]!.openingBalance, 9598.630136986301)).toBeLessThanOrEqual(REL);
    expect(rel(rows[1]!.periodInterest, 88.35999249390129)).toBeLessThanOrEqual(REL);

    expect(iso(rows[2]!.date)).toBe('2027-03-31');
    expect(rows[2]!.daysInPeriod).toBe(31);
    expect(rel(rows[2]!.openingBalance, 9186.990129480202)).toBeLessThanOrEqual(REL);
    expect(rel(rows[2]!.periodInterest, 93.63178981278452)).toBeLessThanOrEqual(REL);
  });

  it('leap: 2028-01-31 -> 2028-02-29 is 29 days, interest = B1 x 0.12 x 29/366 = 91.26310131685031', () => {
    // I1 = 10000 x 0.12 x 30/366 = 98.36065573770492, B1 = 9598.360655737704
    const rows = calculateCobCanada(monthly('2028-01-31', '2028-04-30', '2028-01-01')).amortizationSchedule;
    expect(iso(rows[1]!.date)).toBe('2028-02-29');
    expect(rows[1]!.daysInPeriod).toBe(29);
    expect(rel(rows[1]!.periodInterest, 91.26310131685031)).toBeLessThanOrEqual(REL);
  });
});

describe('T3 End Date exit with clamped dates (exit only when nextDate > End Date)', () => {
  it('End Date = the clamped Feb 28: that payment is included (2 rows)', () => {
    const res = calculateCobCanada(monthly('2027-01-31', '2027-02-28'));
    expect(res.amortizationSchedule.map((r) => iso(r.date))).toEqual(['2027-01-31', '2027-02-28']);
    expect(res.numberOfPayments).toBe(2);
  });

  it('End Date = the clamped Feb 29 (leap): that payment is included (2 rows)', () => {
    const res = calculateCobCanada(monthly('2028-01-31', '2028-02-29'));
    expect(res.amortizationSchedule.map((r) => iso(r.date))).toEqual(['2028-01-31', '2028-02-29']);
    expect(res.numberOfPayments).toBe(2);
  });

  it('End Date = the clamped Apr 30: included, last row Apr 30 (4 rows)', () => {
    const res = calculateCobCanada(monthly('2027-01-31', '2027-04-30'));
    expect(res.amortizationSchedule.map((r) => iso(r.date))).toEqual([
      '2027-01-31',
      '2027-02-28',
      '2027-03-31',
      '2027-04-30',
    ]);
    expect(res.numberOfPayments).toBe(4);
  });

  it('End Date one day before the clamped Apr 30: Apr 30 excluded, last row Mar 31 (3 rows)', () => {
    const res = calculateCobCanada(monthly('2027-01-31', '2027-04-29'));
    expect(res.amortizationSchedule.map((r) => iso(r.date))).toEqual(['2027-01-31', '2027-02-28', '2027-03-31']);
    expect(res.numberOfPayments).toBe(3);
  });
});
