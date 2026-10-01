import type { CobCanadaInput, CobCanadaResult, ContractTerm } from './types.js';
export interface EngineSwitches {
    readonly unpaidInterestCapitalised: boolean;
}
export declare const SHIPPED_SWITCHES: EngineSwitches;
export declare function calculateCobCanada(input: CobCanadaInput): CobCanadaResult;
export declare function calculateCobCanadaWith(input: CobCanadaInput, switches: EngineSwitches): CobCanadaResult;
export declare function contractTerm(result: Pick<CobCanadaResult, 'amortizationSchedule'>): ContractTerm;
