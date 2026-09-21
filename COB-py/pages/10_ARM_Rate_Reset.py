import streamlit as st

from cob_calculator.arm import ArmResetInput, calculate_arm_reset_rate
from cob_calculator.payment import calculate_monthly_payment

st.set_page_config(page_title="ARM Rate Reset", page_icon="🎚️", layout="wide")
st.title("ARM Rate Reset Calculator")
st.caption(
    "Pure rate-cap calculator for an adjustable-rate mortgage reset. Plug the "
    "resulting capped rate into the Segmented Mortgage builder's next renewal "
    "segment to see the resulting payment and schedule."
)

col1, col2 = st.columns(2)
with col1:
    is_first_reset = st.checkbox("This is the first reset", value=True)
    previous_rate = st.number_input("Previous rate (%)", min_value=0.0, value=5.0, step=0.00000001, format="%.8f")
    initial_rate = st.number_input("Initial (start) rate (%)", min_value=0.0, value=4.0, step=0.00000001, format="%.8f")
with col2:
    index_rate = st.number_input("Current index rate (%)", min_value=0.0, value=5.5, step=0.00000001, format="%.8f")
    margin = st.number_input("Margin (%)", min_value=0.0, value=2.25, step=0.00000001, format="%.8f")

st.markdown("**Caps (uncheck to omit a cap entirely)**")
c1, c2, c3 = st.columns(3)
with c1:
    use_initial_cap = st.checkbox("Initial cap", value=True)
    initial_cap = st.number_input("percentage points", min_value=0.0, value=2.0, step=0.25, key="initial_cap", disabled=not use_initial_cap) if use_initial_cap else None
with c2:
    use_periodic_cap = st.checkbox("Periodic cap", value=True)
    periodic_cap = st.number_input("percentage points", min_value=0.0, value=2.0, step=0.25, key="periodic_cap", disabled=not use_periodic_cap) if use_periodic_cap else None
with c3:
    use_lifetime_cap = st.checkbox("Lifetime cap", value=True)
    lifetime_cap = st.number_input("percentage points", min_value=0.0, value=5.0, step=0.25, key="lifetime_cap", disabled=not use_lifetime_cap) if use_lifetime_cap else None

try:
    result = calculate_arm_reset_rate(
        ArmResetInput(
            previous_rate_percent=previous_rate,
            initial_rate_percent=initial_rate,
            index_rate_percent=index_rate,
            margin_percent=margin,
            initial_cap_percent=initial_cap,
            periodic_cap_percent=periodic_cap,
            lifetime_cap_percent=lifetime_cap,
            is_first_reset=is_first_reset,
        )
    )
except ValueError as e:
    st.error(str(e))
    st.stop()

c1, c2 = st.columns(2)
c1.metric("Fully-indexed rate", f"{result.fully_indexed_rate_percent:.3f}%")
c2.metric("Capped rate (actual new rate)", f"{result.capped_rate_percent:.3f}%")

if result.capped_rate_percent < result.fully_indexed_rate_percent:
    st.info("A cap is limiting the rate below the fully-indexed value.")

st.divider()
st.subheader("Resulting payment (optional)")
c1, c2 = st.columns(2)
balance = c1.number_input("Remaining balance ($)", min_value=0.01, value=300000.0, step=1000.0)
remaining_months = c2.number_input("Remaining amortization months", min_value=1, value=300, step=1)
try:
    payment = calculate_monthly_payment(balance, result.capped_rate_percent, int(remaining_months))
    st.metric("New monthly payment", f"${payment:,.2f}")
except ValueError as e:
    st.error(str(e))
