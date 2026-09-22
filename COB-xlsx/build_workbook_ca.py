#!/usr/bin/env python3
"""Builds COB_Calculator_CA.xlsx -- the Canadian Cost-of-Borrowing (COB)
disclosure calculator. See docs/new-req/006-cost-of-borrowing-disclosure.md
for the spec this implements, and that spec's new "Excel implementation
notes" section for why this is a SIBLING workbook (not new sheets bolted
onto COB_Calculator.xlsx) and for the judgment calls made on the spec's
open questions.

This is a separate script (not new functions appended to build_workbook.py)
but reuses that module's styling constants and helpers directly, so the two
workbooks look and behave identically at the cell-formatting level -- see
the imports below.

Run: python3 build_workbook_ca.py [output_path]
"""

import sys
from pathlib import Path

from openpyxl import Workbook, load_workbook
from openpyxl.styles import Font
from openpyxl.utils.cell import coordinate_from_string
from openpyxl.worksheet.datavalidation import DataValidation
from openpyxl.worksheet.worksheet import Worksheet

from build_workbook import (
    FONT_NAME,
    INPUT_FONT,
    FORMULA_FONT,
    LABEL_FONT,
    NOTE_FONT,
    TITLE_FONT,
    INPUT_ROW_FILL,
    BORDER,
    MONEY_FMT,
    PCT_FMT,
    DATE_FMT,
    NUM_FMT,
    style_header_row,
    set_col_widths,
    title_block,
    _scrub_empty_string_cells,
)

SHEET_NAME_CA = "COB_CA"
SHEET_NAME_SCHEDULE = "COB_CA_Schedule"

# Bound for the term-scoped amortization schedule (COB_CA_Schedule). A contract
# term is short by design (commonly 3-5 years) but term_years is explicitly
# user-customizable and not restricted to that range, so this is sized generously:
# 10 years at the densest supported cadence (weekly, 52/yr) = 520 rows. Same
# house convention as the rest of this workbook: extend by copying the last
# row's formulas down if a longer term is needed.
MAX_CA_TERM_ROWS = 520

SECTION_FONT = Font(name=FONT_NAME, bold=True, size=12)


def _section(ws: Worksheet, row: int, text: str) -> None:
    ws.cell(row=row, column=1, value=text).font = SECTION_FONT


def _row(ws: Worksheet, r: int, label: str, value=None, formula=None, fmt=None, is_input=False, note=None) -> str:
    """Writes one label/value (or label/formula) row and returns its value cell's
    reference ("B{r}"), the same convention as build_workbook.py's
    _labeled_inputs/_labeled_outputs but row-by-row, so every formula below can
    refer to another row by name (via the `ref` dict) instead of a hardcoded
    row number -- the exact bug class documented in docs/new-req/005 (a stale
    hardcoded column/row reference silently pointing at the wrong cell)."""
    ws.cell(row=r, column=1, value=label).font = LABEL_FONT
    cell = ws.cell(row=r, column=2, value=value if value is not None else formula)
    if is_input:
        cell.font = INPUT_FONT
        cell.fill = INPUT_ROW_FILL
        cell.border = BORDER
    else:
        cell.font = FORMULA_FONT
    if fmt:
        cell.number_format = fmt
    if note:
        nc = ws.cell(row=r, column=3, value=note)
        nc.font = NOTE_FONT
    return f"B{r}"


def xref(sheet: str, ref: str) -> str:
    """Absolute cross-sheet reference, e.g. xref('COB_CA', 'B16') -> "COB_CA!$B$16"."""
    col, row = coordinate_from_string(ref)
    return f"{sheet}!${col}${row}"


def build_cob_ca_sheet(wb: Workbook):
    ws = wb.create_sheet(SHEET_NAME_CA)
    title_block(
        ws,
        "Canadian Cost of Borrowing (COB) Disclosure -- inputs & summary",
        "Borrower-facing COST-OF-BORROWING ESTIMATE, not a certified regulatory disclosure -- "
        "see docs/new-req/006-cost-of-borrowing-disclosure.md. Blue cells = edit; black = "
        "computed. Every input field stays visible for every Flow (no macros can hide/show "
        "fields) -- pick Flow/Product type/Rate type below, then read the four computed helper "
        "rows to see which date field, trigger-rate, compounding, and accrued-interest rules "
        "actually apply; unused fields for your Flow are simply ignored by the formulas.",
    )

    ref = {}
    r = 4
    _section(ws, r, "Flow / product / rate-type selection")
    r += 1
    ref["flow"] = _row(ws, r, "Flow", value="New mortgage", is_input=True)
    flow_cell_row = r
    r += 1
    ref["product_type"] = _row(ws, r, "Product type", value="mortgage", is_input=True)
    r += 1
    ref["rate_type"] = _row(ws, r, "Rate type", value="variable", is_input=True)
    r += 1
    r += 1  # spacer

    ref["date_field_used"] = _row(
        ws, r, "Date field used (per spec's Flow table)",
        formula=f'=IF(OR({ref["flow"]}="New mortgage",{ref["flow"]}="New loan"),"Pre-approval date","Renewal date")',
    )
    r += 1
    ref["carry_forward"] = _row(
        ws, r, "Accrued-interest carry-forward applies?",
        formula=(
            f'=IF(OR({ref["flow"]}="Existing mortgage",{ref["flow"]}="Existing loan",'
            f'{ref["flow"]}="Payment change",{ref["flow"]}="Variable rate payment change"),"Yes","No")'
        ),
    )
    r += 1
    ref["compounding"] = _row(
        ws, r, "Compounding convention (eq. 1 / eq. 2)",
        formula=(
            f'=IF(AND({ref["product_type"]}="mortgage",{ref["rate_type"]}="fixed"),'
            f'"Semi-annual (Interest Act s.6, CONFIRMED)","Monthly (best-available default, eq. 2)")'
        ),
    )
    r += 1
    ref["trigger_applies"] = _row(
        ws, r, "Trigger rate computed? (mortgage + variable only)",
        formula=f'=IF(AND({ref["product_type"]}="mortgage",{ref["rate_type"]}="variable"),"Yes","No / N/A")',
    )
    r += 1
    r += 1  # spacer

    # Small reference lookup table (payments/year per payment_frequency), mirroring
    # PaymentFrequency!D4:E8 in the US-style workbook exactly (same 4 cadences, same
    # payments-per-year values -- reused rather than re-derived).
    ws.cell(row=4, column=4, value="Frequency").font = LABEL_FONT
    ws.cell(row=4, column=5, value="Payments/Yr").font = LABEL_FONT
    freq_table = [("monthly", 12), ("semiMonthly", 24), ("biweekly", 26), ("weekly", 52)]
    for i, (name, ppy) in enumerate(freq_table):
        ws.cell(row=5 + i, column=4, value=name).font = FORMULA_FONT
        ws.cell(row=5 + i, column=5, value=ppy).font = FORMULA_FONT
    freq_name_rng, freq_ppy_rng = "$D$5:$D$8", "$E$5:$E$8"

    _section(ws, r, "Inputs -- common to every flow")
    r += 1
    ref["loan_amount"] = _row(
        ws, r, "Loan amount ($) / current outstanding balance ($)", value=400000, fmt=MONEY_FMT, is_input=True,
        note="New flows: the new loan/mortgage face amount. Existing/Payment-change flows: enter the "
        "CURRENT OUTSTANDING BALANCE here instead (same field, reused per spec).",
    )
    r += 1
    ref["contract_rate"] = _row(ws, r, "Contract rate, nominal annual (%)", value=5.0, fmt="0.00000000", is_input=True)
    r += 1
    ref["payment_frequency"] = _row(ws, r, "Payment frequency", value="monthly", is_input=True)
    payment_frequency_row = r
    r += 1
    ref["term_years"] = _row(ws, r, "Term years (CONTRACT TERM, not amortization)", value=5, fmt=NUM_FMT, is_input=True)
    r += 1
    ref["term_months"] = _row(ws, r, "Term months (contract term, extra months)", value=0, fmt=NUM_FMT, is_input=True)
    r += 1
    ref["rem_amort_years"] = _row(ws, r, "Remaining amortization years", value=25, fmt=NUM_FMT, is_input=True)
    r += 1
    ref["rem_amort_months"] = _row(ws, r, "Remaining amortization months (extra)", value=0, fmt=NUM_FMT, is_input=True)
    r += 1
    ref["first_payment_date"] = _row(ws, r, "First payment date", value="2026-02-01", fmt=DATE_FMT, is_input=True)
    r += 1
    ref["end_date"] = _row(
        ws, r, "End date (this term's maturity/renewal date)", value="2031-01-01", fmt=DATE_FMT, is_input=True,
    )
    r += 1
    r += 1  # spacer

    _section(ws, r, "Inputs -- flow-conditional")
    r += 1
    ref["disbursal_date"] = _row(
        ws, r, "Disbursal date (new flows only)", value="2026-01-15", fmt=DATE_FMT, is_input=True,
    )
    r += 1
    ref["pre_approval_date"] = _row(
        ws, r, "Pre-approval date (new mortgage / new loan only)", value="2025-12-01", fmt=DATE_FMT, is_input=True,
    )
    r += 1
    ref["renewal_date"] = _row(
        ws, r, "Renewal date (existing/payment-change flows only)", value="2026-01-01", fmt=DATE_FMT, is_input=True,
    )
    r += 1
    ref["accrued_interest"] = _row(
        ws, r, "Accrued interest ($) -- existing/renewal flows only", value=0, fmt=MONEY_FMT, is_input=True,
        note="Judgment call: capitalized into this term's opening balance when the carry-forward row above "
        "reads Yes -- see docs/new-req/006's Excel implementation notes.",
    )
    r += 1
    ref["semi_annual_ref_date"] = _row(
        ws, r, "Semi-annual compounding reference date (fixed mortgages only)", value="2026-01-01", fmt=DATE_FMT,
        is_input=True,
        note="Display/reference only -- eq. 1's periodic-rate conversion does not depend on this date "
        "(see spec 006, equation 1). Not used in any formula below.",
    )
    r += 1
    r += 1  # spacer

    _section(ws, r, "Fees (equation 7's fee-inclusion list)")
    r += 1
    ws.cell(
        row=r, column=1,
        value=(
            "Financed? and Included in COB? are INDEPENDENT flags (spec 006 eq. 7) -- e.g. a "
            "prepayment penalty or discharge fee is never included in cob_amount even if financed."
        ),
    ).font = NOTE_FONT
    r += 2

    fee_header_row = r
    fee_headers = ["Fee name", "Amount ($)", "Financed? (Y/N)", "Included in COB? (Y/N)"]
    for i, h in enumerate(fee_headers, start=1):
        ws.cell(row=fee_header_row, column=i, value=h)
    style_header_row(ws, fee_header_row, 1, len(fee_headers))
    fee_first_row = fee_header_row + 1
    fee_examples = [
        ("Administrative charge", 200, "N", "Y"),
        ("Appraisal fee (lender-required)", 400, "N", "Y"),
        ("Broker fee (paid by lender to broker, included in amount borrowed)", 500, "Y", "Y"),
        ("Prepayment penalty", 0, "N", "N"),
        ("Discharge fee", 0, "N", "N"),
        ("Mortgage default insurance premium (high-ratio)", 0, "Y", "N"),
    ]
    fee_last_row = fee_first_row + len(fee_examples) - 1
    for i, (name, amt, fin, inc) in enumerate(fee_examples):
        rr = fee_first_row + i
        ws.cell(row=rr, column=1, value=name)
        ws.cell(row=rr, column=2, value=amt)
        ws.cell(row=rr, column=3, value=fin)
        ws.cell(row=rr, column=4, value=inc)
        for c in (1, 2, 3, 4):
            ws.cell(row=rr, column=c).font = INPUT_FONT
            ws.cell(row=rr, column=c).fill = INPUT_ROW_FILL
            ws.cell(row=rr, column=c).border = BORDER
        ws.cell(row=rr, column=2).number_format = MONEY_FMT
    fee_amt_rng = f"$B${fee_first_row}:$B${fee_last_row}"
    fee_fin_rng = f"$C${fee_first_row}:$C${fee_last_row}"
    fee_inc_rng = f"$D${fee_first_row}:$D${fee_last_row}"
    r = fee_last_row + 2

    # --- Data validation (dropdown) lists ---
    dv_flow = DataValidation(
        type="list",
        formula1='"New mortgage,New loan,Existing mortgage,Existing loan,Payment change,Variable rate payment change"',
        allow_blank=False,
    )
    ws.add_data_validation(dv_flow)
    dv_flow.add(ws[ref["flow"]])
    dv_product = DataValidation(type="list", formula1='"mortgage,personalLoan"', allow_blank=False)
    ws.add_data_validation(dv_product)
    dv_product.add(ws[ref["product_type"]])
    dv_rate_type = DataValidation(type="list", formula1='"variable,fixed"', allow_blank=False)
    ws.add_data_validation(dv_rate_type)
    dv_rate_type.add(ws[ref["rate_type"]])
    dv_freq = DataValidation(type="list", formula1='"monthly,semiMonthly,biweekly,weekly"', allow_blank=False)
    ws.add_data_validation(dv_freq)
    dv_freq.add(ws[ref["payment_frequency"]])
    dv_yn = DataValidation(type="list", formula1='"Y,N"', allow_blank=False)
    ws.add_data_validation(dv_yn)
    dv_yn.add(f"C{fee_first_row}:D{fee_last_row}")

    # --- Derived / computed section ---
    _section(ws, r, "Derived quantities")
    r += 1
    ref["n"] = _row(
        ws, r, "Payments per year (n)",
        formula=f'=INDEX({freq_ppy_rng},MATCH({ref["payment_frequency"]},{freq_name_rng},0))',
        fmt=NUM_FMT,
    )
    r += 1
    ref["i_period"] = _row(
        ws, r, "Periodic rate i_period (eq. 1 / eq. 2)",
        formula=(
            f'=IF(AND({ref["product_type"]}="mortgage",{ref["rate_type"]}="fixed"),'
            f'(1+{ref["contract_rate"]}/100/2)^(2/{ref["n"]})-1,'
            f'{ref["contract_rate"]}/100/{ref["n"]})'
        ),
        fmt="0.000000%",
    )
    r += 1
    ref["total_fees"] = _row(ws, r, "Total fees", formula=f"=SUM({fee_amt_rng})", fmt=MONEY_FMT)
    r += 1
    ref["total_financed_fees"] = _row(
        ws, r, "Total financed fees", formula=f'=SUMIF({fee_fin_rng},"Y",{fee_amt_rng})', fmt=MONEY_FMT,
    )
    r += 1
    ref["total_cash_fees"] = _row(
        ws, r, "Total cash fees", formula=f"={ref['total_fees']}-{ref['total_financed_fees']}", fmt=MONEY_FMT,
    )
    r += 1
    ref["total_fees_in_cob"] = _row(
        ws, r, "Total fees included in cob_amount (eq. 7 list)",
        formula=f'=SUMIF({fee_inc_rng},"Y",{fee_amt_rng})', fmt=MONEY_FMT,
    )
    r += 1
    ref["disbursal_amount"] = _row(
        ws, r, "Disbursal amount (cash actually advanced)",
        formula=f"={ref['loan_amount']}+{ref['total_financed_fees']}-{ref['total_cash_fees']}", fmt=MONEY_FMT,
        note="Per spec 006's resolved 'Financed fees' formulas (matching spec 002's "
        "effective_loan_amount/amount_financed exactly): financed fees layer ON TOP of "
        "loan_amount (never reduce disbursal); only cash fees reduce disbursal. See "
        "docs/new-req/006's Excel implementation notes.",
    )
    r += 1
    ref["accrued_capitalized"] = _row(
        ws, r, "Accrued interest capitalized into this term's opening balance",
        formula=f'=IF({ref["carry_forward"]}="Yes",{ref["accrued_interest"]},0)', fmt=MONEY_FMT,
    )
    r += 1
    ref["p0"] = _row(
        ws, r, "Amortized principal P0 (opening balance this term)",
        formula=f"={ref['loan_amount']}+{ref['total_financed_fees']}+{ref['accrued_capitalized']}",
        fmt=MONEY_FMT,
    )
    r += 1
    ref["term_total_months"] = _row(
        ws, r, "Term total months", formula=f"=({ref['term_years']}*12+{ref['term_months']})", fmt=NUM_FMT,
    )
    r += 1
    ref["term_years_decimal"] = _row(
        ws, r, "Term, years (T, eq. 6, 2dp)", formula=f"=ROUND({ref['term_total_months']}/12,2)", fmt="0.00",
    )
    r += 1
    ref["rem_amort_total_months"] = _row(
        ws, r, "Remaining amortization total months",
        formula=f"=({ref['rem_amort_years']}*12+{ref['rem_amort_months']})", fmt=NUM_FMT,
    )
    r += 1
    ref["rem_amort_periods"] = _row(
        ws, r, "Remaining amortization total periods (n in eq. 3)",
        formula=f"=ROUND({ref['rem_amort_total_months']}/12*{ref['n']},0)", fmt=NUM_FMT,
    )
    r += 1
    ref["term_periods_raw"] = _row(
        ws, r, "Term length, periods (raw, before clamping to remaining amortization)",
        formula=f"=ROUND({ref['term_total_months']}/12*{ref['n']},0)", fmt=NUM_FMT,
    )
    r += 1
    ref["term_periods"] = _row(
        ws, r, "Term length, periods (schedule bound, clamped)",
        formula=f"=MIN({ref['term_periods_raw']},{ref['rem_amort_periods']})", fmt=NUM_FMT,
        note=f"Clamped so a term can never run longer than remaining amortization. Bounded to "
        f"{MAX_CA_TERM_ROWS} schedule rows -- see COB_CA_Schedule.",
    )
    r += 1
    ref["payment_amount"] = _row(
        ws, r, "Payment amount (eq. 3 -- always an OUTPUT, never entered)",
        formula=f"=ROUND(-PMT({ref['i_period']},{ref['rem_amort_periods']},{ref['p0']}),2)", fmt=MONEY_FMT,
    )
    r += 1
    ref["trigger_rate"] = _row(
        ws, r, "Trigger rate % (eq. 4 -- mortgage + variable only)",
        formula=(
            f'=IF({ref["trigger_applies"]}="Yes",'
            f'ROUND({ref["payment_amount"]}*{ref["n"]}/{ref["p0"]}*100,4),"N/A")'
        ),
        fmt="0.0000",
        note="total_borrowed = current outstanding balance = P0 above (== loan_amount for a brand-new "
        "disbursal, == the current-balance input for existing/renewal/payment-change flows).",
    )
    r += 1
    ref["term_end_whole_months"] = _row(
        ws, r, "(helper) first_payment_date + term_total_months, whole-month date",
        formula=(
            f"=DATE(YEAR({ref['first_payment_date']})+INT((MONTH({ref['first_payment_date']})-1"
            f"+{ref['term_total_months']})/12),MOD(MONTH({ref['first_payment_date']})-1"
            f"+{ref['term_total_months']},12)+1,1)+(DAY({ref['first_payment_date']})-1)"
        ),
        fmt=DATE_FMT,
        note="Explicit month-rollover arithmetic (not EDATE), matching this project's other date "
        "formulas -- see docs/new-req/005.",
    )
    r += 1
    ref["term_days"] = _row(
        ws, r, "term_days (eq. 8, DISPLAY ONLY -- never feeds any monetary formula)",
        formula=f"={ref['end_date']}-{ref['term_end_whole_months']}", fmt=NUM_FMT,
    )
    r += 1
    r += 1  # spacer

    _section(ws, r, "Outputs -- scoped to the current contract term only")
    r += 1
    return ws, ref, r, fee_first_row, fee_last_row


def _finish_cob_ca_outputs(ws: Worksheet, ref: dict, r: int, sched_ranges: dict) -> dict:
    """Second pass: writes the term-scoped output rows once the Schedule sheet's
    (fixed) column layout is known, so these can reference real bounded ranges."""
    counted_rng = sched_ranges["counted"]
    interest_rng = sched_ranges["interest"]
    payment_rng = sched_ranges["payment"]
    beginning_rng = sched_ranges["beginning"]

    ref["number_of_payments"] = _row(
        ws, r, "number_of_payments", formula=f"=COUNTIF({counted_rng},TRUE)", fmt=NUM_FMT,
    )
    r += 1
    ref["total_payment"] = _row(
        ws, r, "total_payment", formula=f"=SUMIFS({payment_rng},{counted_rng},TRUE)", fmt=MONEY_FMT,
    )
    r += 1
    ref["total_interest"] = _row(
        ws, r, "total_interest", formula=f"=SUMIFS({interest_rng},{counted_rng},TRUE)", fmt=MONEY_FMT,
    )
    r += 1
    ref["principal_payment"] = _row(
        ws, r, "principal_payment (== total_payment - total_interest, eq. 5)",
        formula=f"={ref['total_payment']}-{ref['total_interest']}", fmt=MONEY_FMT,
    )
    r += 1
    ref["ending_balance_this_term"] = _row(
        ws, r, "Ending balance at term maturity (next renewal's opening balance)",
        formula=(
            f"=IFERROR(INDEX({sched_ranges['ending']},MATCH({ref['term_periods']},"
            f"{sched_ranges['periodnum']},0)),\"n/a\")"
        ),
        fmt=MONEY_FMT,
    )
    r += 1
    ref["avg_outstanding_balance"] = _row(
        ws, r, "P: average outstanding balance per period (eq. 6)",
        formula=(
            f"=IF({ref['number_of_payments']}=0,0,"
            f"SUMPRODUCT(({counted_rng})*({beginning_rng}))/{ref['number_of_payments']})"
        ),
        fmt=MONEY_FMT,
        note="Average, across this term's counted periods, of the balance outstanding at the END of "
        "each period BEFORE that period's payment is subtracted -- i.e. each period's beginning "
        "balance (interest accrues on it before the payment is applied). Per Financial Consumer "
        "Protection Framework Regulations SOR/2021-181 s.47(1).",
    )
    r += 1
    ref["cob_amount"] = _row(
        ws, r, "cob_amount = total_interest + fees included in COB (eq. 7)",
        formula=f"={ref['total_interest']}+{ref['total_fees_in_cob']}", fmt=MONEY_FMT,
    )
    r += 1
    ref["cob_rate"] = _row(
        ws, r, "cob_rate_percent = (C/(T*P))*100 (eq. 6)",
        formula=(
            f"=IF(OR({ref['term_years_decimal']}=0,{ref['avg_outstanding_balance']}=0),\"n/a\","
            f"ROUND({ref['cob_amount']}/({ref['term_years_decimal']}*{ref['avg_outstanding_balance']})*100,4))"
        ),
        fmt="0.0000",
        note="Regulatory average-outstanding-balance formula (Financial Consumer Protection Framework "
        "Regulations SOR/2021-181 ss.47-48) -- deliberately NOT spec 002's IRR/actuarial APR solve.",
    )
    r += 1
    r += 1  # spacer
    ws.cell(
        row=r, column=1,
        value=(
            "Optional: COB_Calculator_CA_macros.bas (in this folder) adds a chart of the schedule "
            "above plus a one-click disclosure-summary PDF export -- see COB-xlsx/MANUAL.md, "
            "\"COB_CA macros\", for how to import it (requires saving this file as a "
            "macro-enabled .xlsm; not required to use any of the formulas on this sheet)."
        ),
    ).font = NOTE_FONT
    return ref


def build_cob_ca_schedule_sheet(wb: Workbook, ref: dict):
    ws = wb.create_sheet(SHEET_NAME_SCHEDULE)
    title_block(
        ws,
        "COB_CA amortization schedule (computed) -- do not edit",
        f"One row per period within the CURRENT CONTRACT TERM ONLY (not the full amortization) -- "
        f"bounded to {MAX_CA_TERM_ROWS} rows. Rows past the term's own length (COB_CA!{ref['term_periods']}) "
        "freeze at the term's own ending balance; rows past an early full payoff (rare -- only if "
        "remaining amortization is shorter than the term) read $0, same self-stabilizing technique used "
        "throughout COB_Calculator.xlsx (see docs/new-req/005).",
    )

    headers = ["Period #", "Period Date", "Beginning Balance", "Interest", "Principal", "Payment",
               "Ending Balance", "Counted in term totals?"]
    header_row = 4
    for i, h in enumerate(headers, start=1):
        ws.cell(row=header_row, column=i, value=h)
    style_header_row(ws, header_row, 1, len(headers))
    first_data_row = header_row + 1
    last_data_row = first_data_row + MAX_CA_TERM_ROWS - 1

    p0 = xref("COB_CA", ref["p0"])
    i_period = xref("COB_CA", ref["i_period"])
    payment_amount = xref("COB_CA", ref["payment_amount"])
    term_periods = xref("COB_CA", ref["term_periods"])
    first_payment_date = xref("COB_CA", ref["first_payment_date"])
    n_per_year = xref("COB_CA", ref["n"])

    for i in range(MAX_CA_TERM_ROWS):
        rr = first_data_row + i
        period_num = i + 1
        prev_rr = rr - 1

        ws.cell(row=rr, column=1, value=period_num)

        # Period date: explicit month/day-count stepping matching the rest of the
        # project's date arithmetic (see docs/new-req/005) -- monthly/semiMonthly use
        # whole-month rollover, biweekly/weekly use exact day steps. months_per_period
        # = 12/n for monthly-family cadences; biweekly/weekly step by exact days.
        ws.cell(
            row=rr, column=2,
            value=(
                f'=IF({n_per_year}=12,'
                f"DATE(YEAR({first_payment_date})+INT((MONTH({first_payment_date})-1+{period_num - 1})/12),"
                f"MOD(MONTH({first_payment_date})-1+{period_num - 1},12)+1,1)+(DAY({first_payment_date})-1),"
                f'IF({n_per_year}=24,{first_payment_date}+ROUND(({period_num - 1}*365.25)/24,0),'
                f'IF({n_per_year}=26,{first_payment_date}+{(period_num - 1) * 14},'
                f'{first_payment_date}+{(period_num - 1) * 7})))'
            ),
        )
        ws.cell(row=rr, column=2).number_format = DATE_FMT

        beginning_expr = p0 if period_num == 1 else f"G{prev_rr}"
        within_term_expr = f"({'A' + str(rr)}<={term_periods})"

        ws.cell(row=rr, column=3, value=f"={beginning_expr}")
        ws.cell(row=rr, column=3).number_format = MONEY_FMT

        interest_expr = f"IF({within_term_expr},ROUND(C{rr}*{i_period},2),0)"
        ws.cell(row=rr, column=4, value=f"={interest_expr}")
        ws.cell(row=rr, column=4).number_format = MONEY_FMT

        would_payoff_expr = f"AND({within_term_expr},ROUND(C{rr}-ROUND({payment_amount}-D{rr},2),2)<=0)"
        principal_expr = f"IF({within_term_expr},IF({would_payoff_expr},C{rr},ROUND({payment_amount}-D{rr},2)),0)"
        ws.cell(row=rr, column=5, value=f"={principal_expr}")
        ws.cell(row=rr, column=5).number_format = MONEY_FMT

        payment_expr = f"IF({within_term_expr},IF({would_payoff_expr},ROUND(D{rr}+E{rr},2),{payment_amount}),0)"
        ws.cell(row=rr, column=6, value=f"={payment_expr}")
        ws.cell(row=rr, column=6).number_format = MONEY_FMT

        ending_expr = f"IF({within_term_expr},IF({would_payoff_expr},0,ROUND(C{rr}-E{rr},2)),C{rr})"
        ws.cell(row=rr, column=7, value=f"={ending_expr}")
        ws.cell(row=rr, column=7).number_format = MONEY_FMT

        # H column stores a plain "is the loan still genuinely being paid" flag
        # combined with the term bound, exactly mirroring the main workbook's
        # IsActive column (build_workbook.py's Schedule sheet) plus one extra AND
        # for the term-length clamp.
        if period_num == 1:
            counted_expr = f"={within_term_expr}"
        else:
            counted_expr = f"=AND(H{prev_rr},C{prev_rr}>0,{within_term_expr})"
        ws.cell(row=rr, column=8, value=counted_expr)

        for c in range(1, 9):
            ws.cell(row=rr, column=c).font = FORMULA_FONT

    set_col_widths(ws, {"A": 10, "B": 14, "C": 16, "D": 13, "E": 13, "F": 13, "G": 16, "H": 14})
    ws.freeze_panes = ws.cell(row=first_data_row, column=2).coordinate

    sched_ranges = {
        "periodnum": f"COB_CA_Schedule!$A${first_data_row}:$A${last_data_row}",
        "beginning": f"COB_CA_Schedule!$C${first_data_row}:$C${last_data_row}",
        "interest": f"COB_CA_Schedule!$D${first_data_row}:$D${last_data_row}",
        "payment": f"COB_CA_Schedule!$F${first_data_row}:$F${last_data_row}",
        "ending": f"COB_CA_Schedule!$G${first_data_row}:$G${last_data_row}",
        "counted": f"COB_CA_Schedule!$H${first_data_row}:$H${last_data_row}",
    }
    return ws, sched_ranges


if __name__ == "__main__":
    out_path = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).parent / "COB_Calculator_CA.xlsx"

    # Regenerating formulas into an EXISTING macro-enabled workbook (see
    # COB-xlsx/MANUAL.md, "Regenerating after macros are installed"): if the
    # target is a .xlsm that already exists, load it with keep_vba=True so its
    # vbaProject.bin (and any macro-owned sheet, e.g. COB_CA_Chart) survive
    # byte-for-byte -- openpyxl can't AUTHOR a VBA project from nothing, but it
    # can faithfully preserve one that's already there while this script tears
    # down and rebuilds just the two formula-driven sheets it owns. Any other
    # target (a fresh .xlsx, or a .xlsm that doesn't exist yet) builds a brand
    # new workbook from scratch exactly as before -- no macros, pure formulas.
    reuse_macro_workbook = out_path.suffix.lower() == ".xlsm" and out_path.exists()
    if reuse_macro_workbook:
        wb = load_workbook(out_path, keep_vba=True)
        for name in (SHEET_NAME_CA, SHEET_NAME_SCHEDULE):
            if name in wb.sheetnames:
                del wb[name]
    else:
        wb = Workbook()
        wb.remove(wb.active)

    ws_ca, ref, r_after_fees, fee_first_row, fee_last_row = build_cob_ca_sheet(wb)
    # Schedule sheet needs ref (P0/i_period/payment_amount/term_periods/etc.) built
    # above; COB_CA's own term-scoped OUTPUT rows need the Schedule sheet's bounded
    # ranges, which need the Schedule sheet built. Two-pass: build Schedule using the
    # partial ref dict (it only needs the derived-quantity cells, already written),
    # then come back and finish COB_CA's output rows using the Schedule ranges.
    ws_sched, sched_ranges = build_cob_ca_schedule_sheet(wb, ref)
    ref = _finish_cob_ca_outputs(ws_ca, ref, r_after_fees, sched_ranges)

    set_col_widths(ws_ca, {"A": 55, "B": 18, "C": 46, "D": 14, "E": 12})

    _scrub_empty_string_cells(wb)
    wb.save(out_path)
    if reuse_macro_workbook:
        print(f"wrote {out_path} (preserved existing VBA project / macro-owned sheets)")
    else:
        print(f"wrote {out_path}")
