import type {
  ExtraPaymentSavingsInput,
  LoanInput,
  LumpSumPayment,
  ManualPaymentOverride,
  MortgageInput,
  PaymentFrequency,
  PaymentFrequencyScheduleInput,
  PmiInput,
  RecurringCosts,
  Segment,
} from './types.js';
import type { PointsBreakevenInput } from './points.js';
import type { RefinanceBreakevenInput } from './refinance.js';
import type { ArmResetInput } from './arm.js';
import type { BankStatementRow } from './importOverrides.js';

export function validatePaymentInputs(
  principal: number,
  annualInterestRatePercent: number,
  numberOfPayments: number,
): void {
  if (!(principal > 0)) {
    throw new RangeError(`principal must be > 0, got ${principal}`);
  }
  if (!(annualInterestRatePercent >= 0)) {
    throw new RangeError(`annualInterestRatePercent must be >= 0, got ${annualInterestRatePercent}`);
  }
  if (!(numberOfPayments > 0) || !Number.isInteger(numberOfPayments)) {
    throw new RangeError(`numberOfPayments must be a positive integer, got ${numberOfPayments}`);
  }
}

export function validateLoanInput(input: LoanInput): void {
  if (!(input.loanAmount > 0)) {
    throw new RangeError(`loanAmount must be > 0, got ${input.loanAmount}`);
  }
  if (!(input.annualInterestRatePercent >= 0)) {
    throw new RangeError(
      `annualInterestRatePercent must be >= 0, got ${input.annualInterestRatePercent}`,
    );
  }
  if (!(input.termYears > 0)) {
    throw new RangeError(`termYears must be > 0, got ${input.termYears}`);
  }
}

export function validateSegment(segment: Segment, index: number, totalSegments: number): void {
  const isLast = index === totalSegments - 1;

  if (index === 0) {
    if (!(segment.startingBalance !== undefined && segment.startingBalance > 0)) {
      throw new RangeError('segments[0].startingBalance is required and must be > 0');
    }
  } else if (segment.startingBalance !== undefined) {
    throw new RangeError(
      `segments[${index}].startingBalance is only valid on segments[0]; later segments inherit their starting balance from the previous segment's ending balance`,
    );
  }

  if (!(segment.annualInterestRatePercent >= 0)) {
    throw new RangeError(
      `segments[${index}].annualInterestRatePercent must be >= 0, got ${segment.annualInterestRatePercent}`,
    );
  }

  const hasPayment = segment.paymentAmount !== undefined;
  const hasAmortization = segment.amortizationMonthsRemaining !== undefined;
  if (!segment.interestOnly && !hasPayment && !hasAmortization) {
    throw new RangeError(
      `segments[${index}] must specify at least one of paymentAmount or amortizationMonthsRemaining, ` +
        'unless interestOnly is true',
    );
  }
  if (hasPayment && !(segment.paymentAmount! > 0)) {
    throw new RangeError(`segments[${index}].paymentAmount must be > 0, got ${segment.paymentAmount}`);
  }
  if (hasAmortization && !(segment.amortizationMonthsRemaining! > 0)) {
    throw new RangeError(
      `segments[${index}].amortizationMonthsRemaining must be > 0, got ${segment.amortizationMonthsRemaining}`,
    );
  }

  if (!isLast) {
    if (!(segment.termMonths !== undefined && segment.termMonths > 0)) {
      throw new RangeError(
        `segments[${index}].termMonths is required (and must be > 0) on every segment except the last`,
      );
    }
  } else if (segment.termMonths !== undefined && !segment.balloon) {
    // The last segment is what runs the mortgage to full payoff (a zero balance). If it
    // also had a termMonths, it would stop partway through with a nonzero balance and
    // nothing left to carry that balance into — silently misrepresenting an unpaid loan
    // as fully paid off. Cap it with another segment instead, or set balloon: true if a
    // nonzero payoff balance at termMonths is the deliberate intent.
    throw new RangeError(
      `segments[${index}].termMonths must be omitted on the last segment so it can run to full payoff, ` +
        `unless segments[${index}].balloon is true (a deliberate balloon payment due at termMonths) — ` +
        'remove termMonths, set balloon: true, or add another segment after this one for the remaining balance',
    );
  }

  if (segment.balloon && segment.termMonths === undefined) {
    throw new RangeError(
      `segments[${index}].balloon requires termMonths to be set (the balloon due date)`,
    );
  }
  if (segment.balloon && !isLast) {
    throw new RangeError(`segments[${index}].balloon is only valid on the last segment`);
  }

  if (segment.interestOnly && segment.termMonths === undefined) {
    throw new RangeError(
      `segments[${index}].interestOnly requires termMonths — an interest-only segment never ` +
        'amortizes to zero on its own; set termMonths (optionally with balloon: true) or follow ' +
        'it with another segment',
    );
  }
}

export function validateMortgageInput(input: MortgageInput): void {
  if (!input.segments || input.segments.length === 0) {
    throw new RangeError('MortgageInput.segments must contain at least one segment');
  }
  input.segments.forEach((segment, index) =>
    validateSegment(segment, index, input.segments.length),
  );
  validateLumpSumPayments(input.lumpSumPayments, input.segments);
  validateRecurringCosts(input.recurringCosts);
  if (input.pmi) validatePmiInput(input.pmi);
}

/** Precomputes the valid segment-boundary payment numbers (cumulative termMonths of
 *  every non-last segment) and checks each lump sum lands exactly on one — v1 only
 *  supports lump sums applied at a segment/renewal boundary, not mid-segment. */
export function validateLumpSumPayments(
  lumpSumPayments: LumpSumPayment[] | undefined,
  segments: Segment[],
): void {
  if (!lumpSumPayments || lumpSumPayments.length === 0) return;

  const boundaryPaymentNumbers: number[] = [];
  let cumulative = 0;
  for (let i = 0; i < segments.length - 1; i += 1) {
    cumulative += segments[i]!.termMonths!;
    boundaryPaymentNumbers.push(cumulative);
  }

  for (const lumpSum of lumpSumPayments) {
    if (!(lumpSum.amount > 0)) {
      throw new RangeError(`lumpSumPayments amount must be > 0, got ${lumpSum.amount}`);
    }
    if (!boundaryPaymentNumbers.includes(lumpSum.afterPaymentNumber)) {
      throw new RangeError(
        `lumpSumPayments.afterPaymentNumber (${lumpSum.afterPaymentNumber}) must be a segment ` +
          `boundary's last payment number — valid boundaries are: ${boundaryPaymentNumbers.join(', ') || '(none; only one segment)'}`,
      );
    }
  }
}

export function validateExtraPaymentSavingsInput(input: ExtraPaymentSavingsInput): void {
  if (!(input.loanAmount > 0)) {
    throw new RangeError(`loanAmount must be > 0, got ${input.loanAmount}`);
  }
  if (!(input.annualInterestRatePercent >= 0)) {
    throw new RangeError(
      `annualInterestRatePercent must be >= 0, got ${input.annualInterestRatePercent}`,
    );
  }
  if (!(input.termMonths > 0) || !Number.isInteger(input.termMonths)) {
    throw new RangeError(`termMonths must be a positive integer, got ${input.termMonths}`);
  }
  if (!(input.extraMonthlyPayment >= 0)) {
    throw new RangeError(`extraMonthlyPayment must be >= 0, got ${input.extraMonthlyPayment}`);
  }
}

const VALID_PAYMENT_FREQUENCIES: readonly PaymentFrequency[] = [
  'monthly',
  'semiMonthly',
  'biweekly',
  'weekly',
];

export function validatePaymentFrequencyScheduleInput(input: PaymentFrequencyScheduleInput): void {
  if (!(input.loanAmount > 0)) {
    throw new RangeError(`loanAmount must be > 0, got ${input.loanAmount}`);
  }
  if (!(input.annualInterestRatePercent >= 0)) {
    throw new RangeError(
      `annualInterestRatePercent must be >= 0, got ${input.annualInterestRatePercent}`,
    );
  }
  if (!(input.termMonths > 0) || !Number.isInteger(input.termMonths)) {
    throw new RangeError(`termMonths must be a positive integer, got ${input.termMonths}`);
  }
  if (!VALID_PAYMENT_FREQUENCIES.includes(input.frequency)) {
    throw new RangeError(
      `frequency must be one of ${VALID_PAYMENT_FREQUENCIES.join(', ')}, got ${input.frequency}`,
    );
  }
}

export function validateLtvInputs(loanAmount: number, propertyValue: number): void {
  if (!(loanAmount >= 0)) {
    throw new RangeError(`loanAmount must be >= 0, got ${loanAmount}`);
  }
  if (!(propertyValue > 0)) {
    throw new RangeError(`propertyValue must be > 0, got ${propertyValue}`);
  }
}

export function validateCltvInputs(
  firstLienBalance: number,
  secondLienBalance: number,
  propertyValue: number,
): void {
  if (!(firstLienBalance >= 0)) {
    throw new RangeError(`firstLienBalance must be >= 0, got ${firstLienBalance}`);
  }
  if (!(secondLienBalance >= 0)) {
    throw new RangeError(`secondLienBalance must be >= 0, got ${secondLienBalance}`);
  }
  if (!(propertyValue > 0)) {
    throw new RangeError(`propertyValue must be > 0, got ${propertyValue}`);
  }
}

export function validateDscrInputs(
  netOperatingIncome: number,
  annualDebtService: number,
): void {
  if (!(annualDebtService > 0)) {
    throw new RangeError(`annualDebtService must be > 0, got ${annualDebtService}`);
  }
  if (netOperatingIncome === undefined || Number.isNaN(netOperatingIncome)) {
    throw new RangeError(`netOperatingIncome must be a number, got ${netOperatingIncome}`);
  }
}

export function validatePointsBreakevenInput(input: PointsBreakevenInput): void {
  if (!(input.loanAmount > 0)) {
    throw new RangeError(`loanAmount must be > 0, got ${input.loanAmount}`);
  }
  if (!(input.points >= 0)) {
    throw new RangeError(`points must be >= 0, got ${input.points}`);
  }
  if (!(input.rateReductionPercent >= 0)) {
    throw new RangeError(
      `rateReductionPercent must be >= 0, got ${input.rateReductionPercent}`,
    );
  }
  if (!(input.originalRatePercent >= 0)) {
    throw new RangeError(`originalRatePercent must be >= 0, got ${input.originalRatePercent}`);
  }
  if (!(input.termMonths > 0) || !Number.isInteger(input.termMonths)) {
    throw new RangeError(`termMonths must be a positive integer, got ${input.termMonths}`);
  }
  if (!(input.originalRatePercent - input.rateReductionPercent >= 0)) {
    throw new RangeError(
      `rateReductionPercent (${input.rateReductionPercent}) must not exceed originalRatePercent (${input.originalRatePercent})`,
    );
  }
}

export function validateRefinanceBreakevenInputs(input: RefinanceBreakevenInput): void {
  if (!(input.closingCosts >= 0)) {
    throw new RangeError(`closingCosts must be >= 0, got ${input.closingCosts}`);
  }
  if (!(input.oldMonthlyPayment > 0)) {
    throw new RangeError(`oldMonthlyPayment must be > 0, got ${input.oldMonthlyPayment}`);
  }
  if (!(input.newMonthlyPayment > 0)) {
    throw new RangeError(`newMonthlyPayment must be > 0, got ${input.newMonthlyPayment}`);
  }
}

export function validateTermComparisonInput(loans: LoanInput[]): void {
  if (!loans || loans.length < 2) {
    throw new RangeError(`compareLoanTerms requires at least 2 loans, got ${loans?.length ?? 0}`);
  }
}

export function validateArmResetInput(input: ArmResetInput): void {
  if (!(input.indexRatePercent >= 0)) {
    throw new RangeError(`indexRatePercent must be >= 0, got ${input.indexRatePercent}`);
  }
  if (!(input.marginPercent >= 0)) {
    throw new RangeError(`marginPercent must be >= 0, got ${input.marginPercent}`);
  }
  if (!(input.previousRatePercent >= 0)) {
    throw new RangeError(`previousRatePercent must be >= 0, got ${input.previousRatePercent}`);
  }
  if (!(input.initialRatePercent >= 0)) {
    throw new RangeError(`initialRatePercent must be >= 0, got ${input.initialRatePercent}`);
  }
  for (const [name, value] of [
    ['initialCapPercent', input.initialCapPercent],
    ['periodicCapPercent', input.periodicCapPercent],
    ['lifetimeCapPercent', input.lifetimeCapPercent],
  ] as const) {
    if (value !== undefined && !(value >= 0)) {
      throw new RangeError(`${name} must be >= 0, got ${value}`);
    }
  }
}

export function validatePmiPaymentInputs(loanBalance: number, annualRatePercent: number): void {
  if (!(loanBalance >= 0)) {
    throw new RangeError(`loanBalance must be >= 0, got ${loanBalance}`);
  }
  if (!(annualRatePercent >= 0)) {
    throw new RangeError(`annualRatePercent must be >= 0, got ${annualRatePercent}`);
  }
}

export function validatePmiInput(pmi: PmiInput): void {
  if (!(pmi.annualRatePercent >= 0)) {
    throw new RangeError(`pmi.annualRatePercent must be >= 0, got ${pmi.annualRatePercent}`);
  }
  if (!(pmi.propertyValue > 0)) {
    throw new RangeError(`pmi.propertyValue must be > 0, got ${pmi.propertyValue}`);
  }
  if (
    pmi.dropAtLtvPercent !== undefined &&
    !(pmi.dropAtLtvPercent > 0 && pmi.dropAtLtvPercent <= 100)
  ) {
    throw new RangeError(
      `pmi.dropAtLtvPercent must be in (0, 100], got ${pmi.dropAtLtvPercent}`,
    );
  }
}

export function validateRecurringCosts(recurringCosts: RecurringCosts | undefined): void {
  if (!recurringCosts) return;
  for (const [name, cost] of Object.entries(recurringCosts)) {
    if (!cost) continue;
    if (!(cost.annualAmount >= 0)) {
      throw new RangeError(
        `recurringCosts.${name}.annualAmount must be >= 0, got ${cost.annualAmount}`,
      );
    }
    if (cost.annualIncreasePercent !== undefined && !(cost.annualIncreasePercent >= 0)) {
      throw new RangeError(
        `recurringCosts.${name}.annualIncreasePercent must be >= 0, got ${cost.annualIncreasePercent}`,
      );
    }
  }
}

export function validateBankStatementRow(row: BankStatementRow, rowIndex: number): void {
  if (!(row.paymentNumber > 0) || !Number.isInteger(row.paymentNumber)) {
    throw new RangeError(
      `bank statement row ${rowIndex}: paymentNumber must be a positive integer, got ${row.paymentNumber}`,
    );
  }
  const hasAny =
    row.paymentAmount !== undefined ||
    row.interestPortion !== undefined ||
    row.principalPortion !== undefined ||
    row.remainingBalance !== undefined;
  if (!hasAny) {
    throw new RangeError(
      `bank statement row ${rowIndex}: must specify at least one of paymentAmount, interestPortion, ` +
        'principalPortion, or remainingBalance',
    );
  }
  for (const [name, value] of [
    ['paymentAmount', row.paymentAmount],
    ['interestPortion', row.interestPortion],
    ['principalPortion', row.principalPortion],
  ] as const) {
    if (value !== undefined && value < 0) {
      throw new RangeError(`bank statement row ${rowIndex}: ${name} must not be negative, got ${value}`);
    }
  }
}

export function validateOverridesInRange(
  overrides: ManualPaymentOverride[] | undefined,
  scheduleLength: number,
): void {
  if (!overrides) return;
  for (const override of overrides) {
    if (override.paymentNumber < 1 || override.paymentNumber > scheduleLength) {
      throw new RangeError(
        `manualOverrides paymentNumber ${override.paymentNumber} is out of range for a schedule of length ${scheduleLength}`,
      );
    }
  }
}
