// Canadian Cost of Borrowing (COB) engine: the public API. The UI imports only this
// module (COB-architecture.md ADR-05, F2).
export { calculateCobCanada, contractTerm, contractTermOptions, paymentsPerYearFor } from './cobCanada.js';
export { FLOWS, requiresSemiAnnualDate } from './flows.js';
export type { FlowSpec } from './flows.js';
export { PAYMENTS_PER_YEAR } from './types.js';
export { allowedPaymentFrequencies } from './products.js';
export { collectInputIssues } from './validate.js';
export type { InputIssue } from './validate.js';
export type {
  CobCanadaInput,
  CobCanadaResult,
  CobFlow,
  CobScheduleRow,
  ContractTerm,
  ContractTermMonths,
  ContractTermOptions,
  Fee,
  FeeSchedule,
  PaymentFrequency,
  ProductType,
  RateType,
} from './types.js';
