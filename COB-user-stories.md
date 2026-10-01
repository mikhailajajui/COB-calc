# COB Calculator – Use Cases & User Stories

> Derived from `COB-business-requirement.md` (BRD v2.3, identical in content to `COB Requirements v2.3.docx`) on 2026-09-27.
> Every item traces back to BRD IDs (IN-xx, OUT-xx, BR-xx, §x.x). Anything the BRD does not settle is listed in **§6 Open Questions** and is not decided here.

---

## 1. Actors

| Actor | Type | Goal |
|---|---|---|
| **Lending Staff** (branch / mortgage specialist) | Primary | Produce the Cost of Borrowing disclosure values and schedule for a member's loan or mortgage. |
| **Compliance / Auditor** | Secondary | Retain and review completed calculations to confirm they follow the Bank Act COB regulations (§2). |
| **QA / Business Analyst** | Secondary | Show that the new application gives the same outputs as Excel COB Calculator v7 (§2, §7). |
| Wealthview / core banking | *Excluded* | No integration. All values are keyed in manually (§1.2). |

## 2. System Boundary

**In:** manual input capture, validation, rate conversion, amortization loop, COB/APR, trigger rate, schedule display, export/print.
**Out:** calculating the payment amount (it is entered by the user), any system integration, and any storage of member PII (§1.2, §7).

---

## 3. Use Case Model

```
                        ┌──────────────────── COB Calculator ─────────────────────┐
                        │                                                          │
                        │  UC-01 Calculate COB – New Mortgage / Loan ──┐           │
   Lending Staff ───────┤  UC-02 Calculate COB – Renewal ──────────────┤ «include» │
                        │  UC-03 Calculate COB – Payment Change ───────┼──► UC-05 Validate Inputs
                        │  UC-04 Calculate COB – Variable Rate         │  ──► UC-06 Generate Schedule & Outputs
                        │        Payment Change ───────────────────────┘           │
                        │                                                          │
   Lending Staff ───────┤  UC-07 Switch Use Case (retain shared values)            │
   Compliance ──────────┤  UC-08 Export / Print Calculation                        │
   QA / BA ─────────────┤  UC-09 Verify Parity against Excel v7                    │
                        └──────────────────────────────────────────────────────────┘
```

### Field visibility by use case

| Field | UC-01 New | UC-02 Renewal | UC-03 Payment Change | UC-04 Variable Rate Pmt Change |
|---|---|---|---|---|
| IN-02 … IN-09, IN-12, IN-13 | ✔ | ✔ | ✔ | ✔ |
| IN-03 Product Type | Any | **Mortgage only, locked** (DQ-16 ✅ 2026-09-29; delivered B21, CHANGES §50) | Any (unchanged; not asked) | Mortgage, locked (today) |
| Start Date label (IN-10) | Disbursal Date (10a) | Renewal Date (10c) | **Last Payment Date (10b)** (OQ-A ✅ 2026-09-29; delivered B22, CHANGES §51) | **Last Payment Date (10b)** (OQ-A ✅ 2026-09-29; delivered B22, CHANGES §51) |
| IN-11 Accrued Interest | **Hidden** (BR-06) | Mandatory, blank by default, $0 allowed (BR-05; delivered B20, CHANGES §49) | Mandatory, blank by default, $0 allowed (delivered B20, CHANGES §49); holds arrears only, stated in the hint (delivered B22, CHANGES §51) | Same as Payment Change (OQ-B ✅ 2026-09-29; delivered B20; hint delivered B22, CHANGES §51) |
| IN-11 field name and hint | — | Name "Accrued interest" (unchanged); hint "Interest accrued since the last payment date." (unchanged, user 2026-09-29) | Name "Accrued interest" (**unchanged**, user 2026-09-29: the rename to "Accrued interest (earlier unpaid)" was declined); hint "Only interest due at earlier payments and not yet paid (arrears), usually $0.00. Interest since the last payment date is already charged." (accepted by the user 2026-09-29 as interim wording, Q-MSG; delivered B22, CHANGES §51) | Same as Payment Change (delivered B22, CHANGES §51) |
| IN-12 label meaning | First Payment Date | First Payment Date | **Next** Payment Date (BR-12) | **Next** Payment Date (OQ-A ✅ 2026-09-29; delivered B22, CHANGES §51) |
| OUT-09 Trigger Rate | Only if Mortgage + Variable (BR-08) | same | same | same |
| Contract date, Semi-annual compounding date (not BRD inputs) | Switched off (Q-SACD ✅ 2026-09-29; delivered B24, CHANGES §56) | same | same | same |
| Contract term (not a BRD input) | Read-only result, derived from First Payment Date → last scheduled payment date (OQ-P ✅ 2026-09-29, refined 2026-09-30; delivered B24, CHANGES §56) | same | same | same |

*Rows marked "planned" describe decided behaviour that is not built yet; "delivered" rows cite the `COB-ts/CHANGES.md` entry. B24 is delivered (CHANGES §56): the Contract date, Semi-annual compounding date and typed Contract term are off the form, and the rows above marked "planned B24" now describe delivered behaviour. Delivered: Accrued interest opens blank and is mandatory for Renewal, Payment Change and VRPC (B20, CHANGES §49); Renewal is locked to Mortgage (B21, CHANGES §50); the screen labels and the Accrued interest hint follow the use case (B22, CHANGES §51); the "Unpaid interest at end date" figure is shown when above $0 (B26, CHANGES §55), with its hint reworded (B26-HINT, CHANGES §57). Planned or in progress: B29 (Help page), then B25.*

---

### UC-01 Calculate COB – New Mortgage / Loan

| | |
|---|---|
| **Primary actor** | Lending Staff |
| **Trigger** | A new loan or mortgage is being disbursed and the COB disclosure is needed. |
| **Preconditions** | The payment amount has already been worked out outside this tool (§1.2). |
| **Postconditions (success)** | OUT-01…OUT-09 are displayed as they apply. No member data is stored. |
| **Traces** | IN-01…IN-10a, IN-12, IN-13; BR-01…04, 06, 07, 09, 11, 13; §4.1–4.4; App. B |

**Main success scenario**
1. Staff selects Use Case = *New Mortgage / Loan*.
2. System shows the Start Date as **Disbursal Date** and hides Accrued Interest (BR-06, BR-07).
3. Staff enters the Loan Amount (including financed fees), Product Type, Rate Type, Contract Rate, Financed Fees, Non-Financed Fees, Payment Amount, Frequency, Disbursal Date, First Payment Date and End Date.
   *Decided 2026-09-29, delivered B23, CHANGES §52 (decisions 6, 7):* the fee table starts empty and is headed "Fees"; the Financed option is switched off, so every fee is entered as non-financed. *Delivered B24, CHANGES §56 (decision 8):* the Contract term is not typed; it is a read-only result derived from the First Payment Date to the last scheduled payment date (refined 2026-09-30, see the "Contract term refinement" row in §7.5).
4. Staff asks for the calculation.
5. System validates the inputs (**include UC-05**).
6. System works out the effective rate (§4.2), generates the schedule and computes the outputs (**include UC-06**).
7. System shows the summary outputs and the amortization schedule.

**Alternate / exception flows**
- 5a. Validation fails → the system shows field-level errors and does not calculate (§6).
- 6a. Product = Mortgage and Rate = Variable → the system also shows the Trigger Rate (BR-08).
- 6b. The loan is fully paid before the End Date → the schedule stops at payoff (App. B step 8).

### UC-02 Calculate COB – Renewal

Same as UC-01, except:
- Step 1: **Renewal is mortgage-only.** Choosing Renewal sets Product Type = Mortgage and locks it, as VRPC does (DQ-16 ✅ 2026-09-29, decision 9; delivered B21, CHANGES §50).
- Step 2: the Start Date label is **Renewal Date** (IN-10c), and **Accrued Interest is shown and mandatory**. $0.00 is allowed (BR-05). The field starts blank and a blank is rejected (decision 4; delivered B20, CHANGES §49).
- Step 6: carried accrued interest is added to the interest due on the first payment. Whatever that payment cannot absorb carries forward until it is paid off (BR-10, §4.5). It earns no interest while outstanding (decision 1; delivered B19, CHANGES §48).
- **Traces:** IN-01, IN-03, IN-10c, IN-11, BR-05, BR-10, §4.5.

### UC-03 Calculate COB – Payment Change

Same as UC-02, except:
- Loan Amount means **the balance as of the change date** (IN-02).
- ~~The Start Date label is **Payment Change Date** (IN-10d). IN-10b "Last Payment Date" is also listed for payment changes, so which label applies is unclear (**OQ-A**).~~ *Superseded 2026-09-29 (decisions 2 and 5):* the Start Date is the **Last Payment Date** (IN-10b), and the schedule charges interest from that date. No separate Payment Change Date (IN-10d) input is planned; the stakeholders were not asked whether IN-10d is still needed (decision 11: no follow-ups), so this rests on decisions 2 and 5. Delivered B22 (CHANGES §51).
- The First Payment Date field means the **Next Payment Date** (BR-12).
- ~~Accrued interest is taken *as at the change date* (IN-11).~~ *Superseded 2026-09-29 (decision 2):* Accrued Interest holds only **older unpaid interest (arrears)** at the Last Payment Date, usually $0, because the schedule already charges everything from the last payment onward. Mandatory, blank by default, $0 allowed (decision 4; delivered B20, CHANGES §49). The field keeps the name "Accrued interest" (user 2026-09-29; the rename to "Accrued interest (earlier unpaid)" was declined); its hint for Payment Change and VRPC reads "Only interest due at earlier payments and not yet paid (arrears), usually $0.00. Interest since the last payment date is already charged." (accepted by the user 2026-09-29 as interim wording, Q-MSG). Delivered B22 (CHANGES §51). With the name unchanged, the hint is the only on-screen guard against entering the interest since the Last Payment Date here, which would charge it twice (FB-16).
- **Traces:** IN-02, IN-10b, IN-11, IN-12, BR-05, BR-10, BR-12; decisions 2, 4, 5 (`COB-feedback-impact.md`).

### UC-04 Calculate COB – Variable Rate Payment Change

Listed as a use case (IN-01, §1.1), but the BRD gives it **no specific field rules**. Working assumption: it behaves like UC-03 with Rate Type = Variable, and it always shows the Trigger Rate when Product = Mortgage. ~~**Must be confirmed — OQ-A, OQ-B.**~~ *Decided 2026-09-29:* VRPC uses the same start date as Payment Change (Last Payment Date, OQ-A ✅, decisions 2 and 5; delivered B22, CHANGES §51) and Accrued Interest is mandatory, blank by default, $0 allowed (OQ-B ✅, decision 4; delivered B20, CHANGES §49), with the Payment Change hint (delivered B22, CHANGES §51).

### UC-05 Validate Inputs «include»

| Rule | Source |
|---|---|
| Every mandatory field for the selected use case is filled in before calculation is allowed. | §6 |
| Currency and rate fields reject non-numeric and negative values. $0.00 is allowed only where stated (IN-06, IN-07, IN-11). | §6 |
| Total fees < Loan Amount. | §6 (Excel macro) |
| First Payment Date ≥ Start Date. | §6 (Excel macro) |
| End Date > First Payment Date. | §6 (Excel macro) |
| *Delivered B20 (CHANGES §49):* Accrued Interest is mandatory for Renewal, Payment Change and VRPC; blank is rejected, $0.00 is accepted. | BR-05, IN-11; decision 4 (OQ-B ✅ 2026-09-29) |
| *Delivered B21 (CHANGES §50):* Renewal with Product Type = Personal Loan is rejected (Renewal is mortgage-only). | decision 9 (DQ-16 ✅ 2026-09-29) |
| *Delivered B24, CHANGES §56:* the Semi-annual compounding date is no longer required for fixed mortgages. The "term not both 0" check no longer applies to the derived term, so a contract under one month is allowed. *Resolved 2026-09-30 (Q-CT-CHECKS): the B13 zero-day COB-rate check is unchanged; the "term not both 0" check is dropped, per the architect's B24 brief. The engine's termYears / termMonths stay optional, deprecated and ignored (Q-CT-ENGINE); removal is the later item B24-CLEANUP.* | decision 8 (Q-SACD ✅, OQ-P ✅ 2026-09-29); Q-TERM-SHORT |
| *Planned B25:* a semi-monthly First Payment Date that is not the 15th or month-end is **not rejected**; it is moved forward (see US-16). How staff see the move is open (Q-SEMI-SHOW). | decision 10 (OQ-Z revised 2026-09-29) |

### UC-06 Generate Schedule & Outputs «include»

1. Work out the effective annual rate: Fixed Mortgage → semi-annual conversion with m = 2 and n from the frequency (§4.2, BR-01). Variable Mortgage → the contract rate (BR-02). Personal Loan → monthly / contract rate (BR-02, **OQ-C**; a personal loan is Monthly only, FB-24 decision 2026-09-30).
2. Initialize: openingBalance = IN-02, feesToRecover = IN-06 + IN-07, carriedAccruedInterest = IN-11 or 0 (B.1).
3. For each period: find the next date (B.4) → stop if it is past the End Date → work out actual-day interest with the leap-year split (B.3, BR-11) → add carried accrued interest → apply the payment through the waterfall: interest → fees → principal (B.5, BR-13) → write the row (B.6) → stop if the balance is $0 → move to the next period.
   *Delivered B19 (decision 1, 2026-09-29; CHANGES §48, DEV-OQL):* period interest is charged on principal only. Interest a payment doesn't cover goes to the non-interest-bearing accrued-interest bucket (with IN-11), is paid first by later payments, oldest first (IN-11 before later shortfalls, Q-W4-INT), and counts in C as interest charged. This replaces the workbook's capitalisation (OQ-L), which stays available as a policy switch (`UNPAID_INTEREST_CAPITALISED`, ships off).
4. Compute the totals: P = average of the opening balances, T = term days ÷ 365, C = interest + all fees, APR = C ÷ (T × P) × 100 (§4.1, B.7). With no fees, APR = the calculated rate (workbook rule, OQ-Q). FB-11 (whether that no-fee rule should change) is **on hold** (decision 3, 2026-09-29); today's rule is kept.
5. Trigger Rate = (Payment × n) ÷ outstanding principal, for variable mortgages only (§4.3, BR-08).

### UC-07 Switch Use Case

Staff changes IN-01 after entering data. The system shows or hides the conditional fields and relabels the Start Date. **Values in fields that both use cases share are kept** (§7 Usability). Earlier results are cleared or marked stale (to confirm).
*2026-09-29:* FB-7 (whether Product / Rate Type go back to the earlier choice after leaving a locked flow) is **parked with today's behaviour kept** (decision 11): leaving VRPC unlocks the dropdowns but leaves them on Mortgage / Variable. Since B21 (delivered, CHANGES §50), Renewal also locks Product = Mortgage, so the same applies when leaving Renewal. On-screen relabelling per use case is delivered (B22, CHANGES §51).

### UC-08 Export / Print Calculation

Staff or Compliance exports or prints the inputs, outputs and full schedule so the calculation can be kept on file (§2 Auditability, §7). The format is not specified (**OQ-J**).
*Delivered B23, CHANGES §52 (decision 7, Q-FEE-CSV, 2026-09-29):* the printout loses the fee descriptions; while Financed is switched off, the fee columns, "Fees recovered" and "Disbursal amount" are hidden on screen and print, and the CSV drops its three fee columns. *Delivered B24, CHANGES §56 (decision 8):* the Contract date and Semi-annual compounding date rows are not printed; the printed Contract term is the derived one (printout and contract-terms tile only; the CSV carries NO term, Q-CT-PRINT resolved 2026-09-30). FB-8d (whether to keep the other "More figures") is **parked with today's behaviour kept** (decision 11).

### UC-09 Verify Parity against Excel v7

QA runs a set of sample scenarios with known Excel v7 outputs through the application and compares the results within an agreed tolerance (§2, §7, App. A).

---

## 4. User Stories

Stories follow INVEST. Acceptance criteria are written in Given / When / Then. Priority uses MoSCoW.

### Epic E1 — Capture Loan Inputs

**US-01 Select use case** · *Must* · IN-01, BR-06, BR-07
As Lending Staff, I want to choose the use case (New, Renewal, Payment Change, Variable Rate Payment Change), so that I see only the fields and labels that apply to that transaction.
- **Given** the calculator is open **when** I select *New Mortgage / Loan* **then** Accrued Interest is not shown and the Start Date reads "Disbursal Date".
- **Given** I select *Renewal* **then** the Start Date reads "Renewal Date" and Accrued Interest is shown.
- ~~**Given** I select *Payment Change* **then** the Start Date reads "Payment Change Date" and the First Payment Date field reads "Next Payment Date".~~ *Superseded 2026-09-29 (OQ-A ✅, decisions 2 and 5).*
- **Given** I select *Payment Change* or *Variable Rate Payment Change* **then** the Start Date reads exactly "Last payment date" and the First Payment Date field reads exactly "Next payment date", on screen, in the contract-terms tiles and on the printout (user 2026-09-29). *Delivered (B22, CHANGES §51).*
- **Given** I select any use case **then** the on-screen start-date and first-payment-date labels match the printout labels for that use case. *Delivered (B22, CHANGES §51).* (Before B22 the screen always read "Renewal date" / "First payment date" for existing-loan flows and only the printout followed the use case.)
- **Given** I select *Renewal* **then** Product Type is set to Mortgage and locked. *Delivered (B21, CHANGES §50), DQ-16 ✅ 2026-09-29, decision 9.*

**US-02 Enter core loan terms** · *Must* · IN-02…IN-05, IN-08, IN-09
As Lending Staff, I want to enter the loan amount, product type, rate type, contract rate, payment amount and payment frequency, so that the calculator has the terms it needs.
- The Product dropdown offers exactly {Personal Loan, Mortgage}. The Rate Type dropdown offers {Variable, Fixed}.
- The Frequency dropdown offers {Weekly, Accelerated Weekly, Bi-weekly, Accelerated Bi-weekly, Semi-monthly, Monthly}. *(UI part superseded 2026-09-30, see the row "Accelerated frequencies hidden" in §7.5: the dropdown no longer offers the two accelerated options while the switch is off; engine unchanged; planned as a new B-item, architect to number it.)*
- The Payment Amount is entered by the user. The system never derives it (§1.2).

**US-03 Enter financed and non-financed fees** · *Must* · IN-06, IN-07, BR-03, BR-04
As Lending Staff, I want to enter financed and non-financed fees separately, so that the cost of borrowing includes both and only financed fees count as principal.
- Both fields accept $0.00.
- **Given** financed fees of $X **then** they are *not* added to the Loan Amount again, because IN-02 already includes them (BR-03). (**OQ-D**)
- **Given** non-financed fees of $Y **then** $Y is included in C and is not added to principal (BR-04).
- *Decided 2026-09-29 (decisions 6, 7; Q-FEE-CSV):*
  - **Given** the calculator opens **then** the fee table is empty (no sample fees). *Delivered (B23, CHANGES §52).*
  - **Given** the Financed switch is off (the decided setting) **then** no Financed option is shown, the fee table is headed "Fees", every fee is sent as non-financed, and the fee columns, "Fees recovered", "Disbursal amount" and the CSV fee columns are hidden. *Delivered (B23, CHANGES §52).* The engine's financed-fee path (criterion 2) is kept and still tested with the switch on.
  - **Given** a printout **then** it carries no fee-type descriptions. *Delivered (B23, CHANGES §52).*
- FB-9a / FB-18 (how non-financed fees are treated in the payments) are **parked with today's behaviour kept** (decision 11): OQ-S stands, so fees stay out of principal and the waterfall and count only in C.

**US-04 Enter term dates** · *Must* · IN-10…IN-13, BR-12
As Lending Staff, I want to enter the start date, first (or next) payment date and end date, so that interest is worked out on the real calendar.
- The Start Date label follows the use case (US-01).
- For Payment Change, the First Payment Date is treated as the Next Payment Date (BR-12). *From B22 the same applies to VRPC (OQ-A ✅ 2026-09-29).*
- *Decided 2026-09-29 (decision 8; OQ-P ✅, Q-SACD ✅; Q-TERM-SHORT):*
  - **Given** any use case **then** the Contract date and the Semi-annual compounding date are not shown, not printed and not required. *Delivered (B24, CHANGES §56).*
  - ~~**Given** a Start Date and an End Date **then** the Contract term is a read-only field showing Start Date → End Date in years and months, with leftover days shown.~~ *Superseded for the start and end points 2026-09-30 ("Contract term refinement", §7.5):*
  - **Given** a calculated schedule **then** the Term years / Term months inputs are gone and ONE read-only field labelled "Contract term" shows the term from the **First Payment Date** to the **last scheduled payment date** (the date of the last payment row, on or before the End Date; not the typed End Date) in years, months and leftover days (e.g. REF-01, sold as "3 years": "2 years, 11 months, 17 days", not a rounded "3 years"; Q-CT-START confirmed literally 2026-09-30). It is a result of the calculation, not an input. The field is **blank until a schedule exists and is cleared after a failed calculation** (Q-CT-EMPTY, resolved 2026-09-30). For a semi-monthly first date moved forward by B25, the term starts at the **moved** date (Q-CT-B25). "Term in days" stays unchanged beside it. The months / leftover-days split is the convention in `COB-architecture.md` B24 brief, item B24-R1 (Q-CT-SPLIT); it is not restated here. *Delivered (B24, CHANGES §56).*
  - **Given** First Payment Date → last scheduled payment date is under one month **then** the calculation is allowed and the term reads e.g. "0 years, 0 months, 20 days". *Delivered (B24, CHANGES §56).*
  - The End Date stays mandatory and drives the schedule and T (IN-13; FB-12 confirmed).

**US-05 Enter accrued interest** · *Must* · IN-11, BR-05, BR-06
As Lending Staff renewing or changing a loan, I want to enter unpaid accrued interest, so that the schedule recovers it.
- The field is mandatory for Renewal and Payment Change. $0.00 is valid. Blank is not valid. *Met since B20 (CHANGES §49).*
- The field is not shown for New Mortgage / Loan.
- *Decided 2026-09-29 (OQ-B ✅, decision 4):* **Given** Renewal, Payment Change **or VRPC** **then** the field starts blank, a blank is rejected by the UI and the engine, and $0.00 is accepted. *Delivered (B20, CHANGES §49); the blank-field message is interim (Q-MSG).*
- *Decided 2026-09-29 (decision 2):* **Given** Payment Change or VRPC **then** the field means older unpaid interest (arrears) at the Last Payment Date, usually $0, and its hint reads exactly "Only interest due at earlier payments and not yet paid (arrears), usually $0.00. Interest since the last payment date is already charged." (wording accepted by the user 2026-09-29; interim under Q-MSG). *Delivered (B22, CHANGES §51).*
- *Decided 2026-09-29 (user):* **Given** any use case that shows the field **then** its name is "Accrued interest" on the form, the contract-terms tiles and the printout (unchanged; the proposed "Accrued interest (earlier unpaid)" was declined). **Given** Renewal **then** the hint stays "Interest accrued since the last payment date." *Unchanged by B22.*

**US-06 Be told about invalid inputs** · *Must* · §6
As Lending Staff, I want clear field-level errors before calculation, so that I never get an invalid disclosure.
- **Given** a negative or non-numeric currency or rate value **then** the field is rejected with a message.
- **Given** (financed + non-financed fees) ≥ Loan Amount **then** calculation is blocked with the message "Total Fees must be less than the Loan Amount" (workbook macro, OQ-M ✅). *Interim (Q-MSG interim, 2026-09-27): the engine currently says "total fees (financed + non-financed) (X) must be less than loanAmount (Y)". The final wording is still open under Q-MSG.*
- **Given** First Payment Date < Start Date **or** End Date ≤ First Payment Date **then** calculation is blocked.
- **Given** any mandatory field for the use case is empty **then** the Calculate action is disabled or rejected.

**US-07 Switch use case without re-typing** · *Should* · §7
As Lending Staff, I want to change the use case without losing values I've already entered, so that I can correct a wrong selection quickly.
- **Given** I entered the Loan Amount and Rate under *New* **when** I switch to *Renewal* **then** those values are kept, and Accrued Interest appears empty. *Accrued interest opens blank since B20 (CHANGES §49). Not verified here: that a value typed in Accrued interest before switching flows is cleared or kept (FB-7 is parked).*
- FB-7 (restore Product / Rate Type after leaving a locked flow) is **parked with today's behaviour kept** (decision 11). See UC-07.

### Epic E2 — Calculate Cost of Borrowing

**US-08 Apply the correct compounding convention** · *Must* · OUT-01, BR-01, BR-02, BR-09, §4.2, App. A
As Lending Staff, I want the contract rate converted according to the product and rate type, so that interest follows the Bank Act conventions.
- **Given** Fixed Mortgage, 3.74 %, Monthly **then** the effective nominal rate = 3.7111878328753178 % (App. A). The same check applies to every row of App. A.
- **Given** Accelerated Weekly **then** n = 52, identical to Weekly. **Given** Accelerated Bi-weekly **then** n = 26 (BR-09). *(Engine behaviour unchanged. The UI no longer offers these two options while hidden; superseded for the UI by the 2026-09-30 decision, §7.5.)*
- n comes from the frequency key: Weekly 52 · Accelerated Weekly 52 · Bi-weekly 26 · Accelerated Bi-weekly 26 · Semi-monthly 24 · Monthly 12 (OQ-C ✅).
- **Given** Fixed Mortgage (workbook rate type `SEMI-ANNUAL`) **then** rate = n × [(1 + i/2)^(2/n) − 1] for the selected frequency.
- **Given** a Variable Mortgage or any Personal Loan (workbook rate type `MONTHLY`) **then** the effective rate = the contract rate as entered, **not converted** (a Variable Mortgage at any frequency; a Personal Loan at Monthly only). (FB-24, decided 2026-09-30: a personal loan may only be Monthly, so this unconverted-rate rule now matters for personal loans only at Monthly. See the "FB-24 decision" and "B27 answers" rows in §7.5.)

**US-09 Compute interest on actual days** · *Must* · BR-11, §4.4, B.3
As Lending Staff, I want each period's interest based on the actual calendar days, so that short or long first periods are correct.
- **Given** a period entirely within a non-leap year **then** interest = bal × rate × days ÷ 365.
- **Given** a period that spans into or out of a leap year **then** interest = bal × rate × (d365 ÷ 365 + d366 ÷ 366).

**US-10 Apply accrued interest to early payments** · *Must* · BR-10, §4.5
As Lending Staff, I want past accrued interest recovered from the first payment(s), so that the schedule shows the member's real principal reduction.
- **Given** accrued interest ≤ the interest capacity of payment 1 **then** payment 1's interest portion goes up by that amount and its principal portion goes down by the same amount. The payment total is unchanged.
- **Given** accrued interest > the capacity of payment 1 **then** the remainder carries to payment 2, 3, … until it is paid off.
- **Given** accrued interest is outstanding **then** it is not charged interest (OQ-W1, decided 2026-09-29, decision 1). *Delivered as the general rule (B19, CHANGES §48, DEV-OQL).*
- **Given** IN-11 accrued interest and a later period shortfall are both outstanding **then** a payment pays the IN-11 amount first, then the shortfall (oldest first; OQ-W4 / Q-W4-INT ✅ 2026-09-29). *Delivered (B19, CHANGES §48).*
- Whether entered accrued interest counts in C only as it is paid (OQ-W2, FB-25 W2) is **parked with today's behaviour kept** (decision 11: counted as it is paid). OQ-W3 (in P?) and OQ-W5 (worked examples) are **still open**: no decision covers them (F43). See §7.4.

**US-11 Allocate each payment interest → fees → principal** · *Must* · BR-13, B.5
- **Given** a payment **then** interest due is paid first, then outstanding fees, then principal gets whatever is left.
- ~~**Given** the payment is less than the interest due **then** the unpaid interest carries forward, stays in the Loan balance, and earns interest in the next period (workbook behaviour, OQ-L ✅).~~ *Superseded 2026-09-29 by decision 1 (FB-14, FB-29): "no interest on unpaid interest". It was today's behaviour (T6) until B19 was delivered (CHANGES §48), and stays available as the workbook branch of the engine switch `UNPAID_INTEREST_CAPITALISED` (ships off).*
- **Given** the payment is less than the interest due **then** the unpaid interest goes to a separate accrued-interest bucket that is not in the Loan balance and earns no interest; period interest is charged on principal only. *Delivered (B19, CHANGES §48), DEV-OQL.*
- **Given** unpaid interest is in the bucket **then** later payments pay it first, as interest, oldest first (IN-11 before later shortfalls, Q-W4-INT). *Delivered (B19, CHANGES §48).*
- **Given** period interest was charged but not paid by the end of the schedule **then** it still counts in C as interest charged (FB-25; fixes QA finding F-1). *Delivered (B19, CHANGES §48).*

**US-12 See the Cost of Borrowing rate and amount** · *Must* · OUT-02, OUT-03, §4.1, B.7
As Lending Staff, I want the APR and the COB dollar amount, so that I can complete the regulatory disclosure.
- C = total interest accrued over the term + financed fees + non-financed fees (all fees in full) (OQ-E ✅).
- P = average **opening principal** (schedule column E, which excludes fees and unpaid interest). The BRD says "opening balances", so see **OQ-Q**. T = (last payment date − start date) ÷ 365.
- APR = C ÷ (T × P) × 100.
- **Given** financed + non-financed fees = 0 **then** APR = the calculated rate (workbook shortcut, **OQ-Q**). *FB-11 (should this change?) is **on hold** (decision 3, 2026-09-29); this criterion stays as is until the user settles it.*
- No rounding is applied during the calculation. Currency is displayed to 2 decimals and rates to 4 (OQ-H ✅).

**US-13 See payment totals** · *Must* · OUT-04…OUT-07
As Lending Staff, I want the number of payments, total of all payments, total interest and total principal, so that I can explain the loan to the member.
- Each total equals the sum of its column in the schedule.
- ⚠ In the workbook, "Principle Paid" = Total Payments − Total Interest, which also counts fees paid (**OQ-R**).
- *Decided 2026-09-29 (user, Q-B19-ENDACC = yes):* **Given** interest is still unpaid after the last payment on or before the End Date (the last schedule row's accrued-interest closing amount is above $0) **then** the on-screen and printed figures show that amount as its own line; **given** it is $0 **then** no line is shown. *Delivered B26 (CHANGES §55, QA PASS WITH NOTES 2026-09-30); the hint reword below is delivered as B26-HINT (CHANGES §57).* The amount is the whole unpaid-interest bucket (entered accrued interest not yet paid plus period interest not yet paid, B19). *Label and hint decided by the user 2026-09-29:* the line is labelled **"Unpaid interest at end date"** with the hint ~~"Owed in addition to the balance at end date"~~ *(superseded 2026-09-30, see "B26 hint reword", §7.5)* **"Unpaid after the last payment; interest since then is not included"**; wording stays interim under Q-MSG like other messages.

**US-14 See the trigger rate for variable mortgages** · *Must* · OUT-09, BR-08, §4.3
As Lending Staff, I want the trigger rate on variable-rate mortgages, so that I can tell the member when their payments stop covering the interest.
- **Given** Mortgage + Variable **then** Trigger Rate % = (Payment × n ÷ Loan Amount IN-02) × 100 (OQ-F ✅). Example: 465.46 × 52 ÷ 227,829.65 × 100 = 10.62 %.
- **Given** any other product or rate combination **then** the Trigger Rate is not shown.

### Epic E3 — Amortization Schedule

**US-15 View the per-payment schedule** · *Must* · OUT-08, §3.3, B.2, B.6
As Lending Staff, I want a row-by-row schedule, so that I can show how each payment is split.
- The columns are Pymt #, Payment Date, Loan / Principal / Fees (Opening), New Int, Total Int, Payment, Interest / Fees / Principal Paid, and Fees / Principal / Loan (Closing) (B.6).
- Each row's closing balance = the next row's opening balance.
- *Delivered (B19, CHANGES §48):* the Balance columns no longer include unpaid interest; it shows in the accrued-interest columns (decision 1).
- *Delivered (B23, CHANGES §52):* while Financed is switched off, the fee columns are hidden on screen, in print and in the CSV (decision 7, Q-FEE-CSV). FB-6 (keep today's columns otherwise) is confirmed.
- The schedule stops at the End Date or at payoff, whichever comes first. A payment that falls **on** the End Date is included. Payments stop only when the next date is **after** the End Date (OQ-K ✅).
- **Given** the payment amount is more than the principal still owed **then**, as in the workbook, that row's interest and fees are paid normally, Principal Paid = the remaining principal, the row's **Payment column shows only the remaining principal**, and Total Payments adds that same figure. The loan closes at $0.00 (OQ-K / OQ-T ✅, decision 2026-09-27: keep the workbook behaviour).

**US-16 Generate payment dates by frequency** · *Must* · B.4
As Lending Staff, I want payment dates that follow the chosen frequency rules, so that the dates match the Excel workbook.
- **Payment #1 is always on the First Payment Date**, for every frequency. Its interest runs from the Start Date to the First Payment Date (OQ-I ✅).
- Weekly / Accelerated Weekly: the previous payment date + 7 days.
- Bi-weekly / Accelerated Bi-weekly: the First Payment Date + 14 × k days.
- Monthly (**decision 2026-09-27, OQ-X**): if the First Payment Date is the **last day of its month**, every payment falls on the last day of its month (Apr 30 → May 31 → Jun 30; Feb 28 → Mar 31). Otherwise, every payment keeps the First Payment Date's day of the month, clamped to month-end when the month is shorter (Jan 30 → Feb 28 → Mar 30). Each date is counted from the First Payment Date, not from the previous payment.
- Monthly rule confirmed by the stakeholders 2026-09-29 (FB-2a, decision 10).
- ~~Semi-monthly: pairs 15th ↔ end of month, or day d ↔ d + 15 (workbook `getNextSemiMonthly`).~~ *Superseded 2026-09-29 (decision 10, OQ-Z revised). This is today's behaviour until B25 is delivered.*
- Semi-monthly: payments fall on the 15th and the last day of the month. **Given** a First Payment Date on any other day **then** it is moved forward to the next 15th or month-end, and payment #1 falls on that date; later payments alternate 15th ↔ month-end. *Planned (B25), DEV-OQZ.* How the moved date is shown to staff is **open** (Q-SEMI-SHOW, asked before B25's UI part).
- **No skip-date rule.** It is commented out in the workbook.

### Epic E4 — Record & Compliance

**US-17 Export / print a calculation** · *Must* · §2, §7
As Compliance, I want to export or print the inputs, outputs and schedule, so that the calculation can be kept on the member file.
- The output includes every input, every displayed output, and the full schedule.
- *Delivered B23 (CHANGES §52) and B24 (CHANGES §56):* inputs and outputs that are switched off (Financed option, fee columns, "Fees recovered", "Disbursal amount", Contract date, Semi-annual compounding date) are left out; the printout has no fee descriptions; the CSV drops the fee columns while Financed is off (decisions 7, 8; Q-FEE-CSV).

**US-18 No PII persisted** · *Must* · §1.2, §7
As Compliance, I want the tool to store no member personal information, so that it does not become a system of record.
- After the session closes, no input values remain on the server. (Whether the browser may keep draft inputs is to be confirmed.)

### Epic E5 — Parity & Quality

**US-19 Parity regression suite** · *Must* · §2, §7, App. A
As QA, I want automated tests that run reference scenarios against Excel v7 outputs, so that any drift from the workbook is caught.
- The App. A rate table passes to full double precision.
- At least one reference scenario per use case × product × rate type × frequency matches Excel to the agreed rounding.
- Reference case REF-01 (§7.3), saved in the workbook, reproduces 156 payments, COB = 22,514.11 and APR = 3.7068 %.

---

## 5. Traceability Matrix

| BRD item | Stories / UCs | Decisions of 2026-09-29 that change it (B-item; B19–B22 delivered, CHANGES §48–§51; the rest planned) |
|---|---|---|
| IN-01 | US-01, UC-01…04, UC-07 | Renewal mortgage-only, DQ-16 (B21, delivered); FB-7 parked |
| IN-02…IN-05, IN-08, IN-09 | US-02, US-08 | IN-03 locked for Renewal (B21, delivered); FB-24 decided 2026-09-30 (Monthly only for personal loans, all flows, engine rejects as a fixed rule with no switch; B27 planned, not built) |
| IN-06, IN-07, BR-03, BR-04 | US-03, US-12, US-17 | Financed switched off, no sample fees, no print descriptions (B23, delivered, CHANGES §52); FB-9a/18 parked; FB-11 on hold |
| IN-10…IN-13, BR-07, BR-12 | US-01, US-04, UC-03, UC-04 | Labels per use case, PC/VRPC start = Last Payment Date, OQ-A (B22, delivered); term derived from the dates, OQ-P (B24, delivered, CHANGES §56) |
| IN-11, BR-05, BR-06, BR-10, §4.5 | US-05, US-10, UC-02, UC-03 | Mandatory incl. VRPC, OQ-B (B20, delivered); arrears only for PC/VRPC, hint text, name unchanged (B22, delivered); no interest, oldest first, OQ-W1/W4 (B19, delivered); W2 parked; W3, W5 open |
| OUT-01, BR-01, BR-02, BR-09, §4.2, App. A | US-08, US-19 | — |
| OUT-02, OUT-03, §4.1, B.7 | US-12 | Unpaid interest counts in C as charged (B19, delivered); FB-11 on hold |
| OUT-04…OUT-07 | US-13 | Unpaid interest left at the end shown as a figure when above $0, Q-B19-ENDACC (B26, delivered CHANGES §55; hint reworded 2026-09-30, B26-HINT delivered CHANGES §57) |
| OUT-08, §3.3, B.2, B.6 | US-15, US-17 | Balance excludes unpaid interest (B19, delivered); fee columns hidden while Financed is off (B23, delivered, CHANGES §52) |
| OUT-09, BR-08, §4.3 | US-14 | — |
| BR-11, §4.4, B.3 | US-09 | — |
| BR-13, B.5 | US-11 | No interest on unpaid interest, OQ-L revised (B19, delivered) |
| B.4 | US-16 | Semi-monthly first date moved forward, OQ-Z revised (B25); Q-SEMI-SHOW open |
| §6 | US-06, UC-05 | New checks from B20 and B21 (delivered) and B24 (delivered, CHANGES §56); B25 moves rather than rejects |
| §7 | US-07, US-17, US-18, US-19 | FB-7 parked; print/CSV changes (B23 delivered, CHANGES §52; B24 delivered, CHANGES §56) |
| *Not in the BRD:* Contract date, Semi-annual compounding date, Contract term | US-04, US-17 | Switched off / derived, Q-SACD and OQ-P (B24, delivered, CHANGES §56) |

Every IN, OUT and BR item is covered by at least one story.

---


## 6. Open Questions: Gaps to Settle Before Development

Each gap quotes the requirements **word for word**, taken from `COB Requirements v2.3.docx` (§ = section, IN / BR / B.x = requirement ID). The quotes show exactly where the text is silent or contradicts itself. **"Check in workbook"** says where to look in the original COB Calculator v7 workbook or macro so the missing rule can be transcribed.

Priority: 🔴 changes calculated numbers · 🟠 changes which fields are shown or the flow · 🟡 presentation only.

*Status of each question is in §7.1. The questions below are kept as asked; items settled on 2026-09-29 carry a "Decided" line under their heading instead of losing their original text.*

---

### OQ-A 🟠 Which Start Date label belongs to which use case? — ✅ Decided 2026-09-29

> **Decided 2026-09-29** (`COB-feedback-impact.md`, decisions 2 and 5; FB-3, FB-16). New → Disbursal Date; Renewal → Renewal Date; **Payment Change and VRPC → Last Payment Date** (IN-10b), with the First Payment Date field reading Next Payment Date. The screen labels follow the use case, as the printout does. **Delivered B22** (CHANGES §51). *User answers 2026-09-29 for B22:* the Payment Change / VRPC labels are exactly "Last payment date" and "Next payment date"; the field name "Accrued interest" stays unchanged in every flow; the Payment Change / VRPC Accrued interest hint is "Only interest due at earlier payments and not yet paid (arrears), usually $0.00. Interest since the last payment date is already charged." (interim, Q-MSG); Renewal is unchanged.

> **IN-01:** "One of: New Mortgage / Loan; Renewal; Payment Change; Variable Rate Payment Change."
>
> **IN-10b** Last Payment Date: "Payment changes only."
>
> **IN-10d** Payment Change Date: "Payment change only – the date the change is made effective on the banking system."
>
> **IN-10c** Renewal Date: "Renewed mortgages only."
>
> **BR-07:** "The Start Date label is rendered conditionally based on the selected use case (Disbursal / Last Payment / Renewal / Payment Change Date)."

**Gap:** There are four use cases and four labels, but two labels (10b and 10d) both point to "payment change". *Variable Rate Payment Change* is not assigned a label at all.
**Question:** Is it *Payment Change → Payment Change Date* and *Variable Rate Payment Change → Last Payment Date*, or some other mapping?
**Check in workbook:** the label and visibility logic on the Calculator sheet for each use-case dropdown value.

### OQ-B 🟠 Does Variable Rate Payment Change need Accrued Interest? — ✅ Decided 2026-09-29

> **Decided 2026-09-29** (`COB-feedback-impact.md`, decision 4; FB-4, FB-17). Yes. Accrued Interest is shown and mandatory for Renewal, Payment Change and VRPC, blank by default, $0.00 allowed. **Delivered B20** (CHANGES §49, QA PASS).

> **IN-11:** "Mandatory for Renewal (as at renewal) and Payment Change (as at change date); accepts $0.00. Not rendered for New Mortgage."
>
> **BR-05:** "Accrued interest is a mandatory input for Renewal and Payment Change use cases and must accept $0.00."
>
> **B.1** carriedAccruedInterest: "Accrued Interest (IN-11) for Renewal / Payment Change; 0 for New Mortgage."

**Gap:** *Variable Rate Payment Change* never appears in any rule about accrued interest. We can't tell whether to show it, whether it is mandatory, or whether it defaults to 0.
**Check in workbook:** whether the Accrued Interest cell is shown or hidden for that dropdown value.

### OQ-C 🔴 Which rate goes into the calculation for personal loans and variable mortgages?

> **IN-04:** "Variable or Fixed. Fixed-rate mortgages compound semi-annually; all other products compound monthly."
>
> **OUT-01:** "For variable-rate products this equals the contract rate; all non-mortgage products use monthly compounding."
>
> **§4.2:** "Variable-rate mortgage: no conversion – the effective rate equals the contract rate (m = n)."
>
> **§4.2:** "All other products (e.g., personal loans): use monthly compounding at the contract rate (m = 12)."
>
> **BR-02:** "All other products including variable-rate mortgages and all personal loan products use monthly compounding, which equals the contract rate."
>
> **B.1** annualRate: "The Calculated Rate: for MONTHLY rate type = contract rate; otherwise the equivalent rate for the payment frequency from the Semi-Annual Rate Converter (Section 4.2)."

**Gaps:**
1. B.1 refers to a "MONTHLY rate type", but IN-04 only offers "Variable or Fixed". No such value exists.
2. "(m = 12)" suggests the §4.2 formula is applied with m = 12, which changes the rate for weekly or bi-weekly payments. "which equals the contract rate" says no conversion happens. These give different numbers.
3. A **Fixed-rate Personal Loan** could be read as semi-annual (it is "Fixed") or monthly (it is "not a mortgage").

**Question:** For each Product × Rate Type combination, what exact rate does the loop use: the contract rate as entered, or a converted rate (and if converted, with which m)?
**Check in workbook:** the macro line that sets the Calculated Rate, and the condition that decides between "MONTHLY" and anything else.

### OQ-D 🔴 Are financed fees counted twice?

> **IN-02:** "The total loan amount, inclusive of any financed fees."
>
> **IN-06:** "they form part of the principal loan amount. Already included in the IN-02 total, and captured here separately so they can be shown against the first payment."
>
> **BR-03:** "they are already included in the Mortgage/Loan Amount (IN-02) and are shown in a separate column against the first payment."
>
> **§3.3:** "A separate column for financed fees applied to the first payment. This value is added to the mortgage principal."
>
> **B.1** openingBalance: "Initialized to the Mortgage/Loan Amount (IN-02), inclusive of financed fees."
>
> **B.1** feesToRecover: "Financed Fees (IN-06) + Non-Financed Fees (IN-07). Recovered within the payment waterfall."
>
> **B.5:** "feesPaid  = min(remaining, feesToRecover)" … "closingBalance = openingBalance - principalPaid"

**Gaps:**
1. Financed fees are already inside `openingBalance`. They are also in `feesToRecover`, which each payment pays off *before* principal. Taken literally, the member repays those fees twice: once as fees and again as part of principal.
2. §3.3 says the fees are "added to the mortgage principal", while BR-03 says they are "already included". Does the system add them, or not?

**Question:** In the workbook, is the opening loan balance the IN-02 amount, or IN-02 minus the financed fees? Does `feesToRecover` really include the financed fees?
**Check in workbook:** the macro's initialization of the opening balance and fees variables, plus a sample schedule's first row (Loan / Principle / Fees opening columns D, E, F).

### OQ-E 🔴 Cost of borrowing amount: fees paid, or all fees?

> **OUT-03:** "Sum of all interest and fees paid over the term."
>
> **B.7:** "Cost of Borrowing amount (C): total interest paid + total fees (financed and non-financed)."

**Gap:** When the term ends before the waterfall has recovered all the fees, "fees paid" is less than "total fees", and C and the APR come out differently.
**Check in workbook:** the cell or macro line that totals C, and whether it sums column K (Fees Paid) or adds IN-06 + IN-07.

### OQ-F 🔴 Trigger rate: which principal, and in what units?

> **§4.3:** "Trigger Rate = ( Payment Amount × Payments Per Year ) ÷ Current Outstanding Principal"
>
> **OUT-09:** "The rate at which interest exceeds principal in a payment."
>
> **BR-08:** "The Trigger Rate is calculated and displayed for variable-rate mortgages only."

**Gaps:** "Current Outstanding Principal" isn't defined: it could be IN-02, the opening balance of payment 1, or something else. The formula gives a fraction, and we don't know if it's shown ×100 as a percentage. BR-08 says "variable-rate **mortgages**", but IN-04 also lets a user pick Variable for a personal loan.
**Check in workbook:** the Trigger Rate cell formula and its number format.

### OQ-G 🟠 "One Time" frequency

> **IN-09:** "Weekly, Accelerated Weekly, Bi-weekly, Accelerated Bi-weekly, Semi-monthly, or Monthly."
>
> *(2026-09-30: the tool's dropdown no longer lists the two accelerated options; the engine still accepts them. See §7.5.)*
>
> **B.4:** "One Time | nextDate = firstPymtDate (single payment)."
>
> **§4.2** frequency key lists no n for One Time.

**Gap:** "One Time" appears in the date rules but not in the dropdown, and it has no n value, which §4.2 needs for the rate conversion and §4.3 needs for the trigger rate.
**Question:** Is it in scope? If so, what is n?
**Check in workbook:** the frequency dropdown's list source.

### OQ-H 🔴 Rounding and display precision

> **§6:** "Define currency rounding (recommend 2 decimal places) and rate display precision (recommend a consistent number of decimals, e.g., 3–5) to guarantee parity with the Excel outputs."

**Gap:** This is written as a task, not a rule. We need to know whether amounts are rounded **on every schedule row** (so later rows use rounded balances) or **only when displayed**. That choice changes the totals and the APR.
**Check in workbook:** any `Round(...)` calls in the macro loop, and the number formats on the schedule and output cells.

### OQ-I 🔴 Payment-date rules

> **B.2 step 1:** "Determine the next payment (closing) date from the current startDate, based on payment frequency (see B.4)."
>
> **B.4 Weekly:** "getNextWeekly(startDate); if the result is a skip date, advance one more week."
>
> **B.4 Bi-weekly:** "getNextBiweekly(firstPymtDate, startDate); if the result is a skip date, advance one more bi-weekly period."
>
> **B.4 Semi-monthly:** "Alternates around the 15th and end-of-month; if the current day is on/after the 15th, the next date is the 15th of the following month; otherwise the next 15th (not past end-of-month)."
>
> **B.4 Monthly:** "getNextEOM(startDate) – end-of-month stepping."
>
> **B.4 Skip-date rule:** "where a month contains five occurrences of the same weekday, the fifth is flagged as a “skip date”; if a computed payment date lands on a skip date, the scheduler advances to the next eligible date."

**Gaps:**
1. **The first payment date is ignored.** Step 1 works out every date from `startDate`. Only Bi-weekly and One Time use `firstPymtDate`. For Weekly, Semi-monthly and Monthly, we can't tell how the user's First Payment Date (IN-12) becomes payment #1.
2. **Semi-monthly never reaches end of month.** The rule says it "alternates around the 15th and end-of-month", but both branches it describes land on a 15th.
3. **Monthly always lands on month-end.** If the First Payment Date is the 10th, do later payments go to the 30th/31st or stay on the 10th?
4. **Skip dates:** "advance one more week" (Weekly) and "the next eligible date" (general rule) may differ. Skipping the fifth weekday also means the member pays fewer payments than 52 a year, so this needs a worked example.

**Check in workbook:** the full VBA code of `getNextWeekly`, `getNextBiweekly`, `getNextEOM`, the semi-monthly branch, and the skip-date function. Also check how the macro sets the first closing date.

### OQ-J 🟡 Export format

> **§2:** "Inputs and results should be exportable/printable so a completed calculation can be retained on file."
>
> **§7:** "Allow the completed calculation (inputs, outputs, and schedule) to be exported or printed for retention on file."

**Gap:** The format (PDF, Excel, CSV, print view) and the layout are not specified.

### OQ-K 🔴 What happens at the end of the term and on the last payment?

> **B.2:** "The loop exits when the term (End Date) is reached or the loan is fully paid off."
>
> **B.2 step 2:** "If the closingDate reaches/passes the End Date, stop generating further payments."
>
> **B.2 step 8:** "Payoff check – exit condition. If the closingBalance reaches $0.00, stop – the loan is fully paid."
>
> **§6:** "Define behaviour when the final scheduled payment does not fully amortize the balance (rounding/last-payment adjustment; see Appendix B, Step 8)."

**Gaps:**
1. "Reaches/passes": if a payment falls exactly **on** the End Date, it is excluded, which sounds unlikely for a maturity payment.
2. §6 points to Step 8 for the last-payment adjustment, but Step 8 only checks for $0.00. It never says what happens when the last payment is **more** than the remaining balance (principalPaid would push the balance negative) or **less** than it (a balance remains at maturity).
3. B.7 term T uses "the final closing date". If the loop stopped because of the End Date, is that the last payment's date or the End Date itself?

**Check in workbook:** the exit condition in the loop (`>=` or `>`), and any adjustment the macro makes to the final payment row.

### OQ-L 🔴 What happens to interest the payment doesn't cover? — ✅ Revised 2026-09-29

> **Resolved 2026-09-27** as "capitalised, as the workbook does" (§7.1, T6). **Superseded 2026-09-29** (`COB-feedback-impact.md`, decision 1 and follow-up Q-W4-INT; FB-14, FB-29): no interest on unpaid interest. Unpaid period interest goes to a separate non-interest-bearing accrued-interest bucket, paid first by later payments, oldest first (IN-11 before later shortfalls), and counted in C as interest charged. Engine switch with the workbook branch kept. **Delivered B19** (DEV-OQL; CHANGES §48, QA PASS WITH NOTES).

> **B.2 step 4:** "totalInterestDue = periodInterest + carriedAccruedInterest. (Any accrued interest not recovered this period remains carried forward.)"
>
> **B.2 step 6:** "Reduce feesToRecover by feesPaid and carriedAccruedInterest by the accrued portion recovered."
>
> **B.5:** "interestPaid = min(remaining, totalInterestDue)"

**Gap:** If period interest is more than the payment (for example, a variable mortgage above its trigger rate), the unpaid **period** interest is not handled anywhere. Step 6 only reduces *carried* interest. The shortfall could be added to carried interest, added to principal, or lost. We also don't know whether the payment covers period interest or carried interest first, which changes how much is "recovered".
**Check in workbook:** how the macro updates its accrued-interest variable after the interest step.

### OQ-M ✅ "Total fees" in the validation rule

> **§6:** "Total fees must be less than the loan amount (enforced by the COB v7 workbook macro)."

**Gap:** "Total fees" isn't defined. It could be IN-06 + IN-07, or financed fees only (the only fees that are part of the loan).
**Check in workbook:** the macro's validation expression.

---

### Summary: what to transcribe from the workbook

| # | Workbook item to transcribe | Resolves |
|---|---|---|
| 1 | Use-case dropdown → label and visibility logic on the Calculator sheet (the workbook has none, §7.1; settled by the business 2026-09-29) | OQ-A, OQ-B |
| 2 | Macro line that sets the Calculated Rate (the "MONTHLY" condition) | OQ-C |
| 3 | Macro initialization of the opening balance and fees variables + first schedule row | OQ-D |
| 4 | Formulas for the C (COB $) cell and the Trigger Rate cell | OQ-E, OQ-F |
| 5 | Frequency dropdown list source | OQ-G |
| 6 | Every `Round(...)` in the loop + cell number formats | OQ-H |
| 7 | VBA for `getNextWeekly`, `getNextBiweekly`, `getNextEOM`, the semi-monthly branch, the skip-date function, and how the first closing date is set | OQ-I |
| 8 | Loop exit condition + final-payment handling | OQ-K |
| 9 | How the accrued-interest variable is updated after interest is paid (transcribed, §7.2; the business reversed it 2026-09-29) | OQ-L |
| 10 | Fee validation expression | OQ-M |

---

## 7. Resolutions: Business Answers and Evidence from the Workbook (2026-09-27)

Sources: the business answers given on 2026-09-27, plus the macro and formulas of `Cost of Borrowing Rate Calc_Current.xlsm` (VBA module `Sheet1`, "Calculator" sheet). Code excerpts are copied word for word from the macro.

### 7.1 Status

| OQ | Status | Resolution |
|---|---|---|
| OQ-A | ✅ **Decided 2026-09-29** (was ❌ Open) | The workbook has **no** Use Case selector. It has only a "Disbursal Date". The four use cases and their labels are **new** requirements with no Excel reference. *Decided by the business (decisions 2 and 5, `COB-feedback-impact.md`):* New → Disbursal Date; Renewal → Renewal Date; Payment Change and VRPC → **Last Payment Date**, First Payment Date reads Next Payment Date; screen labels match the printout. **Delivered B22** (CHANGES §51). |
| OQ-B | ✅ **Decided 2026-09-29** (was ❌ Open) | The workbook has **no** Accrued Interest input. See 7.4. *Decided (decision 4):* mandatory for Renewal, Payment Change and VRPC, blank by default, $0 allowed. **Delivered B20** (CHANGES §49). |
| OQ-C | ✅ Resolved | Fixed Mortgage → `SEMI-ANNUAL` → converted using the n table. Variable Mortgage and Personal Loan → `MONTHLY` → contract rate as entered, no conversion. *(2026-09-30: personal loans are Monthly only (FB-24), so for them "no conversion" only ever applies at Monthly; a Variable Mortgage is still unconverted at any frequency. The engine rejects a non-monthly personal loan as a fixed rule, no switch and no OQ-AB; the deviation from the workbook, which accepts any frequency with the MONTHLY basis, is DEV-FB24. See "B27 answers", §7.5.)* |
| OQ-D | ✅ Resolved (+ OQ-S) | Nothing is counted twice. Principal = Loan − financed fees − non-financed fees. Fees are tracked in their own column. |
| OQ-E | ✅ Resolved | C = total interest accrued + financed fees + non-financed fees, with fees counted in full. |
| OQ-F | ✅ Resolved | Trigger % = (Payment × n ÷ Loan Amount) × 100. |
| OQ-G | ✅ Resolved | "One Time" is not in the dropdown and its branch in the macro is commented out → **out of scope**. |
| OQ-H | ✅ Resolved | There is no `Round()` anywhere in the macro. Full precision throughout; the display shows 2 decimals for currency and 4 for rates. |
| OQ-I | ✅ Resolved | The First Payment Date is payment #1 for every frequency (business answer + macro). Monthly keeps the same day of the month. There is no skip rule. |
| OQ-J | 🟡 Partial | The baseline is the workbook's Print button (prints the Calculator sheet with Prepared by, Verified by, Portfolio # and Date). The digital format is still open. |
| OQ-K | ✅ Resolved (+ OQ-T) | A payment on the End Date is included. The last payment follows the **workbook exactly**: Payment = remaining principal (decision 2026-09-27, replacing the earlier "remaining balance" answer). |
| OQ-L | ~~✅ Resolved~~ **Superseded 2026-09-29** | ~~Unpaid interest carries forward and earns interest itself (capitalised).~~ This was the 2026-09-27 resolution (workbook behaviour, T6); it now survives only as the workbook branch of the engine switch, shipped off. *Revised by decision 1 + Q-W4-INT:* unpaid interest goes to a separate non-interest-bearing bucket, paid first, oldest first, counted in C as charged; the workbook branch stays behind an engine switch. **Delivered B19** (DEV-OQL; CHANGES §48). |
| OQ-M | ✅ Resolved | Financed + non-financed fees must be less than the Loan Amount. |

**Later items, status as of 2026-09-29** (decisions in `COB-feedback-impact.md`, top table; B-items in `COB-architecture.md` §5; B19–B23 are delivered (B19–B22 CHANGES §48–§51, B23 CHANGES §52); B26 is delivered, CHANGES §55, QA PASS WITH NOTES 2026-09-30; B26-HINT is delivered, CHANGES §57; B24 is delivered, CHANGES §56; B25 is not built yet; B29 (Help page) is planned / in progress):

| Item | Status | Resolution |
|---|---|---|
| OQ-P (§7.3) | ✅ Decided 2026-09-29, **refined 2026-09-30** | End Date is mandatory and drives the schedule. Term Years / Months are not entered: the Contract term is a read-only result, derived **First Payment Date → last scheduled payment date** in years, months and leftover days (2026-09-30 "Contract term refinement" row; the 2026-09-29 start and end points Start Date → End Date are superseded); a term under one month is allowed (decision 8, Q-TERM-SHORT). Replaces backlog B9. Delivered **B24**, CHANGES §56 (DEV-OQP); the engine's termYears / termMonths are optional, deprecated and ignored (removal parked as B24-CLEANUP). |
| Q-SACD | ✅ Decided 2026-09-29 | The Semi-annual compounding date (not a BRD input; required today for fixed mortgages, used in no calculation) is switched off: hidden, not printed, not required. The Contract date is switched off the same way (decision 8). Delivered **B24**, CHANGES §56: the Contract date is hidden behind `UI_SWITCHES.contractDateField`; the semi-annual date is optional behind the engine switch `SEMI_ANNUAL_DATE_REQUIRED` and hidden (a present but invalid date is still rejected). |
| DQ-16 | ✅ Decided 2026-09-29 | Renewal is mortgage-only, locked like VRPC (decision 9). Payment Change for personal loans is unchanged (not asked). **Delivered B21** (CHANGES §50). |
| OQ-W (§7.4) | Partly decided 2026-09-29 | W1 ✅ no interest on accrued interest (decision 1); W4 ✅ oldest first (Q-W4-INT); both **delivered B19** (CHANGES §48). W2 parked with today's rule (decision 11, FB-25 W2). **W3 and W5 still open**: no decision covers them (F43). |
| OQ-Z (§7.5) | **Revised 2026-09-29** | The 2026-09-27 decision (keep the workbook semi-monthly logic) is superseded: payments fall on the 15th and month-end, and any other First Payment Date is moved forward to the next 15th or month-end (decision 10). Planned **B25** (DEV-OQZ). Q-SEMI-SHOW (how staff see the move) is open. |
| OQ-X (§7.3) | ✅ Confirmed 2026-09-29 | Stakeholders confirmed the monthly rule (FB-2a, decision 10). No change. |
| OQ-S (§7.5) | Kept, question parked | FB-9a / FB-18 (fees paid separately vs recovered through payments) parked with today's behaviour (decision 11). With Financed switched off (B23, delivered, CHANGES §52), every fee follows OQ-S. |
| OQ-Q (no-fee rate) | On hold | FB-11 is on hold (decision 3); today's workbook rule is kept. |
| Q-B19-ENDACC | ✅ Decided 2026-09-29 | Show the unpaid interest left after the last payment as a figure on screen and in print, only when above $0 (§7.5); label "Unpaid interest at end date", hint ~~"Owed in addition to the balance at end date"~~ (superseded 2026-09-30) now **"Unpaid after the last payment; interest since then is not included"** (user 2026-09-30, interim under Q-MSG). **B26 delivered** (CHANGES §55, QA PASS WITH NOTES 2026-09-30); hint reword delivered as B26-HINT (CHANGES §57). |
| B22 wording | ✅ Decided 2026-09-29 | PC / VRPC labels "Last payment date" / "Next payment date"; "Accrued interest" name unchanged; PC / VRPC arrears hint accepted as interim text; Renewal unchanged (§7.5). **Delivered B22** (CHANGES §51). |
| FB-7, FB-8d | Parked | Today's behaviour kept (decision 11). See UC-07, UC-08. |
| FB-24 | ✅ Decided 2026-09-30 | Reverses the parking: a personal loan may only have the Monthly frequency, in all flows; the engine rejects other frequencies (fixed rule, no switch); the page locks the select. See the "FB-24 decision" and "B27 answers" rows in §7.5. Deviation: DEV-FB24. |

### 7.2 Evidence

**OQ-C: the rate**

Calculator!D10 `=IF(RateType="MONTHLY", MonthlyRate, XLOOKUP(Freq, r_Freq, r_EquivalentRate))`. The RateType dropdown (G10) offers `"MONTHLY,SEMI-ANNUAL"`.
The Formula sheet's n table: Weekly 52 · Accelerated Weekly 52 · Biweekly 26 · Accelerated Biweekly 26 · Semi Monthly 24 · Monthly 12.
This is where B.1's "MONTHLY rate type" comes from: it is the workbook's G10 dropdown, not IN-04.

**OQ-D: fees**
```vb
openingBalance = loanAmt
currPrinciple = loanAmt - finFee - nonFinFee
currFees = finFee + nonFinFee
...
newBalance = newFees + newPrinciple + intAccrued - totalInterestPaid
```

**OQ-E and the APR**
```vb
COB = intAccrued + finFee + nonFinFee
If finFee + nonFinFee = 0 Then
    COBRate = aRate * 100
Else
    totalYears = termDay / 365
    COBRate = (COB / (avgOpeningPrinciple * totalYears)) * 100
```
`avgOpeningPrinciple = totalOpeningPrinciple / pymtCount`, where `totalOpeningPrinciple` sums `currPrinciple` (column E), **not** the Loan balance.

**OQ-F: trigger rate.** Calculator!M29 `=IF(D4=0, "", (D26*PaymentsPerYear/D4) * 100)`

**OQ-I: dates**
```vb
closingDate = firstPymtDate          ' payment #1 = First Payment Date
If Not isFirstPymt Then
  Case "Weekly", "Accelerated Weekly":      getNextWeekly(startDate)            ' +7 days
  Case "Biweekly", "Accelerated Biweekly":  getNextBiweekly(firstPymtDate, ...) ' first + 14k
  Case "Semi Monthly":                      getNextSemiMonthly(firstPymtDate, ...)
  Case "Monthly":                           getNextMonthly(firstPymtDate, ...)  ' DateAdd("m", k, first)
  'Case "Weekly With Skip" ...  'Case "End of Month" ...  'Case "One Time"   ← all commented out
```

**OQ-K: end of term**
```vb
checkToExit = DateDiff("d", eDate, nextDate) > 0     ' stop only when next date is AFTER End Date
...
If currPrinciple >= moneyLeft Then
    principlePaid = moneyLeft
Else
    pymtAmnt = currPrinciple        ' ← last payment
    principlePaid = currPrinciple
```

**OQ-L: interest the payment doesn't cover**
```vb
newInt = openingBalance * appliedRate
intAccrued = intAccrued + newInt
intPaid = min(moneyLeft, intAccrued - totalInterestPaid)   ' (paraphrased If/Else)
```
Unpaid interest stays in `intAccrued − totalInterestPaid`. It goes into `newBalance`, which becomes the next period's `openingBalance`, so the next period charges interest on it.
*This evidence stands as the workbook's behaviour. The business decided on 2026-09-29 not to follow it (decision 1: "We cannot charge interest on interest"); see §7.1 OQ-L. Delivered B19 (CHANGES §48); this workbook rule remains only behind the engine switch, shipped off.*

### 7.3 New discrepancies: BRD vs the real workbook

These are places where the BRD (especially Appendix B, which says it was "transcribed from the workbook macro") **does not match** the macro. Each one needs a decision: follow the workbook (parity), or follow the BRD (a deliberate change).

| ID | BRD says (quote) | Workbook actually does | Impact |
|---|---|---|---|
| **OQ-N** 🔴 | §4.2 "i<sub>m</sub> The entered contract mortgage rate" | In SEMI-ANNUAL mode the rate comes from **'Semi-Annual Rate Converter'!B4** (hard-coded 3.74), not from Calculator!F10. Staff have to type the rate on a second sheet. | The new app should have **one** contract-rate input. Confirm. |
| **OQ-P** 🟠 | IN-13 "End Date … The maturity date" (mandatory) | The workbook also has **Term (Years)** and **Term (Months)** inputs, and End Date may be left blank. When it is blank, the term is `DateDiff(first, next)/365 > termYr − 7/365`. | Are Term Years/Months in scope, or is End Date mandatory? **✅ Decided 2026-09-29 (decision 8):** End Date is mandatory and drives the calculation; the Contract term is read-only, derived from the dates (years, months, leftover days). Delivered B24, CHANGES §56 (DEV-OQP). **Refined 2026-09-30:** the term runs from the First Payment Date to the last scheduled payment date (not Start Date → End Date), the Term inputs are removed, and it is a calculated result ("Contract term refinement" row, §7.5). Note: the BRD has no Term input; IN-08 is Payment Amount, so the term is a workbook field (OQ-P), not a BRD ID. |
| **OQ-Q** 🔴 | §4.1 "P … average of the opening balances across all payments" | P = average opening **principal** (column E: excludes fees and unpaid interest). **When fees = 0, APR = calculated rate** (no formula). | Parity needs the workbook rule. The BRD text should be corrected. |
| **OQ-R** 🟡 | OUT-07 "Sum of the principal portion across all payments" | J31 `=G29-J29` (Total Payments − Total Interest), which also includes fees paid. | When fees > 0, the workbook overstates principal paid. Fix, or keep for parity? |
| **OQ-S** 🔴 | BR-04 "Non-financed fees … are NOT added to principal" and IN-07 "NOT deducted from the advance" | The macro subtracts **non-financed fees** (N) from the Loan Amount, the same as financed fees (F), when it splits the Loan balance: `currPrinciple = loanAmt - finFee - nonFinFee`, `currFees = finFee + nonFinFee`. So (a) principal = Loan − F − N and the fee bucket includes N, which the payment waterfall then recovers; and (b) P in the COB rate is the average opening principal based on Loan − F − N (see OQ-Q). Interest is **not** increased by N: it is charged on `openingBalance`, which starts at the full Loan Amount whatever N is (`openingBalance = loanAmt`, `newInt = openingBalance * appliedRate`). Interest with and without a cash fee is identical (to about 4e-16 relative). | Contradicts BR-04. A fee the member paid separately is treated as part of the loan: it is taken out of principal, sits in the fee bucket and is recovered from payments, and it lowers P (raising the COB rate). *Corrected 2026-09-27: rationale wording, decision unchanged; evidence: macro lines 386-388/456, B6 QA. The earlier text said the macro charges interest on both kinds of fee; it does not.* |
| **OQ-T** ✅ | Business answer: "the last payment is the remaining payment" | The macro sets the last `pymtAmnt = currPrinciple`. That drops the interest and fees paid in the same row, so "Total Payments" is lower than the cash actually paid by the last row's interest and fees. | **Decision 2026-09-27: keep the workbook behaviour for parity.** Last-row Payment = remaining principal; interest and fees for that row are still shown in their own columns. Not a difference from Excel. |
| **OQ-U** 🟡 | B.4 "Monthly: getNextEOM(startDate) – end-of-month stepping" plus the skip-date rule | Monthly = same day of the month, and the skip rule is commented out. `getNextEOM` is used only inside Semi-monthly. | Appendix B B.4 is **wrong** and should be corrected. |
| **OQ-X** ✅ | B.4 "Monthly: getNextEOM(startDate) – end-of-month stepping" | `DateAdd("m", k, firstPymtDate)` keeps the day number: Apr 30 → May 30, Feb 28 → Mar 28. Only a 31st start stays at month-end. | **Decision 2026-09-27: payments that start at month-end stay at month-end** (Apr 30 → May 31). This is an intentional difference from Excel for start dates on Feb 28/29 and the 30th of 30-day months. *Confirmed by the stakeholders 2026-09-29 (FB-2a, decision 10).* |
| **OQ-V** 🟡 | IN-09 labels "Bi-weekly", "Semi-monthly" | Workbook labels are "Biweekly", "Semi Monthly". | Display only. Map the labels when importing test data. |

**REF-01: reference case saved in the workbook (for parity)**

| Input | Value | Output | Excel value |
|---|---|---|---|
| Loan Amount | 227,829.65 | # of payments | 156 |
| Financed / non-financed fees | 0 / 0 | Total payments | 72,611.76 |
| Rate type / rate | SEMI-ANNUAL / 3.74 % | COB amount | 22,514.10591158249 |
| Frequency | Accelerated Weekly | COB rate % | 3.706781471105014 |
| Disbursal date | 2026-03-17 | Row 1 interest | 138.82433838712447 |
| First payment date | 2026-03-23 | Row 1 principal paid | 326.63566161287554 |
| End date | 2029-03-17 | Last payment date | 2029-03-12 |
| Payment | 465.46 | Term days | 1091 |

### 7.4 Accrued interest: why it "is not functioning well"

The workbook **cannot** do what BRD §4.5 / BR-10 describe, because:

1. **There is no input for past accrued interest.** The macro's `intAccrued` is *interest accrued since the disbursal date*. It is shown as "Total Int" (column H), and it is not the member's unpaid interest from before. BRD B.1 "carriedAccruedInterest" **does not exist in the macro**.
2. **Unpaid interest is capitalised.** Anything a payment doesn't cover stays in the Loan balance and earns interest the next period (7.2 OQ-L). If staff approximate accrued interest by adding it to the Loan Amount, it earns interest *and* is treated as principal. *(Workbook behaviour. The calculator no longer does this since B19: decision 1, 2026-09-29; CHANGES §48.)*
3. **C would include it.** `COB = intAccrued + fees`, so any way of seeding accrued interest into `intAccrued` adds the prior term's interest to this term's cost of borrowing.

The Renewal and Payment Change accrued-interest behaviour is therefore a **new calculation with no Excel reference**. The business needs to confirm (**OQ-W**):

| # | Decision | Suggested default | Status (2026-09-29) |
|---|---|---|---|
| W1 | Does past accrued interest earn interest while it is outstanding? | **No.** Keep it in a separate bucket that isn't charged interest (BRD §4.5 says it is "added to the interest portion", not to principal). | ✅ **Decided: No** (decision 1). Extended to unpaid period interest too. Delivered B19 (CHANGES §48). |
| W2 | Is past accrued interest included in the COB amount C? | **No.** It belongs to the previous term. | **Parked, today's rule kept** (decision 11, FB-25 W2): IN-11 counts in C as far as it is paid (`PRIOR_ACCRUED_IN_COB = 'whenPaid'`). The suggested default "No" was not adopted. |
| W3 | Is it included in the average principal P? | **No.** | ❌ **Open**: no decision covers it (F43). Today IN-11 is not in P (`PRIOR_ACCRUED_IN_P = false`), and since B19 (CHANGES §48) no unpaid interest of any kind is in the balance, so P excludes it by construction. |
| W4 | Within the interest step, which is paid first: past accrued interest or the current period's interest? | Past accrued interest first (the BRD says it goes on "the first payment"). | ✅ **Decided: oldest first** (decision 1 + follow-up Q-W4-INT): IN-11 before any later period shortfall. Delivered B19 (CHANGES §48). |
| W5 | Parity baseline | Business to supply 2 or 3 worked examples (a Renewal and a Payment Change), because Excel cannot produce them. | ❌ **Open**: no decision covers it (F43), and decision 11 (no follow-up questions) suggests none will be requested; to confirm with the user. |

### 7.5 Decisions of 2026-09-27 (user)

| ID | Decision |
|---|---|
| **OQ-S** ✅ | **Follow the BRD.** Non-financed fees are paid separately. They are never part of principal, are never charged interest, and count only in the cost of borrowing (C). This is an intentional difference from Excel. The legacy test D-05, which expects the workbook behaviour, is retired. |
| **OQ-Y** ✅ *(superseded 2026-09-28 by OQ-Y revised)* | **A $0 payment is allowed, as in Excel.** The schedule runs to the End Date with nothing paid, and interest builds up and is charged interest (OQ-L). This replaces the earlier deliberate rejection. *(The "charged interest (OQ-L)" part is also superseded 2026-09-29 by decision 1; see §7.1 OQ-L.)* |
| **OQ-Z** ~~✅~~ **Superseded 2026-09-29** | ~~**Semi-monthly keeps the workbook logic.** Only the real last day of a month counts as month-end, so Apr 30 alternates 15th / month-end and Jan 30 alternates 15th / 30th. Feb 28 counts as month-end in 2027 but not in 2028.~~ *Revised by the user 2026-09-29 (decision 10, `COB-feedback-impact.md`; FB-2b):* semi-monthly payments fall on the 15th and month-end; a First Payment Date on any other day is **moved forward to the next 15th or month-end** (chosen over rejecting it). A new intentional difference from Excel (DEV-OQZ). The ~39 semi-monthly golden changes are approved for that task. Planned **B25**; the old rule stays in force until then. Q-SEMI-SHOW (how staff see the moved date) is open. |
| **OQ-AA** ✅ | **A blank Contract Rate field is rejected in the UI** (decided 2026-09-27), as T7 did for a blank payment. A 0 that the user types is still allowed. Today `Number('')` silently turns a blank into 0%. This is a UI-only task, queued after B3a. |
| **Q-MSG interim (fee limit)** | Decided 2026-09-27 for B2. The fee-limit error uses neutral interim wording naming both fee kinds: `total fees (financed + non-financed) (X) must be less than loanAmount (Y)`. It is not the workbook text. Q-MSG (final wording of all messages) stays open. |
| **OQ-Y revised** ✅ | **Decided by the user 2026-09-28: the payment amount can't be 0.** It must be > 0. This replaces OQ-Y ("a $0 payment is allowed, as in Excel") and is an intentional difference from Excel. Negative, blank and non-numeric values stay rejected. There is no minimum beyond > 0 (user, 2026-09-28). |
| **OQ-AA revised** ✅ | **Decided by the user 2026-09-28: a 0% contract rate can't be set.** The contract rate must be > 0. This replaces the OQ-AA clause "a 0 that the user types is still allowed"; a blank rate stays rejected. |
| **Q-B8-1** ✅ | *Superseded for the UI by the 2026-09-30 decision "Accelerated frequencies hidden" (next rows): while hidden, the "(n/yr)" suffix on the two accelerated options does not show; the suffix on the other four options stays. Engine unchanged. Original text follows.* **Decided by the user 2026-09-29: the Payment Frequency options keep the payments-per-year suffix.** The two new accelerated options (B8) read "Accelerated Bi-weekly (26/yr)" and "Accelerated Weekly (52/yr)", like the existing options. Print labels stay bare ("Accelerated Weekly", "Accelerated Bi-weekly"). |
| **Accelerated frequencies hidden** ✅ | **Decided by the user 2026-09-30: drop the Accelerated Weekly and Accelerated Bi-weekly selections from the Payment Frequency dropdown "as they don't have a function calculation"** (the tool does not calculate the accelerated payment amount; under BR-09 they are identical to Weekly / Bi-weekly; source `COB-feedback-impact.md` FB-1, R2: "Accelerated payments differ in payment amount which is not calculated by this calculator"). **Scope chosen: hide in the UI behind a switch (ADR-14: deactivated, not removed).** (1) The dropdown offers {Weekly, Bi-weekly, Semi-monthly, Monthly} while the switch is off. (2) The engine keeps accepting `acceleratedWeekly` / `acceleratedBiweekly`; n, dates, goldens and the B8 engine tests are unchanged. (3) One switch brings the two options back. (4) Supersedes the UI part of B8 (IN-09 field-table row, BR-09 text, US-02 / US-08 criteria) and Q-B8-1 for the UI. **Planned as B28; not built.** **Answered by the user 2026-09-30 (B28 defaults CONFIRMED):** (a) **no hint text** where the options were; (b) a saved or pasted accelerated value **does not matter** (no storage); (c) the A10 capture fixture stays **byte-identical** (it records no dropdown text), so **no regeneration and no approval needed**; **no DEV ID** (results are identical through Weekly / Bi-weekly under BR-09). |
| **B10 acknowledged** ✅ | **Approved by the user 2026-09-29.** A fee without an `includedInCob` flag is accepted and counted in full in the cost of borrowing (OQ-E: C = all fees); the flag is never read. Nothing changes on screen. A flag that is present but not a boolean (e.g. `"yes"`) is **still rejected** (user, 2026-09-29). |
| **Q-MONEY-FMT** ✅ | **Decided by the user 2026-09-29: money amounts show in money format, e.g. `227,199.28`, so they're easier to read.** (1) It applies to every $ amount input: Loan amount, Payment amount, Accrued interest and each fee amount. The rate % and the Term years/months stay plain numbers. (2) The format is applied when the user leaves the field, not while typing. Typed or pasted commas are accepted. (3) A formatted field always shows 2 decimals (`227199` → `227,199.00`). If the user typed more decimals than 2, the field keeps the exact value, so nothing is silently rounded. (4) The printout shows the same format: the printed inputs change from `$227829.65` to `$227,829.65`, matching the printed results and schedule. This is UI display only; the value sent to the engine is unchanged. (5) **Added by the user 2026-09-29 (B16):** a badly formed amount (e.g. `2,27199`, `1,5`) shows an error instead of being treated as blank; today a malformed Accrued interest or fee amount becomes a silent $0. The wording is interim and part of Q-MSG. (6) While the user types a comma number key by key (e.g. `1,`), the error line may flash briefly; the user accepted this. |
| **Q-PRINT-HEAD** ✅ | **Decided by the user 2026-09-29: the printed amortization schedule must show every column.** Reported defect: with All columns selected, the printed table is 1201px wide against a 965px printable width (letter landscape, 12mm margins). The right-hand columns (Accrued interest (closing), Fees (closing), Balance) are cut off unless the browser shrinks the page to fit. Fix, per the user's suggestion: **short column headings in the print only**, because the group headings already say Opening / Interest / Payment breakdown / Closing. The headings become #, Date, Days, Balance, Fees, Period, Accrued, Payment, Interest, Fees, Principal, Accrued, Fees, Balance. Measured in Chrome, the table is then 780px wide and fits. The screen keeps today's long headings, and the CSV keeps its own headings (OQ-J). |
| **Stakeholder feedback 2026-09-29** ✅ | **Decided by the user 2026-09-29 on `COB-feedback-impact.md`** (full table at its top). (1) No interest on unpaid interest: a separate non-interest-bearing accrued bucket, paid first, behind an engine switch (revises OQ-L / T6; closes OQ-W1/W4; fixes FB-25). (2) The Payment Change / VRPC schedule starts at the Last Payment Date; accrued interest = arrears only. (3) FB-11 (COB rate with no fees) is **on hold**; today's rule stays. (4) Accrued interest is mandatory for Renewal / Payment Change / VRPC, blank by default, $0 allowed (closes OQ-B). (5) On-screen labels follow the use case (closes OQ-A). (6) No sample fees. (7) Financed option deactivated; the printout fee descriptions are removed; the $0 fee columns and figures are hidden behind the same switch. (8) Contract date and semi-annual compounding date deactivated; the term is read-only, derived from the dates with leftover days shown (settles OQ-P). (9) Renewal is mortgage-only (closes DQ-16). (10) Monthly dates confirmed; a semi-monthly first date is moved forward to the next 15th / month-end (revises OQ-Z). (11) No follow-up questions sent. Switches live in one place with tests for both states. The golden changes named in items 1, 9 and 10 are approved for those tasks. **Follow-ups (same day):** a second golden fixture for PC/VRPC is approved (B18), and B19 may regenerate its 2 groups + 1 long case. Q-W4-INT: oldest first (IN-11 before later shortfalls). Q-FEE-CSV: the CSV drops the fee columns while Financed is off. Q-TERM-SHORT: a contract under one month is allowed once the term is derived. Q-SEMI-SHOW is open. **Planned as** B19 (items 1 + Q-W4-INT, DEV-OQL), B20 (item 4), B21 (item 9), B22 (items 2 and 5), B23 (items 6, 7 + Q-FEE-CSV), B24 (item 8 + Q-TERM-SHORT, DEV-OQP), B25 (item 10, DEV-OQZ); B18 (PC/VRPC golden) is delivered; *update:* B19, B20 and B21 are delivered (CHANGES §48, §49, §50); B22, B23 and B24 are delivered (CHANGES §51, §52, §56); B25 is not built. **Parked with today's behaviour kept (item 11):** FB-7, FB-8d, FB-9a/FB-18, FB-25 W2 (OQ-W2). *(FB-24 was parked here and is decided on 2026-09-30, see the "FB-24 decision" row.)* **Not covered by any decision:** OQ-W3, OQ-W5 (F43). The affected sections of this file (§3, §4, §5, §6, §7.1–§7.4) were reconciled on 2026-09-29 (doc finding F42). |
| **Q-B19-ENDACC** ✅ | **Decided by the user 2026-09-29: yes.** After B19, interest still unpaid after the last payment on or before the End Date shows only in the last schedule row's Accrued interest (closing) column. The on-screen and printed figures gain a line showing that amount, **only when it is above $0** (no line when it is $0, so REF-01-style printouts are unchanged). UI only; the engine already returns the value; the CSV is unchanged (it holds the schedule, which already carries the value). Built as **B26**, after B23 (both edit the "More figures" list); **delivered, CHANGES §55, QA PASS WITH NOTES 2026-09-30**. **Label and hint decided by the user 2026-09-29:** label **"Unpaid interest at end date"**, hint ~~**"Owed in addition to the balance at end date"**~~ *(superseded 2026-09-30, see "B26 hint reword")*; wording stays interim under Q-MSG like other messages. Source: CHANGES.md §48 "User decision recorded"; `COB-architecture.md` §7. Closes doc finding F47. |
| **B26 hint reword** ✅ | **Decided by the user 2026-09-30.** The hint of the figure "Unpaid interest at end date" changes from ~~"Owed in addition to the balance at end date"~~ to **"Unpaid after the last payment; interest since then is not included"**. The label stays "Unpaid interest at end date"; the figure is still shown only when above $0; wording stays interim under Q-MSG. **Reason (QA finding on B26):** interest accruing between the last payment date and the End Date is in neither the balance nor this figure (example: last payment 2028-04-01, End Date 2028-04-15, about 14 days, roughly $380 on $200,000), so the old hint could be read as the complete amount owed. The user chose rewording over keeping the hint or adding the final accrual to the figure, so the figure's value is unchanged. **Delivered as B26-HINT (CHANGES §57, 2026-09-30):** one string literal in `ui/ca-view.js`; tests and both Chrome scripts assert the new hint. Source: CHANGES.md §55, §57. |
| **B22 answers** ✅ | **Decided by the user 2026-09-29 (B22 brief questions).** (1) For Payment Change and VRPC the start-date field reads **"Last payment date"** and the first-payment field **"Next payment date"**, on screen, in the contract-terms tiles and on the printout (decisions 5 and 2). (2) The field name **"Accrued interest" stays unchanged everywhere** (form label, tiles, print row, every flow); the proposed rename to "Accrued interest (earlier unpaid)" is declined. (3) The interim hint for Payment Change and VRPC is accepted: **"Only interest due at earlier payments and not yet paid (arrears), usually $0.00. Interest since the last payment date is already charged."** It stays interim under Q-MSG for a final wording. (4) **Renewal is unchanged**: labels "Renewal date" / "First payment date", hint "Interest accrued since the last payment date." (5) The A10 capture fixture change for these strings is approved. B22 is **delivered** (CHANGES §51). Consequence to note: with the name unchanged, the hint (and the user manual) is the only guard against staff entering the interest since the Last payment date into Accrued interest, which the schedule already charges (FB-16 double count; QA probe +$784.19). |
| **FB-24 decision** ✅ | **Decided by the user 2026-09-30: "'always monthly' means monthly payments only"** (FB-24 reading (b); source `gaps-and-openquestions-feedback.md` §3.11: "Personal loan rates are always monthly"). (1) A Personal Loan may only have the **Monthly** payment frequency. Weekly, Accelerated Weekly, Bi-weekly, Accelerated Bi-weekly and Semi-monthly are **not valid** for a personal loan. (2) This **reverses the parking of FB-24** (decision 11, today's behaviour kept). Reading (c) is dropped. (3) OQ-C is unchanged: the contract rate is used unconverted; it now matters for personal loans only at Monthly (a Variable Mortgage is still unconverted at any frequency). (4) Payment Change for personal loans: **unchanged** (decision 9); not asked again whether it applies. **Planned as** B27 (architect); **not built**. *The approval and the open questions that stood here (golden reshape, Q-FB24-SWITCH, Q-FB24-PC, Q-FB24-API) are answered 2026-09-30: see the next row, "B27 answers".* Source: `COB-feedback-impact.md` FB-24 and its decisions table (row 12). |
| **B27 answers** ✅ | **Decided by the user 2026-09-30 (B27 brief questions; closes Q-B27-GOLD, Q-B27-UI, Q-FB24-PC, Q-B27-SWITCH, Q-FB24-API and the earlier Q-FB24-SWITCH).** (1) **Q-B27-GOLD approved:** both golden masters are reshaped for B27, in the B27 task only, with the procedure in the brief: drop the personal-loan non-monthly groups (54 in the first golden, 36 in the Payment Change golden), trim the two extra groups to Monthly, and replace the one weekly personal-loan long case with a monthly one. Counts (148 to 94 groups, 122 to 86) are the architect's scratch measurements; QA verifies them. (2) **Q-B27-UI:** when Product is Personal loan the page **locks** Payment Frequency to Monthly (select set to Monthly and disabled, with a hint). When the user switches back to Mortgage the value **stays Monthly** and the select is re-enabled. The hint wording is interim (Q-MSG) unless the brief says otherwise. (3) **Q-FB24-PC:** Monthly-only applies in **all flows**, including Payment Change and VRPC for personal loans (decision 9's "unchanged" means Payment Change stays open to personal loans, not that any frequency is allowed). (4) **Q-B27-SWITCH / Q-FB24-API:** the **engine itself rejects** a non-monthly personal loan, as a **fixed rule with no policy switch** (user chose "Engine rejects, fixed rule"). Consequences: there is **no OQ-AB** and no policy constant; the deviation from the workbook is recorded as **DEV-FB24** (the workbook has no product type and accepts any frequency with the MONTHLY rate basis); OQ-C wording updated. Reversing the rule later is a **code change** (no switch to flip). Any earlier text saying "planned, switch" is superseded. **Follow-up answers 2026-09-30:** (5) **Q-B27-ARCHIVE: YES.** The pre-B27 golden fixtures are kept at `COB-ts/archive/pre-b27/` (copies made before the reshape; nothing deleted). (6) **Q-B27-TESTS: QA's recommendation APPROVED**, after a measured impact analysis (91 tests break when the rule is added; a "twin" mapping, where a non-monthly personal-loan input becomes a mortgage / variable input at the same frequency, was proven byte-identical except `triggerRatePercent` on 22,730 pairs). (a) Existing tests whose personal loan is only a vehicle get input / sampling-domain edits through a twin helper; **no expected values or fixture values are edited.** (b) The 12 class-C tests (rateSelection-oqc claims that exist only at a non-monthly personal-loan frequency) are **retired**: the same two claims stay covered at Monthly, on variable mortgages and in the equations tests; a new all-payments-per-year equation-level personal-loan test is added. (c) **No re-pin:** a frozen pre-B27 generator copy (test-only) lets b10, b8 and B19-ON keep their numbers and the original B19 pins. (7) **Dropped cases not replaced:** the personal-loan weekly / bi-weekly / semi-monthly underpayment golden cases (234 + 156) are **not** replaced with a mortgage / variable group; **no golden group is added.** (8) **Q-B27-HASH (2026-09-30):** the loopEquations test `overflowToInfinityShipped` pins a sha (`c88a5419…`) that includes `triggerRatePercent`, which the twin mapping changes (null for a personal loan, a number for the mortgage twin). The user chose: QA may **edit the assertion code of that one test** so the trigger is nulled before hashing; the **pinned hash value stays the same** (verified to reproduce); **no re-pin to `a54aa741…`, no retirement.** This is the **single declared exception X1** to the "no expected or fixture value edits" rule in (6)(a). |
| **B24 term label** ✅ | **Decided by the user 2026-09-30: "Contract term".** For the change flows (Payment Change / VRPC) the derived, read-only term (decision 8; start and end points superseded 2026-09-30, see the next row) is labelled **"Contract term"**, not "Remaining term". Applies to B24 and to every flow; wording stays interim under Q-MSG. |
| **Contract term refinement** ✅ | **Decided by the user 2026-09-30: "The contract term should be gone from the UI and is calculated from the first payment to last payment — 'Contract term'."** Answers to the BA's clarifying questions: (1) the derived term **starts at the First Payment Date** (for Payment Change / VRPC, the Next Payment Date field); (2) it **ends at the last scheduled payment date**, i.e. the date of the last payment row of the calculated schedule, on or before the End Date (not the typed End Date); (3) the Term years / Term months inputs are **removed** and ONE read-only field labelled **"Contract term"** (years, months, leftover days) shows the derived value, so it is a **result that depends on the calculated schedule, not an input**. **Supersedes:** decision 8's "Start Date to End Date" and the B24-term answer's "(End Date − Start Date)" for the start and end points. **Keeps:** derived-not-input, leftover days shown, End Date mandatory and driving the schedule, Q-TERM-SHORT (under one month allowed), label "Contract term" in every flow. **Open consequences as first logged (all answered the same day, see the next row "Contract term refinement: answers"):** (Q-CT-EMPTY) what the read-only field shows before a calculation has run (blank, a dash, or a placeholder), and whether it shows after a failed calculation; (Q-CT-CHECKS) how the zero-day COB-rate check (B13) and the "term not both 0" check behave when the term is a result and no longer available before calculating (the engine's validation currently reads termYears / termMonths as inputs; the "not both 0" check was already dropped for the derived term by Q-TERM-SHORT); (Q-CT-ENGINE) whether the derived term must be consistent with the engine's existing use of the term (termDays / T for the COB rate runs from the Start Date to the End Date, while the displayed term now runs from the First Payment Date to the last payment; the two can differ and the printout would show both "Contract term" and "Term in days"); (Q-CT-SPLIT) the months / leftover-days convention (whole calendar months first, then days? month-end handling, e.g. 31 Jan to 28 Feb; last-day-of-month dates), to be pinned by the BA / architect with the user; (Q-CT-PRINT) first logged as "the printout and CSV carry the same derived value"; **corrected 2026-09-30: the CSV carries no term**; the A10 capture fixture strings for the term change only with the user's approval (given, Q-CT-FIX). Impact: B24 scope grows (a result-dependent field, not a form-only derivation), and FB-5's blank-term checks are unreachable from the UI. |
| **Contract term refinement: answers** ✅ | **Answered by the user 2026-09-30** (BA tags mapped to the architect's `COB-architecture.md` B24 names). **(1) Q-CT-START (architect) = the start-point question: CONFIRMED literally.** The read-only "Contract term" is the span from the First Payment Date to the last scheduled payment date, shown as years, months and leftover days. A contract sold as "3 years" therefore displays "2 years, 11 months, 17 days" (REF-01 example from the B24 brief), not a rounded "3 years". **(2) Defaults CONFIRMED:** (a) **Q-CT-EMPTY:** the field is blank until a schedule exists and is cleared after a failed calculation. (b) **Q-CT-PRINT:** the term is printed and shown in the contract-terms tile, but the CSV gets NO term (any text saying the CSV carries it is wrong and is corrected). (c) Q-CT-DAYS: "Term in days" stays unchanged beside "Contract term". (d) **Q-CT-B25:** for a semi-monthly first date moved forward by B25, the term starts at the MOVED date. (e) **Q-CT-ENGINE (in principle) and Q-CT-CHECKS:** the engine's termYears / termMonths stay optional, deprecated and ignored now; removal is a later item **B24-CLEANUP**. The B13 zero-day COB-rate check is unchanged; the "term not both 0" check is dropped, per the architect's brief. **Q-CT-SPLIT:** the months / days split convention is the one the architect defined in the B24 brief, item B24-R1 (`termBetween` in `calendar.ts`); this document does not restate it. **(3) Q-CT-FIX: APPROVED.** The A10 capture fixture `tests/ca/fixtures/a10_ui_capture_v1.json` is regenerated for B24 when it is built (term strings change in every scenario; Contract date and Semi-annual date leave the form). The goldens stay byte-identical. QA lists every changed string in `CHANGES.md`. **Mapping note:** Q-CT-CSV = (2)(b); Q-CT-API (engine API shape) is taken as answered in principle by (2)(e), and the architect should confirm that reading; the user did not name Q-CT-API or Q-CT-CSV explicitly. |
| **Q-B23-FIX** ✅ | **Answered by the user 2026-09-30 (architect question Q-B23-FIX, `COB-architecture.md` §7).** (1) **Approved:** `tests/ca/fixtures/a10_ui_capture_v1.json` (current sha256 `c7b98da5147e1a071b5da2218604e3ff8df0b590eed730b8cd8c8190`) is regenerated for B23 after sr-dev's code is done. Expected changes (brief B23-FIX): fee columns and figures disappear from the schedule tables, the CSV, printFigures, moreFigures and figures; printFees and the terms list lose the financed parts; S1_fees figures move because its financed fee becomes a cash fee; raw.fees[0].financed changes true to false; a new top-level key formDefaults; provenance changes. QA lists every changed string in `CHANGES.md`. (2) **Declined:** no byte copy of the current fixture is kept as `a10_ui_capture_financed_on_v1.json`; the Financed-on path is covered by unit tests only. **Consequence for the user's awareness (flagged by the architect):** with Financed off, a fee staff used to enter as financed becomes a cash fee (REF-01 loan with one 500 fee: COB rate 3.7854% to 3.8266%). **Delivered 2026-09-30 (B23, CHANGES §52; QA PASS WITH NOTES 2026-09-30):** the fixture regeneration was user-approved, and so was the small file `tests/ca/fixtures/b23_on_state_pins.json`. |
| **Help page (B29): documents moved** ✅ | **Done 2026-09-30 (user).** The three documents (user manual, coverage report, domain overview) moved from `docs/` to `COB-ts/docs/`: copied, verified identical by sha256, originals removed; `CLAUDE.md`, the `doc-writer` agent and `HANDOFF.md` updated. |
| **Help page (B29): what it is** ✅ | **Decided by the user 2026-09-30.** A **"Help" button in the calculator's page header** opens **one styled Help page in a new tab** (`ui/help.html`) containing all three documents. It is **static HTML generated at build time** from the markdown (diagrams pre-rendered to SVG; works offline, no runtime library). Purpose: stakeholders and staff refer to the same documents when they propose changes, citing section IDs such as F55, US-04, OQ-P, B24, DEV-OQP. |
| **Help page (B29): design approved** ✅ | **Approved by the user 2026-09-30** (ui-designer, `visual_design/help-page-design.md`): system font stack; a bare `help.html` opens the User manual; no "Suggest a change" link; Mermaid diagrams always on a white panel; one document at a time (all three stacked when JavaScript is off); darker "Planned" border; dark mode follows the system setting; no change to the shared tokens file; a legend chip for the fifth diagram box state "out"; no axe-core. |
| **Help page (B29): packages approved** ✅ | **Approved by the user 2026-09-30.** Dev-only `markdown-it` 15.0.2 and `mermaid` 11.17.2 (exact-pinned, MIT). `npm run help` relies on the globally installed Playwright and Google Chrome, like the existing Chrome scripts. The generated `ui/help.html` stays in the tree ("kept where built"; no git). |
| **Help page (B29): removable and loosely coupled** ✅ | **Decided by the user 2026-09-30:** "make it easy to revert to the calculator by removing the doc later" and "using SoC principle it should be loosely coupled with the project". Help is a **self-contained, removable add-on**. There is **no remove script**: removal is a manual, numbered procedure only. The three documents **stay in `COB-ts/docs/` as plain Markdown** after removal. Planned as **B29 (before B25)**; the architect records the exact coupling rules in `COB-architecture.md`. Status: planned / in progress. |
| **Help page (B29): Q-HELP-NESTED** ✅ | **Decided by the user 2026-09-30: YES.** The Help build's two dev dependencies (`markdown-it` 15.0.2, `mermaid` 11.17.2) live in a **separate `COB-ts/help/package.json`** with its own lock file and `node_modules`. The calculator's root `package.json`, lock file and scripts are **never touched**. Commands: `npm install --prefix help` (once) and `node help/build-help.mjs [--check]`. **Cost accepted:** a fresh clone without the Help install **skips** the Help tests instead of failing, and Help's packages have their own audit, `npm audit --prefix help`. (Refines the "packages approved" row: `npm run help` is replaced by the commands above.) |
| **Help page (B29): Q-HELP-OUTSCOPE** ✅ | **Decided by the user 2026-09-30.** The coverage report's status "Not covered – out of scope" appears on the Help page in the **grey "out" state**, not red: the same meaning as the diagrams' white dashed "out of scope" boxes. |
| **Help page (B29): Q-F7-SELF** ✅ | **Decided by the user 2026-09-30.** Leave test F7 as it is (it reads `COB-user-stories.md` from the parent folder). **No backlog item.** The removability claim is stated **"in the repository layout"**. |
| **Scope** ✅ | **Delete the out-of-scope US-mortgage library** in `COB-ts/src` (pmi, ltv, dscr, arm, refinance, points, costs, compare, …). This happens only after the COB engine and UI have been decoupled from it (architecture A2/A3) and the results are proven byte-identical. There is no version control, so the deletion is irreversible. |
| **OQ-W interim** *(superseded by B19, delivered 2026-09-29, CHANGES §48; kept for the record; decision 1 + Q-W4-INT, 2026-09-29, pick option (d) oldest first and extend "no interest" to every shortfall)* | Until OQ-W is decided: in a renewal or payment change where a payment falls short of period interest while IN-11 accrued interest is still owed, the shortfall stays outside the balance (today's behaviour, option a). Once IN-11 is cleared, OQ-L applies. The options for the business are (a) keep this, (b) pay period interest first, (c) pay IN-11 first, (d) pay the oldest amount first. |
