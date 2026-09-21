"""Shared Streamlit UI helpers used across every page of the COB calculator app."""

from __future__ import annotations

import math
from datetime import date

import pandas as pd
import streamlit as st

from cob_calculator.types import AmortizationEntry, PeriodAmortizationEntry


def money(value: float) -> str:
    if value is None:
        return "--"
    if math.isinf(value):
        return "never"
    return f"${value:,.2f}"


def months_as_years_text(months: int) -> str:
    years, rem = divmod(months, 12)
    parts = []
    if years:
        parts.append(f"{years} yr")
    if rem:
        parts.append(f"{rem} mo")
    return " ".join(parts) if parts else "0 mo"


def schedule_to_dataframe(rows: list[AmortizationEntry]) -> pd.DataFrame:
    data = {
        "Payment #": [r.payment_number for r in rows],
        "Date": [r.payment_date for r in rows],
        "Payment": [r.payment_amount for r in rows],
        "Interest": [r.interest_portion for r in rows],
        "Principal": [r.principal_portion for r in rows],
        "Balance": [r.remaining_balance for r in rows],
    }
    if any(r.tax_portion is not None for r in rows):
        data["Tax"] = [r.tax_portion or 0 for r in rows]
    if any(r.insurance_portion is not None for r in rows):
        data["Insurance"] = [r.insurance_portion or 0 for r in rows]
    if any(r.hoa_portion is not None for r in rows):
        data["HOA"] = [r.hoa_portion or 0 for r in rows]
    if any(r.pmi_portion is not None for r in rows):
        data["PMI"] = [r.pmi_portion or 0 for r in rows]
    if any(r.is_manual_override for r in rows):
        data["Override"] = [r.is_manual_override for r in rows]
    if any(r.override_reason for r in rows):
        data["Override reason"] = [r.override_reason or "" for r in rows]
    return pd.DataFrame(data)


def period_schedule_to_dataframe(rows: list[PeriodAmortizationEntry]) -> pd.DataFrame:
    return pd.DataFrame(
        {
            "Period #": [r.period_number for r in rows],
            "Date": [r.period_date for r in rows],
            "Payment": [r.payment_amount for r in rows],
            "Interest": [r.interest_portion for r in rows],
            "Principal": [r.principal_portion for r in rows],
            "Balance": [r.remaining_balance for r in rows],
        }
    )


def download_schedule_button(df: pd.DataFrame, filename: str, key: str) -> None:
    st.download_button(
        "Download schedule as CSV",
        data=df.to_csv(index=False).encode("utf-8"),
        file_name=filename,
        mime="text/csv",
        key=key,
    )


def balance_chart(df: pd.DataFrame, x_col: str = "Date") -> None:
    st.line_chart(df.set_index(x_col)["Balance"])


def interest_vs_principal_chart(df: pd.DataFrame, x_col: str = "Date") -> None:
    st.area_chart(df.set_index(x_col)[["Interest", "Principal"]])


def date_input_default(label: str, key: str) -> date:
    return st.date_input(label, value=date.today(), key=key)
