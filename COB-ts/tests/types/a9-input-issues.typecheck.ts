/**
 * A9 type-level tests (COB-architecture.md §5 A9, rules A9-R2 and A9-R4, revision 13; §3.5 Errors;
 * ADR-13(f)). QA step written 2026-09-29, before the developer step. The developer must not edit
 * this file.
 *
 * Not a vitest file (the name does not match `*.test.ts`): only `npm run typecheck:tests`
 * compiles it. Types and the function come from the CA public barrel, so this also pins A9-R4.
 *   Red today: TS2305 (the barrel has no `InputIssue` / `collectInputIssues`), and T2's directive
 *              is then unused (TS2578).
 *   After A9:  0 errors.
 * Every case is on one line so each directive covers exactly one declaration, and every
 * declaration is exported so unused-local settings never matter.
 */
import type { CobCanadaInput, InputIssue } from '../../src/ca/index.js';
import { collectInputIssues } from '../../src/ca/index.js';

/** A9-T1 (compiles): `field` is a top-level input key; `renewalDate` is one (from ExistingLoanInput). */
export const t1: InputIssue = { field: 'renewalDate', message: '' };

/** A9-T2 (error): `startDate` is a ValidatedInput key, not an input key. */
// @ts-expect-error A9-T2 field must be keyof CobCanadaInput
export const t2: InputIssue = { field: 'startDate', message: '' };

/** A9-T3 (compiles): collectInputIssues takes a CobCanadaInput and returns InputIssue[]. */
export function t3(x: CobCanadaInput): InputIssue[] { const all: InputIssue[] = collectInputIssues(x); return all; }
