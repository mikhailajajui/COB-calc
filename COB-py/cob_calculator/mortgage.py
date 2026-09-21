from __future__ import annotations

from dataclasses import dataclass, replace

from .costs import apply_recurring_costs
from .money import round2
from .segment import compute_segment_schedule
from .types import (
    AmortizationEntry,
    BalloonPaymentDue,
    LoanSummary,
    LumpSumPayment,
    ManualPaymentOverride,
    MortgageInput,
    SegmentSummary,
)
from .validate import validate_mortgage_input, validate_overrides_in_range


@dataclass
class _StitchedSchedule:
    rows: list[AmortizationEntry]
    segment_summaries: list[SegmentSummary]


def _stitch_segments(input: MortgageInput) -> _StitchedSchedule:
    validate_mortgage_input(input)

    overrides_by_payment_number: dict[int, ManualPaymentOverride] = {
        o.payment_number: o for o in (input.manual_overrides or [])
    }
    lump_sums_by_payment_number: dict[int, LumpSumPayment] = {
        l.after_payment_number: l for l in (input.lump_sum_payments or [])
    }

    rows: list[AmortizationEntry] = []
    segment_summaries: list[SegmentSummary] = []
    balance = input.segments[0].starting_balance
    next_payment_number = 1

    for index, segment in enumerate(input.segments):
        starting_balance = balance
        result = compute_segment_schedule(
            segment, index, starting_balance, next_payment_number, overrides_by_payment_number
        )

        rows.extend(result.rows)
        segment_summaries.append(
            SegmentSummary(
                segment_index=index,
                monthly_payment=result.monthly_payment,
                starting_balance=starting_balance,
                ending_balance=result.ending_balance,
            )
        )

        balance = result.ending_balance
        next_payment_number += len(result.rows)

        boundary_payment_number = next_payment_number - 1
        lump_sum = lump_sums_by_payment_number.get(boundary_payment_number)
        if lump_sum is not None:
            last_row = rows[-1]
            curtailment = min(lump_sum.amount, last_row.remaining_balance)
            rows[-1] = replace(
                last_row,
                principal_portion=round2(last_row.principal_portion + curtailment),
                payment_amount=round2(last_row.payment_amount + curtailment),
                remaining_balance=round2(last_row.remaining_balance - curtailment),
            )
            balance = rows[-1].remaining_balance
            segment_summaries[-1] = replace(segment_summaries[-1], ending_balance=balance)
            del lump_sums_by_payment_number[boundary_payment_number]

        # If a lump sum fully clears the balance at a boundary, there is nothing left
        # for a subsequent segment to amortize -- stop here.
        if balance <= 0 and index < len(input.segments) - 1:
            break

    if len(overrides_by_payment_number) > 0:
        unresolved = list(overrides_by_payment_number.values())
        validate_overrides_in_range(unresolved, len(rows))
        numbers = ", ".join(str(o.payment_number) for o in unresolved)
        raise ValueError(
            f"manualOverrides contain unconsumed paymentNumber(s) (duplicates within "
            f"range?): {numbers}"
        )

    return _StitchedSchedule(rows=rows, segment_summaries=segment_summaries)


def compute_mortgage_schedule(input: MortgageInput) -> list[AmortizationEntry]:
    return _stitch_segments(input).rows


def summarize_mortgage(input: MortgageInput) -> LoanSummary:
    stitched = _stitch_segments(input)
    rows = stitched.rows
    segment_summaries = stitched.segment_summaries

    total_of_payments = round2(sum(row.payment_amount for row in rows))
    total_interest_paid = round2(sum(row.interest_portion for row in rows))
    last_row = rows[-1]

    # Keyed off whichever segment actually finished last (not necessarily
    # input.segments[-1] -- a lump sum can end the schedule early).
    last_executed_segment = input.segments[len(segment_summaries) - 1]
    balloon_payment_due = (
        BalloonPaymentDue(
            segment_index=len(segment_summaries) - 1,
            amount=segment_summaries[-1].ending_balance,
            due_date=last_row.payment_date,
        )
        if last_executed_segment.balloon
        else None
    )

    final_rows = rows
    cost_breakdown = None
    if input.recurring_costs or input.pmi:
        applied = apply_recurring_costs(rows, input.recurring_costs, input.pmi)
        final_rows = applied.rows
        cost_breakdown = applied.breakdown

    return LoanSummary(
        schedule=final_rows,
        total_of_payments=total_of_payments,
        total_interest_paid=total_interest_paid,
        number_of_payments=len(rows),
        payoff_date=last_row.payment_date,
        segment_summaries=segment_summaries,
        balloon_payment_due=balloon_payment_due,
        cost_breakdown=cost_breakdown,
    )
