import { describe, expect, it } from 'vitest';
import { calculatedRate } from '../../src/ca/equations.js';
import type { CobCanadaInput, CobCanadaResult } from '../../src/ca/index.js';
import { isoDay, wireToInput } from './support/builders.js';
import { withinRel } from './support/compare.js';
import { loadFixture as load } from './support/fixtures.js';
import { SHIPPED, WORKBOOK, calculateWith } from './support/switches.js';
import type { Switches } from './support/switches.js';

/**
 * Full-row parity against the shared JSON fixtures (tests/ca/fixtures), at the
 * project tolerance. The request for each vector comes from ca_app_wire_vectors.json
 * (the same wire request the spec 010 API and web suites will send), so this file is
 * the in-process baseline those suites mirror.
 *
 * What this proves: COB-ts matches the oracle (S*) and the live workbook's cached
 * cells (V007_live). Vectors with `known_divergence` are expected failures tied to
 * 008 items; `it.fails` turns red when the engine starts matching, so the list can't
 * go stale silently.
 *
 * B19 (DEV-OQL, 2026-09-29): the oracle is the workbook, which capitalises unpaid interest.
 * S6_underpay (the one vector with a shortfall) therefore runs against the workbook branch
 * (`WORKBOOK`); every other vector runs against the shipped branch (`SHIPPED`; it has no
 * shortfall, so both branches agree). One `known_divergence DEV-OQL S6_underpay` test pins that
 * the shipped branch differs from the workbook there.
 */

interface WireVector {
  id: string;
  source: string;
  request: Record<string, unknown> & { fees: CobCanadaInput['fees'] };
  known_divergence: string[];
}

const wire = load('ca_app_wire_vectors.json') as {
  tolerance_rel: number;
  totals_map: Record<string, string>;
  row_map: Record<string, string>;
  vectors: WireVector[];
};
const oracle = load('ca_oracle_scenarios.json') as {
  scenarios: { inputs: { id: string }; converted_rate_pct: number; totals: Record<string, number>; rows: Record<string, number | string>[] }[];
};
const live007 = load('ca_007_worked_vector.json') as {
  totals: Record<string, number>;
  rows: Record<string, number | string>[];
};
const appendixA = load('ca_appendix_a.json') as {
  contract_rate_pct: number;
  m: number;
  tolerance_abs: number;
  rows: { n: number; converted_rate_pct: number }[];
};

/** Wire (YYYY-MM-DD) -> engine input, the same conversion spec 010's wire.ts makes. */
const toEngineInput = (request: WireVector['request']): CobCanadaInput => wireToInput(request);

const iso = isoDay;

function mismatches(
  result: CobCanadaResult,
  totals: Record<string, number>,
  rows: Record<string, number | string>[],
  converted?: number,
): string[] {
  const tol = wire.tolerance_rel;
  const out: string[] = [];
  for (const [engineKey, fixtureKey] of Object.entries(wire.totals_map)) {
    if (!(fixtureKey in totals)) continue; // e.g. `principal` exists in the 007 vector only
    const a = result[engineKey as keyof CobCanadaResult] as number;
    if (!withinRel(a, totals[fixtureKey]!, tol)) out.push(`${engineKey}: ${a} vs ${totals[fixtureKey]}`);
  }
  if (converted !== undefined && !withinRel(result.calculatedRatePercent, converted, tol)) {
    out.push(`calculatedRatePercent: ${result.calculatedRatePercent} vs ${converted}`);
  }
  if (result.amortizationSchedule.length !== rows.length) {
    out.push(`rows: ${result.amortizationSchedule.length} vs ${rows.length}`);
  }
  const n = Math.min(result.amortizationSchedule.length, rows.length);
  for (let i = 0; i < n; i++) {
    const row = result.amortizationSchedule[i]!;
    const fx = rows[i]!;
    for (const [engineKey, fixtureKey] of Object.entries(wire.row_map)) {
      if (!(fixtureKey in fx)) continue;
      if (engineKey === 'date') {
        if (iso(row.date) !== fx[fixtureKey]) out.push(`row ${i + 1} date: ${iso(row.date)} vs ${String(fx[fixtureKey])}`);
        continue;
      }
      const a = row[engineKey as keyof typeof row] as number;
      if (!withinRel(a, fx[fixtureKey] as number, tol)) out.push(`row ${i + 1} ${engineKey}: ${a} vs ${String(fx[fixtureKey])}`);
    }
  }
  return out;
}

describe('fixture parity (shared JSON fixtures, 1e-9 relative, every row)', () => {
  for (const v of wire.vectors) {
    const run = (switches: Switches = v.id === 'S6_underpay' ? WORKBOOK : SHIPPED) => {
      const result = calculateWith(toEngineInput(v.request), switches);
      if (v.id === 'V007_live') return mismatches(result, live007.totals, live007.rows);
      const sc = oracle.scenarios.find((s) => s.inputs.id === v.id);
      if (!sc) throw new Error(`no oracle scenario ${v.id}`);
      return mismatches(result, sc.totals, sc.rows, sc.converted_rate_pct);
    };
    if (v.known_divergence.length === 0) {
      it(`${v.id} matches ${v.source}`, () => {
        expect(run()).toEqual([]);
      });
    } else {
      // known_divergence: expected failure tied to the vector's 008 items (see header).
      it.fails(`${v.id} diverges from ${v.source} (known: ${v.known_divergence.join(', ')})`, () => {
        expect(run()).toEqual([]);
      });
    }
  }
});

// known_divergence DEV-OQL (B19, decision 1): the workbook capitalises S6's unpaid interest; the shipped engine does not.
describe('fixture parity, shipped branch divergence (B19)', () => {
  it('known_divergence DEV-OQL S6_underpay: shipped does not match the workbook oracle', () => {
    const v = wire.vectors.find((x) => x.id === 'S6_underpay')!;
    const sc = oracle.scenarios.find((s) => s.inputs.id === 'S6_underpay')!;
    const result = calculateWith(toEngineInput(v.request), SHIPPED);
    expect(mismatches(result, sc.totals, sc.rows, sc.converted_rate_pct).length).toBeGreaterThan(0);
  });
});

describe('BRD Appendix A (3.74% at m=2), 1e-12 absolute', () => {
  for (const row of appendixA.rows) {
    it(`n=${row.n}`, () => {
      const pct = calculatedRate(appendixA.contract_rate_pct, appendixA.m, row.n) * 100;
      expect(Math.abs(pct - row.converted_rate_pct)).toBeLessThanOrEqual(appendixA.tolerance_abs);
    });
  }
});
