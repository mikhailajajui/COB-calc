import streamlit as st

from app_common import money
from cob_calculator.dti import AffordabilityInput, DtiInput, calculate_affordability, calculate_dti

st.set_page_config(page_title="DTI & Affordability", page_icon="💰", layout="wide")
st.title("Debt-to-Income & Affordability")

tab1, tab2 = st.tabs(["Check my DTI", "How much can I afford"])

with tab1:
    st.caption(
        "Front-end DTI = full housing payment (P&I + tax + insurance + HOA + PMI) / gross "
        "income. Back-end DTI additionally counts other recurring debts (auto, student "
        "loans, credit card minimums)."
    )
    col1, col2 = st.columns(2)
    with col1:
        income = st.number_input("Gross monthly income ($)", min_value=0.01, value=9000.0, step=100.0)
        housing_payment = st.number_input(
            "Full housing payment ($/mo, PITI + HOA + PMI)", min_value=0.0, value=2200.0, step=50.0
        )
    with col2:
        other_debts = st.number_input("Other monthly debts ($, auto/student/CC/etc.)", min_value=0.0, value=500.0, step=50.0)
        c1, c2 = st.columns(2)
        front_max = c1.number_input("Front-end max (%)", min_value=1.0, value=28.0, step=1.0)
        back_max = c2.number_input("Back-end max (%)", min_value=1.0, value=36.0, step=1.0)

    try:
        result = calculate_dti(
            DtiInput(gross_monthly_income=income, housing_payment=housing_payment, other_monthly_debts=other_debts),
            front_end_max_percent=front_max,
            back_end_max_percent=back_max,
        )
    except ValueError as e:
        st.error(str(e))
        st.stop()

    c1, c2 = st.columns(2)
    c1.metric("Front-end DTI", f"{result.front_end_dti * 100:.1f}%", delta=("OK" if result.front_end_ok else "over limit"))
    c2.metric("Back-end DTI", f"{result.back_end_dti * 100:.1f}%", delta=("OK" if result.back_end_ok else "over limit"))

    if result.qualifies:
        st.success(f"Within {front_max:.0f}%/{back_max:.0f}% DTI limits.")
    else:
        st.warning(f"Exceeds {front_max:.0f}%/{back_max:.0f}% DTI limits.")

with tab2:
    st.caption("Reverse calculation: given income, debts, rate and term, what's the maximum loan you'd qualify for?")
    col1, col2 = st.columns(2)
    with col1:
        aff_income = st.number_input("Gross monthly income ($)", min_value=0.01, value=9000.0, step=100.0, key="aff_income")
        aff_other_debts = st.number_input("Other monthly debts ($)", min_value=0.0, value=500.0, step=50.0, key="aff_debts")
        non_pi = st.number_input(
            "Estimated non-P&I housing costs ($/mo, tax+insurance+HOA+PMI)", min_value=0.0, value=400.0, step=50.0
        )
    with col2:
        aff_rate = st.number_input("Annual interest rate (%)", min_value=0.0, value=6.5, step=0.00000001, format="%.8f", key="aff_rate")
        aff_term = st.number_input("Term (months)", min_value=1, value=360, step=1, key="aff_term")
        down_payment = st.number_input("Down payment ($)", min_value=0.0, value=60000.0, step=1000.0, key="aff_down")

    c1, c2 = st.columns(2)
    aff_front_max = c1.number_input("Front-end max (%)", min_value=1.0, value=28.0, step=1.0, key="aff_front_max")
    aff_back_max = c2.number_input("Back-end max (%)", min_value=1.0, value=36.0, step=1.0, key="aff_back_max")

    try:
        aff_result = calculate_affordability(
            AffordabilityInput(
                gross_monthly_income=aff_income,
                other_monthly_debts=aff_other_debts,
                annual_interest_rate_percent=aff_rate,
                term_months=int(aff_term),
                non_pi_housing_costs=non_pi,
                front_end_max_percent=aff_front_max,
                back_end_max_percent=aff_back_max,
                down_payment=down_payment,
            )
        )
    except ValueError as e:
        st.error(str(e))
        st.stop()

    if not aff_result.qualifies:
        st.error(
            "Existing debts and estimated housing costs already exceed the DTI limits at "
            "this income -- no loan amount qualifies."
        )
    else:
        c1, c2, c3 = st.columns(3)
        c1.metric("Max P&I payment", money(aff_result.max_pi_payment))
        c2.metric("Max loan amount", money(aff_result.max_loan_amount))
        c3.metric("Max home price", money(aff_result.max_home_price))
        st.info(f"Binding constraint: **{aff_result.binding_constraint.replace('_', '-')}** DTI limit.")
