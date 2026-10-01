import { isFiniteNumber, type Fee, type FeeSchedule } from './types.js';

export type { Fee, FeeSchedule } from './types.js';

function throwRangeError(message: string): never {
  throw new RangeError(message);
}

/**
 * Validates a single Fee for use in a Canadian (spec 006) flow: amount must be a
 * finite, non-negative number and `financed` a boolean. `includedInCob` is optional;
 * if present it must be a boolean, and its value is never read (C counts every fee in
 * full: OQ-E, macro line 562; B10, user 2026-09-29).
 *
 * Each failing check passes its message to `report` and returns false (a fee gives at
 * most one message: its first failing check); the default reporter throws a RangeError
 * with that message. Returns true when the fee is valid.
 */
export function validateFee(fee: Fee, index: number, report: (message: string) => void = throwRangeError): boolean {
  if (typeof fee !== 'object' || fee === null) {
    report(`fees.fees[${index}] must be a fee object, got ${String(fee)}`);
    return false;
  }
  const label = fee.name || `fees.fees[${index}]`;
  if (!isFiniteNumber(fee.amount)) {
    report(`${label} amount must be a finite number, got ${String(fee.amount)}`);
    return false;
  }
  if (!(fee.amount >= 0)) {
    report(`${label} amount must be >= 0, got ${fee.amount}`);
    return false;
  }
  if (typeof fee.financed !== 'boolean') {
    report(`${label}.financed must be a boolean, got ${String(fee.financed)}`);
    return false;
  }
  const includedInCob: unknown = fee.includedInCob;
  if (includedInCob !== undefined && typeof includedInCob !== 'boolean') {
    report(`${label}.includedInCob must be a boolean if present, got ${String(includedInCob)}`);
    return false;
  }
  return true;
}

/** Validates the schedule's shape, then every fee in index order (holes skipped); same reporter contract as validateFee. */
export function validateFeeSchedule(schedule: FeeSchedule, report: (message: string) => void = throwRangeError): boolean {
  if (typeof schedule !== 'object' || schedule === null || !Array.isArray(schedule.fees)) {
    report('fees must be an object with a fees array');
    return false;
  }
  let ok = true;
  schedule.fees.forEach((fee, index) => {
    if (!validateFee(fee, index, report)) ok = false;
  });
  return ok;
}

export function totalFinancedFees(schedule: FeeSchedule): number {
  return schedule.fees.filter((fee) => fee.financed).reduce((sum, fee) => sum + fee.amount, 0);
}

export function totalCashFees(schedule: FeeSchedule): number {
  return schedule.fees.filter((fee) => !fee.financed).reduce((sum, fee) => sum + fee.amount, 0);
}
