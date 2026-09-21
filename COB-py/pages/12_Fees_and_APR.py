import pandas as pd
import streamlit as st

from app_common import money
from cob_calculator.apr import AprInput, calculate_apr
from cob_calculator.fees import Fee, FeeSchedule

st.set_page_config(page_title="Fees & APR", page_icon="📋", layout="wide")
st.title("Fees & APR")
st.caption(
    "A simplified actuarial-method APR -- **not** a certified TILA/Reg Z disclosure. "
    "Good for comparing offers consistently; not a substitute for a lender's Loan Estimate."
)

col1, col2 = st.columns(2)
with col1:
    loan_amount = st.number_input("Loan amount (note amount, before financed fees) ($)", min_value=1.0, value=300000.0, step=1000.0)
    rate = st.number_input("Annual interest rate / note rate (%)", min_value=0.0, value=6.5, step=0.00000001, format="%.8f")
with col2:
    term_months = st.number_input("Term (months)", min_value=1, value=360, step=1)
    down_payment = st.number_input("Down payment ($, for cash-to-close only)", min_value=0.0, value=60000.0, step=1000.0)

st.subheader("Fees")
st.caption(
    "Cash fees are paid out-of-pocket at closing and reduce the amount financed (raising "
    "APR above the note rate). Financed fees (e.g. VA funding fee, upfront FHA MIP) are "
    "added to the loan balance instead -- they raise your payment and balance, but do not "
    "raise APR relative to the same note rate on that larger balance."
)
default_fees = pd.DataFrame(
    [
        {"name": "Origination fee", "amount": 3000.0, "financed": False},
        {"name": "Application fee", "amount": 500.0, "financed": False},
        {"name": "Appraisal", "amount": 650.0, "financed": False},
    ]
)
fees_df = st.data_editor(
    default_fees,
    num_rows="dynamic",
    width="stretch",
    key="fees_editor",
    column_config={
        "financed": st.column_config.CheckboxColumn("Financed into loan?"),
        "amount": st.column_config.NumberColumn("Amount ($)", min_value=0.0),
    },
)

fees = [
    Fee(name=str(row["name"]), amount=float(row["amount"]), financed=bool(row.get("financed", False)))
    for _, row in fees_df.dropna(subset=["name", "amount"]).iterrows()
]
fee_schedule = FeeSchedule(fees=fees)

try:
    result = calculate_apr(
        AprInput(
            loan_amount=loan_amount,
            annual_interest_rate_percent=rate,
            term_months=int(term_months),
            fees=fee_schedule,
        )
    )
except ValueError as e:
    st.error(str(e))
    st.stop()

st.divider()
c1, c2, c3 = st.columns(3)
c1.metric("Note rate", f"{rate:.3f}%")
c2.metric("APR", f"{result.apr_percent:.3f}%", delta=f"+{result.apr_minus_note_rate_percent:.3f} pts")
c3.metric("Monthly payment (P&I)", money(result.monthly_payment))

c4, c5, c6 = st.columns(3)
c4.metric("Total fees", money(result.total_fees))
c5.metric("Effective loan amount", money(result.effective_loan_amount))
c6.metric("Amount financed", money(result.amount_financed))

cash_fees = fee_schedule.total_cash_fees
cash_to_close = down_payment + cash_fees
st.metric("Estimated cash to close", money(cash_to_close), help="Down payment + cash (non-financed) fees.")

if result.apr_minus_note_rate_percent > 0:
    st.info(
        f"This loan's APR ({result.apr_percent:.3f}%) is {result.apr_minus_note_rate_percent:.3f} "
        f"percentage points above its note rate ({rate:.3f}%) because of "
        f"{money(fee_schedule.total_cash_fees)} in cash fees. Use APR, not the note rate, to "
        "compare against other offers with different fee structures."
    )
else:
    st.success("No cash fees -- APR equals the note rate.")
