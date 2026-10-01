/**
 * B19 (COB-architecture.md §5 B19, revision 19): no interest on unpaid interest (stakeholder
 * decision 1, Q-W4-INT "oldest first"; DEV-OQL). QA step written 2026-09-29, before the
 * developer step. Rules B19-R1...R8.
 *
 * The engine switch `UNPAID_INTEREST_CAPITALISED` (mechanism M2, ADR-14) ships `false`. `true` is
 * the workbook branch (T6 / OQ-L capitalisation plus the OQ-W interim rule), kept and tested.
 * Vectors V1-V4 and V6 carry closed-form hand checks (Excel cannot produce a shortfall case for
 * the shipped branch; W5 stays a standing request). V5 is the v1 golden corpus case
 * `extra:minimumPayment` case 1. Vector figures were measured on QA's scratch prototype of the
 * brief's exact code (2026-09-29); the hand checks are independent of it.
 *
 * Red until sr-dev lands B19: every test calls `calculateWith` (support/switches.ts), which throws
 * until `cobCanada.ts` exports `calculateCobCanadaWith`, or reads the not-yet-changed sources.
 * All dates are UTC midnight (this file is deliberately not in `test:tz`).
 */
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { calculateCobCanada } from '../../src/ca/index.js';
import type { CobCanadaInput, CobCanadaResult, CobFlow, PaymentFrequency } from '../../src/ca/index.js';
import { SRC_CA, read, stripComments } from '../architecture/support.js';
import { asInput, utcDate } from './support/builders.js';
import { withinRel } from './support/compare.js';
import { rehome } from './support/rehome.js';
import { BOTH, SHIPPED, WORKBOOK, calculateWith } from './support/switches.js';
// @ts-ignore -- plain .mjs shared with the golden generator (no .d.ts).
import * as corpus from './fixtures/generate_golden.mjs';

const POLICIES_MODULE = '../../src/ca/policies.js';
const POLICIES_FILE = join(SRC_CA, 'policies.ts');
const COB_FILE = join(SRC_CA, 'cobCanada.ts');
const d = utcDate;

// ---------------------------------------------------------------------------------------------
// Vectors (brief B19 "Vectors"): monthly personal loan / fixed $100,000 at 6%, payment $400,
// start 2026-12-01, first 2027-01-01, End 2029-01-01, term 2/0, no fees, unless stated.

const BASE_LOAN = {
  productType: 'personalLoan',
  rateType: 'fixed',
  loanAmount: 100000,
  fees: { fees: [] },
  contractRatePercent: 6,
  paymentAmount: 400,
  paymentFrequency: 'monthly',
  firstPaymentDate: d('2027-01-01'),
  endDate: d('2029-01-01'),
  termYears: 2,
  termMonths: 0,
};
// B21 (decision 9): Renewal is mortgage-only, and BASE_LOAN is a personal loan, so the flow is
// paymentChange (the engine treats the two identically; B18-INV-flow-equivalence). Values unchanged.
const renewal = (accruedInterest: number, paymentAmount = 400): CobCanadaInput =>
  asInput({ ...BASE_LOAN, flow: 'paymentChange', renewalDate: d('2026-12-01'), accruedInterest, paymentAmount });

const V1 = asInput({ ...BASE_LOAN, flow: 'newMortgageOrLoan', disbursalDate: d('2026-12-01') });
const V2 = renewal(850.25);
const V3 = renewal(5000);
const V4 = renewal(850.25, 520);
/** A7's input R: renewal, mortgage / variable, IN-11 5,000, paying 100 a month. */
const V6 = asInput({
  flow: 'renewal',
  productType: 'mortgage',
  rateType: 'variable',
  loanAmount: 100000,
  fees: { fees: [] },
  contractRatePercent: 6,
  paymentAmount: 100,
  paymentFrequency: 'monthly',
  renewalDate: d('2027-01-01'),
  firstPaymentDate: d('2027-02-01'),
  endDate: d('2027-12-01'),
  termYears: 1,
  termMonths: 0,
  accruedInterest: 5000,
});
/** v1 corpus case: extra:minimumPayment, first case (weekly, mortgage / variable, fin 2000 + cash 400, payment 0.01). */
const V5: CobCanadaInput = corpus.makeInput({
  first: d('2027-01-01'),
  frequency: 'weekly',
  productType: 'mortgage',
  rateType: 'variable',
  feeSet: 'fin2000cash400',
  flowKey: 'new',
  payment: 0.01,
});

interface Digest {
  rows: number;
  row2Opening: number;
  row1AccClosing: number;
  totalInterest: number;
  cobAmount: number;
  cobRatePercent: number;
  endingBalance: number;
  lastAccClosing: number;
}
const digest = (r: CobCanadaResult): Digest => {
  const s = r.amortizationSchedule;
  return {
    rows: s.length,
    row2Opening: s[1]!.openingBalance,
    row1AccClosing: s[0]!.carriedAccruedInterestClosing,
    totalInterest: r.totalInterest,
    cobAmount: r.cobAmount,
    cobRatePercent: r.cobRatePercent,
    endingBalance: r.endingBalance,
    lastAccClosing: s[s.length - 1]!.carriedAccruedInterestClosing,
  };
};

const D = (
  rows: number,
  row2Opening: number,
  row1AccClosing: number,
  totalInterest: number,
  cobRatePercent: number,
  endingBalance: number,
  lastAccClosing: number,
): Digest => ({ rows, row2Opening, row1AccClosing, totalInterest, cobAmount: totalInterest, cobRatePercent, endingBalance, lastAccClosing });

/** Brief table, exact (`toEqual`). V5 has fees, so its cobAmount differs from totalInterest by the 2,400 of fees. */
const EXPECTED: Record<string, { workbook: Digest; shipped: Digest }> = {
  V1: {
    workbook: D(25, 100109.5890410959, 109.58904109589042, 12665.681065440427, 6, 102665.68106544043, 2665.681065440427),
    shipped: D(25, 100000, 109.58904109589042, 12509.589041095891, 6, 100000, 2509.589041095891),
  },
  V2: {
    workbook: D(25, 100000, 959.8390410958905, 10000, 6, 100000, 3359.8390410958914),
    shipped: D(25, 100000, 959.8390410958905, 13359.839041095891, 6, 100000, 3359.8390410958914),
  },
  V3: {
    workbook: D(25, 100000, 5109.58904109589, 10000, 6, 100000, 7509.589041095886),
    shipped: D(25, 100000, 5109.58904109589, 17509.589041095885, 6, 100000, 7509.589041095886),
  },
  V4: {
    workbook: D(25, 100000, 839.8390410958905, 13000, 6, 100000, 359.8390410958914),
    shipped: D(25, 100000, 839.8390410958905, 13359.839041095891, 6, 100000, 359.8390410958914),
  },
  V6: {
    workbook: D(11, 100000, 5409.58904109589, 1100, 6, 100000, 9390.410958904107),
    shipped: D(11, 100000, 5409.58904109589, 6590.410958904107, 6, 100000, 9390.410958904107),
  },
  V5: {
    workbook: {
      rows: 105,
      row2Opening: 250355.4694520548,
      row1AccClosing: 355.4694520547945,
      totalInterest: 27606.563231143715,
      cobAmount: 30006.563231143715,
      cobRatePercent: 5.632241248416552,
      endingBalance: 277605.5132311437,
      lastAccClosing: 27605.513231143716,
    },
    shipped: {
      rows: 105,
      row2Opening: 250000,
      row1AccClosing: 355.4694520547945,
      totalInterest: 26199.126993038433,
      cobAmount: 28599.126993038433,
      cobRatePercent: 5.657821871251506,
      endingBalance: 250000,
      lastAccClosing: 26198.076993038434,
    },
  },
};
const VECTORS: Record<string, CobCanadaInput> = { V1, V2, V3, V4, V5, V6 };

const sum = (xs: number[]) => xs.reduce((s, x) => s + x, 0);

// =============================================================================================

describe('B19 switch constant and source shape (DEV-OQL, ADR-14)', () => {
  it('B19-PIN-1: UNPAID_INTEREST_CAPITALISED === false (the shipped value)', async () => {
    const mod = (await import(/* @vite-ignore */ POLICIES_MODULE)) as Record<string, unknown>;
    expect(mod.UNPAID_INTEREST_CAPITALISED).toBe(false);
  });

  it('B19-PIN-2: policies.ts JSDoc and declaration, cobCanada.ts wiring (M2: no satisfies pin)', () => {
    const src = read(POLICIES_FILE);
    const m = src.match(/(\/\*\*(?:(?!\*\/)[\s\S])*\*\/)\s*export\s+const\s+UNPAID_INTEREST_CAPITALISED\b/);
    expect(m, 'UNPAID_INTEREST_CAPITALISED: no JSDoc directly above').not.toBeNull();
    const doc = m![1]!;
    expect(doc).not.toMatch(/\bexport\s+const\b/);
    expect(doc.match(/@(\w+)/)?.[1]).toBe('decision');
    expect(doc.match(/@decision\s+(OQ-[A-Za-z0-9]+)/)?.[1]).toBe('OQ-L');
    expect(doc).toContain('Switch (ADR-14): shipped `false`; the other branch `true` is built and tested.');
    expect(stripComments(src)).toMatch(/\bexport\s+const\s+UNPAID_INTEREST_CAPITALISED\s*=\s*false\s*;/);

    const cob = stripComments(read(COB_FILE));
    expect(cob).not.toMatch(/\bUNPAID_INTEREST_CAPITALISED\s+satisfies\b/);
    const flat = cob.replace(/\s+/g, ' ');
    expect(flat).toContain(
      'export function calculateCobCanada(input: CobCanadaInput): CobCanadaResult { return calculateCobCanadaWith(input, SHIPPED_SWITCHES); }',
    );
    expect(flat).toMatch(
      /export const SHIPPED_SWITCHES: EngineSwitches = Object\.freeze\(\{ unpaidInterestCapitalised: UNPAID_INTEREST_CAPITALISED,? \}\);/,
    );
  });

  it('B19-API: calculateCobCanadaWith / SHIPPED_SWITCHES are on neither barrel; calculateCobCanada is the shipped branch', () => {
    for (const barrel of [join(SRC_CA, 'index.ts'), join(SRC_CA, '..', 'index.ts')]) {
      const code = stripComments(read(barrel));
      expect(code, barrel).not.toMatch(/calculateCobCanadaWith|SHIPPED_SWITCHES|EngineSwitches/);
    }
    for (const [id, x] of Object.entries(VECTORS)) {
      expect(JSON.stringify(calculateCobCanada(x)), id).toBe(JSON.stringify(calculateWith(x, SHIPPED)));
    }
  });
});

// =============================================================================================

describe('B19-V vectors: both switch states, exact figures (table in the brief)', () => {
  for (const id of ['V1', 'V2', 'V3', 'V4', 'V5', 'V6']) {
    it.each(BOTH)(`B19-${id} %s`, (label, switches) => {
      const r = calculateWith(VECTORS[id]!, switches);
      const shipped = switches === SHIPPED;
      expect(digest(r)).toEqual(shipped ? EXPECTED[id]!.shipped : EXPECTED[id]!.workbook);
      if (!shipped) return;

      const s = r.amortizationSchedule;
      // B19-R5: the balance never holds unpaid interest.
      for (const row of s) expect(row.closingBalance).toBe(row.openingBalance - row.feesPaid - row.principalPortion);
      const periodTotal = sum(s.map((x) => x.periodInterest));
      if (id === 'V1') {
        // Hand check: 6,000 x (31/365 + 365/365 + 366/366); the 2028 leap year is split by equation 3.
        expect(withinRel(r.totalInterest, 6000 * (31 / 365 + 1 + 1), 1e-12)).toBe(true);
        expect(withinRel(r.totalInterest, periodTotal, 1e-12)).toBe(true);
      }
      if (id === 'V2' || id === 'V4') {
        // IN-11 fully paid: V1's period interest plus the 850.25 paid.
        expect(withinRel(r.totalInterest, 6000 * (31 / 365 + 1 + 1) + 850.25, 1e-12)).toBe(true);
      }
      if (id === 'V3') {
        // Oldest first (Q-W4-INT): payments (10,000) exceed IN-11, so all 5,000 is paid and counts;
        // period-first would give 12,509.59.
        expect(withinRel(r.totalInterest, 6000 * (31 / 365 + 1 + 1) + 5000, 1e-12)).toBe(true);
      }
      if (id === 'V6') {
        // Two C rules in one bucket: 1,100 paid, all of it to IN-11 (counted), 5,490.41 period interest
        // charged and unpaid (counted); the 3,900 IN-11 still owed is in the bucket, not in C.
        expect(withinRel(periodTotal, 5490.410958904109, 1e-12)).toBe(true);
        expect(r.totalInterest).toBe(6590.410958904107);
        expect(withinRel(r.totalInterest, periodTotal + 1100, 1e-12)).toBe(true);
        expect(withinRel(s[s.length - 1]!.carriedAccruedInterestClosing, 3900 + periodTotal, 1e-12)).toBe(true);
      }
    });
  }
});

// =============================================================================================
// B19-INV: one deterministic sweep of 4,000 inputs (LCG seed 20260929).

interface SweepCase {
  input: CobCanadaInput;
  in11: number;
}

const FREQS: PaymentFrequency[] = ['weekly', 'biweekly', 'semiMonthly', 'monthly', 'acceleratedWeekly', 'acceleratedBiweekly'];
const FLOW_LIST: CobFlow[] = ['newMortgageOrLoan', 'renewal', 'paymentChange', 'variableRatePaymentChange'];
const PPY: Record<PaymentFrequency, number> = {
  weekly: 52,
  biweekly: 26,
  semiMonthly: 24,
  monthly: 12,
  acceleratedWeekly: 52,
  acceleratedBiweekly: 26,
};
const DAY_MS = 86_400_000;

function buildSweep(n: number): SweepCase[] {
  let seed = 20260929;
  const next = (): number => {
    seed = (seed * 1103515245 + 12345) % 2 ** 31;
    return seed / 2 ** 31;
  };
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(next() * xs.length)]!;
  const out: SweepCase[] = [];
  for (let i = 0; i < n; i++) {
    const flow = pick(FLOW_LIST);
    const frequency = pick(FREQS);
    const [productType, rateType] =
      flow === 'variableRatePaymentChange' ? (['mortgage', 'variable'] as const) : pick([['mortgage', 'fixed'], ['mortgage', 'variable'], ['personalLoan', 'fixed'], ['personalLoan', 'variable']] as const);
    const loan = 50000 + Math.round(next() * 450000);
    const rate = 2 + Math.round(next() * 70) / 10;
    const periodInterestApprox = (loan * rate) / 100 / PPY[frequency];
    const payment = Math.round(periodInterestApprox * (0.3 + next() * 4.7) * 100) / 100 + 0.01;
    const in11 = flow === 'newMortgageOrLoan' ? 0 : pick([0, 37.5, 850.25, 3 * periodInterestApprox, loan * 0.05]);
    const feeKind = pick(['none', 'financed', 'both'] as const);
    const fees = [
      ...(feeKind !== 'none' ? [{ name: 'Financed', amount: 500 + Math.round(next() * 2500), financed: true, includedInCob: true }] : []),
      ...(feeKind === 'both' ? [{ name: 'Cash', amount: 100 + Math.round(next() * 700), financed: false, includedInCob: true }] : []),
    ];
    // First payment date: a 15th or a month end for semi-monthly, any day otherwise; start is before it.
    const monthOffset = Math.floor(next() * 24);
    const first =
      frequency === 'semiMonthly'
        ? next() < 0.5
          ? new Date(Date.UTC(2027, monthOffset, 15))
          : new Date(Date.UTC(2027, monthOffset + 1, 0))
        : new Date(Date.UTC(2027, 0, 1) + Math.floor(next() * 700) * DAY_MS);
    const start = new Date(first.getTime() - 10 * DAY_MS);
    const years = 1 + Math.floor(next() * 3);
    const end = new Date(Date.UTC(first.getUTCFullYear() + years, first.getUTCMonth(), first.getUTCDate()));
    const input: Record<string, unknown> = {
      // B21 (decision 9): Renewal + personal loan is rejected; send it as paymentChange (same engine path).
      flow: flow === 'renewal' && productType === 'personalLoan' ? 'paymentChange' : flow,
      productType,
      rateType,
      loanAmount: loan,
      fees: { fees },
      contractRatePercent: rate,
      paymentAmount: payment,
      paymentFrequency: frequency,
      firstPaymentDate: first,
      endDate: end,
      termYears: years,
      termMonths: 0,
    };
    if (flow === 'newMortgageOrLoan') input.disbursalDate = start;
    else {
      input.renewalDate = start;
      input.accruedInterest = in11;
    }
    if (productType === 'mortgage' && rateType === 'fixed') input.semiAnnualCompoundingDate = start;
    out.push({ input: asInput(rehome(input)), in11 }); // B27: DEV-FB24 class D (final input through the twin; every draw unchanged)
  }
  return out;
}

let sweepCache: { c: SweepCase; shipped: CobCanadaResult }[] | undefined;
const sweep = () => (sweepCache ??= buildSweep(4000).map((c) => ({ c, shipped: calculateWith(c.input, SHIPPED) })));

describe('B19-INV sweep (4,000 deterministic inputs, shipped branch)', () => {
  it('B19-INV-nonneg: every carried accrued interest >= 0 and totalInterest - sum(interestPaid) >= 0 (B19-R6)', () => {
    let checked = 0;
    for (const { c, shipped } of sweep()) {
      const s = shipped.amortizationSchedule;
      for (const row of s) {
        if (!(row.carriedAccruedInterestOpening >= 0 && row.carriedAccruedInterestClosing >= 0)) {
          throw new Error(`negative bucket: ${JSON.stringify(c.input)} row ${row.period}`);
        }
      }
      expect(shipped.totalInterest - sum(s.map((x) => x.interestPaid))).toBeGreaterThanOrEqual(0);
      checked += 1;
    }
    expect(checked).toBe(4000);
  });

  it('B19-INV-balance: closingBalance = openingBalance - feesPaid - principalPortion exactly; rows chain exactly (B19-R5, R2)', () => {
    for (const { c, shipped } of sweep()) {
      const s = shipped.amortizationSchedule;
      expect(s[0]!.carriedAccruedInterestOpening, JSON.stringify(c.input)).toBe(c.in11);
      s.forEach((row, i) => {
        if (row.closingBalance !== row.openingBalance - row.feesPaid - row.principalPortion) {
          throw new Error(`balance identity: ${JSON.stringify(c.input)} row ${row.period}`);
        }
        if (i > 0) {
          const prev = s[i - 1]!;
          if (row.openingBalance !== prev.closingBalance || row.carriedAccruedInterestOpening !== prev.carriedAccruedInterestClosing) {
            throw new Error(`chain: ${JSON.stringify(c.input)} row ${row.period}`);
          }
        }
      });
    }
  });

  it('B19-INV-C: totalInterest = sum(periodInterest) + min(IN-11, sum(interestPaid)) within 1e-9 (B19-R4)', () => {
    for (const { c, shipped } of sweep()) {
      const s = shipped.amortizationSchedule;
      const expected = sum(s.map((x) => x.periodInterest)) + Math.min(c.in11, sum(s.map((x) => x.interestPaid)));
      if (!withinRel(shipped.totalInterest, expected, 1e-9)) {
        throw new Error(`C: ${shipped.totalInterest} vs ${expected} for ${JSON.stringify(c.input)}`);
      }
    }
  });

  it('B19-INV-noshortfall: where no workbook row carries unpaid interest out, both states are identical', () => {
    let same = 0;
    for (const { c, shipped } of sweep()) {
      const wb = calculateWith(c.input, WORKBOOK);
      if (wb.amortizationSchedule.some((row) => row.carriedAccruedInterestClosing > 0)) continue;
      same += 1;
      if (JSON.stringify(wb) !== JSON.stringify(shipped)) throw new Error(`differs: ${JSON.stringify(c.input)}`);
    }
    // Guard against a vacuous sweep (brief: 1,305 of 20,000 inputs, about 6.5%).
    expect(same).toBeGreaterThanOrEqual(50);
  });
});
