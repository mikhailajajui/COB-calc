/**
 * B8 (COB-architecture.md §5 B8, revision 10; ADR-13(d)): Accelerated Weekly and Accelerated
 * Bi-weekly as separate PaymentFrequency values. QA step written 2026-09-29, before the
 * developer step. The developer must not edit these assertions.
 *
 * Sources (all settled, no business choice here):
 *   - BRD IN-09 (COB-business-requirement.md:101): the dropdown offers Weekly, Accelerated
 *     Weekly, Bi-weekly, Accelerated Bi-weekly, Semi-monthly, Monthly.
 *   - BRD BR-09 (:219) / resolved OQ-06: Accelerated Weekly is treated identically to Weekly
 *     (n = 52) and Accelerated Bi-weekly identically to Bi-weekly (n = 26); frequency key
 *     :172-179 (52/52/26/26/24/12).
 *   - Macro (reference/workbook-macro-source.txt:408-419): Case "Accelerated Weekly" ->
 *     getNextWeekly(startDate), Case "Accelerated Biweekly" -> getNextBiweekly(firstPymtDate,
 *     startDate), exactly the regular cases.
 *   - REF-01 is an Accelerated Weekly run in the workbook (Calculator!D12 = 'Accelerated
 *     Weekly', reference/workbook-sheet-formulas.txt:22). Until B8 the REF-01 test sends
 *     'weekly'; B8-5 runs it as entered.
 *   - BRD Appendix A (:265-266): 3.74% m=2 -> n=26 3.7081026469586664, n=52 3.7067814711050140.
 *
 * Tests:
 *   B8-1  PAYMENTS_PER_YEAR value and key order (keys appended after weekly).
 *   B8-2  payment-date chains from 2027-01-31, each equal to the regular twin's chain.
 *   B8-3  validation: both values accepted; display strings and near-misses rejected with the
 *         exact B8-R3 message.
 *   B8-4  Appendix A through the engine (fixed mortgage, 3.74%).
 *   B8-5  REF-01 (real Excel output) as entered in the workbook, paymentFrequency
 *         'acceleratedWeekly': every row cell and summary cell within 1e-9 relative, and the
 *         result JSON is byte-identical to the weekly run (sha256 14c8c98b...a709, the REF-01
 *         engine hash recorded since A6).
 *   B8-INV-twin  every weekly/biweekly case of the golden corpus (2,184 of 4,455, plus the 4
 *         weekly/biweekly 30-year cases) gives identical JSON.stringify output (or the same error
 *         class and message) when its frequency is replaced by the accelerated twin.
 * The golden fixture is NOT regenerated and gets no new cases (the twin test covers them).
 * Dates compared with toISOString() exactly; this file joins `test:tz` (A4 selection rule).
 */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { periodDateFor } from '../../src/ca/calendar.js';
import { calculateCobCanada } from '../../src/ca/index.js';
import { PAYMENTS_PER_YEAR } from '../../src/ca/index.js';
import type { CobCanadaInput, CobScheduleRow, PaymentFrequency } from '../../src/ca/index.js';
// @ts-ignore -- plain .mjs shared with the golden generator (no .d.ts); tests are not typechecked (F8).
import * as legacyCorpus from './fixtures/legacy/generate_golden_pre_b27.mjs';
import { rehome } from './support/rehome.js';

// B27: DEV-FB24 class G -- the corpus is the FROZEN pre-B27 generator (4,455 cases, 2,184 weekly/biweekly, as before),
// and every input goes through the twin (a personal loan at a non-monthly frequency becomes the same-frequency
// variable mortgage), so the counts and the assertions below are unchanged.
const corpus = {
  buildGroups: legacyCorpus.buildGroups,
  buildLongCases: legacyCorpus.buildLongCases,
  makeInput: (p: unknown) => rehome(legacyCorpus.makeInput(p)),
};
import { asInput, utcDate } from './support/builders.js';
import { withinRel as withinRelTol } from './support/compare.js';
import { loadFixture } from './support/fixtures.js';
import { LEAP_OFF, SHIPPED, calculateWith } from './support/switches.js';

// B37 (DEC-B37-LEAP-N): workbook converter (n = 52/26), switch off. Used by B8-4 and B8-5, which characterise the workbook.
const calcLeapOff = (x: CobCanadaInput) => calculateWith(x, SHIPPED, LEAP_OFF);

const d = utcDate;
const AW = 'acceleratedWeekly' as PaymentFrequency;
const AB = 'acceleratedBiweekly' as PaymentFrequency;
const TWINS: [PaymentFrequency, PaymentFrequency][] = [
  [AW, 'weekly'],
  [AB, 'biweekly'],
];

function outcome(input: CobCanadaInput): string {
  try {
    return 'OK ' + JSON.stringify(calculateCobCanada(input));
  } catch (e) {
    return `THROW ${(e as Error).constructor.name}: ${(e as Error).message}`;
  }
}

// ---------------------------------------------------------------------------------------------
describe('B8-1 PAYMENTS_PER_YEAR (BR-09 frequency key; ADR-13(d))', () => {
  it('has the six values: accelerated n equals the regular n', () => {
    expect(PAYMENTS_PER_YEAR).toEqual({
      monthly: 12,
      semiMonthly: 24,
      biweekly: 26,
      weekly: 52,
      acceleratedBiweekly: 26,
      acceleratedWeekly: 52,
    });
  });

  it('keys are the existing four in their order, then acceleratedBiweekly, acceleratedWeekly', () => {
    expect(Object.keys(PAYMENTS_PER_YEAR)).toEqual([
      'monthly',
      'semiMonthly',
      'biweekly',
      'weekly',
      'acceleratedBiweekly',
      'acceleratedWeekly',
    ]);
  });
});

// ---------------------------------------------------------------------------------------------
describe('B8-2 payment dates (macro getNextWeekly / getNextBiweekly, lines 408-419)', () => {
  const FIRST = d('2027-01-31');
  function chain(fr: PaymentFrequency, n = 5): string[] {
    const out: string[] = [];
    let prev = FIRST;
    for (let i = 0; i < n; i++) {
      const x = periodDateFor(fr, FIRST, i, prev);
      out.push(x instanceof Date ? x.toISOString() : String(x));
      if (x instanceof Date) prev = x;
    }
    return out;
  }

  it('acceleratedWeekly: 01-31, 02-07, 02-14, 02-21, 02-28 (UTC midnight)', () => {
    expect(chain(AW)).toEqual(
      ['2027-01-31', '2027-02-07', '2027-02-14', '2027-02-21', '2027-02-28'].map((s) => `${s}T00:00:00.000Z`),
    );
  });

  it('acceleratedBiweekly: 01-31, 02-14, 02-28, 03-14, 03-28 (UTC midnight)', () => {
    expect(chain(AB)).toEqual(
      ['2027-01-31', '2027-02-14', '2027-02-28', '2027-03-14', '2027-03-28'].map((s) => `${s}T00:00:00.000Z`),
    );
  });

  it.each(TWINS)('%s chain equals the %s chain over 200 periods (crosses Feb 29 2028)', (acc, reg) => {
    expect(chain(acc, 200)).toEqual(chain(reg, 200));
  });
});

// ---------------------------------------------------------------------------------------------
describe('B8-3 validation (rule B8-R3; message key order of PAYMENTS_PER_YEAR, Q-MSG interim)', () => {
  const base = {
    flow: 'newMortgageOrLoan',
    productType: 'mortgage',
    rateType: 'fixed',
    loanAmount: 10000,
    contractRatePercent: 3.74,
    paymentAmount: 100,
    paymentFrequency: 'weekly',
    disbursalDate: d('2027-01-20'),
    firstPaymentDate: d('2027-01-31'),
    endDate: d('2029-01-31'),
    termYears: 2,
    termMonths: 0,
    fees: { fees: [] },
    semiAnnualCompoundingDate: d('2027-01-20'),
  };
  const withFreq = (f: unknown) => asInput({ ...base, paymentFrequency: f });
  const MSG = (v: string) =>
    `paymentFrequency must be one of monthly/semiMonthly/biweekly/weekly/acceleratedBiweekly/acceleratedWeekly, got ${v}`;

  it.each([AW, AB])('%s is accepted', (f) => {
    expect(() => calculateCobCanada(withFreq(f))).not.toThrow();
  });

  // The spec's list, plus the workbook spelling 'Accelerated Biweekly' and a capital-W
  // near-miss of the chosen camelCase ('acceleratedBiWeekly'): display strings are not API values.
  const REJECT: [string, unknown][] = [
    ['Accelerated Weekly', 'Accelerated Weekly'],
    ['acceleratedweekly', 'acceleratedweekly'],
    ['accelerated_weekly', 'accelerated_weekly'],
    ['acceleratedMonthly', 'acceleratedMonthly'],
    ['toString', 'toString'],
    ['undefined', undefined],
    ['Accelerated Biweekly', 'Accelerated Biweekly'],
    ['acceleratedBiWeekly', 'acceleratedBiWeekly'],
  ];
  it.each(REJECT)('rejects %s with RangeError and the exact message', (shown, value) => {
    let err: unknown;
    try {
      calculateCobCanada(withFreq(value));
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(RangeError);
    expect((err as Error).message).toBe(MSG(shown));
  });

  it('check order unchanged: a bad paymentAmount is still reported before a bad frequency', () => {
    expect(() => calculateCobCanada({ ...withFreq('nope'), paymentAmount: 0 } as CobCanadaInput)).toThrow(
      /^paymentAmount must be > 0/,
    );
  });
});

// ---------------------------------------------------------------------------------------------
describe('B8-4 BRD Appendix A through the engine (fixed mortgage, 3.74%, m = 2)', () => {
  const input = (f: PaymentFrequency) =>
    asInput({
      flow: 'newMortgageOrLoan',
      productType: 'mortgage',
      rateType: 'fixed',
      loanAmount: 10000,
      contractRatePercent: 3.74,
      paymentAmount: 100,
      paymentFrequency: f,
      disbursalDate: d('2027-01-20'),
      firstPaymentDate: d('2027-01-31'),
      endDate: d('2029-01-31'),
      termYears: 2,
      termMonths: 0,
      fees: { fees: [] },
      semiAnnualCompoundingDate: d('2027-01-20'),
    });

  it('acceleratedWeekly (n = 52): calculatedRatePercent 3.706781471105014', () => {
    expect(calcLeapOff(input(AW)).calculatedRatePercent).toBe(3.706781471105014); // B37: workbook converter (n = 52/26), switch off
  });

  it('acceleratedBiweekly (n = 26): calculatedRatePercent 3.7081026469586664', () => {
    expect(calcLeapOff(input(AB)).calculatedRatePercent).toBe(3.7081026469586664); // B37: workbook converter (n = 52/26), switch off
  });
});

// ---------------------------------------------------------------------------------------------
describe('B8-5 REF-01 real Excel output, run as entered in the workbook (Accelerated Weekly)', () => {
  const ref = loadFixture('ca_ref01_workbook_saved.json') as {
    inputs: Record<string, number | string>;
    converter: { mortgage_rate_pct: number };
    summary: Record<string, number>;
    rows: Record<string, number | string>[];
  };
  const make = (f: PaymentFrequency) =>
    asInput({
      flow: 'newMortgageOrLoan',
      productType: 'mortgage',
      rateType: 'fixed',
      loanAmount: ref.inputs.loan_amount as number,
      contractRatePercent: ref.converter.mortgage_rate_pct,
      paymentAmount: ref.inputs.payment_amount as number,
      paymentFrequency: f,
      disbursalDate: d(ref.inputs.disbursal_date as string),
      firstPaymentDate: d(ref.inputs.first_payment_date as string),
      endDate: d(ref.inputs.end_date as string),
      termYears: ref.inputs.term_years as number,
      termMonths: 0,
      fees: { fees: [] },
      semiAnnualCompoundingDate: d(ref.inputs.disbursal_date as string),
    });

  const TOL = 1e-9;
  const withinRel = (actual: number, expected: number): boolean => withinRelTol(actual, expected, TOL);

  function run(): ReturnType<typeof calculateCobCanada> | Error {
    try {
      return calcLeapOff(make(AW)); // B37 (DEC-B37-LEAP-N): workbook converter (n = 52/26), switch off
    } catch (e) {
      return e as Error;
    }
  }
  const res = run();
  const ok = () => {
    if (res instanceof Error) expect.fail(`acceleratedWeekly REF-01 threw: ${res.message}`);
    return res;
  };

  it('result JSON is byte-identical to the weekly run (REF-01 engine hash 14c8c98b...a709)', () => {
    const json = JSON.stringify(ok());
    expect(json).toBe(JSON.stringify(calcLeapOff(make('weekly')))); // B37: workbook converter (n = 52/26), switch off
    expect(createHash('sha256').update(json).digest('hex')).toBe(
      '14c8c98be1b693563b9d73d3d10a9082031018162327c2527da6b3010a60a709',
    );
  });

  it('156 rows; every row date matches the workbook', () => {
    const rows = ok().amortizationSchedule;
    expect(rows).toHaveLength(156);
    expect(rows.map((r) => r.date.toISOString().slice(0, 10))).toEqual(ref.rows.map((r) => r.date));
  });

  it('every row cell B, D..O within 1e-9 relative of the workbook', () => {
    const rows = ok().amortizationSchedule;
    let cum = 0;
    const F: [string, (r: CobScheduleRow) => number][] = [
      ['n', (r) => r.period],
      ['open_loan', (r) => r.openingBalance],
      ['open_principal', (r) => r.openingBalance - r.feesOpening],
      ['open_fees', (r) => r.feesOpening],
      ['new_int', (r) => r.periodInterest],
      ['total_int', () => cum],
      ['payment', (r) => r.paymentAmount],
      ['interest_paid', (r) => r.interestPaid],
      ['fees_paid', (r) => r.feesPaid],
      ['principal_paid', (r) => r.principalPortion],
      ['close_fees', (r) => r.feesClosing],
      ['close_principal', (r) => r.closingBalance - r.feesClosing],
      ['close_loan', (r) => r.closingBalance],
    ];
    const bad: string[] = [];
    ref.rows.forEach((fx, i) => {
      const r = rows[i]!;
      cum += r.periodInterest;
      for (const [k, get] of F) if (!withinRel(get(r), fx[k] as number)) bad.push(`row ${i + 1} ${k}: ${get(r)} vs ${fx[k]}`);
    });
    expect(bad).toEqual([]);
  });

  it('every summary cell within 1e-9 relative; trigger rate null (documented difference)', () => {
    const r = ok();
    const pairs: [string, number | null, number][] = [
      ['D10', r.calculatedRatePercent, ref.inputs.calculated_rate_pct as number],
      ['D29', r.cobAmount, ref.summary.cob_amount!],
      ['D31', r.cobRatePercent, ref.summary.cob_rate_pct!],
      ['G29', r.totalPayment, ref.summary.total_payment!],
      ['G31', r.numberOfPayments, ref.summary.n_payments!],
      ['J29', r.totalInterest, ref.summary.total_interest!],
      ['J31', r.principalPayment, ref.summary.principal_paid!],
      ['D20', r.termDays, ref.summary.term_days!],
      ['I193', r.amortizationSchedule.reduce((s, x) => s + x.paymentAmount, 0), ref.summary.payment_column_sum!],
    ];
    const bad = pairs.filter(([, a, e]) => a === null || !withinRel(a, e)).map(([k, a, e]) => `${k}: ${a} vs ${e}`);
    expect(bad).toEqual([]);
    expect(r.triggerRatePercent).toBeNull();
  });
});

// ---------------------------------------------------------------------------------------------
describe('B8-INV-twin: accelerated input == regular twin across the golden corpus', () => {
  const TWIN_OF: Record<string, PaymentFrequency> = { weekly: AW, biweekly: AB };
  type Case = { label: string; params: { frequency: string } };

  it('2,184 weekly/biweekly corpus cases give identical output with the accelerated value', () => {
    const cases: Case[] = (corpus.buildGroups() as { cases: Case[] }[]).flatMap((g) => g.cases);
    expect(cases).toHaveLength(4455);
    const pairs = cases.filter((c) => c.params.frequency in TWIN_OF);
    expect(pairs).toHaveLength(2184);
    const bad: string[] = [];
    let accelThrew = 0;
    for (const c of pairs) {
      const reg = corpus.makeInput(c.params) as CobCanadaInput;
      const acc = { ...reg, paymentFrequency: TWIN_OF[c.params.frequency]! } as CobCanadaInput;
      const a = outcome(acc);
      if (a.startsWith('THROW')) accelThrew++;
      if (a !== outcome(reg)) bad.push(`${c.label}: ${a.slice(0, 160)}`);
    }
    expect(bad.slice(0, 5), `${bad.length} of ${pairs.length} pairs differ`).toEqual([]);
    // Guard against a vacuous pass: the corpus is all-valid, so no accelerated case may throw.
    expect(accelThrew).toBe(0);
  });

  it('the 4 weekly/biweekly 30-year cases give identical output with the accelerated value', () => {
    const longs = (corpus.buildLongCases() as { key: string; params: { frequency: string } }[]).filter(
      (c) => c.params.frequency in TWIN_OF,
    );
    expect(longs.map((c) => c.key)).toEqual([
      'long:weekly:noPayoff',
      'long:weekly:payoff',
      'long:biweekly:noPayoff',
      'long:biweekly:payoff',
    ]);
    for (const c of longs) {
      const reg = corpus.makeInput(c.params) as CobCanadaInput;
      const acc = { ...reg, paymentFrequency: TWIN_OF[c.params.frequency]! } as CobCanadaInput;
      const a = outcome(acc);
      expect(a.startsWith('OK'), `${c.key}: ${a.slice(0, 160)}`).toBe(true);
      expect(a === outcome(reg), c.key).toBe(true);
    }
  });
});
