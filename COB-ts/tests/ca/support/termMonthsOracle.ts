/**
 * B34 (COB-architecture.md section 5 B34, revision 53; user decision DEC-B34-TERM, 2026-10-06): a test-only oracle for the
 * contract term rounded UP to whole months. QA-owned. Imports nothing from src/ (and nothing from termOracle.ts).
 *
 * Written from the RULE, with a different search than the implementation and than termOracle.refTerm: the rounded term is
 * the SMALLEST whole number of months m >= 0 whose stepped date from `from` is on or after `to` (both read as UTC calendar
 * dates). "Any leftover day counts as a full month; no leftover day, no rounding" is exactly that: the stepped date for m
 * either equals `to` (no leftover) or is the first one past it.
 *
 * Month stepper (own copy): month-end stays month-end (OQ-X); any other day keeps its number, clamped to the target month's
 * last day; always counted from `from` (never chained), so Jan 30 + 2 months is Mar 30.
 */
export interface Months { years: number; months: number }

const UTC_DAY = (d: Date): number => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());

function daysInMonth(year: number, monthIndex: number): number {
  // monthIndex may run past 11; normalise first.
  const y = year + Math.floor(monthIndex / 12);
  const m = ((monthIndex % 12) + 12) % 12;
  const table = [31, (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return table[m]!;
}

/** UTC-midnight timestamp of `from` stepped `n` whole months (n >= 0). */
export function stepMonths(from: Date, n: number): number {
  const y = from.getUTCFullYear();
  const m = from.getUTCMonth();
  const day = from.getUTCDate();
  const monthEnd = day === daysInMonth(y, m);
  const ty = y + Math.floor((m + n) / 12);
  const tm = (m + n) % 12;
  const last = daysInMonth(ty, tm);
  return Date.UTC(ty, tm, monthEnd ? last : Math.min(day, last));
}

/** The term from `from` to `to`, rounded up to whole months, split into years and months 0-11. Throws if `to` < `from`. */
export function roundedTermMonths(from: Date, to: Date): Months {
  const target = UTC_DAY(to);
  if (UTC_DAY(from) > target) throw new Error('oracle: from after to');
  let n = 0;
  while (stepMonths(from, n) < target) n += 1;
  return { years: Math.floor(n / 12), months: n % 12 };
}

/** Months as one count (12 * years + months). */
export const monthCount = (t: Months): number => 12 * t.years + t.months;

/** The page text of a whole-month term, typed from Q-B34-ZERO (zero parts left out; a zero term reads "0 months"). */
export function monthsText(t: Months): string {
  const p = (n: number, unit: string): string => `${n} ${unit}${n === 1 ? '' : 's'}`;
  if (t.years === 0) return p(t.months, 'month');
  return t.months === 0 ? p(t.years, 'year') : `${p(t.years, 'year')}, ${p(t.months, 'month')}`;
}
