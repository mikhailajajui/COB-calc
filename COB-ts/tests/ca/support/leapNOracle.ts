/**
 * B37 (COB-architecture.md §5 B37, revision 56 + addendum revision 57; user decision DEC-B37-LEAP-N): QA's own oracle for
 * the leap-aware payments per year n of equation 1, and a small shipped-branch schedule oracle used to confirm the B37
 * vectors. QA-owned, test-only. Imports NOTHING from src/: calendar arithmetic is done on ISO day strings with a
 * days-from-civil count and its own 4/100/400 leap rule, so it does not share the engine's Date code.
 *
 * Rule (COB-user-stories.md US-08, DEC-B37-LEAP-N): n = (D / P) / Y, D = actual days from the flow's start date to the
 * End date, P = 7 or 14, Y = sum over the calendar years the span touches of (the span's days in that year / days in that
 * year). Evaluated left to right, Y summed chronologically from 0 (brief B37-D5: no snapping, no reordering).
 *
 * The schedule oracle covers only what the B37 vectors need: the shipped B19 branch (UNPAID_INTEREST_CAPITALISED false,
 * DEV-OQL: unpaid interest is one bucket outside the balance; IN-11 due from payment 1), the 7/14-day frequencies (rows at
 * first + k * P days, inclusive of the End date), financed fees inside the balance and recovered after interest, cash
 * fees only in C, equation 7's no-fee short-circuit. Trust check (b37-leap-aware-n.test.ts, B37-T0): at n = 52 / 26 it
 * reproduces the saved workbook's REF-01 and today's engine on the B37 vectors exactly.
 */

/** Days since 1970-01-01 of a proleptic Gregorian civil date (H. Hinnant's days_from_civil). */
export function civilDays(iso: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (m === null) throw new RangeError(`not a YYYY-MM-DD day: ${iso}`);
  let y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  y -= mo <= 2 ? 1 : 0;
  const era = Math.floor(y / 400);
  const yoe = y - era * 400;
  const doy = Math.floor((153 * (mo + (mo > 2 ? -3 : 9)) + 2) / 5) + d - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

/** Inverse of civilDays. */
export function civilIso(days: number): string {
  const z = days + 719468;
  const era = Math.floor(z / 146097);
  const doe = z - era * 146097;
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const d = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const mo = mp + (mp < 10 ? 3 : -9);
  const y = yoe + era * 400 + (mo <= 2 ? 1 : 0);
  return `${String(y).padStart(4, '0')}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

export function oracleIsLeap(year: number): boolean {
  if (year % 400 === 0) return true;
  if (year % 100 === 0) return false;
  return year % 4 === 0;
}

/** Y: the span [start, end) in leap-aware years, summed chronologically per calendar year from 0. */
export function oracleYears(startIso: string, endIso: string): number {
  const s = civilDays(startIso);
  const e = civilDays(endIso);
  if (s > e) throw new RangeError('start after end');
  let y = 0;
  let cursor = s;
  let year = Number(startIso.slice(0, 4));
  while (cursor < e) {
    const nextYearStart = civilDays(`${String(year + 1).padStart(4, '0')}-01-01`);
    const segEnd = Math.min(nextYearStart, e);
    y += (segEnd - cursor) / (oracleIsLeap(year) ? 366 : 365);
    cursor = segEnd;
    year += 1;
  }
  return y;
}

/** n = (D / P) / Y, left to right. */
export function oracleLeapN(periodDays: number, startIso: string, endIso: string): number {
  const d = civilDays(endIso) - civilDays(startIso);
  return d / periodDays / oracleYears(startIso, endIso);
}

/** Equation 1 at m = 2, in the workbook's operand order (annual / 100, / 2, ^(2 / n), - 1, x n). Decimal. */
export function oracleConvertedDecimal(contractRatePercent: number, n: number): number {
  return n * (Math.pow(1 + contractRatePercent / 100 / 2, 2 / n) - 1);
}

export const ORACLE_PERIOD_DAYS: Readonly<Record<string, 7 | 14 | null>> = Object.freeze({
  weekly: 7,
  acceleratedWeekly: 7,
  biweekly: 14,
  acceleratedBiweekly: 14,
  monthly: null,
  semiMonthly: null,
});

export const ORACLE_BASE_N: Readonly<Record<string, number>> = Object.freeze({
  monthly: 12,
  semiMonthly: 24,
  biweekly: 26,
  weekly: 52,
  acceleratedBiweekly: 26,
  acceleratedWeekly: 52,
});

/** The decided n for a (product, rate type, frequency, start, end) with the switch in `leapAware`. */
export function oracleN(
  productType: string,
  rateType: string,
  frequency: string,
  startIso: string | null,
  endIso: string | null,
  leapAware: boolean,
): number {
  const base = ORACLE_BASE_N[frequency];
  if (base === undefined) throw new RangeError(`unknown frequency ${frequency}`);
  const p = ORACLE_PERIOD_DAYS[frequency] ?? null;
  const converted = productType === 'mortgage' && rateType === 'fixed';
  if (!leapAware || p === null || !converted || startIso === null || endIso === null) return base;
  if (!(civilDays(endIso) - civilDays(startIso) > 0)) return base;
  return oracleLeapN(p, startIso, endIso);
}

export interface OracleCase {
  flow: 'newMortgageOrLoan' | 'renewal' | 'paymentChange' | 'variableRatePaymentChange';
  productType: 'mortgage' | 'personalLoan';
  rateType: 'fixed' | 'variable';
  frequency: 'weekly' | 'acceleratedWeekly' | 'biweekly' | 'acceleratedBiweekly';
  loanAmount: number;
  contractRatePercent: number;
  paymentAmount: number;
  accruedInterest: number;
  start: string;
  first: string;
  end: string;
  financedFees: number[];
  cashFees: number[];
}

export interface OracleRow {
  date: string;
  openingBalance: number;
  periodInterest: number;
  interestPaid: number;
  principalPortion: number;
  closingBalance: number;
}

export interface OracleResult {
  n: number;
  calculatedRatePercent: number;
  rows: OracleRow[];
  numberOfPayments: number;
  totalInterest: number;
  principalPayment: number;
  endingBalance: number;
  termDays: number;
  cobAmount: number;
  cobRatePercent: number;
}

/** The shipped-branch schedule for a 7/14-day frequency at the given switch state. */
export function oracleSchedule(c: OracleCase, leapAware: boolean): OracleResult {
  const p = ORACLE_PERIOD_DAYS[c.frequency];
  if (p === null || p === undefined) throw new RangeError('oracleSchedule covers the 7/14-day frequencies only');
  const n = oracleN(c.productType, c.rateType, c.frequency, c.start, c.end, leapAware);
  const converted = c.productType === 'mortgage' && c.rateType === 'fixed';
  const decimal = converted ? oracleConvertedDecimal(c.contractRatePercent, n) : c.contractRatePercent / 100;
  const percent = converted ? decimal * 100 : c.contractRatePercent;
  const fin = c.financedFees.reduce((s, x) => s + x, 0);
  const cash = c.cashFees.reduce((s, x) => s + x, 0);
  const startDay = civilDays(c.start);
  const firstDay = civilDays(c.first);
  const endDay = civilDays(c.end);

  const rows: OracleRow[] = [];
  let open = c.loanAmount;
  let feesLeft = fin;
  let prior = c.start;
  let bucket = c.flow === 'newMortgageOrLoan' ? 0 : c.accruedInterest;
  let in11Owed = bucket;
  for (let k = 0; ; k += 1) {
    const day = firstDay + k * p;
    if (day > endDay) break;
    const date = civilIso(day);
    const interest = open * decimal * oracleYears(prior, date);
    const due = interest + bucket;
    const paidInterest = Math.min(c.paymentAmount, due);
    const afterInterest = c.paymentAmount - paidInterest;
    const paidFees = Math.min(afterInterest, feesLeft);
    const afterFees = afterInterest - paidFees;
    const outstanding = open - feesLeft;
    const cap = outstanding > 0 ? outstanding : 0;
    const principal = cap < afterFees ? cap : afterFees;
    const closing = open - paidFees - principal;
    in11Owed = in11Owed - Math.min(paidInterest, in11Owed);
    bucket = due - paidInterest;
    feesLeft = feesLeft - paidFees;
    rows.push({ date, openingBalance: open, periodInterest: interest, interestPaid: paidInterest, principalPortion: principal, closingBalance: closing });
    open = closing;
    prior = date;
    if (closing <= 0) break;
  }
  const last = rows[rows.length - 1];
  if (last === undefined) throw new RangeError('no rows');
  const totalInterest = rows.reduce((s, r) => s + r.interestPaid, 0) + (bucket - in11Owed);
  const principalPayment = rows.reduce((s, r) => s + r.principalPortion, 0);
  const cobAmount = totalInterest + fin + cash;
  const termDays = civilDays(last.date) - startDay;
  const avgOpen = rows.reduce((s, r) => s + r.openingBalance, 0) / rows.length;
  const cobRatePercent = fin + cash === 0 ? decimal * 100 : (cobAmount / ((termDays / 365) * avgOpen)) * 100;
  return {
    n,
    calculatedRatePercent: percent,
    rows,
    numberOfPayments: rows.length,
    totalInterest,
    principalPayment,
    endingBalance: last.closingBalance,
    termDays,
    cobAmount,
    cobRatePercent,
  };
}
