import streamlit as st

st.set_page_config(page_title="US Engine Overview", page_icon="🏠", layout="wide")

st.title("US-style engine (legacy)")
st.markdown(
    """
The older US-style mortgage/loan tools, kept for reference. The main app is the
**Cost of Borrowing (Canada)** calculator at the top of the sidebar. Every
calculation runs locally, nothing leaves your machine.

Tools in this section:

- **Loan Calculator** -- a simple fixed-rate loan: monthly payment, amortization
  schedule, totals.
- **Extra Payments** -- how much time/interest an extra monthly principal payment
  saves.
- **Payment Frequency** -- monthly vs. biweekly/weekly/semi-monthly acceleration.
- **Segmented Mortgage** -- renewals, rate changes, interest-only periods, balloon
  payments, lump sums, and manual statement overrides, all stitched into one
  schedule.
- **PMI & Recurring Costs** -- property tax / insurance / HOA / PMI-with-auto-drop
  layered on top of P&I.
- **Points Breakeven** -- is buying discount points worth it.
- **Refinance** -- breakeven and net savings on a refinance.
- **Compare Loan Terms** -- side-by-side comparison of 2+ loan offers.
- **LTV & DSCR** -- loan-to-value, combined LTV, and debt-service coverage ratio.
- **ARM Rate Reset** -- capped rate at an adjustable-rate mortgage's reset.
- **Bank Statement Reconciliation** -- import actual payment history (CSV/JSON) as
  manual overrides against the computed schedule.
- **Fees & APR** -- origination/application/closing fees and a simplified APR
  (always &ge; the note rate), so you compare offers correctly even when fee
  structures differ.
- **DTI & Affordability** -- front-end/back-end debt-to-income check, plus a
  reverse "how much house can I afford" calculator.

Also on the **Loan Calculator** page: a "Yearly summary / report window" panel
to see just the first N years of a loan (interest/principal/balance per year),
without scrolling a 360-row schedule.
"""
)

st.info("All figures are estimates for planning purposes only, not financial advice.")
