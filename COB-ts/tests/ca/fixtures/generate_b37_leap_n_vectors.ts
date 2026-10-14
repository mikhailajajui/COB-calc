/**
 * B37 (COB-architecture.md §5 B37, revision 56/57; DEC-B37-LEAP-N): writes b37_leap_n_vectors.json from QA's own oracle
 * (tests/ca/support/leapNOracle.ts; nothing from src/). Test-only. Run from COB-ts/:
 *   npx vite-node tests/ca/fixtures/generate_b37_leap_n_vectors.ts
 * Trust check (b37-leap-aware-n.test.ts B37-T0): with the switch off the oracle reproduces the saved workbook's REF-01 and
 * the unmodified engine on every vector here, field by field.
 * B38 (spec 013, DEC-B38-YEARFRAC-ROUND): the top-level "b38" key holds the YEARFRAC table (E-B38-1), n at B38 and the
 * B38-state results (YEARFRAC + cent rounding) of every case above plus the B38 cases; "note", "cases", "nVectors" and
 * "labelN" are unchanged.
 * B39 (spec 014, DEC-B39-VAR-PL-M12): the top-level "b39" key holds n for the MONTHLY basis at 7/14 days and the results of
 * the B39 cases (VAR-1, VAR-2, T1, T3, T3-variable, VAR-2-VRPC) in the shipped state (all three switches true), the
 * B39-with-B37's-Y state (true, false, true) and the B38 state (true, true, false); every other key is unchanged.
 */
import { writeFileSync } from 'node:fs';
import { FIXTURES_DIR } from '../support/fixtures.js';
import { oracleLeapN, oracleN, oracleSchedule, oracleYearFracBasis1, oracleYears, civilDays } from '../support/leapNOracle.js';
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

/** B38 cases (spec 013 INV-B38-PENDING, INV-B38-LE1Y). V-PEND is the user's prediction, not Excel truth (Q-B38-PEND). */
const B38_CASES: Record<string, OracleCase> = {
  'V-PEND': { ...none, flow: 'paymentChange', productType: 'mortgage', rateType: 'fixed', frequency: 'biweekly', loanAmount: 300000, contractRatePercent: 5, paymentAmount: 900, accruedInterest: 0, start: '2026-11-02', first: '2026-11-16', end: '2030-06-28' },
  'V-LE1Y-FEB29': { ...none, flow: 'newMortgageOrLoan', productType: 'mortgage', rateType: 'fixed', frequency: 'biweekly', loanAmount: 300000, contractRatePercent: 5, paymentAmount: 1600, accruedInterest: 0, start: '2027-06-01', first: '2027-06-15', end: '2028-03-15' },
  'V-LE1Y-NOFEB': { ...none, flow: 'newMortgageOrLoan', productType: 'mortgage', rateType: 'fixed', frequency: 'weekly', loanAmount: 300000, contractRatePercent: 5, paymentAmount: 800, accruedInterest: 0, start: '2028-03-10', first: '2028-03-17', end: '2029-02-20' },
  'V-LE1Y-END-FEB29': { ...none, flow: 'newMortgageOrLoan', productType: 'mortgage', rateType: 'fixed', frequency: 'weekly', loanAmount: 300000, contractRatePercent: 5, paymentAmount: 800, accruedInterest: 0, start: '2027-03-05', first: '2027-03-12', end: '2028-02-29' },
  'V-EXACT1Y': { ...none, flow: 'renewal', productType: 'mortgage', rateType: 'fixed', frequency: 'acceleratedBiweekly', loanAmount: 250000, contractRatePercent: 6, paymentAmount: 1000, accruedInterest: 100, start: '2027-12-15', first: '2027-12-29', end: '2028-12-15' },
  'V-CROSS1Y-1D': { ...none, flow: 'newMortgageOrLoan', productType: 'mortgage', rateType: 'fixed', frequency: 'weekly', loanAmount: 300000, contractRatePercent: 5, paymentAmount: 800, accruedInterest: 0, start: '2028-03-01', first: '2028-03-08', end: '2029-03-02' },
};

/** E-B38-1 table (spec 013). */
const YEARFRAC_SPANS: [string, string][] = [
  ['2026-10-08', '2029-09-23'], ['2026-10-08', '2031-03-27'], ['2000-01-01', '2004-01-31'], ['2000-01-01', '2000-01-02'],
  ['2028-01-10', '2028-12-18'], ['2100-01-04', '2100-12-27'], ['2027-06-01', '2028-03-15'], ['2027-06-01', '2028-02-28'],
  ['2027-06-01', '2028-02-29'], ['2028-03-01', '2029-02-28'], ['2028-02-29', '2029-02-28'], ['2027-12-31', '2028-01-01'],
  ['2028-12-31', '2029-01-01'], ['2000-01-01', '2001-01-01'], ['2027-12-15', '2028-12-15'], ['2028-02-29', '2029-03-01'],
];

const pick = (c: OracleCase, leap: boolean, yearFracRounded = false, monthlyConversion = false) => {
  const r = oracleSchedule(c, leap, yearFracRounded, monthlyConversion);
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

/** B39 cases (spec 014 registry UX-003, UX-004, UX-P02, UX-P04, plus INV-B39-PLVAR / INV-B39-VRPC twins). VAR-1 / VAR-2 are
 *  the user's Excel examples; T1 and T3 are predictions awaiting the user's Excel (Q-B39-PL-EXAMPLE). */
const B39_CASES: Record<string, OracleCase> = {
  'VAR-1': { ...none, flow: 'paymentChange', productType: 'mortgage', rateType: 'variable', frequency: 'weekly', loanAmount: 109939.12, contractRatePercent: 4, paymentAmount: 145.16, accruedInterest: 0, start: '2026-10-08', first: '2026-10-15', end: '2029-09-27' },
  'VAR-2': { ...none, flow: 'paymentChange', productType: 'mortgage', rateType: 'variable', frequency: 'biweekly', loanAmount: 333623.25, contractRatePercent: 3.8, paymentAmount: 863.15, accruedInterest: 277.63, start: '2026-10-13', first: '2026-10-19', end: '2031-09-15' },
  T1: { ...none, flow: 'paymentChange', productType: 'mortgage', rateType: 'variable', frequency: 'acceleratedWeekly', loanAmount: 109939.12, contractRatePercent: 4, paymentAmount: 145.16, accruedInterest: 0, start: '2026-10-08', first: '2026-10-15', end: '2029-09-27' },
  T3: { ...none, flow: 'newMortgageOrLoan', productType: 'personalLoan', rateType: 'fixed', frequency: 'weekly', loanAmount: 30000, contractRatePercent: 8, paymentAmount: 140, accruedInterest: 0, start: '2026-11-01', first: '2026-11-08', end: '2031-11-01' },
  'T3-variable': { ...none, flow: 'newMortgageOrLoan', productType: 'personalLoan', rateType: 'variable', frequency: 'weekly', loanAmount: 30000, contractRatePercent: 8, paymentAmount: 140, accruedInterest: 0, start: '2026-11-01', first: '2026-11-08', end: '2031-11-01' },
  'VAR-2-VRPC': { ...none, flow: 'variableRatePaymentChange', productType: 'mortgage', rateType: 'variable', frequency: 'biweekly', loanAmount: 333623.25, contractRatePercent: 3.8, paymentAmount: 863.15, accruedInterest: 277.63, start: '2026-10-13', first: '2026-10-19', end: '2031-09-15' },
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
  b38: {
    note: 'B38 QA vectors (spec 013, DEC-B38-YEARFRAC-ROUND): same oracle, YEARFRAC_ROUNDED_INTEREST true (Y = Excel YEARFRAC basis 1; period interest rounded to the cent in the B37 cases). "on" = both switches true (shipped). V-PEND is a user prediction, unconfirmed in Excel (Q-B38-PEND). Do not hand-edit.',
    yearFracVectors: YEARFRAC_SPANS.map(([s, e]) => ({ start: s, end: e, y: oracleYearFracBasis1(s, e) })),
    nVectors: N_VECTORS.map(([p, s, e]) => ({ periodDays: p, start: s, end: e, n: oracleLeapN(p, s, e, true) })),
    labelN: Object.fromEntries([
      ['V-CASE1', '2026-10-08', '2029-09-23'], ['V-EX2', '2026-10-08', '2031-03-27'], ['REF-01', '2026-03-17', '2029-03-17'],
      ['RENEWAL', '2026-04-01', '2028-10-01'], ['V-2028', '2028-01-10', '2028-12-18'], ['V-NOLEAP', '2099-06-01', '2101-06-01'],
    ].map(([id, s, e]) => [id, { start: s, end: e, n: Object.fromEntries(['weekly', 'acceleratedWeekly', 'biweekly', 'acceleratedBiweekly', 'semiMonthly', 'monthly'].map((f) => [f, oracleN('mortgage', 'fixed', f, s!, e!, true, true)])) }])),
    cases: Object.fromEntries(Object.entries({ ...CASES, ...B38_CASES }).map(([id, c]) => [id, {
      input: c,
      D: civilDays(c.end) - civilDays(c.start),
      Y: oracleYearFracBasis1(c.start, c.end),
      on: pick(c, true, true),
    }])),
  },
  b39: {
    note: 'B39 QA vectors (spec 014, DEC-B39-VAR-PL-M12): same oracle. MONTHLY basis (variable-rate mortgage, personal loan) at 7/14 days: n = D / P / Y as in B37/B38 and equation 1 at m = 12, period interest never rounded. "on" = all three switches true (shipped); "b37Y" = (true, false, true), B39 with B37\'s Y (no Excel evidence); "b38" = (true, true, false), the B38 state (the contract rate as entered). VAR-1 / VAR-2 are the user\'s Excel examples (registry UX-003 known gap +1 cent, UX-004); T1 and T3 are predictions (Q-B39-PL-EXAMPLE). Do not hand-edit.',
    nVectors: Object.entries(B39_CASES).map(([id, c]) => ({
      id,
      productType: c.productType,
      rateType: c.rateType,
      frequency: c.frequency,
      start: c.start,
      end: c.end,
      n: oracleN(c.productType, c.rateType, c.frequency, c.start, c.end, true, true, true),
      nB37Y: oracleN(c.productType, c.rateType, c.frequency, c.start, c.end, true, false, true),
      nOff: oracleN(c.productType, c.rateType, c.frequency, c.start, c.end, true, true, false),
    })),
    cases: Object.fromEntries(Object.entries(B39_CASES).map(([id, c]) => [id, {
      input: c,
      D: civilDays(c.end) - civilDays(c.start),
      Y: oracleYearFracBasis1(c.start, c.end),
      on: pick(c, true, true, true),
      b37Y: pick(c, true, false, true),
      b38: pick(c, true, true, false),
    }])),
  },
};
writeFileSync(FIXTURES_DIR + 'b37_leap_n_vectors.json', JSON.stringify(out, null, 1) + '\n');
console.log('written', Object.keys(out.cases).length, 'cases', out.nVectors.length, 'n vectors');
