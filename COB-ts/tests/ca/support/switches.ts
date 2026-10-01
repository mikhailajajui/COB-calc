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

type WithFn = (input: CobCanadaInput, switches: Switches) => CobCanadaResult;

/** `calculateCobCanadaWith(input, switches)`; throws until cobCanada.ts exports it. */
export function calculateWith(input: CobCanadaInput, switches: Switches): CobCanadaResult {
  const fn = (cob as unknown as { calculateCobCanadaWith?: WithFn }).calculateCobCanadaWith;
  if (typeof fn !== 'function') throw new Error('B19: cobCanada.ts does not export calculateCobCanadaWith yet');
  return fn(input, switches);
}
