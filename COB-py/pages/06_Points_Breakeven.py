import pandas as pd
import streamlit as st

from app_common import money
from cob_calculator.points import PointsBreakevenInput, calculate_points_breakeven

st.set_page_config(page_title="Points Breakeven", page_icon="🎯", layout="wide")
st.title("Discount Points Breakeven")
st.caption("Is buying down the rate with discount points worth it before you expect to sell/refinance?")

col1, col2 = st.columns(2)
with col1:
    loan_amount = st.number_input("Loan amount ($)", min_value=1.0, value=300000.0, step=1000.0)
    original_rate = st.number_input("Original rate (%)", min_value=0.0, value=6.5, step=0.00000001, format="%.8f")
    term_months = st.number_input("Term (months)", min_value=1, value=360, step=1)
with col2:
    points = st.number_input("Points purchased (1 point = 1% of loan)", min_value=0.0, value=1.0, step=0.125)
    rate_reduction = st.number_input("Rate reduction from points (percentage points)", min_value=0.0, value=0.25, step=0.05)

try:
    result = calculate_points_breakeven(
        PointsBreakevenInput(
            loan_amount=loan_amount,
            points=points,
            rate_reduction_percent=rate_reduction,
            original_rate_percent=original_rate,
            term_months=int(term_months),
        )
    )
except ValueError as e:
    st.error(str(e))
    st.stop()

c1, c2, c3 = st.columns(3)
c1.metric("Cost of points", money(result.points_cost))
c2.metric("Monthly savings", money(result.monthly_savings))
c3.metric(
    "Breakeven",
    "never" if result.breakeven_months == float("inf") else f"{result.breakeven_months:.1f} months",
)

st.table(
    pd.DataFrame(
        {
            f"At {original_rate:.3f}%": [money(result.monthly_payment_original)],
            f"At {original_rate - rate_reduction:.3f}% (with points)": [money(result.monthly_payment_with_points)],
        },
        index=["Monthly payment"],
    )
)

if result.breakeven_months == float("inf"):
    st.warning("These points produce no monthly savings -- they never pay for themselves.")
else:
    st.info(
        f"You recoup the {money(result.points_cost)} cost of points after "
        f"{result.breakeven_months:.1f} months. Buying points is worth it only if you "
        "keep this loan longer than that."
    )
