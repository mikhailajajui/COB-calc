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
    # Independent second axis, originally added for
    # docs/new-req/006-cost-of-borrowing-disclosure.md's first draft: does this fee
    # count toward a *regulatory* cost-of-borrowing dollar amount (Financial Consumer
    # Protection Framework Regulations s. 48)? NOT the same question as `financed` --
    # e.g. a financed mortgage-default-insurance premium could be excluded from COB
    # while a cash-paid appraisal fee is included.
    #
    # UNUSED by cob_canada.py as of the spec's reconciliation against the real Alterna
    # Savings BRD (docs/new-req/007-cob-canada-brd-reconciliation.md, finding #6): the
    # real application includes ALL fees (financed and cash) in cob_amount
    # unconditionally, with no regulatory filtering, so cob_canada.py never reads this
    # field. It stays on this shared dataclass, optional and unenforced, only for
    # backward compatibility / a possible future, more general Canadian-disclosure
    # engine that might want FCPFR-style filtering -- not for the current Canadian COB
    # calculator.
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
