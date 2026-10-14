# QA report: B39 (DEC-B39-VAR-PL-M12, spec 014), COB-ts, 2026-10-13

Scope: the uncommitted B39 change in `COB-ts/src/ca/` and its tests. Authority: spec 014, the registry
`COB-py/tests/fixtures/ca_user_excel_examples.json`, and CHANGES §77. No product code was changed, and nothing was
committed, reverted or stashed. All scratch work is in the session scratchpad.

## Verdict: **PASS WITH NOTES**

**Tests pass vs matches Excel.** The tests pass. That shows the engine matches spec 014 and QA's oracles. It does
not show the engine matches the user's Excel. Only UX-001, UX-002 and UX-004 are Excel matches, and the Excel figures
are totals only: there are no row-level or rate-cell Excel figures. UX-003 is 1 cent off Excel, which is a known gap
(Q-B39-VAR1-CENT). UX-P01 to UX-P04 are predictions. Nothing was checked against the reference workbook, which B39
departs from on purpose (DEV-B39-M12).

Highest rung reached for COB-ts: **3, matches the reference.** Here the reference is the user's Excel totals, plus an
independent oracle at full precision. Rung 4 does not apply, because B39 is COB-ts only (Q-B39-ENGINES).

## 1. Check commands (run by QA)

| Command | Result |
|---|---|
| `npm run typecheck` | clean |
| `npm test` | **Test Files 98 passed (98), Tests 4319 passed (4319)**, which matches the developer's claim |
| `npm run build` | clean |
| `npm run typecheck:tests` | clean |
| `npm run test:tz` | America/Toronto **28 files / 1651 passed**; Pacific/Kiritimati **28 / 1651 passed** |

QA did not re-run the Chrome smoke step (j), `check_share_page.mjs` or the `COB.html` rebuild. Those results are the
developer's evidence only.

## 2. Registry: independent oracle

I wrote a new oracle in Python (`scratchpad/oracle39.py`). It imports no engine code and none of the TS test oracle. It
covers: YEARFRAC basis 1, the BR-11 per-year day split, n = D/P/Y, equation 1 at m = 2 (fixed mortgage) and m = 12
(MONTHLY basis, 7/14-day frequencies), B38 cent rounding (fixed mortgage only), the semi-monthly 15th / month-end
dates, the DEV-OQL unpaid-interest bucket, and fees. Its results:

| Id | Status | Oracle (2 dp) | Registry `expected` | Excel | Pre-B39 (switch off) |
|---|---|---|---|---|---|
| UX-001 FIX-1 | match (**Excel-confirmed**) | 60,137.63 / 43,861.65 | same | 60,137.63 / 43,861.65 | same |
| UX-002 FIX-2 | match (**Excel-confirmed**) | 74,326.11 / 48,523.89 | same | 74,326.11 / 48,523.89 | same |
| UX-003 VAR-1 | known-gap (+1/−1 cent) | 12,463.92 / 10,035.88 (raw 12,463.91672) | same | 12,463.91 / 10,035.89 | 12,480.90 / 10,018.90 |
| UX-004 VAR-2 | match (**Excel-confirmed**; frequency inferred, Q-B39-VAR2-FREQ) | 57,808.56 / 53,537.79 | same | 57,808.56 / 53,537.79 | 57,862.71 / 53,483.64 |
| UX-P01 CHECK | prediction | 51,018.08 / 34,481.92 | same | — | same |
| UX-P02 T1 | prediction | 12,463.92 / 10,035.88 | same | — | 12,480.90 / 10,018.90 |
| UX-P03 T2 (semi-monthly) | prediction | 58,219.01 / 51,185.35 | same | — | same |
| UX-P04 T3 | prediction | 6,376.33 / 30,000.00 (260 rows) | same | — | 6,397.62 / 30,000.00 |

The full-precision values match spec 014 INV-B39-ACCEPT:

- n is identical to the last bit: VAR-1 52.17857142857142, VAR-2 26.083333333333332, T3 52.166666666666664.
- The Calculated rate is identical to the last bit: 3.994876602469461, 3.796756654443251, 7.979547907300506.
- Row 1 interest is identical: 84.22883636407059 and 208.22240457772344.
- The totals differ only in the last float bits, because the oracle sums in a different order.
- INV-B39-STATES (B39 with B37's Y) also reproduces: VAR-1 n 52.1909594095941, total 12,463.91552; VAR-2 57,808.55683.

The registry byte copy in COB-ts is identical to the COB-py file (`cmp`).

## 3. Scope, switch and label: engine against the oracle on a grid

I ran a grid of 4 product/rate pairs × 6 frequencies × 4 flows × 6 date spans (including leap crossings and a 10-year
term) × 4 loan/payment sets (including underpayment) × 2 fee sets. Each case ran in all 8 switch states (leapAware,
yearFracRounded, monthlyConversion) through `calculateCobCanadaWith`. That is 4,608 cases: 2,808 valid and 1,800
rejected by validation (rate 0, and variableRatePaymentChange on a product other than a variable mortgage).

- **0 discrepancies** across the checks below.
- **Rejections:** the same error message in all 8 states.
- **Shipped state:** `calculateCobCanada` JSON-equals state (1,1,1) in every case.
- **INV-B39-SCOPE / -OFF:** turning the switch on and off changes the JSON result **iff** leapAware is on, the basis
  is MONTHLY and P ∈ {7, 14}. That covers both yf values, so fixed mortgages, Monthly and Semi-monthly are
  byte-identical with the switch on or off.
- **INV-B39-GATE:** with leapAware off, the switch is inert in all cases.
- **Trigger rate:** identical on and off in every case.
- **Oracle agreement, states (1,1,1) and (1,1,0):** I checked every 7/14-day and semi-monthly case (4,680 runs)
  against the oracle. The Calculated rate matched **bit for bit**. Row count, last date, row 1 interest and totals
  matched to 1e-9 relative.
- **INV-B39-BELOW:** holds for every in-scope case.
- **Label:** `paymentsPerYearFor` is `===` the oracle's n at the shipped state, for every 7/14-day case.

Goldens, checked independently against `b39_pre_golden_group_hashes.json`:

- v1: **56 of 148** groups moved, and pc: **50 of 122** groups. Every moved group holds an in-scope case. That includes
  the extras: `extra:minimumPayment` and `vrpcx:minimumPayment` are weekly variable mortgages, and
  `extra:underpayment` and `pcx:underpayment` are personal loans. No in-scope group stayed put.
- Group keys and case counts are unchanged.
- Long cases: v1 0 of 6 moved; pc 1 of 2 moved (`long:pc:weekly:acc850:underpayment`).
- File shas match CHANGES §77.
- The pre-B39 anchors (d6b9b532…, 72a644a2…, 89329245…) equal the shas recorded in CHANGES §76 when B38 was signed
  off. The switch-off replay therefore rests on an anchor the developer did not create.

## 4. Audit of changed tests

- **No test deleted.** For every changed test file, the count of `it`/`test` declarations is the same as at HEAD or
  higher.
- **No tolerance loosened.** No `toBeCloseTo` or tolerance constant was widened.
- **B39_OFF pins** apply to: rateSelection-oqc, B27-T2, B33-T4/T6, T5 L1–L7 and N1–N3, B19-V5, the B26-T6 sweep,
  cobCanada leap straddle, and A5 `overflowToInfinityShipped`. Their expected values are unchanged and their titles
  carry " — B39 off". No regression is hidden behind them. Out of scope, on and off are byte-identical (§3), and
  B39-T4/T4b plus my grid cover the shipped in-scope behaviour. See F-3 for the coverage cost.
- **T5 shipped twins** for L3/L4/L7 are tagged `known_divergence DEV-B39-M12`. They only assert that the rate is lower
  and the results differ, which is weak but honest.
- **`b37-capture.test.ts`** is a QA-owned file the developer edited. The B39 change does two things:
  - block 1 reads the B38 goldens as the engine replays them with the switch off;
  - the capture blocks first apply `b39_capture_undo.json`.

  The undo patch touches only VRPC_zero_accrued and PL_WEEKLY, and only number tokens. B38-describe test 2 checks that
  the mapped-back scenarios equal every per-scenario B38 sha. No expected value changed. **Accepted.**
- **`support/leapNOracle.ts`** is a QA-owned oracle the developer extended (`oracleMonthlyConvertedDecimal`, and
  `monthlyConversion` in `oracleN` / `oracleSchedule`). That weakens its independence. However, the independent
  Python oracle (§2, §3) agrees with it, bit for bit on rates. **Accepted.**

## 5. Mutation tests (spec 014 §3, M1–M11)

I ran these on a scratch copy of COB-ts with node_modules symlinked, running `vitest run tests/ca tests/architecture`.
The baseline was 3,644 tests, all green.

| Mutant | Red tests |
|---|---|
| M1 m = 2 for MONTHLY | 132 |
| M2 `100*n*(…)` operand order | 67 |
| M3 row rounding in scope | 155 |
| M4 n = 52/26 for MONTHLY | 132 |
| M5 Y = dayCountFraction (shipped) | 131 |
| M6 Semi-monthly converted | 71 |
| M7 fixed mortgage at m = 12 | 358 |
| M8 ungated (active with leapAware off) | 180 |
| M9 label passes `false` as 8th argument | 9 |
| M10 trigger rate on the leap-aware n | 50 |
| M11 rate truncated to 6 dp | 132 |

**Survivors: none.**

## 6. Findings (most severe first)

- **F-1 [minor: display/docs, user-visible] UI / Help · spec 014 "no UI change" · VAR-2 inputs.**
  - Expected: the hint describes the rate as converted.
  - Actual: `ui/ca-view.js:375` shows the hint "Fixed-rate mortgages: contract rate converted to the payment frequency.
    Otherwise the contract rate." beside 3.79676 % for a 3.8 % contract. `ui/help.html:845` says "For variable-rate
    mortgages and all personal loans, it is the contract rate as entered."
  - Both are now false for every in-scope case.
  - Spec 014 left the UI out of scope. Route to the architect (spec) and the doc-writer / UI (hint and Help). The Help
    text is part of the pending doc-writer step.
- **F-2 [minor: spec] INV-B39-ZERO cannot be reached end to end.**
  - `validateCobCanadaInput` rejects `contractRatePercent` 0 ("must be > 0, got 0").
  - The invariant can therefore only be tested at equation level, where `calculatedRateFor(…, 0, n, true)` gives 0.
  - Ask the architect to restate the invariant as equation-level.
- **F-3 [minor: coverage] Whole blocks were pinned to switch-off.** Out-of-scope frequencies were pinned too (the
  OQ-C Monthly/Semi-monthly rows, the B33-T4 432-case sweep, T5 L1/L2/L5/L6), and so was the whole B26-T6
  golden-corpus sweep.
  - No result is wrong, because out of scope the two states are byte-identical.
  - However, B26-T6's invariant ("the unpaid-interest line is shown iff the last closing accrued interest > 0") is no
    longer swept over the shipped in-scope corpus.
  - Recommend a shipped twin of the B26-T6 sweep that checks the invariant only, with no pinned figure.
- **F-4 [minor: registry/docs] Missing open-item IDs.**
  - UX-P02 and UX-P03 have no Q- ID, so their test titles fall back to `PENDING Q-B39-PL-EXAMPLE`. That is right for
    P02 (Accelerated frequencies are covered by that item) but wrong for P03 (Semi-monthly). Spec 014 names
    **Q-B39-SM** for P03, and Q-B39-SM is not in 008.
  - Registry `howToAdd` rule 5 requires an 008 item that names the entry ID. No `UX-` ID appears in 008, which affects
    UX-003 / Q-B39-VAR1-CENT.
  - Route to the architect (registry) and the BA (008).
- **F-5 [note] `leapPathApplies` now uses `== null`.** An unknown frequency's `undefined` period is now treated like
  `null`, which returns false.
  - This matches spec E-B39-1 ("Never throws … undefined/null → false").
  - It cannot be reached in the engine: validation and `conversionPaymentsPerYear` step 1 reject an unknown frequency
    first. The only reachable change is in direct calls to `roundsPeriodInterestToCent` / `convertsMonthlyRate`.
  - No action needed.

## 7. Tests and fixtures added

None in the repo. These scratch tools are not committed: `oracle39.py` (independent Python oracle), `dump.ts` +
`analyze.py` (the 4,608-case, 8-state grid) and `mutants.py` (M1–M11).
