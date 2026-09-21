"""Domain-QA test suite for docs/new-req/003-dti-and-affordability.md.

Invariants tested map 1:1 to the spec's "Invariants" section.
"""

import pytest

from cob_calculator.dti import AffordabilityInput, DtiInput, calculate_affordability, calculate_dti
from cob_calculator.payment import calculate_monthly_payment


def test_dti_is_pure_ratio_arithmetic():
    result = calculate_dti(
        DtiInput(gross_monthly_income=8000, housing_payment=2000, other_monthly_debts=800)
    )
    assert result.front_end_dti == pytest.approx(2000 / 8000)
    assert result.back_end_dti == pytest.approx(2800 / 8000)


@pytest.mark.parametrize(
    "housing_payment,other_debts",
    [
        (2000, 800),  # front 25% ok, back 35% ok -> qualifies
        (2400, 800),  # front 30% not ok, back 40% not ok -> fails both
        (2000, 2000),  # front 25% ok, back 50% not ok -> fails back only
        (2500, 300),  # front 31.25% not ok, back 35% ok -> fails front only
    ],
)
def test_qualifies_is_and_of_both_subchecks(housing_payment, other_debts):
    result = calculate_dti(
        DtiInput(gross_monthly_income=8000, housing_payment=housing_payment, other_monthly_debts=other_debts),
        front_end_max_percent=28,
        back_end_max_percent=36,
    )
    assert result.front_end_ok == (housing_payment / 8000 <= 0.28)
    assert result.back_end_ok == ((housing_payment + other_debts) / 8000 <= 0.36)
    assert result.qualifies == (result.front_end_ok and result.back_end_ok)


def test_affordability_round_trips_through_monthly_payment():
    result = calculate_affordability(
        AffordabilityInput(
            gross_monthly_income=9000,
            other_monthly_debts=500,
            annual_interest_rate_percent=6.5,
            term_months=360,
            non_pi_housing_costs=400,
        )
    )
    assert result.max_pi_payment > 0
    recomputed_payment = calculate_monthly_payment(result.max_loan_amount, 6.5, 360)
    assert recomputed_payment == pytest.approx(result.max_pi_payment, abs=0.01)


def test_affordability_zero_rate_uses_linear_branch():
    result = calculate_affordability(
        AffordabilityInput(
            gross_monthly_income=9000,
            other_monthly_debts=0,
            annual_interest_rate_percent=0,
            term_months=120,
        )
    )
    assert result.max_loan_amount == pytest.approx(result.max_pi_payment * 120, abs=0.01)


def test_binding_constraint_front_end_when_other_debts_are_low():
    # Low other debts + generous back-end threshold -> front-end (tighter housing-cost
    # ratio) binds first.
    result = calculate_affordability(
        AffordabilityInput(
            gross_monthly_income=10000,
            other_monthly_debts=0,
            annual_interest_rate_percent=6.5,
            term_months=360,
            non_pi_housing_costs=0,
            front_end_max_percent=20,  # tight front-end
            back_end_max_percent=50,  # loose back-end
        )
    )
    assert result.binding_constraint == "front_end"


def test_binding_constraint_back_end_when_other_debts_are_high():
    result = calculate_affordability(
        AffordabilityInput(
            gross_monthly_income=10000,
            other_monthly_debts=3000,  # heavy existing debt load
            annual_interest_rate_percent=6.5,
            term_months=360,
            non_pi_housing_costs=0,
            front_end_max_percent=28,
            back_end_max_percent=36,
        )
    )
    assert result.binding_constraint == "back_end"


def test_non_qualification_reports_zero_not_negative():
    result = calculate_affordability(
        AffordabilityInput(
            gross_monthly_income=3000,
            other_monthly_debts=2000,  # debts alone exceed the back-end allowance
            annual_interest_rate_percent=6.5,
            term_months=360,
            non_pi_housing_costs=500,
            back_end_max_percent=36,
        )
    )
    assert result.max_pi_payment == 0
    assert result.max_loan_amount == 0
    assert result.qualifies is False


def test_max_home_price_includes_down_payment():
    result = calculate_affordability(
        AffordabilityInput(
            gross_monthly_income=9000,
            other_monthly_debts=500,
            annual_interest_rate_percent=6.5,
            term_months=360,
            down_payment=50000,
        )
    )
    assert result.max_home_price == pytest.approx(result.max_loan_amount + 50000, abs=0.01)


def test_looser_threshold_affords_strictly_more():
    # other_monthly_debts=1000 makes back-end the binding constraint at 36% (back
    # allowance 2240 < front allowance 2520); loosening to 43% relaxes it past the
    # front-end allowance, so the ceiling should strictly increase.
    conventional = calculate_affordability(
        AffordabilityInput(
            gross_monthly_income=9000,
            other_monthly_debts=1000,
            annual_interest_rate_percent=6.5,
            term_months=360,
            back_end_max_percent=36,
        )
    )
    fha_style = calculate_affordability(
        AffordabilityInput(
            gross_monthly_income=9000,
            other_monthly_debts=1000,
            annual_interest_rate_percent=6.5,
            term_months=360,
            back_end_max_percent=43,
        )
    )
    assert conventional.binding_constraint == "back_end"
    assert fha_style.max_loan_amount > conventional.max_loan_amount


def test_dti_rejects_zero_income():
    with pytest.raises(ValueError):
        calculate_dti(DtiInput(gross_monthly_income=0, housing_payment=1000, other_monthly_debts=0))
