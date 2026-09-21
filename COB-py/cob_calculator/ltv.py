from .validate import validate_cltv_inputs, validate_ltv_inputs


def loan_to_value(loan_amount: float, property_value: float) -> float:
    """LTV = loanAmount / propertyValue, as an unrounded decimal ratio (0.9 = 90%)."""
    validate_ltv_inputs(loan_amount, property_value)
    return loan_amount / property_value


def combined_loan_to_value(
    first_lien_balance: float, second_lien_balance: float, property_value: float
) -> float:
    """CLTV = (firstLienBalance + secondLienBalance) / propertyValue, unrounded ratio."""
    validate_cltv_inputs(first_lien_balance, second_lien_balance, property_value)
    return (first_lien_balance + second_lien_balance) / property_value
