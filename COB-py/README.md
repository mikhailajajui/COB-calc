# COB-py

A Python/Streamlit port of [COB-ts](../COB-ts) -- the same segmented mortgage /
cost-of-borrowing calculator engine, reimplemented from scratch in Python and
wrapped in a multi-page Streamlit UI.

`cob_calculator/` is a 1:1 port of every module in `COB-ts/src/`: the same
formulas, the same validation rules, the same rounding policy (cents, half-up to
match JavaScript's `Math.round`), and the same date-overflow semantics for
`add_months` (so a Jan 31 start date rolls into Mar 2 exactly like the TS engine).

It also includes features identified in a banking-domain QA pass that don't
exist in COB-ts yet (`reporting.py`, `fees.py`, `apr.py`, `dti.py`) -- see
[`docs/new-req`](../docs/new-req) for the platform-agnostic specs behind them.

`cob_canada.py` is a separate, standalone engine (not a US-mortgage variant --
see [`docs/new-req/006`](../docs/new-req/006-cost-of-borrowing-disclosure.md))
that reproduces one specific lender's real production calculator (Alterna
Savings' Cost of Borrowing Calculator, per its BRD and live workbook -- see
[`docs/new-req/007`](../docs/new-req/007-cob-canada-brd-reconciliation.md) for
the reconciliation that verified every formula against that source). It takes
a manually entered payment amount rather than solving for one, accrues
interest on actual calendar days rather than a fixed periodic rate, and has no
system integration -- all inputs are typed in by the user, matching the real
application's own scope.

## Run the app

```bash
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
streamlit run streamlit_app.py
```

Pages (sidebar):

- **Loan Calculator** -- single fixed-rate loan, amortization schedule, totals.
- **Extra Payments** -- extra monthly principal payment savings.
- **Payment Frequency** -- monthly vs. biweekly/weekly/semi-monthly acceleration.
- **Segmented Mortgage** -- renewals, rate/payment changes, interest-only,
  balloon, lump sums, manual overrides, PMI, recurring costs -- all stitched
  into one schedule.
- **PMI & Recurring Costs** -- single-loan convenience view of the cost
  breakdown (tax/insurance/HOA/PMI with auto-drop).
- **Points Breakeven**, **Refinance**, **Compare Loan Terms** -- decision tools
  composed from the core loan engine.
- **LTV & DSCR**, **ARM Rate Reset** -- pure ratio/rate calculators.
- **Bank Reconciliation** -- import a CSV/JSON bank statement as manual
  overrides and see the reconciled schedule.
- **Fees & APR** -- itemized origination/application/closing fees (cash or
  financed into the loan) and a simplified actuarial-method APR.
- **DTI & Affordability** -- front-end/back-end debt-to-income check, and a
  reverse "how much house can I afford" calculator.
- **Cost of Borrowing (Canada)** -- standalone Canadian mortgage/personal-loan
  disclosure calculator (4 flows: new mortgage/loan, renewal, payment change,
  variable-rate payment change), reproducing Alterna Savings' real production
  calculator: user-entered payment amount, day-count interest accrual, and an
  interest-then-fees-then-principal payment waterfall.

The Loan Calculator page also has a "Yearly summary / report window" panel for
viewing just the first N years of a loan.

## Run the tests

```bash
pip install -r requirements.txt
python3 -m pytest
```
