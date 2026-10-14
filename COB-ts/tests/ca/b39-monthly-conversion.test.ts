/**
 * B39 (spec docs/new-req/014-b39-monthly-conversion-variable-personal-loan.md; user decision DEC-B39-VAR-PL-M12, 2026-10-13;
 * deviation DEV-B39-M12): the MONTHLY rate basis (variable-rate mortgage, personal loan of either rate type) at the 7- and
 * 14-day frequencies is converted by equation 1 at m = 12 with B37's leap-aware n and B38's Y; period interest is not
 * rounded. Switch MONTHLY_RATE_CONVERSION (ADR-14), shipped true, effective only while LEAP_AWARE_PAYMENTS_PER_YEAR is true.
 *
 * Expected values come from QA's own oracle (support/leapNOracle.ts, no src/ import) and the user's Excel registry
 * (COB-py/tests/fixtures/ca_user_excel_examples.json), never from src/.
 *
 * "Tests pass" is not "matches Excel": only UX-001, UX-002 and UX-004 are Excel matches; UX-003 is a 1-cent known gap
 * (Q-B39-VAR1-CENT); the pending-excel entries are predictions. Nothing here is checked against the reference workbook,
 * which B39 deliberately departs from (the workbook-parity tests run with the switch off).
 */
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import * as ca from '../../src/ca/index.js';
import * as root from '../../src/index.js';
import { PAYMENTS_PER_YEAR, calculateCobCanada, paymentsPerYearFor } from '../../src/ca/index.js';
import type { CobCanadaInput, CobCanadaResult, PaymentFrequency, ProductType, RateType } from '../../src/ca/index.js';
import { calculatedRateFor, conversionPaymentsPerYear, convertsMonthlyRate, periodInterest } from '../../src/ca/equations.js';
import { MONTHLY_RATE_CONVERSION } from '../../src/ca/policies.js';
import type * as View from '../../ui/ca-view.js';
import { ROOT, SRC_CA, read, stripComments } from '../architecture/support.js';
import { asInput, oracleCaseInput, utcDate } from './support/builders.js';
import { FIXTURES_DIR, applyCaptureUndo, loadFixture } from './support/fixtures.js';
import type { CaptureUndo } from './support/fixtures.js';
import {
  ORACLE_PERIOD_DAYS,
  civilDays,
  oracleMonthlyConvertedDecimal,
  oracleN,
  oracleRoundCent,
  oracleSchedule,
  oracleYearFracBasis1,
} from './support/leapNOracle.js';
import type { OracleCase } from './support/leapNOracle.js';
import { DAY_BASED, SIX, buildSweep } from './support/leapSweep.js';
import type { SweepCase } from './support/leapSweep.js';
import { b38StateGoldenText } from './support/preB37Golden.js';
import { B39_OFF, B39_ON, SHIPPED, WORKBOOK, calculateWith } from './support/switches.js';
// @ts-ignore -- plain .mjs shared with the generator (no .d.ts).
import * as gen1 from './fixtures/generate_golden.mjs';
// @ts-ignore -- plain .mjs shared with the generator (no .d.ts).
import * as genPc from './fixtures/generate_golden_pc.mjs';

const loadView = () => import('../../ui/ca-view.js') as Promise<typeof View>;
const sha256 = (s: string): string => createHash('sha256').update(s).digest('hex');
const json = (r: unknown): string => JSON.stringify(r);
/** Whole cents of a 2-dp figure (registry figures are exact to the cent). */
const toCents = (x: number): number => Math.round(x * 100);

/** The shipped state, explicitly (all three switches true). */
const shipped = (x: CobCanadaInput): CobCanadaResult => calculateWith(x, SHIPPED, true, true, B39_ON);
/** The B38 state of spec 014's switch table, (true, true, false): today's engine before B39. */
const b38State = (x: CobCanadaInput): CobCanadaResult => calculateWith(x, SHIPPED, true, true, B39_OFF);
/** B39 with B37's Y, (true, false, true): built and tested, no Excel evidence (INV-B39-STATES). */
const b39B37Y = (x: CobCanadaInput): CobCanadaResult => calculateWith(x, SHIPPED, true, false, B39_ON);

const isMonthlyBasis = (pt: string, rt: string): boolean => !(pt === 'mortgage' && rt === 'fixed');
/** Predicate M with leapAware on, from the spec (E-B39-1), not from src/. */
const inScope = (pt: string, rt: string, f: string, start: string, end: string): boolean =>
  isMonthlyBasis(pt, rt) && DAY_BASED.has(f) && civilDays(end) > civilDays(start);

// ------------------------------------------------------------------------------------------------ the registry
interface RegistryEntry {
  id: string;
  label: string;
  status: 'match' | 'known-gap' | 'pending-excel';
  input: OracleCase & { frequency: string };
  inferred: { field: string }[];
  excel: Record<string, number | string> | null;
  expected: Record<string, number>;
  gapCents?: Record<string, number>;
  decisions: string[];
}
interface Registry {
  examples: RegistryEntry[];
}
const REGISTRY_FILE = 'ca_user_excel_examples.json';
const REGISTRY = loadFixture<Registry>(REGISTRY_FILE);
const regInput = (e: RegistryEntry): CobCanadaInput => oracleCaseInput(e.input as OracleCase);
const byId = (id: string): RegistryEntry => {
  const e = REGISTRY.examples.find((x) => x.id === id);
  if (!e) throw new Error(`no registry entry ${id}`);
  return e;
};
/** The open item an entry's test title carries: the first Q- ID in the entry outside `input`; pending B39 examples without
 *  one fall back to Q-B39-PL-EXAMPLE (spec 014 consumption rule 3). */
const openItem = (e: RegistryEntry): string | undefined => {
  const { input: _input, ...rest } = e;
  return /\bQ-[A-Z0-9]+(?:-[A-Z0-9]+)*\b/.exec(JSON.stringify(rest))?.[0] ?? (e.status === 'pending-excel' ? 'Q-B39-PL-EXAMPLE' : undefined);
};
const titleOf = (e: RegistryEntry): string => {
  const tag = e.status === 'known-gap' ? `known_divergence ${openItem(e)}` : e.status === 'pending-excel' ? `PENDING ${openItem(e)}` : 'match';
  return `${e.id} ${e.label} [${e.status}] ${tag}`;
};

// ------------------------------------------------------------------------------------------------ the oracle vectors
interface B39Totals {
  n: number;
  calculatedRatePercent: number;
  numberOfPayments: number;
  totalInterest: number;
  principalPayment: number;
  endingBalance: number;
  termDays: number;
  cobAmount: number;
  cobRatePercent: number;
  row1PeriodInterest: number;
  lastRowDate: string;
}
interface B39Vectors {
  b39: {
    nVectors: { id: string; productType: string; rateType: string; frequency: string; start: string; end: string; n: number; nB37Y: number; nOff: number }[];
    cases: Record<string, { input: OracleCase; D: number; Y: number; on: B39Totals; b37Y: B39Totals; b38: B39Totals }>;
  };
}
const V = loadFixture<B39Vectors>('b37_leap_n_vectors.json').b39;
const vec = (id: string) => {
  const c = V.cases[id];
  if (!c) throw new Error(`no b39 vector ${id}`);
  return c;
};
const TOTAL_FIELDS = ['calculatedRatePercent', 'numberOfPayments', 'totalInterest', 'principalPayment', 'endingBalance', 'termDays', 'cobAmount', 'cobRatePercent'] as const;

// ================================================================================================ T1
describe('B39-T1 INV-B39-PIN: MONTHLY_RATE_CONVERSION is shipped true and calculateCobCanada is the B39 state', () => {
  it('MONTHLY_RATE_CONVERSION === true (value pin, ADR-14)', () => {
    expect(MONTHLY_RATE_CONVERSION).toBe(true);
  });

  it.each(['VAR-1', 'T3'])('%s: calculateCobCanada(x) JSON-equals calculateCobCanadaWith(x, SHIPPED, true, true, true); the B38 state differs', (id) => {
    const x = oracleCaseInput(vec(id).input);
    expect(json(calculateCobCanada(x))).toBe(json(shipped(x)));
    expect(json(calculateCobCanada(x))).not.toBe(json(b38State(x)));
  });

  it('source: the fifth parameter is `monthlyConversion: boolean = MONTHLY_RATE_CONVERSION`; calculateCobCanada passes two arguments', () => {
    const code = stripComments(read(join(SRC_CA, 'cobCanada.ts')));
    expect(code).toMatch(
      /export function calculateCobCanadaWith\(\s*input: CobCanadaInput,\s*switches: EngineSwitches,\s*leapAware: boolean = LEAP_AWARE_PAYMENTS_PER_YEAR,\s*yearFracRounded: boolean = YEARFRAC_ROUNDED_INTEREST,\s*monthlyConversion: boolean = MONTHLY_RATE_CONVERSION,?\s*\): CobCanadaResult/,
    );
    expect(code).toMatch(/return calculateCobCanadaWith\(input, SHIPPED_SWITCHES\);/);
    expect(stripComments(read(join(SRC_CA, 'policies.ts')))).toMatch(/export const MONTHLY_RATE_CONVERSION = true;/);
  });
});

// ================================================================================================ T2
describe('B39-T2 the user\'s Excel registry (ca_user_excel_examples.json; spec 014 consumption rules 1-6)', () => {
  it('rule 4: ids unique and well formed; status one of three; gapCents iff known-gap; inferred fields name input keys', () => {
    const ids = REGISTRY.examples.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const e of REGISTRY.examples) {
      expect(e.id).toMatch(/^UX-(\d{3}|P\d{2})$/);
      expect(['match', 'known-gap', 'pending-excel']).toContain(e.status);
      expect(e.gapCents !== undefined, `${e.id} gapCents`).toBe(e.status === 'known-gap');
      for (const inf of e.inferred) {
        expect(inf.field === 'financedFees/cashFees' || Object.hasOwn(e.input, inf.field), `${e.id} inferred ${inf.field}`).toBe(true);
      }
    }
  });

  // Rules 2 and 3, one test per entry: appending an entry adds a test with no code change.
  it.each(REGISTRY.examples.map((e) => [titleOf(e), e] as const))('%s', (_title, e) => {
    const r = calculateCobCanada(regInput(e));
    const keys = Object.keys(e.expected);
    expect(keys.length).toBeGreaterThan(0);
    for (const k of keys) {
      const engine = (r as unknown as Record<string, number>)[k];
      expect(typeof engine, `${e.id} ${k} is an engine figure`).toBe('number');
      expect(toCents(oracleRoundCent(engine!)), `${e.id} ${k}: engine ${engine}`).toBe(toCents(e.expected[k]!));
    }
    if (e.status === 'match') {
      for (const k of keys) expect(toCents(e.expected[k]!), `${e.id} ${k} = Excel`).toBe(toCents(e.excel![k] as number));
    } else if (e.status === 'known-gap') {
      expect(Object.values(e.gapCents!).some((g) => g !== 0)).toBe(true);
      for (const k of keys) expect(toCents(e.expected[k]!), `${e.id} ${k} = Excel + gap`).toBe(toCents(e.excel![k] as number) + e.gapCents![k]!);
    } else {
      expect(e.excel).toBeNull();
    }
  });

  it('the registry\'s entries are the spec 014 table at version 1 (8 entries; UX-003 known gap +1 / -1 cent)', () => {
    expect(REGISTRY.examples.slice(0, 8).map((e) => `${e.id} ${e.status}`)).toEqual([
      'UX-001 match',
      'UX-002 match',
      'UX-003 known-gap',
      'UX-004 match',
      'UX-P01 pending-excel',
      'UX-P02 pending-excel',
      'UX-P03 pending-excel',
      'UX-P04 pending-excel',
    ]);
    expect(byId('UX-003').gapCents).toEqual({ totalInterest: 1, principalPayment: -1 });
  });
});

// ================================================================================================ T3
describe('B39-T3 INV-B39-ACCEPT, INV-B39-FIXED, INV-B39-STATES against QA\'s oracle', () => {
  it('the b39 vector key equals a fresh oracle run (n, Y, every state)', () => {
    for (const [id, c] of Object.entries(V.cases)) {
      expect(c.D, id).toBe(civilDays(c.input.end) - civilDays(c.input.start));
      expect(c.Y, id).toBe(oracleYearFracBasis1(c.input.start, c.input.end));
      for (const [state, args] of [['on', [true, true, true]], ['b37Y', [true, false, true]], ['b38', [true, true, false]]] as const) {
        const q = oracleSchedule(c.input, args[0], args[1], args[2]);
        const t = c[state];
        for (const k of TOTAL_FIELDS) expect(t[k], `${id} ${state} ${k}`).toBe(q[k]);
        expect(t.n, `${id} ${state} n`).toBe(q.n);
        expect(t.row1PeriodInterest).toBe(q.rows[0]!.periodInterest);
      }
    }
    for (const v of V.nVectors) {
      expect(v.n, v.id).toBe(oracleN(v.productType, v.rateType, v.frequency, v.start, v.end, true, true, true));
      expect(v.nOff, v.id).toBe(PAYMENTS_PER_YEAR[v.frequency as PaymentFrequency]);
    }
  });

  it('INV-B39-ACCEPT literals (spec 014 table): D, Y, n, rate, rows, raw totals, row 1 interest', () => {
    const want: Record<string, [number, number, number, number, number, number, number, number]> = {
      'VAR-1': [1085, 2.97056810403833, 52.17857142857142, 3.994876602469461, 155, 12463.91672273959, 10035.883277260407, 84.22883636407059],
      'VAR-2': [1798, 4.923779096303058, 26.083333333333332, 3.796756654443251, 129, 57808.56142971458, 53537.788570285404, 208.22240457772344],
      T3: [1826, 5.0004564125969875, 52.166666666666664, 7.979547907300506, 260, 6376.325798799797, 30000.00000000002, 45.909727685838526],
    };
    for (const [id, [d, y, n, rate, rows, ti, pp, row1]] of Object.entries(want)) {
      const c = vec(id);
      expect([c.D, c.Y, c.on.n, c.on.calculatedRatePercent, c.on.numberOfPayments, c.on.totalInterest, c.on.principalPayment, c.on.row1PeriodInterest], id).toEqual([d, y, n, rate, rows, ti, pp, row1]);
    }
    expect(vec('VAR-1').b38.totalInterest).toBe(12480.898934294939);
    expect(vec('VAR-2').b38.totalInterest).toBe(57862.70692515041);
    expect(vec('T3').b38.totalInterest).toBe(6397.62434132225);
  });

  it.each(Object.keys(V.cases))('%s: the engine equals the oracle in all three states, every headline and every row (Object.is)', (id) => {
    const c = vec(id);
    const x = oracleCaseInput(c.input);
    for (const [state, run, args] of [
      ['on', shipped, [true, true, true]],
      ['b37Y', b39B37Y, [true, false, true]],
      ['b38', b38State, [true, true, false]],
    ] as const) {
      const r = run(x);
      const q = oracleSchedule(c.input, args[0], args[1], args[2]);
      for (const k of TOTAL_FIELDS) expect(r[k], `${id} ${state} ${k}`).toBe(q[k]);
      expect(r.amortizationSchedule.length).toBe(q.rows.length);
      r.amortizationSchedule.forEach((row, i) => {
        const o = q.rows[i]!;
        expect(row.periodInterest, `${id} ${state} row ${i + 1}`).toBe(o.periodInterest);
        expect(row.interestPaid, `${id} ${state} row ${i + 1}`).toBe(o.interestPaid);
        expect(row.principalPortion, `${id} ${state} row ${i + 1}`).toBe(o.principalPortion);
        expect(row.closingBalance, `${id} ${state} row ${i + 1}`).toBe(o.closingBalance);
      });
    }
  });

  it('INV-B39-STATES (B39 with B37\'s Y): VAR-1 n 52.1909594095941, rate 3.9948762395765574, total 12,463.915519974867; VAR-2 n 26.085936878925192, rate 3.796756378779001, total 57,808.55682806941; T3 n 52.171428571428564, total 6,376.32521940656', () => {
    const v1 = b39B37Y(oracleCaseInput(vec('VAR-1').input));
    expect([v1.calculatedRatePercent, v1.totalInterest]).toEqual([3.9948762395765574, 12463.915519974867]);
    expect(vec('VAR-1').b37Y.n).toBe(52.1909594095941);
    const v2 = b39B37Y(oracleCaseInput(vec('VAR-2').input));
    expect([v2.calculatedRatePercent, v2.totalInterest]).toEqual([3.796756378779001, 57808.55682806941]);
    expect(vec('VAR-2').b37Y.n).toBe(26.085936878925192);
    expect(b39B37Y(oracleCaseInput(vec('T3').input)).totalInterest).toBe(6376.32521940656);
    expect(vec('T3').b37Y.n).toBe(52.171428571428564);
    expect(v1.amortizationSchedule[0]!.periodInterest).not.toBe(oracleRoundCent(v1.amortizationSchedule[0]!.periodInterest));
  });

  it.each(['UX-001', 'UX-002', 'UX-P01'])('INV-B39-FIXED %s (fixed-rate mortgage): the shipped result JSON-equals the B38 state', (id) => {
    const x = regInput(byId(id));
    expect(json(calculateCobCanada(x))).toBe(json(b38State(x)));
  });

  it('INV-B39-FIXED literals: UX-001 60,137.63, UX-002 74,326.10999999997, UX-P01 51,018.07999999999 (full precision)', () => {
    expect(calculateCobCanada(regInput(byId('UX-001'))).totalInterest).toBe(60137.63);
    expect(calculateCobCanada(regInput(byId('UX-002'))).totalInterest).toBe(74326.10999999997);
    expect(calculateCobCanada(regInput(byId('UX-P01'))).totalInterest).toBe(51018.07999999999);
  });
});

// ================================================================================================ T4
type SweepOutcome = { ok: true; on: CobCanadaResult; off: CobCanadaResult } | { ok: false; onErr: string; offErr: string };
const tryRun = (fn: () => CobCanadaResult): CobCanadaResult | string => {
  try {
    return fn();
  } catch (e) {
    return e instanceof Error ? `${e.name}: ${e.message}` : String(e);
  }
};
const SWEEP: SweepCase[] = buildSweep();
let SWEEP_OUT: SweepOutcome[] = [];
function sweepOutcomes(): SweepOutcome[] {
  if (SWEEP_OUT.length === 0) {
    SWEEP_OUT = SWEEP.map((c) => {
      const a = tryRun(() => calculateCobCanada(c.x));
      const b = tryRun(() => b38State(c.x));
      return typeof a === 'string' || typeof b === 'string'
        ? { ok: false, onErr: typeof a === 'string' ? a : 'ok', offErr: typeof b === 'string' ? b : 'ok' }
        : { ok: true, on: a, off: b };
    });
  }
  return SWEEP_OUT;
}
const rate = (pct: number, n: number): number => oracleMonthlyConvertedDecimal(pct, n) * 100;

describe('B39-T4 sweep (the 4,800 B37-T5 inputs): INV-B39-SCOPE, -NOROUND, -RATE, -BELOW, -N, -GATE, the oracle row by row', () => {
  beforeAll(() => {
    sweepOutcomes();
  }, 120_000);

  it('the sweep is wide: in-scope cases (variable mortgage and personal loan at 7/14 days) exist in quantity; errors are identical in both states', () => {
    const res = sweepOutcomes();
    for (const o of res) if (!o.ok) expect(o.onErr).toBe(o.offErr);
    const n = SWEEP.filter((c, i) => res[i]!.ok && inScope(c.pt, c.rt, c.f, c.start, c.end)).length;
    expect(n).toBeGreaterThan(1500);
    expect(SWEEP.some((c) => c.pt === 'personalLoan' && c.rt === 'variable' && DAY_BASED.has(c.f))).toBe(true);
  });

  it('INV-B39-SCOPE: shipped vs B38 state differ (JSON) iff the case is in scope (MONTHLY basis, P in {7, 14}, start < End)', () => {
    const res = sweepOutcomes();
    const bad: string[] = [];
    SWEEP.forEach((c, i) => {
      const o = res[i]!;
      if (!o.ok) return;
      const differ = json(o.on) !== json(o.off);
      if (differ !== inScope(c.pt, c.rt, c.f, c.start, c.end)) bad.push(`${i} ${c.pt}/${c.rt} ${c.f} differ=${differ}`);
    });
    expect(bad.slice(0, 5), `${bad.length} failures`).toEqual([]);
  });

  it('INV-B39-RATE, -N, -BELOW: in scope the Calculated rate is the oracle\'s equation 1 at m = 12 and n = D / P / YEARFRAC, strictly below the contract rate and within rate(366/P) .. rate(365/P); out of scope unchanged', () => {
    const res = sweepOutcomes();
    const bad: string[] = [];
    let checked = 0;
    SWEEP.forEach((c, i) => {
      const o = res[i]!;
      if (!o.ok) return;
      const pct = c.x.contractRatePercent;
      if (!inScope(c.pt, c.rt, c.f, c.start, c.end)) {
        if (!Object.is(o.on.calculatedRatePercent, o.off.calculatedRatePercent)) bad.push(`${i} out of scope rate`);
        return;
      }
      checked += 1;
      const n = oracleN(c.pt, c.rt, c.f, c.start, c.end, true, true, true);
      const p = ORACLE_PERIOD_DAYS[c.f]!;
      if (!Object.is(conversionPaymentsPerYear(c.pt, c.rt, c.f, utcDate(c.start), utcDate(c.end), true, true, true), n)) bad.push(`${i} n`);
      if (!Object.is(o.on.calculatedRatePercent, rate(pct, n))) bad.push(`${i} rate ${o.on.calculatedRatePercent} vs ${rate(pct, n)}`);
      if (!(o.on.calculatedRatePercent < pct)) bad.push(`${i} not below`);
      if (!(rate(pct, 366 / p) * (1 - 1e-12) <= o.on.calculatedRatePercent && o.on.calculatedRatePercent <= rate(pct, 365 / p) * (1 + 1e-12))) bad.push(`${i} bounds`);
      if (o.off.calculatedRatePercent !== pct) bad.push(`${i} B38 state rate`);
      if (c.x.fees.fees.length === 0 && !Object.is(o.on.cobRatePercent, o.on.calculatedRatePercent)) bad.push(`${i} cobRate`);
    });
    expect(bad.slice(0, 5), `${bad.length} failures`).toEqual([]);
    expect(checked).toBeGreaterThan(1500);
  });

  it('INV-B39-NOROUND: in scope every row\'s periodInterest Object.is periodInterest(opening, decimal, prior, date), unrounded', () => {
    const res = sweepOutcomes();
    let rows = 0;
    let bad = 0;
    SWEEP.forEach((c, i) => {
      const o = res[i]!;
      if (!o.ok || !inScope(c.pt, c.rt, c.f, c.start, c.end)) return;
      const dec = oracleMonthlyConvertedDecimal(c.x.contractRatePercent, oracleN(c.pt, c.rt, c.f, c.start, c.end, true, true, true));
      let prior = utcDate(c.start);
      for (const row of o.on.amortizationSchedule) {
        rows += 1;
        if (!Object.is(row.periodInterest, periodInterest(row.openingBalance, dec, prior, row.date))) bad += 1;
        prior = row.date;
      }
    });
    expect(rows).toBeGreaterThan(100000);
    expect(bad).toBe(0);
  });

  it('QA schedule oracle, shipped: every in-scope case matches the oracle\'s totals and rows exactly', () => {
    const res = sweepOutcomes();
    const bad: string[] = [];
    let checked = 0;
    SWEEP.forEach((c, i) => {
      const o = res[i]!;
      if (c.oc === null || !o.ok || !inScope(c.pt, c.rt, c.f, c.start, c.end)) return;
      const q = oracleSchedule(c.oc, true, true, true);
      for (const k of TOTAL_FIELDS) if (!Object.is(o.on[k], q[k])) bad.push(`${i} ${k}: ${o.on[k]} vs ${q[k]}`);
      o.on.amortizationSchedule.forEach((row, j) => {
        const r = q.rows[j];
        if (!r || !Object.is(row.periodInterest, r.periodInterest) || !Object.is(row.closingBalance, r.closingBalance)) bad.push(`${i} row ${j + 1}`);
      });
      checked += 1;
    });
    expect(bad.slice(0, 5), `${bad.length} failures`).toEqual([]);
    expect(checked).toBeGreaterThan(1500);
  });

  it('INV-B39-GATE: with leapAware false, monthlyConversion true and false JSON-equal (both yearFracRounded states), every sweep case', () => {
    const bad: string[] = [];
    SWEEP.forEach((c, i) => {
      for (const yf of [true, false]) {
        const a = tryRun(() => calculateWith(c.x, SHIPPED, false, yf, B39_ON));
        const b = tryRun(() => calculateWith(c.x, SHIPPED, false, yf, B39_OFF));
        if (json(a) !== json(b)) bad.push(`${i} ${yf}`);
      }
    });
    expect(bad.slice(0, 5), `${bad.length} failures`).toEqual([]);
  }, 120_000);
});

// ================================================================================================ T4b
describe('B39-T4b the 768-case grid (8 registry bases x 6 frequencies x 4 product / rate pairs x 4 (leapAware, yearFracRounded) states)', () => {
  const PAIRS: [ProductType, RateType][] = [['mortgage', 'fixed'], ['mortgage', 'variable'], ['personalLoan', 'fixed'], ['personalLoan', 'variable']];
  const GRID = REGISTRY.examples.slice(0, 8).flatMap((e) =>
    SIX.flatMap((f) => PAIRS.flatMap(([pt, rt]) => [[true, true], [true, false], [false, true], [false, false]].map(([la, yf]) => ({ e, f, pt, rt, la: la!, yf: yf! })))),
  );

  it('the grid has 768 cases', () => expect(GRID).toHaveLength(768));

  it('INV-B39-OFF / -SCOPE / -GATE: (la, yf, true) vs (la, yf, false) differ (JSON) iff la and the MONTHLY basis at 7/14 days; errors identical', () => {
    const bad: string[] = [];
    let differing = 0;
    for (const { e, f, pt, rt, la, yf } of GRID) {
      const x = asInput({ ...regInput(e), productType: pt, rateType: rt, paymentFrequency: f });
      const a = tryRun(() => calculateWith(x, SHIPPED, la, yf, B39_ON));
      const b = tryRun(() => calculateWith(x, SHIPPED, la, yf, B39_OFF));
      const differ = json(a) !== json(b);
      const want = typeof a !== 'string' && la && isMonthlyBasis(pt, rt) && DAY_BASED.has(f);
      if (differ !== want) bad.push(`${e.id} ${f} ${pt}/${rt} ${la} ${yf} differ=${differ}`);
      if (differ) differing += 1;
    }
    expect(bad.slice(0, 5), `${bad.length} failures`).toEqual([]);
    expect(differing).toBeGreaterThan(100);
  });

  it('INV-B39-SCOPE: T2 (UX-P03, VAR-2 at Semi-monthly) stays 58,219.00820034338 at rate 3.8', () => {
    const r = calculateCobCanada(regInput(byId('UX-P03')));
    expect(r.totalInterest).toBe(58219.00820034338);
    expect(r.calculatedRatePercent).toBe(3.8);
  });
});

// ================================================================================================ T5
describe('B39-T5 INV-B39-LABEL: the dropdown label reads the same n as the calculation', () => {
  it('VAR-1: weekly 52.17857142857142, biweekly = conversionPaymentsPerYear(..., true, true, true), semi-monthly 24, monthly 12', () => {
    const x = regInput(byId('UX-003'));
    expect(paymentsPerYearFor(x, 'weekly')).toBe(52.17857142857142);
    expect(paymentsPerYearFor(x, 'biweekly')).toBe(conversionPaymentsPerYear('mortgage', 'variable', 'biweekly', utcDate('2026-10-08'), utcDate('2029-09-27'), true, true, true));
    expect(paymentsPerYearFor(x, 'semiMonthly')).toBe(24);
    expect(paymentsPerYearFor(x, 'monthly')).toBe(12);
  });

  it('frequencyOptionText(\'weekly\', 52.17857142857142) is "Weekly (52/yr)" (no UI change)', async () => {
    const v = await loadView();
    expect(v.frequencyOptionText('weekly', 52.17857142857142)).toBe('Weekly (52/yr)');
    expect(v.frequencyOptionText('biweekly', 26.083333333333332)).toBe('Bi-weekly (26/yr)');
  });

  it('every sweep case and frequency: paymentsPerYearFor(x, f) Object.is the oracle n with monthlyConversion; the shipped rate is equation 1 at the case\'s own label n', () => {
    const res = sweepOutcomes();
    const bad: string[] = [];
    SWEEP.forEach((c, i) => {
      for (const f of SIX) if (!Object.is(paymentsPerYearFor(c.x, f), oracleN(c.pt, c.rt, f, c.start, c.end, true, true, true))) bad.push(`${i} ${f}`);
      const o = res[i]!;
      if (!o.ok) return;
      const m = inScope(c.pt, c.rt, c.f, c.start, c.end);
      if (!Object.is(calculatedRateFor(c.pt, c.rt, c.x.contractRatePercent, paymentsPerYearFor(c.x, c.f), m).percent, o.on.calculatedRatePercent)) bad.push(`${i} rate`);
    });
    expect(bad.slice(0, 5), `${bad.length} failures`).toEqual([]);
  });

  it('source guards: paymentsPerYearFor passes the three switch constants (no literal); roundsPeriodInterestToCent calls leapPathApplies with six arguments; the engine passes convertsMonthlyRate\'s result to calculatedRateFor', () => {
    const code = stripComments(read(join(SRC_CA, 'cobCanada.ts')));
    const start = code.indexOf('export function paymentsPerYearFor(');
    const body = code.slice(start, code.indexOf('\n}', start));
    expect(body).toMatch(/conversionPaymentsPerYear\([\s\S]*LEAP_AWARE_PAYMENTS_PER_YEAR,\s*YEARFRAC_ROUNDED_INTEREST,\s*MONTHLY_RATE_CONVERSION,?\s*\)/);
    expect(body).not.toMatch(/\b(true|false)\b/);
    expect(code).toMatch(/convertsMonthlyRate\([\s\S]*?leapAware,\s*monthlyConversion,?\s*\)/);
    expect(code).toMatch(/calculatedRateFor\([\s\S]*?nForRate,\s*convertMonthly,?\s*\)/);
    expect(code).toMatch(/roundsPeriodInterestToCent\([\s\S]*?leapAware,\s*yearFracRounded,?\s*\)/);
    expect(code).toMatch(/const paymentsPerYear = PAYMENTS_PER_YEAR\[input\.paymentFrequency\];/);
    expect(code).toMatch(/triggerRatePercentEquation\(input\.paymentAmount, paymentsPerYear, amortizedPrincipal\)/);
    const eq = stripComments(read(join(SRC_CA, 'equations.ts')));
    const r = eq.indexOf('export function roundsPeriodInterestToCent(');
    const rBody = eq.slice(r, eq.indexOf('\n}', r));
    const call = /leapPathApplies\(([^)]*)\)/.exec(rBody)![1]!;
    expect(call.split(',').map((s) => s.trim()).filter(Boolean)).toHaveLength(6);
    expect(eq).not.toMatch(/policies/);
  });
});

// ================================================================================================ T6
describe('B39-T6 INV-B39-TRIGGER, -ACCEL, -PLVAR, -VRPC, -ZERO', () => {
  it('INV-B39-TRIGGER: the trigger rate stays on 52 / 26 (VAR-1 6.865909059486741, VAR-2 6.726719435770738 in both states; personal loans null)', () => {
    for (const [id, t] of [['VAR-1', 6.865909059486741], ['VAR-2', 6.726719435770738]] as const) {
      const x = oracleCaseInput(vec(id).input);
      expect(calculateCobCanada(x).triggerRatePercent, id).toBe(t);
      expect(b38State(x).triggerRatePercent, id).toBe(t);
    }
    expect(calculateCobCanada(oracleCaseInput(vec('T3').input)).triggerRatePercent).toBeNull();
    expect(calculateCobCanada(oracleCaseInput(vec('T3-variable').input)).triggerRatePercent).toBeNull();
  });

  it('INV-B39-ACCEL: T1 (VAR-1 at Accelerated weekly) gives the same figures as VAR-1 (only the frequency input differs)', () => {
    const a = calculateCobCanada(oracleCaseInput(vec('VAR-1').input));
    const b = calculateCobCanada(oracleCaseInput(vec('T1').input));
    expect(json(b)).toBe(json(a));
    const vb = calculateCobCanada(asInput({ ...oracleCaseInput(vec('VAR-2').input), paymentFrequency: 'acceleratedBiweekly' }));
    expect(json(vb)).toBe(json(calculateCobCanada(oracleCaseInput(vec('VAR-2').input))));
  });

  it('INV-B39-PLVAR: a personal loan with rateType variable JSON-equals the same loan with fixed (T3: 6,376.325798799797)', () => {
    const f = calculateCobCanada(oracleCaseInput(vec('T3').input));
    const v = calculateCobCanada(oracleCaseInput(vec('T3-variable').input));
    expect(json(v)).toBe(json(f));
    expect(f.totalInterest).toBe(6376.325798799797);
  });

  it('INV-B39-VRPC: VAR-2 through variableRatePaymentChange has the same totals as through paymentChange (57,808.56142971458)', () => {
    const a = calculateCobCanada(oracleCaseInput(vec('VAR-2').input));
    const b = calculateCobCanada(oracleCaseInput(vec('VAR-2-VRPC').input));
    for (const k of TOTAL_FIELDS) expect(b[k], k).toBe(a[k]);
    expect(b.totalInterest).toBe(57808.56142971458);
  });

  // Validation rejects a contract rate of 0 before the engine runs (contractRatePercent must be > 0), so INV-B39-ZERO is
  // asserted where it is reachable: equation 1 at m = 12 and the period interest it feeds.
  it('INV-B39-ZERO: in scope, contract rate 0 converts to Calculated rate 0 and gives period interest 0; the engine rejects 0 at validation', () => {
    for (const id of ['VAR-1', 'VAR-2', 'T3']) {
      const c = vec(id);
      const n = oracleN(c.input.productType, c.input.rateType, c.input.frequency, c.input.start, c.input.end, true, true, true);
      const r = calculatedRateFor(c.input.productType, c.input.rateType, 0, n, true);
      expect(r, id).toEqual({ percent: 0, decimal: 0 });
      expect(periodInterest(c.input.loanAmount, r.decimal, utcDate(c.input.start), utcDate(c.input.first)), id).toBe(0);
      expect(() => calculateCobCanada(asInput({ ...oracleCaseInput(c.input), contractRatePercent: 0 })), id).toThrow(RangeError);
    }
  });

  it('the B19 switch is independent: VAR-1 in the workbook branch has the same Calculated rate as shipped', () => {
    const x = oracleCaseInput(vec('VAR-1').input);
    expect(calculateWith(x, WORKBOOK).calculatedRatePercent).toBe(calculateCobCanada(x).calculatedRatePercent);
  });

  it('invalid input is still rejected first: a negative contract rate on VAR-1 throws RangeError', () => {
    expect(() => calculateCobCanada(asInput({ ...oracleCaseInput(vec('VAR-1').input), contractRatePercent: -1 }))).toThrow(RangeError);
  });
});

// ================================================================================================ T7
interface GoldenPin {
  v1: { fileSha256: string; groups: Record<string, { hash: string; n: number }>; long: Record<string, string> };
  pc: { fileSha256: string; groups: Record<string, { hash: string; n: number }>; long: Record<string, string> };
  capture: { fileSha256: string; scenarioIds: string[]; scenarioSha256: Record<string, string> };
}
interface Generator {
  buildGroups(): { key: string; cases: { params: object }[] }[];
  buildLongCases(): { key: string; params: object }[];
  makeInput(params: object): CobCanadaInput;
}
const GEN: Record<'v1' | 'pc', Generator> = { v1: gen1 as Generator, pc: genPc as Generator };
const FILE = { v1: 'golden_engine_v1.json', pc: 'golden_engine_pc_v1.json' } as const;

describe('B39-T7 INV-B39-OFF: the goldens and the page capture (regenerated for B39; pre-B39 pin b39_pre_golden_group_hashes.json)', () => {
  const PIN = loadFixture<GoldenPin>('b39_pre_golden_group_hashes.json');
  const isInScopeInput = (x: CobCanadaInput): boolean => {
    const start = (x as unknown as Record<string, Date | undefined>)[x.flow === 'newMortgageOrLoan' ? 'disbursalDate' : 'renewalDate'];
    return convertsMonthlyRate(x.productType, x.rateType, x.paymentFrequency, start, x.endDate, true, true);
  };

  it.each(['v1', 'pc'] as const)('%s: with MONTHLY_RATE_CONVERSION false the generator reproduces the pre-B39 file byte for byte', (side) => {
    expect(sha256(b38StateGoldenText(side))).toBe(PIN[side].fileSha256);
  }, 120_000);

  it.each(['v1', 'pc'] as const)('%s: a group or long case moved iff it holds a case in scope (MONTHLY basis at 7/14 days); same keys and counts', (side) => {
    const now = loadFixture<{ groups: Record<string, { hash: string; n: number }>; long: Record<string, unknown> }>(FILE[side]);
    const pin = PIN[side];
    expect(Object.keys(now.groups)).toEqual(Object.keys(pin.groups));
    let moved = 0;
    for (const g of GEN[side].buildGroups()) {
      const want = g.cases.some((c) => isInScopeInput(GEN[side].makeInput(c.params)));
      expect(now.groups[g.key]!.n, g.key).toBe(pin.groups[g.key]!.n);
      expect(now.groups[g.key]!.hash !== pin.groups[g.key]!.hash, `${g.key} moved`).toBe(want);
      if (want) moved += 1;
    }
    expect(moved).toBe(side === 'v1' ? 56 : 50);
    for (const l of GEN[side].buildLongCases()) {
      const want = isInScopeInput(GEN[side].makeInput(l.params));
      expect(sha256(JSON.stringify(now.long[l.key])) !== pin.long[l.key], `${l.key} moved`).toBe(want);
    }
  });

  it('the B39 fixture shas: v1 b35d9e52...634a, PC d1076ca7...31d3, capture e22f0161...77df (regenerated, DEC-B39-VAR-PL-M12)', () => {
    expect(sha256(read(join(ROOT, 'tests', 'ca', 'fixtures', FILE.v1)))).toBe('b35d9e525beb15550018c7089b71aac01dc3b55cd87422a9506ce022f08b634a');
    expect(sha256(read(join(ROOT, 'tests', 'ca', 'fixtures', FILE.pc)))).toBe('d1076ca7d6c1c1378e339a45770351ca8712a76d5d2706d7bcfcd7750eb431d3');
    expect(sha256(read(join(ROOT, 'tests', 'ca', 'fixtures', 'a10_ui_capture_v1.json')))).toBe('e22f016172c733cfaaf97c36567bab81c1b8b9a5e032b3e88a42c73ebdfa77df');
  });

  type Scenario = { id: string; modes: Record<string, { figures: string[][] }> };
  const cap = () => loadFixture<{ scenarios: Scenario[] }>('a10_ui_capture_v1.json');
  const UNDO = loadFixture<CaptureUndo>('b39_capture_undo.json');

  it('capture: only VRPC_zero_accrued and PL_WEEKLY changed; b39_capture_undo.json maps every scenario back to its pre-B39 sha', () => {
    expect(Object.keys(UNDO.scenarios)).toEqual(['VRPC_zero_accrued', 'PL_WEEKLY']);
    const scenarios = cap().scenarios;
    expect(scenarios.map((s) => s.id)).toEqual(PIN.capture.scenarioIds);
    for (const s of scenarios) {
      const changed = s.id in UNDO.scenarios;
      expect(sha256(JSON.stringify(s)) !== PIN.capture.scenarioSha256[s.id], `${s.id} changed`).toBe(changed);
      expect(sha256(JSON.stringify(applyCaptureUndo(s, UNDO))), s.id).toBe(PIN.capture.scenarioSha256[s.id]);
    }
  });

  const HINT_RATE = 'Fixed-rate mortgages: contract rate converted to the payment frequency. Otherwise the contract rate.';
  const HINT_COB = 'Interest plus all fees over the term.';
  const HINT_TI = 'Interest charged over the term, including any not yet paid.';
  it.each(['all', 'compact'])('PL_WEEKLY / %s: APR and Calculated rate 7.97955% (was 8.00000%), Total of all payments $11,192.45, COB amount and Total interest $1,192.47; 150 payments, 1,050 days', (mode) => {
    const s = cap().scenarios.find((x) => x.id === 'PL_WEEKLY')!;
    expect(s.modes[mode]!.figures).toEqual([
      ['Cost of borrowing rate (APR)', '7.97955%'],
      ['Calculated rate', '7.97955%', HINT_RATE],
      ['Number of payments', '150'],
      ['Term in days', '1,050 days'],
      ['Balance at end date', '$0.00'],
      ['Total of all payments', '$11,192.45'],
      ['Cost of borrowing amount', '$1,192.47', HINT_COB],
      ['Total principal paid', '$10,000.00'],
      ['Total interest', '$1,192.47', HINT_TI],
    ]);
  });

  it.each(['all', 'compact'])('VRPC_zero_accrued / %s: APR and Calculated rate 5.19393% (was 5.20000%), Balance $262,385.25, COB amount and Total interest $72,885.25, Total principal $37,614.75; trigger rate 7.36667% unchanged', (mode) => {
    const s = cap().scenarios.find((x) => x.id === 'VRPC_zero_accrued')!;
    const figs = s.modes[mode]!.figures;
    expect(figs[0]).toEqual(['Cost of borrowing rate (APR)', '5.19393%']);
    expect(figs[1]).toEqual(['Calculated rate', '5.19393%', HINT_RATE]);
    expect(figs.find((f) => f[0] === 'Balance at end date')).toEqual(['Balance at end date', '$262,385.25']);
    expect(figs.find((f) => f[0] === 'Total interest')).toEqual(['Total interest', '$72,885.25', HINT_TI]);
    expect(figs.find((f) => f[0] === 'Total principal paid')).toEqual(['Total principal paid', '$37,614.75']);
    expect(figs.find((f) => f[0] === 'Trigger rate')![1]).toBe('7.36667%');
  });
});

// ================================================================================================ T8
describe('B39-T8 structure: no barrel change; convertsMonthlyRate and the switch are on neither barrel', () => {
  it('convertsMonthlyRate, MONTHLY_RATE_CONVERSION and calculateCobCanadaWith are not exported from src/ca/index or src/index', () => {
    for (const mod of [ca, root] as Record<string, unknown>[]) {
      for (const name of ['convertsMonthlyRate', 'MONTHLY_RATE_CONVERSION', 'calculateCobCanadaWith', 'conversionPaymentsPerYear']) expect(mod[name], name).toBeUndefined();
      expect(typeof mod['paymentsPerYearFor']).toBe('function');
    }
  });
});
