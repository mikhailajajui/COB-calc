# COB Calculator Manual

A sheet-by-sheet reference for `COB_Calculator.xlsx` — a plain-formula, no-macro Excel workbook for mortgage and cost-of-borrowing calculations: segmented renewals, lump sums, PMI, bank-statement reconciliation, and nine standalone tools. This manual walks through every sheet: what to type in, what comes back out, and five worked examples using the numbers already sitting in the file.

It also covers `COB_Calculator_CA.xlsx`, a separate, sibling workbook for the **Canadian** Cost-of-Borrowing disclosure calculator (semi-annual mortgage compounding, trigger rate, contract-term-vs-amortization) — see [COB_CA](#cob_ca) below.

## Contents

- [Quick start](#quick-start)
- [Color legend](#color-legend)
- **The engine**: [Segments](#segments) · [LumpSums](#lumpsums) · [Overrides](#overrides) · [PMI_Costs](#pmi_costs) · [Schedule](#schedule) · [Summary](#summary) · [YearlySummary](#yearlysummary)
- **Standalone tools**: [PaymentFrequency](#paymentfrequency) · [ExtraPayment](#extrapayment) · [Points](#points) · [Refinance](#refinance) · [CompareTerms](#compareterms) · [LTV_DSCR](#ltv_dscr) · [ARM_Reset](#arm_reset) · [Fees_APR](#fees_apr) · [DTI_Affordability](#dti_affordability)
- **Canadian COB workbook**: [COB_CA](#cob_ca) · [COB_CA_Schedule](#cob_ca_schedule) · [COB_CA macros (optional, VBA)](#cob_ca-macros-optional-vba)
- [Worked examples](#worked-examples)
- [Limits & troubleshooting](#limits--troubleshooting)
- [FAQ](#faq)

## Quick start

1. **Open `COB_Calculator.xlsx`** in Excel, Google Sheets, or LibreOffice Calc. Every calculation is a plain formula — no macros, no add-ins, nothing to enable.
2. **Read the in-workbook `README` tab once.** It's the same legend as below, kept inside the file so it travels with it.
3. **Pick a tab.** For a plain 30-year fixed loan, start at `Segments` — one row is enough. For everything else (points, refinance, affordability…), each has its own self-contained tab.
4. **Edit only the blue, yellow-tinted cells.** Everything in black recalculates on its own the moment you change an input — there's no "Calculate" button to press.

> **Why nothing seems to happen at first:** every tab already ships with a realistic example filled in — you're never looking at a blank grid. Change any blue cell to see your own numbers replace the example instantly.

## Color legend

| | |
|---|---|
| 🔵 **Blue text, tinted fill** | An input. Type over it with your own numbers, dates, or Y/N. |
| ⬛ **Black text** | A computed formula. Don't type into these — they read from the blue cells and update automatically. |

---

## Segments
*input*

The mortgage itself: one row per **segment** — a stretch of the loan at one rate and one payment. A plain 30-year fixed loan is a single row. A loan that renews at a new rate in year 5, or converts from interest-only to amortizing, is two or more rows, entered chronologically.

> **The one rule that matters:** every row except the **last** needs a `Term Months` — that's the row's renewal boundary. The last row's `Term Months` stays blank, so it's the one that runs the loan all the way to a $0 balance. If you want the last row to stop early with money still owed instead (a balloon), give it a `Term Months` *and* mark `Balloon? = Y`.

| Column | Cell (row 1) | What it means |
|---|---|---|
| Start Date | `B5` | Date of this segment's *first* payment. |
| Annual Rate % | `C5` | e.g. `6.5`, not `0.065`. Accepts up to 8 decimal places. |
| Payment Amount | `D5` | Leave blank to have the payment computed for you; fill it in for a manual/fixed payment (e.g. after an extra-payment plan). |
| Amortization Months Remaining | `E5` | Required if Payment Amount is blank — the span the payment is sized to pay off over (360 for a fresh 30-year loan). |
| Term Months | `F5` | How many payments before the *next* row takes over. Blank only on the last row (see callout above). |
| Starting Balance | `G5` | **Row 1 only.** The original loan amount. Later rows inherit theirs automatically from the row above's ending balance — leave it blank. |
| Balloon? (Y/N) | `H5` | Last row only. Y means the remaining balance is due in full at Term Months, instead of the loan running to $0. |
| Interest Only? (Y/N) | `I5` | Payment = interest only; the balance never moves on its own. Needs a Term Months even on the last row. |

Columns J–N (Start/End Payment #, Monthly Payment, Segment Starting/Ending Balance) are computed — read them, don't edit them.

## LumpSums
*input*

One-time extra principal payments. **Only at a renewal boundary** — the After Payment # must match one of `Segments!K`'s End Payment # values for a non-final row. The sheet's caption shows you the valid numbers for your current Segments setup.

| Column | Meaning |
|---|---|
| After Payment # | The global payment number this lump sum lands right after. |
| Amount | Dollars applied straight to principal at that point. |

> ⚠️ **Not what this is for:** a lump sum any month you like, mid-segment, isn't supported — the engine only checks segment boundaries. To model that, split the segment into two rows in `Segments` at the month you want, then put the lump sum on that new boundary.

## Overrides
*input*

Bank-statement reconciliation. If your real statement's payment #14 doesn't match what the model computed — a fee, a rate quirk, a bank's own rounding — put payment #14 here and fill in only the fields your statement actually shows. Everything you leave blank falls back to the computed value.

| Column | Required? | Notes |
|---|---|---|
| Payment # | Always | The global payment number to correct. |
| Payment Amount | Optional | |
| Interest Portion | Optional | |
| Principal Portion | Optional | Ignored if Remaining Balance is given instead. |
| Remaining Balance | Optional | If given, principal is derived as balance − this value. |
| Reason | Optional | Free text, for your own audit trail — shown back in the Schedule sheet. |

## PMI_Costs
*input*

Everything layered on top of principal & interest: PMI (with auto-drop at a loan-to-value threshold you choose) and escalating property tax, home insurance, and HOA.

| Cell | Field | Notes |
|---|---|---|
| `B4` | PMI annual rate (%) | Set to 0 to turn PMI off entirely. |
| `B5` | Property value ($) | Used to compute current loan-to-value each month. |
| `B6` | PMI drop-at LTV (%) | PMI stops the first month balance ÷ property value falls at or below this. |
| `B8` / `B9` | Property tax annual amount / annual increase % | Increase compounds once per 12-payment anniversary. |
| `B10` / `B11` | Home insurance annual amount / increase % | |
| `B12` / `B13` | HOA annual amount / increase % | |

## Schedule
*computed — don't edit*

The full payment-by-payment result, one row per global payment number, 1 through 360 (30 years). This is what everything else on the Summary and YearlySummary tabs is built from.

| Column | Meaning |
|---|---|
| Payment Date, Beginning/Ending Balance | Self-explanatory. |
| Interest, Principal, Payment | The P&I split for that row — already reflects any lump sum or override applied to it. |
| Tax, Insurance, HOA, PMI | Blank/zero unless you've filled in `PMI_Costs`. |
| Active Row? | FALSE once the loan is fully paid off — rows past payoff just read $0, they aren't hidden. |

> **Reading a real bank statement against this:** a real statement rounds interest to the cent every period, same as this sheet — so a mismatch of a few dollars late in a long loan is expected rounding drift, not an error. A mismatch of tens of dollars or more is a real signal: check `Overrides`.

## Summary
*computed*

The headline numbers for the whole loan, in one place.

| Cell | Reports |
|---|---|
| `B4` | Number of payments to payoff |
| `B5` | Total interest paid |
| `B6` / `B7` | Total principal / total of payments (P&I) |
| `B8` | Payoff date |
| `B10`–`B13` | Total tax / insurance / HOA / PMI paid |
| `B14` | Total cost of ownership (P&I + all of the above) |
| `B15` | Payment # PMI dropped off (or "never"/"active through payoff") |
| `B18`–`B20` | Balloon due? / amount / date — only meaningful if your last segment has Balloon = Y |

## YearlySummary
*computed + 1 input*

Answers "how much will I pay in the first N years?" without scrolling a 360-row schedule. Type a number of years into `B4` and the totals below update to match.

| Cell | Field |
|---|---|
| `B4` | **Input.** "Show through year" — try 5, or your own horizon. |
| Rows 7–36 | One row per year (1–30): payments that year, starting/ending balance, interest and principal paid. |
| "Totals through year" row | Interest, principal, and ending balance for exactly the window you picked in B4. |

---

## PaymentFrequency
*standalone tool*

Monthly vs. biweekly vs. weekly vs. semi-monthly, for a single plain loan (not the segmented engine). Type the frequency name — `monthly`, `semiMonthly`, `biweekly`, or `weekly` — into `B8`.

| Cell | Field |
|---|---|
| `B4`–`B8` | Inputs: loan amount, rate, term (months), start date, frequency. |
| `B13` | What you actually pay each period at the chosen cadence. |
| `B14` / `B15` | Periods to payoff / total interest at that cadence. |

> ⚠️ **One honest approximation:** semi-monthly dates are evenly spaced across the month, not locked to the "1st & 15th" some lenders use — a documented approximation, not a bug.

## ExtraPayment
*standalone tool*

What a flat extra amount on top of your regular payment, every month, actually buys you.

| Cell | Field |
|---|---|
| `B4`–`B8` | Inputs: loan amount, rate, term, **extra monthly payment**, start date. |
| Bottom summary block | Original vs. new months to payoff, months saved, original vs. new total interest, interest saved. |

## Points
*standalone tool*

Is buying discount points worth it before you expect to move or refinance?

| Cell | Field |
|---|---|
| `B4`–`B8` | Loan amount, points purchased, rate reduction they buy, original rate, term. |
| `B14` | Breakeven, in months — "never" if the points produce no monthly savings at all. |

## Refinance
*standalone tool*

Old loan vs. new loan, closing costs included.

| Cell | Field |
|---|---|
| `B4`–`B10` | Old balance/rate/remaining term, new amount/rate/term, closing costs. |
| `B14` / `B15` | Old vs. new total cost over the respective terms. |
| `B16` / `B17` | Net savings / breakeven in months. |

> ⚠️ **Simplification:** totals here use payment × months, a quick-comparison shortcut — expect the same few-dollar difference from a full cent-rounded schedule described on the Schedule tab, on long terms.

## CompareTerms
*standalone tool*

Up to four offers, side by side — different rates, different terms, same layout.

| Row | Field |
|---|---|
| 5–7 | Loan amount / rate / term (years), one column per offer. |
| 8–10 | Computed: monthly payment, total interest, total of payments. |
| 12 / 13 | Which offer has the lowest payment / lowest total interest — named directly, not just highlighted. |

## LTV_DSCR
*standalone tool*

Three independent mini-calculators stacked on one tab: loan-to-value, combined LTV (first lien + HELOC), and debt-service coverage ratio for a rental/investment property.

| Section | Result cell |
|---|---|
| LTV (row 4) | `B7` |
| CLTV (row 10) | `B14` |
| DSCR (row 17) | `B20` |

## ARM_Reset
*standalone tool*

A pure rate-cap calculator for an adjustable-rate mortgage's reset — fully-indexed rate, then whatever your initial/periodic/lifetime caps actually allow.

| Cell | Field |
|---|---|
| `B4`–`B13` | Is-first-reset flag, previous/initial rate, index rate, margin, the three caps, remaining balance and amortization. |
| `B15` / `B16` | Fully-indexed rate / capped (actual) rate. |
| `B17` | Resulting new monthly payment. |

To actually schedule the reset loan, copy the capped rate (`B16`) into a new row's `Annual Rate %` on the [Segments](#segments) tab.

## Fees_APR
*standalone tool*

The note rate isn't the real cost when a loan carries fees — this converts fees into an APR you can actually compare across offers.

| Cell / range | Field |
|---|---|
| `B4`–`B6` | Loan amount, note rate, term. |
| Fee table (rows 10–16) | Name, amount, and whether it's financed into the loan (Y) or paid in cash (N). |
| `B24` | APR — always ≥ the note rate whenever any cash fee is present. |
| `B25` | APR minus note rate, in points — the size of the gap. |

> 🛑 **Scope:** a simplified actuarial-method APR — useful for comparing offers consistently, but not a substitute for a lender's official Loan Estimate.

## DTI_Affordability
*standalone tool*

Two calculators on one tab: check whether a specific housing payment fits your income, or work backward to find the loan you'd actually qualify for.

| Section | Key cells |
|---|---|
| **Check my DTI** (row 4) | Inputs `B5`–`B9`; results `B11` (front-end DTI), `B12` (back-end DTI), `B15` (qualifies?). |
| **How much can I afford** (row 18) | Inputs `B19`–`B26`; `B32` max loan amount, `B33` max home price, `B31` which limit (front- or back-end) is binding. |

---

## COB_CA
*Canadian Cost-of-Borrowing calculator — `COB_Calculator_CA.xlsx`, a separate workbook*

Everything below lives in `COB_Calculator_CA.xlsx`, generated by `build_workbook_ca.py` — not in `COB_Calculator.xlsx`. See `docs/new-req/006-cost-of-borrowing-disclosure.md` (especially its "Excel implementation notes" section) for the full spec and the judgment calls made building this. This models a single Canadian mortgage/loan **contract term** — semi-annual compounding for fixed-rate mortgages (Interest Act s.6), a trigger rate for variable-rate mortgages, and the regulatory `APR = (C/(T×P))×100` cost-of-borrowing rate — not the US-style segmented/IRR engine above.

| Cell | Field |
|---|---|
| `B5` | **Flow** dropdown: New mortgage / New loan / Existing mortgage / Existing loan / Payment change / Variable rate payment change. |
| `B6` | **Product type** dropdown: `mortgage` / `personalLoan`. |
| `B7` | **Rate type** dropdown: `variable` / `fixed`. |
| `B9`–`B12` | **Computed helper cells** — read these after picking Flow/Product/Rate type: which date field applies, whether accrued interest carries forward, which compounding convention is in effect, and whether a trigger rate is computed. Every input field below stays visible regardless of Flow (Excel has no macros to hide cells) — these four cells tell you which ones actually matter for your selection. |
| `B15` | Loan amount / **current outstanding balance** — dual-purpose: the new loan amount for New flows, or the current balance for Existing/Payment-change flows (see the note in column C). |
| `B16` | Contract rate, nominal annual (%). |
| `B17` | Payment frequency dropdown: `monthly` / `semiMonthly` / `biweekly` / `weekly`. |
| `B18`–`B19` | **Term years / months** — the CONTRACT TERM (commonly 3–5 years), not the amortization. |
| `B20`–`B21` | Remaining amortization years / months — what's left of the full payoff horizon; feeds the payment-amount solve. |
| `B22`–`B23` | First payment date / End date (this term's maturity). |
| `B26`–`B30` | Flow-conditional dates and values: disbursal date (new flows), pre-approval date (new flows), renewal date (existing/payment-change flows), accrued interest (existing/renewal flows), semi-annual compounding reference date (fixed mortgages, display only). |
| Fee table, rows 36–41 | Fee name / Amount / **Financed? (Y/N)** / **Included in COB? (Y/N)** — these two flags are independent (a fee can be financed but excluded from `cob_amount`, e.g. mortgage default insurance, or cash-paid but included, e.g. an appraisal fee lenders require). |
| `B44`–`B62` | Derived quantities: payments/year, periodic rate, fee totals, disbursal amount, amortized opening principal (`P0`), term/amortization period counts, **`B59` payment amount** (always computed, never entered), **`B60` trigger rate** (mortgage+variable only, else "N/A"), and `term_days` (display only). |
| `B65`–`B72` | Outputs, scoped to the current contract term only: number of payments, total payment, total interest, principal payment, ending balance at term maturity (what a renewal would carry forward into `B15`), average outstanding balance, `cob_amount`, and `cob_rate_percent`. |

> ⚠️ **Scope limit:** this models one contract term at a time. Renewing into a new term means manually copying `B69` (ending balance) into the next calculation's `B15` — there's no automatic cross-term chaining.

> ⚠️ **Honesty about precision:** same caveat as `Fees_APR` — this is a borrower-facing cost-of-borrowing *estimate*, not a certified regulatory disclosure. See spec 006's "Scope" section.

## COB_CA_Schedule
*computed — don't edit — part of `COB_Calculator_CA.xlsx`*

The amortization schedule for the **current contract term only** (not the full remaining amortization) — one row per payment period, bounded to 520 rows (10 years at weekly, the densest supported cadence). Rows past the term's own length freeze at the term's ending balance; rows past an early full payoff (only possible if remaining amortization is shorter than the term) read $0 — same self-stabilizing technique as `COB_Calculator.xlsx`'s `Schedule` sheet.

| Column | Meaning |
|---|---|
| Period #, Period Date | Self-explanatory. |
| Beginning Balance, Interest, Principal, Payment, Ending Balance | The standard per-period breakdown. |
| Counted in term totals? | `TRUE` while the period is both within the term length and the loan still has a genuine payment to make — `COB_CA`'s term-scoped outputs (`B65`–`B72`) sum only rows where this is `TRUE`. |

---

## COB_CA macros (optional, VBA)
*requires saving your own macro-enabled `.xlsm` copy — not part of the shipped `COB_Calculator_CA.xlsx`*

`COB_Calculator_CA.xlsx` itself has **no macros** — every number on `COB_CA`/`COB_CA_Schedule` is a plain formula, same design as the rest of this project. This section is for users who explicitly want real VBA on top of that: a companion file, [`COB_Calculator_CA_macros.bas`](COB_Calculator_CA_macros.bas), adds a chart of the amortization schedule and a one-click disclosure-summary PDF export. Installing it is a deliberate trade: you gain those two conveniences, but the file becomes macro-enabled, which means Excel shows an **Enable Content** / "Macros have been disabled" security prompt every time you open it (standard Excel behavior for any `.xlsm` — Excel doesn't run VBA from a downloaded or newly-macro-enabled file until you explicitly click Enable Content, precisely so a file can't silently run code on open).

### What the macros do

| Macro | What it does |
|---|---|
| `BuildScheduleChart` | Builds (or rebuilds) a stacked Interest/Principal column chart plus a Remaining Balance line (secondary axis) on a new `COB_CA_Chart` sheet, sized to exactly this term's actual payment count (`COB_CA!B65`) — not the schedule's full 520-row bound, so you never see a chart with a long flat tail of frozen/zero rows past the term. |
| `Auto_Open` | Runs automatically whenever the workbook opens (a classic VBA auto-macro — no extra setup) and simply calls `BuildScheduleChart`, so the chart is always current the moment you open the file. |
| `RefreshAll` | Forces a full recalculation, then rebuilds the chart — bind this to a button for a visible "Recalculate & Refresh Chart" action after changing several inputs at once (Excel already recalculates automatically; this is a convenience/reassurance action, not a fix for anything broken). |
| `PrintDisclosureSummary` | Exports a short PDF of `COB_CA`'s Flow/Product/Rate-type + common-inputs block and the Outputs block (`B65`–`B72`) — a real, shareable one-or-two-page disclosure summary, prompting you for a save location each time. |

All four are read-only with respect to the formulas: none of them writes into an input or output cell. `COB_CA_Chart` is a sheet the macros own entirely — `build_workbook_ca.py` never creates or touches it, so nothing about the formula layer depends on it existing.

### Installing it (one-time, per copy)

1. Open `COB_Calculator_CA.xlsx` in Excel and immediately **File → Save As**, choosing **Excel Macro-Enabled Workbook (.xlsm)** as the format — e.g. save it as `COB_Calculator_CA.xlsm` in the same folder. (You now have two files: the original, macro-free `.xlsx`, and your new `.xlsm`. Keep both — see "Regenerating" below.)
2. Open the VBA editor: **Tools → Macro → Visual Basic Editor** on the menu bar (or the keyboard shortcut, `Option+F11` on Mac / `Alt+F11` on Windows).
3. In the VBA editor: **File → Import File…**, and select `COB_Calculator_CA_macros.bas` from this folder. This creates a new standard module named `COB_CA_Macros` (the name is baked into the file itself, so you don't need to rename anything).
4. Close the VBA editor and save the `.xlsm` again (`Cmd+S` / `Ctrl+S` — a "keep macro-enabled format" prompt is expected and correct, click **Yes**/**Keep**).
5. Close and reopen the file once. You'll see the **Enable Content** security prompt described above — click it, and `Auto_Open` will build the chart on a new `COB_CA_Chart` tab immediately.

**Optional: add buttons for `RefreshAll` / `PrintDisclosureSummary`.** These two don't run automatically (only `Auto_Open` does) — to give yourself a clickable button: enable the **Developer** tab (Excel → Preferences → Ribbon & Toolbar, or File → Options → Customize Ribbon on Windows, and check "Developer"), then **Developer → Insert → Button (Form Control)**, draw it on the `COB_CA` sheet, and when Excel prompts you to **Assign Macro**, pick `RefreshAll` (or `PrintDisclosureSummary` for a second button). Rename the button's caption by clicking it once more and typing over the default text.

### Regenerating after macros are installed

This is the part that changes once VBA is involved, so it's worth being precise about what actually happens:

- **`python3 build_workbook_ca.py` (no arguments, or any `.xlsx` target) is unaffected** — it still builds a brand-new, pure-formula workbook from scratch every time, exactly as before. This is what you should keep doing if you only care about the formulas (e.g. after changing a formula in `build_workbook_ca.py` itself).
- **`python3 build_workbook_ca.py path/to/your/COB_Calculator_CA.xlsm`, pointed at your ALREADY-macro-enabled file, refreshes the formulas in place without disturbing your macros.** The script detects the `.xlsm` extension and, if that file already exists, loads it with `keep_vba=True` (an openpyxl feature that preserves an existing VBA project byte-for-byte), deletes only the `COB_CA` and `COB_CA_Schedule` sheets, rebuilds them fresh, and leaves everything else — the `vbaProject.bin`, the `COB_CA_Chart` sheet the macros built, any buttons you added — untouched. This was verified directly: merging freshly-built `COB_CA`/`COB_CA_Schedule` sheets into a `.xlsm` with an unrelated pre-existing VBA project left that project byte-for-byte identical (confirmed by comparing the embedded `vbaProject.bin` before and after) while the new formulas recalculated cleanly (0 errors).
- **What this does NOT do: update the macros themselves.** openpyxl can *preserve* a VBA project that's already there, but it cannot *author* one — there's no supported way on this machine to inject or edit VBA source from a script (see "Why a companion `.bas` file, not a real `.xlsm` built by this repo" below). If `COB_Calculator_CA_macros.bas` itself changes in a future update, you must manually remove the old `COB_CA_Macros` module in the VBA editor (right-click it in the Project Explorer → Remove `COB_CA_Macros`, choose "No" when asked to export) and re-import the new `.bas` file (step 3 above) — the formula-refresh step above does not do this for you.
- **If the cell layout changes** (a `COB_CA`/`COB_CA_Schedule` row or column moves), the macros' hardcoded cell references (`COB_CA!B58`, `COB_CA!B65`, and `COB_CA_Schedule`'s column letters — all listed in a comment block at the top of the `.bas` file) will silently point at the wrong cell rather than erroring, since VBA has no way to know the layout changed. Re-check that comment block against the current sheet whenever you re-import after a `build_workbook_ca.py` layout change.

### Why a companion `.bas` file, not a real `.xlsm` built by this repo

This was tried first, and confirmed not to work on this machine, for two independent reasons:

1. **openpyxl cannot author VBA from scratch** — it can only preserve a `vbaProject.bin` that's already embedded in a file it loads with `keep_vba=True` (used above for the formula-refresh path). Building the VBA project itself needs a different tool.
2. **`xlwings` (the standard tool for driving Excel from Python, including writing VBA modules) was installed and tested, and its VBA-authoring path does not work on macOS**: on Windows, `xlwings`/COM automation exposes `workbook.api.VBProject.VBComponents.Add(...).CodeModule.AddFromString(...)`, which is how VBA gets injected programmatically. On macOS, Excel is driven via AppleScript instead of COM, and **Excel's AppleScript dictionary has no `VBProject` property at all** (confirmed directly: calling it raised `Unknown property, element or command: 'VBProject'`, and dumping Excel's full AppleScript dictionary with `sdef` turned up zero VBA-related entries anywhere). The usual fallback for this — driving the VBA editor's UI directly via `System Events` keystroke/paste automation — was also tested and confirmed blocked in this environment: `System Events` could not even enumerate Microsoft Excel's own windows (`Can't get window 1 of process "Microsoft Excel"`), meaning the sandboxed process this ran in does not have the macOS **Accessibility** permission GUI-scripting requires. Hand-crafting a `vbaProject.bin`'s bytes directly (bypassing both tools) was ruled out on purpose — the xlsx skill's own guidance is explicit that this is not attempted, since getting the OLE compound-file/MS-OVBA compression format exactly right by hand is its own significant source of corruption risk.

Given both automated paths are genuinely unavailable here, the companion `.bas` file plus the one-time manual import above is the honest, correct approach — not a shortcut taken without checking.

All five use the numbers already sitting in the shipped file — open the corresponding tab and follow along with your own copy.

### 1. A plain 30-year fixed loan

The simplest case: one `Segments` row, no term months, no renewal.

- Loan: **$300,000**
- Rate: **6.5%**
- Amortization: **360 mo**

1. On [Segments](#segments), row 5: set Amortization Months Remaining to `360`, Starting Balance to `300000`, rate to `6.5`. Leave Term Months blank — it's the only row, so it must run to payoff.
2. Leave rows 6–12 completely blank.
3. Read the monthly payment straight off `Segments!L5`, or the full breakdown on [Summary](#summary).

### 2. Renewal + a $20,000 lump sum (the file's default example)

The pre-loaded scenario: a 5-year term at 5%, then a 25-year renewal at 6%, with a $20,000 lump sum the day it renews.

- Segment 1: **5% · 60 mo term**
- Segment 2: **6% · runs to payoff**
- Lump sum: **$20,000 @ payment #60**

1. [Segments](#segments) rows 5–6 are already filled in this way. Segment 1's `Term Months` (60) is what makes it a boundary, not the final row.
2. On [LumpSums](#lumpsums), row 5 already reads `After Payment # = 60, Amount = 20000` — 60 is segment 1's End Payment #, a valid boundary.
3. Check `Segments!M6` (segment 2's starting balance): it's segment 1's payoff balance *minus* the $20,000, automatically.

### 3. Reconciling a real bank statement

Say your real statement's payment #10 shows more interest than the model computed — a one-off adjustment.

1. On [Overrides](#overrides), row 5 already shows this: `Payment # = 10, Interest Portion = 700`, with a reason noted.
2. Principal, payment total, and remaining balance for that row are still computed automatically from the $700 you supplied — you only had to give the one number your statement disagreed on.
3. Every row after #10 carries the corrected balance forward, same as if it had always been $700.

### 4. PMI that drops off automatically

A loan that starts above 80% LTV, so PMI applies until the balance earns its way below the threshold.

- Property value: **$220,000**
- PMI rate: **0.6%**
- Drops at: **80% LTV**

1. These are the file's default [PMI_Costs](#pmi_costs) values already.
2. Property tax ($4,800/yr) and home insurance ($1,200/yr) are layered on top too — see the same tab.
3. `Summary!B15` reports the exact payment number PMI stopped.

### 5. How much house can I afford

1. Go to [DTI_Affordability](#dti_affordability), "How much can I afford" section.
2. Set your gross monthly income (`B19`), other monthly debts (`B20`), the rate/term you'd actually get quoted (`B21`–`B22`), an estimate of tax+insurance+HOA+PMI (`B23`), and your down payment (`B26`).
3. Read `B32` for the maximum loan you'd qualify for, `B33` for the home price that implies, and `B31` for which limit — front-end housing ratio, or back-end including other debts — is actually the one holding you back.

### 6. Canadian fixed mortgage: 5-year term inside a 25-year amortization

`COB_Calculator_CA.xlsx`'s [COB_CA](#cob_ca) sheet, default scenario: a $400,000 mortgage, 5% nominal rate, monthly payments, a 5-year contract term, 25 years remaining amortization.

- With `B6 = mortgage`, `B7 = variable` (the shipped default), payments use the monthly convention (eq. 2): `B59` computes to **$2,341.28**, matching `PMT(5%/12, 300, 400,500)` exactly (the extra $500 is the shipped example's one financed fee, grossed into the amortized principal — see `B52`).
- Switch `B7` to `fixed`: `B45` (periodic rate) drops slightly, to `(1+0.05/2)^(2/12)-1 = 0.41239%`/month instead of `0.41667%`/month — Canadian semi-annual, not-in-advance compounding is *slightly cheaper* than monthly compounding at the same nominal rate (the well-known "Canadian mortgage advantage"; see spec 006's Excel implementation notes for why this workbook's invariant differs from one line of the spec's own invariant list).
- `B69` (ending balance at term maturity) is what you'd type into `B15` to model this mortgage's renewal into a new term.

### 7. Trigger rate on a variable-rate mortgage (WOWA.ca's worked example)

Reproducing the cited example from spec 006 (equation 4): a $500,000 balance with a $1,998.59 monthly payment should give a 4.80% trigger rate.

1. Set `B6 = mortgage`, `B7 = variable`, `B15 = 500000`, zero out the fee table (rows 36–41, column B), and set `B20 = 25` / `B21 = 0` (25-year remaining amortization).
2. Set `B16` (contract rate) to `1.4953524645341203` — the rate that makes a 25-year, $500,000 annuity payment exactly $1,998.59/month.
3. `B59` reads **$1,998.59**; `B60` (trigger rate) reads **4.7966%**, which rounds to WOWA's published 4.80%.

This also demonstrates equation 4's Bank of Canada citation directly: trigger rate is loan-size-invariant when payment is freshly computed from the same balance (try doubling `B15` — `B59` and `B60` scale together and `B60` doesn't move); it only decreases as balance rises when `payment_amount` is held fixed against an independently changing balance (e.g. checking an existing fixed payment against a since-amortized balance), not when both come from the same fresh calculation.

---

## Limits & troubleshooting

| What you might see | What it means |
|---|---|
| A row reads all zeros near the bottom of a table | Normal — the loan already paid off before that row. Rows aren't hidden, just quietly inactive. |
| "exceeds 360-row table" (or 1560, on PaymentFrequency) | Your term is longer than the sheet was built to hold. Select the last row's formulas and copy them down to extend it. |
| A lump sum "disappears" | Its After Payment # doesn't match a real boundary — check the caption above the LumpSums table for the valid numbers given your current Segments. |
| A number is a few dollars off a quick online calculator | Expected — this workbook rounds every period to the cent like a real statement does; a calculator that doesn't will drift by a few dollars on a long loan. See the Schedule tab's note. |

Other known scope limits: lump sums only land on segment boundaries, not mid-segment; Fees_APR is a simplified APR, not a certified lender disclosure; Refinance/CompareTerms use payment × months for totals rather than a full schedule; `COB_Calculator_CA.xlsx`'s `COB_CA_Schedule` only models one contract term at a time (renewal chaining is a manual copy-the-balance-forward step, not automatic) and is bounded to 520 rows (extend the same way as any other bounded table here).

## FAQ

**Do I need Excel specifically?**
No — it's plain formulas, no macros or add-ins. Google Sheets and LibreOffice Calc both open and calculate it correctly.

**Can I add more segments than the file ships with?**
Yes — [Segments](#segments) has room for 8 rows by default. Fill in row 7 the same way as the rows before it; leave Starting Balance blank (only row 1 gets one) and it'll inherit automatically.

**Why does the last payment sometimes look like an odd amount?**
It's deliberate: the final payment of a fully-amortizing segment absorbs whatever fraction of a cent accumulated from rounding every prior period — exactly what a real bank does on your very last payment.

**Is this the same as the Python/Streamlit or TypeScript version?**
Same underlying math, cross-checked row-for-row against the Python engine during development. This workbook is the plain-formula version for anyone who'd rather stay inside a spreadsheet.

---

*COB Calculator · formula-driven, no macros · matches the Python (COB-py) and TypeScript (COB-ts) engines*
