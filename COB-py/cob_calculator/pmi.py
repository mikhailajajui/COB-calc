from .money import round2
from .validate import validate_pmi_payment_inputs


def calculate_pmi_payment(loan_balance: float, annual_rate_percent: float) -> float:
    """Monthly PMI payment against a given balance (typically the original loan
    amount -- PMI doesn't vary month-to-month like a running-balance figure would)."""
    validate_pmi_payment_inputs(loan_balance, annual_rate_percent)
    return round2((loan_balance * annual_rate_percent) / 100 / 12)
