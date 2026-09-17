# Equations reference

Every formula used in `cob-calculator`, one section per source file. Each entry gives
the math, the variable definitions, and the exact implementation location. See
`docs/spec.md` §2 for the two conventions every formula here follows:

- **Rates are percent numbers** ($6$ means 6%), converted to a decimal monthly rate as
  $r = \dfrac{\text{annualInterestRatePercent}}{100 \times 12}$ everywhere.
- **Rounding**: `round2()` (`src/money.ts`) rounds only final currency amounts, at the
  point they're computed — `round2(x) = \dfrac{\text{round}(100x)}{100}`. Ratios (LTV,
  DSCR) and time-spans (breakeven months) are left unrounded.

---

## 1. Core payment math — `src/payment.ts`

### 1.1 Monthly payment (standard annuity formula)

$$
\text{PMT} = P \cdot \frac{r(1+r)^n}{(1+r)^n - 1}
$$

- $P$ = `balance` (principal)
- $r$ = monthly rate = `annualInterestRatePercent / 100 / 12`
- $n$ = `numberOfPayments`
- **Zero-rate edge case** ($r = 0$, division by zero in the formula above):
  $\text{PMT} = P / n$

`calculateMonthlyPayment()`, `src/payment.ts:11-26`.

### 1.2 Total interest over the life of a loan

$$
\text{totalInterest} = n \cdot \text{PMT} - P
$$

Computed once in `docs/spec.md`'s worked examples; in code this is derived per-row by
summing `interestPortion` across the schedule (§5 below) rather than computed in
closed form, so the two must agree — that agreement is what `tests/mortgage.test.ts`'s
"fundamental payment identity" test checks.

---

## 2. Per-row amortization — `src/segment.ts`

### 2.1 Interest / principal split (standard row)

$$
\text{interest}_k = \text{balance}_{k-1} \cdot r \qquad
\text{principal}_k = \text{PMT} - \text{interest}_k \qquad
\text{balance}_k = \text{balance}_{k-1} - \text{principal}_k
$$

`src/segment.ts:100,133,135`.

### 2.2 Forced final row (clears rounding residue exactly)

$$
\text{principal}_k = \text{balance}_{k-1} \qquad
\text{payment}_k = \text{interest}_k + \text{principal}_k \qquad
\text{balance}_k = 0
$$

Triggered when the row is a bounded segment's last row, or when the dynamic loop
detects the next computed balance would go $\le 0$. `src/segment.ts:116-121` (kept in
the codebase as an inline branch, not extracted verbatim here).

### 2.3 Interest-only row (`Segment.interestOnly`)

$$
\text{interest}_k = \text{balance}_{k-1} \cdot r \qquad
\text{principal}_k = 0 \qquad
\text{balance}_k = \text{balance}_{k-1}
$$

`src/segment.ts:55` (payment sizing) and the `segment.interestOnly` branch in the row
loop.

### 2.4 Remaining balance after $k$ payments (closed form)

$$
B_k = P \cdot \frac{(1+r)^n - (1+r)^k}{(1+r)^n - 1}
$$

Not computed directly in `src/segment.ts` (which iterates row-by-row instead), but
this is the identity the iterative loop must match — used in
`tests/segment.test.ts`/`tests/mortgage.test.ts` to independently verify bounded-segment
and balloon-segment endpoints.

### 2.5 Manual override reconciliation

When a row has a `ManualPaymentOverride`:

$$
\text{interest}_k = \text{override.interestPortion} \;\lor\; \text{balance}_{k-1}\cdot r
$$

then, if `remainingBalance` is given directly:

$$
\text{principal}_k = \text{override.principalPortion} \;\lor\; (\text{balance}_{k-1} - \text{remainingBalance})
$$

otherwise:

$$
\text{principal}_k = \text{override.principalPortion} \;\lor\; (\text{payment}_k - \text{interest}_k)
$$

`src/segment.ts:85-97`. ($\lor$ reads "or, if undefined" — TS's `??`.)

---

## 3. Mortgage-level aggregation — `src/mortgage.ts`

### 3.1 Totals

$$
\text{totalOfPayments} = \sum_k \text{payment}_k \qquad
\text{totalInterestPaid} = \sum_k \text{interest}_k
$$

`src/mortgage.ts:97-98`. The payment identity that must always hold:
$\text{totalOfPayments} = \text{totalInterestPaid} + P_{\text{original}}$.

### 3.2 Lump-sum curtailment at a segment boundary

$$
\text{curtailment} = \min(\text{lumpSum.amount},\ \text{balance}_{\text{boundary}})
$$

then the boundary row's principal/payment/balance are all adjusted by that amount:

$$
\text{principal}' = \text{principal} + \text{curtailment} \quad
\text{payment}' = \text{payment} + \text{curtailment} \quad
\text{balance}' = \text{balance} - \text{curtailment}
$$

`src/mortgage.ts:60-63`.

### 3.3 Balloon payment due

$$
\text{balloonPaymentDue} = \text{balance}_{\text{last row of the balloon segment}}
$$

No separate formula — it falls out of §2.1/§2.2 naturally once a segment has
`termMonths` set without running the zero-forcing logic (`Segment.balloon: true`); see
`docs/spec.md` §6.2 for the full design rationale.

---

## 4. Extra & lump-sum payments — `src/extraPayment.ts`, `src/paymentFrequency.ts`

### 4.1 Extra payment savings

Composes two full schedules rather than a closed-form shortcut:

$$
\text{monthsSaved} = \text{originalMonths} - \text{newMonths} \qquad
\text{interestSaved} = \text{originalInterest} - \text{newInterest}
$$

where `newMonths`/`newInterest` come from re-running the schedule with
$\text{PMT}' = \text{PMT} + \text{extraMonthlyPayment}$ run open-ended to a zero
balance. `src/extraPayment.ts:47-55`. **Exact-zero guarantee:** when
`extraMonthlyPayment = 0`, the function short-circuits to
`monthsSaved = 0, interestSaved = 0` rather than re-deriving them through the dynamic
loop, which can otherwise land one payment off from the baseline purely from
cent-rounding (see the comment at `src/extraPayment.ts:33-42`).

### 4.2 Payment-frequency schedule (monthly/semi-monthly/biweekly/weekly)

**Period payment amount** — the standard "pay a fraction of your monthly bill each
occurrence" program, not a fresh annuity computed at the period cadence:

$$
\text{periodPayment} = \text{PMT} \cdot f
$$

where $f$ is the **payment fraction** paid at each occurrence of the chosen frequency:

| Frequency | Payments/yr ($p$) | Fraction ($f$) | Payment-count annual-equivalent ($p \cdot f$) |
|---|---|---|---|
| monthly | 12 | 1 | 12 (baseline) |
| semiMonthly | 24 | 1/2 | 12 (not accelerated by payment count) |
| biweekly | 26 | 1/2 | 13 (accelerated) |
| weekly | 52 | 1/4 | 13 (accelerated) |

**Per-period accrual** (the genuine schedule, `generatePeriodSchedule()`,
`src/paymentFrequency.ts`) — the same row-by-row structure as §2.1/§2.2, but with the
period rate substituted for the monthly rate:

$$
r_{\text{period}} = \frac{\text{annualInterestRatePercent}}{100 \cdot p}
\qquad
\text{interest}_k = \text{balance}_{k-1} \cdot r_{\text{period}}
\qquad
\text{principal}_k = \text{periodPayment} - \text{interest}_k
$$

with the same forced-final-row clearing as §2.2 when a period's principal would
overpay the remaining balance. Real calendar dates per period: $+7$ days (weekly),
$+14$ days (biweekly), evenly spaced at $\approx 365.25/24$ days (semiMonthly,
approximating the "1st & 15th" convention), or the engine's `addMonths` (monthly).

**`'monthly'` is an exact identity**, not merely $r_{\text{period}} = r_{\text{month}}$
producing the same numbers by coincidence: the implementation literally reuses
`summarizeLoan()`'s own schedule rows for `'monthly'` rather than re-deriving them
through this second, independently-rounded loop, which would otherwise risk landing
one payment off from cent rounding alone (see `src/paymentFrequency.ts`'s `schedule`
assignment).

**Derived summary figures** — no longer a monthly-equivalent shortcut, but read
directly off the true per-period schedule:

$$
\text{newTotalInterest} = \sum_k \text{interest}_k
\qquad
\text{newMonths} = \text{round}\!\left(\frac{\text{numberOfPeriods}}{p} \cdot 12\right)
$$

`src/paymentFrequency.ts`. See `docs/spec.md` §3.3 for why there's no separate
"accelerated" flag (the acceleration is intrinsic to $p \cdot f \ne 12$, not a toggle),
and for the real finding that true per-period accrual gives semi-monthly a small
interest saving from payment timing even though it saves zero time, and makes
biweekly/weekly diverge slightly from each other instead of being exactly equal.

---

## 5. Qualification & risk ratios — `src/ltv.ts`, `src/dscr.ts`

$$
\text{LTV} = \frac{\text{loanAmount}}{\text{propertyValue}} \qquad
\text{CLTV} = \frac{\text{firstLien} + \text{secondLien}}{\text{propertyValue}} \qquad
\text{DSCR} = \frac{\text{netOperatingIncome}}{\text{annualDebtService}}
$$

`src/ltv.ts:3-15`, `src/dscr.ts:3-9`. All three throw `RangeError` for a non-positive
denominator rather than returning `Infinity` — see `docs/spec.md` §2.

---

## 6. Recurring costs & PMI — `src/pmi.ts`, `src/costs.ts`

### 6.1 PMI

$$
\text{pmiPayment} = \frac{\text{loanBalance} \cdot \text{annualRatePercent}}{100 \times 12}
$$

`src/pmi.ts:8`, computed against the **original** loan amount, applied while
$\dfrac{\text{remainingBalance}}{\text{propertyValue}} > \dfrac{\text{dropAtLtvPercent}}{100}$
(default 80%).

### 6.2 Recurring cost escalation (property tax / insurance / HOA)

$$
\text{yearIndex} = \left\lfloor \frac{\text{paymentNumber} - 1}{12} \right\rfloor
\qquad
\text{monthlyPortion} = \frac{\text{annualAmount} \cdot (1 + \frac{\text{annualIncreasePercent}}{100})^{\text{yearIndex}}}{12}
$$

`src/costs.ts:13-15`. Compounds at each 12-payment anniversary; the compounding stays
unrounded until the final `round2` of the monthly figure (§0's rounding-policy rule).

### 6.3 Cost breakdown totals

$$
\text{totalCostOfOwnership} = \text{totalOfPayments} + \text{totalTax} + \text{totalInsurance} + \text{totalHoa} + \text{totalPmi}
$$

`src/costs.ts:81-84`.

---

## 7. Alternative payment structures — `src/arm.ts`

### 7.1 ARM reset rate with caps

$$
\text{fullyIndexed} = \text{indexRate} + \text{margin}
$$

$$
\text{capped} = \min\big(\text{fullyIndexed},\ \text{previousRate} + \text{perResetCap}\big)
$$

where `perResetCap` is `initialCapPercent` on the first reset or `periodicCapPercent`
on every later reset, then:

$$
\text{capped} = \min\big(\text{capped},\ \text{initialRate} + \text{lifetimeCap}\big)
\qquad
\text{capped} = \max(\text{capped},\ 0)
$$

`src/arm.ts:30-38`. Each cap is applied only if provided (both are optional).

---

## 8. Comparison & breakeven tooling — `src/points.ts`, `src/refinance.ts`, `src/compare.ts`

### 8.1 Mortgage points

$$
\text{pointsCost} = \frac{\text{loanAmount} \cdot \text{points}}{100}
\qquad
\text{monthlySavings} = \text{PMT}_{\text{original}} - \text{PMT}_{\text{withPoints}}
$$

$$
\text{breakevenMonths} =
\begin{cases}
\dfrac{\text{pointsCost}}{\text{monthlySavings}} & \text{monthlySavings} > 0 \\[4pt]
\infty & \text{otherwise}
\end{cases}
$$

`src/points.ts:28-42`. $\text{PMT}_{\text{withPoints}}$ uses
$\text{originalRatePercent} - \text{rateReductionPercent}$ as the rate (§1.1).

### 8.2 Refinance breakeven & total cost

$$
\text{breakevenMonths} =
\begin{cases}
\dfrac{\text{closingCosts}}{\text{oldPayment} - \text{newPayment}} & \text{oldPayment} > \text{newPayment} \\[4pt]
\infty & \text{otherwise}
\end{cases}
$$

$$
\text{newTotalCost} = \text{newSummary.totalOfPayments} + \text{closingCosts}
\qquad
\text{netSavings} = \text{oldTotalCost} - \text{newTotalCost}
$$

`src/refinance.ts:16-20,44-45`. `oldTotalCost`/`newTotalCost`/payments are read off two
independent `summarizeLoan()` calls (§3.1), not recomputed by hand.

### 8.3 Term comparison

No new arithmetic — `compareLoanTerms()` runs `summarizeLoan()` (§3.1) once per
candidate loan and reports $\arg\min$ over `monthlyPayment` and over
`totalInterestPaid`, ties resolved to the first (lowest) index. `src/compare.ts`.

---

## 9. Home-price loan adapter — `src/loan.ts`

$$
\text{loanAmount} = \text{homePrice} - \text{downPayment}
$$

`src/loan.ts:30-41`, guarded by `downPayment < homePrice`.
