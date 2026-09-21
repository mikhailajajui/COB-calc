from datetime import date

import streamlit as st

from app_common import download_schedule_button, money, months_as_years_text, period_schedule_to_dataframe
from cob_calculator.payment_frequency import calculate_payment_frequency_schedule
from cob_calculator.types import PaymentFrequencyScheduleInput

st.set_page_config(page_title="Payment Frequency", page_icon="📆", layout="wide")
st.title("Payment Frequency Schedule")
st.caption(
    "Genuine per-period amortization at the chosen cadence -- interest accrues each "
    "period against the real outstanding balance, with real calendar dates."
)

col1, col2 = st.columns(2)
with col1:
    loan_amount = st.number_input("Loan amount ($)", min_value=1.0, value=300000.0, step=1000.0)
    rate = st.number_input("Annual interest rate (%)", min_value=0.0, value=6.5, step=0.00000001, format="%.8f")
with col2:
    term_months = st.number_input("Term (months)", min_value=1, value=360, step=1)
    start = st.date_input("Start date", value=date.today())

frequency = st.selectbox(
    "Payment frequency",
    ["monthly", "semiMonthly", "biweekly", "weekly"],
    index=2,
    format_func=lambda f: {
        "monthly": "Monthly (12/yr)",
        "semiMonthly": "Semi-monthly (24/yr)",
        "biweekly": "Biweekly (26/yr)",
        "weekly": "Weekly (52/yr)",
    }[f],
)

try:
    result = calculate_payment_frequency_schedule(
        PaymentFrequencyScheduleInput(
            loan_amount=loan_amount,
            annual_interest_rate_percent=rate,
            term_months=int(term_months),
            frequency=frequency,
            start_date=start,
        )
    )
except ValueError as e:
    st.error(str(e))
    st.stop()

c1, c2, c3, c4 = st.columns(4)
c1.metric("Monthly-equivalent payment", money(result.monthly_payment))
c2.metric(f"Per {frequency} payment", money(result.period_payment_amount))
c3.metric("Payoff", months_as_years_text(result.new_months), delta=f"-{months_as_years_text(result.months_saved)}")
c4.metric("Interest saved", money(result.interest_saved))

if result.effective_extra_monthly_payment > 0:
    st.info(
        f"This cadence is equivalent to an extra {money(result.effective_extra_monthly_payment)}/month "
        "of principal payment, on average."
    )

df = period_schedule_to_dataframe(result.schedule)
st.line_chart(df.set_index("Date")["Balance"])

st.subheader("Per-period amortization schedule")
st.dataframe(df, width='stretch', hide_index=True)
download_schedule_button(df, f"{frequency}_schedule.csv", key="freq_download")
