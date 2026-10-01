// Library root: the public API of the COB calculator is the CA barrel (ADR-05, ADR-13).
export {
  FLOWS, PAYMENTS_PER_YEAR, allowedPaymentFrequencies, calculateCobCanada, collectInputIssues, contractTerm, requiresSemiAnnualDate,
} from './ca/index.js';
export type {
  CobCanadaInput, CobCanadaResult, CobFlow, CobScheduleRow, ContractTerm, Fee, FeeSchedule, FlowSpec, InputIssue,
  PaymentFrequency, ProductType, RateType,
} from './ca/index.js';
