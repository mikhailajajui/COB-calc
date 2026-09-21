import pandas as pd
import streamlit as st

from app_common import money
from cob_calculator.compare import compare_loan_terms
from cob_calculator.types import LoanInput

st.set_page_config(page_title="Compare Loan Terms", page_icon="⚖️", layout="wide")
st.title("Compare Loan Offers")
st.caption("Side-by-side comparison of two or more loan offers -- same amount, different rate/term.")

num_loans = st.number_input("Number of offers to compare", min_value=2, max_value=6, value=2, step=1)

loans = []
cols = st.columns(int(num_loans))
for i, col in enumerate(cols):
    with col:
        st.markdown(f"**Offer {i + 1}**")
        amount = st.number_input("Loan amount ($)", min_value=1.0, value=300000.0, step=1000.0, key=f"cmp_amount_{i}")
        rate = st.number_input("Rate (%)", min_value=0.0, value=6.5 if i == 0 else 6.0, step=0.00000001, format="%.8f", key=f"cmp_rate_{i}")
        term = st.number_input("Term (years)", min_value=1.0, value=30.0 if i == 0 else 15.0, step=1.0, key=f"cmp_term_{i}")
        loans.append(LoanInput(loan_amount=amount, annual_interest_rate_percent=rate, term_years=term))

try:
    result = compare_loan_terms(loans)
except ValueError as e:
    st.error(str(e))
    st.stop()

df = pd.DataFrame(
    {
        "Offer": [f"Offer {i + 1}" for i in range(len(result.entries))],
        "Rate (%)": [e.input.annual_interest_rate_percent for e in result.entries],
        "Term (yrs)": [e.input.term_years for e in result.entries],
        "Monthly payment": [money(e.monthly_payment) for e in result.entries],
        "Total interest": [money(e.total_interest_paid) for e in result.entries],
        "Total of payments": [money(e.total_of_payments) for e in result.entries],
        "Payoff date": [e.payoff_date.isoformat() for e in result.entries],
    }
)
st.dataframe(df, width='stretch', hide_index=True)

st.success(
    f"**Offer {result.lowest_monthly_payment_index + 1}** has the lowest monthly payment. "
    f"**Offer {result.lowest_total_interest_index + 1}** has the lowest total interest paid."
)
