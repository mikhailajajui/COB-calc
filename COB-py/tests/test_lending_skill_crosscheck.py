"""Cross-validates cob_calculator's outputs against the `lending` skill's
independent reference implementation (LendingAnalysis in
.claude/skills/lending/scripts/lending.py).

This is deliberately a SECOND, independently-written implementation of the same
domain math -- agreement between two implementations built from the same
formulas but different code is much stronger evidence of correctness than more
unit tests derived from the same mental model, because it catches a bug that
would otherwise be baked into both the code and the tests.

Known, expected sources of small disagreement (not bugs -- documented so a
future maintainer doesn't chase them):
  - cob_calculator rounds every row to the cent, like a real bank statement;
    LendingAnalysis keeps full float precision throughout and only rounds the
    final reported figure. Over a 360-payment schedule this can accumulate to
    a few cents to low dollars of difference -- tolerances below are set
    accordingly, not loosened to hide a real mismatch.
  - LendingAnalysis.extra_payment_savings() stops when balance <= 0.005 and
    does not force a final row to clear the balance exactly, and caps at
    2x the original term rather than a fixed payments-safety-cap; it also
    fully applies overpayment past the balance on the very last row. This can
    shift the payoff month by up to 1 vs. cob_calculator's forced-final-row
    convention. Tested with an explicit `abs(...) <= 1` month tolerance.
"""

import importlib.util
import math
from datetime import date
from pathlib import Path

import pytest

from cob_calculator.arm import ArmResetInput, calculate_arm_reset_rate
from cob_calculator.dscr import debt_service_coverage_ratio
from cob_calculator.extra_payment import calculate_extra_payment_savings
from cob_calculator.ltv import loan_to_value
from cob_calculator.mortgage import summarize_mortgage
from cob_calculator.payment import calculate_monthly_payment
from cob_calculator.pmi import calculate_pmi_payment
from cob_calculator.points import PointsBreakevenInput, calculate_points_breakeven
from cob_calculator.refinance import (
    RefinanceBreakevenInput,
    RefinanceComparisonInput,
    calculate_refinance_breakeven,
    compare_refinance,
)
from cob_calculator.segment import compute_segment_schedule
from cob_calculator.types import ExtraPaymentSavingsInput, LoanInput, MortgageInput, Segment

_SKILL_SCRIPT = (
    Path(__file__).resolve().parents[2] / ".claude" / "skills" / "lending" / "scripts" / "lending.py"
)


def _load_lending_analysis():
    spec = importlib.util.spec_from_file_location("lending_skill_reference", _SKILL_SCRIPT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.LendingAnalysis


LA = _load_lending_analysis()


# ---------------------------------------------------------------------------
# Monthly payment / total interest -- the foundational formula both engines share.
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "principal,rate_percent,term_months",
    [
        (400000, 6.5, 360),
        (300000, 6.5, 360),
        (400000, 5.9, 180),
        (150000, 4.0, 240),
        (500000, 0.0, 360),  # zero-rate edge case
        (50000, 7.25, 60),
    ],
)
def test_monthly_payment_agrees_with_skill_reference(principal, rate_percent, term_months):
    ours = calculate_monthly_payment(principal, rate_percent, term_months)
    theirs = LA.monthly_payment(principal, rate_percent / 100, term_months)
    assert ours == pytest.approx(theirs, abs=0.01)


@pytest.mark.parametrize(
    "principal,rate_percent,term_months",
    [
        (400000, 6.5, 360),
        (300000, 6.5, 360),
        (400000, 5.9, 180),
    ],
)
def test_total_interest_agrees_with_skill_reference(principal, rate_percent, term_months):
    ours = summarize_loan_total_interest(principal, rate_percent, term_months)
    theirs = LA.total_interest(principal, rate_percent / 100, term_months)
    # cent-rounding of 360 individual rows vs. unrounded n*PMT-P -- allow a few
    # dollars of accumulated rounding drift, not unbounded slop.
    assert ours == pytest.approx(theirs, abs=5.0)


def summarize_loan_total_interest(principal, rate_percent, term_months):
    from cob_calculator.loan import summarize_loan

    return summarize_loan(
        LoanInput(loan_amount=principal, annual_interest_rate_percent=rate_percent, term_years=term_months / 12)
    ).total_interest_paid


def test_skill_reference_matches_its_own_documented_worked_examples():
    # Sanity check on the oracle itself before trusting it as ground truth.
    assert LA.monthly_payment(400_000, 0.065, 360) == pytest.approx(2528.0, abs=1.0)
    assert LA.total_interest(400_000, 0.065, 360) == pytest.approx(510178.0, abs=50.0)


# ---------------------------------------------------------------------------
# Remaining balance -- closed-form (skill) vs. per-row simulation (ours).
#
# Full writeup: docs/new-req/004-rounding-drift-accuracy-disclosure.md
#
# These are NOT expected to agree to the penny for large k, and that's not a
# bug: cob_calculator rounds interest to the cent every row (like a real
# amortization schedule), and each row's rounding error compounds forward at
# rate (1+r) per remaining period (a $0.01 discrepancy at row k becomes
# roughly $0.01*(1+r)^(n-k) by row n) -- verified numerically below: the drift
# grows smoothly from ~$0.004 at row 1 to ~$4.68 at row 359, then resolves to
# exactly $0 at row 360 because the engine forces the final row to true up
# all accumulated rounding, exactly like a real final mortgage payment does.
# LendingAnalysis, by contrast, keeps full float precision throughout and only
# rounds the final displayed figure -- it's the theoretical closed-form, ours
# is the bank-statement-accurate one. Both are "correct" for their own frame;
# the test below checks tight agreement early (where drift hasn't accumulated)
# and *bounded, monotonically-explained* drift later, rather than pretending
# they should match exactly throughout.
# ---------------------------------------------------------------------------


def _schedule_for_remaining_balance_check():
    principal, rate_percent, term_months = 300000, 6.5, 360
    result = compute_segment_schedule(
        Segment(
            start_date=date(2024, 1, 1),
            annual_interest_rate_percent=rate_percent,
            amortization_months_remaining=term_months,
            starting_balance=principal,
        ),
        0,
        principal,
        1,
        {},
    )
    return principal, rate_percent, term_months, result


@pytest.mark.parametrize("payments_made", [1, 12, 60])
def test_remaining_balance_agrees_tightly_early_in_the_schedule(payments_made):
    principal, rate_percent, term_months, result = _schedule_for_remaining_balance_check()
    ours = result.rows[payments_made - 1].remaining_balance
    theirs = LA.remaining_balance(principal, rate_percent / 100, term_months, payments_made)
    assert ours == pytest.approx(theirs, abs=1.0)


@pytest.mark.parametrize("payments_made", [180, 300, 359])
def test_remaining_balance_drift_stays_bounded_late_in_the_schedule(payments_made):
    principal, rate_percent, term_months, result = _schedule_for_remaining_balance_check()
    ours = result.rows[payments_made - 1].remaining_balance
    theirs = LA.remaining_balance(principal, rate_percent / 100, term_months, payments_made)
    # Bounded (a few dollars on a $300K loan), not runaway/unbounded -- if this
    # ever blew up to hundreds of dollars, that WOULD indicate a real bug.
    assert abs(ours - theirs) < 10.0


def test_remaining_balance_converges_to_exactly_zero_at_payoff_despite_drift():
    principal, rate_percent, term_months, result = _schedule_for_remaining_balance_check()
    assert result.rows[-1].remaining_balance == 0
    assert LA.remaining_balance(principal, rate_percent / 100, term_months, term_months) == pytest.approx(0.0, abs=0.01)


# ---------------------------------------------------------------------------
# LTV / DSCR / PMI -- pure ratio/rate functions, should match almost exactly.
# ---------------------------------------------------------------------------


def test_ltv_agrees_with_skill_reference():
    assert loan_to_value(450000, 500000) == pytest.approx(LA.loan_to_value(450000, 500000))


def test_dscr_agrees_with_skill_reference():
    assert debt_service_coverage_ratio(120000, 90000) == pytest.approx(
        LA.debt_service_coverage_ratio(120000, 90000)
    )


def test_pmi_cost_agrees_with_skill_reference():
    # cob_calculator's calculate_pmi_payment takes a rate in percent (e.g. 0.8);
    # LA.pmi_cost takes a decimal (0.008) with a different default (0.008 vs our
    # required explicit rate) -- pass the same effective rate to both.
    ours = calculate_pmi_payment(450000, 0.8)
    theirs = LA.pmi_cost(450000, 0.008)
    assert ours == pytest.approx(theirs, abs=0.01)


# ---------------------------------------------------------------------------
# Balloon payment -- LA computes it as a closed-form remaining balance;
# cob_calculator computes it by actually running the segment schedule.
# ---------------------------------------------------------------------------


def test_balloon_payment_agrees_with_skill_reference():
    principal, rate_percent, amortization_months, balloon_month = 500000, 6.0, 360, 84
    summary = summarize_mortgage(
        MortgageInput(
            segments=[
                Segment(
                    start_date=date(2024, 1, 1),
                    annual_interest_rate_percent=rate_percent,
                    amortization_months_remaining=amortization_months,
                    term_months=balloon_month,
                    starting_balance=principal,
                    balloon=True,
                )
            ]
        )
    )
    ours = summary.balloon_payment_due.amount
    theirs = LA.balloon_payment(principal, rate_percent / 100, amortization_months, balloon_month)
    assert ours == pytest.approx(theirs, abs=1.0)


# ---------------------------------------------------------------------------
# Points breakeven, refinance breakeven & total savings.
# ---------------------------------------------------------------------------


def test_points_breakeven_agrees_with_skill_reference():
    ours = calculate_points_breakeven(
        PointsBreakevenInput(
            loan_amount=400000, points=1.0, rate_reduction_percent=0.25, original_rate_percent=6.5, term_months=360
        )
    )
    theirs = LA.points_breakeven(
        loan_amount=400000, points=1.0, rate_reduction=0.0025, term_months=360, original_rate=0.065
    )
    assert ours.breakeven_months == pytest.approx(theirs, rel=1e-2)


def test_refinance_breakeven_agrees_with_skill_reference():
    ours = calculate_refinance_breakeven(
        RefinanceBreakevenInput(closing_costs=6000, old_monthly_payment=1896.20, new_monthly_payment=1600.00)
    )
    theirs = LA.refinance_breakeven(closing_costs=6000, old_payment=1896.20, new_payment=1600.00)
    assert ours == pytest.approx(theirs, rel=1e-6)


def test_refinance_total_savings_agrees_with_skill_reference():
    ours = compare_refinance(
        RefinanceComparisonInput(
            old_loan=LoanInput(loan_amount=300000, annual_interest_rate_percent=6.5, term_years=300 / 12),
            new_loan=LoanInput(loan_amount=300000, annual_interest_rate_percent=5.5, term_years=300 / 12),
            closing_costs=6000,
        )
    )
    theirs = LA.refinance_total_savings(
        old_balance=300000,
        old_rate=0.065,
        old_remaining_months=300,
        new_rate=0.055,
        new_term_months=300,
        closing_costs=6000,
    )
    assert ours.old_monthly_payment == pytest.approx(theirs["old_payment"], abs=0.01)
    assert ours.new_monthly_payment == pytest.approx(theirs["new_payment"], abs=0.01)
    assert ours.breakeven_months == pytest.approx(theirs["breakeven_months"], rel=1e-2)
    # Note: ours.old_total_cost/new_total_cost use the FULL amortized loan totals
    # (via summarize_loan), while LA's are pmt*n undiscounted sums -- these are the
    # same formula (n * PMT [+ fees]) so they should still agree closely.
    assert ours.new_total_cost == pytest.approx(theirs["new_total_cost"], abs=5.0)


# ---------------------------------------------------------------------------
# ARM reset.
# ---------------------------------------------------------------------------


def test_arm_reset_agrees_with_skill_reference():
    ours = calculate_arm_reset_rate(
        ArmResetInput(
            previous_rate_percent=4.5,
            initial_rate_percent=4.5,
            index_rate_percent=5.0,
            margin_percent=2.75,
            lifetime_cap_percent=5.0,
            is_first_reset=True,
        )
    )
    theirs = LA.arm_payment_after_reset(
        remaining_balance=380000,
        index_rate=0.05,
        margin=0.0275,
        remaining_months=300,
        rate_cap=0.05,
        initial_rate=0.045,
    )
    assert ours.fully_indexed_rate_percent == pytest.approx(theirs["fully_indexed_rate"] * 100, abs=1e-4)
    assert ours.capped_rate_percent == pytest.approx(theirs["capped_rate"] * 100, abs=1e-4)

    our_payment = calculate_monthly_payment(380000, ours.capped_rate_percent, 300)
    assert our_payment == pytest.approx(theirs["new_payment"], abs=0.01)


# ---------------------------------------------------------------------------
# Extra payment savings -- termination-convention differences documented above;
# use a wider, explicitly-justified tolerance rather than exact equality.
# ---------------------------------------------------------------------------


def test_extra_payment_savings_agrees_with_skill_reference_within_documented_tolerance():
    ours = calculate_extra_payment_savings(
        ExtraPaymentSavingsInput(
            loan_amount=300000, annual_interest_rate_percent=6.5, term_months=360, extra_monthly_payment=200
        )
    )
    theirs = LA.extra_payment_savings(300000, 0.065, 360, 200)

    assert abs(ours.new_months - theirs["new_months"]) <= 1
    assert ours.interest_saved == pytest.approx(theirs["interest_saved"], abs=25.0)


def test_extra_payment_savings_matches_skill_md_worked_example():
    # docs/new-req and SKILL.md both cite this exact example -- pin it directly.
    ours = calculate_extra_payment_savings(
        ExtraPaymentSavingsInput(
            loan_amount=300000, annual_interest_rate_percent=6.5, term_months=360, extra_monthly_payment=200
        )
    )
    assert ours.new_months == pytest.approx(277, abs=1)
    assert ours.interest_saved == pytest.approx(103449.0, rel=0.02)
