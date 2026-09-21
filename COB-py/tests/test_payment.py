import pytest

from cob_calculator.payment import calculate_monthly_payment


def test_standard_annuity_payment():
    assert calculate_monthly_payment(300000, 6.5, 360) == 1896.2


def test_zero_rate_is_a_plain_division():
    assert calculate_monthly_payment(120000, 0, 120) == 1000.0


def test_rejects_non_positive_principal():
    with pytest.raises(ValueError):
        calculate_monthly_payment(0, 6, 360)


def test_rejects_non_integer_number_of_payments():
    with pytest.raises(ValueError):
        calculate_monthly_payment(100000, 6, 12.5)
