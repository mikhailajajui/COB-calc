from datetime import date

import pytest

from cob_calculator.mortgage import summarize_mortgage
from cob_calculator.payment import calculate_monthly_payment
from cob_calculator.segment import compute_segment_schedule
from cob_calculator.types import MortgageInput, Segment


def no_overrides():
    return {}


class TestOpenEndedSegment:
    segment = Segment(
        start_date=date(2020, 1, 1),
        annual_interest_rate_percent=6,
        amortization_months_remaining=360,
        starting_balance=200000,
    )

    def test_runs_to_exact_payoff(self):
        result = compute_segment_schedule(self.segment, 0, 200000, 1, no_overrides())
        assert len(result.rows) == 360
        assert result.ending_balance == 0
        assert result.rows[-1].remaining_balance == 0

    def test_principal_sums_to_original_balance(self):
        result = compute_segment_schedule(self.segment, 0, 200000, 1, no_overrides())
        total_principal = round(sum(r.principal_portion for r in result.rows) * 100) / 100
        assert total_principal == 200000

    def test_first_row_interest_matches_balance_times_rate(self):
        result = compute_segment_schedule(self.segment, 0, 200000, 1, no_overrides())
        r = 6 / 100 / 12
        assert result.rows[0].interest_portion == round(200000 * r * 100) / 100

    def test_throws_when_payment_never_covers_interest(self):
        broken = Segment(
            start_date=date(2020, 1, 1),
            annual_interest_rate_percent=6,
            payment_amount=500,  # 500 < 200000 * 0.005 = 1000 of interest
            starting_balance=200000,
        )
        with pytest.raises(ValueError, match="never amortize"):
            compute_segment_schedule(broken, 0, 200000, 1, no_overrides())


class TestBoundedSegment:
    segment = Segment(
        start_date=date(2020, 1, 1),
        annual_interest_rate_percent=6,
        amortization_months_remaining=300,
        term_months=60,
        starting_balance=200000,
    )

    def test_stops_at_exactly_term_months_with_nonzero_balance(self):
        result = compute_segment_schedule(self.segment, 0, 200000, 1, no_overrides())
        assert len(result.rows) == 60
        assert result.ending_balance > 0

    def test_matches_closed_form_remaining_balance(self):
        result = compute_segment_schedule(self.segment, 0, 200000, 1, no_overrides())
        m = calculate_monthly_payment(200000, 6, 300)
        assert result.monthly_payment == m

        r = 6 / 100 / 12
        k = 60
        factor = (1 + r) ** k
        expected_balance = round((200000 * factor - m * ((factor - 1) / r)) * 100) / 100

        assert result.ending_balance == pytest.approx(expected_balance, abs=1)
        assert result.rows[-1].remaining_balance == result.ending_balance


def test_bounded_segment_overpaid_stops_exactly_at_zero():
    segment = Segment(
        start_date=date(2020, 1, 1),
        annual_interest_rate_percent=6,
        payment_amount=2200,
        starting_balance=20000,
        term_months=24,  # far more months than needed to pay off $20,000 at $2,200/mo
    )
    result = compute_segment_schedule(segment, 0, 20000, 1, no_overrides())

    assert len(result.rows) < 24
    assert result.ending_balance == 0
    assert result.rows[-1].remaining_balance == 0
    assert result.rows[-1].principal_portion <= 2200
    assert all(row.remaining_balance >= 0 for row in result.rows)
    assert all(row.interest_portion >= 0 for row in result.rows)


class TestInterestOnlySegment:
    segment = Segment(
        start_date=date(2020, 1, 1),
        annual_interest_rate_percent=6,
        term_months=12,
        starting_balance=200000,
        interest_only=True,
    )

    def test_keeps_principal_zero_and_balance_unchanged(self):
        result = compute_segment_schedule(self.segment, 0, 200000, 1, no_overrides())
        r = 6 / 100 / 12
        assert len(result.rows) == 12
        assert result.monthly_payment == round(200000 * r * 100) / 100
        assert all(row.principal_portion == 0 for row in result.rows)
        assert all(row.remaining_balance == 200000 for row in result.rows)
        assert result.ending_balance == 200000

    def test_renewal_segment_inherits_unchanged_starting_balance(self):
        renewal_segment = Segment(
            start_date=date(2021, 1, 1),
            annual_interest_rate_percent=6,
            amortization_months_remaining=348,
        )
        summary = summarize_mortgage(
            MortgageInput(segments=[self.segment, renewal_segment])
        )
        assert summary.segment_summaries[1].starting_balance == 200000

    def test_throws_when_interest_only_without_term_months(self):
        invalid = Segment(
            start_date=date(2020, 1, 1),
            annual_interest_rate_percent=6,
            starting_balance=200000,
            interest_only=True,
        )
        with pytest.raises(ValueError):
            summarize_mortgage(MortgageInput(segments=[invalid]))


def test_manual_payment_pays_down_faster_than_computed_default():
    default_segment = Segment(
        start_date=date(2020, 1, 1),
        annual_interest_rate_percent=6,
        amortization_months_remaining=300,
        term_months=12,
        starting_balance=200000,
    )
    higher_payment_segment = Segment(
        start_date=default_segment.start_date,
        annual_interest_rate_percent=default_segment.annual_interest_rate_percent,
        amortization_months_remaining=default_segment.amortization_months_remaining,
        term_months=default_segment.term_months,
        starting_balance=default_segment.starting_balance,
        payment_amount=2000,  # higher than the ~1288 the formula would compute
    )

    default_result = compute_segment_schedule(default_segment, 0, 200000, 1, no_overrides())
    result = compute_segment_schedule(higher_payment_segment, 0, 200000, 1, no_overrides())

    assert result.monthly_payment == 2000
    assert all(row.payment_amount == 2000 for row in result.rows)
    assert result.ending_balance < default_result.ending_balance
