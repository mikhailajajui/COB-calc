/**
 * B37 (COB-architecture.md §5 B37, revision 56; user decision DEC-B37-LEAP-N): the pre-B37 golden fixtures, rebuilt from
 * the engine with `LEAP_AWARE_PAYMENTS_PER_YEAR` off (n = 52 / 26, the workbook converter). QA-owned.
 *
 * B37 regenerates `golden_engine_v1.json` and `golden_engine_pc_v1.json` (approved by the user 2026-10-09). Tests that
 * check the HISTORY of those files (B25-T9 G2/G3/G4, B33-T8, B27-T9) compared the committed file with older states; they
 * now compare this replay instead, which is the pre-B37 file byte for byte (B37-INV-OFF: `serialise(computeGolden(off))`
 * has sha256 922fd695...3aee / 5ab1c6a6...a7df5, pinned by QA in `b37_pre_golden_group_hashes.json` before the
 * regeneration). No assertion value of those tests changes.
 *
 * Each corpus is computed once per test worker (about 5 s each): call these from `beforeAll` or a test with a long timeout.
 */
import type { CobCanadaInput, CobCanadaResult } from '../../../src/ca/index.js';
import { LEAP_OFF, SHIPPED, calculateWith } from './switches.js';
// @ts-ignore -- plain .mjs shared with the generator (no .d.ts).
import * as gen1 from '../fixtures/generate_golden.mjs';
// @ts-ignore -- plain .mjs shared with the generator (no .d.ts).
import * as genPc from '../fixtures/generate_golden_pc.mjs';

export type GoldenSide = 'v1' | 'pc';

/** The generators' computed form: groups with hash, n and case tuples; long cases as plain result JSON. */
export interface ComputedGolden {
  groups: Record<string, { hash: string; n: number; cases: (string | number | null)[][] }>;
  long: Record<string, unknown>;
}

interface Generator {
  computeGolden(calculate: (input: CobCanadaInput) => CobCanadaResult): ComputedGolden;
  serialise(golden: ComputedGolden): string;
}

const GEN: Record<GoldenSide, Generator> = { v1: gen1 as Generator, pc: genPc as Generator };
const computedCache: Partial<Record<GoldenSide, ComputedGolden>> = {};
const textCache: Partial<Record<GoldenSide, string>> = {};

/** The corpus computed with the leap switch off (shipped B19 switches): the pre-B37 engine output. */
export function preB37Computed(side: GoldenSide): ComputedGolden {
  return (computedCache[side] ??= GEN[side].computeGolden((input) => calculateWith(input, SHIPPED, LEAP_OFF)));
}

/** The pre-B37 fixture text, byte for byte (the generator's own `serialise` of the leap-off replay). */
export function preB37GoldenText(side: GoldenSide): string {
  return (textCache[side] ??= GEN[side].serialise(preB37Computed(side)));
}
