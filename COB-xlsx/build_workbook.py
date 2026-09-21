#!/usr/bin/env python3
"""Builds COB_Calculator.xlsx -- a formula-driven Excel port of the COB
segmented mortgage / cost-of-borrowing engine. See docs/new-req/005-excel-workbook.md
for the design spec this implements.

Run: python3 build_workbook.py [output_path]
"""

import sys
from pathlib import Path

from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter
from openpyxl.worksheet.worksheet import Worksheet

FONT_NAME = "Arial"

INPUT_FONT = Font(name=FONT_NAME, color="0000FF")
FORMULA_FONT = Font(name=FONT_NAME, color="000000")
LINK_FONT = Font(name=FONT_NAME, color="008000")
HEADER_FONT = Font(name=FONT_NAME, bold=True, color="FFFFFF")
TITLE_FONT = Font(name=FONT_NAME, bold=True, size=14)
LABEL_FONT = Font(name=FONT_NAME, bold=True)
NOTE_FONT = Font(name=FONT_NAME, italic=True, size=9, color="808080")

HEADER_FILL = PatternFill("solid", fgColor="305496")
ASSUMPTION_FILL = PatternFill("solid", fgColor="FFFF00")
INPUT_ROW_FILL = PatternFill("solid", fgColor="FFF2CC")

THIN = Side(style="thin", color="BFBFBF")
BORDER = Border(left=THIN, right=THIN, top=THIN, bottom=THIN)

MONEY_FMT = "$#,##0.00;($#,##0.00);-"
MONEY0_FMT = "$#,##0;($#,##0);-"
PCT_FMT = "0.0000%"
PCT2_FMT = "0.00%"
DATE_FMT = "yyyy-mm-dd"
NUM_FMT = "#,##0"

# Row-count bounds (documented assumption; see the README sheet + docs/new-req/005).
MAX_SCHEDULE_ROWS = 360   # 30 years monthly -- the segmented mortgage engine
MAX_FREQ_ROWS = 1560      # 30 years at weekly (52/yr) cadence -- payment-frequency tool
MAX_YEARS = 30

# Single source of truth for the Schedule sheet's column layout (name, header, number
# format, is_helper). Every OTHER sheet that references a Schedule column (Segments'
# cross-segment lookups, Summary, YearlySummary, ...) must go through schedule_col(name)
# below rather than hardcoding a letter -- a stale hardcoded letter here was exactly the
# bug the Python-engine cross-check caught (Segments referenced Schedule!$K:$K expecting
# "EndingBalance" from an earlier draft of this layout, when $K:$K had since become
# "SegKnownLength").
SCHEDULE_COLUMNS = [
    ("PaymentNumber", "Payment #", "#,##0", False),
    ("SegmentIndex", "Seg Idx", "#,##0", True),
    ("SegStartDate", "Seg Start Date", "yyyy-mm-dd", True),
    ("SegStartPayNum", "Seg Start Pay#", "#,##0", True),
    ("PaymentDate", "Payment Date", "yyyy-mm-dd", False),
    ("MonthlyRate", "Monthly Rate", "0.000000%", True),
    ("SegMonthlyPayment", "Seg Monthly Pmt", "$#,##0.00;($#,##0.00);-", True),
    ("IsInterestOnly", "Seg IO?", None, True),
    ("IsFinalSegment", "Seg Final?", None, True),
    ("SegEndPayNum", "Seg End Pay#", "#,##0", True),
    ("SegKnownLength", "Seg Known Len", "#,##0", True),
    ("BeginningBalance", "Beginning Balance", "$#,##0.00;($#,##0.00);-", False),
    ("OvrInterest", "Ovr: Interest", "$#,##0.00;($#,##0.00);-", True),
    ("OvrRemBalance", "Ovr: Rem Bal", "$#,##0.00;($#,##0.00);-", True),
    ("OvrPrincipal", "Ovr: Principal", "$#,##0.00;($#,##0.00);-", True),
    ("OvrPayment", "Ovr: Payment", "$#,##0.00;($#,##0.00);-", True),
    ("OvrReason", "Ovr: Reason", None, True),
    ("HasOverride", "Has Override?", None, True),
    ("WouldPayOffOrFinal", "Payoff Row?", None, True),
    ("InterestPortion", "Interest", "$#,##0.00;($#,##0.00);-", False),
    ("PrincipalPortion", "Principal (pre-lump)", "$#,##0.00;($#,##0.00);-", True),
    ("PaymentAmount", "Payment (pre-lump)", "$#,##0.00;($#,##0.00);-", True),
    ("EndingBalancePreLump", "Ending Bal (pre-lump)", "$#,##0.00;($#,##0.00);-", True),
    ("LumpSumAmount", "Lump Sum Applied", "$#,##0.00;($#,##0.00);-", True),
    # "Final" = pre-lump value + this row's lump sum, if any -- matching the TS/Python
    # engine, which mutates the boundary row's own principal/payment after computing
    # the lump sum (see mortgage.py's _stitch_segments). These, not the pre-lump
    # columns above, are what every downstream sheet (Summary, YearlySummary) must sum.
    ("PrincipalFinal", "Principal", "$#,##0.00;($#,##0.00);-", False),
    ("PaymentFinal", "Payment", "$#,##0.00;($#,##0.00);-", False),
    ("EndingBalance", "Ending Balance", "$#,##0.00;($#,##0.00);-", False),
    ("IsActive", "Active Row?", None, True),
    ("TaxPortion", "Tax", "$#,##0.00;($#,##0.00);-", False),
    ("InsurancePortion", "Insurance", "$#,##0.00;($#,##0.00);-", False),
    ("HoaPortion", "HOA", "$#,##0.00;($#,##0.00);-", False),
    ("CurrentLtv", "Current LTV", "0.00%", True),
    ("PmiActive", "PMI Active?", None, True),
    ("PmiPortion", "PMI", "$#,##0.00;($#,##0.00);-", False),
    ("PmiJustDropped", "PMI Just Dropped?", None, True),
]
_SCHEDULE_NAME_TO_COL = {name: i + 1 for i, (name, *_r) in enumerate(SCHEDULE_COLUMNS)}
_SCHEDULE_HEADER_ROW = 4
_SCHEDULE_FIRST_DATA_ROW = _SCHEDULE_HEADER_ROW + 1


def schedule_col(name: str) -> str:
    """The Schedule sheet's column letter for a named field -- the only way any other
    sheet should reference a Schedule column, so column layout changes can't silently
    desync a cross-sheet formula."""
    return get_column_letter(_SCHEDULE_NAME_TO_COL[name])


def schedule_ref(name: str, row: int) -> str:
    return f"{schedule_col(name)}{row}"


def schedule_range(name: str) -> str:
    letter = schedule_col(name)
    return f"Schedule!${letter}:${letter}"


_SCHEDULE_LAST_DATA_ROW = _SCHEDULE_FIRST_DATA_ROW + MAX_SCHEDULE_ROWS - 1


def schedule_data_range(name: str) -> str:
    """Like schedule_range(), but bounded to the actual data rows (not the whole
    column) -- required for the SUMPRODUCT/MAX 'last row matching a condition' trick
    to stay fast and to avoid the header row polluting numeric comparisons."""
    letter = schedule_col(name)
    return f"Schedule!${letter}${_SCHEDULE_FIRST_DATA_ROW}:${letter}${_SCHEDULE_LAST_DATA_ROW}"


def style_header_row(ws: Worksheet, row: int, first_col: int, last_col: int) -> None:
    for col in range(first_col, last_col + 1):
        cell = ws.cell(row=row, column=col)
        cell.font = HEADER_FONT
        cell.fill = HEADER_FILL
        cell.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
        cell.border = BORDER


def set_col_widths(ws: Worksheet, widths: dict) -> None:
    for col, width in widths.items():
        ws.column_dimensions[col].width = width


def title_block(ws: Worksheet, title: str, note: str = "") -> None:
    ws["A1"] = title
    ws["A1"].font = TITLE_FONT
    if note:
        ws["A2"] = note
        ws["A2"].font = NOTE_FONT


def build_segments_sheet(wb: Workbook) -> Worksheet:
    ws = wb.create_sheet("Segments")
    title_block(
        ws,
        "Segments (input)",
        "Blue cells = edit these. One row per segment, chronological. Segment 1's Starting "
        "Balance is required; later segments inherit their starting balance from the prior "
        "segment's computed ending balance (do not fill in Starting Balance for row 2+).",
    )

    headers = [
        "Seg #", "Start Date", "Annual Rate %", "Payment Amount\n(blank = compute)",
        "Amortization Months\nRemaining (blank if\nPayment Amount given)", "Term Months\n(blank = final/runs to payoff)",
        "Starting Balance\n(segment 1 only)", "Balloon?\n(Y/N)", "Interest Only?\n(Y/N)",
        "Start Payment #", "End Payment #", "Monthly Payment\n(computed)",
        "Segment Starting\nBalance (computed)", "Segment Ending\nBalance (computed)",
    ]
    header_row = 4
    for i, h in enumerate(headers, start=1):
        ws.cell(row=header_row, column=i, value=h)
    style_header_row(ws, header_row, 1, len(headers))
    ws.row_dimensions[header_row].height = 45

    set_col_widths(
        ws,
        {
            "A": 7, "B": 12, "C": 12, "D": 15, "E": 16, "F": 16, "G": 15, "H": 9, "I": 10,
            "J": 12, "K": 12, "L": 15, "M": 16, "N": 16,
        },
    )

    # Example / default scenario: a 5-year term at origination, then a 25-year renewal at a
    # new rate, matching the kind of scenario used throughout docs/new-req and COB-py's tests.
    example_rows = [
        # start_date, rate%, payment_amount, amort_months, term_months, starting_balance, balloon, io
        ("2024-01-01", 5.0, None, 300, 60, 200000, "N", "N"),
        ("2029-01-01", 6.0, None, 240, None, None, "N", "N"),
    ]

    first_data_row = header_row + 1
    n_segments = 8  # room to add more segments; blank rows are simply ignored downstream
    for i in range(n_segments):
        r = first_data_row + i
        ws.cell(row=r, column=1, value=i + 1).font = FORMULA_FONT
        if i < len(example_rows):
            (start_date, rate, pay, amort, term, bal, balloon, io) = example_rows[i]
            ws.cell(row=r, column=2, value=start_date).font = INPUT_FONT
            ws.cell(row=r, column=3, value=rate).font = INPUT_FONT
            ws.cell(row=r, column=4, value=pay).font = INPUT_FONT
            ws.cell(row=r, column=5, value=amort).font = INPUT_FONT
            ws.cell(row=r, column=6, value=term).font = INPUT_FONT
            ws.cell(row=r, column=7, value=bal).font = INPUT_FONT
            ws.cell(row=r, column=8, value=balloon).font = INPUT_FONT
            ws.cell(row=r, column=9, value=io).font = INPUT_FONT
        for c in (2, 3, 4, 5, 6, 7, 8, 9):
            ws.cell(row=r, column=c).fill = INPUT_ROW_FILL
            ws.cell(row=r, column=c).border = BORDER
        ws.cell(row=r, column=2).number_format = DATE_FMT
        ws.cell(row=r, column=3).number_format = "0.00000000"
        ws.cell(row=r, column=4).number_format = MONEY_FMT
        ws.cell(row=r, column=7).number_format = MONEY_FMT

        # --- computed columns ---
        # Start payment # = 1 for segment 1, else previous segment's End Payment # + 1.
        if i == 0:
            ws.cell(row=r, column=10, value="=1")
        else:
            ws.cell(row=r, column=10, value=f"=IF($F{r-1}=\"\",\"\",K{r-1}+1)")
        # End payment # = Start + TermMonths - 1 (blank if TermMonths blank -- final/open-ended
        # segment; its actual end is discovered from the Schedule sheet instead).
        ws.cell(row=r, column=11, value=f"=IF(OR($F{r}=\"\",$J{r}=\"\"),\"\",J{r}+F{r}-1)")

        # Segment starting balance: segment 1 uses its own input; later segments look up the
        # Ending Balance of the previous segment's LAST schedule row (Schedule sheet column
        # holds EndingBalance per global payment number).
        if i == 0:
            ws.cell(row=r, column=13, value=f"=G{r}")
        else:
            ws.cell(
                row=r, column=13,
                value=(
                    f"=IF($B{r}=\"\",\"\",IFERROR(INDEX({schedule_range('EndingBalance')},"
                    f"MATCH(K{r-1},{schedule_range('PaymentNumber')},0)),\"\"))"
                ),
            )

        # Monthly payment for the segment:
        #  - interest-only: starting balance * monthly rate
        #  - payment amount given: use as-is
        #  - else: PMT() on the segment's own starting balance / amortization months
        ws.cell(
            row=r, column=12,
            value=(
                f"=IF($B{r}=\"\",\"\","
                f"IF(I{r}=\"Y\",ROUND(M{r}*(C{r}/100/12),2),"
                f"IF(D{r}<>\"\",ROUND(D{r},2),"
                f"ROUND(-PMT(C{r}/100/12,E{r},M{r}),2))))"
            ),
        )

        # Segment ending balance = EndingBalance of this segment's own last schedule row
        # (for a bounded segment) or, for the open-ended final segment (no known length),
        # the EndingBalance of the LAST row whose SegmentIndex matches this segment's
        # number. SUMPRODUCT(MAX(...)) finds that last matching PaymentNumber without
        # needing an array-entered (Ctrl+Shift+Enter) formula, unlike a MATCH(2,1/(...),1)
        # trick, which LibreOffice/Excel only evaluate correctly when CSE-entered.
        ws.cell(
            row=r, column=14,
            value=(
                f"=IF($B{r}=\"\",\"\","
                f"IF(K{r}<>\"\",IFERROR(INDEX({schedule_range('EndingBalance')},"
                f"MATCH(K{r},{schedule_range('PaymentNumber')},0)),\"\"),"
                f"IFERROR(INDEX({schedule_range('EndingBalance')},"
                f"MATCH(SUMPRODUCT(MAX(({schedule_data_range('SegmentIndex')}=$A{r})"
                f"*{schedule_data_range('PaymentNumber')})),{schedule_range('PaymentNumber')},0)),\"\")))"
            ),
        )
        for c in (10, 11, 12, 13, 14):
            ws.cell(row=r, column=c).font = FORMULA_FONT
            ws.cell(row=r, column=c).number_format = MONEY_FMT if c in (12, 13, 14) else NUM_FMT
            ws.cell(row=r, column=c).border = BORDER

    ws.freeze_panes = "B5"
    return ws


def build_lump_sums_sheet(wb: Workbook) -> Worksheet:
    ws = wb.create_sheet("LumpSums")
    title_block(
        ws,
        "Lump Sum Payments (input)",
        "Applied at a segment/renewal boundary only -- After Payment # must equal one of "
        "Segments!K (End Payment #) for a non-final segment. Leave rows blank if unused.",
    )
    headers = ["After Payment #", "Amount"]
    header_row = 4
    for i, h in enumerate(headers, start=1):
        ws.cell(row=header_row, column=i, value=h)
    style_header_row(ws, header_row, 1, len(headers))
    set_col_widths(ws, {"A": 16, "B": 14})
    example = {0: (60, 20000)}  # example: a $20,000 lump sum at segment 1's boundary
    for i in range(10):
        r = header_row + 1 + i
        if i in example:
            ws.cell(row=r, column=1, value=example[i][0])
            ws.cell(row=r, column=2, value=example[i][1])
        for c in (1, 2):
            ws.cell(row=r, column=c).font = INPUT_FONT
            ws.cell(row=r, column=c).fill = INPUT_ROW_FILL
            ws.cell(row=r, column=c).border = BORDER
        ws.cell(row=r, column=2).number_format = MONEY_FMT
    return ws


def build_overrides_sheet(wb: Workbook) -> Worksheet:
    ws = wb.create_sheet("Overrides")
    title_block(
        ws,
        "Manual Payment Overrides (input)",
        "Bank-statement reconciliation rows. Leave a field blank to use the computed value; "
        "Payment # is required, all other fields optional per row.",
    )
    headers = ["Payment #", "Payment Amount", "Interest Portion", "Principal Portion", "Remaining Balance", "Reason"]
    header_row = 4
    for i, h in enumerate(headers, start=1):
        ws.cell(row=header_row, column=i, value=h)
    style_header_row(ws, header_row, 1, len(headers))
    set_col_widths(ws, {"A": 12, "B": 15, "C": 15, "D": 15, "E": 16, "F": 28})
    # Example: a bank-statement adjustment on payment #10 (interest portion only;
    # principal/payment/remaining-balance all fall back to computed values).
    example_row = {1: 10, 3: 700, 6: "example: bank fee adjustment"}
    for i in range(15):
        r = header_row + 1 + i
        if i == 0:
            for c, v in example_row.items():
                ws.cell(row=r, column=c, value=v)
        for c in range(1, 7):
            ws.cell(row=r, column=c).font = INPUT_FONT
            ws.cell(row=r, column=c).fill = INPUT_ROW_FILL
            ws.cell(row=r, column=c).border = BORDER
        for c in (2, 3, 4, 5):
            ws.cell(row=r, column=c).number_format = MONEY_FMT
    return ws


def build_pmi_costs_sheet(wb: Workbook) -> Worksheet:
    ws = wb.create_sheet("PMI_Costs")
    title_block(ws, "PMI & Recurring Costs (input)", "Leave PMI/cost annual amounts blank (0) to disable that cost.")

    labels_values = [
        ("PMI annual rate (%)", 0.6),
        ("Property value ($)", 220000),
        ("PMI drop-at LTV (%)", 80),
        ("", None),
        ("Property tax annual amount ($)", 4800),
        ("Property tax annual increase (%)", 0),
        ("Home insurance annual amount ($)", 1200),
        ("Home insurance annual increase (%)", 0),
        ("HOA annual amount ($)", 0),
        ("HOA annual increase (%)", 0),
    ]
    row = 4
    for label, value in labels_values:
        if label == "":
            row += 1
            continue
        ws.cell(row=row, column=1, value=label).font = LABEL_FONT
        cell = ws.cell(row=row, column=2, value=value)
        cell.font = INPUT_FONT
        cell.fill = INPUT_ROW_FILL
        cell.border = BORDER
        if "$" in label:
            cell.number_format = MONEY_FMT
        row += 1
    set_col_widths(ws, {"A": 32, "B": 16})
    # Referenced directly as PMI_Costs!$B$4 etc. elsewhere (no named ranges -- keeps
    # formulas simple and avoids cross-openpyxl-version named-range quirks).
    return ws


def build_schedule_sheet(wb: Workbook) -> Worksheet:
    """The core segmented-mortgage engine, expressed as one row per global payment
    number. Columns are defined as an ordered list below so formulas can refer to
    each other by name ({BeginningBalance}, {InterestPortion}, ...) instead of
    hand-tracked letters -- resolved to real column letters at build time.
    """
    ws = wb.create_sheet("Schedule")
    title_block(
        ws,
        "Schedule (computed) -- do not edit",
        f"One row per global payment number, 1..{MAX_SCHEDULE_ROWS} ({MAX_SCHEDULE_ROWS/12:.0f} years). "
        "Rows past the loan's actual payoff show as blank. Extend by selecting the last row and "
        "copying its formulas down if you need a longer schedule.",
    )

    header_row = _SCHEDULE_HEADER_ROW
    first_data_row = _SCHEDULE_FIRST_DATA_ROW
    last_data_row = _SCHEDULE_LAST_DATA_ROW

    # Single source of truth: SCHEDULE_COLUMNS (module-level). Order matters -- a
    # formula may only reference names defined earlier in that list (Excel itself
    # doesn't care about definition order, but L()/schedule_col() do, since building
    # a formula for column N sometimes reads a later column's letter, e.g.
    # WouldPayOffOrFinal reads InterestPortion, which is fine -- Excel's own dependency
    # graph resolves calculation order regardless of sheet layout order).
    columns = SCHEDULE_COLUMNS
    name_to_col = _SCHEDULE_NAME_TO_COL

    def L(name: str, row: int) -> str:
        """Reference to `name`'s cell on the given row, absolute-free (for fill-down)."""
        return f"{get_column_letter(name_to_col[name])}{row}"

    def col_letter(name: str) -> str:
        return get_column_letter(name_to_col[name])

    for name, header, _fmt, _helper in columns:
        ws.cell(row=header_row, column=name_to_col[name], value=header)
    style_header_row(ws, header_row, 1, len(columns))
    ws.row_dimensions[header_row].height = 30
    ws.freeze_panes = ws.cell(row=first_data_row, column=name_to_col["PaymentDate"] + 1).coordinate

    for r in range(first_data_row, last_data_row + 1):
        pay_num = r - first_data_row + 1
        prev_r = r - 1

        ws.cell(row=r, column=name_to_col["PaymentNumber"], value=pay_num)

        ws.cell(
            row=r, column=name_to_col["SegmentIndex"],
            value=f"=SUMPRODUCT((Segments!$J$5:$J$12<>\"\")*(Segments!$J$5:$J$12<={L('PaymentNumber', r)}))",
        )
        ws.cell(row=r, column=name_to_col["SegStartDate"], value=f"=INDEX(Segments!$B$5:$B$12,{L('SegmentIndex', r)})")
        ws.cell(row=r, column=name_to_col["SegStartPayNum"], value=f"=INDEX(Segments!$J$5:$J$12,{L('SegmentIndex', r)})")
        ws.cell(
            row=r, column=name_to_col["PaymentDate"],
            value=(
                f"=DATE(YEAR({L('SegStartDate', r)})+INT((MONTH({L('SegStartDate', r)})-1"
                f"+({L('PaymentNumber', r)}-{L('SegStartPayNum', r)}))/12),"
                f"MOD(MONTH({L('SegStartDate', r)})-1+({L('PaymentNumber', r)}-{L('SegStartPayNum', r)}),12)+1,1)"
                f"+(DAY({L('SegStartDate', r)})-1)"
            ),
        )
        ws.cell(row=r, column=name_to_col["MonthlyRate"], value=f"=INDEX(Segments!$C$5:$C$12,{L('SegmentIndex', r)})/100/12")
        ws.cell(row=r, column=name_to_col["SegMonthlyPayment"], value=f"=INDEX(Segments!$L$5:$L$12,{L('SegmentIndex', r)})")
        ws.cell(row=r, column=name_to_col["IsInterestOnly"], value=f"=INDEX(Segments!$I$5:$I$12,{L('SegmentIndex', r)})=\"Y\"")
        ws.cell(row=r, column=name_to_col["IsFinalSegment"], value=f"=INDEX(Segments!$F$5:$F$12,{L('SegmentIndex', r)})=\"\"")
        ws.cell(row=r, column=name_to_col["SegEndPayNum"], value=f"=INDEX(Segments!$K$5:$K$12,{L('SegmentIndex', r)})")
        ws.cell(
            row=r, column=name_to_col["SegKnownLength"],
            value=(
                f"=IF(INDEX(Segments!$F$5:$F$12,{L('SegmentIndex', r)})<>\"\","
                f"INDEX(Segments!$F$5:$F$12,{L('SegmentIndex', r)}),"
                f"IF(INDEX(Segments!$E$5:$E$12,{L('SegmentIndex', r)})<>\"\","
                f"INDEX(Segments!$E$5:$E$12,{L('SegmentIndex', r)}),\"\"))"
            ),
        )

        if pay_num == 1:
            ws.cell(row=r, column=name_to_col["BeginningBalance"], value="=Segments!$G$5")
        else:
            ws.cell(row=r, column=name_to_col["BeginningBalance"], value=f"={L('EndingBalance', prev_r)}")

        ws.cell(row=r, column=name_to_col["OvrInterest"], value=f"=IFERROR(INDEX(Overrides!$C:$C,MATCH({L('PaymentNumber', r)},Overrides!$A:$A,0)),\"\")")
        ws.cell(row=r, column=name_to_col["OvrRemBalance"], value=f"=IFERROR(INDEX(Overrides!$E:$E,MATCH({L('PaymentNumber', r)},Overrides!$A:$A,0)),\"\")")
        ws.cell(row=r, column=name_to_col["OvrPrincipal"], value=f"=IFERROR(INDEX(Overrides!$D:$D,MATCH({L('PaymentNumber', r)},Overrides!$A:$A,0)),\"\")")
        ws.cell(row=r, column=name_to_col["OvrPayment"], value=f"=IFERROR(INDEX(Overrides!$B:$B,MATCH({L('PaymentNumber', r)},Overrides!$A:$A,0)),\"\")")
        ws.cell(row=r, column=name_to_col["OvrReason"], value=f"=IFERROR(INDEX(Overrides!$F:$F,MATCH({L('PaymentNumber', r)},Overrides!$A:$A,0)),\"\")")
        ws.cell(row=r, column=name_to_col["HasOverride"], value=f"=ISNUMBER(MATCH({L('PaymentNumber', r)},Overrides!$A:$A,0))")

        # WouldPayOffOrFinal: only meaningful for the non-override, non-interest-only
        # branch, but harmless to compute unconditionally (it's just a boolean).
        ws.cell(
            row=r, column=name_to_col["WouldPayOffOrFinal"],
            value=(
                f"=OR(ROUND({L('BeginningBalance', r)}-ROUND({L('SegMonthlyPayment', r)}-{L('InterestPortion', r)},2),2)<=0,"
                f"AND({L('IsFinalSegment', r)},{L('SegKnownLength', r)}<>\"\","
                f"({L('PaymentNumber', r)}-{L('SegStartPayNum', r)}+1)={L('SegKnownLength', r)}))"
            ),
        )

        ws.cell(row=r, column=name_to_col["InterestPortion"], value=f"=IF({L('OvrInterest', r)}<>\"\",{L('OvrInterest', r)},ROUND({L('BeginningBalance', r)}*{L('MonthlyRate', r)},2))")

        ws.cell(
            row=r, column=name_to_col["PrincipalPortion"],
            value=(
                f"=IF({L('HasOverride', r)},"
                f"IF({L('OvrPrincipal', r)}<>\"\",{L('OvrPrincipal', r)},"
                f"IF({L('OvrRemBalance', r)}<>\"\",ROUND({L('BeginningBalance', r)}-{L('OvrRemBalance', r)},2),"
                f"ROUND((IF({L('OvrPayment', r)}<>\"\",{L('OvrPayment', r)},{L('SegMonthlyPayment', r)}))-{L('InterestPortion', r)},2))),"
                f"IF({L('IsInterestOnly', r)},0,"
                f"IF({L('WouldPayOffOrFinal', r)},{L('BeginningBalance', r)},ROUND({L('SegMonthlyPayment', r)}-{L('InterestPortion', r)},2))))"
            ),
        )

        ws.cell(
            row=r, column=name_to_col["PaymentAmount"],
            value=(
                f"=IF({L('HasOverride', r)},IF({L('OvrPayment', r)}<>\"\",{L('OvrPayment', r)},ROUND({L('InterestPortion', r)}+{L('PrincipalPortion', r)},2)),"
                f"IF({L('IsInterestOnly', r)},{L('InterestPortion', r)},"
                f"IF({L('WouldPayOffOrFinal', r)},ROUND({L('InterestPortion', r)}+{L('PrincipalPortion', r)},2),{L('SegMonthlyPayment', r)})))"
            ),
        )

        ws.cell(
            row=r, column=name_to_col["EndingBalancePreLump"],
            value=(
                f"=IF({L('HasOverride', r)},"
                f"IF({L('OvrRemBalance', r)}<>\"\",{L('OvrRemBalance', r)},ROUND({L('BeginningBalance', r)}-{L('PrincipalPortion', r)},2)),"
                f"IF({L('IsInterestOnly', r)},{L('BeginningBalance', r)},"
                f"IF({L('WouldPayOffOrFinal', r)},0,ROUND({L('BeginningBalance', r)}-{L('PrincipalPortion', r)},2))))"
            ),
        )

        # Lump sum: applied only at a segment boundary (this row's PaymentNumber ==
        # some non-final segment's End Payment #), clamped to the remaining balance.
        ws.cell(
            row=r, column=name_to_col["LumpSumAmount"],
            value=f"=IFERROR(MIN(INDEX(LumpSums!$B:$B,MATCH({L('PaymentNumber', r)},LumpSums!$A:$A,0)),{L('EndingBalancePreLump', r)}),0)",
        )
        ws.cell(row=r, column=name_to_col["PrincipalFinal"], value=f"=ROUND({L('PrincipalPortion', r)}+{L('LumpSumAmount', r)},2)")
        ws.cell(row=r, column=name_to_col["PaymentFinal"], value=f"=ROUND({L('PaymentAmount', r)}+{L('LumpSumAmount', r)},2)")
        ws.cell(row=r, column=name_to_col["EndingBalance"], value=f"=ROUND({L('EndingBalancePreLump', r)}-{L('LumpSumAmount', r)},2)")

        # Row 1 always active; subsequent rows active iff the chain of prior rows never
        # hit a zero beginning balance (loan already paid off).
        ws.cell(row=r, column=name_to_col["IsActive"], value=("=TRUE" if pay_num == 1 else f"=AND({L('IsActive', prev_r)},{L('BeginningBalance', r)}>0)"))

        year_index_expr = f"INT(({L('PaymentNumber', r)}-1)/12)"
        ws.cell(
            row=r, column=name_to_col["TaxPortion"],
            value=f"=IF(PMI_Costs!$B$8=0,0,ROUND(PMI_Costs!$B$8*(1+PMI_Costs!$B$9/100)^{year_index_expr}/12,2))",
        )
        ws.cell(
            row=r, column=name_to_col["InsurancePortion"],
            value=f"=IF(PMI_Costs!$B$10=0,0,ROUND(PMI_Costs!$B$10*(1+PMI_Costs!$B$11/100)^{year_index_expr}/12,2))",
        )
        ws.cell(
            row=r, column=name_to_col["HoaPortion"],
            value=f"=IF(PMI_Costs!$B$12=0,0,ROUND(PMI_Costs!$B$12*(1+PMI_Costs!$B$13/100)^{year_index_expr}/12,2))",
        )
        ws.cell(row=r, column=name_to_col["CurrentLtv"], value=f"=IF(PMI_Costs!$B$5=0,0,{L('EndingBalance', r)}/PMI_Costs!$B$5)")
        ws.cell(row=r, column=name_to_col["PmiActive"], value=f"=AND(PMI_Costs!$B$4>0,{L('CurrentLtv', r)}>PMI_Costs!$B$6/100)")
        ws.cell(
            row=r, column=name_to_col["PmiPortion"],
            value=f"=IF({L('PmiActive', r)},ROUND(Segments!$G$5*PMI_Costs!$B$4/100/12,2),0)",
        )
        ws.cell(
            row=r, column=name_to_col["PmiJustDropped"],
            value=("=FALSE" if pay_num == 1 else f"=AND(NOT({L('PmiActive', r)}),{L('PmiActive', prev_r)})"),
        )

        for name, _header, fmt, _helper in columns:
            cell = ws.cell(row=r, column=name_to_col[name])
            cell.font = FORMULA_FONT
            if fmt:
                cell.number_format = fmt

    set_col_widths(ws, {get_column_letter(i + 1): 13 for i in range(len(columns))})
    ws.column_dimensions[col_letter("OvrReason")].width = 22
    return ws


def build_summary_sheet(wb: Workbook) -> Worksheet:
    ws = wb.create_sheet("Summary")
    title_block(ws, "Summary (computed)", "Totals over the Schedule sheet's active rows only.")

    active_rng = schedule_data_range("IsActive")
    int_rng = schedule_data_range("InterestPortion")
    prin_rng = schedule_data_range("PrincipalFinal")
    pmt_rng = schedule_data_range("PaymentFinal")
    date_rng = schedule_data_range("PaymentDate")
    paynum_rng = schedule_data_range("PaymentNumber")
    tax_rng = schedule_data_range("TaxPortion")
    ins_rng = schedule_data_range("InsurancePortion")
    hoa_rng = schedule_data_range("HoaPortion")
    pmi_rng = schedule_data_range("PmiPortion")
    pmi_active_rng = schedule_data_range("PmiActive")
    pmi_dropped_rng = schedule_data_range("PmiJustDropped")

    rows = [
        ("Number of payments", f"=COUNTIF({active_rng},TRUE)", NUM_FMT),
        ("Total interest paid", f"=SUMIFS({int_rng},{active_rng},TRUE)", MONEY_FMT),
        ("Total principal paid (P&I only)", f"=SUMIFS({prin_rng},{active_rng},TRUE)", MONEY_FMT),
        ("Total of payments (P&I)", f"=SUMIFS({pmt_rng},{active_rng},TRUE)", MONEY_FMT),
        ("Payoff date", f"=SUMPRODUCT(MAX(({active_rng})*({date_rng})))", DATE_FMT),
        ("", "", None),
        ("Total tax paid", f"=SUMIFS({tax_rng},{active_rng},TRUE)", MONEY_FMT),
        ("Total insurance paid", f"=SUMIFS({ins_rng},{active_rng},TRUE)", MONEY_FMT),
        ("Total HOA paid", f"=SUMIFS({hoa_rng},{active_rng},TRUE)", MONEY_FMT),
        ("Total PMI paid", f"=SUMIFS({pmi_rng},{active_rng},TRUE)", MONEY_FMT),
        ("Total cost of ownership", None, MONEY_FMT),  # filled in below, references rows above
        (
            "PMI dropped at payment #",
            # SUMIFS' sum_range argument must be an actual range reference -- it
            # cannot be an arithmetic expression like `range*1`. That was invalid
            # Excel formula syntax (LibreOffice tolerated it; Excel's stricter
            # parser could not, and silently dropped this formula on open --
            # confirmed via Excel's own repair log: "Removed Records: Formula
            # from /xl/worksheets/sheet7.xml part" pointed straight at Summary,
            # this workbook's only cell with this pattern). SUMPRODUCT, unlike
            # SUMIFS, is specifically designed to accept array expressions.
            f'=IFERROR(INDEX({paynum_rng},MATCH(TRUE,{pmi_dropped_rng},0)),IF(SUMPRODUCT(({active_rng})*({pmi_active_rng}))>0,"active through payoff","never"))',
            None,
        ),
        ("", "", None),
        ("Balloon segment index (last active row's segment)", f"=SUMPRODUCT(MAX(({active_rng})*({schedule_data_range('SegmentIndex')})))", NUM_FMT),
    ]

    row_i = 4
    label_cells = {}
    for label, formula, fmt in rows:
        if label == "":
            row_i += 1
            continue
        ws.cell(row=row_i, column=1, value=label).font = LABEL_FONT
        cell = ws.cell(row=row_i, column=2, value=formula)
        cell.font = FORMULA_FONT
        if fmt:
            cell.number_format = fmt
        label_cells[label] = row_i
        row_i += 1

    # Total cost of ownership = Total of payments + tax + insurance + hoa + pmi.
    tco_row = label_cells["Total cost of ownership"]
    ws.cell(
        row=tco_row, column=2,
        value=(
            f"=B{label_cells['Total of payments (P&I)']}+B{label_cells['Total tax paid']}"
            f"+B{label_cells['Total insurance paid']}+B{label_cells['Total HOA paid']}+B{label_cells['Total PMI paid']}"
        ),
    )

    # Balloon payment due: only meaningful if the segment at the balloon index has
    # Balloon=Y. Segments!row = 4 + segment_index (segment 1 is Segments row 5).
    balloon_idx_row = label_cells["Balloon segment index (last active row's segment)"]
    ws.cell(row=balloon_idx_row + 1, column=1, value="Balloon payment due?").font = LABEL_FONT
    ws.cell(
        row=balloon_idx_row + 1, column=2,
        value=f'=IF(INDEX(Segments!$H:$H,B{balloon_idx_row}+4)="Y","Yes","No")',
    ).font = FORMULA_FONT
    ws.cell(row=balloon_idx_row + 2, column=1, value="Balloon amount (if due)").font = LABEL_FONT
    ws.cell(
        row=balloon_idx_row + 2, column=2,
        value=f'=IF(INDEX(Segments!$H:$H,B{balloon_idx_row}+4)="Y",SUMPRODUCT(MAX(({active_rng})*({schedule_data_range("EndingBalancePreLump")}))),"n/a")',
    ).font = FORMULA_FONT
    ws.cell(row=balloon_idx_row + 2, column=2).number_format = MONEY_FMT
    ws.cell(row=balloon_idx_row + 3, column=1, value="Balloon due date (if due)").font = LABEL_FONT
    ws.cell(
        row=balloon_idx_row + 3, column=2,
        value=f'=IF(INDEX(Segments!$H:$H,B{balloon_idx_row}+4)="Y",SUMPRODUCT(MAX(({active_rng})*({date_rng}))),"n/a")',
    ).font = FORMULA_FONT
    ws.cell(row=balloon_idx_row + 3, column=2).number_format = DATE_FMT

    set_col_widths(ws, {"A": 42, "B": 20})
    return ws


def build_yearly_summary_sheet(wb: Workbook) -> Worksheet:
    ws = wb.create_sheet("YearlySummary")
    title_block(
        ws,
        "Yearly Summary / Report Window",
        "Set 'Show through year' below (blue cell) to see cumulative totals for just the "
        "first N years -- e.g. enter 5 to answer 'how much interest will I pay in the first "
        "5 years?' without scrolling the full Schedule.",
    )

    ws.cell(row=4, column=1, value="Show through year:").font = LABEL_FONT
    through_year_cell = "B4"
    ws[through_year_cell] = 5
    ws[through_year_cell].font = INPUT_FONT
    ws[through_year_cell].fill = INPUT_ROW_FILL
    ws[through_year_cell].border = BORDER

    header_row = 6
    headers = ["Year", "Payments in Year", "Starting Balance", "Ending Balance", "Interest Paid", "Principal Paid"]
    for i, h in enumerate(headers, start=1):
        ws.cell(row=header_row, column=i, value=h)
    style_header_row(ws, header_row, 1, len(headers))
    set_col_widths(ws, {"A": 8, "B": 16, "C": 16, "D": 16, "E": 15, "F": 15})

    active_rng = schedule_data_range("IsActive")
    paynum_rng = schedule_data_range("PaymentNumber")
    int_rng = schedule_data_range("InterestPortion")
    prin_rng = schedule_data_range("PrincipalFinal")
    bal_rng = schedule_data_range("EndingBalance")

    first_data_row = header_row + 1
    for i in range(MAX_YEARS):
        r = first_data_row + i
        year = i + 1
        ws.cell(row=r, column=1, value=year).font = FORMULA_FONT
        year_cond = f"(INT(({paynum_rng}-1)/12)+1={year})"
        ws.cell(row=r, column=2, value=f"=SUMPRODUCT(({year_cond})*({active_rng}))").font = FORMULA_FONT
        # Starting balance for the year = EndingBalance of the last row of year-1 (or the
        # original principal for year 1) = BeginningBalance of the year's first active row.
        begin_rng = schedule_data_range("BeginningBalance")
        ws.cell(
            row=r, column=3,
            value=f'=IFERROR(INDEX({begin_rng},MATCH(1,({year_cond})*({active_rng}),0)),"")',
        ).font = FORMULA_FONT
        # Ending balance for the year = EndingBalance of the LAST active row in that
        # year, found via the max PaymentNumber among (year, active) rows, then a
        # normal (non-array) INDEX/MATCH lookup on that specific payment number.
        ws.cell(
            row=r, column=4,
            value=(
                f'=IFERROR(INDEX({bal_rng},MATCH(SUMPRODUCT(MAX(({year_cond})*({active_rng})*({paynum_rng}))),'
                f'{paynum_rng},0)),"")'
            ),
        ).font = FORMULA_FONT
        ws.cell(row=r, column=5, value=f"=SUMPRODUCT(({year_cond})*({active_rng})*({int_rng}))").font = FORMULA_FONT
        ws.cell(row=r, column=6, value=f"=SUMPRODUCT(({year_cond})*({active_rng})*({prin_rng}))").font = FORMULA_FONT
        for c, fmt in ((3, MONEY_FMT), (4, MONEY_FMT), (5, MONEY_FMT), (6, MONEY_FMT)):
            ws.cell(row=r, column=c).number_format = fmt

    # Window totals through the selected year.
    window_row = first_data_row + MAX_YEARS + 1
    ws.cell(row=window_row, column=1, value=f"Totals through year (see {through_year_cell})").font = LABEL_FONT
    year_range = f"$A${first_data_row}:$A${first_data_row + MAX_YEARS - 1}"
    int_col_range = f"$E${first_data_row}:$E${first_data_row + MAX_YEARS - 1}"
    prin_col_range = f"$F${first_data_row}:$F${first_data_row + MAX_YEARS - 1}"
    bal_col_range = f"$D${first_data_row}:$D${first_data_row + MAX_YEARS - 1}"
    ws.cell(row=window_row, column=2, value=f"=SUMIFS({int_col_range},{year_range},\"<=\"&{through_year_cell})").number_format = MONEY_FMT
    ws.cell(row=window_row + 1, column=1, value="(Interest / Principal / Ending balance)").font = NOTE_FONT
    ws.cell(row=window_row, column=3, value=f"=SUMIFS({prin_col_range},{year_range},\"<=\"&{through_year_cell})").number_format = MONEY_FMT
    ws.cell(
        row=window_row, column=4,
        value=f'=INDEX({bal_col_range},MATCH(MIN({through_year_cell},COUNT({year_range})),{year_range},0))',
    ).number_format = MONEY_FMT
    for c in (2, 3, 4):
        ws.cell(row=window_row, column=c).font = FORMULA_FONT

    return ws


def build_payment_frequency_sheet(wb: Workbook) -> Worksheet:
    ws = wb.create_sheet("PaymentFrequency")
    title_block(
        ws,
        "Payment Frequency (monthly / semi-monthly / biweekly / weekly)",
        f"Standalone single-loan calculator (not part of the segmented engine). Genuine "
        f"per-period amortization at the chosen cadence. Bounded to {MAX_FREQ_ROWS} periods "
        f"({MAX_FREQ_ROWS/52:.0f} years at weekly, the densest cadence).",
    )

    labels = [
        ("Loan amount ($)", 300000, MONEY_FMT),
        ("Annual interest rate (%)", 6.5, "0.00000000"),
        ("Term (months)", 360, NUM_FMT),
        ("Start date", "2024-01-01", DATE_FMT),
        ("Frequency (monthly/semiMonthly/biweekly/weekly)", "biweekly", None),
    ]
    for i, (label, value, fmt) in enumerate(labels):
        r = 4 + i
        ws.cell(row=r, column=1, value=label).font = LABEL_FONT
        cell = ws.cell(row=r, column=2, value=value)
        cell.font = INPUT_FONT
        cell.fill = INPUT_ROW_FILL
        cell.border = BORDER
        if fmt:
            cell.number_format = fmt
    loan_cell, rate_cell, term_cell, start_cell, freq_cell = "B4", "B5", "B6", "B7", "B8"

    # Payments/year and payment-fraction lookup table (paymentFraction = what fraction
    # of the monthly payment is paid each occurrence -- e.g. half every 2 weeks for
    # biweekly. Mirrors COB-py's payment_frequency.py FREQUENCY_CONFIG exactly.
    ws["D4"] = "Frequency"
    ws["E4"] = "Payments/Yr"
    ws["F4"] = "Payment Fraction"
    for c in ("D4", "E4", "F4"):
        ws[c].font = LABEL_FONT
    freq_table = [("monthly", 12, 1), ("semiMonthly", 24, 0.5), ("biweekly", 26, 0.5), ("weekly", 52, 0.25)]
    for i, (name, ppy, frac) in enumerate(freq_table):
        r = 5 + i
        ws.cell(row=r, column=4, value=name).font = FORMULA_FONT
        ws.cell(row=r, column=5, value=ppy).font = FORMULA_FONT
        ws.cell(row=r, column=6, value=frac).font = FORMULA_FONT

    ws["A10"] = "Payments per year (looked up)"
    ws["A10"].font = LABEL_FONT
    ws["B10"] = f'=INDEX($E$5:$E$8,MATCH({freq_cell},$D$5:$D$8,0))'
    ws["A11"] = "Payment fraction (looked up)"
    ws["A11"].font = LABEL_FONT
    ws["B11"] = f'=INDEX($F$5:$F$8,MATCH({freq_cell},$D$5:$D$8,0))'
    ws["A12"] = "Monthly-equivalent payment"
    ws["A12"].font = LABEL_FONT
    ws["B12"] = f"=ROUND(-PMT({rate_cell}/100/12,{term_cell},{loan_cell}),2)"
    ws["A13"] = "Period payment amount"
    ws["A13"].font = LABEL_FONT
    ws["B13"] = "=ROUND(B12*B11,2)"
    for r in (10, 11, 12, 13):
        ws.cell(row=r, column=2).font = FORMULA_FONT
    ws["B12"].number_format = MONEY_FMT
    ws["B13"].number_format = MONEY_FMT

    header_row = 16
    headers = ["Period #", "Period Date", "Payment", "Interest", "Principal", "Remaining Balance"]
    for i, h in enumerate(headers, start=1):
        ws.cell(row=header_row, column=i, value=h)
    style_header_row(ws, header_row, 1, len(headers))
    first_data_row = header_row + 1
    last_data_row = first_data_row + MAX_FREQ_ROWS - 1

    for i in range(MAX_FREQ_ROWS):
        r = first_data_row + i
        period_num = i + 1
        prev_r = r - 1
        ws.cell(row=r, column=1, value=period_num)
        # Period date: monthly reuses EDATE-equivalent add-months logic (matches the
        # engine's addMonths exactly, incl. day-of-month overflow); weekly/biweekly use
        # exact 7/14-day steps; semiMonthly is evenly spaced (an approximation of the
        # "1st & 15th" convention -- see docs/new-req and COB-py's payment_frequency.py).
        ws.cell(
            row=r, column=2,
            value=(
                f'=IF({freq_cell}="monthly",'
                f'DATE(YEAR({start_cell})+INT((MONTH({start_cell})-1+{period_num-1})/12),'
                f'MOD(MONTH({start_cell})-1+{period_num-1},12)+1,1)+(DAY({start_cell})-1),'
                f'IF({freq_cell}="weekly",{start_cell}+{(period_num-1)*7},'
                f'IF({freq_cell}="biweekly",{start_cell}+{(period_num-1)*14},'
                f'{start_cell}+ROUND(({period_num-1}*365.25)/24,0))))'
            ),
        )
        if period_num == 1:
            beginning_balance_expr = loan_cell
        else:
            beginning_balance_expr = f"F{prev_r}"
        # Self-stabilizing at payoff, same technique as the (already cross-validated)
        # Schedule sheet: once beginning balance hits exactly 0, would_pay_off is always
        # true (0 - positive_payment <= 0), forcing interest/principal/payment/ending
        # balance all to 0 -- so rows past actual payoff just read 0 forever, with no
        # blanking hack needed (and no risk of a blank string breaking later rows' math).
        rate_period_expr = f"{rate_cell}/100/B10"
        interest_expr = f"ROUND({beginning_balance_expr}*{rate_period_expr},2)"
        ws.cell(row=r, column=4, value=f"={interest_expr}")
        would_pay_off = f"(ROUND({beginning_balance_expr}-ROUND($B$13-D{r},2),2)<=0)"
        ws.cell(row=r, column=5, value=f"=IF({would_pay_off},{beginning_balance_expr},ROUND($B$13-D{r},2))")
        ws.cell(row=r, column=3, value=f"=IF({would_pay_off},ROUND(D{r}+E{r},2),$B$13)")
        ws.cell(row=r, column=6, value=f"=IF({would_pay_off},0,ROUND({beginning_balance_expr}-E{r},2))")
        for c in range(1, 7):
            ws.cell(row=r, column=c).font = FORMULA_FONT
        for c in (3, 4, 5, 6):
            ws.cell(row=r, column=c).number_format = MONEY_FMT
        ws.cell(row=r, column=2).number_format = DATE_FMT

    # Summary metrics below the table. Rows past actual payoff self-stabilize to 0
    # (see the loop above), so a plain SUM already excludes their (zero) contribution
    # correctly -- no blank-string filtering needed. "Periods to payoff" is the
    # position of the first exact 0 in Remaining Balance (balance is monotonically
    # non-increasing to 0, then stays 0), found with a normal exact-match MATCH.
    bal_col = f"$F${first_data_row}:$F${last_data_row}"
    int_col = f"$D${first_data_row}:$D${last_data_row}"
    summary_row = 13
    ws.cell(row=summary_row + 1, column=1, value="Number of periods to payoff").font = LABEL_FONT
    ws.cell(
        row=summary_row + 1, column=2,
        value=f'=IFERROR(MATCH(0,{bal_col},0),"loan does not pay off within {MAX_FREQ_ROWS} periods -- extend the table")',
    ).font = FORMULA_FONT
    ws.cell(row=summary_row + 2, column=1, value="Total interest (this frequency)").font = LABEL_FONT
    ws.cell(row=summary_row + 2, column=2, value=f"=SUM({int_col})").font = FORMULA_FONT
    ws.cell(row=summary_row + 2, column=2).number_format = MONEY_FMT

    set_col_widths(ws, {"A": 30, "B": 16, "C": 10, "D": 14, "E": 16, "F": 16})
    ws.freeze_panes = ws.cell(row=first_data_row, column=1).coordinate
    return ws


def build_extra_payment_sheet(wb: Workbook) -> Worksheet:
    ws = wb.create_sheet("ExtraPayment")
    title_block(
        ws,
        "Extra Monthly Payment Savings",
        f"Standalone single-loan calculator: baseline (fixed {MAX_SCHEDULE_ROWS}-row-bounded "
        "term) vs. the same loan with an extra monthly principal payment (runs until payoff, "
        "self-stabilizing at $0 once paid off -- see PaymentFrequency sheet for the same pattern).",
    )

    labels = [
        ("Loan amount ($)", 300000, MONEY_FMT),
        ("Annual interest rate (%)", 6.5, "0.00000000"),
        ("Term (months)", 360, NUM_FMT),
        ("Extra monthly payment ($)", 200, MONEY_FMT),
        ("Start date", "2024-01-01", DATE_FMT),
    ]
    for i, (label, value, fmt) in enumerate(labels):
        r = 4 + i
        ws.cell(row=r, column=1, value=label).font = LABEL_FONT
        cell = ws.cell(row=r, column=2, value=value)
        cell.font = INPUT_FONT
        cell.fill = INPUT_ROW_FILL
        cell.border = BORDER
        if fmt:
            cell.number_format = fmt
    loan_cell, rate_cell, term_cell, extra_cell, start_cell = "B4", "B5", "B6", "B7", "B8"

    ws["A10"] = "Base monthly payment"
    ws["A10"].font = LABEL_FONT
    ws["B10"] = f"=ROUND(-PMT({rate_cell}/100/12,{term_cell},{loan_cell}),2)"
    ws["A11"] = "Payment with extra"
    ws["A11"].font = LABEL_FONT
    ws["B11"] = f"=ROUND(B10+{extra_cell},2)"
    for c in ("B10", "B11"):
        ws[c].font = FORMULA_FONT
        ws[c].number_format = MONEY_FMT

    header_row = 14
    headers = [
        "Month", "Date",
        "Baseline: Interest", "Baseline: Principal", "Baseline: Balance",
        "With Extra: Interest", "With Extra: Principal", "With Extra: Balance",
    ]
    for i, h in enumerate(headers, start=1):
        ws.cell(row=header_row, column=i, value=h)
    style_header_row(ws, header_row, 1, len(headers))
    first_data_row = header_row + 1
    last_data_row = first_data_row + MAX_SCHEDULE_ROWS - 1

    for i in range(MAX_SCHEDULE_ROWS):
        r = first_data_row + i
        month_num = i + 1
        prev_r = r - 1
        ws.cell(row=r, column=1, value=month_num)
        ws.cell(
            row=r, column=2,
            value=(
                f"=DATE(YEAR({start_cell})+INT((MONTH({start_cell})-1+{month_num-1})/12),"
                f"MOD(MONTH({start_cell})-1+{month_num-1},12)+1,1)+(DAY({start_cell})-1)"
            ),
        )

        # --- Baseline: fixed term, standard amortization, self-stabilizes at 0 past term ---
        base_bal_prev = loan_cell if month_num == 1 else f"E{prev_r}"
        base_int = f"ROUND({base_bal_prev}*{rate_cell}/100/12,2)"
        ws.cell(row=r, column=3, value=f"={base_int}")
        # OR month_num=term_months: force-clear the scheduled final row of the fixed
        # term even when natural cent-rounding leaves a sub-cent-to-few-dollar residual
        # instead of landing on exactly 0 (same fix already validated in the Schedule
        # sheet's WouldPayOffOrFinal -- omitting it here left a $4.71 residual at
        # month 360 on the $300K/6.5%/30yr example before this fix).
        base_would_pay_off = f"(OR(ROUND({base_bal_prev}-ROUND($B$10-C{r},2),2)<=0,{month_num}={term_cell}))"
        ws.cell(row=r, column=4, value=f"=IF({base_would_pay_off},{base_bal_prev},ROUND($B$10-C{r},2))")
        ws.cell(row=r, column=5, value=f"=IF({base_would_pay_off},0,ROUND({base_bal_prev}-D{r},2))")

        # --- With extra: open-ended (payment includes extra), same self-stabilizing pattern ---
        extra_bal_prev = loan_cell if month_num == 1 else f"H{prev_r}"
        extra_int = f"ROUND({extra_bal_prev}*{rate_cell}/100/12,2)"
        ws.cell(row=r, column=6, value=f"={extra_int}")
        extra_would_pay_off = f"(ROUND({extra_bal_prev}-ROUND($B$11-F{r},2),2)<=0)"
        ws.cell(row=r, column=7, value=f"=IF({extra_would_pay_off},{extra_bal_prev},ROUND($B$11-F{r},2))")
        ws.cell(row=r, column=8, value=f"=IF({extra_would_pay_off},0,ROUND({extra_bal_prev}-G{r},2))")

        for c in range(1, 9):
            ws.cell(row=r, column=c).font = FORMULA_FONT
        for c in (3, 4, 5, 6, 7, 8):
            ws.cell(row=r, column=c).number_format = MONEY_FMT
        ws.cell(row=r, column=2).number_format = DATE_FMT

    base_bal_col = f"$E${first_data_row}:$E${last_data_row}"
    base_int_col = f"$C${first_data_row}:$C${last_data_row}"
    extra_bal_col = f"$H${first_data_row}:$H${last_data_row}"
    extra_int_col = f"$F${first_data_row}:$F${last_data_row}"

    summary_start = last_data_row + 2
    summary_labels = [
        ("Original months to payoff", f'=IFERROR(MATCH(0,{base_bal_col},0),"exceeds {MAX_SCHEDULE_ROWS}-row table")', NUM_FMT),
        ("New months to payoff (with extra)", f'=IFERROR(MATCH(0,{extra_bal_col},0),"exceeds {MAX_SCHEDULE_ROWS}-row table")', NUM_FMT),
        ("Months saved", f'=IFERROR(B{summary_start}-B{summary_start + 1},"n/a")', NUM_FMT),
        ("Original total interest", f"=SUM({base_int_col})", MONEY_FMT),
        ("New total interest (with extra)", f"=SUM({extra_int_col})", MONEY_FMT),
        ("Interest saved", f"=B{summary_start + 3}-B{summary_start + 4}", MONEY_FMT),
    ]
    for i, (label, formula, fmt) in enumerate(summary_labels):
        r = summary_start + i
        ws.cell(row=r, column=1, value=label).font = LABEL_FONT
        cell = ws.cell(row=r, column=2, value=formula)
        cell.font = FORMULA_FONT
        cell.number_format = fmt

    set_col_widths(ws, {get_column_letter(i): 16 for i in range(1, 9)})
    ws.freeze_panes = ws.cell(row=first_data_row, column=1).coordinate
    return ws


def _labeled_inputs(ws: Worksheet, start_row: int, labels_values_fmts, col_a_width=34) -> dict:
    """Writes a column of (label, value, format) input rows starting at start_row.
    Returns {label: 'B<row>'} so callers can reference cells by label."""
    refs = {}
    for i, (label, value, fmt) in enumerate(labels_values_fmts):
        r = start_row + i
        ws.cell(row=r, column=1, value=label).font = LABEL_FONT
        cell = ws.cell(row=r, column=2, value=value)
        cell.font = INPUT_FONT
        cell.fill = INPUT_ROW_FILL
        cell.border = BORDER
        if fmt:
            cell.number_format = fmt
        refs[label] = f"B{r}"
    set_col_widths(ws, {"A": col_a_width, "B": 18})
    return refs


def _labeled_outputs(ws: Worksheet, start_row: int, labels_formulas_fmts) -> dict:
    refs = {}
    for i, (label, formula, fmt) in enumerate(labels_formulas_fmts):
        r = start_row + i
        ws.cell(row=r, column=1, value=label).font = LABEL_FONT
        cell = ws.cell(row=r, column=2, value=formula)
        cell.font = FORMULA_FONT
        if fmt:
            cell.number_format = fmt
        refs[label] = f"B{r}"
    return refs


def build_points_sheet(wb: Workbook) -> Worksheet:
    ws = wb.create_sheet("Points")
    title_block(ws, "Discount Points Breakeven")
    inp = _labeled_inputs(
        ws, 4,
        [
            ("Loan amount ($)", 400000, MONEY_FMT),
            ("Points purchased (1 = 1% of loan)", 1.0, "0.00"),
            ("Rate reduction from points (pts)", 0.25, "0.00000000"),
            ("Original rate (%)", 6.5, "0.00000000"),
            ("Term (months)", 360, NUM_FMT),
        ],
    )
    out = _labeled_outputs(
        ws, 10,
        [
            ("Points cost", f"=ROUND({inp['Loan amount ($)']}*{inp['Points purchased (1 = 1% of loan)']}/100,2)", MONEY_FMT),
            ("Monthly payment (original rate)", f"=ROUND(-PMT({inp['Original rate (%)']}/100/12,{inp['Term (months)']},{inp['Loan amount ($)']}),2)", MONEY_FMT),
            (
                "Monthly payment (with points)",
                f"=ROUND(-PMT(({inp['Original rate (%)']}-{inp['Rate reduction from points (pts)']})/100/12,{inp['Term (months)']},{inp['Loan amount ($)']}),2)",
                MONEY_FMT,
            ),
            ("Monthly savings", "=B11-B12", MONEY_FMT),
            ("Breakeven (months)", '=IF(B13<=0,"never (no monthly savings)",B10/B13)', None),
        ],
    )
    return ws


def build_refinance_sheet(wb: Workbook) -> Worksheet:
    ws = wb.create_sheet("Refinance")
    title_block(
        ws, "Refinance Comparison",
        f"Total costs use n*payment over the full term, a quick-comparison simplification -- "
        "expect the same small rounding-drift deviation from a full cent-rounded schedule "
        "documented in docs/new-req/004-rounding-drift-accuracy-disclosure.md.",
    )
    inp = _labeled_inputs(
        ws, 4,
        [
            ("Old: remaining balance ($)", 280000, MONEY_FMT),
            ("Old: rate (%)", 7.0, "0.00000000"),
            ("Old: remaining term (years)", 28, "0.00"),
            ("New: loan amount ($)", 280000, MONEY_FMT),
            ("New: rate (%)", 6.0, "0.00000000"),
            ("New: term (years)", 30, "0.00"),
            ("Closing costs ($)", 6000, MONEY_FMT),
        ],
    )
    out = _labeled_outputs(
        ws, 12,
        [
            ("Old monthly payment", f"=ROUND(-PMT({inp['Old: rate (%)']}/100/12,{inp['Old: remaining term (years)']}*12,{inp['Old: remaining balance ($)']}),2)", MONEY_FMT),
            ("New monthly payment", f"=ROUND(-PMT({inp['New: rate (%)']}/100/12,{inp['New: term (years)']}*12,{inp['New: loan amount ($)']}),2)", MONEY_FMT),
            ("Old total cost (remaining term)", f"=B12*{inp['Old: remaining term (years)']}*12", MONEY_FMT),
            ("New total cost (incl. closing costs)", f"=B13*{inp['New: term (years)']}*12+{inp['Closing costs ($)']}", MONEY_FMT),
            ("Net savings", "=B14-B15", MONEY_FMT),
            ("Breakeven (months)", '=IF(B12-B13<=0,"never (no monthly savings)",' + f"{inp['Closing costs ($)']}/(B12-B13))", None),
        ],
    )
    return ws


def build_compare_terms_sheet(wb: Workbook) -> Worksheet:
    ws = wb.create_sheet("CompareTerms")
    title_block(ws, "Compare Loan Offers", "Up to 4 offers, side by side.")
    header_row = 4
    headers = [None, "Offer 1", "Offer 2", "Offer 3", "Offer 4"]
    for i, h in enumerate(headers, start=1):
        if h is not None:
            ws.cell(row=header_row, column=i, value=h)
    style_header_row(ws, header_row, 1, len(headers))

    field_rows = [
        ("Loan amount ($)", [300000, 300000, 300000, 300000], MONEY_FMT, True),
        ("Rate (%)", [6.5, 6.0, 6.5, 5.75], "0.00000000", True),
        ("Term (years)", [30, 30, 15, 15], "0.00", True),
    ]
    row = header_row + 1
    refs = {}
    for label, defaults, fmt, is_input in field_rows:
        ws.cell(row=row, column=1, value=label).font = LABEL_FONT
        for c in range(2, 6):
            cell = ws.cell(row=row, column=c, value=defaults[c - 2])
            cell.font = INPUT_FONT
            cell.fill = INPUT_ROW_FILL
            cell.border = BORDER
            cell.number_format = fmt
        refs[label] = row
        row += 1

    computed_rows = [
        ("Monthly payment", lambda c: f"=ROUND(-PMT({c}{refs['Rate (%)']}/100/12,{c}{refs['Term (years)']}*12,{c}{refs['Loan amount ($)']}),2)", MONEY_FMT),
        ("Total interest", lambda c: f"={c}{row - 1}*{c}{refs['Term (years)']}*12-{c}{refs['Loan amount ($)']}", MONEY_FMT),
        ("Total of payments", lambda c: f"={c}{row-2}*{c}{refs['Term (years)']}*12", MONEY_FMT),
    ]
    for label, formula_fn, fmt in computed_rows:
        ws.cell(row=row, column=1, value=label).font = LABEL_FONT
        for c in ("B", "C", "D", "E"):
            cell = ws.cell(row=row, column="BCDE".index(c) + 2, value=formula_fn(c))
            cell.font = FORMULA_FONT
            cell.number_format = fmt
        refs[label] = row
        row += 1

    row += 1
    ws.cell(row=row, column=1, value="Lowest monthly payment").font = LABEL_FONT
    ws.cell(row=row, column=2, value=f"=INDEX($B${header_row}:$E${header_row},MATCH(MIN(B{refs['Monthly payment']}:E{refs['Monthly payment']}),B{refs['Monthly payment']}:E{refs['Monthly payment']},0))").font = FORMULA_FONT
    row += 1
    ws.cell(row=row, column=1, value="Lowest total interest").font = LABEL_FONT
    ws.cell(row=row, column=2, value=f"=INDEX($B${header_row}:$E${header_row},MATCH(MIN(B{refs['Total interest']}:E{refs['Total interest']}),B{refs['Total interest']}:E{refs['Total interest']},0))").font = FORMULA_FONT

    set_col_widths(ws, {"A": 22, "B": 14, "C": 14, "D": 14, "E": 14})
    return ws


def build_ltv_dscr_sheet(wb: Workbook) -> Worksheet:
    ws = wb.create_sheet("LTV_DSCR")
    title_block(ws, "LTV, CLTV & DSCR")

    ws["A4"] = "Loan-to-Value (LTV)"
    ws["A4"].font = Font(name=FONT_NAME, bold=True, size=12)
    ltv_in = _labeled_inputs(ws, 5, [("Loan amount ($)", 270000, MONEY_FMT), ("Property value ($)", 300000, MONEY_FMT)])
    _labeled_outputs(ws, 7, [("LTV", f"=IF({ltv_in['Property value ($)']}=0,\"n/a\",{ltv_in['Loan amount ($)']}/{ltv_in['Property value ($)']})", PCT2_FMT)])

    ws["A10"] = "Combined LTV (CLTV)"
    ws["A10"].font = Font(name=FONT_NAME, bold=True, size=12)
    cltv_in = _labeled_inputs(
        ws, 11,
        [("First lien balance ($)", 200000, MONEY_FMT), ("Second lien / HELOC ($)", 50000, MONEY_FMT), ("Property value ($)", 300000, MONEY_FMT)],
    )
    _labeled_outputs(
        ws, 14,
        [("CLTV", f"=IF({cltv_in['Property value ($)']}=0,\"n/a\",({cltv_in['First lien balance ($)']}+{cltv_in['Second lien / HELOC ($)']})/{cltv_in['Property value ($)']})", PCT2_FMT)],
    )

    ws["A17"] = "Debt Service Coverage Ratio (DSCR)"
    ws["A17"].font = Font(name=FONT_NAME, bold=True, size=12)
    dscr_in = _labeled_inputs(ws, 18, [("Net operating income ($/yr)", 120000, MONEY_FMT), ("Annual debt service ($/yr)", 90000, MONEY_FMT)])
    _labeled_outputs(
        ws, 20,
        [("DSCR", f"=IF({dscr_in['Annual debt service ($/yr)']}=0,\"n/a\",{dscr_in['Net operating income ($/yr)']}/{dscr_in['Annual debt service ($/yr)']})", "0.00")],
    )
    return ws


def build_arm_reset_sheet(wb: Workbook) -> Worksheet:
    ws = wb.create_sheet("ARM_Reset")
    title_block(ws, "ARM Rate Reset", "Pure rate-cap calculator; plug the capped rate into a Segments row to model the resulting schedule.")
    inp = _labeled_inputs(
        ws, 4,
        [
            ("Is this the first reset? (Y/N)", "Y", None),
            ("Previous rate (%)", 5.0, "0.00000000"),
            ("Initial (start) rate (%)", 4.0, "0.00000000"),
            ("Current index rate (%)", 5.5, "0.00000000"),
            ("Margin (%)", 2.75, "0.00000000"),
            ("Initial cap (pts, blank = none)", 2.0, "0.00"),
            ("Periodic cap (pts, blank = none)", 2.0, "0.00"),
            ("Lifetime cap (pts, blank = none)", 5.0, "0.00"),
            ("Remaining balance ($)", 380000, MONEY_FMT),
            ("Remaining amortization (months)", 300, NUM_FMT),
        ],
    )
    out_row = 15
    ws.cell(row=out_row, column=1, value="Fully-indexed rate (%)").font = LABEL_FONT
    ws.cell(row=out_row, column=2, value=f"={inp['Current index rate (%)']}+{inp['Margin (%)']}").font = FORMULA_FONT
    ws.cell(row=out_row, column=2).number_format = "0.00000000"

    per_reset_cap = f'IF({inp["Is this the first reset? (Y/N)"]}="Y",{inp["Initial cap (pts, blank = none)"]},{inp["Periodic cap (pts, blank = none)"]})'
    ws.cell(row=out_row + 1, column=1, value="Capped rate (%)").font = LABEL_FONT
    ws.cell(
        row=out_row + 1, column=2,
        value=(
            f"=MAX(0,MIN(IF({per_reset_cap}=\"\",B{out_row},MIN(B{out_row},{inp['Previous rate (%)']}+{per_reset_cap})),"
            f"IF({inp['Lifetime cap (pts, blank = none)']}=\"\",B{out_row},{inp['Initial (start) rate (%)']}+{inp['Lifetime cap (pts, blank = none)']})))"
        ),
    ).font = FORMULA_FONT
    ws.cell(row=out_row + 1, column=2).number_format = "0.00000000"

    ws.cell(row=out_row + 2, column=1, value="New monthly payment").font = LABEL_FONT
    ws.cell(
        row=out_row + 2, column=2,
        value=f"=ROUND(-PMT(B{out_row + 1}/100/12,{inp['Remaining amortization (months)']},{inp['Remaining balance ($)']}),2)",
    ).font = FORMULA_FONT
    ws.cell(row=out_row + 2, column=2).number_format = MONEY_FMT
    return ws


def build_fees_apr_sheet(wb: Workbook) -> Worksheet:
    ws = wb.create_sheet("Fees_APR")
    title_block(
        ws, "Fees & APR",
        "A simplified actuarial-method APR (via Excel's RATE function) -- not a certified "
        "TILA/Reg Z disclosure. See docs/new-req/002-fees-and-apr.md.",
    )
    inp = _labeled_inputs(
        ws, 4,
        [
            ("Loan amount (note amount, $)", 300000, MONEY_FMT),
            ("Annual interest rate / note rate (%)", 6.5, "0.00000000"),
            ("Term (months)", 360, NUM_FMT),
        ],
    )

    fee_header_row = 9
    ws.cell(row=fee_header_row, column=1, value="Fee name")
    ws.cell(row=fee_header_row, column=2, value="Amount")
    ws.cell(row=fee_header_row, column=3, value="Financed? (Y/N)")
    style_header_row(ws, fee_header_row, 1, 3)
    fee_examples = [("Origination fee", 3000, "N"), ("Application fee", 500, "N"), ("Appraisal", 650, "N")]
    fee_first_row = fee_header_row + 1
    fee_last_row = fee_first_row + 6
    for i in range(fee_last_row - fee_first_row + 1):
        r = fee_first_row + i
        if i < len(fee_examples):
            name, amt, fin = fee_examples[i]
            ws.cell(row=r, column=1, value=name)
            ws.cell(row=r, column=2, value=amt)
            ws.cell(row=r, column=3, value=fin)
        for c in (1, 2, 3):
            ws.cell(row=r, column=c).font = INPUT_FONT
            ws.cell(row=r, column=c).fill = INPUT_ROW_FILL
            ws.cell(row=r, column=c).border = BORDER
        ws.cell(row=r, column=2).number_format = MONEY_FMT

    fee_amt_rng = f"$B${fee_first_row}:$B${fee_last_row}"
    fee_fin_rng = f"$C${fee_first_row}:$C${fee_last_row}"

    out_row = fee_last_row + 2
    outputs = [
        ("Total fees", f"=SUM({fee_amt_rng})", MONEY_FMT),
        ("Total financed fees", f'=SUMIF({fee_fin_rng},"Y",{fee_amt_rng})', MONEY_FMT),
        ("Total cash fees", f'=SUMIF({fee_fin_rng},"<>Y",{fee_amt_rng})-SUMIF({fee_fin_rng},"",{fee_amt_rng})', MONEY_FMT),
    ]
    refs = _labeled_outputs(ws, out_row, outputs)

    r2 = out_row + len(outputs)
    ws.cell(row=r2, column=1, value="Effective loan amount").font = LABEL_FONT
    ws.cell(row=r2, column=2, value=f"={inp['Loan amount (note amount, $)']}+{refs['Total financed fees']}").font = FORMULA_FONT
    ws.cell(row=r2, column=2).number_format = MONEY_FMT
    ws.cell(row=r2 + 1, column=1, value="Monthly payment").font = LABEL_FONT
    ws.cell(row=r2 + 1, column=2, value=f"=ROUND(-PMT({inp['Annual interest rate / note rate (%)']}/100/12,{inp['Term (months)']},B{r2}),2)").font = FORMULA_FONT
    ws.cell(row=r2 + 1, column=2).number_format = MONEY_FMT
    ws.cell(row=r2 + 2, column=1, value="Amount financed").font = LABEL_FONT
    ws.cell(row=r2 + 2, column=2, value=f"=B{r2}-{refs['Total cash fees']}").font = FORMULA_FONT
    ws.cell(row=r2 + 2, column=2).number_format = MONEY_FMT
    ws.cell(row=r2 + 3, column=1, value="APR (%)").font = LABEL_FONT
    ws.cell(
        row=r2 + 3, column=2,
        value=f"=IFERROR(RATE({inp['Term (months)']},-B{r2 + 1},B{r2 + 2})*12*100,\"n/a -- fees too large relative to loan\")",
    ).font = FORMULA_FONT
    ws.cell(row=r2 + 3, column=2).number_format = "0.00000000"
    ws.cell(row=r2 + 4, column=1, value="APR minus note rate (pts)").font = LABEL_FONT
    ws.cell(row=r2 + 4, column=2, value=f"=IFERROR(B{r2 + 3}-{inp['Annual interest rate / note rate (%)']},\"n/a\")").font = FORMULA_FONT
    ws.cell(row=r2 + 4, column=2).number_format = "0.00000000"
    return ws


def build_dti_affordability_sheet(wb: Workbook) -> Worksheet:
    ws = wb.create_sheet("DTI_Affordability")
    title_block(ws, "DTI & Affordability")

    ws["A4"] = "Check my DTI"
    ws["A4"].font = Font(name=FONT_NAME, bold=True, size=12)
    dti_in = _labeled_inputs(
        ws, 5,
        [
            ("Gross monthly income ($)", 9000, MONEY_FMT),
            ("Full housing payment ($/mo)", 2200, MONEY_FMT),
            ("Other monthly debts ($)", 500, MONEY_FMT),
            ("Front-end max (%)", 28, "0.00"),
            ("Back-end max (%)", 36, "0.00"),
        ],
    )
    dti_out = _labeled_outputs(
        ws, 11,
        [
            ("Front-end DTI", f"={dti_in['Full housing payment ($/mo)']}/{dti_in['Gross monthly income ($)']}", PCT2_FMT),
            (
                "Back-end DTI",
                f"=({dti_in['Full housing payment ($/mo)']}+{dti_in['Other monthly debts ($)']})/{dti_in['Gross monthly income ($)']}",
                PCT2_FMT,
            ),
            ("Front-end OK?", f"=B11<={dti_in['Front-end max (%)']}/100", None),
            ("Back-end OK?", f"=B12<={dti_in['Back-end max (%)']}/100", None),
            ("Qualifies?", "=AND(B13,B14)", None),
        ],
    )

    ws["A18"] = "How much can I afford"
    ws["A18"].font = Font(name=FONT_NAME, bold=True, size=12)
    aff_in = _labeled_inputs(
        ws, 19,
        [
            ("Gross monthly income ($)", 9000, MONEY_FMT),
            ("Other monthly debts ($)", 500, MONEY_FMT),
            ("Annual interest rate (%)", 6.5, "0.00000000"),
            ("Term (months)", 360, NUM_FMT),
            ("Est. non-P&I housing costs ($/mo)", 400, MONEY_FMT),
            ("Front-end max (%)", 28, "0.00"),
            ("Back-end max (%)", 36, "0.00"),
            ("Down payment ($)", 60000, MONEY_FMT),
        ],
    )
    fr_allow = f"{aff_in['Gross monthly income ($)']}*{aff_in['Front-end max (%)']}/100-{aff_in['Est. non-P&I housing costs ($/mo)']}"
    bk_allow = (
        f"{aff_in['Gross monthly income ($)']}*{aff_in['Back-end max (%)']}/100"
        f"-{aff_in['Other monthly debts ($)']}-{aff_in['Est. non-P&I housing costs ($/mo)']}"
    )
    aff_row = 28
    ws.cell(row=aff_row, column=1, value="Front-end allowance").font = LABEL_FONT
    ws.cell(row=aff_row, column=2, value=f"={fr_allow}").font = FORMULA_FONT
    ws.cell(row=aff_row, column=2).number_format = MONEY_FMT
    ws.cell(row=aff_row + 1, column=1, value="Back-end allowance").font = LABEL_FONT
    ws.cell(row=aff_row + 1, column=2, value=f"={bk_allow}").font = FORMULA_FONT
    ws.cell(row=aff_row + 1, column=2).number_format = MONEY_FMT
    ws.cell(row=aff_row + 2, column=1, value="Max P&I payment").font = LABEL_FONT
    ws.cell(row=aff_row + 2, column=2, value=f"=ROUND(MAX(0,MIN(B{aff_row},B{aff_row + 1})),2)").font = FORMULA_FONT
    ws.cell(row=aff_row + 2, column=2).number_format = MONEY_FMT
    ws.cell(row=aff_row + 3, column=1, value="Binding constraint").font = LABEL_FONT
    ws.cell(row=aff_row + 3, column=2, value=f'=IF(B{aff_row}<=B{aff_row + 1},"front_end","back_end")').font = FORMULA_FONT
    ws.cell(row=aff_row + 4, column=1, value="Max loan amount").font = LABEL_FONT
    ws.cell(
        row=aff_row + 4, column=2,
        value=f"=IF(B{aff_row + 2}=0,0,ROUND(PV({aff_in['Annual interest rate (%)']}/100/12,{aff_in['Term (months)']},-B{aff_row + 2}),2))",
    ).font = FORMULA_FONT
    ws.cell(row=aff_row + 4, column=2).number_format = MONEY_FMT
    ws.cell(row=aff_row + 5, column=1, value="Max home price").font = LABEL_FONT
    ws.cell(row=aff_row + 5, column=2, value=f"=B{aff_row + 4}+{aff_in['Down payment ($)']}").font = FORMULA_FONT
    ws.cell(row=aff_row + 5, column=2).number_format = MONEY_FMT
    ws.cell(row=aff_row + 6, column=1, value="Qualifies?").font = LABEL_FONT
    ws.cell(row=aff_row + 6, column=2, value=f"=B{aff_row + 2}>0").font = FORMULA_FONT
    return ws


def build_readme_sheet(wb: Workbook) -> Worksheet:
    ws = wb.create_sheet("README")
    ws["A1"] = "COB Calculator (Excel)"
    ws["A1"].font = TITLE_FONT
    ws["A2"] = "A formula-driven Excel port of the COB segmented mortgage / cost-of-borrowing engine."
    ws["A2"].font = NOTE_FONT

    rows = [
        "",
        "COLOR LEGEND",
        "Blue text, yellow-tinted cells = INPUT -- edit these.",
        "Black text = COMPUTED formula -- do not edit; it will recalculate automatically.",
        "",
        "SHEETS",
        "Segments, LumpSums, Overrides, PMI_Costs -- inputs for the segmented mortgage engine.",
        "Schedule, Summary, YearlySummary -- computed output of the segmented engine (do not edit).",
        "PaymentFrequency, ExtraPayment -- standalone single-loan calculators (own inputs).",
        "Points, Refinance, CompareTerms, LTV_DSCR, ARM_Reset, Fees_APR, DTI_Affordability -- standalone calculators.",
        "",
        "KEY ASSUMPTIONS (see docs/new-req/ in the source repo for full specs)",
        f"- Segmented Schedule is bounded to {MAX_SCHEDULE_ROWS} rows (30 years monthly). Extend by selecting the",
        "  last row's formulas and copying down if you need a longer combined schedule.",
        f"- PaymentFrequency is bounded to {MAX_FREQ_ROWS} periods (30 years at weekly, the densest cadence).",
        "- Lump sums apply only at a segment/renewal boundary (not mid-segment), matching the engine's v1 scope.",
        "- Fees_APR computes a simplified actuarial-method APR (via Excel's RATE function) -- not a certified",
        "  TILA/Reg Z disclosure.",
        "- Refinance/CompareTerms use n*payment for total cost (a quick-comparison simplification) rather than",
        "  a full cent-rounded schedule -- expect a few dollars of difference from the Schedule sheet's own",
        "  totals on long terms. This is the SAME rounding-drift behavior documented for the Python/TypeScript",
        "  engines in docs/new-req/004-rounding-drift-accuracy-disclosure.md: intermediate/aggregate figures from",
        "  an unrounded closed-form calculation can differ from a per-period cent-rounded schedule by a few",
        "  dollars on a long loan -- not a defect in either calculation.",
        "",
        "VERIFICATION",
        "Every formula in this workbook was cross-checked against cob_calculator (the Python reference engine)",
        "for representative scenarios covering renewals, lump sums, manual overrides, interest-only, balloon,",
        "PMI auto-drop, recurring costs, and every standalone calculator -- see the build/verification session",
        "for details. Recalculated with LibreOffice via the xlsx skill's recalc.py: 0 formula errors.",
    ]
    for i, text in enumerate(rows):
        r = 4 + i
        # Never write an empty string as a cell value: openpyxl serializes a str
        # value as t="inlineStr", but an EMPTY string produces a self-closed
        # <c t="inlineStr" /> with no <is> child -- schema-invalid per OOXML
        # (t="inlineStr" requires an <is> element), which LibreOffice tolerates
        # silently but Excel's stricter parser flags as "a problem with some
        # content" requiring repair. A blank spacer row should have no value at
        # all (None), not an empty string.
        cell = ws.cell(row=r, column=1, value=(text if text else None))
        if text.isupper() and text != "":
            cell.font = Font(name=FONT_NAME, bold=True, size=12)
        else:
            cell.font = Font(name=FONT_NAME)
    ws.column_dimensions["A"].width = 110
    return ws


def _scrub_empty_string_cells(wb: Workbook) -> None:
    """Defensive final pass: openpyxl serializes a str cell value as
    t="inlineStr", but an EMPTY string ("") produces a self-closed
    <c t="inlineStr" /> with no <is> child -- schema-invalid per OOXML (t="inlineStr"
    requires an <is> element). LibreOffice tolerates this silently; Microsoft Excel's
    stricter parser flags it as "a problem with some content," forcing a repair
    prompt on open. This was a real, confirmed bug in this workbook (5 cells across
    the README and CompareTerms sheets), not a hypothetical -- found by directly
    inspecting the saved XML after Excel refused to open the file cleanly even
    post the (necessary, but not sufficient on its own) fix of shipping the
    pristine openpyxl output instead of the LibreOffice-recalculated one.

    Rather than trust every call site above to never pass "" as a value (this
    class of bug can easily reappear in a future edit -- e.g. a spacer row, a
    blank table header), this scrubs every worksheet's every cell once, right
    before saving: any cell whose value is exactly "" is reset to None (a
    genuinely empty cell), which openpyxl always serializes safely.
    """
    for ws in wb.worksheets:
        for row in ws.iter_rows():
            for cell in row:
                if cell.value == "":
                    cell.value = None


if __name__ == "__main__":
    out_path = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).parent / "COB_Calculator.xlsx"
    wb = Workbook()
    wb.remove(wb.active)

    build_readme_sheet(wb)
    build_segments_sheet(wb)
    build_lump_sums_sheet(wb)
    build_overrides_sheet(wb)
    build_pmi_costs_sheet(wb)
    build_schedule_sheet(wb)
    build_summary_sheet(wb)
    build_yearly_summary_sheet(wb)
    build_payment_frequency_sheet(wb)
    build_extra_payment_sheet(wb)
    build_points_sheet(wb)
    build_refinance_sheet(wb)
    build_compare_terms_sheet(wb)
    build_ltv_dscr_sheet(wb)
    build_arm_reset_sheet(wb)
    build_fees_apr_sheet(wb)
    build_dti_affordability_sheet(wb)

    _scrub_empty_string_cells(wb)

    wb.save(out_path)
    print(f"wrote {out_path}")
