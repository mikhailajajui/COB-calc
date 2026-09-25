import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { calculateCobCanada } from '../../src/ca/cobCanada.js';
import { calculatedRate } from '../../src/ca/equations.js';
import type { CobCanadaInput, CobCanadaResult } from '../../src/ca/types.js';

/**
 * Full-row parity against the shared JSON fixtures (COB-py/tests/fixtures), at the
 * project tolerance. The request for each vector comes from ca_app_wire_vectors.json
 * (the same wire request the spec 010 API and web suites will send), so this file is
 * the in-process baseline those suites mirror.
 *
 * What this proves: COB-ts matches the oracle (S*) and the live workbook's cached
 * cells (V007_live). Vectors with `known_divergence` are expected failures tied to
 * 008 items; `it.fails` turns red when the engine starts matching, so the list can't
 * go stale silently.
 */
const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url));
const load = (name: string) => JSON.parse(readFileSync(FIXTURES + name, 'utf8'));

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

const DATE_FIELDS = ['firstPaymentDate', 'endDate', 'disbursalDate', 'renewalDate', 'semiAnnualCompoundingDate'];

/** Wire (YYYY-MM-DD) -> engine input, the same conversion spec 010's wire.ts makes. */
function toEngineInput(request: WireVector['request']): CobCanadaInput {
  const out: Record<string, unknown> = { ...request };
  for (const f of DATE_FIELDS) {
    if (typeof request[f] === 'string') out[f] = new Date(`${request[f] as string}T00:00:00Z`);
  }
  return out as unknown as CobCanadaInput;
}

const iso = (d: Date) => d.toISOString().slice(0, 10);

/** Relative error, with exact zero only equal to (near) zero. */
function withinRel(actual: number, expected: number, tol: number): boolean {
  if (Object.is(actual, expected)) return true;
  const scale = Math.max(Math.abs(actual), Math.abs(expected));
  if (scale < 1e-9) return true; // both effectively zero (e.g. 0 vs 1e-12 residue)
  return Math.abs(actual - expected) / scale <= tol;
}

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
    const run = () => {
      const result = calculateCobCanada(toEngineInput(v.request));
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
      it.fails(`${v.id} diverges from ${v.source} (known: ${v.known_divergence.join(', ')})`, () => {
        expect(run()).toEqual([]);
      });
    }
  }
});

describe('BRD Appendix A (3.74% at m=2), 1e-12 absolute', () => {
  for (const row of appendixA.rows) {
    it(`n=${row.n}`, () => {
      const pct = calculatedRate(appendixA.contract_rate_pct, appendixA.m, row.n) * 100;
      expect(Math.abs(pct - row.converted_rate_pct)).toBeLessThanOrEqual(appendixA.tolerance_abs);
    });
  }
});
