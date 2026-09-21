from __future__ import annotations

import math
from dataclasses import dataclass

from .money import round2
from .payment import calculate_monthly_payment
from .validate import validate_points_breakeven_input


@dataclass
class PointsBreakevenInput:
    loan_amount: float
    # 1 point = 1% of loan_amount.
    points: float
    # Rate reduction achieved by buying points, in percentage points (e.g. 0.25).
    rate_reduction_percent: float
    original_rate_percent: float
    term_months: int


@dataclass
class PointsBreakevenResult:
    points_cost: float
    monthly_payment_original: float
    monthly_payment_with_points: float
    monthly_savings: float
    # Months to recoup the points cost. Infinity if points produce no monthly
    # savings -- a legitimate financial outcome, not an invalid input.
    breakeven_months: float


def calculate_points_breakeven(input: PointsBreakevenInput) -> PointsBreakevenResult:
    validate_points_breakeven_input(input)

    points_cost = round2((input.loan_amount * input.points) / 100)
    monthly_payment_original = calculate_monthly_payment(
        input.loan_amount, input.original_rate_percent, input.term_months
    )
    monthly_payment_with_points = calculate_monthly_payment(
        input.loan_amount, input.original_rate_percent - input.rate_reduction_percent, input.term_months
    )
    monthly_savings = round2(monthly_payment_original - monthly_payment_with_points)
    breakeven_months = math.inf if monthly_savings <= 0 else points_cost / monthly_savings

    return PointsBreakevenResult(
        points_cost=points_cost,
        monthly_payment_original=monthly_payment_original,
        monthly_payment_with_points=monthly_payment_with_points,
        monthly_savings=monthly_savings,
        breakeven_months=breakeven_months,
    )
