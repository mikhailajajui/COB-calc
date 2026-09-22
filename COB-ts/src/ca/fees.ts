import { round2 } from '../money.js';

/**
 * Loan fees, itemized: name/amount/financed, mirroring COB-py's existing
 * `cob_calculator/fees.py` (spec 002's Fee/FeeSchedule shape) rather than diverging —
 * COB-ts has not implemented spec 002 itself (no US fees.ts exists), so this is this
 * project's first TypeScript Fee/FeeSchedule, defined here for the Canadian module.
 *
 * Extended per spec 006 (docs/new-req/006-cost-of-borrowing-disclosure.md) with a
 * second, independent per-fee `includedInCob` flag. `financed` and `includedInCob`
 * answer genuinely different questions: `financed` is "does this fee reduce cash
 * disbursed or get added to the amortized balance," while `includedInCob` is "does
 * Financial Consumer Protection Framework Regulations s.48 count this dollar toward
 * cobAmount" (equation 7) -- e.g. a *financed* mortgage-default-insurance premium is
 * still added to the amortized balance like any other financed fee, but must never be
 * counted toward cobAmount; a discharge fee is excluded from cobAmount regardless of
 * whether it's paid in cash or financed.
 *
 * `includedInCob` has no safe default -- defaulting to `true` would silently pull
 * regulation-excluded categories (mortgage default insurance, discharge fees,
 * prepayment penalties, etc.) into cobAmount, defaulting to `false` would silently
 * drop includable ones. It therefore stays optional/undefined on this shared type
 * (matching COB-py's `included_in_cob: Optional[bool] = None`, a strictly additive
 * no-op for any future US caller that never sets it), but validateFee requires it to
 * be explicitly set (true or false) whenever a Canadian flow constructs a Fee -- see
 * validateFee below.
 */
export interface Fee {
  name: string;
  amount: number;
  /** false (default elsewhere in the ecosystem): paid out-of-pocket, reduces
   *  disbursal. true: added to the amortized principal instead of reducing disbursal. */
  financed: boolean;
  /** Whether this fee counts toward cobAmount (equation 7). Independent of
   *  `financed` -- see the type-level doc comment above. Left `undefined` by any
   *  caller that doesn't care (contributes 0 to totalFeesIncludedInCob); Canadian
   *  flows must set it explicitly -- see validateFee. */
  includedInCob?: boolean;
}

export interface FeeSchedule {
  fees: Fee[];
}

/**
 * Validates a single Fee for use in a Canadian (spec 006) flow: amount must be
 * non-negative, and -- unlike the shared type's optional `includedInCob` -- this
 * validation requires it to be explicitly set (true or false), since there is no safe
 * default (see the Fee doc comment above and spec 006's "Open questions").
 */
export function validateFee(fee: Fee, index: number): void {
  const label = fee.name || `fees.fees[${index}]`;
  if (!(fee.amount >= 0)) {
    throw new RangeError(`${label} amount must be >= 0, got ${fee.amount}`);
  }
  if (typeof fee.financed !== 'boolean') {
    throw new RangeError(`${label}.financed must be a boolean, got ${String(fee.financed)}`);
  }
  if (typeof fee.includedInCob !== 'boolean') {
    throw new RangeError(
      `${label}.includedInCob must be explicitly true or false for a Canadian COB flow -- ` +
        'it has no safe default (see docs/new-req/006-cost-of-borrowing-disclosure.md "Open questions"): ' +
        'defaulting true would silently pull regulation-excluded fees into cobAmount, defaulting false ' +
        'would silently drop includable ones.',
    );
  }
}

export function validateFeeSchedule(schedule: FeeSchedule): void {
  schedule.fees.forEach((fee, index) => validateFee(fee, index));
}

export function totalFees(schedule: FeeSchedule): number {
  return round2(schedule.fees.reduce((sum, fee) => sum + fee.amount, 0));
}

export function totalFinancedFees(schedule: FeeSchedule): number {
  return round2(schedule.fees.filter((fee) => fee.financed).reduce((sum, fee) => sum + fee.amount, 0));
}

export function totalCashFees(schedule: FeeSchedule): number {
  return round2(schedule.fees.filter((fee) => !fee.financed).reduce((sum, fee) => sum + fee.amount, 0));
}

/** Sum of fee.amount where includedInCob === true. Fees that leave includedInCob
 *  undefined contribute 0, matching COB-py's total_fees_included_in_cob. */
export function totalFeesIncludedInCob(schedule: FeeSchedule): number {
  return round2(
    schedule.fees.filter((fee) => fee.includedInCob === true).reduce((sum, fee) => sum + fee.amount, 0),
  );
}
