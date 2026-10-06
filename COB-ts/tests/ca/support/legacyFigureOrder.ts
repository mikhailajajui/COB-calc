/**
 * B31 (COB-architecture.md §5 B31, revision 49; DEC-B31-LAYOUT): the pre-B31 order of the result
 * figures, used to replay the new two-group lists against pins made before the re-arrangement
 * (b23_on_state_pins.json for the switch-on page, b31_pre_layout_pins.json for the shipped page).
 * QA-owned, written in the B31 red step (2026-10-05). The developer must not edit this file.
 *
 * Source of the orders: ui/ca-view.js before B31 (`printFigures = [...headline, ...main, ...more]`,
 * `mainFigures` = Calculated rate, [Trigger rate], Number of payments, Total of all payments,
 * Total interest, Total principal paid; `moreFigures` = [Fees recovered], Balance at end date,
 * [Unpaid interest], [Disbursal amount], Term in days).
 */

/** A figure tuple as ui/ca-view.d.ts declares it (kept structural so this helper imports nothing). */
export type LegacyFigure = readonly [string, string] | readonly [string, string, string];

export const LEGACY_PRINT: readonly string[] = Object.freeze([
  'Cost of borrowing rate (APR)',
  'Cost of borrowing amount',
  'Calculated rate',
  'Trigger rate',
  'Number of payments',
  'Total of all payments',
  'Total interest',
  'Total principal paid',
  'Fees recovered through payments',
  'Balance at end date',
  'Unpaid interest at end date',
  'Disbursal amount',
  'Term in days',
]);

export const LEGACY_MAIN: readonly string[] = Object.freeze([
  'Calculated rate',
  'Trigger rate',
  'Number of payments',
  'Total of all payments',
  'Total interest',
  'Total principal paid',
]);

export const LEGACY_MORE: readonly string[] = Object.freeze([
  'Fees recovered through payments',
  'Balance at end date',
  'Unpaid interest at end date',
  'Disbursal amount',
  'Term in days',
]);

/**
 * For each label in `order`, the entries of `list` with that label (in their list order).
 * Entries whose label is in no position of `order` are dropped, so callers also compare lengths.
 */
export function inLegacyOrder<F extends LegacyFigure>(list: readonly F[], order: readonly string[]): F[] {
  return order.flatMap((label) => list.filter((f) => f[0] === label));
}
