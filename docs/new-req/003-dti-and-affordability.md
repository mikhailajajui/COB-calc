# 003 — DTI & Affordability

## Problem

`dscr.ts`/`dscr.py` covers *investment-property* income coverage (net operating
income / annual debt service). Personal-mortgage underwriting runs on a
different, more fundamental metric that doesn't exist anywhere in the engine:
**debt-to-income ratio (DTI)**. The lending skill's own reference table lists
DTI (front-end ≤28%, back-end ≤36–43%) as a core qualification criterion, and
this skill's trigger phrases explicitly include "how much house can I afford" --
a calculator that isn't implemented anywhere either.

## Definitions (per the lending skill)

- **Front-end DTI** = housing payment / gross monthly income. "Housing payment"
  here means the full PITI-plus (P&I + property tax + homeowners insurance +
  HOA + PMI), not just P&I -- front-end ratios are about total housing cost,
  and a calculator that only counted P&I would understate risk for a
  high-tax/high-HOA property.
- **Back-end DTI** = (housing payment + all other recurring monthly debts) /
  gross monthly income. Other debts: auto loans, student loans, credit card
  minimums, other installment/revolving debt -- *not* variable
  living expenses (groceries, utilities), which underwriting doesn't count.
- Thresholds are program-dependent (conventional ~28/36, many QM programs allow
  back-end up to 43-45% with compensating factors, FHA is more lenient). This
  spec makes both max percentages caller-configurable with conventional
  defaults (28/36), rather than hardcoding one program's rule.

## Data shapes

```
DtiInput:
  gross_monthly_income: money        # > 0
  housing_payment: money             # >= 0; full PITI+HOA+PMI, not P&I alone
  other_monthly_debts: money         # >= 0

DtiResult:
  front_end_dti: ratio               # housing_payment / gross_monthly_income
  back_end_dti: ratio                # (housing_payment + other_monthly_debts) / income
  front_end_max_percent: percent     # threshold used
  back_end_max_percent: percent
  front_end_ok: bool                 # front_end_dti <= front_end_max_percent/100
  back_end_ok: bool
  qualifies: bool                    # front_end_ok AND back_end_ok
```

```
AffordabilityInput:
  gross_monthly_income: money         # > 0
  other_monthly_debts: money          # >= 0
  annual_interest_rate_percent: percent
  term_months: int                    # > 0
  non_pi_housing_costs: money = 0     # estimated monthly tax+insurance+HOA+PMI,
                                       # i.e. the part of "housing payment" that
                                       # ISN'T the P&I being solved for
  front_end_max_percent: percent = 28
  back_end_max_percent: percent = 36
  down_payment: money = 0             # to also report max home price

AffordabilityResult:
  max_pi_payment: money                # >= 0; the larger of "qualifies for
                                       # nothing" (0) and the binding-constraint
                                       # allowance
  max_loan_amount: money               # closed-form inverse of the annuity
                                       # formula against max_pi_payment
  max_home_price: money                # max_loan_amount + down_payment
  binding_constraint: "front_end" | "back_end"
  qualifies: bool                      # max_pi_payment > 0
```

## Algorithm

**DTI**: pure ratio arithmetic, no solving required.
```
front_end_dti = housing_payment / gross_monthly_income
back_end_dti  = (housing_payment + other_monthly_debts) / gross_monthly_income
front_end_ok  = front_end_dti <= front_end_max_percent / 100
back_end_ok   = back_end_dti <= back_end_max_percent / 100
qualifies     = front_end_ok and back_end_ok
```

**Affordability** is the *reverse* of DTI: given the income and the two
thresholds, find the maximum P&I payment allowed by each constraint
independently, take the more restrictive (smaller) one, then invert the
standard annuity payment formula for the loan amount that produces exactly
that P&I payment at the given rate/term.

```
front_end_allowance = gross_monthly_income * front_end_max_percent / 100 - non_pi_housing_costs
back_end_allowance  = gross_monthly_income * back_end_max_percent / 100 - other_monthly_debts - non_pi_housing_costs

max_pi_payment = max(0, min(front_end_allowance, back_end_allowance))
binding_constraint = "front_end" if front_end_allowance <= back_end_allowance else "back_end"

# Closed-form inverse of PMT = P * [r(1+r)^n] / [(1+r)^n - 1]:
if r == 0:
    max_loan_amount = max_pi_payment * n
else:
    factor = (1 + r) ** n
    max_loan_amount = max_pi_payment * (factor - 1) / (r * factor)

max_home_price = max_loan_amount + down_payment
qualifies = max_pi_payment > 0
```

This closed-form inversion is exact (algebraic inverse of
`calculate_monthly_payment`, not an approximation or a solve) -- worth a named
round-trip test: feeding `max_loan_amount` back into
`calculate_monthly_payment` reproduces `max_pi_payment`.

## Invariants (domain-QA test suite)

1. **DTI is pure ratio arithmetic** -- `front_end_dti` and `back_end_dti` match
   hand-computed ratios exactly (no rounding surprises; these are decision
   ratios, not currency, so they stay unrounded like the rest of the engine's
   ratio functions, e.g. `loan_to_value`).
2. **`qualifies` is exactly the AND of both sub-checks** -- test all four
   quadrants (front ok/back ok, front ok/back not ok, etc.).
3. **Affordability round-trips**: `calculate_monthly_payment(max_loan_amount,
   rate, term_months) == max_pi_payment` within a cent, for both r=0 and r>0.
4. **Binding constraint is correctly identified**: construct one scenario where
   front-end binds (high other debts push back-end allowance below front-end)
   and one where back-end binds (low other debts, high non-P&I housing costs
   push front-end allowance below back-end) -- assert `binding_constraint`
   matches in both.
5. **Non-qualification is reported, not just zero**: a borrower whose debts
   alone exceed the back-end allowance gets `max_pi_payment == 0`,
   `qualifies == False`, `max_loan_amount == 0` -- not a negative number, not
   an exception.
6. **`max_home_price` includes the down payment** the caller supplies, even
   when `down_payment == 0` (default).
7. **Zero-rate edge case**: `annual_interest_rate_percent == 0` uses the linear
   branch (`max_pi_payment * n`), not a division by zero.
8. **Threshold overrides are honored**: passing non-default
   `front_end_max_percent`/`back_end_max_percent` changes both the DTI
   pass/fail and the affordability ceiling accordingly (e.g. a looser FHA-style
   43% back-end threshold affords strictly more loan than the 36% conventional
   default, all else equal).
