from datetime import date

from cob_calculator.mortgage import summarize_mortgage
from cob_calculator.pmi import calculate_pmi_payment
from cob_calculator.types import (
    MortgageInput,
    PmiInput,
    RecurringCost,
    RecurringCosts,
    Segment,
)


def test_pmi_payment_formula():
    assert calculate_pmi_payment(300000, 0.5) == 125.0


def test_pmi_drops_when_ltv_reaches_threshold_and_is_reported():
    summary = summarize_mortgage(
        MortgageInput(
            segments=[
                Segment(
                    start_date=date(2024, 1, 1),
                    annual_interest_rate_percent=6,
                    amortization_months_remaining=360,
                    starting_balance=380000,
                )
            ],
            pmi=PmiInput(annual_rate_percent=0.6, property_value=400000, drop_at_ltv_percent=80),
        )
    )
    breakdown = summary.cost_breakdown
    assert breakdown is not None
    assert breakdown.total_pmi_paid > 0
    assert breakdown.pmi_dropped_at_payment_number is not None

    dropped_row = next(
        r for r in summary.schedule if r.payment_number == breakdown.pmi_dropped_at_payment_number
    )
    assert dropped_row.pmi_portion == 0
    prior_row = next(
        r for r in summary.schedule if r.payment_number == breakdown.pmi_dropped_at_payment_number - 1
    )
    assert prior_row.pmi_portion > 0


def test_recurring_costs_escalate_annually_and_roll_into_total_cost_of_ownership():
    summary = summarize_mortgage(
        MortgageInput(
            segments=[
                Segment(
                    start_date=date(2024, 1, 1),
                    annual_interest_rate_percent=6,
                    amortization_months_remaining=24,
                    starting_balance=50000,
                )
            ],
            recurring_costs=RecurringCosts(
                property_tax=RecurringCost(annual_amount=1200, annual_increase_percent=10)
            ),
        )
    )
    year1_tax = summary.schedule[0].tax_portion
    year2_tax = summary.schedule[12].tax_portion
    assert year1_tax == 100.0
    assert year2_tax == 110.0
    assert summary.cost_breakdown.total_cost_of_ownership > summary.total_of_payments
