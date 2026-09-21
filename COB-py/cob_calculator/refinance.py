from __future__ import annotations

import math
from dataclasses import dataclass

from .loan import summarize_loan
from .money import round2
from .types import LoanInput
from .validate import validate_refinance_breakeven_inputs


@dataclass
class RefinanceBreakevenInput:
    closing_costs: float
    old_monthly_payment: float
    new_monthly_payment: float


def calculate_refinance_breakeven(input: RefinanceBreakevenInput) -> float:
    """Months to recoup refinancing closing costs. Infinity if the new payment
    doesn't save anything -- a legitimate financial outcome, not an invalid input."""
    validate_refinance_breakeven_inputs(input)
    savings = input.old_monthly_payment - input.new_monthly_payment
    if savings <= 0:
        return math.inf
    return input.closing_costs / savings


@dataclass
class RefinanceComparisonInput:
    old_loan: LoanInput
    new_loan: LoanInput
    closing_costs: float


@dataclass
class RefinanceComparisonResult:
    old_monthly_payment: float
    new_monthly_payment: float
    old_total_cost: float
    new_total_cost: float
    net_savings: float
    breakeven_months: float


def compare_refinance(input: RefinanceComparisonInput) -> RefinanceComparisonResult:
    """Composes two summarize_loan() calls rather than reimplementing amortization."""
    old_summary = summarize_loan(input.old_loan)
    new_summary = summarize_loan(input.new_loan)

    old_monthly_payment = old_summary.segment_summaries[0].monthly_payment
    new_monthly_payment = new_summary.segment_summaries[0].monthly_payment
    old_total_cost = old_summary.total_of_payments
    new_total_cost = round2(new_summary.total_of_payments + input.closing_costs)
    net_savings = round2(old_total_cost - new_total_cost)
    breakeven_months = calculate_refinance_breakeven(
        RefinanceBreakevenInput(
            closing_costs=input.closing_costs,
            old_monthly_payment=old_monthly_payment,
            new_monthly_payment=new_monthly_payment,
        )
    )

    return RefinanceComparisonResult(
        old_monthly_payment=old_monthly_payment,
        new_monthly_payment=new_monthly_payment,
        old_total_cost=old_total_cost,
        new_total_cost=new_total_cost,
        net_savings=net_savings,
        breakeven_months=breakeven_months,
    )
