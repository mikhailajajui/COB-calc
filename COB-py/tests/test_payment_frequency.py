from datetime import date

import pytest

from cob_calculator.payment_frequency import calculate_payment_frequency_schedule
from cob_calculator.types import PaymentFrequencyScheduleInput


def test_monthly_frequency_matches_baseline_exactly():
    result = calculate_payment_frequency_schedule(
        PaymentFrequencyScheduleInput(
            loan_amount=250000,
            annual_interest_rate_percent=6,
            term_months=360,
            frequency="monthly",
            start_date=date(2024, 1, 1),
        )
    )
    assert result.months_saved == 0
    assert result.interest_saved == 0
    assert result.number_of_periods == result.original_months


def test_biweekly_accelerates_payoff_and_saves_interest():
    result = calculate_payment_frequency_schedule(
        PaymentFrequencyScheduleInput(
            loan_amount=250000,
            annual_interest_rate_percent=6,
            term_months=360,
            frequency="biweekly",
            start_date=date(2024, 1, 1),
        )
    )
    assert result.payments_per_year == 26
    assert result.period_payment_amount == pytest.approx(result.monthly_payment / 2, abs=0.01)
    assert result.months_saved > 0
    assert result.interest_saved > 0
    assert result.schedule[-1].remaining_balance == 0


def test_weekly_period_dates_step_by_seven_days():
    result = calculate_payment_frequency_schedule(
        PaymentFrequencyScheduleInput(
            loan_amount=250000,
            annual_interest_rate_percent=6,
            term_months=360,
            frequency="weekly",
            start_date=date(2024, 1, 1),
        )
    )
    assert (result.schedule[1].period_date - result.schedule[0].period_date).days == 7
    assert result.payments_per_year == 52


def test_invalid_frequency_raises():
    with pytest.raises(ValueError):
        calculate_payment_frequency_schedule(
            PaymentFrequencyScheduleInput(
                loan_amount=250000,
                annual_interest_rate_percent=6,
                term_months=360,
                frequency="fortnightly",  # not a valid PaymentFrequency
            )
        )
