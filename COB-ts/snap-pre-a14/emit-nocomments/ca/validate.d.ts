import type { CobCanadaInput } from './types.js';
export interface ValidatedInput {
    readonly startDate: Date;
}
export interface InputIssue {
    readonly field: keyof CobCanadaInput;
    readonly message: string;
}
export declare function validateCobCanadaInput(input: CobCanadaInput): ValidatedInput;
export declare function collectInputIssues(input: CobCanadaInput): InputIssue[];
