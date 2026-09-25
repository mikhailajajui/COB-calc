import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { calculateCobCanada } from '../../src/ca/cobCanada.js';
import type { CobCanadaInput, CobCanadaResult, CobScheduleRow } from '../../src/index.js';

/**
 * Spec 011 (docs/new-req/011-app-engine-brd-changes.md) "D9 / D8" (financed fees reduce
 * the balance when paid, DEV-011-2) and "DQ-28" (the final payment pays only what is
 * owed, DEV-011-3): invariants I-011-10 ... I-011-14. Tolerance 1e-9 relative.
 *
 * I-011-12's expected rows come from the macro oracle (COB-py/tests/fixtures/
 * macro_oracle.py, run with non_fin_fee = 0) via fixtures/d9_oracle_vectors.json; that
 * file records how it was generated. Oracle, not a live macro run.
 */

const REL_TOL = 1e-9;
const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url));
const load = (name: string) => JSON.parse(readFileSync(FIXTURES + name, 'utf8'));

function relDiff(actual: number, expected: number): number {
  return Math.abs(actual - expected) / Math.max(Math.abs(expected), 1);
}

function expectRel(actual: number, expected: number): void {
  expect(relDiff(actual, expected)).toBeLessThanOrEqual(REL_TOL);
}

type WireRequest = Record<string, unknown> & { fees: CobCanadaInput['fees'] };
const DATE_FIELDS = ['firstPaymentDate', 'endDate', 'disbursalDate', 'renewalDate', 'semiAnnualCompoundingDate'];

function toEngineInput(request: WireRequest): CobCanadaInput {
  const out: Record<string, unknown> = { ...request };
  for (const f of DATE_FIELDS) {
    if (typeof request[f] === 'string') out[f] = new Date(`${request[f] as string}T00:00:00Z`);
  }
  return out as unknown as CobCanadaInput;
}

const wire = load('ca_app_wire_vectors.json') as { vectors: { id: string; request: WireRequest }[] };
const wireInput = (id: string): CobCanadaInput => toEngineInput(wire.vectors.find((v) => v.id === id)!.request);

interface OracleRow {
  n: number;
  date: string;
  open_loan: number;
  open_fees: number;
  new_int: number;
  payment: number;
  interest_paid: number;
  fees_paid: number;
  principal_paid: number;
  close_fees: number;
  close_loan: number;
}
const d9 = load('d9_oracle_vectors.json') as {
  tolerance_rel: number;
  cases: {
    id: string;
    request: WireRequest;
    totals: { n: number; total_payment: number; total_interest: number; term_days: number; ending_balance: number };
    rows: OracleRow[];
    p1_with_non_financed_200?: { cob_amount: number; avg_opening_balance: number; cob_rate_pct: number };
  }[];
};

/** 011 base input P0. */
function p0(overrides: Partial<CobCanadaInput> = {}): CobCanadaInput {
  return {
    flow: 'newMortgageOrLoan',
    productType: 'personalLoan',
    rateType: 'fixed',
    loanAmount: 10000,
    contractRatePercent: 6,
    paymentAmount: 500,
    paymentFrequency: 'monthly',
    disbursalDate: new Date('2026-01-01'),
    firstPaymentDate: new Date('2026-02-01'),
    endDate: new Date('2026-12-01'),
    termYears: 1,
    termMonths: 0,
    fees: { fees: [] },
    ...overrides,
  };
}

const financed = (amount: number) => ({ name: 'Admin', amount, financed: true, includedInCob: true });
const nonFinanced = (amount: number) => ({ name: 'Appraisal', amount, financed: false, includedInCob: true });

function renewal(overrides: Partial<CobCanadaInput> = {}): CobCanadaInput {
  const base = p0({ flow: 'renewal', renewalDate: new Date('2026-01-01'), accruedInterest: 50 });
  delete base.disbursalDate;
  return { ...base, ...overrides };
}

/** Inputs the "for every valid input" invariants are checked over: every wire vector,
 *  011's P-inputs, payoff (with and without fees, on row 1 and later), underpayment
 *  (payment below interest) and a renewal with accrued interest and fees. */
const PROPERTY_INPUTS: [string, CobCanadaInput][] = [
  ...wire.vectors.map((v) => [v.id, toEngineInput(v.request)] as [string, CobCanadaInput]),
  ['P0', p0()],
  ['P1', p0({ fees: { fees: [financed(300), nonFinanced(200)] } })],
  ['P2', p0({ fees: { fees: [nonFinanced(200)] } })],
  ['P0 payoff with fees', p0({ paymentAmount: 2000, fees: { fees: [financed(300)] } })],
  ['row-1 payoff with fees', p0({ loanAmount: 1000, paymentAmount: 5000, fees: { fees: [financed(100)] } })],
  ['fees larger than a payment', p0({ paymentAmount: 200, fees: { fees: [financed(700)] } })],
  ['underpayment with fees', p0({ paymentAmount: 30, fees: { fees: [financed(300)] } })],
  ['renewal, accrued interest, fees, payoff', renewal({ paymentAmount: 1500, fees: { fees: [financed(400)] } })],
];

function rowsOf(result: CobCanadaResult): CobScheduleRow[] {
  return result.amortizationSchedule;
}

describe('I-011-10 FEES-REDUCE-BALANCE (D9/D8)', () => {
  it.each(PROPERTY_INPUTS)(
    '%s: closingBalance == openingBalance - feesPaid - principalPortion, and rows chain',
    (_label, input) => {
      const rows = rowsOf(calculateCobCanada(input));
      rows.forEach((row, i) => {
        expect(row.closingBalance).toBe(row.openingBalance - row.feesPaid - row.principalPortion);
        if (i > 0) expect(row.openingBalance).toBe(rows[i - 1]!.closingBalance);
      });
      expect(rows[0]!.openingBalance).toBe(input.loanAmount);
    },
  );

  it('P1 row 1 (spec value): the $300 financed fee paid on row 1 comes off the balance', () => {
    const row1 = rowsOf(calculateCobCanada(p0({ fees: { fees: [financed(300)] } })))[0]!;
    expectRel(row1.closingBalance, 10000 - 300 - 149.04109589041207);
  });

  it('boundary: a fee larger than one payment is recovered over two rows, principal 0 on the first', () => {
    const rows = rowsOf(calculateCobCanada(p0({ paymentAmount: 200, fees: { fees: [financed(300)] } })));
    expect(rows[0]!.principalPortion).toBe(0);
    expect(rows[0]!.feesClosing).toBeGreaterThan(0);
    expectRel(rows[0]!.closingBalance, 10000 - rows[0]!.feesPaid);
    expect(rows[1]!.feesClosing).toBe(0);
  });

  it('invalid input is still rejected before any schedule is built', () => {
    expect(() => calculateCobCanada(p0({ fees: { fees: [financed(-1)] } }))).toThrow(RangeError);
  });
});

describe('I-011-11 FEES-COUNTED-ONCE (D9/D8)', () => {
  it.each(PROPERTY_INPUTS)('%s: sum(principalPortion) + sum(feesPaid) == loanAmount - endingBalance', (_label, input) => {
    const res = calculateCobCanada(input);
    const paidDown = rowsOf(res).reduce((s, r) => s + r.principalPortion + r.feesPaid, 0);
    expect(Math.abs(paidDown - (input.loanAmount - res.endingBalance)) / input.loanAmount).toBeLessThanOrEqual(REL_TOL);
    expectRel(res.principalPayment + res.feesRecovered, input.loanAmount - res.endingBalance);
  });

  it('S1 with only its financed fee: the member pays back loan + interest, not loan + interest + fees', () => {
    const input = toEngineInput(d9.cases.find((c) => c.id === 'S1_financed_only')!.request);
    const res = calculateCobCanada(input);
    expectRel(res.totalPayment, input.loanAmount - res.endingBalance + res.totalInterest);
  });
});

describe('I-011-12 MACRO-MATCH, FINANCED FEES ONLY (D9/D8)', () => {
  it('the fixture uses the project tolerance', () => {
    expect(d9.tolerance_rel).toBe(REL_TOL);
  });

  for (const c of d9.cases) {
    it(`${c.id}: every row and total matches macro_oracle.calculate_all(non_fin_fee=0)`, () => {
      const res = calculateCobCanada(toEngineInput(c.request));
      const rows = rowsOf(res);
      expect(rows.length).toBe(c.rows.length);
      let maxRel = 0;
      const check = (a: number, e: number) => {
        maxRel = Math.max(maxRel, relDiff(a, e));
      };
      rows.forEach((row, i) => {
        const o = c.rows[i]!;
        expect(row.date.toISOString().slice(0, 10)).toBe(o.date);
        check(row.openingBalance, o.open_loan);
        check(row.feesOpening, o.open_fees);
        check(row.periodInterest, o.new_int);
        check(row.paymentAmount, o.payment);
        check(row.interestPaid, o.interest_paid);
        check(row.feesPaid, o.fees_paid);
        check(row.principalPortion, o.principal_paid);
        check(row.feesClosing, o.close_fees);
        check(row.closingBalance, o.close_loan);
      });
      expect(res.numberOfPayments).toBe(c.totals.n);
      expect(res.termDays).toBe(c.totals.term_days);
      check(res.totalPayment, c.totals.total_payment);
      check(res.totalInterest, c.totals.total_interest);
      check(res.endingBalance, c.totals.ending_balance);
      expect(maxRel).toBeLessThanOrEqual(REL_TOL);
    });
  }

  it('I-011-1 cross-check: P1 (with the $200 non-financed fee) C, P and COB rate equal the oracle-derived values', () => {
    const derived = d9.cases.find((c) => c.id === 'P1_financed_only')!.p1_with_non_financed_200!;
    const res = calculateCobCanada(p0({ fees: { fees: [financed(300), nonFinanced(200)] } }));
    const rows = rowsOf(res);
    expectRel(res.cobAmount, derived.cob_amount);
    expectRel(rows.reduce((s, r) => s + r.openingBalance, 0) / rows.length, derived.avg_opening_balance);
    expectRel(res.cobRatePercent, derived.cob_rate_pct);
  });
});

describe('I-011-13 PAYOFF (DQ-28)', () => {
  it.each(PROPERTY_INPUTS)('%s: no overshoot; paymentAmount is what the row actually paid', (_label, input) => {
    const rows = rowsOf(calculateCobCanada(input));
    rows.forEach((row, i) => {
      expect(row.closingBalance).toBeGreaterThanOrEqual(-1e-9 * input.loanAmount);
      expect(row.principalPortion).toBeLessThanOrEqual(row.openingBalance - row.feesOpening + 1e-9 * input.loanAmount);
      expectRel(row.paymentAmount, row.interestPaid + row.feesPaid + row.principalPortion);
      expect(row.paymentAmount).toBeLessThanOrEqual(input.paymentAmount);
      if (i < rows.length - 1) expect(row.paymentAmount).toBe(input.paymentAmount);
    });
  });

  it.each(['S5_payoff', 'S9_fees_payoff'])('%s: the last row closes at 0 and pays less than the input payment', (id) => {
    const input = wireInput(id);
    const res = calculateCobCanada(input);
    const last = rowsOf(res).at(-1)!;
    expect(Math.abs(last.closingBalance)).toBeLessThanOrEqual(1e-9 * input.loanAmount);
    expect(Math.abs(res.endingBalance)).toBeLessThanOrEqual(1e-9 * input.loanAmount);
    expect(last.paymentAmount).toBeLessThan(input.paymentAmount);
    expectRel(res.totalPayment, res.totalInterest + res.feesRecovered + res.principalPayment);
  });

  it('S5 (DEV-011-3): the payoff row records interest + principal, where the macro records principal only', () => {
    const res = calculateCobCanada(wireInput('S5_payoff'));
    const last = rowsOf(res).at(-1)!;
    expect(res.numberOfPayments).toBe(6);
    // Oracle S5 last row: principal_paid 74.19280222397538, interest_paid 0.36139088970696776.
    expectRel(last.principalPortion, 74.19280222397538);
    expectRel(last.interestPaid, 0.36139088970696776);
    expectRel(last.paymentAmount, 74.19280222397538 + 0.36139088970696776);
    expectRel(res.totalPayment, 5000 + res.totalInterest);
  });

  it('boundary: a payoff on row 1 with a financed fee stops after one row, fee and principal both paid', () => {
    const input = p0({ loanAmount: 1000, paymentAmount: 5000, fees: { fees: [financed(100)] } });
    const res = calculateCobCanada(input);
    const [row] = rowsOf(res);
    expect(res.numberOfPayments).toBe(1);
    expect(row!.feesPaid).toBe(100);
    expect(row!.principalPortion).toBe(900);
    expect(row!.closingBalance).toBe(0);
    expectRel(row!.paymentAmount, row!.interestPaid + 1000);
  });

  it('invalid input: a zero payment is still rejected', () => {
    expect(() => calculateCobCanada(p0({ paymentAmount: 0 }))).toThrow(RangeError);
  });
});

describe('I-011-14 NO-FEE, NO-PAYOFF UNCHANGED', () => {
  // Bit-identical to the pre-D9 rules: with feesPaid = 0 the balance update is
  // exactly openingBalance - principalPortion, and without a payoff every row's
  // paymentAmount is the input payment itself (not a re-summed one). The 007 worked
  // vector and Appendix A are asserted unchanged in fixtureParity.test.ts.
  it.each(['V007_live', 'S0_007', 'S3_leap_weekly', 'S7_biweekly', 'S8_10y_weekly'])(
    '%s: rows use the pre-D9 formulas bit for bit',
    (id) => {
      const input = wireInput(id);
      for (const row of rowsOf(calculateCobCanada(input))) {
        expect(row.feesPaid).toBe(0);
        expect(row.closingBalance).toBe(row.openingBalance - row.principalPortion);
        expect(Object.is(row.paymentAmount, input.paymentAmount)).toBe(true);
      }
    },
  );
});
