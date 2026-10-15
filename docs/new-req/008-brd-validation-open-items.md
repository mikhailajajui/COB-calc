# 008 — Open items from validating docs against `COB Requirements v2.3.docx`

## Status

**Open — A1–A3 resolved 2026-09-23; §B, §C, §D, §E open; §F (use-case gaps from 009) added 2026-09-23, all open; §G (app-level questions from 010) added 2026-09-23; G1 superseded by the revised D2, G9 closed by the 010 design, the rest open. E6 (fee-total rounding) added 2026-09-23.** Written 2026-09-22 after checking specs 006/007
against the docx, then cross-checking the questions against the live macro
(`docs/Cost of Borrowing Rate Calc_Current.xlsm`, VBA extracted with
`python3 -m oletools.olevba --decode -c <file>`). Line refs below are to that
extraction's `Calculator` sheet module (`CalculateAll`, `ValidateInput`,
`getRate`, `getNext*`).

**Scope after the user's decisions of 2026-09-23** (`docs/app/delivery-plan.md`
§2.0). Two rule sets now apply, and each resolution below says which one it
covers:
- **`app/` (`app/engine`, `app/api`, `app/web`): the BRD governs.** The macro is
  a reference only. No live-macro vector is required, and "macro wins on
  arithmetic" does not apply. Acceptance is the team's UAT sign-off (DQ-26),
  not macro parity. `app/engine` is a fork of COB-ts and changes on its own;
  the engine changes are specified in `docs/new-req/011-app-engine-brd-changes.md`
  (the architect's; being written, so resolutions that depend on it say
  "pending 011").
- **COB-ts, COB-py, COB-xlsx: unchanged.** The macro still wins on arithmetic
  for parity. COB-ts is frozen as the comparison baseline;
  `npm run compare:cob-ts` reports the differences and never fails the build.
  Every §B/§C/§E item stays open for these engines unless it says otherwise.

Resolved for `app/` on 2026-09-23: G2 (provisional), G3, G4, G15, C4, B1/D4
(DQ-02, DQ-03, DQ-04, DQ-26, DQ-27). Deferred: G6, G11 (DQ-18, DQ-19). Still
open: D1, D2 (DQ-05; decision note `docs/app/dq-05-note.md`). New: D8 (IN-07 vs
Appendix B.1, widened to financed fees), D9 (which BRD text governs `app/` where
Appendix B is known to be wrong). **D9 resolved for `app/` 2026-09-24: (b).**
Applied first to financed fees (D8/B1–B3) and the final payment (B6), 011
DEV-011-2/-3; questions for the BRD author in `docs/app/brd-author-questions.md`.
Validation of the resolved items against COB-ts: §H below.

**2026-10-13 (DEC-B39-VAR-PL-M12, user):** F-ii #4 (G-06) / DQ-30 answered for COB-ts at Weekly, Accelerated weekly, Bi-weekly and Accelerated bi-weekly (option (b), with the leap-aware n); still open for `app/`, COB-py and COB-xlsx. New B39 open items in §I.

Already verified OK: Appendix A's 7 converted rates reproduce to <1e-12; the
007 worked vector's payment #1 interest (138.824338387124…) and trigger rate
(10.623691868025078%) reproduce.

## A. Doc housekeeping (quick fixes)

1. **Status drift.** `README.md` says 006 is re-implemented and validated in
   all three engines; 006's own Status + "Excel implementation notes" and
   007's Status still say the engines are pre-reconciliation. Confirm which is
   true and fix the stale ones.
   **Resolved (2026-09-23): neither version was right.**
   - The committed engines (`2314d14`) are pre-reconciliation
     (`remaining_amortization_*` inputs, annuity-solved payment).
   - The **uncommitted** working tree re-implements post-007 006 in all three
     engines: payment is an input, `end_date` stop, day-count 365/366, the
     waterfall, and `disbursal = loan − financed_fees`.
   - `npm test` tests/ca: 88 pass. `pytest tests/test_cob_canada.py`: 49 pass.
     Both reproduce the fee-free 007 vector (156 rows, final balance
     177,731.99591…). The tests only assert to the cent, but the qa audit
     (§E) found the actual values match all 156 rows to within 2e-14 relative.
   - The xlsx was not recalculated.
   - "Full parity" is false: §B, C1 and A3 are still unimplemented.
   → Changed: 006 Status and "Excel implementation notes", 007 Status and its
   "Follow-up work" items 1–2, and the README rows for 006/007/008.
2. **End-date boundary contradiction in 006.** `end_date` data-shape comment
   says "first scheduled payment on or after end_date"; equation 5 says a row
   exactly on `end_date` IS generated. Macro: `DateDiff("d", eDate, nextDate)
   > 0` → equation 5 is right; fix the comment.
   **Resolved (2026-09-23): the comment was wrong; equation 5 is right.**
   Verified in `CalculateAll`: `checkToExit = DateDiff("d", eDate, nextDate) >
   0`, which runs only when End Date is non-blank. A date on `eDate` gives 0,
   so the row is generated.
   → Changed: 006 `end_date` data-shape comment now says inclusive and cites
   equation 5 and the macro line. The blank-End-Date fallback stays open
   under C4.
3. **Frequency enum.** 006 lists 4 values; docx IN-09 has 6 (Accelerated
   Bi-weekly never mentioned). Macro dispatch names: `Weekly`, `Accelerated
   Weekly`, `Biweekly`, `Accelerated Biweekly`, `Semi Monthly`, `Monthly`
   (+ `One Time`, see D4).
   **Resolved (2026-09-23): six values.**
   - Docx IN-09 reads: "Weekly, Accelerated Weekly, Bi-weekly, Accelerated
     Bi-weekly, Semi-monthly, or Monthly".
   - The macro's `CalculateAll` Select Case and the `Calculator!D12` dropdown
     (`Payment_Frequency` = `Settings!B3:G3`) both use `Weekly`, `Accelerated
     Weekly`, `Biweekly`, `Accelerated Biweekly`, `Semi Monthly`, `Monthly`.
   - Under BR-09 and the macro, each accelerated value shares n and its
     `getNext*` rule with its regular counterpart.
   - (The pointer above should read C5, not D4.)

   → Changed:
   - 006 `payment_frequency` now lists all 6 values with the docx↔macro↔code
     mapping. It no longer tells implementers to reuse the legacy US enum.
   - "One Time" is added to 006 Open questions as open.
   - architecture.md §3.1 and the §6 IN/BR-09 rows are updated.
   - **Implementation gap still to do:** TS/py/xlsx accept only 4 values.

## B. Macro contradicts spec 006 — fix before trusting any fee > 0 result

These all come from `CalculateAll`. 007's worked vector has $0 fees and $0
accrued interest, so none of them show up in it.

1. **Principal excludes BOTH fee types.** Macro init:
   `openingBalance = loanAmt`, `currPrinciple = loanAmt − finFee − nonFinFee`,
   `currFees = finFee + nonFinFee`. So Loan = Principal + Fees (+ unpaid
   interest). Note non-financed fees are also carved out of IN-02, which
   conflicts with IN-07's "NOT deducted from the advance" and with 006/007's
   `disbursal_amount = loan_amount − financed_fees`. → Ask BRD author which is
   intended; macro is what produces today's numbers.

   **Resolved for `app/` (2026-09-23): DQ-27, follow IN-07.** Non-financed
   fees are paid separately by the member, are not deducted from the advance,
   are not added to principal, and are included in the cost of borrowing
   (IN-07, BR-04, OQ-01). → `app/engine` changes its fee equations (track E,
   pending 011); `docs/app/requirements-traceability.md` IN-07/BR-04 rows
   updated. **Still open for COB-ts/py/xlsx**, where the macro's carve-out
   holds for parity. The BRD contradicts itself on this point; see D8.
2. **Fees paid reduce the loan balance.** `newBalance = newFees + newPrinciple
   + intAccrued − totalInterestPaid`. 006 equation 4 has `closing_balance =
   opening_balance − principal_portion` (fees paid never reduce it) — wrong
   whenever fees > 0. Docx B.5's pseudo-code has the same flaw; the macro is
   right.
3. **`P` is the average of the opening *principal* component, not the loan
   balance.** `totalOpeningPrinciple += currPrinciple`;
   `avgOpeningPrinciple = totalOpeningPrinciple / pymtCount`. 006 equation 7
   says "average of each row's opening balance". Differs by the outstanding
   fees each row → changes `cob_rate_percent` whenever fees > 0.
4. **Unpaid interest is inside the interest-bearing balance.** Interest is
   `openingBalance × getRate(...)` and `openingBalance` includes
   `intAccrued − totalInterestPaid` — i.e. unpaid interest compounds. 006/007
   finding #5 say carried accrued interest is tracked separately and "the
   opening balance itself is never increased". Contradicts the macro (only
   matters when a payment doesn't cover interest).
   **User decision 2026-09-25 (COB-ts):** unpaid interest is capitalised into principal. It earns interest, is
   part of the amount owed, and also counts in P and the payoff cap, where the user judges the macro wrong. See
   012 D-02 / DEV-012-1. 006's non-compounding wording is superseded for COB-ts. `app/engine` is not decided.
5. **`total_interest` / `C` use interest *accrued*, not interest *paid*.**
   `COB = intAccrued + finFee + nonFinFee`; `TOTALINTERESTCELL = intAccrued`.
   006 sums `interest_paid`. Same number unless interest is unpaid at the end.
6. **Final-payoff payment is buggy in the macro.** When remaining principal <
   money left: `pymtAmnt = currPrinciple` — the reported payment drops to the
   principal only (interest + fees paid that row are excluded from
   `totalPayment`). Decide: replicate for parity, or fix and document the
   deviation (docx §6 asks us to define last-payment behaviour).
7. **Leap-year day count is not "365 unless crossing".** `getRate`: a period
   wholly inside a leap year divides by **366** (`daysInYear(startDate)`); a
   crossing period is split by calendar year, each part over its own year's
   length. Docx B.3's "using a 365-day year" is wrong for periods entirely in
   2028; make sure 006 equation 3 and the engines say/do the same as the macro.

## C. Macro answers — fold into 006

1. **Payment-date rules (docx B.4 is partly wrong):**
   - Weekly / Accelerated Weekly: previous date + 7 days.
   - Biweekly / Accelerated Biweekly: `first_payment_date + 14k`, first one
     after the previous date (anchored, not chained).
   - Monthly: `DateAdd("m", k, first_payment_date)` — anchored to the first
     payment date, clamps to month-end (Jan 31 → Feb 28 → Mar 31). **Not**
     end-of-month stepping; docx's `getNextEOM` is the commented-out
     `"End of Month"` case.
   - Semi Monthly: `getNextSemiMonthly` (15th / EOM pairing when first date is
     the 15th or an EOM; otherwise day1 and day1+15, capped at EOM). Spec it
     from the VBA verbatim.
   - Any other value: +1 month.
   - Skip-date rule: dead code (already in 007 addendum #5).
2. **Validation (docx §6) — what the macro actually enforces:**
   - numeric checks on loan, both fees, rate, payment;
   - `finFee + nonFinFee >= loanAmt` → "Total Fees must be less than the Loan
     Amount";
   - `firstPymtDate < disbDate` → error (same day allowed; One Time requires
     strictly after);
   - `eDate <= firstPymtDate` → "End Date must be after the First Payment
     Date";
   - term months/years must be > 0.
   - **Not** enforced: negative values (docx §6 adds this as a new rule).
3. **Rounding:** the macro never rounds (no `Round()` anywhere); all
   schedule/total cells hold full doubles. Parity = no intermediate rounding;
   rounding is display-only. Write that into 006.
4. **End Date is optional in the macro.** If blank, exit when
   `days(first_payment → next) / 365 > term_years − 7/365`. So `term_years`/
   `term_months` are real inputs in the workbook, not display-only as 006
   says. Decide whether the replacement keeps this fallback or makes End Date
   mandatory (docx IN-13 implies mandatory).

   **Resolved for `app/` (2026-09-23): DQ-03, End Date is required** (with
   term years/months and the semi-annual compounding date; see G4). → the
   `app/` form and request schema require `endDate`; `app/engine` has no
   blank-End-Date fallback (pending 011). **Still open for COB-ts/py/xlsx**,
   where the macro's fallback is the parity behaviour.
5. **"One Time" frequency is live.** `ValidateInput` handles it (disables
   term/end date, derives term from disbursal→first payment), and the loop
   generates exactly one row at `first_payment_date`. Docx IN-09 omits it;
   B.4 lists it. → Ask BRD author whether it stays.
   *Evidence added 2026-09-23 (still open):* the live dropdown on
   `Calculator!D12` (list `Payment_Frequency` = `Settings!B3:G3`, error alert
   on) does **not** offer "One Time". So the macro's One Time code is
   reachable only by getting past the validation, for example by pasting a
   value. The `Case "One Time"` in the date dispatch is commented out; One
   Time is handled via `isOneTime`. This weakens "is live"; the question to
   the BRD author stands.

## D. Needs a BRD-author / business decision (macro can't answer)

The macro has **no** use-case dropdown, product-type input, or accrued-interest
input — those are new in the docx for the replacement app. So:

1. **Start-date labels (IN-10 / BR-07).** 006 collapses four labels to
   `disbursal_date` / `renewal_date`. For Payment Change, which date starts
   interest and `T`: Last Payment Date (IN-10b) or Payment Change Date
   (IN-10d)? Docx marks both "payment change only".

   **Still open (2026-09-23): DQ-05.** The user asked for more context, which
   is in `docs/app/dq-05-note.md` (verbatim BRD text, a worked example, what
   the macro does, recommendation). Build default for `app/` until answered:
   IN-10d Payment Change Date, sent as `renewalDate`.
2. **Accrued interest for Variable Rate Payment Change.** Docx says
   mandatory for Renewal and Payment Change; 006 also applies it to VRPC.
   Confirm.

   **Still open (2026-09-23): part of DQ-05**, same note. Build default for
   `app/`: the form shows Accrued interest for VRPC and requires it ($0.00
   allowed).
3. **Accrued-interest mechanics vs. item B4 above.** Docx §4.5 says carried
   separately; the macro's own unpaid-interest handling compounds. Pick one
   for the new input.
4. **Non-financed fees:** paid separately (IN-07) or recovered through the
   payment waterfall and carved out of principal (B.1 + macro)? See B1.

   **Resolved for `app/` (2026-09-23): DQ-27, paid separately per IN-07**
   (see B1). → `app/engine` fee equations, pending 011. Still open for
   COB-ts/py/xlsx. The BRD's own B.1 wording is D8.
5. **Schedule columns (docx §3.3 / B.6).** 006's `ScheduleRow` has one
   balance; docx/macro have Loan / Principal / Fees (opening + closing),
   cumulative interest (`intAccrued`) and a financed-fee column on the first
   payment. Align 006's row shape with the macro columns B–O.
6. **Non-functional (docx §7) not covered anywhere in 006:** export/print
   (macro has `btnPrint_Click`), no personal-data storage, keep shared field
   values when use case changes.
7. **Deliberate deviations to send back to the docx author** so v2.4 matches:
   the no-fees COB-rate short-circuit (not in §4.1), skip-date dead code,
   Monthly = anchored not EOM, 366-day leap-year periods, fee/principal split.
   *Added 2026-09-23:* for `app/`, acceptance is UAT sign-off, not
   reproduction of the Excel outputs (§2, §7 parity testing; G15, DQ-26).
8. **The BRD contradicts itself on non-financed fees (added 2026-09-24).**
   *BRD author.* Are non-financed fees (IN-07) left out of the payment
   waterfall (payments never go towards them)? Yes / no.
   - *Text (verbatim):*
     - IN-07: "Fees paid separately by the member and NOT deducted from the
       advance. Included in the cost of borrowing but not added to principal.
       Accepts $0.00."
     - BR-04: "Non-financed fees are paid separately by the member, are NOT
       added to principal, but ARE included in the cost of borrowing (C)."
     - Appendix B.1, `feesToRecover`: "Financed Fees (IN-06) + Non-Financed
       Fees (IN-07). Recovered within the payment waterfall."
     - Appendix B.5, step 2: "feesPaid  = min(remaining, feesToRecover)".
   - *Consequence:*
     - **Yes (IN-07 / BR-04 reading):** the fees count once, in C. No part of
       any payment goes to them, so the payments that would have gone to them
       go to principal instead. Principal falls faster, total interest is
       lower, and OUT-07 (principal payment) is higher.
     - **No (B.1 / B.5 reading, which is also what the macro does):** after
       interest, the early payments pay off the non-financed fees before any
       principal. Principal falls later, total interest and C are higher, and
       the member in effect pays those fees twice: once separately (IN-07) and
       again out of the scheduled payments.
   - *Recommend:* **yes.** IN-07, BR-04 and OQ-01 ("RESOLVED (v2.2)") all
     say "paid separately", and the user chose IN-07 for `app/` (DQ-27).
     B.1 is labelled a transcription of the macro, so it carries the macro's
     behaviour, not the resolved requirement. v2.4 should drop IN-07 from
     `feesToRecover`.
   - *Blocks:* the `app/engine` fee equations (track E, 011); the `app/`
     expected values for fee-bearing scenarios (for example S1, S9); UAT
     sign-off for any calculation with non-financed fees > 0. `app/` builds
     on the IN-07 reading (DQ-27) until the author answers.
   - *Widened (2026-09-24) to financed fees.* B.1 also puts IN-06 into
     `feesToRecover`, while IN-06 is already inside IN-02 (`openingBalance`),
     and B.2 step 6 reduces the balance by `principalPaid` only. Taken
     literally, a financed fee is paid once as a fee and still stays in the
     balance, earning interest. §3.3 ("added to the mortgage principal") and
     BR-03 ("already included") disagree too; B.6 (Loan = Principle + Fees)
     implies the macro's separate fee component. BR-13's fee step needs
     *some* fee to recover. `app/engine` today follows B.2 literally
     (`cobCanada.ts`: balance starts at IN-02, financed fees recovered in the
     waterfall, balance reduced by principal only), so fee-bearing `app/`
     results charge financed fees twice. Sent to the author as one question
     with options (i)–(iii): `docs/app/brd-author-questions.md` §1.1. Overlaps
     D9's B2 case.
9. **Which BRD text governs `app/` where Appendix B is already known to be
   wrong (added 2026-09-24).** *User.* Where the BRD's Appendix B describes
   something the BRD's own §3–§5 or the macro show to be wrong, does `app/`
   follow (a) the Appendix B text as written, or (b) the corrected rule, with
   the correction sent to the BRD author for v2.4? Pick one.
   - *Text:* the user's decision "the BRD governs `app/engine`"
     (`docs/app/delivery-plan.md` §2.0), against these known cases:
     - B.2/B.5: "closingBalance = openingBalance − principalPaid" (fees paid
       never reduce the balance; item B2).
     - B.3: "using a 365-day year" (a period wholly inside a leap year; item B7).
     - B.4 Monthly: "getNextEOM(startDate) – end-of-month stepping" and the
       skip-date rule (both unused by the macro; item C1).
   - *Consequence:* (a) `app/` produces figures that differ from the legacy
     workbook in these cases, and UAT testers comparing against the workbook
     will see the differences. (b) `app/` follows the rule the BRD means, and
     each correction is listed as a deviation from the v2.3 text.
   - *Recommend:* **(b).** B.2–B.4 are described as a transcription of the
     macro, and these lines misdescribe it; taking them literally would build
     in known errors.
   - **Resolved for `app/` (2026-09-24): (b)**, user. Applied so far to the
     balance update (B.2/B.5 → 011 "D9 / D8", DEV-011-2) and the final payment
     (B6 → 011 "DQ-28", DEV-011-3). The B.3 leap-year and B.4 monthly-date cases
     still need their 011 rules.
   - *Blocks:* 011's equations for balance, day count and monthly dates;
     `app/` UAT expected values.

## E. Engine defects found by the qa audit (2026-09-23)

Found by running each engine against `COB-py/tests/fixtures/macro_oracle.py`,
a line-for-line transliteration of `CalculateAll` / `getRate` / `getNext*`.
The oracle reproduces all 2184 cells of the 007 vector bit for bit
(`ca_007_worked_vector.json`). Expected values below come from the oracle
(`ca_oracle_scenarios.json`), **not** from a live macro run. Scenario IDs
refer to that file. These are wrong results in the uncommitted working tree,
separate from the §B spec issues.

1. **Monthly dates overflow instead of clamping** (all engines; C1).
   `S2_monthly_jan31`, first payment 2027-01-31: expected 2027-02-28
   (`DateAdd("m")` clamps to month end), actual 2027-03-03. Blocked on 006
   equation 5 being rewritten per C1.
2. **xlsx row cap drops the last row** (COB-xlsx only). `S8_10y_weekly`, a
   10-year weekly term: expected 521 rows, actual 520, so total interest is
   $96.14 short. The workbook needs enough schedule rows for the longest
   supported term.
3. **Final-payoff row: three different answers** (all engines; B6).
   `S5_payoff`, $5000 at $1000/month: TS/PY count the full $1000 and leave the
   closing balance at −925.45; xlsx reports a final payment of 74.554; the
   macro reports 74.193. Blocked on the B6 decision (replicate the macro, or
   fix it as a named deviation).
4. **Validation gaps vs. the macro** (C2).
   - PY accepts a first payment before disbursal (it silently accrues $0
     interest), an end date equal to the first payment date, and a zero term.
   - Neither TS nor PY rejects `financed + non-financed fees >= loan`; the
     macro errors with "Total Fees must be less than the Loan Amount".
5. **TS requires `includedInCob` on every fee** (TS only). 006 equation 8
   says the engine never reads it, and PY accepts fees without it. Make it
   optional in TS, or drop it.

   *`app/` (2026-09-23), not a defect to fix now:* DQ-02 keeps itemised fees
   with `includedInCob`, and the `app/` UI sends `includedInCob: true` for
   every fee (see G3). Still open for the baseline engines; COB-ts is frozen,
   so no fix is scheduled there.
6. **Fee totals are rounded to the cent** (TS and PY; found by the QA design
   review, `docs/app/test-strategy.md` "Engine note", 2026-09-23).
   - *TS:* `COB-ts/src/ca/fees.ts:73-91`. `totalFees`, `totalFinancedFees`,
     `totalCashFees` and `totalFeesIncludedInCob` each return
     `round2(sum)`, where `round2(v) = Math.round(v × 100) / 100`
     (`COB-ts/src/money.ts`). `cobCanada.ts:183-184` uses the financed and
     cash totals for `disbursalAmount`, the waterfall's starting
     `feesToRecover` and the COB amount.
   - *PY:* the same. `COB-py/cob_calculator/fees.py:49-66` wraps each
     `total_*` property in `round2` (`js_round(v × 100) / 100`, `money.py`).
     PY also rounds `disbursal_amount` again
     (`cob_canada.py:221`, `round2(loan_amount − total_financed_fees)`); TS
     doesn't (`cobCanada.ts:190`).
   - *Macro (static reading only):* there is no fee list to sum. `finFee` and
     `nonFinFee` are read directly from the single cells `Calculator!D6` and
     `D8` (`Range(...).Value`, extraction lines 118–119 and 367–368). There is
     no `Round` call anywhere in the extraction. Both cells have only a
     display format (`#,##0.00`), with no data validation, and the workbook
     calculates at full precision (no "precision as displayed"). So the
     macro uses the typed values unrounded (C3).
   - *Unverified:* no live-macro run has used a fee with more than two
     decimals, so the macro's behaviour there is inferred from the code, not
     observed.
   - *Consequence:* it breaks the no-intermediate-rounding convention (C3).
     For fees keyed in whole cents, the result differs from the macro by at
     most float residue from summing several fees (the macro has one value
     per type, so it never sums). For a fee with a sub-cent part (for
     example 100.004), the engines use 100.00 and the macro uses 100.004.
     Every fee-dependent output (row fees, balances, OUT-02, OUT-03) then
     differs. The 007 vector and S0–S9 don't show it: their fees are $0 or
     whole cents.
   - *Recommend:* remove the `round2` calls from the fee totals (and from
     PY's `compute_disbursal_amount`), so fees stay unrounded as in the
     macro. If staff keying sub-cent fees should be prevented, make it a
     validation rule instead (a business decision, not a rounding step).
   - *Blocks:* nothing today. It must be fixed before any live-macro vector
     with sub-cent fees is used, and it goes with G3 (scalar fee fields make
     the sum disappear).

Also from the audit:
- B7 is a docs issue only. The engines already divide by 366 inside a leap
  year and match the macro across 2027–2029, within 1 ulp. For bit-for-bit
  equality they would need the macro's evaluation order,
  `bal × ((rate × days) / diy)`. 006 equation 3's text still needs the fix.
- The existing tests check only rows 1 and 156 and the totals of the 007
  vector, to the cent. There is no Appendix A test and no xlsx parity test.
  The fixtures above are ready to back full-row 1e-9 tests.

## F. Use-case gaps needing the BRD author (from 009, 2026-09-23)

Found by the use-case gap analysis (`009-use-case-gap-analysis.md`, finding IDs
G-xx). One question per item. Each has the exact text, a recommended answer
with its reason, and what it blocks.

### F-i. Audit / printout

1. **Sign-off block on the printout (G-01).** Should the printed or exported
   calculation carry a block with Prepared by, Verified by, Portfolio # and
   the Date/time? Yes / no.
   - *Text:*
     - Docx §2: "Inputs and results should be exportable/printable so a
       completed calculation can be retained on file." (No fields named.)
     - Macro: `Const PREPARED = "J6"`, `VERIFIED = "J8"`, `PORTFOLIO = "J10"`;
       `prepareForPrinting` moves the "employee box" onto the print area;
       `Calculator!J12 = NOW()`.
   - *Recommend:* **yes**, with all four as free-text fields that are printed
     and never persisted. The live tool prints them today, and a verifier
     line is what makes a retained copy auditable.
   - *Blocks:* UC-07-A1, 008 D6 (print/export spec), the UI specs.
2. **Source of "Prepared by" (G-01).** Is Prepared by typed by the user, or
   filled from the login identity? Pick one.
   - *Text:*
     - Macro `resetData`: `Range(PREPARED).Value = Users_Fullname()`, which
       reads the Windows AD/LDAP name through `ADSystemInfo`.
     - Docx §2: "Manual entry only: No connection to Wealthview or other core
       systems; the user keys in all values."
   - *Recommend:* **typed.** A directory lookup is a system integration, and
     the docx says the user keys in all values.
   - *Blocks:* UC-07-A1; it decides whether the app needs authentication at
     all.
3. **Show the COB-rate breakdown (G-12)?** Should the screen and printout
   show how the COB rate was derived: C, the average principal P, and the
   term days? Or, when there are no fees, the label "Annual Rate (no Fees)"?
   Yes / no.
   - *Text:*
     - Docx B.7: "The macro's **displayed** 'COB Rate' string expresses
       exactly this relationship".
     - Macro: the string is built, but its write to the sheet is commented
       out under `'FOR TESTING`, so it is not displayed today.
   - *Recommend:* **no** for parity, and correct B.7's wording in v2.4.
   - *Blocks:* UC-06 output list, UC-07 content.

### F-ii. Product × flow combinations

4. **Personal-loan rate at a non-monthly frequency (G-06, arithmetic
   conflict).** For a personal loan (or a variable mortgage) paid weekly,
   bi-weekly or semi-monthly, is the rate applied to the day-count interest:
   - (a) the contract rate unchanged, or
   - (b) the contract rate converted with m = 12,
     `n·[(1+i/12)^(12/n) − 1]`?

   Pick one.
   - *Text:*
     - Docx §4.2: "All other products (e.g., personal loans): use monthly
       compounding at the contract rate (m = 12)."
     - Docx BR-02: "use monthly compounding, which equals the contract rate."
     - Docx B.1: "for MONTHLY rate type = contract rate".
     - Workbook `Calculator!D10`:
       `=IF(RateType="MONTHLY", MonthlyRate, XLOOKUP(Freq, r_Freq, r_EquivalentRate))`.
       This uses the contract rate unconverted at every frequency.
     - 006 eq. 2 and 007 #10 chose (b).
   - *Consequence:* at 8.00% weekly, (a) gives 8.00% and (b) gives 7.979567%.
     OUT-01, every row's interest, OUT-03 and OUT-02 all change. Monthly
     frequency is unaffected.
   - *Recommend:* **(a)**. It is what the workbook computes, and BR-02 and
     B.1 say the same; the bindings say the macro wins on arithmetic. Fix
     §4.2 in v2.4.
   - *Blocks:*
     - 006 eq. 2 and architecture §3.4;
     - all personal-loan parity vectors at non-monthly frequency;
     - a formula pass on eq. 2.

   **Answered for COB-ts only (2026-10-13, user, DEC-B39-VAR-PL-M12, task B39,
   planned, not built):** (b) at Weekly, Accelerated weekly, Bi-weekly and
   Accelerated bi-weekly, for a variable-rate mortgage and for a personal loan
   of either rate type, but with n = (D ÷ P) ÷ Y (B37) and Y = Excel YEARFRAC
   basis 1 (B38), not n = 52 / 26: `n·[(1+i/12)^(12/n) − 1]`. (a) stays at
   Semi-monthly (and Monthly, where (a) = (b)). → COB-ts history: (a) since
   2026-09-27 (OQ-C, `COB-ts/CHANGES.md` §12); B39 moves the four 7- and 14-day
   frequencies to (b) behind a new switch, shipped on. Recorded in
   `COB-user-stories.md` §7.5 and US-08; spec
   `docs/new-req/014-b39-monthly-conversion-variable-personal-loan.md`
   (architect). Suggested deviation ID **DEV-B39-M12**: departs from §4.2's
   variable-mortgage "no conversion – the effective rate equals the contract
   rate (m = n)", from BR-02 / B.1 ("equals the contract rate" / "for MONTHLY
   rate type = contract rate") and from `Calculator!D10`; follows §4.2's
   personal-loan "(m = 12)". The recommendation above ((a), macro wins) is
   overridden for COB-ts by the user. **Still open:** the `app/` answer (DQ-30,
   BRD author letter §2.1; delivery-plan default "Unchanged"), COB-py and
   COB-xlsx (§I, Q-B39-ENGINES), and the BRD v2.4 wording. Note: the question
   as asked also covered Semi-monthly, which B39 leaves at (a), so COB-ts now
   mixes both readings by frequency.
5. **Renewal of personal loans (G-07).** Can the Renewal use case be selected
   with Product Type = Personal Loan? Yes / no.
   - *Text:*
     - IN-10c: "Renewal Date … Renewed mortgages only."
     - IN-01 lists "Renewal" with no product restriction.
     - §1.1: "Support for new mortgages/loans, renewals, …".
   - *Recommend:* **yes**, with the label kept as "Renewal Date".
     "Mortgages only" is most likely shorthand, since IN-10a says
     "mortgages / loans".
   - *Blocks:* UC-02 precondition, UC-08-A2.
6. **Does Variable Rate Payment Change lock Product and Rate type (G-08)?**
   When VRPC is selected, are Product = Mortgage and Rate type = Variable set
   and not editable? Yes / no.
   - *Text:*
     - IN-01: "Variable Rate Payment Change" (the name only).
     - BR-08: "Trigger Rate is calculated and displayed for variable-rate
       mortgages only."
     - Nothing restricts IN-03/IN-04 for this use case.
   - *Recommend:* **yes**, because the flow exists to produce the trigger
     rate, which BR-08 limits to variable mortgages.
   - *Blocks:* UC-04 precondition (architecture's "form fixes both values" is
     currently untraced), UC-08-A2.
7. **Is VRPC's calculation different from Payment Change on a variable
   mortgage (G-09)?** Yes / no; if yes, how?
   - *Text:*
     - IN-01: the use case "Drives conditional fields and calculation path."
     - No section defines a VRPC-specific calculation.
   - *Recommend:* **no difference** beyond the conditional fields. Nothing in
     the docx defines one, and the macro has no use-case input.
   - *Blocks:* UC-04 main flow; whether engines need a VRPC branch.
8. **IN-02 for Renewal (G-10).** For Renewal, is the Loan Amount the
   outstanding balance on the renewal date, including any financed renewal
   fees? Yes / no.
   - *Text:* IN-02: "New product: the disbursal amount (gross of financed
     fees). Payment change: the balance as of the change date." Renewal is
     not mentioned.
   - *Recommend:* **yes.** It is consistent with IN-02's lead sentence ("The
     total loan amount, inclusive of any financed fees") and with the Payment
     Change wording.
   - *Blocks:* UC-02 inputs and field help text; the renewal parity vector.

### F-iii. Outputs and validation

9. **OUT-01 label (G-11).** Which label should OUT-01 carry on screen and in
   print for products that are not fixed-rate mortgages? Pick one:
   - (a) "Semi-Annual Compounding Rate" always;
   - (b) "Calculated Rate (%)" always (the workbook label, `Calculator!C10`);
   - (c) (a) for fixed mortgages, (b) otherwise.
   - *Text:* OUT-01: "Semi-Annual Compounding Rate … For variable-rate
     products this equals the contract rate".
   - *Recommend:* **(b)**. It is the label users see today, and it isn't
     wrong for loans that don't compound semi-annually.
   - *Blocks:* UI and printout wording.
10. **$0 payment amount (G-13).** Is a Payment Amount (IN-08) of $0.00
    accepted? Yes / no.
    - *Text:*
      - §6: "reject non-numeric input and negative values (except where a
        $0.00 default is explicitly allowed)".
      - Only IN-06, IN-07 and IN-11 say "Accepts $0.00".
      - The macro accepts 0 (numeric check only); nothing is then paid and
        interest accrues to End Date.
      - The current code rejects it ("payment > 0").
    - *Recommend:* **no, reject it.** IN-08 is not on the explicit-$0 list,
      and a $0 payment produces no disclosure-meaningful schedule. This
      deviates from the macro; record it in D7.
    - *Blocks:* UC-05-E8, validators in all engines.
11. **Standalone rate converter (G-05).** Must the replacement offer the Semi-
    Annual Rate Converter as a user-facing screen showing all seven
    equivalents (Annual, Semi-Annual, Quarterly, Monthly, Semi-Monthly,
    Bi-weekly, Weekly)? Yes / no.
    - *Text:*
      - §1.1: "Reproduction of the calculation logic held in the existing
        Excel workbook, including the Semi-Annual Rate Converter sheet".
      - Appendix A: "Developers should use these as unit-test cases".
      - Workbook: the converter sheet is visible, and it is where users enter
        the semi-annual rate (`B4 "Enter Mortgage Rate"`).
    - *Recommend:* **no.** §1.1 says "calculation logic" and Appendix A frames
      the table as tests. The IN-09 frequencies are already covered by OUT-01.
    - *Blocks:* whether UC-10 exists.

## G. App-level questions from the full-stack app (010, 2026-09-23)

Found while tracing 010 (Fastify API + React UI; decisions D1, D2 revised,
D2a, D3–D7) back to the BRD. Revised 2026-09-23 against 010's current text
and QA's design review (`docs/app/test-strategy.md`, DR-13). The trace is `docs/app/requirements-traceability.md`. One question per
item. Each has the exact text, a recommended answer with its reason, and what
it blocks. **Who answers** is on each item: *BRD author* (via the user) or
*user* (an internal decision).

### G-i. Scope and the API (D2)

1. **Can other systems call the COB API (D2)?** *BRD author.* May other
   internal systems call the calculation API programmatically, as long as none
   of them feeds it from Wealthview or another core system? Yes / no.
   - *Text:*
     - §1.1: "A standalone calculator that accepts manual user input".
     - §1.2 (out of scope): "Any API or system integration with Wealthview.
       All inputs are entered manually by the user."
     - §2: "Manual entry only: No connection to Wealthview or other core
       systems; the user keys in all values."
     - 010 D2: "every team in the organisation can reach the app and build on
       it later … a documented, versioned internal service with a published
       OpenAPI contract".
   - *Consequence:* **yes**: the API is a public internal contract, §1.1/§2
     need a v2.4 amendment, and G2/G3 must be settled before v1 is published.
     **No**: the API stays the SPA's private back end, the OpenAPI document is
     not published, and D2 is withdrawn.
   - *Recommend:* **yes, with the Wealthview/core-system restriction written
     into v2.4.** The user has decided D2. The BRD's actual exclusion is
     Wealthview integration, and §2's "the user keys in all values" is the
     part that needs rewording.
   - *Blocks:* publishing the OpenAPI contract; `/docs` in production; the
     API versioning policy; G2, G3.

   **Superseded (2026-09-23): user decision replacing D2.** Everyone in the
   organisation can use the React front end. The API is **not offered to
   other teams**; it is the SPA's private back end. Later reuse by other
   projects goes through the engine package or a Fastify plugin, not through
   calls to this deployment. So there is nothing to ask the BRD author: the
   deployment stays a standalone, manually keyed calculator (§1.1, §2). No
   v2.4 amendment is needed for it.
   → Changed:
   - `docs/app/requirements-traceability.md`: §2.1 is rewritten to what
     remains; the §1.1 b1, §1.2 b1 and §2 manual-entry rows move from partial
     to covered; AC-X6 now says "private API, no `/docs` in production".
   - G2, G3, G6, G15 and G16 below are revised.
   - 010 and `docs/app/architecture.md` belong to the architect, who folds
     this in.
2. **Does the API enforce per-use-case mandatory fields?** *User.* Should a
   Renewal / Payment Change / VRPC request without `accruedInterest` be
   rejected by the API (not just blocked in the form)? Yes / no.
   - *Text:*
     - BR-05: "Accrued interest is a mandatory input for Renewal and Payment
       Change use cases and must accept $0.00."
     - §6: "Mandatory fields (per use case) must be completed before
       calculation is permitted."
     - Engine `types.ts`: `accruedInterest` "Defaults to 0 when omitted".
     - 010 invariant 6: "The API adds no business rules of its own."
   - *Consequence:* **yes**: the rule goes into `validateCobCanadaInput`
     (so invariant 6 still holds) and all three engines change. **No**: anyone calling
     the private API directly (possible under D1, though unsupported), or a
     later project reusing the engine package, gets a result the BRD says must
     not be calculated.
   - *Recommend:* **yes, in the engine validator.** *(Revised 2026-09-23 after
     G1 was superseded.)* The SPA is now the only supported caller, so this is
     less urgent. It still belongs in the engine, which is what reuse goes
     through.
   - *Blocks:* API schema, engine validators (TS/PY/xlsx), AC-02.3.

   **Resolved, provisional (2026-09-23): DQ-04, no.** The user said "Just
   remove it". Interpretation, still to confirm with the user: no rule in the
   engine or the API. The `app/` form requires Accrued interest for Renewal,
   Payment Change and VRPC ($0.00 allowed; BR-05, IN-11 "Mandatory … accepts
   $0.00"), and `app/engine` keeps defaulting a missing value to 0. → AC-02.3
   in `docs/app/requirements-traceability.md` now expects a result (not a 4xx)
   for a direct request without `accruedInterest`; BR-05, §6 b4 and UC-05 rows
   updated. The accepted gap: a direct API caller can omit it.
3. **Fee inputs on the wire.** *User.* Should the v1 request mirror the BRD's
   two scalar fields (Financed Fees IN-06, Non-Financed Fees IN-07), with the
   API mapping each to one fee with `includedInCob: true`? Yes / no.
   - *Text:*
     - IN-06 / IN-07: one currency field each.
     - BR-04: non-financed fees "ARE included in the cost of borrowing (C)".
     - Engine `fees.ts`: an itemised `fees[]` with `financed` and a required
       `includedInCob` (the TS-only requirement is 008 E5).
     - 010 "Request": "**every fee property is required**, including
       `includedInCob` (matches `validateFee`; the API never fills a
       default)".
   - *Consequence:* **yes**: the contract matches the BRD, a caller can't
     exclude a fee from C, and 010's "never fills in a default" changes.
     **No**: the contract exposes a knob the BRD doesn't have; a caller
     setting `includedInCob: false` gets a COB $ and rate that break BR-04.
   - *Recommend:* **yes.** It is the BRD's input list. *(Revised 2026-09-23
     after G1 was superseded.)* The API is now private, so this is about
     matching the BRD's inputs and keeping BR-04 true for direct callers.
     It is no longer about a published contract.
   - *Blocks:* API schema, `wire.ts`, the form's fee fields, AC-01.4.

   **Resolved (2026-09-23): DQ-02, no; itemised fees.** The `app/` form has
   rows of name, amount and a "financed" checkbox, added and removed as in
   `COB-ts/ui/ca.html`. The UI sends `includedInCob: true` for every fee. The
   UI validates, the server validates again, and the server returns the
   results and schedule columns. → traceability IN-06, IN-07, BR-04 rows and
   AC-01.4 updated. Accepted gap: a direct API caller can still send
   `includedInCob: false` and get a C that breaks BR-04 (unsupported caller;
   see G2).
4. **Engine-required inputs that aren't in the BRD.** *User.* Until the
   engine drops them, should the app hide `termYears`/`termMonths` and
   `semiAnnualCompoundingDate` and send derived placeholder values? Yes / no.
   - *Text:*
     - `validate.ts`: "termYears/termMonths must not both be 0"; fixed
       mortgages "require semiAnnualCompoundingDate".
     - BRD IN-01…IN-13: no term-years/months field, no compounding-date field.
     - 009 I5 recommends removing `semiAnnualCompoundingDate`; C4 covers the
       term fields.
   - *Consequence:* **yes**: the form matches the BRD, and the API derives
     values the engine ignores for arithmetic (a mapping 010 invariant 6
     doesn't foresee). **No**: staff see and must fill fields no requirement
     asks for.
   - *Recommend:* **neither as a workaround. Resolve 009 I5 and C4 in the
     engine first.** Both are internal decisions, and the app can't ship its
     form until they're made.
   - *Blocks:* form field matrix, API schema, 009 I5, C4.

   **Resolved for `app/` (2026-09-23): DQ-03, collect all of them, all
   required:** term years/months, the semi-annual compounding date and End
   Date. → the `app/` form and schema require them; traceability IN-13 and
   the untraced-inputs row updated. The term and compounding-date fields
   still have no BRD ID (they come from the engine and the workbook), so the
   form shows them as required inputs that the BRD doesn't list. 009 I5 is
   answered "keep" for `app/`.
   - *Still open (user, yes/no):* is the semi-annual compounding date
     required for every product, or only for fixed-rate mortgages? The answer
     says "All required"; the engine requires it only for fixed mortgages
     (`validate.ts`), and only fixed-rate mortgages compound semi-annually
     (BR-01). *Recommend:* fixed-rate mortgages only; the field means nothing
     for the others. *Blocks:* the form field matrix, AC-01.8. Until answered, the
     engine's current rule (fixed-rate mortgages only) is what runs.

### G-ii. Access, identity and the printout (D1)

5. **"Prepared by" is typed, given D1.** *User, then BRD author via F2.*
   With no access control (D1), the app has no user identity, so F2 can only
   be answered "typed". Accept that the printout's preparer is self-declared?
   Yes / no.
   - *Text:*
     - Macro `resetData`: `Range(PREPARED).Value = Users_Fullname()` (Windows
       directory login).
     - 010 D1: "the app is for internal staff and has **no access control**
       … It does not track who made them."
     - §2: "the user keys in all values."
   - *Consequence:* **yes**: F2 closes as "typed" and the BRD's auditability
     rests on a typed name plus the Verified-by signature. **No**: D1 must be
     reopened (SSO or an auth proxy), and the name then becomes staff PII in
     the request path.
   - *Recommend:* **yes.** It matches F2's recommendation and §2's manual
     entry, and the Verified-by signature is the control.
   - *Blocks:* F2, UC-07-A1, AC-07.4.
6. **Where the app is reachable from.** *User.* Pick one: (a) Alterna's
   internal network / VPN only; (b) reachable from the internet.
   - *Text:* no BRD requirement. Document classification "INTERNAL
     DISTRIBUTION ONLY"; 010 D1 "Internal staff only, **no access control**";
     010 resolved Q1: "Reachability is controlled by the network (internal
     ingress)".
   - *Consequence:* **(a)**: D1 "no access control" is bounded by the network.
     **(b)**: anyone can run and script calculations against the private
     API; member figures cross the internet unauthenticated.
   - *Recommend:* **(a).** D1 only holds up with a network boundary.
   - *Status:* 010 already designs (a): Container Apps in an internal
     environment (ADR-003). This item asks the user to confirm it.
   - *Blocks:* AC-X7; the network details are 010 Q-H3.

   **Deferred (2026-09-23): DQ-19, "to be decided".** Placeholders stay; the
   build assumes (a). Still open.
7. **Sign-off fields stay in the browser.** *User.* If F1 adds Prepared by /
   Verified by / Portfolio #, are those fields kept out of every API request
   and every log? Yes / no.
   - *Text:*
     - §7: "should not persist member/customer personal information."
     - Macro `PORTFOLIO = "J10"` (a member portfolio number).
   - *Consequence:* **yes**: print is client-side only and the API never sees
     an identifier. **No**: a member identifier travels with the member's
     financial figures, and the no-body-logging rule becomes the only guard.
   - *Recommend:* **yes.**
   - *Blocks:* UC-07-A1, AC-07.3, AC-07.4.

### G-iii. Monitoring and privacy (D1, D3)

8. **What monitoring records.** *User.* Pick one:
   (a) request counts only (Application Insights `requests`, by operation and
   result code), plus `cob.calculations` by `outcome` only;
   (b) (a) plus the `cob.calculations` dimensions `flow`, `productType`,
   `rateType`, `paymentFrequency`.
   - *Text:*
     - 010 D1: "Monitoring exists only to count requests over time, not to
       track who made them."
     - 010 "Monitoring": the `requests` table plus one counter,
       `cob.calculations`, with the dimensions in (b). There is no
       per-calculation log line.
     - §7 no PII storage.
   - *Consequence:* (a) is exactly D1's "count requests". (b) adds a usage
     breakdown by product and flow. Neither holds amounts, dates or identities.
   - *Recommend:* **(b).** It answers "how is it used" with enum values only,
     and holds no per-calculation record.
   - *Status:* 010 implements (b) provisionally; the same question is 010
     Q-M1 (QA DR-9). One answer closes both.
   - *Blocks:* `api/src/metrics.ts`, AC-X5.
9. **Rate limiting vs "no IPs".** *User.* Pick one: (a) no app-level rate
   limit; (b) one global limit, not keyed by client; (c) per-IP limit held in
   memory only.
   - *Text:*
     - 010 D3: "client IPs are never logged or stored, including by the
       platform's telemetry."
     - 010's first draft ("Hardening"): `@fastify/rate-limit` (in-memory
       store). Its default key is the client IP.
   - *Consequence:* (c) keeps IPs in process memory, which reads as "stored"
     under D3. (b) lets one noisy caller exhaust the limit for everyone. (a)
     leaves only the platform's protection.
   - *Recommend:* **(b)**, sized well above staff use. It honours D3 without a
     reading of "stored".
   - *Blocks:* hardening config, AC-X3.

   **Closed (2026-09-23): answered by the 010 design, option (b).** 010 "Rate
   limiting": "`@fastify/rate-limit` with the in-memory store and **a constant
   key** (`keyGenerator: () => 'global'`), so there is one bucket per replica
   and **no per-IP state** (D3)." The limit's size is 010 Q-A4.
   → Changed: traceability §2.3 (leak closed) and AC-X3.
10. **Field-level rule errors.** *User.* Should a 422 identify the field it
    concerns and use the BRD/macro wording (009 UC-05-E1…E8), instead of the
    engine's developer text? Yes / no.
    - *Text:*
      - 010 error contract: 422 `detail` is "**The engine's message,
        verbatim** (one rule source). No `issues`: the engine does not report
        a field path".
      - `validate.ts`: `loanAmount must be > 0, got ${input.loanAmount}`.
      - Architecture UC-05: "Errors are field-level and block calculation".
      - Macro: "Total Fees must be less than the Loan Amount" on both fee
        fields.
    - *Consequence:* **yes**: the engine's `RangeError` gains a field path and
      user wording (all engines change; the one-rule-source invariant holds).
      **No**: the UI shows one developer-worded message per attempt, not tied
      to a field, and the message echoes input values that must never reach a
      log.
    - *Recommend:* **yes.**
    - *Blocks:* UC-05 exception flows, AC-05.3, AC-05.4.

### G-iv. Hosting (D4)

11. **Azure region.** *User (Alterna IT/policy).* Must the app run in a
    Canadian Azure region? Yes / no.
    - *Text:* BRD silent. §7 "should not persist member/customer personal
      information"; member financial figures pass through in transit.
    - *Consequence:* **yes** limits the region choice to Canadian regions and
      the services offered there. **No** leaves it to the architect.
    - *Recommend:* **yes**, unless Alterna policy says otherwise. It costs
      nothing for a stateless unit.
    - *Status:* the same question is 010 Q-H2 (which adds telemetry location
      and retention). One answer closes both.
    - *Blocks:* D4 deployment.

    **Deferred (2026-09-23): DQ-18, "to be decided later".** Placeholders
    stay (`canadacentral`). Still open.
12. **Is print/PDF plus CSV enough for "export"?** *BRD author.* Do "Print or
    save as PDF" (the browser's) and an unrounded CSV download meet §7's
    "exported or printed"? Yes / no.
    - *Text:* §7: "Allow the completed calculation (inputs, outputs, and
      schedule) to be exported or printed for retention on file." The UI
      design (`docs/visual_design/app-ui.md` K2, `ResultActions`) offers
      "Print or save as PDF" and "Download CSV" (unrounded).
    - *Consequence:* **yes**: the planned print/PDF + CSV is enough. **No**:
      another format (for example a PDF generated by the app) has to be
      specified.
    - *Recommend:* **yes.** It gives a file for retention with no server-side
      rendering, so nothing touches the API.
    - *Blocks:* D6, UC-07 scope, AC-07.5.
13. **Engine version on the printout.** *BRD author.* Should the printout show
    the app/engine version and the calculation date/time? Yes / no.
    - *Text:* §2 "Auditability … retained on file". 010: every response has
      `X-Engine-Version`. Macro `J12 =NOW()` covers the date only (F1).
    - *Consequence:* **yes**: a retained copy can be traced to the parity
      baseline in force when it was made. **No**: after an engine fix
      (008 §B), old and new printouts can't be told apart.
    - *Recommend:* **yes.**
    - *Blocks:* UC-07 content.
14. **Cold start.** *User.* Is a first calculation that takes several seconds
    (cold start) acceptable? Yes / no.
    - *Text:* BRD: no response-time requirement. 010 D4: "Hosted on
      **Azure**, on an independent unit chosen for efficient calculation."
    - *Status:* the same question is 010 Q-H1 (`minReplicas` 1 or 0). One
      answer closes both.
    - *Consequence:* **no** rules out scale-to-zero hosting without a warm
      instance. **Yes** leaves it open.
    - *Recommend:* **no.** Staff run this with a member waiting.
    - *Blocks:* D4 choice.

### G-v. Go-live and housekeeping

15. **Go-live before parity.** *User.* Pick one for results with fees > 0,
    accrued interest > 0, or month-end monthly dates while 008 §B, C1 and §E
    are open: (a) serve them unflagged; (b) serve them with a visible
    "not yet verified against the workbook" flag; (c) refuse them (422).
    - *Text:* §2: "The application must reproduce the outputs of the existing
      Excel calculator (COB Calculator v7) for the same inputs." 010 Status:
      "every parity gap in 006 / 008 (fees > 0, unpaid interest, date rules,
      the two missing accelerated frequencies) carries over."
    - *Consequence:* (a) staff receive numbers known to
      differ from the workbook. (b) they are warned. (c) the app only serves
      the cases shown at parity.
    - *Recommend:* **(c) for staff go-live; (b) for a pre-release.** A
      disclosure with a wrong COB is a compliance error.
    - *Blocks:* go-live.

    **Resolved for `app/` (2026-09-23): DQ-26, none of (a)–(c).** The BRD
    governs `app/`, so there is no parity gate against the macro. Go-live
    comes only after the team confirms the values in UAT; a UAT sign-off gate
    sits before prod. → traceability §2 parity, §7 parity testing, UC-09 and
    AC-06.1/AC-09.x rewritten to UAT acceptance. For COB-ts/py/xlsx, §2 parity
    still means the macro. This departs from the BRD's own §2 ("The
    application must reproduce the outputs of the existing Excel calculator
    (COB Calculator v7) for the same inputs") and §7 parity testing, so it is
    added to the D7 list of deviations for v2.4.
16. **Housekeeping: §1.2 is misquoted.** *No answer needed; doc fix.*
    `architecture.md` §1 ("Wealthview or any system integration") and 010
    Scope ("excludes Wealthview and other system integration") paraphrase
    §1.2 more widely than it reads: "Any API or system integration with
    Wealthview. All inputs are entered manually by the user." The wider
    constraint is §2 ("No connection to Wealthview or other core systems").
    Fix both paraphrases (010 is the architect's). G1 is superseded, so this
    no longer waits on it.

## H. Validation of resolved items against COB-ts (qa + ba, 2026-09-24)

Read-only runs of the frozen COB-ts build and `app/engine/dist` on the same inputs
(oracle numbers from `macro_oracle.py`, not a live macro). "Tests pass", not
workbook parity, except the 007 vector and Appendix A. COB-ts check: 199 passed
(fixture parity: S1, S5, S6, S9 expected failures). `compare:cob-ts`: 10/16 files
identical.

1. **Financed fees charged twice in both engines** (D8, B1–B3). S1 cost of
   borrowing: COB-ts $25,297.89, `app/` $25,242.42, oracle $25,014.11. `app/` fix:
   011 "D9 / D8". COB-ts stays as is (frozen).
2. **COB-ts non-financed fees** stay in principal *and* go through the waterfall
   (B.1 literally), unlike the macro's carve-out. `app/` follows IN-07 (DQ-27).
3. **COB-ts tests encode the double charge:** `COB-ts/tests/ca/invariants.test.ts:98`
   and `:117` assert that fees increase total interest; in the macro, S0 and S1
   have the same total interest. Record only (COB-ts frozen).
4. **Final payment overshoots in both engines** (B6): S5 closes at −$925.45; S9
   pays $5,618 of principal on a $5,000 loan. `app/` fix: 011 "DQ-28".
5. **DQ-30 default not implemented:** both engines convert personal-loan rates
   from m = 12 at non-monthly frequencies (6% weekly → 5.98850%); the delivery-plan
   default says "unchanged". Question sent to the BRD author (§2.1 of the letter);
   no change until answered. *Later (record only): COB-ts moved to "unchanged"
   on 2026-09-27 (OQ-C, `COB-ts/CHANGES.md` §12). **2026-10-13, answered for
   COB-ts by the user (DEC-B39-VAR-PL-M12):** converted with m = 12 and the
   leap-aware YEARFRAC n at Weekly, Accelerated weekly, Bi-weekly and Accelerated
   bi-weekly; unchanged at Semi-monthly and Monthly. See F-ii #4. `app/` still
   open.*
6. **Underpayment (S6):** $906.29 of unpaid interest is missing from the ending
   balance, total interest and C (B5, still open).
7. **Letter assumptions vs build** (ba): DQ-06 and DQ-16 in the first draft
   contradicted the build (VRPC locks Mortgage + Variable; Renewal allows personal
   loans). Letter corrected: DQ-06 assumption now matches the build; DQ-16 is an
   open question.
8. **Consistent:** DQ-02, DQ-03 (compounding date required for fixed mortgages
   only, which §2.0's "all required" doesn't spell out; OQ-011-4), DQ-04, DQ-05,
   DQ-13, DQ-15, DQ-29, DQ-31, DQ-32, DQ-33, DQ-34; the DQ-05 note's $849.31 /
   $849.32 figures reproduce.
9. **Test gaps in COB-ts** (record only): no direct test for the DQ-04 default,
   for term / compounding date having no effect, or for VRPC = Payment Change.
10. `delivery-plan.md` §2 table rows DQ-02 and DQ-04 still read "Answer:" with
   pre-§2.0 answers; the note above the table says §2.0 wins.

### H (cont.) — edge-case sweep (qa, 2026-09-24)

87 named cases + 30,000 random inputs on COB-ts-copy and `app/engine` (identical
output). No invariant violations. Findings:
11. **Fees ≥ loan** gave a negative payment (DQ-28 cap). **Fixed 2026-09-24** for
    financed fees (011 "BRD §6"); non-financed fees in the limit stay open (E4).
12. **COB-ts-copy UI parsed dates at local midnight** (engine is UTC): east of UTC every
    date moved a day. **Fixed 2026-09-24** in `COB-ts-copy/ui/ca.js`; verified in
    Tokyo/Toronto/UTC/Honolulu. `app/web` was not affected.
13. **New consequence of E1:** a monthly schedule anchored on Feb 29 (2028-02-29 →
    2029-02-28) gives 12 rows vs the oracle's 13; the last payment is dropped. E1/C1
    still need their 011 rule under D9 (b).
14. Direct engine callers can pass Infinity, numeric strings and unknown enum values
    (the API's schema blocks them). Low priority.
15. Design review of the results area: `docs/visual_design/results-kpi-review.md`
    (open questions there: APR precision, BRD §4.3 trigger-rate wording vs formula,
    accrued interest in total interest / C).

## I. B39: monthly-compounded conversion for variable mortgages and personal loans (user, 2026-10-13)

Decision **DEC-B39-VAR-PL-M12** (`COB-user-stories.md` §7.5; task B39, COB-ts
only, planned, not built; spec
`docs/new-req/014-b39-monthly-conversion-variable-personal-loan.md`, architect).
User Excel examples registry:
`COB-py/tests/fixtures/ca_user_excel_examples.json` (architect). Evidence is the
user's own Excel, not the reference workbook. Rule set: COB-ts.

1. **Q-B39-VAR1-CENT (yes/no). Open.** VAR-1 (Payment change, variable, 4 %,
   109,939.12, Weekly 145.16, accrued 0, 2026-10-08 / 2026-10-15 / 2029-09-27):
   Excel Total interest 12,463.91 / principal 10,035.89; B39 gives 12,463.92;
   today 12,480.90. Accept the 1-cent gap provisionally?
   - *Recommend:* yes, pinned as a known gap (VAR-2 matches to the cent; the
     user chose this rule over the alternative).
   - *Consequence of no:* another fitting pass before B39 can be signed off.
   - *Blocks:* how VAR-1 is pinned in the 014 tests (parity or known gap).
2. **Q-B39-VAR2-FREQ (yes/no). Open.** VAR-2 (variable, 3.8 %, 333,623.25,
   payment 863.15, accrued 277.63, 2026-10-13 / 2026-10-19 / 2031-09-15; Excel
   57,808.56 / 53,537.79; B39 57,808.56; today 57,862.71) had no frequency;
   Bi-weekly is inferred from 129 payments × 863.15 = interest + principal.
   Confirm Bi-weekly?
   - *Recommend:* yes; the arithmetic only fits a 14-day schedule.
   - *Blocks:* recording VAR-2 as an Excel truth rather than an inference.
3. **Q-B39-PL-EXAMPLE (request). Open.** No user Excel example exists for a
   personal loan (either rate type) or for an Accelerated frequency; both are
   covered by extension of the rule.
   - *Blocks:* nothing in the build; any pinned Excel figure for those cases.
4. **Q-B39-UNIFIED (request). Open.** The user chose B39 over a single rule for
   every product ("rate truncated to 6 dp, no row rounding"), which also matched
   3 of the 4 examples. The full-precision Calculated-rate cell from the user's
   Excel for VAR-2 and for fixed case 1 would show which rule the Excel uses.
   - *Blocks:* nothing now; it may reopen the rule choice (B38 and B39).
5. **Q-B39-ENGINES (pick one). Open.** (a) COB-ts only, like B37 / B38;
   (b) also COB-py / COB-xlsx; (c) also `app/engine` (BRD governs there; DQ-30
   default "Unchanged", BRD author letter §2.1).
   - *Recommend:* (a), consistent with B37 / B38.
   - *Blocks:* B39 scope beyond COB-ts; F-ii #4 / DQ-30 for the other engines.
6. **Q-B39-SWITCH (pick one). Open (BA, not in the user's list).** Does the B39
   switch act on its own (with `LEAP_AWARE_PAYMENTS_PER_YEAR` off, n = 52 / 26)
   or only while that switch is on, like B38?
   - *Recommend:* only with it on; the decision defines n as B37's leap-aware n.
   - *Blocks:* the 014 switch table.
7. **Q-B39-TRIGGER (yes/no). Open (BA, not in the user's list).** BRD §4.3:
   "Trigger Rate = ( Payment Amount × Payments Per Year ) ÷ Current Outstanding
   Principal" (variable mortgages only, BR-08). DEC-B37-LEAP-N (8) kept it out of
   scope because variable mortgages were "never converted"; B39 ends that. Keep
   the Trigger rate on the frequency key (52 / 26)?
   - *Recommend:* yes; the decision changes the rate only.
   - *Consequence of no:* the Trigger rate changes for weekly / bi-weekly
     variable mortgages (Payment change, VRPC).
   - *Blocks:* 014 scope.

**Conflicts recorded, not resolved (DEV-B39-M12, suggested ID):** the BRD
contradicts itself (§4.2 personal loans "(m = 12)" and IN-04 "all other products
compound monthly" vs §4.2 variable "no conversion … (m = n)", BR-02 "which equals
the contract rate", B.1, OUT-01 "For variable-rate products this equals the
contract rate"); B39 follows the first group and departs from the second and
from `Calculator!D10`. It also reverses, for these cases, OQ-C (2026-09-27) and
DEC-B33-FREQ point (4).

## Suggested order for tomorrow

1. A1–A3 (minutes).
2. Build a fee-bearing test vector: in the xlsm set financed + non-financed
   fees > 0 (ideally also a payment below interest to hit B4/B6), save the
   schedule output, and use it as the second parity vector. *(2026-09-23: for
   COB-ts/py/xlsx only; `app/` needs no live-macro vector.)*
3. Rewrite 006 equations 3, 4, 5, 7 per B and C; then re-check each engine.
4. Send D1–D7 to the BRD author as one list.
