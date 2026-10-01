/**
 * F9 (COB-architecture.md §6): the public export surface of the library root
 * (src/index.ts) and the CA public barrel (src/ca/index.ts) is pinned. Type-only exports
 * are snapshotted from source text (they vanish at runtime), every name shared by root and
 * barrel must be the same binding, the barrel constant is pinned by value, and `export *`
 * is forbidden in both files so the lists stay verifiable.
 * A change to any list here needs an entry in ADR-13 (COB-architecture.md §4).
 *
 * History:
 * - A3 (2026-09-27): first version (developer, test-first; QA-reviewed and strengthened).
 * - ADR-13(a), A16 (QA, 2026-09-27): Fee/FeeSchedule added to CA_TYPE_EXPORTS (user
 *   decision). Type-only, so CA_EXPORTS (runtime) is unchanged.
 * - ADR-13(b), A15 (QA, 2026-09-27; user decision to delete the US library): the root is
 *   an explicit named re-export of the CA barrel. ROOT_EXPORTS drops the 24 US runtime
 *   exports (incl. round2) and the 18 CA internals, and gains PAYMENTS_PER_YEAR (43 -> 2).
 *   ROOT_TYPE_EXPORTS becomes the 9 CA public types (the root PaymentFrequency changes
 *   meaning from the US type to the CA type). New: root runtime keys equal the barrel's.
 *   These assertions are red until the A15 rewrite of src/index.ts lands.
 * - ADR-13(c), A6 (QA, 2026-09-28; additive, technical: §3.5 puts the flow catalogue on the
 *   UI's import path): src/ca/index.ts gains runtime FLOWS and requiresSemiAnnualDate
 *   (CA_EXPORTS 2 -> 4) and type FlowSpec (CA_TYPE_EXPORTS 9 -> 10); src/index.ts re-exports
 *   the same three names by name, so the root lists still equal the CA lists. FLOW_IDS and
 *   computesTriggerRate stay internal to src/ca. Nothing is removed or renamed.
 *   Red until the A6 barrel edits land.
 * - ADR-13(f), A9 (QA, 2026-09-29; additive, technical: §3.5 puts the issues list on the UI's
 *   import path): src/ca/index.ts gains runtime collectInputIssues (CA_EXPORTS 4 -> 5) and type
 *   InputIssue (CA_TYPE_EXPORTS 10 -> 11), both re-exported by name from ./validate.js;
 *   src/index.ts re-exports the same two names by name. validateCobCanadaInput, ValidatedInput,
 *   validateFee and validateFeeSchedule stay off both barrels. Red until the A9 barrel edits land.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as ca from '../../src/ca/index.js';
import * as root from '../../src/index.js';

// ADR-13(c), A6: + FLOWS, requiresSemiAnnualDate. ADR-13(f), A9: + collectInputIssues.
// ADR-13(h), B27 (DEV-FB24): + allowedPaymentFrequencies (the product catalogue).
// ADR-13(h), B24 (DEV-OQP): + contractTerm (runtime) and the type ContractTerm.
const CA_EXPORTS = ['FLOWS', 'PAYMENTS_PER_YEAR', 'allowedPaymentFrequencies', 'calculateCobCanada', 'collectInputIssues', 'contractTerm', 'requiresSemiAnnualDate'];

const CA_TYPE_EXPORTS = [
  'CobCanadaInput',
  'CobCanadaResult',
  'CobFlow',
  'CobScheduleRow',
  'ContractTerm', // ADR-13(h), B24
  'Fee',
  'FeeSchedule',
  'FlowSpec', // ADR-13(c), A6
  'InputIssue', // ADR-13(f), A9
  'PaymentFrequency',
  'ProductType',
  'RateType',
];

// ADR-13(b): after A15 the root lists equal the CA lists (still so after ADR-13(c), A6 and ADR-13(f), A9).
const ROOT_EXPORTS = [...CA_EXPORTS];
const ROOT_TYPE_EXPORTS = [...CA_TYPE_EXPORTS];

/** Names in `export type { ... }` blocks, plus top-level `export type X` / `export interface X`. */
function typeExportsOf(relPath: string): string[] {
  const src = readFileSync(new URL(`../../${relPath}`, import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
  const names: string[] = [];
  for (const m of src.matchAll(/export\s+type\s*\{([^}]*)\}/g)) {
    names.push(...m[1]!.split(',').map((x) => x.trim().split(/\s+as\s+/).pop()!).filter(Boolean));
  }
  for (const m of src.matchAll(/export\s+(?:type|interface)\s+([A-Za-z_]\w*)/g)) names.push(m[1]!);
  // `export *` would make the lists above unverifiable: forbid it in both barrels.
  if (/export\s*\*/.test(src)) names.push('<export *>');
  return [...new Set(names)].sort();
}

describe('export surface', () => {
  it('src/index.ts runtime exports are exactly the CA public API (ADR-13(b))', () => {
    expect(Object.keys(root).sort()).toEqual(ROOT_EXPORTS);
  });

  it('src/ca/index.ts runtime exports are exactly the CA public API', () => {
    expect(Object.keys(ca).sort()).toEqual(CA_EXPORTS);
  });

  it('src/index.ts runtime keys equal src/ca/index.ts runtime keys (ADR-13(b))', () => {
    expect(Object.keys(root).sort()).toEqual(Object.keys(ca).sort());
  });

  it('root has exactly 7 runtime exports (B27: + allowedPaymentFrequencies; B24: + contractTerm) and the lists have no duplicates (ADR-13(f))', () => {
    expect(ROOT_EXPORTS).toHaveLength(7);
    expect(new Set(ROOT_EXPORTS).size).toBe(ROOT_EXPORTS.length);
    expect(new Set(CA_EXPORTS).size).toBe(CA_EXPORTS.length);
  });

  it('the root re-exports the same calculateCobCanada as the CA barrel', () => {
    expect(typeof ca.calculateCobCanada).toBe('function');
    expect(root.calculateCobCanada).toBe(ca.calculateCobCanada);
  });

  it('every runtime name exported by both root and CA barrel is the same binding', () => {
    const shared = Object.keys(ca).filter((k) => k in root);
    expect(shared).toContain('calculateCobCanada');
    for (const k of shared) expect((root as Record<string, unknown>)[k], k).toBe((ca as Record<string, unknown>)[k]);
  });

  it('PAYMENTS_PER_YEAR is pinned by value', () => {
    // B8 (QA 2026-09-29, ADR-13(d)): two keys appended, accelerated n = regular n (BR-09).
    expect(ca.PAYMENTS_PER_YEAR).toEqual({
      monthly: 12,
      semiMonthly: 24,
      biweekly: 26,
      weekly: 52,
      acceleratedBiweekly: 26,
      acceleratedWeekly: 52,
    });
  });

  it('src/ca/index.ts type-only exports are exactly the CA public types', () => {
    expect(typeExportsOf('src/ca/index.ts')).toEqual(CA_TYPE_EXPORTS);
  });

  it('src/index.ts type-only exports are exactly the CA public types (ADR-13(b))', () => {
    expect(typeExportsOf('src/index.ts')).toEqual([...ROOT_TYPE_EXPORTS].sort());
  });
});
