from datetime import date

import streamlit as st

from app_common import balance_chart, download_schedule_button, money, schedule_to_dataframe
from cob_calculator.money import js_round
from cob_calculator.mortgage import summarize_mortgage
from cob_calculator.types import MortgageInput, PmiInput, RecurringCost, RecurringCosts, Segment

st.set_page_config(page_title="PMI & Recurring Costs", page_icon="🧾", layout="wide")
st.title("PMI & Recurring Costs")
st.caption(
    "A single fixed-rate loan with property tax, home insurance, HOA, and PMI "
    "(with auto-drop at a chosen LTV) layered on top of principal & interest."
)

col1, col2 = st.columns(2)
with col1:
    loan_amount = st.number_input("Loan amount ($)", min_value=1.0, value=380000.0, step=1000.0)
    rate = st.number_input("Annual interest rate (%)", min_value=0.0, value=6.5, step=0.00000001, format="%.8f")
with col2:
    term_years = st.number_input("Term (years)", min_value=1.0, value=30.0, step=1.0)
    start = st.date_input("Start date", value=date.today())

use_pmi = st.checkbox("Include PMI", value=True)
pmi_input = None
if use_pmi:
    p1, p2, p3 = st.columns(3)
    pmi_rate = p1.number_input("PMI annual rate (%)", min_value=0.0, value=0.55, step=0.05)
    property_value = p2.number_input("Property value ($)", min_value=0.01, value=400000.0, step=1000.0)
    drop_ltv = p3.number_input("Drop PMI at LTV (%)", min_value=0.01, max_value=100.0, value=80.0, step=1.0)
    pmi_input = PmiInput(annual_rate_percent=pmi_rate, property_value=property_value, drop_at_ltv_percent=drop_ltv)

st.markdown("**Recurring costs**")
costs_kwargs = {}
for label, key, default in [("Property tax", "tax", 4800.0), ("Home insurance", "insurance", 1400.0), ("HOA", "hoa", 0.0)]:
    use_cost = st.checkbox(f"Include {label}", value=default > 0, key=f"use_{key}")
    if use_cost:
        c1, c2 = st.columns(2)
        annual_amount = c1.number_input(f"{label} annual amount ($)", min_value=0.0, value=default, step=100.0, key=f"{key}_amt")
        annual_increase = c2.number_input(f"{label} annual increase (%)", min_value=0.0, value=0.0, step=0.5, key=f"{key}_inc")
        costs_kwargs[key] = RecurringCost(annual_amount=annual_amount, annual_increase_percent=annual_increase)

recurring_costs = (
    RecurringCosts(property_tax=costs_kwargs.get("tax"), home_insurance=costs_kwargs.get("insurance"), hoa=costs_kwargs.get("hoa"))
    if costs_kwargs
    else None
)

try:
    summary = summarize_mortgage(
        MortgageInput(
            segments=[
                Segment(
                    start_date=start,
                    annual_interest_rate_percent=rate,
                    amortization_months_remaining=js_round(term_years * 12),
                    starting_balance=loan_amount,
                )
            ],
            recurring_costs=recurring_costs,
            pmi=pmi_input,
        )
    )
except ValueError as e:
    st.error(str(e))
    st.stop()

st.subheader(f"P&I monthly payment: {money(summary.segment_summaries[0].monthly_payment)}")

if summary.cost_breakdown:
    cb = summary.cost_breakdown
    c1, c2, c3, c4, c5 = st.columns(5)
    c1.metric("Total tax", money(cb.total_tax_paid))
    c2.metric("Total insurance", money(cb.total_insurance_paid))
    c3.metric("Total HOA", money(cb.total_hoa_paid))
    c4.metric("Total PMI", money(cb.total_pmi_paid))
    c5.metric("Total cost of ownership", money(cb.total_cost_of_ownership))
    if cb.pmi_dropped_at_payment_number:
        st.success(f"PMI drops off at payment #{cb.pmi_dropped_at_payment_number}.")
    elif use_pmi:
        st.info("PMI never drops within this loan's term at the given property value / drop LTV.")
else:
    st.info("Enable PMI or a recurring cost above to see a cost breakdown.")

df = schedule_to_dataframe(summary.schedule)
balance_chart(df)

st.subheader("Full payment schedule (P&I + costs)")
st.dataframe(df, width='stretch', hide_index=True)
download_schedule_button(df, "pmi_costs_schedule.csv", key="pmi_costs_download")
