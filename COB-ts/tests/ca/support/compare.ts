/**
 * A12b-R1 (COB-architecture.md §5 A12b, revision 14): the one home for numeric comparison and
 * RangeError helpers used by tests/ca. QA-owned. F11c / F11e forbid local copies.
 */
import { expect } from 'vitest';

/**
 * Symmetric relative error, with exact zero only equal to (near) zero.
 * Verbatim from tests/ca/fixtureParity.test.ts:63-68 (one algorithm shared by the 7 former copies).
 */
export function withinRel(actual: number, expected: number, tol: number): boolean {
  if (Object.is(actual, expected)) return true;
  const scale = Math.max(Math.abs(actual), Math.abs(expected));
  if (scale < 1e-9) return true; // both effectively zero (e.g. 0 vs 1e-12 residue)
  return Math.abs(actual - expected) / scale <= tol;
}

/** Relative error against the expected value, with the denominator floored at 1 (asymmetric). */
export function relDiffFloor1(actual: number, expected: number): number {
  return Math.abs(actual - expected) / Math.max(Math.abs(expected), 1);
}

/** Asserts relDiffFloor1(actual, expected) <= tol; `message` is shown on failure. */
export function expectRelFloor1(actual: number, expected: number, tol: number, message?: string): void {
  expect(relDiffFloor1(actual, expected), message).toBeLessThanOrEqual(tol);
}

/**
 * Asserts `fn` throws a RangeError whose message matches `pattern` (so a downstream RangeError
 * can't pass for it). Body from tests/ca/defects012.test.ts:148-157.
 */
export function expectRangeErrorMatching(fn: () => unknown, pattern: RegExp): void {
  let caught: unknown;
  try {
    fn();
  } catch (e) {
    caught = e;
  }
  expect(caught, 'expected a throw').toBeInstanceOf(RangeError);
  expect((caught as Error).message).toMatch(pattern);
}
