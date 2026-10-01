import type { ContractTerm, PaymentFrequency } from './types.js';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/** UTC-midnight timestamp for a Date's calendar-date components. Extracted via UTC
 *  getters (not local getters) because this module's Dates are constructed from
 *  'YYYY-MM-DD'-style ISO strings, which parse to UTC midnight -- using local getters
 *  would silently shift the calendar date by a day in any timezone west of UTC (e.g.
 *  this repo's own dev/CI environment, America/Toronto). All date arithmetic in this
 *  module stays in UTC space for exactly this reason. */
export function utcDateOnly(date: Date): number {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

/**
 * Actual calendar days between two dates (no leap-year splitting -- a plain integer
 * day count). Feeds ScheduleRow.days_in_period and term_days.
 */
export function daysBetween(start: Date, end: Date): number {
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw new RangeError('start/end must be valid Dates');
  }
  return Math.round((utcDateOnly(end) - utcDateOnly(start)) / MS_PER_DAY); // fitness:day-count
}

/**
 * Equation 3's day-count-fraction step -- docx section 4.4 / Appendix B.3: the actual
 * number of calendar days in [start, end), divided by 365, EXCEPT that any days
 * falling in a leap calendar year are divided by 366 instead, with the (possibly
 * several) partial results summed. This is additive across contiguous sub-ranges --
 * calling it once over a whole span gives the same result as summing it over each
 * row-length sub-period of that span (verified against doc 007's worked vector; see
 * cobCanada.ts's cob_rate_percent T for where this additivity is relied on).
 */
export function dayCountFraction(start: Date, end: Date): number {
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw new RangeError('start/end must be valid Dates');
  }
  const endUtc = utcDateOnly(end);
  let cursor = utcDateOnly(start);
  if (cursor > endUtc) {
    throw new RangeError('start must be on or before end');
  }
  let fraction = 0;
  while (cursor < endUtc) {
    const year = new Date(cursor).getUTCFullYear();
    const nextYearStart = Date.UTC(year + 1, 0, 1);
    const segmentEnd = Math.min(nextYearStart, endUtc);
    const daysInSegment = Math.round((segmentEnd - cursor) / MS_PER_DAY); // fitness:day-count
    const daysInYear = isLeapYear(year) ? 366 : 365;
    fraction += daysInSegment / daysInYear;
    cursor = segmentEnd;
  }
  return fraction;
}

/** UTC-safe day/month stepping -- see utcDateOnly's doc comment above for why
 *  this module avoids local-timezone Date getters/setters entirely. */
export function addUtcDays(date: Date, days: number): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + days));
}

/** Day count of the given UTC month (0-based monthIndex; Date.UTC normalises an
 *  out-of-range monthIndex into the right year). */
export function daysInUtcMonth(year: number, monthIndex: number): number {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

/** True when `date` is the last day of its UTC month (Feb 28 2027, Feb 29 2028, Apr 30;
 *  Feb 28 2028 is not, as 2028 is a leap year). */
export function isLastDayOfMonth(date: Date): boolean {
  return date.getUTCDate() === daysInUtcMonth(date.getUTCFullYear(), date.getUTCMonth());
}

/** Steps `months` calendar months from `date` (callers index every monthly date from
 *  the First Payment Date). Two steps:
 *  1. Month-end rule OQ-X (COB-user-stories.md §7.3, business decision 2026-09-27): if
 *     `date` is the last day of its month, the result is the last day of the target
 *     month (Apr 30 -> May 31 -> Jun 30; Feb 28 2027 -> Mar 31). This is an intentional
 *     difference from the workbook, whose DateAdd keeps the day number (Feb 28 ->
 *     Mar 28).
 *  2. Otherwise the day number is kept and clamped to the last day of the target
 *     month, as VBA `DateAdd("m", months, date)` does in the macro's getNextMonthly:
 *     Jan 31 + 1 month is Feb 28 (Feb 29 in a leap year), and Jan 30 -> Feb 28 ->
 *     Mar 30.
 *  T3 2026-09-27: monthly DateAdd month-end clamp; OQ-X 2026-09-27: month-end rule. */
export function addMonthsClamped(date: Date, months: number): Date {
  const year = date.getUTCFullYear();
  const monthIndex = date.getUTCMonth() + months;
  const lastDay = daysInUtcMonth(year, monthIndex);
  const day = isLastDayOfMonth(date) ? lastDay : Math.min(date.getUTCDate(), lastDay);
  return new Date(Date.UTC(year, monthIndex, day));
}

/** The whole years, months and leftover days from `from` to `to` (B24-R1). Both are read as
 *  UTC calendar dates. The month count is anchored on the schedule's own stepper
 *  `addMonthsClamped` (so a month-end start anchors on month-ends, OQ-X), and the leftover
 *  days run from that anchor to `to`. */
export function termBetween(from: Date, to: Date): ContractTerm {
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    throw new RangeError('from/to must be valid Dates');
  }
  const start = new Date(utcDateOnly(from));
  const end = new Date(utcDateOnly(to));
  if (start.getTime() > end.getTime()) {
    throw new RangeError('from must be on or before to');
  }
  let totalMonths =
    (end.getUTCFullYear() - start.getUTCFullYear()) * 12 + (end.getUTCMonth() - start.getUTCMonth());
  if (addMonthsClamped(start, totalMonths).getTime() > end.getTime()) {
    totalMonths -= 1;
  }
  const months = totalMonths % 12;
  const years = (totalMonths - months) / 12;
  const days = daysBetween(addMonthsClamped(start, totalMonths), end);
  return { years, months, days };
}

/** Last day of `date`'s UTC month. Equivalent to the macro's
 *  `getNextEOM(DateAdd("d", -1, date))`, the only way getNextSemiMonthly calls it. */
export function endOfUtcMonth(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0));
}

/** Exact port of the workbook's `getNextSemiMonthly(firstPymtDate, currentDate)` and
 *  the `getNextEOM` it calls (reference/workbook-macro-source.txt ~lines 844-905),
 *  quirks kept. Returns the payment date after `currentDate` (the previous payment).
 *  Both arguments are read as their UTC calendar dates (any time of day is dropped).
 *  - isEOM: the first date is the 15th or the last day of its month; dates then
 *    alternate 15th / month-end (so a 31st start gives 15th / month-end).
 *  - Otherwise day1 = first day, minus 15 when >= 15. A date <= 15th moves 15 days,
 *    capped at its month-end (February capping: a 14th start gives 14th / 29th, Feb
 *    28 or 29); a date > 15th moves to day1 of the next month via
 *    `DateSerial(y, m, day1)`, where day1 = 0 rolls back to the previous month's last
 *    day (Date.UTC normalises day 0 the same way). So a 16th start gives 1st / 16th,
 *    and a 30th in a 31-day month gives 15th / 30th.
 *  - The monthly month-end rule OQ-X does not apply here.
 *  T4 2026-09-27: semi-monthly getNextSemiMonthly port. */
export function nextSemiMonthlyDate(firstPaymentDate: Date, currentDate: Date): Date {
  const first = new Date(utcDateOnly(firstPaymentDate));
  const current = new Date(utcDateOnly(currentDate));
  const firstDay = first.getUTCDate();
  const isEom = endOfUtcMonth(first).getTime() === first.getTime() || firstDay === 15;
  const day1 = firstDay >= 15 ? firstDay - 15 : firstDay;

  const currDay = current.getUTCDate();
  const currEom = endOfUtcMonth(current);

  if (current.getTime() === currEom.getTime() && isEom) {
    return new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth() + 1, 15));
  }
  if (currDay === 15 && isEom) {
    return currEom;
  }
  if (currDay > 15) {
    return new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth() + 1, day1));
  }
  const nextDate = addUtcDays(current, 15);
  return nextDate.getTime() > currEom.getTime() ? currEom : nextDate;
}

/** The First Payment Date the schedule starts from (B25, DEV-OQZ). Semi-monthly: a date that is
 *  neither the 15th nor its month's last day moves forward within the same UTC month to the
 *  15th (days 1-14) or to the month-end (days 16 to the day before month-end); the result is a
 *  new Date at UTC midnight. Every other frequency returns `first` itself. An invalid Date is
 *  returned unchanged (callers check validity first). */
export function effectiveFirstPaymentDate(frequency: PaymentFrequency, first: Date): Date {
  if (frequency !== 'semiMonthly' || Number.isNaN(first.getTime())) {
    return first;
  }
  const year = first.getUTCFullYear();
  const monthIndex = first.getUTCMonth();
  const day = first.getUTCDate();
  const last = daysInUtcMonth(year, monthIndex);
  const movedDay = day === 15 || day === last ? day : day < 15 ? 15 : last;
  return new Date(Date.UTC(year, monthIndex, movedDay));
}

/** periodDate for period index i (0-based) at the given payment frequency.
 *  Per BR-09, Accelerated Weekly is treated identically to Weekly and Accelerated
 *  Bi-weekly identically to Bi-weekly. Weekly, bi-weekly and monthly are indexed from the First Payment
 *  Date; semiMonthly is chained like the macro: index 0 is the First Payment Date (a
 *  new Date at its UTC midnight) and
 *  each later date is nextSemiMonthlyDate(firstPaymentDate, previousPaymentDate). */
export function periodDateFor(
  frequency: PaymentFrequency,
  firstPaymentDate: Date,
  index: number,
  previousPaymentDate: Date,
): Date {
  switch (frequency) {
    case 'monthly':
      return addMonthsClamped(firstPaymentDate, index);
    case 'weekly':
    case 'acceleratedWeekly':
      return addUtcDays(firstPaymentDate, index * 7);
    case 'biweekly':
    case 'acceleratedBiweekly':
      return addUtcDays(firstPaymentDate, index * 14);
    case 'semiMonthly':
      return index === 0 ? new Date(utcDateOnly(firstPaymentDate)) : nextSemiMonthlyDate(firstPaymentDate, previousPaymentDate);
  }
}
