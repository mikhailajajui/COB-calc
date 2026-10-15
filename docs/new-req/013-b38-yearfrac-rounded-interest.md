# 013 — B38: Excel YEARFRAC in the leap-aware n, and per-period interest rounded to the cent (COB-ts)

## Status

**Draft brief, ready to build (2026-10-10).** Decision `DEC-B38-YEARFRAC-ROUND` (user, 2026-10-10).
Deviation `DEV-B38-ROUND` (below), which needs the user's sign-off in the change log. Target: **COB-ts only**.

| Item | State |
|---|---|
| Rule 1: Y in n = (D ÷ P) ÷ Y becomes Excel `YEARFRAC(start, end, 1)` | Specified (E-B38-1, E-B38-2). The algorithm for spans of a year or less is a black-box reconstruction of Excel (background research); see Q-B38-YF |
| Rule 2: each row's period interest rounded to the cent before the waterfall | Specified (E-B38-3, E-B38-4) |
| Switch | One switch, `YEARFRAC_ROUNDED_INTEREST`, shipped `true` (ADR-14 / M2) |
| Acceptance | Case 1 and example 2 reproduced to the cent by the architect's prototype; the pending vector reproduces the user's prediction |
| Not yet done (the caller limited this run to this one file) | `docs/architecture.md` traceability row, the open-items log entry for Q-B38-YF / Q-B38-ROUND / Q-B38-PEND, the `docs/new-req/README.md` row (the BA is editing it), `COB-user-stories.md` §7.x entry with the ID (the BA is adding it; F7 needs it) |

Source ranking for this item: the reference workbook (`Cost of Borrowing Rate Calc_Current.xlsm`) uses n = 52 / 26 and never rounds. B37 already departed from it (DEV-B37-LEAPN). B38 follows the **user's own Excel** (a different spreadsheet that the user checks figures against), by explicit user decision. B38 therefore extends a deviation from the workbook and has nothing to gain from re-reading the macro. With the switch off, the engine is byte-for-byte today's B37 engine. With both switches off, it is the workbook converter.

## Problem

After B37, the engine reproduces the user's Excel example 2 to the cent (74,326.11) but misses case 1 by one cent (60,137.62 against Excel's 60,137.63; CHANGES §75 records that the user accepted the gap). The main session's scratch experiment (`scratchpad/ts/COB-ts/src/ca/equations.ts`, an env-var hack, used here only for its arithmetic) showed that the user's Excel does two things the engine doesn't:

1. Y in n is Excel's `YEARFRAC(start, end, 1)` (actual/actual, one average year length for the whole span), not the B37 per-calendar-year split (`dayCountFraction`).
2. Each period's interest is rounded to the cent (Excel `ROUND(…, 2)`), and the balance, the unpaid-interest bucket and the totals are built from the rounded figure.

Neither change alone reproduces both cases. Example 2 with YEARFRAC alone gives 74,326.12, and with rounding alone 74,326.09. Only both together give 74,326.11, and they also give case 1's 60,137.63.

## Scope

**In scope: exactly the B37 cases.** Fixed-rate mortgage (SEMI-ANNUAL basis); Weekly, Accelerated weekly, Bi-weekly, Accelerated bi-weekly (P = 7 or 14); all four flows; and only when `LEAP_AWARE_PAYMENTS_PER_YEAR` is `true`. Formally, every case where `conversionPaymentsPerYear` takes its step 6 today (the "leap path", predicate S below).

**Out of scope, unchanged byte for byte:**
- Monthly and Semi-monthly; variable-rate mortgages; personal loans. Interest stays unrounded, keeping legacy parity.
- The period day-count rule (BR-11, BRD Appendix B.3): `periodInterest = opening × r × dayCountFraction(prior, date)`, with leap days over 366. Only its result is rounded, and only in scope.
- The COB-rate T (plain days ÷ 365, equation 7); the trigger rate (`PAYMENTS_PER_YEAR`); the accrued-interest rules (B19, IN-11 all due from payment 1); fees; validation; the schedule dates and stop rule.
- The IN-11 accrued interest input, fees and payment amount, which are never rounded by the engine.
- COB-py, COB-xlsx and `app/engine`, which have no B37. Their divergence from COB-ts on fixed weekly / bi-weekly cases is already recorded by B37 and simply grows.
- No public type changes. `CobScheduleRow.periodInterest` keeps its type and in scope holds the rounded figure (doc comment only). No new barrel export. `paymentsPerYearFor(input, frequency)` keeps its signature.

## Data shapes

### Switch (policies.ts, ADR-14 / mechanism M2)

```ts
/**
 * @decision DEC-B38-YEARFRAC-ROUND — Excel YEARFRAC (basis 1) for Y in the leap-aware n, and period interest rounded
 * to the cent before the payment waterfall, for the B37 cases only (fixed-rate mortgage, SEMI-ANNUAL basis, 7- and
 * 14-day frequencies, all flows). Effective only while LEAP_AWARE_PAYMENTS_PER_YEAR is true.
 * Switch (ADR-14): shipped `true`; the other branch `false` is built and tested.
 * `true`: Y = YEARFRAC(start, end, 1) (excelYearFracBasis1); every schedule row's period interest is
 * roundToCentHalfAwayFromZero(periodInterest(...)) (DEV-B38-ROUND).
 * `false`: today's B37 rule (Y = dayCountFraction, period interest unrounded), byte for byte.
 */
export const YEARFRAC_ROUNDED_INTEREST = true;
```

**One switch, not two (decision, architect).**
- The user asked for "a switch".
- The two halves reproduce the user's Excel only together. Example 2 proves each half alone is wrong: 74,326.12 and 74,326.09 against 74,326.11.
- Two switches would add two states with no business meaning, and ADR-14 would require building and testing each.

The switch **refines** B37 and is dependent on it. There are three meaningful engine states:

| `LEAP_AWARE_PAYMENTS_PER_YEAR` | `YEARFRAC_ROUNDED_INTEREST` | State |
|---|---|---|
| `false` | any | Workbook converter n = 52 / 26, no rounding (pre-B37, byte for byte) |
| `true` | `false` | B37 (today, byte for byte) |
| `true` | `true` | **B38 (shipped)** |

### Threading (cobCanada.ts)

```ts
export function calculateCobCanadaWith(
  input: CobCanadaInput,
  switches: EngineSwitches,
  leapAware: boolean = LEAP_AWARE_PAYMENTS_PER_YEAR,
  yearFracRounded: boolean = YEARFRAC_ROUNDED_INTEREST,
): CobCanadaResult
```

- `calculateCobCanada(input)` stays `return calculateCobCanadaWith(input, SHIPPED_SWITCHES);`.
- `EngineSwitches` / `SHIPPED_SWITCHES` are unchanged. The fourth parameter follows the B37 precedent of a defaulted positional parameter.
- `calculateCobCanadaWith` passes `yearFracRounded` as the new 7th argument to its one `conversionPaymentsPerYear(` call. It computes `roundPeriodInterest = roundsPeriodInterestToCent(productType, rateType, paymentFrequency, startDate, endDate, leapAware, yearFracRounded)` and passes it to `buildSchedule` through a new `BuildScheduleArgs.roundPeriodInterest: boolean`.
- `paymentsPerYearFor(input, frequency)` passes `LEAP_AWARE_PAYMENTS_PER_YEAR, YEARFRAC_ROUNDED_INTEREST` as the 6th and 7th arguments of its `conversionPaymentsPerYear(` call, and never a literal. The dropdown label and the calculation therefore read the same n.
- `cobCanada.ts` still calls `conversionPaymentsPerYear(` exactly twice. It never calls `leapAwarePaymentsPerYear(`, `paymentPeriodDays(` or `excelYearFracBasis1(`.

### New and changed functions in `src/ca` (none on either barrel)

| File | Function | Change |
|---|---|---|
| `calendar.ts` | `excelYearFracBasis1(start: Date, end: Date): number` | **New** (E-B38-1) |
| `equations.ts` | `leapAwarePaymentsPerYear(periodDays, start, end, yearFrac: boolean = false)` | 4th defaulted parameter: Y = `yearFrac ? excelYearFracBasis1 : dayCountFraction` |
| `equations.ts` | `conversionPaymentsPerYear(p, r, f, start, end, leapAware, yearFracRounded: boolean = false)` | 7th defaulted parameter, forwarded to `leapAwarePaymentsPerYear` at step 6 |
| `equations.ts` | `roundsPeriodInterestToCent(p, r, f, start, end, leapAware, yearFracRounded): boolean` | **New**: predicate S (E-B38-4) |
| `equations.ts` | `roundToCentHalfAwayFromZero(x: number): number` | **New** (E-B38-3) |
| `equations.ts` | `periodInterest` | **Unchanged.** The rounding wraps the call in `buildSchedule` and is not folded in |
| `cobCanada.ts` | `buildSchedule`, `calculateCobCanadaWith`, `paymentsPerYearFor` | As above |
| `types.ts` | `CobScheduleRow.periodInterest` doc comment | "rounded to the cent in the B38 cases (DEC-B38-YEARFRAC-ROUND)" |

`conversionPaymentsPerYear` and `roundsPeriodInterestToCent` share one private predicate (`leapPathApplies(p, r, f, start, end, leapAware)`, steps 2 to 5 of the existing chooser), so the rounding scope can never drift from the n scope.

## Equations

Notation: dates are UTC calendar days. `leap(y)` is the Gregorian 4/100/400 rule (`isLeapYear`). `daysInYear(y)` is 366 if `leap(y)`, else 365. `daysBetween` is the existing whole-day count.

### E-B38-1 — `excelYearFracBasis1(start, end)` (Excel `YEARFRAC(start, end, 1)`)

Guards, in this order:
1. Either date is invalid: `RangeError`.
2. `start > end`: `RangeError`.
3. `days = daysBetween(start, end)`. If `days === 0`, return `0`.

Let `(y1, m1, d1)` and `(y2, m2, d2)` be the UTC year, month and day of start and end.

```
withinAYear := (y1 = y2) OR (y2 = y1 + 1 AND (m1 > m2 OR (m1 = m2 AND d1 >= d2)))

if withinAYear:
    if y1 = y2:  L := daysInYear(y1)                                  # same year: that year's length, always
    else:        L := 366 if (leap(y1) AND start < Mar 1 of y1)
                           OR (leap(y2) AND end >= Feb 29 of y2)       # a Feb 29 lies in [start, end]
                      else 365
else:
    L := (sum of daysInYear(y) for y = y1 .. y2) / (y2 - y1 + 1)      # integer sum, then ONE division

return days / L
```

- **Multi-year branch.** This is the rule the user gave. It is also Microsoft's documented "average length of the years the range crosses".
- **Within-a-year branch.** This is D. A. Wheeler's reconstruction, which matched Excel 2007 on all 66,564 basis-1 test cases outside 1900 (background research, see Sources; it does not override any project source). Microsoft's own wording is wrong here in two places:
  - Same-year spans always use that year's length, even without a Feb 29: `(2000-01-01, 2000-01-02)` gives 1/366, not 1/365.
  - Exactly one year starting in a leap year before March gives 366/366: `(2000-01-01, 2001-01-01)` gives 1.
- **The "≤ 1 year" test uses calendar fields, not day counts.** For example, `(2028-02-29, 2029-03-01)` is **not** within a year (m1 = Feb < m2 = Mar), so it goes to the multi-year branch: 366 / 365.5.
- **Excel's 1900 leap-year bug is not reproduced.** Dates before 1900-03-01 can't reach a mortgage calculation.
- **No snapping or reordering.** `L` for the multi-year branch is computed as `total / count`. The function returns `days / L`.

Checks (prototype `scratchpad/b38`, all `Object.is` to the right-hand side, or 1e-9 for Wheeler's 10-digit figure):

| start → end | Branch | Expected |
|---|---|---|
| 2026-10-08 → 2029-09-23 | multi (4 years, one leap) | 1081 / 365.25 = 2.9596167008898013 |
| 2026-10-08 → 2031-03-27 | multi (6 years, one leap) | 1631 / (2191/6) = 4.466453674121405 |
| 2000-01-01 → 2004-01-31 | multi (two leaps) | 4.080459770114943 (Wheeler: 4.080459770) |
| 2000-01-01 → 2000-01-02 | same year, leap | 1/366 |
| 2028-01-10 → 2028-12-18 | same year, leap | 343/366 (= today's `dayCountFraction`) |
| 2100-01-04 → 2100-12-27 | same year, 2100 not leap | 357/365 |
| 2027-06-01 → 2028-03-15 | cross, Feb 29 2028 inside | 288/366 |
| 2027-06-01 → 2028-02-28 | cross, no Feb 29 | 272/365 |
| 2027-06-01 → 2028-02-29 | cross, end = Feb 29 | 273/366 |
| 2028-03-01 → 2029-02-28 | cross, start after Feb 29 | 364/365 |
| 2028-02-29 → 2029-02-28 | cross, start = Feb 29 | 365/366 |
| 2027-12-31 → 2028-01-01 | cross, Feb 29 2028 not reached | 1/365 |
| 2028-12-31 → 2029-01-01 | cross, Feb 29 2028 behind start | 1/365 |
| 2000-01-01 → 2001-01-01 | exactly one year | 1 (366/366) |
| 2027-12-15 → 2028-12-15 | exactly one year | 1 (366/366) |
| 2028-02-29 → 2029-03-01 | multi (not "within a year") | 366/365.5 = 1.0013679890560876 |

### E-B38-2 — n for equation 1 (B38 state)

For the B37 cases with both switches on:

```
n = D / P / Y,   D = daysBetween(start, end),  P = 7 or 14,  Y = excelYearFracBasis1(start, end)
```

`start` is the flow's start date (Disbursal date, Renewal date or Date of change) and `end` is the End date, as in B37. The expression is evaluated **left to right**: `D / P` first, then divided by `Y`, where `Y` is itself `days / L`.

The algebraically equal `L / P` is **not allowed**. It differs in the last bit on 37,908 of 86,258 sampled spans (prototype sweep 2025 to 2031), and the acceptance figures were produced with the left-to-right order.

Consequences:
- n = L / P up to rounding, so 365/P ≤ n ≤ 366/P. The B37 bound INV-BOUNDS holds unchanged.
- n is never exactly 52 or 26, because 365/7 > 52 and 365/14 > 26.
- The labels still round to 52 and 26.

Checks:

| Case | n |
|---|---|
| V-CASE1 | 26.089285714285715 (B37: 26.095568783068778) |
| V-EX2 | 26.083333333333336 |
| V-PEND | 26.085714285714285 |

### E-B38-3 — `roundToCentHalfAwayFromZero(x)` (Excel `ROUND(x, 2)`)

**Semantics (normative, implementation-independent):**
1. Let `D15(x)` be the 15-significant-digit decimal nearest to |x|. When two such decimals are equally near, take the larger one. This is exactly ECMAScript's `Number.prototype.toExponential(14)` rule.
2. Round `D15(x) × 100` to an integer, half away from zero, in exact decimal arithmetic.
3. Restore the sign. The result is that integer ÷ 100, the double nearest to the decimal cent value.
4. Edge values: `0` maps to `0` (never `-0`), and any result of 0 cents is `0`. A non-finite x gives `RangeError`.

**Why 15 digits and not an epsilon.**
- Excel stores IEEE doubles and works to 15 significant digits. Excel's `ROUND(1.005, 2)` is commonly reported as 1.01, although the double nearest 1.005 lies just *below* 1.005, so `Math.round(x * 100) / 100` gives 1.00.
- Rounding the 15-digit decimal reproduces that behaviour with no tunable constant.
- An epsilon (`x + ε`) is scale-dependent: a fixed ε is too big for small amounts and too small for large ones. It would be a second, arbitrary decision.
- `toFixed(2)` rounds the exact binary value, which gives the same wrong 1.00.
- **Exactness range.** The result is exact half-away-from-zero cent rounding of the 15-digit decimal for |x| < 1e12. That is 12 integer digits, 2 cent digits and 1 deciding digit.
- **Above 1e12.** The cent decision is made by `toExponential`'s own round-half-up on the binary value. This is deterministic and pinned (INV-B38-ROUND-RANGE), but unreachable: one period's interest would need a balance far above any loan.
- **Corpus impact of the method choice.** Across all 65,425 rounded rows of both regenerated goldens, this method and naive `Math.round(x * 100) / 100` agree on every row. No row is within 1e-6 cent of a tie. The method only governs genuine near-ties.

**Reference implementation (normative for COB-ts).** The `toExponential` line carries the new F4 marker:

```ts
export function roundToCentHalfAwayFromZero(x: number): number {
  if (!Number.isFinite(x)) {
    throw new RangeError(`x must be a finite number, got ${x}`);
  }
  if (x === 0) return 0;
  const sign = x < 0 ? -1 : 1;
  const [mantissa, exponentText] = Math.abs(x).toExponential(14).split('e') as [string, string]; // fitness:cent-round
  const digits = mantissa.replace('.', ''); // 15 significant digits
  const shift = Number(exponentText) - 12; // cents = digits x 10^shift
  if (shift >= 0) return (sign * Number(digits + '0'.repeat(shift))) / 100;
  const keep = 15 + shift; // leading digits that are whole cents
  if (keep < 0) return 0;
  const wholeCents = keep === 0 ? 0 : Number(digits.slice(0, keep));
  const cents = wholeCents + (Number(digits.charAt(keep)) >= 5 ? 1 : 0);
  return cents === 0 ? 0 : (sign * cents) / 100;
}
```

Checks (prototype):

| x | Result | Note |
|---|---|---|
| 1.005 | 1.01 | `Math.round` approach gives 1 |
| -1.005 | -1.01 | |
| 2.675 | 2.68 | |
| 0.005 | 0.01 | |
| 0.0049999999 | 0 | |
| 0.0025 | 0 | |
| 0.0001 | 0 | |
| 1e-9 | 0 | |
| 0.015 | 0.02 | |
| 1.115 | 1.12 | |
| 10.235 | 10.24 | |
| 1234.565 | 1234.57 | |
| 1234.5649999999 | 1234.56 | |
| 123456789.125 | 123456789.13 | |
| 758.3018733743622 | 758.3 | V-CASE1 row 1 |
| 0 | 0 | |

### E-B38-4 — schedule row (B38 state)

Predicate S, in this order:
- `S := leapAware AND yearFracRounded AND paymentPeriodDays(f) ≠ null AND selectRateBasis(p, r) = 'SEMI-ANNUAL' AND start, end valid AND daysBetween(start, end) > 0`.
- This is the leap path of `conversionPaymentsPerYear` plus `yearFracRounded`.

For row k (prior date t₀ = the flow's start date, then the previous row date):

```
raw_k = periodInterest(opening_k, r, t_{k-1}, t_k)          # unchanged equation 3 (BR-11, B.3)
I_k   = S ? roundToCentHalfAwayFromZero(raw_k) : raw_k       # the row's periodInterest
```

`I_k` replaces `periodInterestAmount` everywhere downstream:
- it is the row's `periodInterest` field;
- it is the first argument of `applyPaymentWaterfall`;
- through the waterfall it drives `interestPaid`, `principalPortion`, `carriedAccruedInterestClosing`, `closingBalance` and the B19 bucket / `priorAccruedOwed`;
- it drives `unpaidPeriodInterestAtEnd`, `totalInterest`, `principalPayment`, `endingBalance`, `cobAmount` and the eq. 7 general-branch COB rate (through the balances).

Both `unpaidInterestCapitalised` branches use the same `I_k`.

Nothing else is rounded:
- balances, buckets and totals are float sums of cent-valued terms and are not re-rounded, for example `totalInterest` 51018.07999999999;
- display rounding (2 dp) is unchanged.

`r` is equation 1 at the E-B38-2 n.

## Invariants

Each is a named, testable rule with concrete inputs. Values come from the architect's prototype and must be reproduced by QA's own oracle (not by `src/`). "B37 state" means `(leapAware true, yearFracRounded false)`.

- **INV-B38-PIN.**
  - `YEARFRAC_ROUNDED_INTEREST === true`.
  - `calculateCobCanada(x)` JSON-equals `calculateCobCanadaWith(x, SHIPPED_SWITCHES, true, true)` for V-CASE1.
  - Source: the 4th parameter is `yearFracRounded: boolean = YEARFRAC_ROUNDED_INTEREST`, and `calculateCobCanada` passes two arguments.
- **INV-B38-ACCEPT** (Payment change, fixed mortgage, Bi-weekly, no fees, shipped). Inputs are loan, rate, payment, accrued, Date of change, next payment, End:

  | Vector | Inputs | Shipped total interest / principal (2 dp) | B37 state |
  |---|---|---|---|
  | V-CASE1 | 495,466.87; 4.34 %; 1,350.64; 58.33; 2026-10-08; 2026-10-21; 2029-09-23 | **60,137.63 / 43,861.65** (Excel), 77 rows, rate 4.297116290973523 % | 60,137.62 / 43,861.66 |
  | V-EX2 | 413,337.42; 4.30 %; 1,050; 530.49; 2026-10-08; 2026-10-08; 2031-03-27 | **74,326.11 / 48,523.89** (Excel), 117 rows, rate 4.257898619563019 % | unchanged at 2 dp |

  YEARFRAC only, rounding off (mutant M15): 74,326.12. Rounding only, B37 Y (mutant M5c): 74,326.09.
- **INV-B38-PENDING** (prediction, **not** Excel truth). V-PEND: 300,000; 5 %; 900; 0; 2026-11-02; 2026-11-16; 2030-06-28.
  - Shipped: 51,018.08 / 34,481.92, 95 rows, rate 4.943200251390675 %, row 1 interest 568.81. B37 state: 51,018.03 / 34,481.97.
  - Test it as a `known_divergence`-style pin labelled `PENDING Q-B38-PEND (user prediction, unconfirmed in Excel)`. It pins the engine's value and doesn't claim parity. When the user confirms or refutes it, QA re-labels it or raises a defect.
- **INV-B38-YF.** The E-B38-1 table, through `excelYearFracBasis1` and through QA's oracle. Also: guards (start > end and an invalid Date each give `RangeError`; start = end gives 0); 2000 is leap and 2100 is not.
- **INV-B38-N.** For each in-scope case, `conversionPaymentsPerYear(..., true, true)` `Object.is` the oracle's `D / P / YEARFRAC`:
  - V-CASE1 26.089285714285715; V-EX2 26.083333333333336; V-PEND 26.085714285714285.
  - Bounds: 365/P (1 − 1e-12) ≤ n ≤ 366/P (1 + 1e-12) on the B37-T5 sweep.
  - The shipped rate is strictly below the workbook-converter rate.
- **INV-B38-ORDER.** n is `D / P / Y` and not `L / P`. On V-CASE1, V-WEEKLY, V-WHOLE5Y and the sweep, the engine `Object.is` the left-to-right oracle. The sweep contains spans where `L / P` differs in the last bit, for example 2025-01-01 → 2025-02-27 at P = 7: 52.14285714285714 against 52.142857142857146.
- **INV-B38-LE1Y** (within-a-year branch through the engine; the B37 state shown for contrast):

  | Vector | Flow / frequency | Inputs (loan, rate, payment, start, first, End) | n (B38 / B37) | B38 total interest (raw) |
  |---|---|---|---|---|
  | V-LE1Y-FEB29 | new, biweekly | 300,000; 5 %; 1,600; 2027-06-01; 2027-06-15; 2028-03-15 | 26.142857142857146 / 26.089744459121867 | 10,993.45 |
  | V-LE1Y-NOFEB | new, weekly | 300,000; 5 %; 800; 2028-03-10; 2028-03-17; 2029-02-20 | 52.14285714285714 / 52.26508143212298 | 13,313.24 |
  | V-LE1Y-END-FEB29 | new, weekly | 300,000; 5 %; 800; 2027-03-05; 2027-03-12; 2028-02-29 | 52.285714285714285 / 52.16615159621361 | 13,859.259999999995 |
  | V-EXACT1Y | renewal, acceleratedBiweekly | 250,000; 6 %; 1,000; accrued 100; 2027-12-15; 2027-12-29; 2028-12-15 | 26.142857142857142 / 26.13953075598049 | 14,497.879999999997 |
  | V-CROSS1Y-1D | new, weekly | 300,000; 5 %; 800; 2028-03-01; 2028-03-08; 2029-03-02 | 52.21428571428571 (multi-year branch) / 52.26224146224146 | 14,090 |
  | V-2028 (existing) | — | same year | 26.142857142857142, unchanged | 13,067.529999999999 (B37 13,067.52165346835) |

  V-2028's n is unchanged because YEARFRAC equals `dayCountFraction` in a single year, so only the rounding moves it.
- **INV-B38-ROUND.** The E-B38-3 table. Also INV-B38-ROUND-RANGE: `roundToCentHalfAwayFromZero(1e15 / 7) === 142857142857143` (pins the documented above-range behaviour); NaN and ±Infinity give `RangeError`; the function never returns `-0`.
- **INV-B38-ROW.** Shipped, for every in-scope case of the B37-T5 sweep and both goldens' in-scope groups:
  - `row.periodInterest === roundToCentHalfAwayFromZero(periodInterest(row.openingBalance, decimal, prior, row.date))`;
  - `row.periodInterest * 100` is within 1e-6 of an integer;
  - V-CASE1 row 1 `periodInterest === 758.3` (B37 758.3018733743622).
  - INV-B38-CONST, the twin of B37's INV-CONST: for every out-of-scope case, `row.periodInterest === periodInterest(...)` (unrounded) in the shipped state.
- **INV-B38-SCOPE.**
  - Every out-of-scope case (Monthly, Semi-monthly, variable, personal loan, any flow) JSON-equals between `yearFracRounded` true and false.
  - With `leapAware` false, every case JSON-equals between `yearFracRounded` true and false. Sweep: B37-T5's 4,800 inputs.
- **INV-B38-SCOPE-SAME.** On the sweep and for every frequency, `roundsPeriodInterestToCent(p, r, f, s, e, L, Y)` equals `L && Y && conversionPaymentsPerYear(p, r, f, s, e, true, true) !== PAYMENTS_PER_YEAR[f]`. This holds because n ∉ {52, 26} on the leap path.
- **INV-B38-OFF.** With `yearFracRounded` false, the engine replays the B37 goldens byte for byte:
  - `serialise(computeGolden({ yearFracRounded: false }))` has sha `b90ea69ce09cea5ceaea400cb4a192fcef0d8aca1117905e38c7b01ed876d220` (v1) and `9da9599f75bec61090a9f07d2ee16f4bd8a3c51e3601675d2170ce2afc905db8` (PC);
  - every `on` block of `b37_leap_n_vectors.json` is reproduced field by field.

  Prototype: switch flipped to `false`, both goldens regenerated to exactly those shas, and `tests/ca` + `tests/architecture` all green except the 7 structural guards listed under the test plan.
- **INV-B38-B19.** V-CASE1 in both `unpaidInterestCapitalised` states, shipped: every row's `periodInterest` is whole cents, and the calculated rate depends only on the switch pair.
- **INV-B38-ACCEL.** Accelerated weekly / bi-weekly JSON-equal weekly / bi-weekly in the shipped state (V-NOLEAP-EXACT, V-WHOLE5Y).
- **INV-B38-INPUTS.** The engine never rounds inputs. Renewal, fixed, biweekly, accrued `58.335`: row 1 `carriedAccruedInterestOpening === 58.335`. Fees and payment amounts reach the waterfall as entered.
- **INV-B38-LABEL.**
  - For every sweep case and every frequency, `paymentsPerYearFor(x, f)` `Object.is` `conversionPaymentsPerYear(p, r, f, start, end, LEAP_AWARE_PAYMENTS_PER_YEAR, YEARFRAC_ROUNDED_INTEREST)` and the oracle n. Equation 1 at that n is the shipped Calculated rate.
  - On the REF-01 default dates, the page texts stay "Weekly (52/yr)", "Bi-weekly (26/yr)", "Semi-monthly (24/yr)" and "Monthly (12/yr)" in all three engine states.
  - Source: `paymentsPerYearFor`'s call ends `LEAP_AWARE_PAYMENTS_PER_YEAR, YEARFRAC_ROUNDED_INTEREST)` with no `true` / `false` literal.
- **INV-B38-REF01** (`known_divergence` DEV-B37-LEAPN + DEV-B38-ROUND, shipped). REF-01 (new, fixed 3.74 %, weekly, 227,829.65, 465.46, 2026-03-17 / 2026-03-23 / 2029-03-17):

  | Figure | Shipped (B38) | B37 state | Workbook |
  |---|---|---|---|
  | Total interest | 22,514.06 | 22,514.07 | 22,514.11 |
  | Total principal | 50,097.70 | 50,097.69 | — |
  | Balance | 177,731.95 | 177,731.96 | — |
  | COB amount | 22,514.06 | — | — |

  - The calculated rate is 3.706776950704952 % (3.70678 at 5 dp, unchanged on screen).
  - S1_fees: COB amount 25,014.06, APR 4.114401983975993 % (4.11440 %, unchanged at 5 dp).
  - The leap-off branch still matches the workbook exactly (`ref01-workbook.test.ts`, unchanged).

## Deviation DEV-B38-ROUND (needs sign-off in CHANGES §76)

- **Part 1, interest rounding.** Per-period interest is rounded to the cent inside the calculation for the B37 cases. This departs from:
  - the workbook, whose macro never rounds;
  - the project convention "no intermediate rounding" (CLAUDE.md, ADR-02, fitness F4);
  - the user manual's "doesn't round anything while it calculates".
- **Part 2, YEARFRAC.** Y in the leap-aware n changes from the per-year split to Excel YEARFRAC basis 1.
- The workbook's n = 52 / 26 departure stays DEV-B37-LEAPN.
- **Authority.** User decision DEC-B38-YEARFRAC-ROUND, matching the user's Excel on V-CASE1 and V-EX2.
- **Containment.**
  - The rule is scoped to predicate S.
  - It is behind `YEARFRAC_ROUNDED_INTEREST`; `false` restores B37.
  - F4 gets one marked, pinned exemption line.

## Implementation and test plan

Order mirrors B37: QA red step, then sr-dev green step, then QA verify, then doc-writer. Prefer extending existing files. **New files are listed explicitly; there are two, both fixtures.**

### 1. QA red step (tests first; `src/` untouched)

**Test helpers and oracle (extended, no new files):**

`tests/ca/support/switches.ts`:
- `calculateWith(input, switches, leapAware?, yearFracRounded?)`. The 4th argument is passed only when given.
- `export const B38_ON = true, B38_OFF = false` and `BOTH_B38`.
- Doc: `LEAP_ON` with no 4th argument is the shipped B38 state.

`tests/ca/support/leapNOracle.ts` (still no `src/` import):
- `oracleYearFracBasis1(startIso, endIso)`: E-B38-1 on ISO days with `civilDays`, written independently.
- `oracleRoundCent(x)`: E-B38-3. QA must implement it independently of the reference code, for example from `x.toPrecision(15)` with string or BigInt arithmetic. It must agree on the E-B38-3 table.
- `oracleLeapN(periodDays, s, e, yearFrac = false)`, `oracleN(..., yearFrac = false)` and `oracleSchedule(c, leapAware, yearFracRounded = false)`, which rounds each row's period interest when in scope.

`tests/ca/fixtures/generate_b37_leap_n_vectors.ts` (extended): adds a top-level `"b38"` key to `b37_leap_n_vectors.json`, holding:
- `yearFracVectors`, the E-B38-1 table;
- `nVectors` at B38;
- per-case `b38` results for every existing case, plus the new cases V-PEND, V-LE1Y-FEB29, V-LE1Y-NOFEB, V-LE1Y-END-FEB29, V-EXACT1Y and V-CROSS1Y-1D. Put these in a separate `b38.cases` map so B37's `CASE_IDS` doesn't grow.

The existing `note`, `cases` and `nVectors` subtrees must stay **byte-identical** after re-parse. QA proves this in the red-step evidence by deep-comparing them before and after. B37-T0's "fixture equals a fresh oracle run" then covers the new key.

**`tests/ca/b37-leap-aware-n.test.ts`: which B37 assertions move.**
- File-local helpers become `on = (x) => calculateWith(x, SHIPPED, LEAP_ON, B38_OFF)` and `off = … LEAP_OFF`. Every B37-state engine assertion (T0, T3 to T7) then stays as it is, now pinned explicitly to the B37 state. That serves as INV-B38-OFF evidence.
- The three `calculateCobCanada(` calls in T3 (REF-01 known_divergence, US-08 case 1 and example 2) and the one in T9 INV-LABEL-N become `on(`. Their titles say "B37 state (YEARFRAC_ROUNDED_INTEREST false)". Their values are unchanged. The case-1 title keeps "Excel 60,137.63; superseded by B38" as history.
- These assertions change value:
  - **T1** "calculateCobCanada JSON-equals …": becomes `calculateCobCanadaWith(x, SHIPPED, true, false)` and rate 4.297115439387225; the shipped equality moves to B38-T1.
  - **T1 source regex**: allows the 4th defaulted parameter (`leapAware: … ,\s*yearFracRounded: boolean = YEARFRAC_ROUNDED_INTEREST,?`).
  - **T9** C3 vectors, "reads the flow's START date", INV-LABEL-N, INV-LABEL-SHARED and INV-LABEL-TOTAL: `paymentsPerYearFor` is shipped and therefore B38. Compare against the oracle at `yearFrac = true` (for example V-CASE1 26.089285714285715), or pass the 7th argument where the test calls `conversionPaymentsPerYear` directly.
  - **T9 source guard**: `/conversionPaymentsPerYear\([\s\S]*LEAP_AWARE_PAYMENTS_PER_YEAR,\s*YEARFRAC_ROUNDED_INTEREST,?\s*\)/`.
  - **T9 "none of the four new names is on either barrel"**: extend with `excelYearFracBasis1`, `roundToCentHalfAwayFromZero` and `roundsPeriodInterestToCent`.
- **New `describe` blocks appended to the same file**: B38-T1 (INV-B38-PIN) to B38-T9, covering INV-B38-ACCEPT, -PENDING, -N, -ORDER, -LE1Y, -ROW / -CONST, -SCOPE, -SCOPE-SAME, -OFF (computeGolden with `yearFracRounded: false` → the two shas above), -B19, -ACCEL, -INPUTS, -LABEL and -REF01.
- Because the file is already in `test:tz` for both zones, `package.json` doesn't change, so the Help baseline doesn't need a package.json re-pin.

**Other existing test files (extended):**
- `tests/ca/equations.test.ts`: INV-B38-ROUND, INV-B38-ROUND-RANGE, `leapAwarePaymentsPerYear(…, true)` and the `conversionPaymentsPerYear` 7th parameter defaulting to `false` (byte-identity with six arguments).
- `tests/ca/calendar-a4.test.ts`: INV-B38-YF. Test (a)'s export list gains `excelYearFracBasis1`.
- `tests/ca/policies-a7.test.ts`: A7-1 / A7-2. Exports become eight; the new last export is `YEARFRAC_ROUNDED_INTEREST`; `cobCanada.ts` imports it.
- `tests/ca/b27-personal-loan-monthly-only.test.ts`: the policies export-name list gains `YEARFRAC_ROUNDED_INTEREST`.
- `tests/ca/b37-frequency-labels.test.ts`: the "[leap-aware n (shipped)] … Math.round of the engine n" case compares against the B38 oracle n, for example 52.17857142857143 rather than 52.1904761904762. `BOTH_LEAP` keeps its two rows; add the B37-state row through the 4th argument if the helper allows it. Texts are unchanged.
- `tests/architecture/f4-no-rounding.test.ts`:
  - `ROUNDING` gains `|\.toExponential\(`.
  - New marker `// fitness:cent-round` (DEV-B38-ROUND).
  - New test "F4 [B38]": the marker appears exactly once, in `src/ca/equations.ts`, on exactly the line `const [mantissa, exponentText] = Math.abs(x).toExponential(14).split('e') as [string, string]; // fitness:cent-round`.
  - "F4: no unmarked rounding" excludes both markers.
  - The day-count marker tests are unchanged.
  - The header records the exemption and why: the user decision; Excel ROUND has no non-rounding equivalent.
- `tests/architecture/f7-decisions-registered.test.ts`: no code change. Its regex already accepts `DEC-B38-YEARFRAC-ROUND`. It goes green once the BA adds the ID to `COB-user-stories.md`.
- `tests/ca/golden/engineGolden.test.ts` / `engineGoldenPc.test.ts`: no code change. They go red until the goldens are regenerated.
- The generators `tests/ca/fixtures/generate_golden.mjs` and `generate_golden_pc.mjs` are extended: `computeGolden` accepts `{ leapAware, yearFracRounded }` for B37-T8 and B38-T-OFF. The output for the defaults is unchanged.

**Expected red after the red step** (prototype-measured: 85 red in `tests/ca` + `tests/architecture` with no test edits; 54 after pinning the B37 file to `B38_OFF`):
- the new B38 tests;
- 22 v1 + 12 PC golden tests;
- 2 in F6 (they hash the golden fixture);
- A10-C10 to C13 (REF-01 and S1_fees are fixed weekly);
- the 14 structural and label tests above, red until `src/` lands;
- F4 [B38];
- F7, until the user-stories ID lands.

### 2. sr-dev green step

`src/ca/policies.ts`, `calendar.ts`, `equations.ts`, `cobCanada.ts` and `types.ts` (comment) as in **Data shapes**. Nothing else in `src/`. No barrel change. `ui/ca.js`, `ui/ca-view.js` and `ui/ca.html` stay **unchanged**: the label path already goes through `paymentsPerYearFor` (`renderFrequencyLabels`, `ui/ca.js` l.489-491).

Then:
- **Regenerate goldens (user-approved inside B38 for these groups only).** Run `npx vite-node tests/ca/fixtures/generate_golden.mjs --write` and `generate_golden_pc.mjs --write`. Prototype result:

  | File | Before | After (expected) | Moves |
  |---|---|---|---|
  | `golden_engine_v1.json` | `b90ea69c…d220` | `d6b9b532ccac4141347b71bb04cd2f4ae020200d887d71039c843ff2f35bea07` | **18 of 148 groups** `{weekly,biweekly}\|mortgage/fixed\|{none,fin2000,fin2000cash400}\|{new,renewal0,renewal850}`; **4 of 6 long cases** `long:{weekly,biweekly}:{noPayoff,payoff}` |
  | `golden_engine_pc_v1.json` | `9da9599f…5db8` | `72a644a2ec65acc8e2ef101d4e4df647b3889ec93fe8a46e10c58f545f5addb4` | **12 of 122 groups** `pc\|{weekly,biweekly}\|mortgage/fixed\|{none,fin2000,fin2000cash400}\|{acc0,acc850}`; no long case |

  These are the same group lists as B37. Every other group is byte-identical and no case count changes. The CHANGES entry lists the groups and both hash pairs. If sr-dev's shas differ from these, stop and report: the values are deterministic.
- `node share/build-share.mjs`, which rebuilds `COB.html`.
- `npm run build`, `typecheck`, `typecheck:tests` and `test:tz`.

### 3. QA verify

**Goldens, independently.**
- Group by group against the committed B37 fixtures (or `computeGolden({ yearFracRounded: false })`).
- Exactly the listed groups and long cases move.
- QA's oracle reproduces every in-scope case of both corpora row by row in the B38 state (`Object.is`), and every case in the B37 state.

**Capture `a10_ui_capture_v1.json`** (regenerate with `capture_a10_ui.mjs`, Chrome). Only REF-01 and S1_fees change, in both modes, and only number tokens:

| Figure | Before | After |
|---|---|---|
| Total interest | $22,514.07 | $22,514.06 |
| Cost of borrowing amount (REF-01) | $22,514.07 | $22,514.06 |
| Cost of borrowing amount (S1_fees) | $25,014.07 | $25,014.06 |
| Total principal paid | $50,097.69 | $50,097.70 |
| Balance at end date | $177,731.96 | $177,731.95 |

- Plus schedule table, print schedule and CSV digits.
- Calculated rate 3.70678 % and S1_fees APR 4.11440 % are unchanged.
- No other scenario, label, `formDefaults` or `flowScreens` changes.

**New fixture 1: `tests/ca/fixtures/b38_capture_undo.json`** (QA). The reverse number-token patch from the B38 capture to the B37 capture, in the format of `b37_capture_undo.json`.

**Capture chain re-baselines (no assertion value changes).**
- `b37-capture.test.ts`:
  - The golden block checks against the B37 group pins as today but without the file-sha equality, which becomes history.
  - The capture block applies `b38_capture_undo.json` before its B37 string checks.
  - Add a "B38 goldens / capture" `describe` with the moved lists and new shas above.
- `b33-frequency-unlocked.test.ts` B33-T10: apply the B38 undo, then the B37 undo.
- `golden/b25-golden.test.ts` G4 and `b27-personal-loan-monthly-only.test.ts` B27-T11: re-pin the capture sha.

**Help / share re-pins** (record each in the file's `recorded` / `_comment`):
- `help/tests/fixtures/pre-b29-baseline.json`: both golden shas, the capture sha and `trees.src` (policies, calendar, equations, cobCanada, types comment).
- `ui/ca.js`, `ui/ca-view.js`, `ui/ca.html` and `package.json` must **not** change; assert this.
- `share/tests/fixtures/pre-b30-pins.json`: both golden shas and the capture sha.
- Expected red until re-pinned: about 5 in `help/tests/b29-help-link.test.mjs`, 1 to 2 in `b29-help-removal.test.mjs` and 2 in `share/tests/b30-readonly-coupling.test.mjs`. That is the B37 pattern; a copy of the tree without Help packages installed also shows the `b29-security-html-block` tests red, which is an artefact.

**Mutants** (scratch copy; each must be killed):

| ID | Mutation | Killed by |
|---|---|---|
| M1 | Rounding applied to every frequency and product | INV-B38-SCOPE / CONST |
| M2 | `Math.round(x * 100) / 100` | INV-B38-ROUND 1.005 |
| M3 | Half-even | 0.015 → 0.02, 1.005 |
| M4 | Truncation | 2.675 |
| M5 | Multi-year YEARFRAC formula used for every span (the scratch hack) | V-LE1Y-* |
| M5c | B37 Y kept, rounding on | V-EX2 74,326.09 |
| M6 | Same-year span uses 366 only if [start, end] contains a Feb 29 (Microsoft's wording) | 2000-01-01 → 2000-01-02 = 1/366, and QA adds 2028-03-01 → 2028-12-01 = 275/366. Note: reusing the cross-year Feb 29 test for same-year spans is an *equivalent* mutant (in a leap year it always yields 366), so don't count it |
| M7 | `end > Feb 29` (strict) | 2027-06-01 → 2028-02-29 |
| M8 | `start <= Mar 1` | 2028-03-01 → 2029-02-28 |
| M9 | Y = D / 365.25 | V-LE1Y-NOFEB |
| M10 | Rounding when `leapAware` is false | INV-B38-SCOPE |
| M11 | Only displayed interest rounded, waterfall unrounded | INV-B38-ROW / ACCEPT |
| M12 | `paymentsPerYearFor` without the 7th argument | INV-B38-LABEL |
| M13 | `interestPaid` rounded instead of `periodInterest` | INV-B38-ROW |
| M14 | n = L / P | INV-B38-ORDER |
| M15 | YEARFRAC on, rounding off | V-EX2 74,326.12 |
| M16 | `withinAYear` uses `d1 > d2` | 2027-12-15 → 2028-12-15 |

**Evidence:** `npm run build`, `npx vitest run` (full), `typecheck`, `typecheck:tests`, `test:tz` in both zones, Chrome smoke (labels plus V-CASE1 total interest **$60,137.63**), F12, `check_share_page.mjs` against the rebuilt `COB.html`.

### 4. Doc-writer, then the Help rebuild

- **`COB-ts/docs/COB-user-manual.md`.**
  - New draft line.
  - §10 "How the calculated rate is worked out" (l.311): Y is "the span in years as Excel's YEARFRAC counts it: the days divided by the average length of the calendar years the span touches (365 or 366 for a span of a year or less)".
  - l.320 "Display precision" and l.374: for a fixed-rate mortgage paid Weekly or Bi-weekly, each payment's interest is rounded to the cent, as the Excel calculation does; nothing else is rounded.
  - l.401 and l.456 (schedule and CSV "exact" wording): in those cases the CSV interest is whole cents.
- **`COB-ts/docs/COB-domain-overview.md`.** The state line; the §3.2 `NLeap` box and "Today (B37…)" paragraph (YEARFRAC, case 1 now $60,137.63 to the cent); the §3.3 `Int` box note "rounded to the cent for fixed Weekly / Bi-weekly (B38)"; the §4 table row (REF-01 $22,514.11 → $22,514.06; DEV-B38-ROUND).
- **`COB-ts/docs/COB-coverage.md`.** Add a B38 row if it tracks items.
- Then `node help/build-help.mjs` and re-pin the Help baseline page sha.

### 5. CHANGES.md §76 (template; sr-dev writes, QA completes)

`### 76. B38: Excel YEARFRAC for Y in the leap-aware n, and period interest rounded to the cent, for Weekly and Bi-weekly fixed-rate mortgages (2026-10-…, user decision DEC-B38-YEARFRAC-ROUND; deviation DEV-B38-ROUND; QA verified …)`

- **What.**
  - Engine: E-B38-1 to E-B38-4. Switch `YEARFRAC_ROUNDED_INTEREST`, shipped `true`; `false` is B37 byte for byte; effective only with `LEAP_AWARE_PAYMENTS_PER_YEAR`.
  - The new and changed `src/ca` functions.
  - UI unchanged; the labels still read 52 / 26.
  - F4 exemption `// fitness:cent-round`.
- **Why.**
  - Case 1 60,137.63 / 43,861.65 (Excel, to the cent; was 60,137.62 / 43,861.66); example 2 74,326.11 / 48,523.89 (unchanged).
  - The pending vector predicts 51,018.08 / 34,481.92 (unconfirmed, Q-B38-PEND).
  - DEV-B38-ROUND text; REF-01 22,514.07 → 22,514.06.
- **Fixtures.** Both golden hash pairs, the 18 + 4 / 12 group lists, the capture sha pair, and the re-pins in help / share / G4 / B27-T11 / B33-T10.
- **Evidence.** Counts and QA verdict.

### Impact estimate

Measured on the prototype (`scratchpad/b38/COB-ts`, `tests/ca` + `tests/architecture`, 3,477 tests, baseline all green):

| State | Red tests |
|---|---|
| Rounding applied globally (main session, unscoped) | ~770 |
| Scoped as specified, no test edits | **85** |
| … with the B37 file pinned to `B38_OFF` | **54** |
| … after golden and capture regeneration | **14** structural / label edits plus the new B38 tests |

The 54 break down as:
- 34 golden tests, which go green on regeneration;
- 2 F6;
- 4 A10-C10 to C13, which go green on the capture regeneration;
- the 14 structural and label edits.

On top of that come the help / share pin tests and the capture-chain tests (B37 pattern, about 12).

## Open questions (for the user)

- **Q-B38-YF (non-blocking; default: ship E-B38-1 as written).** Excel's YEARFRAC basis 1 for spans of **a year or less** is not documented correctly by Microsoft. E-B38-1 uses D. A. Wheeler's black-box reconstruction, verified against Excel 2007. Could you type these into your Excel and send back the values to 15 digits?

  | Formula | Expected |
  |---|---|
  | `=YEARFRAC(DATE(2027,6,1),DATE(2028,3,15),1)` | 0.786885245901639 (288/366) |
  | `=YEARFRAC(DATE(2027,6,1),DATE(2028,2,28),1)` | 0.745205479452055 (272/365) |
  | `=YEARFRAC(DATE(2028,3,10),DATE(2029,2,20),1)` | 0.950684931506849 (347/365) |
  | `=YEARFRAC(DATE(2027,3,5),DATE(2028,2,29),1)` | 0.986338797814208 (361/366) |
  | `=YEARFRAC(DATE(2027,12,15),DATE(2028,12,15),1)` | 1 |
  | `=YEARFRAC(DATE(2028,12,31),DATE(2029,1,1),1)` | 0.00273972602739726 (1/365) |
  | `=YEARFRAC(DATE(2028,2,29),DATE(2029,3,1),1)` | 1.00136798905609 (366/365.5) |

  Any mismatch is a defect against E-B38-1 before release.
- **Q-B38-ROUND (non-blocking; no golden case is affected).** Excel's ROUND internals aren't documented. Please check `=ROUND(1.005,2)` (we expect 1.01) and `=ROUND(2.675,2)` (we expect 2.68). If Excel gives 1.00, E-B38-3 switches to exact-binary rounding; that is a one-line change and affects no current vector.
- **Q-B38-PEND.** Please confirm in your Excel the pending vector (300,000; 5 %; 900; accrued 0; 2026-11-02; 2026-11-16; 2030-06-28): we predict **51,018.08 / 34,481.92**.
- **Q-B38-FORMULA (information).** Does your Excel's per-period interest formula use days ÷ 365 with leap days ÷ 366, exactly as the engine does (BR-11)? Two matching vectors suggest yes. A different operand order can only matter at an exact half-cent, which no test case hits.
- **Q-B38-SCOPE-SM (confirmation, already answered "no").** Rounding stays off for Monthly / Semi-monthly fixed mortgages, even though your Excel may round there too. If it does, that is a future item, because it would break legacy parity for those frequencies.

## Checks run for this brief

All in `scratchpad/b38/`, on a copy of COB-ts patched with the design above. These are not repo changes.

- **Acceptance vectors** (`vec.mjs`), all four switch states:

  | Vector | B38 | B37 state | Leap off |
  |---|---|---|---|
  | V-CASE1 | **60,137.63 / 43,861.65** | 60,137.62 / 43,861.66 | 60,137.81 / 43,861.47 |
  | V-EX2 | **74,326.11 / 48,523.89** | 74,326.11 / 48,523.89 | 74,326.33 |
  | V-PEND | **51,018.08 / 34,481.92** (= the user's prediction) | 51,018.03 / 34,481.97 | — |

  The leap-off state gives the same figures with `yearFracRounded` true or false.
- **YEARFRAC table** (E-B38-1): 17 of 17 as listed, including all three of Wheeler's published examples.
- **Rounding table** (E-B38-3): all as listed. Across the regenerated goldens (65,425 rounded rows), 0 disagreements with naive rounding and 0 near-ties.
- **Goldens**: on, v1 `d6b9b532…ea07` (18 groups + 4 long) and PC `72a644a2…ddb4` (12 groups); off, `b90ea69c…d220` and `9da9599f…5db8` (byte-identical to the committed files).
- **Test suite** (`tests/ca` + `tests/architecture`, 3,477 tests): baseline 0 red; on, 85 red; off, 7 red (all structural export / source guards); on with the B37 file pinned off, 54 red (breakdown above).
- **"Tests pass" ≠ "matches Excel".** Only V-CASE1 and V-EX2 are Excel truths, supplied by the user. V-PEND is a prediction. The within-a-year YEARFRAC branch and ROUND near-ties rest on background research (Q-B38-YF, Q-B38-ROUND).

## Sources

- Project: `COB-ts/src/ca/equations.ts` (`leapAwarePaymentsPerYear` l.130, `conversionPaymentsPerYear` l.155-169, `periodInterest` l.183-197); `COB-ts/src/ca/cobCanada.ts` (`buildSchedule` loop l.101-110, `calculateCobCanadaWith` l.209-245, `paymentsPerYearFor` l.402-413); `COB-ts/src/ca/calendar.ts` (`dayCountFraction` l.39-59); `COB-ts/src/ca/policies.ts` l.64-72; `COB-ts/CHANGES.md` §75; `COB-ts/tests/architecture/f4-no-rounding.test.ts`, `f7-decisions-registered.test.ts`; `COB-ts/tests/ca/b37-leap-aware-n.test.ts`, `support/leapNOracle.ts`, `support/switches.ts`.
- Background only (does not override the user decision or the project sources):
  - D. A. Wheeler, "YEARFRAC, basis==1: Here's the CORRECT algorithm (previously undocumented)", OASIS office list, April 2008: https://lists.oasis-open.org/archives/office/200804/msg00085.html
  - Wheeler, "YEARFRAC: Why both Microsoft XML definitions are wrong": https://lists-archive.oasis-open.org/archives/office/200804/msg00084.html
  - Microsoft, YEARFRAC function: https://support.microsoft.com/en-us/office/yearfrac-function-3844141e-c76d-4143-82b6-208454ddc6a8
  - Microsoft, "Floating-point arithmetic may give inaccurate results in Excel": https://learn.microsoft.com/en-us/troubleshoot/microsoft-365-apps/excel/floating-point-arithmetic-inaccurate-result
