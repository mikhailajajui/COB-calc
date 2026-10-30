/**
 * B37 (DEC-B37-LEAP-N): the deterministic 4,800-input sweep of b37-leap-aware-n.test.ts (B37-T5 / B38-T5), moved here
 * unchanged by B39 (spec 014, B39-T4) so b39-monthly-conversion.test.ts runs the same inputs. QA-owned, test-only.
 */
import { PAYMENTS_PER_YEAR } from '../../../src/ca/index.js';
import type { CobCanadaInput, CobFlow, PaymentFrequency, ProductType, RateType } from '../../../src/ca/index.js';
import { asInput, utcDate } from './builders.js';
import { civilDays, civilIso } from './leapNOracle.js';
import type { OracleCase } from './leapNOracle.js';

export const FLOW_IDS: CobFlow[] = ['newMortgageOrLoan', 'renewal', 'paymentChange', 'variableRatePaymentChange'];
export const SIX: PaymentFrequency[] = ['weekly', 'acceleratedWeekly', 'biweekly', 'acceleratedBiweekly', 'semiMonthly', 'monthly'];
export const DAY_BASED = new Set<string>(['weekly', 'acceleratedWeekly', 'biweekly', 'acceleratedBiweekly']);
export interface SweepCase {
  x: CobCanadaInput;
  flow: CobFlow;
  pt: ProductType;
  rt: RateType;
  f: PaymentFrequency;
  start: string;
  end: string;
  oc: OracleCase | null;
}
/** Deterministic 4,800-input sweep: four flows, both products and rate types (as each flow allows), six frequencies,
 *  start dates 1999-01-01 .. 2101-06-30 (every 8th case inside 2000, every 8th inside 2100), spans 1 .. 3,021 days. */
export function buildSweep(): SweepCase[] {
  let seed = 37;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648), seed / 2147483648);
  const lo = civilDays('1999-01-01');
  const hi = civilDays('2101-06-30');
  const out: SweepCase[] = [];
  for (let i = 0; i < 4800; i += 1) {
    const flow = FLOW_IDS[i % 4]!;
    const f = SIX[Math.floor(i / 4) % 6]!;
    let pt: ProductType = rnd() < 0.6 ? 'mortgage' : 'personalLoan';
    let rt: RateType = rnd() < 0.6 ? 'fixed' : 'variable';
    if (flow === 'renewal') pt = 'mortgage';
    if (flow === 'variableRatePaymentChange') [pt, rt] = ['mortgage', 'variable'];
    const startDay =
      i % 8 === 3 ? civilDays('2000-01-01') + Math.floor(rnd() * 366) : i % 8 === 5 ? civilDays('2100-01-01') + Math.floor(rnd() * 365) : lo + Math.floor(rnd() * (hi - lo));
    const firstDay = startDay + Math.floor(rnd() * 21);
    const endDay = firstDay + 1 + Math.floor(rnd() * 3000);
    const loan = +(10000 + rnd() * 590000).toFixed(2);
    const rate = +(0.5 + rnd() * 11.5).toFixed(3);
    const ppy = PAYMENTS_PER_YEAR[f];
    const pay = +((loan * rate) / 100 / ppy * (rnd() < 0.1 ? 0.6 : 1.1 + rnd() * 2)).toFixed(2);
    const accrued = flow === 'newMortgageOrLoan' ? 0 : rnd() < 0.5 ? 0 : +(rnd() * 1200).toFixed(2);
    const feeDraw = rnd();
    const financedFees = feeDraw < 0.15 ? [+(rnd() * 3000).toFixed(2)] : [];
    const cashFees = feeDraw > 0.85 ? [+(rnd() * 800).toFixed(2)] : [];
    const start = civilIso(startDay);
    const end = civilIso(endDay);
    const first = civilIso(firstDay);
    const oc: OracleCase | null = DAY_BASED.has(f)
      ? { flow, productType: pt, rateType: rt, frequency: f as OracleCase['frequency'], loanAmount: loan, contractRatePercent: rate, paymentAmount: pay, accruedInterest: accrued, start, first, end, financedFees, cashFees }
      : null;
    const fees = { fees: [...financedFees.map((amount) => ({ name: 'F', amount, financed: true })), ...cashFees.map((amount) => ({ name: 'C', amount, financed: false }))] };
    const common = { flow, productType: pt, rateType: rt, contractRatePercent: rate, loanAmount: loan, paymentFrequency: f, paymentAmount: pay, firstPaymentDate: utcDate(first), endDate: utcDate(end), fees };
    const x = asInput(flow === 'newMortgageOrLoan' ? { ...common, disbursalDate: utcDate(start) } : { ...common, renewalDate: utcDate(start), accruedInterest: accrued });
    out.push({ x, flow, pt, rt, f, start, end, oc });
  }
  return out;
}
