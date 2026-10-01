/**
 * A12b-R1 (COB-architecture.md §5 A12b, revision 14): the one home for date builders and the
 * wire-request -> engine-input converter used by tests/ca. QA-owned. F11b / F11d forbid local copies.
 * Per-file base inputs are deliberately NOT consolidated (they carry each file's test data).
 */
import type { CobCanadaInput } from '../../../src/ca/index.js';

/** UTC midnight of a `YYYY-MM-DD` calendar date. */
export function utcDate(ymd: string): Date {
  return new Date(`${ymd}T00:00:00Z`);
}

/** The UTC calendar date of `x` as `YYYY-MM-DD`. */
export function isoDay(x: Date): string {
  return x.toISOString().slice(0, 10);
}

/** Every date-valued field of CobCanadaInput. */
export const INPUT_DATE_FIELDS = ['firstPaymentDate', 'endDate', 'disbursalDate', 'renewalDate', 'semiAnnualCompoundingDate'] as const;

/**
 * Returns its argument typed as CobCanadaInput. The ONE sanctioned escape from the input type,
 * for deliberately incomplete, mixed or out-of-type inputs (replaces `as unknown as CobCanadaInput`).
 */
export function asInput(draft: object): CobCanadaInput {
  return draft as CobCanadaInput;
}

/**
 * Wire request (dates as `YYYY-MM-DD` strings) -> engine input: a shallow copy with each
 * INPUT_DATE_FIELDS key whose value is a string replaced by its UTC midnight. Adds no key and
 * does not mutate `request`.
 */
export function wireToInput(request: object): CobCanadaInput {
  const out: Record<string, unknown> = { ...request };
  for (const k of INPUT_DATE_FIELDS) {
    const v = out[k];
    if (typeof v === 'string') out[k] = utcDate(v);
  }
  return asInput(out);
}
