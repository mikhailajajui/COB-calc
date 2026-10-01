/**
 * One named constant per open business decision (COB-architecture.md §3.4), each at
 * today's implemented value. None of these decisions is settled here.
 *
 * Mechanism M1: the constants carry no type annotation, so each has its literal type.
 * `cobCanada.ts` pins each one with `NAME satisfies <literal>;` at the place where
 * today's rule lives. Changing a value here makes `tsc` fail at that pin, which is
 * where the alternative branch has to be written. Only today's branch is built.
 * `UNPAID_INTEREST_CAPITALISED` is a decided switch (mechanism M2, ADR-14): both branches are built; it has no `satisfies` pin.
 */

/**
 * @decision OQ-Q — basis of P, the average outstanding balance used in the COB rate.
 * Today `'openingBalance'`: P is the simple mean of each row's `openingBalance`, which
 * includes financed fees still owed and capitalised unpaid period interest (workbook
 * branch only) (`averageOutstandingBalance` in `cobCanada.ts`).
 * Alternative (not built): `'openingPrincipal'` (macro column E).
 */
export const P_BASIS = 'openingBalance';

/**
 * @decision OQ-R — how `principalPayment` is derived.
 * Today `'sumOfPrincipalPortion'`: `principalPayment` is the sum of `row.principalPortion`.
 * Alternative (not built): `'totalPaymentMinusInterest'` (macro J31).
 */
export const PRINCIPAL_PAID = 'sumOfPrincipalPortion';

/**
 * @decision OQ-W — W2: how IN-11 prior accrued interest counts in C.
 * Today `'whenPaid'`: IN-11 counts in `totalInterest` (so in C) only through
 * `row.interestPaid`; IN-11 unpaid at the end is not counted. Period interest unpaid at the end is counted in the shipped branch (B19).
 * Alternatives (not built): `'never'` (W2 suggested default "No"), `'inFull'`.
 */
export const PRIOR_ACCRUED_IN_COB = 'whenPaid';

/**
 * @decision OQ-W — W3: is IN-11 prior accrued interest part of P?
 * Today `false`: IN-11 never enters `openingBalance`, so it is not in P.
 * Alternative (not built): `true`.
 */
export const PRIOR_ACCRUED_IN_P = false;

/**
 * @decision OQ-L — does unpaid interest earn interest? Revised by stakeholder decision 1
 * (2026-09-29, DEV-OQL).
 * Switch (ADR-14): shipped `false`; the other branch `true` is built and tested.
 * `false`: no interest on interest. Every unpaid interest amount (IN-11 and period
 * shortfalls) is one bucket outside the balance, earning nothing; payments clear it oldest
 * first (IN-11 before any period shortfall, Q-W4-INT); C counts every period interest amount
 * charged, including any still unpaid at the end.
 * `true`: the workbook branch (macro l.461-462, 514, 540): T6 / OQ-L capitalisation, plus the
 * OQ-W interim rule while IN-11 is owed.
 */
export const UNPAID_INTEREST_CAPITALISED = false;

/**
 * @decision Q-SACD — is the semi-annual compounding reference date required for a fixed-rate mortgage?
 * Switch (ADR-14): shipped `false`; the other branch `true` is built and tested.
 * `false`: the date is optional (the UI does not ask for it); a present but invalid date is still rejected.
 * `true`: a fixed-rate mortgage must supply it.
 */
export const SEMI_ANNUAL_DATE_REQUIRED = false;
