from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

from .validate import validate_arm_reset_input


@dataclass
class ArmResetInput:
    previous_rate_percent: float
    initial_rate_percent: float
    index_rate_percent: float
    margin_percent: float
    is_first_reset: bool
    initial_cap_percent: Optional[float] = None
    periodic_cap_percent: Optional[float] = None
    lifetime_cap_percent: Optional[float] = None


@dataclass
class ArmResetResult:
    fully_indexed_rate_percent: float
    capped_rate_percent: float


def calculate_arm_reset_rate(input: ArmResetInput) -> ArmResetResult:
    """Pure rate-cap calculator. Plug capped_rate_percent into a normal renewal
    segment's annual_interest_rate_percent (the existing "variable rate change"
    mechanism) -- call calculate_monthly_payment(balance, capped_rate_percent,
    remaining_months) directly for the resulting payment; this module doesn't
    duplicate that."""
    validate_arm_reset_input(input)

    fully_indexed_rate_percent = input.index_rate_percent + input.margin_percent
    capped = fully_indexed_rate_percent

    per_reset_cap = input.initial_cap_percent if input.is_first_reset else input.periodic_cap_percent
    if per_reset_cap is not None:
        capped = min(capped, input.previous_rate_percent + per_reset_cap)
    if input.lifetime_cap_percent is not None:
        capped = min(capped, input.initial_rate_percent + input.lifetime_cap_percent)
    capped = max(capped, 0)

    return ArmResetResult(fully_indexed_rate_percent=fully_indexed_rate_percent, capped_rate_percent=capped)
