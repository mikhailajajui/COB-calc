# 001 — Yearly Summary & N-Year Report Window

## Problem

The engine only ever produces (a) the full per-payment schedule or (b) whole-loan
totals (`LoanSummary.total_interest_paid`, etc.). There is no way to ask "how
much interest will I pay in the first 5 years?" without hand-building a bounded
segment and reading its `segment_summaries`, and there is no annual rollup table
— the natural container real servicers and calculators show (year-by-year
interest/principal/tax/insurance/PMI paid, ending balance) doesn't exist.

## Important constraint: you cannot skip computing the prior rows

For a plain single-rate fixed loan there is a closed-form remaining-balance
formula (`B_k = P(1+r)^k - M[(1+r)^k - 1]/r`), so *balance at year 5* could in
principle be computed without generating the first 60 rows. But the engine
supports segments, renewals, lump sums, manual overrides, PMI drop-off, and
recurring-cost escalation — none of which have a closed form once composed
together. **This spec computes the full schedule as usual and only truncates
the *report*, not the underlying computation.** This is fast enough in practice
(max 1200 rows under the engine's existing safety cap) and guarantees the
truncated numbers agree exactly with the full schedule's own totals.

## Scope

Applies to `AmortizationEntry` schedules (the monthly-periodic segment/mortgage
engine: `LoanSummary.schedule`). Payment-frequency schedules
(`PeriodAmortizationEntry`, biweekly/weekly/semiMonthly) are **out of scope for
v1** — a "year" doesn't correspond to a clean N-row block at those cadences
(26 biweekly payments ≠ exactly one calendar year), and yearly rollups there
need calendar-date bucketing, not payment-count bucketing. Documented as a
follow-up, not silently ignored.

## Data shapes

```
YearlySummary:
  year_number: int              # 1-based
  payments_in_year: int         # 12, except possibly the last year of a schedule
                                 # whose payment count isn't a multiple of 12
  starting_balance: money       # balance carried in from the prior year (or the
                                 # original principal for year 1)
  ending_balance: money         # balance after this year's last row
  total_payments: money         # sum of payment_amount across the year's rows
  total_interest: money
  total_principal: money
  total_tax: money | null       # present iff the schedule carries tax_portion
  total_insurance: money | null
  total_hoa: money | null
  total_pmi: money | null

ReportWindowSummary:
  through_year: int                        # requested N
  through_payment_number: int              # last payment number actually covered
                                            # (< through_year * 12 if the loan
                                            # paid off early)
  yearly: YearlySummary[]                  # length = min(through_year, years elapsed)
  total_interest_paid: money                # sum over the window
  total_principal_paid: money
  total_of_payments: money
  ending_balance: money                     # balance at the end of the window
  original_principal: money
  percent_of_original_balance_remaining: ratio   # ending_balance / original_principal
  percent_of_term_elapsed: ratio                 # through_payment_number / total schedule length
  paid_off_within_window: bool               # true if the loan reached $0 before/at
                                              # through_year
```

## Functions

```
summarize_schedule_by_year(schedule: AmortizationEntry[]) -> YearlySummary[]
```
- Groups rows by `year_index = (payment_number - 1) // 12` (0-based internally,
  reported as `year_number = year_index + 1`). This is the same bucketing
  convention `costs.*` already uses for recurring-cost escalation anniversaries,
  so "year 2" here means the same thing it means to `applyRecurringCosts` /
  `apply_recurring_costs`.
- `starting_balance` for year N = `remaining_balance` of the last row of year
  N-1, or the schedule's original principal (`schedule[0].remaining_balance +
  schedule[0].principal_portion`) for year 1.
- The optional cost fields (`total_tax` etc.) are `null` for the whole result
  set if the schedule was built without `recurring_costs`/`pmi` (i.e. no row
  carries that field) — not zero, so callers can distinguish "not tracked" from
  "tracked and zero."

```
summarize_report_window(loan_summary: LoanSummary, through_years: int) -> ReportWindowSummary
```
- `through_years` must be a positive integer. No upper bound is enforced here
  (a caller asking for more years than the loan has just gets the whole loan
  back, with `through_payment_number == number_of_payments` and
  `paid_off_within_window = true`).
- Internally: `summarize_schedule_by_year(loan_summary.schedule)`, then slice
  the first `min(through_years, len(yearly))` entries and roll them up.

## Invariants (what the domain-QA test suite checks)

1. **Round-trip identity**: summing `total_interest`/`total_principal` across
   *every* `YearlySummary` for the full schedule equals
   `LoanSummary.total_interest_paid` / the original principal, exactly (both
   are built from the same rounded per-row values, so no new rounding is
   introduced by aggregation).
2. **Final year clears the balance**: for a schedule that runs to payoff, the
   last `YearlySummary.ending_balance` is `0`.
3. **Partial final year**: a schedule whose length isn't a multiple of 12 (e.g.
   362 payments) produces a final `YearlySummary` with `payments_in_year < 12`,
   not an error and not a silently dropped remainder.
4. **Report window matches the raw schedule at the boundary**: for a 30-year
   loan, `summarize_report_window(summary, 5).ending_balance` equals
   `schedule[59].remaining_balance` (payment #60) exactly.
5. **Window beyond payoff**: requesting `through_years` larger than the loan's
   actual life (e.g. a 15-year loan with `through_years=30`) does not error —
   it returns the full loan's numbers with `paid_off_within_window = True`.
6. **Cost fields are `None`, not `0`, when untracked**: a plain P&I loan (no
   PMI/recurring costs) yields `total_tax is None` etc. across every
   `YearlySummary`, so a caller can't mistake "not configured" for "configured
   and zero."
