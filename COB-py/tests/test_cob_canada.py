"""Domain-QA test suite for docs/new-req/006-cost-of-borrowing-disclosure.md.

Invariants tested map 1:1 to the spec's "Invariants" section (6 items). The two
worked-example cross-checks cited in the spec (WOWA.ca trigger rate, hand-computed
semi-annual conversion) get their own dedicated tests, clearly labeled.
"""

from datetime import date

import pytest

from cob_calculator.cob_canada import (
    CobCanadaInput,
    calculate_cob_canada,
    compute_amortized_principal,
    compute_average_outstanding_balance,
    compute_cob_amount,
    compute_cob_rate_percent,
    compute_disbursal_amount,
    compute_payment_amount,
    compute_periodic_rate,
    compute_term_days,
    compute_trigger_rate_percent,
)
from cob_calculator.fees import Fee, FeeSchedule
from cob_calculator.payment import calculate_monthly_payment


def _new_mortgage_fixed(**overrides):
    defaults = dict(
        flow="newMortgage",
        product_type="mortgage",
        rate_type="fixed",
        loan_amount=400000,
        fees=FeeSchedule(),
        contract_rate_percent=5,
        payment_frequency="monthly",
        term_years=5,
        term_months=0,
        remaining_amortization_years=25,
        remaining_amortization_months=0,
        first_payment_date=date(2024, 2, 1),
        end_date=date(2029, 1, 1),
        disbursal_date=date(2024, 1, 1),
    )
    defaults.update(overrides)
    return CobCanadaInput(**defaults)


def _existing_mortgage_variable(**overrides):
    defaults = dict(
        flow="existingMortgage",
        product_type="mortgage",
        rate_type="variable",
        loan_amount=350000,
        fees=FeeSchedule(
            fees=[
                Fee(name="Mortgage default insurance", amount=10000, financed=True, included_in_cob=False),
                Fee(name="Appraisal fee", amount=400, financed=False, included_in_cob=True),
            ]
        ),
        contract_rate_percent=6.2,
        payment_frequency="monthly",
        term_years=3,
        term_months=0,
        remaining_amortization_years=22,
        remaining_amortization_months=6,
        first_payment_date=date(2025, 1, 1),
        end_date=date(2028, 1, 1),
        renewal_date=date(2024, 12, 15),
        accrued_interest=250.75,
    )
    defaults.update(overrides)
    return CobCanadaInput(**defaults)


# --- Equation 1 & 2: periodic rate ---------------------------------------------------


def test_compute_periodic_rate_fixed_mortgage_semi_annual_matches_hand_example():
    # Spec's own cited worked example: 5% nominal, monthly payments (n=12),
    # i_period = (1 + 0.05/2)^(2/12) - 1 = 0.41239%/period.
    r = compute_periodic_rate(5, "mortgage", "fixed", "monthly")
    assert r == pytest.approx(0.0041239154651442345, abs=1e-9)


def test_compute_periodic_rate_variable_mortgage_and_personal_loans_use_nominal_over_n():
    # Equation 2 applies identically to variable mortgages and personal loans of
    # either rate type -- all three combinations must match the plain rate/n formula.
    for product_type, rate_type in (("mortgage", "variable"), ("personalLoan", "fixed"), ("personalLoan", "variable")):
        r = compute_periodic_rate(6, product_type, rate_type, "monthly")
        assert r == pytest.approx(0.06 / 12, abs=1e-12)


def test_compute_periodic_rate_zero_percent_is_zero_for_both_conventions():
    assert compute_periodic_rate(0, "mortgage", "fixed", "monthly") == 0
    assert compute_periodic_rate(0, "mortgage", "variable", "monthly") == 0


# --- Equation 3: payment amount (reuses calculate_monthly_payment) ------------------


def test_compute_payment_amount_matches_direct_annuity_call():
    periodic_rate = compute_periodic_rate(5, "mortgage", "fixed", "monthly")
    expected = calculate_monthly_payment(400000, 5, 300, periodic_rate=periodic_rate)
    assert compute_payment_amount(400000, 5, periodic_rate, 300) == expected


def test_compute_payment_amount_zero_rate_is_plain_division():
    assert compute_payment_amount(120000, 0, 0, 120) == 1000.0


def test_compute_payment_amount_rejects_non_positive_principal():
    with pytest.raises(ValueError):
        compute_payment_amount(0, 5, 0.004, 300)


# --- Equation 4: trigger rate --------------------------------------------------------


def test_trigger_rate_wowa_worked_example():
    # WOWA.ca: $500,000 balance, $1,998.59 monthly payment -> 4.80% trigger rate.
    trigger = compute_trigger_rate_percent(1998.59, 12, 500000, "mortgage", "variable")
    assert trigger == pytest.approx(4.80, abs=0.01)


def test_trigger_rate_is_none_for_fixed_mortgages_and_personal_loans():
    assert compute_trigger_rate_percent(1998.59, 12, 500000, "mortgage", "fixed") is None
    assert compute_trigger_rate_percent(1998.59, 12, 500000, "personalLoan", "variable") is None
    assert compute_trigger_rate_percent(1998.59, 12, 500000, "personalLoan", "fixed") is None


def test_trigger_rate_rejects_non_positive_balance():
    with pytest.raises(ValueError):
        compute_trigger_rate_percent(1998.59, 12, 0, "mortgage", "variable")


# --- Equation 6/7: cob_amount / cob_rate_percent ------------------------------------


def test_compute_cob_amount_only_sums_included_in_cob_fees():
    fees = FeeSchedule(
        fees=[
            Fee(name="Mortgage default insurance", amount=10000, financed=True, included_in_cob=False),
            Fee(name="Appraisal fee", amount=400, financed=False, included_in_cob=True),
        ]
    )
    assert compute_cob_amount(1000, fees) == 1400


def test_compute_cob_amount_with_no_included_fees_equals_total_interest():
    assert compute_cob_amount(1000, FeeSchedule()) == 1000


def test_compute_cob_rate_percent_rejects_non_positive_average_balance():
    with pytest.raises(ValueError):
        compute_cob_rate_percent(1000, 5, 0, 0)


def test_compute_cob_rate_percent_no_extra_cost_case_is_close_to_note_rate():
    # No fees at all: cob_amount == total_interest only, so cob_rate_percent should be
    # in the same ballpark as the note rate (average-balance APR isn't identical to the
    # nominal rate, unlike spec 002's no-cost short-circuit, but it must not blow up).
    result = calculate_cob_canada(_new_mortgage_fixed())
    assert result.cob_rate_percent == pytest.approx(5, abs=0.5)


# --- Equation 8: term_days (display only) -------------------------------------------


def test_compute_term_days_matches_hand_computed_remainder():
    inp = _new_mortgage_fixed(
        disbursal_date=date(2024, 1, 1),
        term_years=5,
        term_months=0,
        end_date=date(2029, 1, 10),  # 9 days past the whole 5-year mark
    )
    assert compute_term_days(inp) == 9


def test_compute_term_days_zero_when_end_date_lands_exactly_on_term():
    inp = _new_mortgage_fixed(disbursal_date=date(2024, 1, 1), term_years=5, term_months=0, end_date=date(2029, 1, 1))
    assert compute_term_days(inp) == 0


# --- Financed fees / disbursal (equation 3's P, "Financed fees" section) -----------


def test_amortized_principal_layers_financed_fees_and_accrued_interest_on_top():
    inp = _existing_mortgage_variable()
    assert compute_amortized_principal(inp) == 350000 + 10000 + 250.75


def test_disbursal_amount_only_nets_cash_fees_never_financed_fees_or_accrued_interest():
    inp = _existing_mortgage_variable()
    assert compute_disbursal_amount(inp) == 350000 + 10000 - 400


def test_amortized_principal_rejects_nothing_but_reflects_zero_fees_correctly():
    inp = _new_mortgage_fixed(fees=FeeSchedule())
    assert compute_amortized_principal(inp) == 400000
    assert compute_disbursal_amount(inp) == 400000


# --- Fee/FeeSchedule extension (included_in_cob) -- strictly additive --------------


def test_fee_included_in_cob_defaults_to_none_not_true_or_false():
    fee = Fee(name="Origination", amount=500)
    assert fee.included_in_cob is None


def test_fee_schedule_total_fees_included_in_cob_ignores_unset_fees():
    # Fees with included_in_cob left None (every pre-existing spec-002/US fee) must
    # contribute 0 -- this aggregate is a no-op for every caller that predates this
    # module.
    schedule = FeeSchedule(fees=[Fee(name="Origination", amount=3000), Fee(name="VA funding fee", amount=6000, financed=True)])
    assert schedule.total_fees_included_in_cob == 0


def test_fee_schedule_total_fees_included_in_cob_sums_only_flagged_fees():
    schedule = FeeSchedule(
        fees=[
            Fee(name="Mortgage default insurance", amount=10000, financed=True, included_in_cob=False),
            Fee(name="Appraisal fee", amount=400, financed=False, included_in_cob=True),
            Fee(name="Discharge fee", amount=75, financed=False, included_in_cob=False),
        ]
    )
    assert schedule.total_fees_included_in_cob == 400


# --- Full calculate_cob_canada integration, per flow --------------------------------


def test_new_mortgage_fixed_happy_path():
    result = calculate_cob_canada(_new_mortgage_fixed())
    assert result.number_of_payments == 60  # 5-year term at monthly cadence
    assert result.trigger_rate_percent is None
    assert result.total_payment > result.total_interest > 0
    assert result.ending_balance > 0  # 5-year term inside a 25-year amortization


def test_existing_mortgage_variable_recomputes_payment_off_current_balance():
    result = calculate_cob_canada(_existing_mortgage_variable())
    assert result.trigger_rate_percent is not None
    assert result.amortized_principal == pytest.approx(360250.75)
    # cob_amount only picks up the COB-included appraisal fee, never the
    # COB-excluded (but financed) default-insurance premium.
    assert result.cob_amount == pytest.approx(result.total_interest + 400, abs=0.01)


def test_new_loan_personal_never_computes_trigger_rate():
    inp = CobCanadaInput(
        flow="newLoan",
        product_type="personalLoan",
        rate_type="variable",
        loan_amount=20000,
        fees=FeeSchedule(fees=[Fee(name="Admin fee", amount=150, financed=False, included_in_cob=True)]),
        contract_rate_percent=9.5,
        payment_frequency="monthly",
        term_years=5,
        term_months=0,
        remaining_amortization_years=5,
        remaining_amortization_months=0,
        first_payment_date=date(2024, 2, 1),
        end_date=date(2029, 1, 1),
        disbursal_date=date(2024, 1, 1),
    )
    result = calculate_cob_canada(inp)
    assert result.trigger_rate_percent is None
    assert result.number_of_payments == 60
    assert result.ending_balance == 0  # full 5-year term fully amortizes a 5-year loan


def test_payment_change_flow_recomputes_payment_never_takes_it_as_input():
    # "Payment change" flows never accept payment_amount as an input field at all --
    # CobCanadaInput has no such field, so this is a structural + behavioral check:
    # the recomputed payment must reflect the (possibly new) rate/balance, not a
    # borrower-fixed number.
    inp = _existing_mortgage_variable(flow="paymentChange", contract_rate_percent=7.1)
    result = calculate_cob_canada(inp)
    baseline = calculate_cob_canada(_existing_mortgage_variable())
    assert result.payment_amount != baseline.payment_amount


def test_variable_rate_payment_change_always_computes_trigger_rate():
    inp = _existing_mortgage_variable(flow="variableRatePaymentChange")
    result = calculate_cob_canada(inp)
    assert result.trigger_rate_percent is not None


# --- Validation (RangeError-equivalent = plain ValueError) --------------------------


def test_validate_rejects_new_flow_missing_disbursal_date():
    inp = _new_mortgage_fixed(disbursal_date=None)
    with pytest.raises(ValueError):
        calculate_cob_canada(inp)


def test_validate_rejects_existing_flow_missing_renewal_date():
    inp = _existing_mortgage_variable(renewal_date=None)
    with pytest.raises(ValueError):
        calculate_cob_canada(inp)


def test_validate_rejects_mismatched_flow_and_product_type():
    inp = _new_mortgage_fixed(flow="newLoan")  # newLoan requires personalLoan
    with pytest.raises(ValueError):
        calculate_cob_canada(inp)


def test_validate_rejects_variable_rate_payment_change_on_fixed_rate():
    inp = _existing_mortgage_variable(flow="variableRatePaymentChange", rate_type="fixed")
    with pytest.raises(ValueError):
        calculate_cob_canada(inp)


def test_validate_rejects_fee_with_unset_included_in_cob():
    inp = _new_mortgage_fixed(fees=FeeSchedule(fees=[Fee(name="Unspecified fee", amount=100)]))
    with pytest.raises(ValueError):
        calculate_cob_canada(inp)


def test_validate_rejects_non_positive_loan_amount():
    inp = _new_mortgage_fixed(loan_amount=0)
    with pytest.raises(ValueError):
        calculate_cob_canada(inp)


# --- Invariants (spec's "## Invariants" section, 6 items) ---------------------------


def test_invariant_1_fixed_rate_mortgage_trigger_rate_is_na():
    result = calculate_cob_canada(_new_mortgage_fixed())
    assert result.trigger_rate_percent is None


def test_invariant_2_reconciliation_principal_plus_interest_equals_total_payment():
    for inp in (_new_mortgage_fixed(), _existing_mortgage_variable()):
        result = calculate_cob_canada(inp)
        assert result.principal_payment + result.total_interest == pytest.approx(result.total_payment, abs=0.01)


def test_invariant_3_financed_fees_increase_interest_cash_fees_do_not():
    base = calculate_cob_canada(_new_mortgage_fixed(fees=FeeSchedule()))
    with_financed_fee = calculate_cob_canada(
        _new_mortgage_fixed(
            fees=FeeSchedule(fees=[Fee(name="Financed fee", amount=8000, financed=True, included_in_cob=False)])
        )
    )
    with_cash_fee = calculate_cob_canada(
        _new_mortgage_fixed(
            fees=FeeSchedule(fees=[Fee(name="Cash fee", amount=8000, financed=False, included_in_cob=False)])
        )
    )
    assert with_financed_fee.total_interest > base.total_interest
    assert with_cash_fee.total_interest == base.total_interest


def test_invariant_4_term_days_never_changes_monetary_outputs():
    # Vary only the disbursal_date (which feeds term_days and schedule row dates) --
    # every dollar-figure output must stay byte-identical, and term_days must change.
    inp_a = _new_mortgage_fixed(disbursal_date=date(2024, 1, 1), first_payment_date=date(2024, 2, 1))
    inp_b = _new_mortgage_fixed(disbursal_date=date(2024, 1, 15), first_payment_date=date(2024, 2, 1))
    result_a = calculate_cob_canada(inp_a)
    result_b = calculate_cob_canada(inp_b)
    assert result_a.term_days != result_b.term_days
    assert result_a.payment_amount == result_b.payment_amount
    assert result_a.total_interest == result_b.total_interest
    assert result_a.total_payment == result_b.total_payment
    assert result_a.cob_amount == result_b.cob_amount
    assert result_a.cob_rate_percent == result_b.cob_rate_percent


def test_invariant_5_semi_annual_vs_monthly_compounding_produce_different_payments():
    # NOTE: the spec's own invariant #5 prose claims semi-annual compounding is "more
    # expensive" than monthly at the same nominal rate -- this direction is WRONG (a
    # documented error in the spec's own text, already flagged by a prior QA pass on
    # the Excel implementation: less-frequent compounding at a fixed nominal rate
    # produces a LOWER effective annual rate, so semi-annual is actually cheaper). Per
    # the task's instruction, this test asserts only the actually-testable part --
    # that the two conventions produce DIFFERENT payments -- not a specific direction.
    fixed_result = calculate_cob_canada(_new_mortgage_fixed(rate_type="fixed"))
    variable_result = calculate_cob_canada(_new_mortgage_fixed(rate_type="variable"))
    assert fixed_result.payment_amount != variable_result.payment_amount


def test_invariant_6_trigger_rate_monotonically_decreases_as_balance_increases():
    # Holding payment_amount and payments_per_year fixed (using the pure equation-4
    # function directly, exactly as invariant #6 is stated -- calculate_cob_canada
    # always recomputes payment_amount off the same balance, so scaling loan_amount
    # through the full pipeline would leave trigger_rate_percent unchanged, per the
    # Bank of Canada's own origination-time-invariance observation cited in the spec).
    low_balance_trigger = compute_trigger_rate_percent(2000, 12, 400000, "mortgage", "variable")
    high_balance_trigger = compute_trigger_rate_percent(2000, 12, 500000, "mortgage", "variable")
    assert high_balance_trigger < low_balance_trigger


# --- compute_average_outstanding_balance --------------------------------------------


def test_compute_average_outstanding_balance_happy_path():
    from cob_calculator.cob_canada import ScheduleRow

    schedule = [
        ScheduleRow(1, date(2024, 2, 1), 1000, 400, 600, 9400),
        ScheduleRow(2, date(2024, 3, 1), 1000, 380, 620, 8780),
    ]
    # beginning balances: 10000 (opening), 9400 (row 1's ending) -> average 9700
    assert compute_average_outstanding_balance(10000, schedule) == 9700


def test_compute_average_outstanding_balance_single_row_equals_opening_balance():
    from cob_calculator.cob_canada import ScheduleRow

    schedule = [ScheduleRow(1, date(2024, 2, 1), 1000, 400, 600, 9400)]
    assert compute_average_outstanding_balance(10000, schedule) == 10000


def test_compute_average_outstanding_balance_rejects_empty_schedule():
    with pytest.raises(ValueError):
        compute_average_outstanding_balance(10000, [])
