# Decision registry

This file lists the open or switchable business decisions that the engine cites with a `@decision` tag in `src/ca/policies.ts`, one row per decision ID. It mirrors the business record (`COB-user-stories.md`), which is kept in the project repository outside this folder; the "Business record" column names the section of that document where each decision is recorded. The architecture test F7 (`tests/architecture/f7-decisions-registered.test.ts`) checks that this table lists exactly the `@decision` IDs of `policies.ts`. A row is added or removed in the same task as its `@decision` tag in `src/ca/policies.ts`.

| ID | Decision (one line) | Status | Business record |
|---|---|---|---|
| OQ-Q | Basis of P, the average outstanding balance used in the COB rate. | On hold: FB-11 is on hold (decision 3); today's workbook rule is kept. | COB-user-stories.md §7.1 |
| OQ-R | How `principalPayment` is derived. | Open: should Principal Paid exclude fees (BRD), or keep the workbook's Total Payments − Interest? | COB-user-stories.md §7.3 |
| OQ-W | W2: how IN-11 prior accrued interest counts in C; W3: is IN-11 prior accrued interest part of P? | Partly decided 2026-09-29: W2 parked with today's rule (decision 11); W3 still open. | COB-user-stories.md §7.1, §7.4 |
| OQ-L | Does unpaid interest earn interest? | Revised 2026-09-29 (decision 1 + Q-W4-INT); delivered B19 (DEV-OQL; CHANGES §48). | COB-user-stories.md §6, §7.1 |
| Q-SACD | Is the semi-annual compounding reference date required for a fixed-rate mortgage? | Decided 2026-09-29; delivered B24 (CHANGES §56). | COB-user-stories.md §7.1 |
| DEC-B37-LEAP-N | Payments per year n in equation 1 (fixed-rate mortgage, SEMI-ANNUAL basis) for the 7- and 14-day frequencies (Weekly, Accelerated weekly, Bi-weekly, Accelerated bi-weekly). | Decided by the user 2026-10-09; delivered B37 (CHANGES §75, QA PASS WITH NOTES); Q-B37-LAW and Q-B37-WHICH-EXCEL still open. | COB-user-stories.md §7.5 |
| DEC-B38-YEARFRAC-ROUND | Excel YEARFRAC (basis 1) for Y in the leap-aware n, and period interest rounded to the cent before the payment waterfall, for the B37 cases only. | Decided by the user 2026-10-10; delivered B38 (CHANGES §76, QA PASS WITH NOTES). | COB-user-stories.md §7.5 |
| DEC-B39-VAR-PL-M12 | The MONTHLY rate basis (variable-rate mortgage, personal loan of either rate type) at the 7- and 14-day frequencies (Weekly, Accelerated weekly, Bi-weekly, Accelerated bi-weekly), all flows. | Decided by the user 2026-10-13; delivered in code B39 (CHANGES §77, not yet QA verified); deviation ID DEV-B39-M12 is a suggested ID that needs the user's sign-off. | COB-user-stories.md §7.5 |
