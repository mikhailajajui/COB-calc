"""Domain-QA test suite for docs/new-req/001-yearly-summary-report-window.md.

Invariants tested map 1:1 to the spec's "Invariants" section.
"""

from datetime import date

import pytest

from cob_calculator.loan import summarize_loan
from cob_calculator.mortgage import summarize_mortgage
from cob_calculator.reporting import summarize_report_window, summarize_schedule_by_year
from cob_calculator.types import MortgageInput, PmiInput, RecurringCost, RecurringCosts, Segment
from cob_calculator.types import LoanInput


def _thirty_year_loan():
    return summarize_loan(
        LoanInput(
            loan_amount=300000,
            annual_interest_rate_percent=6.5,
            term_years=30,
            start_date=date(2024, 1, 1),
        )
    )


def test_round_trip_interest_and_principal_match_whole_loan_totals():
    summary = _thirty_year_loan()
    yearly = summarize_schedule_by_year(summary.schedule)

    assert sum(y.total_interest for y in yearly) == pytest.approx(summary.total_interest_paid, abs=0.01)
    original_principal = summary.schedule[0].remaining_balance + summary.schedule[0].principal_portion
    assert sum(y.total_principal for y in yearly) == pytest.approx(original_principal, abs=0.01)
    assert len(yearly) == 30


def test_final_year_clears_the_balance_for_a_fully_amortizing_loan():
    summary = _thirty_year_loan()
    yearly = summarize_schedule_by_year(summary.schedule)
    assert yearly[-1].ending_balance == 0


def test_partial_final_year_is_reported_not_dropped():
    # 362 months: 30 full years (360) + a 2-payment final year.
    summary = summarize_loan(
        LoanInput(loan_amount=50000, annual_interest_rate_percent=5, term_years=362 / 12, start_date=date(2024, 1, 1))
    )
    # amortization_months_remaining is derived via js_round(term_years*12); confirm we
    # actually got 362 rows before asserting on the partial-year behavior.
    assert summary.number_of_payments == 362
    yearly = summarize_schedule_by_year(summary.schedule)
    assert len(yearly) == 31
    assert yearly[-1].payments_in_year == 2
    assert yearly[-1].ending_balance == 0


def test_report_window_matches_raw_schedule_at_the_boundary():
    summary = _thirty_year_loan()
    window = summarize_report_window(summary, 5)

    assert window.through_payment_number == 60
    assert window.ending_balance == summary.schedule[59].remaining_balance
    assert len(window.yearly) == 5
    assert window.paid_off_within_window is False


def test_report_window_beyond_payoff_returns_the_whole_loan():
    summary = summarize_loan(
        LoanInput(loan_amount=200000, annual_interest_rate_percent=6, term_years=15, start_date=date(2024, 1, 1))
    )
    window = summarize_report_window(summary, 30)  # loan only runs 15 years

    assert window.through_payment_number == summary.number_of_payments
    assert window.ending_balance == 0
    assert window.paid_off_within_window is True
    assert window.percent_of_term_elapsed == pytest.approx(1.0)


def test_cost_fields_are_none_when_untracked():
    summary = _thirty_year_loan()
    yearly = summarize_schedule_by_year(summary.schedule)
    assert all(y.total_tax is None for y in yearly)
    assert all(y.total_pmi is None for y in yearly)


def test_cost_fields_are_populated_when_tracked_including_pmi_dropoff():
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
            recurring_costs=RecurringCosts(property_tax=RecurringCost(annual_amount=4800)),
        )
    )
    yearly = summarize_schedule_by_year(summary.schedule)
    assert yearly[0].total_tax == pytest.approx(4800, abs=0.01)
    # PMI is active early and (per the fixture in test_costs_pmi.py) drops later --
    # some year must show total_pmi > 0 and a later year must show it hit 0.
    assert any(y.total_pmi and y.total_pmi > 0 for y in yearly)
    assert any(y.total_pmi == 0 for y in yearly)


def test_through_years_must_be_positive():
    summary = _thirty_year_loan()
    with pytest.raises(ValueError):
        summarize_report_window(summary, 0)


def test_starting_balance_chains_across_years():
    summary = _thirty_year_loan()
    yearly = summarize_schedule_by_year(summary.schedule)
    for prev, nxt in zip(yearly, yearly[1:]):
        assert nxt.starting_balance == prev.ending_balance
