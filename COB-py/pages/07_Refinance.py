import streamlit as st

from app_common import money
from cob_calculator.refinance import RefinanceComparisonInput, compare_refinance
from cob_calculator.types import LoanInput

st.set_page_config(page_title="Refinance", page_icon="🔁", layout="wide")
st.title("Refinance Comparison")
st.caption("Breakeven and net savings on refinancing an existing loan into a new one.")

st.subheader("Current loan")
col1, col2, col3 = st.columns(3)
old_amount = col1.number_input("Remaining balance ($)", min_value=1.0, value=280000.0, step=1000.0, key="old_amount")
old_rate = col2.number_input("Current rate (%)", min_value=0.0, value=7.0, step=0.00000001, format="%.8f", key="old_rate")
old_term = col3.number_input("Remaining term (years)", min_value=1.0, value=28.0, step=1.0, key="old_term")

st.subheader("New loan")
col4, col5, col6 = st.columns(3)
new_amount = col4.number_input("New loan amount ($)", min_value=1.0, value=280000.0, step=1000.0, key="new_amount")
new_rate = col5.number_input("New rate (%)", min_value=0.0, value=6.0, step=0.00000001, format="%.8f", key="new_rate")
new_term = col6.number_input("New term (years)", min_value=1.0, value=30.0, step=1.0, key="new_term")

closing_costs = st.number_input("Closing costs ($)", min_value=0.0, value=6000.0, step=100.0)

try:
    result = compare_refinance(
        RefinanceComparisonInput(
            old_loan=LoanInput(loan_amount=old_amount, annual_interest_rate_percent=old_rate, term_years=old_term),
            new_loan=LoanInput(loan_amount=new_amount, annual_interest_rate_percent=new_rate, term_years=new_term),
            closing_costs=closing_costs,
        )
    )
except ValueError as e:
    st.error(str(e))
    st.stop()

c1, c2, c3 = st.columns(3)
c1.metric("Old monthly payment", money(result.old_monthly_payment))
c2.metric("New monthly payment", money(result.new_monthly_payment), delta=money(result.new_monthly_payment - result.old_monthly_payment))
c3.metric(
    "Breakeven",
    "never" if result.breakeven_months == float("inf") else f"{result.breakeven_months:.1f} months",
)

c4, c5 = st.columns(2)
c4.metric("Old total cost (remaining)", money(result.old_total_cost))
c5.metric("New total cost (incl. closing costs)", money(result.new_total_cost), delta=money(-result.net_savings))

if result.net_savings > 0:
    st.success(f"Refinancing saves {money(result.net_savings)} in total cost over the life of the new loan.")
else:
    st.warning(f"Refinancing costs {money(-result.net_savings)} more in total over the life of the new loan.")
