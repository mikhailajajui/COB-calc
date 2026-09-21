from datetime import date

import pandas as pd
import streamlit as st

from app_common import money, months_as_years_text
from cob_calculator.extra_payment import calculate_extra_payment_savings
from cob_calculator.types import ExtraPaymentSavingsInput

st.set_page_config(page_title="Extra Payments", page_icon="💸", layout="wide")
st.title("Extra Monthly Payment Savings")
st.caption("How much time and interest an extra recurring principal payment saves, vs. the baseline loan.")

col1, col2 = st.columns(2)
with col1:
    loan_amount = st.number_input("Loan amount ($)", min_value=1.0, value=300000.0, step=1000.0)
    rate = st.number_input("Annual interest rate (%)", min_value=0.0, value=6.5, step=0.00000001, format="%.8f")
with col2:
    term_months = st.number_input("Term (months)", min_value=1, value=360, step=1)
    extra = st.number_input("Extra monthly payment ($)", min_value=0.0, value=200.0, step=25.0)
start = st.date_input("Start date", value=date.today())

try:
    result = calculate_extra_payment_savings(
        ExtraPaymentSavingsInput(
            loan_amount=loan_amount,
            annual_interest_rate_percent=rate,
            term_months=int(term_months),
            extra_monthly_payment=extra,
            start_date=start,
        )
    )
except ValueError as e:
    st.error(str(e))
    st.stop()

c1, c2, c3 = st.columns(3)
c1.metric("Original payoff", months_as_years_text(result.original_months))
c2.metric("New payoff", months_as_years_text(result.new_months), delta=f"-{months_as_years_text(result.months_saved)}")
c3.metric("Interest saved", money(result.interest_saved))

st.subheader("Detail")
detail_df = pd.DataFrame(
    {
        "Baseline": [months_as_years_text(result.original_months), money(result.original_total_interest)],
        f"+{money(extra)}/mo": [months_as_years_text(result.new_months), money(result.new_total_interest)],
    },
    index=["Term", "Total interest"],
)
st.table(detail_df)
