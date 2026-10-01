/**
 * B11 (COB-architecture.md §5 B11, revision 6): the waterfall principal cap is never negative.
 * Rule B11-R1 in applyPaymentWaterfall. Macro-grounded behaviour change, no user decision.
 * QA step written 2026-09-28, before the developer step.
 *
 * Source (macro, reference/workbook-macro-source.txt): currPrinciple = loanAmt - finFee -
 * nonFinFee (387); principlePaid is at most currPrinciple (500-506); newPrinciple =
 * currPrinciple - principlePaid (511); currPrinciple = newPrinciple (541). So the macro's
 * principal is never negative, and its payoff branch runs only when moneyLeft > 0 (496-499).
 *
 * Expected values were derived independently from a transliterated macro oracle
 * (fixtures/generate_b11_waterfall_vectors.py -> fixtures/b11_waterfall_vectors.json; the oracle
 * reproduces d9_oracle_vectors.json P1 exactly before being trusted). E1 uses the archived
 * COB-py macro_oracle.calculate_all, not a live macro run. Each test checks BOTH the spec's
 * literal value and the oracle fixture.
 *
 * Red before B11: W1, W2, W3, W5, E1, the sweep property. Green before and after: W4.
 */
import { describe, expect, it } from 'vitest';
import { calculateCobCanada } from '../../src/ca/index.js';
import { applyPaymentWaterfall } from '../../src/ca/equations.js';
import type { CobCanadaInput, PaymentFrequency, ProductType, RateType } from '../../src/ca/index.js';
import { asInput, utcDate } from './support/builders.js';
import { rehome } from './support/rehome.js';
import { loadFixture } from './support/fixtures.js';

interface OracleW {
  id: string;
  args: [number, number, number, number, number];
  expected: { interestPaid: number; feesPaid: number; principalPortion: number; amountPaid: number };
}
interface OracleE1Row { n: number; date: string; payment: number; interest_paid: number; fees_paid: number; principal_paid: number }
const FX = loadFixture('b11_waterfall_vectors.json') as {
  waterfall: OracleW[];
  e1: { n: number; total_payment: number; rows: OracleE1Row[] };
};
const oracle = (id: string) => FX.waterfall.find((w) => w.id === id)!;

const d = utcDate;

describe('B11 unit vectors: applyPaymentWaterfall with a non-positive principalOutstanding', () => {
  it('B11-W1 (R2 vector): $0 payment, cap -8.73e-11 -> principalPortion 0, amountPaid 0 (was -8.73e-11)', () => {
    const w = applyPaymentWaterfall(10542.892225726024, 231328.09997504807, 859377.58, 0, -8.731149137020111e-11);
    expect(w.principalPortion).toBe(0);
    expect(w.amountPaid).toBe(0);
    expect(w.interestPaid).toBe(0);
    expect(w.feesPaid).toBe(0);
    const o = oracle('W1').expected;
    expect([w.interestPaid, w.feesPaid, w.principalPortion, w.amountPaid]).toEqual([
      o.interestPaid, o.feesPaid, o.principalPortion, o.amountPaid,
    ]);
  });

  it('B11-W2: payment all used by interest, cap -1e-12 -> not a payoff; interest 0.26, principal 0, Payment 0.26', () => {
    const w = applyPaymentWaterfall(0.5, 0, 0, 0.26, -1e-12);
    expect(w.interestPaid).toBe(0.26);
    expect(w.principalPortion).toBe(0);
    expect(w.amountPaid).toBe(0.26);
    const o = oracle('W2').expected;
    expect([w.interestPaid, w.feesPaid, w.principalPortion, w.amountPaid]).toEqual([
      o.interestPaid, o.feesPaid, o.principalPortion, o.amountPaid,
    ]);
  });

  it('B11-W3: money left, cap -1e-12 -> payoff with principal 0 and Payment 0 (was -1e-12)', () => {
    const w = applyPaymentWaterfall(0.1, 0, 0, 0.26, -1e-12);
    expect(w.principalPortion).toBe(0);
    expect(w.amountPaid).toBe(0);
    expect(w.interestPaid).toBe(0.1);
    const o = oracle('W3').expected;
    expect([w.interestPaid, w.feesPaid, w.principalPortion, w.amountPaid]).toEqual([
      o.interestPaid, o.feesPaid, o.principalPortion, o.amountPaid,
    ]);
  });

  it('B11-W4 (unchanged): cap 0 -> 0, 0; cap 5 -> 0.16, 0.26', () => {
    const a = applyPaymentWaterfall(0.1, 0, 0, 0.26, 0);
    expect([a.principalPortion, a.amountPaid]).toEqual([0, 0]);
    const b = applyPaymentWaterfall(0.1, 0, 0, 0.26, 5);
    expect([b.principalPortion, b.amountPaid]).toEqual([0.16, 0.26]);
    const oa = oracle('W4a').expected;
    const ob = oracle('W4b').expected;
    expect([a.principalPortion, a.amountPaid]).toEqual([oa.principalPortion, oa.amountPaid]);
    expect([b.principalPortion, b.amountPaid]).toEqual([ob.principalPortion, ob.amountPaid]);
  });

  it('B11-W5: cap -0 -> principalPortion and amountPaid are +0 (were -0)', () => {
    const w = applyPaymentWaterfall(0.1, 0, 0, 0.26, -0);
    expect(Object.is(w.principalPortion, 0)).toBe(true);
    expect(Object.is(w.amountPaid, 0)).toBe(true);
  });
});

describe('B11-E1: engine case, loanAmount one ULP above a 2,000 financed fee', () => {
  const input = asInput({
    flow: 'newMortgageOrLoan',
    productType: 'mortgage',
    rateType: 'variable',
    contractRatePercent: 5.19,
    paymentFrequency: 'biweekly',
    paymentAmount: 0.25,
    loanAmount: 2000.0000000000002,
    fees: { fees: [{ name: 'F', amount: 2000, financed: true, includedInCob: true }] },
    disbursalDate: d('2026-12-22'),
    firstPaymentDate: d('2027-01-01'),
    endDate: d('2028-01-01'),
    termYears: 1,
    termMonths: 0,
  });

  it('27 rows, no negative Payment, row 17 Payment 0.25 = interestPaid, totalPayment 6.75 (was 5.249999999999453)', () => {
    expect(input.loanAmount).toBeGreaterThan(2000);
    expect(input.loanAmount - 2000).toBe(2.2737367544323206e-13); // exactly 1 ULP at 2000
    const r = calculateCobCanada(input);
    const s = r.amortizationSchedule;
    expect(s).toHaveLength(27);
    expect(s.filter((row) => row.paymentAmount < 0).map((row) => row.period)).toEqual([]);
    expect(s[16]!.period).toBe(17);
    expect(s[16]!.paymentAmount).toBe(0.25);
    expect(s[16]!.paymentAmount).toBe(s[16]!.interestPaid);
    expect(r.totalPayment).toBe(6.75);
  });

  it('matches the macro oracle row by row (Payment, interest, fees, principal, date) and in totals', () => {
    const r = calculateCobCanada(input);
    const s = r.amortizationSchedule;
    expect(s).toHaveLength(FX.e1.n);
    expect(r.totalPayment).toBe(FX.e1.total_payment);
    FX.e1.rows.forEach((o, i) => {
      const row = s[i]!;
      expect([row.period, row.date.toISOString().slice(0, 10)]).toEqual([o.n, o.date]);
      expect([row.paymentAmount, row.interestPaid, row.feesPaid, row.principalPortion]).toEqual([
        o.payment, o.interest_paid, o.fees_paid, o.principal_paid,
      ]);
    });
  });
});

/**
 * B11-INV-sweep generator (spec: loanAmount = a financed fee in whole cents 1.00..9,000.00 plus
 * 1..64 ULP; 4 frequencies x 4 product/rate pairs; payments 0..0.50; rates 1..10%). Dates are
 * not specified by the spec: disbursal 2026-01-01 + 0..364 days, first payment + 1..40 days,
 * end = first payment + 365 days, termYears 1. Seeded LCG, deterministic.
 * Size: 30,000 inputs (the spec's size; about 1.5 s). Pre-B11 build (measured 2026-09-28): 108 of the
 * 30,000 inputs (585 rows of 884,669) have a negative Payment or principal. The row total is
 * pinned so a generator change that makes the sweep vacuous shows up.
 * B14 (OQ-Y revised, 2026-09-28): a $0 payment is rejected, so the payment draw is 0.01..0.50
 * (one rnd() call, the other draws unchanged); rows 884,669 -> 884,665. QA re-measured on a
 * scratch copy with the B11 clamp removed: 102 inputs (575 rows) still break the property, so
 * the sweep still catches a B11 regression.
 */
describe('B11-INV-sweep: every row has paymentAmount >= 0 and principalPortion >= 0', () => {
  it('holds on a deterministic 30,000-input ULP sweep', () => {
    let seed = 20260928;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648), seed / 2147483648);
    const f64 = new Float64Array(1);
    const u64 = new BigUint64Array(f64.buffer);
    const plusUlps = (x: number, k: number) => {
      f64[0] = x;
      u64[0] = u64[0]! + BigInt(k);
      return f64[0]!;
    };
    const freqs: PaymentFrequency[] = ['weekly', 'biweekly', 'semiMonthly', 'monthly'];
    const pts: [ProductType, RateType][] = [
      ['personalLoan', 'fixed'], ['personalLoan', 'variable'], ['mortgage', 'fixed'], ['mortgage', 'variable'],
    ];
    const DAY = 86400000;
    const N = 30000;
    let rows = 0;
    const bad: string[] = [];
    for (let i = 0; i < N; i += 1) {
      const f = freqs[i % 4]!;
      const [pt, rt] = pts[(i >> 2) % 4]!;
      const fee = (100 + Math.floor(rnd() * 899901)) / 100; // 1.00 .. 9000.00
      const loan = plusUlps(fee, 1 + Math.floor(rnd() * 64));
      const pay = (1 + Math.floor(rnd() * 50)) / 100; // 0.01 .. 0.50 (B14, OQ-Y revised: > 0)
      const rate = (100 + Math.floor(rnd() * 901)) / 100; // 1.00 .. 10.00
      const dis = new Date(Date.UTC(2026, 0, 1) + Math.floor(rnd() * 365) * DAY);
      const fp = new Date(dis.getTime() + (1 + Math.floor(rnd() * 40)) * DAY);
      const end = new Date(fp.getTime() + 365 * DAY);
      const input = asInput(rehome({ // B27: DEV-FB24 class D (final input through the twin; every draw unchanged)
        flow: 'newMortgageOrLoan', productType: pt, rateType: rt, loanAmount: loan, contractRatePercent: rate,
        paymentAmount: pay, paymentFrequency: f, disbursalDate: dis, firstPaymentDate: fp, endDate: end,
        semiAnnualCompoundingDate: dis, termYears: 1, termMonths: 0,
        fees: { fees: [{ name: 'F', amount: fee, financed: true, includedInCob: true }] },
      }));
      const r = calculateCobCanada(input);
      for (const row of r.amortizationSchedule) {
        rows += 1;
        if (!(row.paymentAmount >= 0) || !(row.principalPortion >= 0)) {
          bad.push(`#${i} row ${row.period}: payment ${row.paymentAmount}, principal ${row.principalPortion}`);
        }
      }
    }
    expect(rows).toBe(884665);
    expect(bad.slice(0, 5)).toEqual([]);
    expect(bad.length).toBe(0);
  });
});
