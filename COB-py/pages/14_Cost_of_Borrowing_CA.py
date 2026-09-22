from datetime import date

import pandas as pd
import streamlit as st

from app_common import download_schedule_button, money, period_schedule_to_dataframe
from cob_calculator.cob_canada import CobCanadaInput, calculate_cob_canada
from cob_calculator.fees import Fee, FeeSchedule

st.set_page_config(page_title="Cost of Borrowing (Canada)", page_icon="🍁", layout="wide")
st.title("Cost of Borrowing Disclosure (Canada)")
st.caption(
    "A borrower-facing cost-of-borrowing estimate for Canadian mortgages and personal "
    "loans, covering the 6 dropdown-driven flows from docs/new-req/006 -- **not** a "
    "certified regulatory disclosure. Every output here is scoped to the current "
    "contract term, not the full amortization."
)

FLOW_LABELS = {
    "newMortgage": "New mortgage",
    "newLoan": "New loan",
    "existingMortgage": "Existing mortgage",
    "existingLoan": "Existing loan",
    "paymentChange": "Payment change",
    "variableRatePaymentChange": "Variable rate payment change",
}
# None means the flow leaves that choice open; a value means the flow pins it
# (mirrors validate_cob_canada_input's flow/product/rate-type rules exactly).
FLOW_FIXED_PRODUCT_TYPE = {
    "newMortgage": "mortgage",
    "newLoan": "personalLoan",
    "existingMortgage": "mortgage",
    "existingLoan": "personalLoan",
    "paymentChange": None,
    "variableRatePaymentChange": "mortgage",
}
FLOW_FIXED_RATE_TYPE = {
    "variableRatePaymentChange": "variable",
}
PRODUCT_TYPE_LABELS = {"mortgage": "Mortgage", "personalLoan": "Personal loan"}
RATE_TYPE_LABELS = {"variable": "Variable", "fixed": "Fixed"}
NEW_FLOWS = ("newMortgage", "newLoan")
FREQUENCY_LABELS = {
    "monthly": "Monthly (12/yr)",
    "semiMonthly": "Semi-monthly (24/yr)",
    "biweekly": "Biweekly (26/yr)",
    "weekly": "Weekly (52/yr)",
}

flow = st.selectbox("Flow", list(FLOW_LABELS), format_func=lambda f: FLOW_LABELS[f])

col1, col2 = st.columns(2)
with col1:
    fixed_product_type = FLOW_FIXED_PRODUCT_TYPE[flow]
    if fixed_product_type is not None:
        product_type = fixed_product_type
        st.selectbox(
            "Product type",
            [fixed_product_type],
            format_func=lambda p: PRODUCT_TYPE_LABELS[p],
            disabled=True,
            help=f"Fixed to {PRODUCT_TYPE_LABELS[fixed_product_type]!r} by the {FLOW_LABELS[flow]!r} flow.",
        )
    else:
        product_type = st.selectbox(
            "Product type", ["mortgage", "personalLoan"], format_func=lambda p: PRODUCT_TYPE_LABELS[p]
        )
with col2:
    fixed_rate_type = FLOW_FIXED_RATE_TYPE.get(flow)
    if fixed_rate_type is not None:
        rate_type = fixed_rate_type
        st.selectbox(
            "Rate type",
            [fixed_rate_type],
            format_func=lambda r: RATE_TYPE_LABELS[r],
            disabled=True,
            help=f"Fixed to {RATE_TYPE_LABELS[fixed_rate_type]!r} by the {FLOW_LABELS[flow]!r} flow.",
        )
    else:
        rate_type = st.selectbox("Rate type", ["variable", "fixed"], format_func=lambda r: RATE_TYPE_LABELS[r])

st.subheader("Loan details")
col1, col2, col3 = st.columns(3)
with col1:
    loan_amount_label = "Loan amount ($)" if flow in NEW_FLOWS else "Current outstanding balance ($)"
    loan_amount = st.number_input(loan_amount_label, min_value=0.01, value=400000.0, step=1000.0)
    contract_rate_percent = st.number_input(
        "Contract rate (%)", min_value=0.0, value=5.0, step=0.00000001, format="%.8f"
    )
with col2:
    payment_frequency = st.selectbox(
        "Payment frequency", list(FREQUENCY_LABELS), format_func=lambda f: FREQUENCY_LABELS[f]
    )
    first_payment_date = st.date_input("First payment date", value=date.today())
with col3:
    end_date = st.date_input("Term end date (maturity/renewal)", value=date.today())

st.subheader("Term & amortization")
st.caption(
    "Contract term is how long this rate is locked (commonly 3-5 years); remaining "
    "amortization is what's left of the full payoff horizon -- they are different "
    "lengths, and only the term's payments are counted in the outputs below."
)
col1, col2 = st.columns(2)
with col1:
    st.markdown("**Contract term**")
    tcol1, tcol2 = st.columns(2)
    term_years = tcol1.number_input("Term years", min_value=0, value=5, step=1)
    term_months = tcol2.number_input("Term months", min_value=0, max_value=11, value=0, step=1)
with col2:
    st.markdown("**Remaining amortization**")
    acol1, acol2 = st.columns(2)
    remaining_amortization_years = acol1.number_input("Amortization years", min_value=0, value=25, step=1)
    remaining_amortization_months = acol2.number_input(
        "Amortization months", min_value=0, max_value=11, value=0, step=1
    )

st.subheader("Flow-specific dates")
disbursal_date = None
pre_approval_date = None
renewal_date = None
accrued_interest = 0.0
if flow in NEW_FLOWS:
    col1, col2 = st.columns(2)
    with col1:
        disbursal_date = st.date_input("Disbursal date", value=date.today())
    with col2:
        pre_approval_date = st.date_input("Pre-approval date", value=date.today())
else:
    col1, col2 = st.columns(2)
    with col1:
        renewal_date = st.date_input("Renewal date", value=date.today())
    with col2:
        accrued_interest = st.number_input(
            "Accrued interest carried forward ($)",
            min_value=0.0,
            value=0.0,
            step=10.0,
            help="Interest accrued since the last payment, capitalized into this term's opening balance.",
        )

semi_annual_compounding_date = None
if product_type == "mortgage" and rate_type == "fixed":
    semi_annual_compounding_date = st.date_input(
        "Semi-annual compounding anchor date (display only)",
        value=disbursal_date or renewal_date or date.today(),
        help=(
            "Reference date the semi-annual compounding periods are anchored to. "
            "Display/reference only -- it does not change the periodic-rate conversion "
            "(equation 1) or any monetary output."
        ),
    )
else:
    st.caption("Semi-annual compounding date: N/A -- only applies to fixed-rate mortgages.")

st.subheader("Fees")
st.caption(
    "Financed fees add to the amortized principal without reducing what's disbursed; "
    "cash fees do the opposite. 'Included in COB?' is an independent flag driven by "
    "Financial Consumer Protection Framework Regulations s. 48 -- e.g. mortgage default "
    "insurance is often financed but excluded from the COB dollar amount, while an "
    "appraisal fee can be cash-paid but still included."
)
default_fees = pd.DataFrame(
    [
        {"name": "Mortgage default insurance", "amount": 10000.0, "financed": True, "included_in_cob": False},
        {"name": "Appraisal fee", "amount": 400.0, "financed": False, "included_in_cob": True},
    ]
)
fees_df = st.data_editor(
    default_fees,
    num_rows="dynamic",
    width="stretch",
    key="cob_ca_fees_editor",
    column_config={
        "name": st.column_config.TextColumn("Fee name"),
        "amount": st.column_config.NumberColumn("Amount ($)", min_value=0.0),
        "financed": st.column_config.CheckboxColumn("Financed?"),
        "included_in_cob": st.column_config.CheckboxColumn("Included in COB?"),
    },
)

fees = [
    Fee(
        name=str(row["name"]),
        amount=float(row["amount"]),
        financed=bool(row.get("financed", False)),
        included_in_cob=bool(row.get("included_in_cob", False)),
    )
    for _, row in fees_df.dropna(subset=["name", "amount"]).iterrows()
]
fee_schedule = FeeSchedule(fees=fees)

cob_input = CobCanadaInput(
    flow=flow,
    product_type=product_type,
    rate_type=rate_type,
    loan_amount=loan_amount,
    fees=fee_schedule,
    contract_rate_percent=contract_rate_percent,
    payment_frequency=payment_frequency,
    term_years=int(term_years),
    term_months=int(term_months),
    remaining_amortization_years=int(remaining_amortization_years),
    remaining_amortization_months=int(remaining_amortization_months),
    first_payment_date=first_payment_date,
    end_date=end_date,
    disbursal_date=disbursal_date,
    pre_approval_date=pre_approval_date,
    renewal_date=renewal_date,
    accrued_interest=accrued_interest,
    semi_annual_compounding_date=semi_annual_compounding_date,
)

try:
    result = calculate_cob_canada(cob_input)
except ValueError as e:
    st.error(str(e))
    st.stop()

st.divider()
st.subheader("Results (this contract term)")

freq_short = FREQUENCY_LABELS[payment_frequency].split(" (")[0]
m1, m2, m3, m4 = st.columns(4)
m1.metric(f"Payment ({freq_short})", money(result.payment_amount))
m2.metric("COB amount", money(result.cob_amount))
m3.metric("COB rate (APR)", f"{result.cob_rate_percent:.3f}%")
m4.metric("Number of payments", result.number_of_payments)

m5, m6, m7, m8 = st.columns(4)
m5.metric("Total payment", money(result.total_payment))
m6.metric("Total interest", money(result.total_interest))
m7.metric("Principal payment", money(result.principal_payment))
trigger_display = f"{result.trigger_rate_percent:.3f}%" if result.trigger_rate_percent is not None else "N/A"
m8.metric(
    "Trigger rate",
    trigger_display,
    help="Only computed for variable-rate mortgages -- N/A for fixed-rate mortgages and personal loans.",
)

m9, m10, m11, m12 = st.columns(4)
m9.metric("Disbursal amount", money(result.disbursal_amount))
m10.metric("Amortized principal", money(result.amortized_principal))
m11.metric("Ending balance (this term)", money(result.ending_balance))
m12.metric("Term length (days, display only)", result.term_days)

st.caption(
    "Ending balance is exactly what a follow-on renewal / payment-change calculation "
    "would enter as its own loan amount / current outstanding balance."
)

st.subheader("Amortization schedule (this contract term only)")
schedule_df = period_schedule_to_dataframe(result.amortization_schedule)
st.dataframe(schedule_df, width="stretch", hide_index=True)
download_schedule_button(schedule_df, "cob_canada_schedule.csv", key="cob_ca_schedule_download")
