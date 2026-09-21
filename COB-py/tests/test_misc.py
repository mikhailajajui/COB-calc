import math
from datetime import date

import pytest

from cob_calculator.arm import ArmResetInput, calculate_arm_reset_rate
from cob_calculator.compare import compare_loan_terms
from cob_calculator.dscr import debt_service_coverage_ratio
from cob_calculator.extra_payment import calculate_extra_payment_savings
from cob_calculator.import_overrides import import_overrides_from_csv, import_overrides_from_json
from cob_calculator.loan import from_home_price, summarize_loan
from cob_calculator.ltv import combined_loan_to_value, loan_to_value
from cob_calculator.points import PointsBreakevenInput, calculate_points_breakeven
from cob_calculator.refinance import RefinanceComparisonInput, compare_refinance
from cob_calculator.types import ExtraPaymentSavingsInput, HomePriceLoanInput, LoanInput


def test_ltv_and_cltv():
    assert loan_to_value(270000, 300000) == pytest.approx(0.9)
    assert combined_loan_to_value(200000, 50000, 300000) == pytest.approx(250000 / 300000)


def test_dscr():
    assert debt_service_coverage_ratio(50000, 40000) == pytest.approx(1.25)
    with pytest.raises(ValueError):
        debt_service_coverage_ratio(50000, 0)


def test_arm_reset_caps_at_periodic_and_lifetime_limits():
    result = calculate_arm_reset_rate(
        ArmResetInput(
            previous_rate_percent=5.0,
            initial_rate_percent=4.0,
            index_rate_percent=5.5,
            margin_percent=2.25,
            initial_cap_percent=2,
            periodic_cap_percent=2,
            lifetime_cap_percent=5,
            is_first_reset=True,
        )
    )
    assert result.fully_indexed_rate_percent == pytest.approx(7.75)
    # capped by initial cap (previous 5.0 + 2 = 7.0) before the lifetime cap (4.0 + 5 = 9.0)
    assert result.capped_rate_percent == pytest.approx(7.0)


def test_points_breakeven_infinite_when_no_savings():
    result = calculate_points_breakeven(
        PointsBreakevenInput(
            loan_amount=300000, points=1, rate_reduction_percent=0, original_rate_percent=6.5, term_months=360
        )
    )
    assert result.monthly_savings == 0
    assert result.breakeven_months == math.inf


def test_refinance_breakeven_composes_two_loan_summaries():
    result = compare_refinance(
        RefinanceComparisonInput(
            old_loan=LoanInput(loan_amount=300000, annual_interest_rate_percent=6.5, term_years=30),
            new_loan=LoanInput(loan_amount=300000, annual_interest_rate_percent=5.5, term_years=30),
            closing_costs=5000,
        )
    )
    assert result.new_monthly_payment < result.old_monthly_payment
    assert result.breakeven_months > 0


def test_compare_loan_terms_picks_lowest_indices():
    result = compare_loan_terms(
        [
            LoanInput(loan_amount=300000, annual_interest_rate_percent=6.5, term_years=30),
            LoanInput(loan_amount=300000, annual_interest_rate_percent=6.5, term_years=15),
        ]
    )
    assert result.lowest_monthly_payment_index == 0  # 30yr has the lower monthly payment
    assert result.lowest_total_interest_index == 1  # 15yr has the lower total interest


def test_extra_payment_savings_shortens_term():
    result = calculate_extra_payment_savings(
        ExtraPaymentSavingsInput(
            loan_amount=300000,
            annual_interest_rate_percent=6.5,
            term_months=360,
            extra_monthly_payment=200,
            start_date=date(2024, 1, 1),
        )
    )
    assert result.new_months < result.original_months
    assert result.interest_saved > 0


def test_extra_payment_zero_is_identical_to_baseline():
    result = calculate_extra_payment_savings(
        ExtraPaymentSavingsInput(
            loan_amount=300000,
            annual_interest_rate_percent=6.5,
            term_months=360,
            extra_monthly_payment=0,
        )
    )
    assert result.months_saved == 0
    assert result.interest_saved == 0


def test_from_home_price_derives_loan_amount():
    loan_input = from_home_price(
        HomePriceLoanInput(home_price=500000, down_payment=100000, annual_interest_rate_percent=6, term_years=30)
    )
    assert loan_input.loan_amount == 400000


def test_from_home_price_rejects_down_payment_at_or_above_price():
    with pytest.raises(ValueError):
        from_home_price(
            HomePriceLoanInput(home_price=300000, down_payment=300000, annual_interest_rate_percent=6, term_years=30)
        )


def test_import_overrides_from_json():
    overrides = import_overrides_from_json(
        '[{"paymentNumber": 3, "paymentAmount": 1500, "reason": "bank fee"}]'
    )
    assert len(overrides) == 1
    assert overrides[0].payment_number == 3
    assert overrides[0].payment_amount == 1500
    assert overrides[0].reason == "bank fee"


def test_import_overrides_from_csv():
    csv_text = "paymentNumber,remainingBalance,reason\n5,145000,statement reconciliation\n"
    overrides = import_overrides_from_csv(csv_text)
    assert len(overrides) == 1
    assert overrides[0].payment_number == 5
    assert overrides[0].remaining_balance == 145000
    assert overrides[0].reason == "statement reconciliation"


def test_import_overrides_rejects_duplicate_payment_numbers():
    with pytest.raises(ValueError):
        import_overrides_from_json(
            '[{"paymentNumber": 3, "paymentAmount": 1500}, {"paymentNumber": 3, "paymentAmount": 1600}]'
        )
