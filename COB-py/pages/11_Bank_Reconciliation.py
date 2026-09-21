from datetime import date

import streamlit as st

from app_common import download_schedule_button, money, schedule_to_dataframe
from cob_calculator.import_overrides import import_overrides_from_csv, import_overrides_from_json
from cob_calculator.mortgage import summarize_mortgage
from cob_calculator.money import js_round
from cob_calculator.types import MortgageInput, Segment

st.set_page_config(page_title="Bank Reconciliation", page_icon="🏦", layout="wide")
st.title("Bank Statement Reconciliation")
st.caption(
    "Import actual payment history from your bank as manual overrides against the "
    "computed schedule for a single fixed-rate loan, and see the reconciled result."
)
st.warning(
    "**Reading a discrepancy correctly:** this engine rounds interest to the cent every "
    "payment, same as a real bank statement -- so a real statement's balance at a given "
    "payment can differ from the computed schedule by up to a few dollars late in a long "
    "loan purely from rounding, growing smoothly and never past the final payoff. A gap "
    "**larger** than that (tens of dollars or more) is a real signal -- a rate change, a "
    "missed/late payment, an unlogged fee -- worth reconciling with a manual override "
    "above, not rounding noise. See docs/new-req/004-rounding-drift-accuracy-disclosure.md "
    "for the underlying mechanism and verified magnitudes.",
    icon="⚠️",
)

st.subheader("1. Loan")
col1, col2 = st.columns(2)
with col1:
    loan_amount = st.number_input("Loan amount ($)", min_value=1.0, value=300000.0, step=1000.0)
    rate = st.number_input("Annual interest rate (%)", min_value=0.0, value=6.5, step=0.00000001, format="%.8f")
with col2:
    term_years = st.number_input("Term (years)", min_value=1.0, value=30.0, step=1.0)
    start = st.date_input("Start date", value=date.today())

st.subheader("2. Import overrides")
st.caption(
    "CSV columns: paymentNumber, paymentAmount, interestPortion, principalPortion, "
    "remainingBalance, reason (all but paymentNumber optional; naive parser -- no "
    "quoted fields). Or paste a JSON array of the same fields."
)
import_format = st.radio("Format", ["CSV", "JSON"], horizontal=True)

if import_format == "CSV":
    uploaded = st.file_uploader("Upload CSV", type=["csv"])
    text = st.text_area(
        "...or paste CSV",
        value="paymentNumber,remainingBalance,reason\n12,289500,statement reconciliation\n",
        height=120,
    )
    raw = uploaded.getvalue().decode("utf-8") if uploaded else text
    parser = import_overrides_from_csv
else:
    text = st.text_area(
        "Paste JSON array",
        value='[{"paymentNumber": 12, "remainingBalance": 289500, "reason": "statement reconciliation"}]',
        height=120,
    )
    raw = text
    parser = import_overrides_from_json

overrides = []
if raw.strip():
    try:
        overrides = parser(raw)
        st.success(f"Parsed {len(overrides)} override row(s).")
    except ValueError as e:
        st.error(str(e))

st.subheader("3. Reconciled schedule")
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
            manual_overrides=overrides or None,
        )
    )
except ValueError as e:
    st.error(str(e))
    st.stop()

c1, c2, c3 = st.columns(3)
c1.metric("Number of payments", summary.number_of_payments)
c2.metric("Total interest", money(summary.total_interest_paid))
c3.metric("Payoff date", summary.payoff_date.isoformat())

df = schedule_to_dataframe(summary.schedule)
if overrides:
    st.markdown("**Overridden rows**")
    st.dataframe(df[df["Override"] == True], width='stretch', hide_index=True)  # noqa: E712

st.markdown("**Full schedule**")
st.dataframe(df, width='stretch', hide_index=True)
download_schedule_button(df, "reconciled_schedule.csv", key="reconciliation_download")
