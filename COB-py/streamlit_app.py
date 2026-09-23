"""Entry point: the Canadian Cost of Borrowing calculator is the default page.

The US-style tools are legacy (see CLAUDE.md). They are still registered, so their
URLs (e.g. /Loan_Calculator) keep working, but the navigation menu is hidden.
"""
from pathlib import Path

import streamlit as st

PAGES = Path(__file__).parent / "pages"

LEGACY_PAGES = [
    "00_US_Overview.py",
    "01_Loan_Calculator.py",
    "02_Extra_Payments.py",
    "03_Payment_Frequency.py",
    "04_Segmented_Mortgage.py",
    "05_PMI_and_Costs.py",
    "06_Points_Breakeven.py",
    "07_Refinance.py",
    "08_Compare_Loan_Terms.py",
    "09_LTV_and_DSCR.py",
    "10_ARM_Rate_Reset.py",
    "11_Bank_Reconciliation.py",
    "12_Fees_and_APR.py",
    "13_DTI_and_Affordability.py",
]

navigation = st.navigation(
    {
        "Canada": [
            st.Page(
                PAGES / "14_Cost_of_Borrowing_CA.py",
                title="Cost of Borrowing Calculator",
                icon="🍁",
                default=True,
            ),
        ],
        "US engine (legacy)": [st.Page(PAGES / name) for name in LEGACY_PAGES],
    },
    position="hidden",
)
# Hotlinked from alterna.ca like the TS page; the browser loads it, so nothing is stored here.
st.logo(
    "https://www.alterna.ca/media/t0onoi0m/alterna-savings.svg",
    link="https://www.alterna.ca/",
    size="large",
)
navigation.run()
