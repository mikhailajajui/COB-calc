# 002 — Fees & APR

## Problem

The engine has no concept of loan origination fees at all. `compare_loan_terms`
ranks offers by note rate + term only, which will recommend the wrong "cheaper"
loan whenever offers carry different fees — exactly the scenario APR exists to
prevent (Regulation Z / TILA requires APR disclosure precisely because rate
alone is gameable by shifting cost into fees). `RefinanceComparisonInput`
carries a single opaque `closing_costs` number; nothing itemizes fees or derives
an APR from them.

## Scope and honesty about precision

This is a **simplified, actuarial-method APR**, not a certified TILA/Reg Z
disclosure engine. Real Reg Z APR calculations distinguish "finance charges"
from "amounts financed" with rules about which fees count (an appraisal fee
paid to an independent third party is typically *not* a finance charge; an
origination fee paid to the lender typically *is*), handle odd first-period
days, and use precise actuarial tables. This spec deliberately does **not**
attempt full regulatory precision — it computes an amortization-equivalent APR
by solving for the rate that reconciles the note-rate payment against a
fee-adjusted amount financed. Good enough to compare two loan offers
consistently; not a substitute for a lender's Loan Estimate.

## Data shapes

```
Fee:
  name: string             # e.g. "Origination fee", "Application fee", "Appraisal"
  amount: money            # >= 0
  financed: bool           # false (default): paid out-of-pocket at closing,
                            # reduces the amount financed. true: added to the
                            # loan principal instead (VA funding fee, upfront
                            # FHA MIP) -- does NOT reduce amount financed, but
                            # DOES increase the balance the note-rate payment is
                            # computed against.

FeeSchedule:
  fees: Fee[]

  total_fees -> money                          # sum of all fee amounts
  total_financed_fees -> money                  # sum of fees where financed=true
  total_cash_fees -> money                      # sum of fees where financed=false
```

```
AprInput:
  loan_amount: money             # the note amount BEFORE any financed fees are added
  annual_interest_rate_percent: percent
  term_months: int
  fees: FeeSchedule

AprResult:
  effective_loan_amount: money        # loan_amount + total_financed_fees -- what the
                                       # note-rate payment is actually computed against
  monthly_payment: money               # standard annuity payment on effective_loan_amount
  amount_financed: money               # effective_loan_amount - total_cash_fees --
                                       # what Reg Z calls "amount financed": the money
                                       # the borrower actually nets, against which the
                                       # SAME monthly_payment is being measured
  apr_percent: percent                 # nominal annual rate (monthly rate * 12 * 100)
                                       # that makes amount_financed the present value of
                                       # `term_months` payments of `monthly_payment`
  apr_minus_note_rate_percent: percent  # apr_percent - annual_interest_rate_percent;
                                       # always >= 0 when total_fees > 0, and == 0 when
                                       # total_fees == 0 (see invariants)
  total_fees: money
  cash_to_close: money                 # down_payment (from the caller, not part of this
                                       # module) is added by the caller; this module only
                                       # reports total_cash_fees, since it doesn't know
                                       # the down payment
```

## Algorithm

1. `effective_loan_amount = loan_amount + fees.total_financed_fees`
2. `monthly_payment = calculate_monthly_payment(effective_loan_amount, annual_interest_rate_percent, term_months)`
   (reuse the existing engine function -- do not reimplement the annuity formula)
3. `amount_financed = effective_loan_amount - fees.total_cash_fees`
   - If `amount_financed <= 0`: raise (fees exceed the loan itself -- not a
     financially meaningful scenario, reject rather than return a nonsensical
     negative-rate result)
   - If `amount_financed == effective_loan_amount` (no cash fees): APR equals
     the note rate exactly, no solve needed -- short-circuit.
4. Otherwise, solve for `r` (monthly rate) such that:
   ```
   amount_financed == monthly_payment * (1 - (1 + r) ** -term_months) / r
   ```
   via bisection (robust, no derivative needed, and this equation is monotonic
   in `r` over the relevant domain so bisection always converges). Bracket:
   `lo = 0`, `hi` = generous upper bound (e.g. 1.0 = 100% monthly -- loans with
   fees anywhere near making this necessary are already pathological). Iterate
   to convergence within a fixed tolerance (e.g. 1e-10 on the equation
   residual) or a fixed iteration cap (e.g. 200) -- do not loop unbounded.
5. `apr_percent = r * 12 * 100`

## Invariants (domain-QA test suite)

1. **No fees ⇒ APR == note rate exactly** (not "approximately" -- the
   short-circuit in step 3 above must fire so there's no solver noise).
2. **Any fees ⇒ APR > note rate**, strictly, whenever `total_cash_fees > 0`.
3. **Financed-only fees do not change APR** relative to a no-fee loan at the
   SAME note rate applied to the larger `effective_loan_amount` -- because
   `amount_financed == effective_loan_amount` in that case (financing a fee
   doesn't reduce what the borrower nets, it only increases what they owe, and
   the note-rate payment already reflects the larger balance). This is a
   deliberately counter-intuitive but correct result worth a named test.
4. **Round-trip**: plugging the solved `apr_percent` back into the standard
   present-value-of-annuity formula against `monthly_payment` and
   `term_months` reproduces `amount_financed` within a cent.
5. **Monotonicity**: holding everything else fixed, increasing `total_cash_fees`
   strictly increases `apr_percent`.
6. **Degenerate reject**: fees >= effective_loan_amount raises rather than
   returning a nonsensical/negative APR.
7. **compare_loan_terms-style ranking sanity**: given two offers with the same
   rate/term but offer B has higher cash fees than offer A, an APR-based
   comparison ranks A as cheaper even though both have identical monthly
   payments and identical note rates -- demonstrating the exact failure mode
   this feature fixes.
