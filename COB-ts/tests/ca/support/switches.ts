/**
 * B19 (COB-architecture.md §5 B19, revision 19): engine switch states for tests. QA-owned.
 *
 * `WORKBOOK` is `UNPAID_INTEREST_CAPITALISED = true` (today's T6 / OQ-L branch), `SHIPPED` is
 * `false` (DEV-OQL). `calculateWith(input, switches)` reads `calculateCobCanadaWith` from
 * `cobCanada.ts` AT CALL TIME, so in the red step (before sr-dev exports it) each test fails on
 * its own instead of the whole file failing at import, and `typecheck:tests` stays clean.
 */
import * as cob from '../../../src/ca/cobCanada.js';
import type { CobCanadaInput, CobCanadaResult } from '../../../src/ca/index.js';

export interface Switches {
  readonly unpaidInterestCapitalised: boolean;
}

/** `UNPAID_INTEREST_CAPITALISED = true`: the workbook branch (macro l.461-462, 514, 540). */
export const WORKBOOK: Switches = Object.freeze({ unpaidInterestCapitalised: true });
/** `UNPAID_INTEREST_CAPITALISED = false`: the shipped branch (DEV-OQL, decision 1). */
export const SHIPPED: Switches = Object.freeze({ unpaidInterestCapitalised: false });

/** Both switch states, for `it.each(BOTH)`. */
export const BOTH: ReadonlyArray<readonly [string, Switches]> = [
  ['workbook (capitalised: true)', WORKBOOK],
  ['shipped (capitalised: false)', SHIPPED],
];

type WithFn = (input: CobCanadaInput, switches: Switches, leapAware?: boolean) => CobCanadaResult;

/**
 * `calculateCobCanadaWith(input, switches[, leapAware])`; throws until cobCanada.ts exports it.
 * B37 (DEC-B37-LEAP-N, brief B37-D1): `leapAware` is the engine's third, defaulted parameter (the
 * LEAP_AWARE_PAYMENTS_PER_YEAR switch); it is passed only when given, so a two-argument call is exactly the pre-B37 call.
 */
export function calculateWith(input: CobCanadaInput, switches: Switches, leapAware?: boolean): CobCanadaResult {
  const fn = (cob as unknown as { calculateCobCanadaWith?: WithFn }).calculateCobCanadaWith;
  if (typeof fn !== 'function') throw new Error('B19: cobCanada.ts does not export calculateCobCanadaWith yet');
  return leapAware === undefined ? fn(input, switches) : fn(input, switches, leapAware);
}

/**
 * B37 (DEC-B37-LEAP-N, ADR-14): the two states of `LEAP_AWARE_PAYMENTS_PER_YEAR`. `LEAP_ON` is the shipped state (n for
 * equation 1 = (D / P) / Y for the 7/14-day frequencies of a fixed-rate mortgage); `LEAP_OFF` is the workbook converter
 * (n = 52 / 26). The value pin is in b37-leap-aware-n.test.ts (B37-T1).
 */
export const LEAP_ON = true;
export const LEAP_OFF = false;
/** Both leap states, for `it.each(BOTH_LEAP)`. */
export const BOTH_LEAP: ReadonlyArray<readonly [string, boolean]> = Object.freeze([
  ['leap-aware n (shipped)', LEAP_ON],
  ['workbook n 52/26', LEAP_OFF],
] as const);
