import streamlit as st

from cob_calculator.dscr import debt_service_coverage_ratio
from cob_calculator.ltv import combined_loan_to_value, loan_to_value

st.set_page_config(page_title="LTV & DSCR", page_icon="📐", layout="wide")
st.title("LTV, CLTV & DSCR")

tab1, tab2, tab3 = st.tabs(["Loan-to-Value", "Combined LTV", "Debt Service Coverage Ratio"])

with tab1:
    st.caption("LTV = loan amount / property value.")
    c1, c2 = st.columns(2)
    loan_amount = c1.number_input("Loan amount ($)", min_value=0.0, value=270000.0, step=1000.0, key="ltv_loan")
    property_value = c2.number_input("Property value ($)", min_value=0.01, value=300000.0, step=1000.0, key="ltv_value")
    try:
        ltv = loan_to_value(loan_amount, property_value)
        st.metric("LTV", f"{ltv * 100:.2f}%")
        if ltv > 0.8:
            st.info("LTV above 80% typically requires PMI on a conventional loan.")
    except ValueError as e:
        st.error(str(e))

with tab2:
    st.caption("CLTV = (first lien balance + second lien balance) / property value.")
    c1, c2, c3 = st.columns(3)
    first_lien = c1.number_input("First lien balance ($)", min_value=0.0, value=200000.0, step=1000.0)
    second_lien = c2.number_input("Second lien balance ($)", min_value=0.0, value=50000.0, step=1000.0)
    property_value2 = c3.number_input("Property value ($)", min_value=0.01, value=300000.0, step=1000.0, key="cltv_value")
    try:
        cltv = combined_loan_to_value(first_lien, second_lien, property_value2)
        st.metric("CLTV", f"{cltv * 100:.2f}%")
    except ValueError as e:
        st.error(str(e))

with tab3:
    st.caption("DSCR = net operating income / annual debt service. Values > 1.0 indicate sufficient income to cover debt.")
    c1, c2 = st.columns(2)
    noi = c1.number_input("Net operating income ($/yr)", value=50000.0, step=1000.0)
    debt_service = c2.number_input("Annual debt service ($/yr)", min_value=0.01, value=40000.0, step=1000.0)
    try:
        dscr = debt_service_coverage_ratio(noi, debt_service)
        st.metric("DSCR", f"{dscr:.2f}")
        if dscr < 1.0:
            st.warning("DSCR below 1.0 -- income does not cover debt service.")
        else:
            st.success("DSCR at or above 1.0 -- income covers debt service.")
    except ValueError as e:
        st.error(str(e))
