import { calculateMonthlyPayment } from './payment.js';
import { round2 } from './money.js';
import { validatePointsBreakevenInput } from './validate.js';

export interface PointsBreakevenInput {
  loanAmount: number;
  /** 1 point = 1% of loanAmount. */
  points: number;
  /** Rate reduction achieved by buying points, in percentage points (e.g. 0.25). */
  rateReductionPercent: number;
  originalRatePercent: number;
  termMonths: number;
}

export interface PointsBreakevenResult {
  pointsCost: number;
  monthlyPaymentOriginal: number;
  monthlyPaymentWithPoints: number;
  monthlySavings: number;
  /** Months to recoup the points cost. Infinity if points produce no monthly savings —
   *  a legitimate financial outcome ("points never pay off"), not an invalid input. */
  breakevenMonths: number;
}

export function calculatePointsBreakeven(input: PointsBreakevenInput): PointsBreakevenResult {
  validatePointsBreakevenInput(input);

  const pointsCost = round2((input.loanAmount * input.points) / 100);
  const monthlyPaymentOriginal = calculateMonthlyPayment(
    input.loanAmount,
    input.originalRatePercent,
    input.termMonths,
  );
  const monthlyPaymentWithPoints = calculateMonthlyPayment(
    input.loanAmount,
    input.originalRatePercent - input.rateReductionPercent,
    input.termMonths,
  );
  const monthlySavings = round2(monthlyPaymentOriginal - monthlyPaymentWithPoints);
  const breakevenMonths = monthlySavings <= 0 ? Infinity : pointsCost / monthlySavings;

  return {
    pointsCost,
    monthlyPaymentOriginal,
    monthlyPaymentWithPoints,
    monthlySavings,
    breakevenMonths,
  };
}
