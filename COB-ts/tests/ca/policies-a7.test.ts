/**
 * A7 (COB-architecture.md §5 A7 and §3.4, revision 9): `src/ca/policies.ts`, one named constant
 * per open business decision, read by `cobCanada.ts` through mechanism M1
 * (`NAME satisfies <today's literal>;` at the read site). QA step written 2026-09-28, before
 * the developer step. Pure structure: engine output, messages, public API and UI unchanged.
 *
 * Pending decisions, NOT settled here. Every literal below is today's behaviour:
 * - OQ-Q  P_BASIS                     'openingBalance'        (alt 'openingPrincipal', macro col E)
 * - OQ-R  PRINCIPAL_PAID              'sumOfPrincipalPortion' (alt 'totalPaymentMinusInterest')
 * - OQ-W  PRIOR_ACCRUED_IN_COB        'whenPaid'              (W2; alt 'never', 'inFull')
 * - OQ-W  PRIOR_ACCRUED_IN_P          false                   (W3; alt true)
 *
 * B19 (revision 19, DEV-OQL, 2026-09-29): W1 and W4 are decided and RETIRED (no constant, no pin);
 * `UNPAID_INTEREST_CAPITALISED` (OQ-L) is a decided engine switch (mechanism M2, ADR-14): shipped
 * `false`, no `satisfies` pin, both branches built. It is not in POLICY_TABLE (that table is the
 * M1 open decisions); it is covered by A7-1 / A7-2 export lists and by b19-unpaid-interest.test.ts.
 * The A7-3 characterisations of unpaid interest run against both switch states.
 *
 * Red until the developer lands A7: A7-1 (policies.ts does not exist) and A7-2 (source guard).
 * Green now and must stay green: A7-3 (characterisation, exact `toBe` values measured on the
 * pre-A7 build, identical to the architect's revision 9 measurements).
 * A7-4 (each constant mutated -> `tsc` fails with TS1360 at its pin) is a QA verification step,
 * not a suite test.
 *
 * All dates are UTC midnight and at least one month apart, so nothing here is time-zone
 * sensitive (this file is deliberately not in `test:tz`).
 */
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { calculateCobCanada } from '../../src/ca/index.js';
import { calculatedRateFor, costOfBorrowingRatePercent } from '../../src/ca/equations.js';
import type { CobCanadaInput, CobScheduleRow } from '../../src/ca/index.js';
import { SRC_CA, read, stripComments } from '../architecture/support.js';
import { asInput, utcDate } from './support/builders.js';
import { BOTH, SHIPPED, calculateWith } from './support/switches.js';

// ---------------------------------------------------------------------------------------------
// policies.ts is loaded lazily so that A7-3 runs (green) while the module does not exist yet.

const POLICIES_MODULE = '../../src/ca/policies.js';
const POLICIES_FILE = join(SRC_CA, 'policies.ts');
const COB_FILE = join(SRC_CA, 'cobCanada.ts');

/** §5 A7 table: export name, exact literal, @decision ID, and the alternatives its JSDoc names. */
const POLICY_TABLE: ReadonlyArray<{ name: string; value: string | boolean; decision: string; alternatives: string[] }> = [
  { name: 'P_BASIS', value: 'openingBalance', decision: 'OQ-Q', alternatives: ['openingPrincipal'] },
  { name: 'PRINCIPAL_PAID', value: 'sumOfPrincipalPortion', decision: 'OQ-R', alternatives: ['totalPaymentMinusInterest'] },
  { name: 'PRIOR_ACCRUED_IN_COB', value: 'whenPaid', decision: 'OQ-W', alternatives: ['never', 'inFull'] },
  { name: 'PRIOR_ACCRUED_IN_P', value: false, decision: 'OQ-W', alternatives: ['true'] },
];

/** B19: the decided switch, exported after the four M1 constants. */
const SWITCH_NAME = 'UNPAID_INTEREST_CAPITALISED';

const literalSource = (v: string | boolean) => (typeof v === 'string' ? `'${v}'` : String(v));
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** `NAME satisfies <literal>;` with either quote style for string literals. */
const pinRe = (name: string, v: string | boolean, flags = 'g') =>
  new RegExp(
    `\\b${name}\\s+satisfies\\s+${typeof v === 'string' ? `(['"])${escapeRe(v)}\\1` : String(v)}\\s*;`,
    flags,
  );

/** Code (comments blanked) of cobCanada.ts split at the three function headers. */
function cobSections(): { buildSchedule: string; averageOutstandingBalance: string; calculateCobCanada: string } {
  const code = stripComments(read(COB_FILE));
  const b = code.search(/\bfunction\s+buildSchedule\s*\(/);
  const a = code.search(/\bfunction\s+averageOutstandingBalance\s*\(/);
  const c = code.search(/\bexport\s+function\s+calculateCobCanada\s*\(/);
  expect([b >= 0, a >= 0, c >= 0]).toEqual([true, true, true]);
  expect(b < a && a < c).toBe(true);
  return { buildSchedule: code.slice(b, a), averageOutstandingBalance: code.slice(a, c), calculateCobCanada: code.slice(c) };
}

// ---------------------------------------------------------------------------------------------
// A7-3 inputs (§5 A7 "Characterisation").

const d = utcDate;
const sum = (rows: CobScheduleRow[], f: (r: CobScheduleRow) => number) => rows.reduce((s, r) => s + f(r), 0);

/** Base input R: renewal, mortgage/variable, IN-11 = 5000, underpaying 100/month. */
const R = asInput({
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

const FIN_FEE = { name: 'f', amount: 1000, financed: true, includedInCob: true };
const CASH_FEE = { name: 'c', amount: 400, financed: false, includedInCob: true };

/** Input N: R as a new mortgage (no renewalDate / accruedInterest), payment 2000, fees 1000 + 400. */
const N = (() => {
  const { renewalDate: _r, accruedInterest: _a, ...rest } = R as unknown as Record<string, unknown>;
  return asInput({
    ...rest,
    flow: 'newMortgageOrLoan',
    disbursalDate: d('2027-01-01'),
    paymentAmount: 2000,
    fees: { fees: [FIN_FEE, CASH_FEE] },
  });
})();

// =============================================================================================

describe('A7-1 policies.ts: export list and exact values (red until A7)', () => {
  it('A7-1: runtime exports are exactly the four open-decision constants plus the B19 switch and (B24) the Q-SACD switch', async () => {
    const mod = (await import(/* @vite-ignore */ POLICIES_MODULE)) as Record<string, unknown>;
    expect(Object.keys(mod).sort()).toEqual([
      'PRINCIPAL_PAID',
      'PRIOR_ACCRUED_IN_COB',
      'PRIOR_ACCRUED_IN_P',
      'P_BASIS',
      'SEMI_ANNUAL_DATE_REQUIRED',
      'UNPAID_INTEREST_CAPITALISED',
    ]);
  });

  for (const { name, value, decision } of POLICY_TABLE) {
    it(`A7-1: ${name} === ${literalSource(value)} (${decision}, today's value, not settled)`, async () => {
      const mod = (await import(/* @vite-ignore */ POLICIES_MODULE)) as Record<string, unknown>;
      expect(mod[name]).toBe(value);
    });
  }
});

// =============================================================================================

describe('A7-2 source guard (red until A7)', () => {
  it('A7-2: policies.ts exists and has no import, no export list, no exported type/interface/function/let/var/class/enum/default', () => {
    expect(existsSync(POLICIES_FILE)).toBe(true);
    const code = stripComments(read(POLICIES_FILE));
    expect(code).not.toMatch(/\bimport\b/);
    expect(code).not.toMatch(/\bexport\s*\{/);
    expect(code).not.toMatch(/\bexport\s*\*/);
    expect(code).not.toMatch(/\bexport\s+(?:declare\s+)?(?:type|interface|function|async|let|var|class|enum|abstract|default)\b/);
  });

  it('A7-2: policies.ts constants carry no type annotation (M1 needs the literal types)', () => {
    const code = stripComments(read(POLICIES_FILE));
    expect(code).not.toMatch(/\bexport\s+const\s+\w+\s*:/);
    // No `as` widening / `as const` on the value either: the literal type must come from the initialiser.
    for (const { name, value } of POLICY_TABLE) {
      expect(code).toMatch(
        new RegExp(`\\bexport\\s+const\\s+${name}\\s*=\\s*${typeof value === 'string' ? `(['"])${escapeRe(value)}\\1` : String(value)}\\s*;`),
      );
    }
  });

  it('A7-2: policies.ts declares exactly six exports: the four M1 constants, then the B19 switch (in order), and (B24) SEMI_ANNUAL_DATE_REQUIRED after them', () => {
    const code = stripComments(read(POLICIES_FILE));
    const names = [...code.matchAll(/\bexport\s+const\s+(\w+)/g)].map((m) => m[1]);
    expect(names).toEqual([...POLICY_TABLE.map((p) => p.name), SWITCH_NAME, 'SEMI_ANNUAL_DATE_REQUIRED']);
  });

  for (const { name, decision, alternatives } of POLICY_TABLE) {
    it(`A7-2: ${name} is directly preceded by a JSDoc whose first tag is @decision ${decision} and that names the alternatives`, () => {
      const src = read(POLICIES_FILE);
      const m = src.match(new RegExp(`(\\/\\*\\*(?:(?!\\*\\/)[\\s\\S])*\\*\\/)\\s*export\\s+const\\s+${name}\\b`));
      expect(m, `${name}: no JSDoc directly above`).not.toBeNull();
      const doc = m![1]!;
      // Only the doc block directly above: it must not swallow a previous export.
      expect(doc).not.toMatch(/\bexport\s+const\b/);
      expect(doc.match(/@(\w+)/)?.[1]).toBe('decision');
      // F7a regex: `@decision OQ-W4` would not register, so the tag is exactly the OQ ID.
      expect(doc.match(/@decision\s+(OQ-[A-Za-z0-9]+)/)?.[1]).toBe(decision);
      for (const alt of alternatives) expect(doc, `${name}: alternative ${alt}`).toMatch(new RegExp(`\\b${escapeRe(alt)}\\b`));
    });
  }

  for (const { name, value } of POLICY_TABLE) {
    it(`A7-2: cobCanada.ts contains \`${name} satisfies ${literalSource(value)};\` exactly once`, () => {
      const code = stripComments(read(COB_FILE));
      expect(code.match(pinRe(name, value))?.length ?? 0).toBe(1);
    });
  }

  it('A7-2: cobCanada.ts imports the four constants and the B19 switch from ./policies.js', () => {
    const code = stripComments(read(COB_FILE));
    const m = code.match(/import\s*\{([^}]*)\}\s*from\s*['"]\.\/policies\.js['"]/);
    expect(m).not.toBeNull();
    const names = m![1]!.split(',').map((s) => s.trim()).filter(Boolean).sort();
    expect(names).toEqual([...POLICY_TABLE.map((p) => p.name), SWITCH_NAME].sort());
  });

  it('A7-2 (B19): W1 and W4 are retired: no constant in policies.ts or cobCanada.ts, and buildSchedule has no satisfies pin', () => {
    const { buildSchedule } = cobSections();
    const policies = stripComments(read(POLICIES_FILE));
    const cob = stripComments(read(COB_FILE));
    for (const retired of ['PRIOR_ACCRUED_EARNS_INTEREST', 'PRIOR_ACCRUED_PAYMENT_ORDER']) {
      expect(policies, retired).not.toContain(retired);
      expect(cob, retired).not.toContain(retired);
    }
    expect(buildSchedule).not.toMatch(/\bsatisfies\b/);
  });

  it('A7-2: OQ-Q and W3 pins are the first and second statements of averageOutstandingBalance', () => {
    const { averageOutstandingBalance } = cobSections();
    expect(averageOutstandingBalance).toMatch(
      new RegExp(
        `^function\\s+averageOutstandingBalance\\s*\\([^)]*\\)\\s*:\\s*number\\s*\\{\\s*` +
          `${pinRe('P_BASIS', 'openingBalance').source}\\s*` +
          `${pinRe('PRIOR_ACCRUED_IN_P', false).source}\\s*return\\b`,
      ),
    );
  });

  it('A7-2: W2 and OQ-R pins are in calculateCobCanada, directly before their statements', () => {
    const { calculateCobCanada: calc } = cobSections();
    expect(calc).toMatch(new RegExp(`${pinRe('PRIOR_ACCRUED_IN_COB', 'whenPaid').source}\\s*const\\s+totalInterest\\s*=`));
    expect(calc).toMatch(
      new RegExp(`${pinRe('PRINCIPAL_PAID', 'sumOfPrincipalPortion').source}\\s*const\\s+principalPayment\\s*=`),
    );
  });

  it('A7-2: no src/ca file other than cobCanada.ts and (B24-R5: the Q-SACD switch is the default of requiresSemiAnnualDate) flows.ts, and policies.ts itself, mentions policies in code', () => {
    const offenders = readdirSync(SRC_CA)
      .filter((f) => f.endsWith('.ts') && f !== 'cobCanada.ts' && f !== 'flows.ts' && f !== 'policies.ts')
      .filter((f) => /policies/.test(stripComments(read(join(SRC_CA, f)))));
    expect(offenders).toEqual([]);
  });
});

// =============================================================================================

describe('A7-3 characterisation of today (green now, must stay green)', () => {
  // B19: while IN-11 is owed, both branches pool it with period interest outside the balance (W1 fixed rule).
  it.each(BOTH)('A7-W1/W3/W4 %s: IN-11 is pooled with period interest outside the balance, earning no interest', (_label, switches) => {
    const r = calculateWith(R, switches);
    const s = r.amortizationSchedule;
    expect(s.length).toBe(11);
    for (const row of s) {
      expect(row.openingBalance).toBe(100000);
      expect(row.closingBalance).toBe(100000);
    }
    expect(s[0]!.periodInterest).toBe(509.5890410958904);
    expect(s[0]!.carriedAccruedInterestOpening).toBe(5000);
    expect(s[0]!.interestPaid).toBe(100);
    expect(s[0]!.carriedAccruedInterestClosing).toBe(5409.58904109589);
    expect(s[1]!.carriedAccruedInterestOpening).toBe(5409.58904109589);
    expect(s[1]!.carriedAccruedInterestClosing).toBe(5769.863013698629);
    expect(s[10]!.carriedAccruedInterestClosing).toBe(9390.410958904107);
    expect(r.endingBalance).toBe(100000);
  });

  it.each(BOTH)('A7-OQL-contrast %s: with no IN-11 the unpaid period interest is capitalised (workbook) or kept outside the balance (shipped, DEV-OQL)', (_label, switches) => {
    const r = calculateWith({ ...R, accruedInterest: 0 } as CobCanadaInput, switches);
    if (switches === SHIPPED) {
      expect(r.amortizationSchedule[1]!.openingBalance).toBe(100000);
      expect(r.totalInterest).toBe(5490.410958904109);
      expect(r.endingBalance).toBe(100000);
      return;
    }
    expect(r.amortizationSchedule[1]!.openingBalance).toBe(100409.5890410959);
    expect(r.totalInterest).toBe(5601.523432386113);
    expect(r.endingBalance).toBe(104501.52343238611);
  });

  it.each(BOTH)("A7-W2 ('whenPaid') %s: IN-11 pool still unpaid at the end is not in C (workbook: all interest paid only; shipped: plus period interest charged)", (_label, switches) => {
    const r = calculateWith(R, switches);
    // Workbook branch: 1,100 paid. Shipped branch (B19-R4): 1,100 paid plus the 5,490.41 of period interest
    // charged; the 3,900 of IN-11 still owed is in neither.
    const expectedC = switches === SHIPPED ? 6590.410958904107 : 1100;
    expect(r.totalInterest).toBe(expectedC);
    expect(r.totalPayment).toBe(1100);
    expect(r.cobAmount).toBe(expectedC);
    expect(sum(r.amortizationSchedule, (x) => x.periodInterest)).toBe(5490.410958904109);
  });

  it("A7-W2 ('whenPaid'): IN-11 paid in full counts in totalInterest; P = mean openingBalance", () => {
    const r = calculateCobCanada({ ...R, paymentAmount: 2000, fees: { fees: [FIN_FEE] } } as CobCanadaInput);
    const s = r.amortizationSchedule;
    const sumPeriodInterest = sum(s, (x) => x.periodInterest);
    expect(sumPeriodInterest).toBe(5295.01837110251);
    expect(r.totalInterest).toBe(10295.01837110251);
    expect(r.totalInterest).toBe(sumPeriodInterest + 5000);
    expect(r.cobAmount).toBe(11295.01837110251);
    expect(r.cobRatePercent).toBe(12.796832132686257);
    expect(sum(s, (x) => x.openingBalance) / s.length).toBe(96456.35944563309);
  });

  it("A7-Q/R: principalPayment = Σ principalPortion; P = mean openingBalance ('openingBalance')", () => {
    const r = calculateCobCanada(N);
    const s = r.amortizationSchedule;
    expect(r.principalPayment).toBe(15929.88323979968);
    expect(r.principalPayment).toBe(sum(s, (x) => x.principalPortion));
    // The OQ-R alternative (total payment minus interest) would differ by the 1000 financed fee.
    expect(r.totalPayment - r.totalInterest).toBe(16929.88323979968);
    expect(r.totalPayment - r.totalInterest).toBe(r.principalPayment + r.feesRecovered);
    expect(r.feesRecovered).toBe(1000);
    expect(r.termDays).toBe(334);
    const meanOpening = sum(s, (x) => x.openingBalance) / s.length;
    expect(meanOpening).toBe(92372.53889580503);
    expect(r.cobRatePercent).toBe(7.65447898670016);
    expect(r.cobRatePercent).toBe(
      costOfBorrowingRatePercent(
        calculatedRateFor('mortgage', 'variable', 6, 12).decimal,
        1000,
        400,
        r.cobAmount,
        r.termDays / 365,
        meanOpening,
      ),
    );
  });
});
