from __future__ import annotations

from datetime import date

from .dates import add_days, add_months
from .loan import summarize_loan
from .money import js_round, round2
from .payment import calculate_monthly_payment
from .types import (
    PaymentFrequency,
    PaymentFrequencyScheduleInput,
    PaymentFrequencyScheduleResult,
    PeriodAmortizationEntry,
)
from .validate import validate_payment_frequency_schedule_input

# paymentFraction: what fraction of the monthly payment is paid at each occurrence
# (e.g. half the monthly payment every 2 weeks for 'biweekly') -- this is the standard
# real-world "pay half your bill every 2 weeks" acceleration program, not a fresh
# annuity computed at the period cadence.
_FREQUENCY_CONFIG: dict[PaymentFrequency, dict[str, float]] = {
    "monthly": {"payments_per_year": 12, "payment_fraction": 1},
    "semiMonthly": {"payments_per_year": 24, "payment_fraction": 1 / 2},
    "biweekly": {"payments_per_year": 26, "payment_fraction": 1 / 2},
    "weekly": {"payments_per_year": 52, "payment_fraction": 1 / 4},
}

# 100 years' worth of weekly periods -- a generous safety cap against a period
# payment that doesn't cover interest.
MAX_PERIODS_SAFETY_CAP = 5200


def _period_date_for(frequency: PaymentFrequency, start_date: date, index: int) -> date:
    """periodDate for period index i (0-based). monthly reuses the engine's
    add_months for exact parity with the standard monthly schedule; weekly/biweekly
    use exact 7/14-day steps; semiMonthly is evenly spaced (an approximation of the
    "1st & 15th" convention some lenders use)."""
    if frequency == "monthly":
        return add_months(start_date, index)
    if frequency == "weekly":
        return add_days(start_date, index * 7)
    if frequency == "biweekly":
        return add_days(start_date, index * 14)
    if frequency == "semiMonthly":
        return add_days(start_date, js_round((index * 365.25) / 24))
    raise ValueError(f"unknown frequency {frequency}")


def _generate_period_schedule(
    loan_amount: float,
    annual_interest_rate_percent: float,
    period_payment_amount: float,
    payments_per_year: int,
    frequency: PaymentFrequency,
    start_date: date,
) -> list[PeriodAmortizationEntry]:
    """Generates a genuine per-period amortization schedule: interest accrues each
    period at annual_interest_rate_percent / payments_per_year against the real
    outstanding balance, with real calendar dates. Runs until the balance is paid off
    (forced to clear exactly on the row that would otherwise go negative), bounded by
    MAX_PERIODS_SAFETY_CAP."""
    r_period = annual_interest_rate_percent / 100 / payments_per_year
    rows: list[PeriodAmortizationEntry] = []
    balance = round2(loan_amount)
    index = 0

    while balance > 0:
        if index >= MAX_PERIODS_SAFETY_CAP:
            raise ValueError(
                f"Payment frequency schedule did not amortize to zero within "
                f"{MAX_PERIODS_SAFETY_CAP} periods -- periodPaymentAmount "
                f"{period_payment_amount} may be insufficient to cover interest."
            )

        interest_portion = round2(balance * r_period)
        if period_payment_amount <= interest_portion:
            raise ValueError(
                f"Payment frequency schedule's period payment {period_payment_amount} "
                f"does not cover this period's interest ({interest_portion}) -- this "
                "loan would never amortize."
            )

        principal_portion = round2(period_payment_amount - interest_portion)
        payment_amount = period_payment_amount
        remaining_balance = round2(balance - principal_portion)

        if remaining_balance <= 0:
            principal_portion = balance
            payment_amount = round2(interest_portion + principal_portion)
            remaining_balance = 0

        rows.append(
            PeriodAmortizationEntry(
                period_number=index + 1,
                period_date=_period_date_for(frequency, start_date, index),
                payment_amount=payment_amount,
                interest_portion=interest_portion,
                principal_portion=principal_portion,
                remaining_balance=remaining_balance,
            )
        )

        balance = remaining_balance
        index += 1

    return rows


def calculate_payment_frequency_schedule(
    input: PaymentFrequencyScheduleInput,
) -> PaymentFrequencyScheduleResult:
    validate_payment_frequency_schedule_input(input)

    start_date = input.start_date if input.start_date is not None else date.today()
    config = _FREQUENCY_CONFIG[input.frequency]
    payments_per_year = int(config["payments_per_year"])
    payment_fraction = config["payment_fraction"]

    monthly_payment = calculate_monthly_payment(
        input.loan_amount, input.annual_interest_rate_percent, input.term_months
    )
    period_payment_amount = round2(monthly_payment * payment_fraction)

    annual_equivalent_payments = payments_per_year * payment_fraction
    effective_extra_monthly_payment = round2(
        (monthly_payment * (annual_equivalent_payments - 12)) / 12
    )

    # Baseline: the standard, exact monthly schedule (unchanged, not an approximation).
    from .types import LoanInput

    baseline = summarize_loan(
        LoanInput(
            loan_amount=input.loan_amount,
            annual_interest_rate_percent=input.annual_interest_rate_percent,
            term_years=input.term_months / 12,
            start_date=start_date,
        )
    )

    # Detail: a genuine per-period schedule at the chosen frequency's real cadence --
    # this is what actually determines new_months/new_total_interest/interest_saved
    # below, not a monthly-equivalent shortcut. 'monthly' reuses the baseline's own
    # schedule directly rather than re-deriving it through a second, independent
    # dynamic loop -- two independently-rounded implementations of the identical math
    # can otherwise land one payment apart from pure cent-rounding.
    if input.frequency == "monthly":
        schedule = [
            PeriodAmortizationEntry(
                period_number=row.payment_number,
                period_date=row.payment_date,
                payment_amount=row.payment_amount,
                interest_portion=row.interest_portion,
                principal_portion=row.principal_portion,
                remaining_balance=row.remaining_balance,
            )
            for row in baseline.schedule
        ]
    else:
        schedule = _generate_period_schedule(
            input.loan_amount,
            input.annual_interest_rate_percent,
            period_payment_amount,
            payments_per_year,
            input.frequency,
            start_date,
        )

    last_row = schedule[-1]
    new_total_interest = round2(sum(row.interest_portion for row in schedule))
    # Expressed as elapsed years (periods / payments_per_year) converted to months,
    # rather than derived from calendar dates.
    new_months = js_round((len(schedule) / payments_per_year) * 12)

    return PaymentFrequencyScheduleResult(
        frequency=input.frequency,
        payments_per_year=payments_per_year,
        monthly_payment=monthly_payment,
        period_payment_amount=period_payment_amount,
        schedule=schedule,
        number_of_periods=len(schedule),
        payoff_date=last_row.period_date,
        effective_extra_monthly_payment=effective_extra_monthly_payment,
        original_months=baseline.number_of_payments,
        new_months=new_months,
        months_saved=baseline.number_of_payments - new_months,
        original_total_interest=baseline.total_interest_paid,
        new_total_interest=new_total_interest,
        interest_saved=round2(baseline.total_interest_paid - new_total_interest),
    )
