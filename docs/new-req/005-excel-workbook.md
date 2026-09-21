# 005 — Excel Workbook (Full Segmented Engine)

## Problem

The engine exists as TypeScript (`COB-ts`) and Python/Streamlit (`COB-py`). Some
users want the same calculator as a plain Excel workbook -- no code, no server,
just formulas they can inspect, edit, and hand to someone else. This spec
documents the design of that third implementation, `COB-xlsx/COB_Calculator.xlsx`
(built by `COB-xlsx/build_workbook.py`), so the same design could be reproduced
in Google Sheets or any other spreadsheet tool.

## Why Excel formulas are a fundamentally different paradigm

The segment/mortgage engine's logic (segments stitched end-to-end, lump sums,
manual overrides, PMI auto-drop, recurring-cost escalation) is imperative in
every other implementation: loops, early returns, mutation. Excel/LibreOffice
have no real control flow -- every cell is a pure expression evaluated once per
recalculation. The design challenge was translating each piece of imperative
logic into an equivalent declarative formula, without `XLOOKUP`/`FILTER`/
`LAMBDA`-class dynamic-array functions (LibreOffice, the verification engine
used here, doesn't evaluate them reliably from an openpyxl-written file — see
the xlsx skill's guidance).

## Row-bounding, not loops

Every "runs until payoff" computation (the segmented Schedule, PaymentFrequency,
ExtraPayment's "with extra" column) is expressed as a **fixed-size grid**
(`MAX_SCHEDULE_ROWS = 360`, `MAX_FREQ_ROWS = 1560`), with formulas that
**self-stabilize to exactly $0** once a loan is paid off, rather than being
dynamically sized:

```
would_pay_off = (balance - (payment - interest)) <= 0   [rounded]
principal = IF(would_pay_off, balance, payment - interest)
ending_balance = IF(would_pay_off, 0, balance - principal)
```

Once `ending_balance` hits exactly `0`, every subsequent row's `beginning_balance`
is `0`, `interest = 0`, `would_pay_off` is trivially true forever (0 minus a
positive payment is always `<= 0`), so principal/payment/ending_balance all stay
`0` indefinitely. This is the same technique validated in the segmented Schedule
sheet and reused in PaymentFrequency and ExtraPayment. **A caught bug**: the
segmented Schedule's "force-clear the scheduled final row of a bounded segment"
rule (needed because cent-rounding can leave a few dollars of residual instead
of landing on exactly `$0`) was initially implemented only for the segmented
engine and was missing from ExtraPayment's baseline column — caught by the
Python-engine cross-check (a $4.71 residual at month 360 on a textbook
$300K/6.5%/30yr loan) and fixed before shipping.

## Column layout as a single source of truth

The Schedule sheet's ~32 columns are defined once, as an ordered list
(`SCHEDULE_COLUMNS` in `build_workbook.py`), and every cross-sheet reference
(Segments' lookups into Schedule, Summary's aggregations, YearlySummary's
per-year rollups) goes through a `schedule_col(name)` / `schedule_range(name)`
helper rather than a hardcoded column letter. **A caught bug**: an early draft
hardcoded `Schedule!$K:$K` in the Segments sheet expecting it to mean
"EndingBalance," from a version of the layout where that was true; by the time
the Schedule sheet was finalized, column K had become `SegKnownLength` instead.
This silently produced a wrong "segment 2 monthly payment" ($0.43 instead of
~$1,269) with **zero formula errors** (LibreOffice happily evaluated the wrong
reference) -- caught only by comparing against the Python engine's numbers, not
by the recalc/error-check step. This is the single strongest argument in this
spec for cross-engine validation over "the formulas evaluate cleanly."

## Segment/payment-number bookkeeping without dynamic arrays

- **Which segment does payment N belong to?** `SUMPRODUCT((starts<>"")*(starts<=N))`
  -- a count of how many segments have started by payment N, robust to blank
  trailing rows (unlike `MATCH(..., 1)`, which requires strictly ascending data
  including the blanks, which trailing blanks violate).
- **What's the last payment number in segment J (for an open-ended final
  segment with no known length)?** `SUMPRODUCT(MAX((segment_index_range=J)*(payment_number_range)))`
  -- finds the max payment number among matching rows without an array-entered
  (Ctrl+Shift+Enter) formula. An earlier draft used `MATCH(2, 1/(range=cond), 1)`,
  a classic "last row matching a condition" trick that **requires** CSE entry to
  evaluate correctly; written as a plain formula (as openpyxl always writes),
  it's unreliable. Replaced before it was ever tested against real data.
- **PMI dropped at which payment?** A per-row `PmiJustDropped` boolean helper
  column (`AND(NOT(this row's PmiActive), previous row's PmiActive)`), then a
  plain `MATCH(TRUE, that column, 0)` -- exact match against a materialized
  column, no array entry needed.

## Date arithmetic matches the JS/Python engines' rollover exactly

Excel's `EDATE()` clamps to the end of the target month (Jan 31 + 1 month =
Feb 28), which diverges from the JS/Python engines' `add_months` (Jan 31 + 1
month = Mar 2, matching `Date.setMonth`'s day-overflow rollover — see
`COB-py/cob_calculator/dates.py`). To keep the three implementations in
agreement, every date formula in this workbook uses the explicit
first-of-month-plus-day-offset construction instead of `EDATE`:

```
DATE(YEAR(start)+INT((MONTH(start)-1+n)/12), MOD(MONTH(start)-1+n,12)+1, 1) + (DAY(start)-1)
```

## Lump sums mutate the boundary row's displayed principal/payment, not just its balance

Mirroring `mortgage.py`'s `_stitch_segments` (which mutates the boundary row's
`principal_portion`/`payment_amount` after computing the lump sum, not only its
`remaining_balance`), the Schedule sheet keeps explicit pre-lump-sum helper
columns (`PrincipalPortion`, `PaymentAmount`, marked as internal/helper) and
separate **displayed** `PrincipalFinal`/`PaymentFinal` columns
(`= pre_lump_value + lump_sum_applied_this_row`). **A caught bug**: the first
draft only added the lump sum into the ending-balance calculation and displayed
the pre-lump principal/payment directly -- correct final balance, wrong
displayed principal and payment on the boundary row. Caught by the same
cross-check (payment 60 showed principal $429.84 instead of $20,429.84).

## APR via Excel's native `RATE()`, not a hand-rolled bisection

`COB-py/cob_calculator/apr.py` implements its own bisection solver because
Python has no built-in annuity-rate solver. Excel/LibreOffice already have one:
`RATE(nper, pmt, pv)` solves exactly the equation the APR calculation needs
(the periodic rate at which `pv` equals the present value of `nper` payments of
`pmt`). `Fees_APR!B24` is simply
`=RATE(term_months, -monthly_payment, amount_financed)*12*100`, verified against
the Python engine's bisection result to 8 decimal places on every case tested
(this is a case where the spreadsheet tool's native primitive is simply less
code and no less correct than the from-scratch solver another platform needs).

## Affordability's max-loan-amount via `PV()`, not a hand-rolled inverse

Likewise, `dti.py`'s closed-form inversion of the annuity formula
(`max_loan_amount = payment * ((1+r)^n - 1) / (r * (1+r)^n)`) is exactly what
Excel's `PV(rate, nper, -payment)` computes natively.

## Scope: what's out

- Payment-frequency yearly summaries (a "year" doesn't correspond to a clean
  row-count block at biweekly/weekly cadence) -- same documented gap as
  spec 001.
- Mid-segment lump sums, financed-fee-added-to-principal as a first-class
  Segments field, HELOC draws, day-count/odd-days interest, arbitrary-date
  payoff quotes -- same gaps documented in `docs/new-req/README.md`, not
  addressed by any of the three implementations yet.
- Refinance/CompareTerms use `n * payment` for total cost (not a full
  cent-rounded schedule) -- a deliberate quick-comparison simplification. Expect
  the same few-dollars rounding-drift deviation from a full schedule's own
  totals documented in spec 004, on long terms.

## Verification methodology

Every sheet was checked against `cob_calculator` (the Python reference engine)
for a representative scenario, not just recalculated for formula errors:

1. **Formula errors**: `recalc.py` (LibreOffice) — 0 errors across ~22,800
   formulas, required but not sufficient (see the two caught bugs above, both
   of which recalculated cleanly while being wrong).
2. **Value agreement, full schedule**: every one of 300 rows' payment date,
   remaining balance, interest, principal, and payment compared exactly (within
   $0.02) against `summarize_mortgage()` for a scenario covering a renewal,
   a lump sum, a manual override, PMI with auto-drop, and escalating recurring
   costs.
3. **Value agreement, every standalone tool**: Points, Refinance, CompareTerms,
   LTV/CLTV/DSCR, ARM reset, Fees/APR, DTI/affordability, PaymentFrequency (628
   biweekly rows checked exactly), and ExtraPayment all matched their Python
   equivalents (exactly, or within the already-documented rounding-drift
   tolerance for the two sheets that deliberately use `n * payment`).

## A third (and fourth) caught bug: Excel refused to open the file at all

After shipping, the user's actual Microsoft Excel showed "We found a problem
with some content in 'COB_Calculator.xlsx'... Do you want us to try to recover
as much as we can?" on open -- despite `recalc.py` reporting
`"status": "success", "total_errors": 0`. Two separate issues contributed,
found by direct forensic inspection of the saved XML (unzipping the `.xlsx` and
reading the raw part files) rather than by guessing:

**Bug 3 -- don't ship the LibreOffice-recalculated file.** `recalc.py` (per the
xlsx skill) rewrites the file it's given *in place* -- necessary for it to
verify anything, but it means the artifact on disk afterward is no longer pure
`openpyxl` output; it's been through LibreOffice's own xlsx writer, which
re-serializes some styles differently. Diffing `xl/styles.xml` between a fresh
`build_workbook.py` output and the same file after `recalc.py` showed a clean
`yyyy-mm-dd` date format became `yyyy/mm/dd`, and a clean
`$#,##0.00;($#,##0.00);-` money format became a garbled, differently-quoted/
escaped equivalent. This was the first hypothesis and the first fix attempt:
verify on a disposable copy (`cp` first, run `recalc.py` on the copy), ship the
pristine `build_workbook.py` output, never the LibreOffice-touched one. **This
alone did not fix the repair prompt** -- the user hit it again on the "fixed"
file, proving this bug, while real, was not the (or not the only) cause.

**Bug 4 -- the actual cause: empty-string cell values serialize as
schema-invalid XML.** Unzipping the pristine (never-LibreOffice-touched) file
and grep-ing the raw worksheet XML for self-closed cells
(`<c ... t="inlineStr" />`, no `<is>` child) found 5 of them, across the README
and CompareTerms sheets. Per OOXML (ECMA-376 §18.3.1.4), a cell with
`t="inlineStr"` **requires** an `<is>` (inline string) child element containing
the actual text; a bare type declaration with no content is schema-invalid.
LibreOffice's lenient parser accepted these silently (which is exactly why
`recalc.py`'s "zero errors" gave false confidence); Excel's stricter parser
does not. Root cause in `build_workbook.py`: two spots wrote a literal empty
string (`""`) as a cell's *value* to represent a blank spacer row/header cell
(`ws.cell(row=r, column=1, value="")`) -- openpyxl serializes any `str` value,
including an empty one, as `t="inlineStr"`, but apparently only writes the
`<is>` child when the string is truthy, leaving the empty-string case
schema-invalid. The fix has two layers: (1) the two call sites now pass `None`
instead of `""` for a genuinely blank cell; (2) a new defensive pass,
`_scrub_empty_string_cells()`, runs over every cell in every sheet immediately
before `wb.save()`, resetting any lingering `""` value to `None` -- so this
exact class of bug cannot silently reappear from a future edit (a new spacer
row, a new blank table header) without another forensic XML dig to catch it.

## A fifth caught bug: `SUMIFS`' sum_range argument cannot be an arithmetic expression

Fixing bug 4 did not fix the repair prompt -- the user hit it again, proving
the empty-inlineStr issue, while real, still wasn't the (only) cause. Rather
than guess a third time, verification escalated to ground truth in two steps:

1. **Real OOXML schema validation**, not ad-hoc regex forensics: downloaded the
   actual ECMA-376 XSD schemas (`sml-sheet.xsd` and its dependencies, via a
   public GitHub mirror) and ran `xmllint --schema` against every one of the 17
   worksheet parts plus `styles.xml` and `workbook.xml`. Every part validated
   cleanly except one confirmed false positive (the mirror's schema doesn't
   import the standard W3C `xml:` namespace, so it doesn't recognize the
   completely valid `xml:space="preserve"` attribute openpyxl legitimately
   writes on strings with leading/trailing whitespace). This ruled out further
   schema-level guessing -- the file's XML was, in fact, valid.
2. **Excel's own repair log**, obtained by letting the user click "Yes" to
   recover: `Removed Records: Formula from /xl/worksheets/sheet7.xml part`.
   Cross-referencing `xl/_rels/workbook.xml.rels` (`sheet7.xml` = `rId9` =
   Summary) pointed at the exact sheet. Reading every formula actually written
   to that sheet (not re-deriving them from memory) found the culprit:
   ```
   =IFERROR(INDEX(...), IF(SUMIFS(Schedule!$AG$5:$AG$364*1, Schedule!$AB$5:$AB$364, TRUE) > 0, ...))
   ```
   `SUMIFS`' `sum_range` argument (its first argument) must be an actual range
   reference -- `Schedule!$AG$5:$AG$364*1` is an arithmetic expression (range
   times 1, meant to coerce a boolean TRUE/FALSE column to 1/0 for summing),
   which is invalid there. `SUMPRODUCT`, by contrast, is specifically designed
   to accept array expressions as arguments and was used correctly everywhere
   else in the workbook -- this was the one place `SUMIFS` was used with an
   arithmetic argument instead. LibreOffice's parser tolerated it (coercing it
   somehow); Excel's could not, and silently dropped the formula rather than
   refuse to open the file outright.

   Fixed by replacing the invalid `SUMIFS(range*1, ...)` with
   `SUMPRODUCT((active_range)*(pmi_active_range))>0` -- semantically identical,
   syntactically valid. A follow-up static sweep of every formula in the
   workbook (regex-matching every `SUMIFS`/`COUNTIFS`/`SUMIF`/`COUNTIF` call's
   arguments for an arithmetic operator applied directly to a range reference)
   confirmed this was the *only* instance of the pattern -- not just patched
   where found, but checked for recurrence across all ~22,800 formulas.

## The underlying lesson, three times over

Every one of the bugs in this document (two formula-logic bugs, the
LibreOffice-recalculated-file issue, the empty-inlineStr-cell issue, and this
`SUMIFS` argument issue) passed `recalc.py` with `"total_errors": 0`. Each was
only caught by a *different* check: cross-validating actual values against the
Python engine; diffing raw XML between two versions of the file; validating
against the real OOXML schema; and finally, reading Excel's own repair log
after the fact. **A clean automated check only proves what it specifically
checks.** `recalc.py` proves formulas evaluate under LibreOffice's parser; it
says nothing about Excel's stricter formula-argument validation, nor about
OOXML schema conformance Excel enforces more strictly than LibreOffice does.
There was no substitute, in the end, for opening the actual file in the actual
target application and reading what it reported.
