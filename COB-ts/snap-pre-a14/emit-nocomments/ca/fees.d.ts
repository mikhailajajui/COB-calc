import { type Fee, type FeeSchedule } from './types.js';
export type { Fee, FeeSchedule } from './types.js';
export declare function validateFee(fee: Fee, index: number, report?: (message: string) => void): boolean;
export declare function validateFeeSchedule(schedule: FeeSchedule, report?: (message: string) => void): boolean;
export declare function totalFinancedFees(schedule: FeeSchedule): number;
export declare function totalCashFees(schedule: FeeSchedule): number;
