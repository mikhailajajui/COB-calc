/**
 * B25 engine half (COB-architecture.md section 5 B25, revision 39; DEV-OQZ; stakeholder decision 10 / FB-2b; user decisions
 * 2026-10-01): a semi-monthly First Payment Date that is neither the 15th nor a month-end is MOVED FORWARD to the next 15th /
 * month-end, in `effectiveFirstPaymentDate(frequency, first)` (calendar.ts). The schedule and the Contract term start at the
 * moved date; validation compares the End Date and the start date with the moved date; the result type gets no new field.
 *
 *   T1  B25-R1 / R2 the move function: the 12 vectors, the 731-date oracle sweep, the other frequencies, time of day, purity.
 *   T2  B25-R3 the engine schedule: oracle date lists, row 1, B25-INV-equiv, and the pre-B25 snapshot for what must not change.
 *   T3  B25-R7 typed versus moved Contract term (the B24 gap). Re-baselined by B32 (DEC-B32-TERM): the term runs from the
 *       start date, so the move no longer changes it (supersedes Q-CT-B25).
 *   T4  B25-R5 validation (moved date; interim End wording; start between typed and moved is accepted).
 *   T5  purity (frozen input, called twice) and the F3 source guard.
 *
 * Oracle: fixtures/generate_b25_semimonthly_move_vectors.py (rule R1 written independently; dates after the move from a
 * line-for-line port of the macro getNextSemiMonthly, trust-checked against the older T4 / D-01 oracle). Snapshot:
 * fixtures/b25_pre_snapshot.json, taken on the pre-B25 engine. The function that B25 adds is read at call time from a
 * namespace import, so every test fails on its own while the code is missing. In `test:tz` (the rule reads UTC dates).
 * sr-dev must not edit these assertions or the fixtures.
 */
import { describe, expect, it } from 'vitest';
import * as ca from '../../src/ca/index.js';
import * as root from '../../src/index.js';
import * as calendar from '../../src/ca/calendar.js';
import { calculateCobCanada, collectInputIssues, contractTerm } from '../../src/ca/index.js';
import type { CobCanadaInput, PaymentFrequency } from '../../src/ca/index.js';
import { periodDateFor } from '../../src/ca/calendar.js';
import { SRC_CA, read, stripComments } from '../architecture/support.js';
import { asInput, isoDay, utcDate } from './support/builders.js';
import { loadFixture } from './support/fixtures.js';
import { LEAP_OFF, SHIPPED, calculateWith } from './support/switches.js';
// @ts-ignore -- plain .mjs shared with the snapshot generator (no .d.ts).
import * as snap from './fixtures/generate_b25_pre_snapshot.mjs';

const d = utcDate;
const iso = isoDay;
const DAY = 86_400_000;

type Eff = (frequency: PaymentFrequency, first: Date) => Date;
const eff: Eff = (frequency, first) => {
  const fn = (calendar as unknown as { effectiveFirstPaymentDate?: Eff }).effectiveFirstPaymentDate;
  if (typeof fn !== 'function') throw new Error('B25: src/ca/calendar.ts does not export effectiveFirstPaymentDate yet');
  return fn(frequency, first);
};

interface Oracle {
  moves: { typed: string; moved: string }[];
  sweep: { typed: string; moved: string; end: string; dates: string[]; datesTypedEnd: string[] }[];
}
const ORACLE = loadFixture<Oracle>('b25_semimonthly_move_vectors.json');
const WORKBOOK_SWEEP = loadFixture<{ sweep: { first: string; dates: string[] }[] }>('ca_semimonthly_vectors.json');
const SNAPSHOT = loadFixture<{ hashes: Record<string, string> }>('b25_pre_snapshot.json');

// ---------------------------------------------------------------------------------------------------------------
// T1 the move function
// ---------------------------------------------------------------------------------------------------------------
describe('B25-T1 effectiveFirstPaymentDate (B25-R1 / R2): the 12 vectors of the brief', () => {
  const VECTORS: [string, string][] = [
    ['2027-01-10', '2027-01-15'],
    ['2027-01-14', '2027-01-15'],
    ['2027-01-15', '2027-01-15'],
    ['2027-01-16', '2027-01-31'],
    ['2027-01-30', '2027-01-31'],
    ['2027-01-31', '2027-01-31'],
    ['2027-02-27', '2027-02-28'],
    ['2027-02-28', '2027-02-28'],
    ['2028-02-16', '2028-02-29'],
    ['2028-02-28', '2028-02-29'], // not a month-end in a leap year
    ['2027-04-29', '2027-04-30'],
    ['2027-12-20', '2027-12-31'],
  ];
  it.each(VECTORS)('semiMonthly %s -> %s', (typed, moved) => {
    expect(eff('semiMonthly', d(typed)).toISOString()).toBe(`${moved}T00:00:00.000Z`);
  });

  it('known edge dates: the 1st, the 14th, the 15th, the 16th, the day before month-end, month-end, in every month length', () => {
    const E: [string, string][] = [
      ['2027-03-01', '2027-03-15'], ['2027-03-14', '2027-03-15'], ['2027-03-16', '2027-03-31'], ['2027-03-30', '2027-03-31'],
      ['2027-04-01', '2027-04-15'], ['2027-04-29', '2027-04-30'], ['2027-04-30', '2027-04-30'],
      ['2028-02-01', '2028-02-15'], ['2028-02-29', '2028-02-29'], ['2027-02-01', '2027-02-15'], ['2027-02-16', '2027-02-28'],
      ['2027-12-01', '2027-12-15'], ['2027-12-31', '2027-12-31'],
    ];
    for (const [typed, moved] of E) expect(iso(eff('semiMonthly', d(typed))), typed).toBe(moved);
  });
});

describe('B25-T1 effectiveFirstPaymentDate: all 731 dates 2027-01-01 .. 2028-12-31 against the oracle', () => {
  it('the oracle file covers 731 consecutive dates, 683 of them moved and 48 not (architect count, independent recount)', () => {
    expect(ORACLE.moves).toHaveLength(731);
    expect(ORACLE.moves[0]!.typed).toBe('2027-01-01');
    expect(ORACLE.moves.at(-1)!.typed).toBe('2028-12-31');
    expect(ORACLE.moves.filter((m) => m.typed !== m.moved)).toHaveLength(683);
  });

  it('the moved date equals the oracle for every date; never earlier than typed; same year and month', () => {
    const bad: string[] = [];
    for (const m of ORACLE.moves) {
      const got = eff('semiMonthly', d(m.typed));
      if (iso(got) !== m.moved) bad.push(`${m.typed}: ${iso(got)} vs ${m.moved}`);
      if (got.getTime() < d(m.typed).getTime()) bad.push(`${m.typed}: moved earlier`);
      if (iso(got).slice(0, 7) !== m.typed.slice(0, 7)) bad.push(`${m.typed}: month changed`);
    }
    expect(bad.slice(0, 5)).toEqual([]);
  });

  it('feeding the moved date to the schedule chain gives the macro dates (oracle) and the workbook sweep entry of the moved date', () => {
    const workbook = new Map(WORKBOOK_SWEEP.sweep.map((s) => [s.first, s.dates]));
    const bad: string[] = [];
    for (const s of ORACLE.sweep) {
      const first = eff('semiMonthly', d(s.typed));
      const got: string[] = [];
      let prev = first;
      for (let i = 0; i < 12; i += 1) {
        prev = periodDateFor('semiMonthly', first, i, prev);
        got.push(iso(prev));
      }
      if (got.join() !== s.dates.slice(0, 12).join()) bad.push(`${s.typed}: chain ${got.join()} vs oracle`);
      const wb = workbook.get(s.moved);
      if (wb === undefined || got.join() !== wb.slice(0, 12).join()) bad.push(`${s.typed}: differs from workbook sweep of ${s.moved}`);
    }
    expect(bad.slice(0, 5)).toEqual([]);
  });
});

describe('B25-T1 effectiveFirstPaymentDate: other frequencies, time of day, purity, invalid dates, barrels', () => {
  const OTHERS: PaymentFrequency[] = ['weekly', 'acceleratedWeekly', 'biweekly', 'acceleratedBiweekly', 'monthly'];

  it.each(OTHERS)('%s returns the very same Date object for dates the semi-monthly rule would move (MUT-10)', (f) => {
    for (const typed of ['2027-01-10', '2027-01-16', '2027-02-27', '2028-02-28', '2027-12-20']) {
      const x = d(typed);
      expect(eff(f, x)).toBe(x);
    }
  });

  it('a non-semi frequency keeps a time of day (nothing is read or rebuilt)', () => {
    const x = new Date('2027-01-10T15:30:00.000Z');
    expect(eff('monthly', x)).toBe(x);
    expect(eff('monthly', x).toISOString()).toBe('2027-01-10T15:30:00.000Z');
  });

  it('semi-monthly reads the UTC calendar date and returns UTC midnight (time of day dropped, MUT-12)', () => {
    expect(eff('semiMonthly', new Date('2027-01-10T15:30:00.000Z')).toISOString()).toBe('2027-01-15T00:00:00.000Z');
    expect(eff('semiMonthly', new Date('2027-01-16T00:00:00.001Z')).toISOString()).toBe('2027-01-31T00:00:00.000Z');
    expect(eff('semiMonthly', new Date('2027-01-31T23:59:59.999Z')).toISOString()).toBe('2027-01-31T00:00:00.000Z');
    expect(eff('semiMonthly', new Date('2027-01-15T12:00:00.000Z')).toISOString()).toBe('2027-01-15T00:00:00.000Z');
    expect(eff('semiMonthly', new Date('2027-02-28T00:00:01.000Z')).toISOString()).toBe('2027-02-28T00:00:00.000Z');
    expect(eff('semiMonthly', new Date('2028-02-28T23:00:00.000Z')).toISOString()).toBe('2028-02-29T00:00:00.000Z');
  });

  it('semi-monthly always returns a new Date (also when not moved), and never mutates its argument (MUT-13)', () => {
    for (const typed of ['2027-01-10', '2027-01-15', '2027-01-31']) {
      const x = new Date(`${typed}T09:00:00.000Z`);
      const before = x.getTime();
      const out = eff('semiMonthly', x);
      expect(out).not.toBe(x);
      expect(x.getTime()).toBe(before);
    }
  });

  it('an invalid Date comes back unchanged (callers check validity first)', () => {
    const bad = new Date(NaN);
    expect(eff('semiMonthly', bad)).toBe(bad);
    expect(eff('monthly', bad)).toBe(bad);
  });

  it('is not exported from the barrels (R2: the UI does not need it; F9 snapshot unchanged)', () => {
    expect(Object.keys(ca)).not.toContain('effectiveFirstPaymentDate');
    expect(Object.keys(root)).not.toContain('effectiveFirstPaymentDate');
  });
});

// ---------------------------------------------------------------------------------------------------------------
// T2 the engine schedule
// ---------------------------------------------------------------------------------------------------------------
describe('B25-T2 engine schedule: the schedule starts at the moved date (oracle date lists, 731 typed dates)', () => {
  const byMonth = new Map<string, Oracle['sweep']>();
  for (const s of ORACLE.sweep) byMonth.set(s.typed.slice(0, 7), [...(byMonth.get(s.typed.slice(0, 7)) ?? []), s]);

  for (const [month, cases] of byMonth) {
    it(`typed dates in ${month}: dates = oracle, row 1 = moved date, row 1 days = start -> moved, INV-equiv (typed = moved)`, () => {
      const bad: string[] = [];
      for (const s of cases) {
        const input = asInput(snap.snapInput(s.typed, 'semiMonthly', s.end));
        const r = calculateCobCanada(input);
        const got = r.amortizationSchedule.map((row) => iso(row.date));
        if (got.join() !== s.dates.join()) bad.push(`${s.typed}: dates differ (rows ${got.length} vs ${s.dates.length})`);
        const row1 = r.amortizationSchedule[0]!;
        if (iso(row1.date) !== s.moved) bad.push(`${s.typed}: row 1 ${iso(row1.date)} vs ${s.moved}`);
        const startMs = (input.disbursalDate as Date).getTime();
        const wantDays = Math.round((d(s.moved).getTime() - startMs) / DAY);
        if (row1.daysInPeriod !== wantDays) bad.push(`${s.typed}: row 1 days ${row1.daysInPeriod} vs ${wantDays}`);
        const movedInput = asInput({ ...input, firstPaymentDate: d(s.moved) });
        if (JSON.stringify(r) !== JSON.stringify(calculateCobCanada(movedInput))) bad.push(`${s.typed}: result differs from the moved-date call`);
      }
      expect(bad.slice(0, 5), `${bad.length} problems`).toEqual([]);
    });
  }

  it('B25-INV-equiv holds with the golden-style input too (renewal flow, fees, variable rate): typed 2027-01-10 = moved 2027-01-15', () => {
    const typed = asInput({
      flow: 'renewal', productType: 'mortgage', rateType: 'variable', loanAmount: 250000, contractRatePercent: 5.19, paymentAmount: 650,
      paymentFrequency: 'semiMonthly', firstPaymentDate: d('2027-01-10'), endDate: d('2029-01-10'), termYears: 2, termMonths: 0,
      renewalDate: d('2026-12-31'), accruedInterest: 850.25,
      fees: { fees: [{ name: 'F', amount: 2000, financed: true, includedInCob: true }, { name: 'C', amount: 400, financed: false, includedInCob: true }] },
    });
    expect(JSON.stringify(calculateCobCanada(typed))).toBe(
      JSON.stringify(calculateCobCanada(asInput({ ...typed, firstPaymentDate: d('2027-01-15') }))),
    );
  });
});

describe('B25-T2 what must NOT change: a pre-B25 snapshot (sha256 of JSON.stringify(result))', () => {
  it('the snapshot holds weekly / biweekly / monthly for 731 dates and 48 unmoved semi-monthly dates (2,241 hashes)', () => {
    expect(Object.keys(SNAPSHOT.hashes)).toHaveLength(2241);
    expect(Object.keys(SNAPSHOT.hashes).filter((k) => k.startsWith('semiMonthly|'))).toHaveLength(48);
  });

  for (const f of ['weekly', 'biweekly', 'monthly'] as const) {
    it(`${f}: every typed date 2027-01-01 .. 2028-12-31 gives the same JSON as before B25`, () => {
      const bad: string[] = [];
      for (const typed of snap.allTypedDates() as string[]) {
        // B37 (DEC-B37-LEAP-N): workbook converter (n = 52/26), switch off (the snapshot is the pre-B25 = pre-B37 engine's,
        // fixed mortgage; weekly / bi-weekly move with the leap switch on, monthly does not).
        const h = snap.sha16(JSON.stringify(calculateWith(asInput(snap.snapInput(typed, f, snap.addDaysIso(typed, 730))), SHIPPED, LEAP_OFF)));
        if (h !== SNAPSHOT.hashes[`${f}|${typed}`]) bad.push(typed);
      }
      expect(bad.slice(0, 5), `${bad.length} dates changed`).toEqual([]);
    });
  }

  it('semi-monthly with a typed 15th / month-end (48 dates): JSON identical to before B25', () => {
    const bad: string[] = [];
    for (const typed of (snap.allTypedDates() as string[]).filter((t) => snap.isUnmovedSemi(t))) {
      const h = snap.sha16(JSON.stringify(calculateCobCanada(asInput(snap.snapInput(typed, 'semiMonthly', snap.addDaysIso(typed, 730))))));
      if (h !== SNAPSHOT.hashes[`semiMonthly|${typed}`]) bad.push(typed);
    }
    expect(bad).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// T3 typed versus moved Contract term
// ---------------------------------------------------------------------------------------------------------------
// B32 (DEC-B32-TERM, 2026-10-05): superseding Q-CT-B25 (term from the moved date). The term now runs from the start date
// (here the Disbursal date 2027-01-01) to the last row, contractTerm(input, result); values from the B32 vectors table.
type ContractTerm2 = (input: unknown, result: unknown) => { years: number; months: number; days: number };
const contractTerm2: ContractTerm2 = (i, r) => (contractTerm as unknown as ContractTerm2)(i, r);
describe('B25-T3 Contract term runs from the start date; the move does not change it (B32, superseding Q-CT-B25)', () => {
  const inputOf = (typed: string, end: string, start = '2027-01-01', frequency: PaymentFrequency = 'semiMonthly') =>
    asInput({ ...snap.snapInput(typed, frequency, end), disbursalDate: d(start), semiAnnualCompoundingDate: d(start) });
  const run = (typed: string, end: string, start = '2027-01-01', frequency: PaymentFrequency = 'semiMonthly') => {
    const input = inputOf(typed, end, start, frequency);
    return { input, r: calculateCobCanada(input) };
  };

  it('typed 2027-01-10, start 2027-01-01, End 2029-01-15: row 1 2027-01-15, last row 2029-01-15, term 2 years 0 months 14 days', () => {
    const { input, r } = run('2027-01-10', '2029-01-15');
    expect(iso(r.amortizationSchedule[0]!.date)).toBe('2027-01-15');
    expect(iso(r.amortizationSchedule.at(-1)!.date)).toBe('2029-01-15');
    expect(contractTerm2(input, r)).toEqual({ years: 2, months: 0, days: 14 }); // B32 (DEC-B32-TERM): was 2, 0, 0 (moved date)
    // neither the moved date (2, 0, 0) nor the typed date (2, 0, 5) is the start any more
    expect(calendar.termBetween(d('2027-01-10'), r.amortizationSchedule.at(-1)!.date)).toEqual({ years: 2, months: 0, days: 5 });
    expect(contractTerm2(input, r)).not.toEqual({ years: 2, months: 0, days: 0 });
  });

  it('typed 2027-01-30, End 2028-01-31: term 1 year 0 months 30 days (B32; was 1, 0, 0 from the moved date)', () => {
    const { input, r } = run('2027-01-30', '2028-01-31');
    expect(iso(r.amortizationSchedule[0]!.date)).toBe('2027-01-31');
    expect(contractTerm2(input, r)).toEqual({ years: 1, months: 0, days: 30 });
    expect(calendar.termBetween(d('2027-01-30'), r.amortizationSchedule.at(-1)!.date)).toEqual({ years: 1, months: 0, days: 1 });
  });

  it('typed 2027-01-15 (not moved): the same 2 years 0 months 14 days as the moved case (the move does not change the term)', () => {
    const { input, r } = run('2027-01-15', '2029-01-15');
    expect(contractTerm2(input, r)).toEqual({ years: 2, months: 0, days: 14 }); // B32 (DEC-B32-TERM): was 2, 0, 0
    expect(calendar.termBetween(d('2027-01-15'), r.amortizationSchedule.at(-1)!.date)).toEqual({ years: 2, months: 0, days: 0 });
  });

  it('a monthly schedule of the same typed date is untouched: first row is the typed date; term 2 years 0 months 9 days', () => {
    const { input, r } = run('2027-01-10', '2029-01-10', '2027-01-01', 'monthly');
    expect(iso(r.amortizationSchedule[0]!.date)).toBe('2027-01-10');
    expect(contractTerm2(input, r)).toEqual({ years: 2, months: 0, days: 9 }); // B32 (DEC-B32-TERM): was 2, 0, 0
  });
});

// ---------------------------------------------------------------------------------------------------------------
// T4 validation
// ---------------------------------------------------------------------------------------------------------------
describe('B25-T4 validation compares the date-order checks with the MOVED date (R5)', () => {
  const MOVED_MSG = (moved: string) =>
    `endDate must be after firstPaymentDate (moved to ${moved} for semi-monthly payments; compared as UTC calendar dates)`;
  const UNMOVED_MSG = 'endDate must be after firstPaymentDate (compared as UTC calendar dates)';
  const mk = (over: Record<string, unknown>): CobCanadaInput =>
    asInput({ ...snap.snapInput('2027-01-16', 'semiMonthly', '2027-02-01'), disbursalDate: d('2027-01-06'), semiAnnualCompoundingDate: d('2027-01-06'), ...over });
  const throwsMessage = (input: CobCanadaInput): string | null => {
    try {
      calculateCobCanada(input);
      return null;
    } catch (e) {
      expect(e).toBeInstanceOf(RangeError);
      return (e as Error).message;
    }
  };

  it('typed 2027-01-16 (moved to 2027-01-31): End 2027-01-20 is rejected, naming the moved date', () => {
    expect(throwsMessage(mk({ endDate: d('2027-01-20') }))).toBe(MOVED_MSG('2027-01-31'));
  });
  it('End 2027-01-31 (equal to the moved date) is rejected: End must be AFTER', () => {
    expect(throwsMessage(mk({ endDate: d('2027-01-31') }))).toBe(MOVED_MSG('2027-01-31'));
  });
  it('End 2027-02-01 is accepted, and the schedule is the single row of 2027-01-31', () => {
    const r = calculateCobCanada(mk({ endDate: d('2027-02-01') }));
    expect(r.amortizationSchedule.map((row) => iso(row.date))).toEqual(['2027-01-31']);
  });
  it('typed 2027-01-10 (moved to 2027-01-15): End 2027-01-12 rejected; End 2027-01-16 accepted', () => {
    const base = snap.snapInput('2027-01-10', 'semiMonthly', '2027-01-12');
    expect(throwsMessage(asInput(base))).toBe(MOVED_MSG('2027-01-15'));
    expect(throwsMessage(asInput({ ...base, endDate: d('2027-01-16') }))).toBeNull();
  });
  it('leap February: typed 2028-02-16 (moved to 2028-02-29): End 2028-02-29 rejected, 2028-03-01 accepted', () => {
    const base = snap.snapInput('2028-02-16', 'semiMonthly', '2028-02-29');
    expect(throwsMessage(asInput(base))).toBe(MOVED_MSG('2028-02-29'));
    expect(throwsMessage(asInput({ ...base, endDate: d('2028-03-01') }))).toBeNull();
  });

  it('unmoved dates keep today\'s message byte for byte (typed 15th and month-end)', () => {
    expect(throwsMessage(asInput(snap.snapInput('2027-01-15', 'semiMonthly', '2027-01-15')))).toBe(UNMOVED_MSG);
    expect(throwsMessage(asInput(snap.snapInput('2027-01-31', 'semiMonthly', '2027-01-20')))).toBe(UNMOVED_MSG);
    expect(throwsMessage(asInput(snap.snapInput('2027-02-28', 'semiMonthly', '2027-02-28')))).toBe(UNMOVED_MSG);
  });

  it('weekly, biweekly, monthly with the SAME dates (typed 2027-01-16, End 2027-01-20) are accepted exactly as before', () => {
    for (const f of ['weekly', 'acceleratedWeekly', 'biweekly', 'acceleratedBiweekly', 'monthly'] as const) {
      expect(throwsMessage(mk({ paymentFrequency: f, endDate: d('2027-01-20') })), f).toBeNull();
    }
    // and their wording for a genuine failure is today's (no "moved")
    expect(throwsMessage(mk({ paymentFrequency: 'monthly', endDate: d('2027-01-16') }))).toBe(UNMOVED_MSG);
  });

  it('start date: after the MOVED date is rejected with the existing start message', () => {
    // typed 2027-01-10 -> moved 2027-01-15
    const base = { ...snap.snapInput('2027-01-10', 'semiMonthly', '2027-03-01') };
    expect(throwsMessage(asInput({ ...base, disbursalDate: d('2027-01-16') }))).toBe('disbursalDate must be on or before firstPaymentDate');
    const renewal = { ...base, flow: 'renewal', disbursalDate: undefined, renewalDate: d('2027-01-16'), accruedInterest: 0 };
    expect(throwsMessage(asInput(renewal))).toBe('renewalDate must be on or before firstPaymentDate');
  });

  it('start date between the typed and the moved date is now ACCEPTED (user decision 2026-10-01): DEV-OQZ known_divergence', () => {
    const base = { ...snap.snapInput('2027-01-10', 'semiMonthly', '2027-03-01') };
    for (const start of ['2027-01-11', '2027-01-12', '2027-01-15']) {
      const r = calculateCobCanada(asInput({ ...base, disbursalDate: d(start) }));
      expect(iso(r.amortizationSchedule[0]!.date)).toBe('2027-01-15');
      expect(r.amortizationSchedule[0]!.daysInPeriod).toBe(Math.round((d('2027-01-15').getTime() - d(start).getTime()) / DAY));
    }
    // the same start date with a weekly schedule is still rejected (the typed date is the first date there)
    expect(throwsMessage(asInput({ ...base, paymentFrequency: 'weekly', disbursalDate: d('2027-01-12') }))).toBe(
      'disbursalDate must be on or before firstPaymentDate',
    );
  });

  it('collectInputIssues reports the moved date in the End issue, in check order, and the unmoved issue unchanged', () => {
    const issues = collectInputIssues(asInput({ ...snap.snapInput('2027-01-16', 'semiMonthly', '2027-01-20'), disbursalDate: d('2027-01-06') }));
    expect(issues).toEqual([{ field: 'endDate', message: MOVED_MSG('2027-01-31') }]);
    const both = collectInputIssues(asInput({ ...snap.snapInput('2027-01-10', 'semiMonthly', '2027-01-12'), disbursalDate: d('2027-01-16') }));
    expect(both).toEqual([
      { field: 'endDate', message: MOVED_MSG('2027-01-15') },
      { field: 'disbursalDate', message: 'disbursalDate must be on or before firstPaymentDate' },
    ]);
    expect(collectInputIssues(asInput(snap.snapInput('2027-01-15', 'semiMonthly', '2027-01-15')))).toEqual([
      { field: 'endDate', message: UNMOVED_MSG },
    ]);
  });

  it('an invalid frequency never reaches the move: issues name the frequency, no "moved" wording, nothing throws', () => {
    const issues = collectInputIssues(asInput({ ...snap.snapInput('2027-01-16', 'semiMonthly', '2027-01-20'), paymentFrequency: 'fortnightly' }));
    expect(issues.some((i) => i.field === 'paymentFrequency')).toBe(true);
    expect(issues.some((i) => /moved/.test(i.message))).toBe(false);
    expect(issues.find((i) => i.field === 'endDate')).toBeUndefined(); // End 2027-01-20 is after the typed 2027-01-16
  });
});

// ---------------------------------------------------------------------------------------------------------------
// T5 purity
// ---------------------------------------------------------------------------------------------------------------
describe('B25-T5 purity and source guard', () => {
  it('a deep-frozen input is calculated twice with JSON-equal results and is not changed', () => {
    const input = snap.snapInput('2027-01-10', 'semiMonthly', '2029-01-15') as CobCanadaInput & { fees: { fees: object[] } };
    Object.freeze(input.fees);
    Object.freeze(input);
    const first = input.firstPaymentDate.getTime();
    const a = JSON.stringify(calculateCobCanada(input));
    const b = JSON.stringify(calculateCobCanada(input));
    expect(a).toBe(b);
    expect(input.firstPaymentDate.getTime()).toBe(first);
    expect(collectInputIssues(input)).toEqual([]);
  });

  it('F3 / F4: effectiveFirstPaymentDate is written with UTC getters only and no rounding', () => {
    const src = stripComments(read(`${SRC_CA}/calendar.ts`));
    const start = src.indexOf('function effectiveFirstPaymentDate(');
    expect(start).toBeGreaterThan(0);
    const body = src.slice(start, src.indexOf('\n}\n', start));
    expect(body).not.toMatch(/\.(getDate|getMonth|getFullYear|getDay|getHours)\s*\(/);
    expect(body).not.toMatch(/Math\.(round|floor|ceil|trunc)|toFixed/);
    expect(body).toMatch(/getUTC/);
  });

  it('the schedule builder and the stepping functions are not edited: buildSchedule still receives one first date', () => {
    const src = stripComments(read(`${SRC_CA}/cobCanada.ts`));
    expect(src.match(/effectiveFirstPaymentDate\(/g)?.length).toBe(1); // computed once (R3), after validation
    expect(src).toMatch(/import \{[^}]*effectiveFirstPaymentDate[^}]*\} from '\.\/calendar\.js'/);
  });
});
