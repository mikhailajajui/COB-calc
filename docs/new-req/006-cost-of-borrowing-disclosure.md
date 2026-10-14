# 006 — Cost of Borrowing (COB) Disclosure: mortgage & loan workflows

## Status

**Rewritten per doc 007's BRD reconciliation.** This spec was originally built
from an ambiguous dictated requirement plus independent Canadian regulatory
research (Interest Act, Financial Consumer Protection Framework Regulations)
and was never checked against Alterna Savings' actual BRD or production
workbook. `docs/new-req/007-cob-canada-brd-reconciliation.md` did that check —
reading `COB Requirements v2.3.docx` and the live `Cost of Borrowing Rate
Calc_Current.xlsm` directly — and found ten load-bearing divergences, all
resolved in the real BRD's favor. This version of the spec incorporates all
ten: `payment_amount` is now a plain input, the invented
"remaining amortization" concept is gone, interest accrual is day-count-prorated
rather than a fixed per-period rate, the fee carve-out direction is flipped,
accrued interest is a carry-forward waterfall input rather than a
capitalization, `cob_amount` includes all fees unconditionally, the APR's `T`
is real elapsed days rather than nominal term length, a payment-allocation
waterfall (interest → fees → principal) is now specified explicitly, the flow
enum is collapsed from six values to the real four, and equation 2's
compounding-conversion formula now branches by product type.

**Implementation status (checked 2026-09-23 against the code, see 008 A1):**
- The last commit (`2314d14`) holds the *pre-reconciliation* engines
  (annuity-solved payment, `remaining_amortization_*` inputs).
- The **uncommitted working tree** re-implements this rewritten spec in all
  three engines (`COB-py/cob_calculator/cob_canada.py`, `COB-ts/src/ca/`,
  `COB-xlsx/build_workbook_ca.py`): payment is an input, no amortization
  horizon, day-count interest with a 365/366 split, interest → fees →
  principal waterfall, `disbursal_amount = loan_amount − financed_fees`, and
  `end_date`-inclusive stop.
- **What's been shown:** the TS and Python CA tests pass (88 and 49), and both
  reproduce the fee-free 007 worked vector (156 rows, final balance
  177,731.99591…). The whole-vector tolerance is cent-level, not the project's
  1e-9. The `.xlsx` was not recalculated for this check.
- **Not parity:** this spec itself is still known to diverge from the macro
  whenever fees > 0 or interest goes unpaid (008 §B). Payment-date rules also
  diverge: monthly is not month-end-clamped, semi-monthly is approximated
  (008 C1). The engines accept only 4 of the 6 IN-09 frequency values. They
  have no `acceleratedWeekly` or `acceleratedBiweekly` (see
  `payment_frequency` below). Only the fee-free vector is proven.

See doc 007 for the
full evidence trail (docx section/BR citations, live workbook formulas, and a
worked validation vector) behind every change made here.

## Problem

The existing engine (`COB-ts` / `COB-py`) models US-style mortgages:
monthly-compounding, monthly-periodic amortization, with APR treated as a
simplified actuarial-equivalent rate (spec 002). It has no concept of:

- **Semi-annual compounding**, which is the statutory default for Canadian
  fixed-rate mortgages (Interest Act, s. 6) — the disclosed/contract rate
  compounds semi-annually not in advance, and payments still fall on a
  monthly/biweekly/weekly schedule, so a frequency-equivalent nominal rate
  must be derived from the semi-annual nominal rate rather than dividing by
  the number of periods directly. Variable-rate mortgages and personal loans
  use the same conversion formula with a different compounding period (see
  "Conditional calculation paths" and equation 2).
- **Day-count-prorated interest accrual.** Each period's interest is not a
  fixed fraction of the frequency-equivalent annual rate applied uniformly —
  it is that annual rate prorated by the *actual* number of calendar days in
  the period, divided by 365 (split across 365/366 on a leap-year boundary).
  Odd-length periods (a short first period between disbursal and the first
  payment date, in particular) accrue proportionally less or more interest
  than a "clean" period of the same nominal frequency.
- **A payment-allocation waterfall.** Every payment is consumed in a fixed
  order — interest (including any carried-forward accrued interest) first,
  then outstanding fees (recovered gradually out of the payment stream, not
  netted once at origination), then whatever remains reduces principal.
- **Financed fees are already included in the loan amount, not layered on
  top of it.** `loan_amount` is inclusive of financed fees by definition; the
  actual cash disbursed is `loan_amount` minus financed fees. Non-financed
  (cash-paid) fees are paid separately by the borrower and do **not** reduce
  disbursal — they only enter the cost-of-borrowing total (see "Financed
  fees" below).
- **A trigger rate** — the contract rate at which a fixed payment on a
  variable-rate mortgage stops covering accruing interest (relevant only to
  variable-rate mortgages, not personal loans or fixed-rate mortgages).
- **Four distinct dropdown-driven workflows** (new mortgage/loan, renewal,
  payment change, variable-rate payment change), each of which asks for a
  different subset of inputs and runs a different calculation path (e.g.
  renewal/payment-change flows use a renewal date and an accrued-interest
  carry-forward instead of a disbursal date).

This spec organizes the raw field list into inputs / outputs / derived
fields, the conditional logic that picks a calculation path, and the
equations each output requires.

## Scope

**In scope:** field inventory, presentation-layer flow (dropdown → which
fields apply), conditional compounding/trigger-rate logic by product type and
rate type, day-count interest accrual, the interest→fees→principal payment
waterfall, and the equation each derived output requires.

**Out of scope for this spec:** actual disclosure-statement copy/legal
wording, HELOC draws, multi-lien scenarios, solving for a payment amount
(this engine is given a payment, never derives one — see finding #1 in doc
007), and wiring this into the existing `segment.ts`/`mortgage.ts` stitching
engine (that integration is a follow-up once a language/module target is
chosen — already decided below).

**Honesty about precision** (same caveat pattern as spec 002): this is a
**borrower-facing cost-of-borrowing calculator that reproduces a specific
lender's (Alterna Savings) real production calculator**, not a certified
regulatory disclosure engine and not a general model of every Canadian
lender's practice. The mechanics here (day-count proration, the
interest→fees→principal waterfall, the fee carve-out direction) are what
`COB Requirements v2.3.docx` and its live workbook actually implement, cited
and verified in doc 007 — but other lenders may compound, prorate, or
allocate payments differently, and nothing here should be read as a
statement of what Canadian regulation *requires* every lender to do, only
what this one BRD requires this application to compute. Treat every formula
here as "reproduces Alterna's calculator for the same inputs," not as a
substitute for any bank's compliance-reviewed disclosure statement.

## Presentation layer: dropdown-driven workflows

A single top-level dropdown selects one of **four** flows (`COB Requirements
v2.3.docx` IN-01, §3.1) — collapsed from an earlier six-value draft that
split new/existing by product type; product type is already a separate,
orthogonal dropdown (IN-03) that applies identically across all four flows.
The flow selected determines which date field appears (disbursal vs. renewal)
and whether an accrued-interest carry-forward applies.

| Flow | Date field shown | Uses accrued-interest carry-forward? | Trigger rate computed? |
|---|---|---|---|
| `newMortgageOrLoan` | `disbursal_date` | No | Yes, if product = mortgage and rate type = variable |
| `renewal` | `renewal_date` | Yes | Yes, if product = mortgage and rate type = variable |
| `paymentChange` | `renewal_date` (as-of date for the recomputation) | Yes | Yes, if product = mortgage and rate type = variable |
| `variableRatePaymentChange` | `renewal_date` | Yes | Yes, always (mortgage + variable only by construction — the flow exists specifically to recompute this) |

`payment_amount` is a **plain required input in every flow** (see "Data
shapes" — this reverses the prior draft's "always computed" design; see doc
007 finding #1). `renewal`/`paymentChange`/`variableRatePaymentChange` flows
seed the schedule from the *current outstanding balance* (the prior term's
final `closing_balance`) rather than the original `loan_amount`, and carry
forward any unrecovered `accrued_interest` — they do not re-derive a payment
amount from anything; the user (lender staff) enters whatever the new payment
is.

Two more dropdowns condition the calculation path directly, unchanged from
the prior draft:

- **Product type:** `mortgage` \| `personalLoan`
- **Rate type:** `variable` \| `fixed`

**Compounding rule** (docx §4.2, "Application by product/rate type" — three
cases, not two):

- Fixed-rate **mortgage**: convert the semi-annual nominal rate using `m=2`
  (equation 1) — CONFIRMED, Interest Act s. 6.
- Variable-rate **mortgage**: no conversion — the frequency-equivalent
  nominal rate equals the contract rate exactly (`m=n`; the compounding
  period always matches whatever the payment frequency is).
- **Personal loan** (either rate type): monthly compounding at the contract
  rate (`m=12`) — the *same* conversion formula as equation 1, just with
  `m=12` substituted, applied whenever the payment frequency isn't itself
  monthly. For monthly-frequency personal loans this reduces to
  `contract_rate/12` exactly (`m=12, n=12`).

See equation 2 for the unified formula and full branching table.

## Data shapes

### Inputs — common to every flow

```
loan_amount: money                  # face amount, ALREADY INCLUSIVE of any
                                      # financed fees (IN-02: "The total loan
                                      # amount, inclusive of any financed
                                      # fees") — see "Financed fees" below.
                                      # For renewal/paymentChange/
                                      # variableRatePaymentChange flows this
                                      # is the current outstanding balance,
                                      # not the original disbursed amount.
fees: FeeSchedule                    # itemized fee list — reuses spec 002's
                                      # Fee/FeeSchedule shape (Fee: name,
                                      # amount, financed: bool). This
                                      # Canadian engine does NOT use spec
                                      # 002's optional `included_in_cob`
                                      # field (see equation "cob_amount"
                                      # below and "Open questions") — the
                                      # field stays on the shared `Fee` type
                                      # for backward compatibility, this
                                      # engine simply never reads it.
                                      # `fees.total_financed_fees` and
                                      # `fees.total_cash_fees` are the
                                      # derived aggregates this spec uses
                                      # throughout.
contract_rate_percent: percent       # the "calculated rate" input / contracted
                                      # interest rate, nominal annual
payment_amount: money                # USER-ENTERED, present in EVERY flow
                                      # (IN-08). Never derived by this
                                      # engine — see doc 007 finding #1.
                                      # Constant across every scheduled
                                      # payment for the flow being computed
                                      # (the schedule does not solve for or
                                      # adjust it).
payment_frequency: enum              # IN-09 — six values (docx label →
                                      # macro dispatch string → n):
                                      #   weekly              "Weekly"               52
                                      #   acceleratedWeekly   "Accelerated Weekly"   52
                                      #   biweekly            "Biweekly"             26
                                      #   acceleratedBiweekly "Accelerated Biweekly" 26
                                      #   semiMonthly         "Semi Monthly"         24
                                      #   monthly             "Monthly"              12
                                      # Docx IN-09 spells them "Bi-weekly",
                                      # "Accelerated Bi-weekly",
                                      # "Semi-monthly"; the macro's dropdown
                                      # (named range Payment_Frequency =
                                      # Settings!B3:G3) and its CalculateAll
                                      # Select Case use the spellings above.
                                      # BR-09: each accelerated value uses the
                                      # same n as its regular counterpart, and
                                      # the macro dispatches it to the same
                                      # getNext* date rule. The only
                                      # difference is the user-entered
                                      # payment_amount. They are still
                                      # distinct input values (IN-09 lists
                                      # them as separate dropdown options).
                                      # Code values follow architecture.md
                                      # §3.1. Do NOT reuse the legacy US
                                      # engine's frequency enum.
                                      # "One Time" is NOT in this enum: it is
                                      # unresolved (008 C5), see Open
                                      # questions.
first_payment_date: date
end_date: date                       # IN-13 — the date the schedule is run
                                      # to, INCLUSIVE: a scheduled payment
                                      # dated exactly on end_date IS
                                      # generated; the first candidate dated
                                      # strictly after end_date is not. The
                                      # schedule also stops after the row
                                      # whose closing_balance reaches zero,
                                      # whichever comes first (equation 5;
                                      # macro CalculateAll:
                                      # `checkToExit = DateDiff("d", eDate,
                                      # nextDate) > 0`). There is no
                                      # amortization-horizon concept in this
                                      # application — a schedule may (and
                                      # commonly does) end with a nonzero
                                      # balance still outstanding; see doc
                                      # 007 finding #2 and its worked
                                      # example (final row balance
                                      # $177,731.99591158231, not $0).
product_type: enum                   # mortgage | personalLoan
rate_type: enum                      # variable | fixed
term_years: int                      # DISPLAY ONLY. Informational contract-
                                      # term length; does not drive the
                                      # schedule (end_date does) and does not
                                      # feed any monetary output.
term_months: int                     # display only, same caveat as term_years
term_days: int                       # informational display of the term
                                      # length in days. MUST be computed the
                                      # same way as T in the APR equation
                                      # (start_date to final_payment_date,
                                      # actual days) rather than derived
                                      # independently from term_years/
                                      # term_months — this field used to be
                                      # purely cosmetic (see doc 007 finding
                                      # #7); keeping its derivation identical
                                      # to T avoids the two silently
                                      # diverging again.
```

### Inputs — flow-conditional

```
disbursal_date: date                 # newMortgageOrLoan ONLY — start of
                                      # interest accrual and the flow's
                                      # start_date for the APR's T (see
                                      # equation "cob_rate_percent")
renewal_date: date                   # renewal / paymentChange /
                                      # variableRatePaymentChange ONLY — this
                                      # flow's start_date, same role as
                                      # disbursal_date for a new flow
accrued_interest: money              # renewal/paymentChange/
                                      # variableRatePaymentChange flows:
                                      # interest accrued since the last
                                      # payment, carried into this
                                      # calculation as the schedule's
                                      # initial carriedAccruedInterest (see
                                      # "Payment allocation waterfall" below
                                      # — this is NOT added to loan_amount or
                                      # the schedule's opening balance; doc
                                      # 007 finding #5)
semi_annual_compounding_date: date   # fixed-rate mortgages only — the
                                      # reference date the semi-annual
                                      # compounding periods are anchored to
                                      # (display/reference only; does not
                                      # change the periodic-rate conversion
                                      # itself)
```

### Outputs

```
calculated_rate_percent: percent     # docx OUT-01 ("Semi-Annual Compounding
                                      # Rate") -- the frequency-equivalent
                                      # nominal rate equation 1/2 derives from
                                      # contract_rate_percent (e.g. 3.74% at
                                      # m=2, n=52 -> 3.706781471105014%).
                                      # MISSING from earlier drafts of this
                                      # spec despite being a required docx
                                      # output and despite already driving
                                      # both period_interest (equation 3) and
                                      # the cob_rate_percent short-circuit
                                      # (equation 7) internally -- every
                                      # engine/UI must expose this as its own
                                      # field, not just use it as an
                                      # unreturned intermediate value.
cob_amount: money                    # total cost-of-borrowing dollar amount
cob_rate_percent: percent            # cost-of-borrowing rate, this
                                      # project's equivalent of APR
total_payment: money                 # total of all scheduled payments
number_of_payments: int              # total count of scheduled payments
                                      # actually generated (bounded by
                                      # end_date, see "Schedule generation")
total_interest: money                # total of all period_interest plus any
                                      # accrued-interest recovered, across
                                      # the schedule
principal_payment: money             # total of payments applied to
                                      # principal (== total_payment -
                                      # total_interest - fees_recovered,
                                      # see invariant #2 below)
trigger_rate_percent: percent        # mortgage + variable-rate only; null/NA
                                      # for personal loans and fixed-rate
                                      # mortgages
amortization_schedule: ScheduleRow[] # full per-period breakdown — see shape
                                      # below
```

```
ScheduleRow:
  period: int
  date: date                          # this row's payment date
  days_in_period: int                 # actual calendar days since the prior
                                       # row's date (or since start_date for
                                       # the first row) — feeds period_interest
  opening_balance: money
  period_interest: money              # openingBalance x calculated_rate x
                                       # (days_in_period / 365), split across
                                       # a leap-year boundary if the period
                                       # straddles one (see equation
                                       # "period_interest")
  carried_accrued_interest_opening: money   # unrecovered accrued interest
                                       # entering this row (0 once fully
                                       # recovered, always 0 for
                                       # newMortgageOrLoan flows)
  fees_opening: money                  # feesToRecover balance entering this
                                       # row
  payment_amount: money                # this flow's constant payment_amount
  interest_paid: money                 # portion of the payment applied to
                                       # period_interest + carried accrued
                                       # interest (waterfall step 1)
  fees_paid: money                     # portion applied to fees_opening
                                       # (waterfall step 2)
  principal_portion: money             # remainder, applied to opening_balance
                                       # (waterfall step 3)
  carried_accrued_interest_closing: money
  fees_closing: money
  closing_balance: money
```

### Restricted fields (computed only — never directly editable)

- `cob_rate_percent`
- `cob_amount`
- `number_of_payments`
- `total_payment`
- `total_interest`
- `principal_payment`
- `amortization_schedule`
- `trigger_rate_percent` (mortgage + variable-rate only, per above)

`payment_amount` is explicitly **not** in this list — it moved to a plain
input in every flow (doc 007 finding #1). `term_days` is also not in this
list; it is display-only but must track the same day-count basis as `T`
(see above).

## Conditional calculation paths

| Product type | Rate type | Compounding conversion | Trigger rate? | Notes |
|---|---|---|---|---|
| Mortgage | Fixed | `m=2`, semi-annual (eq. 1/2) | No — fixed payment always covers interest by construction | `semi_annual_compounding_date` applies |
| Mortgage | Variable | `m=n`, i.e. no conversion (eq. 2) | Yes | Payment may not cover interest if contract rate rises — this is exactly what the trigger rate flags |
| Personal loan | Fixed | `m=12` (eq. 2) | No | Applied whenever `payment_frequency` isn't monthly; reduces to `contract_rate/12` when it is |
| Personal loan | Variable | `m=12` (eq. 2) | No | Dictation/docx explicitly scopes trigger rate to mortgages only |

**Financed fees.** `loan_amount` (IN-02) is **already inclusive** of any
financed fees — financed fees are a *breakout/display* of an amount already
inside `loan_amount`, not an additive top-up (doc 007 finding #4; this
reverses the prior draft's "Reading B," which added financed fees on top of
`loan_amount`):

- `amortized_principal = loan_amount` — the balance the schedule runs
  against. Financing a fee does not change this figure at all (it's already
  in `loan_amount`); it only changes how much of `loan_amount` is cash vs.
  fee.
- `disbursal_amount = loan_amount - fees.total_financed_fees` — the actual
  cash advanced to the borrower. **Cash (non-financed) fees do NOT reduce
  disbursal** — they are paid separately by the borrower, outside the loan
  proceeds (IN-07: "Fees paid separately by the member and NOT deducted from
  the advance"; BR-04). They only enter `cob_amount` (see the `cob_amount`
  equation) and the fees-recovery waterfall (see "Payment allocation
  waterfall").

Reconciling the dictation's original two sentences ("fees deducted from loan
advanced" vs. "form a part of the principal amount"): both describe
**financed** fees specifically, from two angles — a financed fee is already
counted in the principal (`loan_amount`), and is deducted out of what's
actually advanced in cash. Cash fees don't participate in either sentence;
they're a separate, borrower-paid-outside-the-loan amount that only shows up
in the cost-of-borrowing total.

## Equations

1. **Frequency-equivalent nominal rate from a semi-annually-compounded
   contract rate** (general conversion formula), for a payment frequency
   with `n` payments/year and compounding period `m`:
   **CONFIRMED**, Interest Act, R.S.C. 1985, c. I-15, s. 6 (see prior draft
   for full sourcing — unchanged by doc 007):
   ```
   calculated_rate = n x [(1 + contract_rate/m)^(m/n) - 1]
   ```
   with per-period rate `calculated_rate / n = (1 + contract_rate/m)^(m/n) - 1`.
   This is the same formula the prior draft called "equation 1," generalized
   to an explicit `m` parameter rather than hardcoding `m=2` — see equation 2
   for how `m` is selected. When `m=n` this reduces to `calculated_rate =
   contract_rate` exactly (the algebraic basis for the variable-rate
   mortgage's "no conversion" case).

2. **Selecting `m` by product/rate type** (doc 007 finding #10 — this
   replaces the prior draft's flat "monthly compounding for every
   non-fixed-mortgage case," which was correct for variable mortgages by
   coincidence but wrong for non-monthly-frequency personal loans):
   - Fixed-rate mortgage: `m = 2` (semi-annual) — CONFIRMED, Interest Act s.
     6, per equation 1's sourcing.
   - Variable-rate mortgage: `m = n` — reduces equation 1 to
     `calculated_rate = contract_rate` (no conversion). Real-world lender
     practice genuinely varies here (TD/BMO/RBC compound variable mortgages
     monthly; Scotiabank semi-annually; FCAC's own worked example uses yet a
     third convention) — `m=n` is what this specific BRD/workbook implements
     and is not a claim about Canadian lending in general.
   - Personal loan (either rate type): `m = 12`, applied via the same
     equation 1 formula, whenever `payment_frequency` isn't itself monthly.
     Reduces to `contract_rate/12` when `payment_frequency` is monthly
     (`m=12, n=12`). Sourced from docx §4.2's explicit three-case table, not
     from a statute (Interest Act s. 6 only covers mortgages/hypothecs on
     real property, not personal loans) — treat as "this BRD's convention,"
     not a regulatory requirement.

3. **Period interest — day-count proration** (doc 007 finding #3; this is a
   new equation, not present in the prior draft, which applied
   `calculated_rate / n` as a fixed periodic rate to every row unconditionally):
   ```
   period_interest = opening_balance x calculated_rate x (days_in_period / 365)
   ```
   `days_in_period` is the actual number of calendar days between this row's
   date and the prior row's date (or between `start_date` and the first
   scheduled payment date, for the first row). If a period straddles a
   leap-year boundary, split the day count: the days falling in the leap
   year are divided by 366, the remainder by 365, and the two partial results
   summed (docx §4.4, Appendix B.3). `calculated_rate` here is always the
   frequency-equivalent nominal rate from equation 1/2 — the day-count
   proration is a second, independent step applied on top of it, never
   folded into a single fixed periodic rate. This is why an irregular period
   (a short first period, a semi-monthly schedule's uneven day gaps, a
   leap-year crossing) genuinely changes that row's interest relative to a
   "clean" period of the same nominal frequency — CONFIRMED against the live
   workbook's own values (see doc 007's worked vector: payment #1, 6 actual
   days, `227829.65 x 0.03706781471105014 x (6/365) = 138.82433838712447`,
   matching the workbook exactly).

4. **Payment allocation waterfall — interest, then fees, then principal**
   (doc 007 finding #8; also new — the prior draft had no fee-recovery
   mechanism and only ever split a row's payment into interest/principal).
   The schedule generator tracks two running values across the schedule:

   - `carried_accrued_interest`: starts at the input `accrued_interest`
     (renewal/paymentChange/variableRatePaymentChange flows; `0` for
     `newMortgageOrLoan`).
   - `fees_to_recover`: starts at `fees.total_financed_fees +
     fees.total_cash_fees` — **both** fee types combined (unlike
     `disbursal_amount`, which uses only financed fees; doc 007 finding #8).

   For each scheduled row, in order:
   1. `total_interest_due = period_interest + carried_accrued_interest`
      (this row's own new interest, plus whatever accrued interest hasn't
      yet been recovered).
   2. `interest_paid = min(payment_amount, total_interest_due)`; the
      remainder `total_interest_due - interest_paid` becomes the next row's
      `carried_accrued_interest` (this is how an under-recovered accrued
      balance continues to be applied against interest on subsequent
      payments until fully recovered, per BR-10).
   3. `remaining_after_interest = payment_amount - interest_paid`.
      `fees_paid = min(remaining_after_interest, fees_to_recover)`;
      `fees_to_recover` shrinks by `fees_paid`.
   4. `remaining_after_fees = remaining_after_interest - fees_paid`;
      `principal_portion = remaining_after_fees`; `closing_balance =
      opening_balance - principal_portion`.

   In the common case (payment comfortably exceeds interest + any accrued
   carry, and fees are fully recovered well before the fee-carrying period
   ends), this reduces to the familiar "interest first, principal second"
   split with a fee-sized detour in between. `total_interest` (the output)
   sums `interest_paid` across every row; `principal_payment` sums
   `principal_portion` across every row (the fee portion of each payment is
   tracked separately, not folded into either total — see invariant #2).

5. **Schedule generation / stop condition** (doc 007 finding #2, boundary
   corrected against the live macro source — see doc 007's "Addendum: VBA
   macro source review"): the schedule generates one row per
   `payment_frequency` period, starting at `first_payment_date`, applying
   equations 3–4 each row, and **stops without generating** the first
   candidate row whose date is *strictly after* `end_date` — a row landing
   exactly ON `end_date` IS generated (this is inclusive, not exclusive; an
   earlier version of this spec said "on or after," which is off by one
   against the real macro's `DateDiff("d", endDate, candidateDate) > 0` exit
   check). The other stop condition is unchanged:
   - the first candidate row whose date is strictly after `end_date` is not
     generated (stop), or
   - the row whose `closing_balance` reaches zero (stop, that row IS
     generated),

   whichever comes first. There is no amortization-horizon input anywhere in
   this engine (see "Data shapes" — the prior draft's
   `remaining_amortization_years`/`remaining_amortization_months` fields and
   the entire "contract term vs. amortization" framing built around them are
   removed, not reworked; doc 007 finding #2). A schedule commonly ends with
   a nonzero `closing_balance` still outstanding — that balance becomes the
   next `renewal`/`paymentChange` flow's `loan_amount` input.

6. **Trigger rate** (mortgage + variable-rate only) — unchanged from the
   prior draft's research and sourcing (CONFIRMED, matches docx §4.3
   exactly):
   ```
   trigger_rate_percent = (payment_amount x payments_per_year / loan_amount) x 100
   ```
   `loan_amount` here means the flow's current outstanding principal (the
   original `loan_amount` for a `newMortgageOrLoan` flow; the current
   balance for `renewal`/`paymentChange`/`variableRatePaymentChange` flows) —
   confirmed live in the workbook (`Other related calculations!D9`) and
   consistent with Bank of Canada Staff Analytical Note 2022-19's
   origination-time framing. See the prior draft's equation 4 for full
   sourcing (WOWA.ca, Coast Capital Savings, money.ca, BoC 2022-19) — none of
   that sourcing changes here.

7. **`cob_rate_percent` (cost-of-borrowing rate / "APR")** — CORRECTED, and now
   VBA-confirmed (doc 007 finding #7, settled definitively by doc 007's
   "Addendum: VBA macro source review", which hand-simulated the live macro's
   actual `getRate`/`COBRate` code and reproduced this doc's own worked
   vector bit-for-bit):
   ```
   if fees.total_financed_fees + fees.total_cash_fees == 0:
       cob_rate_percent = calculated_rate x 100   # SHORT-CIRCUIT, no T/P involved
   else:
       cob_rate_percent = (cob_amount / (T x P)) x 100
   ```
   **The short-circuit is not optional or approximate — it is the literal
   macro logic** (`If finFee + nonFinFee = 0 Then COBRate = aRate * 100`),
   sourced from Financial Consumer Protection Framework Regulations s. 32
   ("the APR ... is the annual interest rate if the only cost of borrowing is
   interest"), identical in shape to this project's existing `apr.py`
   (spec 002) `if total_cash_fees == 0: apr_percent = note_rate` convention.
   **No choice of `T`/`P` reproduces the short-circuit's result from the
   general formula as an identity** — confirmed numerically against the real
   workbook's actual per-row balances (see doc 007's addendum); do not try to
   reverse-engineer a `T`/`P` combination to hit a target number instead of
   implementing this explicit branch.

   For the general (`fees > 0`) branch:
   - `T = (final_payment_date - start_date).days / 365` — a **plain**
     divide-by-365, confirmed via the macro source (`totalYears = termDay /
     365`) to NOT be leap-year-adjusted, unlike equation 3's `period_interest`
     (which IS leap-year-aware). `final_payment_date` is the date of the
     **last row actually generated** by the schedule (equation 5's stop
     condition — not `end_date` itself, and not a nominal
     `term_years + term_months/12`; matches the macro's own `termDay =
     DateDiff("d", disbDate, closingDate)`, `closingDate` being the last
     generated row's date), and `start_date` is `disbursal_date`
     (`newMortgageOrLoan`) or `renewal_date` (the other three flows).
   - `P` = the average of each counted row's **opening** (beginning-of-period)
     balance, a **simple** (unweighted) average — unchanged from the prior
     draft, confirmed correct in doc 007 ("What matches" section; docx
     Appendix B.7 and the macro's own `avgOpeningPrinciple = totalOpeningPrinciple
     / pymtCount`).
   - `cob_amount` (`C`) — see equation 8, below; changed from the prior
     draft's FCPFR-filtered subset to "all fees, unconditionally."
   - Sourced from Financial Consumer Protection Framework Regulations,
     SOR/2021-181, ss. 47–48 (successor to the repealed Cost of Borrowing
     (Banks) Regulations, SOR/2001-101) for the formula's general shape —
     this BRD/workbook implements that shape with its own `T`/`C` definitions
     as detailed above, which is what this engine reproduces.

8. **`cob_amount` (cost-of-borrowing dollar amount)** — CORRECTED (doc 007
   finding #6; this drops the prior draft's FCPFR-inclusion/exclusion
   per-fee filtering entirely):
   ```
   cob_amount = total_interest + fees.total_financed_fees + fees.total_cash_fees
   ```
   All fees, unconditionally — no `included_in_cob` filtering. Confirmed live:
   `Other related calculations!D27 = Calculator!D6 + Calculator!D8` (financed
   + non-financed fees, unconditionally), with the workbook's own internal
   check `D29 (total interest) = COBAmount (D25) - D27` implying exactly this
   relationship. This makes spec 002's/the prior draft's `included_in_cob`
   flag **unnecessary for this engine** — the `financed`/`cash` axis alone is
   sufficient here. The flag itself is not removed from the shared
   `Fee`/`FeeSchedule` type (additive-fields convention; other consumers of
   that shared type may still use it) — this Canadian engine simply never
   reads it. Whether a future, more general Canadian-disclosure engine still
   wants an FCPFR-filtered `cob_amount` is a separate product question, not
   answered here (see "Open questions").

## Invariants (for the eventual domain-QA test suite)

1. **Fixed-rate mortgage ⇒ trigger rate is N/A**, never computed or
   displayed — a fixed payment on a fixed rate cannot fail to cover interest
   by construction. Unaffected by this rewrite.
2. **Reconciliation**: `total_payment == total_interest + fees_recovered +
   principal_payment` exactly (within rounding), for every flow and every
   product/rate-type combination, where `fees_recovered` is the sum of
   `fees_paid` across every scheduled row (equation 4). This replaces the
   prior draft's simpler `principal_payment + total_interest ==
   total_payment` — with the fee-recovery waterfall added, a payment now
   funds three buckets, not two, so the reconciliation identity must account
   for the fee bucket explicitly or it will appear to "leak" money whenever
   `fees_to_recover > 0`. When `fees.total_financed_fees +
   fees.total_cash_fees == 0` (no fees), `fees_recovered == 0` and the
   identity collapses back to the prior draft's two-term form, which is why
   doc 007's fee-free worked vector reconciles under either version.
3. **Financed fees never change `amortized_principal`** (revised — the prior
   draft's invariant #3 assumed financed fees were additive on top of
   `loan_amount`; that direction is now reversed, doc 007 finding #4):
   `amortized_principal == loan_amount` regardless of how `loan_amount` is
   split between financed fees and cash principal — reclassifying a dollar
   of `loan_amount` from "cash" to "financed fee" (holding `loan_amount`
   itself fixed) must not change `total_interest`, `payment_amount`-derived
   totals, or `cob_rate_percent`'s `P`, since none of those are computed from
   the fee split, only from `loan_amount` itself. It **does** change
   `disbursal_amount` (which subtracts `fees.total_financed_fees`) and
   `cob_amount` (which adds both fee totals) — those are the only two outputs
   sensitive to the financed/cash split.
4. ~~`term_days` never changes any monetary output~~ — **deleted.** This was
   the prior draft's invariant #4 and is false against the real requirements:
   the APR's `T` is computed from actual elapsed days (equation 7), which
   `term_days` is meant to track (see "Data shapes"). Varying the day-count
   basis genuinely changes `cob_rate_percent`. No replacement invariant is
   asserted here beyond "`term_days` and `T` must use the same day-count
   basis," which is already stated as a data-shape requirement rather than a
   QA invariant.
5. **Semi-annual, `m=n`, and `m=12` conversions produce different periodic
   rates for the same nominal `contract_rate_percent`** whenever `n != 2`
   and `n != 12` respectively — a fixed-rate mortgage, a variable-rate
   mortgage, and a personal loan at the *same* nominal contract rate and
   *same* non-monthly `payment_frequency` must generally produce different
   `calculated_rate` values (semi-annual compounding, at a fixed nominal
   rate, is arithmetically cheaper than monthly compounding — `(1+r/2)^2 <
   (1+r/12)^12` for `r>0` — while `m=n` degenerates to the nominal rate
   exactly, distinct from both). A test asserting these three diverge (and
   in the correct direction) guards against accidentally hardcoding one
   compounding convention everywhere. Unaffected by this rewrite except that
   `m=n`'s case (no conversion) is now a third, explicit branch rather than
   folded into the "monthly" bucket.
6. **Trigger rate monotonicity**: holding `payment_amount` and
   `payments_per_year` fixed, increasing the current outstanding balance
   (equation 6's `loan_amount`) must decrease `trigger_rate_percent` — a
   larger balance needs a lower rate to push the payment underwater.
   Unaffected by this rewrite. Note (unchanged from the prior draft's Excel
   implementation notes): because `payment_amount` is a plain user input in
   this engine (not re-derived from the balance, per finding #1), this
   invariant must be tested by holding `payment_amount` fixed and varying
   the balance independently — which this engine actually supports directly
   now, unlike the prior draft's design where `payment_amount` was always
   recomputed from whatever balance was passed in.

## Open questions

- **Open (008 C5 / D-list): the "One Time" payment frequency.** Docx IN-09
  omits it; docx B.4 lists it ("One Time"); the macro's `ValidateInput` and
  `CalculateAll` handle it (`isOneTime`). But the live dropdown on
  `Calculator!D12` (list `Payment_Frequency` = `Settings!B3:G3`, error alert
  on) offers only the six IN-09 values. Until the BRD author answers, it is
  not part of the `payment_frequency` enum. Don't implement it.

- **Resolved (reversed from the prior draft):** financed fees are **already
  included inside** `loan_amount` (doc 007 finding #4), not layered on top of
  it. `amortized_principal = loan_amount`; `disbursal_amount = loan_amount -
  fees.total_financed_fees`; cash fees never touch disbursal or the
  amortized principal, only `cob_amount` and the fees-recovery waterfall. See
  "Financed fees" above for the resolved formulas and reconciliation of the
  original dictated wording. The prior draft's CMHC-premium counter-example
  (default insurance financed "on top of" the mortgage advance) may still be
  an accurate real-world data point for *some* lenders' products, but it is
  not what this specific BRD's IN-02 describes, and IN-02's own text
  ("inclusive of any financed fees") is unambiguous on this point.
- **Resolved:** `payment_amount` is a plain required input in every flow
  (doc 007 finding #1), never solved by this engine. This engine's
  responsibility is schedule generation and totals given a payment the
  caller supplies — not an annuity solve. Any future "suggest a payment
  amount" feature (e.g. an amortization-horizon-driven PMT solve) is
  explicitly out of scope for this application per docx §1.2 and would need
  its own spec if ever built, since the real system has no amortization
  input to solve against in the first place (finding #2).
- **Resolved:** there is no "remaining amortization" concept in this engine.
  The schedule runs from `first_payment_date` to `end_date` (or until the
  balance reaches zero, whichever first) at the user-entered
  `payment_amount` — see equation 5. Renewal chaining (the next term's
  `loan_amount` seeded from this term's final `closing_balance`) is a manual
  step between separate calculations, same as the prior draft's Excel
  implementation notes already described, not an automatic multi-term
  solve.
- **Resolved:** reuse spec 002's `Fee`/`FeeSchedule` shape (`name`, `amount`,
  `financed: bool`) as-is; this engine does not use the `included_in_cob`
  field spec 002 defines for other consumers (equation 8 above uses all fees
  unconditionally). No new fee shape is needed for this application. Whether
  a stricter, FCPFR-filtered `cob_amount` mode is ever worth adding as an
  opt-in for a different, more general-purpose Canadian disclosure engine is
  a distinct product question, not resolved here (doc 007's "Follow-up
  work" item 3).
- **Resolved:** new sibling module (a Canadian engine alongside the existing
  US-style `COB-ts`/`COB-py`), not a compounding-convention parameter bolted
  onto the existing one. This decision is unaffected by any of doc 007's ten
  findings — see the prior draft's full reasoning (US engine's
  `calculateMonthlyPayment`/`compute_segment_schedule` hardcode monthly
  compounding independently in multiple places with no injection point; the
  two engines' output shapes don't line up — `LoanSummary` aggregates a
  full stitched multi-segment schedule, this spec needs single-term totals
  with the final balance handed to the next term). The one piece of
  country-agnostic math worth sharing, if either engine is refactored later,
  is the day-count interest-accrual and interest→fees→principal waterfall
  logic itself (equations 3–4) — genuinely new primitives introduced by this
  rewrite, not present in the US engine, so there is nothing to reuse there
  yet; if a second Canadian-style (day-count-prorated, waterfall-allocated)
  product ever gets built, extracting those two equations into a shared
  primitive would be the natural refactor, analogous to the prior draft's
  suggestion for the annuity formula (which is no longer relevant to this
  engine at all, since it no longer solves for a payment amount).

## Excel implementation notes

A reference implementation exists (`COB-xlsx/build_workbook_ca.py` →
`COB_Calculator_CA.xlsx`). As of 2026-09-23 the **uncommitted** working-tree
builder has been re-implemented against this rewrite. Its header lists payment
as an input, no amortization horizon, the 365/366 day-count split, a carried
accrued-interest column, the waterfall, and
`disbursal = loan − financed_fees`. The committed version (`2314d14`) is
still the pre-reconciliation model. The judgment calls below record what had
to change from the prior draft. They are kept for traceability. The working-tree
builder was spot-checked by grep on 2026-09-23 for #1 (the disbursal formula), #2 (the
"Included in COB" column is kept but unused), #3 (no capitalization) and #5
(no amortization horizon). It has not been checked item by item beyond that,
and the generated workbook has not been recalculated or parity-checked against
the macro.

### Judgment calls that must change when the workbook is rebuilt

1. **Financed-fee carve-out direction (prior judgment call #1): superseded,
   not a judgment call at all — doc 007 finding #4 settles it definitively
   against the BRD text.** The prior draft's resolution (`disbursal_amount =
   loan_amount + fees.total_financed_fees - fees.total_cash_fees`,
   `amortized_principal = loan_amount + fees.total_financed_fees`) is
   **wrong** relative to the real BRD. The corrected mechanism (see
   "Financed fees" above) is `amortized_principal = loan_amount` (no change
   from `loan_amount` at all) and `disbursal_amount = loan_amount -
   fees.total_financed_fees` (cash fees never touch disbursal). When the
   workbook is rebuilt, `COB_CA!B50`/`B52` (or their successors) need this
   formula change, not a re-litigation of which reading is correct — that
   question is now closed.
2. **Fee shape (prior judgment call #2): mostly still fine, `Included in
   COB? Y/N` column becomes unused.** The 4-column itemized fee table
   (`Fee name`, `Amount`, `Financed? Y/N`, `Included in COB? Y/N`) can stay
   structurally as-is for the rebuild, but the `Included in COB?` column no
   longer drives `cob_amount` (equation 8 now sums all fees unconditionally,
   both financed and cash) — either drop the column or leave it as an
   unused/informational field, but don't wire it into the `cob_amount`
   formula.
3. **Accrued-interest carry-forward mechanics (prior judgment call #3):
   superseded — doc 007 finding #5 specifies the real mechanism explicitly,
   this is no longer an open judgment call.** The prior draft's choice
   (capitalize `accrued_interest` into `P0`/the opening balance, the same
   way a financed fee was treated) is **wrong**. The corrected mechanism is
   the `carried_accrued_interest` running value described in equation 4
   above: it starts at the input `accrued_interest`, is added to
   `period_interest` to form `total_interest_due` for the waterfall, shrinks
   by whatever the waterfall recovers as interest beyond the period's own
   new accrual, and carries to the next row until it hits zero — the opening
   balance itself is never touched by this value. When the workbook is
   rebuilt, this needs a new tracked column per schedule row (similar to how
   `fees_opening`/`fees_closing` need their own columns for the waterfall,
   per finding #8), not a single origination-time addition into `P0`.
4. **`P` in the APR formula (prior judgment call #4): unaffected, still
   correct.** Average of each row's beginning-of-period balance — confirmed
   correct by doc 007's "What matches" section, no change needed on rebuild.
5. **Term-vs-amortization clamp (prior judgment call #5): no longer
   applicable — the concept it was clamping doesn't exist anymore.** There is
   no `remaining_amortization` input to clamp a term against in the
   corrected model (doc 007 finding #2); this judgment call and its
   `COB_CA!B58` `MIN(...)` formula should simply be deleted on rebuild, not
   reworked.
6. **Renewal chaining out of scope (prior judgment call #6): unaffected,
   still the right scope boundary.** A rebuilt workbook still only needs to
   compute one term/flow at a time, with the final `closing_balance` manually
   carried into the next calculation's `loan_amount` input — same as before.
7. **Invariant #5 direction discrepancy (prior judgment call #7): the
   underlying math observation (semi-annual compounding is cheaper than
   monthly at the same nominal rate, not "more expensive" as the prior
   draft's invariant #5 prose claimed) is still correct and still worth
   preserving in the rebuilt invariant's prose — unaffected by this rewrite's
   equation changes, since equation 1's conversion formula itself didn't
   change.
8. **Invariant #6 trigger-rate monotonicity test setup (prior judgment call
   #8): now easier, not harder, to test correctly.** The prior draft's
   caveat existed because that workbook always recomputed `payment_amount`
   from the same balance used as `total_borrowed`, so varying the balance
   alone couldn't isolate the invariant. In the corrected model,
   `payment_amount` is a plain input never re-derived from the balance (per
   finding #1), so the invariant can be tested directly by holding
   `payment_amount` fixed and varying `loan_amount` — no special-cased setup
   needed on rebuild.

### Scope notes (unaffected by this rewrite, still apply to the rebuild)

- Sibling workbook, not sheets inside `COB_Calculator.xlsx` — same reasoning
  as before (the two engines share almost no domain concepts).
- `semi_annual_compounding_date` stays a pure display/reference input.
- Data-validation dropdowns for Flow (now 4 values, not 6), Product type,
  Rate type, and Payment frequency (6 values per IN-09, see
  `payment_frequency`), implemented as Excel list validations, not macros.
- The amortization schedule sheet needs new columns for
  `days_in_period`, `carried_accrued_interest_opening/closing`, and
  `fees_opening/closing` that the prior schedule sheet didn't have (the
  waterfall and day-count proration are both new mechanics — see equations
  3–4).

## Equations research

Unchanged from the prior draft except where superseded by doc 007's
findings, which are called out inline in "Equations" above (equations 1, 2,
3, 4, 5, 7, 8 all carry a note where their content changed; equation 6,
trigger rate, is unaffected). Headline status:

- **Equation 1** (semi-annual→periodic conversion): unaffected, confirmed
  exactly, grounded in Interest Act, R.S.C. 1985, c. I-15, s. 6.
- **Equation 2** (`m` selection by product/rate type): revised — now three
  explicit branches (`m=2` fixed mortgage, `m=n` variable mortgage, `m=12`
  personal loan) rather than a flat "monthly for everything but fixed
  mortgages" rule. The variable-mortgage and personal-loan conventions
  remain this-BRD-specific, not a claim about Canadian lending generally —
  same caveat as before, just attributed to the correct three-way split now.
- **Equation 3** (day-count period interest): new. Sourced directly from
  docx §4.4/Appendix B.3 and verified exactly against the live workbook's
  own computed values (doc 007's worked vector).
- **Equation 4** (payment waterfall): new. Sourced from docx BR-13/Appendix
  B.5 and the live workbook's `Fees (Opening)`/`(Closing)` columns.
- **Equation 6** (trigger rate): unaffected — still CONFIRMED, same sourcing
  as the prior draft (Bank of Canada Staff Analytical Note 2022-19, WOWA.ca,
  Coast Capital Savings, money.ca).
- **Equation 7** (`cob_rate_percent`/APR): shape unaffected (Financial
  Consumer Protection Framework Regulations, SOR/2021-181, ss. 47-48); `T`'s
  definition corrected per doc 007 finding #7.
- **Equation 8** (`cob_amount`): corrected — drops the FCPFR s.48
  inclusion/exclusion filtering entirely in favor of "all fees,
  unconditionally," per doc 007 finding #6. The FCPFR sourcing itself isn't
  wrong as regulatory background, it's simply not what this BRD/workbook
  implements.
