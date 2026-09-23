export { annuityPaymentFromPeriodicRate, calculateMonthlyPayment } from './payment.js';
export { computeSegmentSchedule, addMonths } from './segment.js';
export type { SegmentResult } from './segment.js';
export { computeMortgageSchedule, summarizeMortgage } from './mortgage.js';
export { toSingleSegmentMortgage, summarizeLoan, fromHomePrice } from './loan.js';
export { round2 } from './money.js';
export { loanToValue, combinedLoanToValue } from './ltv.js';
export { debtServiceCoverageRatio } from './dscr.js';
export { calculatePointsBreakeven } from './points.js';
export type { PointsBreakevenInput, PointsBreakevenResult } from './points.js';
export { calculateRefinanceBreakeven, compareRefinance } from './refinance.js';
export type {
  RefinanceBreakevenInput,
  RefinanceComparisonInput,
  RefinanceComparisonResult,
} from './refinance.js';
export { compareLoanTerms } from './compare.js';
export type { TermComparisonEntry, TermComparisonResult } from './compare.js';
export { calculateExtraPaymentSavings } from './extraPayment.js';
export { calculatePaymentFrequencySchedule } from './paymentFrequency.js';
export { calculateArmResetRate } from './arm.js';
export type { ArmResetInput, ArmResetResult } from './arm.js';
export { calculatePmiPayment } from './pmi.js';
export { applyRecurringCosts } from './costs.js';
export { importOverridesFromJson, importOverridesFromCsv } from './importOverrides.js';
export type { BankStatementRow } from './importOverrides.js';

// Canadian Cost of Borrowing (COB) disclosure engine -- a sibling module to the above
// US-style engine, per docs/new-req/006-cost-of-borrowing-disclosure.md.
export { calculateCobCanada } from './ca/cobCanada.js';
export type {
  CobCanadaInput,
  CobCanadaResult,
  CobFlow,
  CobScheduleRow,
  ProductType,
  RateType,
} from './ca/types.js';
export {
  totalCashFees,
  totalFees,
  totalFeesIncludedInCob,
  totalFinancedFees,
  validateFee,
  validateFeeSchedule,
} from './ca/fees.js';
export type { Fee, FeeSchedule } from './ca/fees.js';
export {
  applyPaymentWaterfall,
  calculatedRate,
  cobAmount,
  cobRatePercent,
  costOfBorrowingRatePercent,
  dayCountFraction,
  daysBetween,
  periodInterest,
  selectCompoundingPeriodsPerYear,
  triggerRatePercent,
} from './ca/equations.js';
export type { PaymentWaterfallResult } from './ca/equations.js';

export type {
  Segment,
  ManualPaymentOverride,
  MortgageInput,
  AmortizationEntry,
  SegmentSummary,
  LoanSummary,
  LoanInput,
  HomePriceLoanInput,
  LumpSumPayment,
  ExtraPaymentSavingsInput,
  ExtraPaymentSavingsResult,
  PaymentFrequency,
  PaymentFrequencyScheduleInput,
  PaymentFrequencyScheduleResult,
  PeriodAmortizationEntry,
  RecurringCost,
  RecurringCosts,
  PmiInput,
  CostBreakdownSummary,
} from './types.js';
