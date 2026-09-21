from __future__ import annotations

from dataclasses import dataclass
from datetime import date

from .loan import summarize_loan
from .types import LoanInput
from .validate import validate_term_comparison_input


@dataclass
class TermComparisonEntry:
    input: LoanInput
    monthly_payment: float
    total_interest_paid: float
    total_of_payments: float
    payoff_date: date


@dataclass
class TermComparisonResult:
    entries: list[TermComparisonEntry]
    lowest_monthly_payment_index: int
    lowest_total_interest_index: int


def compare_loan_terms(loans: list[LoanInput]) -> TermComparisonResult:
    """Pure aggregation over summarize_loan() per entry. Ties resolve to the first
    (lowest) index."""
    validate_term_comparison_input(loans)

    entries = []
    for input in loans:
        summary = summarize_loan(input)
        entries.append(
            TermComparisonEntry(
                input=input,
                monthly_payment=summary.segment_summaries[0].monthly_payment,
                total_interest_paid=summary.total_interest_paid,
                total_of_payments=summary.total_of_payments,
                payoff_date=summary.payoff_date,
            )
        )

    lowest_monthly_payment_index = 0
    lowest_total_interest_index = 0
    for i in range(1, len(entries)):
        if entries[i].monthly_payment < entries[lowest_monthly_payment_index].monthly_payment:
            lowest_monthly_payment_index = i
        if entries[i].total_interest_paid < entries[lowest_total_interest_index].total_interest_paid:
            lowest_total_interest_index = i

    return TermComparisonResult(
        entries=entries,
        lowest_monthly_payment_index=lowest_monthly_payment_index,
        lowest_total_interest_index=lowest_total_interest_index,
    )
