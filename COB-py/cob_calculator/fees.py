"""Loan fees: origination/application/closing costs, either paid in cash at
closing or financed into the loan balance.

See docs/new-req/002-fees-and-apr.md for the full spec.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from .money import round2


@dataclass
class Fee:
    name: str
    amount: float
    # False (default): paid out-of-pocket at closing, reduces the amount financed.
    # True: added to the loan principal instead (VA funding fee, upfront FHA MIP).
    financed: bool = False

    def __post_init__(self) -> None:
        if not (self.amount >= 0):
            raise ValueError(f"fee {self.name!r} amount must be >= 0, got {self.amount}")


@dataclass
class FeeSchedule:
    fees: list[Fee] = field(default_factory=list)

    @property
    def total_fees(self) -> float:
        return round2(sum(f.amount for f in self.fees))

    @property
    def total_financed_fees(self) -> float:
        return round2(sum(f.amount for f in self.fees if f.financed))

    @property
    def total_cash_fees(self) -> float:
        return round2(sum(f.amount for f in self.fees if not f.financed))
