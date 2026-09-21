"""Simplified actuarial-method APR calculator. See docs/new-req/002-fees-and-apr.md
for the full spec, including the explicit caveat that this is NOT a certified
TILA/Reg Z disclosure engine."""

from __future__ import annotations

from dataclasses import dataclass

from .fees import FeeSchedule
from .money import round2
from .payment import calculate_monthly_payment

_BISECTION_MAX_ITERATIONS = 200
_BISECTION_TOLERANCE = 1e-10


@dataclass
class AprInput:
    # The note amount BEFORE any financed fees are added.
    loan_amount: float
    annual_interest_rate_percent: float
    term_months: int
    fees: FeeSchedule


@dataclass
class AprResult:
    # loan_amount + total_financed_fees -- what the note-rate payment is
    # actually computed against.
    effective_loan_amount: float
    monthly_payment: float
    # effective_loan_amount - total_cash_fees -- what Reg Z calls "amount
    # financed": the money the borrower actually nets, against which the same
    # monthly_payment is being measured.
    amount_financed: float
    # Nominal annual rate (monthly rate * 12 * 100) that makes amount_financed
    # the present value of term_months payments of monthly_payment.
    apr_percent: float
    apr_minus_note_rate_percent: float
    total_fees: float


def _present_value_of_annuity(payment: float, r: float, n: int) -> float:
    if r == 0:
        return payment * n
    return payment * (1 - (1 + r) ** -n) / r


def _solve_monthly_rate_for_amount_financed(
    monthly_payment: float, amount_financed: float, term_months: int
) -> float:
    """Bisection on r such that PV(monthly_payment, r, term_months) == amount_financed.
    The PV-of-annuity function is strictly decreasing in r, so bisection converges
    monotonically within the bracket."""
    lo, hi = 0.0, 1.0  # 0% to 100% *monthly* -- a generous upper bound
    # Widen hi if needed (pathological fee/loan ratios) rather than assuming 1.0
    # always brackets the root.
    while _present_value_of_annuity(monthly_payment, hi, term_months) > amount_financed:
        hi *= 2
        if hi > 1e6:
            raise ValueError(
                "APR solver failed to bracket a root -- fees are likely too large "
                "relative to the loan amount for this to be a meaningful loan."
            )

    for _ in range(_BISECTION_MAX_ITERATIONS):
        mid = (lo + hi) / 2
        pv = _present_value_of_annuity(monthly_payment, mid, term_months)
        if abs(pv - amount_financed) < _BISECTION_TOLERANCE:
            return mid
        if pv > amount_financed:
            # Higher rate discounts payments more heavily -> lower PV.
            lo = mid
        else:
            hi = mid
    return (lo + hi) / 2


def calculate_apr(input: AprInput) -> AprResult:
    if not (input.loan_amount > 0):
        raise ValueError(f"loanAmount must be > 0, got {input.loan_amount}")
    if not (input.annual_interest_rate_percent >= 0):
        raise ValueError(
            f"annualInterestRatePercent must be >= 0, got {input.annual_interest_rate_percent}"
        )
    if not (input.term_months > 0) or not float(input.term_months).is_integer():
        raise ValueError(f"termMonths must be a positive integer, got {input.term_months}")

    total_financed_fees = input.fees.total_financed_fees
    total_cash_fees = input.fees.total_cash_fees
    total_fees = input.fees.total_fees

    effective_loan_amount = round2(input.loan_amount + total_financed_fees)
    monthly_payment = calculate_monthly_payment(
        effective_loan_amount, input.annual_interest_rate_percent, input.term_months
    )
    amount_financed = round2(effective_loan_amount - total_cash_fees)

    if not (amount_financed > 0):
        raise ValueError(
            f"fees ({total_cash_fees}) leave a non-positive amount financed "
            f"({amount_financed}) against an effective loan of {effective_loan_amount} "
            "-- this is not a financially meaningful loan"
        )

    if total_cash_fees == 0:
        # No cash fees: APR equals the note rate exactly, no solve needed.
        apr_percent = input.annual_interest_rate_percent
    else:
        r = _solve_monthly_rate_for_amount_financed(monthly_payment, amount_financed, input.term_months)
        apr_percent = r * 12 * 100

    return AprResult(
        effective_loan_amount=effective_loan_amount,
        monthly_payment=monthly_payment,
        amount_financed=amount_financed,
        apr_percent=apr_percent,
        apr_minus_note_rate_percent=apr_percent - input.annual_interest_rate_percent,
        total_fees=total_fees,
    )
