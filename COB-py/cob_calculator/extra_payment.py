from __future__ import annotations

from datetime import date

from .money import round2
from .mortgage import summarize_mortgage
from .payment import calculate_monthly_payment
from .types import ExtraPaymentSavingsInput, ExtraPaymentSavingsResult, MortgageInput, Segment
from .validate import validate_extra_payment_savings_input


def calculate_extra_payment_savings(input: ExtraPaymentSavingsInput) -> ExtraPaymentSavingsResult:
    """Composes two summarize_mortgage() calls (baseline vs. with an extra monthly
    principal payment) rather than reimplementing amortization."""
    validate_extra_payment_savings_input(input)

    start_date = input.start_date if input.start_date is not None else date.today()

    baseline = summarize_mortgage(
        MortgageInput(
            segments=[
                Segment(
                    start_date=start_date,
                    annual_interest_rate_percent=input.annual_interest_rate_percent,
                    amortization_months_remaining=input.term_months,
                    starting_balance=input.loan_amount,
                )
            ]
        )
    )

    # Zero extra payment is mathematically identical to the baseline -- short-circuit
    # rather than re-deriving it through the open-ended dynamic loop, whose per-payment
    # cent rounding can land on one payment more or fewer than the
    # amortization_months_remaining-bounded baseline even when the payment amount is
    # unchanged.
    if input.extra_monthly_payment == 0:
        return ExtraPaymentSavingsResult(
            original_months=baseline.number_of_payments,
            new_months=baseline.number_of_payments,
            months_saved=0,
            original_total_interest=baseline.total_interest_paid,
            new_total_interest=baseline.total_interest_paid,
            interest_saved=0,
        )

    base_payment = calculate_monthly_payment(
        input.loan_amount, input.annual_interest_rate_percent, input.term_months
    )

    with_extra = summarize_mortgage(
        MortgageInput(
            segments=[
                Segment(
                    start_date=start_date,
                    annual_interest_rate_percent=input.annual_interest_rate_percent,
                    payment_amount=round2(base_payment + input.extra_monthly_payment),
                    starting_balance=input.loan_amount,
                    # amortization_months_remaining/term_months intentionally omitted:
                    # the payoff length with extra payments isn't known in advance, so
                    # the engine runs the open-ended payment-only branch until the
                    # balance reaches zero.
                )
            ]
        )
    )

    return ExtraPaymentSavingsResult(
        original_months=baseline.number_of_payments,
        new_months=with_extra.number_of_payments,
        months_saved=baseline.number_of_payments - with_extra.number_of_payments,
        original_total_interest=baseline.total_interest_paid,
        new_total_interest=with_extra.total_interest_paid,
        interest_saved=round2(baseline.total_interest_paid - with_extra.total_interest_paid),
    )
