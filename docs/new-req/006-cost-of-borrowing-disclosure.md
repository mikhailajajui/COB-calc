# 006 — Cost of Borrowing (COB) Disclosure: mortgage & loan workflows

## Status

**Spec only — no reference implementation yet.** The equations research pass
(see "Equations research" below) is now complete: every formula in "##
Equations" has been checked against a regulatory or industry source and is
labeled CONFIRMED, CORRECTED, or BEST AVAILABLE (with the caveat spelled out
inline). Two items are worth flagging before implementation starts: equation
4 (trigger rate) was corrected/clarified (the dictated formula is exact once
`total_borrowed` means *current outstanding balance*, not original
principal), and equation 6 (COB rate) was corrected outright — Canadian
regulation uses an average-outstanding-balance formula, not the
present-value/IRR solve this project's existing spec-002 APR engine uses, so
that solver must **not** be reused as-is.

## Problem

The existing engine (`COB-ts` / `COB-py`) models US-style mortgages:
monthly-compounding, monthly-periodic amortization, with APR treated as a
simplified actuarial-equivalent rate (spec 002). It has no concept of:

- **Semi-annual compounding**, which is the statutory default for Canadian
  fixed-rate mortgages (Interest Act, s. 6) — the disclosed/contract rate
  compounds semi-annually not in advance, and payments still fall on a
  monthly/biweekly/weekly schedule, so a periodic rate must be derived from
  the semi-annual nominal rate rather than dividing by the number of periods
  directly.
- **Financed fees increase the amortized principal without reducing
  disbursal** — a fee "financed" (e.g. a mortgage default insurance premium)
  is added into the balance the payment schedule amortizes but does **not**
  reduce the cash advanced to the borrower; the opposite is true of a
  cash-paid (unfinanced) fee, which reduces disbursal but never touches the
  amortized principal (see "Financed fees" under "Conditional calculation
  paths" for the resolved formulas) — either way, a fee is not a purely
  cosmetic disclosure line item, it moves real money in one direction or the
  other.
- **A trigger rate** — the contract rate at which a fixed payment on a
  variable-rate mortgage stops covering accruing interest (relevant only to
  variable-rate mortgages, not personal loans or fixed-rate mortgages).
- **Distinct dropdown-driven workflows** (new mortgage, new loan, existing
  mortgage, existing loan, payment change, variable-rate payment change),
  each of which asks for a different subset of inputs and runs a different
  calculation path (e.g. "existing" flows use a renewal date and an accrued
  interest carry-forward instead of a disbursal date).
- **Contract term vs. amortization are two different lengths.** Canadian
  mortgages are quoted with a short, renewable **contract term** (commonly 3
  or 5 years, but must be user-customizable — not hardcoded to those two
  values) inside a much longer **amortization period** (the total payoff
  horizon, e.g. 25–30 years). The rate is only locked for the term; at
  `end_date` (the term's maturity date) the mortgage renews into a new term
  at a new rate, while the amortization schedule continues uninterrupted
  from wherever the remaining balance/remaining-amortization stood. The
  existing US-style engine has no such split (a US fixed mortgage's rate is
  locked for the full amortization). This spec's `term_years`/`term_months`/
  `term_days` inputs are the **contract term**, not the amortization period
  — see "Data shapes" for the added `remaining_amortization_*` fields this
  requires.

This spec organizes the raw field list into inputs / outputs / derived
fields, the conditional logic that picks a calculation path, and the
equations each output requires — flagging which equations still need
research validation.

## Scope

**In scope:** field inventory, presentation-layer flow (dropdown → which
fields apply), conditional compounding/trigger-rate logic by product type and
rate type, and the equation each derived output requires.

**Out of scope for this spec:** actual disclosure-statement copy/legal
wording, HELOC draws, multi-lien scenarios, and wiring this into the existing
`segment.ts`/`mortgage.ts` stitching engine (that integration is a follow-up
once the equations are verified and a language/module target is chosen).

**Honesty about precision** (same caveat pattern as spec 002): this is a
**borrower-facing cost-of-borrowing calculator**, not a certified regulatory
disclosure engine. Canadian Cost of Borrowing (Banks) Regulations disclosure
has precise rules about which fees are included, day-count conventions, and
mandated rounding that this spec does not claim to reproduce exactly. Treat
every formula here as "good enough to show a consistent, explainable
estimate," not as a substitute for a bank's compliance-reviewed disclosure
statement.

## Presentation layer: dropdown-driven workflows

A single top-level dropdown selects one of six flows. The flow selected
determines which date field appears (pre-approval vs. renewal), whether
accrued interest carries forward, and whether a trigger rate is computed.

| Flow | Product | Date field shown | Uses accrued interest carry-forward? | Trigger rate computed? |
|---|---|---|---|---|
| New mortgage | Mortgage | Pre-approval date | No | Yes, if rate type = variable |
| New loan | Personal loan | Pre-approval date | No | No (loans never show a trigger rate) |
| Existing mortgage | Mortgage | Renewal date | Yes | Yes, if rate type = variable |
| Existing loan | Personal loan | Renewal date | Yes | No |
| Payment change | Either | Renewal date | Yes | Yes, if mortgage + variable |
| Variable rate payment change | Mortgage, variable only | Renewal date | Yes | Yes (always — this flow exists specifically to recompute it) |

In every flow, `payment_amount` is computed, never entered — see "Data
shapes" below. "Payment change" / "variable rate payment change" recompute
the payment off the *current outstanding balance* and *remaining
amortization* (not the original `loan_amount`/full amortization), same as a
renewal, just without necessarily changing the contract term or rate type.

Two more dropdowns condition the calculation path directly:

- **Product type:** `mortgage` \| `personal loan`
- **Rate type:** `variable` \| `fixed`

**Compounding rule** (as dictated): fixed-rate **mortgages** compound
**semi-annually**; every other combination (variable-rate mortgage, and
personal loans regardless of rate type) compounds **monthly**. The
fixed-mortgage case is **confirmed** (Interest Act s. 6 — see equation 1).
The variable-mortgage and personal-loan cases are **best-available, not
authoritative**: real Canadian variable-rate mortgages compound monthly at
some lenders (TD, BMO, RBC) but semi-annually at others (Scotiabank), and
personal-loan monthly compounding is sourced from consumer-finance
commentary rather than a statute (Interest Act s. 6 only covers
mortgages/hypothecs on real property) — see equation 2 for full sourcing
and the recommendation to keep this configurable rather than hardcoded.

## Data shapes

### Inputs — common to every flow

```
loan_amount: money                  # face/contract amount before financed fees
                                      # are netted out of disbursal
fees: FeeSchedule                    # itemized fee list — reuses spec 002's
                                      # Fee/FeeSchedule shape (Fee: name,
                                      # amount, financed: bool), extended with
                                      # a second, independent per-fee
                                      # `included_in_cob: bool` flag (see
                                      # equation 7 and "Open questions" for
                                      # why these two flags are not the same
                                      # axis). `financed_fees` — the amount
                                      # ADDED to the amortized principal
                                      # without reducing cash disbursed,
                                      # discussed throughout this doc (see
                                      # "Financed fees" below) — is now the
                                      # derived aggregate
                                      # `fees.total_financed_fees`, not a raw
                                      # scalar input; the carve-out direction
                                      # question below is now resolved
                                      # (financed fees layer on top of
                                      # `loan_amount`, matching spec 002's
                                      # `effective_loan_amount`) and unaffected
                                      # by this shape change.
contract_rate_percent: percent       # the "calculated rate" / contracted
                                      # interest rate, nominal annual
payment_frequency: enum              # monthly | semiMonthly | biweekly |
                                      # weekly (reuse the frequency enum
                                      # already defined for payment-frequency
                                      # scheduling, do not invent a new one)
disbursal_date: date                 # new-flow only; see date fields below
term_years: int                      # CONTRACT TERM, not amortization —
                                      # user-customizable (commonly 3 or 5
                                      # years in Canadian practice, but not
                                      # restricted to those two values; do
                                      # not render this as a fixed
                                      # 3-or-5-only dropdown)
term_months: int                     # contract term, months component
term_days: int                       # DISPLAY ONLY — derived from
                                      # disbursal_date/first_payment_date +
                                      # term_years/term_months, never an
                                      # independent input to any formula
remaining_amortization_years: int    # what's left of the full payoff
                                      # horizon at the start of THIS
                                      # contract term. For new-flow inputs,
                                      # equals the full requested
                                      # amortization (e.g. 25y); for
                                      # existing/renewal flows, this is
                                      # shorter than the original
                                      # amortization by however much has
                                      # already amortized
remaining_amortization_months: int   # remaining amortization, months
                                      # component
first_payment_date: date
end_date: date                       # end of THIS CONTRACT TERM (maturity/
                                      # renewal date), NOT the amortization
                                      # payoff date — see "Contract term vs.
                                      # amortization" in Problem
product_type: enum                   # mortgage | personalLoan
rate_type: enum                      # variable | fixed
```

`payment_amount` is **always an output**, never a direct input, across
every flow (this resolves what was previously an open question below):
every flow supplies `loan_amount` (or current outstanding balance),
`contract_rate_percent`, `payment_frequency`, and `remaining_amortization_*`,
and the payment amount is solved from those via the annuity formula
(equation 3). "Payment change" and "variable rate payment change" flows are
not the borrower fixing a payment and solving for something else — they are
the *lender* recomputing the required payment (off the current balance,
current/new rate, and remaining amortization) after a rate change or a
scheduled payment reset, exactly like a new/renewal calculation but seeded
from the current balance instead of the original `loan_amount`.

### Inputs — flow-conditional

```
pre_approval_date: date              # new mortgage / new loan ONLY
renewal_date: date                   # existing mortgage / existing loan /
                                      # payment change / variable rate
                                      # payment change ONLY
accrued_interest: money              # existing/renewal flows: interest
                                      # accrued since the last payment,
                                      # carried into this calculation
semi_annual_compounding_date: date   # fixed-rate mortgages only — the
                                      # reference date the semi-annual
                                      # compounding periods are anchored to
                                      # (needed to convert the nominal
                                      # semi-annual rate into a periodic rate
                                      # aligned with payment_frequency)
```

### Outputs

```
cob_amount: money                    # total cost-of-borrowing dollar amount
                                      # (== "cost of borrowing dollar amount"
                                      # in the restrictions list below —
                                      # same field, listed twice in the
                                      # dictation)
cob_rate_percent: percent            # cost-of-borrowing rate, i.e. this
                                      # project's equivalent of APR
total_payment: money                 # total of all payments over the term
number_of_payments: int              # total count of scheduled payments
total_interest: money                # total of all interest across the term
principal_payment: money             # total of payments applied to
                                      # principal (== total_payment -
                                      # total_interest, should reconcile
                                      # exactly — see invariants)
trigger_rate_percent: percent        # mortgage + variable-rate only; null/NA
                                      # for personal loans and fixed-rate
                                      # mortgages
amortization_schedule: ScheduleRow[] # full per-period breakdown: period #,
                                      # date, payment, interest portion,
                                      # principal portion, remaining balance
```

**Term vs. amortization scoping.** All of the above outputs
(`total_payment`, `number_of_payments`, `total_interest`,
`principal_payment`, `cob_amount`, `cob_rate_percent`,
`amortization_schedule`) are scoped to the **current contract term**, not
the full amortization — this matches the regulatory APR formula (equation
6), whose `T` is the term in years, not the amortization. `payment_amount`
itself is solved using `remaining_amortization_*` as the annuity's `n`
(equation 3), but only the payments that actually fall within `term_years`/
`term_months` are counted/summed/scheduled. The schedule's final row's
`remaining_balance` becomes the next renewal's opening outstanding balance —
this is what "existing mortgage" / "payment change" flows use as their
current-balance input instead of `loan_amount`.

### Restricted fields (computed only — never directly editable)

These were listed separately in the dictation ("out restriction") but map
1:1 onto outputs already defined above, plus `term_days` and
`semi_annual_compounding_date`, which are display/reference fields rather
than freestanding calculations:

- `semi_annual_compounding_date` (fixed-rate mortgages only)
- `cob_rate_percent` (labelled "ARP" in the dictation — almost certainly a
  mis-transcription of **APR**; treated as the same field as
  `cob_rate_percent` above, not a separate output)
- `cob_amount`
- `number_of_payments`
- `total_payment`
- `total_interest`
- `principal_payment`
- `amortization_schedule`
- `trigger_rate_percent` (mortgage-only, per above)

## Conditional calculation paths

| Product type | Rate type | Compounding | Trigger rate? | Notes |
|---|---|---|---|---|
| Mortgage | Fixed | Semi-annual (confirmed, eq. 1) | No — fixed payment always covers interest by construction | `semi_annual_compounding_date` applies |
| Mortgage | Variable | Monthly (best-available default, eq. 2 — varies by lender) | Yes | Payment may not cover interest if contract rate rises — this is exactly what the trigger rate flags |
| Personal loan | Fixed | Monthly (best-available default, eq. 2) | No | |
| Personal loan | Variable | Monthly (best-available default, eq. 2) | No | Dictation explicitly scopes trigger rate to "mortgage only" |

**Financed fees (resolved — see "Open questions").** Financed fees are
**layered on top of** `loan_amount`, not carved out of it — the same
direction as spec 002's `effective_loan_amount = loan_amount +
fees.total_financed_fees`, generalized per-fee via the same `Fee.financed`
flag this spec already reuses from spec 002:

- amortized principal = `loan_amount + fees.total_financed_fees` — what
  `payment_amount` (equation 3), `total_interest`, and equation 6's
  average-balance `P` are all computed against. Financing a fee never
  reduces this; it only ever grows it.
- disbursal amount = `loan_amount + fees.total_financed_fees -
  fees.total_cash_fees` — mirrors spec 002's `amount_financed =
  effective_loan_amount - total_cash_fees` exactly. Only cash (unfinanced)
  fees reduce what's disbursed; financed fees do not.

Read this way, the dictation's two sentences ("fees deducted from loan
advanced" vs. "form a part of the principal amount") are not two competing
models of the same dollar — they're describing two different fee types:
"deducted from loan advanced" describes what a **cash** fee does to
disbursal, and "form a part of the principal amount" describes what a
**financed** fee does to the amortized balance. Once the two sentences are
attributed to the two `Fee.financed` states they actually apply to, the
dictation stops being contradictory.

**New vs. existing disposal amount.** "New product disposal amount, grossed
or financed fees" in the dictation is read as: the amount actually disbursed
on a **new** mortgage/loan is `loan_amount + fees.total_financed_fees -
fees.total_cash_fees` — gross `loan_amount` when there are no cash fees
(fees are either absent or fully financed), reduced only by whatever fees
are cash-paid. The same `Fee.financed` boolean-per-fee model as spec 002
generalizes this correctly, via the `FeeSchedule` aggregates now in "Data
shapes" above (`total_financed_fees`/`total_cash_fees`), not a single
`financed_fees` scalar.

## Equations

Every formula below has been through the research pass described in
"Equations research" and is labeled CONFIRMED, CORRECTED, or BEST AVAILABLE
with sourcing inline. These are ready to implement against, subject to the
caveats called out per-item (especially equations 2 and 4) and the
still-open items in "Open questions" below (which are about field semantics,
not the math itself).

1. **Periodic rate from a semi-annually-compounded nominal rate**
   (fixed-rate mortgages), for a payment frequency with `n` payments/year:
   **CONFIRMED**: `i_period = (1 + contract_rate/2)^(2/n) - 1`.
   Interest Act, R.S.C. 1985, c. I-15, s. 6 requires that for a mortgage on
   real property with blended (principal + interest) payments, no interest
   is chargeable at all unless the mortgage states "the amount of the
   principal money and the rate of interest chargeable on that money,
   calculated yearly or half-yearly, not in advance" — the statutory basis
   for "Canadian mortgages compound semi-annually." The formula itself
   (converting the semi-annual nominal rate to whatever periodic rate
   matches the payment frequency) is the well-known "Canadian mortgage
   constant" conversion: `(1 + i_period)^n = (1 + contract_rate/2)^2`, i.e.
   `n` periodic compoundings must reproduce the same effective annual rate
   as 2 semi-annual compoundings, which solves to the candidate formula
   exactly. Corroborated by a worked example (monthly case, `n=12`, so
   `2/n = 1/6`) in the standard Canadian-mortgage-math treatment at
   yorku.ca/amarshal/mortgage.htm ("A Guide to Mortgage Interest
   Calculations in Canada") and consistent with every other secondary
   source checked (WOWA.ca, WealthNorth). No source disagreement found —
   this is the uncontroversial, universally-used formula for fixed-rate
   Canadian mortgages.

2. **Periodic rate for monthly-compounding cases** (variable mortgages,
   all personal loans): **BEST AVAILABLE, with caveat** —
   `i_period = contract_rate / n` (simple nominal/n convention).
   Interest Act s. 6 (see equation 1) applies to mortgages with blended
   payments generally; it does not mandate monthly-vs-semi-annual, it only
   requires *some* yearly-or-half-yearly-stated rate for interest to be
   chargeable at all, so lenders are free to compound variable mortgages
   either way as long as they disclose consistently. Real-world practice is
   genuinely split: a mortgage-planner industry source
   (integratedmortgageplanners.com, "Interest-rate Compounding: A Devil in
   the Detail") reports TD explicitly calculates its variable rate
   "monthly, not in advance" (nominal/n, matching the candidate formula),
   as do BMO and RBC — but Scotiabank compounds its variable-rate mortgages
   semi-annually, the same as fixed-rate ones. FCAC's own worked
   information-box example for a variable-rate mortgage
   (canada.ca/.../credit-variable-fixed-mortgage.html) uses a third
   convention again: "interest is compounded twice per year but charged
   monthly" (semi-annual compounding, monthly-in-arrears charging — closer
   to equation 1's conversion than to simple nominal/n). **Conclusion:**
   there is no single authoritative answer for variable-rate mortgages —
   `contract_rate / n` is a reasonable, common default (and it's the
   convention that makes the trigger-rate identity in equation 4 exact),
   but this should be treated as a per-lender configurable assumption, not
   a hardcoded fact, and the doc/UI should say so if this ever becomes
   borrower-facing. For **personal loans**, Interest Act s. 6 does not
   apply at all (it is scoped to mortgages/hypothecs on real property), so
   there is no statutory compounding rule to confirm against; secondary
   consumer-finance sources (hardbacon.ca, thefinanceguys.ca) describe
   monthly compounding as the common convention for instalment personal
   loans, with lines of credit more often using simple daily interest —
   this is a reasonable default but is sourced from industry commentary,
   not regulation, so keep it labeled as an assumption rather than a
   confirmed rule.

3. **Payment amount** (new flows: solve for payment given rate/term):
   **CONFIRMED** — standard annuity formula, `PMT = P × [r(1+r)^n] / [(1+r)^n
   - 1]` with `P` = amortized principal (`loan_amount +
   fees.total_financed_fees`, per the resolved carve-out direction — see
   "Financed fees" and "Open questions"), `r`
   = `i_period` from (1) or (2), `n` = total number of payments. This is a
   pure mathematical identity (present value of an ordinary annuity, solved
   for payment) independent of any Canadian-specific rule — the only
   country-specific input is which `i_period` (1 or 2) feeds it. **Reuse
   this project's existing annuity implementation, do not reimplement.**

4. **Trigger rate** (mortgage + variable only) — as dictated:
   `trigger_rate = (payment_amount × payments_per_year) / total_borrowed`
   **CONFIRMED, with `total_borrowed` clarified to mean current outstanding
   principal balance** (not the original loan amount, except at the moment
   of disbursal when the two are equal). This is **not** an approximation —
   it is algebraically the exact rigorous per-period solve once you plug in
   the right compounding convention. Derivation: the rigorous definition
   solves for periodic rate `r*` such that `payment_amount ==
   outstanding_balance × r*` (interest-only, principal portion zero), i.e.
   `r* = payment_amount / outstanding_balance`. Annualizing `r*` using
   *the same monthly/nominal-per-n convention as equation 2* (which is the
   convention that actually applies to variable-rate mortgages — trigger
   rate is only defined for the variable case) gives `annual_trigger_rate =
   r* × n = payment_amount × n / outstanding_balance`, which is exactly the
   dictated formula. So the dictated formula is correct *provided*
   `total_borrowed` means outstanding balance and the monthly-compounding
   convention from equation 2 applies (if a lender instead compounds its
   variable mortgage semi-annually per equation 2's caveat, the correct
   annualization is the equation-1 conversion applied in reverse, not a
   flat `× n`).
   - **Sources**: multiple independent industry explainers state the
     formula identically: "(Payment amount × # of Payments per year /
     Balance owing) × 100 = Trigger rate" — see WOWA.ca ("What is the
     Mortgage Trigger Rate?"), Coast Capital Savings ("What is a trigger
     rate and how is it calculated?"), and money.ca, all using "balance
     owing" / current outstanding balance, not original principal, and
     WOWA gives a fully worked numeric example ($500,000 balance,
     $1,998.59 monthly payment → 4.80% trigger rate) that reproduces
     exactly via this formula.
   - **Top source**: Bank of Canada Staff Analytical Note 2022-19
     (Murchison & teNyenhuis, "Variable-Rate Mortgages with Fixed Payments:
     Examining Trigger Rates," bankofcanada.ca/2022/11/staff-analytical-notes-2022-19)
     gives the qualitative definition ("the interest rate at which the
     interest portion of the payment equals the total payment amount, and
     therefore the principal portion is zero") and makes the important
     observation that **at origination**, "the trigger rate does not
     depend on the size of the loan" and "is a function of the term to
     maturity and the initial (contractual) interest rate" — because
     payment and original principal scale together at fixed rate/
     amortization, the ratio is loan-size-invariant *at t=0*. This
     reconciles cleanly with the `total_borrowed` question: for **new**
     mortgage flows (no payments made yet), `outstanding_balance ==
     loan_amount` (or the amortized principal after financed fees), so
     using `loan_amount` is correct and matches the BoC's origination-time
     framing; for **existing/renewal/payment-change** flows, the balance
     has since amortized (or grown, under negative amortization) away from
     the original principal, so the *current outstanding balance* must be
     used, matching the industry-calculator sources above and invariant #6
     below (trigger rate recomputed off the current balance is what
     borrowers and lenders actually check as rates move).
   - **Practical note**: this ratio-based formula implicitly assumes the
     lender does not apply prepayments/skip-payments between now and the
     trigger point; several sources (nesto.ca, Wahi) flag that a
     prepayment shifts the true trigger point higher than this formula
     predicts, since it reduces balance without changing scheduled payment
     — worth a comment in the eventual implementation but not a change to
     the formula itself.

5. **Total interest / total payment / principal payment**: **CONFIRMED** —
   standard amortization identities —
   `total_payment = payment_amount × number_of_payments` (+ any
   partial/odd final payment),
   `total_interest = total_payment - principal_amortized`,
   `principal_payment = total_payment - total_interest`
   (i.e. `principal_payment == principal_amortized` and should reconcile
   exactly — flagged as invariant #2 below). These are not expected to need
   research beyond confirming odd-day / short-first-period handling given
   `disbursal_date` vs. `first_payment_date` may not be an exact period
   apart.

6. **COB rate (cost-of-borrowing rate / "APR")**: **CORRECTED — does NOT
   reuse spec 002's IRR/actuarial solve.** Canadian federal regulation
   prescribes a different, simpler formula:
   `APR = (C / (T × P)) × 100`, where `C` is the dollar cost of borrowing
   over the term (see equation 7), `T` is the term expressed in years (to
   at least two decimal places), and `P` is the *average of the principal
   outstanding at the end of each payment period, before subtracting the
   payment due at that time*. This is an average-outstanding-balance
   method, not a present-value/IRR solve — materially different from spec
   002's `apr_percent`, which solves for the rate that reconciles
   `amount_financed` against the note-rate payment stream (a Reg-Z-style
   actuarial method). Do not reuse spec 002's solver for this field;
   implement the average-balance formula separately.
   - **Governing source (current)**: Financial Consumer Protection
     Framework Regulations, SOR/2021-181 (in force since June 30, 2022),
     ss. 47–48 — s. 47(1) states the `APR = (C/(T×P)) × 100` formula
     verbatim with the variable definitions above; s. 47(2)(a) adds a
     rounding rule ("the APR may be rounded off to the nearest eighth of a
     per cent") and that "a period of one month is 1/12 of a year"; a
     parallel simplification (s. 32, general Framework provisions) states
     "the APR for a credit agreement is the annual interest rate if the
     only cost of borrowing is interest" — the same no-extra-cost
     short-circuit spec 002 already implements (invariant #1 there), just
     under a different underlying formula.
   - **Superseded source**: the same formula (same `C`/`T`/`P` structure,
     then numbered s. 3(1)) previously lived in the Cost of Borrowing
     (Banks) Regulations, SOR/2001-101 — that regulation was **repealed
     effective 2022-06-29** by SOR/2021-181 s. 122 and folded into the
     Financial Consumer Protection Framework Regulations above; cite the
     current Framework Regulations going forward, not the archived COBR
     (laws-lois.justice.gc.ca still serves the archived text under an
     "ARCHIVED" banner, which is easy to cite by mistake).
   - This has a direct consequence for the semi-annual-vs-monthly
     compounding question in equations 1/2: because the regulatory APR
     formula works off average outstanding balance and total cost, not a
     compounding-convention-sensitive IRR solve, the compounding choice
     mainly affects `payment_amount`/`total_interest` (equations 1–3)
     upstream, and only flows into `cob_rate_percent` indirectly through
     `C` and `P`.

7. **Cost of borrowing dollar amount (`cob_amount`)**: **CONFIRMED, shape
   correct, fee-inclusion list now specified** —
   `cob_amount = total_interest + total_fees_included_in_cob`, where
   `total_fees_included_in_cob` is defined by regulation, not by this
   project's existing `financed`/`cash` fee split (spec 002). Financial
   Consumer Protection Framework Regulations s. 48(1) (successor to Cost of
   Borrowing (Banks) Regulations s. 5(1), repealed 2022-06-29 — see equation
   6) defines cost of borrowing as "all the costs of borrowing under the
   loan over its term, in particular the interest or discount that applies
   to the loan," and explicitly **includes**: administrative charges;
   insurance charges other than those excluded below; broker charges (where
   the charge is included in the amount borrowed and paid by the bank
   directly to the broker); and charges for appraisal, inspection or
   surveying services related to the property given as security, where the
   bank requires them. Section 48(2) explicitly **excludes**: optional
   insurance charges; overdraft charges; fees to register a security
   interest or obtain public-registry information about one; prepayment
   penalties/charges; borrower-purchased title insurance; mortgage default
   insurance premiums (high-ratio insurance); and discharge fees. This is a
   materially different inclusion list from spec 002's Reg Z-flavoured
   `financed`/`cash` split — e.g., a prepayment penalty or discharge fee
   might sit in this project's generic `Fee` model but must **never** be
   added into `cob_amount`, regardless of whether it's flagged `financed`.
   Recommend a dedicated `included_in_cob: bool` flag per fee (distinct from
   `financed: bool`) rather than assuming the two coincide.

8. **`term_days` (display only)**: **CONFIRMED as a pure display
   derivation** — `(end_date - disbursal_date)` expressed as the remainder
   after whole years/months are extracted, purely for display. No
   regulatory source defines a "term_days" field as such; this is not a
   regulated quantity, just a UI convenience for showing the term in
   day-granularity alongside `term_years`/`term_months`. The one thing
   worth confirming (not researched further, low risk) is the day-count
   convention for the subtraction itself (actual/actual calendar
   subtraction vs. actual/365) — since this field is explicitly barred from
   feeding back into any monetary calculation (see invariant #4), the
   day-count convention chosen here has no financial consequence, only a
   cosmetic one, so it does not need a regulatory citation.

## Invariants (for the eventual domain-QA test suite)

1. **Fixed-rate mortgage ⇒ trigger rate is N/A**, never computed or
   displayed — a fixed payment on a fixed rate cannot fail to cover
   interest by construction.
2. **Reconciliation**: `principal_payment + total_interest == total_payment`
   exactly (within rounding), for every flow and every product/rate-type
   combination.
3. **Financed fees increase the amortized principal, never disbursal; cash
   fees do the opposite** (corrected — the title of this invariant
   previously had the direction backwards relative to its own body and the
   resolved carve-out direction, see "Open questions"): for a fixed
   `loan_amount` and `contract_rate_percent`, increasing
   `fees.total_financed_fees` must not decrease `total_interest` — financing
   a fee adds to what's owed (same direction as spec 002 invariant #3 for
   financed fees) — while increasing `fees.total_cash_fees` must not change
   `total_interest` at all (cash fees reduce disbursal only, never the
   amortized principal).
4. **`term_days` never changes any monetary output** — holding every other
   input fixed and varying only how `term_days` is displayed/derived must
   produce byte-identical `payment_amount`, `total_interest`, `cob_amount`,
   `cob_rate_percent`.
5. **Semi-annual vs. monthly compounding produce different periodic rates
   for the same nominal `contract_rate_percent`** — a fixed-rate mortgage
   and a variable-rate mortgage at the *same* nominal contract rate must NOT
   produce the same payment amount (semi-annual compounding is slightly more
   expensive than monthly compounding at the same nominal rate); a test
   asserting they differ (and in the correct direction) guards against
   accidentally hardcoding one compounding convention everywhere.
6. **Trigger rate monotonicity**: holding `payment_amount` and
   `payments_per_year` fixed, increasing `total_borrowed` (confirmed by
   research to mean current outstanding principal balance — see equation 4)
   must decrease `trigger_rate_percent` — a larger balance needs a lower
   rate to push the payment underwater.

## Open questions (blocking implementation, not just equations)

- **Resolved:** Financed fees are **layered on top** of `loan_amount`
  (Reading B), not carved out of it (Reading A) — generalized per-fee via
  the `Fee.financed` flag this spec already reuses from spec 002, rather
  than forced into a single global rule:
  - amortized principal = `loan_amount + fees.total_financed_fees` —
    matches spec 002's `effective_loan_amount = loan_amount +
    fees.total_financed_fees` exactly. Financing a fee never reduces this,
    only grows it.
  - disbursal amount = `loan_amount + fees.total_financed_fees -
    fees.total_cash_fees` — matches spec 002's `amount_financed =
    effective_loan_amount - total_cash_fees` exactly. Only cash (unfinanced)
    fees reduce disbursal; financed fees do not.

  **Why Reading B, not Reading A:** consistency with spec 002's existing,
  already-implemented `effective_loan_amount` convention is the strong
  default now that the fee-shape question above has already committed this
  spec to reusing spec 002's `Fee`/`FeeSchedule` model — introducing a
  second, opposite-direction meaning for the same `financed: bool` flag
  inside one shared `Fee` type would make the flag mean different things in
  the two engines that read it. This is also confirmed by real Canadian
  mortgage practice for the highest-volume financed fee this spec deals
  with: mortgage default insurance (CMHC/Sagen/Canada Guaranty premiums) is
  consistently documented (Ratehub, WOWA, RBC) as being added ON TOP of the
  mortgage principal, not netted out of the amount advanced — e.g. a
  $475,000 mortgage advance plus a $19,000 CMHC premium financed into the
  loan produces a $494,000 total mortgage balance, with the full $475,000
  still reaching the purchase; the premium is not "carved out of" the
  $475,000. This is exactly a *financed* fee that inflates the amortized
  principal without touching disbursal — and, per equation 7's own research,
  the same premium is simultaneously excluded from `cob_amount` (FCPFR
  s.48(2)) — reconfirming that `financed` and `included_in_cob` are
  independent axes, not the same fact viewed two ways.

  **Reconciling the dictation's two sentences:** "fees deducted from loan
  advanced" and "form a part of the principal amount" are not two competing
  models of the same dollar amount — they describe two different fee
  *types*. "Deducted from loan advanced" describes what a **cash**
  (unfinanced) fee does to disbursal; "form a part of the principal amount"
  describes what a **financed** fee does to the amortized balance. Once each
  sentence is attributed to the `Fee.financed` state it actually applies to,
  the dictation is consistent, not ambiguous — see "Financed fees" under
  "Conditional calculation paths" for the resolved formulas built into the
  doc above.

  **Reconciled:** `COB-xlsx/build_workbook_ca.py` was originally built before
  this question had a research-backed answer and used a third reading —
  "both directions at once" (`disbursal_amount = loan_amount -
  financed_fees` **and** `amortized_principal = loan_amount + financed_fees +
  accrued_interest`), which double-counted a financed fee's effect relative
  to the resolution above (it both reduced disbursal *and* inflated
  principal for the same dollar). `COB_CA!B50`'s formula has since been
  corrected to `loan_amount + fees.total_financed_fees -
  fees.total_cash_fees` (this section's resolved formula, matching spec
  002's `amount_financed` exactly) — see "Excel implementation notes" →
  "Judgment calls on open questions" item 1 for the corrected writeup. `P0`
  (the amortized-principal cell, `COB_CA!B52`) already matched this
  resolution and needed no change; `payment_amount`, `total_interest`,
  `trigger_rate_percent`, and `cob_amount`/`cob_rate_percent` are all
  computed from `P0`, not `disbursal_amount`, so none of those outputs
  changed — only the (previously wrong) disbursal figure itself moved (from
  `loan_amount - total_financed_fees` to `loan_amount +
  total_financed_fees - total_cash_fees`). Re-verified with `recalc.py`
  (0 errors) after the fix.
- **Resolved:** `payment_amount` is always an output, in every flow (see
  "Data shapes"). "Payment change" / "variable rate payment change" flows
  recompute it off the current outstanding balance and remaining
  amortization, not off a borrower-fixed payment.
- **Resolved:** `term_years`/`term_months` are the **contract term**
  (renewable, user-customizable — commonly 3 or 5 years but not restricted
  to those values), distinct from the amortization period. Existing/renewal
  flows carry the remaining amortization forward via the new
  `remaining_amortization_years`/`remaining_amortization_months` inputs
  rather than restarting amortization at each renewal. This still needs one
  worked example (a 5-year term inside a 25-year amortization, renewed once)
  to confirm the schedule-stitching behavior end to end, but the field
  semantics are settled.
- **Resolved:** Reuse spec 002's `Fee`/`FeeSchedule` shape (per-fee
  `name`/`amount`/`financed: bool`), extended with a second, independent
  per-fee `included_in_cob: bool` flag — not a new Canada-specific fee shape.
  `financed` and `included_in_cob` answer genuinely different questions:
  `financed` is "does this fee reduce cash disbursed or get added to the
  amortized balance," while `included_in_cob` is "does Financial Consumer
  Protection Framework Regulations s.48 count this dollar toward
  `cob_amount`" — and equation 7's research already established these two
  axes don't coincide (a *financed* mortgage-default-insurance premium still
  gets added to the amortized balance like any other financed fee, but must
  never be added into `cob_amount`; a discharge fee is excluded from
  `cob_amount` regardless of whether it's paid in cash or financed).
  Because both are independent booleans on the same underlying "named dollar
  amount attached to a loan" concept, adding `included_in_cob` as a second
  optional field is a strictly additive change (satisfies this project's
  "additive fields only, no breaking changes" convention) and keeps one Fee
  vocabulary across the whole engine instead of fragmenting into a
  US-flavored `Fee` and a parallel Canada-flavored one that would end up with
  the same three-or-four fields under different names. Follow-on:
  `FeeSchedule` should grow a computed aggregate analogous to
  `total_financed_fees`/`total_cash_fees` — e.g.
  `total_fees_included_in_cob -> money` (sum of `fee.amount` where
  `included_in_cob`) — which equation 7's `cob_amount = total_interest +
  total_fees_included_in_cob` consumes directly; see "Data shapes" above,
  which now defines the common `fees: FeeSchedule` input instead of a bare
  `financed_fees` scalar. One caveat for whoever implements this (a
  validation-rule call, not a shape call, so left unresolved here):
  `included_in_cob` has no safe default — defaulting it to `true` would
  silently pull regulation-excluded categories (mortgage default insurance,
  discharge fees, prepayment penalties, etc.) into `cob_amount`, and
  defaulting to `false` would silently drop includable ones, either of which
  changes a financial output by accident rather than by an explicit modeling
  choice; it should be a required field (no default) wherever a Canadian
  flow constructs a `Fee`, even though it stays typed optional on the shared
  struct for backward compatibility with spec 002's US usage, which never
  reads it. Implementation note: `COB-py` already has a real
  `Fee`/`FeeSchedule` implementation (`cob_calculator/fees.py`) that can be
  extended directly; `COB-ts` has not yet implemented spec 002 (no
  `fees.ts`/`apr.ts` exists in `COB-ts/src`), so its Canadian module will be
  defining this shape in TypeScript for the first time — it should mirror
  `COB-py`'s shape rather than diverging from it, and `docs/new-req/README.md`'s
  parity tracking should reflect that spec 002 is COB-py-only until then.
- **Resolved:** New sibling module (a Canadian engine alongside the existing
  US-style `COB-ts`/`COB-py`), not a compounding-convention parameter bolted
  onto the existing one. The monthly-compounding assumption is not a single
  config knob in either engine — it's hardcoded independently in at least
  three places per language: `calculateMonthlyPayment`/
  `calculate_monthly_payment` (`payment.ts`/`payment.py`) computes
  `r = rate/100/12` internally with no parameter to inject a different
  divisor or a pre-derived periodic rate; `computeSegmentSchedule`/
  `compute_segment_schedule` (`segment.ts`/`segment.py`) independently
  recomputes the same `r = rate/100/12` a second time for its own per-row
  interest accrual instead of delegating to the payment module; and
  `calculatePaymentFrequencySchedule` (`paymentFrequency.ts`) layers a third,
  `paymentsPerYear`-flavored rate derivation on top for non-monthly
  frequencies, still assuming the nominal/n convention (equation 2), never
  the semi-annual conversion (equation 1). Parameterizing compounding would
  mean either breaking `calculateMonthlyPayment`'s existing
  `(balance, annualRatePercent, numberOfPayments)` signature — which this
  project's "no breaking changes to existing types" and "no reimplementing
  shared math" conventions both argue against — or bolting on a second,
  parallel entry point, which is most of the effort of a sibling module
  already, just squeezed into files that also serve the US engine's PMI/
  DSCR/DTI/points/ARM/balloon logic that has no Canadian-COB equivalent in
  this spec and would gain unnecessary risk from threading a new parameter
  through it. The two engines' output *shapes* also don't line up:
  `LoanSummary`/`summarize_mortgage` aggregates totals across the entire
  stitched multi-segment schedule, while this spec needs `total_interest`/
  `total_payment`/`cob_amount`/etc. scoped to only the *current contract
  term*, with that term's final balance handed off as the next renewal's
  opening balance (see "Term vs. amortization scoping" above) — a different
  aggregation contract, not the same `LoanSummary` plus a field. The one
  piece of country-agnostic math worth actually sharing is the annuity
  identity itself (equation 3): a low-risk reuse path is for the Canadian
  module to compute `i_period` from equation 1 or 2 and pass a pre-derived
  periodic rate into a small, extracted `annuityPaymentFromPeriodicRate(principal,
  r, n)` primitive that `calculateMonthlyPayment` is refactored to call
  internally (keeping its own public signature and monthly-only behavior
  unchanged for the US engine) — a genuine shared primitive rather than
  re-deriving the annuity formula a second time, but that refactor is
  implementation work for whoever picks this up, not a decision this spec
  needs to force. **Caveat:** the Excel implementation's own module/sheet
  choice for this feature is tracked separately in `COB-xlsx`'s own docs
  (a parallel workstream) and does not need to match this recommendation for
  `COB-ts`/`COB-py` — Excel's constraints (formula-driven, no macros,
  generated by `build_workbook.py`) are different enough that its
  new-sheet-vs-parameterized-sheet call is its own decision.

## Excel implementation notes

A reference implementation now exists: `COB-xlsx/build_workbook_ca.py` generates
`COB-xlsx/COB_Calculator_CA.xlsx` (two sheets, `COB_CA` and `COB_CA_Schedule`).
This section records the design decision and judgment calls made turning the
spec above into formulas, per the workflow in `docs/new-req/005-excel-workbook.md`.

### Same workbook vs. sibling file: sibling file, chosen

This is a **separate workbook** (`COB_Calculator_CA.xlsx`, built by a separate
script `build_workbook_ca.py`), not new sheets inside `COB_Calculator.xlsx`.
Reasoning:

- The two engines share almost no domain concepts. US `COB_Calculator.xlsx` is
  built around segments/renewals with monthly-only compounding, PMI, escrow,
  and an IRR-style APR; every one of those either doesn't exist in the
  Canadian model (PMI, DTI, points) or means something different (APR,
  "term," compounding convention). Bolting Canadian sheets onto the same
  workbook would mean two incompatible mental models sharing one `README`
  tab and one color legend, with no natural place to explain which
  conventions apply to which sheets.
- `build_workbook_ca.py` still **reuses** `build_workbook.py`'s styling
  constants and helpers directly (`from build_workbook import FONT_NAME,
  INPUT_FONT, ..., title_block, _scrub_empty_string_cells`) rather than
  redefining them, so the two workbooks are visually and structurally
  identical at the formatting level -- this gets the consistency benefit of
  "one workbook" without the conceptual mixing.
- Spec 006 itself leans this way for the *code* target ("a sibling module is
  likely cleaner than parameterizing the existing one" -- see "Open
  questions"); the same reasoning applies at the spreadsheet layer.

### Judgment calls on open questions

1. **Financed-fee carve-out vs. layered-on-top (the spec's first open
   question): now matches the spec's resolved Reading B exactly, after one
   correction mid-build.** This workbook was originally built using a
   literal, "both directions at once" reading of the (then-ambiguous) field
   description -- `disbursal_amount = loan_amount - financed_fees` **and**
   `amortized_principal = loan_amount + financed_fees +
   capitalized_accrued_interest` -- which double-counted a financed fee's
   effect relative to what "Open questions" above has since formally
   resolved (Reading B, matching spec 002's `effective_loan_amount`/
   `amount_financed` convention exactly, on the strength of that consistency
   plus the CMHC-premium counter-example). **`COB_CA!B50`'s formula has been
   corrected** to `loan_amount + fees.total_financed_fees -
   fees.total_cash_fees` (this file's default example: `400,000 + 500 - 600
   = 399,900`, vs. the pre-fix `399,500`). `COB_CA!B52` (`P0`, the amortized
   principal `payment_amount`/`total_interest`/`trigger_rate_percent`/
   `cob_amount` are all actually computed from) already matched the resolved
   formula and needed no change, so this fix only moved the
   `disbursal_amount` display figure -- verified with a fresh `recalc.py`
   pass (0 errors) and by re-reading `COB_CA!B50`'s recalculated value after
   the fix. This also still satisfies invariant #3 (increasing
   `fees.total_financed_fees` must not decrease `total_interest`): `P0`
   strictly increases with `total_financed_fees` either way, since the fix
   only touched the (P0-independent) disbursal formula.
2. **Fee shape: a 4-column table (`Fee name`, `Amount`, `Financed? Y/N`,
   `Included in COB? Y/N`), not a single scalar.** The spec's own "still
   open" bullet says whichever fee shape is used needs the two flags kept
   independent; a single `financed_fees` scalar input can't represent a fee
   that's cash-paid but still COB-included (e.g. an appraisal fee), so this
   implementation uses a small itemized table (mirroring `Fees_APR`'s fee
   table in the US workbook) with both flags as separate Y/N columns, summed
   into `total_financed_fees` / `total_fees_included_in_cob` independently.
   The shipped example rows deliberately include a fee that's financed but
   NOT COB-included (mortgage default insurance) and one that's COB-included
   but NOT financed (an appraisal fee) to demonstrate the flags don't
   coincide.
3. **Accrued-interest carry-forward mechanics (not fully specified by the
   dictation beyond "carried into this calculation"): capitalized into this
   term's opening balance.** For existing/renewal/payment-change flows,
   `accrued_interest` is added into `P0` alongside `financed_fees`
   (`COB_CA!B51`/`B52`), i.e. treated the same way a financed fee is treated
   -- it becomes part of what the new payment is computed against, and part
   of what interest starts accruing on for this term. This is the most
   standard real-world treatment (unpaid accrued interest capitalizing into
   the new balance at renewal) and keeps `payment_amount`/`total_interest`
   internally consistent, but it's a genuine judgment call, not something
   spec 006 pins down explicitly -- flagged here per the task's instructions
   rather than silently assumed.
4. **`P` in equation 6 (average outstanding balance) read as each period's
   *beginning* balance.** The regulation's wording -- "principal outstanding
   at the end of each payment period, before subtracting the payment due at
   that time" -- is exactly the balance interest accrues on for that period,
   i.e. `BeginningBalance` in the schedule (the balance carried in from the
   prior period, before that period's own payment is applied). Implemented
   as `AVERAGE` over the term's counted rows' `BeginningBalance` column via
   `SUMPRODUCT`, consistent with the `SUMPRODUCT`-over-`INDEX/MATCH` idioms
   already used throughout `build_workbook.py` (no array-entered formulas).
5. **Term-vs-amortization clamp**: if a user enters a `term` longer than
   `remaining_amortization`, the term is silently clamped to the shorter of
   the two (`COB_CA!B58 = MIN(raw term periods, remaining amortization
   periods)`) rather than erroring -- a mortgage's contract term should never
   outlive its own amortization, and the schedule sheet already
   self-stabilizes past a full payoff, so clamping is the conservative,
   already-idiomatic choice.
6. **Full renewal chaining is out of scope, as flagged as acceptable in the
   task**: `COB_CA_Schedule` computes one term's schedule only. Its final
   row's `Ending Balance` (`COB_CA!B69`) is exactly the value a follow-on
   "existing mortgage"/"payment change" calculation would type into
   `COB_CA!B15` (the "loan amount / current outstanding balance" input) to
   chain a renewal -- but that chaining is manual (copy the number over),
   not an automatic cross-workbook link.
7. **A discrepancy found in spec 006 itself, not resolved by
   reinterpretation (flagged per the task's instructions, invariant text
   left unchanged):** invariant #5 states "semi-annual compounding is
   slightly more expensive than monthly compounding at the same nominal
   rate." Implementing equations 1 and 2 exactly as specified and comparing
   them at the same nominal `contract_rate_percent` (5%, monthly payments)
   shows the **opposite** direction: equation 1 (semi-annual) gives
   `i_period = 0.41239%`/period vs. equation 2 (monthly) `i_period =
   0.41667%`/period -- semi-annual compounding is *cheaper*, not more
   expensive, because compounding **less** frequently at a fixed nominal
   rate produces a **lower** effective annual rate ((1+0.05/2)^2-1 = 5.0625%
   vs. (1+0.05/12)^12-1 = 5.1162%). This is the well-documented "Canadian
   mortgage advantage" of semi-annual, not-in-advance compounding, and is
   consistent with equation 1's own cited source (yorku.ca's mortgage-math
   treatment) -- the equations themselves are correctly implemented and not
   in question; only the invariant's prose about *which direction* is wrong.
   The testable part of invariant #5 (the two conventions must produce
   **different** payments, not the same one) does hold and was verified
   below. This is reported rather than silently fixed, per the task's
   instruction to flag rather than reinterpret spec inconsistencies.
8. **Invariant #6 (trigger-rate monotonicity) needs a fixed `payment_amount`
   held independent of the balance being varied, which the origination-style
   sheet doesn't produce by construction.** In this calculator,
   `payment_amount` is always recomputed via the annuity formula from the
   *same* balance used as `total_borrowed`, so scaling `loan_amount` up
   while letting the sheet recompute the payment leaves `trigger_rate_percent`
   **unchanged** -- this is not a bug, it's exactly the Bank of Canada
   citation already in equation 4's sourcing ("at origination, the trigger
   rate does not depend on the size of the loan"). Invariant #6's actual
   premise (payment held fixed, balance varying independently -- e.g. the
   same original payment checked against a since-amortized balance) was
   verified directly against the formula with plain arithmetic instead (see
   "Verification" below), and holds exactly as stated.

### Scope notes

- The amortization schedule (`COB_CA_Schedule`) is bounded to 520 rows (10
  years at the densest supported cadence, weekly) -- extend by copying the
  last row's formulas down, same convention as every bounded table in
  `COB_Calculator.xlsx`.
- `semi_annual_compounding_date` is wired in as a pure display/reference
  input, per equation 1's own note that it doesn't change the periodic-rate
  conversion itself.
- Data-validation dropdowns (Flow, Product type, Rate type, Payment
  frequency, and the two per-fee Y/N flags) are implemented as Excel list
  validations, not macros -- every flow-conditional input field stays visible
  at all times; four computed helper cells (`COB_CA!B9`-`B12`) tell the user
  which fields/rules actually apply for the current Flow/Product/Rate-type
  combination, since Excel data validation has no built-in show/hide.

## Equations research

**Completed.** Each formula in "## Equations" above has been checked against
a primary or authoritative secondary source and annotated CONFIRMED,
CORRECTED, or BEST AVAILABLE (with the caveat spelled out inline) — see each
numbered item for sourcing. Headline results:

- **Equation 1** (semi-annual→periodic conversion): confirmed exactly,
  grounded in Interest Act, R.S.C. 1985, c. I-15, s. 6.
- **Equation 2** (monthly compounding for variable mortgages/loans):
  best-available default, not authoritative — real lenders differ (TD/BMO/
  RBC monthly vs. Scotiabank semi-annual for variable mortgages; FCAC's own
  worked example uses yet a third convention), so keep this configurable.
- **Equation 4** (trigger rate, high priority): the dictated formula is
  confirmed exact, not an approximation, once `total_borrowed` is read as
  *current outstanding balance* — corroborated by Bank of Canada Staff
  Analytical Note 2022-19 and multiple industry trigger-rate calculators
  (WOWA.ca, Coast Capital Savings) using the identical formula.
- **Equation 6** (COB rate/APR): corrected — Canadian regulation
  (Financial Consumer Protection Framework Regulations, SOR/2021-181, ss.
  47–48, successor to the repealed Cost of Borrowing (Banks) Regulations)
  prescribes an average-outstanding-balance formula, `APR = (C/(T×P))×100`,
  not spec 002's present-value/IRR solve — do not reuse that solver here.
- **Equation 7** (COB dollar amount): confirmed shape, with the regulatory
  fee inclusion/exclusion list now spelled out (differs from spec 002's
  `financed`/`cash` split).
- Equations 3, 5, 8 are standard, country-agnostic math identities or
  display-only derivations — briefly confirmed, no material findings.

All four items originally tracked in "Open questions" are now resolved:
payment-amount input/output direction per flow, fee-shape reuse, target
module, and the financed-fee carve-out direction (fees layer on top of
`loan_amount`, matching spec 002's `effective_loan_amount` convention and
real Canadian mortgage-default-insurance practice — see each item's
"Resolved:" note). The `COB-xlsx/build_workbook_ca.py` reference
implementation, which had chosen a different (now-superseded) reading of the
carve-out direction before this question had a research-backed answer, has
since been corrected (`COB_CA!B50`'s `disbursal_amount` formula) to match —
see the "Resolved:" note's "Reconciled" paragraph and "Excel implementation
notes" → "Judgment calls on open questions" item 1.
