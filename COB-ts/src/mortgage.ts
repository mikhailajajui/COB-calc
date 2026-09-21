import { round2 } from './money.js';
import { computeSegmentSchedule } from './segment.js';
import { applyRecurringCosts } from './costs.js';
import { validateMortgageInput, validateOverridesInRange } from './validate.js';
import type {
  AmortizationEntry,
  LoanSummary,
  LumpSumPayment,
  ManualPaymentOverride,
  MortgageInput,
  SegmentSummary,
} from './types.js';

interface StitchedSchedule {
  rows: AmortizationEntry[];
  segmentSummaries: SegmentSummary[];
}

function stitchSegments(input: MortgageInput): StitchedSchedule {
  validateMortgageInput(input);

  const overridesByPaymentNumber = new Map<number, ManualPaymentOverride>(
    (input.manualOverrides ?? []).map((o) => [o.paymentNumber, o]),
  );
  const lumpSumsByPaymentNumber = new Map<number, LumpSumPayment>(
    (input.lumpSumPayments ?? []).map((l) => [l.afterPaymentNumber, l]),
  );

  const rows: AmortizationEntry[] = [];
  const segmentSummaries: SegmentSummary[] = [];
  let balance = input.segments[0]!.startingBalance!;
  let nextPaymentNumber = 1;

  for (let index = 0; index < input.segments.length; index += 1) {
    const segment = input.segments[index]!;
    const startingBalance = balance;
    const { rows: segmentRows, endingBalance, monthlyPayment } = computeSegmentSchedule(
      segment,
      index,
      startingBalance,
      nextPaymentNumber,
      overridesByPaymentNumber,
    );

    rows.push(...segmentRows);
    segmentSummaries.push({
      segmentIndex: index,
      monthlyPayment,
      startingBalance,
      endingBalance,
    });

    balance = endingBalance;
    nextPaymentNumber += segmentRows.length;

    const boundaryPaymentNumber = nextPaymentNumber - 1;
    const lumpSum = lumpSumsByPaymentNumber.get(boundaryPaymentNumber);
    if (lumpSum !== undefined) {
      const lastRow = rows[rows.length - 1]!;
      const curtailment = Math.min(lumpSum.amount, lastRow.remainingBalance);
      lastRow.principalPortion = round2(lastRow.principalPortion + curtailment);
      lastRow.paymentAmount = round2(lastRow.paymentAmount + curtailment);
      lastRow.remainingBalance = round2(lastRow.remainingBalance - curtailment);
      balance = lastRow.remainingBalance;
      segmentSummaries[segmentSummaries.length - 1]!.endingBalance = balance;
      lumpSumsByPaymentNumber.delete(boundaryPaymentNumber);
    }

    // If a lump sum fully clears the balance at a boundary, there is nothing left for
    // a subsequent segment to amortize — stop here rather than calling
    // calculateMonthlyPayment(0, ...), which would throw.
    if (balance <= 0 && index < input.segments.length - 1) {
      break;
    }
  }

  if (overridesByPaymentNumber.size > 0) {
    const unresolved = [...overridesByPaymentNumber.values()];
    validateOverridesInRange(unresolved, rows.length);
    throw new RangeError(
      `manualOverrides contain unconsumed paymentNumber(s) (duplicates within range?): ${unresolved
        .map((o) => o.paymentNumber)
        .join(', ')}`,
    );
  }

  return { rows, segmentSummaries };
}

export function computeMortgageSchedule(input: MortgageInput): AmortizationEntry[] {
  return stitchSegments(input).rows;
}

export function summarizeMortgage(input: MortgageInput): LoanSummary {
  const { rows, segmentSummaries } = stitchSegments(input);

  const totalOfPayments = round2(rows.reduce((sum, row) => sum + row.paymentAmount, 0));
  const totalInterestPaid = round2(rows.reduce((sum, row) => sum + row.interestPortion, 0));
  const lastRow = rows[rows.length - 1]!;

  // Keyed off whichever segment actually finished last (not necessarily
  // input.segments[input.segments.length - 1] — a lump sum can end the schedule early).
  const lastExecutedSegment = input.segments[segmentSummaries.length - 1]!;
  const balloonPaymentDue = lastExecutedSegment.balloon
    ? {
        segmentIndex: segmentSummaries.length - 1,
        amount: segmentSummaries[segmentSummaries.length - 1]!.endingBalance,
        dueDate: lastRow.paymentDate,
      }
    : undefined;

  let finalRows = rows;
  let costBreakdown: LoanSummary['costBreakdown'];
  if (input.recurringCosts || input.pmi) {
    const applied = applyRecurringCosts(rows, input.recurringCosts, input.pmi);
    finalRows = applied.rows;
    costBreakdown = applied.breakdown;
  }

  return {
    schedule: finalRows,
    totalOfPayments,
    totalInterestPaid,
    numberOfPayments: rows.length,
    payoffDate: lastRow.paymentDate,
    segmentSummaries,
    balloonPaymentDue,
    costBreakdown,
  };
}
