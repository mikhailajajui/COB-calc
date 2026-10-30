# COB Calculator: Requirements v3 Draft (PRRD)

Proposed revision of the requirements, for business owners, compliance and reviewers. Draft of 2026-10-14. It compares **BRD v2.3** (`docs/COB Requirements v2.3.docx`) with what the **COB-ts calculator does today** (branch `b37-b39-rate-rules`, engine `COB-ts/src/ca/`, page `COB-ts/ui/`), one section at a time, and gives the wording proposed for v3 for each section.

This is not an issued BRD. The stakeholders own the BRD; nothing here changes it until they accept it. Every difference listed was decided by the user and is recorded in the coverage report (sections 4 and 5) and in `COB-ts/CHANGES.md`.

**How to read the tables.** Each row gives what v2.3 says, what the calculator does, a status and the proposed v3 text. Status words:

| Status | Meaning |
|---|---|
| Covered | The calculator does what v2.3 says. v3 keeps the text, sometimes with a clarification. |
| Partly covered | The calculator does something different from v2.3, decided by the user. v3 changes the text. |
| Not covered – out of scope | v2.3 describes it, and the calculator does not build it, by decision. v3 removes or marks it. |
| Open decision | Still waiting for a stakeholder answer. v3 keeps the v2.3 text and records the question. |

**Source check.** The docx and its extraction `docs/COB-business-requirement.md` were compared paragraph by paragraph on 2026-10-14. They match. The only differences are the docx table-of-contents page numbers and one escaped ampersand.

---

## 1. Summary of changes

| Area | Number of v3 changes | Headline |
|---|---|---|
| Purpose, scope, principles (§1, §2) | 2 | Parity means "same as the workbook except the listed, decided differences" |
| Inputs (§3.1) | 7 | Itemized fees with a Financed flag; "Date of change" replaces Last Payment Date and Payment Change Date; Renewal and Payment change take personal loans; Variable rate payment change and the accelerated frequencies are hidden on the page |
| Outputs (§3.2, §3.3) | 6 | OUT-01 renamed "Calculated rate"; new figures (Term in days, Balance at end date, Unpaid interest at end date, Contract term); schedule columns redrawn |
| Rate conversion (§4.2) | 3 | Leap-aware n and Excel YEARFRAC at the 7- and 14-day frequencies; per-row cent rounding for fixed mortgages; monthly-compounded conversion for variable mortgages and personal loans at those frequencies |
| APR, trigger rate, interest (§4.1, §4.3 to §4.5) | 4 | No-fee shortcut (APR equals the calculated rate); unpaid interest never earns interest; prior accrued interest paid first and counted in C only when paid |
| Business rules (§5) | 4 | BR-02, BR-03, BR-04 and BR-12 reworded |
| Validation (§6) | 4 | Payment and rate must be above 0; fee limit counts every fee; the two "define" items answered |
| Appendix B | 6 | Skip-date rule and One Time dropped; month-end and semi-monthly rules; payoff row; non-financed fees outside the waterfall; column map redrawn |

The numbered list of changes is in section 4 of this document.

---

## 2. Section by section

### Document control and version history

| Topic | v2.3 says | COB-ts does | Status | Proposed v3 |
|---|---|---|---|---|
| Version | 2.3, "Ready for development review" | Built against 2.3 | Covered | Version 3.0 (draft), "For stakeholder review". Add a history row: "3.0 – Draft – Records the decisions taken during development: rate rules at the 7- and 14-day frequencies, fee treatment, unpaid interest, dates, validation and screen changes." |
| Reference workbook | "COB Calculator v7" | Parity tested against `Cost of Borrowing Rate Calc_Current.xlsm` (reference case REF-01, 156 rows) | Partly covered | Name the workbook file the parity tests use, and say which version gave the user's examples (Q-B37-WHICH-EXCEL). |

### §1 Purpose and scope

| Topic | v2.3 says | COB-ts does | Status | Proposed v3 |
|---|---|---|---|---|
| Standalone calculator, manual input, disclosure values and schedule (§1.1) | Required | A single page; every value is typed in; results and a full schedule | Covered | Keep. |
| Four use cases (§1.1) | New, Renewal, Payment change, Variable rate payment change | The engine has all four. The page offers three: Variable rate payment change is hidden (user decision 2026-10-01) | Partly covered | Keep the four in scope; add "Variable rate payment change is not offered on the page until the stakeholders confirm its rules." |
| Reproduce the workbook logic (§1.1) | Converter sheet and the macro | Reproduces them, apart from the differences in the coverage report section 4 | Partly covered | "Reproduce the workbook logic, except the differences listed in section 9 (new)." |
| No Wealthview integration (§1.2) | Out of scope | No integration | Covered | Keep. |
| Payment amount calculation (§1.2) | Out of scope; entered by the user | Entered by the user; never calculated | Covered | Keep. |
| No storage of member data (§1.2) | Out of scope | Nothing is saved; closing the page clears it | Covered | Keep. |

### §2 Guiding principles

| Topic | v2.3 says | COB-ts does | Status | Proposed v3 |
|---|---|---|---|---|
| Functional parity | Same outputs as the workbook for the same inputs | Same outputs for REF-01 to 1.3e-14 relative with the leap-aware switch off. With the shipped switches, results differ on purpose in the cases of DEV-B37-LEAPN, DEV-B38-ROUND and DEV-B39-M12 (a few cents of interest) and in the other DEV cases | Partly covered | "Same outputs as the workbook, except for the decided differences in section 9. Each difference has an ID, a reason and a test." |
| Manual entry | Required | Yes | Covered | Keep. |
| Regulatory alignment | "Cost of Borrowing regulations under the Bank Act" | Rate conversion is documented against the Interest Act s.6; the APR shape against the Financial Consumer Protection Framework Regulations (SOR/2021-181). Project research finds the Bank Act regime applies only to banks (Alterna Bank). Alterna Savings is an Ontario credit union, governed by the Credit Unions and Caisses Populaires Act, 2020 and O. Reg. 108/22. Both regimes use the same APR formula (O. Reg. 108/22 s.3, SOR/2021-181 s.47), so no figure changes | Open decision | "Calculations must be consistent with the cost of borrowing disclosure rules that apply to the lending entity: for Alterna Savings, the Credit Unions and Caisses Populaires Act, 2020 and O. Reg. 108/22; for Alterna Bank, the Bank Act and SOR/2021-181. Both use the same APR formula (§4.1). Fixed-rate mortgage rates are stated and compounded half-yearly, not in advance, to satisfy Interest Act s.6. In Ontario the APR must be consistent with that rate (O. Reg. 108/22 s.4(2))." Compliance to confirm the citations and which entity lends on each product (Q-B37-LAW). |
| Auditability (export, print) | Required | Print or save as PDF, and CSV download of the schedule | Covered | Keep. |

### §3.1 Input fields

| Topic | v2.3 says | COB-ts does | Status | Proposed v3 |
|---|---|---|---|---|
| Use case (IN-01) | Dropdown with four values | "Flow" dropdown: New mortgage or loan, Renewal, Payment change. The fourth is hidden on the page | Partly covered | Rename the field "Flow" or keep "Use Case"; list the three offered values and note the hidden fourth. |
| Loan amount (IN-02) | Total amount including financed fees; for payment change, the balance at the change date | Same. Must be above 0 | Covered | Keep; add "For Renewal, the balance at the renewal date." |
| Product type (IN-03) | Personal loan or Mortgage | Same. Renewal and Payment change accept both; Variable rate payment change forces Mortgage | Partly covered | Add: "Renewal and Payment change apply to both product types. Variable rate payment change is mortgage only." |
| Rate type (IN-04) | Fixed mortgages compound semi-annually; all others monthly | Same rate basis. Variable rate payment change forces Variable | Covered | Keep; add the forced Variable. |
| Contract rate (IN-05) | Annual rate | Percent number, must be above 0 (DEV-OQAA) | Partly covered | Add "Must be greater than 0%." |
| Financed and non-financed fees (IN-06, IN-07) | Two currency fields | An itemized fee list: name, amount and a Financed flag per fee. The page ships with the Financed control switched off, so every fee typed on the page is treated as non-financed (decision 7). The engine supports both kinds | Partly covered | Replace the two fields with "Fees: a list of fees, each with a name, an amount (0 or more) and whether it is financed." Record that the page sends every fee as non-financed until the Financed option is switched on. |
| Payment amount (IN-08) | Scheduled payment, excludes taxes | Entered; must be above 0 (DEV-OQY) | Partly covered | Add "Must be greater than $0." |
| Payment frequency (IN-09) | Six values | Engine: six values. Page: four (Weekly, Bi-weekly, Semi-monthly, Monthly); the two accelerated values are hidden (B28) because they give the same result. Labels show payments per year, for example "Weekly (52/yr)". Personal loans take every frequency (DEC-B33-FREQ) | Partly covered | List the four offered values; keep BR-09 for the accelerated ones; say a personal loan may use any frequency. |
| Start date (IN-10 to IN-10d) | Disbursal date, Last payment date, Renewal date, Payment change date | Three labels: Disbursal date (New), Renewal date (Renewal), Date of change (Payment change and Variable rate payment change). "Last payment date" and "Payment change date" are merged into Date of change | Partly covered | Replace IN-10a to IN-10d with three labels: Disbursal date, Renewal date, Date of change. |
| Accrued interest (IN-11) | Mandatory for Renewal and Payment change; accepts $0.00; not shown for New | Same; also required for Variable rate payment change; must be 0 or more | Covered | Keep; add Variable rate payment change. |
| First payment date (IN-12) | First payment; Next payment date for payment change | Same labels. A semi-monthly date that is not the 15th or month-end moves forward to the next of those, with a note on screen and on the printout (DEV-OQZ) | Partly covered | Add the semi-monthly move. |
| End date (IN-13) | Maturity of the term | Same. A payment that falls on the End date is included | Covered | Keep; add "A payment on the End date is part of the term." |
| Not in v2.3 | – | Contract term: read only, from the start date, whole years and months rounded up; "Remaining contract term" for Renewal and Payment change; a "Term based on" choice when the term to the End date and to the last payment differ (DEV-OQP). Contract date and the semi-annual reference date are not asked | Partly covered | Add the Contract term as a displayed field. State that it does not change any figure. |

### §3.2 Calculated outputs

| Topic | v2.3 says | COB-ts does | Status | Proposed v3 |
|---|---|---|---|---|
| Semi-annual compounding rate (OUT-01) | Fixed mortgages: converted. Variable: the contract rate | Shown as "Calculated rate". Fixed mortgage: converted from semi-annual. Variable mortgage and personal loan: the contract rate at Monthly and Semi-monthly; converted as monthly-compounded at the 7- and 14-day frequencies (DEV-B39-M12) | Partly covered | Rename to "Calculated rate" and restate per section 4.2 below. |
| APR (OUT-02) | Per §4.1 | Per §4.1, plus the no-fee shortcut (see §4.1) | Partly covered | See §4.1. |
| Cost of borrowing amount (OUT-03) | Interest and fees over the term | Total interest plus every fee, financed or not | Covered | Keep; add "every fee counts in full." |
| Number of payments (OUT-04) | Scheduled payments over the term | Rows actually generated: stops at the End date or at payoff | Covered | Keep; add "fewer if the loan is paid off before the End date." |
| Total of all payments (OUT-05) | Sum of scheduled payments | Sum of the Payment column; a payoff row counts only what was needed | Covered | Keep; add the payoff row. |
| Total interest (OUT-06) | Interest portion across all payments | Interest charged over the term, including period interest still unpaid at the end. Prior accrued interest (IN-11) counts only as far as it is paid (OQ-W) | Partly covered | "Interest charged over the term, including any period interest not yet paid at the End date." Keep OQ-W open. |
| Total principal (OUT-07) | Principal portion across all payments | Sum of the Principal paid column | Open decision | Keep; the workbook uses total payments less total interest, which includes fees paid (OQ-R). |
| Schedule (OUT-08) | Per §3.3 | Per §3.3 with the columns in Appendix B.6 below | Partly covered | See §3.3. |
| Trigger rate (OUT-09) | Variable mortgages | Same | Covered | Keep. |
| Not in v2.3 | – | Term in days; Balance at end date; Unpaid interest at end date (only when above 0); with the Financed option on, Fees recovered through payments and Disbursal amount | Partly covered | Add these as displayed figures. |
| Display precision | Not set (§6 asks for it) | Currency 2 decimals; rates 5 decimals; no rounding inside the calculation except the per-row cent rounding of DEV-B38-ROUND | Partly covered | State the precision (see §6). |

### §3.3 Amortization schedule

| Topic | v2.3 says | COB-ts does | Status | Proposed v3 |
|---|---|---|---|---|
| Interest, principal, balance per payment | Required | Yes, plus date, days, opening balance, period interest, accrued interest opening and closing, payment and fees | Covered | Keep. |
| Separate column for financed fees against the first payment, "added to the mortgage principal" | Required | Financed fees sit inside the opening balance and are recovered through the waterfall, shown as Fees opening, Fees paid and Fees closing. These columns are hidden while the Financed option is off | Partly covered | "Fees still to recover, fees paid and fees remaining are shown per payment when financed fees are in use." Remove "added to the mortgage principal": they are already in IN-02. |
| Export | §7 | Screen table, printed table (short headings) and CSV | Covered | Keep. |

### §4.1 Cost of borrowing rate (APR)

| Topic | v2.3 says | COB-ts does | Status | Proposed v3 |
|---|---|---|---|---|
| Formula | APR = C ÷ (T × P) × 100 | Same, when there are fees | Covered | Keep. |
| No fees | Not stated | With $0 of fees the APR is the Calculated rate itself, as the macro does | Partly covered | Add: "When total fees are $0, the APR equals the Calculated rate." |
| T | Term days ÷ 365 | Actual days from the start date to the last payment row, ÷ 365 (no leap split) | Covered | Keep; say "to the last payment date" and "not split for leap years." |
| P | Average opening balance | Simple mean of each row's opening balance (includes financed fees still owed) | Open decision | Keep; the workbook uses opening principal (OQ-Q). With fees the APR can differ, for example 9.25% against 9.63%. |
| Zero-day term | Not stated | A same-day contract with fees is rejected with a message (the workbook divides by zero) | Partly covered | Add to §6. |

### §4.2 Semi-annual rate conversion

| Topic | v2.3 says | COB-ts does | Status | Proposed v3 |
|---|---|---|---|---|
| Formula | i_n = n × [(1 + i_m ÷ m)^(m ÷ n) − 1] | Same formula | Covered | Keep. |
| n for Weekly and Bi-weekly (and accelerated) | Fixed: 52 and 26 | Fixed mortgage: n = (days from the start date to the End date ÷ 7 or 14) ÷ YEARFRAC(start, end, basis 1), not 52 or 26 (DEV-B37-LEAPN, DEV-B38-ROUND). Labels still read 52/yr and 26/yr | Partly covered | Replace the frequency key for the 7- and 14-day frequencies with the leap-aware n. Keep 12 and 24 for Monthly and Semi-monthly. |
| Per-row rounding | Not stated | Fixed mortgage at the 7- and 14-day frequencies: each row's period interest is rounded to the cent (half away from zero, as Excel ROUND) before the waterfall | Partly covered | Add the rounding rule for these cases. |
| Variable-rate mortgage | No conversion (m = n) | Monthly and Semi-monthly: the contract rate. Weekly and Bi-weekly: the contract rate as monthly-compounded, converted with m = 12 and the leap-aware n (DEV-B39-M12); interest not rounded per row | Partly covered | Replace "no conversion" with the two cases. |
| Personal loans | "Monthly compounding at the contract rate (m = 12)" | Same as the variable-rate mortgage, for either rate type | Partly covered | Use the same wording as the variable-rate mortgage. |
| Appendix A link | Validation at the stated n | Still holds: Appendix A is tested at n = 1 to 52 to 1e-12 | Covered | Keep, and say Appendix A tests the formula, not the leap-aware n. |
| Legal basis | "The Bank Act convention" | Semi-annual compounding comes from the Interest Act s.6 (a federal Act that applies to every lender), not the Bank Act. s.6 requires the rate of a blended-payment mortgage to be stated yearly or half-yearly, not in advance; compounding half-yearly is the practice that satisfies it, not a mandate. s.7 makes the stated rate a ceiling | Open decision | Replace "the Bank Act convention" with "half-yearly, not in advance (Interest Act s.6)". Compliance to confirm that the leap-aware n of DEV-B37-LEAPN still gives a rate consistent with the s.6 statement (O. Reg. 108/22 s.4(2)) (Q-B37-LAW). |

### §4.3 Trigger rate

| Topic | v2.3 says | COB-ts does | Status | Proposed v3 |
|---|---|---|---|---|
| Formula | Payment × payments per year ÷ current principal | Same, with 52, 26, 24 or 12 (never the leap-aware n) and the Loan amount as current principal | Covered | Keep; add "payments per year is 52, 26, 24 or 12." |
| Scope | Variable mortgages only | Same, in every flow | Covered | Keep. |

### §4.4 Interest accrual and day count

| Topic | v2.3 says | COB-ts does | Status | Proposed v3 |
|---|---|---|---|---|
| Actual days, 365 or 366 split | Required | Same; days in a leap year ÷ 366, others ÷ 365, summed | Covered | Keep. |
| Precision | Not stated | Full precision, except the per-row cent rounding in §4.2 | Partly covered | Cross-refer to §4.2. |

### §4.5 Accrued interest treatment

| Topic | v2.3 says | COB-ts does | Status | Proposed v3 |
|---|---|---|---|---|
| Added to the first payment's interest | Required | Yes: paid before anything else, oldest first | Covered | Keep. |
| Excess carries forward | Required | Yes | Covered | Keep. |
| Interest on unpaid interest | Not stated; the workbook adds unpaid interest to the balance, where it earns interest | Unpaid interest (IN-11 and any shortfall) sits outside the balance and earns nothing (DEV-OQL). The workbook rule is built behind a switch that ships off | Partly covered | Add: "Unpaid interest is not added to the balance and does not earn interest." |
| Prior accrued interest (IN-11) in C and in P | Not stated | Counts in C only as it is paid; never in P | Open decision | Record OQ-W2, OQ-W3 and OQ-W5. |

### §5 Business rules

| Topic | v2.3 says | COB-ts does | Status | Proposed v3 |
|---|---|---|---|---|
| Rule 1 (BR-01) | Fixed mortgages: semi-annual | Same | Covered | Keep. |
| Rule 2 (BR-02) | Other products: monthly, equal to the contract rate | Equal to the contract rate at Monthly and Semi-monthly only; converted at the 7- and 14-day frequencies | Partly covered | "...use monthly compounding. At Monthly and Semi-monthly the Calculated rate is the contract rate; at Weekly and Bi-weekly it is converted per §4.2." |
| Rule 3 (BR-03) | Financed fees in principal, separate column | In the opening balance, recovered in the waterfall, shown in the fee columns | Partly covered | Reword per §3.3. |
| Rule 4 (BR-04) | Non-financed fees: not in principal, in C | Same: never in principal, never in the waterfall, counted only in C (DEV-OQS; the workbook recovers them in the waterfall) | Covered | Keep, and add "never recovered through the payments." |
| Rules 5 and 6 (BR-05, BR-06) | Accrued interest mandatory for Renewal and Payment change; hidden for New | Same | Covered | Keep. |
| Rule 7 (BR-07) | Four start-date labels | Three labels | Partly covered | Per §3.1. |
| Rule 8 (BR-08) | Trigger rate for variable mortgages | Same | Covered | Keep. |
| Rule 9 (BR-09) | Accelerated equal to regular | Same in the engine; hidden on the page | Covered | Keep; add the page note. |
| Rules 10, 11, 13 (BR-10, BR-11, BR-13) | Accrued interest, day count, waterfall order | Same | Covered | Keep. |
| Rule 12 (BR-12) | First payment date is the Next payment date for payment changes | Same label | Covered | Keep. |
| New rule | – | A personal loan may use any payment frequency (DEC-B33-FREQ) | Partly covered | Add as a new rule. |

### §6 Validation and error handling

| Topic | v2.3 says | COB-ts does | Status | Proposed v3 |
|---|---|---|---|---|
| Fee limit | Total fees less than the loan amount | Financed plus non-financed fees must be less than the loan amount | Covered | Keep. |
| Date order | First payment not before start; End after First payment | Same; the same day is allowed for start and first payment; the End date is compared with the moved semi-monthly date | Covered | Keep, with the two clarifications. |
| Non-numeric and negative values | Rejected, except where $0.00 is allowed | Rejected. Loan amount, rate and payment must be above 0; fees and accrued interest may be 0 | Partly covered | List which fields accept 0. |
| Mandatory fields | Required per use case | Same | Covered | Keep. |
| Error display | Not stated | One message at a time in the error box | Covered | Keep. |
| "Define" rounding and precision | Open | Answered: currency 2 decimals, rates 5 decimals, no intermediate rounding except DEV-B38-ROUND | Partly covered | Replace the "define" item with the rule. |
| "Define" a final payment that does not pay off the loan | Open | Answered: no last-payment adjustment. The schedule stops at the End date and shows the Balance at end date. A payoff row pays only the remaining principal | Partly covered | Replace the "define" item with the rule. |
| Zero-day term with fees | Not stated | Rejected with a message | Partly covered | Add. |

### §7 Non-functional requirements

| Topic | v2.3 says | COB-ts does | Status | Proposed v3 |
|---|---|---|---|---|
| Parity test scenarios | Required | REF-01 from the workbook, Appendix A, oracle scenarios S0 to S9 and the user's Excel examples. Still missing: a live-workbook case with fees and accrued interest | Partly covered | Keep, and list the reference cases. |
| Export or print | Required | Print or PDF, CSV | Covered | Keep. |
| Fields keep values when the use case changes | Required | Shared fields keep their values; the page only shows or hides each flow's own fields | Covered | Keep. |
| No member data stored | Required | Nothing stored | Covered | Keep. |
| Not in v2.3 | – | A Help page (this manual, the coverage report, the domain overview and this draft) | Covered | Add "Help: an in-page link to the user manual." |

### §8 Assumptions and resolved questions

| Topic | v2.3 says | COB-ts does | Status | Proposed v3 |
|---|---|---|---|---|
| Resolved questions (OQ-01 to OQ-06) | Resolved | Built as resolved | Covered | Keep. |
| New open questions | – | OQ-Q (P basis), OQ-R (principal paid), OQ-W (IN-11 in C and P), Q-B37-LAW, Q-B37-WHICH-EXCEL, the Q-B39 questions, Q-MSG (interim wording) | Open decision | Add a table of open questions. |

### Appendix A: Validation set

| Topic | v2.3 says | COB-ts does | Status | Proposed v3 |
|---|---|---|---|---|
| 3.74% at m = 2, n = 1 to 52 | Unit-test cases | Tested to 1e-12 | Covered | Keep. Add: "These values test the formula at the stated n. Weekly and Bi-weekly calculations use the leap-aware n of §4.2." |

### Appendix B: Amortization schedule logic

| Topic | v2.3 says | COB-ts does | Status | Proposed v3 |
|---|---|---|---|---|
| B.1 fees to recover | Financed plus non-financed | Financed only; non-financed fees never enter the waterfall (DEV-OQS) | Partly covered | "feesToRecover = financed fees." |
| B.1 annual rate | Contract rate, or the converter rate | Per §4.2 v3 | Partly covered | Refer to §4.2. |
| B.2 loop and stop | Stop when the date reaches or passes the End date | A row dated on the End date is included; the loop stops at the first date after it, or after payoff | Partly covered | "Stop at the first date after the End date." |
| B.2 payoff | Stop at $0.00 | Same; the payoff row's Payment is only the remaining principal | Covered | Add the payoff-row payment. |
| B.3 interest | Actual days, leap split | Same | Covered | Keep. |
| B.4 weekly and bi-weekly | Skip-date rule (fifth weekday) | Every 7 or 14 days from the first payment date. The skip-date code is unreachable in the macro (OQ-I, OQ-U) | Not covered – out of scope | Remove the skip-date rule. |
| B.4 semi-monthly | 15th and month-end | Exact port of the macro, plus the first-date move (DEV-OQZ) | Partly covered | Describe the port and the move. |
| B.4 monthly | End-of-month stepping | Same day each month, clamped to the month's last day; a month-end first date stays on month-ends (DEV-OQX; the workbook keeps the day number) | Partly covered | Replace "end-of-month stepping" with this rule. |
| B.4 One Time | Single payment | Not offered (OQ-G) | Not covered – out of scope | Remove. |
| B.5 waterfall | Interest, fees, principal | Same; principal is capped at what is owed | Covered | Add the cap. |
| B.6 columns | 14 workbook columns (B to O) | #, Date, Days, Opening balance, Fees opening, Period interest, Accrued interest opening, Payment, Interest paid, Fees paid, Principal paid, Accrued interest closing, Fees closing, Balance. No separate opening and closing principal columns; no cumulative interest column. The CSV keeps its own order | Partly covered | Replace the B to O map with the calculator's columns. |
| B.7 totals | P, T, C, APR | Per §4.1 v3 | Partly covered | Refer to §4.1. |

---

## 3. Unchanged from v2.3

Keep these as they are: §1.2 out of scope; §2 manual entry and auditability; IN-02, IN-04, IN-11 to IN-13 (with the small additions above); OUT-03 to OUT-05 and OUT-09; §4.3; §4.4; BR-01, BR-05, BR-06 and BR-08 to BR-13; Appendix A; B.3 and B.5.

---

## 4. List of changes for v3

| Change | Section | What changes | Source |
|---|---|---|---|
| V3 change 1 | §2 | Parity means "same as the workbook except the listed differences" | Coverage report section 4 |
| V3 change 2 | §1.1, §3.1 | Variable rate payment change hidden on the page; engine keeps it | User decision 2026-10-01 |
| V3 change 3 | §3.1 | Itemized fees with a Financed flag; page sends every fee as non-financed | Decision 7; Q-FEE-CSV |
| V3 change 4 | §3.1 | Start-date labels: Disbursal date, Renewal date, Date of change | Decisions 2 and 5 |
| V3 change 5 | §3.1, §5 | Renewal and Payment change accept personal loans; a personal loan takes any frequency | Decision 9 revised; DEC-B33-FREQ |
| V3 change 6 | §3.1 | Accelerated frequencies hidden; labels show payments per year | B28; OQ-V |
| V3 change 7 | §3.1, §6 | Rate and payment must be above 0 | DEV-OQAA; DEV-OQY |
| V3 change 8 | §3.1 | Semi-monthly first date moved to the 15th or month-end | DEV-OQZ |
| V3 change 9 | §3.1 | Contract term shown read-only, whole years and months, with "Term based on" | DEV-OQP |
| V3 change 10 | §3.2 | OUT-01 renamed "Calculated rate"; new figures added | User decisions |
| V3 change 11 | §3.2, §4.5 | Total interest includes unpaid period interest; unpaid interest earns nothing | DEV-OQL |
| V3 change 12 | §4.1 | APR equals the Calculated rate when fees are $0 | Workbook macro |
| V3 change 13 | §4.2 | Leap-aware n with YEARFRAC at the 7- and 14-day frequencies (fixed mortgages) | DEV-B37-LEAPN; DEV-B38-ROUND |
| V3 change 14 | §4.2 | Per-row cent rounding of period interest (fixed mortgages, 7- and 14-day) | DEV-B38-ROUND |
| V3 change 15 | §4.2, §5 | Variable mortgages and personal loans converted as monthly-compounded at the 7- and 14-day frequencies | DEV-B39-M12 |
| V3 change 16 | §3.3, B.1, §5 | Non-financed fees never enter the waterfall | DEV-OQS |
| V3 change 17 | §6 | Rounding, display precision and the final-payment rule defined | User decisions; B13 |
| V3 change 18 | B.2 | A payment on the End date is included; payoff row pays only what is owed | Workbook macro |
| V3 change 19 | B.4 | Skip-date rule and One Time removed | OQ-I; OQ-U; OQ-G |
| V3 change 20 | B.4 | Month-end monthly rule | DEV-OQX |
| V3 change 21 | B.6 | Column map replaced with the calculator's columns | OQ-J |
| V3 change 22 | §7 | Help page added | B29 |

---

## 5. Questions for the stakeholders before v3 is issued

| Question | Why it matters |
|---|---|
| Average balance basis (OQ-Q): is P the average opening balance (BRD) or the average opening principal (workbook)? | The APR with fees differs, for example 9.25% against 9.63%. |
| Total principal (OQ-R): is it the sum of principal paid, or total payments less interest? | The figure differs whenever fees are recovered through payments. |
| Prior accrued interest (OQ-W2, OQ-W3, OQ-W5): how it accrued interest counts in C and P | No workbook reference exists for this input. |
| Legal basis (Q-B37-LAW): Bank Act or Ontario credit union law for disclosure, and Interest Act s.6 for semi-annual compounding | Wording of §2 and §4.2; the calculation does not change. Needs compliance to say which entity (Alterna Savings or Alterna Bank) lends on each product, and to recheck the Ontario citation after 1 March 2027 (CUCPA 2020 s.275). |
| Workbook version (Q-B37-WHICH-EXCEL): which workbook version gave the user's examples | Names the parity reference in v3. |
| Monthly-compounded conversion (Q-B39-VAR1-CENT, Q-B39-VAR2-FREQ, Q-B39-PL-EXAMPLE, Q-B39-UNIFIED, Q-B39-ENGINES) | Confirms the monthly-compounded conversion against more Excel examples and whether the other engines follow. |
| Wording (Q-MSG): final wording of messages, hints and labels | Every on-screen text is interim until confirmed. |
| Excluded fees: should some fees stay out of C? | O. Reg. 108/22 and SOR/2021-181 exclude some fees from the cost of borrowing (for example mortgage default insurance and discharge fees). The calculator counts every fee in C (OQ-E), so C is overstated if such a fee is entered. The same regulations say principal "does not include any cost of borrowing", which bears on OQ-Q. |
| Financed option: switch it on? | Today a fee typed on the page is always non-financed, which changes the APR for a fee staff used to enter as financed. |
