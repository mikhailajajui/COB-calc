"""Domain-QA test suite for docs/new-req/002-fees-and-apr.md.

Invariants tested map 1:1 to the spec's "Invariants" section.
"""

import pytest

from cob_calculator.apr import AprInput, calculate_apr
from cob_calculator.fees import Fee, FeeSchedule


def test_no_fees_apr_equals_note_rate_exactly():
    result = calculate_apr(
        AprInput(loan_amount=300000, annual_interest_rate_percent=6.5, term_months=360, fees=FeeSchedule())
    )
    assert result.apr_percent == 6.5
    assert result.apr_minus_note_rate_percent == 0
    assert result.amount_financed == result.effective_loan_amount


def test_cash_fees_strictly_increase_apr_above_note_rate():
    result = calculate_apr(
        AprInput(
            loan_amount=300000,
            annual_interest_rate_percent=6.5,
            term_months=360,
            fees=FeeSchedule(fees=[Fee(name="Origination fee", amount=6000)]),
        )
    )
    assert result.apr_percent > 6.5
    assert result.apr_minus_note_rate_percent > 0


def test_financed_only_fees_do_not_change_apr():
    # Financing a fee increases what's owed but doesn't reduce what's netted --
    # amount_financed == effective_loan_amount in both cases, so APR == note rate.
    with_financed_fee = calculate_apr(
        AprInput(
            loan_amount=300000,
            annual_interest_rate_percent=6.5,
            term_months=360,
            fees=FeeSchedule(fees=[Fee(name="VA funding fee", amount=6000, financed=True)]),
        )
    )
    assert with_financed_fee.apr_percent == pytest.approx(6.5, abs=1e-6)
    assert with_financed_fee.effective_loan_amount == 306000
    assert with_financed_fee.amount_financed == 306000


def test_round_trip_solved_apr_reproduces_amount_financed():
    result = calculate_apr(
        AprInput(
            loan_amount=300000,
            annual_interest_rate_percent=6.5,
            term_months=360,
            fees=FeeSchedule(fees=[Fee(name="Origination", amount=4500), Fee(name="Application", amount=500)]),
        )
    )
    r = result.apr_percent / 100 / 12
    n = 360
    pv = result.monthly_payment * (1 - (1 + r) ** -n) / r
    assert pv == pytest.approx(result.amount_financed, abs=0.01)


def test_apr_monotonic_in_cash_fees():
    low = calculate_apr(
        AprInput(
            loan_amount=300000,
            annual_interest_rate_percent=6.5,
            term_months=360,
            fees=FeeSchedule(fees=[Fee(name="fee", amount=2000)]),
        )
    )
    high = calculate_apr(
        AprInput(
            loan_amount=300000,
            annual_interest_rate_percent=6.5,
            term_months=360,
            fees=FeeSchedule(fees=[Fee(name="fee", amount=8000)]),
        )
    )
    assert high.apr_percent > low.apr_percent


def test_fees_exceeding_loan_amount_is_rejected():
    with pytest.raises(ValueError):
        calculate_apr(
            AprInput(
                loan_amount=10000,
                annual_interest_rate_percent=6.5,
                term_months=360,
                fees=FeeSchedule(fees=[Fee(name="huge fee", amount=15000)]),
            )
        )


def test_apr_based_ranking_fixes_note_rate_only_ranking():
    # Same rate, same term, same monthly payment -- but offer B has higher cash fees.
    # A note-rate-only comparison sees these as identical; APR must not.
    offer_a = calculate_apr(
        AprInput(
            loan_amount=300000,
            annual_interest_rate_percent=6.0,
            term_months=360,
            fees=FeeSchedule(fees=[Fee(name="fee", amount=1000)]),
        )
    )
    offer_b = calculate_apr(
        AprInput(
            loan_amount=300000,
            annual_interest_rate_percent=6.0,
            term_months=360,
            fees=FeeSchedule(fees=[Fee(name="fee", amount=9000)]),
        )
    )
    assert offer_a.monthly_payment == offer_b.monthly_payment  # identical P&I payment
    assert offer_a.apr_percent < offer_b.apr_percent  # APR correctly distinguishes them


def test_fee_schedule_totals():
    schedule = FeeSchedule(
        fees=[
            Fee(name="Origination", amount=3000),
            Fee(name="VA funding fee", amount=6000, financed=True),
            Fee(name="Appraisal", amount=500),
        ]
    )
    assert schedule.total_fees == 9500
    assert schedule.total_financed_fees == 6000
    assert schedule.total_cash_fees == 3500


def test_fee_rejects_negative_amount():
    with pytest.raises(ValueError):
        Fee(name="bad", amount=-100)
