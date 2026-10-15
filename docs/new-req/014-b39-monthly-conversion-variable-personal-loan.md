# 014 — B39: monthly-compounded rate conversion for variable-rate mortgages and personal loans at the 7- and 14-day frequencies (COB-ts)

## Status

**Draft brief, ready to build (2026-10-13).** Decision `DEC-B39-VAR-PL-M12` (user, 2026-10-13, `COB-user-stories.md` §7.5 and US-08). Deviation `DEV-B39-M12` (suggested ID, below), which needs the user's sign-off in the change log (CHANGES §77). Target: **COB-ts only** (Q-B39-ENGINES).

| Item | State |
|---|---|
| Rule: Calculated rate = n × [(1 + i/12)^(12/n) − 1] for a variable-rate mortgage and a personal loan (either rate type) at Weekly, Accelerated weekly, Bi-weekly, Accelerated bi-weekly | Specified (E-B39-1 … E-B39-4) |
| n | B37's leap-aware n = (D ÷ P) ÷ Y with B38's Y (Excel `YEARFRAC(start, end, 1)`) — the existing chooser, unchanged at step 6 |
| Period interest | Full precision (no cent rounding); B38 rounding stays fixed-rate-mortgage only |
| Switch | `MONTHLY_RATE_CONVERSION`, shipped `true` (ADR-14 / M2); effective only while `LEAP_AWARE_PAYMENTS_PER_YEAR` is `true` |
| Acceptance | User's Excel: VAR-2 to the cent; VAR-1 **+1 cent** (known gap, Q-B39-VAR1-CENT); fixed case 1 / example 2 unchanged. Registry `COB-py/tests/fixtures/ca_user_excel_examples.json` (new, this brief) |
| Not done here (caller limited this run to two files) | `docs/architecture.md` traceability row; `docs/new-req/README.md` and 008 §I (the BA is editing them; both already reference this spec); `COB-user-stories.md` (BA, done) |

**Source ranking for this item.** The reference workbook uses the contract rate unconverted for its MONTHLY rate type at every frequency (`Calculator!D10 = IF(RateType="MONTHLY", MonthlyRate, XLOOKUP(Freq, r_Freq, r_EquivalentRate))`, OQ-C, CHANGES §12). The BRD contradicts itself (008 F-ii #4 / G-06): §4.2 "All other products (e.g., personal loans): use monthly compounding at the contract rate (m = 12)" and IN-04, against §4.2 "Variable-rate mortgage: no conversion … (m = n)", BR-02 "… use monthly compounding, which equals the contract rate", B.1 "for MONTHLY rate type = contract rate" and OUT-01. B39 follows the **user's own Excel** (the spreadsheet the user checks figures against and calls the point of truth), by explicit user decision, as B37 and B38 did. It therefore follows §4.2's personal-loan bullet and departs from §4.2's variable bullet, BR-02, B.1, OUT-01 and the workbook. Re-reading the macro adds nothing: its rule is the one being departed from. With the switch off, the engine is byte for byte today's (B38) engine.

## Problem

The user supplied two variable-rate-mortgage examples from their Excel on 2026-10-13 (VAR-1, VAR-2; registry UX-003, UX-004). Today's engine (contract rate as entered) misses both by far more than rounding: VAR-1 12,480.90 against Excel 12,463.91, VAR-2 57,862.71 against 57,808.56. Treating the contract rate as monthly-compounded and converting it to the payment frequency with B37/B38's n reproduces VAR-2 to the cent and VAR-1 to 1 cent, and leaves the two fixed-rate examples at their Excel values. The research behind the choice is in Appendix R.

## Scope

**In scope (predicate M, E-B39-1):** rate basis `MONTHLY` (variable-rate mortgage; personal loan, fixed or variable rate) **and** a 7- or 14-day frequency (Weekly, Accelerated weekly, Bi-weekly, Accelerated bi-weekly) **and** start < End **and** `LEAP_AWARE_PAYMENTS_PER_YEAR` **and** `MONTHLY_RATE_CONVERSION`. All four flows (the decision names products and frequencies, not flows), including Variable-rate payment change.

**Out of scope, unchanged byte for byte:**
- Fixed-rate mortgages at every frequency (B37 + B38, spec 013), including the B38 per-row cent rounding, which stays fixed-only.
- Monthly and Semi-monthly for every product: contract rate as entered (variable / personal loan), m = 2 with n = 12 / 24 (fixed). G-06 also asked about Semi-monthly; B39 leaves it at option (a).
- The period day-count rule (BR-11, B.3): `periodInterest(opening, r, prior, date)`, actual days, leap-year days over 366. In scope it is **not** rounded.
- The Trigger rate (BRD §4.3, BR-08): `payment × PAYMENTS_PER_YEAR[f] ÷ principal` (52 / 26), unchanged (default for Q-B39-TRIGGER).
- The COB-rate T (equation 7), the accrued-interest rules, fees, validation, schedule dates and stop rule.
- COB-py, COB-xlsx, `app/engine` (Q-B39-ENGINES). Note for that question: COB-py and `app/engine` already convert a **personal loan** at m = 12 with the fixed n = 52 / 26 (008 §E #5, `cob_canada.py` l.174-179, `app/engine/src/cobCanada.ts` l.197-202), and leave a variable mortgage unconverted.
- Public types and barrels: no change. `paymentsPerYearFor(input, frequency)` keeps its signature; its value changes in scope (E-B39-2).

## Data shapes

### Switch (policies.ts, ADR-14 / mechanism M2; new last export, the ninth)

```ts
/**
 * @decision DEC-B39-VAR-PL-M12 — the MONTHLY rate basis (variable-rate mortgage, personal loan of either rate type) at
 * the 7- and 14-day frequencies (Weekly, Accelerated weekly, Bi-weekly, Accelerated bi-weekly), all flows: the
 * contract rate is treated as compounded monthly and converted with equation 1 at m = 12 and the leap-aware n of
 * DEC-B37-LEAP-N (Y as chosen by YEARFRAC_ROUNDED_INTEREST). Period interest is not rounded (DEV-B39-M12).
 * Effective only while LEAP_AWARE_PAYMENTS_PER_YEAR is true.
 * Switch (ADR-14): shipped `true`; the other branch `false` is built and tested.
 * `true`: Calculated rate = n x [(1 + i/12)^(12/n) - 1].
 * `false`: the contract rate as entered at every frequency (OQ-C, workbook Calculator!D10), byte for byte.
 */
export const MONTHLY_RATE_CONVERSION = true;
```

**Name.** `MONTHLY_RATE_CONVERSION`: it switches the conversion of the workbook's `MONTHLY` rate basis (`selectRateBasis`), parallel to `LEAP_AWARE_PAYMENTS_PER_YEAR` / `YEARFRAC_ROUNDED_INTEREST`.

**Gated on `LEAP_AWARE_PAYMENTS_PER_YEAR` (decision, architect; answers Q-B39-SWITCH as the BA recommended).**
- The decision defines n as B37's leap-aware n. With B37 off there is no leap-aware n; the only remaining reading (m = 12 with n = 52 / 26) was measured and is not the decided rule (Appendix R: +0.02 / +0.15 on VAR-1 / VAR-2). Building it would add a state with no business meaning that ADR-14 would require to be tested.
- Gating falls out of the existing chooser for free: predicate M uses `leapPathApplies`, whose step 2 is `!leapAware → false`.

**Y follows `YEARFRAC_ROUNDED_INTEREST` (decision, architect).** The decision says "the same Y that B38 uses". Reusing the chooser's step 6 unchanged makes that literally true in every switch state, keeps one Y code path and keeps the label and the calculation on one function (Q-B37-LABEL). With B38 off, B39 uses `dayCountFraction`, a built-and-tested state with no Excel evidence (INV-B39-STATES).

| `LEAP_AWARE_…` | `YEARFRAC_ROUNDED_…` | `MONTHLY_RATE_CONVERSION` | State |
|---|---|---|---|
| `false` | any | any | Workbook converter: n = 52 / 26, MONTHLY basis unconverted, no rounding (B39 inert) |
| `true` | `false` | `false` | B37 |
| `true` | `true` | `false` | B38 (the shipped state before B39) |
| `true` | `false` | `true` | B39 with B37's Y (built, tested; no Excel evidence) |
| `true` | `true` | `true` | **B39 (shipped)** |

### Threading (cobCanada.ts)

```ts
export function calculateCobCanadaWith(
  input: CobCanadaInput,
  switches: EngineSwitches,
  leapAware: boolean = LEAP_AWARE_PAYMENTS_PER_YEAR,
  yearFracRounded: boolean = YEARFRAC_ROUNDED_INTEREST,
  monthlyConversion: boolean = MONTHLY_RATE_CONVERSION,
): CobCanadaResult
```

- `calculateCobCanada(input)` stays `return calculateCobCanadaWith(input, SHIPPED_SWITCHES);`.
- `nForRate = conversionPaymentsPerYear(p, r, f, startDate, endDate, leapAware, yearFracRounded, monthlyConversion)`.
- `roundPeriodInterest = roundsPeriodInterestToCent(p, r, f, startDate, endDate, leapAware, yearFracRounded)` — call unchanged (no 8th argument).
- `convertMonthly = convertsMonthlyRate(p, r, f, startDate, endDate, leapAware, monthlyConversion)`.
- `calculatedRateFor(p, r, contractRatePercent, nForRate, convertMonthly)`.
- `paymentsPerYearFor` passes `LEAP_AWARE_PAYMENTS_PER_YEAR, YEARFRAC_ROUNDED_INTEREST, MONTHLY_RATE_CONVERSION` (constants, no literal) as arguments 6-8.
- The trigger-rate call keeps `PAYMENTS_PER_YEAR[input.paymentFrequency]`.

### New and changed functions in `src/ca` (none on either barrel)

| File | Function | Change |
|---|---|---|
| `policies.ts` | `MONTHLY_RATE_CONVERSION` | **New** constant (above) |
| `equations.ts` | `leapPathApplies(p, r, f, start, end, leapAware, monthlyConversion: boolean = false)` (private) | 7th defaulted parameter; the basis test becomes "SEMI-ANNUAL, or MONTHLY with `monthlyConversion`" (E-B39-1) |
| `equations.ts` | `conversionPaymentsPerYear(p, r, f, start, end, leapAware, yearFracRounded = false, monthlyConversion: boolean = false)` | 8th defaulted parameter, forwarded to `leapPathApplies`. Step 4 changes (E-B39-2); step 6 unchanged |
| `equations.ts` | `convertsMonthlyRate(p, r, f, start, end, leapAware, monthlyConversion): boolean` | **New**: predicate M (E-B39-1) |
| `equations.ts` | `roundsPeriodInterestToCent` | **Source unchanged.** It calls `leapPathApplies` with six arguments, so the MONTHLY basis never rounds. Doc comment gains "never for the MONTHLY basis (B39 keeps full precision)" |
| `equations.ts` | `calculatedRateFor(p, r, contractRatePercent, paymentsPerYear, convertMonthly: boolean = false)` | 5th defaulted parameter (E-B39-3) |
| `equations.ts` | `selectRateBasis`, `selectCompoundingPeriodsPerYear`, `calculatedRate`, `leapAwarePaymentsPerYear`, `periodInterest` | **Unchanged** (doc comments of `selectRateBasis` / equation 1 / equation 2 gain one line each naming B39) |
| `cobCanada.ts` | `calculateCobCanadaWith`, `paymentsPerYearFor` | As above |
| `types.ts` | `PAYMENTS_PER_YEAR` doc comment; `calculatedRatePercent` doc comment | "… and for the 7/14-day frequencies of the MONTHLY basis when `MONTHLY_RATE_CONVERSION` is on (B39)"; "MONTHLY basis: the contract rate, or its m = 12 conversion at 7/14-day frequencies (B39)" |

## Equations

Notation: `basis = selectRateBasis(productType, rateType)`; `P = paymentPeriodDays(f)` (7, 14 or null); `i = contractRatePercent / 100`.

### E-B39-1 — predicate M (`convertsMonthlyRate`) and the widened leap path

```
leapPathApplies(p, r, f, start, end, leapAware, monthlyConversion = false):
  1. leapAware false                                  -> false
  2. P null (Monthly, Semi-monthly)                    -> false
  3. basis !== 'SEMI-ANNUAL' and not monthlyConversion -> false
  4. start or end not a valid Date, or daysBetween(start, end) <= 0 -> false
  5. -> true

convertsMonthlyRate(p, r, f, start, end, leapAware, monthlyConversion) =
  monthlyConversion && basis === 'MONTHLY' && leapPathApplies(p, r, f, start, end, leapAware, true)
```

Never throws (an unknown frequency gives `P` undefined/null → false). Predicate S of B38 (`roundsPeriodInterestToCent`) is unchanged and is therefore disjoint from M: S ⇒ basis SEMI-ANNUAL, M ⇒ basis MONTHLY.

### E-B39-2 — n for equation 1 (`conversionPaymentsPerYear`)

In order:
1. `base = PAYMENTS_PER_YEAR[f]` (own key only; `RangeError` otherwise).
2. `leapAware` false → `base`.
3. `P` null → `base`.
4. **Changed:** `basis !== 'SEMI-ANNUAL'` **and not** `monthlyConversion` → `base`.
5. Invalid date or `daysBetween(start, end) <= 0` → `base`.
6. `leapAwarePaymentsPerYear(P, start, end, yearFracRounded)` = `D / P / Y`, evaluated left to right; `Y = excelYearFracBasis1(start, end)` when `yearFracRounded`, else `dayCountFraction(start, end)` (unchanged).

`paymentsPerYearFor(input, f)` (the dropdown label) calls this with the shipped constants, so the label's n and the calculation's n are the same number (Q-B37-LABEL). The label shows `Math.round(n)` (`ui/ca-view.js` `frequencyOptionText`), so the visible text stays "(52/yr)" / "(26/yr)" for every realistic span (365/7 ≤ n ≤ 366/7 · (1 + 1e-12)). No UI change.

### E-B39-3 — Calculated rate (`calculatedRateFor`)

```
basis MONTHLY, convertMonthly false -> { percent: contractRatePercent, decimal: contractRatePercent / 100 }   (unchanged)
basis MONTHLY, convertMonthly true  -> decimal = calculatedRate(contractRatePercent, 12, paymentsPerYear)
                                       = n * (Math.pow(1 + (contractRatePercent / 100) / 12, 12 / n) - 1)
                                       percent = decimal * 100
basis SEMI-ANNUAL                   -> unchanged (m = 2); convertMonthly is ignored
```

- m = 12 is a module-level `const` in `equations.ts` (not exported), named in the doc comment as "BRD §4.2 m = 12".
- Operand order is `calculatedRate`'s (existing). `percent = decimal * 100`, as in the SEMI-ANNUAL branch. **Do not** compute `100 * n * (…)`: it differs in the last bit (VAR-2: `decimal * 100` = 3.796756654443251, `100 * n * (…)` = 3.7967566544432505; the main session's scratch figure used the latter). Only the former is the pin.
- No rounding or truncation of n or of the rate (the 6-dp truncation is the rejected alternative of Appendix R).
- `contractRatePercent = 0` gives exactly 0. For n > 12 and i > 0 the result is strictly below i (INV-B39-BELOW).

### E-B39-4 — schedule row (B39 state)

`periodInterestAmount = periodInterest(openingBalance, calculatedRateDecimal, priorDate, rowDate)` — full precision, **not** `roundToCentHalfAwayFromZero(…)` (predicate S is false). Everything downstream (waterfall, unpaid-interest bucket, totals, C, P, COB rate) is today's code fed with the new rate.

## Registry of the user's Excel examples (`COB-py/tests/fixtures/ca_user_excel_examples.json`)

The cross-reference point of truth for every figure the user produces in their own Excel. Append-only; rules for adding an example are in the file (`howToAdd`). Owner: architect. Entries at version 1 (all Payment change unless noted, no fees; shipped COB-ts = all three switches on):

| Id | Label | Status | Inputs (product/rate, freq, loan, rate, payment, accrued, start / first / End) | Excel | Expected (2 dp) | Before B39 |
|---|---|---|---|---|---|---|
| UX-001 | FIX-1 (case 1) | match | mortgage/fixed, Bi-weekly, 495,466.87, 4.34, 1,350.64, 58.33, 2026-10-08 / 2026-10-21 / 2029-09-23 | 60,137.63 / 43,861.65 | 60,137.63 / 43,861.65 | same |
| UX-002 | FIX-2 (example 2) | match | mortgage/fixed, Bi-weekly, 413,337.42, 4.30, 1,050, 530.49, 2026-10-08 / 2026-10-08 / 2031-03-27 | 74,326.11 / 48,523.89 | 74,326.11 / 48,523.89 | same |
| UX-003 | VAR-1 | **known-gap** +1 / −1 cent | mortgage/variable, Weekly, 109,939.12, 4, 145.16, 0 (confirmed), 2026-10-08 / 2026-10-15 / 2029-09-27 (End corrected from "2026") | 12,463.91 / 10,035.89 | **12,463.92 / 10,035.88** | 12,480.90 / 10,018.90 |
| UX-004 | VAR-2 | match | mortgage/variable, **Bi-weekly (inferred)**, 333,623.25, 3.8, 863.15, 277.63, 2026-10-13 / 2026-10-19 / 2031-09-15 | 57,808.56 / 53,537.79 | 57,808.56 / 53,537.79 | 57,862.71 / 53,483.64 |
| UX-P01 | CHECK (V-PEND) | pending-excel | New loan, mortgage/fixed, Bi-weekly, 300,000, 5, 900, —, 2026-11-02 / 2026-11-16 / 2030-06-28 | — | 51,018.08 / 34,481.92 | same |
| UX-P02 | T1 | pending-excel | VAR-1 at Accelerated weekly | — | 12,463.92 / 10,035.88 | 12,480.90 / 10,018.90 |
| UX-P03 | T2 | pending-excel | VAR-2 at Semi-monthly 935.08, first 2026-11-01 | — | 58,219.01 / 51,185.35 | same (out of scope) |
| UX-P04 | T3 | pending-excel | New loan, personalLoan/fixed, Weekly, 30,000, 8, 140, —, 2026-11-01 / 2026-11-08 / 2031-11-01 | — | 6,376.33 / 30,000.00 (paid off, row 260) | 6,397.62 / 30,000.00 |

Notes: UX-P01's frequency is Bi-weekly (verified against 013's V-PEND fixture); 013 records it as Payment change with accrued 0, the caller as a new loan — both give bit-identical results. T1 equals VAR-1 because the payment is entered and P = 7 for both weekly frequencies.

**How COB-ts consumes it (QA, normative).**
1. A byte-identical copy lives at `COB-ts/tests/ca/fixtures/ca_user_excel_examples.json` (the repo's pattern for shared fixtures, cf. `ca_oracle_scenarios.json`). `tests/ca/support/fixtures.ts` gains `SHARED_FIXTURES_DIR` (`../../../../COB-py/tests/fixtures/`) and `readSharedFixtureText(name)`, the only place that path is built (F11a). A test asserts the two files are byte-identical.
2. For **every** entry, build the engine input from `input` (the `toInput` mapping of `b37-leap-aware-n.test.ts`; move it to `support/` if shared) and run `calculateCobCanada` (shipped). For each figure named in `expected`, `oracleRoundCent(engine figure)` (QA's independent Excel ROUND, `support/leapNOracle.ts`) must equal `expected`, compared in integer cents.
3. Then by status: `match` → `expected` equals `excel` per figure; `known-gap` → `expected` equals `excel + gapCents / 100` per figure (integer cents), and `gapCents` is non-zero for at least one figure; `pending-excel` → `excel` is `null`. Test titles carry the label, the status and, for `known-gap` / `pending-excel`, the open-item ID (`known_divergence Q-B39-VAR1-CENT`, `PENDING Q-B38-PEND`, `PENDING Q-B39-PL-EXAMPLE`).
4. Structural checks: ids unique and matching `^UX-(\d{3}|P\d{2})$`; status in the three values; `gapCents` present iff `known-gap`; every `inferred[].field` names an `input` key (or `financedFees/cashFees`); every `decisions[]` entry starts with a `DEC-` / `Q-` ID found in `COB-user-stories.md` or 008.
5. `engineWhenRecorded` is information, **not** a pin. Full-precision pins live in QA's generated vectors (below).
6. A failing registry test is never fixed by editing `expected`: a figure change needs a decision, recorded in 008 / CHANGES (registry `howToAdd` rule 7).

## Invariants

Values come from the architect's prototype (scratch copy of `COB-ts/src/ca`, 2026-10-13) and must be reproduced by QA's own oracle, not by `src/`. "Shipped" = `(true, true, true)`; "B38 state" = `(true, true, false)`.

- **INV-B39-PIN.** `MONTHLY_RATE_CONVERSION === true`; `calculateCobCanada(x)` JSON-equals `calculateCobCanadaWith(x, SHIPPED_SWITCHES, true, true, true)` for VAR-1 and T3. Source: the 5th parameter is `monthlyConversion: boolean = MONTHLY_RATE_CONVERSION`.
- **INV-B39-ACCEPT** (shipped; full precision; registry gives the 2-dp truth):

  | Vector | D | Y (YEARFRAC) | n | Calculated rate % | Rows | Total interest (raw) | Principal (raw) | Row 1 interest |
  |---|---|---|---|---|---|---|---|---|
  | VAR-1 | 1085 | 2.97056810403833 | 52.17857142857142 | 3.994876602469461 | 155 | 12463.91672273959 | 10035.883277260407 | 84.22883636407059 |
  | VAR-2 | 1798 | 4.923779096303058 | 26.083333333333332 | 3.796756654443251 | 129 | 57808.56142971458 | 53537.788570285404 | 208.22240457772344 |
  | T3 | 1826 | 5.0004564125969875 | 52.166666666666664 | 7.979547907300506 | 260 | 6376.325798799797 | 30000.00000000002 | 45.909727685838526 |

  B38 state (today): VAR-1 12,480.898934294939, rate 4; VAR-2 57,862.70692515041, rate 3.8; T3 6,397.62434132225, rate 8.
- **INV-B39-FIXED.** Fixed-rate mortgages are unchanged: for UX-001, UX-002, UX-P01 the shipped result JSON-equals the B38 state (60,137.63 / 74,326.10999999997 / 51,018.07999999999).
- **INV-B39-OFF.** `calculateCobCanadaWith(x, S, la, yf, false)` JSON-equals the pre-B39 engine for every x and every `(la, yf)`. Prototype: 768 / 768 identical (8 registry bases × 6 frequencies × 4 product/rate pairs × 4 `(la, yf)` states). Test: golden generators with `monthlyConversion: false` reproduce the pre-B39 group hashes captured in the red step (`b39_pre_golden_group_hashes.json`, B37 pattern).
- **INV-B39-GATE.** With `leapAware = false`, `monthlyConversion` true and false give JSON-equal results (both `yf`), on the same 768-case grid.
- **INV-B39-SCOPE.** Shipped vs `monthlyConversion = false` differ (JSON) **iff** `leapAware` ∧ basis MONTHLY ∧ P ∈ {7, 14} (prototype: exact on the 768 grid). In particular Monthly / Semi-monthly variable and personal-loan cases and every fixed-mortgage case are JSON-equal; T2 stays 58,219.00820034338, rate 3.8.
- **INV-B39-NOROUND.** In scope, every row's `periodInterest` `Object.is` `periodInterest(openingBalance, calculatedRateDecimal, priorDate, date)` (unrounded); `roundsPeriodInterestToCent` is false for the MONTHLY basis in all 8 switch states; VAR-1 row 1 = 84.22883636407059 (not 84.23). Source guard: `roundsPeriodInterestToCent`'s call to `leapPathApplies` has exactly six arguments.
- **INV-B39-RATE.** In scope, `calculatedRatePercent` `Object.is` `oracleMonthlyConvertedDecimal(pct, oracleN(...)) * 100`, with `oracleMonthlyConvertedDecimal(pct, n) = n * (Math.pow(1 + pct / 100 / 12, 12 / n) - 1)`; out of scope unchanged. `cobRatePercent` follows from the new totals (VAR-1 3.994876602469461, equal to the rate because there are no fees).
- **INV-B39-BELOW.** In scope with pct > 0: `calculatedRatePercent < contractRatePercent`, and, because equation 1 at m = 12 decreases as n grows and 365/P ≤ n ≤ 366/P · (1 + 1e-12), `rate(366/P) · (1 − 1e-12) ≤ calculatedRatePercent ≤ rate(365/P) · (1 + 1e-12)` with `rate(n) = oracleMonthlyConvertedDecimal(pct, n) * 100`, on the B37-T5 sweep.
- **INV-B39-N.** `conversionPaymentsPerYear(p, r, f, s, e, true, true, true)` `Object.is` the oracle's `D / P / YEARFRAC` for in-scope MONTHLY-basis cases (VAR-1 52.17857142857142, VAR-2 26.083333333333332, T3 52.166666666666664); with the 8th argument false (or omitted) it returns 52 / 26 for them (byte-identity with seven arguments).
- **INV-B39-LABEL.** `paymentsPerYearFor(VAR-1 input, 'weekly')` = 52.17857142857142, `'biweekly'` = `conversionPaymentsPerYear(…, 'biweekly', …, true, true, true)`, `'semiMonthly'` 24, `'monthly'` 12; for every sweep case and frequency `paymentsPerYearFor(x, f)` `Object.is` the n the engine used. `frequencyOptionText('weekly', 52.17857142857142)` = "Weekly (52/yr)". Source guard: `paymentsPerYearFor` passes `LEAP_AWARE_PAYMENTS_PER_YEAR, YEARFRAC_ROUNDED_INTEREST, MONTHLY_RATE_CONVERSION` (no literal).
- **INV-B39-TRIGGER.** `triggerRatePercent` is unchanged by B39: VAR-1 6.865909059486741, VAR-2 6.726719435770738 in both states; personal loans `null`.
- **INV-B39-STATES** (B39 with B37's Y, `(true, false, true)`): VAR-1 n 52.1909594095941, rate 3.9948762395765574, total 12,463.915519974867 (→ 12,463.92); VAR-2 n 26.085936878925192, rate 3.796756378779001, total 57,808.55682806941 (→ 57,808.56); T3 n 52.171428571428564, total 6,376.32521940656. Interest unrounded.
- **INV-B39-ACCEL.** Accelerated weekly / bi-weekly JSON-equal Weekly / Bi-weekly apart from nothing (same inputs → same result): T1 ≡ VAR-1.
- **INV-B39-PLVAR.** A personal loan with `rateType: 'variable'` JSON-equals the same loan with `'fixed'` (same basis, no trigger rate): T3 both 6,376.325798799797.
- **INV-B39-VRPC.** VAR-2 through `variableRatePaymentChange` gives the same totals as through `paymentChange` (57,808.56142971458).
- **INV-B39-ZERO.** In scope, contract rate 0 → `calculatedRatePercent` 0 and every `periodInterest` 0.

## Deviation DEV-B39-M12 (suggested ID; needs sign-off in CHANGES §77)

- **What.** For the MONTHLY rate basis at 7- and 14-day frequencies, the Calculated rate is the contract rate converted at m = 12 with the leap-aware n, instead of the contract rate as entered.
- **Departs from:** the workbook (`Calculator!D10`, MONTHLY → `MonthlyRate`); BRD §4.2 variable bullet ("no conversion … (m = n)"), BR-02 ("which equals the contract rate"), B.1 ("for MONTHLY rate type = contract rate"), OUT-01; OQ-C (2026-09-27, CHANGES §12) and DEC-B33-FREQ point (4) for these cases.
- **Follows:** BRD §4.2 personal-loan bullet (m = 12) and IN-04, for personal loans; for variable mortgages, only the user's Excel.
- **Resolves (COB-ts only):** 008 F-ii #4 (G-06) and §E #5 (DQ-30) as option (b) at the four 7/14-day frequencies; Semi-monthly stays (a). Open for `app/`, COB-py, COB-xlsx.
- **Authority.** User decision DEC-B39-VAR-PL-M12, matching VAR-2 to the cent and VAR-1 to 1 cent.
- **Containment.** Predicate M; switch `MONTHLY_RATE_CONVERSION` (false restores B38 byte for byte); no rounding added (F4 untouched).

## Acceptance criteria

1. Shipped COB-ts reproduces every registry entry per the consumption rule: UX-001, UX-002, UX-004 to the cent; UX-003 at Excel + (+1, −1) cents, labelled `known_divergence Q-B39-VAR1-CENT`; UX-P01…P04 at their predictions, labelled PENDING.
2. Every invariant above passes against QA's independent oracle.
3. `MONTHLY_RATE_CONVERSION = false` reproduces the pre-B39 engine byte for byte (INV-B39-OFF), and the workbook-parity tests (T5 L3/L4/L7/N2, B33-T6) stay green pinned to that state.
4. The page, in Chrome: Payment change, Variable, Bi-weekly, VAR-2 inputs → Total interest **$57,808.56**, Total principal paid **$53,537.79**; the Weekly option still reads "(52/yr)".
5. `npm run typecheck && npm test && npm run build`, `typecheck:tests`, `test:tz` (both zones) green; F7 green (the BA has registered DEC-B39-VAR-PL-M12).

## Implementation and test plan

Order mirrors B37/B38: QA red step, sr-dev green step, QA verify, doc-writer. New files are listed explicitly.

### 1. QA red step (tests first; `src/` untouched)

**New files:** `tests/ca/b39-monthly-conversion.test.ts`; `tests/ca/fixtures/ca_user_excel_examples.json` (byte copy); `tests/ca/fixtures/b39_pre_golden_group_hashes.json` (captured before `src/` changes); `tests/ca/fixtures/b39_capture_undo.json` (if the capture-undo pattern is kept, as in B38).

**Helpers (extended):**
- `support/switches.ts`: `calculateWith(input, switches, leapAware?, yearFracRounded?, monthlyConversion?)` (5th passed only when given); `B39_ON = true`, `B39_OFF = false`.
- `support/leapNOracle.ts` (no `src/` import): `oracleN(…, yearFrac = false, monthlyConversion = false)` widening step 4 as E-B39-2; `oracleMonthlyConvertedDecimal`; `oracleSchedule(c, leapAware, yearFracRounded = false, monthlyConversion = false)` using it for the MONTHLY basis and never rounding it.
- `support/fixtures.ts`: `SHARED_FIXTURES_DIR`, `readSharedFixtureText` (registry rule 1).
- `fixtures/generate_b37_leap_n_vectors.ts`: a top-level `"b39"` key (`nVectors`, `cases` for VAR-1, VAR-2, T1, T3, T3-variable, VAR-2-VRPC, plus the `(true, false, true)` twins). Existing subtrees byte-identical after re-parse (QA proves by deep-compare, as for B38).

**`tests/ca/b39-monthly-conversion.test.ts`:** B39-T1 INV-B39-PIN; T2 the registry (consumption rules 1-6); T3 INV-B39-ACCEPT / -FIXED / -STATES against the oracle; T4 the 4,800-input B37-T5 sweep: -SCOPE, -NOROUND, -RATE, -BELOW, -N, -GATE, oracle row by row; T5 -LABEL (+ source guards); T6 -TRIGGER, -ACCEL, -PLVAR, -VRPC, -ZERO; T7 -OFF (golden hashes); T8 structural (barrels unchanged; `convertsMonthlyRate` not exported from either barrel). Add the file to `test:tz`; re-pin the Help `package.json` baseline if that changes it (B37 pattern).

**Existing tests that encode the pre-B39 rule** (prototype-measured, see Impact): pin them to the B39-off state with the 5th argument `B39_OFF` and add " — B39 off (MONTHLY_RATE_CONVERSION false)" to the title. Their values don't change; this is INV-B39-OFF evidence. Applies to: `rateSelection-oqc` (4), `b27-personal-loan-monthly-only` B27-T2 (25), `b33-personal-loan-frequencies` T4 and T6 (5), `engineRules-t5` L3/L4/L7/N2 (5, workbook-oracle parity, tag `known_divergence DEV-B39-M12` on the shipped twin if one is kept), `b19-unpaid-interest` V5 (2), `b26-unpaid-interest-figure` (1), `cobCanada.test` leap-straddle (1), `loopEquations-a5` overflowToInfinityShipped (1; or re-pin its sha with a B39 comment).

**Changed value / structure** (red until `src/` lands):
- `b37-leap-aware-n.test.ts` (19): B37-T3 C-VAR / C-VRPC / C-PL pin `B39_OFF`; INV-SCOPE (B37-T5), INV-CONST (B37-T6), the oracle tests and B38-T5 SCOPE / ROW / oracle: pass `B39_OFF` or widen to predicate M; T1 / B38-T1 source regexes allow the 5th defaulted parameter; INV-LABEL-N / -SHARED / -TOTAL and B38-T9 compare against the oracle with `monthlyConversion = true`; the label source guard becomes `/conversionPaymentsPerYear\([\s\S]*LEAP_AWARE_PAYMENTS_PER_YEAR,\s*YEARFRAC_ROUNDED_INTEREST,\s*MONTHLY_RATE_CONVERSION,?\s*\)/`.
- `policies-a7.test.ts` (3): nine exports; last is `MONTHLY_RATE_CONVERSION`; `cobCanada.ts` imports it. `b27` T6 export-name list likewise.
- `b37-frequency-labels.test.ts`: variable / personal-loan rows compare against the B39 oracle n (texts unchanged).
- Goldens (`engineGolden` 56, `engineGoldenPc` 51) and F6 (2): red until regenerated; generators accept `{ leapAware, yearFracRounded, monthlyConversion }`.
- `a10-ca-view.test.ts` C16-C19 (VRPC_zero_accrued, PL_WEEKLY): capture regeneration / undo patch (B38 pattern).
- `equations.test.ts`: `calculatedRateFor` 5th parameter defaults to false (byte-identity with four arguments); `convertsMonthlyRate` table (8 switch states × 6 frequencies × 3 bases).

### 2. sr-dev green step

`src/ca/policies.ts`, `equations.ts`, `cobCanada.ts`, `types.ts` (comments) as in **Data shapes**. Nothing else in `src/`; no barrel or UI change (the label already goes through `paymentsPerYearFor`, `ui/ca.js` l.489-491).

### 3. QA verify

Full `npx vitest run`, `typecheck`, `typecheck:tests`, `build`, `test:tz` both zones. Mutants (each must turn a test red): M1 m = 2 instead of 12 for MONTHLY; M2 `100 * n * (…)` operand order; M3 row rounding in scope; M4 n = 52 / 26 for MONTHLY; M5 Y = `dayCountFraction` in the shipped state; M6 Semi-monthly converted; M7 fixed mortgage at m = 12; M8 ungated (B39 active with `leapAware` false); M9 label passes `false` as 8th argument; M10 trigger rate on the leap-aware n; M11 rate truncated to 6 dp (the Appendix R alternative: VAR-2 57,808.55). Chrome smoke: new step (j) VAR-2 through the UI (acceptance 4); steps (h)/(i) unchanged. Rebuild `COB.html`; `check_share_page.mjs`.

### 4. Doc-writer, then the Help rebuild

User manual / domain overview: "a variable-rate mortgage or personal loan paid weekly or bi-weekly uses the contract rate converted from monthly compounding"; Help rebuild and pins (B37 pattern).

### 5. CHANGES.md §77 (sr-dev writes, QA completes)

Title: "B39: monthly-compounded rate conversion for variable-rate mortgages and personal loans at Weekly and Bi-weekly (2026-10-13, user decision DEC-B39-VAR-PL-M12; deviation DEV-B39-M12)". Why / What / Tests / Evidence / "Tests pass ≠ matches Excel": only UX-001, -002, -004 are Excel matches; UX-003 is a 1-cent known gap; UX-P01…P04 are predictions.

### Impact estimate

Measured on the prototype (scratch copy of COB-ts, `tests/ca` + `tests/architecture`, 3,573 tests; baseline 2 red, both F7 artefacts of the scratch copy lacking `COB-user-stories.md`): **181 red, 179 attributable to B39**: 107 golden (56 + 51), 2 F6, 4 A10, 25 B27-T2, 19 in the B37/B38 file, 5 T5, 5 B33, 4 OQ-C, 3 policies, 2 B19, 1 each A5, cobCanada, B26. All but the structural / label edits (~25) go green by B39_OFF pinning or regeneration, with unchanged values.

## Open questions

- **Q-B39-VAR1-CENT (user).** VAR-1: B39 gives 12,463.92 / 10,035.88, Excel 12,463.91 / 10,035.89. Accept the 1-cent gap? Pinned as `known-gap` (+1 / −1) until answered. The raw total 12,463.9167 is 0.0017 above the half-cent.
- **Q-B39-VAR2-FREQ (user).** VAR-2's frequency was not stated; Bi-weekly inferred (129 × 863.15 = 111,346.35 = Excel interest + principal; only a 14-day schedule has 129 rows). Confirm.
- **Q-B39-PL-EXAMPLE (user).** No Excel example yet for a personal loan or an Accelerated frequency; T1 and T3 (registry UX-P02, UX-P04) are the requested ones.
- **Q-B39-UNIFIED (user; decisive data point).** The leading alternative — one rule for every product: rate truncated to 6 dp, YEARFRAC n, rows at full precision, no B38 rounding — also scores 3/4 (fails VAR-2 by −0.01 instead of VAR-1 by +0.01). Please send the **Calculated rate cell at full precision** (format with 15 decimals) from your Excel for **VAR-2** and **FIX-1**: B39 predicts 3.796756654443251 % and 4.297116290973523 %; the alternative predicts 3.796756 % and 4.297116 %. UX-P01 (CHECK) also discriminates: B38/B39 51,018.08, the alternative 51,018.04.
- **Q-B39-ENGINES (user).** COB-ts only (recommended, like B37/B38), or COB-py / COB-xlsx / `app/engine` too? (`app/engine` is BRD-governed; DQ-30 default "unchanged".)
- **Q-B39-SWITCH (answered here, architect, for sign-off).** Gated on `LEAP_AWARE_PAYMENTS_PER_YEAR`; Y follows `YEARFRAC_ROUNDED_INTEREST`.
- **Q-B39-TRIGGER (user; default kept).** Trigger rate stays on 52 / 26 and the payment/principal formula of §4.3 (INV-B39-TRIGGER).
- **Q-B39-SM (information).** Does your Excel also convert variable / personal-loan rates at Semi-monthly? T2 (UX-P03) answers it: B39 predicts no change (58,219.01).

## Checks run for this brief

- Prototype: scratch copy of `COB-ts/src/ca` with E-B39-1…3, bundled with esbuild, run on every registry entry (table above). FIX-1 / FIX-2 / CHECK unchanged at 60,137.63 / 74,326.11 / 51,018.08; VAR-2 57,808.5614 → 57,808.56 ✓; VAR-1 12,463.9167 → 12,463.92 (+0.01); T2 58,219.01 (unchanged); T3 6,376.33 (today 6,397.62); today's values VAR-1 12,480.90, VAR-2 57,862.71 reproduced.
- Off state: 768 / 768 inputs JSON-identical to the current repo engine; scope exact on the same grid; no rounding in scope.
- Appendix R rows recomputed on the prototype (the m = 2, split-vs-YEARFRAC and truncated-rows rows are the main session's measurements, not recomputed here): m = 12 with n = 52 / 26 → VAR-1 12,463.93 (+0.02), VAR-2 57,808.71 (+0.15); rows rounded everywhere → VAR-1 12,463.97 (+0.06), VAR-2 57,808.53 (−0.03); 6-dp truncated rate, YEARFRAC n, full precision → FIX-1 60,137.6266 ✓, FIX-2 74,326.1069 ✓, VAR-1 12,463.9147 ✓, VAR-2 57,808.5505 (−0.01).
- Prototype test run: 179 attributable red (Impact).
- **"Tests pass" ≠ "matches Excel".** Excel truths: UX-001, -002, -003, -004 (user-supplied totals only; no row-level or rate-cell Excel figures exist). Nothing here was checked against the reference workbook, which B39 deliberately departs from.

## Appendix R — research record (candidate rules against the four Excel totals)

Kept so that every future example can re-score the rules. Signed differences are engine − Excel on total interest (2 dp); ✓ = cent match. Inputs: registry UX-001…004. "Rows" = per-row period interest.

| Candidate | FIX-1 | FIX-2 | VAR-1 | VAR-2 | Score |
|---|---|---|---|---|---|
| Variable at m = 2 (like fixed) | — | — | −108.81 | −495.20 | rejected |
| Variable m = 12, n fixed 52 / 26 (B38 fixed) | ✓ | ✓ | +0.02 | +0.15 | 2/4 |
| n split at Jan 1 (B37 Y) vs YEARFRAC Y, rows full precision | each 2/4 across the four | | | | 2/4 |
| Rows rounded to the cent everywhere, YEARFRAC n (B38 extended to variable) | ✓ | ✓ | +0.06 | −0.03 | 2/4 |
| Rows truncated to the cent | −0.35 … −0.85 on all | | | | 0/4 |
| **Unified:** rate truncated to 6 dp, YEARFRAC n, rows full precision, all products | ✓ (60,137.6266) | ✓ (74,326.1069) | ✓ (12,463.9147) | −0.01 (57,808.5505) | 3/4 — leading alternative, not chosen |
| **Chosen: B39 + B38** (fixed: m = 2, rows rounded; MONTHLY: m = 12, rows full precision) | ✓ | ✓ | +0.01 (12,463.9167) | ✓ (57,808.5614) | 3/4 |

Several raw totals sit within $0.002 of a half-cent (VAR-1 .9167 / .9147, FIX-2 .1069, VAR-2 .5505 / .5614), so totals alone cannot discriminate the two 3/4 rules. The decisive next data point is the full-precision Calculated-rate cell (Q-B39-UNIFIED), then UX-P01 (51,018.08 vs 51,018.04). If the user's Excel shows a 6-dp rate, the rule choice (B38 and B39) reopens as a new decision; it is not re-pinned silently.

## Sources

- User decision DEC-B39-VAR-PL-M12 (2026-10-13), `COB-user-stories.md` §7.5, US-08 (B39 criteria); 008 F-ii #4 (G-06), §E #5 (DQ-30), §I.
- BRD `docs/COB-business-requirement.md` §4.2 (l.~180-190), §4.3, BR-02 (l.212), B.1 (l.274-280), IN-04, OUT-01.
- Workbook `Calculator!D10` (as quoted in 008 F-ii #4 and `equations.ts` `selectRateBasis`).
- Code read: `COB-ts/src/ca/equations.ts` (`calculatedRate`, `selectRateBasis`, `calculatedRateFor`, `leapAwarePaymentsPerYear`, `conversionPaymentsPerYear`, `leapPathApplies`, `roundsPeriodInterestToCent`), `cobCanada.ts` (l.219-300, 424-435), `policies.ts`, `ui/ca-view.js` `frequencyOptionText`.
- Spec 013 (B38) for structure, Y and V-PEND; `COB-ts/CHANGES.md` §75-76.
