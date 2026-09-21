"""Dataclass port of COB-ts's src/types.ts. Field names are snake_case; everything
else (semantics, optionality, defaults) mirrors the TypeScript interfaces exactly."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date
from typing import Literal, Optional


@dataclass
class Segment:
    start_date: date
    annual_interest_rate_percent: float
    # Manual payment override for this segment (payment change). If omitted, computed
    # from balance + rate + amortization_months_remaining via calculate_monthly_payment.
    # Not used (and not required) when interest_only is set.
    payment_amount: Optional[float] = None
    # Amortization period (months) used to size the payment when payment_amount is
    # omitted. At least one of payment_amount / amortization_months_remaining is
    # required, unless interest_only is set.
    amortization_months_remaining: Optional[int] = None
    # How many payments this segment covers before the next segment (renewal/change)
    # takes over. Required on every segment except the last, which runs to payoff --
    # unless balloon is true, in which case it's required on the (balloon) last
    # segment too.
    term_months: Optional[int] = None
    # Only valid on segments[0] -- the original principal. Later segments inherit
    # their starting balance from the previous segment's ending balance.
    starting_balance: Optional[float] = None
    # Only valid on the last segment, together with term_months -- that segment
    # stops after term_months payments with a nonzero balance, reported as
    # LoanSummary.balloon_payment_due, instead of running to payoff.
    balloon: bool = False
    # Payment = balance * monthly rate for every row; principal never moves. Requires
    # term_months (an interest-only segment never amortizes to zero on its own).
    interest_only: bool = False


@dataclass
class ManualPaymentOverride:
    # 1-based payment number, global across the whole stitched schedule.
    payment_number: int
    payment_amount: Optional[float] = None
    interest_portion: Optional[float] = None
    principal_portion: Optional[float] = None
    # If given, forces this row's ending balance directly; otherwise derived from
    # balance - principal_portion as usual.
    remaining_balance: Optional[float] = None
    reason: Optional[str] = None


@dataclass
class LumpSumPayment:
    # Global payment number of the last row of the segment this lump sum is applied
    # after -- must be exactly a segment/renewal boundary.
    after_payment_number: int
    amount: float


@dataclass
class RecurringCost:
    annual_amount: float
    # Annual % increase applied at each 12-payment anniversary. Escalation only.
    annual_increase_percent: Optional[float] = None


@dataclass
class RecurringCosts:
    property_tax: Optional[RecurringCost] = None
    home_insurance: Optional[RecurringCost] = None
    hoa: Optional[RecurringCost] = None


@dataclass
class PmiInput:
    annual_rate_percent: float
    property_value: float
    # LTV percent at/below which PMI is dropped. Defaults to 80.
    drop_at_ltv_percent: Optional[float] = None


@dataclass
class CostBreakdownSummary:
    total_tax_paid: float
    total_insurance_paid: float
    total_hoa_paid: float
    total_pmi_paid: float
    # total_of_payments (P&I) + all of the above.
    total_cost_of_ownership: float
    # First payment number where PMI dropped off; None if PMI was never active or
    # wasn't configured.
    pmi_dropped_at_payment_number: Optional[int] = None


@dataclass
class MortgageInput:
    segments: list[Segment]
    manual_overrides: Optional[list[ManualPaymentOverride]] = None
    lump_sum_payments: Optional[list[LumpSumPayment]] = None
    recurring_costs: Optional[RecurringCosts] = None
    pmi: Optional[PmiInput] = None


@dataclass
class AmortizationEntry:
    # Global, 1-based payment number across the whole stitched schedule.
    payment_number: int
    # Index into MortgageInput.segments this row belongs to.
    segment_index: int
    payment_date: date
    payment_amount: float
    interest_portion: float
    principal_portion: float
    remaining_balance: float
    is_manual_override: bool
    tax_portion: Optional[float] = None
    insurance_portion: Optional[float] = None
    hoa_portion: Optional[float] = None
    pmi_portion: Optional[float] = None
    override_reason: Optional[str] = None


@dataclass
class SegmentSummary:
    segment_index: int
    monthly_payment: float
    starting_balance: float
    ending_balance: float


@dataclass
class BalloonPaymentDue:
    segment_index: int
    amount: float
    due_date: date


@dataclass
class LoanSummary:
    schedule: list[AmortizationEntry]
    total_of_payments: float
    total_interest_paid: float
    number_of_payments: int
    payoff_date: date
    segment_summaries: list[SegmentSummary]
    balloon_payment_due: Optional[BalloonPaymentDue] = None
    cost_breakdown: Optional[CostBreakdownSummary] = None


@dataclass
class LoanInput:
    """Convenience input for the simple single-rate, no-renewal case. Internally
    converted to a one-segment MortgageInput via to_single_segment_mortgage()."""

    loan_amount: float
    annual_interest_rate_percent: float
    term_years: float
    start_date: Optional[date] = None


@dataclass
class HomePriceLoanInput:
    home_price: float
    down_payment: float
    annual_interest_rate_percent: float
    term_years: float
    start_date: Optional[date] = None


@dataclass
class ExtraPaymentSavingsInput:
    loan_amount: float
    annual_interest_rate_percent: float
    term_months: int
    extra_monthly_payment: float
    start_date: Optional[date] = None


@dataclass
class ExtraPaymentSavingsResult:
    original_months: int
    new_months: int
    months_saved: int
    original_total_interest: float
    new_total_interest: float
    interest_saved: float


PaymentFrequency = Literal["monthly", "semiMonthly", "biweekly", "weekly"]


@dataclass
class PaymentFrequencyScheduleInput:
    loan_amount: float
    annual_interest_rate_percent: float
    term_months: int
    frequency: PaymentFrequency
    start_date: Optional[date] = None


@dataclass
class PeriodAmortizationEntry:
    # 1-based, within this schedule only (not a global payment number).
    period_number: int
    period_date: date
    payment_amount: float
    interest_portion: float
    principal_portion: float
    remaining_balance: float


@dataclass
class PaymentFrequencyScheduleResult:
    frequency: PaymentFrequency
    payments_per_year: int
    monthly_payment: float
    # The amount paid on each occurrence of the chosen frequency; equals
    # monthly_payment for 'monthly'.
    period_payment_amount: float
    schedule: list[PeriodAmortizationEntry]
    number_of_periods: int
    payoff_date: date
    effective_extra_monthly_payment: float
    original_months: int
    new_months: int
    months_saved: int
    original_total_interest: float
    new_total_interest: float
    interest_saved: float
