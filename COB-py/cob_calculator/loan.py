from __future__ import annotations

from datetime import date
from dataclasses import replace

from .money import js_round
from .mortgage import summarize_mortgage
from .types import HomePriceLoanInput, LoanInput, LoanSummary, MortgageInput, Segment
from .validate import validate_loan_input


def to_single_segment_mortgage(input: LoanInput) -> MortgageInput:
    """Convenience wrapper for the simple, non-renewing case (a single fixed-rate loan
    from origination to payoff). Builds a one-segment MortgageInput so the simple loan
    case and the segmented/renewal case share one implementation."""
    validate_loan_input(input)
    return MortgageInput(
        segments=[
            Segment(
                start_date=input.start_date if input.start_date is not None else date.today(),
                annual_interest_rate_percent=input.annual_interest_rate_percent,
                amortization_months_remaining=js_round(input.term_years * 12),
                starting_balance=input.loan_amount,
                # term_months intentionally omitted so this single segment runs to payoff.
            )
        ]
    )


def summarize_loan(input: LoanInput) -> LoanSummary:
    return summarize_mortgage(to_single_segment_mortgage(input))


def from_home_price(input: HomePriceLoanInput) -> LoanInput:
    """Pure adapter: derives loan_amount from home_price - down_payment."""
    if not (input.down_payment < input.home_price):
        raise ValueError(
            f"downPayment ({input.down_payment}) must be less than homePrice ({input.home_price})"
        )
    return LoanInput(
        loan_amount=input.home_price - input.down_payment,
        annual_interest_rate_percent=input.annual_interest_rate_percent,
        term_years=input.term_years,
        start_date=input.start_date,
    )
