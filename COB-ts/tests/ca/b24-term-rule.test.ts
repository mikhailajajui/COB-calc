/**
 * B24 engine half (COB-architecture.md section 5 B24, revision 31; DEV-OQP; user decisions 2026-09-30, COB-user-stories.md
 * section 7.5 "Contract term refinement"): the Contract term is a DERIVED RESULT, the time from the first row of the
 * calculated schedule to its last row, as years, months and leftover days.
 *
 *   T1  B24-R1 the month / day split `termBetween(from, to)` in calendar.ts: the architect's table (fixture
 *       b24_term_vectors.json), the throws, the time-of-day row, and an independent oracle (support/termOracle.ts,
 *       confirmed on the table first) over a grid.
 *   T2  B24-R1 properties P1-P4 (grid), P5 (a monthly schedule of N rows is N-1 months and 0 days), P6 (time of day).
 *   T3  B24-R2 / R3 `contractTerm(result)` from the first row to the last row (never the typed First Payment Date when
 *       they differ, never the start date, never the End Date); barrels; the empty schedule.
 *   T4  B24-R4 termYears / termMonths are never read and never validated: any value gives a result JSON-identical to
 *       the input without them, and collectInputIssues has no term issue. The B13 zero-day COB-rate check is unchanged.
 *
 * Functions that B24 adds are read at call time from namespace imports (so each test fails on its own while the code is
 * missing, and `typecheck:tests` stays clean). This file is in `test:tz` (the rule reads UTC calendar dates).
 * sr-dev must not edit these assertions or the fixture.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as ca from '../../src/ca/index.js';
import * as root from '../../src/index.js';
import * as cobModule from '../../src/ca/cobCanada.js';
import * as calendar from '../../src/ca/calendar.js';
import type { CobCanadaInput, CobCanadaResult } from '../../src/ca/index.js';
import { ROOT } from '../architecture/support.js';
import { asInput, isoDay, utcDate } from './support/builders.js';
import { loadFixture } from './support/fixtures.js';
import { refTerm } from './support/termOracle.js';
import type { Term } from './support/termOracle.js';

const d = utcDate;

type TermBetween = (from: Date, to: Date) => Term;
type ContractTermFn = (result: { amortizationSchedule: { date: Date }[] }) => Term;

const termBetween: TermBetween = (from, to) => {
  const fn = (calendar as unknown as { termBetween?: TermBetween }).termBetween;
  if (typeof fn !== 'function') throw new Error('B24: src/ca/calendar.ts does not export termBetween yet');
  return fn(from, to);
};
const contractTermOf = (mod: object): ContractTermFn => {
  const fn = (mod as { contractTerm?: ContractTermFn }).contractTerm;
  if (typeof fn !== 'function') throw new Error('B24: contractTerm is not exported yet');
  return fn;
};
const contractTerm: ContractTermFn = (r) => contractTermOf(ca)(r);

interface Vectors { rows: { name: string; from: string; to: string; years: number; months: number; days: number }[] }
const VECTORS = loadFixture<Vectors>('b24_term_vectors.json');
const T = (years: number, months: number, days: number): Term => ({ years, months, days });

// ---------------------------------------------------------------------------------------------------------------
// T1 the R1 table, the throws, the time of day, the oracle
// ---------------------------------------------------------------------------------------------------------------
describe('B24-T1 termBetween (B24-R1): the architect\'s table, exact values', () => {
  it('the fixture holds the 27 table rows (table is not silently shortened)', () => {
    expect(VECTORS.rows).toHaveLength(27);
  });

  it.each(VECTORS.rows.map((r) => [`${r.name}: ${r.from} -> ${r.to}`, r] as const))('%s', (_n, r) => {
    expect(termBetween(d(r.from), d(r.to))).toEqual(T(r.years, r.months, r.days));
  });

  it('the result has exactly the keys years, months, days (non-negative integers)', () => {
    const t = termBetween(d('2026-03-23'), d('2029-03-12'));
    expect(Object.keys(t).sort()).toEqual(['days', 'months', 'years']);
    for (const v of Object.values(t)) expect(Number.isInteger(v) && v >= 0).toBe(true);
  });

  it('a from date after the to date throws RangeError "from must be on or before to"', () => {
    expect(() => termBetween(d('2026-03-06'), d('2026-03-05'))).toThrow(RangeError);
    expect(() => termBetween(d('2026-03-06'), d('2026-03-05'))).toThrow(/from must be on or before to/);
  });

  it('an invalid Date (either side) throws RangeError "from/to must be valid Dates"', () => {
    expect(() => termBetween(new Date(NaN), d('2026-03-05'))).toThrow(RangeError);
    expect(() => termBetween(d('2026-03-05'), new Date(NaN))).toThrow(RangeError);
    expect(() => termBetween(new Date(NaN), d('2026-03-05'))).toThrow(/from\/to must be valid Dates/);
  });

  it('time of day is dropped: 23:59:59.999Z and 00:00:00.001Z give the answer of the same calendar dates', () => {
    expect(termBetween(new Date('2026-01-31T23:59:59.999Z'), new Date('2026-02-28T00:00:00.001Z'))).toEqual(T(0, 1, 0));
    expect(termBetween(new Date('2026-03-05T12:00:00Z'), new Date('2026-03-05T01:00:00Z'))).toEqual(T(0, 0, 0)); // same day, to earlier in the day
  });
});

describe('B24-T1b the independent oracle (support/termOracle.ts) reproduces the table, then the grid agrees with termBetween', () => {
  it('oracle check: refTerm reproduces all 27 table rows (trust gate for the sweep below)', () => {
    for (const r of VECTORS.rows) expect(refTerm(d(r.from), d(r.to)), r.name).toEqual(T(r.years, r.months, r.days));
  });

  it('termBetween equals the oracle over 731 start days x 120 end offsets (87,720 cases, ends every 7th day to about 2.3 years)', () => {
    const start = Date.UTC(2024, 0, 1);
    let n = 0;
    for (let i = 0; i < 731; i++) {
      const from = new Date(start + i * 86_400_000);
      for (let k = 0; k < 120; k++) {
        const to = new Date(from.getTime() + k * 7 * 86_400_000);
        const got = termBetween(from, to);
        const want = refTerm(from, to);
        if (got.years !== want.years || got.months !== want.months || got.days !== want.days) {
          expect({ from: isoDay(from), to: isoDay(to), got }, 'first mismatch').toEqual({ from: isoDay(from), to: isoDay(to), got: want });
        }
        n++;
      }
    }
    expect(n).toBe(87_720);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// T2 properties
// ---------------------------------------------------------------------------------------------------------------
describe('B24-T2 properties P1-P6 of termBetween (B24-R1)', () => {
  const grid: [Date, Date][] = [];
  const s0 = Date.UTC(2024, 0, 1);
  for (let i = 0; i < 800; i++) {
    const from = new Date(s0 + i * 86_400_000);
    for (let k = 0; k < 300; k++) grid.push([from, new Date(from.getTime() + k * 3 * 86_400_000)]);
  }

  it('P1 + P2 + P3: anchor + days = to; one more month overshoots; months in [0, 11], days in [0, 30] (240,000 cases)', () => {
    let bad: string | null = null;
    let maxDays = 0;
    const addM = (calendar as unknown as { addMonthsClamped: (x: Date, m: number) => Date }).addMonthsClamped;
    for (const [from, to] of grid) {
      const t = termBetween(from, to);
      const m = t.years * 12 + t.months;
      const anchor = addM(from, m);
      const p1 = anchor.getTime() + t.days * 86_400_000 === to.getTime();
      const p2 = addM(from, m + 1).getTime() > to.getTime();
      const p3 = t.months >= 0 && t.months <= 11 && t.days >= 0 && t.days <= 30 && t.years >= 0;
      maxDays = Math.max(maxDays, t.days);
      if (!(p1 && p2 && p3)) {
        bad = `${isoDay(from)} -> ${isoDay(to)}: ${JSON.stringify(t)} p1=${p1} p2=${p2} p3=${p3}`;
        break;
      }
    }
    expect(bad).toBeNull();
    expect(maxDays).toBe(30); // non-vacuity: the grid reaches the largest day count
    expect(grid).toHaveLength(240_000);
  });

  it('P4: for a fixed start, (months in total, days) never decreases as the end date grows (800 starts x 300 ends)', () => {
    let bad: string | null = null;
    for (let i = 0; i < grid.length && !bad; i += 300) {
      let prev: [number, number] = [-1, -1];
      for (let k = 0; k < 300; k++) {
        const [from, to] = grid[i + k]!;
        const t = termBetween(from, to);
        const cur: [number, number] = [t.years * 12 + t.months, t.days];
        if (cur[0] < prev[0] || (cur[0] === prev[0] && cur[1] < prev[1])) bad = `${isoDay(from)} -> ${isoDay(to)}`;
        prev = cur;
      }
    }
    expect(bad).toBeNull();
  });

  it.each([1, 2, 13, 36, 60])('P5: a monthly schedule of %i rows is exactly N-1 months and 0 days, for every first date in 2024-2029 (2,200 starts)', (N) => {
    const period = calendar.periodDateFor as unknown as (f: string, first: Date, i: number, prev: Date) => Date;
    let bad: string | null = null;
    for (let i = 0; i < 2200 && !bad; i++) {
      const first = new Date(Date.UTC(2024, 0, 1 + i));
      const last = period('monthly', first, N - 1, first);
      const t = termBetween(first, last);
      if (t.years * 12 + t.months !== N - 1 || t.days !== 0) bad = `${isoDay(first)} N=${N}: ${JSON.stringify(t)}`;
    }
    expect(bad).toBeNull();
  });

  it('P6: the answer does not depend on the time of day of either date', () => {
    for (const [from, to] of grid.filter((_, i) => i % 97 === 0)) {
      const plain = termBetween(from, to);
      const shifted = termBetween(new Date(from.getTime() + 23 * 3_600_000 + 59 * 60_000), new Date(to.getTime() + 3_600_000));
      expect(shifted).toEqual(plain);
    }
  });
});

// ---------------------------------------------------------------------------------------------------------------
// T3 contractTerm(result)
// ---------------------------------------------------------------------------------------------------------------
const BASE = {
  flow: 'newMortgageOrLoan',
  productType: 'mortgage',
  rateType: 'variable',
  loanAmount: 250000,
  contractRatePercent: 5.19,
  paymentFrequency: 'monthly',
  paymentAmount: 1300,
  fees: { fees: [] },
  disbursalDate: d('2027-01-01'),
  firstPaymentDate: d('2027-02-01'),
  endDate: d('2029-06-01'),
};
const make = (o: Record<string, unknown> = {}): CobCanadaInput => asInput({ ...BASE, ...o });
const run = (o: Record<string, unknown> = {}): CobCanadaResult => ca.calculateCobCanada(make(o));

interface CaptureRaw { scenarios: { id: string; raw: Record<string, string> }[] }
const CAPTURE = loadFixture<CaptureRaw>('a10_ui_capture_v1.json');
const captured = async (id: string): Promise<CobCanadaResult> => {
  const view = (await import('../../ui/ca-view.js')) as unknown as {
    toInput: (raw: unknown, ctx: unknown) => CobCanadaInput;
  };
  const raw = CAPTURE.scenarios.find((s) => s.id === id)!.raw;
  const spec = ca.FLOWS[raw['flow'] as ca.CobFlow];
  const ctx = { spec, semiAnnual: ca.requiresSemiAnnualDate(raw['productType'] as ca.ProductType, raw['rateType'] as ca.RateType), switches: { financedOption: false, acceleratedFrequencies: false, contractDateField: false } };
  return ca.calculateCobCanada(view.toInput(raw, ctx));
};

describe('B24-T3 contractTerm(result): first row to last row (B24-R2, R3)', () => {
  // [scenario, first row, last row, term]: the four capture scenarios, architect-measured (R1 table).
  it.each([
    ['REF-01', '2026-03-23', '2029-03-12', T(2, 11, 17)],
    ['S1_fees', '2026-03-23', '2029-03-12', T(2, 11, 17)],
    ['RENEWAL', '2026-05-01', '2028-10-01', T(2, 5, 0)],
    ['VRPC_zero_accrued', '2026-06-26', '2031-06-06', T(4, 11, 11)],
  ] as const)('%s: rows %s .. %s give %j (not measured from the start date, not to the End Date)', async (id, first, last, want) => {
    const r = await captured(id);
    const rows = r.amortizationSchedule;
    expect(isoDay(rows[0]!.date)).toBe(first);
    expect(isoDay(rows[rows.length - 1]!.date)).toBe(last);
    expect(contractTerm(r)).toEqual(want);
  });

  it('REF-01 is 2 years, 11 months, 17 days and NOT the 2, 11, 23 of the Disbursal date or the 2, 11, 22 of the End Date (MUT-3 / MUT-4)', async () => {
    const r = await captured('REF-01');
    expect(contractTerm(r)).not.toEqual(T(2, 11, 23));
    expect(contractTerm(r)).not.toEqual(T(2, 11, 22));
  });

  it('REF-01: "Term in days" is unchanged (Q-CT-DAYS): daysBetween(Disbursal 2026-03-17, last row 2029-03-12) = 1091', async () => {
    const r = await captured('REF-01');
    expect(r.termDays).toBe(1091);
  });

  it('a payoff before the End Date: the term runs to the last row, which is earlier than the End Date', () => {
    const r = run({ loanAmount: 10000, paymentAmount: 2000, endDate: d('2030-01-01') });
    const rows = r.amortizationSchedule;
    const lastRow = rows[rows.length - 1]!.date;
    expect(lastRow.getTime()).toBeLessThan(d('2030-01-01').getTime());
    expect(rows[rows.length - 1]!.closingBalance).toBe(0);
    // 6 monthly rows from 2027-02-01 (10,000 at 5.19% repaid by 2,000 payments): last row 2027-07-01, 5 months.
    expect(rows).toHaveLength(6);
    expect(isoDay(lastRow)).toBe('2027-07-01');
    expect(contractTerm(r)).toEqual(T(0, 5, 0));
    expect(contractTerm(r)).not.toEqual(refTerm(d('2027-02-01'), d('2030-01-01'))); // would be 2, 11, 0 against the End Date
  });

  it('a contract under one month is allowed (Q-TERM-SHORT): two weekly rows give 0 years, 0 months, 7 days', () => {
    const r = run({ paymentFrequency: 'weekly', paymentAmount: 300, firstPaymentDate: d('2027-03-23'), endDate: d('2027-03-31') });
    expect(r.amortizationSchedule.map((x) => isoDay(x.date))).toEqual(['2027-03-23', '2027-03-30']);
    expect(contractTerm(r)).toEqual(T(0, 0, 7));
  });

  it('a one-row schedule is allowed and reads 0 years, 0 months, 0 days', () => {
    const r = run({ disbursalDate: d('2027-01-01'), firstPaymentDate: d('2027-01-01'), endDate: d('2027-01-02') });
    expect(r.amortizationSchedule).toHaveLength(1);
    expect(contractTerm(r)).toEqual(T(0, 0, 0));
  });

  it('a one-row schedule with any fee is still decided by the B13 zero-day rule (unchanged message)', () => {
    const fee = { name: 'F', amount: 2000, financed: true, includedInCob: true };
    const call = () => run({ fees: { fees: [fee] }, disbursalDate: d('2027-01-01'), firstPaymentDate: d('2027-01-01'), endDate: d('2027-01-02') });
    expect(call).toThrow(RangeError);
    expect(call).toThrow(/COB-rate term is 0 days/);
    expect(call).toThrow(/disbursalDate/);
  });

  it('semi-monthly: the term is row 0 to the last row (the dates of the schedule), equal to the oracle', () => {
    const r = run({ paymentFrequency: 'semiMonthly', paymentAmount: 700, firstPaymentDate: d('2027-01-15'), endDate: d('2027-06-20') });
    const rows = r.amortizationSchedule.map((x) => isoDay(x.date));
    expect(rows[0]).toBe('2027-01-15');
    expect(rows[rows.length - 1]).toBe('2027-06-15');
    expect(contractTerm(r)).toEqual(T(0, 5, 0));
    expect(contractTerm(r)).toEqual(refTerm(r.amortizationSchedule[0]!.date, r.amortizationSchedule[rows.length - 1]!.date));
  });

  it('weekly and bi-weekly: the term equals the oracle on the schedule\'s own first and last dates', () => {
    for (const [f, amount] of [['weekly', 300], ['biweekly', 600], ['acceleratedWeekly', 300], ['acceleratedBiweekly', 600]] as const) {
      const r = run({ paymentFrequency: f, paymentAmount: amount, firstPaymentDate: d('2027-03-01'), endDate: d('2028-09-01') });
      const rows = r.amortizationSchedule;
      expect(contractTerm(r), f).toEqual(refTerm(rows[0]!.date, rows[rows.length - 1]!.date));
    }
  });

  it('reads only the first and last row date (a minimal Pick<CobCanadaResult, "amortizationSchedule"> is enough; times of day are dropped)', () => {
    const rows = [{ date: new Date('2026-01-31T18:00:00Z') }, { date: new Date('2026-06-01T00:00:00Z') }, { date: new Date('2026-02-28T03:00:00Z') }];
    // middle rows and their order do not matter; first = 2026-01-31, last = 2026-02-28 (a month-end to month-end month)
    expect(contractTerm({ amortizationSchedule: rows })).toEqual(T(0, 1, 0));
  });

  it('an empty schedule throws RangeError (the engine never returns one)', () => {
    expect(() => contractTerm({ amortizationSchedule: [] })).toThrow(RangeError);
  });

  it('B24-R3: contractTerm is exported by cobCanada.ts and by both barrels as the same function', () => {
    const fn = (cobModule as unknown as { contractTerm?: unknown }).contractTerm;
    expect(typeof fn).toBe('function');
    expect((ca as unknown as { contractTerm?: unknown }).contractTerm).toBe(fn);
    expect((root as unknown as { contractTerm?: unknown }).contractTerm).toBe(fn);
  });

  it('B24-R3: termBetween is NOT on either barrel (it stays internal to src/ca)', () => {
    expect('termBetween' in ca).toBe(false);
    expect('termBetween' in root).toBe(false);
  });

  it('the result of calculateCobCanada gains no term field (goldens pin JSON.stringify of the result)', () => {
    const r = run();
    expect(Object.keys(r).some((k) => /term(Years|Months|Text)|contractTerm/i.test(k))).toBe(false);
    expect(Object.keys(r.amortizationSchedule[0]!).some((k) => /term/i.test(k))).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// T4 termYears / termMonths are never read and never validated
// ---------------------------------------------------------------------------------------------------------------
const FLOW_INPUTS: [string, Record<string, unknown>][] = [
  ['newMortgageOrLoan', {}],
  ['renewal', { flow: 'renewal', disbursalDate: undefined, renewalDate: d('2027-01-15'), accruedInterest: 0 }],
  ['paymentChange', { flow: 'paymentChange', disbursalDate: undefined, renewalDate: d('2027-01-15'), accruedInterest: 0 }],
  ['variableRatePaymentChange', { flow: 'variableRatePaymentChange', disbursalDate: undefined, renewalDate: d('2027-01-15'), accruedInterest: 0 }],
];
const BAD_TERMS: [string, Record<string, unknown>][] = [
  ['NaN years', { termYears: NaN, termMonths: 0 }],
  ['negative years', { termYears: -1, termMonths: 0 }],
  ['fractional years', { termYears: 1.5, termMonths: 0 }],
  ['12 months', { termYears: 1, termMonths: 12 }],
  ['negative months', { termYears: 1, termMonths: -3 }],
  ['0 and 0', { termYears: 0, termMonths: 0 }],
  ['numeric strings', { termYears: '3', termMonths: '0' }],
  ['Infinity', { termYears: Infinity, termMonths: -Infinity }],
  ['null', { termYears: null, termMonths: null }],
  ['undefined', { termYears: undefined, termMonths: undefined }],
  ['a Symbol', { termYears: Symbol('y'), termMonths: Symbol('m') }],
  ['a huge number', { termYears: 1e9, termMonths: 11 }],
  ['only years', { termYears: 7 }],
  ['only months', { termMonths: 7 }],
];

describe('B24-T4 termYears / termMonths are optional, ignored and never validated (B24-R4, B24-INV-ignored)', () => {
  it.each(FLOW_INPUTS)('%s: an input with NO term fields is accepted and calculates', (_f, over) => {
    expect(() => ca.calculateCobCanada(make(over))).not.toThrow();
  });

  for (const [flowName, over] of FLOW_INPUTS) {
    it.each(BAD_TERMS)(`${flowName} with %s: accepted, result JSON-identical to the input without the term fields, no term issue`, (_n, term) => {
      const without = ca.calculateCobCanada(make(over));
      const withTerm = make({ ...over, ...term });
      expect(JSON.stringify(ca.calculateCobCanada(withTerm))).toBe(JSON.stringify(without));
      const issues = ca.collectInputIssues(withTerm);
      expect(issues.filter((i) => /term/i.test(i.field) || /term(Years|Months)/.test(i.message))).toEqual([]);
      expect(issues).toEqual([]);
    });
  }

  it('the term fields do not change the schedule: a huge termYears does not lengthen it, termYears 0 does not shorten it (MUT-8)', () => {
    const a = run({ termYears: 50, termMonths: 11 });
    const b = run({ termYears: 0, termMonths: 1 });
    expect(a.amortizationSchedule.length).toBe(run().amortizationSchedule.length);
    expect(JSON.stringify(b)).toBe(JSON.stringify(run()));
  });

  it('types.ts: termYears and termMonths are optional and carry a @deprecated JSDoc tag (B24-R4, Q-CT-API)', () => {
    const src = readFileSync(`${ROOT}/src/ca/types.ts`, 'utf8');
    for (const field of ['termYears', 'termMonths']) {
      const m = new RegExp(`/\\*\\*((?:(?!\\*/)[\\s\\S])*)\\*/\\s*${field}(\\??):\\s*number;`).exec(src);
      expect(m, `${field} declaration with a JSDoc block`).not.toBeNull();
      expect(m![2], `${field} is optional`).toBe('?');
      expect(m![1], `${field} JSDoc`).toContain('@deprecated');
    }
  });

  it('End Date stays mandatory: with valid term fields and no endDate the engine still rejects, naming endDate', () => {
    const x = { ...make({ termYears: 3, termMonths: 0 }) } as unknown as Record<string, unknown>;
    delete x['endDate'];
    expect(() => ca.calculateCobCanada(asInput(x))).toThrow(RangeError);
    expect(() => ca.calculateCobCanada(asInput(x))).toThrow(/endDate/);
  });

  it('the remaining checks keep their order: a bad loanAmount is still the first issue when a bad term is also present', () => {
    const issues = ca.collectInputIssues(make({ loanAmount: 0, termYears: -1, termMonths: 99 }));
    expect(issues[0]).toEqual({ field: 'loanAmount', message: 'loanAmount must be > 0, got 0' });
    expect(issues).toHaveLength(1);
  });
});
