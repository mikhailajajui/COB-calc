/**
 * B37-T11 type-level tests (COB-architecture.md section 5 B37 addendum, revision 57, B37-L1..L4; ADR-13(j); DEC-B37-LEAP-N;
 * label format: whole numbers). QA red step, 2026-10-09. sr-dev must not edit this file.
 *
 * Not a vitest file: only `npm run typecheck:tests` compiles it. Before B37 the engine imports do not exist (TS2305 /
 * TS2724), so the gate is red; after B37 every line compiles and every `@ts-expect-error` directive is used.
 *   - `paymentsPerYearFor(input, frequency): number` is on BOTH barrels;
 *   - `conversionPaymentsPerYear` / `leapAwarePaymentsPerYear` (equations.ts) and `paymentPeriodDays` (calendar.ts) are
 *     internal, with the brief's signatures;
 *   - `frequencyOptionText(frequency, paymentsPerYear): string` is declared by the QA-owned ui/ca-view.d.ts.
 * Every declaration is exported so unused-local settings never matter.
 */
import { paymentsPerYearFor } from '../../src/ca/index.js';
import type { CobCanadaInput, PaymentFrequency } from '../../src/ca/index.js';
import { paymentsPerYearFor as rootPaymentsPerYearFor } from '../../src/index.js';
import { conversionPaymentsPerYear, leapAwarePaymentsPerYear } from '../../src/ca/equations.js';
import { paymentPeriodDays } from '../../src/ca/calendar.js';
import * as v from '../../ui/ca-view.js';

declare const input: CobCanadaInput;
declare const f: PaymentFrequency;

/** B37-TT-1 (compiles): the label's n, on both barrels. */
export const n1: number = paymentsPerYearFor(input, 'weekly');
export const n2: number = rootPaymentsPerYearFor(input, f);
/** B37-TT-2 (error): the frequency is required (the UI asks for every option, not only the selected one). */
// @ts-expect-error B37-TT-2 the frequency is required
export const n3 = paymentsPerYearFor(input);
/** B37-TT-3 (error): the frequency is a PaymentFrequency. */
// @ts-expect-error B37-TT-3 'daily' is not a PaymentFrequency
export const n4 = paymentsPerYearFor(input, 'daily');
/** B37-TT-4 (compiles): the internal choice point and equation 1's n. */
export const n5: number = conversionPaymentsPerYear('mortgage', 'fixed', 'biweekly', new Date(0), undefined, true);
export const n6: number = leapAwarePaymentsPerYear(14, new Date(0), new Date(86_400_000));
export const p1: 7 | 14 | null = paymentPeriodDays(f);
/** B37-TT-5 (compiles): the view formatter. */
export const t1: string = v.frequencyOptionText('weekly', 52);
export const t2: string = v.frequencyOptionText(f, paymentsPerYearFor(input, f));
/** B37-TT-6 (error): the per-year figure is a number, never a pre-formatted string. */
// @ts-expect-error B37-TT-6 paymentsPerYear is a number
export const t3 = v.frequencyOptionText('weekly', '52');
