# COB-ts — change log

**Project of record (user decision 2026-09-27): `~/Development/cob/COB-ts` is the only live code.**
`~/Projects/cob_calculator` (`COB-ts`, `COB-ts copy`, `app/engine`, `app/web`, `COB-py`) is an
untouched archive. It does not include the 2026-09-27 fixes (T1–T7) and is no longer kept in sync.

Historical note: this folder began as a copy of an archived project (`~/Projects/cob_calculator/COB-ts copy`)
and has diverged from it since (decisions T1 to T7 and later). The dated entries below are history.

## 2026-09-24

### 1. Engine: port of spec 011

- **What:** the `app/engine` fixes from `docs/new-req/011-app-engine-brd-changes.md`
  were ported to `src/ca/`:
  - DQ-27 (DEV-011-1): non-financed fees are paid separately. They don't reduce the
    disbursal, don't enter principal or the payment waterfall, and count only in the
    cost of borrowing amount and rate. `feesToRecover` now starts at the financed fees
    only.
  - D9/D8 (DEV-011-2): financed fees paid reduce the balance:
    `closingBalance = openingBalance - feesPaid - principalPortion`.
  - DQ-28 (DEV-011-3): the final payment pays only what is owed. The principal step
    is capped at `openingBalance - feesOpening`, and the row's `paymentAmount` is what
    was actually paid (the new waterfall field `amountPaid`).
- **Why:** 008 §H items 1, 2 and 4 (financed fees charged twice, non-financed fees in
  principal, final payment overshoot). User decisions of 2026-09-24: D9 option (b),
  the corrected rule, and "port all app/engine fixes" to the copy.
- **Evidence:** `tests/ca/spec011.test.ts`, `tests/ca/spec011-d9.test.ts`, and the
  updated `invariants`, `equations`, `cobCanada` and `fixtureParity` tests. They're
  the same as `app/engine/tests/` apart from imports. The fixtures, copied into
  `tests/ca/fixtures/`, are `ca_007_worked_vector.json`, `ca_app_wire_vectors.json`,
  `ca_appendix_a.json`, `ca_oracle_scenarios.json`, `d9_oracle_vectors.json` and its
  generator. These show that the tests pass. They don't show a match with the workbook.

### 2. UI: Contract date

- **What:** a display-only Contract date field, which defaults to today's local date,
  and a "Contract terms — as of <date>" block that lists the inputs behind the results.
- **Why:** user request. It doesn't change the calculation.
- **Evidence:** checked in the browser (see item 6b).

### 3. Exports: print and CSV

- **What:** a "Print or save as PDF" printout that matches the app's print record,
  with a Contract date row added and no Ref. A CSV in the app's format. Both buttons
  are unavailable (`aria-disabled`) until there is a current result, and each click
  handler checks for one.
- **Why:** user request, to match `app/web`.
- **Evidence:** checked in the browser (see item 6b). There are no automated UI tests
  in this package.

### 4. Results panel and schedule table

- **What:** the results panel and schedule table look like the app's on screen.
- **Why:** user request.
- **Evidence:** visual check only.

### 5. Print and CSV follow the All/Compact setting

- **What:** print and CSV include only the columns that are on screen, all or compact.
  The print heading stays on the same page as the table.
- **Why:** user request. **This deliberately differs from the app**, which always
  prints and exports every column.
- **Evidence:** visual check only.

### 6a. BRD §6 fee limit (QA F1, F2)

- **What:** `validateCobCanadaInput` rejects input where the total financed fees are
  greater than or equal to `loanAmount`. The error is
  `total financed fees (1500) must be less than loanAmount (1000) (BRD §6)`. The page
  shows this engine message in `#error`, as it does for other validation errors.
- **Why:** BRD §6 says "Total fees must be less than the loan amount". Nothing enforced
  this. With financed fees above the loan, the DQ-28 cap went negative (QA F1: payment
  −400, principal −500). With fees equal to the loan, principal never moved (F2).
  Rule approved by the user on 2026-09-24: count financed fees only. Whether
  non-financed fees count is still open with the BRD author.
- **Evidence:** `tests/ca/validate.test.ts` ("BRD §6" block): rejects fees above the
  loan and fees equal to it, sums several fees, accepts the loan minus 0.01, and
  ignores non-financed fees. The same change and tests are in `app/engine`.

### 6b. UI dates parsed to UTC midnight (QA F3)

- **What:** `parseDateInput` now returns `new Date(Date.UTC(y, m-1, d))`.
  `inputDateFmt` now formats that date directly, without converting it from local
  midnight first.
- **Why:** the page built dates at local midnight, but the engine does its date math
  in UTC only. East of UTC every date moved a day earlier (Asia/Tokyo: P0 gave 10 rows
  instead of 11).
- **Evidence:** Playwright (Chrome) with timezoneId Asia/Tokyo, America/Toronto, UTC
  and Pacific/Honolulu. Two scenarios were run: the default page (156 rows) and a
  personal loan of 1000 at 6%, monthly, from 2026-02-01 to 2026-12-01 (11 rows). In
  all four timezones, the screen table, print table and CSV were identical. The dates
  shown on screen, in print and in the "as of" block equalled the dates typed.

## 2026-09-25

### 7. Headline figure cards (user request 2026-09-24, KPI review F1)

- **What:** the two headline cards stay side by side above 480px and stack one per row
  at 480px and below. Values are 700 weight, tabular, -0.02em tracking, line-height
  1.1, `white-space: nowrap`. `overflow-wrap: anywhere` is gone. The size is
  `min(--kpi-size, 100cqi / --kpi-em)`: `--kpi-size` is `clamp(30px, 3.2vw, 40px)`
  above 480px and `clamp(32px, 9vw, 40px)` at 480px and below. Each card is a size
  container, and `ca.js` sets `--kpi-em` on the headline list to the widest value's
  width in ems, so both values share one size and the widest one fits. Labels are
  13px. The 3-column headline grid at 768–991px (one column empty) was removed.
- **Why:** the user asked on 2026-09-24 for stacked cards on the phone and bigger,
  more visible numbers. Review F1 (`docs/visual_design/results-kpi-review.md`):
  at 375px the values broke mid-figure ("5.33159 / %", "$32,414. / 11").
- **Evidence:** Playwright (Chrome) at 1280, 768, 480, 375 and 320px for the default
  case, a large case (2,000,000 at 7%, 25-year weekly term, COB $1,728,313.08) and
  a variable-rate payment change. Every value was on one line and not clipped, and
  no width had horizontal page scroll. At 1280px the value is 29.4px (default) and
  23.1px (large): each card is 168px wide inside, so a bigger size would clip. The
  print text (times masked) and the CSV are unchanged. Print CSS was not touched.

### 8. Bigger headline figures on tablet and desktop (user decision 2026-09-25)

- **What:** from 992px the form and results columns are equal (`1fr 1fr`, was
  `7fr 5fr`). The breakpoint stays at 992px. Above 480px `--kpi-size` is `40px` (was
  `clamp(30px, 3.2vw, 40px)`), so the size is set by how much room the card has
  (`100cqi / --kpi-em`, unchanged). The phone layout (480px and below) is unchanged.
  `ca.js` is unchanged.
- **This departs from the app on purpose:** the app's results panel is narrower
  (7:5). Here the results take half the width, so the form column is narrower.
  At 1280 and 1440px the form rows go from 3 fields to 2, and at 992–1100px they stay
  at 2. The fee name box and the frequency select show less text before it is cut
  off (it was already cut off before this change).
- **Why:** at 1024px the values were 23.7px, smaller than the old 28px. At 1280px
  they were 29.4px because the cards were too narrow, and on tablets they were held
  at 30px although the cards had room.
- **Evidence:** Playwright (Chrome) at 12 widths × 3 cases. KPI size before → after,
  in px (default 5.33159% / $32,414.11; large $1,728,313.08; variable-rate payment
  change 5.27244% / $34,581.15, sized like default):

  | Width | Layout | Default | Large | VRPC |
  |---|---|---|---|---|
  | 1440, 1280 | side by side | 29.4 → 37.6 | 23.1 → 29.6 | 29.4 → 37.6 |
  | 1100 | side by side | 26.5 → 34.1 | 20.8 → 26.8 | 26.5 → 34.1 |
  | 1024 | side by side | 23.7 → 30.8 | 18.6 → 24.2 | 23.7 → 30.8 |
  | 992 | side by side | 22.6 → 29.4 | 17.7 → 23.1 | 22.6 → 29.4 |
  | 991, 768 | side by side | 31.7/30 → 40 | 31.7/30 → 40 | 31.7/30 → 40 |
  | 600 | side by side | 30 → 40 | 30 → 33.7 | 30 → 40 |
  | 481 | side by side | 30 → 32.4 | 25.5 (same) | 30 → 32.4 |
  | 480 / 375 / 320 | stacked | 40 / 33.8 / 32 (same) | same | same |

  Every value is on one line and not clipped. No width scrolls sideways, value
  contrast is 13.3:1, and there are no JS errors (the only console error is the
  existing favicon 404). At 1024 and 1280 nothing in the form or fee table runs past
  its column. The print text (pdftotext, times masked) and the CSV are byte-identical
  before and after for all three cases. Print CSS was not touched.
  `npm run typecheck && npm test && npm run build` pass (308 tests).

### 9. Headline figures reach 44px on desktop, still side by side (user decision 2026-09-25)

- **What:** the cards stay side by side above 480px. Each value gets more width:
  KPI card side padding 16 → 10px (`padding: 14px 10px`), gap between the cards
  12 → 8px, the results panel (from 992px) `padding: 24px` → `20px 12px`, and the
  form/results `column-gap` (from 992px) 32 → 24px. Above 480px `--kpi-size` is
  `48px` (was 40px), so the card width decides. Value tracking is -0.03em (was
  -0.02em). In `ca.js`, `kpiValueEm()` now uses measured Inter 700 tabular widths
  (digits 0.647em, `$` 0.655em, `%` 1.016em) and a 1% margin (was 0.655em for all
  digits and 2%). In Chrome, system-ui and Arial are no wider. The label stays 13px,
  600, muted, and wraps if needed. The wording is unchanged. The phone layout (480px
  and below) keeps `clamp(32px, 9vw, 40px)`. Figure rows, More figures, schedule,
  print CSS, CSV and the form rules are unchanged.
- **Why:** the user said the numbers were not big enough and chose to keep the cards
  side by side, trim the padding and reach about 44px.
- **Evidence:** Playwright (Chrome) at 12 widths × 3 cases. KPI size before → after,
  in px:

  | Width | Layout | Default | Large ($1,728,313.08) | VRPC |
  |---|---|---|---|---|
  | 1440, 1280 | side by side | 37.6 → 44.2 | 29.6 → 34.8 | 37.6 → 44.2 |
  | 1100 | side by side | 34.1 → 40.5 | 26.8 → 31.9 | 34.1 → 40.5 |
  | 1024 | side by side | 30.8 → 37.1 | 24.2 → 29.2 | 30.8 → 37.1 |
  | 992 | side by side | 29.4 → 35.6 | 23.1 → 28 | 29.4 → 35.6 |
  | 991, 768 | side by side | 40 → 48 | 40 → 48 | 40 → 48 |
  | 600 | side by side | 40 → 47.1 | 33.7 → 37 | 40 → 47.1 |
  | 481 | side by side | 32.4 → 36.2 | 25.5 → 28.5 | 32.4 → 36.2 |
  | 480 / 375 / 320 | stacked | 40 / 33.8 / 32 (same) | same | same |

  In all 36 runs every value is on one line and not clipped, and the page never
  scrolls sideways. Contrast is 13.3:1 for values and 4.6:1 for labels (same as
  before). There are no JS errors; the only console error is the existing favicon
  404. Nothing in the form or fee table runs past its column. The print text
  (pdftotext, times masked) and the CSV are byte-identical before and after for all
  three cases. `npm run typecheck && npm test && npm run build` pass (308 tests).

### 10. Contract terms as KPI-style tiles (user request 2026-09-25)

- **What:** the "Contract terms — as of <date>" block (same place, between the form
  and the schedule, hidden with the results) is no longer one grey box. It is a
  heading (16px) over a `<dl>` of tiles, one `<div>` (`dt` + `dd`) per term, styled
  like the headline cards: raised card surface, 3px accent top border, label 13px
  600 muted, value below it 700 weight, tabular, -0.02em tracking, heading colour.
  - Size: 26px from 992px, 24px at 481–991px, 22px at 480px and below, 20px below
    375px. Amounts, rates, dates and single words (`.term-value--fit`) stay on one
    line: the size is `min(--term-size, 100cqi / --term-em)`, where each tile is a
    size container and `ca.js` (`fitTermValues()`) sets `--term-em` to the value's
    width in ems, measured in the page font with a 2% margin and again after
    `document.fonts.ready`. Flow, Product type and Contract term may wrap between
    words ("3 years," / "0 months"; each part has a no-break space).
  - Grid: `repeat(auto-fill, minmax(200px, 1fr))` from 992px (5 per row at 1280),
    2 per row below 992px, 1 per row below 375px.
  - Fees: one tile, 2 columns wide (full width below 992px). Each fee is
    "Name — $amount" at 18px with a small "Financed" / "Not financed" tag; the name
    wraps by word, the amount doesn't. "No fees" when there are none.
  - Order as before, except Accrued interest (non-new flows) now follows Payment
    amount so the amounts sit together.
  - Format fixes: Contract rate is the field as typed plus "%" (like the app's print
    record: "3.74%", was "3.7400%"). Payment frequency uses the app's labels
    (`FREQUENCY_LABELS` in `app/web/src/form/rules.ts`, the same as
    `PRINT_FREQUENCIES` here: "Weekly", "Bi-weekly", "Semi-monthly", "Monthly"; was
    the select text, e.g. "Weekly (52/yr, incl. Accelerated Weekly)"). Fees read
    "No fees" (was "None"). Amounts and dates are unchanged ($227,829.65,
    Mar 17, 2026). `percentFmt()` was only used here and is gone.
  - The results card, schedule, print CSS, printout and CSV are unchanged.
- **Why:** the user asked for the block to look like the KPI cards, with bigger
  values.
- **Evidence:** Playwright (Chrome) at 1440, 1280, 1024, 768, 480, 375 and 320px ×
  4 cases: (a) default new mortgage with 2 fees, (b) renewal, accrued interest
  123.45, fee "CMHC mortgage default insurance premium", (c) no fees, (d) loan
  2,000,000, payment 4,200. Value size before → after, in px:

  | Width | Per row | (a), (b), (c) | (d) | Fees |
  |---|---|---|---|---|
  | 1440, 1280 | 5 | 14 → 26 | 14 → 26 | 14 → 18 |
  | 1024 | 4 | 14 → 26 | 14 → 26 | 14 → 18 |
  | 768 | 2 | 14 → 24 | 14 → 24 | 14 → 18 |
  | 480 | 2 | 14 → 22 | 14 → 22 | 14 → 18 |
  | 375 | 2 | 14 → 22 | 14 → 22 ($2,000,000.00: 20.3) | 14 → 18 |
  | 320 | 1 | 14 → 20 | 14 → 20 | 14 → 18 |

  In all 28 runs every amount, rate, date and fee amount is on one line and not
  clipped, the page never scrolls sideways, and there are no JS errors. Contrast is
  4.62:1 for labels (and the fee tag, same colours) and 13.3:1 for values. The
  block is hidden on invalid input (loan -5). The print text (pdftotext, times
  masked) and the CSV are byte-identical before and after for all 4 cases. Print
  CSS was not touched. `npm run typecheck && npm test && npm run build` pass
  (308 tests).

## 2026-09-27

### 11. Engine: last payment follows the workbook (OQ-K / OQ-T)

- **What:** reverts DQ-28 (DEV-011-3, item 1). On the payoff row, interest and fees
  are paid as before and principal paid = the remaining principal, but the row's
  Payment (`paymentAmount`, waterfall `amountPaid`) is now the remaining principal
  only. Total of all payments sums that figure, so it leaves out the payoff row's
  interest and fees. Other rows, DQ-27, D9/D8 and the End Date exit are unchanged.
  The UI needs no change: it shows `paymentAmount` and `totalPayment` as they come.
- **Why:** user decision 2026-09-27 to follow the workbook exactly (macro
  `CalculateAll`: `pymtAmnt = currPrinciple`). COB-user-stories §7 OQ-K / OQ-T,
  US-15.
- **Evidence:** the new `tests/ca/lastPayment-oqk.test.ts` (a hand-computed 3-row
  payoff, a row-1 payoff, the no-payoff boundary, zero payment rejected, and the
  invariant sum(Payment) == Total of all payments) failed before the change and
  passes after it. The tests that asserted DQ-28 now assert the workbook rule
  (`equations`, `invariants` #2, `spec011-d9` I-011-13). 012 D-07 (`defects012`)
  and the S5_payoff fixture parity now match the oracle, so the `.fails` was
  removed and S5's `known_divergence` in `ca_app_wire_vectors.json` is now `[]`.
  `npm test`: 365 passed, 3 todo. `npm run typecheck` passes.

### 12. Engine: rate selection follows the workbook (OQ-C, DQ-30)

- **What:** the Calculated Rate now follows the workbook's rate basis (new
  `selectRateBasis`, `calculatedRateFor` in `src/ca/equations.ts`). Fixed-rate
  mortgages (SEMI-ANNUAL) are converted as before: `n × ((1 + i/2)^(2/n) − 1)`.
  Variable-rate mortgages and personal loans of either rate type (MONTHLY) use the
  contract rate unconverted and exact at every frequency. Personal loans were
  converted from m = 12, which was wrong at weekly, bi-weekly and semi-monthly. The
  variable mortgage went through m = n and carried floating-point noise (e.g.
  5.999999999999517). `selectCompoundingPeriodsPerYear` now returns m = n for
  personal loans. The UI's Calculated rate caption says only fixed-rate mortgages are
  converted.
- **Why:** OQ-C, settled 2026-09-27 from the workbook: `Calculator!D10 =
  IF(RateType="MONTHLY", MonthlyRate, XLOOKUP(Freq, r_Freq, r_EquivalentRate))`, read
  by the macro's `getRate` as `aRate = D10 / 100`.
- **Evidence:** QA's new `tests/ca/rateSelection-oqc.test.ts` (33 tests, 18 failed
  before the change) passes. Old-rule tests now assert the new rule: `equations`
  (personal loan m = n; invariant #5 is now "only the semi-annual rate is converted")
  and the `cobCanada` leap-year row, recomputed by hand at 6% unconverted (row 5
  interest 53.0034672709 → 53.1057862215, opening balance 46223.195571 →
  46223.625106). The personal-loan fixtures (`d9_oracle_vectors.json` P1,
  `ca_defect_012_vectors.json`) are monthly only, so m = 12 already equalled m = n
  and they are unchanged. Also: invariant #2's title now names the payoff-row
  exception, and S9's `known_divergence` drops `008 B6` and `011 DEV-011-3` (resolved
  in item 11; S9 still diverges on B1/B3/DEV-011-1). `npm test`: 401 passed, 3 todo.
  `npm run typecheck` passes.

### 13. Engine: monthly dates clamp to month-end (T3, 008 E1/C1, 012 D-03)

- **What:** T3 2026-09-27: monthly DateAdd month-end clamp. Monthly payment dates
  (new `addMonthsClamped` in `src/ca/cobCanada.ts`) now clamp the day to the last
  day of the target month instead of overflowing. A first payment on Jan 31 gives
  Jan 31, Feb 28 (Feb 29 in a leap year), Mar 31, Apr 30, and so on. Before, Jan 31
  + 1 month was Mar 3, so a schedule had two March payments and no February one.
  Every date is still counted from the First Payment Date. Other frequencies are
  unchanged.
- **Why:** the macro's `getNextMonthly` uses VBA `DateAdd("m", k, firstPymtDate)`,
  which clamps. The clamp matches DateAdd. The business's month-end rule OQ-X
  (a First Payment Date on the last day of its month keeps every payment on the
  last day of its month) is a planned intentional difference from the workbook and
  is not in this change: a start on Feb 28 or Apr 30 still steps to the 28th or 30th.
- **Evidence:** QA's new `tests/ca/monthlyDates-t3.test.ts` (15 tests, 12 failed
  before the change) passes. 012 D-03 (`defects012`: the three `D03_*` vectors and
  S2_monthly_jan31) now matches the oracle on every compared total, rate and row
  field, so the `.fails` was removed. S2_monthly_jan31's fixture parity matches on
  all 137 compared fields (13 rows, largest relative error 1.3e-15), so its
  `known_divergence` in `ca_app_wire_vectors.json` is now `[]`. No fixture values
  changed. `npm test`: 416 passed, 3 todo. `npm run typecheck` and `npm run build`
  pass.

### 14. Engine: monthly month-end rule (OQ-X, intentional difference from Excel)

- **What:** OQ-X 2026-09-27: month-end rule. If the First Payment Date is the last
  day of its month, every monthly payment now falls on the last day of its month
  (new `isLastDayOfMonth` step in `addMonthsClamped`, `src/ca/cobCanada.ts`):
  Apr 30 2027 -> May 31 -> Jun 30; Feb 28 2027 -> Mar 31; Feb 29 2028 -> Mar 31 ->
  ... -> Feb 28 2029; Nov 30 -> Dec 31 -> Jan 31 -> Feb 29 2028. Other start days
  keep the T3 clamp (Jan 30 -> Feb 28 -> Mar 30; Feb 28 2028 is not a month-end and
  stays on the 28th). Dates are still counted from the First Payment Date; interest
  day counts and the End Date exit follow the new dates. Monthly only; semi-monthly
  (T4) is unchanged.
- **Why:** business decision 2026-09-27 (`COB-user-stories.md` §7.3 OQ-X). This is an
  **intentional difference from the Excel workbook**, whose `DateAdd("m")` keeps the
  day number (Feb 29 -> Mar 29). The workbook vector
  `D03_monthly_rowcount_2028-02-29` therefore no longer matches the workbook dates.
- **Evidence:** QA's `tests/ca/monthlyMonthEnd-oqx.test.ts` (21 tests, 13 failed
  before) passes against `tests/ca/fixtures/ca_oqx_vectors.json`. In `defects012`,
  `D03_monthly_rowcount_2028-02-29` is listed in `OQX_INTENTIONAL_DIVERGENCE`, and its
  `it.fails` "full workbook parity -- intentional divergence OQ-X" now passes. No
  tests or fixtures changed. `npm test`: 438 passed, 3 todo (before: 14 failed,
  424 passed). `npm run typecheck` and `npm run build` pass.

### 15. Engine: semi-monthly dates follow the workbook (T4, 008 E1/C1, 012 D-01)

- **What:** T4 2026-09-27: semi-monthly getNextSemiMonthly port. Semi-monthly dates
  are no longer evenly spaced (`round(i x 365.25 / 24)` days). New
  `nextSemiMonthlyDate` in `src/ca/cobCanada.ts` ports the macro's
  `getNextSemiMonthly` and `getNextEOM` exactly, quirks kept, and dates are chained:
  payment #1 is the First Payment Date, each later one is
  `nextSemiMonthlyDate(firstPaymentDate, previousPaymentDate)`. A 15th or month-end
  start gives 15th / month-end; a 30th in a 31-day month gives 15th / 30th; a 16th
  gives 1st / 16th; dates on or before the 15th are capped at the month-end (Feb 28
  or 29). The monthly month-end rule OQ-X does not apply. The End Date exit is
  unchanged (a payment on the End Date is kept). Weekly, bi-weekly and monthly are
  unchanged.
- **Why:** 008 E1/C1 and 012 D-01: the workbook's semi-monthly calendar differs from
  even spacing.
- **Evidence:** QA's `tests/ca/semiMonthlyDates-t4.test.ts` (58 tests, including a
  731-date sweep against `tests/ca/fixtures/ca_semimonthly_vectors.json`; 56 failed
  before) passes. In `defects012`, the nine D-01 vectors and S4_semimonthly now match
  the oracle, so `.fails` was removed. S4_semimonthly's fixture parity matches on all
  256 compared fields (25 rows, largest relative error 1.6e-15), so its
  `known_divergence` in `ca_app_wire_vectors.json` is now `[]`. No fixture values
  changed. `npm test`: 496 passed, 3 todo (before: 56 failed, 440 passed).
  `npm run typecheck` and `npm run build` pass.

### 16. Engine: unpaid period interest stays in the Loan balance (T6, OQ-L, 012 D-02)

- **What:** T6 2026-09-27: OQ-L unpaid interest carried in balance. When a payment
  doesn't cover the interest due, the unpaid period interest stays owing, is paid
  first from later payments, is part of the Loan balance (closing and next opening)
  and is charged interest next period. The principal step is capped at
  `openingBalance - feesOpening - unpaid period interest`. `totalInterest`, and so C,
  now count interest accrued (sum of interest paid plus period interest still unpaid
  after the last row). `buildSchedule` in `src/ca/cobCanada.ts` tracks unpaid period
  interest apart from IN-11 past accrued interest (`accruedInterest`), whose
  treatment is OQ-W (open) and is unchanged: carried outside the balance, earning no
  interest, counted in C as paid. While IN-11 is outstanding, an interest shortfall
  is carried with it under the old rule (ordering of the two is part of OQ-W).
  UI: "Total interest paid" is now "Total interest" (with a hint), and the schedule's
  "Interest paid" column total is the sum of that column.
- **Why:** OQ-L (settled: workbook behaviour). CalculateAll: `newInt = openingBalance
  * appliedRate`, `newBalance = newFees + newPrinciple + intAccrued -
  totalInterestPaid`, `COB = intAccrued + finFee + nonFinFee`.
- **Evidence:** QA's 7 OQ-L tests in `tests/ca/engineRules-t5.test.ts` pass. 012 D-02
  (scenario A and S6_underpay) matches the oracle, so `.fails` was removed. S6's
  fixture parity now matches on all 141 numeric fields (max relative error 4.1e-16).
  Engine output for 1,445 IN-11 scenarios (`accruedInterest > 0`: every existing test
  scenario plus a grid over the three flows, four frequencies, five amounts, nine
  payments, with and without fees) is byte-identical before and after. Pending QA:
  the `S6_underpay` `known_divergence` entry and the spec 011 invariants I-011-10 /
  I-011-11 on underpayment inputs (see the T6 report).

### 17. Engine: a $0 payment is allowed, like Excel (T7, OQ-Y)

- **What:** T7 2026-09-27: OQ-Y $0 payment allowed. This replaces the earlier
  deliberate rejection of a zero payment (`paymentAmount must be > 0`). A payment of
  exactly 0 is accepted: the schedule runs to the End Date with interest, fees and
  principal paid all 0, and unpaid interest carries forward and is charged interest
  (OQ-L, entry 16). Negative, `NaN`, `null` and `undefined` payments are still
  rejected (`paymentAmount must be >= 0`) in `validateCobCanadaInput`
  (`src/ca/validate.ts`), `applyPaymentWaterfall` and `triggerRatePercent`
  (`src/ca/equations.ts`). A $0 payment gives a trigger rate of 0%.
  UI: an empty Payment field is treated as missing (the engine's error is shown and
  nothing is calculated); a typed 0 is accepted.
- **Why:** OQ-Y (user decision 2026-09-27, `COB-user-stories.md` §7.5): match the
  workbook. BRD §6: mandatory fields must be completed before calculation.
- **Evidence:** QA's 33 tests in `tests/ca/zeroPayment-oqy.test.ts` pass (fixture
  `ca_oqy_zero_payment_vectors.json`). Four older zero-payment rejection tests now
  use -1 ("negative payment rejected"): `validate.test.ts`, `equations.test.ts`,
  `lastPayment-oqk.test.ts`, `spec011-d9.test.ts`.

### 18. Structure: CA engine decoupled from the US library; CA public barrel (A2, A3)

- **What:** A2 2026-09-27: `PaymentFrequency` is declared in `src/ca/types.ts` (same
  literal union as `src/types.ts`); `src/ca/types.ts` and `src/ca/cobCanada.ts` no
  longer import `../types.js`. The note at the top of this file about `types.ts`
  importing `PaymentFrequency` from `../types.js` no longer applies. `fees.ts` still
  imports `round2` from `../money.js` (B1).
  A3 2026-09-27: new `src/ca/index.ts`, the CA public API: `calculateCobCanada`,
  `PAYMENTS_PER_YEAR` and the types `CobCanadaInput`, `CobCanadaResult`,
  `CobScheduleRow`, `CobFlow`, `ProductType`, `RateType`, `PaymentFrequency`.
  `src/index.ts` re-exports the CA engine and types from it; its export surface is
  unchanged. `ui/ca.js` imports `/dist/ca/index.js`. New `npm run test:tz` runs the
  golden master and F6 under `TZ=America/Toronto` and `TZ=Pacific/Kiritimati`.
- **Why:** COB-architecture.md §5 A2/A3, ADR-05. No behaviour change.
- **Evidence:** golden master (`tests/ca/golden`) unchanged and green; the F1 [A2] and
  F2 [A3] `it.fails` now pass and were changed to `it`. New export snapshot
  `tests/api/exportSurface.test.ts` (root list green before and after; written by the
  developer, pending QA review). REF-01 through `dist/ca/index.js` and the old
  `dist/index.js` gives the same result JSON (sha256 `14c8c98b…`).

### 19. Engine: numeric inputs must be real finite numbers (B3a, 012 D-11, BRD §6)

- **What:** B3a 2026-09-27. New `isFiniteNumber(x)` in `src/ca/types.ts`
  (`typeof x === 'number' && Number.isFinite(x)`), used by every numeric guard in
  `validate.ts` (`loanAmount`, `contractRatePercent`, `paymentAmount`,
  `accruedInterest`), `fees.ts` `validateFee` (fee `amount`) and `equations.ts`
  (`applyPaymentWaterfall`'s five parameters, `triggerRatePercent`'s three). Numeric
  strings, `''`, booleans, arrays, objects, `null`, `NaN` and `±Infinity` now throw a
  `RangeError` naming the field (`<field> must be a finite number, got …`); messages
  for negative values are unchanged. `accruedInterest` is absent or a finite number
  `>= 0`; `null` is rejected (ruling R1). `principalOutstanding` gets the finite check
  only, no sign check (ruling R2). `flow`, `productType`, `rateType` and
  `paymentFrequency` are checked against own-key allowlists (inherited keys such as
  `'toString'` are rejected). `fees` must be an object with a `fees` array, and each
  fee must be an object. The fee-amount check runs before the BRD §6 fee-limit check.
- **Why:** 012 D-11 / BRD §6 (COB-architecture.md §5 B3a, rev 3). JavaScript `>=`
  coerced `''`, `false` and `[]` to 0, so a blank or garbage payment became a $0
  schedule (since T7, OQ-Y), and `Infinity` passed as-is.
- **Evidence:** QA's `tests/ca/numericGuard-b3a.test.ts` goes from 139 failing to all
  green (file unchanged, sha256 `3343bc98…8369`). The 4 `it.fails` in
  `zeroPayment-coercion-oqy.test.ts` and the D-11 `it.fails` in `defects012.test.ts`
  now pass and were changed to `it`. Full suite 1040 passed, 3 todo; typecheck clean;
  `test:tz` green. Golden master byte-identical (sha256 `c190e944…1b35`). UI input
  building (`ui/ca.js`) unchanged; UI-shaped inputs (all flows, blank optional fields,
  blank accrued interest, blank fee amount) still calculate through `dist/ca/index.js`.
  A blank payment now reads "paymentAmount must be a finite number, got NaN" instead
  of "… must be >= 0, got NaN" (wording is Q-MSG).

### 20. Structure: `types.ts` owns `Fee` / `FeeSchedule`; both on the CA public API (A16, F5)

- **What:** the `Fee` and `FeeSchedule` interfaces (with their doc comments) moved
  from `src/ca/fees.ts` to `src/ca/types.ts`, which now imports nothing in `src/ca`.
  `fees.ts` imports them from `./types.js` and re-exports them
  (`export type { Fee, FeeSchedule } from './types.js'`), so existing import paths
  stay valid. `src/ca/index.ts` adds `Fee` and `FeeSchedule` as type exports.
  Type-only change: no runtime behaviour changed.
- **Why:** COB-architecture.md §5 A16. F5 failed on `types.ts` importing
  `FeeSchedule` from `fees.ts` (types → fees). Exporting `Fee` / `FeeSchedule` from
  the barrel is a user decision (2026-09-27).
- **Evidence:** QA's `tests/api/a16-fee-types.test.ts` and the CA type-export list in
  `tests/api/exportSurface.test.ts` go from red to green. The F5 `it.fails('F5 [A16]: …')`
  in `tests/architecture/f5-layering.test.ts` now reports as failing because the check
  passes (QA removes the `.fails`). Full suite 1046 passed, 1 failed (that F5), 3 todo;
  typecheck clean; build OK; `test:tz` green. Golden master byte-identical (sha256
  `c190e944…1b35`). Runtime keys of `dist/ca/index.js` still
  `["PAYMENTS_PER_YEAR","calculateCobCanada"]`.
  **QA verification (PASS WITH NOTES):** F5 `.fails` removed; full suite 1047 passed,
  3 todo, 0 failed. Golden and REF-01 output byte-identical to the pre-A16 build.

### 21. Engine: fee totals are unrounded sums (B1, 012 D-10, OQ-H)

- **What:** B1 2026-09-27. `totalFees`, `totalFinancedFees`, `totalCashFees` and
  `totalFeesIncludedInCob` in `src/ca/fees.ts` return the plain left-to-right sum of
  `fee.amount` over the same filter as before, with no `round2`. The
  `import { round2 } from '../money.js'` line is deleted: this was the last import
  from `src/ca` into the US library, so `src/ca` now imports nothing outside itself.
  **Behaviour change** only where a fee sum differs from its value rounded to the
  cent, which includes the BRD §6 fee-limit check at sub-cent boundaries: a loan of
  1000.004 with a fee of 1000.004 is now rejected (it used to round to 1000.00 and
  pass), and fees summing to 999.999 (or a financed fee of 999.996) on a 1000 loan
  are now accepted (they used to round to 1000.00 and be rejected). A financed fee of
  100.004 now gives `cobAmount - totalInterest` of 100.004, not 100.00.
- **Why:** OQ-H (resolved: no `Round()` in the macro; full precision throughout,
  display rounds only), ADR-02, 012 D-10; COB-architecture.md §5 B1 (revision 4:
  moved ahead of A15 to clear A15-1).
- **Evidence:** QA's `tests/ca/b1-unrounded-fees.test.ts` (sha256 `8b3dd458…`,
  fixture `b1_unrounded_fee_vectors.json`) goes from 20 red to 26 of 26 green. The
  four `it.fails` F1 [B1], F4 [B1] and the two D-10 tests in `defects012.test.ts` now
  report as failing because their checks pass (QA removes the `.fails`). Full suite
  1069 passed, 4 failed (those four), 3 todo; typecheck clean; build OK; `test:tz`
  green (164 + 164). Golden master byte-identical, **no regeneration** (sha256
  `c190e944…1b35`).

### 22. Structure: US-mortgage library deleted; root API is the CA barrel (A15, ADR-13(b))

- **What:** A15 2026-09-27. Deleted exactly 35 files (a scratchpad copy is kept until the
  QA verdict):
  - `src/` (18): `arm.ts`, `compare.ts`, `costs.ts`, `dscr.ts`, `extraPayment.ts`,
    `importOverrides.ts`, `loan.ts`, `ltv.ts`, `money.ts`, `mortgage.ts`, `payment.ts`,
    `paymentFrequency.ts`, `pmi.ts`, `points.ts`, `refinance.ts`, `segment.ts`, `types.ts`,
    `validate.ts`.
  - `tests/` (15, 93 tests): `arm`, `compare`, `costs`, `dscr`, `extraPayment`,
    `importOverrides`, `loan`, `ltv`, `mortgage`, `payment`, `paymentFrequency`, `pmi`,
    `points`, `refinance`, `segment` (`.test.ts`).
  - `ui/` (2): `index.html`, `main.js`.

  Rewritten: `src/index.ts` is now a named re-export of `./ca/index.js` (runtime
  `PAYMENTS_PER_YEAR`, `calculateCobCanada`; the 9 CA public types; no `export *`).
  `ui/serve.mjs` no longer mentions the legacy US page (header comment and listen
  banner). `src/ca/types.ts` header no longer cites `src/payment.ts`, `src/segment.ts` or
  `src/mortgage.ts` (the remaining stale citations are left for A14). `README.md` describes
  the COB calculator and `ui/ca.html`. The `package.json` description is "Cost of
  Borrowing (COB) calculator engine (Canada)". `dist/` is untouched (stale US output goes
  in A13).
- **Why:** User decision 2026-09-27: delete the US library (delete, not move; exactly these
  35 files). COB-architecture.md §5 A15 (revision 4); the public API change is ADR-13(b):
  the root drops the 24 US runtime exports, the 18 CA internals and 31 type names, gains
  `PAYMENTS_PER_YEAR`, and its `PaymentFrequency` is now the CA type.
- **Evidence:** QA's red tests went green: `tests/api/exportSurface.test.ts` (3) and the
  A15 guard in `tests/architecture/f10-imports-resolve.test.ts` (5). F10 green. Full suite
  before: 1076 passed, 8 failed (those 8), 3 todo (1087); after: 991 passed, 0 failed,
  3 todo (994) = 1084 − 93. Typecheck clean; build OK; `test:tz` green (164 + 164).
  Golden master byte-identical, no regeneration (sha256 `c190e944…1b35`). `npm run ui`:
  `/`, `/ui/ca.html`, `/ui/ca.js`, `/dist/ca/index.js` return 200; `/ui/index.html` 404.

### 23. Tooling: build, serve and timezone hygiene (A13)

- **What:** A13 2026-09-27. No `src/` change.
  - `package.json`: new `clean` script (`node -e "require('fs').rmSync('dist',{recursive:true,force:true})"`;
    `node -e` runs as CommonJS even though the package is `"type": "module"`). `build` is
    now `npm run clean && tsc -p tsconfig.json`. `test:tz` is the spec command:
    `tests/ca/golden` and the whole of `tests/architecture` under `TZ=America/Toronto`, then
    `TZ=Pacific/Kiritimati`.
  - `ui/serve.mjs`: serves only `/ui/**`, `/dist/**` and `/package.json`; `/` still serves
    `ui/ca.html`. The path is decoded (malformed encoding gives 404), resolved against the
    project root, and the resolved path must lie inside `ui/` or `dist/` or equal
    `package.json`; anything else is 404. This covers `..`, `%2e%2e`, `..%2f` and
    `/package.json/../README.md`. Port behaviour unchanged. Header comment updated.
  - `npm run build` was run: the live `dist/` no longer holds `biweekly.*` or the 18 US
    modules' output (it now holds only `index.*` and `ca/`).
- **Why:** COB-architecture.md §5 A13 (revision 4): stale US output left by A15; F6 CI
  half (`test:tz` over all architecture tests); the dev server exposed the whole project
  root (src, tests, fixtures, parent directory via `..`).
- **Evidence:** QA's 22 red tests went green: `tests/tooling/a13-build-scripts.test.ts` (6)
  and `tests/tooling/a13-serve.test.ts` (16). Full suite: 1026 passed, 0 failed, 3 todo
  (1029). Typecheck clean; build OK; `test:tz` green (196 + 196). Golden master
  byte-identical, no regeneration (sha256 `c190e944…1b35`). `npm run ui` equivalent
  (curl, PORT=5199): `/`, `/ui/ca.js`, `/dist/ca/index.js`, `/package.json` 200 (title
  "Cost of Borrowing Calculator | Alterna Savings"); `/README.md`,
  `/ui/%2e%2e/src/index.ts`, malformed `%E0%A4%A` 404. No server processes left running.

### 24. Engine: fee limit counts financed + non-financed fees (B2, 012 D-08, OQ-M)

- **What:** B2 2026-09-27. `src/ca/validate.ts` only. The fee-limit check now rejects when
  `!(totalFinancedFees(fees) + totalCashFees(fees) < loanAmount)` (previously financed
  fees only). The sum is the two group totals added once, not `totalFees()`. Message:
  `total fees (financed + non-financed) (X) must be less than loanAmount (Y)`, X the
  grouped sum, Y `loanAmount`, both raw; the " (BRD §6)" suffix is dropped. Position in
  the check order unchanged (after the numeric/type checks, B3a). The stale "only financed
  fees count" comment and doc header are corrected.
- **Why:** OQ-M (financed + non-financed fees must be less than the loan amount); 012 D-08;
  COB-architecture.md §5 B2 ruling B2-R1 / invariant B2-INV-grouping (revision 5): macro
  lines 174-184 test `If (finFee + nonFinFee) >= loanAmt`, two group operands (lines
  117-118). Message wording is the user's "Q-MSG interim (fee limit)" decision
  (COB-user-stories.md §7.5); Q-MSG itself stays open.
- **Evidence:** QA's 12 red tests went green: `tests/ca/b2-fee-limit.test.ts` (10, fixture
  `b2_fee_limit_vectors.json`, incl. G1/G2 grouping) and `tests/ca/validate.test.ts` (2).
  Full suite before: 1035 passed, 12 failed, 3 todo (1050); after: 1045 passed, 2 failed,
  3 todo (1050). The 2 failures are the D-08 `it.fails` in `tests/ca/defects012.test.ts`
  now passing, left for QA to remove. Typecheck clean; build OK; `test:tz` green
  (196 + 196). Golden master byte-identical, no regeneration (sha256 `c190e944…1b35`).
  Built engine with a UI-shaped input (loan 1000, financed 400 + non-financed 600) throws
  `total fees (financed + non-financed) (1000) must be less than loanAmount (1000)`, which
  `ui/ca.js` shows verbatim via `err.message`.
  **QA verification (PASS WITH NOTES):** D-08 `.fails` removed; 1047 passed, 3 todo, 0 failed.
  Old vs new builds on 70,000 inputs: identical output wherever both accept, and every new
  rejection matches the macro oracle. The B1 fixture was regenerated to fix its `rule` text
  only (sha `86a05876…`).

### 25. Engine: dates validated by name, ordered on UTC calendar dates (B3b, 012 D-12)

- **What:** B3b 2026-09-27. `src/ca/validate.ts` only (two local helpers,
  `requireValidDate` and `utcCalendarDay`). Each date the chosen flow uses must be a real
  `Date` (`instanceof Date`, so objects that only have `getTime` are rejected) with a finite
  time, else `RangeError: <field> must be a valid Date`: `firstPaymentDate`, `endDate`,
  `disbursalDate` (new loan), `renewalDate` (renewal / paymentChange / VRPC) and
  `semiAnnualCompoundingDate` (fixed mortgage only, where it was already required; Q-SACD
  stays open). A missing start date keeps `flow '<flow>' requires <field>`. The three
  ordering checks now compare UTC Y/M/D (`getUTC*`), not timestamps: start == first payment
  is allowed, `endDate <= firstPaymentDate` is rejected. The endDate message is now
  `endDate must be after firstPaymentDate (compared as UTC calendar dates)`; the old
  "otherwise the schedule generates zero payments" was wrong (the inclusive rule gives one
  row, D-12). Non-midnight times are not rejected; dates the flow doesn't use are not checked.
- **Why:** 012 D-12; BRD §6 (date validation: start not after first payment, end after first
  payment); macro `ValidateInput` IsDate per field (lines 216, 268, 301), `firstPymtDate <
  disbDate` (271), `eDate <= firstPymtDate` (304). COB-architecture.md §5 B3b.
- **Evidence:** QA's 33 red tests in `tests/ca/b3b-date-validation.test.ts` went green (71/71
  in the file; also 71/71 under TZ=America/Toronto and TZ=Pacific/Kiritimati). Full suite
  after: 1111 passed, 7 failed, 3 todo (1121); the 7 are the D-12 `it.fails` in
  `tests/ca/defects012.test.ts` now passing, left for QA to remove. Typecheck clean; build OK;
  `test:tz` green (196 + 196). Golden master byte-identical, no regeneration (sha256
  `c190e944…1b35`). Built engine with UI-shaped inputs (dates via `Date.UTC` midnight) is
  accepted for all four flows under UTC, America/Toronto and Pacific/Kiritimati.

### 26. Tests: 012 D-05 retired as deviation DEV-OQS (B6, OQ-S) — tests only, by QA

- **What:** B6 2026-09-27. No engine change. In `tests/ca/defects012.test.ts` the D-05
  `it.fails` is replaced by a `DEV-OQS` block: one `known_divergence DEV-OQS` test keeps the
  workbook S1_fees values (macro oracle, unedited) and pins that the engine differs from them
  only in `feesOpening` / `feesPaid` / `feesClosing` / `principalPortion` (Excel: fee bucket
  F + N = 2500, principal = loan − F − N; engine: F = 2000). Four BRD tests pin S1_fees
  against `d9_oracle_vectors.json` S1_financed_only (macro oracle with non_fin_fee = 0):
  every row equal; cash fee not in the waterfall or principal; no interest on it; C =
  interest + F + N and the COB rate scales by (I + F + N) / (I + F). `ca_app_wire_vectors.json`:
  `known_divergence` "011 DEV-011-1" → "DEV-OQS (OQ-S 2026-09-27; spec 011 DEV-011-1)" for
  S1_fees and S9_fees_payoff (same rule). Edited in place: its generator exists only in the
  archive and is already out of date with this file.
- **Why:** OQ-S decided for the BRD 2026-09-27 (BR-04, IN-07): cash fees are paid
  separately and count only in C. Intentional difference from Excel, register row DEV-OQS
  (COB-architecture.md §2.1). COB-architecture.md §5 B6.
- **Evidence:** full suite 1122 passed, 3 todo (was 1118 + 3 todo: −1 `it.fails`, +5
  tests). Typecheck clean; `test:tz` green (196 + 196). Golden master byte-identical
  (`c190e944…1b35`); `src/` untouched.

## 2026-09-28

### 27. Structure: `calendar.ts` is the one home for date rules (A4)

- **What:** A4 2026-09-28, refactor, no behaviour change. New `src/ca/calendar.ts` (imports
  only `PaymentFrequency` from `types`) exports exactly `addMonthsClamped`, `addUtcDays`,
  `dayCountFraction`, `daysBetween`, `daysInUtcMonth`, `endOfUtcMonth`, `isLastDayOfMonth`,
  `isLeapYear`, `nextSemiMonthlyDate`, `periodDateFor`, `utcDateOnly`. `MS_PER_DAY` stays
  private. The bodies and doc comments were moved unchanged from `cobCanada.ts` (the date
  helpers and `periodDateFor`) and `equations.ts` (`MS_PER_DAY` through `dayCountFraction`).
  `equations.ts` imports `dayCountFraction` and re-exports `daysBetween` / `dayCountFraction`
  from `./calendar.js`. `cobCanada.ts` imports `dayCountFraction`, `daysBetween` and
  `periodDateFor` from `./calendar.js`. `validate.ts` drops its private `utcCalendarDay`
  (same expression) and uses `utcDateOnly` from `./calendar.js` in the three date-ordering
  checks, so the messages are unchanged. The two integer day-count `Math.round` lines carry
  `// fitness:day-count` on the same line. `package.json` `test:tz` now also runs the five
  date test files in both zones. Semi-monthly logic and time-of-day handling are unchanged:
  the semi-monthly index 0 still returns the input `Date` itself, as pinned.
- **Why:** COB-architecture.md §5 A4 (revision 6), §3.2 (one home per rule); F4 marker;
  F5 edge validate → calendar; B3b follow-ups (`utcCalendarDay`, date tests under `test:tz`).
- **Evidence:** QA's red `tests/ca/calendar-a4.test.ts` (12) and the `test:tz` string test in
  `tests/tooling/a13-build-scripts.test.ts` (1) went green. Full suite 1140 passed, 1 failed,
  3 todo (1144). The 1 failure is `F4 [A4]` now passing under its `.fails`, which QA removes.
  Typecheck clean. The build emits `dist/ca/calendar.*` (1:1 with `src`). `test:tz`: 379
  passed per zone under America/Toronto and Pacific/Kiritimati, plus the same `F4 [A4]` flip
  (380 tests). Golden master byte-identical, no regeneration (sha256 `c190e944…1b35`).

- **QA verification (PASS WITH NOTES, 2026-09-28):** QA removed the F4 [A4] `.fails`, and F4 now has no known debt. Full suite: 1141 passed, 3 todo, 0 failed (the new file has 18 tests, of which 12 were red before A4). `test:tz`: 380 tests per time zone. The moved code differs from the original line ranges in exactly 3 lines (2 day-count markers and the `addUtcDays` comment pointer), plus the `export` keyword on the nine helpers that weren't exported before. Old and new builds gave identical output and errors on 240,000 inputs in 3 time zones. Golden, REF-01 output (`14c8c98b…`) and all fixtures byte-identical.

### 28. Structure: the schedule loop calls `periodInterest` (A5)

- **What:** A5 2026-09-28, refactor, no behaviour change. In `buildSchedule` (`src/ca/cobCanada.ts`)
  the inline `openingBalance * calculatedRateDecimal * dayCountFraction(priorDate, rowDate)` is
  replaced by `periodInterest(openingBalance, calculatedRateDecimal, priorDate, rowDate)` from
  `./equations.js`, which evaluates the same `(a*b)*c` expression, so the floats are identical.
  The now-unused `dayCountFraction` import is dropped from `cobCanada.ts`. The `periodInterest`
  guards (balance >= 0, rate >= 0) never trip inside the loop.
- **Why:** COB-architecture.md §5 A5 (revision 6): one home per rule; the loop uses the
  equations instead of restating them.
- **Evidence:** QA's 2 red `[A5]` source guards in `tests/ca/loopEquations-a5.test.ts` went
  green; its 12 characterisation cases and the sweep stayed green. Full suite 1157 passed,
  3 todo (1160), 0 failed. Typecheck clean, build OK. `test:tz`: 380 passed per zone in both
  zones. Golden master byte-identical, no regeneration (sha256 `c190e944…1b35`).

### 29. Behaviour: the waterfall principal cap is never negative (B11)

- **What:** B11 2026-09-28, behaviour change (numerical correctness toward the macro, not a
  business rule or deviation). In `applyPaymentWaterfall` (`src/ca/equations.ts`), after the
  unchanged R2 finite guard, the principal cap is `principalCap = principalOutstanding > 0 ?
  principalOutstanding : 0`; `isPayoff = principalCap < remainingAfterFees` and
  `principalPortion = isPayoff ? principalCap : remainingAfterFees`. `amountPaid` is unchanged.
  A float-noise negative `principalOutstanding` (loan amount within a few ULP of the financed
  fees) no longer turns a row into a payoff with a negative Payment; `-0` becomes `+0`. No
  `Math.*` call (F4). `cobCanada.ts` unchanged. The doc comment of `applyPaymentWaterfall`
  now states the non-negative cap.
- **Why:** COB-architecture.md §5 B11 (revision 6). The macro keeps principal as its own running
  value that can't go negative: `currPrinciple = loanAmt - finFee - nonFinFee` (line 387),
  `principlePaid` capped at `currPrinciple` with the payoff branch only when `isMoneyLeft =
  (moneyLeft > 0)` (lines 496-511), `currPrinciple = newPrinciple` (line 541).
- **Evidence:** QA's `tests/ca/b11-waterfall-cap.test.ts` (7 red, fixture
  `b11_waterfall_vectors.json`) went green. B11-E1 (loan 2000.0000000000002, financed fee 2000,
  biweekly, payment 0.25): no row with a negative Payment (was 6), `totalPayment` 6.75 (was
  5.249999999999453). Full suite 1165 passed, 3 todo (1168), 0 failed. Typecheck clean, build
  OK. `test:tz`: 380 passed per zone in both zones. REF-01 and the A5 characterisation hashes
  (`loopEquations-a5`) green. Golden master byte-identical, no regeneration (sha256
  `c190e944…1b35`): no golden change.

### 30. Message: a zero-day COB-rate term says why it is rejected (B13)

- **What:** B13 2026-09-28, message-only change (no behaviour change: the same inputs still
  throw). In `calculateCobCanada` (`src/ca/cobCanada.ts`), straight after `termDays` is
  computed, rule B13-R1: when `termDays === 0` and `!(financedFees + cashFees === 0)` it
  throws `RangeError("<disbursalDate|renewalDate> is the same day as the only payment date,
  so the COB-rate term is 0 days; with fees the term must be at least 1 day")`. The field is
  `disbursalDate` for `newMortgageOrLoan`, otherwise `renewalDate` (same selection as
  `startDate`). The fee condition is the exact negation of the zero-fee short-circuit in
  `costOfBorrowingRatePercent` (macro line 564), with the same operands, so the two branches
  partition the inputs. `cobRatePercent`'s own `termYears must be > 0` guard is kept.
  Interim wording pending Q-MSG.
- **Why:** COB-architecture.md §5 B13 (revision 6). The old message (`termYears must be > 0,
  got 0`) did not tell the user what to fix. Parity: the macro also fails here —
  `termDay = DateDiff("d", disbDate, closingDate)` (line 554) is 0 and `COBRate` (line 569)
  divides by zero with no `On Error`; line 271 allows a first payment on the disbursal date.
- **Evidence:** QA's `tests/ca/b13-zero-term-message.test.ts` B13-1…B13-5 (red) went green;
  B13-6…B13-8 stayed green. Full suite 1173 passed, 3 todo (1176), 0 failed. Typecheck clean, build OK. `test:tz`: 380 passed per zone in both zones. Golden master byte-identical, no
  regeneration (sha256 `c190e944…1b35`).

### 31. UI: the schedule's values clear the scrollbars

- **What:** `ui/ca.html` screen styles only (print styles unchanged). The last schedule column
  gets `padding-right: 24px`, and the sticky totals row gets `padding-bottom: 16px` (6px + 10px).
- **Why:** User request, 2026-09-28. Overlay scrollbars covered the Balance column and the totals row.
- **Evidence:** CSS only; no engine or `ca.js` change. The padding sits inside the cells, so the
  totals row's background still reaches the bottom edge and no rows show through beneath it.

### 32. Behaviour: payment amount and contract rate must be > 0 (B14, absorbs B12)

- **What:** B14 2026-09-28, behaviour change (intentional differences from Excel **DEV-OQY**
  and **DEV-OQAA**). In `validateCobCanadaInput` (`src/ca/validate.ts`), rule B14-R1: the two
  sign checks change in place, still straight after each field's B3a finite check, to
  `!(contractRatePercent > 0)` → `contractRatePercent must be > 0, got <x>` and
  `!(paymentAmount > 0)` → `paymentAmount must be > 0, got <x>`. Check order unchanged
  (loanAmount → rate → payment → enums), so a blank (NaN) value keeps the B3a message and a
  0 rate with a 0/NaN payment reports the rate. Negatives now use the same `> 0` wording;
  `-0` is rejected and prints `got 0`. No minimum above 0. Equation-level guards
  (`equations.ts`, `>= 0`) unchanged. UI rule B14-U1 (former B12), `ui/ca.js` `buildInput`:
  `contractRatePercent: numOrUndefined(contractRatePercentEl.value) ?? NaN,` so a blank rate
  gives the B3a finite-number message. No UI-side check; the UI shows the engine message.
- **Why:** **OQ-Y revised** and **OQ-AA revised** (`COB-user-stories.md` §7.5, user
  2026-09-28): payment > 0 and rate > 0, no minimum. The macro only checks `IsNumeric`
  (lines 187-192, 315-320), so both are recorded deviations (DEV-OQY, DEV-OQAA;
  COB-architecture.md §2.1, §5 B14 revision 7). Supersedes T7 (OQ-Y) and the OQ-AA clause
  "a typed 0 is still allowed".
- **Golden master (approved regeneration, user 2026-09-28; this group only):** regenerated with
  `npx vite-node tests/ca/fixtures/generate_golden.mjs --write`, no hand edits. Group
  **`extra:zeroPayment` removed** (hash `db777846a8149aa2d9cbf8c09bd9ce575bb802b974e77a70c0454bb0e7b13be1`,
  n 312); group **`extra:minimumPayment` added** at the same position, payment $0.01 (hash
  `4860fb957f01e0bdde7e107d31bb2b4069b1b5a8b842b91691837bfc7b84eb4c`, n 312). File sha256
  `c190e94476cbf0134c7ae77e0b1ad1e1e9a157efd2c74c24fe5df1538e781b35` →
  `27a28c357aec4ebbcc767e6ac2d25f61156d4702f3503750fe579144650c6519`. `diff` shows only line
  150 changed: 147 groups + 6 long cases byte-identical. Still 148 groups, 4,455 cases.
- **Evidence:** QA's 35 red tests (b14-payment-rate-positive, zeroPayment-oqy,
  numericGuard-b3a, loopEquations-a5, zeroPayment-coercion-oqy, engineGolden) went green.
  Full suite 1190 passed, 3 todo (1193), 0 failed. Typecheck clean, build OK. `test:tz`: 380
  passed per zone in both zones. UI: served via `ui/serve.mjs`; the served `ca.js` has the
  U1 line; UI-shaped input through the built engine gives `contractRatePercent must be a
  finite number, got NaN` (blank rate), `contractRatePercent must be > 0, got 0` (0 rate),
  `paymentAmount must be > 0, got 0` (0 payment); a valid input still runs (60 rows).
  **QA verification (PASS WITH NOTES, 2026-09-28):** the golden file was regenerated twice by QA
  and matched byte for byte; only the swapped group changed. REF-01 output is unchanged
  (`14c8c98b…a709`). An old-vs-new sweep of 20,000 valid inputs was identical, and 20,000
  mutated inputs changed only where a value was 0 or -0. B12 (OQ-AA blank rate) is merged
  into this item. Headless-browser MT-06a–e passed, and the REF-01 CSV is identical before and
  after (`e341126b…658a`).

### 33. Refactor: retire `totalFees()` (A17)

- **What:** A17 2026-09-28, refactor, no behaviour change. Deleted `totalFees()` (one
  list-order sum over all fees) from `src/ca/fees.ts`. It had no production caller and was on
  neither barrel (ADR-13(b)). `totalFeesIncludedInCob` stays (goes with B10).
- **Why:** B2-R1: the fee limit (and C, and the zero-fee branch) must use the grouped fee
  sum; an unused list-order sum over all fees invited misuse. One home per rule
  (COB-architecture.md §2 principle 5, §5 A17).
- **Evidence:** QA's A17 guard in `tests/ca/fees.test.ts` (no `totalFees` export, no
  `\btotalFees\b` in `src/` or `ui/`) went green. Full suite 1191 passed, 3 todo (1194),
  0 failed. Typecheck clean; build OK (clean rebuild; `dist/ca/fees.js` no longer exports `totalFees`).
  `test:tz`: 380 passed per zone in both zones. Golden `tests/ca/fixtures/golden_engine_v1.json`
  unchanged, sha256 `27a28c357aec4ebbcc767e6ac2d25f61156d4702f3503750fe579144650c6519`.
  **QA verification (PASS, 2026-09-28):** the diff is the 4 removed lines only. Old and new builds were identical on 40,000 inputs (valid and mutated). REF-01 output and golden unchanged; the public export lists are unchanged.

### 34. Refactor: `flows.ts`, the use-case catalogue (A6)

- **What:** A6 2026-09-28, refactor, no behaviour change. New `src/ca/flows.ts` (`FLOW_IDS`,
  frozen `FLOWS`, `computesTriggerRate`, `requiresSemiAnnualDate`, `FlowSpec`). `cobCanada.ts`
  and `validate.ts` read it for the start-date field, the accrued-interest seed, the VRPC lock,
  the date checks and the semi-annual requirement. `ui/ca.js` reads `FLOWS` and
  `requiresSemiAnnualDate`; `FORCED_*`, `isNewFlow`, `isChangeFlow` and `startDateLabel` are
  deleted. Public API (ADR-13(c), additive): both barrels gain `FLOWS`, `requiresSemiAnnualDate`
  and `FlowSpec`. OQ-A (Start Date labels) and OQ-B (accrued interest stays `'optional'`) are
  untouched and tagged `@pending` in `flows.ts`.
- **Why:** One home for the per-flow facts (ADR-07; COB-architecture.md §5 A6).
- **Evidence:** QA's A6-1–A6-8 tests (`tests/ca/flows-a6.test.ts`, 74 tests; A6-8 edit in
  `tests/api/exportSurface.test.ts`) went green. Full suite 1265 passed, 3 todo (1268), 0 failed.
  Typecheck clean; build OK. `test:tz`: 380 passed per zone in both zones. Golden
  `tests/ca/fixtures/golden_engine_v1.json` unchanged, sha256
  `27a28c357aec4ebbcc767e6ac2d25f61156d4702f3503750fe579144650c6519`; REF-01 engine hash unchanged
  (`14c8c98b…a709`). **QA verification (PASS, 2026-09-28):** no test file changed after the red
  run; only the 6 planned product files changed. 210,000 old-vs-new inputs (all flows, odd flow
  values, date-focused, valid) had 0 differences in results or messages. The A6-9 headless UI
  snapshots (16 visibility rows, 8 outputs, 20 extras, REF-01 CSV) are identical before and
  after; MT-06a–e passed.

### 35. Refactor: open decisions as named policy constants (A7)

- **What:** A7 2026-09-28, refactor, no behaviour change. New `src/ca/policies.ts` (no imports)
  holds six constants at today's values: `P_BASIS = 'openingBalance'` (OQ-Q),
  `PRINCIPAL_PAID = 'sumOfPrincipalPortion'` (OQ-R), and for OQ-W (W1–W4, interim option (a))
  `PRIOR_ACCRUED_EARNS_INTEREST = false`, `PRIOR_ACCRUED_IN_COB = 'whenPaid'`,
  `PRIOR_ACCRUED_IN_P = false`, `PRIOR_ACCRUED_PAYMENT_ORDER = 'pooledOutsideBalance'`. Each is
  tagged `@decision OQ-x` and names its alternatives. `cobCanada.ts` gains only the import and six
  `NAME satisfies <literal>;` pins at the site of each rule (lines 98, 101, 164, 165, 235, 242).
  Not exported from the barrels. F7a is now a plain `it`.
- **Why:** COB-architecture.md §3.4, mechanism M1: each open decision has one visible name, and
  changing a value makes `tsc` fail exactly where the alternative branch must be written. Only
  today's branch exists. OQ-Q, OQ-R and OQ-W remain open; their values are unchanged.
- **Evidence:** QA's `tests/ca/policies-a7.test.ts` (32 tests) and F7a went green. Full suite
  1297 passed, 3 todo (1300), 0 failed. Typecheck clean; build OK. `test:tz`: 380 passed per zone
  in both zones. Golden unchanged, sha256
  `27a28c357aec4ebbcc767e6ac2d25f61156d4702f3503750fe579144650c6519`; REF-01 engine hash unchanged
  (`14c8c98b…a709`). **QA verification (PASS, 2026-09-28):** tests unchanged since the red run;
  `cobCanada.ts` diff is additions only; barrels, UI and other `src/` files byte-identical.
  A7-4 mutation: 6/6 constants changed each give one TS1360 at the matching pin. 60,000
  old-vs-new inputs (40,000 valid across all flows, 20,000 invalid/edge) had 0 differences.
  F1–F10 green.

### 36. Fix: semi-monthly dates ignore the time of day (B15)

- **What:** B15 2026-09-29, defect fix. `nextSemiMonthlyDate` (`src/ca/calendar.ts`) reads both
  arguments as their UTC calendar dates (`new Date(utcDateOnly(...))`); `periodDateFor`
  semi-monthly index 0 returns the First Payment Date as a fresh Date at UTC midnight instead of
  the caller's object. `test:tz` now also runs `tests/ca/b15-semimonthly-time-of-day.test.ts`.
  Behaviour changes only for API inputs carrying a time of day: they now give the same result as
  the same date at midnight. Midnight inputs (everything the UI sends) are unchanged.
- **Why:** B15-R1 (COB-architecture.md §5). A time of day moved semi-monthly dates (a 31 Jan
  first payment at 12:00Z gave 16 Feb, 16 Mar… instead of 15 Feb, 28 Feb). Defect fix that
  follows B3b (accept a time, use its UTC date) and the UTC-dates-only invariant, so per the
  architect it needs no decision ID and is not an Excel divergence.
- **Evidence:** QA's 19 new tests plus 2 re-pinned `calendar-a4` tests (16 red on the old code).
  Full suite 1316 passed, 3 todo (1319), 0 failed. Typecheck clean; build OK. `test:tz`: 399
  passed per zone in both zones. Golden unchanged, sha256
  `27a28c357aec4ebbcc767e6ac2d25f61156d4702f3503750fe579144650c6519`; REF-01 unchanged.
  **QA verification (PASS, 2026-09-29):** tests unchanged since the red run; only `calendar.ts`
  (the two functions and their doc comments) and the `test:tz` line changed. Probe: 8,772
  time-of-day inputs now match their midnight twins (old build: 2,193 differed, 72 with wrong
  dates); 2,924 midnight inputs byte-identical. Old-vs-new sweep of 208,000 inputs (UTC and
  `Pacific/Kiritimati`): 0 midnight changes; only semi-monthly time-of-day inputs changed. VBA
  `getNextSemiMonthly` oracle: 986,400 dates, 0 mismatches (old build: 19,384).

### 37. Behaviour: Accelerated Weekly and Accelerated Bi-weekly as separate frequencies (B8)

- **What:** B8 2026-09-29, behaviour addition. `PaymentFrequency` goes from 4 to 6 values
  (`acceleratedBiweekly`, `acceleratedWeekly`). `PAYMENTS_PER_YEAR` gains 26 and 52, after
  `weekly`. `periodDateFor` (`src/ca/calendar.ts`) treats them exactly like bi-weekly and weekly.
  The invalid-frequency message is built from the `PAYMENTS_PER_YEAR` keys and now lists all six
  values (Q-MSG interim wording). UI: the dropdown has six options in IN-09 order with the "(n/yr)"
  suffix ("Accelerated Bi-weekly (26/yr)", "Accelerated Weekly (52/yr)"); `weekly` stays the
  default. Print, contract-terms and context-line labels read "Accelerated Weekly" /
  "Accelerated Bi-weekly" (`PRINT_FREQUENCIES`). CSV unchanged. `test:tz` now runs 9 paths.
- **Why:** BRD IN-09 / BR-09 and OQ-06 (accelerated uses the same n and dates as regular), US-02;
  user decision Q-B8-1 (2026-09-29: keep the suffix); ADR-13(d) (additive; export names unchanged).
  Resolves documentation finding F4 (no Accelerated Bi-weekly option).
- **Evidence:** QA's `tests/ca/b8-accelerated-frequencies.test.ts` (25 tests) plus the updated
  `exportSurface` pin and `a13-build-scripts` list. Full suite 1341 passed, 3 todo (1344), 0 failed.
  Typecheck clean; build OK. `test:tz`: 424 passed per zone in both zones. Golden unchanged, sha256
  `27a28c357aec4ebbcc767e6ac2d25f61156d4702f3503750fe579144650c6519`, no new cases; REF-01 identical
  (`14c8c98b…a709`) for `weekly` and `acceleratedWeekly`; App. A rates exact.
  **QA verification (PASS, 2026-09-29):** tests unchanged since the red run; only the 6 briefed
  files changed. Old vs new on 99,000 inputs: 0 differences except the invalid-frequency message
  list (11,000 cases, exactly the B8-R3 text). Accelerated vs regular: 44,000 random pairs plus the
  2,184-case corpus, 0 differences. B8-6 headless UI check PASS; the four regular options are
  byte-identical to the pre-B8 UI.

### 38. Behaviour: `Fee.includedInCob` is optional (B10)

- **What:** B10 2026-09-29, validation relaxed. `validateFee` (`src/ca/fees.ts`) accepts a fee
  with no `includedInCob`, or with it `undefined`, `true` or `false`; the engine never reads the
  flag. A value that is present but not a boolean (including `null`) is still rejected, as the last
  fee check, with interim Q-MSG text `<label>.includedInCob must be a boolean if present, got <value>`
  (replaces the old "no safe default" message). `totalFeesIncludedInCob` deleted (dead code, on
  neither barrel). `ui/ca.js` no longer sends the flag. Doc comments in `fees.ts` and `types.ts`
  updated (the spec-006 paragraph no longer claims the flag decides cobAmount); the type shape is
  unchanged (`includedInCob?: boolean`). Nothing changes on screen, in print or in the CSV.
- **Why:** OQ-E (C counts every fee in full) and user approval 2026-09-29 (`COB-user-stories.md`
  §7.5), including keeping the rejection of non-boolean values. Not an Excel deviation: the macro
  has no inclusion flag (`COB = intAccrued + finFee + nonFinFee`, line 562); this removes a
  validation the workbook never had.
- **Evidence:** QA's `tests/ca/b10-includedincob-optional.test.ts` (26 tests) plus updated tests in
  `spec011`, `fees` and `b1-unrounded-fees`. Full suite 1368 passed, 3 todo (1371), 0 failed.
  Typecheck clean; build OK. `test:tz`: 424 passed per zone in both zones. Golden unchanged, sha256
  `27a28c357aec4ebbcc767e6ac2d25f61156d4702f3503750fe579144650c6519`; REF-01 identical.
  **QA verification (PASS WITH NOTES, 2026-09-29):** tests unchanged since the red run; only
  `fees.ts`, `types.ts` (comments only; `types.js` byte-identical) and `ui/ca.js` changed. Old vs
  new on 41,769 runs (3,213 fee cases × 13 flag values): `true`/`false` identical to old;
  absent/`undefined` equal the `true` result (old threw); the 9 other values rejected with the new
  message. B10-6 headless UI snapshot byte-identical (8 scenarios, screen, CSV, error text). Note:
  `dist/` was stale after the last comment edit (comments only); QA's rebuild fixed it.

### 39. Tooling: typecheck the tests (A12a, F8)

- **What:** A12a 2026-09-29, tooling, no behaviour change. New `tsconfig.test.json` (extends
  `tsconfig.json`; `noEmit`; `rootDir "."`; includes `tests/**/*.ts` and `src/**/*.ts`) and
  `npm run typecheck:tests` (`tsc -p tsconfig.test.json`, straight after `typecheck`). F8 goes from
  `it.fails` to a plain `it`. Four type-only test edits: `rateSelection-oqc` `Freq` excludes the
  accelerated frequencies; `b13-zero-term-message` `input()` override type; `b3b-date-validation`
  tuple cast and `!` index. No `src/`, `ui/` or `tsconfig.json` change.
- **Why:** split from A12 (COB-architecture.md revision 12, §5 A12a) so A8's type-level red test
  can fail; fixes the 9 annotation errors in 3 test files. The rest of A12 is A12b.
- **Evidence:** red run 1367 passed, 1 failed (F8), 3 todo; now 1368 passed, 3 todo (1371),
  0 failed. `typecheck` and `typecheck:tests` exit 0. The 3 edited test files transpile
  byte-identically (tsc and esbuild) and their per-test results are unchanged. `dist/`
  byte-identical to the pre-A12a build. `test:tz`: 424 passed per zone. Golden unchanged, sha256
  `27a28c357aec4ebbcc767e6ac2d25f61156d4702f3503750fe579144650c6519`; REF-01 identical.
  **QA verification (PASS WITH NOTES, 2026-09-29):** config matches the brief exactly; a probe type
  error in a test makes `typecheck:tests` exit 2. Notes: (N1) `@types/node` is not in
  `devDependencies`; it resolves from `~/node_modules`, so on a clean machine `typecheck:tests`
  gives 86 errors (follow-up queued). (N2) F8 checks only that the config exists; type errors are
  caught by `npm run typecheck:tests`, which R-BUILD requires.

### 40. Refactor: per-flow input types (A8)

- **What:** A8 2026-09-29, refactor; compile-time-only break for TypeScript API callers
  (ADR-09), no runtime change. `CobCanadaInput` (`src/ca/types.ts`) is now the union
  `NewLoanInput | ExistingLoanInput` over `CobInputCommon`: `NewLoanInput` requires `disbursalDate`
  and forbids `renewalDate` / `accruedInterest` (`?: undefined`); `ExistingLoanInput` requires
  `renewalDate`, forbids `disbursalDate`, and keeps `accruedInterest?: number` optional.
  `validateCobCanadaInput` (`validate.ts`) returns `ValidatedInput { startDate }`, the input's own
  Date; checks, messages and order unchanged. `cobCanada.ts` uses it, and the non-null assertion
  `input[flowSpec.startDateField]!` is removed (no cast, no flow literal).
- **Why:** COB-architecture.md §3.3 / §5 A8: a TypeScript caller must give the flow's start date
  and cannot mix flow fields. No export name is added (ADR-13(e); the new types are on neither
  barrel; F9 lists unchanged). OQ-A (`renewalDate` name) and OQ-B (`accruedInterest` optional for
  every existing-loan flow) are untouched.
- **Evidence:** QA's `tests/types/a8-input-union.typecheck.ts` (T1–T8; 7 type errors before, 0
  after), `tests/ca/a8-input-union.test.ts` (6 tests) and 11 type-only casts in 8 test files
  (compiled JS and per-test results unchanged). Full suite 1374 passed, 3 todo (1377), 0 failed.
  `typecheck` and `typecheck:tests` 0 errors. `test:tz`: 424 passed per zone. Golden unchanged,
  sha256 `27a28c357aec4ebbcc767e6ac2d25f61156d4702f3503750fe579144650c6519`; REF-01 identical.
  **QA verification (PASS WITH NOTES, 2026-09-29):** only the 3 `src/ca` files changed;
  `dist/index.d.ts` and `dist/ca/index.d.ts` identical. Old vs new on 53,532 inputs (all 4 flows):
  0 differences in results or messages; `startDate` is the input's own object in every case. Each
  `@ts-expect-error` fails for its intended reason. F1–F10 green. Note F-1: `types.ts` lacks the
  §3.3 inline notes (`@pending OQ-A` on `renewalDate`, `@pending OQ-B` on `accruedInterest`, OQ-P,
  Q-SACD), and the `accruedInterest` comment still mentions `newMortgageOrLoan` though it now sits on
  `ExistingLoanInput` (comment-only follow-up queued).

### 41. Refactor: validation issues list (A9)

- **What:** A9 2026-09-29, refactor with an additive API (ADR-13(f)). `src/ca/validate.ts` gains
  `collectInputIssues(input): InputIssue[]` and `InputIssue { field; message }`. One private
  `checkInput(input, report)` runs the 19-row check table (§5 A9); its gates stop a later check from
  reporting a consequence of an earlier failure. `validateCobCanadaInput` passes a throwing
  reporter, so it evaluates nothing after the first failure (A9-R3) and still returns
  `{ startDate }` without a cast. `collectInputIssues` never catches. `validateFee` /
  `validateFeeSchedule` (`fees.ts`) take an optional reporter (default: throw `RangeError`, as
  before) and return `boolean`. Both barrels export `collectInputIssues` and `InputIssue`.
  `types.ts`: comment-only A9-R5 notes (OQ-P, Q-SACD, `@pending OQ-A`, `@pending OQ-B` / BR-05),
  fixing A8 QA note F-1.
- **Why:** COB-architecture.md §3.5 / §5 A9: the UI will be able to show every problem at once
  (Phase 3, checklist 2f). Messages and their order are unchanged; Q-MSG wording is untouched.
  OQ-A, OQ-B, OQ-P and Q-SACD stay open.
- **Evidence:** QA's `tests/ca/a9-input-issues.test.ts` (83 tests), `tests/types/a9-input-issues.typecheck.ts`
  (T1–T3) and the `exportSurface` list updates. Full suite 1457 passed, 3 todo (1460), 0 failed.
  `typecheck` and `typecheck:tests` 0 errors. `test:tz`: 424 passed per zone. Golden unchanged,
  sha256 `27a28c357aec4ebbcc767e6ac2d25f61156d4702f3503750fe579144650c6519`; REF-01 identical.
  **QA verification (PASS WITH NOTES, 2026-09-29):** only the 5 listed `src` files changed; `ui/**`
  byte-identical. Old vs new on 518,196 inputs: 0 differences in validation outcome or
  `calculateCobCanada` output (469,308 computed). Issue lists equal an independent oracle (58,768
  inputs with several issues, up to 5); empty exactly when validation passes, otherwise the first
  message equals the thrown one. F1–F10 green. Notes: sr-dev stopped on a QA fixture-order defect in
  A9-4, which QA fixed (reordered one combination; no assertion change). `collectInputIssues`
  throws a TypeError on Symbol / prototype-less values, as designed (relevant for the Phase 3 UI).

### 42. Tooling: `@types/node` devDependency (A18)

- **What:** A18 2026-09-29, tooling, no behaviour change; approved by the user 2026-09-29. Added
  `"@types/node": "~22.12.0"` (matching Node v22.12.0) to `COB-ts/package.json` devDependencies.
  `package-lock.json` gains `@types/node` 22.12.0 and `undici-types` 6.20.0 only (18 lines). F8
  now also asserts this devDependency and its range. No `src/`, `ui/`, tsconfig or test-logic change.
- **Why:** fixes A12a QA note N1 / documentation finding F29: the tests' Node types came from
  `~/node_modules/@types/node` (22.9.0), outside the project, so a clean checkout failed
  `npm run typecheck:tests` (87 errors).
- **Evidence:** QA's F8 edit (`tests/architecture/f8-tests-typechecked.test.ts`) went green. Full
  suite 1457 passed, 3 todo (1460), 0 failed. `typecheck` and `typecheck:tests` 0 errors.
  `test:tz`: 424 passed per zone. `dist/` byte-identical. Golden unchanged, sha256
  `27a28c357aec4ebbcc767e6ac2d25f61156d4702f3503750fe579144650c6519`.
  **QA verification (PASS, 2026-09-29):** only `package.json` (one line) and `package-lock.json`
  (the 18 expected lines) changed. Clean copy outside `$HOME` with `npm ci`: `typecheck:tests` 87
  errors → 0, and `tsc --listFiles` loads `@types/node` only from the project's own `node_modules`.
  Note: `npm audit` reports 5 vulnerabilities (3 moderate, 1 high, 1 critical) that were already
  present before A18; no `npm audit fix` was run.

### 43. Refactor: test-support consolidation (A12b, F11)

- **What:** A12b, 2026-09-29. Tests only; no behaviour change. QA added
  `tests/ca/support/{fixtures,compare,builders}.ts` (`loadFixture`, `withinRel`,
  `relDiffFloor1`, `expectRelFloor1`, `expectRangeErrorMatching`, `utcDate`, `isoDay`,
  `asInput`, `wireToInput`), `support.test.ts` (S1–S8) and fitness check F11
  (`tests/architecture/f11-test-helpers.test.ts`, F11a–f). sr-dev migrated 34
  `tests/ca/*.test.ts` files using edit kinds M1–M7 only (`equations.test.ts` needed no edit).
  A12b-R6 (approved by the user 2026-09-29): the in-vitest compiler probe
  `tests/api/a16-fee-types.test.ts` is deleted and replaced by
  `tests/types/a16-fee-types.typecheck.ts`, which keeps the same three type-identity checks in
  the `typecheck:tests` gate. No `src/`, `ui/`, fixture, config or `package.json` change.
- **Why:** `COB-architecture.md` §5 A12b / §6 F11. Helpers had been copied into many files
  (7 `withinRel`, 22 date helpers, 14 fixture loaders, 8 converters, 35 double casts, and 85
  barrel names imported from internal module paths). They now have one home, and F11 stops the
  copies coming back. `typecheck:tests` (A12a) made the in-vitest probe redundant.
- **Evidence:** F11 was red with 14/27/12/35/3/85 hits and is now green. Full suite 1470 passed,
  3 todo (1473), 0 failed. Against the pre-change run, the only differences are the 14 added
  tests and the removed `A16 [API]` test; no test changed status. `typecheck` and
  `typecheck:tests` 0 errors. `test:tz`: 430 passed per zone. `dist/` byte-identical. Golden
  unchanged, sha256 `27a28c357aec4ebbcc767e6ac2d25f61156d4702f3503750fe579144650c6519`; REF-01
  identical.
  **QA verification (PASS WITH NOTES, 2026-09-29):** every hunk is one of M1–M7. Test-title,
  `it.fails` / `known_divergence` and plain-cast counts are unchanged. The a16 typecheck file
  still fails when `Fee` is removed from the barrel (TS2305/TS2322). Sensitivity:
  `withinRel → true` gives 4 failures in 2 files, and `utcDate` shifted to +05:00 gives 197 in
  15 files (the architect's prototype also gave 4 and 197). Notes: a sensitivity run on a
  scratch copy needs a control run, because `f7` and `a13-serve` fail in the copy (both pass
  on the live tree). Two files have a duplicate `index.js` import line (cosmetic). While F11
  was red, `test:tz` ran only the first zone (the script chains the zones with `&&`).
  `npm audit` was left as is by the user's choice on 2026-09-29: the 5 findings in the
  vitest/vite/esbuild tooling are accepted, and no upgrade item is opened.

### 44. UI split `ui/ca-view.js` (A10) and blank term rejected (012 D-09)

- **What:** A10, 2026-09-29, in two steps.
  - **Step 1 (refactor, no behaviour change):** new `ui/ca-view.js` (29 exports, no imports, one
    schedule-table builder). `ui/ca.js` goes from 958 to 489 lines and does DOM work only. QA added
    `ui/ca-view.d.ts`, `tests/ca/a10-ca-view.test.ts` (14 tests), `tests/ca/fixtures/a10_ui_capture_v1.json`
    and `capture_a10_ui.mjs` (headless Chrome through the globally installed `@playwright/mcp`; no
    new dependency), and edited B14-U1 and A6-7.
  - **Step 2 (012 D-09, A10-R7):** a blank Years or Months field is sent as NaN, and the engine's
    existing messages reject it. A typed 0 stays 0. This is a UI input rule, not a difference from
    Excel's output, so it has no DEV-ID. The D-06 and D-09 `it.todo`s became 6 tests; the D-13 todo
    stays (OQ-A).
  - **Unchanged:** accrued interest (A10-R6, OQ-B: a blank still means $0), and a blank Loan amount
    or fee amount (Q-A10-1). No `src/` change.
- **Why:** `COB-architecture.md` §5 A10 (revision 15). 012 D-09: the defect register says "no
  stakeholder input needed".
- **Evidence:** Step 1 went from red 1468 passed / 17 failed / 3 todo to green 1485 passed / 3 todo.
  Step 2 went from red 1489 passed / 2 failed / 1 todo (the brief's "1488" was an arithmetic slip)
  to green **1491 passed, 1 todo (1492)**. `typecheck` and `typecheck:tests` 0 errors. `test:tz`
  430 per zone. `dist/` byte-identical (it holds the engine only; `ui/` is served from source).
  Golden unchanged, sha256 `27a28c357aec4ebbcc767e6ac2d25f61156d4702f3503750fe579144650c6519`.
  The Chrome capture (5 scenarios: CSV bytes, print `innerHTML`, figure lists) is identical to the
  fixture after both steps.
  **QA verification (step 1 PASS WITH NOTES, step 2 PASS, A10 PASS WITH NOTES, 2026-09-29):**
  17 mutants killed (10 in step 1, 7 in step 2, each with a control run). MT-09 in the headless page:
  a blank Years field shows `termYears must be a non-negative integer, got NaN` (before: "must not
  both be 0"); a blank Months field shows `termMonths must be an integer in [0, 11], got NaN`
  (before: silently read as 0); 0 years + 6 months gives results. Typed 0/0, accrued interest
  blank or 0, a blank Loan amount and a blank fee amount give the same output as before A10.
  Notes:
  - N1: `#resultContext`, `#contractTermsDate`, `--kpi-em` and the table class aren't in the
    capture. A one-off check found them identical before and after; add them if the fixture is
    regenerated.
  - N2: the brief's tests missed the singular "1 payment" text; QA pinned it and the other
    unreached branches in A10-P3.
  - N3: `test:tz` is red while any architecture test (F10) is red, because `&&` skips the second
    zone.
  - N4: the brief's `defects012` line references were stale.
  - Information: a blank fee amount prints as "$" (unchanged from before A10; see Q-A10-1 and B16).

### 45. Money format for amount inputs and printed inputs (B16, Q-MONEY-FMT)

- **What:** B16, 2026-09-29.
  - **Fields:** Loan amount, Payment amount, Accrued interest and each fee amount become
    `type="text" inputmode="decimal"`. When the user leaves a field it is formatted, e.g.
    `227,199.00`. Typed extra decimals are kept, never rounded. Typed or pasted commas and a
    leading `$` are accepted.
  - **Printout:** printed inputs show `$227,829.65` (before: `$227829.65`).
  - **Parsing:** one grammar, `parseAmount`, feeds the engine, the printout and the fee subtotals.
  - **Malformed amounts:** now rejected with the engine's message, where before they were read
    as blank, which gave a silent $0 for accrued interest and fees (Q-MONEY-FMT (5); the wording
    is part of Q-MSG).
  - **Unchanged:** the blank rules (OQ-B, Q-A10-1, B14, D-09), the engine, the CSV, `dist/` and
    the golden.
  - **Tests and types:** `ui/ca-view.d.ts` goes from 29 to 31 exports. QA regenerated fixture
    B16-FIX in `a10_ui_capture_v1.json`: exactly 24 strings (12 raw values, 8 `printInputs`,
    4 `printFees`) plus the provenance note. Q-MONEY-FMT is the user's approval for that. New
    test file `tests/ca/b16-money-format.test.ts` (12 tests).
  - This is a UI display change, so it has no DEV-ID.
- **Why:** user decision Q-MONEY-FMT (2026-09-29), `COB-user-stories.md` §7.5;
  `COB-architecture.md` §5 B16 (revision 16).
- **Evidence:** red 1474 passed / 29 failed / 1 todo; green **1503 passed, 1 todo (1504)**.
  `typecheck` and `typecheck:tests` 0 errors. `test:tz` 430 per zone. `dist/` byte-identical.
  Golden unchanged, sha256 `27a28c357aec4ebbcc767e6ac2d25f61156d4702f3503750fe579144650c6519`.
  Chrome capture equals the new fixture.
  **QA verification (PASS WITH NOTES, 2026-09-29):**
  - **Oracle:** QA's own scanner oracle agrees on 1,113,624 strings with 0 violations. The value
    never changes when formatted, formatting twice gives the same text, and plain decimals parse
    as before.
  - **Page checks:** blur formatting, paste, `465.4567` kept as typed, malformed loan, fee and
    accrued amounts all rejected. A blank accrued amount gives the same figures as `0.00`. A
    blank fee amount behaves as before and still prints "$". The CSV download is byte-identical.
    Aria roles change from spinbutton to textbox, with the same names.
  - **Styles:** computed styles of all amount inputs are identical before and after. `ca.html`
    selects both the `number` and `text` fee inputs.
  - **Mutation:** 10 of 10 mutants killed.
  - **Notes:**
    - N1: the brief's claim "typedMoney = formatCurrency for every ≤2-decimal amount" fails at 16
      or more significant digits. That's not reachable at realistic amounts; the architect will
      reword it.
    - N2: blur formatting is covered only by a source check and QA's page check; no vitest test
      drives the page.

### 46. Short column headings in the printed schedule (B17, Q-PRINT-HEAD)

- **What:** B17, 2026-09-29.
  - **Code:** each `COLUMNS` row in `ui/ca-view.js` gains a 5th element, `printHeader`. The one
    table builder uses it for print only.
  - **Printed headings:** #, Date, Days, Balance, Fees | Period, Accrued | Payment, Interest,
    Fees, Principal | Accrued, Fees, Balance, under the unchanged group headings (Opening /
    Interest / Payment breakdown / Closing).
  - **Unchanged:** the screen table, the CSV (OQ-J), the engine, `dist/` and the golden. Still 31
    exports; one `ca-view.d.ts` line.
  - **Tests:** QA regenerated fixture B17-FIX in `a10_ui_capture_v1.json`: 8 `printScheduleTable`
    strings (48 heading substitutions) plus the provenance note. Q-PRINT-HEAD is the user's
    approval for that. New `tests/ca/b17-print-headings.test.ts` (6 tests). New fitness check
    **F12**, `tests/ui/check_print_width.mjs`: a Chrome page check that the natural print table
    width is ≤ 965px, over 7 scenarios × 2 column modes. Run it by hand with `node`; it isn't
    part of vitest.
  - This is a UI print change, so it has no DEV-ID.
- **Why:** user report and decision Q-PRINT-HEAD (2026-09-29; `COB-user-stories.md` §7.5).
  With All columns, the printed schedule was 1201px wide against a 965px printable width
  (letter landscape, 12mm margins). Chrome shrank the whole page to about 80%; a browser or
  setting that doesn't shrink (e.g. Safari, Scale 100%) cut off the closing columns.
  `COB-architecture.md` §5 B17 (revision 17).
- **Evidence:** red 1497 passed / 12 failed / 1 todo; green **1509 passed, 1 todo (1510, 53
  files)**. `typecheck` and `typecheck:tests` 0 errors. `test:tz` 430 per zone. `dist/`
  byte-identical. Golden unchanged, sha256
  `27a28c357aec4ebbcc767e6ac2d25f61156d4702f3503750fe579144650c6519`. The capture equals the
  fixture; the screen table and CSV are identical to before B17.
  **QA verification (PASS WITH NOTES, 2026-09-29):**
  - **F12:** the 7 All cases measured 1194.8–1228.8px before; after, all 14 cases pass, at most
    917.4px.
  - **PDF at scale 1:** the glyph scale was 0.805 before (shrunk) and is 1.000 after. The Balance
    column's right edge is at 755.2pt, inside the 757.98pt content edge.
  - **Mutation:** 6 of 6 mutants killed.
  - **Notes:**
    - N1: in Chrome the defect showed as a whole-page shrink, not clipped columns.
    - N2: at full size the default printout is 5 pages instead of 4.
    - N3: amounts with nine or more integer digits ($100M+) would still reach about 972px.

### 47. Second golden fixture for Payment Change / VRPC (B18)

- **What:** B18, 2026-09-29. Tests only; no `src/`, `ui/` or `dist/` change. New fixture
  `tests/ca/fixtures/golden_engine_pc_v1.json`: 122 groups (3,536 cases) plus 2 long cases,
  covering Payment Change and Variable Rate Payment Change. Generator
  `tests/ca/fixtures/generate_golden_pc.mjs`; test `tests/ca/golden/engineGoldenPc.test.ts`
  (136 tests: S1, S2, 122 group hashes, 2 long cases, P1–P6, a flow-equivalence invariant, and
  3 FB-16 pins of today's behaviour). The first golden fixture `golden_engine_v1.json`, its
  generator and its test are byte-identical. QA wrote and verified the whole item as the brief
  assigns; there was no sr-dev step.
- **Why:** the first golden had no Payment Change or VRPC case (QA, `COB-feedback-impact.md`
  FB-16). Decisions 1 and 2 of the stakeholder-feedback review change these flows, so they need
  golden coverage first. `COB-architecture.md` §5 B18 (revision 18). The user approved adding
  this second golden on 2026-09-29.
- **Evidence:** the suite goes from 1509 passed, 1 todo to **1645 passed, 1 todo (1646, 54
  files)**. Exactly the 136 new tests were added; no existing test changed status. `typecheck`
  and `typecheck:tests` 0 errors. `test:tz` 566 per zone.
  - **Hashes:** the new fixture's sha256 is
    `337a93467acf48742667087702b4504c6451cbb0b57f841f89adaddaffa81a12` in both time zones, the
    same as the architect's independent prototype. The first golden is unchanged at
    `27a28c357aec4ebbcc767e6ac2d25f61156d4702f3503750fe579144650c6519`.
  - **Oracle:** QA ran the archived macro oracle on the 1,144 cases with no accrued interest.
    1,122 match on dates, row count and term days; C is within 1e-9 relative and balances within
    1e-6. The 22 other cases are monthly month-end starts (OQ-X). With a financed fee, the COB
    rate differs by OQ-Q (P = average opening balance); all 612 of those cases match the oracle
    recomputed that way.
  - **Mutation:** 3 of 3 flow mutants killed (49, 13 and 136 tests red). The first golden stays
    green under all three.
  - **Main-session check:** the suite count and both hashes confirmed; nothing in `src/` or
    `ui/` changed after the B18 files were written.
  - **QA finding F-1:** statically importing `generate_golden.mjs` also runs its `--write`
    block. So `generate_golden_pc.mjs --write` without `--out` could silently rewrite the first
    golden, which matters from B19 on. QA's generator imports it dynamically with `--write`
    hidden from its arguments. The architect will record this in the B19 brief.

### 48. No interest on unpaid interest (B19, DEV-OQL)

- **What:** B19, 2026-09-29. Unpaid interest (IN-11 or a period shortfall) no longer earns
  interest. It sits in one bucket outside the balance, paid first, oldest first (Q-W4-INT).
  C counts period interest as charged and IN-11 only when paid (W2 parked).
  `closingBalance = opening - fees paid - principal`; P stays the mean opening balance. The
  workbook behaviour stays behind the engine switch `UNPAID_INTEREST_CAPITALISED`
  (`src/ca/policies.ts`, ships `false`; ADR-14); `calculateCobCanadaWith` takes the switches.
  `PRIOR_ACCRUED_EARNS_INTEREST` and `PRIOR_ACCRUED_PAYMENT_ORDER` are retired. Changed:
  `src/ca/policies.ts`, `cobCanada.ts`, `types.ts` (comments). QA added
  `tests/ca/b19-unpaid-interest.test.ts`, `tests/ca/golden/b19-switch-on.test.ts`,
  `tests/ca/support/switches.ts`, and edited the tests the brief lists.
- **Why:** stakeholder decision 1 (FB-14, FB-29, FB-25), Q-W4-INT; QA finding F-1 (each golden
  generator writes only its own fixture, procedure B19-GOLD, guard test B19-G).
  `COB-architecture.md` revision 19 §5. The user approved the golden changes.
- **Evidence:** suite 1645 -> **1717 passed, 1 todo (56 files)**; `typecheck` and
  `typecheck:tests` clean; `test:tz` 569 per zone. QA verdict PASS WITH NOTES.
  - **First golden** `27a28c35...6519` -> `9e868cdf2edb74c1bf651cacfbfb384730c8e1d3b07ebb983d45580b699bf4b1`:
    26 groups (`extra:minimumPayment`, `extra:underpayment`, 24 weekly `new` / `renewal0`
    groups) plus `long:weekly:noPayoff`.
  - **PC golden** `337a9346...1a12` -> `5ab1c6a6c086ba737d790bb1e42f2eb36ccd61c3c256e2634a6d5cc312fa7df5`:
    `pcx:underpayment`, `vrpcx:minimumPayment`, plus `long:pc:weekly:acc850:underpayment`.
  - Switch on reproduces both old goldens byte for byte (B19-ON-v1, B19-ON-pc). REF-01 and the
    A10 Chrome capture are unchanged.
  - Independent oracle (macro transliteration for the workbook branch, own model for the
    shipped branch): 6,000 inputs, 0 mismatches. Mutations 5/5 killed.
  - Notes: N1 a misindented comment in the workbook branch of `cobCanada.ts` (cosmetic); N2
    the IN-11 workbook branch has no macro reference (the macro has no IN-11 input).
- **User decision recorded:** Q-B19-ENDACC = yes (show unpaid interest left at the End Date in
  the on-screen and printed figures, only when above $0); not built yet.

### 49. Accrued interest required (B20)

- **What:** B20, 2026-09-29. Accrued interest is mandatory for Renewal, Payment Change and
  VRPC; $0 is valid. `src/ca/flows.ts`: `accruedInterest` is `'hidden' | 'required'` (New
  stays hidden); the `@pending OQ-B` tag is replaced by "decision 4, B20".
  `src/ca/validate.ts`: an absent value on a valid required flow throws
  `flow '<flow>' requires accruedInterest (enter 0 if there is none)` (interim Q-MSG);
  `null`, NaN and negatives keep their own messages. `src/ca/types.ts`:
  `ExistingLoanInput.accruedInterest` is required (ADR-13(g), a compile-time break for API
  callers). `cobCanada.ts` keeps `?? 0` (comment only). UI: `ca.html` opens the field blank;
  `printInputRows` always shows the row; the dead "Not entered" branch is gone from `ca.js`.
- **Why:** stakeholder decision 4 (FB-4, FB-17); closes OQ-B, BR-05 and finding F3. The
  workbook has no such input, so there is no DEV ID and no switch. `COB-architecture.md`
  revision 20 §5.
- **Evidence:** suite 1717 -> **1744 passed, 1 todo (57 files)**; `typecheck` and
  `typecheck:tests` clean; `test:tz` 569 per zone; F12 14/14; both goldens unchanged
  (`9e868cdf...f4b1`, `5ab1c6a6...7df5`). QA verdict PASS.
  - **UI page fixture change (user-approved 2026-09-29, B20-FIX):** in
    `a10_ui_capture_v1.json`, `raw.accruedInterest` `"0.00"` -> `""` in REF-01, S1_fees and
    ERR_blank_rate; `VRPC_blank_accrued` is now an error case with the B20 message and
    `modes: {}`; new scenario `VRPC_zero_accrued`. Both Chrome scripts edited in the same task
    (ADR-14). Capture output equals the fixture minus provenance.
  - Old-vs-new sweep, 60,000 inputs: only the 5,466 absent-field cases on the three flows
    changed (one added issue each); 54,534 identical, including all 12,245 accepted inputs
    that carry the field.
  - Mutation: 11 of 12 killed. R4(d) (the dead "Not entered" tile) is unreachable by vitest.
  - QA edit noted: the A6-1 assertion for `@pending OQ-B` was removed; `@pending OQ-A` stays
    until B22.

### 50. Renewal is mortgage-only (B21)

- **What:** B21, 2026-09-29. `src/ca/flows.ts`: `renewal.forcedProductType` is `'mortgage'`.
  `src/ca/validate.ts`: the flow-lock message is built from the catalogue as
  `flow '<flow>' is <allowed> only, got productType='...', rateType='...'` (interim Q-MSG);
  VRPC's text loses its parenthesis "(it exists specifically to recompute the trigger rate)".
  `ui/ca.js`: comment only (the UI reads `FLOWS`, so the Product select locks to Mortgage for
  Renewal with no code change; leaving Renewal keeps the value at Mortgage). Both Chrome
  scripts no longer select `productType` in the Renewal scenarios (ADR-14). The first-golden
  generator `generate_golden.mjs` `makeInput` now sends a personal-loan `renewal0` /
  `renewal850` key as `paymentChange` (50 groups, 1,484 cases); no regeneration, output
  byte-identical. The PC golden has no personal-loan Renewal.
- **Why:** stakeholder decision 9 (FB-23); closes DQ-16 and QA finding F-3. No DEV ID (the
  workbook has no use cases) and no switch. `COB-architecture.md` revision 21 §5.
- **Evidence:** suite 1744 -> **1759 passed, 1 todo (58 files)**; `typecheck` and
  `typecheck:tests` clean; `test:tz` 569 per zone; F12 14/14; both goldens
  (`9e868cdf...f4b1`, `5ab1c6a6...7df5`) and the A10 capture fixture unchanged. QA verdict PASS.
  - Old-vs-new sweep, 600,000 inputs: 442,748 identical; 94,538 differ only in the VRPC message
    text; 62,714 are Renewal + personalLoan (one added `flow` issue, now rejected); 0
    unexpected differences; all 112,604 successful outputs byte-identical.
  - Mutation: 13 of 13 killed, against an unmutated control that failed only in `a13-serve`
    (no `dist/` in the scratch copy).
  - Chrome: choosing Renewal sets Product to Mortgage and disables the select; Rate stays
    editable; Payment Change keeps Personal loan available.
  - Not re-measured by QA: the "50 groups / 1,484 cases" figure (relied on the byte-identical
    golden test).

### 51. B22: on-screen labels follow the use case (2026-09-30)

- **What:** `src/ca/flows.ts`: both change flows' `startDateLabel` is now "Last payment date"
  (their first-payment label is "Next payment date"); no `@pending` is left. New pure
  `flowLabels(flow, spec)` in `ui/ca-view.js` (now 32 exports, typed in `ui/ca-view.d.ts`).
  `ui/ca.html` gains five ids and the legend reads "Renewal". `ui/ca.js` and `printInputRows`
  read `flowLabels`, so screen, tiles and print share one source (this also fixes the
  "Renewal date" tile shown on VRPC). The Accrued interest hint for the change flows is the
  arrears text accepted by the user 2026-09-29; the label "Accrued interest" is unchanged;
  Renewal is unchanged. `capture_a10_ui.mjs` gains a `flowScreens` block. Approved capture
  fixture change: 6 label strings in `VRPC_zero_accrued` (both modes), the new `flowScreens`
  key (4 flows, 15 strings) and provenance. No engine change, no switch, no DEV ID.
- **Why:** stakeholder decisions 2 and 5; closes OQ-A and doc finding F1. Only the hint guards
  against entering the interest since the Last payment date into Accrued interest (FB-16
  double count, QA probe +$784.19); the manual must say so. `COB-architecture.md` revision 23.
- **Evidence:** suite 1759 -> **1776 passed, 1 todo (59 files)**; `typecheck` and
  `typecheck:tests` clean; `test:tz` 569 per zone; F12 14/14 (max 917.4 px); both goldens
  (`9e868cdf...f4b1`, `5ab1c6a6...7df5`) unchanged; fresh Chrome capture equals the fixture
  minus provenance; mutants 5/5 killed against an unmutated control. QA verdict PASS WITH NOTES.
  - Notes: the fixture could not be diffed against its pre-B22 version (no saved copy), so the
    approved change was confirmed by inspection; 1,442,781 bytes vs the brief's 1,442,815 (34
    bytes, consistent with provenance, unconfirmed). Not checked by hand in Chrome beyond the
    capture.
  - **Fixture baseline (pinned 2026-09-30):** no pre-B22 copy exists (no git history, not in the
    archive, no scratchpad copy), so the pre/post diff cannot be reconstructed. The verified
    post-B22 `a10_ui_capture_v1.json` has sha256
    `c7b98da5147e1a071b5da2218604e3ff8df0b590eed730b810313714cd8c8190` (1,442,781 bytes) and
    equals a fresh Chrome capture minus provenance. Any later change needs user approval and a
    new hash here. The build and tests were produced in the previous session (2026-09-29 22:33-22:42)
    and independently verified in this one.
  - `docs/COB-user-manual.md` line 89 still describes the old labels (doc-writer to update).

### 52. B23: no sample fees; Financed switched off in the UI (2026-09-30)

- **What:** `ui/ca-view.js` exports `UI_SWITCHES = Object.freeze({ financedOption: false })` and
  `FEE_KEYS` (34 exports); `ViewContext` gains `switches`. `toInput`, `printFeesNodes`,
  `moreFigures`, `printFigures`, `scheduleTableNodes` and `scheduleCsv` take `ctx`. With the switch
  off (shipped): every fee is sent non-financed; the fee table has no Financed header or
  checkbox (`data-switch` removal in `ca.js`); the fee columns are hidden on screen, in print and
  in the CSV (Q-FEE-CSV), in both `all` and `compact`; "Fees recovered through payments" and
  "Disbursal amount" are hidden; print has no Financed column, subtotal line or fee-tag.
  Unconditional: no sample fee rows (decision 6) and the printout `.fees-explain` block and its
  CSS are removed. Both Chrome scripts edited. Engine, `dist/` and both goldens untouched.
- **Why:** stakeholder decisions 6 and 7, Q-FEE-CSV, Q-B23-FIX (capture fixture regeneration
  approved by the user 2026-09-30; the byte copy of the old fixture was declined; the small
  `tests/ca/fixtures/b23_on_state_pins.json`, 64 hashes of the Financed-on outputs, was approved).
  No DEV ID (F44). `COB-architecture.md` revisions 24-25.
- **Evidence:** suite 1776 -> **1841 passed, 1 todo (60 files)** (red before the fixture: 38 ->
  9); `typecheck` and `typecheck:tests` clean; `test:tz` 569 per zone; F12 14/14 (max 734.8 px);
  both goldens (`9e868cdf...f4b1`, `5ab1c6a6...7df5`) and REF-01 unchanged; default printout 5
  pages (unchanged); mutants 18/18 killed (5 `ca.js` mutants only by the Chrome capture). QA
  verdict PASS WITH NOTES.
  - **Capture fixture** `a10_ui_capture_v1.json`: old `c7b98da5...8190` (1,442,781 bytes) -> new
    `920c3b78e3c4ada2ad0fb25dba1e63308341f980d79e4c341dd5465760b02bf2` (1,206,626 bytes); a fresh
    capture equals it minus provenance. Changed, in the 4 calculating scenarios (REF-01, S1_fees,
    RENEWAL, VRPC_zero_accrued) in both modes: (1) `html.printScheduleTable` / `scheduleTable`
    lose the 3 fee columns, group spans 14 -> 11 (All), 7 -> 6 (Compact print), 14 -> 11 (screen
    Compact); (2) `csvBase64` loses `Fees (open)`, `Fees paid`, `Fees (close)` (Compact: `Fees
    paid`); (3) `printFigures` / `moreFigures` / `figures` lose "Fees recovered through payments",
    and REF-01 and S1_fees also lose "Disbursal amount"; (4) S1_fees and RENEWAL `printFees` lose
    the Financed heading, Yes/No cells and subtotal paragraph, and `contractTermsList` loses the
    fee-tag spans; (5) S1_fees `raw.fees[0].financed` true -> false; (6) S1_fees "Total principal
    paid" $48,097.65 -> $50,097.65 (its financed fee is now a cash fee; rate 4.11441% and C
    $25,014.11 unchanged); (7) new top-level `formDefaults`; (8) `provenance`. The 2 error
    scenarios, `flowScreens`, `printInputs` and counts are identical. The 64 ON pins match the
    pre-B23 page exactly.
  - Notes: F-1 the brief's MUT-1 text says T1..T6 go red; only PIN-1/PIN-2 do. F-2 S1_fees no
    longer exercises a financed fee in the page (by design). The ON branch of `ca.js` has no
    automated check (accepted risk). With Financed off a fee staff used to enter as financed
    becomes a cash fee (REF-01 loan with one 500 fee: COB rate 3.7854% -> 3.8266%).
  - Docs stale (doc-writer): user manual (sample fees, Financed?, Fees recovered, Disbursal
    amount, fee columns, printout fees), coverage report, domain overview §5.1/§5.2/§6.

### 53. B28: Accelerated Weekly / Bi-weekly hidden in the UI (2026-09-30)

- **What:** `ui/ca-view.js`: `UI_SWITCHES` is now `{ financedOption: false, acceleratedFrequencies:
  false }`; new pure export `switchedOut(ctx, name)` (35 exports). `ui/ca.html`: `data-switch=
  "acceleratedFrequencies"` on the two accelerated options; `ui/ca.js`: the data-switch removal
  loop calls `switchedOut`. The dropdown shows Weekly (52/yr), Bi-weekly (26/yr), Semi-monthly
  (24/yr), Monthly (12/yr). The engine still accepts `acceleratedWeekly` / `acceleratedBiweekly`
  (results identical to Weekly / Bi-weekly, BR-09); `LABELS` keeps its two entries; no hint text.
  Both Chrome scripts gain an assertion that the dropdown has exactly four options (no recorded
  key). Engine, `dist/`, both goldens and the capture fixture are untouched.
- **Why:** user decision 2026-09-30 (the tool does not calculate the accelerated payment amount,
  BR-09); supersedes the UI part of B8 and Q-B8-1. Defaults confirmed by the user: no hint, no
  fixture regeneration, no storage concern, no DEV ID (not a difference from Excel: macro lines
  411-419 give both accelerated values the Weekly / Bi-weekly branches). `COB-architecture.md`
  revision 28.
- **Evidence:** suite 1841 -> **1870 passed, 1 todo (61 files)** (17 tests in
  `b28-accelerated-hidden.test.ts`, +12 from B28-T8 added by QA at verify); `typecheck` and
  `typecheck:tests` clean; `test:tz` 569 per zone; F12 14/14; goldens (`9e868cdf...f4b1`,
  `5ab1c6a6...7df5`) and capture fixture (`920c3b78...2bf2`) unchanged, and a fresh capture equals
  the fixture minus provenance; Chrome: no "Accelerated" text on the page; with the switch true in
  a scratch copy all six options appear in today's order. Mutants: 1-6, the extra no-op-loop
  mutant and MUT-8 killed (MUT-8 only by Chrome); MUT-7 (accelerated `LABELS` entries) survived
  until QA added B28-T8, then killed. QA verdict PASS WITH NOTES.
  - Notes: B23's PIN-2 regex only anchors the `financedOption: false` prefix (B28-PIN-1/PIN-2 pin
    the whole object). The ON branch of `ca.js` has no DOM test in vitest (checked once by hand).
    Files are identified by mtime (no git HEAD).
  - Docs stale (doc-writer): manual lines 4, 111, 124, 126, 234, 325-326; coverage report lines
    134, 174, 201, 226, 235, F4/F25 and counts; domain overview lines 244, 446, 478.

### 54. B27: personal loans are Monthly only (DEV-FB24) (2026-09-30)

- **What:** Engine: new `src/ca/products.ts` (`allowedPaymentFrequencies(productType)`, explicit
  catalogue; personal loan = `['monthly']`), exported on both barrels (ADR-13(h)); `validate.ts`
  rejects a personal loan with any other payment frequency in every flow and rate type, after the
  flow lock and before the date checks, with the interim (Q-MSG) message `paymentFrequency
  'weekly' is not allowed for productType 'personalLoan' (allowed: monthly)` (field
  `paymentFrequency`); `validate.ts` has no product or frequency literal; `equations.ts` is
  comment-only. A fixed rule, no switch. UI: `frequencyLock` and `FREQUENCY_LOCK_HINT` in
  `ui/ca-view.js` (37 exports); `ui/ca.js` and `ui/ca.html` lock Payment Frequency to Monthly
  (disabled, hint "Personal loans are paid monthly.", interim) when Product is Personal loan;
  switching back to Mortgage keeps Monthly and re-enables the select.
  - **Goldens reshaped (user-approved 2026-09-30):** first golden 148 -> 94 groups, 4,455 -> 2,817
    cases, `9e868cdf...f4b1` -> `b7c36e65a859c956e2341c316f64b165265945bad3b148654ef64b0279c98235`;
    Payment Change golden 122 -> 86 groups, 3,536 -> 2,444 cases, `5ab1c6a6...7df5` ->
    `acfe374c6def2cea5bb723c8c639a72e0088aed7f8c952b561d724bd8d26d23e`. 54 + 36 personal-loan
    non-monthly groups dropped; `extra:underpayment` / `pcx:underpayment` trimmed to Monthly
    (changed); the PC long case `long:pc:weekly:acc850:underpayment` became
    `long:pc:monthly:acc850:underpayment`; 93 (first) and 85 (PC) surviving group entries are
    byte-identical to the archive. The pre-B27 fixtures are kept read-only in
    `COB-ts/archive/pre-b27/` (with `MANIFEST.txt`; run by no test).
  - **Tests:** 12 class-C `rateSelection-oqc` tests retired (personal loan fixed 8% / variable 6%
    at weekly, bi-weekly, semi-monthly: "calculatedRatePercent === contract rate" and "row-1
    interest"); the same claims stay covered at Monthly, on variable mortgages and by the new
    all-payments-per-year equation test B27-T14 (12 cases). 13 existing test files got
    input/sampling-domain edits through the QA-owned `rehome` twin (marked "B27: DEV-FB24
    class"), no expected or fixture value edited, except the single declared exception X1
    (`loopEquations-a5` `overflowToInfinityShipped`: assertion code nulls `triggerRatePercent`
    before hashing; pinned sha `c88a5419...` unchanged). Frozen test-only generator copies in
    `tests/ca/fixtures/legacy/` keep b10, b8 and the B19-ON pins (`27a28c35...6519`,
    `337a9346...1a12`). B28-T4 was relaxed to allow the import and the lock argument only.
  - **QA additions at verify:** `tests/ui/ui-scripts-parse.test.ts` (`node --check` on
    `ui/ca.js` and `ui/ca-view.js`), `tests/ui/check_page_smoke.mjs` (Chrome page-load smoke:
    fails on any page error, console error or warning, or failed request; run by hand, like
    `check_print_width.mjs`), and a weekly -> Personal loan -> Mortgage detour in
    `capture_a10_ui.mjs`.
- **Why:** stakeholder feedback FB-24 ("Personal loan rates are always monthly"); the user chose
  reading (b), monthly payments only (2026-09-30), in all flows, engine as a fixed rule, page
  locks the select. DEV-FB24: the workbook accepts any frequency for a personal loan (MONTHLY
  rate basis). Reversing the rule later is a code change. `COB-architecture.md` revisions 26-29.
- **Evidence:** suite 1870 -> **1924 passed, 1 todo (63 files, 1925 tests)**; `typecheck` and
  `typecheck:tests` clean; `test:tz` 480 tests in 20 files per zone (the golden suites shrank);
  F12 14/14; capture fixture `920c3b78...2bf2` byte-identical and a fresh capture equals it minus
  provenance; 100,000-input old-vs-new sweep: 61,267 allowed inputs identical (29,478 calculate,
  31,789 throw the same error), all 38,733 non-monthly personal-loan inputs rejected with exactly
  one added `paymentFrequency` issue; twin re-proved on the old engine over 15,369 inputs (identical
  except `triggerRatePercent`); mutants MUT-1..19 killed, and the UI-wiring mutants MUT-8b, 9b,
  10, 11, 11b plus the duplicate-const defect killed by the Chrome scripts (vitest alone misses
  four of them). Reshaped-corpus workbook-branch shas (information): first `8be341b5...e7f2`, PC
  `c09b36d6...5071f`.
  - **Defect found and fixed in verify (F-1, blocker):** `ui/ca.js` declared `const
    paymentFrequencyEl` twice (SyntaxError; the page was dead while vitest stayed green, because no
    test loaded `ui/ca.js`). sr-dev removed the duplicate; QA's first verdict was FAIL, the
    re-verify on the live tree in Chrome is PASS. The parse test and the smoke script now cover
    this class.
  - **QA verdicts:** first verify FAIL (F-1 blocker above); re-verify on the live tree in real
    Chrome **PASS** (2026-09-30). Final: PASS.
  - Notes: `/favicon.ico` and the external Alterna logo return 404 (pre-existing, exempted by the
    smoke script).
  - Docs stale (doc-writer): manual lines 111, 126 (six frequencies; B28 and B27 shown planned);
    coverage report line ~50 (FB-24 "parked") and the state after B23; domain overview lines 232,
    243, 447, 479; the README needs a line for `archive/`.

### 55. B26: "Unpaid interest at end date" figure (2026-09-30)

- **What:** `moreFigures` in `ui/ca-view.js` adds a figure "Unpaid interest at end date" (hint "Owed
  in addition to the balance at end date", interim under Q-MSG) right after "Balance at end date",
  only when the last schedule row's `carriedAccruedInterestClosing` is strictly `> 0` on the raw
  number (no tolerance, no rounding). `printFigures` spreads `moreFigures`, so the screen and
  the printout both show it. No other code change: engine, `dist/`, CSV, `ca.js`, `ca.html`,
  `ca-view.d.ts` untouched; no switch (ADR-14: the user asked for it active). The shortfall steps
  added to `check_print_width.mjs` (F12 now 16/16) and `capture_a10_ui.mjs` are assertion-only.
- **Why:** user decision Q-B19-ENDACC (2026-09-29): after B19 interest still unpaid after the
  last payment on or before the End Date showed only in the last row's Accrued interest column.
  Label and hint are the user's wording. Assumed, not objected to: strict `> 0` (Q-B26-CENT) and
  no new recorded capture scenario (Q-B26-FIX). `COB-architecture.md` revision 31.
- **Evidence:** suite 1925 -> **1989 passed, 1 todo (64 files)**; new file
  `b26-unpaid-interest-figure.test.ts` (65 tests, 40 red before the change); `typecheck` and
  `typecheck:tests` clean; `test:tz` 480 tests / 20 files per zone; F12 16/16;
  `check_page_smoke.mjs` PASS; capture fixture (`920c3b78...2bf2`), both goldens
  (`b7c36e65...8235`, `acfe374c...d23e`), `b23_on_state_pins.json` and `archive/pre-b27`
  byte-identical; a fresh capture equals the fixture minus provenance. Mutants 15 variants of the
  brief's 10 all killed by vitest (M1, M9 and M10 also by the capture script). QA verdict PASS
  WITH NOTES.
  - **Real Chrome:** REF-01 shows no line (screen and print); the brief's shortfall case (200,000
    at 5% monthly, payment 700, first payment 2026-05-01, End Date 2028-04-15) shows balance
    $200,000.00 and "Unpaid interest at end date $3,015.17" on screen and in print (total interest
    $19,815.17 = $16,800 paid + $3,015.17); a Renewal shortfall (accrued 125.50, payment 300)
    shows $6,715.40; Renewal with payment 900 shows no line.
  - **Independent value check:** an engine-free rebuild gives 3015.168393984311 (engine
    3015.1683939843015). Corpus sweep: 390 of 2,817 (first golden) and 260 of 2,444 (PC) positive;
    smallest 18,775.76 / 19,449.32, none negative or under half a cent; in every case the last
    closing equals the opening accrued plus the sum of period interest minus the sum of interest
    paid (max error 7e-12), which is the B19 bucket.
  - **Notes:** (1) the empty-schedule guard mentioned in B26-R2 is neither implemented nor tested;
    the code would throw on an empty schedule, which the engine never returns. (2) **Plain-language
    risk (for the user):** interest accruing from the last payment date to the End Date is in
    neither the balance nor this line. In the shortfall example the last payment is 2028-04-01 and
    the End Date 2028-04-15: about 14 days, roughly $380 on $200,000. "Owed in addition to the
    balance" could be read as the complete amount owed. (3) The source-text checks are slightly
    brittle (they reject `!==0` anywhere in `moreFigures`). The Financed switch cannot be toggled
    in the browser (shipped off); both states are covered by unit tests. There was no pre-B26 copy
    of `moreFigures` to diff; "one change" rests on mtimes and a code read.
  - Docs stale (doc-writer): manual l.132 and l.267; coverage report l.35, 178, 318, 397 (counts,
    F47 heading); domain overview l.378, 398, 482.

### 56. B24: Contract term derived; Contract date and Semi-annual date hidden (2026-09-30)

- **What:** The Term years / Term months inputs are removed from the page; ONE read-only
  "Contract term" shows "Y years, M months, D days" from the FIRST PAYMENT DATE to the LAST
  SCHEDULED PAYMENT DATE (first to last schedule row), via `termBetween` in `src/ca/calendar.ts`
  (12 calendar exports; anchored on `addMonthsClamped`, so a monthly schedule of N rows is exactly
  N-1 months; `%` not `Math.floor`) and `contractTerm(result)` in `src/ca/cobCanada.ts`, both on
  the barrels (`ui/ca-view.js` gains `contractTermParts`, `contractTermText`, `contractTermHint`,
  40 names). Blank until a schedule exists and cleared after a failed calculation; shown in the
  field, the printout and the contract-terms tile; the CSV has no term; "Term in days" unchanged.
  Contract date hidden behind `UI_SWITCHES.contractDateField` (shipped `false`); the semi-annual
  compounding reference date is optional behind the engine switch `SEMI_ANNUAL_DATE_REQUIRED`
  (`policies.ts`, `@decision Q-SACD`, shipped `false`) and hidden in the UI (a present but invalid
  date is still rejected); `requiresSemiAnnualDate(p, r, required = SEMI_ANNUAL_DATE_REQUIRED)`
  in `flows.ts`. `termYears` / `termMonths` are optional, `@deprecated`, never read and never
  validated; the three term checks ("term not both 0" included) are gone; the B13 zero-day
  COB-rate check is unchanged; `toInput` no longer sends the term keys. F7a regex widened to
  `(?:OQ|Q)-[A-Z]+`. `package.json`: `tests/ca/b24-term-rule.test.ts` added to `test:tz`.
  Removal of the deprecated fields is parked as B24-CLEANUP.
- **Why:** stakeholder decision 8 (FB-8a/8b/8c) as refined by the user 2026-09-30 ("Contract term
  refinement": first payment to last payment, literal, e.g. REF-01 shows 2 years, 11 months, 17
  days); settles OQ-P and Q-SACD; DEV-OQP (the workbook's macro does derive a term for its One
  Time frequency, l.284-290). Q-TERM-SHORT: a contract under one month is allowed.
  `COB-architecture.md` revisions 30-32.
- **Evidence:** suite 1989 -> **2172 passed, 1 todo (66 files, 2173 tests)**; 40 tests retired
  (a9-input-issues 7, numericGuard-b3a 26, spec011 3, validate 1, defects012 3), about 223 added
  (b24-term-rule 123, b24-form-cleanup 86, a type test, term vectors); `typecheck` and
  `typecheck:tests` clean; `test:tz` 21 files / 604 tests per zone; F12 16/16;
  `check_page_smoke.mjs` PASS; goldens (`b7c36e65...8235`, `acfe374c...d23e`),
  `b23_on_state_pins.json` and `archive/pre-b27` unchanged. Old-vs-new sweep: 5,261 golden-corpus
  inputs and 21,044 term-variant runs byte-identical; 189,396 validation comparisons with 0
  differences beyond the removed term checks; 1,605 fixed mortgages without the semi-annual date
  equal the old results with it. Independent oracle (plain Y/M/D search, no shared code): 27/27
  table rows, 237,000 grid cases, monthly N-1 months in 2,000 engine runs, `contractTerm` matches
  the schedule's first and last row dates in 5,261 corpus schedules. Mutants 29/29 killed (MUT-1..14
  and 15 extras); six are killed only by the Chrome scripts (print text, hint literal, non-breaking
  tile spaces, semi-annual tile and print row, field refresh). QA verdict PASS WITH NOTES.
  - **Capture fixture regenerated (user-approved 2026-09-30):** old `920c3b78...2bf2` (1,206,626
    bytes) -> new `5a314af06f17a54d33454c0b28acefc8d76534682ce026ef05782a98aa151ae7` (1,204,223
    bytes); a fresh capture equals it minus provenance. Changes: 24 raw keys removed
    (`contractDate`, `termYears`, `termMonths`, `semiAnnualCompoundingDate` x 6 scenarios); 8
    `printInputs` and 8 `contractTermsList` strings changed (scenarios 0, 1, 2, 4, each in `all`
    and `compact`): REF-01 `3 years, 0 months` -> `2 years, 11 months, 17 days`, S1_fees `1 years,
    0 months` (tile `1 year, 0 months`) -> `2 years, 11 months, 17 days`, RENEWAL `2 years, 6
    months` -> `2 years, 5 months, 0 days`, VRPC_zero_accrued `5 years, 0 months` -> `4 years, 11
    months, 11 days`; the Contract date row is gone from all 8 print inputs, the Semi-annual row
    from 6, and the Semi-annual tile from 6 (tile spaces are non-breaking); 6 `contractTermField`
    keys added (the two error scenarios `""`); 4 `termHint` keys added (new and renewal "...from
    the first payment date..."; Payment Change and VRPC "...from the next payment date...");
    `provenance` date and tree. Figures, CSV names and bytes, and `formDefaults` unchanged. The
    b27-T11 sha pin was updated to the new hash.
  - Notes: (1) the F5 edge flows -> policies and the relaxed A7-2 ("only cobCanada mentions
    policies") are not in the brief; they follow from B24-R5's defaulted parameter and are
    acceptable, the architect should record them in section 6 F5 and A7-2. (2) Other edits
    beyond the brief's list accepted: flows-a6 A6-1 (allows the policies import), A6-3 / A6-4
    (third argument `true`), calendar-a4 export list, a13 test:tz list. (3) `ca.js` wiring (hint
    call, print text, semi rows) is pinned only by the Chrome scripts; QA can add static
    assertions if wanted. (4) The hidden `#semiAnnualField` stays in the DOM with its default
    value (hidden, not removed, never sent). (5) B25 must add the typed-versus-moved first-date
    test that B24 cannot kill.
  - Docs stale (doc-writer): manual l.39, 107, 112, 130, 169, 214-216, 233, 276, 371, 425;
    coverage report l.50, 80, 174, 179, 219, 220, 229, 241, 320, 338, 339 and counts; domain
    overview l.215, 216, 219, 454, 483.

### 57. B26-HINT: reworded hint for "Unpaid interest at end date"; stale it.todo removed (2026-09-30)

- **What:** The hint of the B26 figure "Unpaid interest at end date" is now exactly "Unpaid after
  the last payment; interest since then is not included" (was "Owed in addition to the balance at
  end date"). One string literal changed in `ui/ca-view.js` (`moreFigures`, line 329); the label,
  the trigger (last row's `carriedAccruedInterestClosing` strictly `> 0`) and the position are
  unchanged. Tests: `b26-unpaid-interest-figure.test.ts` (plus a guard that the old literal is
  gone), `capture_a10_ui.mjs` and `check_print_width.mjs` assert the new hint. The placeholder
  `it.todo` and its empty describe (D-13, "manual: ... MT-13a/b") were removed from
  `tests/ca/defects012.test.ts` and the header comment now points to the B22 tests and the Chrome
  capture (user-approved 2026-09-30: B22 delivered those labels and closed OQ-A). Engine, `dist/`,
  CSV, fixtures and goldens untouched. Wording stays interim under Q-MSG.
- **Why:** user decision 2026-09-30, answering QA's B26 note: interest accruing between the last
  payment and the End Date is in neither the balance nor this figure (example: last payment
  2028-04-01, End Date 2028-04-15, about 14 days, roughly $380 on $200,000), so the old hint
  could be read as the complete amount owed. `COB-architecture.md` revision 32.
- **Evidence:** suite 1989 -> (B24) 2172 -> **2173 tests, all passed, 0 todo (66 files)** (the
  guard replaced the removed todo); `typecheck` and `typecheck:tests` clean; `test:tz` 604 per
  zone; F12 16/16; `check_page_smoke.mjs` PASS; capture fixture (`5a314af0...1ae7`),
  `b23_on_state_pins.json` (`b8a945dc...`) and both goldens (`b7c36e65...8235`,
  `acfe374c...d23e`) byte-identical, and a fresh capture equals the fixture minus provenance.
  Real Chrome, shortfall case (200,000 at 5% monthly, payment 700, first payment 2026-05-01, End
  Date 2028-04-15): "Unpaid interest at end date $3,015.17" with the new hint on screen and in
  the printout; REF-01 shows no line. Printed page: the 66-character hint sits on its own line
  under the label (10px, one line, no wrap), nothing clipped, no collision with "Term in days";
  the shortfall printout is 2 pages. Mutants H1 (old hint left), H2 (hint and label swapped),
  M8b (one character altered) and M9 (hint omitted) all killed. QA verdict PASS WITH NOTES.
  - Notes: there is no git HEAD or pre-change copy, so "one literal changed" rests on mtimes and
    greps; the it.todo removal could not be isolated from B24's D09 retirement in the same file,
    but against the only earlier snapshot the diff is the header comment, the B24 retirement and
    the D-13 block. The oracle for the UI strings is hand-made (values measured on the built tree).
  - Old hint still in text (historical or decision text, deliberately kept or for the
    doc-writer): `HANDOFF.md` l.55/141, `docs/COB-user-manual.md` l.257, `docs/COB-domain-overview.md`
    l.400, `docs/COB-coverage.md` l.35/161/318/378/387, `COB-architecture.md` l.500/2463/2500,
    `COB-user-stories.md` l.249/572 (original decision text), §55 above (historical).

### 58. B29: Help page (removable add-on, ADR-15)

- **What:** A "Help" link in the calculator header opens `ui/help.html` in a new tab. The page
  is generated by `node help/build-help.mjs` from `COB-ts/docs/*.md` (user manual as default,
  coverage report, domain overview with 14 Mermaid diagrams). Own package `COB-ts/help/`
  (markdown-it 15.0.2, mermaid 11.17.2, exact pins), own tests and README with the numbered
  removal steps. The calculator, engine, root `package.json` and goldens are untouched.
  `ui/serve.mjs` hardened after the security review: listens on 127.0.0.1 only, GET/HEAD only
  (405 otherwise), Host must be localhost or 127.0.0.1 (403 otherwise), realpath containment,
  `nosniff`. The doc-writer added a "Getting help" subsection (manual §2) and a coverage row.
- **Why:** The user asked for in-app help built from the documents, removable without touching
  the calculator. Security review found no critical or high issues; its medium (listening on
  all interfaces) and three low items were fixed; the block-level raw HTML refusal already existed.
- **Evidence:** suite 74 files / 2624 (1 QA test wrong) -> QA test fixes (G4 filter, F14
  checks 17/18 with the `out` chip dashed per design 7.1, nested describe un-nested) -> 2632 ->
  serve hardening tests -> **76 files, 2663 tests, all passed**; `typecheck` and
  `typecheck:tests` clean; fixtures byte-identical (capture `5a314af0...`, goldens `b7c36e65...`,
  `acfe374c...`); F14 132/132 (check 30 first-contentful-paint race fixed by QA with a buffered
  observer); F15 removability passes (after removal 67 files / 2204 tests); smoke, F12 16/16 and
  capture equal; 22 of 24 mutants run, all killed (MUT-27 and MUT-34 mutate test code, not run).
  Page rebuild reproducible (byte-identical). QA verdict PASS WITH NOTES.
  - Notes: `COB-architecture.md` still says 66 files / 2179 tests after removal (should be 67 / 2204;
    architect to fix); accepted low items: `ui/serve.mjs` is itself served; no `frame-ancestors`
    (meta CSP cannot set it); the logo is requested from alterna.ca when the page is viewed.

### 59. Renewal allows Personal loan again; PC / VRPC start-date label "Date of change" (2026-10-01, user-approved)

- **What:** In `src/ca/flows.ts` (applied by the main session): `renewal.forcedProductType` is now
  `null` (was `'mortgage'`), so Renewal accepts Personal loan as well as Mortgage and the Renewal
  lock message is gone; Personal loan stays Monthly only (B27). `paymentChange` and
  `variableRatePaymentChange` `startDateLabel` is now `'Date of change'` (was `'Last payment date'`);
  `firstPaymentDateLabel` stays `'Next payment date'`; New / Renewal labels and VRPC's
  mortgage + variable lock are unchanged. QA updated the tests that encoded the old rules:
  `b21-renewal-mortgage-only` (file name kept as history; now pins the reversed rule: Renewal +
  personal loan valid and monthly-only, Renewal + mortgage valid, VRPC still locked),
  `flows-a6` (table, A6-5, A6-6 now 13 combinations), `b22-use-case-labels`,
  `a9-input-issues` (row 13b retired, 30 rows, new A9-1b), `b27-personal-loan-monthly-only`
  (Renewal joins the flows; matrix 30 cases; T4 renewal case now one `paymentFrequency` issue),
  and `help/tests/fixtures/pre-b29-baseline.json` (`trees.src` refreshed: flows.ts changed).
  Decision text updated in `COB-user-stories.md` (§3 table, UC steps, acceptance criteria, OQ-A,
  DQ-16, B22 rows) and the checklist.
- **Why:** The user reversed the 2026-09-29 decision 9 (B21, "Renewal is mortgage-only") and
  renamed the PC / VRPC start-date label (replaces the B22 / OQ-A wording "Last payment date").
  No Excel reference exists (the workbook has no use cases), so no DEV ID.
- **Evidence:** before the QA edits the change added 25 failures on top of the 158 B25 reds
  (183). After the edits the suite is back to the B25 set plus 4 tests that need the user's
  approval to change `a10_ui_capture_v1.json` (listed below). Goldens untouched; they are not
  affected (their personal-loan renewal keys are still sent as paymentChange, B21-7a).
  - **Approved 2026-10-01 and applied (fixture `tests/ca/fixtures/a10_ui_capture_v1.json`; new sha256 `381af9d13e3aa76ed23357ad1b31867367ae4f4f7ac3cab138daeaed8e8a8c1b`, after the second approval below, refreshed in `help/tests/fixtures/pre-b29-baseline.json`):**
    `flowScreens.paymentChange.startDate` and `flowScreens.variableRatePaymentChange.startDate`:
    "Last payment date" -> "Date of change"; and in the `VRPC_zero_accrued` scenarios (all and
    compact) `printInputs`: `<dt>Last payment date</dt><dd>Jun 15, 2026</dd>` -> `<dt>Date of change</dt><dd>Jun 15, 2026</dd>`
    (4 strings; the "Last payment date" contract-term tile is a different field and stays).
    Second approval 2026-10-01, applied: `VRPC_zero_accrued` (all and compact) `contractTermsList` tile label
    "Last payment date" -> "Date of change" (2 strings; the tile follows the flow's start-date label). Open item closed.
    Sha256 `d62ffe12...` -> `381af9d1...` refreshed in `help/tests/fixtures/pre-b29-baseline.json`,
    `b27-personal-loan-monthly-only` (B27-T11) and `golden/b25-golden.test.ts`.
    These six strings are the only fixture change. They turned B22-7 (paymentChange, VRPC), A10-C16, A10-C17 green; the B29 baseline sha256 is refreshed.
  - Still saying "last payment date" in `ui/` (not edited): `ui/ca-view.js` l.198 (Renewal hint
    "Interest accrued since the last payment date."), l.200 and l.202 (PC / VRPC arrears hint
    "... Interest since the last payment date is already charged."); `ui/ca.html` l.711 (same
    Renewal hint). These are hint texts the user fixed on 2026-09-29, not the label.

### 60. UI switch `variableRatePaymentChangeFlow`: Variable rate payment change hidden in the Flow dropdown (2026-10-01)

- **What:** `UI_SWITCHES.variableRatePaymentChangeFlow` (ADR-14), shipped `false`, in `ui/ca-view.js`;
  `<option value="variableRatePaymentChange" data-switch="variableRatePaymentChangeFlow">` in `ui/ca.html`;
  a comment in `ui/ca.js`. The Flow dropdown now offers New mortgage / loan, Renewal, Payment change.
  Engine, `dist/`, both goldens and `a10_ui_capture_v1.json` unchanged. No DEV ID (UI choice only).
- **Why:** user decision 2026-10-01: hide VRPC behind a switch (deactivated, not removed). Recorded in
  `COB-user-stories.md` section 7.5 row "VRPC flow hidden" and in the ADR-14 switch list.
- **Evidence (QA verify, 2026-10-01):** `help/tests/fixtures/pre-b29-baseline.json` re-pinned for
  `ui/ca-view.js`, `ui/ca.html` (HELP blocks stripped) and `ui/ca.js` (`ui/ca-view.d.ts` was done
  earlier); `b29-help-link` green. Build and `typecheck` / `typecheck:tests` exit 0. `npx vitest run`:
  79 files, 158 failed, 2810 passed, all in the B25 red set (b25-semimonthly-move, b25-golden,
  semiMonthlyDates-t4, engineGolden, defects012, calendar-a4, loopEquations-a5, b19-switch-on,
  b11-waterfall-cap sweep row count 884,665 vs the B25 value 877,656), none from the switch; `b29-help-removal`
  has 2 failures that are the same B25 goldens run inside the removal copy. Chrome: smoke PASS, capture equal to the
  fixture minus provenance, F12 16/16; independent check: Flow has exactly 3 options, Payment change + Mortgage +
  Variable + Accrued interest 0 shows "Trigger rate" (10.62369%), Renewal accepts Personal loan, no console errors.
  The smoke script's "4 options" means the four Payment Frequency options, not Flow.

### 61. B25 engine step: semi-monthly First Payment Date moved forward to the next 15th / month-end (2026-10-01, DEV-OQZ)

- **What:** `effectiveFirstPaymentDate(frequency, first)` in `src/ca/calendar.ts` (semi-monthly: day 15 or month-end
  unchanged, days 1-14 -> the 15th, 16..day-before-month-end -> month-end, same UTC month; every other frequency returns
  `first` itself); used once by `src/ca/cobCanada.ts` (the schedule starts from the moved date) and by
  `src/ca/validate.ts` (End-after-first and start-on-or-before-first compare with the moved date; the End message gains
  " (moved to YYYY-MM-DD for semi-monthly payments; compared as UTC calendar dates)" only when the date was moved,
  otherwise byte-identical). No new result field. Known divergence DEV-OQZ (the macro keeps the typed day pattern).
  Consequence: a start date between the typed and the moved date (typed 2027-01-10, start 2027-01-12) is now accepted.
  UI step (note on screen, Q-SEMI-DETAIL-1..4) is still open.
- **Why:** stakeholder decision 10 (FB-2b); user decisions 2026-10-01 (Q-SEMI-SHOW).
- **Golden (approved by decision 10):** `golden_engine_v1.json` regenerated, sha256 `249651b2...cf11`, byte-equal to QA's
  oracle `golden_engine_v1_b25_expected.json`. Changed groups: 20 of 94, 504 of 2,817 cases: the 18 `semiMonthly|mortgage/
  fixed|...` and `semiMonthly|mortgage/variable|...` groups (none / fin2000 / fin2000cash400 x new / renewal0 /
  renewal850), plus `extra:minimumPayment` and `extra:semiMonthlyMonthEnd`. The other 74 groups and the long case are
  identical. `golden_engine_pc_v1.json` (`acfe374c...`) and `a10_ui_capture_v1.json` (`381af9d1...`) unchanged.
- **Evidence (QA verify, 2026-10-01):** build, `typecheck`, `typecheck:tests` exit 0. `npx vitest run`: 79 files,
  2968 passed, 0 failed (calculator tree without Help: 70 files, 2509). `test:tz`: 23 files, 880 passed per zone, both
  zones (`b25-semimonthly-move` added to both lists in `package.json` and to the pinned list in `a13-build-scripts`).
  `help/tests/fixtures/pre-b29-baseline.json` re-pinned: first golden sha, `trees.src`, `package.json` sha, counts
  (baseline 69 / 2478, afterRemoval 70 / 2509, test:tz 880); `b29-help-link` and `b29-help-removal` green. QA's own sweep
  (not sr-dev's code): 762 consecutive typed dates 2026-12-01..2028-12-31 (leap and non-leap February, 30/31-day months,
  year ends) x semi-monthly: row 1 equals the rule and the whole date list equals an independent 15th / month-end
  alternation; 3,810 runs of the five other frequencies: first row = typed date. Spot checks of the messages
  (typed 01-16 / End 01-20 and 01-31 rejected as "moved to 2027-01-31", End 02-01 accepted, monthly unchanged).
  Diff of `calendar.ts`, `cobCanada.ts`, `validate.ts` matches brief rules B25-R1, R2, R3, R5; no result field (R4);
  architecture tests (UTC only, no rounding, `src/ca` imports) green.

### 62. B25 UI step: the moved semi-monthly first date is shown (2026-10-01, DEV-OQZ)

**What.** `ui/ca-view.js` gains `firstDateMoveNote(label, typedIso, firstRowDate)` (`''` when not moved) and `printInputRows(..., moveNote)` adds a row "Moved first date" directly under the first-date row only when moved. `ui/ca.html` gains `#firstDateNote` (under the First payment date field) and `#contractTermsNote` (under the Contract terms tiles). `ui/ca.js` fills both with `textContent`, hides them when not moved or after an error, passes the note to the printout, and names the CSV from the moved date. Wording (user-approved): "First payment moved to <Mon D, YYYY> (semi-monthly payments fall on the 15th and month-end)"; the Next payment flows say "Next payment moved to ...". The typed date stays in the inputs and the printout.

**Why.** Decision 10 / Q-SEMI-SHOW: the move must be visible, never silent.

**Evidence (QA, real Chrome).** `check_semimonthly_move.mjs` (F17) PASS, 54 checks. Six mutations each turned F17 red: screen note empty, screen note always hidden, tiles note empty, print row removed, CSV name fixed, wording changed; a seventh (note not cleared on error) also red. Files restored (sha verified). Own checks: note updates when a field changes, disappears when the typed date is a 15th, shows month-end for typed 01-20; printout contains the note once; printed PDF page fits with the extra row. `check_page_smoke` PASS, `check_print_width` 16/16 (F12 has no moved-date scenario; checked by hand, fits). Capture equals `a10_ui_capture_v1.json` (381af9d1...) minus provenance; goldens unchanged (249651b2..., acfe374c...). Pins updated by QA: A10-P3 export list (41 names, adds `firstDateMoveNote`), Help baseline hashes of `ui/ca.html` (HELP blocks stripped), `ui/ca.js`, `ui/ca-view.js`. Suite 80 files / 2994 passed; typecheck, typecheck:tests clean; `test:tz` 880 per zone.

### 63. A11 scope B: the print schedule table is built on demand (2026-10-01, user decisions Q-A11-SCOPE = B, Q-A11-FIX = No)

**What.** `ui/ca.js` only: new `ensurePrintSchedule()` is the sole caller of `renderPrintSchedule`; it does nothing without a result and caches on (result, `scheduleColumns`). It runs from the window `beforeprint` event and from the `matchMedia('print')` change event. `recompute`, `renderPrintRecord` and the column radio handler no longer build the print table. The screen table still rebuilds on every keystroke; no timers, no pause (scope C dropped by the user). Engine, goldens, capture fixture untouched.

**Why.** Chrome measured the weekly 30-year schedule at 383 ms keystroke to paint; the table nobody sees on screen is about a fifth of it (architecture rev 42). User chose B (no visible change) and not to regenerate `a10_ui_capture_v1.json`.

**Evidence (QA, real Chrome).** F18 `check_render_cost.mjs` PASS, 29 checks. Timing, weekly 30y (1595 rows), median of 7: handler 108 ms (pre-A11 162), keystroke to paint 351 ms (pre-A11 383). Ten mutants (scratch copy, control green): print table built in recompute; no-result guard removed; cache ignoring columns; cache ignoring result; cache never stored; matchMedia listener dead; beforeprint listener removed; radio not rebuilding the screen table; recompute not rebuilding the screen table; print count line unset. Each turned F18 red (6 also turn `a11-print-on-demand.test.ts` red; the other 4 are caught only by F18). Own checks: `page.pdf` after a typed change contains the complete schedule (monthly 30y 358 payments, weekly 30y 1,094 payments, both column modes; print rows = screen rows; last payment present; new rate in the record); inputs are not visible in print media so typing there is not possible. Smoke PASS, F12 16/16, F17 PASS (54), capture equals fixture minus provenance (fixture sha 381af9d1... unchanged, goldens 249651b2... / acfe374c... unchanged). Pins: Help baseline `ui/ca.js` -> b69aacc7...; `afterRemoval` counts refreshed to the measured 72 files / 2542 (were stale 70 / 2509); `check_help_removal.mjs` F15 PASS. Suite 81 files / 3001 passed; typecheck, typecheck:tests clean; `test:tz` 880 per zone. Note: the typical 1595-row case is still about 350 ms because the screen table stays per keystroke (a consequence of scope B).

### 64. A14: dead citations replaced by BRD section numbers and "archive" wording (2026-10-01, user decision Q-A14-GUARD = No)

**What.** Comment-only edits (sr-dev) in `src/ca/equations.ts`, `validate.ts`, `cobCanada.ts`, `types.ts`; `tests/ca/defects012.test.ts`, `fixtureParity.test.ts`, `spec011.test.ts`, `spec011-d9.test.ts`, `b11-waterfall-cap.test.ts`, `cobCanada.test.ts`; and the header paragraph of this file. Citations of retired paths now name the BRD section (equations 1 and 2 = BRD 4.2 / Appendix A; 3 = 4.4 / B.3; 4 = B.5; 6 = 4.3; 7 and 8 = 4.1 / B.7; inputs = 3.1; schedule = 3.3, 4, Appendix B; validation and fee limit = 6) or say "archive" for `~/Projects/cob_calculator` material. No code, assertion, `it` title (`spec011-d9.test.ts:216` unchanged) or fixture changed. Decision Q-A14-GUARD = No: no guard test is added against future dead citations. Scope: only the named lines. Other "doc 007 finding #n", "doc 007 addendum" and "spec 011/012 D-nn" mentions are deliberately left (they name archived documents, not live paths): `src/ca/equations.ts` (160, 233, 263, 289, 325), `calendar.ts:36`, `cobCanada.ts` (43-44, 123, 173-178, 215, 233, 236, 277, 285), `types.ts` (66, 85, 92, 101, 139, 172, 227-241), `tests/ca/cobCanada.test.ts` (63, 71, 94, 126-129, 175, 197), `tests/ca/invariants.test.ts`.

**Why.** A14 (architecture section 5): citations pointed at files that no longer exist in the live tree.

**Evidence (QA).** `a14proof.mjs verify`: 11 files changed in bytes (10 sources + CHANGES.md); non-comment token stream changed in 0; emitted JS/d.ts with comments removed differs in 0; fixtures, goldens, package files, tsconfig unchanged. Manual read of every cited section against `COB-business-requirement.md`: 3.1 (IN-01, IN-03), 3.3, 4.1, 4.2, 4.3, 4.4, 6, Appendix A, B.3, B.5, B.7 exist and say what the comments claim; cited fixture `d9_oracle_vectors.json` exists; no new dead path. Help baseline `trees.src` re-pinned (3276caa6... -> 1a56b016...; comment-only). Build, suite 81 files / 3001 passed, typecheck and typecheck:tests clean, `test:tz` 880 per zone; goldens v1 249651b2..., PC acfe374c..., capture 381af9d1... unchanged; `dist/` rebuilt.

### 65. Trigger-rate highlight dropped; domain overview cleaned (2026-10-01, user decisions)

**What.** No product code changed. The user first asked that the Trigger rate figure stand out in the figures list (chose "keep in list, make it stand out"); QA wrote red tests (`tests/ca/b30-trigger-highlight.test.ts`) and a design (class `figure--highlight`, screen only). The user then found the figure (it only shows once Accrued interest is entered for Payment change, entry 60) and asked to go back, so the highlight was dropped before any implementation. The QA test file was deleted (user approved) and its one-line `ui/ca-view.d.ts` edit (a `highlight` parameter and a comment) was reverted byte for byte. `COB-ts/docs/COB-domain-overview.md` was rewritten shorter (525 to 313 lines) for domain experts, with A11 and A14 recorded as delivered and "Last payment date" replaced by "Date of change"; the decision is recorded in `COB-user-stories.md` section 7.5 and `COB-architecture.md` revision 43.

**Why.** The highlight was not needed once the figure was found; the overview had stale B22, B25, A11 and A14 statements.

**Evidence.** Suite 81 files, 3001 passed, 0 failed (re-run by the main session); Help tests 465 passed on three consecutive runs; `help/build-help.mjs --check` up to date; the `ui/ca-view.d.ts` hash is back to its pinned value (`0f8c1edb...`). The Help figure-count pin (14 diagrams) stays as is; a smaller diagram count would need QA to re-pin it (not requested).

### 66. B30: one shareable `COB.html` (2026-10-01, user decisions)

**What.** New loosely coupled build output, in the same spirit as Help (ADR-15): `COB-ts/share/` (`package.json` with no dependencies, `build-share.mjs`, `lib/csp.mjs`, `lib/html.mjs`, `lib/modules.mjs`, `assets/alterna-savings.svg`, `README.md` with removal steps, QA tests in `share/tests/`) generates `COB-ts/COB.html` (150,250 bytes) from `ui/`, `dist/` and `package.json`, read-only. Nothing in the calculator, engine, root `package.json`, `ui/`, `src/` or `help/` changed. User decisions: logo embedded (data URI, not a link); system fonts, no web fonts; no bundler dependency (hand-written); Help left out; footer with version and build date (screen only); output `COB-ts/COB.html`; no root npm script (`npm run build --prefix share` or `node share/build-share.mjs`); the logo link is stripped. Also accepted by the user: the font-measured `--term-em` numbers are masked in the capture comparison (QA F-2), and import aliases are supported but export aliases are rejected (F-1). A Content-Security-Policy meta tag allows only the one inline script (by sha256), inline styles and data images.

**Why.** Let a colleague open or e-mail one file and run the calculator offline from `file://`, with no server.

**Evidence (QA verify).** `npm run build`; `npx vitest run` 86 files, 3133 passed, 0 failed; `typecheck` and `typecheck:tests` clean; `test:tz` 880 passed in both zones; Help `--check` up to date. Pins unchanged: root `package.json` b8680e37..., goldens 249651b2... and acfe374c..., `a10_ui_capture_v1.json` 381af9d1.... Two builds with `--date 2026-10-01` (and via `COB_BUILD_DATE`) are byte-identical (sha 58a8a866...). A bad import in a scratch `--root` and a bad date fail with exit 1 and leave the old output untouched. In real Chrome on `file://` (also a copy in a scratch folder): no console error, only `file:` requests, no links, system fonts, footer "COB Calculator v0.1.0 · built 2026-10-01 · single-file edition, works offline", no horizontal overflow at 360/768/1280, dark mode works, PDF and CSV work. Six scenarios (new with a fee, renewal, payment change fixed, payment change variable with Trigger rate, personal loan, semi-monthly moved date) match the served page in figures, schedule, printout and CSV text; only the font-measured `--term-em` numbers differ. `share/tests/check_share_page.mjs` 38 checks PASS on both copies (runs the capture, smoke, F12, F17 and render-cost scripts through `COB_PAGE_URL`). Mutants on a scratch copy (control green, 132 share tests): wrong CSP hash, http image, external link, Help block kept, version fetch kept, export alias accepted, non-deterministic date, logo link kept, web font kept, output clobbered on failure, CSP removed: 11/11 turned red. Notes: `--check` reports "older than" after any `npm run build` (dist is newer), by design; the default build date is UTC today, so pass `--date` for a reproducible file. Security review: pending.

**Security review (2026-10-01, read-only).** Nothing above minor. The CSP hash matches the inline script; no remote request, no Help or external link, no storage; builder paths and injected values are validated; no dependencies. Minor, left as notes: (1) `ui/ca.js:140` `addFeeRow` puts `values.name` into an attribute unescaped (called with no argument today, no sink); (2) `--out` can overwrite any path; (3) cosmetic dangling-symlink message; (4) form submit is blocked by `form-action 'none'` (safe).

### 67. Payment Change "Accrued interest" hint reworded (2026-10-01 decision, QA verified 2026-10-02)

**What.** `ui/ca-view.js` `ACCRUED_TEXT.paymentChange` is now "Interest accrued since the last payment date." (the Renewal wording). `variableRatePaymentChange` (hidden flow) keeps the old arrears text. `COB.html` rebuilt (`node share/build-share.mjs --date 2026-10-01`; a rebuild gives identical bytes). The user approved changing exactly one fixture string: `tests/ca/fixtures/a10_ui_capture_v1.json` `flowScreens.paymentChange.accruedInterestHint`, from "Only interest due at earlier payments and not yet paid (arrears), usually $0.00. Interest since the last payment date is already charged." to "Interest accrued since the last payment date." Fixture sha256 381af9d1... to 171f8a33... Re-pinned: that sha in `tests/ca/golden/b25-golden.test.ts`, `tests/ca/b27-personal-loan-monthly-only.test.ts`, `help/tests/fixtures/pre-b29-baseline.json` and `share/tests/fixtures/pre-b30-pins.json`; `ui/ca-view.js` in the Help baseline (a6212701... to 1e081d1e...). No COB.html pin exists.

**Why.** User decision 2026-10-01. Decision 2 / FB-16 had made the field mean arrears only, with a hint saying so.

**QA note (user was told and chose to proceed).** The new wording drops the arrears explanation. A user may enter the interest accrued since the last payment in the field, and it would be charged twice, because the schedule starts at the Date of change (decision 2 / FB-16). The engine is unchanged.

**Evidence.** `npm run build`; `npx vitest run` 86 files, 3133 passed, 0 failed (the first run after the edit showed 1 failed test that did not reproduce in four further full runs; cause not identified, probably a load-related timeout); `typecheck`, `typecheck:tests` clean; `test:tz` 880 per zone; Help `--check` up to date. Chrome: capture of the served page equals the updated fixture minus provenance; `share/tests/check_share_page.mjs` PASS (38 checks, runs the capture against COB.html); smoke, F12 (16/16), F17 (54), F18 (29) PASS. The old text still appears only in `ui/ca-view.js` (VRPC) and `COB.html` (same). Stale text left for doc-writer: `docs/COB-user-manual.md` line 171 (and the generated `ui/help.html`), plus HANDOFF, architecture B22-R6 and user stories text.

### 68. Payment Change "Accrued interest" hint: arrears wording restored in a new form (2026-10-02, user decision; QA verified)

**What.** `ui/ca-view.js` `ACCRUED_TEXT.paymentChange` is now "Interest accrued since the last payment date is already included; enter only earlier unpaid interest (arrears), usually $0.00." `variableRatePaymentChange` (hidden flow) and Renewal ("Interest accrued since the last payment date.") are unchanged. `dist/` and `COB.html` rebuilt (`node share/build-share.mjs --date 2026-10-01`). One approved UI fixture string changed in `tests/ca/fixtures/a10_ui_capture_v1.json`: the old string was the section 67 wording "Interest accrued since the last payment date." (fixture sha 171f8a33...); new fixture sha 5c6c69b5.... The Help baseline (`help/tests/fixtures/pre-b29-baseline.json`) re-pinned for `ui/ca-view.js` (now aaed5740...); the share pins (`share/tests/fixtures/pre-b30-pins.json`) needed no change (they already carry the fixture sha 5c6c69b5... and do not pin `ui/ca-view.js`).

**Why.** User decision 2026-10-02. It supersedes the section 67 wording and closes the double-charge note of section 67 / F69 for the hint: the text again tells the user that accrued interest is already included and that only arrears are entered.

**Evidence (QA).** `npm run build`; `npx vitest run` 86 files, 3133 passed, 0 failed; `typecheck` and `typecheck:tests` clean; `test:tz` 880 passed in both zones; Help `--check` up to date. Chrome (served page and `COB.html`) at 360/768/1280 px: Payment change hint reads exactly the new text, wraps inside its field with no horizontal overflow; Renewal hint unchanged; the form hint is not part of the printout (print media hides it), so print width is unaffected (F12 16/16). Capture equals the fixture minus provenance; `build-share.mjs --date 2026-10-01` reproduces the current `COB.html` byte for byte; `check_share_page` 38 checks PASS, smoke PASS, F12 PASS 16/16, F17 PASS 54, F18 PASS 29. Note: the single unexplained failure seen once after section 67 never reproduced here (full suite green on the run for this section).

### 69. Payment Change "Accrued interest" hint reverted to the short text (2026-10-02, user decision; QA verified)

**What.** `ui/ca-view.js` `ACCRUED_TEXT.paymentChange` is back to "Interest accrued since the last payment date." (the section 67 text). Renewal is unchanged (same words) and the hidden `variableRatePaymentChange` keeps its arrears text. `ui/ca-view.js` sha256 is `1e081d1e...`, equal to the section 67 file. `dist/` and `COB.html` rebuilt (`node share/build-share.mjs --date 2026-10-01`); `COB.html` sha256 is `ec6c3075...`, equal to the section 67 era COB.html. UI fixture `tests/ca/fixtures/a10_ui_capture_v1.json`: one approved string back to the section 67 text, sha `5c6c69b5...` -> `171f8a33...`. Help baseline `help/tests/fixtures/pre-b29-baseline.json`: `ui/ca-view.js` re-pinned `aaed5740...` -> `1e081d1e...`, note in `recorded`.

**Why.** User decision 2026-10-02. It reverses section 68.

**Risk open again.** The double-charge risk recorded at section 67 / F69 is OPEN AGAIN for the hint: the short wording does not repeat the arrears advice, so a user may enter the interest accrued since the last payment in the field and have it charged twice. The remaining guards are the Date of change label and the user manual.

**Evidence (QA).** `npm run build`; `npx vitest run` 86 files, 3133 passed, 0 failed; `typecheck` and `typecheck:tests` clean; `test:tz` 880 passed in both zones; Help `--check` up to date (doc-writer re-run and rebuild still pending for the hint wording). Chrome: capture equals the fixture minus provenance; `share/build-share.mjs --date 2026-10-01` reproduces `COB.html` byte for byte; `check_share_page.mjs` 38 checks PASS; smoke, F12 (16/16), F17 (54), F18 (29) PASS.

### 70. B31: result figures in two columns on the printout; screen list and "More figures" regrouped (2026-10-05, user decision DEC-B31-LAYOUT; QA verified PASS WITH NOTES)

**What.** UI only (`ui/ca-view.js`, `ui/ca.js`, `ui/ca.html`); no engine file, no label, hint or value change, CSV unchanged. `printFigures(result, ctx)` now returns `{ left, right }` (breaking for the view module only; export count stays 41); `mainFigures` and `moreFigures` keep their signatures with new contents (private helper `amountFigures`).
- **Printout:** two columns read top to bottom (`div#printFigures.figure-columns` holding `dl#printFiguresLeft` and `dl#printFiguresRight`). Left: Cost of borrowing rate (APR), Calculated rate, Number of payments, Term in days, Balance at end date, Unpaid interest at end date (when above $0), then with the Financed option on (currently off): Fees recovered through payments, Disbursal amount. Right: Total of all payments, Cost of borrowing amount (with its hint), Total principal paid, Total interest, Trigger rate (variable mortgage only, BR-08 unchanged).
- **Screen:** the two KPI cards are unchanged; the main list is the printout's right column, with Cost of borrowing amount shown without its hint (the hint stays on its card); the collapsed "More figures" is the printout's left column without the APR.

**Why.** User decision 2026-10-05 (DEC-B31-LAYOUT, `COB-user-stories.md` §7.5); screen part revised by the user the same day; Q-B31-DUP-HINT = hint on the card only, Q-B31-ON-ORDER = as recommended, Q-B31-NARROW moot. Brief: `COB-architecture.md` §5 B31, revision 49.

**Fixtures.** `tests/ca/fixtures/a10_ui_capture_v1.json` regenerated (user-approved, order and structure only), sha `171f8a33...` -> `ac76408a...`. Changed strings, in each of the 8 entries (REF-01, S1_fees, RENEWAL, VRPC_zero_accrued x all/compact): `html.printFigures` removed; `html.printFiguresLeft` and `html.printFiguresRight` added; `html.mainFigures` and `html.moreFigures` changed; `figures` re-ordered; plus `provenance.chrome` and `provenance.date`. Everything else byte-identical. New QA pin fixture `tests/ca/fixtures/b31_pre_layout_pins.json` (taken before the change). Re-pinned with notes naming B31: `help/tests/fixtures/pre-b29-baseline.json` (stripped `ca.html`, `ca.js`, `ca-view.js`, `ca-view.d.ts`, capture), `share/tests/fixtures/pre-b30-pins.json` (capture), B25-T9 and B27-T11 (capture sha). Both goldens (`249651b2...cf11`, `acfe374c...d23e`), `b23_on_state_pins.json` (`b8a945dc...85c4`) and `dist/` byte-identical.

**Evidence (QA + main session).** `npm run build`; `npx vitest run` 87 files, 3216 passed, 0 failed (confirmed by the main session); `typecheck` and `typecheck:tests` clean; `test:tz` 880 passed in both zones. QA's own oracle: 520 valid combinations, 6,760 checks, 0 failures; trigger rate only for variable mortgages. Mutants 16/16 killed against an unmutated control run. Chrome: smoke PASS, F12 16/16, F17 (54), F18 (29) PASS; printed page counts unchanged (DEFAULT and REF-01 5, SHORTFALL 2). Notes: capture `provenance.tree` text is written by the script and still reads "post-B24" (minor); after the doc-writer run (user manual 21st draft, coverage report updated) `ui/help.html` was rebuilt (`--check` up to date) and `COB.html` rebuilt with `node share/build-share.mjs` (sha `5cf927bd...`); `check_share_page.mjs` 38 checks PASS, smoke PASS, suite still 87 files / 3216 passed.

### 71. B32: Contract term measured from the flow's start date; hint reworded; "Remaining contract term" label for Renewal and Payment change (2026-10-05, user decision DEC-B32-TERM; QA verified PASS)

**What.**
- **Engine helper** `contractTerm(input, result)` in `src/ca/cobCanada.ts` (signature change; was `contractTerm(result)`): whole years, months and days from the flow's start date (`input[FLOWS[flow].startDateField]`: Disbursal date, Renewal date or Date of change) to the last schedule row. It was measured from the first schedule row (first / next payment date). Throws a RangeError for an empty schedule, unknown flow, missing or invalid start date, or a start after the last row. Its span now equals `termDays`. Example (Payment change, Date of change 2026-02-20, next payment 2026-03-15, end 2029-03-15, monthly): 3 years, 0 months, 0 days -> **3 years, 0 months, 23 days**. No result field added; `src/ca/types.ts` comment-only.
- **Hint** (all flows): "Calculated from the {disbursal date | renewal date | date of change} to the last scheduled payment date." (was the first / next payment date label).
- **Label** (`flowLabels(...).contractTerm` in `ui/ca-view.js`): "Remaining contract term" for Renewal and Payment change; "Contract term" for New mortgage or loan and the hidden Variable rate payment change. Used by the field label (`#contractTerm-label`, rewritten on flow change), the Contract terms tile and the printout row. The "Contract terms" heading is unchanged (Q-B32-HEADING default). A start date equal to the last payment date reads "0 years, 0 months, 0 days" (Q-B32-SAME-DAY default).
- CSV and its file name unchanged. Supersedes Q-CT-B25 (the semi-monthly move no longer affects the term).

**Why.** User decision 2026-10-05 (DEC-B32-TERM, `COB-user-stories.md` §7.5): the interest is calculated from the start date, so the term and its description should be too. Brief: `COB-architecture.md` §5 B32, revision 50.

**Fixtures.** `a10_ui_capture_v1.json` regenerated (user-approved), sha `ac76408a...` -> `9877c0c6...`. Changed strings (besides provenance): `flowScreens.<flow>.termHint` for all four flows (as above); new key `flowScreens.<flow>.termLabel` ("Contract term" for New and VRPC, "Remaining contract term" for Renewal and Payment change); `contractTermField` REF-01 and S1_fees 2y 11m 17d -> 2y 11m 23d, RENEWAL 2y 5m 0d -> 2y 6m 0d, VRPC_zero_accrued 4y 11m 11d -> 4y 11m 22d; `html.printInputs` and `html.contractTermsList` (both modes) for those four scenarios: the value, and for RENEWAL the label "Contract term" -> "Remaining contract term". New QA pin fixture `b32_pre_label_pins.json` (taken before the change). Re-pinned with B32 notes: `help/tests/fixtures/pre-b29-baseline.json` (stripped `ca.html`, `ca.js`, `ca-view.js`, `ca-view.d.ts`, `package.json`, src tree, capture), `share/tests/fixtures/pre-b30-pins.json` and `share/tests/b30-build.test.mjs` (`package.json`, capture), B25-T9 and B27-T11 (capture sha), a13 `test:tz` list. Re-baselined tests (B24, B22, B25, type test) with notes naming DEC-B32-TERM. Both goldens (`249651b2...cf11`, `acfe374c...d23e`), `b23_on_state_pins.json` and `b31_pre_layout_pins.json` byte-identical.

**Evidence (QA + main session).** `npm run build`; `npx vitest run` 89 files, 3469 passed, 0 failed (confirmed by the main session); `typecheck` and `typecheck:tests` clean; `test:tz` 1064 passed in each zone. QA's independent date oracle: 33,365 cases, 0 mismatches (598 same-day cases read 0/0/0); mutants M1-M14 all killed against an unmutated control. Chrome: smoke PASS, F12 16/16, F17 (56), F18 (29), capture equality, share page 38 checks PASS.

### 72. B33: personal loans accept every payment frequency again; Monthly-only rule (FB-24 / B27 / DEV-FB24) removed (2026-10-05, user decision DEC-B33-FREQ; QA verified PASS WITH NOTES)

**What.**
- **Engine:** `src/ca/products.ts` gives both products the same frozen six-frequency list (`allowedPaymentFrequencies` stays exported); `src/ca/validate.ts` no longer rejects a non-monthly personal loan (the catalogue rejection block is deleted); `src/ca/equations.ts` comment only. Personal loans are accepted at every frequency in New mortgage or loan, Renewal and Payment change; Variable rate payment change stays mortgage + variable. The accelerated frequencies stay hidden on the page (B28 switch).
- **Rate rule unchanged, now reachable:** only a fixed-rate mortgage converts the contract rate to the payment frequency (OQ-C); a variable mortgage and a personal loan use the contract rate as entered at any frequency. Matches the workbook (D12 lists all six frequencies with no product condition).
- **UI:** the Payment frequency lock and its hint "Personal loans are paid monthly." are deleted (`frequencyLock`, `FREQUENCY_LOCK_HINT`, the hint span and `aria-describedby`); `ui/ca-view.js` drops from 41 to 39 exports.
- **No switch:** the rule is removed outright by the user's explicit choice (against ADR-14's deactivate-behind-a-switch default). DEV-FB24 retired.

**Why.** User decision 2026-10-05 (DEC-B33-FREQ, `COB-user-stories.md` §7.5), reversing the stakeholder feedback decision FB-24 of 2026-09-30; draft note for the stakeholders in `COB-brd-amendments-draft.md`. Brief: `COB-architecture.md` §5 B33, revision 51. Defaults: Q-B33-B27FILE (B27 test file rewritten in place, same name), Q-B33-LEGACY (rehome helper, frozen pre-B27 generators and `archive/pre-b27` kept).

**Golden masters (approved behaviour change).**
- `golden_engine_v1.json` `249651b2...cf11` -> `922fd695...3aee` (148 groups, 4,455 cases): 93 groups unchanged, 0 removed; **54 added**: {weekly, biweekly, semiMonthly} x personalLoan/{fixed, variable} x {none, fin2000, fin2000cash400} x {new, renewal0, renewal850} (36 equal the pre-B27 archive; the 18 semi-monthly ones differ from it because of the B25 move); **changed**: `extra:underpayment` 78 -> 312 cases. Long cases unchanged.
- `golden_engine_pc_v1.json` `acfe374c...d23e` -> `5ab1c6a6...a7df5` (122 groups, 3,536 cases), byte-identical to `archive/pre-b27/golden_engine_pc_v1.json`: 85 unchanged; **36 added**: pc|{weekly, biweekly, semiMonthly}|personalLoan/{fixed, variable}|{none, fin2000, fin2000cash400}|{acc0, acc850}; **changed**: `pcx:underpayment` 52 -> 208; long case `long:pc:monthly:acc850:underpayment` -> `long:pc:weekly:acc850:underpayment`. The PC generator leaves the first golden untouched (F-1).
- Every personal-loan group's figures equal its mortgage/variable twin.

**UI capture.** `a10_ui_capture_v1.json` regenerated (user-approved) `9877c0c6...` -> `4d5a64c1...`: only `scenarios[6]` `PL_WEEKLY` appended (plus provenance date); everything else identical. Re-pinned with "B33 verify" notes: Help baseline (stripped `ca.html`, `ca.js`, `ca-view.js`, src tree, capture), share pins (capture), B25-T9 and B27-T11 (capture). New QA fixture `b33_pre_golden_group_hashes.json`. `b23`, `b31`, `b32` pin files byte-identical.

**Evidence (QA + main session).** `npm run build`; `npx vitest run` 91 files, 3666 passed, 0 failed (confirmed by the main session); `typecheck` and `typecheck:tests` clean; `test:tz` 1256 passed in each zone. QA's own sweep: 864 cases, 0 rejected; personal-loan calculated rate = contract rate in 432/432; fixed mortgage converted, variable not; VRPC unchanged. Mutants M1-M13 all killed against an unmutated control. Chrome: smoke PASS, F12 16/16, F17 (56), F18 (29), capture equal on a second run, share page 38 checks PASS. Note: `ui/help.html` still showed the old lock hint until the doc-writer run and Help rebuild below.

### 73. B34: Contract term in whole years and months, with a choice between the End date and the final payment (2026-10-06, user decision DEC-B34-TERM; QA verified PASS WITH NOTES)

**What.**
- **Engine** (display only; `calculateCobCanada` never calls it): new export `contractTermOptions(input, result)` -> `{ endDate, lastPayment }`, each `{ years, months }` measured from the flow's start date (Disbursal date / Renewal date / Date of change) to the typed End date and to the last schedule row; any leftover day rounds **up** to a full month (internal `roundUpToWholeMonths` in `calendar.ts`, integer arithmetic). New types `ContractTermMonths`, `ContractTermOptions` (ADR-13(i), additive). `contractTerm` unchanged.
- **UI:** zero parts left out ("3 years", "2 years, 6 months", "0 months"). When the two values agree, one value; when they differ, a radio group (legend "Term based on") under the Contract term field: "Start date to end date: {term}" first and pre-selected, "Start date to final payment: {term}" second. The pick is a rule: recalculation never changes it; only a page load resets to the End date. Field, Contract terms tile and printout show the picked rule's value; radios are not printed. Hint (interim, Q-MSG): "From the {disbursal date | renewal date | date of change}; part months count as a full month." New view helpers `contractTermMonthsParts`, `contractTermChoice`.
- CSV and its file name unchanged. No switch (wording change, B32 precedent).

**Why.** User decision 2026-10-06 (DEC-B34-TERM, `COB-user-stories.md` §7.5; answers Q-B34-ZERO default, Q-B34-KEEP/ORDER/TEXT overridden, hint keeps the start-date name). Brief: `COB-architecture.md` §5 B34, revision 53. Test boundaries: `COB-B34-test-boundaries.md` (BA, 99 boundaries).

**Fixtures.** Goldens byte-identical (`922fd695…`, `5ab1c6a6…`); `b23`, `b31`, `b32` pin files byte-identical. `a10_ui_capture_v1.json` regenerated (user-approved) `4d5a64c1…` -> `9577121c…`: 34 paths besides provenance: `flowScreens.*.termHint` x4; `contractTermField` REF-01 "3 years", S1_fees "3 years", RENEWAL "2 years, 6 months", VRPC_zero_accrued "5 years", PL_WEEKLY "3 years"; the term value in `html.printInputs` and `html.contractTermsList` for those five x 2 modes; new key `contractTermChoice` (null for four; PL_WEEKLY offers "Start date to end date: 3 years" (checked) / "Start date to final payment: 2 years, 11 months"). Re-pinned with "recorded B34 verify" notes: Help baseline `pre-b29-baseline.json`, share pins `pre-b30-pins.json`, capture sha in `b25-golden` and `b27` tests. New QA files: `b34-term-options.test.ts`, `b34-term-display.test.ts`, `tests/types/b34-term-options.typecheck.ts`, oracle `support/termMonthsOracle.ts`, `b34_term_vectors.json`.

**Evidence (QA + main session).** `npm run build`; `npx vitest run` 93 files, 3999 tests, 3998 passed, 1 failed = F13 (Help stale until the Help rebuild; confirmed by the main session); `typecheck` and `typecheck:tests` clean; `test:tz` 1421 per zone. Security review: no critical/high/medium (one low, pre-existing: `addFeeRow` attribute built via `innerHTML`, unreachable today). QA oracle sweep 33,176 inputs, 0 mismatches; 91 vector/boundary rows reproduce; mutants 26/26 killed against an unmutated control. Chrome: smoke PASS (INV-PAGE 1-15, BA sequence B, CSV under both picks, zero term), F12 16/16, F17 (56), F18 (29), capture equal on a second run. Note F-1 (architect): the brief's "SHORTFALL (F12)" vector row uses End 2028-04-01; F12 uses 2028-04-15 (pinned as SHORTFALL-F12).

### 74. B35: Payment amount hint shortened to "The scheduled payment." (2026-10-06, user decision DEC-B35-HINT; QA verified PASS WITH NOTES)

**What.** `ui/ca.html:668`: the hint under Payment amount (`#paymentAmount-hint`) reads "The scheduled payment."; the sentence "It isn't calculated here." is deleted. No other product change.

**Why.** User decision 2026-10-06: the sentence was unclear. (It meant the payment amount is entered, not derived: BRD §3 out of scope, IN-08.)

**Fixtures.** Goldens, `a10_ui_capture_v1.json` (`9577121c…`; the hint is not captured) and all pin files byte-identical except the Help baseline `help/tests/fixtures/pre-b29-baseline.json` `files["ui/ca.html"]` (stripped) `9f4d3f34…` -> `7740d849…` ("recorded B35 verify"). New QA test `tests/ca/b35-payment-hint.test.ts` (3 checks); smoke script checks the hint on the live page. Design notes `visual_design/app-ui.md:115` and `design-beyond-brd.md` still quote the old wording (history).

**Evidence (QA + main session).** `npm run build`; `npx vitest run` 94 files, 4005 tests, 4004 passed, 1 failed = F13 (Help stale until the Help rebuild; confirmed by the main session); typecheck and typecheck:tests clean; `test:tz` 1421 per zone. Mutants 4/4 killed (old sentence restored, `&rsquo;` variant, hint emptied, `aria-describedby` removed). Chrome: smoke PASS, F12 16/16, capture equal minus provenance (one earlier run showed a sub-pixel `--term-em` width flake, not reproduced).

### 75. B37: leap-aware payments per year in the rate conversion for Weekly and Bi-weekly fixed-rate mortgages; frequency labels computed by the engine (2026-10-09, user decision DEC-B37-LEAP-N; deviation DEV-B37-LEAPN; QA verified PASS WITH NOTES)

**What.**
- **Engine.** For a fixed-rate mortgage (SEMI-ANNUAL basis) at Weekly / Accelerated weekly (P = 7) or Bi-weekly / Accelerated bi-weekly (P = 14), equation 1 uses n = (D / P) / Y instead of 52 / 26: D = actual days from the flow's start date (Disbursal date, Renewal date or Date of change) to the End date, Y = the same span in leap-aware years (`dayCountFraction`), evaluated in that order at full precision. Monthly (12), Semi-monthly (24), variable-rate mortgages and personal loans unchanged; all four flows. The one rate feeds the Calculated rate, every period's interest and the no-fee COB rate; the trigger rate keeps `PAYMENTS_PER_YEAR`. New switch `LEAP_AWARE_PAYMENTS_PER_YEAR` in `policies.ts` (ADR-14), shipped `true`; `false` is today's 52 / 26 byte for byte. New in `src/ca`: `paymentPeriodDays` (`calendar.ts`), `leapAwarePaymentsPerYear` and `conversionPaymentsPerYear` (`equations.ts`; the single choice point of n), `calculateCobCanadaWith(input, switches, leapAware = LEAP_AWARE_PAYMENTS_PER_YEAR)`, and the public `paymentsPerYearFor(input, frequency)` (`cobCanada.ts`, on both barrels; ADR-13(j), additive). `PAYMENTS_PER_YEAR` value unchanged (doc comment only).
- **UI.** Each Payment frequency option's per-year figure is computed from `paymentsPerYearFor` on every recalculation and on load (`renderFrequencyLabels` in `ui/ca.js`, before `calculateCobCanada`), shown as a **whole number** by `frequencyOptionText` in `ui/ca-view.js` (`${label} (${Math.round(n)}/yr)`, display only, never read back). Because the leap-aware n lies in 52.14..52.29 / 26.07..26.14, the visible texts stay "Weekly (52/yr)", "Bi-weekly (26/yr)", "Semi-monthly (24/yr)", "Monthly (12/yr)". `ui/ca.html` unchanged. Printout, CSV, results line and Contract terms tile unchanged (they use `label`, not the option text).
- **B36 withdrawn.** DEC-B36-ACCR-SPREAD (37.5 % spreading of accrued interest) was never implemented; QA unwound its red step (B37-U) before B37. Accrued interest stays all due at payment 1 (B19).

**Why.** User decision DEC-B37-LEAP-N (2026-10-09, `COB-user-stories.md` §7.5), answers Q-B37-REF01 / APPA / HINT / LABEL and the label format row (whole numbers, superseding the 2-decimal interim default). The user's two Bi-weekly cases: case 1 total interest / principal **60,137.62 / 43,861.66** (Excel 60,137.63 / 43,861.65; 1-cent difference accepted by the user) and example 2 **74,326.11 / 48,523.89** (to the cent). **DEV-B37-LEAPN:** the workbook's converter uses n = 52 / 26 (`reference/workbook-sheet-formulas.txt`), so the shipped state differs from it for fixed-rate weekly / bi-weekly cases (REF-01 total interest 22,514.11 -> 22,514.07); the off state still matches the workbook exactly (`known_divergence` DEV-B37-LEAPN on the on-state assertions). Brief: `COB-architecture.md` §5 B37 (revision 56) and its addendum (revision 57).

**Fixtures.** Goldens regenerated with their generators (user-approved): `golden_engine_v1.json` `922fd695…` -> `b90ea69ce09cea5ceaea400cb4a192fcef0d8aca1117905e38c7b01ed876d220`; 18 of 148 groups changed: `{weekly,biweekly}|mortgage/fixed|{none,fin2000,fin2000cash400}|{new,renewal0,renewal850}`; 4 of 6 long cases: `long:weekly:noPayoff`, `long:weekly:payoff`, `long:biweekly:noPayoff`, `long:biweekly:payoff`. `golden_engine_pc_v1.json` `5ab1c6a6…` -> `9da9599f75bec61090a9f07d2ee16f4bd8a3c51e3601675d2170ce2afc905db8`; 12 of 122 groups changed: `pc|{weekly,biweekly}|mortgage/fixed|{none,fin2000,fin2000cash400}|{acc0,acc850}`; long cases unchanged. Every other group byte-identical. `a10_ui_capture_v1.json` (REF-01, S1_fees), the Help baseline and share pins: re-pinned by QA at verify (pending). `COB.html` rebuilt (`node share/build-share.mjs`).

**Evidence (sr-dev green step, before QA verify; the QA verdict and final counts follow below).** `npm run build`; `npx vitest run` 97 files, 4152 tests, 4135 passed, 17 failed, all awaiting QA's re-pin at verify: A10-C10..C13 and 5 in `b37-capture.test.ts` (capture not yet regenerated), 5 in `help/tests/b29-help-link.test.mjs` and 1 in `b29-help-removal.test.mjs` (Help baseline shas), 2 in `share/tests/b30-readonly-coupling.test.mjs` (golden pins). `typecheck` and `typecheck:tests` clean; `test:tz` 1526 per zone, both green. Chrome: smoke PASS (including the B37 frequency labels and V-CASE1 total interest), also against the rebuilt `COB.html`; F12 16/16.

**QA verification (2026-10-09): PASS WITH NOTES.**
- **Goldens, independent.** Group by group against QA's red-step pin `b37_pre_golden_group_hashes.json`: v1 moved exactly the 18 listed groups and the 4 weekly / bi-weekly long cases; PC exactly the 12 listed groups, no long case; no case count changed; every other group and long case byte-identical. sr-dev's pre-B37 backups equal the pinned shas (`922fd695…`, `5ab1c6a6…`). New values: QA's own oracle (`tests/ca/support/leapNOracle.ts`, no `src/` import) re-ran every 7/14-day case of both corpora (v1 2,188, PC 1,769, any product, both switch states) and the 5 day-based long cases row by row: all headline fields and every row `Object.is` the committed (on) and pre-B37 (off) fixtures; 0 differences. Switch off replays both pre-B37 files byte for byte (B37-T8).
- **Code review** (diff against the pre-B36 control tree): only `policies.ts`, `calendar.ts`, `equations.ts`, `cobCanada.ts`, `types.ts` (comment), both barrels, `ui/ca.js`, `ui/ca-view.js` (and QA's `ca-view.d.ts`) changed, as briefed, with the user's whole-number label (`Math.round`, display only in `ca-view.js`). No rounding in `src/ca`; `src/ca` self-contained; UI imports only `/dist/ca/index.js`; `paymentsPerYearFor` appears exactly twice in `ca.js` (import, `renderFrequencyLabels`); `ui/ca.html` unchanged.
- **Mutants** (scratch copy, unmutated control 239/239 on the targeted files; full-suite control red only in the known copy artefacts f7 and `b29-help-removal`): **26/26 killed**: M1-M16 (M5 = D and Y to the last scheduled date; M9 = SEMI-ANNUAL condition dropped and leap n fed to the trigger rate; also M9a, the condition alone), L-M1, L-M2 (`toFixed(2)`), L-M2b (`Math.trunc`), L-M4, L-M5, L-M6, L-M7, L-M8, L-M9. L-M3 (trailing-zero drop) does not apply to the whole-number format.
- **Capture regenerated** (`capture_a10_ui.mjs`, Chrome 155): minus provenance, only REF-01 and S1_fees changed, both modes, number tokens only: Balance at end date $177,732.00 -> $177,731.96; Cost of borrowing amount $22,514.11 -> $22,514.07 (S1_fees $25,014.11 -> $25,014.07); Total principal paid $50,097.65 -> $50,097.69; Total interest $22,514.11 -> $22,514.07; S1_fees Cost of borrowing rate (APR) 4.11441% -> 4.11440%; plus the schedule table, print schedule (140 number tokens each) and CSV digits. Calculated rate 3.70678% and every label, hint, term, file name, other scenario, `formDefaults` and `flowScreens` unchanged. `a10_ui_capture_v1.json` `9577121c…` -> `6c3686d387197b707518fd45e278414113c32846a04d8c1ac3c587a16d61b824`. Off state at page level (scratch copy, switch `false`): capture identical to the pre-B37 fixture minus provenance; smoke label steps (a)-(g) pass, only (h) V-CASE1 shows the off total $60,137.81 as expected.
- **Re-pins (recorded in each file):** capture sha in `golden/b25-golden.test.ts` G4 and `b27-personal-loan-monthly-only.test.ts` B27-T11; both golden shas and the capture sha in `share/tests/fixtures/pre-b30-pins.json` and `help/tests/fixtures/pre-b29-baseline.json`, plus there `ui/ca.js` `a31683f5…` -> `c85852c6…`, `ui/ca-view.js` `db86542a…` -> `122171fd…`, `trees.src` `b2fed842…` -> `147de5e4…`. **Not in the brief's list:** `b33-frequency-unlocked.test.ts` B33-T10 (pre-B33 capture chain) went red at regeneration; re-baselined like B34 with a B37 undo step that applies QA's new reverse patch `tests/ca/fixtures/b37_capture_undo.json` (number tokens only, each checked as a number on both sides; the result must hash to the red-step per-scenario pins), no assertion value changed.
- **Evidence.** `npm run build`; `npx vitest run` **97 files, 4152 passed, 0 failed**; `typecheck`, `typecheck:tests` clean; `test:tz` **1526 per zone**, both green. Chrome: smoke PASS; F12 16/16; `node share/build-share.mjs` rebuilds `COB.html` byte-identical (`9d365b4c…080a`); `check_share_page.mjs` 38 checks PASS; smoke PASS with `COB_PAGE_URL=file://…/COB.html`. Goldens v1 `b90ea69c…d220`, PC `9da9599f…5db8`; `ui/ca.html` `70dfc176…b064`.
- **Notes.** (1) One full run showed `help/tests/b29-help-uiscan-guard.test.mjs` G5 failing with ENOENT on a `help/.tmp` file (a temp-file race between parallel workers); it passed alone and in the next full run. (2) `renderFrequencyLabels` sits after `readForm` / `toInput` inside `recompute`'s `try`, so if either ever threw the labels would keep their previous text (today neither throws for a form state). (3) The Help page is stale until the doc-writer step and `node help/build-help.mjs`.

## Known open items that still affect this copy

- OQ-W: how IN-11 past accrued interest is treated (interest on it, in C, in P) is
  still open, including a renewal whose payment doesn't cover period interest while
  IN-11 is outstanding. 008 B5 / 012 D-02 is fixed (entry 16).
- DQ-16: closed (Renewal is mortgage-only; decision 9, delivered by B21, entry 50). **Correction 2026-10-01:** this rule was reversed by entry 59; Renewal accepts Personal loan again (then Monthly only; any frequency since entry 72, B33). Entry 50 stays as history.
- Q-MSG: final wording of all validation messages is still open. The fee-limit message
  uses the interim wording (entry 24); the workbook text is "Total Fees must be less than
  the Loan Amount".
