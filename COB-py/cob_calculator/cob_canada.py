"""Canadian Cost of Borrowing (COB) disclosure engine -- a new SIBLING module next to
the existing US-style engine (mortgage.py/segment.py/apr.py), not a compounding
parameter bolted onto it. See docs/new-req/006-cost-of-borrowing-disclosure.md for the
full spec (data shapes, equations 1-8, invariants) -- every equation implemented here
is cited there.

Why a sibling module, not a parameter on the existing engine (spec's "Open questions"
-> target-module resolution): the US engine hardcodes a monthly-compounding
assumption independently in three places (payment.py, segment.py, and
payment_frequency.py's own nominal/n derivation for non-monthly frequencies), and its
LoanSummary/summarize_mortgage aggregation spans a whole stitched multi-segment
schedule, not a single contract term the way this spec needs. The one piece of
country-agnostic math that genuinely IS shared: calculate_monthly_payment (payment.py)
was extended with an optional pre-derived `periodic_rate` parameter (additive,
existing callers unaffected) so this module can hand it equation 1's/2's periodic rate
without re-deriving the annuity formula a second time.

Scope boundary: like the reference COB-xlsx/build_workbook_ca.py implementation,
calculate_cob_canada computes exactly ONE contract term's worth of outputs. A
follow-on renewal ("existing mortgage"/"payment change") is a fresh call whose
`loan_amount` input is this call's `CobCanadaResult.ending_balance` -- that chaining is
the caller's job, not this module's (full automatic renewal-chaining is out of scope,
per the spec).
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from typing import Literal, Optional

from .dates import add_days, add_months
from .fees import FeeSchedule
from .money import js_round, round2
from .payment import calculate_monthly_payment
from .types import PaymentFrequency
from .validate import validate_cob_canada_input

Flow = Literal[
    "newMortgage",
    "newLoan",
    "existingMortgage",
    "existingLoan",
    "paymentChange",
    "variableRatePaymentChange",
]
ProductType = Literal["mortgage", "personalLoan"]
RateType = Literal["variable", "fixed"]

_PAYMENTS_PER_YEAR: dict[PaymentFrequency, int] = {
    "monthly": 12,
    "semiMonthly": 24,
    "biweekly": 26,
    "weekly": 52,
}


@dataclass
class CobCanadaInput:
    flow: Flow
    product_type: ProductType
    rate_type: RateType
    # Face/contract amount for new flows; CURRENT OUTSTANDING BALANCE for
    # existing/payment-change flows (this dual meaning is the spec's own field reuse,
    # see "Presentation layer" table) -- before fees.total_financed_fees/
    # total_cash_fees are netted (see "Financed fees").
    loan_amount: float
    fees: FeeSchedule
    contract_rate_percent: float
    payment_frequency: PaymentFrequency
    term_years: int  # CONTRACT TERM, not amortization
    term_months: int
    remaining_amortization_years: int
    remaining_amortization_months: int
    first_payment_date: date
    end_date: date  # end of this contract term (maturity/renewal date)
    disbursal_date: Optional[date] = None  # new-flow only
    pre_approval_date: Optional[date] = None  # new mortgage / new loan only, display-only
    renewal_date: Optional[date] = None  # existing/renewal/payment-change flows
    accrued_interest: float = 0.0  # existing/renewal flows
    semi_annual_compounding_date: Optional[date] = None  # fixed-rate mortgages only, display-only


@dataclass
class ScheduleRow:
    period_number: int  # 1-based, within this contract term only
    period_date: date
    payment_amount: float
    interest_portion: float
    principal_portion: float
    remaining_balance: float


@dataclass
class CobCanadaResult:
    payment_amount: float
    cob_amount: float
    cob_rate_percent: float
    total_payment: float
    number_of_payments: int
    total_interest: float
    principal_payment: float
    trigger_rate_percent: Optional[float]  # None for fixed mortgages and personal loans
    amortization_schedule: list[ScheduleRow]
    term_days: int
    # Not in the spec's own Output list, but reported for the same traceability
    # apr.py's effective_loan_amount/amount_financed give the US engine.
    amortized_principal: float
    disbursal_amount: float
    # amortization_schedule[-1].remaining_balance -- exactly what a follow-on renewal
    # call passes in as its own `loan_amount` (see "Term vs. amortization scoping").
    ending_balance: float


def _payments_per_year(payment_frequency: PaymentFrequency) -> int:
    return _PAYMENTS_PER_YEAR[payment_frequency]


def compute_periodic_rate(
    contract_rate_percent: float,
    product_type: ProductType,
    rate_type: RateType,
    payment_frequency: PaymentFrequency,
) -> float:
    """Equations 1 & 2. Fixed-rate mortgages compound semi-annually, not in advance
    (equation 1, CONFIRMED -- Interest Act R.S.C. 1985, c. I-15, s. 6):
        i_period = (1 + contract_rate/2)^(2/n) - 1
    Every other combination -- variable-rate mortgages, personal loans of either rate
    type -- uses the nominal/n convention (equation 2, BEST AVAILABLE, kept as a
    default rather than a hardcoded fact per the spec's caveat that real lenders
    differ):
        i_period = contract_rate / n
    Returns a periodic rate as a decimal (e.g. 0.0041239...), not a percent.
    """
    n = _payments_per_year(payment_frequency)
    rate = contract_rate_percent / 100
    if product_type == "mortgage" and rate_type == "fixed":
        return (1 + rate / 2) ** (2 / n) - 1
    return rate / n


def _total_months(years: int, months: int) -> int:
    return years * 12 + months


def _periods_for_months(total_months: int, payment_frequency: PaymentFrequency) -> int:
    """Converts a span expressed in months into a number of payment periods at the
    given frequency. Monthly/semiMonthly convert exactly (12/24 periods per year are
    exact multiples of 12 months); biweekly/weekly don't divide evenly into calendar
    months in real life either, so this rounds to the nearest whole period -- the same
    months<->periods rounding pattern payment_frequency.py already uses for
    new_months."""
    n = _payments_per_year(payment_frequency)
    return js_round(total_months * (n / 12))


def _period_date_for(payment_frequency: PaymentFrequency, start_date: date, index: int) -> date:
    """Mirrors payment_frequency.py's private per-period date helper (monthly via
    add_months for exact parity with the standard schedule; weekly/biweekly via exact
    7/14-day steps; semiMonthly evenly spaced, approximating the "1st & 15th"
    convention)."""
    if payment_frequency == "monthly":
        return add_months(start_date, index)
    if payment_frequency == "weekly":
        return add_days(start_date, index * 7)
    if payment_frequency == "biweekly":
        return add_days(start_date, index * 14)
    if payment_frequency == "semiMonthly":
        return add_days(start_date, js_round((index * 365.25) / 24))
    raise ValueError(f"unknown payment frequency {payment_frequency}")


def compute_term_days(input: CobCanadaInput) -> int:
    """Equation 8 -- display only, never feeds back into any monetary calculation
    (invariant #4): the remainder after whole term_years/term_months are extracted
    from disbursal_date/renewal_date/first_payment_date."""
    start = input.disbursal_date or input.renewal_date or input.first_payment_date
    whole_term_end = add_months(start, _total_months(input.term_years, input.term_months))
    return (input.end_date - whole_term_end).days


def compute_amortized_principal(input: CobCanadaInput) -> float:
    """amortized principal = loan_amount + fees.total_financed_fees, generalized
    per-fee via Fee.financed (see "Financed fees") -- financing a fee only ever grows
    this, never shrinks it. For existing/renewal/payment-change flows,
    accrued_interest also capitalizes into this term's opening balance (the same
    treatment a financed fee gets); this isn't spelled out in the main "Financed fees"
    section but matches the judgment call the reference COB-xlsx/build_workbook_ca.py
    implementation already settled on for the identical field (see the spec's "Excel
    implementation notes" -> judgment call #3), so this module follows it rather than
    silently picking a third convention. `loan_amount` here already means "current
    outstanding balance" for existing/renewal flows, per the spec's own field reuse."""
    return round2(input.loan_amount + input.fees.total_financed_fees + input.accrued_interest)


def compute_disbursal_amount(input: CobCanadaInput) -> float:
    """disbursal = loan_amount + fees.total_financed_fees - fees.total_cash_fees --
    mirrors apr.py's amount_financed = effective_loan_amount - total_cash_fees exactly
    (see "Financed fees" / "New vs. existing disposal amount"). accrued_interest is
    carried-forward interest, not new money disbursed, so it does not enter this
    figure."""
    return round2(input.loan_amount + input.fees.total_financed_fees - input.fees.total_cash_fees)


def compute_payment_amount(
    amortized_principal: float,
    contract_rate_percent: float,
    periodic_rate: float,
    remaining_amortization_periods: int,
) -> float:
    """Equation 3 -- REUSES calculate_monthly_payment (payment.py) via its
    pre-derived-periodic-rate parameter rather than re-deriving
    `PMT = P * [r(1+r)^n] / [(1+r)^n - 1]`. `remaining_amortization_periods` (not the
    current contract term's period count) is `n`, per "Term vs. amortization
    scoping"."""
    return calculate_monthly_payment(
        amortized_principal,
        contract_rate_percent,
        remaining_amortization_periods,
        periodic_rate=periodic_rate,
    )


def compute_trigger_rate_percent(
    payment_amount: float,
    payments_per_year: int,
    total_borrowed: float,
    product_type: ProductType,
    rate_type: RateType,
) -> Optional[float]:
    """Equation 4 -- mortgage + variable only (invariant #1: fixed-rate mortgages and
    personal loans get None/NA, never computed or displayed).
        trigger_rate_percent = (payment_amount * payments_per_year / total_borrowed) * 100
    `total_borrowed` MUST be the CURRENT outstanding principal balance -- for a new
    flow that's amortized_principal (no payments made yet); for an existing/renewal/
    payment-change flow it's the since-amortized current balance (also
    amortized_principal, since `loan_amount` already means "current balance" for those
    flows per the spec's field reuse). Not an approximation -- see equation 4's
    derivation from the rigorous interest-only break-even solve."""
    if product_type != "mortgage" or rate_type != "variable":
        return None
    if not (total_borrowed > 0):
        raise ValueError(f"totalBorrowed must be > 0, got {total_borrowed}")
    return (payment_amount * payments_per_year) / total_borrowed * 100


def compute_average_outstanding_balance(amortized_principal: float, schedule: list[ScheduleRow]) -> float:
    """Equation 6's `P` -- the average of the principal outstanding at the
    *beginning* of each counted payment period, before that period's payment is
    subtracted (Financial Consumer Protection Framework Regulations s. 47(1); read as
    "beginning balance" per the reference implementation's judgment call #4). The
    schedule only records each row's ENDING balance, so the beginning balance of row i
    is row (i-1)'s ending balance, and row 0's beginning balance is
    amortized_principal."""
    if not schedule:
        raise ValueError("schedule must contain at least one row")
    beginning_balances = [amortized_principal] + [row.remaining_balance for row in schedule[:-1]]
    return sum(beginning_balances) / len(beginning_balances)


def compute_cob_amount(total_interest: float, fees: FeeSchedule) -> float:
    """Equation 7 -- cob_amount = total_interest + total_fees_included_in_cob, driven
    by the regulatory `included_in_cob` flag (Financial Consumer Protection Framework
    Regulations s. 48), NOT this project's existing financed/cash split."""
    return round2(total_interest + fees.total_fees_included_in_cob)


def compute_cob_rate_percent(
    cob_amount: float, term_years: int, term_months: int, average_outstanding_balance: float
) -> float:
    """Equation 6 -- the regulatory average-outstanding-balance APR,
    `APR = (C / (T * P)) * 100`. Deliberately NOT spec 002's apr.py IRR/actuarial
    solve (see equation 6's correction note): Canadian regulation prescribes this
    simpler, different formula."""
    if not (average_outstanding_balance > 0):
        raise ValueError(f"averageOutstandingBalance must be > 0, got {average_outstanding_balance}")
    t_years = term_years + term_months / 12
    if not (t_years > 0):
        raise ValueError(f"term (years+months) must total > 0, got {t_years}")
    return (cob_amount / (t_years * average_outstanding_balance)) * 100


def _generate_term_schedule(
    amortized_principal: float,
    periodic_rate: float,
    payment_amount: float,
    number_of_payments: int,
    total_amortization_periods: int,
    payment_frequency: PaymentFrequency,
    start_date: date,
) -> list[ScheduleRow]:
    """Per-period rows for exactly this contract term (equation 5's total_payment/
    total_interest/principal_payment, and equation 6's average balance, are all scoped
    to just these rows -- see "Term vs. amortization scoping", NOT the full
    remaining_amortization_periods). Rounds interest to the cent before deriving that
    row's principal/next balance, same convention as segment.py's schedule rows -- but
    this is a fresh, small loop rather than a call into
    segment.compute_segment_schedule: that function re-derives `r = rate/100/12`
    internally a second time (the very duplication this module exists to avoid, see
    this module's docstring) and is keyed to Segment/AmortizationEntry types built
    around US monthly-only payment dates with no notion of a non-monthly payment
    frequency."""
    rows: list[ScheduleRow] = []
    balance = round2(amortized_principal)
    # Only force-clear the balance on the scheduled final row when this contract term
    # actually consumes the entire remaining amortization (a true payoff) -- otherwise
    # the term ends mid-amortization and the leftover balance is exactly
    # `ending_balance`, the next renewal's opening balance.
    is_full_payoff_term = number_of_payments >= total_amortization_periods

    for index in range(number_of_payments):
        interest_portion = round2(balance * periodic_rate)
        is_last_row = index == number_of_payments - 1

        if is_last_row and is_full_payoff_term:
            principal_portion = balance
            payment = round2(interest_portion + principal_portion)
            remaining_balance = 0.0
        else:
            principal_portion = round2(payment_amount - interest_portion)
            payment = payment_amount
            remaining_balance = round2(balance - principal_portion)

        rows.append(
            ScheduleRow(
                period_number=index + 1,
                period_date=_period_date_for(payment_frequency, start_date, index),
                payment_amount=payment,
                interest_portion=interest_portion,
                principal_portion=principal_portion,
                remaining_balance=remaining_balance,
            )
        )
        balance = remaining_balance

    return rows


def calculate_cob_canada(input: CobCanadaInput) -> CobCanadaResult:
    validate_cob_canada_input(input)

    n = _payments_per_year(input.payment_frequency)
    periodic_rate = compute_periodic_rate(
        input.contract_rate_percent, input.product_type, input.rate_type, input.payment_frequency
    )

    amortized_principal = compute_amortized_principal(input)
    disbursal_amount = compute_disbursal_amount(input)

    total_amortization_periods = _periods_for_months(
        _total_months(input.remaining_amortization_years, input.remaining_amortization_months),
        input.payment_frequency,
    )
    if total_amortization_periods <= 0:
        raise ValueError(
            "remainingAmortizationYears/remainingAmortizationMonths must total more than 0 "
            f"periods at the {input.payment_frequency} frequency, got {total_amortization_periods}"
        )

    payment_amount = compute_payment_amount(
        amortized_principal, input.contract_rate_percent, periodic_rate, total_amortization_periods
    )

    term_periods_raw = _periods_for_months(
        _total_months(input.term_years, input.term_months), input.payment_frequency
    )
    # Term-vs-amortization clamp -- matches COB-xlsx/build_workbook_ca.py's own
    # judgment call #5: a contract term should never outlive its own amortization, so
    # an over-long term is silently clamped rather than rejected.
    number_of_payments = min(term_periods_raw, total_amortization_periods)
    if number_of_payments <= 0:
        raise ValueError(
            f"termYears/termMonths must total more than 0 periods at the "
            f"{input.payment_frequency} frequency, got {term_periods_raw}"
        )

    start_date = input.disbursal_date or input.renewal_date or input.first_payment_date
    schedule = _generate_term_schedule(
        amortized_principal,
        periodic_rate,
        payment_amount,
        number_of_payments,
        total_amortization_periods,
        input.payment_frequency,
        start_date,
    )

    total_payment = round2(sum(row.payment_amount for row in schedule))
    total_interest = round2(sum(row.interest_portion for row in schedule))
    principal_payment = round2(total_payment - total_interest)

    trigger_rate_percent = compute_trigger_rate_percent(
        payment_amount, n, amortized_principal, input.product_type, input.rate_type
    )

    cob_amount = compute_cob_amount(total_interest, input.fees)
    average_outstanding_balance = compute_average_outstanding_balance(amortized_principal, schedule)
    cob_rate_percent = compute_cob_rate_percent(
        cob_amount, input.term_years, input.term_months, average_outstanding_balance
    )

    return CobCanadaResult(
        payment_amount=payment_amount,
        cob_amount=cob_amount,
        cob_rate_percent=cob_rate_percent,
        total_payment=total_payment,
        number_of_payments=number_of_payments,
        total_interest=total_interest,
        principal_payment=principal_payment,
        trigger_rate_percent=trigger_rate_percent,
        amortization_schedule=schedule,
        term_days=compute_term_days(input),
        amortized_principal=amortized_principal,
        disbursal_amount=disbursal_amount,
        ending_balance=schedule[-1].remaining_balance,
    )
