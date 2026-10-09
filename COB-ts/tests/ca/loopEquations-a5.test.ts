/**
 * A5 (COB-architecture.md §5 A5, revision 6): the schedule loop in cobCanada.ts calls
 * equations.periodInterest(...) instead of computing period interest inline. R item:
 * behaviour is byte-identical, golden unchanged. QA step written 2026-09-28, before the
 * developer step.
 *
 * QA checked both spec claims against the code on 2026-09-28:
 *   - Same expression: inline `openingBalance * calculatedRateDecimal * dayCountFraction(priorDate, rowDate)`
 *     and periodInterest's `openingBalance * calculatedRateDecimal * dayCountFraction(periodStart, periodEnd)`
 *     are both (a*b)*c, same operands, same dayCountFraction (calendar.ts).
 *   - Guards never trip: row 1 opening = loanAmount (validated finite > 0); later rows run only
 *     while the previous closing > 0 (loop breaks on <= 0, so negative / sub-cent-negative
 *     closings never reach the call); closing is never NaN (a NaN/Infinity period interest is
 *     rejected by applyPaymentWaterfall first). The rate decimal is finite >= 0 (contract rate
 *     validated finite >= 0; B14 / OQ-AA revised: finite > 0, though a subnormal rate can still
 *     give decimal 0). The only non-finite value that reaches the call is opening =
 *     +Infinity (overflow), which passes `>= 0`, so the error is still the waterfall's.
 *
 * Three parts:
 *   1. Characterisation (green now, must stay green): guard-edge inputs through
 *      calculateCobCanada, pinned as sha256 of JSON.stringify(result), or the exact error.
 *   2. Equivalence sweep (green now): on a deterministic sweep, every row's periodInterest is
 *      Object.is-equal to equations.periodInterest(opening, rate, priorDate, rowDate), and every
 *      row's opening is > 0.
 *   3. Source guard (red until A5): buildSchedule has no inline interest expression and no
 *      dayCountFraction( call, and calls periodInterest(.
 */
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { calculateCobCanada } from '../../src/ca/index.js';
import { calculatedRateFor, periodInterest } from '../../src/ca/equations.js';
import { PAYMENTS_PER_YEAR } from '../../src/ca/index.js';
import type { CobCanadaInput, FeeSchedule, PaymentFrequency, ProductType, RateType } from '../../src/ca/index.js';
import { SRC_CA, read, stripComments } from '../architecture/support.js';
import { asInput, utcDate } from './support/builders.js';
import { rehomeCase } from './support/rehome.js';
import { LEAP_OFF, SHIPPED, WORKBOOK, calculateWith } from './support/switches.js';
import type { Switches } from './support/switches.js';

const d = utcDate;
const sha = (x: unknown) => createHash('sha256').update(JSON.stringify(x)).digest('hex');
const FEE = (amount: number, financed = true): FeeSchedule => ({
  fees: [{ name: 'F', amount, financed, includedInCob: true }],
});

const base = {
  flow: 'newMortgageOrLoan',
  productType: 'personalLoan',
  rateType: 'fixed',
  loanAmount: 10000,
  contractRatePercent: 6,
  // B14 (OQ-Y revised, 2026-09-28): the payment must be > 0, so the base is the minimum $0.01
  // (was $0). These inputs are valid before and after B14, so the pins below are taken on the
  // pre-B14 build and must stay green through the dev step.
  paymentAmount: 0.01,
  paymentFrequency: 'monthly',
  disbursalDate: d('2026-01-15'),
  firstPaymentDate: d('2026-02-15'),
  endDate: d('2027-01-15'),
  termYears: 1,
  termMonths: 0,
  fees: { fees: [] },
} as const;
// B27: DEV-FB24 class D -- every input goes through the twin (a personal loan at a non-monthly frequency
// becomes the same-frequency variable mortgage; identity otherwise), so the sweep draws and pins are unchanged.
const mk = (o: Record<string, unknown>) => rehomeCase(asInput({ ...base, ...o })).twin;

// ---------------------------------------------------------------------------------------
// 1. Characterisation (green now)
// ---------------------------------------------------------------------------------------
// B19 (DEV-OQL): `switches` picks the engine branch; absent = the shipped `calculateCobCanada`. The four cases
// whose pinned figures are the workbook's capitalisation run on WORKBOOK; each has a `...Shipped` twin.
interface Pinned { input: CobCanadaInput; restore?: <R extends object>(result: R) => R; sha?: string; rows?: number; lastClosing?: number; error?: string; switches?: Switches }
const CASES: Record<string, Pinned> = {
  // OQ-Y revised minimum $0.01 payment + OQ-L capitalised interest: opening grows each row.
  minPayCapitalised: {
    input: mk({}),
    switches: WORKBOOK,
    sha: '4f2f48deffbc5d003a6534a84e1b777e13c7d871303a6bbadce85ac0dda899f8', rows: 12, lastClosing: 10616.653480426887,
  },
  minPayCapitalisedFinFee: {
    input: mk({ fees: FEE(250) }),
    switches: WORKBOOK,
    sha: '994b175aae42b88d18e25359fe82255d377dac4dca5792b6c6a80ee1934973cb', rows: 12, lastClosing: 10616.653480426887,
  },
  // OQ-AA revised (B14-R1, known_divergence DEV-OQAA): a 0% contract rate is rejected, so the
  // former rate-0 guard-edge cases are now pinned as the rejection. The calculatedRateDecimal
  // === 0 edge (MONTHLY and m = 2) moved to the unit check B14-U (b14-payment-rate-positive).
  zeroPayZeroRate: {
    input: mk({ contractRatePercent: 0 }),
    error: 'contractRatePercent must be > 0, got 0',
  },
  zeroRateFixedMortgage: {
    input: mk({ productType: 'mortgage', rateType: 'fixed', semiAnnualCompoundingDate: d('2026-01-15'), contractRatePercent: 0, paymentAmount: 900 }),
    error: 'contractRatePercent must be > 0, got 0',
  },
  zeroRatePayoff: {
    input: mk({ contractRatePercent: 0, paymentAmount: 3000 }),
    error: 'contractRatePercent must be > 0, got 0',
  },
  // Positive-rate twins (6%) of the three rate-0 schedules above.
  fixedMortgage6pct: {
    input: mk({ productType: 'mortgage', rateType: 'fixed', semiAnnualCompoundingDate: d('2026-01-15'), paymentAmount: 900 }),
    sha: '10f283eb2320c08f4693e15b1ef0977a7d7d81ad15db46b24c57e54a554bfcb2', rows: 12, lastClosing: 0,
  },
  payoff6pct: {
    input: mk({ paymentAmount: 3000 }),
    sha: '02ca7214fe0eee7c5795cd6862e928b563885d62a65f9ff4124208143d675930', rows: 4, lastClosing: 0,
  },
  // Day-count edge: disbursal = first payment date, so row 1 has dayCountFraction 0.
  zeroDayFirstRow: {
    input: mk({ disbursalDate: d('2026-02-15'), paymentAmount: 500, fees: FEE(100) }),
    sha: 'b605cbc8dbd209e1461e13f2fbcb71e6b5c2061092c09e46becc3a41a6af4094', rows: 12, lastClosing: 4394.365333108026,
  },
  // Payoff row closes at exactly 0 and the loop stops (opening 0 never reaches the call).
  // OQ-AA revised: at rate 0 this is now the rejection; exactPayoffRow6pct is its twin.
  exactPayoffRow: {
    input: mk({ loanAmount: 1000, paymentAmount: 1000, contractRatePercent: 0 }),
    error: 'contractRatePercent must be > 0, got 0',
  },
  exactPayoffRow6pct: {
    input: mk({ loanAmount: 1000, paymentAmount: 2000 }),
    sha: '41ab14684252c4c29bbfa3e8dce21b7d4b6dea24d2ce41d81baff7b0f1e27c00', rows: 1, lastClosing: 0,
  },
  // R2/B11 area: a sub-cent positive opening (row 12 opens at 0.002404263893865277).
  subCentOpeningRow: {
    input: mk({
      productType: 'mortgage', rateType: 'fixed', semiAnnualCompoundingDate: d('2026-01-01'), loanAmount: 1046.62,
      contractRatePercent: 7.3, paymentAmount: 97.13, paymentFrequency: 'semiMonthly', disbursalDate: d('2026-01-01'),
      firstPaymentDate: d('2026-02-01'), endDate: d('2027-12-31'), fees: FEE(12.34),
    }),
    // B25 (DEV-OQZ): the typed 2026-02-01 semi-monthly first date is moved to 2026-02-15. Pin re-taken (was 09d61ad6...22e7):
    // equal to the PRE-B25 engine fed firstPaymentDate 2026-02-15 (B25-INV-equiv), 12 rows, ending balance 0 as before.
    sha: '63a314c0299f7817ebe329ce4adce332013e1f714406c5e796a718a9fe84256d', rows: 12, lastClosing: 0,
  },
  // IN-11 past accrued interest with the minimum $0.01 payment (OQ-W interim rule: flat balance).
  renewalIn11MinPay: {
    input: { ...mk({ flow: 'paymentChange', renewalDate: d('2026-01-15'), accruedInterest: 37.5 }), disbursalDate: undefined } as CobCanadaInput,
    switches: WORKBOOK,
    sha: 'ceca024bc16a646e2f0e3d117e40fd2f5218941369024cf39df434cec2bcd3f7', rows: 12, lastClosing: 10000,
  },
  // Smallest positive loan: with a payment > 0 (B14) it is paid off on row 1 (Payment 5e-324).
  // The 12-row interest-underflow path needed a $0 payment and is no longer reachable.
  tinyLoan: {
    input: mk({ loanAmount: 5e-324 }),
    sha: 'b118c86e0f1ef8366e3948fb3bc585ea68df89b243406a41cef00e18ea337957', rows: 1, lastClosing: 0,
  },
  // Overflow: row 8 opens at +Infinity (passes periodInterest's >= 0 guard); the waterfall rejects.
  overflowToInfinity: {
    input: mk({ loanAmount: 1.5e308, contractRatePercent: 100, paymentFrequency: 'weekly' }),
    switches: WORKBOOK,
    error: 'periodInterestAmount must be a finite number, got Infinity',
  },
  // B19 shipped twins (DEV-OQL, measured on QA's prototype of the brief's code): unpaid interest is never
  // capitalised, so the balance stays flat / never grows and the row-8 overflow is gone.
  minPayCapitalisedShipped: {
    input: mk({}),
    sha: '6289adbf58f0f9985e904515c09d35584e5636623a7c539785eb505270f971d5', rows: 12, lastClosing: 10000,
  },
  minPayCapitalisedFinFeeShipped: {
    input: mk({ fees: FEE(250) }),
    sha: '2cb9ecaaa156bccbd47d4ebd75859368f8e61ad6aec32978fc83314e6b660fd5', rows: 12, lastClosing: 10000,
  },
  renewalIn11MinPayShipped: {
    input: { ...mk({ flow: 'paymentChange', renewalDate: d('2026-01-15'), accruedInterest: 37.5 }), disbursalDate: undefined } as CobCanadaInput,
    sha: '5115e53f0467c1efc179450e5f3f02e8515a9d26b31a7f75c86d06f953b6c145', rows: 12, lastClosing: 10000,
  },
  overflowToInfinityShipped: {
    // B27: DEV-FB24 class X1 -- the twin, plus `restore` so the hash below is taken over the result with the
    // original personal loan's triggerRatePercent (null); the pinned sha is unchanged.
    ...((t) => ({ input: t.twin, restore: t.restore }))(
      rehomeCase(asInput({ ...base, loanAmount: 1.5e308, contractRatePercent: 100, paymentFrequency: 'weekly' })),
    ),
    sha: 'c88a5419f8e4f6d9d8a7c606ce4655f5214efd536df5df08590662366b58888b', rows: 48, lastClosing: 1.5e308,
  },
  // Finite opening and rate, infinite product on row 1: the waterfall rejects.
  hugeRateInfinityInterest: {
    input: mk({ loanAmount: 1e308, contractRatePercent: 1e10 }),
    error: 'periodInterestAmount must be a finite number, got Infinity',
  },
};

const run = (c: Pinned) => (c.switches ? calculateWith(c.input, c.switches) : calculateCobCanada(c.input));

describe('A5 characterisation: guard-edge inputs through calculateCobCanada (green now)', () => {
  for (const [name, c] of Object.entries(CASES)) {
    it(name, () => {
      if (c.input.disbursalDate === undefined) delete (c.input as { disbursalDate?: Date }).disbursalDate;
      if (c.error !== undefined) {
        let msg: string | undefined;
        try {
          run(c);
        } catch (e) {
          expect(e).toBeInstanceOf(RangeError);
          msg = (e as Error).message;
        }
        expect(msg).toBe(c.error);
        return;
      }
      const r = run(c);
      expect(r.amortizationSchedule.length).toBe(c.rows);
      expect(Object.is(r.endingBalance, c.lastClosing)).toBe(true);
      expect(sha(c.restore ? c.restore(r) : r)).toBe(c.sha); // B27: DEV-FB24 class X1 (restore only for overflowToInfinityShipped)
    });
  }
});

// ---------------------------------------------------------------------------------------
// 2. Equivalence sweep (green now)
// ---------------------------------------------------------------------------------------
describe('A5 equivalence: row.periodInterest === periodInterest(opening, rate, prior, date)', () => {
  it('holds with Object.is on every row of a deterministic 4,000-input sweep; every opening > 0', () => {
    let seed = 12345;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648), seed / 2147483648);
    const freqs: PaymentFrequency[] = ['weekly', 'biweekly', 'semiMonthly', 'monthly'];
    const pts: [ProductType, RateType][] = [
      ['personalLoan', 'fixed'], ['personalLoan', 'variable'], ['mortgage', 'fixed'], ['mortgage', 'variable'],
    ];
    const DAY = 86400000;
    let rows = 0;
    let mismatches = 0;
    let nonPositive = 0;
    let skipped = 0;
    for (let i = 0; i < 4000; i += 1) {
      const f = freqs[i % 4]!;
      const [pt, rt] = pts[(i >> 2) % 4]!;
      const L = +(100 + rnd() * 5000).toFixed(2);
      // B14 (OQ-AA revised / OQ-Y revised): rate and payment draws are > 0 (same rnd() calls).
      const rate = [0.001, 0.01, Math.max(0.001, +(rnd() * 20).toFixed(3))][i % 3]!;
      const pay = [0.01, Math.max(0.01, +((rnd() * L) / 5).toFixed(2)), L * 2][Math.floor(rnd() * 3)]!;
      const fee = rnd() < 0.5 ? 0 : +((rnd() * L) / 10).toFixed(2);
      const dis = new Date(Date.UTC(2024, 0, 1) + Math.floor(rnd() * 800) * DAY);
      const fp = new Date(dis.getTime() + Math.floor(rnd() * 40) * DAY);
      const end = new Date(fp.getTime() + (1 + Math.floor(rnd() * 900)) * DAY);
      const input = mk({
        productType: pt, rateType: rt, loanAmount: L, contractRatePercent: rate, paymentAmount: pay,
        paymentFrequency: f, disbursalDate: dis, firstPaymentDate: fp, endDate: end, semiAnnualCompoundingDate: dis,
        fees: fee ? FEE(fee, rnd() < 0.7) : { fees: [] },
      });
      let r;
      try {
        // B37 (DEC-B37-LEAP-N): workbook converter (n = 52/26), switch off: `rd` below uses PAYMENTS_PER_YEAR. The on-state
        // twin of this sweep (leap-aware n) is B37-T6 in b37-leap-aware-n.test.ts.
        r = calculateWith(input, SHIPPED, LEAP_OFF);
      } catch (e) {
        // Only the zero-day COB term (B13) and, since B25 (DEV-OQZ), an End Date that is not after the MOVED semi-monthly
        // first date (the draw makes End = first + 1 day at the shortest) may be skipped; anything else (e.g. a B14
        // rejection of a generated input) is a sweep bug and must surface, not silently shrink the sweep.
        const skippable =
          e instanceof RangeError &&
          (/COB-rate term is 0 days/.test(e.message) ||
            (f === 'semiMonthly' && /^endDate must be after firstPaymentDate \(moved to \d{4}-\d{2}-\d{2} for semi-monthly payments/.test(e.message)));
        if (!skippable) throw e;
        skipped += 1;
        continue;
      }
      const rd = calculatedRateFor(pt, rt, rate, PAYMENTS_PER_YEAR[f]).decimal;
      let prior = dis;
      for (const row of r.amortizationSchedule) {
        rows += 1;
        if (!(row.openingBalance > 0)) nonPositive += 1;
        if (!Object.is(row.periodInterest, periodInterest(row.openingBalance, rd, prior, row.date))) mismatches += 1;
        prior = row.date;
      }
    }
    expect(rows).toBeGreaterThan(50000);
    expect(skipped).toBeLessThan(100);
    expect(nonPositive).toBe(0);
    expect(mismatches).toBe(0);
  });
});

// ---------------------------------------------------------------------------------------
// 3. Source guard (red until A5)
// ---------------------------------------------------------------------------------------
describe('A5 source guard: the schedule loop calls periodInterest', () => {
  const src = stripComments(read(join(SRC_CA, 'cobCanada.ts')));
  const start = src.indexOf('function buildSchedule(');
  const end = src.indexOf('\n}\n', start);
  const body = start >= 0 && end > start ? src.slice(start, end) : '';

  it('buildSchedule is found in cobCanada.ts', () => {
    expect(body.length).toBeGreaterThan(0);
  });
  it('[A5] buildSchedule calls periodInterest(', () => {
    expect(body).toMatch(/\bperiodInterest\s*\(/);
  });
  it('[A5] buildSchedule has no inline interest expression and no dayCountFraction( call', () => {
    expect(body).not.toMatch(/calculatedRateDecimal\s*\*/);
    expect(body).not.toMatch(/\bdayCountFraction\s*\(/);
  });
});
