/**
 * B23 (COB-architecture.md section 5 B23, revision 24) and B28-R6 (revision 28): UI switch states for tests. QA-owned.
 *
 * `ON` / `OFF` are the financed pair (`financedOption` true / false); the other switch stays at its shipped value.
 * `ACCEL_ON` / `ACCEL_OFF` are the accelerated-frequencies pair; `financedOption` stays at its shipped value.
 * B24-R5: `CONTRACT_DATE_ON` / `CONTRACT_DATE_OFF` are the contractDateField pair; the other two stay at their shipped values
 * (the shared ON / OFF / ACCEL_* objects carry contractDateField at its shipped value, false).
 * Tests pass them as `ctx.switches` to the ui/ca-view.js functions, so both states run under vitest.
 * Frozen: a test cannot change a shared state by accident (F11 stays green).
 *
 * The shipped values are written out here on purpose (not read from UI_SWITCHES), so a wrong shipped
 * value cannot make the helper agree with it: the pins live in b23 / b28 tests.
 */
export interface TestUiSwitches {
  readonly financedOption: boolean;
  readonly acceleratedFrequencies: boolean;
  /** B24-R5: the Contract date field (shipped off). */
  readonly contractDateField: boolean;
  /** VRPC-hide (user 2026-10-01): the VRPC option of the Flow dropdown (shipped off). Optional: absent counts as off. */
  readonly variableRatePaymentChangeFlow?: boolean;
}

const SHIPPED_FINANCED = false;
const SHIPPED_ACCELERATED = false;
const SHIPPED_CONTRACT_DATE = false;

export const ON: TestUiSwitches = Object.freeze({ financedOption: true, acceleratedFrequencies: SHIPPED_ACCELERATED, contractDateField: SHIPPED_CONTRACT_DATE });
export const OFF: TestUiSwitches = Object.freeze({ financedOption: false, acceleratedFrequencies: SHIPPED_ACCELERATED, contractDateField: SHIPPED_CONTRACT_DATE });
export const ACCEL_ON: TestUiSwitches = Object.freeze({ financedOption: SHIPPED_FINANCED, acceleratedFrequencies: true, contractDateField: SHIPPED_CONTRACT_DATE });
export const ACCEL_OFF: TestUiSwitches = Object.freeze({ financedOption: SHIPPED_FINANCED, acceleratedFrequencies: false, contractDateField: SHIPPED_CONTRACT_DATE });

/** Both financed states, for `it.each(BOTH)`. */
export const BOTH: ReadonlyArray<readonly [string, TestUiSwitches]> = Object.freeze([
  ['financedOption on', ON],
  ['financedOption off', OFF],
] as const);

/** Both accelerated-frequencies states, for `it.each(BOTH_ACCEL)`. */
export const BOTH_ACCEL: ReadonlyArray<readonly [string, TestUiSwitches]> = Object.freeze([
  ['acceleratedFrequencies on', ACCEL_ON],
  ['acceleratedFrequencies off', ACCEL_OFF],
] as const);

export const CONTRACT_DATE_ON: TestUiSwitches = Object.freeze({ financedOption: SHIPPED_FINANCED, acceleratedFrequencies: SHIPPED_ACCELERATED, contractDateField: true });
export const CONTRACT_DATE_OFF: TestUiSwitches = Object.freeze({ financedOption: SHIPPED_FINANCED, acceleratedFrequencies: SHIPPED_ACCELERATED, contractDateField: false });

/** Both contractDateField states (B24-R5), for `it.each(BOTH_CONTRACT_DATE)`. */
export const BOTH_CONTRACT_DATE: ReadonlyArray<readonly [string, TestUiSwitches]> = Object.freeze([
  ['contractDateField on', CONTRACT_DATE_ON],
  ['contractDateField off', CONTRACT_DATE_OFF],
] as const);

/** VRPC-hide: both states of variableRatePaymentChangeFlow; the other three keys stay at their shipped values. */
export const VRPC_ON: TestUiSwitches = Object.freeze({ financedOption: SHIPPED_FINANCED, acceleratedFrequencies: SHIPPED_ACCELERATED, contractDateField: SHIPPED_CONTRACT_DATE, variableRatePaymentChangeFlow: true });
export const VRPC_OFF: TestUiSwitches = Object.freeze({ financedOption: SHIPPED_FINANCED, acceleratedFrequencies: SHIPPED_ACCELERATED, contractDateField: SHIPPED_CONTRACT_DATE, variableRatePaymentChangeFlow: false });
export const BOTH_VRPC: ReadonlyArray<readonly [string, TestUiSwitches]> = Object.freeze([
  ['variableRatePaymentChangeFlow on', VRPC_ON],
  ['variableRatePaymentChangeFlow off', VRPC_OFF],
] as const);
