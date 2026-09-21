from datetime import date

import pandas as pd
import streamlit as st

from app_common import (
    balance_chart,
    download_schedule_button,
    money,
    schedule_to_dataframe,
)
from cob_calculator.mortgage import summarize_mortgage
from cob_calculator.types import (
    LumpSumPayment,
    ManualPaymentOverride,
    MortgageInput,
    PmiInput,
    RecurringCost,
    RecurringCosts,
    Segment,
)

st.set_page_config(page_title="Segmented Mortgage", page_icon="🧩", layout="wide")
st.title("Segmented Mortgage Builder")
st.caption(
    "Stitch together renewals, rate/payment changes, interest-only periods, and a "
    "balloon payoff into one continuous amortization schedule -- plus lump sums, "
    "manual statement overrides, PMI, and recurring costs."
)

if "segments" not in st.session_state:
    st.session_state.segments = [
        {
            "start_date": date.today(),
            "rate": 6.0,
            "mode": "amortization",
            "amort_months": 360,
            "payment_amount": 2000.0,
            "term_months": None,
            "balloon": False,
            "interest_only": False,
        }
    ]

col_add, col_remove = st.columns(2)
if col_add.button("➕ Add segment"):
    last = st.session_state.segments[-1]
    st.session_state.segments.append(
        {
            "start_date": last["start_date"],
            "rate": last["rate"],
            "mode": "amortization",
            "amort_months": last["amort_months"],
            "payment_amount": last["payment_amount"],
            "term_months": None,
            "balloon": False,
            "interest_only": False,
        }
    )
if col_remove.button("➖ Remove last segment") and len(st.session_state.segments) > 1:
    st.session_state.segments.pop()

st.subheader("Segments (chronological)")
segments: list[Segment] = []
num_segments = len(st.session_state.segments)

for i, seg_state in enumerate(st.session_state.segments):
    is_first = i == 0
    is_last = i == num_segments - 1
    with st.expander(f"Segment {i + 1}" + (" (original origination)" if is_first else "") + (" (final)" if is_last else ""), expanded=True):
        c1, c2, c3 = st.columns(3)
        seg_state["start_date"] = c1.date_input(
            "Start date (first payment)", value=seg_state["start_date"], key=f"seg{i}_start"
        )
        seg_state["rate"] = c2.number_input(
            "Annual interest rate (%)", min_value=0.0, value=float(seg_state["rate"]), step=0.00000001, format="%.8f", key=f"seg{i}_rate"
        )
        if is_first:
            starting_balance = c3.number_input(
                "Starting balance ($)", min_value=0.01, value=200000.0, step=1000.0, key="seg0_balance"
            )

        seg_state["interest_only"] = st.checkbox("Interest-only", value=seg_state["interest_only"], key=f"seg{i}_io")

        if not seg_state["interest_only"]:
            seg_state["mode"] = st.radio(
                "Payment sizing",
                ["amortization", "payment"],
                index=0 if seg_state["mode"] == "amortization" else 1,
                format_func=lambda m: "Amortize over N months" if m == "amortization" else "Fixed payment amount",
                key=f"seg{i}_mode",
                horizontal=True,
            )
            m1, m2 = st.columns(2)
            if seg_state["mode"] == "amortization":
                seg_state["amort_months"] = m1.number_input(
                    "Amortization months remaining", min_value=1, value=int(seg_state["amort_months"]), step=12, key=f"seg{i}_amort"
                )
            else:
                seg_state["payment_amount"] = m1.number_input(
                    "Payment amount ($)", min_value=0.01, value=float(seg_state["payment_amount"]), step=25.0, key=f"seg{i}_payment"
                )

        if not is_last:
            seg_state["term_months"] = st.number_input(
                "Term months (until next segment/renewal)",
                min_value=1,
                value=int(seg_state["term_months"] or 60),
                step=12,
                key=f"seg{i}_term",
            )
            seg_state["balloon"] = False
        else:
            has_term = st.checkbox(
                "Set a term (balloon or interest-only stop point)",
                value=seg_state["term_months"] is not None,
                key=f"seg{i}_hasterm",
            )
            if has_term:
                seg_state["term_months"] = st.number_input(
                    "Term months", min_value=1, value=int(seg_state["term_months"] or 12), step=12, key=f"seg{i}_term"
                )
                seg_state["balloon"] = st.checkbox(
                    "Balloon payment due at term end (otherwise this must be followed by another segment)",
                    value=seg_state["balloon"],
                    key=f"seg{i}_balloon",
                )
            else:
                seg_state["term_months"] = None
                seg_state["balloon"] = False

    segments.append(
        Segment(
            start_date=seg_state["start_date"],
            annual_interest_rate_percent=seg_state["rate"],
            amortization_months_remaining=(seg_state["amort_months"] if not seg_state["interest_only"] and seg_state["mode"] == "amortization" else None),
            payment_amount=(seg_state["payment_amount"] if not seg_state["interest_only"] and seg_state["mode"] == "payment" else None),
            term_months=seg_state["term_months"],
            starting_balance=(starting_balance if is_first else None),
            balloon=seg_state["balloon"],
            interest_only=seg_state["interest_only"],
        )
    )

# Valid lump-sum boundary payment numbers: cumulative termMonths of every non-last segment.
boundaries = []
cumulative = 0
for seg in segments[:-1]:
    cumulative += seg.term_months or 0
    boundaries.append(cumulative)

st.subheader("Lump sum payments")
st.caption(
    "Applied at a segment/renewal boundary only. Valid boundary payment numbers: "
    + (", ".join(str(b) for b in boundaries) if boundaries else "(none -- only one segment)")
)
lump_sum_df = st.data_editor(
    pd.DataFrame(columns=["afterPaymentNumber", "amount"]),
    num_rows="dynamic",
    width='stretch',
    key="lump_sums_editor",
)
lump_sum_payments = [
    LumpSumPayment(after_payment_number=int(row["afterPaymentNumber"]), amount=float(row["amount"]))
    for _, row in lump_sum_df.dropna().iterrows()
]

st.subheader("Manual payment overrides (bank statement reconciliation)")
overrides_df = st.data_editor(
    pd.DataFrame(
        columns=["paymentNumber", "paymentAmount", "interestPortion", "principalPortion", "remainingBalance", "reason"]
    ),
    num_rows="dynamic",
    width='stretch',
    key="overrides_editor",
)
manual_overrides = [
    ManualPaymentOverride(
        payment_number=int(row["paymentNumber"]),
        payment_amount=(float(row["paymentAmount"]) if pd.notna(row.get("paymentAmount")) else None),
        interest_portion=(float(row["interestPortion"]) if pd.notna(row.get("interestPortion")) else None),
        principal_portion=(float(row["principalPortion"]) if pd.notna(row.get("principalPortion")) else None),
        remaining_balance=(float(row["remainingBalance"]) if pd.notna(row.get("remainingBalance")) else None),
        reason=(row.get("reason") if pd.notna(row.get("reason")) else None),
    )
    for _, row in overrides_df.iterrows()
    if pd.notna(row.get("paymentNumber"))
]

with st.expander("PMI & recurring costs (optional)"):
    use_pmi = st.checkbox("Include PMI")
    pmi_input = None
    if use_pmi:
        p1, p2, p3 = st.columns(3)
        pmi_rate = p1.number_input("PMI annual rate (%)", min_value=0.0, value=0.5, step=0.05)
        property_value = p2.number_input("Property value ($)", min_value=0.01, value=250000.0, step=1000.0)
        drop_ltv = p3.number_input("Drop PMI at LTV (%)", min_value=0.01, max_value=100.0, value=80.0, step=1.0)
        pmi_input = PmiInput(annual_rate_percent=pmi_rate, property_value=property_value, drop_at_ltv_percent=drop_ltv)

    st.markdown("**Recurring costs**")
    costs_kwargs = {}
    for label, key in [("Property tax", "tax"), ("Home insurance", "insurance"), ("HOA", "hoa")]:
        use_cost = st.checkbox(f"Include {label}", key=f"use_{key}")
        if use_cost:
            c1, c2 = st.columns(2)
            annual_amount = c1.number_input(f"{label} annual amount ($)", min_value=0.0, value=3000.0, step=100.0, key=f"{key}_amt")
            annual_increase = c2.number_input(f"{label} annual increase (%)", min_value=0.0, value=0.0, step=0.5, key=f"{key}_inc")
            costs_kwargs[key] = RecurringCost(annual_amount=annual_amount, annual_increase_percent=annual_increase)
    recurring_costs = (
        RecurringCosts(
            property_tax=costs_kwargs.get("tax"), home_insurance=costs_kwargs.get("insurance"), hoa=costs_kwargs.get("hoa")
        )
        if costs_kwargs
        else None
    )

mortgage_input = MortgageInput(
    segments=segments,
    manual_overrides=manual_overrides or None,
    lump_sum_payments=lump_sum_payments or None,
    recurring_costs=recurring_costs,
    pmi=pmi_input,
)

st.divider()
try:
    summary = summarize_mortgage(mortgage_input)
except ValueError as e:
    st.error(str(e))
    st.stop()

st.subheader("Summary")
m1, m2, m3, m4 = st.columns(4)
m1.metric("Number of payments", summary.number_of_payments)
m2.metric("Total interest", money(summary.total_interest_paid))
m3.metric("Total of payments", money(summary.total_of_payments))
m4.metric("Payoff date", summary.payoff_date.isoformat())

if summary.balloon_payment_due:
    st.warning(
        f"Balloon payment of {money(summary.balloon_payment_due.amount)} due "
        f"{summary.balloon_payment_due.due_date.isoformat()} (segment {summary.balloon_payment_due.segment_index + 1})."
    )

st.markdown("**Per-segment summary**")
seg_df = pd.DataFrame(
    {
        "Segment": [s.segment_index + 1 for s in summary.segment_summaries],
        "Monthly payment": [money(s.monthly_payment) for s in summary.segment_summaries],
        "Starting balance": [money(s.starting_balance) for s in summary.segment_summaries],
        "Ending balance": [money(s.ending_balance) for s in summary.segment_summaries],
    }
)
st.table(seg_df)

if summary.cost_breakdown:
    st.markdown("**Cost breakdown (on top of P&I)**")
    cb = summary.cost_breakdown
    c1, c2, c3, c4, c5 = st.columns(5)
    c1.metric("Total tax", money(cb.total_tax_paid))
    c2.metric("Total insurance", money(cb.total_insurance_paid))
    c3.metric("Total HOA", money(cb.total_hoa_paid))
    c4.metric("Total PMI", money(cb.total_pmi_paid))
    c5.metric("Total cost of ownership", money(cb.total_cost_of_ownership))
    if cb.pmi_dropped_at_payment_number:
        st.caption(f"PMI dropped off at payment #{cb.pmi_dropped_at_payment_number}.")

df = schedule_to_dataframe(summary.schedule)
balance_chart(df)

st.subheader("Full amortization schedule")
st.dataframe(df, width='stretch', hide_index=True)
download_schedule_button(df, "segmented_mortgage_schedule.csv", key="segmented_download")
