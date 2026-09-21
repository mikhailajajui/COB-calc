# 004 — Rounding-Drift Accuracy Disclosure

## Status: known, intentional behavior — not a defect. Disclosure was missing; now fixed.

## What was found

Cross-validating `cob_calculator` against the `lending` skill's independent
reference implementation (`LendingAnalysis`, see
`COB-py/tests/test_lending_skill_crosscheck.py`) surfaced a real, measurable
divergence: for a $300,000 / 6.5% / 30-year loan, the two engines' reported
**remaining balance at an intermediate payment number** disagree by an amount
that grows smoothly over the life of the loan:

| Payment # | cob_calculator | LendingAnalysis (closed-form) | Difference |
|-----------|---------------:|-------------------------------:|-----------:|
| 1         | 299,728.80     | 299,728.80                     | $0.00      |
| 60        | 280,833.26     | 280,832.93                     | $0.33      |
| 180       | 217,678.77     | 217,677.42                     | $1.35      |
| 300       | 96,915.68      | 96,912.49                      | $3.19      |
| 359       | 1,890.67       | 1,885.99                       | $4.68      |
| 360       | 0.00           | 0.00                           | $0.00      |

## Root cause (verified, not guessed)

`cob_calculator` rounds every row's interest to the cent
(`round2(balance * monthly_rate)`) before deriving that row's principal and
next balance — this is what a real bank statement does, and what every
`AmortizationEntry` in this codebase has always done. `LendingAnalysis` keeps
full floating-point precision through the entire schedule and only rounds a
final reported figure.

Because principal = payment − interest with the payment held fixed, a
rounding error introduced at row *k* doesn't stay put — it propagates into
row *k+1*'s balance and gets multiplied by `(1 + monthly_rate)` every
subsequent row (`δ(k+1) = δ(k) × (1+r) + ε(k)`). At 6.5%/12 monthly, `(1+r)^359
≈ 7`, so a sub-cent rounding choice made near the start of the loan can be
amplified roughly 7× by the end — which is exactly the $0 → $4.68 growth
curve observed above.

**This is not unbounded or runaway.** The engine's last row always forces
`remaining_balance` to exactly `0` (see `segment.py`'s `is_scheduled_final_row`
handling), which absorbs all accumulated drift into the final payment —
exactly what happens on a real mortgage's last payment, which is often a few
cents (or, on principle, occasionally a few dollars for pathological rate/term
combinations) different from the regular payment amount to true up rounding.

## What is, and is NOT, at risk

**Not at risk — verified exact:**
- `LoanSummary.total_interest_paid`, `total_of_payments`: exact sums of the
  actual rounded rows, not derived from a closed form. Self-consistent by
  construction; there is nothing to drift against.
- Sum of `principal_portion` across the whole schedule == original principal,
  exactly (tested).
- `remaining_balance` at full payoff: always exactly `0` (tested).
- Every number `cob_calculator` reports is internally consistent with every
  other number it reports — this drift never appears *within* a single
  schedule, only when comparing across two differently-implemented engines.

**At risk — the actual, narrow scope of this disclosure:**
- **`remaining_balance` (or "payoff amount") at an arbitrary intermediate
  payment number**, when compared against a *different* calculator/tool/
  spreadsheet that does not round every period to the cent (many "quick"
  online mortgage calculators and closed-form spreadsheet formulas fall in
  this category). Expect a difference of up to a few dollars on a 30-year
  loan, concentrated in the back half of the schedule, growing toward — but
  never past — the final payoff row.
- **Where this specifically matters in this app**: the **Bank Reconciliation**
  page (`pages/11_Bank_Reconciliation.py`) and the **Loan Calculator**'s yearly
  report window (`pages/01_Loan_Calculator.py`), both of which show
  intermediate balances a user might sanity-check against an external source.

## Why the distinction matters operationally

If a user reconciling against a **real bank statement** (which, being a real
loan, was itself computed with per-period cent rounding, same convention as
this engine) sees a discrepancy of more than a few dollars at some payment
number, **that is a genuine signal worth investigating** — a rate change, a
skipped/late payment, an unlogged fee, or a data-entry error — not rounding
noise, and the Bank Reconciliation page's manual-override mechanism is the
right tool to correct it.

If a user instead compares against a **simplified/theoretical calculator**
(unrounded closed-form math, like `LendingAnalysis` here, or many quick online
calculators), a difference of up to single-digit dollars late in a long
amortization is **expected and not a defect** in either engine.

## Where the warning now lives

- This document.
- `docs/new-req/README.md` index (cross-referenced).
- Docstring in `COB-py/cob_calculator/segment.py` (points here, states the
  invariant: totals are exact, intermediate balances can drift vs. other
  engines, bounded by `(1+r)^n`).
- In-app disclosure banners:
  - `pages/11_Bank_Reconciliation.py` — explains the real-statement-vs-
    simplified-calculator distinction above, right where a user is actively
    comparing numbers.
  - `pages/01_Loan_Calculator.py`'s yearly report window — a short note that
    intermediate year-end balances are bank-accurate (cent-rounded), not
    theoretical.
- `COB-py/tests/test_lending_skill_crosscheck.py` — the tests that caught this
  in the first place, now asserting the *correct* invariant (tight early,
  bounded-not-runaway late, exact at payoff) with this document referenced
  inline.
