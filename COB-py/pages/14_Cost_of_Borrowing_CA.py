from datetime import date

import pandas as pd
import streamlit as st
import streamlit.components.v1 as components

from app_common import money
from cob_calculator.cob_canada import CobCanadaInput, calculate_cob_canada
from cob_calculator.fees import Fee, FeeSchedule

st.set_page_config(page_title="Cost of Borrowing Calculator | Alterna Savings", page_icon="🍁", layout="wide")
st.title("Cost of Borrowing Calculator")
st.markdown(
    "Calculate the cost of borrowing for a mortgage or personal loan over its current "
    "term: the COB amount and rate, total interest, and a full payment schedule. For "
    "variable-rate mortgages it also shows the trigger rate. Fixed-rate mortgage rates "
    "are compounded semi-annually."
)
st.caption(
    "**Note:** results are estimates. They don't replace the cost of borrowing "
    "disclosure in the loan documents."
)

FLOW_LABELS = {
    "newMortgageOrLoan": "New mortgage / loan",
    "renewal": "Renewal",
    "paymentChange": "Payment change",
    "variableRatePaymentChange": "Variable rate payment change",
}
# variableRatePaymentChange is scoped to mortgage+variable "by construction" (the flow
# exists specifically to recompute the trigger rate for that combination) -- every
# other flow leaves product type / rate type as free, orthogonal dropdowns (IN-03/IN-04).
FLOW_FIXED_PRODUCT_TYPE = {"variableRatePaymentChange": "mortgage"}
FLOW_FIXED_RATE_TYPE = {"variableRatePaymentChange": "variable"}
PRODUCT_TYPE_LABELS = {"mortgage": "Mortgage", "personalLoan": "Personal loan"}
RATE_TYPE_LABELS = {"variable": "Variable", "fixed": "Fixed"}
NEW_FLOWS = ("newMortgageOrLoan",)
FREQUENCY_LABELS = {
    "monthly": "Monthly (12/yr)",
    "semiMonthly": "Semi-monthly (24/yr)",
    "biweekly": "Biweekly (26/yr)",
    "weekly": "Weekly (52/yr, incl. Accelerated Weekly)",
}

# Initial values match the TS page (COB-ts/ui/ca.html) so both UIs open on the same example.
DEFAULT_FEES = [
    {"name": "CMHC mortgage default insurance", "amount": 9500.0, "financed": True},
    {"name": "Appraisal fee", "amount": 400.0, "financed": False},
]


def locked_selectbox(label, options, labels, forced, index=0):
    """A selectbox that the flow can pin to one value (shown disabled)."""
    if forced is not None:
        st.selectbox(label, [forced], format_func=lambda v: labels[v], disabled=True, help="Set by the selected flow.")
        return forced
    return st.selectbox(label, options, index=index, format_func=lambda v: labels[v])


st.subheader("Flow")
col1, col2, col3 = st.columns(3)
with col1:
    flow = st.selectbox("Flow", list(FLOW_LABELS), format_func=lambda f: FLOW_LABELS[f])
with col2:
    product_type = locked_selectbox(
        "Product type", ["mortgage", "personalLoan"], PRODUCT_TYPE_LABELS, FLOW_FIXED_PRODUCT_TYPE.get(flow)
    )
with col3:
    rate_type = locked_selectbox(
        "Rate type", ["variable", "fixed"], RATE_TYPE_LABELS, FLOW_FIXED_RATE_TYPE.get(flow), index=1
    )

st.subheader("Loan / mortgage details")
col1, col2, col3 = st.columns(3)
with col1:
    loan_amount_label = "Loan amount ($)" if flow in NEW_FLOWS else "Current outstanding balance ($)"
    loan_amount = st.number_input(
        loan_amount_label,
        min_value=0.01,
        value=227829.65,
        step=1000.0,
        help="Face amount, or current outstanding balance for existing/renewal flows.",
    )
with col2:
    contract_rate_percent = st.number_input(
        "Contract rate (%)", min_value=0.0, value=3.74, step=0.00000001, format="%.8f"
    )
with col3:
    payment_amount = st.number_input(
        "Payment amount ($)",
        min_value=0.01,
        value=465.46,
        step=10.0,
        help="The scheduled payment. It isn't calculated here.",
    )

col1, col2, col3 = st.columns(3)
with col1:
    payment_frequency = st.selectbox(
        "Payment frequency",
        list(FREQUENCY_LABELS),
        index=list(FREQUENCY_LABELS).index("weekly"),
        format_func=lambda f: FREQUENCY_LABELS[f],
    )
with col2:
    tcol1, tcol2 = st.columns(2)
    term_help = "For reference only: the schedule runs to the end date."
    term_years = tcol1.number_input("Contract term (years)", min_value=0, value=3, step=1, help=term_help)
    term_months = tcol2.number_input("Months", min_value=0, max_value=11, value=0, step=1, help=term_help)
with col3:
    first_payment_date = st.date_input("First payment date", value=date(2026, 3, 23))

col1, _, _ = st.columns(3)
with col1:
    end_date = st.date_input(
        "End date",
        value=date(2029, 3, 17),
        help="Payments are scheduled up to and including this date, or until the loan is paid off.",
    )

disbursal_date = None
renewal_date = None
accrued_interest = 0.0
if flow in NEW_FLOWS:
    with st.container(border=True):
        st.markdown("**New mortgage or loan**")
        col1, _ = st.columns(2)
        disbursal_date = col1.date_input("Disbursal date", value=date(2026, 3, 17))
else:
    with st.container(border=True):
        st.markdown("**Renewal and payment change**")
        col1, col2 = st.columns(2)
        renewal_date = col1.date_input("Renewal date", value=date(2026, 1, 1))
        accrued_interest = col2.number_input(
            "Accrued interest ($)",
            min_value=0.0,
            value=0.0,
            step=10.0,
            help="Interest accrued since the last payment date.",
        )

semi_annual_compounding_date = None
if product_type == "mortgage" and rate_type == "fixed":
    with st.container(border=True):
        st.markdown("**Fixed-rate mortgage**")
        col1, _ = st.columns(2)
        semi_annual_compounding_date = col1.date_input(
            "Semi-annual compounding reference date",
            value=date(2025, 12, 15),
            help="For reference only. It doesn't change the calculation.",
        )

st.subheader("Fees")
fees_df = st.data_editor(
    pd.DataFrame(DEFAULT_FEES),
    num_rows="dynamic",
    width="stretch",
    key="cob_ca_fees_editor",
    column_config={
        "name": st.column_config.TextColumn("Name"),
        "amount": st.column_config.NumberColumn("Amount ($)", min_value=0.0),
        "financed": st.column_config.CheckboxColumn("Financed?"),
    },
)

fees = [
    Fee(
        name=str(row["name"]),
        amount=float(row["amount"]),
        financed=bool(row.get("financed", False)),
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
    payment_amount=payment_amount,
    payment_frequency=payment_frequency,
    term_years=int(term_years),
    term_months=int(term_months),
    first_payment_date=first_payment_date,
    end_date=end_date,
    disbursal_date=disbursal_date,
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
st.subheader("Results")


def percent(value, places=4):
    return "N/A" if value is None else f"{value:.{places}f}%"


# KPI cards: four equal columns, one related group per row (same order as the TS page).
KPI_ROWS = [
    [
        ("COB amount", money(result.cob_amount)),
        ("COB rate", percent(result.cob_rate_percent)),
        ("Calculated rate", percent(result.calculated_rate_percent, 10)),
        ("Trigger rate", percent(result.trigger_rate_percent)),
    ],
    [
        ("Payment amount", money(payment_amount)),
        ("Number of payments", str(result.number_of_payments)),
        ("Total payment", money(result.total_payment)),
        ("Total interest", money(result.total_interest)),
    ],
    [
        ("Principal payment", money(result.principal_payment)),
        ("Fees recovered", money(result.fees_recovered)),
        ("Disbursal amount", money(result.disbursal_amount)),
        ("Amortized principal", money(result.amortized_principal)),
    ],
    [
        ("Ending balance", money(result.ending_balance)),
    ],
]
# st.metric's default value size (2.25rem) truncates currency values in a quarter-width card.
st.html(
    "<style>"
    '[data-testid="stMetricValue"] { font-size: 1.5rem; font-weight: 700; }'
    '[data-testid="stMetricLabel"] p { font-weight: 600; }'
    "</style>"
)
for kpi_row in KPI_ROWS:
    for col, (label, value) in zip(st.columns(4), kpi_row):
        col.container(border=True).metric(label, value)

rows = result.amortization_schedule
# Column names match the TS page's CSV export; amounts are unrounded (rounding is display-only).
schedule_df = pd.DataFrame(
    {
        "#": [r.period_number for r in rows],
        "Date": [r.period_date for r in rows],
        "Days": [r.days_in_period for r in rows],
        "Opening balance": [r.opening_balance for r in rows],
        "Period interest": [r.period_interest for r in rows],
        "Accrued interest (open)": [r.carried_accrued_interest_opening for r in rows],
        "Fees (open)": [r.fees_opening for r in rows],
        "Payment": [r.payment_amount for r in rows],
        "Interest paid": [r.interest_paid for r in rows],
        "Fees paid": [r.fees_paid for r in rows],
        "Principal": [r.principal_portion for r in rows],
        "Accrued interest (close)": [r.carried_accrued_interest_closing for r in rows],
        "Fees (close)": [r.fees_closing for r in rows],
        "Balance": [r.remaining_balance for r in rows],
    }
)

head_col, csv_col, print_col = st.columns([5, 1.5, 1], vertical_alignment="bottom")
head_col.subheader("Amortization schedule")
csv_col.download_button(
    "Download CSV",
    data=schedule_df.to_csv(index=False).encode("utf-8"),
    file_name=f"cost-of-borrowing-schedule-{first_payment_date.isoformat()}.csv",
    mime="text/csv",
    key="cob_ca_schedule_download",
    width="stretch",
)
if print_col.button("Print", key="cob_ca_print", width="stretch"):
    # The component iframe is same-origin, so it can open the app page's print dialog.
    st.session_state["cob_ca_print_count"] = st.session_state.get("cob_ca_print_count", 0) + 1
    components.html(
        f"<script>window.parent.print()</script><!-- {st.session_state['cob_ca_print_count']} -->",
        height=0,
    )

money_column = st.column_config.NumberColumn(format="dollar")
st.dataframe(
    schedule_df,
    width="stretch",
    hide_index=True,
    column_config={
        "Date": st.column_config.DateColumn(format="MMM DD, YYYY"),
        **{
            name: money_column
            for name in schedule_df.columns
            if name not in ("#", "Date", "Days")
        },
    },
)
