# COB Calculator Manual

A sheet-by-sheet reference for `COB_Calculator.xlsx` — a plain-formula, no-macro Excel workbook for mortgage and cost-of-borrowing calculations: segmented renewals, lump sums, PMI, bank-statement reconciliation, and nine standalone tools. This manual walks through every sheet: what to type in, what comes back out, and five worked examples using the numbers already sitting in the file.

## Contents

- [Quick start](#quick-start)
- [Color legend](#color-legend)
- **The engine**: [Segments](#segments) · [LumpSums](#lumpsums) · [Overrides](#overrides) · [PMI_Costs](#pmi_costs) · [Schedule](#schedule) · [Summary](#summary) · [YearlySummary](#yearlysummary)
- **Standalone tools**: [PaymentFrequency](#paymentfrequency) · [ExtraPayment](#extrapayment) · [Points](#points) · [Refinance](#refinance) · [CompareTerms](#compareterms) · [LTV_DSCR](#ltv_dscr) · [ARM_Reset](#arm_reset) · [Fees_APR](#fees_apr) · [DTI_Affordability](#dti_affordability)
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

## Worked examples

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

---

## Limits & troubleshooting

| What you might see | What it means |
|---|---|
| A row reads all zeros near the bottom of a table | Normal — the loan already paid off before that row. Rows aren't hidden, just quietly inactive. |
| "exceeds 360-row table" (or 1560, on PaymentFrequency) | Your term is longer than the sheet was built to hold. Select the last row's formulas and copy them down to extend it. |
| A lump sum "disappears" | Its After Payment # doesn't match a real boundary — check the caption above the LumpSums table for the valid numbers given your current Segments. |
| A number is a few dollars off a quick online calculator | Expected — this workbook rounds every period to the cent like a real statement does; a calculator that doesn't will drift by a few dollars on a long loan. See the Schedule tab's note. |

Other known scope limits: lump sums only land on segment boundaries, not mid-segment; Fees_APR is a simplified APR, not a certified lender disclosure; Refinance/CompareTerms use payment × months for totals rather than a full schedule.

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
