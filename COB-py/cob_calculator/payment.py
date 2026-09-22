from typing import Optional

from .money import round2
from .validate import validate_payment_inputs


def calculate_monthly_payment(
    balance: float,
    annual_interest_rate_percent: float,
    number_of_payments: int,
    periodic_rate: Optional[float] = None,
) -> float:
    """Standard fixed-rate annuity payment formula:
        r = annualInterestRatePercent / 100 / 12
        M = balance * [ r(1+r)^n ] / [ (1+r)^n - 1 ]
    with the r = 0 edge case handled separately (M = balance / n) to avoid division by
    zero. Returns the payment rounded to cents.

    `periodic_rate`, when given, overrides the `annual_interest_rate_percent / 100 / 12`
    derivation with a pre-derived per-period rate -- e.g. the semi-annual->periodic
    conversion (docs/new-req/006-cost-of-borrowing-disclosure.md, equation 1) or the
    nominal/n convention for a non-monthly payment frequency (equation 2), neither of
    which is `rate/100/12`. This is additive/backward-compatible: every existing caller
    omits it and gets the original monthly-only behavior unchanged.
    `annual_interest_rate_percent` is still validated (and still the number reported
    back to callers) even when `periodic_rate` is supplied.
    """
    validate_payment_inputs(balance, annual_interest_rate_percent, number_of_payments)

    r = periodic_rate if periodic_rate is not None else annual_interest_rate_percent / 100 / 12
    if r == 0:
        return round2(balance / number_of_payments)

    factor = (1 + r) ** number_of_payments
    payment = (balance * (r * factor)) / (factor - 1)
    return round2(payment)
