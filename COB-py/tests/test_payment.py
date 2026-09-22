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


# --- periodic_rate override (added for docs/new-req/006-cost-of-borrowing-disclosure.md;
# additive/backward-compatible -- every test above omits it and is unaffected) ---


def test_periodic_rate_override_replaces_the_rate_100_12_derivation():
    # Same nominal 5% rate, but hand the annuity a pre-derived periodic rate that is
    # NOT rate/100/12 (here: the semi-annual->periodic conversion from equation 1) --
    # the payment must reflect the override, not the default monthly derivation.
    default_payment = calculate_monthly_payment(400000, 5, 300)
    overridden_payment = calculate_monthly_payment(400000, 5, 300, periodic_rate=0.0041239154651442345)
    assert overridden_payment != default_payment
    assert overridden_payment == pytest.approx(2326.42, abs=0.01)


def test_periodic_rate_override_omitted_keeps_original_behavior_unchanged():
    assert calculate_monthly_payment(300000, 6.5, 360, periodic_rate=None) == calculate_monthly_payment(
        300000, 6.5, 360
    )


def test_periodic_rate_override_does_not_bypass_validation():
    with pytest.raises(ValueError):
        calculate_monthly_payment(0, 5, 300, periodic_rate=0.004)
