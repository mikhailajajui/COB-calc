/**
 * A16 type-level tests (COB-architecture.md §5 A16; moved here by A12b-R6, revision 14, with the
 * user's approval 2026-09-29): `Fee` and `FeeSchedule` are part of the CA public API (user
 * decision, 2026-09-27): importable as types from src/ca/index.ts, and the SAME types as the ones
 * reachable through src/ca/fees.ts (which re-exports them from types.ts).
 *
 * Not a vitest file (the name does not match `*.test.ts`): only `npm run typecheck:tests`
 * compiles it. This replaces the in-vitest compiler probe tests/api/a16-fee-types.test.ts,
 * which existed only until typecheck:tests (A12a) did. Removing `Fee` from the barrel gives TS2305
 * here and TS2322 on `sameFee`. Every declaration is exported so unused-local settings never matter.
 * (tests/api/exportSurface.test.ts also pins the barrel's type export list by source text.)
 * QA-owned; the developer must not edit this file.
 */
import type { CobCanadaInput, Fee, FeeSchedule } from '../../src/ca/index.js';
import type { Fee as FeesFee, FeeSchedule as FeesFeeSchedule } from '../../src/ca/fees.js';

export type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
export const sameFee: Equal<Fee, FeesFee> = true;
export const sameSchedule: Equal<FeeSchedule, FeesFeeSchedule> = true;
export const sameAsInputFees: Equal<FeeSchedule, CobCanadaInput['fees']> = true;

export const fee: Fee = { name: 'Appraisal', amount: 300, financed: false, includedInCob: true };
export const schedule: FeeSchedule = { fees: [fee] };
