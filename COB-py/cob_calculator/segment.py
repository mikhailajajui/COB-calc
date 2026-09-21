"""
Accuracy note (see docs/new-req/004-rounding-drift-accuracy-disclosure.md):
every row rounds interest to the cent before deriving that row's principal and
next balance -- matching a real bank statement, not a closed-form/unrounded
calculation. Because principal = payment - interest with payment held fixed, a
rounding choice at row k propagates forward and compounds at rate (1+r) per
remaining row, so `remaining_balance` at an arbitrary intermediate row can
diverge from an unrounded reference calculator by a few dollars late in a long
schedule (verified: ~$4.68 on a $300K/6.5%/30yr loan at payment #359). This is
bounded, not runaway -- the final row always forces the balance to exactly 0,
and whole-schedule totals (sum of principal, total interest) are exact sums of
the rounded rows, never derived from a closed form, so they never drift.
"""

from __future__ import annotations

from dataclasses import dataclass

from .dates import add_months
from .money import round2
from .payment import calculate_monthly_payment
from .types import AmortizationEntry, ManualPaymentOverride, Segment

# Safety cap (100 years of monthly payments) against an open-ended segment whose
# payment doesn't cover interest and would otherwise loop forever.
MAX_PAYMENTS_SAFETY_CAP = 1200


@dataclass
class SegmentResult:
    rows: list[AmortizationEntry]
    ending_balance: float
    monthly_payment: float


def compute_segment_schedule(
    segment: Segment,
    segment_index: int,
    starting_balance: float,
    start_payment_number: int,
    overrides_by_payment_number: dict[int, ManualPaymentOverride],
) -> SegmentResult:
    """Generates the amortization rows for a single segment, starting from
    `starting_balance` and numbering payments from `start_payment_number`.

    The segment's row count is bounded whenever it's knowable in advance:
    - `segment.term_months`, when set, is a renewal/change boundary -- exactly that
      many rows are produced and the leftover balance carries into the next segment,
      with no zero-forcing.
    - Otherwise this is the mortgage's final segment. If `amortization_months_remaining`
      is set, that many rows are produced (the payment was sized to amortize over
      exactly that span), with the final row forced to clear the balance exactly. If
      only a manual `payment_amount` is given (no amortization figure), the payoff
      length is genuinely unknown in advance, so rows are produced dynamically until
      the balance reaches zero (bounded by a safety cap against a payment too small to
      cover interest).

    `overrides_by_payment_number` supplies manual corrections for specific global
    payment numbers; when present for a row, its fields take precedence over computed
    values and the resulting balance still propagates forward into subsequent rows as
    usual.
    """
    r = segment.annual_interest_rate_percent / 100 / 12
    if segment.interest_only:
        monthly_payment = round2(starting_balance * r)
    elif segment.payment_amount is not None:
        monthly_payment = round2(segment.payment_amount)
    else:
        monthly_payment = calculate_monthly_payment(
            starting_balance,
            segment.annual_interest_rate_percent,
            segment.amortization_months_remaining,
        )

    is_final_segment = segment.term_months is None
    known_length = segment.term_months if segment.term_months is not None else segment.amortization_months_remaining
    rows: list[AmortizationEntry] = []
    balance = round2(starting_balance)
    payment_index = 0

    while (payment_index < known_length) if known_length is not None else (balance > 0):
        if payment_index >= MAX_PAYMENTS_SAFETY_CAP:
            raise ValueError(
                f"Segment {segment_index} did not amortize to zero within "
                f"{MAX_PAYMENTS_SAFETY_CAP} payments -- payment amount {monthly_payment} "
                "may be insufficient to cover interest (negative amortization)."
            )

        payment_number = start_payment_number + payment_index
        override = overrides_by_payment_number.get(payment_number)

        if override is not None:
            interest_portion = (
                override.interest_portion if override.interest_portion is not None else round2(balance * r)
            )
            if override.remaining_balance is not None:
                remaining_balance = override.remaining_balance
                principal_portion = (
                    override.principal_portion
                    if override.principal_portion is not None
                    else round2(balance - remaining_balance)
                )
            else:
                principal_portion = (
                    override.principal_portion
                    if override.principal_portion is not None
                    else round2((override.payment_amount if override.payment_amount is not None else monthly_payment) - interest_portion)
                )
                remaining_balance = round2(balance - principal_portion)
            payment_amount = (
                override.payment_amount
                if override.payment_amount is not None
                else round2(interest_portion + principal_portion)
            )
            del overrides_by_payment_number[payment_number]
            is_manual_override = True
            override_reason = override.reason
        else:
            interest_portion = round2(balance * r)
            override_reason = None
            is_manual_override = False

            if segment.interest_only:
                # By definition monthly_payment == interest_portion for an
                # interest-only row -- this must not trip the negative-amortization
                # guard below, so it's handled first and unconditionally.
                principal_portion = 0
                payment_amount = interest_portion
                remaining_balance = balance
            else:
                # Only the fully dynamic case (no knowable segment length) risks
                # looping forever on a payment that never covers interest; bounded
                # segments always terminate at known_length regardless.
                if known_length is None and monthly_payment <= interest_portion:
                    raise ValueError(
                        f"Segment {segment_index}'s payment {monthly_payment} does not "
                        f"cover this period's interest ({interest_portion}) -- this "
                        "loan would never amortize."
                    )

                # A payment that would fully retire the balance ends the loan right
                # here -- regardless of whether this is a bounded (non-final,
                # pre-renewal) segment or the open-ended final one.
                would_pay_off_this_row = round2(balance - round2(monthly_payment - interest_portion)) <= 0
                # Also force-clear the scheduled last row of a fully-amortizing final
                # segment, even when the natural math leaves a sub-cent residual.
                is_scheduled_final_row = (
                    is_final_segment and known_length is not None and payment_index == known_length - 1
                )

                if would_pay_off_this_row or is_scheduled_final_row:
                    principal_portion = balance
                    payment_amount = round2(interest_portion + principal_portion)
                    remaining_balance = 0
                else:
                    principal_portion = round2(monthly_payment - interest_portion)
                    payment_amount = monthly_payment
                    remaining_balance = round2(balance - principal_portion)

        rows.append(
            AmortizationEntry(
                payment_number=payment_number,
                segment_index=segment_index,
                payment_date=add_months(segment.start_date, payment_index),
                payment_amount=payment_amount,
                interest_portion=interest_portion,
                principal_portion=principal_portion,
                remaining_balance=remaining_balance,
                is_manual_override=is_manual_override,
                override_reason=override_reason,
            )
        )

        balance = remaining_balance
        payment_index += 1

        # The loan is fully paid off -- stop even if a bounded segment's term_months
        # hasn't been reached yet.
        if balance == 0:
            break

    return SegmentResult(rows=rows, ending_balance=balance, monthly_payment=monthly_payment)
