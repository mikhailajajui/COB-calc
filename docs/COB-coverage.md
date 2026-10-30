# COB Calculator: Coverage Report

For business owners, auditors and reviewers. Version of 2026-10-29: the security and hosting changes SEC-6 (self-hosted font and logo, CHANGES §87) SEC-5 (the page server for local use and Azure App Service, CHANGES §88) and SEC-5b (server hardening before the handover, CHANGES §90) SEC-5c (closing the connection after an error reply, security headers on the `Expect` replies, CHANGES §91) and the toolchain change SEC-NODE26 (Node 26 LTS for development and CI, CHANGES §92) are added in sections 1, 2, 3.5, 6, 7 and 8; the calculation content is as of 2026-10-09 (after B37, CHANGES §75; B36 was withdrawn and never built). The history of each change is in `COB-ts/CHANGES.md`, one entry per task with What, Why and Evidence. This report does not repeat it.

How to read this report: each claim names the requirement, story or decision it comes from and the evidence for it. A claim without evidence is marked **Not verified**. A decision that is still open is shown as open, with what the calculator does today.

**Status words used everywhere:** **Covered** (built and QA-verified) · **Covered – differs from Excel** (with the decision ID) · **Partly covered** · **Not covered – out of scope** · **Not covered – planned** · **Open decision**. Deliverables use **Delivered**, **Planned**, **Parked** or **Removed**.

Requirement → Build → Test → Evidence: every row below follows this line, left to right.

## 1. Summary

The COB Calculator replaces the Excel workbook "Cost of Borrowing Rate Calc_Current.xlsm" (Calculator v7). It is a standalone calculator: staff type the inputs, and it shows the cost of borrowing rate, the amounts, the payment schedule and a printout. It stores nothing about the member and connects to no other system. It reproduces the workbook's results except where a recorded decision says otherwise (section 4).

| Headline | Number | Where to check |
|---|---|---|
| User stories covered | 5 Covered, 5 Covered – differs from Excel, 7 Partly covered, 2 Open decision, 0 not covered (19 in all) | section 3.2 |
| Use cases covered | 0 Covered, 2 Covered – differs from Excel, 7 Partly covered (9 in all) | section 3.3 |
| Differences from Excel with a decision ID | 10 delivered (DEV-OQS, DEV-OQX, DEV-OQY, DEV-OQAA, DEV-OQL, DEV-OQP, DEV-OQZ, DEV-B37-LEAPN, DEV-B38-ROUND, DEV-B39-M12); 1 retired (DEV-FB24, by DEC-B33-FREQ); 3 possible ones waiting for a decision | section 4 |
| Automated tests | Latest QA-verified count, after SEC-NODE26 on Node 26.13.0 (CHANGES §92 Evidence and verify addendum, checklist SEC-NODE26, QA PASS WITH NOTES 2026-10-29): 99 files, 4378 passed + 5 expected fail (4383), 0 failed, 0 skipped, also from a copy of the `COB-ts` folder alone; the four server test files also pass 416/416 on Node 22.23.4. After SEC-5c: 98 files, 4335 + 5 (CHANGES §91 verify addendum). CHANGES §91 Evidence records 4334 + 5 at the development step; the +1 is the `ui/serve.mjs` pin QA re-added (finding D43). After SEC-5b: 97 files, 4258 + 5 (CHANGES §90 verify addendum); CHANGES §90 records 4257 + 5 at the development step (finding D38). After SEC-5: 4089 + 5 (checklist SEC-5; finding D33). Earlier: 97 files, 4152 passed at B37 (CHANGES §75); 90 files, 3858 + 5 at SEC-11 (CHANGES §83). Not re-run for this report. | section 7 |
| Tests in two time zones | 1656 passed per zone after SEC-6, SEC-5, SEC-5b, SEC-5c and SEC-NODE26 (CHANGES §87, §88, §90, §91, §92); 1526 per zone at B37 (CHANGES §75) | section 7 |
| Security and hosting (SEC-5, SEC-5b, SEC-5c, SEC-6, SEC-NODE26) | Page loads nothing from other sites; server has a local and an Azure mode, a fixed set of security headers (also on Node's parse-error and `Expect` replies) and a host allow-list. Built and tested on Node 26.13.0 LTS; production App Service on `NODE|22-lts` (at least 22.23.4) until `NODE|26` is generally available (Q-NODE26-1). 17 Covered | section 3.5 |
| Reference case from the workbook (REF-01) | 156 schedule rows, 2,193 values, largest relative error 1.3e-14, with the B37 switch off (the workbook's 52 / 26). In the shipped state REF-01 differs on purpose (DEV-B37-LEAPN: total interest 22,514.07 instead of 22,514.11) | sections 3.1, 4.1 |
| Open decisions that change results | OQ-Q (the P basis), OQ-R (principal paid) | section 6 |
| Open questions on B37 that do not change results | Q-B37-LAW (Bank Act or Interest Act wording, stakeholders), Q-B37-WHICH-EXCEL (which workbook version gave the user's figures); the frequency option text is interim under Q-MSG | section 6 |

Where the calculator is weakest: the error messages are technical and shown one at a time (Q-MSG, US-06); the print and CSV layout is not decided (OQ-J); and nothing tests the page in a real browser any more: the hand-run Chrome scripts were deleted on 2026-10-28 (SEC-CHROME, section 7).

## 2. Deliverables

Everything the project delivers, with where it lives (paths are inside `COB-ts/` unless stated), who produced it and the evidence.

| Deliverable | What it is | Where it lives | Status | Produced by | Evidence |
|---|---|---|---|---|---|
| Calculator page | The web page staff use: input groups, results, schedule, print and CSV. The Flow list shows three flows (New mortgage / loan, Renewal, Payment change). Since SEC-6 its styles are in `ui/ca.css` and its font and logo are files in `ui/assets/` (no request to another site). | `ui/ca.html`, `ui/ca.css`, `ui/ca.js`, `ui/ca-view.js`, `ui/assets/`; start with `npm run ui` (local mode, `http://localhost:5173`) | Delivered | sr-dev builds, QA verifies | CHANGES §44, §51–§56, §59–§64, §70–§75; `tests/ca/a10-ca-view.test.ts`; the Chrome scripts that opened the page were deleted (SEC-CHROME, section 7) |
| Single-file edition | The whole calculator in one file that opens offline from a double-click (logo embedded, system fonts, version and build date in the footer). It is a snapshot: rebuild before sharing. | The file sits in the `COB-ts` folder; its own add-on folder holds the build script, tests and a README with the build and removal steps (named in CHANGES §66) | Delivered | sr-dev, QA | CHANGES §66; five test files and a 38-check Chrome script, passed on both copies; rebuilt for B37 (CHANGES §75: byte-identical rebuild, sha256 starts 9d365b4c; 38 checks pass; smoke passes against it); rebuilt in SEC-HELP2 (CHANGES §84, 37 Chrome checks then). The Chrome check of the shared page was deleted in SEC-CHROME, so the file is no longer opened in a browser by any test |
| Help page (removed) | Was a "Help" link in the calculator header that opened a page built from the documents in `docs/` (B29, CHANGES §58). Removed on 2026-10-28 by user decision before the security handover (SEC-HELP). The calculator no longer has a Help link or Help page; the documents stay in `docs/` as plain Markdown. | Nothing in `COB-ts/`; a backup outside the project is named in CHANGES §80 | Removed | sr-dev (removal); QA verification pending | CHANGES §80 (not yet QA verified) |
| User manual | How staff use the calculator: use cases, each field, the messages, results, printing | `docs/COB-user-manual.md` | Delivered | doc-writer | Written from the code and the recorded decisions. The checklist's Phase 6 line "Short user guide" is still unticked (F25). |
| Coverage report | This document | `docs/COB-coverage.md` | Delivered | doc-writer | This version |
| Domain overview | Diagrams of the business rules for domain experts, each rule marked today or planned | `docs/COB-domain-overview.md` | Delivered | architect | CHANGES §65 |
| Calculation engine | The rules: rate conversion, dates, interest, payments, fees, totals, validation | `src/ca/` (built to `dist/ca/`) | Delivered | sr-dev, QA | Tests in `tests/ca/`; golden masters; REF-01 |
| Golden master, first (New, Renewal) | A saved copy of the engine's output for 148 groups of inputs (4,455 cases). Any change in results fails a test. | `tests/ca/fixtures/golden_engine_v1.json`, sha256 starts b90ea69c; test `tests/ca/golden/engineGolden.test.ts` | Delivered | QA | Regenerated with the user's approval for B25 (CHANGES §61, 20 groups changed), for B33 (CHANGES §72: 54 personal-loan groups at weekly, bi-weekly and semi-monthly added back, one group enlarged, 93 unchanged) and for B37 (CHANGES §75: 18 of 148 groups, the fixed-rate mortgage weekly and bi-weekly ones, and 4 of 6 long cases changed; QA checked group by group against its pre-B37 pin; with the switch off the engine replays the pre-B37 file byte for byte) |
| Golden master, Payment change | The same, for Payment change and Variable rate payment change | `tests/ca/fixtures/golden_engine_pc_v1.json`, sha256 starts 9da9599f (122 groups, 3,536 cases); test `tests/ca/golden/engineGoldenPc.test.ts` | Delivered | QA | CHANGES §47 (B18); regenerated for B33 (CHANGES §72: 36 personal-loan groups added back) and for B37 (CHANGES §75: 12 of 122 groups, the fixed-rate mortgage weekly and bi-weekly ones; long cases unchanged; switch off replays the pre-B37 file byte for byte) |
| Page capture | A saved Chrome capture of the printout, the CSV and the figures for set scenarios. Unit tests still replay it. The capture script was deleted in SEC-CHROME (2026-10-28), so the fixture can no longer be regenerated and the live page is no longer compared with it. | `tests/ca/fixtures/a10_ui_capture_v1.json`, sha256 starts e22f0161 (last regenerated in B39, CHANGES §77) | Delivered (fixture); capture script Removed | QA | CHANGES §44; regenerated with the user's approval for the figure order and structure (CHANGES §70), for the Contract term value, label and hint (CHANGES §71), for B33 (CHANGES §72: one scenario added, a weekly personal loan; the six earlier scenarios unchanged), and for B34 (CHANGES §73: the term hint for each flow, the term value in five scenarios, and a new record of the Term based on choice; B35 did not change it, CHANGES §74), and for B37 (CHANGES §75: only the REF-01 and fees scenarios, number tokens only, for example Total interest $22,514.11 to $22,514.07; every label, including the frequency options, unchanged); changed only with the user's approval |
| Page server | The zero-dependency Node server that serves the page and the built engine. Local mode (127.0.0.1, port 5173) and hosted mode for Azure App Service (when `WEBSITE_HOSTNAME` is set: 0.0.0.0, port 8080 by default, host allow-list), fixed security headers, `/healthz`, `/version.json` (replaces `/package.json`), file-type allow-list | `ui/serve.mjs` | Delivered | sr-dev, QA | CHANGES §88, §90, §91; `tests/tooling/sec5-serve-azure.test.ts`, `sec5b-serve-hardening.test.ts`, `sec5c-serve-close.test.ts`, `a13-serve.test.ts`; checklist SEC-5, SEC-5b, SEC-5c (QA PASS WITH NOTES 2026-10-29) |
| Azure deployment note | For the Azure and security teams: modes, app settings, start-up errors, headers, what is published, logging, third-party content, items to confirm with the Azure team | `docs/DEPLOY-AZURE.md` | Delivered | architect (first version), doc-writer (updated for SEC-5/SEC-6 and SEC-5b) | `COB-architecture.md` §5 "SEC-5 and SEC-6 brief" (revision 62) and "SEC-5b brief" (revision 63); CHANGES §88, §90 |
| Self-hosted font and logo | Inter 4.1 (four weights, woff2) with its SIL Open Font License 1.1 text, and the Alterna logo as a file | `ui/assets/fonts/`, `ui/assets/fonts/LICENSE.txt`, `ui/assets/alterna-savings.svg` | Delivered | sr-dev, QA | CHANGES §87 (files and sha256 from the official Inter 4.1 release); `tests/ui/sec6-self-hosted.test.ts`, `tests/tooling/sec6-serve-content-types.test.ts`, `share/tests/sec6-share.test.mjs`; checklist SEC-6 (QA PASS WITH NOTES; user opened the page 2026-10-29, no console errors) |
| Chrome checks | Scripts that opened the real page in Chrome (not part of `npx vitest run`): page smoke, print width (F12), render cost (F18), semi-monthly move (F17), the page capture and the shared-page check | Deleted, with the global Playwright MCP package uninstalled (user decision 2026-10-28, SEC-CHROME) | Removed | QA | CHANGES §85; checklist SEC-CHROME (QA PASS); section 7 |
| Project records | Decisions, requirements, task list, architecture, change log | `COB-user-stories.md` (decisions §6–§7.5), `COB-business-requirement.md`, `COB-project-checklist.md`, `COB-architecture.md`, `COB-ts/CHANGES.md` (all in the project root except CHANGES) | Delivered | BA, architect, main session | Section 8 |
| Field-level error messages in business language | Messages that name the screen field and show all problems at once | Not built | Planned | n/a | Q-MSG open (section 6) |
| Automated page tests, parity matrix, accessibility pass, browser list | Quality items on the checklist | Not built | Planned | n/a | Checklist 3b, Phase 4 and Phase 5 are unticked. The hosting target is decided (Azure App Service, user decision of 2026-10-29, checklist §4a) and the server side is delivered (SEC-5); the Azure configuration itself is outside this project (`docs/DEPLOY-AZURE.md`, items "to confirm") |
| BRD v2.4 and compliance sign-off | Updated requirements document, owned by the stakeholders | Draft changes in `COB-brd-amendments-draft.md` | Planned | Stakeholders | Checklist Phase 1b is unticked |
| Cleanup of two unused engine fields | The fields for term years and months stay on the engine input, ignored | `src/ca/types.ts` | Parked | n/a | Called B24-CLEANUP; a breaking change for about 12 test files (F60) |

## 3. Evidence register

### 3.1 Capabilities and the BRD

| Capability | BRD source | Built in | Proved by | Status |
|---|---|---|---|---|
| Manual input; flows New, Renewal, Payment change (Variable rate payment change is built but hidden behind a switch) | §1.1, IN-01 | `src/ca/flows.ts`, `ui/ca-view.js` | `tests/ca/flows-a6.test.ts`, `vrpc-flow-hidden.test.ts`, `b22-use-case-labels.test.ts`; CHANGES §34, §51, §59, §60 | Covered |
| Rate selection: fixed mortgage converted from semi-annual compounding; variable mortgage and personal loans use the contract rate as typed at Monthly and Semi-monthly, and from B39 (DEC-B39-VAR-PL-M12, CHANGES §77) convert it as monthly-compounded at Weekly, Accelerated weekly, Bi-weekly and Accelerated bi-weekly, with the same leap-aware n. From B38 (CHANGES §76) the year count in n is Excel's YEARFRAC, and a fixed mortgage's row interest at those frequencies is rounded to the cent. For a fixed mortgage at Weekly, Accelerated weekly, Bi-weekly or Accelerated bi-weekly the conversion uses a leap-aware payments per year n = (days from the flow's start date to the End date ÷ 7 or 14) ÷ the same span in leap-aware years, instead of 52 / 26; Monthly (12) and Semi-monthly (24) unchanged; all four flows; behind a switch shipped on, both states tested | OUT-01, BR-01, BR-02, §4.2; DEC-B37-LEAP-N | `src/ca/equations.ts`, `calendar.ts`, `cobCanada.ts`, `policies.ts` | `rateSelection-oqc.test.ts` (Appendix A at the stated n, switch off, Q-B37-APPA), `b33-personal-loan-frequencies.test.ts` (432-case sweep), `b37-leap-aware-n.test.ts` (n vectors, the user's two cases, 4,800-input sweep for bounds and scope, QA oracle on every 7/14-day golden case, switch off replays both pre-B37 goldens), type test `b37-leap-n.typecheck.ts`; 26 of 26 mutants killed; CHANGES §12, §72, §75 | Covered – differs from Excel (DEV-B37-LEAPN) |
| Payment frequency: six values in the engine; the page offers Weekly, Bi-weekly, Semi-monthly, Monthly. Each option's per-year figure is computed from the engine's payments-per-year function on load and on every recalculation, shown as a whole number, so the options read "Weekly (52/yr)", "Bi-weekly (26/yr)", "Semi-monthly (24/yr)", "Monthly (12/yr)" as before (wording interim, Q-MSG) | IN-09, BR-09; DEC-B37-LEAP-N label format | `src/ca/`, `ui/ca-view.js`, `ui/ca.js` | `b8-accelerated-frequencies.test.ts`, `b28-accelerated-hidden.test.ts`, `b37-frequency-labels.test.ts`; the four option texts on the live page are **Not verified** since the Chrome smoke check was deleted (SEC-CHROME); CHANGES §37, §53, §75 | Covered |
| A personal loan accepts every payment frequency in New mortgage or loan, Renewal and Payment change, with no lock on the page (Variable rate payment change stays mortgage and variable). The earlier Monthly-only rule (FB-24, B27, CHANGES §54) is removed, with no switch. Matches Excel. | DEC-B33-FREQ (reverses FB-24); IN-03, IN-09 | `src/ca/products.ts`, `validate.ts`, `ui/ca.html`, `ui/ca-view.js` | `b33-personal-loan-frequencies.test.ts`, `b33-frequency-unlocked.test.ts`, `b27-personal-loan-monthly-only.test.ts` (rewritten in place for B33); capture scenario for a weekly personal loan; CHANGES §72 | Covered |
| Interest on actual days with the 365 / 366 split | BR-11, §4.4 | `src/ca/equations.ts` | `engineRules-t5.test.ts`, `calendar-a4.test.ts`; 2.3 million date pairs checked against the macro | Covered |
| Payment dates by frequency; a monthly date on a month-end stays on month-ends; a semi-monthly first date off the 15th / month-end is moved forward | App. B.4 | `src/ca/` | `monthlyDates-t3`, `monthlyMonthEnd-oqx`, `semiMonthlyDates-t4`, `b15-semimonthly-time-of-day`, `b25-semimonthly-move`, `b25-ui-note`; CHANGES §13–§15, §61, §62 | Covered – differs from Excel (DEV-OQX, DEV-OQZ) |
| Each payment pays interest, then fees, then principal; principal never goes below zero | BR-13, B.5 | `src/ca/cobCanada.ts` | `b11-waterfall-cap.test.ts`; CHANGES §29 | Covered |
| Unpaid interest never earns interest; it is paid first, oldest first | B.2 step 4 | `src/ca/cobCanada.ts` | `b19-unpaid-interest.test.ts`, `golden/b19-switch-on.test.ts`; CHANGES §48 | Covered – differs from Excel (DEV-OQL) |
| Last payment pays off the remaining principal | §6, B.2 step 8 | `src/ca/` | `lastPayment-oqk.test.ts`; CHANGES §11 | Covered |
| Non-financed fees are paid separately and count only in the cost of borrowing C | IN-07, BR-04 | `src/ca/fees.ts` | `defects012.test.ts` (DEV-OQS block), `spec011.test.ts` | Covered – differs from Excel (DEV-OQS) |
| Financed fees: kept and tested in the engine, but the Financed option is switched off on the page | IN-06, BR-03 | engine; page switch in `ui/ca-view.js` | `spec011.test.ts`, `b23-fees-switch.test.ts`; CHANGES §52 | Covered |
| Cost of borrowing amount C = interest + all fees | OUT-03, B.7 | `src/ca/cobCanada.ts` | `b10-includedincob-optional.test.ts`; CHANGES §38, §48 | Covered |
| Cost of borrowing rate (APR): C ÷ (T × P) × 100; with no fees the rate equals the calculated rate | OUT-02, §4.1 | `src/ca/cobCanada.ts` | Checklist 2e | Open decision (OQ-Q for P; FB-11 on hold) |
| Trigger rate for variable mortgages | OUT-09, BR-08 | `src/ca/cobCanada.ts` | Checklist 2e | Covered |
| Totals: number of payments, total payments, total interest, total principal | OUT-04…OUT-07 | `src/ca/cobCanada.ts` | Checklist 2e (invariant test item unticked) | Open decision (OQ-R for principal paid) |
| Full precision, no rounding in the calculation | §6 (OQ-H) | `src/ca/` | `tests/architecture/f4-no-rounding.test.ts` | Covered |
| Accrued interest for Renewal and Payment change: required, $0 allowed, paid first | IN-11, BR-05, BR-10 | `src/ca/flows.ts`, `validate.ts` | `b20-accrued-required.test.ts`, `b19-unpaid-interest.test.ts`; CHANGES §49 | Partly covered (no Excel reference; OQ-W3 and OQ-W5 open) |
| Contract term shown as a result, measured from the flow's start date (Disbursal date, Renewal date or Date of change); labelled "Remaining contract term" for Renewal and Payment change. Shown in whole years and months, rounded up (any leftover day counts as a full month), zero parts left out ("3 years", "2 years, 6 months", "0 months"). Two values: to the End date as typed and to the final scheduled payment. When they differ, a "Term based on" radio group offers "Start date to end date: …" (first, pre-selected) and "Start date to final payment: …"; recalculation never changes the pick (only a page load resets it); the field, the Contract terms tile and the printout show the picked value; the radios are not printed. Hint "From the {disbursal date / renewal date / date of change}; part months count as a full month." (interim, Q-MSG). CSV and both golden masters unchanged. | IN-10…IN-13 | `src/ca/calendar.ts`, `src/ca/cobCanada.ts` (display helper, not used by the calculation), `ui/ca-view.js`, `ui/ca.js`, `ui/ca.html` | `b24-term-rule.test.ts`, `b24-form-cleanup.test.ts`, `b32-term-start.test.ts`, `b32-term-labels.test.ts`, `b34-term-options.test.ts`, `b34-term-display.test.ts`, type test `b34-term-options.typecheck.ts`; QA oracle sweep 33,176 inputs, 0 mismatches; the live-page check of both picks and the zero term was the Chrome smoke script, deleted in SEC-CHROME, so that browser part is **Not verified**; capture scenario for a weekly personal loan records the choice; checklist B34; CHANGES §56, §71, §73 (DEC-B32-TERM, DEC-B34-TERM) | Covered – differs from Excel (DEV-OQP) |
| Input validation | §6 | `src/ca/validate.ts` | `validate.test.ts`, `b2-fee-limit`, `b13-zero-term-message`, `b14-payment-rate-positive`, `b3b-date-validation`, `numericGuard-b3a`; CHANGES §19–§33 | Partly covered (messages are interim; payment and rate above zero differ from Excel: DEV-OQY, DEV-OQAA) |
| Money format (227,199.00) in the amount inputs and the printout | UI display | `ui/ca-view.js` | `b16-money-format.test.ts`; CHANGES §45 | Covered |
| Payment amount is entered, not calculated; its hint reads "The scheduled payment." (the earlier second sentence, "It isn't calculated here.", was removed as unclear) | IN-08, §1.2 / §3 out of scope | `ui/ca.html` | `b35-payment-hint.test.ts` (3 checks); the Chrome smoke check of the hint on the live page was deleted (SEC-CHROME); checklist B35; CHANGES §74 | Covered (DEC-B35-HINT) |
| Unpaid interest at the End Date shown as its own figure when above $0 | OUT-04…OUT-07 | `ui/ca-view.js` | `b26-unpaid-interest-figure.test.ts`; CHANGES §55, §57 | Covered |
| Where the result figures appear. Printout: two columns read top to bottom. Left: Cost of borrowing rate (APR), Calculated rate, Number of payments, Term in days, Balance at end date, Unpaid interest at end date (when above $0); with the Financed option on (switched off today): Fees recovered through payments, then Disbursal amount (new loan only). Right: Total of all payments, Cost of borrowing amount (with its hint), Total principal paid, Total interest, Trigger rate (variable mortgage only, BR-08). Screen: the two headline cards are unchanged; the main list is the printout's right column, with Cost of borrowing amount shown without its hint; the collapsed "More figures" is the left column without the APR. Layout only: no figure, label, hint text, value or CSV change; both golden masters byte-identical. No DEV ID (no calculation differs from Excel). | OUT-02…OUT-09 (display) | `ui/ca-view.js`, `ui/ca.js`, `ui/ca.html` | `b31-figure-columns.test.ts`, pins `b31_pre_layout_pins.json`; capture fixture regenerated (approved); F12 16/16, smoke, F17, F18 passed at the time (those Chrome scripts were deleted in SEC-CHROME); QA PASS WITH NOTES; checklist B31; CHANGES §70 | Covered (DEC-B31-LAYOUT) |
| Amortization schedule on screen | OUT-08, B.6 | `ui/ca-view.js` | Checklist 3c unticked | Partly covered (columns differ from B.6, F12) |
| Print / save as PDF and CSV (schedule only) | §2, §7 | `ui/ca.html`, `ui/ca-view.js` | `b17-print-headings.test.ts`, `a11-print-on-demand.test.ts`; the F12 print-width Chrome script was deleted (SEC-CHROME); CHANGES §45, §46, §63 | Partly covered (OQ-J open) |
| No storage of member data | §1.2, §7 | whole page; `ui/serve.mjs` | Page: architecture review only (`COB-architecture.md` §1.8). Server side (SEC-5, CHANGES §88): only `GET` and `HEAD` are accepted (others get 405), it serves fixed files, sets no cookies and logs no requests; tested in `tests/tooling/sec5-serve-azure.test.ts` | Partly covered (the page part is Not verified by QA; checklist "No PII" item unticked) |
| Same results as the workbook (Appendix A, REF-01, golden masters) | §2, §7, App. A | `tests/ca/` | `ref01-workbook.test.ts`, `fixtureParity.test.ts` (both run with the B37 switch off, Q-B37-REF01), `golden/`; `b37-leap-aware-n.test.ts` pins the shipped REF-01 as `known_divergence` DEV-B37-LEAPN; CHANGES §47, §75 | Partly covered (the parity matrix is not built; fixed-rate weekly and bi-weekly cases differ by decision, DEV-B37-LEAPN) |

### 3.1a BRD inputs, outputs and business rules

One row per BRD v2.3 item. "Covered" here means built and QA-verified; the evidence is the capability row above or the story named.

| BRD item | What it is | Built in | Proved by | Status |
|---|---|---|---|---|
| IN-01 | Use case | `src/ca/flows.ts` | US-01 tests | Covered |
| IN-02 | Mortgage / loan amount | `ui/ca.html`, `src/ca/validate.ts` | `validate.test.ts`, `b16-money-format.test.ts` | Covered |
| IN-03 | Product type | `ui/ca.html`, `src/ca/products.ts` | `b33-personal-loan-frequencies.test.ts`, `b27-personal-loan-monthly-only.test.ts` (rewritten for B33), `b21-renewal-mortgage-only.test.ts` (rewritten for the 2026-10-01 reversal) | Covered |
| IN-04 | Rate type | `ui/ca.html`, `src/ca/flows.ts` | `flows-a6.test.ts` | Covered |
| IN-05 | Contract rate | `ui/ca.html`, `src/ca/validate.ts` | `b14-payment-rate-positive.test.ts` | Covered – differs from Excel (DEV-OQAA) |
| IN-06 | Financed fees | `src/ca/fees.ts` (not offered on the page) | `spec011.test.ts`, `b23-fees-switch.test.ts` | Covered |
| IN-07 | Non-financed fees | `src/ca/fees.ts` | `defects012.test.ts` | Covered – differs from Excel (DEV-OQS) |
| IN-08 | Payment amount | `ui/ca.html`, `src/ca/validate.ts` | `b14-payment-rate-positive.test.ts`, `b35-payment-hint.test.ts` (hint) | Covered – differs from Excel (DEV-OQY) |
| IN-09 | Payment frequency | `src/ca/`, `ui/ca-view.js` | `b8-accelerated-frequencies.test.ts`, `b28-accelerated-hidden.test.ts`, `b33-frequency-unlocked.test.ts`, `b37-frequency-labels.test.ts` (labels from the engine, whole numbers) | Covered |
| IN-10 | Start date (labels IN-10a to IN-10d) | `src/ca/flows.ts`, `ui/ca-view.js` | `b22-use-case-labels.test.ts`, `b24-term-rule.test.ts`, `b34-term-options.test.ts` (term from the start date) | Covered – differs from Excel (DEV-OQP) |
| IN-11 | Accrued interest | `src/ca/flows.ts`, `cobCanada.ts` | `b20-accrued-required.test.ts`, `b19-unpaid-interest.test.ts` | Partly covered (OQ-W2 parked; OQ-W3, OQ-W5 open) |
| IN-12 | First payment date | `src/ca/` | `semiMonthlyDates-t4`, `b25-semimonthly-move` | Covered – differs from Excel (DEV-OQZ) |
| IN-13 | End date | `src/ca/validate.ts` | `b3b-date-validation.test.ts`; the term to the End date (B34): `b34-term-options.test.ts` | Covered |
| OUT-01 | Semi-annual compounding rate | `src/ca/equations.ts` | `rateSelection-oqc.test.ts`, Appendix A fixture (formula at the stated n, Q-B37-APPA), `b37-leap-aware-n.test.ts` | Covered – differs from Excel (DEV-B37-LEAPN and DEV-B38-ROUND, fixed mortgage at 7- and 14-day frequencies; DEV-B39-M12, variable mortgage and personal loan at 7- and 14-day frequencies) |
| OUT-02 | Cost of borrowing rate (APR) | `src/ca/cobCanada.ts` | Checklist 2e | Open decision (OQ-Q) |
| OUT-03 | Cost of borrowing amount | `src/ca/cobCanada.ts` | `b19-unpaid-interest.test.ts` | Covered |
| OUT-04 | Total number of payments | `src/ca/cobCanada.ts` | `lastPayment-oqk.test.ts` | Covered |
| OUT-05 | Total of all payments | `src/ca/cobCanada.ts` | `lastPayment-oqk.test.ts` | Covered |
| OUT-06 | Total interest paid | `src/ca/cobCanada.ts` | CHANGES §51 (equals the interest charged) | Covered |
| OUT-07 | Total principal paid | `src/ca/cobCanada.ts` | Checklist 2e invariant item unticked | Open decision (OQ-R) |
| OUT-08 | Amortization schedule | `ui/ca-view.js` | Checklist 3c unticked | Partly covered (F12) |
| OUT-09 | Trigger rate | `src/ca/cobCanada.ts` | Checklist 2e | Covered |
| BR-01 | Fixed mortgages use semi-annual compounding | `src/ca/equations.ts` | `rateSelection-oqc.test.ts`, `b37-leap-aware-n.test.ts` | Covered – differs from Excel (DEV-B37-LEAPN: n for weekly and bi-weekly is leap-aware, not 52 / 26) |
| BR-02 | Other products use the contract rate as typed | `src/ca/equations.ts` | `rateSelection-oqc.test.ts`, `b33-personal-loan-frequencies.test.ts` (personal loans at every frequency), `b39-monthly-conversion.test.ts` | Covered – differs from Excel at 7- and 14-day frequencies (DEV-B39-M12: converted as monthly-compounded) |
| BR-03 | Financed fees are part of the loan amount | `src/ca/fees.ts` | `spec011.test.ts` | Covered |
| BR-04 | Non-financed fees are outside principal and count in C | `src/ca/fees.ts` | `defects012.test.ts` | Covered – differs from Excel (DEV-OQS) |
| BR-05 | Accrued interest is mandatory for Renewal and Payment change; $0 accepted | `src/ca/validate.ts` | `b20-accrued-required.test.ts` | Covered |
| BR-06 | Accrued interest is not shown for a new loan | `src/ca/flows.ts` | `flows-a6.test.ts` | Covered |
| BR-07 | The start date label follows the use case | `ui/ca-view.js` | `b22-use-case-labels.test.ts` | Covered |
| BR-08 | Trigger rate for variable mortgages only | `src/ca/cobCanada.ts` | Checklist 2e | Covered |
| BR-09 | Accelerated frequencies behave like their regular twins | `src/ca/` | `b8-accelerated-frequencies.test.ts`; `b37-leap-aware-n.test.ts` INV-ACCEL (the twins stay identical with the leap-aware n). BR-09's "(n = 52)" / "(n = 26)" no longer holds for the conversion of a fixed mortgage (DEC-B37-LEAP-N) | Covered |
| BR-10 | Accrued interest is paid from the first payment, the excess carries forward (unchanged: the spreading rule DEC-B36-ACCR-SPREAD was withdrawn on 2026-10-09 and never built) | `src/ca/cobCanada.ts` | `b19-unpaid-interest.test.ts` | Partly covered (no Excel reference) |
| BR-11 | Interest on actual days, 365 / 366 split | `src/ca/equations.ts` | `engineRules-t5.test.ts` | Covered |
| BR-12 | For a payment change the first payment date is the Next payment date | `src/ca/flows.ts` | `b22-use-case-labels.test.ts` | Covered |
| BR-13 | Each payment pays interest, then fees, then principal | `src/ca/cobCanada.ts` | `b11-waterfall-cap.test.ts` | Covered |

### 3.2 User stories

Statuses are those of `COB-user-stories.md` §4 and the traceability matrix, as verified against CHANGES.md and the checklist.

| Story | Title | Built in | Proved by | Status |
|---|---|---|---|---|
| US-01 | Select use case | `src/ca/flows.ts`, `ui/ca-view.js` (`flowLabels`) | `flows-a6`, `b22-use-case-labels`, `vrpc-flow-hidden`; capture fixture `flowScreens`; CHANGES §51, §59, §60 | Covered |
| US-02 | Enter core loan terms | `ui/ca.html`, `src/ca/products.ts` | `b8-accelerated-frequencies`, `b28-accelerated-hidden`, `b33-personal-loan-frequencies`, `b33-frequency-unlocked`, `b16-money-format`, `b35-payment-hint` (Payment amount hint); CHANGES §72, §74 | Covered |
| US-03 | Enter financed and non-financed fees | `src/ca/fees.ts`, `ui/ca.js` | `spec011`, `defects012` (DEV-OQS), `b23-fees-switch`, `b10-includedincob-optional`; CHANGES §52 | Covered – differs from Excel (DEV-OQS) |
| US-04 | Enter term dates | `src/ca/`, `ui/ca-view.js` | `b3b-date-validation`, `b24-term-rule`, `b24-form-cleanup`, `b25-semimonthly-move`, `b25-ui-note`, `b32-term-start`, `b32-term-labels`, `b34-term-options`, `b34-term-display`; CHANGES §56, §61, §62, §71, §73 | Covered – differs from Excel (DEV-OQP, DEV-OQZ) |
| US-05 | Enter accrued interest | `src/ca/flows.ts`, `validate.ts` | `b20-accrued-required`; CHANGES §49 | Covered |
| US-06 | Be told about invalid inputs | `src/ca/validate.ts` | `validate.test.ts`, `b2-fee-limit`, `b14-payment-rate-positive`, `b16-money-format`, `a9-input-issues`; CHANGES §32, §41, §45 | Partly covered (messages are technical, one at a time; Q-MSG open) |
| US-07 | Switch use case without re-typing | `ui/ca.js` | Code reading only; checklist 3a and 3b unticked | Partly covered (Not verified) |
| US-08 | Apply the correct compounding convention | `src/ca/equations.ts`, `calendar.ts`, `cobCanada.ts`, `policies.ts` | `rateSelection-oqc`, `b8-accelerated-frequencies`, `b33-personal-loan-frequencies`, `b37-leap-aware-n` (the US-08 criteria: the user's case 1, total interest 60,137.62 and total principal 43,861.66, and example 2, 74,326.11 and 48,523.89; Monthly, Semi-monthly, variable and personal loan unchanged; no-fee COB rate equals the new calculated rate), `b37-frequency-labels`; Appendix A fixture; checklist B37; CHANGES §72, §75 | Covered – differs from Excel (DEV-B37-LEAPN) |
| US-09 | Compute interest on actual days | `src/ca/equations.ts` | `engineRules-t5`, `calendar-a4` | Covered |
| US-10 | Apply accrued interest to early payments | `src/ca/cobCanada.ts` | `b19-unpaid-interest`; CHANGES §48 | Partly covered (OQ-W2 parked; OQ-W3, OQ-W5 open; no Excel reference) |
| US-11 | Allocate each payment interest, then fees, then principal | `src/ca/cobCanada.ts` | `b11-waterfall-cap`, `b19-unpaid-interest`; CHANGES §29, §48 | Covered – differs from Excel (DEV-OQL) |
| US-12 | See the COB rate and amount | `src/ca/cobCanada.ts`, `src/ca/policies.ts` | Checklist 2e; `defects012` D-04 (marked as a known failure) | Open decision (OQ-Q) |
| US-13 | See payment totals | `src/ca/cobCanada.ts`, `ui/ca-view.js` | `b26-unpaid-interest-figure`; checklist 2e invariant item unticked | Open decision (OQ-R) |
| US-14 | See the trigger rate for variable mortgages | `src/ca/cobCanada.ts` | Checklist 2e | Covered |
| US-15 | View the per-payment schedule | `ui/ca-view.js` | `lastPayment-oqk`; checklist 3c unticked | Partly covered (columns differ from B.6) |
| US-16 | Generate payment dates by frequency | `src/ca/` | `monthlyDates-t3`, `semiMonthlyDates-t4`, `b25-semimonthly-move`; macro oracle 986,400 dates, 0 mismatches | Covered – differs from Excel (DEV-OQX, DEV-OQZ) |
| US-17 | Export / print a calculation | `ui/ca.html`, `ui/ca-view.js` | `b17-print-headings`, `a11-print-on-demand`, `b16-money-format`, `b31-figure-columns` (figure columns, CHANGES §70), `b34-term-display` (the printout shows the picked term; the radios are not printed, CHANGES §73); the print-width Chrome script was deleted (SEC-CHROME), so printed width is **Not verified** | Partly covered (OQ-J open) |
| US-18 | No personal information stored | whole page | Architecture review only | Partly covered (Not verified) |
| US-19 | Parity regression suite | `tests/ca/golden/`, `ref01-workbook.test.ts` | Both golden masters; REF-01 and Appendix A run with the B37 switch off (Q-B37-REF01, Q-B37-APPA); CHANGES §75 | Partly covered (the parity matrix is not built; fixed-rate weekly and bi-weekly cases differ by decision, DEV-B37-LEAPN) |

### 3.3 Use cases

| Use case | Title | Built in | Proved by | Status |
|---|---|---|---|---|
| UC-01 | Calculate COB for a new mortgage / loan | `src/ca/`, `ui/` | `ref01-workbook`, `golden/`, `b37-leap-aware-n`; CHANGES §32, §75 | Covered – differs from Excel (DEV-OQS, DEV-OQX, DEV-OQY, DEV-OQAA, DEV-OQL, DEV-OQZ, DEV-B37-LEAPN) |
| UC-02 | Calculate COB for a renewal | `src/ca/flows.ts` | `b19`, `b20`, `b33-personal-loan-frequencies` (personal loans at every frequency in Renewal); CHANGES §48, §49, §59, §72 | Partly covered (no Excel reference; OQ-W2 parked; OQ-W3, OQ-W5 open; page walk-through not automated) |
| UC-03 | Calculate COB after a payment change | `src/ca/flows.ts`, `ui/ca-view.js` | `golden/engineGoldenPc`, `b22-use-case-labels`, `b33-personal-loan-frequencies`, `b37-leap-aware-n` (the user's two bi-weekly Payment change cases, to the cent and within 1 cent of the user's Excel); CHANGES §47, §51, §59, §72, §75 | Partly covered (same reasons as UC-02; the user's two worked cases are bi-weekly fixed-rate only) |
| UC-04 | Calculate COB after a variable rate payment change | `src/ca/flows.ts` | `golden/engineGoldenPc`, `vrpc-flow-hidden`; CHANGES §60 | Partly covered (same reasons; the option is hidden in the Flow list) |
| UC-05 | Validate inputs | `src/ca/validate.ts` | See US-06 | Partly covered (Q-MSG open) |
| UC-06 | Generate schedule and outputs | `src/ca/cobCanada.ts` | See US-08 to US-16; CHANGES §11–§16, §29, §48, §75 | Covered – differs from Excel (DEV-OQS, DEV-OQX, DEV-OQL, DEV-OQZ, DEV-B37-LEAPN) |
| UC-07 | Switch use case | `ui/ca.js` | Code reading only | Partly covered (Not verified) |
| UC-08 | Export / print a calculation | `ui/ca-view.js`, `ui/ca.html` | See US-17 (includes the two-column printed figures, CHANGES §70, and the picked contract term, CHANGES §73) | Partly covered (OQ-J open) |
| UC-09 | Verify parity against Excel v7 | `tests/ca/golden/` | See US-19; CHANGES §47 | Partly covered |

### 3.4 What the calculator does not cover

| Item | Status | Source |
|---|---|---|
| Calculating the payment amount, including accelerated-payment logic | Not covered – out of scope | BRD §1.2, BR-09 |
| Any integration with Wealthview or other systems | Not covered – out of scope | BRD §1.2 |
| Storing member personal information | Not covered – out of scope | BRD §1.2, §7 |
| The "One Time" frequency | Not covered – out of scope | OQ-G |
| The skip-date rule (fifth weekday) | Not covered – out of scope | OQ-I, OQ-U |
| The term (years, months) driving the schedule when End Date is blank | Not covered – out of scope | Decision 8; the term is now derived (DEV-OQP) |
| The single-file edition as a BRD feature | Not covered – out of scope | Not a BRD requirement; delivered as an add-on (section 2) |
| A Help page inside the calculator | Not covered – out of scope | Not a BRD requirement; the B29 Help add-on was removed on 2026-10-28 (SEC-HELP, CHANGES §80) |
| A separate contract-rate cell for the semi-annual converter | Open decision | OQ-N; the page has one Contract rate (%) input |
| "Prepared by / Verified by / Portfolio # / Date" lines on the printout | Open decision | OQ-J |
| Field-level error messages, all problems shown at once next to their fields | Not covered – planned | BRD §6, US-06; the engine can list all problems (A9, CHANGES §41), the page does not use it |
| Parity matrix, automated page tests, accessibility pass, browser list | Not covered – planned | Checklist 3b, Phase 4, Phase 5 |
| Azure App Service configuration (HTTPS only, TLS version, access restrictions or private endpoint, health check path, logs) | Not covered – out of scope | Azure configuration, not code (user decision of 2026-10-29, checklist §4a); described in `docs/DEPLOY-AZURE.md` with the items still to confirm |
| BRD v2.4 and compliance sign-off | Not covered – planned | Checklist Phase 1b |

### 3.5 Security and hosting (SEC-5, SEC-5b, SEC-5c, SEC-6, SEC-NODE26)

Not BRD requirements: these come from the security review follow-ups (checklist §4a) and the user's Azure decisions of 2026-10-29 (DEC-SEC-AZURE: Azure App Service, Linux, Node 22, `node ui/serve.mjs`, internal network only; DEC-SEC6-SELFHOST: self-host the font and logo so the content security policy can allow the app's own origin only). Recorded in the checklist §4a and `COB-architecture.md` §5 "SEC-5 and SEC-6 brief" (revision 62) , "SEC-5b brief" (revision 63; review `reviews/security-review-2026-10-29.md` M1, L1–L4) and "SEC-5c brief" (revision 64; user decision 2026-10-29 to fix F-1 and F-2 before the handover and accept F-3 as N-SEC5C-1) and "SEC-NODE26 brief" (revision 65; user decision 2026-10-29 to move to Node 26 LTS, and Q-NODE26-1 on the production runtime); not in `COB-user-stories.md` (finding D31). All five tasks: QA PASS WITH NOTES, 2026-10-29 (checklist SEC-5, SEC-5b, SEC-5c, SEC-6, SEC-NODE26). No calculation, golden master or page capture changed (CHANGES §87, §88, §90, §91, §92).

| Item | Source | Built in | Proved by | Status |
|---|---|---|---|---|
| The page loads nothing from other sites: Inter 4.1 (four weights) and the logo are served from `ui/assets/`; the font licence (SIL OFL 1.1) is shipped and served as `ui/assets/fonts/LICENSE.txt`; the page has no inline style (CSS moved to `ui/ca.css`). The logo is still a link to alterna.ca when clicked; that is a click, not a request at page load. | DEC-SEC6-SELFHOST; SEC-6 | `ui/ca.html`, `ui/ca.css`, `ui/assets/` | `tests/ui/sec6-self-hosted.test.ts`, `tests/tooling/sec6-serve-content-types.test.ts`; CHANGES §87; user opened the page 2026-10-29 with no console errors (checklist SEC-6) | Covered |
| The single-file edition still inlines the styles (without the font block, so it uses system fonts) and still embeds its own logo | SEC-6 | `share/lib/html.mjs`, `share/build-share.mjs` | `share/tests/sec6-share.test.mjs` (rebuilt page differs only by the fee-header rule and the build date); CHANGES §87 | Covered |
| Local mode: listens on 127.0.0.1 only, port 5173 by default, accepts only the localhost Host names; unchanged start-up line | DEC-SEC-AZURE; SEC-5 (R5-1) | `ui/serve.mjs` | `tests/tooling/sec5-serve-azure.test.ts` (T5-MODE-L), `a13-serve.test.ts`; CHANGES §88 | Covered |
| Hosted mode when `WEBSITE_HOSTNAME` is set: listens on 0.0.0.0, port from `PORT` (8080 by default); accepts only `WEBSITE_HOSTNAME` plus `COB_ALLOWED_HOSTS` (trimmed, lower-cased, no wildcards); other Host headers get 403 | DEC-SEC-AZURE; SEC-5 (R5-1) | `ui/serve.mjs` | `sec5-serve-azure.test.ts` (T5-MODE-H); CHANGES §88 | Covered |
| Fail-fast configuration: a bad `PORT`, `COB_ALLOWED_HOSTS` in local mode, an invalid host name, or a port that can't be opened stops the server at start-up with one `serve.mjs:` line and exit code 1 | SEC-5 (R5-1, R5-2) | `ui/serve.mjs` | `sec5-serve-azure.test.ts` (T5-PORT, T5-HOSTCFG); CHANGES §88 | Covered |
| Fixed security headers on every response the server writes: content security policy allowing only the app's own origin (`default-src 'none'`, `frame-ancestors 'none'`), nosniff, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, Permissions-Policy, COOP, CORP, `Cache-Control: no-store`; HSTS in hosted mode only | SEC-5 (R5-4) | `ui/serve.mjs` | `sec5-serve-azure.test.ts` (T5-HEADERS, T5-CSP; fitness check F22); CHANGES §88 | Covered |
| Requests Node cannot parse get Node's status (400, or 431 headers too large, 413, 408 too slow) with the same security headers, a fixed plain-text body and `Connection: close`; a reset connection, or one that has already sent a reply, is closed without writing anything. Since SEC-5c the connection closes as soon as the reply is flushed (row below) | SEC-5b (R5b-1; review M1) | `ui/serve.mjs` (`clientError` handler) | `tests/tooling/sec5b-serve-hardening.test.ts` (T5b-CLIENTERR, T5b-PIPELINE, T5b-RESET, T5b-CLIENTERR-SRC); CHANGES §90 (raw-socket probes) | Covered |
| A request with no Host header (HTTP/1.1) or more than one Host header gets 400 with the security headers and `Connection: close`, before any other check, `/healthz` included; HTTP/1.0 with no Host and a single empty Host behave as before. Accepted RFC deviation N-SEC5B-1: a single Host with an invalid value gets 403, not 400 | SEC-5b (R5b-2; review L1, M1) | `ui/serve.mjs` (step 0) | `sec5b-serve-hardening.test.ts` (T5b-HOST); CHANGES §90 | Covered |
| `/healthz` answers 200 `ok` whatever the Host header, for the App Service health check; the query is ignored (`/healthz?x` is 200); `/healthz/` and `/%68ealthz` are not the route (404, or 403 with a Host that is not allowed) | SEC-5 (R5-3); SEC-5b (R5b-3) | `ui/serve.mjs` | `sec5-serve-azure.test.ts` (T5-HEALTH), `sec5b-serve-hardening.test.ts` (T5b-PATH); CHANGES §90 | Covered |
| `/version.json` (`{"version":"…"}`, read once at start-up) replaces `/package.json`, which is no longer published (it listed the development packages). The printout still shows "· Engine 0.1.0". | SEC-5 (R5-3, R5-5) | `ui/serve.mjs`, `ui/ca.js` | `sec5-serve-azure.test.ts` (T5-VERSION, R5-5); CHANGES §88. The printout line in a browser under the new headers is **Not verified** | Covered |
| Only `GET` and `HEAD` (others 405); only files under `ui/` and `dist/` with `.html`, `.js`, `.css`, `.svg`, `.woff2` or `.txt`; symbolic links leading out are not followed; everything else 404 | SEC-5 (R5-3) | `ui/serve.mjs` | `sec5-serve-azure.test.ts` (T5-EXT), `a13-serve.test.ts`; CHANGES §88 | Covered |
| Routing on the raw path: a path with `//`, a trailing `/` (other than `/`) or an encoded `/` or `\` (`%2f`, `%5c`) gets 404, so `/ui/ca.html/` and `//evil.com/ui/ca.js` are no longer served; a target that does not start with `/` gets 400 (accepted RFC deviation N-SEC5B-2: the absolute form is refused); file paths are still decoded (`/ui/ca%2Ejs` is served) | SEC-5b (R5b-3; review L2) | `ui/serve.mjs` (steps 1a, 4a) | `sec5b-serve-hardening.test.ts` (T5b-PATH); CHANGES §90 | Covered |
| Connection timeouts for Azure: keep-alive 120 s, headers 125 s, request 125 s (Node's 5 s keep-alive default could give 502s behind a proxy). The Azure front end's idle timeout is still to confirm with the Azure team | SEC-5b (R5b-4; review L3) | `ui/serve.mjs` | `sec5b-serve-hardening.test.ts` (T5b-TIMEOUTS: options in the source, and a connection idle for 6 s still answers); CHANGES §90 | Covered |
| `package.json` declares `engines` `node >=22` (also in `package-lock.json`); npm only warned on a mismatch. No crash handler is installed. Since SEC-NODE26 the floor is `>=26.13.0` and npm enforces it (row below) | SEC-5b (R5b-5; review L4) | `package.json`, `package-lock.json` | `sec5b-serve-hardening.test.ts` (T5b-ENGINES, re-pinned to the new floor in SEC-NODE26); CHANGES §90, §92 | Covered |
| Toolchain on Node 26 LTS (26.13.0, end of life 2029-04-30): `engines` `>=26.13.0`; new `.npmrc` `engine-strict=true`, so `npm ci` on an older Node stops with `EBADENGINE` (checked on Node 22.23.4); new `.nvmrc` `26.13.0`; `@types/node` `~26.6.6`; `allowScripts` denies the `fsevents` install script; lockfile changed in exactly 9 lines; `npm audit` 0. `engines` and `engine-strict` act only when npm installs (CI, development); App Service never runs npm (`SCM_DO_BUILD_DURING_DEPLOYMENT=false`), so the server still starts on Node 22. Production runtime per Q-NODE26-1 (user, 2026-10-29): `NODE|22-lts` at least 22.23.4 until `NODE|26` (preview since 2026-09-11) is generally available on App Service, switching before about 2027-04-30 (Node 22 end of life); the four server test files pass 416/416 on 22.23.4. No `src/`, `ui/`, `dist/`, golden or capture change | SEC-NODE26 brief R-N26-1 to R-N26-9 (revision 65); user decision 2026-10-29; Q-NODE26-1 | `package.json`, `package-lock.json`, `.npmrc`, `.nvmrc`, `README.md`; runtime in `docs/DEPLOY-AZURE.md` | `tests/tooling/node26-toolchain.test.ts`, `tests/architecture/f8-tests-typechecked.test.ts`, `tests/tooling/sec5b-serve-hardening.test.ts`, `share/tests/b30-build.test.mjs` and `share/tests/fixtures/pre-b30-pins.json`; CHANGES §92 and its verify addendum (mutations M1 to M7, alone copy, Node 22.23.4 server run); checklist SEC-NODE26 | Covered |
| Deployment note for the Azure and security teams | DEC-SEC-AZURE | `docs/DEPLOY-AZURE.md` | This update, checked line by line against `ui/serve.mjs` | Covered |
| SEC-5c follow-ups from the SEC-5b QA check. F-1 fixed: the 400/408/413/431 error replies close the connection as soon as the reply is flushed, even if the client keeps its side open (was about 150 s half-open), and a later parse error on the same connection no longer cuts the reply. F-2 fixed: new step 0b, after the Host count and before the 405: an HTTP/1.1 `Expect` value other than `100-continue` gets `417 Expectation failed` with the security headers and `Connection: close` (no body for HEAD); HTTP/1.0 unaffected; `Expect: 100-continue` gets its final reply at once with no interim `100 Continue`, then the connection closes. F-3 accepted as N-SEC5C-1 (section 8). Limit R5c-1: measured on macOS loopback only (section 8) | Checklist SEC-5c; SEC-5c brief R5c-1 to R5c-3 (revision 64); user decision 2026-10-29 | `ui/serve.mjs` (`onClientError`, `checkExpectation`, `checkContinue`, step 0b) | `tests/tooling/sec5c-serve-close.test.ts` (T5c-HALFOPEN, T5c-NOTRUNC, T5c-EXPECT, T5c-CONTINUE, T5c-SRC, T5c-TEXT); CHANGES §91 and its verify addendum (raw-socket probes, both modes, Node 22.23.4) | Covered |

## 4. Differences from Excel

All decided by the user. The register of record is `COB-architecture.md` §2.1. Each row in 4.1 and 4.2 has been delivered and QA-verified.

### 4.1 Differences with a decision ID

| ID | What the calculator does | What Excel does | Decided | Evidence |
|---|---|---|---|---|
| DEV-OQS | Non-financed fees are paid separately: never in principal, never charged interest, counted only in C. | Takes them out of principal and recovers them in the waterfall. | OQ-S, 2026-09-27 | CHANGES §1, §26; `defects012.test.ts` |
| DEV-OQX | A monthly First Payment Date on a month-end keeps every payment on a month-end (Apr 30, then May 31). | Keeps the day number (Apr 30, then May 30). | OQ-X, 2026-09-27 | CHANGES §14; `monthlyMonthEnd-oqx.test.ts` |
| DEV-OQY | A payment amount of $0 or less is rejected. | Accepts any number, including 0. | OQ-Y revised, 2026-09-28 | CHANGES §32; `b14-payment-rate-positive.test.ts` |
| DEV-OQAA | A contract rate of 0% or less, or a blank rate, is rejected. | Accepts any number, so 0% runs. | OQ-AA revised, 2026-09-28 | CHANGES §32; `b14-payment-rate-positive.test.ts` |
| DEV-OQL | Unpaid interest never earns interest. It sits outside the balance, is paid first (oldest first), and period interest counts in C as charged. The workbook rule is kept behind a switch that ships off. | Adds unpaid interest to the balance, where it earns interest. | Stakeholder decision 1, 2026-09-29 | CHANGES §48; `b19-unpaid-interest.test.ts` |
| DEV-OQP | The contract term is a read-only result measured from the flow's start date (Disbursal date, Renewal date or Date of change), in whole years and months, rounded up (any leftover day is a full month), no days. Two values: to the End date as typed and to the last scheduled payment date; when they differ the user picks one under "Term based on" (End date option first and pre-selected; the pick is never reset by recalculation). REF-01 reads "3 years" (no choice). Labelled "Remaining contract term" for Renewal and Payment change, "Contract term" otherwise. A moved semi-monthly first date does not change it. The End Date always drives the schedule. Not in the CSV. | The term is an input. | Decision 8, 2026-09-29, refined 2026-09-30; start point, label and hint changed by DEC-B32-TERM, 2026-10-05; display (years and months, the End date option and the choice) changed by DEC-B34-TERM, 2026-10-06 | CHANGES §56, §71, §73; `b24-term-rule.test.ts`, `b32-term-start.test.ts`, `b32-term-labels.test.ts`, `b34-term-options.test.ts`, `b34-term-display.test.ts` |
| DEV-B37-LEAPN | A fixed-rate mortgage at Weekly, Accelerated weekly, Bi-weekly or Accelerated bi-weekly converts the contract rate with a leap-aware payments per year: n = (days from the flow's start date to the End date ÷ 7 or 14) ÷ the same span in years counting 366-day leap years, at full precision. The Calculated rate is slightly lower; interest, C, the COB rate and the no-fee COB rate follow. Monthly, Semi-monthly, variable mortgages and personal loans unchanged. All four flows. The trigger rate keeps 52 / 26 (variable mortgages only, never converted). The workbook rule is kept behind a switch that ships on (off = the workbook, byte for byte). Example: REF-01 total interest 22,514.07 (workbook 22,514.11); the user's bi-weekly case 1 60,137.62 / 43,861.66 (the user's Excel 60,137.63 / 43,861.65, the 1-cent difference accepted) and example 2 74,326.11 / 48,523.89 (to the cent). | Uses n = 52 / 26 in the Semi-Annual Rate Converter. | DEC-B37-LEAP-N, 2026-10-09; answers Q-B37-REF01, Q-B37-APPA, Q-B37-HINT, Q-B37-LABEL and the label format | CHANGES §75; checklist B37; `b37-leap-aware-n.test.ts`, `b37-frequency-labels.test.ts`, `b37-capture.test.ts` |
| DEV-B38-ROUND | A fixed-rate mortgage at Weekly, Accelerated weekly, Bi-weekly or Accelerated bi-weekly: Y in B37's n is Excel's YEARFRAC (basis 1), and each row's period interest is rounded to the cent before the waterfall. Other cases keep full precision. Behind a switch that ships on (off = B37 exactly). Example: the user's bi-weekly case 1 now gives 60,137.63 / 43,861.65 and example 2 74,326.11 / 48,523.89, both matching the user's Excel to the cent; REF-01 total interest 22,514.06 (workbook 22,514.11). | Uses n = 52 / 26 and never rounds period interest. | DEC-B38-YEARFRAC-ROUND, 2026-10-10 | CHANGES §76; spec 013; `b37-leap-aware-n.test.ts` |
| DEV-B39-M12 (suggested ID) | A variable-rate mortgage or a personal loan (either rate type) at Weekly, Accelerated weekly, Bi-weekly or Accelerated bi-weekly converts the contract rate as monthly-compounded: n × ((1 + r ÷ 12) ^ (12 ÷ n) − 1), with B37's leap-aware n and B38's YEARFRAC year count. Row interest stays at full precision (no per-row rounding). Monthly, Semi-monthly, fixed mortgages and the trigger rate unchanged. Behind a switch that ships on and works only while the B37 switch is on (off = B38 exactly). Example: the user's variable bi-weekly example (3.80%) gives a Calculated rate of 3.79676% and 57,808.56 / 53,537.79, matching the user's Excel to the cent (was 57,862.71); the variable weekly example gives 12,463.92 against the user's Excel 12,463.91 (known 1-cent gap). | Uses the contract rate as entered for variable mortgages and personal loans at every frequency. | DEC-B39-VAR-PL-M12, 2026-10-13 | CHANGES §77; spec 014; `b39-monthly-conversion.test.ts`; Excel examples registry `COB-py/tests/fixtures/ca_user_excel_examples.json` |
| DEV-OQZ | A semi-monthly first payment date that is not the 15th or a month-end moves forward to the next one. Staff see a note; the printout keeps the typed date and adds a Moved first date row. | Keeps the typed pattern (10th, then 10th and 25th). | Decision 10, 2026-09-29; display answered 2026-10-01 | CHANGES §61, §62; `b25-semimonthly-move.test.ts` |

**Retired difference.** DEV-FB24 (a personal loan could only be paid monthly, decided as FB-24 on 2026-09-30 and delivered by B27, CHANGES §54) was removed by the user's decision DEC-B33-FREQ on 2026-10-05, with no switch. A personal loan now accepts every payment frequency and uses the contract rate as entered, as the workbook does, so there is no difference left on this point. Evidence: CHANGES §72; `b33-personal-loan-frequencies.test.ts` (including workbook vectors run as personal loans); `b33-frequency-unlocked.test.ts`.

### 4.2 Other changes from Excel (no DEV ID, each tied to a decision)

| Change | Decided | Evidence |
|---|---|---|
| Use-case selector and labels (Disbursal date, Renewal date, Date of change, Next payment date). The workbook has none. Renewal accepts a mortgage or a personal loan. | Decisions 2, 4, 5, 9 (2026-09-29); Renewal change 2026-10-01 | CHANGES §49–§51, §59 |
| The Financed option is switched off on the page. Every fee is sent as non-financed, so a fee staff used to enter as financed is now a cash fee and the rate can change (REF-01 loan with one 500 fee: 3.7854% to 3.8266%). | Decision 7, 2026-09-29; Q-B23-FIX | CHANGES §52 |
| The Accelerated Weekly and Accelerated Bi-weekly options are hidden. Results are the same as Weekly and Bi-weekly (also with the leap-aware n, B37). | 2026-09-30 | CHANGES §53 |
| Frequency labels show the payments per year, for example "Weekly (52/yr)". Since B37 the figure comes from the engine's payments-per-year function and is shown rounded to a whole number, so the text is unchanged even where the calculation uses the leap-aware n. Wording interim under Q-MSG. | OQ-V; DEC-B37-LEAP-N (Q-B37-LABEL, label format) | CHANGES §37, §53, §75 |
| Fee-limit message wording (the workbook says "Total Fees must be less than the Loan Amount"). Wording is interim. | Q-MSG interim, 2026-09-27 | CHANGES §24 |
| A contract with zero days and fees is rejected with a message (the workbook divides by zero). | B13 | CHANGES §30 |
| Total interest is the interest the schedule charges. | User, 2026-09-29 | CHANGES §51 |

### 4.3 Possible differences waiting for a decision

The calculator follows the BRD today; the workbook does something else.

| Candidate | What the calculator does today | What Excel does | Waiting for |
|---|---|---|---|
| Possible DEV-OQQ | P is the average opening balance (BRD §4.1). | P is the average opening principal. The APR differs when fees are above 0 (for example 9.25% against 9.63%). | OQ-Q |
| Possible DEV-OQR | Total principal paid is the sum of the Principal paid column. | Total payments minus total interest, which includes fees paid. | OQ-R |
| Possible DEV-W | Accrued interest is paid first, earns no interest, counts in C as it is paid, and is not in P. | No accrued-interest input; no Excel reference. | OQ-W2, OQ-W3, OQ-W5 |

## 5. Decisions register

Every decision here was taken by the user; the full text is in `COB-user-stories.md` §6–§7.5. Dates are the dates the decision was recorded.

| Decision | Date | What was decided | Delivered in |
|---|---|---|---|
| First decisions: OQ-S, OQ-X, a blank rate rejected, interim fee-limit message | 2026-09-27 | Fees paid separately; month-end rule for monthly dates; blank rate rejected; interim fee-limit message | CHANGES §1, §14, §24, §32 |
| Payment and rate above zero (OQ-Y and OQ-AA, revised) | 2026-09-28 | Payment and rate must be above zero | CHANGES §32 |
| Q-MONEY-FMT, Q-PRINT-HEAD | 2026-09-29 | Money format in amount inputs and print; printed schedule shows every column | CHANGES §45, §46 |
| Stakeholder feedback, decisions 1–11 | 2026-09-29 | (1) no interest on unpaid interest, oldest first; (2) and (5) labels follow the use case; (4) accrued interest required; (6) no sample fees; (7) Financed off, fee columns hidden; (8) term derived, contract date and semi-annual date hidden; (9) Renewal mortgage-only, reversed 2026-10-01; (10) semi-monthly first date moved forward; (3) and (11) hold or park four items | CHANGES §48–§52, §56, §61, §62 |
| Q-B19-ENDACC and its hint | 2026-09-29, hint 2026-09-30 | Show unpaid interest left at the End Date when above $0; hint "Unpaid after the last payment; interest since then is not included" | CHANGES §55, §57 |
| FB-24, accelerated hidden, Contract term refinement | 2026-09-30 | Personal loan Monthly only (reversed by DEC-B33-FREQ, 2026-10-05; history); hide accelerated options; term in years, months, days (its start point, the first payment date, and Q-CT-B25 were superseded by DEC-B32-TERM) | CHANGES §53, §54, §56 |
| Renewal accepts personal loan; Variable rate payment change hidden; start-date label "Date of change"; Q-SEMI-SHOW answered | 2026-10-01 | As stated | CHANGES §59, §60, §62 |
| Q-A11-SCOPE = B, Q-A11-FIX = No, Q-A14-GUARD = No | 2026-10-01 | Print table built on demand; no capture change; no guard against dead citations | CHANGES §63, §64 |
| Payment change "Accrued interest" hint | 2026-10-02 | The hint reads exactly "Interest accrued since the last payment date." (the CHANGES §67 wording, the same as Renewal). It reverses the longer wording tried in §68. The short hint does not repeat the arrears advice, and the schedule already charges interest from the Date of change, so a user who types that interest into Accrued interest is charged twice. This is OPEN again for the hint (F69). The guards left are the Date of change label and the user manual. The hidden Variable rate payment change flow keeps the original arrears text; Renewal is unchanged. Capture fixture sha256 is back to 171f8a33; the UI view logic file hash starts 1e081d1e; the single-file edition hash starts ec6c3075. | CHANGES §69 (reverses §68, restores §67) |
| Trigger-rate highlight dropped | 2026-10-01 | No highlight; nothing changes | CHANGES §65 |
| B29 Help page; B30 single-file edition | 2026-10-01 | Removable add-ons, no change to results. The Help page was removed on 2026-10-28 (SEC-HELP) | CHANGES §58, §66, §80 |
| SEC-HELP: remove the Help add-on before the security handover | 2026-10-28 | Help link, Help page and its builder removed; no change to results; documents stay as Markdown | CHANGES §80; checklist SEC-HELP (QA PASS WITH NOTES) |
| DEC-SEC-AZURE (Azure decisions) | 2026-10-29 | The calculator runs on Azure App Service as a Node app (Linux, Node 22, `node ui/serve.mjs`). Internal network only, by Azure access restrictions or a private endpoint (Azure configuration, in a deployment note). `serve.mjs` made fit for hosting: bind 0.0.0.0 on `PORT`, Host allow-list from the environment, full security headers. No change to results. | CHANGES §88 (SEC-5); `docs/DEPLOY-AZURE.md`; checklist §4a; `COB-architecture.md` §5 (revision 62). Not in `COB-user-stories.md` (finding D31) |
| DEC-SEC6-SELFHOST | 2026-10-29 | Self-host the Inter font and the logo so the content security policy can be the app's own origin only. No change to results. | CHANGES §87 (SEC-6); checklist §4a; `COB-architecture.md` §5 (revision 62). Not in `COB-user-stories.md` (finding D31) |
| DEC-B31-LAYOUT (screen part revised the same day); Q-B31-DUP-HINT, Q-B31-ON-ORDER answered, Q-B31-NARROW moot | 2026-10-05 | Printed figures in two columns (left: rates and term; right: amounts and Trigger rate); screen keeps the headline cards, a main list equal to the right column (Cost of borrowing amount without its hint, which stays on its card) and a collapsed "More figures" equal to the left column without the APR. With the Financed option on, Unpaid interest at end date stays directly after Balance at end date. No value, label or CSV change. | CHANGES §70; `COB-user-stories.md` §7.5; `COB-architecture.md` §5 B31 (revision 49) |
| DEC-B32-TERM (supersedes the 2026-09-30 start point and Q-CT-B25) | 2026-10-05 | The Contract term runs from the flow's start date to the last scheduled payment date, in every flow. Hint "Calculated from the {disbursal date / renewal date / date of change} to the last scheduled payment date." Label "Remaining contract term" for Renewal and Payment change (field, Contract terms tile, printout row); "Contract term" for New mortgage or loan and the hidden Variable rate payment change. Example: Payment change, Date of change 2026-02-20, next payment 2026-03-15, End date 2029-03-15: 3 years, 0 months, 0 days became 3 years, 0 months, 23 days. The display (years, months and days) and the hint were later replaced by DEC-B34-TERM; the start point and the labels stay. CSV, its file name and both golden masters unchanged. | CHANGES §71; `COB-user-stories.md` §7.5; `COB-architecture.md` §5 B32 (revision 50) |
| DEC-B33-FREQ (reverses FB-24 and the B27 answers; retires DEV-FB24) | 2026-10-05 | A personal loan accepts every payment frequency in New mortgage or loan, Renewal and Payment change; Variable rate payment change stays mortgage and variable. Removed outright, with no switch (the user's choice against the project default of keeping features switchable). The page no longer locks Payment frequency for a personal loan and no longer shows "Personal loans are paid monthly."; the accelerated options stay hidden. Rate rule unchanged: only a fixed-rate mortgage converts the contract rate to the payment frequency; a variable mortgage and a personal loan use the contract rate as entered at any frequency. The semi-monthly first-date move applies to personal loans too. Both golden masters and the page capture changed with approval. Two housekeeping questions use their defaults (Q-B33-B27FILE: the B27 test file is rewritten in place under its old name; Q-B33-LEGACY: the frozen pre-B27 generators and archive are kept); they do not affect results. Later change: the pre-B27 archive (two old golden fixtures and their manifest) was removed from the project on 2026-10-28 by user decision before the security handover; its content is still pinned by a checksum in test B27-T9, and the frozen generators are unaffected (SEC-10, CHANGES §82; not yet QA verified). | CHANGES §72; CHANGES §82 (SEC-10); `COB-user-stories.md` §7.5; `COB-architecture.md` §5 B33 (revision 51) |
| DEC-B34-TERM (replaces the years-months-days display and the hint of DEC-B32-TERM, and with it the Q-B32-SAME-DAY default "0 years, 0 months, 0 days"; answers Q-B34-ZERO, Q-B34-KEEP, Q-B34-ORDER, Q-B34-TEXT) | 2026-10-06 | The Contract term is shown in whole years and months only; any leftover day rounds up to a full month; zero parts are left out and a zero term reads "0 months". Two values, both from the flow's start date: to the End date the user typed and to the last scheduled payment date. Same value: shown once, no choice. Different: a radio group, legend "Term based on", "Start date to end date: {term}" first and pre-selected, "Start date to final payment: {term}" second. The pick is a rule: both values recompute from the current dates; recalculation never changes the pick; only a page load resets it. Field, Contract terms tile and printout show the picked value; the radios are not printed. Hint "From the {disbursal date / renewal date / date of change}; part months count as a full month." The option labels, legend and hint are interim under Q-MSG. Defaults kept: Q-B34-CSV (CSV, file name and engine figures unchanged; both golden masters byte-identical), Q-B34-FIX (page capture changed with the user's approval). No switch; no new DEV ID (DEV-OQP updated). | CHANGES §73; `COB-user-stories.md` §7.5; `COB-architecture.md` §5 B34 (revisions 52-53) |
| DEC-B36-ACCR-SPREAD (withdrawn) | 2026-10-09 | Spreading entered accrued interest at 37.5 % per payment was decided and withdrawn the same day; never built (the user's second example would have needed about 82.5 %). Accrued interest is still paid from the first payment, the rest carried forward (BR-10, B19). | Not delivered (withdrawn); checklist B36; CHANGES §75 |
| DEC-B37-LEAP-N, its answers (Q-B37-REF01: REF-01 stays the workbook reference with the switch off; Q-B37-APPA: Appendix A stays a formula test at the stated n; Q-B37-HINT: Calculated rate hint unchanged; Q-B37-LABEL: label figure computed by the engine) and the label format (whole numbers) | 2026-10-09 | Fixed-rate mortgage at the four 7- and 14-day frequencies: leap-aware n in the rate conversion (DEV-B37-LEAPN). Q-B37-LAW and Q-B37-WHICH-EXCEL stay open (section 6). | CHANGES §75; `COB-user-stories.md` §7.5; `COB-architecture.md` §5 B37 (revisions 56-57) |
| DEC-B38-YEARFRAC-ROUND | 2026-10-10 | Fixed-rate mortgage at the four 7- and 14-day frequencies: Y in n is Excel YEARFRAC (basis 1) and each row's period interest is rounded to the cent (DEV-B38-ROUND). | CHANGES §76; spec 013; `COB-user-stories.md` §7.5 |
| DEC-B39-VAR-PL-M12 | 2026-10-13 | Variable-rate mortgage and personal loan at the four 7- and 14-day frequencies: contract rate converted as monthly-compounded with the B37/B38 n, row interest at full precision (DEV-B39-M12). Open: Q-B39-VAR1-CENT, Q-B39-VAR2-FREQ, Q-B39-PL-EXAMPLE, Q-B39-UNIFIED, Q-B39-ENGINES. | CHANGES §77; spec 014; `COB-user-stories.md` §7.5 |
| DEC-B35-HINT | 2026-10-06 | The hint under Payment amount reads "The scheduled payment."; the sentence "It isn't calculated here." is removed because it was unclear. The payment amount is still entered, not calculated (BRD §1.2 and §3, IN-08). No other change; goldens and page capture unchanged. | CHANGES §74; checklist B35. Not found in `COB-user-stories.md` §7.5 (finding D13) |

## 6. Open and parked items

What the calculator does today is shown in the third column. Nothing here is settled.

| Item | Needed from | Today the calculator... | Status |
|---|---|---|---|
| OQ-Q: is P the average opening principal (workbook) or balance (BRD)? | Business owner | Uses the average opening balance. | Open decision |
| OQ-R: does Total principal paid exclude fees (BRD) or equal payments minus interest (workbook)? | Business owner | Sums the Principal paid column. | Open decision |
| OQ-W3, OQ-W5: is entered accrued interest in P; worked Renewal and Payment change examples | Business owner (examples) | Keeps it out of P; no examples exist. No decision names these two (F43). | Open decision |
| OQ-J: export format and layout of the member file | Business owner | Print / PDF with the full record, CSV with the schedule only. | Open decision |
| OQ-N: one contract-rate input? | Business owner | One input. | Open decision |
| Q-CAP: reject very long End Dates? | Business owner | The schedule stops silently at 20,000 rows. | Open decision |
| Q-MSG: final wording of all error messages | Business owner, BA | Technical messages with field names; interim wordings for the fee limit, blank or zero payment and rate, zero-day term, the unpaid-interest hint, the Contract term hint, legend and option labels (DEC-B34-TERM), and the Payment frequency option text (DEC-B37-LEAP-N). | Open decision |
| Q-A10-1: blank Loan amount or blank fee amount | Business owner | A blank Loan amount is rejected as 0. A blank fee amount is a $0 fee and prints as "$" (F35). | Open decision |
| Browser keeping draft inputs (US-18) | Business owner | Keeps nothing. | Open decision |
| Q-B37-LAW: is semi-annual compounding "the Bank Act convention" (BRD §4.2) or should the legal basis read Interest Act s.6 (the user's wording)? | Stakeholders (they own the BRD) | Calculates as DEC-B37-LEAP-N says; the wording affects the BRD amendment only. Whether a leap-aware n still gives a rate equivalent to the semi-annual contract rate in the legal sense is not decided. | Open decision |
| Q-B37-WHICH-EXCEL: which workbook version produced the user's two Excel figures? The transcribed workbook uses 52 / 26, yet the user's figures fit the leap-aware n. | User | Treats the transcribed workbook (52 / 26) as the Excel reference (REF-01 with the switch off); no effect on results. | Open decision |
| Q-B32-HEADING: keep the "Contract terms" heading for Renewal and Payment change | User (non-blocking) | Keeps "Contract terms" in every flow (recommended default, CHANGES §71). | Open decision (default in use) |
| FB-11: COB rate when there are no fees | User (will discuss) | Rate equals the calculated rate; it ignores accrued interest counted in C. | On hold |
| OQ-W2 / FB-25 W2: does entered accrued interest count in C? | None (no follow-up question will be sent) | Counts it only as far as it is paid. | Parked |
| FB-7: keep values when switching use case | None | Keeps values (code reading, Not verified). | Parked |
| FB-8d: outputs not in the BRD | None | "Disbursal amount" and "Fees recovered through payments" are hidden. | Parked |
| FB-9a, FB-18: non-financed fees paid separately or in the waterfall | None | Paid separately (DEV-OQS). | Parked |
| Field-level messages; all problems at once | Business owner (Q-MSG), then development | One message at a time. | Planned |
| Automated page tests; parity matrix; accessibility; browser list | Project team | No browser check of the page since the Chrome scripts were deleted (SEC-CHROME, 2026-10-28). | Planned |
| SEC-5c R5c-1 limit: a client still sending when the server closes the connection may lose the reply to a TCP reset (section 8, F73) | Azure team | Never seen in the measured runs (macOS loopback only). | To confirm in an Azure test |
| Azure items "to confirm" (`docs/DEPLOY-AZURE.md`): the `NODE|26` GA date on App Service and the exact `--linux-fx-version` strings (Q-NODE26-1), the retirement date of the App Service Node 22 runtime (about 2027-04-30), how the CI agent selects Node 26.13.0, `PORT` set by App Service, `SCM_DO_BUILD_DURING_DEPLOYMENT`, Host header of warm-up and Always On requests, HSTS `includeSubDomains` / `preload`, the front end's idle timeout towards the app (against the 120 s keep-alive), the Node 22.x patch level App Service runs (at least 22.23.4 recommended) | Azure team | The server works with or without them (defaults and `/healthz` answer whatever the Host). | Open (Azure team) |
| BRD v2.4; compliance sign-off; user acceptance testing | Stakeholders, compliance | Not started. | Planned |
| Removal of unused term fields (B24-CLEANUP) | Project team | Fields are ignored. | Parked |

## 7. How to verify

Run from `COB-ts/` unless stated. A pass means the results shown.

| Check | Command | A pass looks like |
|---|---|---|
| All automated tests | `nvm use` (reads `.nvmrc`, Node 26.13.0), then `npx vitest run` | 99 files, 0 failed and 0 skipped. Latest QA-verified: 4378 passed + 5 expected fail after SEC-NODE26 (CHANGES §92 verify addendum, checklist SEC-NODE26); the suite runs from the `COB-ts` folder alone (CHANGES §83, §90, §91) |
| Types | `npm run typecheck` and `npm run typecheck:tests` | No errors |
| Two time zones | `npm run test:tz` | 1656 passed in each zone (CHANGES §87, §88, §90, §91, §92) |
| Golden masters | `shasum -a 256 tests/ca/fixtures/golden_engine_v1.json tests/ca/fixtures/golden_engine_pc_v1.json` | Starts b35d9e52 and d1076ca7 (unchanged by SEC-6, SEC-5 and SEC-5b, CHANGES §87, §88, §90; at B37 they started b90ea69c and 9da9599f, CHANGES §75; finding D34) |
| Page capture | No command. The capture script was deleted (SEC-CHROME). The saved fixture `a10_ui_capture_v1.json` (sha256 starts e22f0161; regenerated in B38 and B39, CHANGES §76, §77) is still replayed by `npx vitest run` | The unit tests that read it pass |
| Dependency audit | `npm audit` | 0 vulnerabilities (CHANGES §87, §88, §90, §92) |
| Page server, local mode | `npm run ui`, then `curl -sI http://localhost:5173/`, `curl -s http://localhost:5173/version.json`, `curl -sI http://localhost:5173/package.json` | 200 with the security headers (no HSTS); `{"version":"0.1.0"}`; 404 |
| Page server, hosted mode | `npm run build`, then `WEBSITE_HOSTNAME=cob-test.azurewebsites.net PORT=5292 node ui/serve.mjs` and `curl -sI -H 'Host: cob-test.azurewebsites.net' http://127.0.0.1:5292/` | 200 with the headers including `Strict-Transport-Security: max-age=31536000`; with `-H 'Host: evil.com'` 403 `Forbidden`, but `/healthz` 200 `ok` (CHANGES §88 manual run) |

The Chrome checks that used to be listed here were deleted on 2026-10-28 (user decision, before the production security handover; SEC-CHROME, CHANGES §85, QA PASS): the page smoke check, the printed schedule width (F12), the print table render cost (F18), the moved semi-monthly date (F17), the page capture script and the shared-page check. The global Playwright MCP package they used was uninstalled. Consequences: nothing tests the page in a real browser any more, so a change that breaks the page (for example a script error that stops it loading) would not turn any test red; and the saved capture fixture can still be replayed but can no longer be regenerated. Chrome, Safari and other browsers are Not verified.

**Where each artifact lives.** Requirements: `COB-business-requirement.md`. Decisions, use cases, stories and the traceability matrix: `COB-user-stories.md`. Task status: `COB-project-checklist.md`. Every task with What, Why and Evidence: `COB-ts/CHANGES.md`. Architecture and the difference register: `COB-architecture.md` §2.1. Engine: `COB-ts/src/ca/`. Page: `COB-ts/ui/`. Tests and fixtures: `COB-ts/tests/`. Workbook reference: `reference/` and `Cost of Borrowing Rate Calc_Current.xlsm`.

## 8. Known gaps

Plain-language list of what is true today and not covered above. Findings that have been fixed are not repeated; the earlier versions of this report and CHANGES.md keep that history. Numbers are the original finding numbers. The three later findings that reused F63 to F65 are renumbered F66 to F68.

| # | Gap | Owner |
|---|---|---|
| F2 | There is no Calculate button, but the page says "Results appear here after you calculate", "Calculate first. Print and download need a current result." and, in print, "Calculate, then print." Results update on every input. US-06 expects a Calculate action. | Business owner, UI |
| F5 | Rates show 5 decimals. The workbook format, and US-12, say 4. | Business owner |
| F9 | Error messages use internal field names (`loanAmount`, `contractRatePercent`). The manual maps them to screen labels. | Q-MSG |
| F10 | The CSV holds the schedule only, not the inputs and results. Its headings differ from the screen. | OQ-J |
| F11 | Some printed labels differ from screen labels ("Use case" against "Flow", "Mortgage or loan amount" against "Loan amount ($)"). | Business owner |
| F12 | The schedule columns differ from BRD B.6 (no opening and closing principal, no New Int or Total Int; adds Days and Accrued interest). | Business owner |
| F15 | The page says results do not replace the cost of borrowing disclosure in the loan documents, while UC-01 and US-12 describe producing those values. Confirm the intended wording. | Business owner |
| F17 | BRD v2.3 is known to be wrong in places (B.4 monthly and skip dates, P definition, personal loans, BR-04). BRD v2.4 is not issued. A reader of the BRD alone gets a different picture. | Stakeholders |
| F25 | The checklist item "Short user guide" is unticked, although the manual covers use cases, dates and the accelerated note. | Main session |
| F35 | A blank fee amount is accepted as a $0 fee and prints as "$". No decision covers it (Q-A10-1). | Business owner |
| F38 | Information: the Q-PRINT-HEAD decision text says the columns are cut off; QA measured that Chrome shrank the page instead. The delivered behaviour is every column at full size. | None |
| F39 | Information: the default printout now runs to 5 pages instead of 4, because it prints at full size. | Business owner (OQ-J) |
| F43 | OQ-W3 and OQ-W5 are not named in any decision. | Business owner |
| F44 | Hiding the Financed option has no DEV ID; it carries decision 7 instead (section 4.2). | Architect |
| F51 | Double-count risk: entering the interest since the last payment date into Accrued interest counts it twice (QA probe: +$784.19 in C). The Payment change hint no longer warns about arrears (CHANGES §69), so only the Date of change label and the user manual guard against it. The engine does not guard. Related to F69. | Business owner |
| F69 | Open for the hint (CHANGES §69, user decision 2026-10-02, reversing §68). The short hint "Interest accrued since the last payment date." does not say "arrears only" and can invite a double charge; the manual advises arrears only and notes the disagreement. Needs a business decision on the hint wording. Related to F51. | Open |
| F52 | Not verified: QA could not compare the capture fixture with its pre-B22 version, and did not check the B22 labels by hand in Chrome beyond the capture. | QA |
| F55 | Interest between the last payment date and the End Date is in neither "Balance at end date" nor "Unpaid interest at end date" (example: about $380 on $200,000 over 14 days). The hint now says so. | Business owner |
| F58 | QA notes from B24 for the architect (record the layering edge from flows to policies in the fitness rules). Not re-checked in this version. | Architect |
| F60 | The engine input still carries the unused term years and months fields (cleanup parked). | Project team |
| F66 | The smoke script's "4 options" means the four Payment Frequency options, not the Flow list (CHANGES §60). Easy to misread. | None |
| F67 | The Renewal hint and the Payment change hint still say "last payment date" while the label reads "Date of change". Recorded by the user's decision (CHANGES §59). | None |
| F68 | The test file `b21-renewal-mortgage-only` now tests the reversed rule (Renewal accepts a personal loan). The name is kept as history (CHANGES §59). | None |
| F70 | The test file `b27-personal-loan-monthly-only` now tests the reversed rule (a personal loan at every frequency). The name is kept as history (Q-B33-B27FILE default, CHANGES §72). | None |
| F72 | Accepted (N-SEC5C-1, user decision 2026-10-29): if a valid request and malformed bytes arrive in the same read, the client gets only the 400 reply and the valid request gets no answer. Node's default handler behaves the same. (The rest of F72 is fixed: parse-error replies carry the security headers since SEC-5b, CHANGES §90; the 417 and 100-continue replies since SEC-5c, CHANGES §91.) | None (accepted) |
| F73 | R5c-1 limit (SEC-5c brief): the server closes a connection only after its reply has been handed to the operating system, but if the client is still sending at that moment, TCP may answer with a reset and the client may lose the reply. Measured on macOS loopback only (28/28 full replies in the brief, 160/160 in the QA verify), not on Linux or behind the App Service front end. No worse than Node's default. | Azure team (to confirm in an Azure test) |
| F71 | Stakeholders wrote "Personal loan rates are always monthly" (feedback §3.11). The user reversed the decision based on it (DEC-B33-FREQ). The stakeholders are told only through a draft note in `COB-brd-amendments-draft.md`; they have not confirmed it. | Stakeholders |

**Marked Not verified:**

- US-07 and UC-07: values kept when switching use case (code reading only).
- US-18: no member data stored (architecture review only; no QA check).
- UC-01 page walk-through (checklist 3b).
- Screen and print behaviour outside the captured scenarios (no automated page tests).
- Formatting an amount when the user leaves the field (checked by a source check and one QA page check).
- Other browsers than Chrome for printing.
- The B22 page labels in Chrome beyond the capture (F52).
- The page in any real browser: the Chrome scripts were deleted (SEC-CHROME).
- The leap-aware n for **Weekly** (7-day) fixed-rate mortgages against a user example: both user cases are Bi-weekly; Weekly follows by extension (DEC-B37-LEAP-N conflict (ii)). The engine's weekly results are checked against QA's own oracle, not against a business example.
- QA note (CHANGES §75): the frequency labels are refreshed inside the same step as the input reading; if that step ever failed the labels would keep their earlier text. Today no form state makes it fail.
- The single-file edition hash (starts 9d365b4c, section 2): recorded in CHANGES §75 after the B37 rebuild; not re-checked here.
- The page in a browser under the SEC-5 security headers: the content security policy console check, the "· Engine" version on the printout via `/version.json`, and the CSV download (CHANGES §88 "Still to do"; the checklist records a browser check only for SEC-6). Also not opened by hand after SEC-5b, which changed a comment in `ui/ca.js` and rebuilt `COB.html` (CHANGES §90 "Still to do").
- The Azure items marked "to confirm" in `docs/DEPLOY-AZURE.md` (not checked against the Alterna tenant).

## Documentation findings

Found while updating for B31 (CHANGES §70). No requirement, decision, code or test was changed.

| # | Finding | Owner |
|---|---|---|
| D1 | The user manual still said the "Unpaid interest at end date" hint was a change in progress and quoted the old hint. The new hint was delivered as B26-HINT (CHANGES §57; `ui/ca-view.js`). Corrected in the manual in this run. | doc-writer (done) |
| D2 | `COB-architecture.md` revision 48 (header list) still describes the first B31 version (one `figureColumns` export, 39 exports, "More figures" removed, columns stacking at 480 px). Revision 49, the checklist and CHANGES §70 describe what was built (41 exports, "More figures" kept). The revision note is history, but a reader may take it as current. | architect |
| D3 | QA note in CHANGES §70: the capture fixture's provenance text still reads "post-B24". Cosmetic. | QA |

Found while updating for B32 (CHANGES §71). No requirement, decision, code or test was changed.

| # | Finding | Owner |
|---|---|---|
| D4 | `COB-user-stories.md` US-04 (the italic note above the first acceptance criterion) still calls DEC-B32-TERM "planned, B32", and the B24 criterion under it still describes the term from the First Payment Date and the moved semi-monthly date (Q-CT-B25) without a delivered marker for B32. B32 is delivered and QA-verified (CHANGES §71, checklist B32). | ba |
| D5 | `COB-architecture.md` §5 status table row B32 still reads "brief written; not started". The checklist and CHANGES §71 record it as delivered with QA PASS. | architect |
| D6 | The hint text in `ui/ca-view.js` is marked as an interim wording under Q-MSG. DEC-B32-TERM fixes its words, so it is unclear whether Q-MSG still covers this hint. | ba |
| D7 | Information: the User manual's earlier rule "a monthly schedule of N payments reads N-1 months" no longer holds now that the term starts at the start date; removed from the manual in this run. | doc-writer (done) |

Found while updating for B33 (CHANGES §72). No requirement, decision, code or test was changed.

| # | Finding | Owner |
|---|---|---|
| D8 | `COB-user-stories.md` still calls DEC-B33-FREQ "planned B33" in the IN-03 note (§3 table), US-02, US-08, the traceability matrix row for IN-02…IN-09, the OQ-C row and the FB-24 row. B33 is delivered and QA-verified (CHANGES §72, checklist B33). | ba |
| D9 | `COB-architecture.md` still shows B33 as "brief written; not started" (the §5 status table row and the §5 B33 heading) and the §2.1 DEV-FB24 row as "retirement planned, B33", with `b33-personal-loan-frequencies.test.ts` as "(planned)". | architect |
| D10 | `COB-ts/CHANGES.md` "Known open items", DQ-16 line, still says Renewal accepts a personal loan "(Monthly only)". Since CHANGES §72 a personal loan at Renewal takes any frequency. | main session |
| D11 | Information: D4 and D5 (B32 marked planned in US-04 and the architecture status table) are resolved in the sources (revision 51 corrected the B32 row; the US-04 note no longer says planned). | None |

Found while updating for B34 and B35 (CHANGES §73, §74). No requirement, decision, code or test was changed.

| # | Finding | Owner |
|---|---|---|
| D12 | `COB-user-stories.md` US-04 note still calls DEC-B34-TERM "planned, B34". B34 is delivered and QA-verified (CHANGES §73, checklist B34). | ba |
| D13 | DEC-B35-HINT (the Payment amount hint) is named in the checklist (B35) and CHANGES §74 but is not recorded in `COB-user-stories.md` §7.5 with the other decisions. The coverage report cites the checklist and CHANGES instead. | ba |
| D14 | `COB-architecture.md` still shows B34 as not started: the §5 status table row ("not started; nothing blocks it"), the §5 B34 heading ("brief written; not started") and the §2.1 DEV-OQP status ("years-and-months display and the End date option: planned, B34"). B35 has no §5 entry. | architect |
| D15 | `COB-architecture.md` §7 still lists Q-B32-SAME-DAY ("0 years, 0 months, 0 days") as an open question. DEC-B34-TERM (Q-B34-ZERO, "0 months") replaces that display, so this report no longer lists it as open. | architect |
| D16 | `COB-ts/docs/COB-domain-overview.md` (owned by the architect) still marks B34 as "Planned (B34, DEC-B34-TERM; decided 2026-10-06, not yet built)" in the Contract term section and in the comparison table row "Contract term". B34 is delivered (CHANGES §73); these should read today. Not edited by the doc-writer. | architect |
| D17 | Information: D6 (whether Q-MSG still covers the term hint) is answered: DEC-B34-TERM (8) states the option labels, legend and hint are interim under Q-MSG. D10 (CHANGES "Known open items", DQ-16 line) is resolved in the source. | None |
| D18 | Information: CHANGES §74 notes that `visual_design/app-ui.md` and `design-beyond-brd.md` still quote the old Payment amount hint (kept as history). | ui-designer |

Found while updating for B37 (CHANGES §75). No requirement, decision, code or test was changed.

| # | Finding | Owner |
|---|---|---|
| D19 | `COB-architecture.md` still shows B37 as not delivered: the §2.1 row DEV-B37-LEAPN ("planned, B37"), the switch table row for the leap-aware switch ("planned"), the §5 status table row B37 ("brief written; ready for QA") and the §5 B37 heading. Revision 57 also gives "Bi-weekly (26.10/yr)" as the label example; the later label-format decision (whole numbers) replaced it. B37 is delivered with QA PASS WITH NOTES (CHANGES §75, checklist B37). | architect |
| D20 | `COB-user-stories.md` still calls DEC-B37-LEAP-N "planned B37" or "planned, not built": the §7.5 decision row, US-08 (n-table note and the new criteria), and the traceability row for OUT-01 / BR-01 / BR-09 / §4.2 / App. A, which also still lists Q-B37-APPA, Q-B37-REF01 and Q-B37-LABEL as open although the user answered them the same day. The US-19 REF-01 criterion still says "how REF-01 is kept is open (Q-B37-REF01)". | ba |
| D21 | US-08's story text says the rate follows "the Bank Act conventions" (as BRD §4.2 does), while the user's decision cites the Interest Act s.6. Open as Q-B37-LAW for the stakeholders; this report does not settle it. | Stakeholders |
| D22 | Source conflict, open as Q-B37-WHICH-EXCEL: the transcribed workbook and QA's replay of the saved workbook use n = 52 / 26, but the user's Excel figures for the two bi-weekly cases fit the leap-aware n. "Excel" in this report means the transcribed workbook. | User |
| D23 | CHANGES §75's "Evidence" paragraph is headed "QA verification pending" and lists 17 failing tests; the QA paragraph after it records the PASS WITH NOTES and 0 failures. This report uses the QA figures. | main session |
| D24 | `COB-ts/docs/COB-domain-overview.md` (owned by the architect) still states "n: Weekly 52, Bi-weekly 26" for the fixed-rate conversion and that the hidden accelerated frequencies use 52 and 26, with no B37 note, and its state line is dated 2026-10-02. Since B37 a fixed-rate mortgage at the four 7- and 14-day frequencies uses the leap-aware n. Not edited by the doc-writer. | architect |
| D25 | Information: B36 (DEC-B36-ACCR-SPREAD) is withdrawn and never built; neither document describes it as a feature. `COB-brd-amendments-draft.md` marks its B36 amendment "Withdrawn: do not send". | None |

Found while updating for SEC-HELP (CHANGES §80, Help add-on removed). No requirement, decision, code or test was changed.

| # | Finding | Owner |
|---|---|---|
| D24 | `COB-ts/docs/v3_PRRD_COB.md` still describes the Help page as current: the comparison row "Not in v2.3" (status Covered, suggested wording "Help: an in-page link to the user manual.") and the change list row "V3 change 22 / §7 / Help page added / B29". Since SEC-HELP there is no Help page. Not edited by the doc-writer (outside its two documents). | Owner of the v3 draft (ba) |
| D25 | Information: `COB-ts/docs/COB-domain-overview.md` contains no mention of Help; nothing to change there. | None |
| D26 | CHANGES §80 is not yet QA verified; this report gives its test counts as **Not verified**. | QA |

Found while updating for SEC-CHROME (2026-10-28). No requirement, decision, code or test was changed.

| # | Finding | Owner |
|---|---|---|
| D27 | SEC-CHROME has no CHANGES entry yet and is not QA verified; this report gives its counts as **Not verified**. | main session, QA |
| D28 | The checklist still refers to the deleted Chrome scripts in open items: SEC-5 ends "Then the Chrome smoke test", SEC-8 changes how the Chrome scripts find the global package, and the SEC-11 note asks the README to list the Chrome scripts by name. CLAUDE.md also still says to run the real page in Chrome after any `ui/` change and lists the Chrome script commands. | main session |
| D29 | The capture fixture can no longer be regenerated, but CLAUDE.md and the checklist (SEC-6) still describe changing it with the user's approval. A change that needs a new capture has no way to make one. | main session |

Found while updating for SEC-6 and SEC-5 (CHANGES §87, §88). No requirement, decision, code or test was changed.

| # | Finding | Owner |
|---|---|---|
| D30 | The headings of CHANGES §87 and §88 still say "not yet QA verified", while the checklist records QA PASS WITH NOTES for both (2026-10-29). `COB-architecture.md` §5 security table rows SEC-5 and SEC-6 and the brief heading still read "Open; brief written" / "not started". | main session, architect |
| D31 | DEC-SEC-AZURE and DEC-SEC6-SELFHOST are recorded in the checklist §4a, CHANGES and the architecture brief, but not in `COB-user-stories.md` §6–§7.5 with the other decisions. They change no calculation. | ba |
| D32 | The checklist item "Hosting / deployment target decided (internal web, desktop, static file)" is still unticked, although DEC-SEC-AZURE decided it (Azure App Service). | main session |
| D33 | Test counts differ by one: CHANGES §88 records 4088 passed + 5 expected fail; the checklist SEC-5 entry (QA) records 4089 + 5. This report uses the QA figure. | main session |
| D34 | Information: the golden-master checksums in section 2 (b90ea69c, 9da9599f) are from B37 (CHANGES §75); since B38 and B39 they start b35d9e52 and d1076ca7 (CHANGES §87, §88, HANDOFF). Section 7 is corrected; the section 2 rows are calculation history and left for a full refresh. | doc-writer (next full run) |
| D35 | Code comment `ui/ca.js` line 546 still reads "brand logo: hotlinked from alterna.ca"; since SEC-6 the logo is `/ui/assets/alterna-savings.svg`. The header comment of `ui/serve.mjs` says "Every response carries one fixed set of security headers", which does not hold for Node's own 400 replies (SEC-5b item 1). Not edited (code). | sr-dev |
| D36 | The checklist SEC-6 note says `.txt` is served as octet-stream "(settle in SEC-5)"; SEC-5 now serves it as `text/plain; charset=utf-8` (CHANGES §88). The note is stale. | main session |
| D37 | Information: D26 and D27 are resolved: SEC-HELP is QA-verified (checklist SEC-HELP) and SEC-CHROME has CHANGES §85 with QA PASS. `docs/COB-domain-overview.md` does not mention the server, fonts or logo; nothing to change there. | None |

Found while updating for SEC-5b (CHANGES §90). No requirement, decision, code or test was changed.

| # | Finding | Owner |
|---|---|---|
| D38 | Test counts differ by one: CHANGES §90 Evidence records 4257 passed + 5 expected fail; the §90 verify addendum (QA) records 4258 + 5. This report uses the QA figure. | main session |
| D39 | `COB-architecture.md` §5 still shows SEC-5b as open: the security table row reads "Open; brief written (revision 63 …)" and the brief heading says "brief written; not started", while CHANGES §90 and the checklist record it as done (QA PASS WITH NOTES 2026-10-29). | architect |
| D40 | Information: D35 is resolved by SEC-5b (CHANGES §90, R5b-7): the `ui/ca.js` logo comment no longer says "hotlinked" and the `ui/serve.mjs` header comment now names the 400/408/413/431 replies. | None |
| D41 | The checklist SEC-5b entry still lists, as item (7a), "add L2/L3/M1-431 to DEPLOY-AZURE.md known gaps"; those items are now fixed, and `docs/DEPLOY-AZURE.md` lists them as fixed rather than as gaps. | main session |
| D42 | SEC-5c (F-1 to F-3) is not yet in `COB-architecture.md` §5 (no table row, no brief); it is tracked only in the checklist and the CHANGES §90 verify addendum. | architect |

Found while updating for SEC-5c (CHANGES §91). No requirement, decision, code or test was changed.

| # | Finding | Owner |
|---|---|---|
| D43 | Test counts differ by one: CHANGES §91 Evidence records 4334 passed + 5 expected fail; the §91 verify addendum and the checklist SEC-5c entry (QA) record 4335 + 5, the +1 being the re-added `ui/serve.mjs` pin. This report uses the QA figure. | None (explained) |
| D44 | `COB-architecture.md` §5 still shows SEC-5c as open: the security table row reads "Open; brief written (revision 64 …)" and the brief heading says "brief written; not started", while CHANGES §91 and the checklist record it as done (QA PASS WITH NOTES 2026-10-29). D39 (the same for SEC-5b) is still open too. | architect |
| D45 | Information: D42 is resolved: SEC-5c now has a §5 table row and a brief (revision 64). | None |
| D46 | CHANGES §91 "Still to do" still lists "QA verify and re-pin (R5c-6)" and the `docs/DEPLOY-AZURE.md` update; the first is done (§91 verify addendum), the second is done by this update. Nobody has recorded opening the page in a browser after SEC-5b or SEC-5c, nor the `nc` check of the 417 from the brief (main session). | main session |

Found while updating for SEC-NODE26 (CHANGES §92) and Q-NODE26-1. No requirement, decision, code or test was changed.

| # | Finding | Owner |
|---|---|---|
| D47 | `COB-architecture.md` §5 still shows SEC-NODE26 as open: the security table row reads "**Open** (brief: revision 65 …)" and the brief heading says "(revision 65, 2026-10-29; open)", while CHANGES §92 and the checklist record it as done (QA PASS WITH NOTES 2026-10-29). Same pattern as D39 and D44. | architect |
| D48 | Decision Q-NODE26-1 (production on `NODE|22-lts` until `NODE|26` is GA) is recorded only in CHANGES §92, `HANDOFF.md` and `CLAUDE.md`; it is not in `COB-user-stories.md` (nor are DEC-SEC-AZURE and DEC-SEC6-SELFHOST, finding D31). `HANDOFF.md` lists this as open for the BA. | ba |
| D49 | The R-N26-9 text in the SEC-NODE26 brief gives the CLI example `az webapp config set --linux-fx-version "NODE|26"`; under Q-NODE26-1 the production value until GA is `NODE|22-lts`. `docs/DEPLOY-AZURE.md` now gives both, each marked *to confirm*. | None (explained) |
| D50 | The 416/416 run on Node 22.23.4 used a `node_modules` installed by `npm ci` on Node 26 (CHANGES §92 verify addendum), because `npm ci` refuses Node 22 by design. That matches production, where no packages are installed. The deploy package `deploy/cob-azure-2026-10-29.zip` was built before SEC-NODE26 and needs rebuilding before a manual test (`HANDOFF.md`). | main session |
| D51 | CHANGES §92 "Still to do" still lists the `docs/DEPLOY-AZURE.md` Runtime row; it is done by this update. The `COB-architecture.md` §5 status table and pipeline-order note still describe the doc-writer step as pending. | main session, architect |
