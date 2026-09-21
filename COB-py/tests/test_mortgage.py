from datetime import date

import pytest

from cob_calculator.dates import add_months
from cob_calculator.mortgage import compute_mortgage_schedule, summarize_mortgage
from cob_calculator.types import LumpSumPayment, ManualPaymentOverride, MortgageInput, Segment


def test_renewal_carries_ending_balance_forward_and_numbers_payments_globally():
    segment1 = Segment(
        start_date=date(2015, 1, 1),
        annual_interest_rate_percent=5,
        amortization_months_remaining=300,
        term_months=60,
        starting_balance=200000,
    )
    segment2 = Segment(
        start_date=date(2020, 1, 1),
        annual_interest_rate_percent=4,
        amortization_months_remaining=240,
    )
    summary = summarize_mortgage(MortgageInput(segments=[segment1, segment2]))

    assert summary.segment_summaries[0].ending_balance == summary.segment_summaries[1].starting_balance
    assert summary.segment_summaries[0].ending_balance > 0

    row60 = summary.schedule[59]
    assert row60.remaining_balance > 0
    last_row = summary.schedule[-1]
    assert last_row.remaining_balance == 0
    assert summary.payoff_date == last_row.payment_date

    assert summary.schedule[59].payment_number == 60
    assert summary.schedule[60].payment_number == 61
    assert summary.schedule[59].segment_index == 0
    assert summary.schedule[60].segment_index == 1


def test_manual_row_override_propagates_and_still_reaches_zero():
    input = MortgageInput(
        segments=[
            Segment(
                start_date=date(2020, 1, 1),
                annual_interest_rate_percent=6,
                amortization_months_remaining=360,
                starting_balance=200000,
            )
        ],
        manual_overrides=[
            ManualPaymentOverride(payment_number=5, interest_portion=950, principal_portion=250)
        ],
    )
    summary = summarize_mortgage(input)
    overridden_row = summary.schedule[4]  # payment #5
    assert overridden_row.is_manual_override is True
    assert overridden_row.interest_portion == 950
    assert overridden_row.principal_portion == 250
    assert overridden_row.payment_amount == 1200

    next_row = summary.schedule[5]  # payment #6, computed normally
    r = 6 / 100 / 12
    assert next_row.interest_portion == pytest.approx(overridden_row.remaining_balance * r, abs=0.01)
    assert next_row.is_manual_override is False

    assert summary.schedule[-1].remaining_balance == 0


def test_payment_identity_holds_across_segments_and_overrides():
    segment1 = Segment(
        start_date=date(2018, 1, 1),
        annual_interest_rate_percent=4,
        amortization_months_remaining=300,
        term_months=24,
        starting_balance=150000,
    )
    segment2 = Segment(
        start_date=add_months(segment1.start_date, 24),
        annual_interest_rate_percent=5,
        amortization_months_remaining=276,
    )
    summary = summarize_mortgage(
        MortgageInput(
            segments=[segment1, segment2],
            manual_overrides=[ManualPaymentOverride(payment_number=10, remaining_balance=145000)],
        )
    )
    assert summary.total_of_payments == pytest.approx(
        summary.total_interest_paid + segment1.starting_balance, abs=0.01
    )


def test_lump_sum_at_renewal_boundary_curtails_next_segment():
    segment1 = Segment(
        start_date=date(2015, 1, 1),
        annual_interest_rate_percent=5,
        amortization_months_remaining=300,
        term_months=60,
        starting_balance=200000,
    )
    segment2_with_amortization = Segment(
        start_date=add_months(segment1.start_date, 60),
        annual_interest_rate_percent=4,
        amortization_months_remaining=240,
    )
    probe = summarize_mortgage(MortgageInput(segments=[segment1, segment2_with_amortization]))
    renewal_payment = probe.segment_summaries[1].monthly_payment
    segment2 = Segment(
        start_date=add_months(segment1.start_date, 60),
        annual_interest_rate_percent=4,
        payment_amount=renewal_payment,
    )

    control = summarize_mortgage(MortgageInput(segments=[segment1, segment2]))
    with_lump_sum = summarize_mortgage(
        MortgageInput(
            segments=[segment1, segment2],
            lump_sum_payments=[LumpSumPayment(after_payment_number=60, amount=20000)],
        )
    )

    assert with_lump_sum.segment_summaries[1].starting_balance == pytest.approx(
        control.segment_summaries[0].ending_balance - 20000, abs=0.01
    )
    assert with_lump_sum.number_of_payments < control.number_of_payments


def test_lump_sum_exceeding_balance_fully_pays_off_at_boundary():
    short_segment1 = Segment(
        start_date=date(2022, 1, 1),
        annual_interest_rate_percent=6,
        amortization_months_remaining=360,
        term_months=12,
        starting_balance=200000,
    )
    short_segment2 = Segment(
        start_date=add_months(short_segment1.start_date, 12),
        annual_interest_rate_percent=5,
        amortization_months_remaining=348,
    )

    result = summarize_mortgage(
        MortgageInput(
            segments=[short_segment1, short_segment2],
            lump_sum_payments=[LumpSumPayment(after_payment_number=12, amount=10_000_000)],
        )
    )

    assert result.number_of_payments == 12
    assert result.schedule[-1].remaining_balance == 0
    assert result.payoff_date == result.schedule[11].payment_date


def test_lump_sum_off_boundary_raises():
    segment1 = Segment(
        start_date=date(2015, 1, 1),
        annual_interest_rate_percent=5,
        amortization_months_remaining=300,
        term_months=60,
        starting_balance=200000,
    )
    segment2 = Segment(
        start_date=add_months(segment1.start_date, 60),
        annual_interest_rate_percent=4,
        amortization_months_remaining=240,
    )
    with pytest.raises(ValueError):
        summarize_mortgage(
            MortgageInput(
                segments=[segment1, segment2],
                lump_sum_payments=[LumpSumPayment(after_payment_number=45, amount=1000)],
            )
        )


def test_balloon_payment_reports_standard_remaining_balance():
    segment = Segment(
        start_date=date(2020, 1, 1),
        annual_interest_rate_percent=6,
        amortization_months_remaining=360,
        term_months=84,
        starting_balance=500000,
        balloon=True,
    )
    summary = summarize_mortgage(MortgageInput(segments=[segment]))
    assert summary.balloon_payment_due is not None
    assert summary.balloon_payment_due.amount == summary.segment_summaries[0].ending_balance
    assert summary.balloon_payment_due.amount > 0
    assert summary.balloon_payment_due.due_date == summary.schedule[-1].payment_date
