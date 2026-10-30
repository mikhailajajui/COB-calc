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
 *
 * B38 (spec 013, DEC-B38-YEARFRAC-ROUND): B38 regenerates both fixtures again (approved by the user 2026-10-10). The B37
 * files (v1 b90ea69c...d220, PC 9da9599f...5db8) are replayed by `b37StateGoldenText`, the corpus with the leap switch on
 * and YEARFRAC_ROUNDED_INTEREST off (INV-B38-OFF).
 *
 * B39 (spec 014, DEC-B39-VAR-PL-M12): B39 regenerates both fixtures again. The B38 files (v1 d6b9b532...ea07, PC
 * 72a644a2...ddb4, pinned in b39_pre_golden_group_hashes.json before any B39 change) are replayed by `b38StateGoldenText`,
 * the corpus with MONTHLY_RATE_CONVERSION off (INV-B39-OFF); `b37StateGoldenText` also passes it off.
 */
import type { CobCanadaInput, CobCanadaResult } from '../../../src/ca/index.js';
import { B38_OFF, B38_ON, B39_OFF, LEAP_OFF, LEAP_ON, SHIPPED, calculateWith } from './switches.js';
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

const b37TextCache: Partial<Record<GoldenSide, string>> = {};

/** B38 INV-B38-OFF: the B37 fixture text, byte for byte (leap on, YEARFRAC_ROUNDED_INTEREST off, B39: MONTHLY_RATE_CONVERSION
 *  off, shipped B19 switches). */
export function b37StateGoldenText(side: GoldenSide): string {
  return (b37TextCache[side] ??= GEN[side].serialise(
    GEN[side].computeGolden((input) => calculateWith(input, SHIPPED, LEAP_ON, B38_OFF, B39_OFF)),
  ));
}

const b38TextCache: Partial<Record<GoldenSide, string>> = {};

/** B39 INV-B39-OFF (spec 014): the B38 fixture text, byte for byte (leap on, YEARFRAC_ROUNDED_INTEREST on,
 *  MONTHLY_RATE_CONVERSION off, shipped B19 switches): the committed goldens before the B39 regeneration. */
export function b38StateGoldenText(side: GoldenSide): string {
  return (b38TextCache[side] ??= GEN[side].serialise(
    GEN[side].computeGolden((input) => calculateWith(input, SHIPPED, LEAP_ON, B38_ON, B39_OFF)),
  ));
}
