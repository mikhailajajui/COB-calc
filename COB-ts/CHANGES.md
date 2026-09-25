# COB-ts-copy — changes from COB-ts

`COB-ts/` is frozen as the comparison baseline. This copy differs from it as listed
below. To see the full difference: `diff -r COB-ts COB-ts-copy -x node_modules -x dist`.

Files that differ: `src/ca/{cobCanada,equations,fees,types,validate}.ts`,
`tests/ca/{cobCanada,equations,fixtureParity,invariants,validate}.test.ts`,
`ui/ca.html`, `ui/ca.js`, plus the new `tests/ca/spec011.test.ts`,
`tests/ca/spec011-d9.test.ts`, `tests/ca/fixtures/` and this file.

`src/ca/` matches `app/engine/src/` except for imports: `types.ts` imports
`PaymentFrequency` from `../types.js` where `app/engine` declares it locally.
`tests/ca/` also matches `app/engine/tests/` except for imports.

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

## Known open items that still affect this copy

- 008 E1/C1: monthly schedules from the 29th, 30th or 31st overflow instead of
  clamping, and semi-monthly dates are affected too. QA reports that a schedule
  anchored on Feb 29 loses its last row.
- 008 B5: on underpayment (S6), unpaid interest is missing from the ending balance,
  total interest and C.
- DQ-30: personal-loan rates at non-monthly frequencies are still converted from m = 12.
- DQ-16: whether Renewal applies to personal loans is still open.
- BRD §6: whether non-financed fees count toward the fee limit is still open. For now
  only financed fees count.
