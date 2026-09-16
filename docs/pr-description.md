# Implement lending-skill gap use cases (PUC1-PUC6)

## Summary

`cob-calculator` originally covered 5 use cases (simple fixed-rate loans, home-price
loans, single-segment amortization, multi-segment mortgage lifecycles, and input
validation). A gap analysis against this project's `lending` skill (a reference
mortgage-analysis implementation) identified 6 categories of common lending
calculations the library couldn't do yet. This PR implements all 6, with tests and a
consolidated spec.

**Problem this solves:** the library could amortize a loan and stitch renewals
together, but couldn't answer the questions that actually drive a borrower's or
lender's decision — *should I pay points, is this refinance worth it, when does PMI
drop off, what's the balloon payment, what happens when my ARM resets, is this loan
DSCR-qualified* — without reaching for a separate tool. Those calculations now live in
the same engine, sharing its amortization core instead of re-deriving it.

## What's new

| Category | Adds |
|---|---|
| **Extra & lump-sum payments** | `calculateExtraPaymentSavings()`, `MortgageInput.lumpSumPayments` (applied at a renewal boundary), `calculateBiweeklySchedule()` |
| **Recurring costs & PMI** | `applyRecurringCosts()` (property tax/insurance/HOA with annual escalation), `calculatePmiPayment()` with 80%-LTV auto-drop, `LoanSummary.costBreakdown` |
| **Qualification ratios** | `loanToValue()`, `combinedLoanToValue()`, `debtServiceCoverageRatio()` |
| **Alternative payment structures** | `Segment.interestOnly`, `Segment.balloon` + `LoanSummary.balloonPaymentDue`, `calculateArmResetRate()` (index+margin with initial/periodic/lifetime caps) |
| **Comparison & breakeven tooling** | `calculatePointsBreakeven()`, `calculateRefinanceBreakeven()` / `compareRefinance()`, `compareLoanTerms()` |
| **Statement reconciliation** | `ManualPaymentOverride.reason` / `AmortizationEntry.overrideReason`, `importOverridesFromJson()` / `importOverridesFromCsv()` |

Full design rationale, worked examples, and known v1 scope cuts are in
[`docs/spec.md`](./spec.md). [`docs/usecases.mmd`](./usecases.mmd) and
[`docs/usecases-proposed.mmd`](./usecases-proposed.mmd) are the before/after diagrams.

## Design notes worth a reviewer's attention

- **No breaking changes.** Every new field (`Segment`, `MortgageInput`,
  `ManualPaymentOverride`, `AmortizationEntry`, `LoanSummary`) is optional and additive.
  Existing callers see no behavior change unless they opt into a new field.
- **Balloon payments required resolving a real conflict**: the original validation
  explicitly forbade `termMonths` on the last segment (it's what makes the loan run to
  payoff). Balloon semantics need the opposite — the last segment stops early with a
  nonzero balance. Resolved with an explicit opt-in `Segment.balloon` flag; absent, the
  original rule is byte-identical (verified: the pre-existing regression test for that
  rule still passes unmodified).
- **Cost breakdown is additive, not intrusive.** PMI/tax/insurance/HOA are computed in
  a separate post-processing pass (`applyRecurringCosts`) rather than woven into the
  core amortization loop, so `totalOfPayments`/`totalInterestPaid` stay P&I-only —
  verified with an explicit regression test comparing runs with and without costs
  configured.
- **Percent-rate convention preserved.** All new functions use the library's existing
  percent-number convention (`6` = 6%), not the lending skill's decimal convention
  (`0.06`) — called out explicitly in `docs/spec.md` to avoid a unit-conversion bug for
  anyone porting numbers from the skill.
- **Deliberate v1 scope cuts** (documented, not oversights): lump sums apply only at a
  segment/renewal boundary, not mid-segment; biweekly is modeled as a monthly-equivalent
  acceleration, not true 14-day accrual; recurring costs only escalate, never decrease;
  the CSV importer is intentionally naive (no quoted-field support, no new dependency
  added — the project has zero runtime dependencies).

## Test plan

- `npm run typecheck` — clean (strict mode, `noUncheckedIndexedAccess`)
- `npm test` — **85/85 passing** (33 original + 52 new), across 15 test files. Every new
  function has a happy-path test, one edge case, and one invalid-input case; several
  happy-path tests are cross-checked against the lending skill's own verified worked
  examples (PMI $300/mo, DSCR 1.3333, ARM reset 7.75%→6.5% capped, points/refinance/
  extra-payment breakevens).
- `npm run build` — clean; `dist/` regenerates with `.d.ts` for all 17 modules.
