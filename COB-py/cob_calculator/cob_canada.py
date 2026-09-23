"""Canadian Cost of Borrowing (COB) disclosure engine -- a SIBLING module next to
the existing US-style engine (mortgage.py/segment.py/apr.py), not a compounding
parameter bolted onto it. See docs/new-req/006-cost-of-borrowing-disclosure.md for the
full (rewritten) spec (data shapes, equations 1-8, invariants) -- every equation
implemented here is cited there. docs/new-req/007-cob-canada-brd-reconciliation.md is
the reconciliation against the real Alterna Savings BRD/workbook that drove this
rewrite; its worked validation vector is reproduced as a permanent test in
tests/test_cob_canada.py.

Why a sibling module, not a parameter on the existing engine: unaffected by the
rewrite -- see spec 006's "Open questions" for the full reasoning (the US engine
hardcodes monthly compounding in multiple places and its LoanSummary aggregation spans
a whole stitched multi-segment schedule, not a single contract term).

Scope boundary: like the reference COB-xlsx implementation, calculate_cob_canada
computes exactly ONE contract term's worth of outputs. A follow-on renewal/payment-
change flow is a fresh call whose `loan_amount` input is this call's
`CobCanadaResult.ending_balance` -- that chaining is the caller's job, not this
module's (full automatic renewal-chaining is out of scope, per the spec).

Rounding policy deviation (deliberate, documented): every other module in this
project rounds currency amounts to the cent at each row/result (round2()). This
module does NOT -- the spec's own worked validation vector (doc 007) gives expected
per-row and total values to many decimal places (e.g. payment #1's interest_paid =
138.82433838712447, total_interest = 22514.10591158249), which only reproduces
exactly if the schedule carries full floating-point precision throughout, matching
how the real Excel workbook this engine reproduces actually computes (Excel doesn't
round formula results, only display). Rounding every row to the cent here would
introduce cumulative drift the real system doesn't have. Callers that need a
cents-only display value should round at render time, not read that expectation into
this module.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from typing import Literal, Optional

from .dates import add_days, add_months
from .fees import FeeSchedule
from .money import js_round, round2
from .types import PaymentFrequency
from .validate import validate_cob_canada_input

Flow = Literal[
    "newMortgageOrLoan",
    "renewal",
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
    # Face amount for newMortgageOrLoan; CURRENT OUTSTANDING BALANCE for
    # renewal/paymentChange/variableRatePaymentChange flows (the spec's own field
    # reuse -- see "Presentation layer" table). Already INCLUSIVE of any financed
    # fees (see "Financed fees" below) -- amortized_principal == loan_amount exactly.
    loan_amount: float
    fees: FeeSchedule
    contract_rate_percent: float
    # USER-ENTERED, required in every flow (doc 007 finding #1) -- this engine never
    # solves for a payment amount, only generates a schedule/totals given one.
    payment_amount: float
    payment_frequency: PaymentFrequency
    first_payment_date: date
    end_date: date  # the date the schedule is run to (IN-13); see "Schedule generation"
    term_years: int  # DISPLAY ONLY -- does not drive the schedule (end_date does)
    term_months: int  # DISPLAY ONLY, same caveat
    disbursal_date: Optional[date] = None  # newMortgageOrLoan ONLY
    renewal_date: Optional[date] = None  # renewal/paymentChange/variableRatePaymentChange ONLY
    # renewal/paymentChange/variableRatePaymentChange flows: interest accrued since the
    # last payment, carried into the schedule as its initial carriedAccruedInterest --
    # NOT added to loan_amount/opening_balance (doc 007 finding #5). Ignored (treated
    # as 0) for newMortgageOrLoan regardless of what's passed, per the spec's table.
    accrued_interest: float = 0.0
    semi_annual_compounding_date: Optional[date] = None  # fixed-rate mortgages only, display-only


@dataclass
class ScheduleRow:
    period_number: int  # 1-based
    period_date: date
    days_in_period: int  # actual calendar days since the prior row's date (or since
    # start_date for the first row) -- feeds period_interest (equation 3)
    opening_balance: float
    period_interest: float  # opening_balance x calculated_rate x day-count fraction
    carried_accrued_interest_opening: float
    fees_opening: float
    payment_amount: float
    interest_paid: float  # waterfall step 1
    fees_paid: float  # waterfall step 2
    principal_portion: float  # waterfall step 3 (remainder)
    carried_accrued_interest_closing: float
    fees_closing: float
    remaining_balance: float  # this row's closing balance


@dataclass
class CobCanadaResult:
    calculated_rate_percent: float  # docx OUT-01 ("Semi-Annual Compounding Rate") --
    # the frequency-equivalent nominal rate equation 1/2 derives from
    # contract_rate_percent. Was computed and used internally (period_interest,
    # cob_rate_percent's short-circuit) but never exposed on this result -- fixed per
    # a UI-surfaced gap (weekly/3.74% silently not showing 3.706781471105014%).
    cob_amount: float
    cob_rate_percent: float
    total_payment: float
    number_of_payments: int
    total_interest: float  # sum of interest_paid across every row (includes any
    # recovered accrued interest, per the spec's own output description)
    principal_payment: float
    fees_recovered: float  # sum of fees_paid across every row -- needed for invariant
    # #2's three-way reconciliation (total_payment == total_interest + fees_recovered +
    # principal_payment)
    trigger_rate_percent: Optional[float]  # mortgage + variable-rate only
    amortization_schedule: list[ScheduleRow]
    term_days: int  # same day-count basis as T (equation 7), NOT display-only-and-
    # independent anymore (doc 007 finding #7)
    amortized_principal: float
    disbursal_amount: float
    # amortization_schedule[-1].remaining_balance -- exactly what a follow-on renewal/
    # payment-change call passes in as its own `loan_amount` input.
    ending_balance: float


def _payments_per_year(payment_frequency: PaymentFrequency) -> int:
    return _PAYMENTS_PER_YEAR[payment_frequency]


def _is_leap(year: int) -> bool:
    return year % 4 == 0 and (year % 100 != 0 or year % 400 == 0)


def _day_count_fraction(start: date, end: date) -> float:
    """Equation 3's day-count proration, generalized to split across however many
    calendar-year boundaries a period straddles (docx Appendix B.3): every day is
    attributed to the calendar year it falls in, days in a leap year are divided by
    366, days in a non-leap year by 365, and the partial-year fractions are summed.
    Reduces to the simple `(end - start).days / 365` case whenever the whole period
    sits inside a single non-leap year (the common case, and the worked vector's own
    payment #1: 6 days within March 2026, a non-leap year)."""
    if end <= start:
        return 0.0
    total = 0.0
    cursor = start
    while cursor.year < end.year:
        year_boundary = date(cursor.year + 1, 1, 1)
        segment_end = min(year_boundary, end)
        days_in_segment = (segment_end - cursor).days
        denom = 366 if _is_leap(cursor.year) else 365
        total += days_in_segment / denom
        cursor = year_boundary
    days_in_segment = (end - cursor).days
    denom = 366 if _is_leap(cursor.year) else 365
    total += days_in_segment / denom
    return total


def _select_m(product_type: ProductType, rate_type: RateType, n: int) -> int:
    """Equation 2 -- which compounding period `m` equation 1's conversion formula
    uses, by product/rate type (docx Section 4.2, three explicit cases):
      - fixed-rate mortgage: m=2 (semi-annual, Interest Act s. 6)
      - variable-rate mortgage: m=n (no conversion -- compounding period always
        matches the payment frequency)
      - personal loan, either rate type: m=12 (monthly compounding at the contract
        rate; reduces to contract_rate/12 exactly when n=12 too)
    """
    if product_type == "mortgage":
        return 2 if rate_type == "fixed" else n
    return 12


def compute_calculated_rate(
    contract_rate_percent: float,
    product_type: ProductType,
    rate_type: RateType,
    payment_frequency: PaymentFrequency,
) -> float:
    """Equations 1 & 2 -- the frequency-equivalent nominal rate:
        calculated_rate = n x [(1 + contract_rate/m)^(m/n) - 1]
    with `m` selected per _select_m. Returns a decimal nominal annual rate (e.g.
    0.03706781471105014), not a percent. When m == n (the variable-mortgage case)
    this reduces to contract_rate exactly, algebraically and numerically (the
    exponent m/n becomes 1, so no floating-point drift is introduced by the pow()
    call)."""
    n = _payments_per_year(payment_frequency)
    m = _select_m(product_type, rate_type, n)
    rate = contract_rate_percent / 100
    return n * ((1 + rate / m) ** (m / n) - 1)


def compute_amortized_principal(input: CobCanadaInput) -> float:
    """amortized_principal = loan_amount, unconditionally (doc 007 finding #4).
    `loan_amount` (IN-02) is ALREADY inclusive of any financed fees -- financing a fee
    is a breakout/display of an amount already inside loan_amount, not an additive
    top-up. `loan_amount` here already means "current outstanding balance" for
    renewal/paymentChange/variableRatePaymentChange flows, per the spec's own field
    reuse."""
    return input.loan_amount


def compute_disbursal_amount(input: CobCanadaInput) -> float:
    """disbursal_amount = loan_amount - fees.total_financed_fees. Cash (non-financed)
    fees do NOT reduce disbursal -- they're paid separately by the borrower, outside
    loan proceeds (IN-07, BR-04; doc 007 finding #4's correction over an earlier
    reconciliation draft that subtracted cash fees too)."""
    return round2(input.loan_amount - input.fees.total_financed_fees)


def compute_trigger_rate_percent(
    payment_amount: float,
    payments_per_year: int,
    total_borrowed: float,
    product_type: ProductType,
    rate_type: RateType,
) -> Optional[float]:
    """Equation 6 -- mortgage + variable only (invariant #1: fixed-rate mortgages and
    personal loans get None/NA, never computed or displayed). Unchanged from the prior
    draft/doc 007's reconciliation -- CONFIRMED against the live workbook exactly.
        trigger_rate_percent = (payment_amount * payments_per_year / total_borrowed) * 100
    `total_borrowed` MUST be the flow's CURRENT outstanding principal -- the original
    `loan_amount` for a newMortgageOrLoan flow, the current balance for the other three
    flows (also `loan_amount`, per the spec's field reuse -- these coincide with
    `amortized_principal` since finding #4 removed any addition to loan_amount)."""
    if product_type != "mortgage" or rate_type != "variable":
        return None
    if not (total_borrowed > 0):
        raise ValueError(f"totalBorrowed must be > 0, got {total_borrowed}")
    return (payment_amount * payments_per_year) / total_borrowed * 100


def compute_average_outstanding_balance(schedule: list[ScheduleRow]) -> float:
    """Equation 7's `P` -- the average of each counted row's BEGINNING (opening)
    balance (Financial Consumer Protection Framework Regulations s. 47(1); docx
    Appendix B.7: "the average of the opening balances across all payments"). Each
    ScheduleRow now carries its own opening_balance directly, so this is a plain
    average, no longer needing to be inferred from the previous row's ending
    balance."""
    if not schedule:
        raise ValueError("schedule must contain at least one row")
    return sum(row.opening_balance for row in schedule) / len(schedule)


def compute_cob_amount(total_interest: float, fees: FeeSchedule) -> float:
    """Equation 8 -- ALL fees, unconditionally (doc 007 finding #6; drops the prior
    draft's FCPFR inclusion/exclusion per-fee filtering entirely):
        cob_amount = total_interest + fees.total_financed_fees + fees.total_cash_fees
    """
    return total_interest + fees.total_financed_fees + fees.total_cash_fees


def compute_cob_rate_percent(
    cob_amount: float, term_years_fraction: float, average_outstanding_balance: float
) -> float:
    """Equation 7's GENERAL (fees > 0) case only -- `cob_rate_percent =
    (cob_amount / (T x P)) x 100`. When there are no fees at all, calculate_cob_canada
    does NOT call this function -- it short-circuits to `calculated_rate` directly
    (FCPFR s. 32, mirrors apr.py's identical `total_cash_fees == 0` branch), because no
    choice of `T` reproduces doc 007's worked vector's cob_rate_percent from this
    formula exactly (verified numerically) -- that case isn't a property of this
    formula, it's a separate rule. `T` is passed in already computed as the actual
    elapsed time from start_date to final_payment_date, in years (doc 007 finding #7 --
    actual elapsed days, not a nominal term_years + term_months/12), as a plain
    `.days / 365` divide per the spec's literal wording -- see calculate_cob_canada's
    comment for why this (rather than a leap-adjusted divide) is used, and that it's an
    unconfirmed judgment call for the fees > 0 case specifically."""
    if not (average_outstanding_balance > 0):
        raise ValueError(f"averageOutstandingBalance must be > 0, got {average_outstanding_balance}")
    if not (term_years_fraction > 0):
        raise ValueError(f"term (T, in years) must be > 0, got {term_years_fraction}")
    return (cob_amount / (term_years_fraction * average_outstanding_balance)) * 100


def _period_date_for(payment_frequency: PaymentFrequency, first_payment_date: date, index: int) -> date:
    """Row dates step forward from first_payment_date at the payment frequency's
    cadence (monthly via add_months for exact calendar-month parity; weekly/biweekly
    via exact 7/14-day steps; semiMonthly evenly spaced, approximating the "1st &
    15th" convention). "Accelerated Weekly" (BR-09) is treated identically to plain
    Weekly here, per the spec."""
    if payment_frequency == "monthly":
        return add_months(first_payment_date, index)
    if payment_frequency == "weekly":
        return add_days(first_payment_date, index * 7)
    if payment_frequency == "biweekly":
        return add_days(first_payment_date, index * 14)
    if payment_frequency == "semiMonthly":
        return add_days(first_payment_date, js_round((index * 365.25) / 24))
    raise ValueError(f"unknown payment frequency {payment_frequency}")


def _generate_schedule(
    payment_frequency: PaymentFrequency,
    first_payment_date: date,
    end_date: date,
    start_date: date,
    opening_principal: float,
    calculated_rate: float,
    payment_amount: float,
    initial_carried_accrued_interest: float,
    initial_fees_to_recover: float,
) -> list[ScheduleRow]:
    """Equations 3-5: per-row day-count-prorated interest, the interest -> fees ->
    principal waterfall, and the two-way stop condition. Generates one row per
    payment_frequency period starting at first_payment_date, and stops at the FIRST
    of: the row whose date is STRICTLY AFTER end_date (that row is NOT generated --
    the schedule simply stops before it; a row landing exactly ON end_date IS
    generated/included -- confirmed against the live workbook's VBA macro,
    `DateDiff("d", eDate, nextDate) > 0`, not `>=`), or the row whose own
    closing_balance reaches zero (that row IS generated/included, since it's the
    payoff payment)."""
    rows: list[ScheduleRow] = []
    balance = opening_principal
    carried_accrued_interest = initial_carried_accrued_interest
    fees_to_recover = initial_fees_to_recover
    prior_date = start_date
    index = 0

    while True:
        this_date = _period_date_for(payment_frequency, first_payment_date, index)
        if this_date > end_date:
            break

        days_in_period = (this_date - prior_date).days
        day_fraction = _day_count_fraction(prior_date, this_date)
        period_interest = balance * calculated_rate * day_fraction

        carried_accrued_interest_opening = carried_accrued_interest
        fees_opening = fees_to_recover

        total_interest_due = period_interest + carried_accrued_interest_opening
        interest_paid = min(payment_amount, total_interest_due)
        carried_accrued_interest_closing = total_interest_due - interest_paid

        remaining_after_interest = payment_amount - interest_paid
        fees_paid = min(remaining_after_interest, fees_opening)
        fees_closing = fees_opening - fees_paid

        principal_portion = remaining_after_interest - fees_paid
        closing_balance = balance - principal_portion

        rows.append(
            ScheduleRow(
                period_number=index + 1,
                period_date=this_date,
                days_in_period=days_in_period,
                opening_balance=balance,
                period_interest=period_interest,
                carried_accrued_interest_opening=carried_accrued_interest_opening,
                fees_opening=fees_opening,
                payment_amount=payment_amount,
                interest_paid=interest_paid,
                fees_paid=fees_paid,
                principal_portion=principal_portion,
                carried_accrued_interest_closing=carried_accrued_interest_closing,
                fees_closing=fees_closing,
                remaining_balance=closing_balance,
            )
        )

        balance = closing_balance
        carried_accrued_interest = carried_accrued_interest_closing
        fees_to_recover = fees_closing
        prior_date = this_date
        index += 1

        if closing_balance <= 0:
            break

    return rows


def calculate_cob_canada(input: CobCanadaInput) -> CobCanadaResult:
    validate_cob_canada_input(input)

    n = _payments_per_year(input.payment_frequency)
    calculated_rate = compute_calculated_rate(
        input.contract_rate_percent, input.product_type, input.rate_type, input.payment_frequency
    )

    amortized_principal = compute_amortized_principal(input)
    disbursal_amount = compute_disbursal_amount(input)

    start_date = input.disbursal_date if input.flow == "newMortgageOrLoan" else input.renewal_date
    if start_date is None:
        # Unreachable in practice -- validate_cob_canada_input already enforces this
        # per-flow -- but keeps mypy/type-checkers and any future caller that skips
        # validation honest.
        raise ValueError("disbursalDate/renewalDate must be set for this flow")

    initial_carried_accrued_interest = 0.0 if input.flow == "newMortgageOrLoan" else input.accrued_interest
    initial_fees_to_recover = input.fees.total_financed_fees + input.fees.total_cash_fees

    schedule = _generate_schedule(
        input.payment_frequency,
        input.first_payment_date,
        input.end_date,
        start_date,
        amortized_principal,
        calculated_rate,
        input.payment_amount,
        initial_carried_accrued_interest,
        initial_fees_to_recover,
    )
    if not schedule:
        raise ValueError(
            "no schedule rows generated -- firstPaymentDate must be before endDate at "
            f"the {input.payment_frequency} frequency"
        )

    total_payment = sum(row.payment_amount for row in schedule)
    total_interest = sum(row.interest_paid for row in schedule)
    fees_recovered = sum(row.fees_paid for row in schedule)
    principal_payment = sum(row.principal_portion for row in schedule)

    final_payment_date = schedule[-1].period_date
    term_days = (final_payment_date - start_date).days
    # T = actual elapsed days from start_date to final_payment_date, / 365 -- plain,
    # per the spec's literal wording (docx Appendix B.7: "actual days ... divided by
    # 365"). JUDGMENT CALL: the spec doesn't say whether this divide should get the
    # same leap-year split equation 3's per-row day-count fraction gets; an earlier
    # version of this module guessed "yes" based on a numeric near-match against doc
    # 007's worked vector, but that was wrong -- the worked vector's cob_rate_percent
    # doesn't come from any particular T (see the no-fees short-circuit below), so
    # there was never real evidence either way. Left as the plain, unadjusted divide
    # (the spec's literal words) rather than re-guessing a second time; flagging this
    # as unconfirmed for the fees>0 case rather than asserting it.
    term_years_fraction = term_days / 365

    average_outstanding_balance = compute_average_outstanding_balance(schedule)

    total_fees = input.fees.total_financed_fees + input.fees.total_cash_fees
    cob_amount = compute_cob_amount(total_interest, input.fees)
    if total_fees == 0:
        # No fees at all: cob_amount is 100% interest, and the FCPFR's "the APR for a
        # credit agreement is the annual interest rate if the only cost of borrowing
        # is interest" (s. 32) short-circuit applies -- mirrors apr.py's identical
        # `total_cash_fees == 0` branch. Doc 007's worked vector is exactly this case
        # (financed_fees = cash_fees = 0) and its cob_rate_percent matches
        # calculated_rate to 15 significant digits in the live workbook -- NOT a
        # property of the C/(T x P) formula for any T (no choice of T reproduces it
        # exactly from the real average-balance P; verified numerically), but an
        # explicit rule, not a formula coincidence.
        cob_rate_percent = calculated_rate * 100
    else:
        cob_rate_percent = compute_cob_rate_percent(cob_amount, term_years_fraction, average_outstanding_balance)

    trigger_rate_percent = compute_trigger_rate_percent(
        input.payment_amount, n, input.loan_amount, input.product_type, input.rate_type
    )

    return CobCanadaResult(
        calculated_rate_percent=calculated_rate * 100,
        cob_amount=cob_amount,
        cob_rate_percent=cob_rate_percent,
        total_payment=total_payment,
        number_of_payments=len(schedule),
        total_interest=total_interest,
        principal_payment=principal_payment,
        fees_recovered=fees_recovered,
        trigger_rate_percent=trigger_rate_percent,
        amortization_schedule=schedule,
        term_days=term_days,
        amortized_principal=amortized_principal,
        disbursal_amount=disbursal_amount,
        ending_balance=schedule[-1].remaining_balance,
    )
