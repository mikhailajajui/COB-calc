"""Yearly summary / N-year report window over an AmortizationEntry schedule.

See docs/new-req/001-yearly-summary-report-window.md for the full spec. Scoped
to the monthly-periodic segment/mortgage schedule (AmortizationEntry) only --
payment-frequency schedules (PeriodAmortizationEntry) are out of scope for v1
(see the spec for why).
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

from .money import round2
from .types import AmortizationEntry, LoanSummary


@dataclass
class YearlySummary:
    year_number: int
    payments_in_year: int
    starting_balance: float
    ending_balance: float
    total_payments: float
    total_interest: float
    total_principal: float
    total_tax: Optional[float] = None
    total_insurance: Optional[float] = None
    total_hoa: Optional[float] = None
    total_pmi: Optional[float] = None


@dataclass
class ReportWindowSummary:
    through_year: int
    through_payment_number: int
    yearly: list[YearlySummary]
    total_interest_paid: float
    total_principal_paid: float
    total_of_payments: float
    ending_balance: float
    original_principal: float
    percent_of_original_balance_remaining: float
    percent_of_term_elapsed: float
    paid_off_within_window: bool


def _validate_schedule(schedule: list[AmortizationEntry]) -> None:
    if not schedule:
        raise ValueError("schedule must contain at least one row")


def summarize_schedule_by_year(schedule: list[AmortizationEntry]) -> list[YearlySummary]:
    _validate_schedule(schedule)

    original_principal = schedule[0].remaining_balance + schedule[0].principal_portion
    tracks_tax = any(r.tax_portion is not None for r in schedule)
    tracks_insurance = any(r.insurance_portion is not None for r in schedule)
    tracks_hoa = any(r.hoa_portion is not None for r in schedule)
    tracks_pmi = any(r.pmi_portion is not None for r in schedule)

    years: list[YearlySummary] = []
    year_start_balance = original_principal
    current_year_index = -1
    current_rows: list[AmortizationEntry] = []

    def flush(year_index: int, rows: list[AmortizationEntry], starting_balance: float) -> float:
        total_payments = round2(sum(r.payment_amount for r in rows))
        total_interest = round2(sum(r.interest_portion for r in rows))
        total_principal = round2(sum(r.principal_portion for r in rows))
        ending_balance = rows[-1].remaining_balance
        years.append(
            YearlySummary(
                year_number=year_index + 1,
                payments_in_year=len(rows),
                starting_balance=starting_balance,
                ending_balance=ending_balance,
                total_payments=total_payments,
                total_interest=total_interest,
                total_principal=total_principal,
                total_tax=round2(sum(r.tax_portion or 0 for r in rows)) if tracks_tax else None,
                total_insurance=round2(sum(r.insurance_portion or 0 for r in rows)) if tracks_insurance else None,
                total_hoa=round2(sum(r.hoa_portion or 0 for r in rows)) if tracks_hoa else None,
                total_pmi=round2(sum(r.pmi_portion or 0 for r in rows)) if tracks_pmi else None,
            )
        )
        return ending_balance

    for row in schedule:
        year_index = (row.payment_number - 1) // 12
        if year_index != current_year_index:
            if current_rows:
                year_start_balance = flush(current_year_index, current_rows, year_start_balance)
            current_year_index = year_index
            current_rows = []
        current_rows.append(row)

    if current_rows:
        flush(current_year_index, current_rows, year_start_balance)

    return years


def summarize_report_window(loan_summary: LoanSummary, through_years: int) -> ReportWindowSummary:
    if not (through_years > 0):
        raise ValueError(f"through_years must be > 0, got {through_years}")

    yearly = summarize_schedule_by_year(loan_summary.schedule)
    window = yearly[: min(through_years, len(yearly))]

    original_principal = (
        loan_summary.schedule[0].remaining_balance + loan_summary.schedule[0].principal_portion
    )
    total_interest_paid = round2(sum(y.total_interest for y in window))
    total_principal_paid = round2(sum(y.total_principal for y in window))
    total_of_payments = round2(sum(y.total_payments for y in window))
    ending_balance = window[-1].ending_balance
    through_payment_number = sum(y.payments_in_year for y in window)

    return ReportWindowSummary(
        through_year=through_years,
        through_payment_number=through_payment_number,
        yearly=window,
        total_interest_paid=total_interest_paid,
        total_principal_paid=total_principal_paid,
        total_of_payments=total_of_payments,
        ending_balance=ending_balance,
        original_principal=original_principal,
        percent_of_original_balance_remaining=(
            ending_balance / original_principal if original_principal else 0.0
        ),
        percent_of_term_elapsed=through_payment_number / loan_summary.number_of_payments,
        paid_off_within_window=(
            ending_balance == 0 or through_payment_number >= loan_summary.number_of_payments
        ),
    )
