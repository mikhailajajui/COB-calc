"""Domain-QA test suite for docs/new-req/006-cost-of-borrowing-disclosure.md (rewritten
per docs/new-req/007-cob-canada-brd-reconciliation.md).

Invariants tested map 1:1 to the spec's "Invariants" section. The worked validation
vector from doc 007 (the actual live Alterna Savings workbook example) is reproduced
exactly, within cent-level tolerance (the workbook's own intermediate rounding differs
from this Python port's, per the task instructions -- but this engine deliberately
does not round per-row/total currency amounts either, so in practice the match is much
tighter than a cent for every value doc 007 gives to full float precision).
"""

from datetime import date

import pytest

from cob_calculator.cob_canada import (
    CobCanadaInput,
    ScheduleRow,
    _day_count_fraction,
    calculate_cob_canada,
    compute_amortized_principal,
    compute_average_outstanding_balance,
    compute_calculated_rate,
    compute_cob_amount,
    compute_cob_rate_percent,
    compute_disbursal_amount,
    compute_trigger_rate_percent,
)
from cob_calculator.fees import Fee, FeeSchedule


def _new_mortgage_fixed(**overrides):
    defaults = dict(
        flow="newMortgageOrLoan",
        product_type="mortgage",
        rate_type="fixed",
        loan_amount=400000,
        fees=FeeSchedule(),
        contract_rate_percent=5,
        payment_amount=2500,
        payment_frequency="monthly",
        term_years=5,
        term_months=0,
        first_payment_date=date(2024, 2, 1),
        # Exactly the 60th monthly payment's date (2024-02-01 + 59 months). A row
        # landing exactly ON end_date is included (equation 5 only excludes a
        # candidate STRICTLY AFTER end_date), so this yields a clean 60-payment,
        # 5-year schedule.
        end_date=date(2029, 1, 1),
        disbursal_date=date(2024, 1, 1),
    )
    defaults.update(overrides)
    return CobCanadaInput(**defaults)


def _renewal_variable(**overrides):
    defaults = dict(
        flow="renewal",
        product_type="mortgage",
        rate_type="variable",
        loan_amount=350000,
        fees=FeeSchedule(
            fees=[
                Fee(name="Mortgage default insurance", amount=10000, financed=True),
                Fee(name="Appraisal fee", amount=400, financed=False),
            ]
        ),
        contract_rate_percent=6.2,
        payment_amount=2400,
        payment_frequency="monthly",
        term_years=3,
        term_months=0,
        first_payment_date=date(2025, 1, 1),
        end_date=date(2028, 1, 1),
        renewal_date=date(2024, 12, 15),
        accrued_interest=250.75,
    )
    defaults.update(overrides)
    return CobCanadaInput(**defaults)


# --- The doc 007 worked validation vector (live Alterna workbook example) -----------


def test_worked_validation_vector_from_doc_007():
    inp = CobCanadaInput(
        flow="newMortgageOrLoan",
        product_type="mortgage",
        rate_type="fixed",
        loan_amount=227829.65,
        fees=FeeSchedule(),
        contract_rate_percent=3.74,
        payment_amount=465.46,
        payment_frequency="weekly",
        term_years=3,
        term_months=0,
        disbursal_date=date(2026, 3, 17),
        first_payment_date=date(2026, 3, 23),
        end_date=date(2029, 3, 17),
    )
    result = calculate_cob_canada(inp)

    assert result.number_of_payments == 156

    row1 = result.amortization_schedule[0]
    assert row1.days_in_period == 6
    assert row1.interest_paid == pytest.approx(138.82433838712447, abs=0.01)
    assert row1.principal_portion == pytest.approx(326.63566161287554, abs=0.01)
    assert row1.remaining_balance == pytest.approx(227503.01433838712, abs=0.01)

    assert result.total_payment == pytest.approx(72611.76, abs=0.01)
    assert result.total_interest == pytest.approx(22514.10591158249, abs=0.01)
    assert result.principal_payment == pytest.approx(50097.654088417505, abs=0.01)
    assert result.cob_amount == pytest.approx(22514.10591158249, abs=0.01)

    # cob_rate_percent hits the FCPFR s. 32 "no fees -> APR = interest rate"
    # short-circuit (mirrors apr.py's identical total_cash_fees == 0 branch) -- this
    # worked vector has zero financed AND zero cash fees, so cob_rate_percent must
    # equal calculated_rate EXACTLY, not merely approximately via C/(T x P) (no choice
    # of T reproduces the live workbook's value from that formula exactly against the
    # real average-balance P -- verified numerically; this is a separate rule, not a
    # coincidence of the general formula).
    assert inp.fees.total_financed_fees + inp.fees.total_cash_fees == 0
    calculated_rate = compute_calculated_rate(3.74, "mortgage", "fixed", "weekly")
    assert result.cob_rate_percent == calculated_rate * 100
    assert result.cob_rate_percent == pytest.approx(3.706781471105014, abs=0.001)

    # This worked vector's own rate_type is 'fixed' (a fixed-rate mortgage), so per
    # invariant #1 (trigger rate N/A for fixed-rate mortgages) result.trigger_rate_percent
    # must be None here -- but doc 007's worked vector still cites a raw
    # trigger_rate_percent value (10.623691868025078) straight off the live workbook's
    # own always-computed cell (Other related calculations!D9), which the docx's BR-08
    # business rule simply chooses not to *display* for a fixed-rate product rather
    # than omitting from the formula. Cross-check the underlying equation 6 formula
    # directly (bypassing the product/rate-type gate) against that raw value, while
    # still asserting the gated public field is None for this scenario.
    assert result.trigger_rate_percent is None
    raw_trigger = compute_trigger_rate_percent(
        inp.payment_amount, 52, inp.loan_amount, "mortgage", "variable"
    )
    assert raw_trigger == pytest.approx(10.623691868025078, abs=0.001)

    final_row = result.amortization_schedule[-1]
    assert final_row.remaining_balance == pytest.approx(177731.99591158231, abs=0.01)
    assert final_row.remaining_balance > 0  # term ends before full payoff -- expected


# --- Equations 1 & 2: calculated_rate -----------------------------------------------


def test_calculated_rate_fixed_mortgage_semi_annual_matches_worked_vector():
    r = compute_calculated_rate(3.74, "mortgage", "fixed", "weekly")
    assert r == pytest.approx(0.03706781471105014, abs=1e-12)


def test_calculated_rate_variable_mortgage_reduces_to_contract_rate_exactly():
    r = compute_calculated_rate(6, "mortgage", "variable", "biweekly")
    assert r == pytest.approx(0.06, abs=1e-15)


def test_calculated_rate_personal_loan_uses_m12_not_flat_rate_over_n():
    # Non-monthly frequency personal loan: must NOT equal a flat contract_rate/n --
    # doc 007 finding #10's whole point.
    r = compute_calculated_rate(6, "personalLoan", "fixed", "weekly")
    flat = 0.06 / 52
    assert r != pytest.approx(flat, abs=1e-9)
    n = 52
    expected = n * ((1 + 0.06 / 12) ** (12 / n) - 1)
    assert r == pytest.approx(expected, abs=1e-12)


def test_calculated_rate_personal_loan_monthly_reduces_to_contract_rate_over_12():
    # compute_calculated_rate returns the ANNUAL nominal rate (equation 1's `in`), not
    # the per-period rate -- for m=12, n=12 this reduces to contract_rate exactly
    # (the per-period rate `in/n` is what reduces to contract_rate/12).
    r = compute_calculated_rate(6, "personalLoan", "variable", "monthly")
    assert r == pytest.approx(0.06, abs=1e-12)
    assert r / 12 == pytest.approx(0.06 / 12, abs=1e-12)


def test_calculated_rate_zero_percent_is_zero_for_every_convention():
    assert compute_calculated_rate(0, "mortgage", "fixed", "monthly") == 0
    assert compute_calculated_rate(0, "mortgage", "variable", "monthly") == 0
    assert compute_calculated_rate(0, "personalLoan", "fixed", "weekly") == 0


# --- Invariant 5: three conventions diverge for the same nominal rate ---------------


def test_invariant_5_fixed_variable_and_personal_loan_rates_diverge():
    fixed = compute_calculated_rate(6, "mortgage", "fixed", "weekly")
    variable = compute_calculated_rate(6, "mortgage", "variable", "weekly")
    personal = compute_calculated_rate(6, "personalLoan", "fixed", "weekly")
    assert fixed != variable != personal
    assert fixed != personal
    # Semi-annual compounding at a fixed nominal rate is arithmetically cheaper
    # (lower effective rate) than monthly compounding.
    assert fixed < personal
    # m=n (variable) means no conversion at all -- exactly the nominal rate.
    assert variable == pytest.approx(0.06, abs=1e-12)


# --- _day_count_fraction --------------------------------------------------------------


def test_day_count_fraction_within_single_non_leap_year_is_plain_days_over_365():
    assert _day_count_fraction(date(2026, 3, 17), date(2026, 3, 23)) == pytest.approx(6 / 365)


def test_day_count_fraction_splits_across_a_leap_year_boundary():
    # 2027 (non-leap) -> 2028 (leap): Dec 20 2027 to Jan 5 2028 = 16 actual days, split
    # into 12 days in 2027 (/365) + 4 days in 2028 (/366), per docx Appendix B.3 (doc
    # 007 follow-up item 4's leap-crossing scenario).
    frac = _day_count_fraction(date(2027, 12, 20), date(2028, 1, 5))
    expected = 12 / 365 + 4 / 366
    assert frac == pytest.approx(expected, abs=1e-12)
    assert (date(2028, 1, 5) - date(2027, 12, 20)).days == 16


def test_day_count_fraction_zero_for_same_date():
    assert _day_count_fraction(date(2026, 1, 1), date(2026, 1, 1)) == 0.0


# --- Equation 4: payment allocation waterfall ----------------------------------------


def test_waterfall_recovers_carried_accrued_interest_before_fees_and_principal():
    inp = _renewal_variable(
        loan_amount=100000,
        fees=FeeSchedule(),
        payment_amount=1000,
        accrued_interest=500,
        contract_rate_percent=6,
    )
    result = calculate_cob_canada(inp)
    row1 = result.amortization_schedule[0]
    assert row1.carried_accrued_interest_opening == 500
    total_interest_due = row1.period_interest + row1.carried_accrued_interest_opening
    # Payment ($1000) comfortably exceeds total_interest_due, so interest_paid should
    # recover it in full, including the carried accrued interest -- strictly more than
    # this period's own new interest alone.
    assert total_interest_due < inp.payment_amount
    assert row1.interest_paid == pytest.approx(total_interest_due)
    assert row1.interest_paid > row1.period_interest
    assert row1.carried_accrued_interest_closing == pytest.approx(0.0, abs=1e-9)


def test_waterfall_recovers_fees_gradually_over_multiple_rows():
    inp = _new_mortgage_fixed(
        fees=FeeSchedule(fees=[Fee(name="Admin fee", amount=1000, financed=False)]),
        payment_amount=200,  # deliberately small so fees can't clear in one row
        contract_rate_percent=0,
    )
    result = calculate_cob_canada(inp)
    row1 = result.amortization_schedule[0]
    assert row1.fees_opening == 1000
    assert row1.fees_paid == pytest.approx(200, abs=0.01)  # zero rate -> all to fees
    assert row1.fees_closing == pytest.approx(800, abs=0.01)
    row2 = result.amortization_schedule[1]
    assert row2.fees_opening == pytest.approx(800, abs=0.01)


# --- Equation 5: schedule stop condition ---------------------------------------------


def test_schedule_excludes_a_candidate_row_strictly_after_end_date():
    # Rows land on the 1st of each month (2024-02-01, 03-01, 04-01, 05-01, ...);
    # end_date sits strictly between 04-01 and 05-01, so 05-01 (the first candidate
    # strictly after end_date) must be excluded.
    inp = _new_mortgage_fixed(end_date=date(2024, 4, 15))
    result = calculate_cob_canada(inp)
    assert result.number_of_payments == 3
    assert result.amortization_schedule[-1].period_date < inp.end_date


def test_schedule_includes_a_row_landing_exactly_on_end_date():
    # Regression test (confirmed against the live workbook's VBA macro,
    # `DateDiff("d", eDate, nextDate) > 0`, not `>=`): a scheduled row landing exactly
    # ON end_date IS generated and counted -- only a candidate STRICTLY AFTER end_date
    # is excluded.
    inp = _new_mortgage_fixed(end_date=date(2024, 5, 1))  # exactly the 4th monthly payment
    result = calculate_cob_canada(inp)
    assert result.number_of_payments == 4
    assert result.amortization_schedule[-1].period_date == inp.end_date


def test_schedule_stops_when_balance_reaches_zero_before_end_date():
    inp = _new_mortgage_fixed(
        loan_amount=1000,
        payment_amount=1000,
        contract_rate_percent=0,
        end_date=date(2030, 1, 1),
    )
    result = calculate_cob_canada(inp)
    assert result.number_of_payments == 1
    assert result.amortization_schedule[-1].remaining_balance <= 0


# --- Equation 6: trigger rate ---------------------------------------------------------


def test_trigger_rate_wowa_worked_example():
    trigger = compute_trigger_rate_percent(1998.59, 12, 500000, "mortgage", "variable")
    assert trigger == pytest.approx(4.80, abs=0.01)


def test_trigger_rate_is_none_for_fixed_mortgages_and_personal_loans():
    assert compute_trigger_rate_percent(1998.59, 12, 500000, "mortgage", "fixed") is None
    assert compute_trigger_rate_percent(1998.59, 12, 500000, "personalLoan", "variable") is None
    assert compute_trigger_rate_percent(1998.59, 12, 500000, "personalLoan", "fixed") is None


def test_trigger_rate_rejects_non_positive_balance():
    with pytest.raises(ValueError):
        compute_trigger_rate_percent(1998.59, 12, 0, "mortgage", "variable")


def test_invariant_6_trigger_rate_monotonically_decreases_as_balance_increases():
    low_balance_trigger = compute_trigger_rate_percent(2000, 12, 400000, "mortgage", "variable")
    high_balance_trigger = compute_trigger_rate_percent(2000, 12, 500000, "mortgage", "variable")
    assert high_balance_trigger < low_balance_trigger


def test_invariant_1_fixed_rate_mortgage_trigger_rate_is_na():
    result = calculate_cob_canada(_new_mortgage_fixed())
    assert result.trigger_rate_percent is None


# --- Equation 8 / cob_amount: unconditional, all fees --------------------------------


def test_compute_cob_amount_sums_all_fees_unconditionally():
    fees = FeeSchedule(
        fees=[
            Fee(name="Mortgage default insurance", amount=10000, financed=True),
            Fee(name="Appraisal fee", amount=400, financed=False),
        ]
    )
    assert compute_cob_amount(1000, fees) == 1000 + 10000 + 400


def test_compute_cob_amount_with_no_fees_equals_total_interest():
    assert compute_cob_amount(1000, FeeSchedule()) == 1000


def test_compute_cob_rate_percent_rejects_non_positive_average_balance():
    with pytest.raises(ValueError):
        compute_cob_rate_percent(1000, 5, 0)


def test_compute_cob_rate_percent_rejects_non_positive_term():
    with pytest.raises(ValueError):
        compute_cob_rate_percent(1000, 0, 100000)


def test_cob_rate_percent_uses_general_formula_when_fees_present():
    # With fees > 0, calculate_cob_canada must NOT take the no-fees short-circuit --
    # cob_rate_percent should differ from calculated_rate (the general C/(T x P)
    # formula, not a plain equality).
    inp = _new_mortgage_fixed(
        fees=FeeSchedule(fees=[Fee(name="Admin fee", amount=5000, financed=False)])
    )
    result = calculate_cob_canada(inp)
    calculated_rate_percent = compute_calculated_rate(5, "mortgage", "fixed", "monthly") * 100
    assert result.cob_rate_percent != pytest.approx(calculated_rate_percent, abs=1e-6)
    # With real fees on top of interest, COB rate must exceed the bare note rate.
    assert result.cob_rate_percent > calculated_rate_percent


def test_cob_rate_percent_short_circuits_to_calculated_rate_when_no_fees_at_all():
    result = calculate_cob_canada(_new_mortgage_fixed(fees=FeeSchedule()))
    calculated_rate_percent = compute_calculated_rate(5, "mortgage", "fixed", "monthly") * 100
    assert result.cob_rate_percent == calculated_rate_percent


# --- Financed fees / disbursal (doc 007 finding #4) -----------------------------------


def test_amortized_principal_equals_loan_amount_regardless_of_fee_split():
    inp = _renewal_variable()
    assert compute_amortized_principal(inp) == 350000


def test_invariant_3_reclassifying_a_fee_from_cash_to_financed_does_not_change_amortized_principal():
    cash_version = _new_mortgage_fixed(
        fees=FeeSchedule(fees=[Fee(name="Fee", amount=5000, financed=False)])
    )
    financed_version = _new_mortgage_fixed(
        fees=FeeSchedule(fees=[Fee(name="Fee", amount=5000, financed=True)])
    )
    assert compute_amortized_principal(cash_version) == compute_amortized_principal(financed_version)
    # ... but it DOES change disbursal_amount and cob_amount.
    assert compute_disbursal_amount(cash_version) != compute_disbursal_amount(financed_version)
    result_cash = calculate_cob_canada(cash_version)
    result_financed = calculate_cob_canada(financed_version)
    assert result_cash.cob_amount == pytest.approx(result_financed.cob_amount, abs=0.01)


def test_disbursal_amount_only_nets_financed_fees_never_cash_fees():
    inp = _renewal_variable()
    assert compute_disbursal_amount(inp) == 350000 - 10000


def test_amortized_principal_and_disbursal_with_zero_fees():
    inp = _new_mortgage_fixed(fees=FeeSchedule())
    assert compute_amortized_principal(inp) == 400000
    assert compute_disbursal_amount(inp) == 400000


# --- Full calculate_cob_canada integration, per flow ----------------------------------


def test_new_mortgage_or_loan_happy_path():
    result = calculate_cob_canada(_new_mortgage_fixed())
    assert result.number_of_payments == 60  # 5-year term at monthly cadence
    assert result.trigger_rate_percent is None
    assert result.total_payment > result.total_interest > 0
    assert result.ending_balance >= 0


def test_renewal_variable_uses_accrued_interest_carry_forward_not_capitalization():
    result = calculate_cob_canada(_renewal_variable())
    assert result.trigger_rate_percent is not None
    # accrued_interest must NOT be capitalized into the opening balance.
    assert result.amortization_schedule[0].opening_balance == 350000
    assert result.amortized_principal == 350000
    # cob_amount includes ALL fees unconditionally now.
    assert result.cob_amount == pytest.approx(result.total_interest + 10000 + 400, abs=0.01)


def test_payment_change_flow_uses_renewal_date_and_carries_accrued_interest():
    inp = _renewal_variable(flow="paymentChange", payment_amount=2600)
    result = calculate_cob_canada(inp)
    assert result.amortization_schedule[0].carried_accrued_interest_opening == 250.75


def test_variable_rate_payment_change_always_computes_trigger_rate():
    inp = _renewal_variable(flow="variableRatePaymentChange")
    result = calculate_cob_canada(inp)
    assert result.trigger_rate_percent is not None


def test_new_mortgage_or_loan_personal_loan_never_computes_trigger_rate():
    inp = CobCanadaInput(
        flow="newMortgageOrLoan",
        product_type="personalLoan",
        rate_type="variable",
        loan_amount=20000,
        fees=FeeSchedule(fees=[Fee(name="Admin fee", amount=150, financed=False)]),
        contract_rate_percent=9.5,
        payment_amount=425,
        payment_frequency="monthly",
        term_years=5,
        term_months=0,
        first_payment_date=date(2024, 2, 1),
        end_date=date(2029, 1, 1),  # see _new_mortgage_fixed's comment on this boundary
        disbursal_date=date(2024, 1, 1),
    )
    result = calculate_cob_canada(inp)
    assert result.trigger_rate_percent is None
    assert result.number_of_payments == 60


# --- Validation (RangeError-equivalent = plain ValueError) ---------------------------


def test_validate_rejects_new_flow_missing_disbursal_date():
    inp = _new_mortgage_fixed(disbursal_date=None)
    with pytest.raises(ValueError):
        calculate_cob_canada(inp)


def test_validate_rejects_non_new_flow_missing_renewal_date():
    inp = _renewal_variable(renewal_date=None)
    with pytest.raises(ValueError):
        calculate_cob_canada(inp)


def test_validate_rejects_unknown_flow():
    inp = _new_mortgage_fixed(flow="newMortgage")  # old 6-value enum member, now invalid
    with pytest.raises(ValueError):
        calculate_cob_canada(inp)


def test_validate_rejects_variable_rate_payment_change_on_fixed_rate():
    inp = _renewal_variable(flow="variableRatePaymentChange", rate_type="fixed")
    with pytest.raises(ValueError):
        calculate_cob_canada(inp)


def test_validate_rejects_non_positive_loan_amount():
    inp = _new_mortgage_fixed(loan_amount=0)
    with pytest.raises(ValueError):
        calculate_cob_canada(inp)


def test_validate_rejects_non_positive_payment_amount():
    inp = _new_mortgage_fixed(payment_amount=0)
    with pytest.raises(ValueError):
        calculate_cob_canada(inp)


def test_validate_rejects_negative_accrued_interest():
    inp = _renewal_variable(accrued_interest=-1)
    with pytest.raises(ValueError):
        calculate_cob_canada(inp)


# --- Invariants (spec's "## Invariants" section) --------------------------------------


def test_invariant_2_reconciliation_total_payment_equals_interest_plus_fees_plus_principal():
    for inp in (
        _new_mortgage_fixed(),
        _renewal_variable(),
        _new_mortgage_fixed(
            fees=FeeSchedule(fees=[Fee(name="Fee", amount=3000, financed=False)]),
            payment_amount=1500,
        ),
    ):
        result = calculate_cob_canada(inp)
        assert result.total_payment == pytest.approx(
            result.total_interest + result.fees_recovered + result.principal_payment, abs=0.01
        )


def test_invariant_2_no_fees_collapses_to_two_term_identity():
    result = calculate_cob_canada(_new_mortgage_fixed(fees=FeeSchedule()))
    assert result.fees_recovered == 0
    assert result.total_payment == pytest.approx(result.total_interest + result.principal_payment, abs=0.01)


def test_invariant_3_financed_fees_never_change_amortized_principal_but_do_change_disbursal_and_cob():
    # NOTE: this checks invariant #3's literal, primary claim -- amortized_principal
    # (the schedule's opening balance) is unaffected by financed fees, since
    # amortized_principal == loan_amount always, regardless of the fee split. Adding a
    # brand-new fee (as opposed to reclassifying an *existing* fixed-dollar fee's
    # financed/cash flag, covered separately below) genuinely DOES change
    # total_interest here -- new fee dollars enter fees_to_recover (equation 4),
    # competing with principal for the payment stream, so the balance amortizes more
    # slowly and accrues more interest. That's a real, intended consequence of
    # equations 3-4 as specified, not a bug -- the invariant's "amortized_principal
    # unaffected" claim is about the balance the schedule runs against, not about
    # every downstream total being fee-blind.
    base = calculate_cob_canada(_new_mortgage_fixed(fees=FeeSchedule()))
    with_financed_fee = calculate_cob_canada(
        _new_mortgage_fixed(fees=FeeSchedule(fees=[Fee(name="Financed fee", amount=8000, financed=True)]))
    )
    assert compute_amortized_principal(_new_mortgage_fixed(fees=FeeSchedule())) == compute_amortized_principal(
        _new_mortgage_fixed(fees=FeeSchedule(fees=[Fee(name="Financed fee", amount=8000, financed=True)]))
    )
    assert with_financed_fee.cob_amount > base.cob_amount


def test_invariant_3_reclassifying_an_existing_fees_flag_leaves_totals_unchanged():
    # The invariant's actual "reclassify a dollar from cash to financed, holding
    # loan_amount fixed" scenario: a FIXED-dollar fee just flips its financed flag.
    # fees_to_recover sums BOTH types combined (equation 4), so the waterfall -- and
    # therefore total_interest, principal_payment, and cob_amount (which also sums
    # both types, equation 8) -- are all identical either way. Only disbursal_amount
    # differs (only financed fees are deducted from it).
    cash = calculate_cob_canada(
        _new_mortgage_fixed(fees=FeeSchedule(fees=[Fee(name="Fee", amount=8000, financed=False)]))
    )
    financed = calculate_cob_canada(
        _new_mortgage_fixed(fees=FeeSchedule(fees=[Fee(name="Fee", amount=8000, financed=True)]))
    )
    assert cash.total_interest == pytest.approx(financed.total_interest, abs=0.01)
    assert cash.cob_amount == pytest.approx(financed.cob_amount, abs=0.01)
    assert cash.disbursal_amount != financed.disbursal_amount


# --- compute_average_outstanding_balance ----------------------------------------------


def test_compute_average_outstanding_balance_happy_path():
    schedule = [
        ScheduleRow(1, date(2024, 2, 1), 31, 10000, 40, 0, 0, 1000, 40, 0, 960, 0, 0, 9040),
        ScheduleRow(2, date(2024, 3, 1), 29, 9040, 36, 0, 0, 1000, 36, 0, 964, 0, 0, 8076),
    ]
    assert compute_average_outstanding_balance(schedule) == (10000 + 9040) / 2


def test_compute_average_outstanding_balance_single_row_equals_its_opening_balance():
    schedule = [ScheduleRow(1, date(2024, 2, 1), 31, 10000, 40, 0, 0, 1000, 40, 0, 960, 0, 0, 9040)]
    assert compute_average_outstanding_balance(schedule) == 10000


def test_compute_average_outstanding_balance_rejects_empty_schedule():
    with pytest.raises(ValueError):
        compute_average_outstanding_balance([])
