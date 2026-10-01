/**
 * B24-R5 (COB-architecture.md section 5 B24, revision 31; decision Q-SACD): engine switch states of
 * `SEMI_ANNUAL_DATE_REQUIRED` for tests. QA-owned.
 *
 * `validateCobCanadaInput` / `collectInputIssues` read the switch through `requiresSemiAnnualDate`'s
 * defaulted last parameter (mechanism M2), so they take no switch argument. To run them in both states
 * the helper re-imports `validate.ts` with `policies.ts` mocked: `SEMI_ANNUAL_DATE_REQUIRED` = `required`.
 * The real `policies.ts` is spread first, so every other constant keeps its shipped value, and the
 * override adds the constant even before sr-dev has written it (red step).
 *
 * `SHIPPED_SEMI_REQUIRED` is written out here on purpose (not read from policies.ts): the value pin lives in
 * b24-form-cleanup.test.ts, so a flip of the shipped value cannot make the helper agree with it.
 */
import { vi } from 'vitest';
import type { CobCanadaInput, CobCanadaResult } from '../../../src/ca/index.js';

export const SHIPPED_SEMI_REQUIRED = false;

export interface ValidateApi {
  validateCobCanadaInput: (input: CobCanadaInput) => unknown;
  collectInputIssues: (input: unknown) => { field: string; message: string }[];
  calculateCobCanada: (input: CobCanadaInput) => CobCanadaResult;
}

/** `validate.ts` and `cobCanada.ts` loaded with `SEMI_ANNUAL_DATE_REQUIRED = required` (fresh module graph per call). */
export async function loadValidate(required: boolean): Promise<ValidateApi> {
  vi.resetModules();
  vi.doMock('../../../src/ca/policies.js', async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    SEMI_ANNUAL_DATE_REQUIRED: required,
  }));
  try {
    const validateModule = await import('../../../src/ca/validate.js');
    const engine = await import('../../../src/ca/cobCanada.js');
    return {
      validateCobCanadaInput: validateModule.validateCobCanadaInput as ValidateApi['validateCobCanadaInput'],
      collectInputIssues: (validateModule as unknown as ValidateApi).collectInputIssues,
      calculateCobCanada: engine.calculateCobCanada,
    };
  } finally {
    vi.doUnmock('../../../src/ca/policies.js');
  }
}

/** Both switch states, for `it.each(BOTH_SEMI)`: [label, required]. */
export const BOTH_SEMI: ReadonlyArray<readonly [string, boolean]> = Object.freeze([
  ['SEMI_ANNUAL_DATE_REQUIRED on', true],
  ['SEMI_ANNUAL_DATE_REQUIRED off', false],
] as const);
