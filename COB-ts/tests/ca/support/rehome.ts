/**
 * B27 (COB-architecture.md section 5 B27, revision 29; DEV-FB24): the "twin" helper. QA-owned.
 *
 * A personal loan may only pay Monthly, so a test that needs a schedule at another frequency
 * uses the TWIN: the same input as a mortgage / variable at the same frequency. The twin is exact
 * because the rate basis of a personal loan (either rate type) and of a variable mortgage is the
 * same MONTHLY basis (equations.ts selectRateBasis), `semiAnnualCompoundingDate` is needed only by
 * mortgage / fixed, and validate.ts has no other product or rate rule for the new and paymentChange
 * flows. Measured by QA on the pre-B27 engine: 22,730 pairs, 0 differences except
 * `triggerRatePercent` (null for a personal loan, a number for the twin).
 *
 * `rehome(input)`: identity for a mortgage or a monthly input; otherwise the twin (personal loan,
 * non-monthly frequency -> `productType: 'mortgage'`, `rateType: 'variable'`, same frequency,
 * same flow and every other field, `semiAnnualCompoundingDate` dropped).
 * `rehomeCase(original)`: `{ twin, restore }`. `restore(result)` sets `triggerRatePercent` back to
 * `null` exactly when the ORIGINAL input was a personal loan (used only where a hash covers the
 * whole result: the two B19-ON replays and loopEquations-a5 overflowToInfinityShipped, class X1).
 * A test that asserts `triggerRatePercent === null` for a personal loan must never be rehomed.
 */
type Draft = Record<string, unknown>;

/** The twin of `input` (identity unless it is a personal loan at a non-monthly frequency). */
export function rehome<T extends object>(input: T): T {
  const x = input as Draft;
  if (x['productType'] !== 'personalLoan' || x['paymentFrequency'] === 'monthly') return input;
  const { semiAnnualCompoundingDate: _dropped, ...rest } = x;
  return { ...rest, productType: 'mortgage', rateType: 'variable' } as T;
}

/** The twin plus the function that restores the original's `triggerRatePercent` on a result. */
export function rehomeCase<T extends object>(original: T): { twin: T; restore: <R extends object>(result: R) => R } {
  const wasPersonalLoan = (original as Draft)['productType'] === 'personalLoan';
  return {
    twin: rehome(original),
    restore: <R extends object>(result: R): R =>
      wasPersonalLoan ? ({ ...(result as Draft), triggerRatePercent: null } as R) : result,
  };
}
