"""Port of COB-ts's src/validate.ts. RangeError -> ValueError throughout."""

from __future__ import annotations

from typing import TYPE_CHECKING, Optional

if TYPE_CHECKING:
    from .arm import ArmResetInput
    from .import_overrides import BankStatementRow
    from .points import PointsBreakevenInput
    from .refinance import RefinanceBreakevenInput
    from .types import (
        ExtraPaymentSavingsInput,
        LoanInput,
        LumpSumPayment,
        ManualPaymentOverride,
        MortgageInput,
        PaymentFrequencyScheduleInput,
        PmiInput,
        RecurringCosts,
        Segment,
    )

VALID_PAYMENT_FREQUENCIES = ("monthly", "semiMonthly", "biweekly", "weekly")


def _is_int(value: float) -> bool:
    return float(value).is_integer()


def validate_payment_inputs(
    principal: float, annual_interest_rate_percent: float, number_of_payments: int
) -> None:
    if not (principal > 0):
        raise ValueError(f"principal must be > 0, got {principal}")
    if not (annual_interest_rate_percent >= 0):
        raise ValueError(
            f"annualInterestRatePercent must be >= 0, got {annual_interest_rate_percent}"
        )
    if not (number_of_payments > 0) or not _is_int(number_of_payments):
        raise ValueError(f"numberOfPayments must be a positive integer, got {number_of_payments}")


def validate_loan_input(input: "LoanInput") -> None:
    if not (input.loan_amount > 0):
        raise ValueError(f"loanAmount must be > 0, got {input.loan_amount}")
    if not (input.annual_interest_rate_percent >= 0):
        raise ValueError(
            f"annualInterestRatePercent must be >= 0, got {input.annual_interest_rate_percent}"
        )
    if not (input.term_years > 0):
        raise ValueError(f"termYears must be > 0, got {input.term_years}")


def validate_segment(segment: "Segment", index: int, total_segments: int) -> None:
    is_last = index == total_segments - 1

    if index == 0:
        if not (segment.starting_balance is not None and segment.starting_balance > 0):
            raise ValueError("segments[0].startingBalance is required and must be > 0")
    elif segment.starting_balance is not None:
        raise ValueError(
            f"segments[{index}].startingBalance is only valid on segments[0]; later "
            "segments inherit their starting balance from the previous segment's "
            "ending balance"
        )

    if not (segment.annual_interest_rate_percent >= 0):
        raise ValueError(
            f"segments[{index}].annualInterestRatePercent must be >= 0, got "
            f"{segment.annual_interest_rate_percent}"
        )

    has_payment = segment.payment_amount is not None
    has_amortization = segment.amortization_months_remaining is not None
    if not segment.interest_only and not has_payment and not has_amortization:
        raise ValueError(
            f"segments[{index}] must specify at least one of paymentAmount or "
            "amortizationMonthsRemaining, unless interestOnly is true"
        )
    if has_payment and not (segment.payment_amount > 0):
        raise ValueError(
            f"segments[{index}].paymentAmount must be > 0, got {segment.payment_amount}"
        )
    if has_amortization and not (segment.amortization_months_remaining > 0):
        raise ValueError(
            f"segments[{index}].amortizationMonthsRemaining must be > 0, got "
            f"{segment.amortization_months_remaining}"
        )

    if not is_last:
        if not (segment.term_months is not None and segment.term_months > 0):
            raise ValueError(
                f"segments[{index}].termMonths is required (and must be > 0) on "
                "every segment except the last"
            )
    elif segment.term_months is not None and not segment.balloon:
        raise ValueError(
            f"segments[{index}].termMonths must be omitted on the last segment so it "
            f"can run to full payoff, unless segments[{index}].balloon is true (a "
            "deliberate balloon payment due at termMonths) -- remove termMonths, set "
            "balloon: true, or add another segment after this one for the remaining "
            "balance"
        )

    if segment.balloon and segment.term_months is None:
        raise ValueError(f"segments[{index}].balloon requires termMonths to be set (the balloon due date)")
    if segment.balloon and not is_last:
        raise ValueError(f"segments[{index}].balloon is only valid on the last segment")

    if segment.interest_only and segment.term_months is None:
        raise ValueError(
            f"segments[{index}].interestOnly requires termMonths -- an interest-only "
            "segment never amortizes to zero on its own; set termMonths (optionally "
            "with balloon: true) or follow it with another segment"
        )


def validate_mortgage_input(input: "MortgageInput") -> None:
    if not input.segments or len(input.segments) == 0:
        raise ValueError("MortgageInput.segments must contain at least one segment")
    for index, segment in enumerate(input.segments):
        validate_segment(segment, index, len(input.segments))
    validate_lump_sum_payments(input.lump_sum_payments, input.segments)
    validate_recurring_costs(input.recurring_costs)
    if input.pmi:
        validate_pmi_input(input.pmi)


def validate_lump_sum_payments(
    lump_sum_payments: Optional[list["LumpSumPayment"]], segments: list["Segment"]
) -> None:
    if not lump_sum_payments:
        return

    boundary_payment_numbers: list[int] = []
    cumulative = 0
    for i in range(len(segments) - 1):
        cumulative += segments[i].term_months
        boundary_payment_numbers.append(cumulative)

    for lump_sum in lump_sum_payments:
        if not (lump_sum.amount > 0):
            raise ValueError(f"lumpSumPayments amount must be > 0, got {lump_sum.amount}")
        if lump_sum.after_payment_number not in boundary_payment_numbers:
            valid = ", ".join(str(n) for n in boundary_payment_numbers) or "(none; only one segment)"
            raise ValueError(
                f"lumpSumPayments.afterPaymentNumber ({lump_sum.after_payment_number}) "
                f"must be a segment boundary's last payment number -- valid boundaries "
                f"are: {valid}"
            )


def validate_extra_payment_savings_input(input: "ExtraPaymentSavingsInput") -> None:
    if not (input.loan_amount > 0):
        raise ValueError(f"loanAmount must be > 0, got {input.loan_amount}")
    if not (input.annual_interest_rate_percent >= 0):
        raise ValueError(
            f"annualInterestRatePercent must be >= 0, got {input.annual_interest_rate_percent}"
        )
    if not (input.term_months > 0) or not _is_int(input.term_months):
        raise ValueError(f"termMonths must be a positive integer, got {input.term_months}")
    if not (input.extra_monthly_payment >= 0):
        raise ValueError(
            f"extraMonthlyPayment must be >= 0, got {input.extra_monthly_payment}"
        )


def validate_payment_frequency_schedule_input(input: "PaymentFrequencyScheduleInput") -> None:
    if not (input.loan_amount > 0):
        raise ValueError(f"loanAmount must be > 0, got {input.loan_amount}")
    if not (input.annual_interest_rate_percent >= 0):
        raise ValueError(
            f"annualInterestRatePercent must be >= 0, got {input.annual_interest_rate_percent}"
        )
    if not (input.term_months > 0) or not _is_int(input.term_months):
        raise ValueError(f"termMonths must be a positive integer, got {input.term_months}")
    if input.frequency not in VALID_PAYMENT_FREQUENCIES:
        raise ValueError(
            f"frequency must be one of {', '.join(VALID_PAYMENT_FREQUENCIES)}, got {input.frequency}"
        )


def validate_ltv_inputs(loan_amount: float, property_value: float) -> None:
    if not (loan_amount >= 0):
        raise ValueError(f"loanAmount must be >= 0, got {loan_amount}")
    if not (property_value > 0):
        raise ValueError(f"propertyValue must be > 0, got {property_value}")


def validate_cltv_inputs(
    first_lien_balance: float, second_lien_balance: float, property_value: float
) -> None:
    if not (first_lien_balance >= 0):
        raise ValueError(f"firstLienBalance must be >= 0, got {first_lien_balance}")
    if not (second_lien_balance >= 0):
        raise ValueError(f"secondLienBalance must be >= 0, got {second_lien_balance}")
    if not (property_value > 0):
        raise ValueError(f"propertyValue must be > 0, got {property_value}")


def validate_dscr_inputs(net_operating_income: float, annual_debt_service: float) -> None:
    if not (annual_debt_service > 0):
        raise ValueError(f"annualDebtService must be > 0, got {annual_debt_service}")
    if net_operating_income is None:
        raise ValueError(f"netOperatingIncome must be a number, got {net_operating_income}")


def validate_points_breakeven_input(input: "PointsBreakevenInput") -> None:
    if not (input.loan_amount > 0):
        raise ValueError(f"loanAmount must be > 0, got {input.loan_amount}")
    if not (input.points >= 0):
        raise ValueError(f"points must be >= 0, got {input.points}")
    if not (input.rate_reduction_percent >= 0):
        raise ValueError(
            f"rateReductionPercent must be >= 0, got {input.rate_reduction_percent}"
        )
    if not (input.original_rate_percent >= 0):
        raise ValueError(f"originalRatePercent must be >= 0, got {input.original_rate_percent}")
    if not (input.term_months > 0) or not _is_int(input.term_months):
        raise ValueError(f"termMonths must be a positive integer, got {input.term_months}")
    if not (input.original_rate_percent - input.rate_reduction_percent >= 0):
        raise ValueError(
            f"rateReductionPercent ({input.rate_reduction_percent}) must not exceed "
            f"originalRatePercent ({input.original_rate_percent})"
        )


def validate_refinance_breakeven_inputs(input: "RefinanceBreakevenInput") -> None:
    if not (input.closing_costs >= 0):
        raise ValueError(f"closingCosts must be >= 0, got {input.closing_costs}")
    if not (input.old_monthly_payment > 0):
        raise ValueError(f"oldMonthlyPayment must be > 0, got {input.old_monthly_payment}")
    if not (input.new_monthly_payment > 0):
        raise ValueError(f"newMonthlyPayment must be > 0, got {input.new_monthly_payment}")


def validate_term_comparison_input(loans: list["LoanInput"]) -> None:
    if not loans or len(loans) < 2:
        raise ValueError(f"compareLoanTerms requires at least 2 loans, got {len(loans) if loans else 0}")


def validate_arm_reset_input(input: "ArmResetInput") -> None:
    if not (input.index_rate_percent >= 0):
        raise ValueError(f"indexRatePercent must be >= 0, got {input.index_rate_percent}")
    if not (input.margin_percent >= 0):
        raise ValueError(f"marginPercent must be >= 0, got {input.margin_percent}")
    if not (input.previous_rate_percent >= 0):
        raise ValueError(f"previousRatePercent must be >= 0, got {input.previous_rate_percent}")
    if not (input.initial_rate_percent >= 0):
        raise ValueError(f"initialRatePercent must be >= 0, got {input.initial_rate_percent}")
    for name, value in (
        ("initialCapPercent", input.initial_cap_percent),
        ("periodicCapPercent", input.periodic_cap_percent),
        ("lifetimeCapPercent", input.lifetime_cap_percent),
    ):
        if value is not None and not (value >= 0):
            raise ValueError(f"{name} must be >= 0, got {value}")


def validate_pmi_payment_inputs(loan_balance: float, annual_rate_percent: float) -> None:
    if not (loan_balance >= 0):
        raise ValueError(f"loanBalance must be >= 0, got {loan_balance}")
    if not (annual_rate_percent >= 0):
        raise ValueError(f"annualRatePercent must be >= 0, got {annual_rate_percent}")


def validate_pmi_input(pmi: "PmiInput") -> None:
    if not (pmi.annual_rate_percent >= 0):
        raise ValueError(f"pmi.annualRatePercent must be >= 0, got {pmi.annual_rate_percent}")
    if not (pmi.property_value > 0):
        raise ValueError(f"pmi.propertyValue must be > 0, got {pmi.property_value}")
    if pmi.drop_at_ltv_percent is not None and not (0 < pmi.drop_at_ltv_percent <= 100):
        raise ValueError(f"pmi.dropAtLtvPercent must be in (0, 100], got {pmi.drop_at_ltv_percent}")


def validate_recurring_costs(recurring_costs: Optional["RecurringCosts"]) -> None:
    if not recurring_costs:
        return
    for name in ("property_tax", "home_insurance", "hoa"):
        cost = getattr(recurring_costs, name)
        if not cost:
            continue
        if not (cost.annual_amount >= 0):
            raise ValueError(f"recurringCosts.{name}.annualAmount must be >= 0, got {cost.annual_amount}")
        if cost.annual_increase_percent is not None and not (cost.annual_increase_percent >= 0):
            raise ValueError(
                f"recurringCosts.{name}.annualIncreasePercent must be >= 0, got "
                f"{cost.annual_increase_percent}"
            )


def validate_bank_statement_row(row: "BankStatementRow", row_index: int) -> None:
    if not (row.payment_number > 0) or not _is_int(row.payment_number):
        raise ValueError(
            f"bank statement row {row_index}: paymentNumber must be a positive integer, "
            f"got {row.payment_number}"
        )
    has_any = (
        row.payment_amount is not None
        or row.interest_portion is not None
        or row.principal_portion is not None
        or row.remaining_balance is not None
    )
    if not has_any:
        raise ValueError(
            f"bank statement row {row_index}: must specify at least one of "
            "paymentAmount, interestPortion, principalPortion, or remainingBalance"
        )
    for name, value in (
        ("paymentAmount", row.payment_amount),
        ("interestPortion", row.interest_portion),
        ("principalPortion", row.principal_portion),
    ):
        if value is not None and value < 0:
            raise ValueError(f"bank statement row {row_index}: {name} must not be negative, got {value}")


def validate_overrides_in_range(
    overrides: Optional[list["ManualPaymentOverride"]], schedule_length: int
) -> None:
    if not overrides:
        return
    for override in overrides:
        if override.payment_number < 1 or override.payment_number > schedule_length:
            raise ValueError(
                f"manualOverrides paymentNumber {override.payment_number} is out of "
                f"range for a schedule of length {schedule_length}"
            )
