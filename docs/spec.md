# cob-calculator — Spec: v2 Use Cases (PUC1-PUC6)

## 1. Purpose & scope

This spec documents the v2 surface added on top of the original 5 use cases
(`docs/usecases.mmd`): 6 categories of use cases identified by a gap analysis against
this project's `.claude/skills/lending` reference implementation
(`docs/usecases-proposed.mmd`). All 6 categories are now implemented, tested, and
exported from `src/index.ts`. The test suite is 90/90 passing (up from the original 33)
and `npm run typecheck` / `npm run build` are both clean.

One subsection below per PUC category, each naming the implementing file(s), the public
function/type signatures, and the edge cases the tests cover. Every formula referenced
below is catalogued in full, with exact source locations, in
[`docs/equations.md`](./equations.md).

## 2. Cross-cutting conventions

- **Percent-rate convention.** All rates in this library are percent numbers (`6` means
  6%), matching the existing `Segment.annualInterestRatePercent` /
  `calculateMonthlyPayment`. This differs from the lending skill's Python reference,
  which uses decimals (`0.065` means 6.5%). Every new function in this spec follows the
  percent convention — when cross-checking a "known example" against the lending
  skill's own worked numbers, remember to convert.
- **Rounding policy** (`src/money.ts`, unchanged): `round2()` rounds only final currency
  amounts actually paid/owed, at each row/result. Ratios (LTV, CLTV, DSCR) and
  time-spans (breakeven months) stay unrounded floats.
- **Validation.** Every new function throws a plain `RangeError` via a
  `validateXInput(...)` function in `src/validate.ts`, called first in the
  corresponding compute function. No custom error classes exist anywhere in this
  codebase (old or new code) — don't add any. The one exception carried over from the
  original engine: `segment.ts`'s negative-amortization guard throws a plain `Error`,
  not `RangeError`.
- **No sentinel `Infinity` for bad input.** Where the lending skill's Python reference
  returns `Infinity` for a bad denominator (e.g. `loan_to_value` with
  `propertyValue <= 0`), this codebase throws instead (LTV, CLTV, DSCR — see §5).
  **Exception:** points breakeven and refinance breakeven *do* return `Infinity` when
  savings are non-positive — that's a legitimate financial outcome ("this doesn't pay
  off"), not an invalid input, so it's not an error (see §7.1, §7.2).
- **Additive/optional fields only.** Every new field on `Segment`, `MortgageInput`,
  `ManualPaymentOverride`, `AmortizationEntry`, and `LoanSummary` is optional. No
  existing behavior changes unless the new field is explicitly set.

## 3. PUC1 — Extra & lump-sum principal payments

### 3.1 Recurring extra payment

`calculateExtraPaymentSavings(input: ExtraPaymentSavingsInput): ExtraPaymentSavingsResult`
— `src/extraPayment.ts`. Composes two `summarizeMortgage()` calls (a baseline
`amortizationMonthsRemaining`-sized loan vs. the same loan with
`extraMonthlyPayment` added to a fixed `paymentAmount`, run open-ended to payoff) rather
than reimplementing amortization.

### 3.2 One-time lump sum at a renewal

`MortgageInput.lumpSumPayments?: LumpSumPayment[]` (`{ afterPaymentNumber, amount }`),
applied in `src/mortgage.ts`'s `stitchSegments`. **Scope cut: v1 supports lump sums
applied only exactly at a segment/renewal boundary**, not mid-segment — the amount
curtails the boundary row's principal/payment/balance directly, keeping the payment
identity intact for every row. If the lump sum fully clears the balance and segments
remain, stitching stops there (no more segments run — avoids a `calculateMonthlyPayment(0, ...)`
throw). Extension point for v2: apply the same `Map`-keyed pattern used for
`manualOverrides` to support mid-segment lump sums.

### 3.3 Payment frequency (monthly / semi-monthly / biweekly / weekly)

`calculatePaymentFrequencySchedule(input: PaymentFrequencyScheduleInput):
PaymentFrequencyScheduleResult` — `src/paymentFrequency.ts`. Generates a **genuine
per-period amortization schedule** at the chosen frequency: interest accrues each
period at `annualInterestRatePercent / paymentsPerYear` against the real outstanding
balance, with real calendar dates (every 7 days for weekly, every 14 for biweekly).
This is a standalone calculator — it doesn't touch `segment.ts`/`mortgage.ts`, which
remain monthly-periodic — so it can afford true per-period accrual without a parallel
segment-stitching engine. `result.schedule: PeriodAmortizationEntry[]` exposes every
row (`periodNumber`, `periodDate`, `paymentAmount`, `interestPortion`,
`principalPortion`, `remainingBalance`); the summary fields (`newMonths`,
`newTotalInterest`, `interestSaved`, etc.) are derived directly from that schedule, not
from a monthly-equivalent shortcut. `'monthly'` is an exact identity against the
standard monthly schedule (`summarizeLoan`) by construction — it reuses that schedule's
own rows rather than re-deriving them through a second independent loop, which would
otherwise risk a one-payment cent-rounding mismatch (see the comment at
`src/paymentFrequency.ts`'s `schedule` assignment).

**One remaining approximation:** `semiMonthly` period dates are evenly spaced
(`365.25 / 24` days apart) rather than snapped to the "1st and 15th of each month"
convention some lenders use. `weekly`/`biweekly` dates are exact (7/14 real days).

**Terminology, clarified against real mortgage-industry practice** (there is no
industry-recognized "accelerated" variant distinct from plain biweekly/weekly — the
acceleration is intrinsic to the calendar, not a togglable feature):

| `PaymentFrequency` | Payments/yr | Amount per period | Saves time? | Saves interest? |
|---|---|---|---|---|
| `'monthly'` | 12 | full payment | No (baseline) | No (baseline) |
| `'semiMonthly'` | 24 | half payment | **No** — 24 × ½ = 12 monthly-equivalents by payment count | **Yes, a modest amount** — true per-period compounding at annual/24 still saves a little purely from payment timing (half the annual total arrives ~15 days earlier on average) |
| `'biweekly'` | 26 | half payment | Yes — 26 × ½ = 13 monthly-equivalents/yr | Yes, substantially |
| `'weekly'` | 52 | quarter payment | Yes — 52 × ¼ = 13 monthly-equivalents/yr | Yes, substantially — and at least as much as biweekly, though no longer required to be *exactly* equal to it now that each frequency compounds independently at its own true period rate |

This is a real finding from moving off the monthly-equivalent approximation: under
*that* model, biweekly and weekly produced identical savings (both reduced to "one
extra monthly-equivalent payment/year") and semi-monthly produced exactly zero. Under
true per-period accrual, semi-monthly's zero-time-saved conclusion still holds (it's a
payment-count fact), but it does save a little interest from payment timing, and
biweekly/weekly diverge slightly from each other since they now compound at genuinely
different period rates (annual/26 vs. annual/52) rather than sharing one approximated
monthly-equivalent figure.

`'bimonthly'` (every-2-months) is deliberately not exposed as a value — it's not a real
mortgage product, and the word is ambiguous with `semiMonthly` in everyday use.

## 4. PUC2 — Recurring costs & PMI

**Architectural decision:** tax/insurance/HOA/PMI don't affect principal paydown, so
they're modeled as a parallel, additive post-processing layer
(`applyRecurringCosts`, `src/costs.ts`) rather than being woven into `segment.ts`'s core
loop. `summarizeMortgage`'s `totalOfPayments`/`totalInterestPaid` remain P&I-only by
design — verified by a dedicated regression test comparing a run with `pmi`/
`recurringCosts` against one without.

### 4.1 Recurring costs with annual escalation

`MortgageInput.recurringCosts?: RecurringCosts` (`propertyTax`/`homeInsurance`/`hoa`,
each `{ annualAmount, annualIncreasePercent? }`). Escalation compounds at each
12-payment anniversary (`yearIndex = floor((paymentNumber - 1) / 12)`). **Scope cut:**
escalation-only — no cost *decreases* are modeled in v1.

### 4.2 PMI + 80% LTV auto-drop

`calculatePmiPayment(loanBalance, annualRatePercent): number` — `src/pmi.ts`. PMI is
computed against the **original** loan amount (matching the lending skill's
`pmi_cost(loan_amount)`, which doesn't vary monthly), applied every row while
`remainingBalance / propertyValue > dropAtLtvPercent/100` (default 80%), and drops to 0
once the LTV threshold is crossed. `MortgageInput.pmi?: PmiInput`.

### 4.3 Cost breakdown

`LoanSummary.costBreakdown?: CostBreakdownSummary` — totals for tax/insurance/HOA/PMI
plus `totalCostOfOwnership` (= `totalOfPayments` + all of the above), and
`pmiDroppedAtPaymentNumber` (the first payment number where PMI dropped off;
`undefined` if PMI was never active because starting LTV was already at/under the
threshold, or if PMI wasn't configured).

## 5. PUC3 — Qualification & risk ratios

- `loanToValue(loanAmount, propertyValue): number` / `combinedLoanToValue(firstLien,
  secondLien, propertyValue): number` — `src/ltv.ts`.
- `debtServiceCoverageRatio(netOperatingIncome, annualDebtService): number` —
  `src/dscr.ts`. `netOperatingIncome` is unrestricted (can be negative — a losing
  investment property is a valid input, not an error); `annualDebtService` must be
  positive.

**Deviation from the lending skill:** all three throw `RangeError` for a non-positive
denominator instead of returning `Infinity` (see §2).

## 6. PUC4 — Alternative payment structures

### 6.1 Interest-only segments

`Segment.interestOnly?: boolean` — `src/segment.ts`. Payment = `balance * monthlyRate`
for every row; `principalPortion` is forced to 0 (checked *before* the
negative-amortization guard and forced-final-row logic, since an interest-only payment
is by definition exactly equal to that period's interest). Requires `termMonths` (an
interest-only segment never amortizes to zero on its own) — validated in
`validateSegment`.

### 6.2 Balloon payments — Design Decision

**The conflict:** `validateSegment` originally forbade `termMonths` on the *last*
segment, because the last segment is what runs the mortgage to full payoff. Balloon
semantics need the opposite: the last segment stops at `termMonths` with a nonzero
balance, and that balance *is* the balloon due.

**The resolution:** an explicit, opt-in `Segment.balloon?: boolean`. Absent, behavior is
byte-identical to the original rule (verified: the pre-existing test asserting
`/must be omitted on the last segment/` still passes unmodified, since the new
condition — `termMonths !== undefined && !segment.balloon` — still evaluates true when
`balloon` is absent). Present, the rule relaxes for that segment, `balloon` additionally
requires `termMonths` and must be on the last segment, and
`LoanSummary.balloonPaymentDue?: { segmentIndex, amount, dueDate }` is populated. No
change to the amortization math in `segment.ts` was needed: a balloon segment always has
`termMonths` set, so `isFinalSegment` is `false`, so the zero-forcing logic never fires
— the loop simply stops after `termMonths` rows with whatever balance remains, which is
exactly the balloon amount.

### 6.3 ARM resets with rate caps

`calculateArmResetRate(input: ArmResetInput): ArmResetResult` — `src/arm.ts`. Pure
rate-cap calculator (fully indexed rate = index + margin, clamped by an initial/periodic
cap relative to the previous rate and a lifetime cap relative to the initial rate). The
caller plugs `cappedRatePercent` into a normal renewal segment's
`annualInterestRatePercent` — this reuses the already-tested "variable rate change"
mechanism unchanged; there's no separate "payment after reset" wrapper, since
`calculateMonthlyPayment(balance, cappedRatePercent, remainingMonths)` already does that.

## 7. PUC5 — Comparison & breakeven tooling

### 7.1 Points breakeven

`calculatePointsBreakeven(input: PointsBreakevenInput): PointsBreakevenResult` —
`src/points.ts`. Calls `calculateMonthlyPayment` twice (original rate vs.
rate-reduced-by-points). `breakevenMonths` is `Infinity` when the rate reduction
produces no monthly savings — a legitimate outcome ("points never pay off"), not a
throw (see §2).

### 7.2 Refinance breakeven & total cost

`calculateRefinanceBreakeven(input): number` and
`compareRefinance(input: RefinanceComparisonInput): RefinanceComparisonResult` —
`src/refinance.ts`. `compareRefinance` composes two `summarizeLoan()` calls rather than
reimplementing amortization. Same `Infinity`-on-no-savings behavior as §7.1.

### 7.3 Term comparison

`compareLoanTerms(loans: LoanInput[]): TermComparisonResult` — `src/compare.ts`. Pure
aggregation over `summarizeLoan()` per entry; reports the lowest-monthly-payment and
lowest-total-interest entries (ties resolve to the first/lowest index).

## 8. PUC6 — Statement reconciliation tooling

### 8.1 Override reason/audit trail

`ManualPaymentOverride.reason?: string` threads through to
`AmortizationEntry.overrideReason` on the corresponding row (`src/segment.ts`).
Free-text, optional, no validation beyond being a string.

### 8.2 Bulk import (CSV/JSON)

`importOverridesFromJson(json: string)` / `importOverridesFromCsv(csv: string):
ManualPaymentOverride[]` — `src/importOverrides.ts`, feeding the existing
`MortgageInput.manualOverrides` mechanism. **Documented limitation:** the CSV parser is
intentionally naive (header row + comma-split, no quoted-field or embedded-comma
support) — no new dependency was added, since `package.json` has zero runtime
dependencies and a fuller CSV parser wasn't warranted for this. Duplicate
`paymentNumber`s within a single import throw `RangeError` rather than silently
last-wins clobbering.

## 9. Known limitations / deliberate v1 scope cuts

- **Lump sums** (§3.2): boundary-only, not mid-segment.
- **Payment frequency** (§3.3): true per-period calendar accrual for
  weekly/biweekly/monthly; `semiMonthly` period dates are evenly spaced rather than
  snapped to fixed 1st/15th-of-month dates; no `'bimonthly'` (every-2-months) value,
  since it isn't a real mortgage product.
- **Recurring costs** (§4.1): escalation-only, no cost decreases.
- **CSV import** (§8.2): no quoted-field/embedded-comma support.
- **Lump-sum curtailment** (§3.2): folded into the boundary row's `paymentAmount`
  rather than modeled as a distinct line-item row — a real-world statement might show
  it separately.

## 10. Traceability table

| PUC node (`docs/usecases-proposed.mmd`) | File | Exported function/type |
|---|---|---|
| PUC1a — recurring extra payment | `src/extraPayment.ts` | `calculateExtraPaymentSavings` |
| PUC1b — lump sum at renewal | `src/types.ts`, `src/mortgage.ts` | `LumpSumPayment`, `MortgageInput.lumpSumPayments` |
| PUC1c — payment frequency (monthly/semi-monthly/biweekly/weekly) | `src/paymentFrequency.ts` | `calculatePaymentFrequencySchedule`, `PaymentFrequency` |
| PUC2a — recurring costs | `src/types.ts`, `src/costs.ts` | `RecurringCosts`, `applyRecurringCosts` |
| PUC2b — PMI + auto-drop | `src/pmi.ts`, `src/costs.ts` | `calculatePmiPayment`, `PmiInput` |
| PUC2c — cost breakdown | `src/types.ts` | `LoanSummary.costBreakdown` |
| PUC3a — LTV | `src/ltv.ts` | `loanToValue` |
| PUC3b — CLTV | `src/ltv.ts` | `combinedLoanToValue` |
| PUC3c — DSCR | `src/dscr.ts` | `debtServiceCoverageRatio` |
| PUC4a — interest-only | `src/types.ts`, `src/segment.ts` | `Segment.interestOnly` |
| PUC4b — balloon payment | `src/types.ts`, `src/validate.ts`, `src/mortgage.ts` | `Segment.balloon`, `LoanSummary.balloonPaymentDue` |
| PUC4c — ARM rate caps | `src/arm.ts` | `calculateArmResetRate` |
| PUC5a — points breakeven | `src/points.ts` | `calculatePointsBreakeven` |
| PUC5b — refinance breakeven | `src/refinance.ts` | `calculateRefinanceBreakeven`, `compareRefinance` |
| PUC5c — term comparison | `src/compare.ts` | `compareLoanTerms` |
| PUC6a — override reason | `src/types.ts` | `ManualPaymentOverride.reason`, `AmortizationEntry.overrideReason` |
| PUC6b — bulk import | `src/importOverrides.ts` | `importOverridesFromJson`, `importOverridesFromCsv` |
