from datetime import date

import pandas as pd
import streamlit as st

from app_common import (
    balance_chart,
    download_schedule_button,
    interest_vs_principal_chart,
    money,
    schedule_to_dataframe,
)
from cob_calculator.loan import from_home_price, summarize_loan
from cob_calculator.reporting import summarize_report_window
from cob_calculator.types import HomePriceLoanInput, LoanInput

st.set_page_config(page_title="Loan Calculator", page_icon="🏠", layout="wide")
st.title("Loan Calculator")
st.caption("A single fixed-rate loan from origination to payoff -- no renewals or rate changes.")

input_mode = st.radio("Loan amount from", ["Loan amount directly", "Home price - down payment"], horizontal=True)

col1, col2 = st.columns(2)
with col1:
    if input_mode == "Loan amount directly":
        loan_amount = st.number_input("Loan amount ($)", min_value=1.0, value=300000.0, step=1000.0)
    else:
        home_price = st.number_input("Home price ($)", min_value=1.0, value=400000.0, step=1000.0)
        down_payment = st.number_input("Down payment ($)", min_value=0.0, value=80000.0, step=1000.0)
    rate = st.number_input("Annual interest rate (%)", min_value=0.0, value=6.5, step=0.00000001, format="%.8f")
with col2:
    term_years = st.number_input("Term (years)", min_value=1.0, value=30.0, step=1.0)
    start = st.date_input("Start date", value=date.today())

if input_mode == "Loan amount directly":
    loan_input = LoanInput(
        loan_amount=loan_amount, annual_interest_rate_percent=rate, term_years=term_years, start_date=start
    )
else:
    try:
        loan_input = from_home_price(
            HomePriceLoanInput(
                home_price=home_price,
                down_payment=down_payment,
                annual_interest_rate_percent=rate,
                term_years=term_years,
                start_date=start,
            )
        )
    except ValueError as e:
        st.error(str(e))
        st.stop()

try:
    summary = summarize_loan(loan_input)
except ValueError as e:
    st.error(str(e))
    st.stop()

monthly_payment = summary.segment_summaries[0].monthly_payment
st.subheader(f"Monthly payment: {money(monthly_payment)}")

m1, m2, m3, m4 = st.columns(4)
m1.metric("Loan amount", money(loan_input.loan_amount))
m2.metric("Total interest", money(summary.total_interest_paid))
m3.metric("Total of payments", money(summary.total_of_payments))
m4.metric("Payoff date", summary.payoff_date.isoformat())

df = schedule_to_dataframe(summary.schedule)

tab1, tab2 = st.tabs(["Balance over time", "Interest vs. principal"])
with tab1:
    balance_chart(df)
with tab2:
    interest_vs_principal_chart(df)

total_years = -(-summary.number_of_payments // 12)  # ceil
with st.expander("Yearly summary / report window (e.g. \"just the first 5 years\")", expanded=False):
    st.caption(
        "Ending balances here are bank-accurate (rounded to the cent every payment), not "
        "a theoretical/unrounded formula -- they can differ from a quick online calculator "
        "by up to a few dollars in later years, which is expected, not an error."
    )
    through_years = st.slider(
        "Show through year", min_value=1, max_value=total_years, value=min(5, total_years)
    )
    window = summarize_report_window(summary, through_years)

    w1, w2, w3, w4 = st.columns(4)
    w1.metric(f"Interest paid through yr {through_years}", money(window.total_interest_paid))
    w2.metric(f"Principal paid through yr {through_years}", money(window.total_principal_paid))
    w3.metric("Balance at end of window", money(window.ending_balance))
    w4.metric("% of original balance left", f"{window.percent_of_original_balance_remaining * 100:.1f}%")

    yearly_df = pd.DataFrame(
        {
            "Year": [y.year_number for y in window.yearly],
            "Payments": [y.payments_in_year for y in window.yearly],
            "Starting balance": [y.starting_balance for y in window.yearly],
            "Ending balance": [y.ending_balance for y in window.yearly],
            "Interest paid": [y.total_interest for y in window.yearly],
            "Principal paid": [y.total_principal for y in window.yearly],
        }
    )
    st.dataframe(yearly_df, width="stretch", hide_index=True)
    if window.paid_off_within_window:
        st.success(f"Loan is fully paid off within this window (payment #{window.through_payment_number}).")

st.subheader("Amortization schedule")
st.dataframe(df, width='stretch', hide_index=True)
download_schedule_button(df, "loan_amortization_schedule.csv", key="loan_calc_download")
