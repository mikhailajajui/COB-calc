from __future__ import annotations

from dataclasses import dataclass, replace

from .money import round2
from .pmi import calculate_pmi_payment
from .types import AmortizationEntry, CostBreakdownSummary, PmiInput, RecurringCosts
from .validate import validate_pmi_input, validate_recurring_costs


def _monthly_recurring_amount(
    annual_amount: float, annual_increase_percent: float | None, payment_number: int
) -> float:
    """annual_increase_percent compounds at each 12-payment anniversary; the
    compounding itself stays unrounded until the final round2 of the monthly
    portion."""
    year_index = (payment_number - 1) // 12
    escalated = annual_amount * (1 + (annual_increase_percent or 0) / 100) ** year_index
    return round2(escalated / 12)


@dataclass
class AppliedCosts:
    rows: list[AmortizationEntry]
    breakdown: CostBreakdownSummary


def apply_recurring_costs(
    schedule: list[AmortizationEntry],
    recurring_costs: RecurringCosts | None,
    pmi: PmiInput | None,
) -> AppliedCosts:
    validate_recurring_costs(recurring_costs)
    if pmi:
        validate_pmi_input(pmi)

    original_loan_amount = (
        schedule[0].remaining_balance + schedule[0].principal_portion if len(schedule) > 0 else 0
    )
    drop_at_ltv = (pmi.drop_at_ltv_percent if pmi and pmi.drop_at_ltv_percent is not None else 80) / 100

    total_tax_paid = 0.0
    total_insurance_paid = 0.0
    total_hoa_paid = 0.0
    total_pmi_paid = 0.0
    pmi_dropped_at_payment_number: int | None = None
    pmi_was_active = False

    rows: list[AmortizationEntry] = []
    for row in schedule:
        tax_portion = (
            _monthly_recurring_amount(
                recurring_costs.property_tax.annual_amount,
                recurring_costs.property_tax.annual_increase_percent,
                row.payment_number,
            )
            if recurring_costs and recurring_costs.property_tax
            else None
        )
        insurance_portion = (
            _monthly_recurring_amount(
                recurring_costs.home_insurance.annual_amount,
                recurring_costs.home_insurance.annual_increase_percent,
                row.payment_number,
            )
            if recurring_costs and recurring_costs.home_insurance
            else None
        )
        hoa_portion = (
            _monthly_recurring_amount(
                recurring_costs.hoa.annual_amount,
                recurring_costs.hoa.annual_increase_percent,
                row.payment_number,
            )
            if recurring_costs and recurring_costs.hoa
            else None
        )

        pmi_portion: float | None = None
        if pmi:
            current_ltv = row.remaining_balance / pmi.property_value
            if current_ltv > drop_at_ltv:
                pmi_portion = calculate_pmi_payment(original_loan_amount, pmi.annual_rate_percent)
                pmi_was_active = True
            else:
                pmi_portion = 0
                if pmi_was_active and pmi_dropped_at_payment_number is None:
                    pmi_dropped_at_payment_number = row.payment_number

        total_tax_paid = round2(total_tax_paid + (tax_portion or 0))
        total_insurance_paid = round2(total_insurance_paid + (insurance_portion or 0))
        total_hoa_paid = round2(total_hoa_paid + (hoa_portion or 0))
        total_pmi_paid = round2(total_pmi_paid + (pmi_portion or 0))

        rows.append(
            replace(
                row,
                tax_portion=tax_portion,
                insurance_portion=insurance_portion,
                hoa_portion=hoa_portion,
                pmi_portion=pmi_portion,
            )
        )

    total_of_payments = round2(sum(row.payment_amount for row in rows))
    total_cost_of_ownership = round2(
        total_of_payments + total_tax_paid + total_insurance_paid + total_hoa_paid + total_pmi_paid
    )

    return AppliedCosts(
        rows=rows,
        breakdown=CostBreakdownSummary(
            total_tax_paid=total_tax_paid,
            total_insurance_paid=total_insurance_paid,
            total_hoa_paid=total_hoa_paid,
            total_pmi_paid=total_pmi_paid,
            total_cost_of_ownership=total_cost_of_ownership,
            pmi_dropped_at_payment_number=pmi_dropped_at_payment_number,
        ),
    )
