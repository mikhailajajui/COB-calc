/**
 * B37 (COB-architecture.md §5 B37, revision 56/57; DEC-B37-LEAP-N): writes b37_leap_n_vectors.json from QA's own oracle
 * (tests/ca/support/leapNOracle.ts; nothing from src/). Test-only. Run from COB-ts/:
 *   npx vite-node tests/ca/fixtures/generate_b37_leap_n_vectors.ts
 * Trust check (b37-leap-aware-n.test.ts B37-T0): with the switch off the oracle reproduces the saved workbook's REF-01 and
 * the unmodified engine on every vector here, field by field.
 */
import { writeFileSync } from 'node:fs';
import { FIXTURES_DIR } from '../support/fixtures.js';
import { oracleLeapN, oracleN, oracleSchedule, oracleYears, civilDays } from '../support/leapNOracle.js';
import type { OracleCase } from '../support/leapNOracle.js';

const none = { financedFees: [] as number[], cashFees: [] as number[] };
const CASES: Record<string, OracleCase> = {
  'V-CASE1': { ...none, flow: 'paymentChange', productType: 'mortgage', rateType: 'fixed', frequency: 'biweekly', loanAmount: 495466.87, contractRatePercent: 4.34, paymentAmount: 1350.64, accruedInterest: 58.33, start: '2026-10-08', first: '2026-10-21', end: '2029-09-23' },
  'V-EX2': { ...none, flow: 'paymentChange', productType: 'mortgage', rateType: 'fixed', frequency: 'biweekly', loanAmount: 413337.42, contractRatePercent: 4.3, paymentAmount: 1050, accruedInterest: 530.49, start: '2026-10-08', first: '2026-10-08', end: '2031-03-27' },
  'V-WEEKLY': { ...none, flow: 'paymentChange', productType: 'mortgage', rateType: 'fixed', frequency: 'weekly', loanAmount: 495466.87, contractRatePercent: 4.34, paymentAmount: 675.32, accruedInterest: 58.33, start: '2026-10-08', first: '2026-10-14', end: '2029-09-23' },
  'V-NOLEAP-EXACT': { ...none, flow: 'renewal', productType: 'mortgage', rateType: 'fixed', frequency: 'acceleratedWeekly', loanAmount: 250000, contractRatePercent: 6, paymentAmount: 600, accruedInterest: 0, start: '2099-06-01', first: '2099-06-08', end: '2101-06-01' },
  'V-NOLEAP-ULP': { ...none, flow: 'newMortgageOrLoan', productType: 'mortgage', rateType: 'fixed', frequency: 'weekly', loanAmount: 300000, contractRatePercent: 5, paymentAmount: 800, accruedInterest: 0, start: '2025-01-06', first: '2025-01-13', end: '2027-01-04' },
  'V-2028': { ...none, flow: 'newMortgageOrLoan', productType: 'mortgage', rateType: 'fixed', frequency: 'biweekly', loanAmount: 300000, contractRatePercent: 5, paymentAmount: 1600, accruedInterest: 0, start: '2028-01-10', first: '2028-01-24', end: '2028-12-18' },
  'V-WHOLE5Y': { ...none, flow: 'renewal', productType: 'mortgage', rateType: 'fixed', frequency: 'acceleratedBiweekly', loanAmount: 250000, contractRatePercent: 6, paymentAmount: 1000, accruedInterest: 100, start: '2025-01-01', first: '2025-01-15', end: '2030-01-01' },
  'V-FEES': { financedFees: [], cashFees: [500], flow: 'paymentChange', productType: 'mortgage', rateType: 'fixed', frequency: 'biweekly', loanAmount: 495466.87, contractRatePercent: 4.34, paymentAmount: 1350.64, accruedInterest: 58.33, start: '2026-10-08', first: '2026-10-21', end: '2029-09-23' },
  'V-REF01': { ...none, flow: 'newMortgageOrLoan', productType: 'mortgage', rateType: 'fixed', frequency: 'weekly', loanAmount: 227829.65, contractRatePercent: 3.74, paymentAmount: 465.46, accruedInterest: 0, start: '2026-03-17', first: '2026-03-23', end: '2029-03-17' },
  // QA addition: financed + cash fees, accrued interest, 5 years weekly (the COB-rate general branch, eq. 7, with the leap n).
  'V-FINFEE': { financedFees: [2000], cashFees: [400], flow: 'renewal', productType: 'mortgage', rateType: 'fixed', frequency: 'weekly', loanAmount: 250000, contractRatePercent: 5.5, paymentAmount: 700, accruedInterest: 850, start: '2027-02-10', first: '2027-02-17', end: '2032-02-10' },
};

const pick = (c: OracleCase, leap: boolean) => {
  const r = oracleSchedule(c, leap);
  return {
    n: r.n,
    calculatedRatePercent: r.calculatedRatePercent,
    numberOfPayments: r.numberOfPayments,
    totalInterest: r.totalInterest,
    principalPayment: r.principalPayment,
    endingBalance: r.endingBalance,
    termDays: r.termDays,
    cobAmount: r.cobAmount,
    cobRatePercent: r.cobRatePercent,
    row1PeriodInterest: r.rows[0]!.periodInterest,
    lastRowDate: r.rows[r.rows.length - 1]!.date,
  };
};

const N_VECTORS: [number, string, string][] = [
  [14, '2026-10-08', '2029-09-23'], [7, '2026-10-08', '2029-09-23'], [14, '2025-01-01', '2030-01-01'], [14, '2000-02-01', '2000-11-30'],
  [7, '2100-01-04', '2100-12-27'], [14, '2025-03-01', '2025-12-01'], [7, '2026-10-08', '2026-10-09'], [14, '2027-12-31', '2028-01-01'],
  [14, '2028-12-31', '2029-01-01'], [7, '2099-06-01', '2101-06-01'], [7, '2025-01-06', '2027-01-04'], [14, '2028-01-10', '2028-12-18'],
  [7, '2026-03-17', '2029-03-17'], [14, '2026-03-17', '2029-03-17'], [14, '2026-10-08', '2031-03-27'], [7, '2026-10-08', '2031-03-27'],
  [7, '2026-04-01', '2028-10-01'], [14, '2026-04-01', '2028-10-01'], [7, '2028-01-10', '2028-12-18'], [14, '2099-06-01', '2101-06-01'],
];

const out = {
  note: 'B37 QA vectors (red step, 2026-10-09; DEC-B37-LEAP-N): generated by generate_b37_leap_n_vectors.ts from QA\'s own oracle tests/ca/support/leapNOracle.ts (no engine code). "on" = LEAP_AWARE_PAYMENTS_PER_YEAR true (n = (D / P) / Y), "off" = the workbook converter (n = 52 / 26). Dates are UTC calendar days. Do not hand-edit.',
  cases: Object.fromEntries(Object.entries(CASES).map(([id, c]) => [id, {
    input: c,
    D: civilDays(c.end) - civilDays(c.start),
    Y: oracleYears(c.start, c.end),
    on: pick(c, true),
    off: pick(c, false),
  }])),
  nVectors: N_VECTORS.map(([p, s, e]) => ({ periodDays: p, start: s, end: e, n: oracleLeapN(p, s, e) })),
  // n for the six frequencies on given dates, fixed mortgage, switch on (the label's number is Math.round of it).
  labelN: Object.fromEntries([
    ['V-CASE1', '2026-10-08', '2029-09-23'], ['V-EX2', '2026-10-08', '2031-03-27'], ['REF-01', '2026-03-17', '2029-03-17'],
    ['RENEWAL', '2026-04-01', '2028-10-01'], ['V-2028', '2028-01-10', '2028-12-18'], ['V-NOLEAP', '2099-06-01', '2101-06-01'],
  ].map(([id, s, e]) => [id, { start: s, end: e, n: Object.fromEntries(['weekly', 'acceleratedWeekly', 'biweekly', 'acceleratedBiweekly', 'semiMonthly', 'monthly'].map((f) => [f, oracleN('mortgage', 'fixed', f, s!, e!, true)])) }])),
};
writeFileSync(FIXTURES_DIR + 'b37_leap_n_vectors.json', JSON.stringify(out, null, 1) + '\n');
console.log('written', Object.keys(out.cases).length, 'cases', out.nVectors.length, 'n vectors');
