"""DTI (debt-to-income) and affordability. See
docs/new-req/003-dti-and-affordability.md for the full spec."""

from __future__ import annotations

from dataclasses import dataclass

from .money import round2


@dataclass
class DtiInput:
    gross_monthly_income: float
    # Full PITI+HOA+PMI, not P&I alone -- front-end ratios are about total
    # housing cost.
    housing_payment: float
    other_monthly_debts: float


@dataclass
class DtiResult:
    front_end_dti: float
    back_end_dti: float
    front_end_max_percent: float
    back_end_max_percent: float
    front_end_ok: bool
    back_end_ok: bool
    qualifies: bool


def _validate_dti_input(input: DtiInput) -> None:
    if not (input.gross_monthly_income > 0):
        raise ValueError(f"grossMonthlyIncome must be > 0, got {input.gross_monthly_income}")
    if not (input.housing_payment >= 0):
        raise ValueError(f"housingPayment must be >= 0, got {input.housing_payment}")
    if not (input.other_monthly_debts >= 0):
        raise ValueError(f"otherMonthlyDebts must be >= 0, got {input.other_monthly_debts}")


def calculate_dti(
    input: DtiInput, front_end_max_percent: float = 28.0, back_end_max_percent: float = 36.0
) -> DtiResult:
    _validate_dti_input(input)
    if not (front_end_max_percent > 0):
        raise ValueError(f"frontEndMaxPercent must be > 0, got {front_end_max_percent}")
    if not (back_end_max_percent > 0):
        raise ValueError(f"backEndMaxPercent must be > 0, got {back_end_max_percent}")

    front_end_dti = input.housing_payment / input.gross_monthly_income
    back_end_dti = (input.housing_payment + input.other_monthly_debts) / input.gross_monthly_income

    front_end_ok = front_end_dti <= front_end_max_percent / 100
    back_end_ok = back_end_dti <= back_end_max_percent / 100

    return DtiResult(
        front_end_dti=front_end_dti,
        back_end_dti=back_end_dti,
        front_end_max_percent=front_end_max_percent,
        back_end_max_percent=back_end_max_percent,
        front_end_ok=front_end_ok,
        back_end_ok=back_end_ok,
        qualifies=front_end_ok and back_end_ok,
    )


@dataclass
class AffordabilityInput:
    gross_monthly_income: float
    other_monthly_debts: float
    annual_interest_rate_percent: float
    term_months: int
    # Estimated monthly tax+insurance+HOA+PMI -- the part of "housing payment"
    # that ISN'T the P&I being solved for.
    non_pi_housing_costs: float = 0.0
    front_end_max_percent: float = 28.0
    back_end_max_percent: float = 36.0
    down_payment: float = 0.0


@dataclass
class AffordabilityResult:
    max_pi_payment: float
    max_loan_amount: float
    max_home_price: float
    binding_constraint: str  # "front_end" | "back_end"
    qualifies: bool


def calculate_affordability(input: AffordabilityInput) -> AffordabilityResult:
    if not (input.gross_monthly_income > 0):
        raise ValueError(f"grossMonthlyIncome must be > 0, got {input.gross_monthly_income}")
    if not (input.other_monthly_debts >= 0):
        raise ValueError(f"otherMonthlyDebts must be >= 0, got {input.other_monthly_debts}")
    if not (input.annual_interest_rate_percent >= 0):
        raise ValueError(
            f"annualInterestRatePercent must be >= 0, got {input.annual_interest_rate_percent}"
        )
    if not (input.term_months > 0) or not float(input.term_months).is_integer():
        raise ValueError(f"termMonths must be a positive integer, got {input.term_months}")
    if not (input.non_pi_housing_costs >= 0):
        raise ValueError(f"nonPiHousingCosts must be >= 0, got {input.non_pi_housing_costs}")
    if not (input.down_payment >= 0):
        raise ValueError(f"downPayment must be >= 0, got {input.down_payment}")

    front_end_allowance = (
        input.gross_monthly_income * input.front_end_max_percent / 100 - input.non_pi_housing_costs
    )
    back_end_allowance = (
        input.gross_monthly_income * input.back_end_max_percent / 100
        - input.other_monthly_debts
        - input.non_pi_housing_costs
    )

    max_pi_payment = max(0.0, min(front_end_allowance, back_end_allowance))
    binding_constraint = "front_end" if front_end_allowance <= back_end_allowance else "back_end"
    max_pi_payment = round2(max_pi_payment)

    r = input.annual_interest_rate_percent / 100 / 12
    n = input.term_months
    if max_pi_payment == 0:
        max_loan_amount = 0.0
    elif r == 0:
        max_loan_amount = round2(max_pi_payment * n)
    else:
        factor = (1 + r) ** n
        max_loan_amount = round2(max_pi_payment * (factor - 1) / (r * factor))

    return AffordabilityResult(
        max_pi_payment=max_pi_payment,
        max_loan_amount=max_loan_amount,
        max_home_price=round2(max_loan_amount + input.down_payment),
        binding_constraint=binding_constraint,
        qualifies=max_pi_payment > 0,
    )
