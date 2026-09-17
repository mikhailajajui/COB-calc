import { calculateMonthlyPayment } from './payment.js';
import { round2 } from './money.js';
import type { AmortizationEntry, ManualPaymentOverride, Segment } from './types.js';

/** Safety cap (100 years of monthly payments) against an open-ended segment whose
 *  payment doesn't cover interest and would otherwise loop forever. */
const MAX_PAYMENTS_SAFETY_CAP = 1200;

export interface SegmentResult {
  rows: AmortizationEntry[];
  endingBalance: number;
  monthlyPayment: number;
}

/** segment.startDate is treated as the date of that segment's first payment. */
export function addMonths(date: Date, months: number): Date {
  const result = new Date(date);
  result.setMonth(result.getMonth() + months);
  return result;
}

/**
 * Generates the amortization rows for a single segment, starting from
 * `startingBalance` and numbering payments from `startPaymentNumber`.
 *
 * The segment's row count is bounded whenever it's knowable in advance:
 * - `segment.termMonths`, when set, is a renewal/change boundary — exactly that many
 *   rows are produced and the leftover balance carries into the next segment, with no
 *   zero-forcing.
 * - Otherwise this is the mortgage's final segment. If `amortizationMonthsRemaining`
 *   is set, that many rows are produced (the payment was sized to amortize over
 *   exactly that span), with the final row forced to clear the balance exactly —
 *   guarding against sub-cent rounding on the payment leaving a residual that would
 *   otherwise spill into an extra payment. If only a manual `paymentAmount` is given
 *   (no amortization figure), the payoff length is genuinely unknown in advance, so
 *   rows are produced dynamically until the balance reaches zero (bounded by a safety
 *   cap against a payment too small to cover interest).
 *
 * `overridesByPaymentNumber` supplies manual corrections for specific global payment
 * numbers; when present for a row, its fields take precedence over computed values and
 * the resulting balance still propagates forward into subsequent rows as usual. When
 * an override specifies `remainingBalance` without `principalPortion`, the principal
 * is derived as `balance - remainingBalance` so the payment identity (total payments =
 * total interest + total principal) still holds across the override.
 */
export function computeSegmentSchedule(
  segment: Segment,
  segmentIndex: number,
  startingBalance: number,
  startPaymentNumber: number,
  overridesByPaymentNumber: Map<number, ManualPaymentOverride>,
): SegmentResult {
  const r = segment.annualInterestRatePercent / 100 / 12;
  const monthlyPayment = segment.interestOnly
    ? round2(startingBalance * r)
    : segment.paymentAmount !== undefined
      ? round2(segment.paymentAmount)
      : calculateMonthlyPayment(
          startingBalance,
          segment.annualInterestRatePercent,
          segment.amortizationMonthsRemaining!,
        );

  const isFinalSegment = segment.termMonths === undefined;
  const knownLength = segment.termMonths ?? segment.amortizationMonthsRemaining;
  const rows: AmortizationEntry[] = [];
  let balance = round2(startingBalance);
  let paymentIndex = 0;

  while (knownLength !== undefined ? paymentIndex < knownLength : balance > 0) {
    if (paymentIndex >= MAX_PAYMENTS_SAFETY_CAP) {
      throw new Error(
        `Segment ${segmentIndex} did not amortize to zero within ${MAX_PAYMENTS_SAFETY_CAP} payments — ` +
          `payment amount ${monthlyPayment} may be insufficient to cover interest (negative amortization).`,
      );
    }

    const paymentNumber = startPaymentNumber + paymentIndex;
    const override = overridesByPaymentNumber.get(paymentNumber);

    let interestPortion: number;
    let principalPortion: number;
    let paymentAmount: number;
    let remainingBalance: number;

    if (override) {
      interestPortion = override.interestPortion ?? round2(balance * r);
      if (override.remainingBalance !== undefined) {
        remainingBalance = override.remainingBalance;
        principalPortion = override.principalPortion ?? round2(balance - remainingBalance);
      } else {
        principalPortion =
          override.principalPortion ??
          round2((override.paymentAmount ?? monthlyPayment) - interestPortion);
        remainingBalance = round2(balance - principalPortion);
      }
      paymentAmount = override.paymentAmount ?? round2(interestPortion + principalPortion);
      overridesByPaymentNumber.delete(paymentNumber);
    } else {
      interestPortion = round2(balance * r);

      if (segment.interestOnly) {
        // By definition monthlyPayment === interestPortion for an interest-only row —
        // this must not trip the negative-amortization guard below, so it's handled
        // first and unconditionally.
        principalPortion = 0;
        paymentAmount = interestPortion;
        remainingBalance = balance;
      } else {
        // Only the fully dynamic case (no knowable segment length) risks looping
        // forever on a payment that never covers interest; bounded segments always
        // terminate at knownLength regardless.
        if (knownLength === undefined && monthlyPayment <= interestPortion) {
          throw new Error(
            `Segment ${segmentIndex}'s payment ${monthlyPayment} does not cover this period's interest ` +
              `(${interestPortion}) — this loan would never amortize.`,
          );
        }

        // A payment that would fully retire the balance ends the loan right here —
        // regardless of whether this is a bounded (non-final, pre-renewal) segment or
        // the open-ended final one. Without this check, a bounded segment whose fixed
        // payment overpays the remaining balance before termMonths is reached would
        // keep generating full payments against an already-paid-off loan, driving the
        // balance (and therefore interest = balance * r) negative for every remaining
        // scheduled row.
        const wouldPayOffThisRow =
          round2(balance - round2(monthlyPayment - interestPortion)) <= 0;
        // Also force-clear the scheduled last row of a fully-amortizing final segment,
        // even when the natural math leaves a sub-cent residual rather than exactly 0.
        const isScheduledFinalRow =
          isFinalSegment && knownLength !== undefined && paymentIndex === knownLength - 1;

        if (wouldPayOffThisRow || isScheduledFinalRow) {
          // Final payment: force principal to clear the balance exactly rather than
          // trusting rounding (or an overpayment) to land on zero.
          principalPortion = balance;
          paymentAmount = round2(interestPortion + principalPortion);
          remainingBalance = 0;
        } else {
          principalPortion = round2(monthlyPayment - interestPortion);
          paymentAmount = monthlyPayment;
          remainingBalance = round2(balance - principalPortion);
        }
      }
    }

    rows.push({
      paymentNumber,
      segmentIndex,
      paymentDate: addMonths(segment.startDate, paymentIndex),
      paymentAmount,
      interestPortion,
      principalPortion,
      remainingBalance,
      isManualOverride: Boolean(override),
      overrideReason: override?.reason,
    });

    balance = remainingBalance;
    paymentIndex += 1;

    // The loan is fully paid off — stop even if a bounded segment's termMonths hasn't
    // been reached yet (see wouldPayOffThisRow above). Harmless/redundant for the
    // final segment's own natural termination.
    if (balance === 0) break;
  }

  return { rows, endingBalance: balance, monthlyPayment };
}
