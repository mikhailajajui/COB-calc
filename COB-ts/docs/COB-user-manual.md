# Cost of Borrowing Calculator: User Manual

For branch and lending staff at Alterna Savings.
Version: eighteenth draft, 2026-10-01. What changed in this draft: nothing you see changes; the printout is now prepared at the moment you print (section 12). Before that: a semi-monthly first payment date that is not the 15th or month-end is now moved forward, and the page tells you with a note (section 6); the printout and the CSV file name follow. Before that: the start date for **Payment change** is now called **Date of change** (it was **Last payment date**); **Renewal** now also allows a **Personal loan**; the **Flow** list shows three flows (**Variable rate payment change** is hidden for now). Earlier draft (2026-09-30):  the **Years** and **Months** boxes are gone. One read-only **Contract term** now shows the time from the first payment to the last payment, in years, months and days (see section 6). The **Contract date** box and the **Semi-annual compounding reference date** box are no longer on the form. Earlier drafts: the results add an **Unpaid interest at end date** line when interest is still unpaid (section 10); the **Payment frequency** list offers four options and a personal loan is **Monthly** only (sections 6 and 9); the page opens with no sample fees and no **Financed?** box (sections 3 and 8); the screen labels follow the flow (section 5); **Renewal** is for mortgages only; **Accrued interest ($)** is required for Renewal, Payment change and Variable rate payment change; unpaid interest no longer earns interest; dollar amounts are shown in money format; and the printed schedule uses short column headings. The error box still shows one problem at a time.

---

## 1. What the calculator does

The Cost of Borrowing Calculator works out the cost of borrowing for a mortgage or a personal loan over its current term. It replaces the Excel "Cost of Borrowing Rate Calc" workbook.

You enter the loan terms by hand. The calculator then shows:

- the cost of borrowing rate (APR) and the cost of borrowing amount;
- the calculated rate, and the trigger rate for variable-rate mortgages;
- the number of payments and the totals of payments, interest and principal;
- a full amortization schedule, one row per payment.

You can print the result, save it as a PDF, or download the schedule as a CSV file.

**What it doesn't do**

- It doesn't work out the payment amount. You enter the payment amount yourself.
- It doesn't connect to Wealthview or any other system. Every value is typed in.
- It doesn't save member information. Nothing you enter is kept after you close the page.

The page shows this note under the title: *"results are estimates. They don't replace the cost of borrowing disclosure in the loan documents."*

---

## 2. The screen at a glance

The page has four areas.

| Area | Where | What it holds |
|---|---|---|
| Input form | Left | **Flow**, **Loan / mortgage details**, the extra fields for the selected flow, and **Fees**. |
| Results | Right | The headline figures, the other figures, **More figures**, and the **Print or save as PDF** and **Download CSV** buttons. |
| Contract terms | Below the form | A summary of the inputs behind the results shown, headed **Contract terms**. |
| Amortization schedule | Bottom | The payment-by-payment table. |

Errors appear in a red box under the input form.

### Getting help

The page header has a **Help** link. Select it to open the Help page in a new tab. The Help page holds this manual, the coverage report and the domain overview. It is a plain saved page, so it opens by itself and does not need the calculator to run. Your calculator tab stays as it is, with nothing lost.

---

## 3. Before you start: clear the sample values

The page opens with a worked example already filled in: a $227,829.65 fixed-rate mortgage at 3.74% with weekly payments of $465.46. The **Fees** table starts empty: there are no sample fees.

For every calculation:

1. Replace every value in the form with the member's values.
2. Add the member's fees, if there are any. Select **Add fee** (see section 8).
3. Check the dates. The sample dates won't match your loan.

---

## 4. There is no Calculate button

The calculator works out the results **as you type**. Each time you change a value, the results, contract terms and schedule update straight away.

- If all the inputs are valid, the results are shown.
- If an input is missing or invalid, the results and schedule are hidden and the red error box tells you what to fix. The error box shows **one problem at a time**. Fix it, and the next problem (if any) is shown.

Some messages on the page say "Calculate first" or "Calculate, then print". They mean: make sure the inputs are complete and valid so that a result is showing.

---

## 5. Step 1: choose the flow

In the **Flow** section, choose the kind of transaction in the **Flow** list.

| Flow | Use it when | Start date field shown |
|---|---|---|
| **New mortgage / loan** | A new mortgage or loan is being advanced. | **Disbursal date** |
| **Renewal** | An existing mortgage or personal loan is being renewed. | **Renewal date**, plus **Accrued interest ($)** |
| **Payment change** | The payment on an existing loan is being changed. | **Date of change**, plus **Accrued interest ($)** (see note below) |

The **Flow** list shows these three flows. A fourth flow, **Variable rate payment change**, is switched off in the page for now and is not in the list. To change the payment on a variable-rate mortgage, choose **Payment change**, **Mortgage** and **Variable**.

Then choose:

- **Product type**: **Mortgage** or **Personal loan**.
- **Rate type**: **Variable** or **Fixed**.

For **Renewal**, **Product type** and **Rate type** stay open: choose **Mortgage** or **Personal loan**, and **Variable** or **Fixed**. A personal loan can only be paid monthly (see section 6).

For **Payment change**, you can choose **Mortgage** or **Personal loan**, and **Variable** or **Fixed**. For a variable-rate mortgage, the **Trigger rate** appears in the results once you have entered **Accrued interest ($)** (enter 0 if there is none).

> **Note for Payment change.** For this flow the start date field is called **Date of change**, and the first payment field is called **Next payment date**. The printout and the **Contract terms** summary use the same names.
>
> - **Date of change** is the date from which interest is charged: the date of the member's last payment, of any size. It is not "the last full payment".
> - **Next payment date** is the date of the first payment under the new payment amount. It is payment 1 in the schedule.
> - The schedule charges interest from the **Date of change**. So it already includes the interest since that payment.
> - **For Payment change, enter the Date of change and put only arrears in Accrued interest.** Do **not** put the interest since the last payment date into **Accrued interest ($)**. The schedule charges it already, so it would be counted twice and the cost of borrowing would be too high. (In one check, doing this raised the cost of borrowing amount by $784.19.)
> - Arrears means interest that was due at earlier payments and is still unpaid. It is usually $0.00. Enter 0 if there is none.

For **Renewal** nothing has changed: the start date is called **Renewal date**, the first payment field is called **First payment date**, and **Accrued interest ($)** is the unpaid interest owing at the renewal date.

**Switching flows.** You can change the flow at any time. Values in fields that the flows share are kept. The flow-specific fields are shown or hidden, and the results update straight away.

---

## 6. Step 2: enter the loan / mortgage details

| Field | What to enter |
|---|---|
| **Loan amount ($)** | For a new loan: the loan amount. Fees the member pays separately are **not** part of it (see section 8). For a renewal or payment change: the current outstanding balance. Must be more than $0. |
| **Contract rate (%)** | The annual contract interest rate, as a percentage (for example, 3.74). Must be more than 0. A blank rate is rejected. |
| **Payment amount ($)** | The scheduled payment, before taxes. The calculator doesn't work this out; enter it from the loan documents. Must be more than $0. |
| **Payment frequency** | Choose one of four options: **Weekly (52/yr)**, **Bi-weekly (26/yr)**, **Semi-monthly (24/yr)** or **Monthly (12/yr)**. The number in brackets is the number of payments a year. **Weekly (52/yr)** is selected when the page opens. When **Product type** is **Personal loan**, the box is set to **Monthly (12/yr)** and locked (greyed out), with the hint "Personal loans are paid monthly." If you then switch **Product type** back to **Mortgage**, the box stays on **Monthly (12/yr)** and unlocks; change it if the mortgage is paid at another frequency. See the notes below. |
| **Contract term** | You don't enter this. It is read-only and fills in by itself once a schedule is calculated. It shows the time from the **First payment date** to the date of the last scheduled payment, in years, months and leftover days, for example "2 years, 11 months, 17 days". It is exact, not rounded: a mortgage sold as a 3-year term from a first payment on 2026-03-23 shows "2 years, 11 months, 17 days", because the first payment is the start and the last payment is the end. The field is blank until a schedule exists, and is cleared again if a calculation fails. A contract shorter than one month is allowed. For Payment change and Variable rate payment change, the hint under the field says it runs from the **Next payment date**. It appears on the printout and in the **Contract terms** summary, but not in the CSV file. |
| **First payment date** | The date of the first payment after the advance or renewal. This is always payment 1. For Payment change this field is called **Next payment date**: enter the date of the next payment. |
| **End date** | The maturity date of the term. Payments are scheduled up to **and including** this date, or until the loan is paid off. Must be after the first payment date. |

**Entering dollar amounts.** This applies to **Loan amount ($)**, **Payment amount ($)**, **Accrued interest ($)** and each fee **Amount ($)**.

- Type the amount with or without commas, for example 227199 or 227,199.28. You can also paste it. A leading $ is fine.
- When you leave the field, the amount is shown in money format, for example 227,199.00. It always shows at least 2 decimals.
- If you type more than 2 decimals, they are kept as you typed them. Nothing is rounded.
- Commas must separate groups of three digits. An amount such as 2,27199 or 1,5 is not accepted, and neither are letters (12a). The red error box then shows a message for that field (see section 9). Use a point, not a comma, for cents.
- While you type a number with commas, the error box may flash for a moment (for example after "1,"). It goes away when the number is complete.

**Accelerated payments.** The list doesn't offer accelerated weekly or accelerated bi-weekly. The calculator doesn't work out the accelerated payment amount. If the member pays accelerated weekly, choose **Weekly (52/yr)**. If they pay accelerated bi-weekly, choose **Bi-weekly (26/yr)**. In both cases enter the accelerated payment amount yourself in **Payment amount ($)**, taken from the loan documents. The payment dates and the figures are the same as for the regular frequency. The results line, the **Contract terms** summary and the printout will say Weekly or Bi-weekly.

**Personal loans are monthly only.** A personal loan can only have **Monthly** payments. If a personal loan is sent with any other frequency, the calculator rejects it in every flow, including Renewal and Payment change (see section 9). The Excel workbook accepted any frequency for a personal loan; the calculator doesn't.

**Semi-monthly first payment dates are moved.** Semi-monthly payments fall on the 15th and the last day of the month. If you choose **Semi-monthly (24/yr)** and enter a first payment date that is on neither, the calculator moves it forward to the next one in the same month:

- the 1st to the 14th becomes the 15th;
- the 16th up to the day before month-end becomes the last day of the month.

For example, 10 January becomes 15 January, and 20 January becomes 31 January. A 15th or a month-end stays as it is. The other frequencies never move the date.

You never lose sight of this. The date you typed stays in the box. A note appears under the **First payment date** box (under **Next payment date** for Payment change):

> First payment moved to Jan 15, 2027 (semi-monthly payments fall on the 15th and month-end)

For Payment change the note starts "Next payment moved to". The same note appears under the **Contract terms** summary. It disappears when the date is not moved, and when an error message is showing.

The moved date is payment 1. The **Contract term** runs from it, and every later payment follows from it. The **End date** must be after the moved date, not the typed one. The start date (**Disbursal date**, **Renewal date** or **Date of change**) may fall between the typed date and the moved date, because the moved date is the one that counts. The Excel workbook did not move the date: it kept the pattern of the day you typed (for example the 10th and 25th). The calculator's schedule and figures can therefore differ from the workbook for a semi-monthly first date that is not the 15th or month-end.

**Time-span rule for Contract term.** The calculator counts whole months first and then the leftover days. A monthly schedule of N payments reads N-1 months. If the first payment is on the 29th, 30th or 31st, a shorter month counts to its last day.

---

## 7. Step 3: fill in the fields for your flow

### New mortgage / loan

| Field | What to enter |
|---|---|
| **Disbursal date** | The date the funds are advanced. It must be on or before the first payment date. Interest for payment 1 runs from this date. |

Accrued interest is not shown for a new loan.

### Renewal and Payment change

| Field | What to enter |
|---|---|
| **Renewal date** (Renewal) or **Date of change** (Payment change) | For a renewal, the renewal date. For a payment change, the date of the member's last payment, of any size. It must be on or before the first payment date (**Next payment date** for a payment change). |
| **Accrued interest ($)** | For a renewal: unpaid interest owing at the renewal date. For a payment change: **arrears only**, see the warning below. Enter **0** if there is none. Always enter a value, even if it is 0. |

The hint under **Accrued interest ($)** depends on the flow.

- Renewal: "Interest accrued since the last payment date."
- Payment change: "Only interest due at earlier payments and not yet paid (arrears), usually $0.00. Interest since the last payment date is already charged." (This wording may be improved later.)

> **Warning for Payment change.** Enter the **Date of change** and put only arrears in **Accrued interest ($)**. Interest since the last payment date is already charged by the schedule. If you also type it into **Accrued interest ($)**, it is counted twice.

> **Accrued interest is required.** For Renewal and Payment change, the **Accrued interest ($)** box opens blank. If you leave it blank, the calculator shows the error `flow 'renewal' requires accruedInterest (enter 0 if there is none)` (the flow name in the message changes with the flow) and doesn't calculate. Enter **0** if there is no accrued interest. A badly typed amount (for example 1,5) is also rejected. The printout always shows the accrued interest amount for these flows. The wording of this message may change later.

> **Unpaid interest is now counted in full.** If a payment is smaller than the **Period interest**, the interest it doesn't cover is unpaid interest. It is counted in the **Cost of borrowing** amount as interest charged, even if it is still unpaid at the end of the term. (An earlier version of the calculator left it out in some Renewal, Payment change and Variable rate payment change cases with accrued interest above $0. That is fixed.)

### Fixed-rate mortgages

Fixed-rate mortgages need no extra field. The semi-annual compounding reference date is no longer on the form. It never changed the calculation.

---

## 8. Step 4: enter the fees

The **Fees** table starts empty. If the member has no fees, leave it empty. The results then show "No fees" in the **Contract terms** summary and the cost of borrowing rate equals the **Calculated rate**.

The table has three columns.

| Column | What to enter |
|---|---|
| **Name** | A short name for the fee, for example "Appraisal fee". If you leave it blank it shows as "Fee". |
| **Amount ($)** | The fee amount. $0 is allowed. It can't be negative. For a $0 fee, enter 0. Today a blank amount is counted as a $0 fee without a warning, and the printout then shows the amount as "$" only. This may change. A badly typed amount (for example 12a) is rejected with an error. |
| **Actions** | **Remove** deletes the row. |

- Select **Add fee** to add a row.
- Select **Remove** on a row to delete it.

**Every fee is a separate fee.** There is no **Financed?** box. The calculator treats every fee as one the member pays separately, not borrowed.

- The fee is **not** added to the loan amount and is **not** deducted from the advance.
- It earns no interest and isn't repaid through the schedule.
- It **counts in the cost of borrowing** amount and rate.

The total of all fees must be less than the loan amount.

> **If a fee used to be entered as financed.** In the past you could tick **Financed?** for a fee. That box is no longer offered, so such a fee is now counted as a separate fee. The loan amount is not treated as already including it, so the cost of borrowing rate can change. Example: the sample loan from the Excel reference case with one fee of 500 gave a cost of borrowing rate of 3.7854% when the fee was financed, and gives 3.8266% now. Enter the loan amount the member actually borrows.

---

## 9. Error messages

The error box shows the message exactly as below. While you type a number with commas, a message may flash for a moment; it goes away when the number is complete. The messages use the calculator's internal field names; the table tells you which field on the screen each one refers to. The wording of these messages is interim and may be improved later.

In the messages, *X* stands for the value you entered.

| Message | Field on screen | What to do |
|---|---|---|
| `loanAmount must be > 0, got X` | **Loan amount ($)** | Enter an amount more than $0. A blank field shows as `got 0`. |
| `loanAmount must be a finite number, got NaN` | **Loan amount ($)** | The amount isn't a valid dollar amount, for example 2,27199. Check the commas and remove any letters. |
| `contractRatePercent must be a finite number, got NaN` | **Contract rate (%)** | The rate is blank or not a number. Enter the rate. |
| `contractRatePercent must be > 0, got X` | **Contract rate (%)** | Enter a rate more than 0. 0% and negative rates are not accepted. |
| `paymentAmount must be a finite number, got NaN` | **Payment amount ($)** | The payment is blank or isn't a valid dollar amount (for example 1,5). Enter the payment amount. |
| `paymentAmount must be > 0, got X` | **Payment amount ($)** | Enter a payment more than $0. A $0 or negative payment is not accepted. |
| *Fee name* `amount must be >= 0, got X` | **Fees**, Amount ($) on that row | A fee can't be negative. Correct the amount. |
| *Fee name* `amount must be a finite number, got NaN` | **Fees**, Amount ($) on that row | The amount isn't a valid dollar amount, for example 12a. Check the commas and remove any letters. |
| `total fees (financed + non-financed) (X) must be less than loanAmount (Y)` | **Fees** and **Loan amount ($)** | The fees add up to the loan amount or more. Check the fee amounts and the loan amount. The totals may print with many decimal places. |
| `firstPaymentDate must be a valid Date` | **First payment date** | Enter the first payment date. |
| `endDate must be a valid Date` | **End date** | Enter the end date. |
| `endDate must be after firstPaymentDate (compared as UTC calendar dates)` | **End date** | The end date must be at least one day after the first payment date. |
| `endDate must be after firstPaymentDate (moved to 2027-01-31 for semi-monthly payments; compared as UTC calendar dates)` (the date shown is the moved date) | **End date** | The calculator moved your semi-monthly first date forward, and the end date is not after the moved date. Choose a later end date. |
| `flow 'newMortgageOrLoan' requires disbursalDate` | **Disbursal date** | Enter the disbursal date. |
| `disbursalDate must be on or before firstPaymentDate` | **Disbursal date** | The disbursal date can't be after the first payment date. |
| `flow 'renewal' requires renewalDate` (also shown with `'paymentChange'`) | **Renewal date**, or **Date of change** for Payment change | Enter the date. |
| `paymentFrequency 'weekly' is not allowed for productType 'personalLoan' (allowed: monthly)` (the frequency named may differ) | **Payment frequency** and **Product type** | A personal loan can only be paid monthly. Choose **Monthly (12/yr)**. You can't normally see this message, because choosing **Personal loan** sets and locks **Payment frequency** to **Monthly**. |
| `renewalDate must be on or before firstPaymentDate` | **Renewal date**, or **Date of change** | The date can't be after the first payment date (**Next payment date** for a payment change). |
| `flow 'renewal' requires accruedInterest (enter 0 if there is none)` (also shown with `'paymentChange'`) | **Accrued interest ($)** | The box is blank. Enter the accrued interest, or 0 if there is none. |
| `accruedInterest must be >= 0, got X` | **Accrued interest ($)** | Accrued interest can't be negative. Enter 0 if there is none. |
| `accruedInterest must be a finite number, got NaN` | **Accrued interest ($)** | The amount isn't a valid dollar amount. Check the commas and remove any letters. Enter 0 if there is none. |
| `disbursalDate is the same day as the only payment date, so the COB-rate term is 0 days; with fees the term must be at least 1 day` (or `renewalDate is …`) | **Disbursal date**, **Renewal date** or **Date of change**, and **End date** | With fees, the only payment can't fall on the start date. Move the first payment date or the end date. |

---

## 10. Reading the results

The **Results** panel starts with a line that sums up the calculation, for example: *New mortgage or loan · Mortgage · Fixed · Weekly · Calculated 2:15 p.m.* The CSV file doesn't show the frequency.

### Headline figures

| Figure | What it means |
|---|---|
| **Cost of borrowing rate (APR)** | The cost of borrowing as an annual percentage rate. When there are no fees, it equals the **Calculated rate**. |
| **Cost of borrowing amount** | "Interest plus all fees over the term": the total interest for the term, plus every fee. |

### Other figures

| Figure | What it means |
|---|---|
| **Calculated rate** | The rate used for interest. For a fixed-rate mortgage, this is the contract rate converted from semi-annual compounding to the payment frequency. For variable-rate mortgages and all personal loans, it is the contract rate as entered. |
| **Trigger rate** | Shown for variable-rate mortgages only. In Payment change it appears once you have entered **Accrued interest ($)**. "If the contract rate rises above this, the payment no longer covers the interest." It is the payment × payments per year ÷ loan amount, as a percentage. |
| **Number of payments** | How many payments are in the schedule. |
| **Total of all payments** | The total of the schedule's **Payment** column. See "The last payment" in section 11. |
| **Total interest** | "Interest charged over the term, including any not yet paid." This is the interest charged by the schedule, the same amount that goes into the cost of borrowing. It is not the total of the **Interest paid** column, and it can be higher than that total if some interest was still unpaid at the end. Accrued interest you entered for a Renewal or change counts only as far as the payments repay it. |
| **Total principal paid** | The total of the schedule's **Principal paid** column. |

### More figures

Select **More figures** to open this section.

| Figure | What it means |
|---|---|
| **Balance at end date** | The loan balance after the last payment in the schedule. It is $0.00 if the loan is paid off within the term. It doesn't include unpaid interest. If interest is still unpaid, the next line shows it. |
| **Unpaid interest at end date** | Hint: "Owed in addition to the balance at end date". Shown only when interest is still unpaid after the last payment in the schedule (the last row's **Accrued interest (closing)** is more than $0). It isn't shown when the loan ends fully paid, for example the REF-01 example. It appears on screen and on the printout, but not in the CSV file. The wording may change. **(Change in progress: the hint is being reworded to "Unpaid after the last payment; interest since then is not included". Today's screen still shows the old hint above.)** |
| **Term in days** | The number of days from the start date (disbursal date, renewal date or date of change) to the date of the final payment in the schedule. |

**Limit of "Unpaid interest at end date".** This line covers interest that was charged on the payment dates and not paid. It does **not** include interest that builds up between the **last payment date** and the **End Date**. That interest is in neither **Balance at end date** nor this line. Example: the last payment is on 2028-04-01 and the End Date is 2028-04-15. That is about 14 days, roughly $380 on a $200,000 balance. So **Balance at end date** plus **Unpaid interest at end date** is not the complete amount owed on the End Date. Don't quote the sum as a payout figure.

**Display precision.** Amounts are shown to the cent. Rates are shown to 5 decimal places. The calculator doesn't round anything while it calculates; it rounds only for display.

### Contract terms

Under the form, **Contract terms** lists the inputs behind the results shown: flow, product type, rate type, loan amount, contract rate, payment amount, accrued interest (for renewals and payment changes), payment frequency, contract term (as years, months and days), the start date and first payment date (named for the flow, for example **Date of change** and **Next payment date** for a payment change), end date, and each fee with its amount ("No fees" if there are none). Use it to check that the results match what you meant to enter.

---

## 11. Reading the amortization schedule

The **Amortization schedule** has one row per payment. The number of payments is shown next to the heading. Rows are grouped by year, and a **Totals** row is at the bottom.

### Columns

| Group | Column | What it shows |
|---|---|---|
| | **#** | The payment number. |
| | **Date** | The payment date. |
| | **Days** | Days since the previous payment (for payment 1, since the start date). Interest is charged on these actual days. |
| Opening | **Opening balance** | The loan balance at the start of the period. |
| Interest | **Period interest** | Interest charged for this period. |
| Interest | **Accrued interest (opening)** | Unpaid interest at the start of the period: any accrued interest you entered that is still owing, plus interest from earlier periods that payments didn't cover. It isn't part of the **Opening balance** and earns no interest. |
| Payment breakdown | **Payment** | The payment applied in this period. |
| Payment breakdown | **Interest paid** | The part of the payment that paid interest. |
| Payment breakdown | **Principal paid** | The part of the payment that reduced the principal. |
| Closing | **Accrued interest (closing)** | Unpaid interest still owing after the payment. |
| Closing | **Balance** | The loan balance after the payment (principal still owing; unpaid interest is not included). It becomes the next row's opening balance. |

The **Totals** row shows the term in days and the totals of **Payment**, **Interest paid** and **Principal paid**. Under **Balance** it shows the balance at the end date.

### All or Compact columns

Use **Columns: All** or **Compact** above the table.

- **All** shows every column.
- **Compact** shows **#**, **Date**, **Payment**, **Interest paid**, **Principal paid** and **Balance**.

Wide screens start with **All**, narrow screens with **Compact**. Your choice also applies to the printout and the CSV download. The printout uses shorter column headings; see section 12.

### How each payment is split

Each payment is applied in this order:

1. **Interest** first: any accrued interest from before the renewal or change, and the interest for the period.
2. **Principal** gets whatever is left.

If a payment doesn't cover all the interest due, the unpaid interest is held separately from the loan balance. It doesn't earn interest. Later payments pay it first, oldest first: accrued interest you entered is paid before any interest left unpaid in a later period. You can see the amount in the **Accrued interest (opening)** and **Accrued interest (closing)** columns.

All interest charged in the periods counts in the cost of borrowing, whether or not it has been paid. Accrued interest you entered counts only as it is paid.

Interest still unpaid after the last payment is shown in the last row's **Accrued interest (closing)** column. It is also shown as **Unpaid interest at end date** in the figures, on screen and in the printout, but only when it is more than $0 (see "More figures" in section 10). This line does not include interest that builds up between the last payment date and the End Date.

### How interest is worked out

Interest is charged on the actual number of days between payments, on a 365-day year. When a period runs into or out of a leap year, the days in the leap year are divided by 366 and the other days by 365.

### How payment dates are set

Payment 1 is always on the **First payment date**. Later dates depend on the frequency:

| Frequency | Later payment dates |
|---|---|
| **Weekly** | Every 7 days. |
| **Bi-weekly** | Every 14 days from the first payment date. |
| **Semi-monthly** | Two payments a month, on the 15th and the last day of the month. If the first payment date is on neither, it is first moved forward to the next 15th or month-end (see section 6), and the payments alternate from there. |
| **Monthly** | The same day each month. In a shorter month, the payment moves to the last day of that month (Jan 30 → Feb 28 → Mar 30). If the first payment is on the **last day** of its month, every payment is on the last day of its month (Apr 30 → May 31 → Jun 30). |

The schedule stops at the **End date** (a payment that falls on the end date is included) or when the loan is paid off, whichever comes first.

### The last payment

If a payment is more than what is left to pay, the loan is paid off on that row. On that row:

- interest is paid as normal, and **Principal paid** is the remaining principal;
- the **Payment** column shows **only the remaining principal**, not the interest paid on that row;
- the **Balance** is $0.00.

Because of this, **Total of all payments** leaves out the interest paid on the final row. This matches the Excel workbook.

### Rounding in the table

The table shows amounts rounded to the cent. The calculator keeps full precision, so a column may not add up to its total to the exact cent. Download the CSV for the exact values.

---

## 12. Printing, saving as PDF, and downloading a CSV

The two buttons under the results only work when a result is showing. Otherwise the hint "Calculate first. Print and download need a current result." appears under them.

### Print or save as PDF

1. Make sure the result you want is showing.
2. Choose **Columns: All** or **Compact** for the schedule.
3. Select **Print or save as PDF**.
4. In your browser's print window, choose a printer, or choose **Save as PDF** to keep a file.

The printed schedule is prepared when you open the print window, from the result that is showing. It always matches the screen.

The printout is headed "Alterna Savings — Cost of borrowing calculation" and shows:

- when it was printed and the engine version, and the time of the calculation;
- **Inputs**: every input, including the use case and the **Contract term**. The date rows use the same names as the screen for the flow. Dollar amounts are in money format, for example $227,829.65. The printout keeps the first payment date you typed. If the calculator moved a semi-monthly first date, one extra row, **Moved first date**, sits right under it and holds the same note as the screen. The row is not there when nothing moved;
- **Fees**: each fee with its name and amount, or "No fees." if there are none;
- the note "* Payment amount does not include taxes.";
- **Results**: every figure, including the **More figures**;
- the **Amortization schedule** with the columns you chose.

**Column headings in the printed schedule.** So that every column fits on the page, the printed schedule uses short column headings. The group headings above them (**Opening**, **Interest**, **Payment breakdown**, **Closing**) tell you which is which. This applies to both **All** and **Compact**. The screen and the CSV download keep the full headings.

| Group | Printed heading | Same as on screen |
|---|---|---|
| | **#** | **#** |
| | **Date** | **Date** |
| | **Days** | **Days** |
| Opening | **Balance** | **Opening balance** |
| Interest | **Period** | **Period interest** |
| Interest | **Accrued** | **Accrued interest (opening)** |
| Payment breakdown | **Payment** | **Payment** |
| Payment breakdown | **Interest** | **Interest paid** |
| Payment breakdown | **Principal** | **Principal paid** |
| Closing | **Accrued** | **Accrued interest (closing)** |
| Closing | **Balance** | **Balance** |

The schedule prints at full size. For example, the sample that opens with the page prints on 5 pages.

**Tip: very large amounts.** If any amount in the schedule is $100,000,000 or more, the printed schedule with **All** columns can be slightly wider than the page. If that happens, choose **Compact** before you print, or in the print window leave the scale on the setting that fits the page.

If you print while no result is showing, the printout says: "No current result. The inputs changed after the last calculation, or nothing was calculated. Calculate, then print." Fix the inputs and print again.

The printout doesn't yet have "Prepared by", "Verified by" or "Portfolio #" lines like the Excel workbook's printout. Add them by hand if your process needs them.

### Download CSV

Select **Download CSV** to save the schedule as a spreadsheet file named `cost-of-borrowing-schedule-`*first payment date*`.csv`. If a semi-monthly first date was moved, the name uses the moved date, not the one you typed.

- It holds the **schedule only**: no inputs or results. Print or save as PDF if you need the full record.
- Amounts are exact (not rounded to the cent). Dates are in YYYY-MM-DD form.
- It has the columns you chose (**All** or **Compact**).
- It has no fee columns, like the on-screen schedule.

---

## 13. Privacy

The calculator doesn't store what you enter. It doesn't send your inputs anywhere. The CSV and PDF are created in your browser and saved only where you choose. When the page is opened fresh, it starts again from the sample values, with no fees (the **Accrued interest ($)** box is blank).

Keep printed or saved records according to Alterna's record-keeping rules for member files.

---

## 14. Quick checklist

1. Choose the **Flow**, **Product type** and **Rate type**.
2. Replace the sample values: loan amount, contract rate, payment amount, frequency, dates. The **Contract term** fills in by itself.
3. Enter the flow's start date (**Disbursal date**, **Renewal date** or **Date of change**) and, for renewals and payment changes, the **Accrued interest ($)** (0 if none; for a payment change, arrears only).
4. Check the **Contract term** that appears. It should match the contract you expect (it runs from the first payment to the last).
5. Add the member's fees, if any. There is no **Financed?** box: every fee is a separate fee.
6. Check there is no red error message.
7. Check the **Contract terms** summary.
8. Read the results and schedule.
9. Select **Print or save as PDF** to keep the record.
