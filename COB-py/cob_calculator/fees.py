"""Loan fees: origination/application/closing costs, either paid in cash at
closing or financed into the loan balance.

See docs/new-req/002-fees-and-apr.md for the full spec.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional

from .money import round2


@dataclass
class Fee:
    name: str
    amount: float
    # False (default): paid out-of-pocket at closing, reduces the amount financed.
    # True: added to the loan principal instead (VA funding fee, upfront FHA MIP).
    financed: bool = False
    # Independent second axis, added for docs/new-req/006-cost-of-borrowing-disclosure.md
    # (Canadian COB engine): does this fee count toward the *regulatory*
    # cost-of-borrowing dollar amount (Financial Consumer Protection Framework
    # Regulations s. 48)? This is NOT the same question as `financed` -- e.g. a
    # financed mortgage-default-insurance premium is still excluded from COB, while a
    # cash-paid appraisal fee can still be included. Defaults to `None` ("unset")
    # rather than `True`/`False` on purpose: spec 002's US callers (apr.py) never read
    # this field and are completely unaffected either way, but a Canadian flow
    # constructing a Fee must set it explicitly -- silently defaulting to `True` would
    # pull regulation-excluded categories into cob_amount, and defaulting to `False`
    # would silently drop includable ones. cob_canada.py's own validation enforces
    # "required in practice" for Canadian flows; this dataclass stays optional for
    # backward compatibility.
    included_in_cob: Optional[bool] = None

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

    @property
    def total_fees_included_in_cob(self) -> float:
        """Sum of fee.amount where included_in_cob is True. Fees with
        included_in_cob left None (the default -- every existing spec-002/US fee)
        contribute 0, so this aggregate is a strictly additive no-op for every
        caller that predates docs/new-req/006-cost-of-borrowing-disclosure.md."""
        return round2(sum(f.amount for f in self.fees if f.included_in_cob))
