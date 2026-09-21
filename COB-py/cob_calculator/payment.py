from .money import round2
from .validate import validate_payment_inputs


def calculate_monthly_payment(
    balance: float, annual_interest_rate_percent: float, number_of_payments: int
) -> float:
    """Standard fixed-rate annuity payment formula:
        r = annualInterestRatePercent / 100 / 12
        M = balance * [ r(1+r)^n ] / [ (1+r)^n - 1 ]
    with the r = 0 edge case handled separately (M = balance / n) to avoid division by
    zero. Returns the payment rounded to cents.
    """
    validate_payment_inputs(balance, annual_interest_rate_percent, number_of_payments)

    r = annual_interest_rate_percent / 100 / 12
    if r == 0:
        return round2(balance / number_of_payments)

    factor = (1 + r) ** number_of_payments
    payment = (balance * (r * factor)) / (factor - 1)
    return round2(payment)
