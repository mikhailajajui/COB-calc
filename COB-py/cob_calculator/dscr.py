from .validate import validate_dscr_inputs


def debt_service_coverage_ratio(net_operating_income: float, annual_debt_service: float) -> float:
    """DSCR = netOperatingIncome / annualDebtService, unrounded ratio. Values > 1.0
    indicate sufficient income to cover debt."""
    validate_dscr_inputs(net_operating_income, annual_debt_service)
    return net_operating_income / annual_debt_service
