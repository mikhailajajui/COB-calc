/**
 * A8 type-level tests (COB-architecture.md §5 A8 and §3.3, revision 12; ADR-09, ADR-13(e)).
 * QA step written 2026-09-29, before the developer step. The developer must not edit this file.
 *
 * Not a vitest file (the name does not match `*.test.ts`): only `npm run typecheck:tests`
 * compiles it. Each `@ts-expect-error` case is a compile error under the §3.3 union; before A8
 * each directive is unused (TS2578), so the gate is red.
 *   Red today:  7 errors in this file (T3-T6: 4 x TS2578; T7: 2 x TS2322; T8: 1 x TS2339).
 *   After A8:   0 errors.
 *
 * Pending decisions, NOT settled here (the union keeps today's behaviour):
 *   - OQ-A: the existing-loan flows keep the one field name `renewalDate` (labels in flows.ts).
 *   - OQ-B / BR-05 settled by B20 (stakeholder decision 4, ADR-13(g)): `accruedInterest` is
 *     REQUIRED for renewal, paymentChange and variableRatePaymentChange (cases B20-T1..T4 at the
 *     end of this file; before B20 the three T1..T3 directives are unused, TS2578, 3 errors).
 *     A8-T3's error is the missing `renewalDate` (it also lacks `accruedInterest`; still one
 *     error on one declaration).
 * Every case is on one line so each directive covers exactly one declaration, and every
 * declaration is exported so unused-local settings never matter.
 */
import type { CobCanadaInput } from '../../src/ca/index.js';
import { validateCobCanadaInput } from '../../src/ca/validate.js';

const d = new Date('2027-01-01T00:00:00Z');

/** Every `CobInputCommon` field except `fees`. */
export const common = {
  productType: 'mortgage',
  rateType: 'variable',
  loanAmount: 250000,
  contractRatePercent: 5.19,
  paymentAmount: 1300,
  paymentFrequency: 'monthly',
  firstPaymentDate: new Date('2027-02-01T00:00:00Z'),
  endDate: new Date('2028-02-01T00:00:00Z'),
  termYears: 1,
  termMonths: 0,
  semiAnnualCompoundingDate: new Date('2027-01-01T00:00:00Z'),
} as const;

/** A8-T1 (compiles): a new loan with its start date. */
export const t1: CobCanadaInput = { ...common, fees: { fees: [] }, flow: 'newMortgageOrLoan', disbursalDate: d };

/** A8-T2 (compiles): a renewal with its start date and its accrued interest (required since B20). */
export const t2: CobCanadaInput = { ...common, fees: { fees: [] }, flow: 'renewal', renewalDate: d, accruedInterest: 10 };

/** A8-T3 (error): a renewal without `renewalDate`. */
// @ts-expect-error A8-T3 renewal requires renewalDate
export const t3: CobCanadaInput = { ...common, fees: { fees: [] }, flow: 'renewal' };

/** A8-T4 (error): a new loan without `disbursalDate`. */
// @ts-expect-error A8-T4 newMortgageOrLoan requires disbursalDate
export const t4: CobCanadaInput = { ...common, fees: { fees: [] }, flow: 'newMortgageOrLoan' };

/** A8-T5 (error): a new loan carrying `accruedInterest` (not taken by this flow). */
// @ts-expect-error A8-T5 newMortgageOrLoan does not take accruedInterest
export const t5: CobCanadaInput = { ...common, fees: { fees: [] }, flow: 'newMortgageOrLoan', disbursalDate: d, accruedInterest: 10 };

/** A8-T6 (error): a payment change carrying both start dates (mixes flows). */
// @ts-expect-error A8-T6 paymentChange does not take disbursalDate
export const t6: CobCanadaInput = { ...common, fees: { fees: [] }, flow: 'paymentChange', renewalDate: d, disbursalDate: d };

/** A8-T7 (compiles): narrowing by `flow` gives a `Date` with no `!`. */
export function startOf(x: CobCanadaInput): Date { return x.flow === 'newMortgageOrLoan' ? x.disbursalDate : x.renewalDate; }

/** A8-T8 (compiles): validation returns the flow's start date. */
export const s: Date = validateCobCanadaInput(t1).startDate;

/** B20-T1 (error): a renewal with its start date but without `accruedInterest` (required, decision 4). */
// @ts-expect-error B20-T1 renewal requires accruedInterest
export const b20t1: CobCanadaInput = { ...common, fees: { fees: [] }, flow: 'renewal', renewalDate: d };

/** B20-T2 (error): a payment change without `accruedInterest`. */
// @ts-expect-error B20-T2 paymentChange requires accruedInterest
export const b20t2: CobCanadaInput = { ...common, fees: { fees: [] }, flow: 'paymentChange', renewalDate: d };

/** B20-T3 (error): a variable-rate payment change without `accruedInterest`. */
// @ts-expect-error B20-T3 variableRatePaymentChange requires accruedInterest
export const b20t3: CobCanadaInput = { ...common, fees: { fees: [] }, flow: 'variableRatePaymentChange', renewalDate: d };

/** B20-T4 (compiles): `accruedInterest: 0` satisfies the requirement (zero is a value). */
export const b20t4: CobCanadaInput = { ...common, fees: { fees: [] }, flow: 'renewal', renewalDate: d, accruedInterest: 0 };
