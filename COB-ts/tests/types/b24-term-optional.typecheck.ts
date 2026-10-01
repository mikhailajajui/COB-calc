/**
 * B24 type-level tests (COB-architecture.md section 5 B24, revision 31, T5; ADR-13(h); DEV-OQP).
 * QA step written 2026-09-30, before the developer step. The developer must not edit this file.
 *
 * Not a vitest file (the name does not match `*.test.ts`): only `npm run typecheck:tests` compiles it.
 * Each `@ts-expect-error` case is a compile error after B24; before B24 its directive is unused (TS2578), or the
 * import does not exist (TS2305 / TS2339), so the gate is red.
 *   - termYears / termMonths are OPTIONAL on every flow's input (a caller may leave them out); numbers still compile.
 *   - `contractTerm` and the type `ContractTerm` are on BOTH barrels; `termBetween` returns a `ContractTerm`.
 *   - the UI's `RawForm` no longer has the term keys; `contractDate` and `semiAnnualCompoundingDate` are optional there.
 * The @deprecated tag on the two fields is checked in tests/ca/b24-term-rule.test.ts (source text).
 * Every declaration is exported so unused-local settings never matter.
 */
import { contractTerm } from '../../src/ca/index.js';
import type { CobCanadaInput, CobCanadaResult, ContractTerm } from '../../src/ca/index.js';
import { contractTerm as rootContractTerm } from '../../src/index.js';
import type { ContractTerm as RootContractTerm } from '../../src/index.js';
import { termBetween } from '../../src/ca/calendar.js';
import type { RawForm, UiSwitches } from '../../ui/ca-view.js';

const d = new Date('2027-01-01T00:00:00Z');

const common = {
  productType: 'mortgage' as const,
  rateType: 'variable' as const,
  loanAmount: 250000,
  contractRatePercent: 5.19,
  paymentAmount: 1300,
  paymentFrequency: 'monthly' as const,
  firstPaymentDate: new Date('2027-02-01T00:00:00Z'),
  endDate: new Date('2028-02-01T00:00:00Z'),
  fees: { fees: [] },
};

/** B24-T5-1 (compiles): a new loan with no term fields at all. */
export const a1: CobCanadaInput = { ...common, flow: 'newMortgageOrLoan', disbursalDate: d };
/** B24-T5-2 (compiles): a renewal with no term fields. */
export const a2: CobCanadaInput = { ...common, flow: 'renewal', renewalDate: d, accruedInterest: 0 };
/** B24-T5-3 (compiles): a payment change with no term fields. */
export const a3: CobCanadaInput = { ...common, flow: 'paymentChange', renewalDate: d, accruedInterest: 0 };
/** B24-T5-4 (compiles): a VRPC with no term fields. */
export const a4: CobCanadaInput = { ...common, flow: 'variableRatePaymentChange', renewalDate: d, accruedInterest: 0 };
/** B24-T5-5 (compiles): the fields are still accepted when present (deprecated, ignored). */
export const a5: CobCanadaInput = { ...common, flow: 'newMortgageOrLoan', disbursalDate: d, termYears: 3, termMonths: 0 };
/** B24-T5-6 (compiles): only one of the two. */
export const a6: CobCanadaInput = { ...common, flow: 'newMortgageOrLoan', disbursalDate: d, termMonths: 6 };
/** B24-T5-7 (error): the fields are still numbers when present. */
// @ts-expect-error B24-T5-7 termYears must be a number
export const a7: CobCanadaInput = { ...common, flow: 'newMortgageOrLoan', disbursalDate: d, termYears: '3' };

/** B24-T5-8 (compiles): the ContractTerm shape, identical on the root barrel. */
export const t8: ContractTerm = { years: 2, months: 11, days: 17 };
export const t8b: RootContractTerm = t8;
/** B24-T5-9 (error): all three members are required. */
// @ts-expect-error B24-T5-9 days is required
export const t9: ContractTerm = { years: 2, months: 11 };
/** B24-T5-10 (error): members are numbers. */
// @ts-expect-error B24-T5-10 years is a number
export const t10: ContractTerm = { years: '2', months: 11, days: 17 };

/** B24-T5-11 (compiles): contractTerm takes the whole result or just its schedule, and returns a ContractTerm. */
export const f11 = (r: CobCanadaResult): ContractTerm => contractTerm(r);
export const f11b = (): ContractTerm => contractTerm({ amortizationSchedule: [] });
export const f11c = (r: CobCanadaResult): RootContractTerm => rootContractTerm(r);
/** B24-T5-12 (error): a bare array is not a result. */
// @ts-expect-error B24-T5-12 contractTerm takes an object with amortizationSchedule
export const f12 = (r: CobCanadaResult) => contractTerm(r.amortizationSchedule);

/** B24-T5-13 (compiles): termBetween(from, to) returns a ContractTerm. */
export const f13: ContractTerm = termBetween(d, d);

/** B24-T5-14 (error): the UI's RawForm has no term keys. */
// @ts-expect-error B24-T5-14 termYears is not part of RawForm any more
export const r14: RawForm = { flow: 'newMortgageOrLoan', productType: 'mortgage', rateType: 'fixed', loanAmount: '', contractRatePercent: '', paymentAmount: '', paymentFrequency: 'monthly', termYears: '3', firstPaymentDate: '', endDate: '', disbursalDate: '', renewalDate: '', accruedInterest: '', fees: [] };
/** B24-T5-15 (compiles): a RawForm without contractDate and semiAnnualCompoundingDate. */
export const r15: RawForm = { flow: 'newMortgageOrLoan', productType: 'mortgage', rateType: 'fixed', loanAmount: '', contractRatePercent: '', paymentAmount: '', paymentFrequency: 'monthly', firstPaymentDate: '', endDate: '', disbursalDate: '', renewalDate: '', accruedInterest: '', fees: [] };
/** B24-T5-16 (compiles): the UI switches carry contractDateField. */
export const s16: UiSwitches = { financedOption: false, acceleratedFrequencies: false, contractDateField: false };
/** B24-T5-17 (error): contractDateField is required on the switches type. */
// @ts-expect-error B24-T5-17 contractDateField is required
export const s17: UiSwitches = { financedOption: false, acceleratedFrequencies: false };
