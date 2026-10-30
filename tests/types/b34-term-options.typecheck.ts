/**
 * B34 type-level tests (COB-architecture.md section 5 B34, revision 53, B34-R1 / R2 / R7; ADR-13(i); DEC-B34-TERM).
 * QA red step, 2026-10-06. sr-dev must not edit this file.
 *
 * Not a vitest file: only `npm run typecheck:tests` compiles it. Before B34 the imports do not exist (TS2305 / TS2724), so
 * the gate is red; after B34 every line compiles and every `@ts-expect-error` directive is used.
 *   - `contractTermOptions` and the types `ContractTermMonths`, `ContractTermOptions` are on BOTH barrels;
 *   - `roundUpToWholeMonths` (calendar.ts, internal) takes a ContractTerm and returns a ContractTermMonths;
 *   - the view declarations of B34-R7 (`contractTermMonthsParts`, `contractTermChoice`, `ContractTermChoice`) accept the
 *     engine's options directly.
 * Every declaration is exported so unused-local settings never matter.
 */
import { calculateCobCanada, contractTermOptions } from '../../src/ca/index.js';
import type { CobCanadaInput, ContractTerm, ContractTermMonths, ContractTermOptions } from '../../src/ca/index.js';
import { contractTermOptions as rootContractTermOptions } from '../../src/index.js';
import type { ContractTermMonths as RootMonths, ContractTermOptions as RootOptions } from '../../src/index.js';
import { roundUpToWholeMonths } from '../../src/ca/calendar.js';
import { contractTermChoice, contractTermMonthsParts } from '../../ui/ca-view.js';
import type { ContractTermChoice, ContractTermChoiceOption } from '../../ui/ca-view.js';

declare const input: CobCanadaInput;

/** B34-TT-1 (compiles): the options shape, identical on the root barrel. */
export const o1: ContractTermOptions = contractTermOptions(input, calculateCobCanada(input));
export const o1b: RootOptions = rootContractTermOptions(input, { amortizationSchedule: [] });
export const m1: ContractTermMonths = o1.endDate;
export const m1b: RootMonths = o1.lastPayment;
/** B34-TT-2 (error): a whole-month term has no days. */
// @ts-expect-error B34-TT-2 days is not a member of ContractTermMonths
export const m2: ContractTermMonths = { years: 3, months: 0, days: 0 };
/** B34-TT-3 (error): both members are required. */
// @ts-expect-error B34-TT-3 months is required
export const m3: ContractTermMonths = { years: 3 };
/** B34-TT-4 (error): both options are required. */
// @ts-expect-error B34-TT-4 endDate is required
export const o4: ContractTermOptions = { lastPayment: { years: 3, months: 0 } };
/** B34-TT-5 (error): two arguments (input, result). */
// @ts-expect-error B34-TT-5 the result is required
export const o5 = contractTermOptions(input);

/** B34-TT-6 (compiles): the internal helper takes a Y/M/D term. */
const term: ContractTerm = { years: 2, months: 11, days: 27 };
export const r6: ContractTermMonths = roundUpToWholeMonths(term);

/** B34-TT-7 (compiles): the view takes the engine's options directly, and any string (or nothing) as the pick. */
export const c7: ContractTermChoice = contractTermChoice(o1, 'lastPayment');
export const c7b: ContractTermChoice = contractTermChoice(o1, undefined);
export const c7c: ContractTermChoice = contractTermChoice(o1, null);
export const p7: [string] | [string, string] = contractTermMonthsParts(o1.endDate);
export const first7: ContractTermChoiceOption | undefined = c7.choices?.[0];
/** B34-TT-8 (error): the basis is one of the two rules. */
// @ts-expect-error B34-TT-8 basis is 'lastPayment' | 'endDate'
export const b8: ContractTermChoice['basis'] = 'firstPayment';
