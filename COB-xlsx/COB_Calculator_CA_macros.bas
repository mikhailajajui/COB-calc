Attribute VB_Name = "COB_CA_Macros"
Option Explicit

' =====================================================================
' COB_CA_Macros -- presentation-layer VBA for the Canadian COB
' calculator (see docs/new-req/006-cost-of-borrowing-disclosure.md and
' COB-xlsx/build_workbook_ca.py).
'
' These macros are ADDITIVE ONLY: they read cells the formula-driven
' sheets (COB_CA, COB_CA_Schedule) already compute and build a chart /
' export a PDF from them. No macro here writes into an input or formula
' cell -- the workbook's correctness still comes entirely from the
' verified formulas in build_workbook_ca.py; this module is presentation
' layer, nothing more.
'
' HOW TO INSTALL: see COB-xlsx/MANUAL.md, "COB_CA macros" section, for
' step-by-step import instructions (this file is meant to be imported via
' the VBA editor's File > Import File, not opened directly).
'
' Cell/sheet references below match build_workbook_ca.py's generated
' layout as of the version this module was written against:
'   COB_CA!B58  = term length, periods (schedule bound, clamped)
'   COB_CA!B65  = number_of_payments (this term's actual payment count)
'   COB_CA_Schedule: header row 4, data starts row 5;
'     column A = Period #, B = Period Date, C = Beginning Balance,
'     D = Interest, E = Principal, F = Payment, G = Ending Balance,
'     H = Counted in term totals?
' If build_workbook_ca.py's layout ever changes, the constants just below
' must be updated to match -- see MANUAL.md's "Regenerating after macros
' are installed" section for the full story on why this can't just be
' re-derived automatically the way the formulas are.
' =====================================================================

Private Const INPUTS_SHEET As String = "COB_CA"
Private Const SCHEDULE_SHEET As String = "COB_CA_Schedule"
Private Const CHART_SHEET As String = "COB_CA_Chart"
Private Const NUM_PAYMENTS_CELL As String = "B65"
Private Const SCHEDULE_FIRST_DATA_ROW As Long = 5
Private Const SCHEDULE_COL_PERIODNUM As String = "A"
Private Const SCHEDULE_COL_INTEREST As String = "D"
Private Const SCHEDULE_COL_PRINCIPAL As String = "E"
Private Const SCHEDULE_COL_ENDING As String = "G"

' Auto_Open is a special Excel macro name: a Sub with exactly this name in
' any standard module runs automatically whenever the workbook is opened
' (this is the classic pre-Workbook_Open auto-macro mechanism, and it
' works from a plain imported .bas module with no ThisWorkbook editing
' required). This is what makes the chart refresh itself on open without
' any extra manual VBA setup beyond the one-time import.
Sub Auto_Open()
    On Error Resume Next
    BuildScheduleChart
    On Error GoTo 0
End Sub

' Builds (or rebuilds) a stacked Interest/Principal column chart plus a
' Remaining Balance line on a secondary axis, sized to exactly this
' term's actual payment count (COB_CA!B65) -- not COB_CA_Schedule's full
' 520-row bound, which would otherwise chart a long flat tail of frozen
' or zero rows past the term boundary (see build_workbook_ca.py's
' self-stabilizing schedule design). Safe to re-run any time, e.g. after
' changing Term years/months or Payment frequency on COB_CA -- it clears
' its own previously-built chart first rather than stacking duplicates,
' so this is also what a "Refresh Chart" button should call.
Sub BuildScheduleChart()
    Dim wsIn As Worksheet, wsSched As Worksheet, wsChart As Worksheet
    Dim nPayments As Long, lastRow As Long
    Dim co As ChartObject, existing As ChartObject
    Dim cht As Chart
    Dim serInterest As Series, serPrincipal As Series, serBalance As Series

    On Error GoTo Fail
    Set wsIn = ThisWorkbook.Worksheets(INPUTS_SHEET)
    Set wsSched = ThisWorkbook.Worksheets(SCHEDULE_SHEET)

    nPayments = CLng(wsIn.Range(NUM_PAYMENTS_CELL).Value)
    If nPayments < 1 Then nPayments = 1
    lastRow = SCHEDULE_FIRST_DATA_ROW + nPayments - 1

    ' Get or create the dedicated chart sheet. build_workbook_ca.py never
    ' creates or touches a sheet named COB_CA_Chart, by design -- so
    ' regenerating COB_CA/COB_CA_Schedule's formulas (rerunning the build
    ' script against this same .xlsm, see MANUAL.md) never disturbs this
    ' sheet or the chart living on it.
    On Error Resume Next
    Set wsChart = ThisWorkbook.Worksheets(CHART_SHEET)
    On Error GoTo Fail
    If wsChart Is Nothing Then
        Set wsChart = ThisWorkbook.Worksheets.Add(After:=wsSched)
        wsChart.Name = CHART_SHEET
    End If

    ' Idempotent refresh: clear any chart this macro previously built here.
    For Each existing In wsChart.ChartObjects
        existing.Delete
    Next existing

    Set co = wsChart.ChartObjects.Add(Left:=10, Top:=10, Width:=760, Height:=420)
    Set cht = co.Chart
    cht.ChartType = xlColumnStacked

    Set serInterest = cht.SeriesCollection.NewSeries
    serInterest.Name = "Interest"
    serInterest.Values = wsSched.Range( _
        SCHEDULE_COL_INTEREST & SCHEDULE_FIRST_DATA_ROW & ":" & SCHEDULE_COL_INTEREST & lastRow)
    serInterest.XValues = wsSched.Range( _
        SCHEDULE_COL_PERIODNUM & SCHEDULE_FIRST_DATA_ROW & ":" & SCHEDULE_COL_PERIODNUM & lastRow)

    Set serPrincipal = cht.SeriesCollection.NewSeries
    serPrincipal.Name = "Principal"
    serPrincipal.Values = wsSched.Range( _
        SCHEDULE_COL_PRINCIPAL & SCHEDULE_FIRST_DATA_ROW & ":" & SCHEDULE_COL_PRINCIPAL & lastRow)

    Set serBalance = cht.SeriesCollection.NewSeries
    serBalance.Name = "Remaining Balance"
    serBalance.Values = wsSched.Range( _
        SCHEDULE_COL_ENDING & SCHEDULE_FIRST_DATA_ROW & ":" & SCHEDULE_COL_ENDING & lastRow)
    serBalance.ChartType = xlLine
    serBalance.AxisGroup = xlSecondary

    cht.HasTitle = True
    cht.ChartTitle.Text = "COB_CA amortization -- current contract term (" & nPayments & " payments)"
    cht.Axes(xlCategory).HasTitle = True
    cht.Axes(xlCategory).AxisTitle.Text = "Period #"
    cht.Axes(xlValue, xlPrimary).HasTitle = True
    cht.Axes(xlValue, xlPrimary).AxisTitle.Text = "Interest / Principal ($)"
    On Error Resume Next
    cht.Axes(xlValue, xlSecondary).HasTitle = True
    cht.Axes(xlValue, xlSecondary).AxisTitle.Text = "Remaining Balance ($)"
    On Error GoTo Fail
    cht.HasLegend = True
    cht.Legend.Position = xlLegendPositionBottom

    Exit Sub
Fail:
    MsgBox "BuildScheduleChart couldn't run: " & Err.Description & vbCrLf & _
           "(Check that the " & INPUTS_SHEET & " and " & SCHEDULE_SHEET & _
           " sheets still exist with their expected layout -- see the " & _
           "comment block at the top of this module.)", vbExclamation
End Sub

' "Recalculate & Refresh Chart" button target. Excel already recalculates
' automatically, so this is a convenience/reassurance action -- forces a
' full recalculation (useful after pasting several changed inputs at
' once) and then rebuilds the chart to match the (possibly now different)
' term length.
Sub RefreshAll()
    Application.CalculateFullRebuild
    BuildScheduleChart
End Sub

' Exports a short PDF of COB_CA's selection block and term-scoped outputs
' -- a real, tangible "disclosure summary" a user can attach to an email,
' which the formulas alone can't produce. Two separate print areas (the
' Flow/Product/Rate-type + common-inputs block, and the Outputs block)
' keep it to one short page each rather than force-shrinking the whole
' sheet onto a single unreadable page. Prompts for a save location so
' re-running it never silently overwrites a prior export.
Sub PrintDisclosureSummary()
    Dim wsIn As Worksheet
    Dim origPrintArea As String
    Dim fName As Variant

    On Error GoTo Fail
    Set wsIn = ThisWorkbook.Worksheets(INPUTS_SHEET)
    origPrintArea = wsIn.PageSetup.PrintArea

    wsIn.PageSetup.PrintArea = "$A$1:$D$23,$A$64:$D$72"
    wsIn.PageSetup.Orientation = xlPortrait
    wsIn.PageSetup.FitToPagesWide = 1

    fName = Application.GetSaveAsFilename( _
        InitialFileName:="COB_CA_disclosure_summary.pdf", _
        FileFilter:="PDF Files (*.pdf), *.pdf")
    If fName <> False Then
        wsIn.ExportAsFixedFormat Type:=xlTypePDF, Filename:=fName, _
            Quality:=xlQualityStandard, OpenAfterPublish:=True
    End If

    wsIn.PageSetup.PrintArea = origPrintArea
    Exit Sub
Fail:
    MsgBox "PrintDisclosureSummary couldn't run: " & Err.Description, vbExclamation
    On Error Resume Next
    wsIn.PageSetup.PrintArea = origPrintArea
End Sub
