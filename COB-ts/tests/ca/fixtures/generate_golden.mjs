/**
 * A0 golden-master characterisation corpus + generator (COB-architecture.md §5 A0).
 *
 * PURPOSE: byte-level proof that a refactor (an "R" backlog item) does not change engine
 * output. The golden file pins JSON.stringify(calculateCobCanada(input)) for every case.
 *
 * WHEN REGENERATING IS ALLOWED
 *   Only in a task that is an APPROVED BEHAVIOUR CHANGE (a "B" backlog item, or a decided
 *   OQ), and only in that same task, with every changed group key listed in CHANGES.md
 *   under that task's entry. A refactor (R item) must NEVER regenerate: if the golden test
 *   goes red during a refactor, the refactor is wrong. Never hand-edit
 *   golden_engine_v1.json.
 *
 * REGENERATE (from COB-ts/):
 *   npx vite-node tests/ca/fixtures/generate_golden.mjs --write
 *   (optional: --out <path> writes elsewhere, e.g. a scratch file to diff against.)
 *
 * CORPUS (spec A0, verbatim):
 *   26 first-payment dates (every 29th day from 2027-01-01, crossing Feb 29 2028)
 *   x 4 frequencies x 4 product/rate pairs x 3 fee sets x 3 flows = 3,744 cases, in
 *   144 groups (frequency x product/rate x fees x flow; the 26 dates are the cases of a
 *   group). Start = first - 10 days, End = first + 2 years (same month/day, UTC), loan
 *   $250,000, rate 5.19%, payment weekly 300 / biweekly 600 / semiMonthly 650 / monthly 1300.
 *   Fee sets: none; $2,000 financed; $2,000 financed + $400 cash. Flows: new; renewal
 *   with accrued 0; renewal with accrued 850.25.
 * EXTRA GROUPS (caller's requirement, not in §5): minimumPayment ($0.01; B14, OQ-Y revised:
 *   replaced zeroPayment (T7 / OQ-Y) at the same position when a $0 payment became invalid),
 *   underpayment (T6 / OQ-L: payment below the first period's interest),
 *   semiMonthlyMonthEnd (T4), monthlyMonthEnd (T3 / OQ-X).
 * LONG CASES: 6 x 30-year (weekly, biweekly, monthly; with and without payoff), stored
 *   as full JSON.
 *
 * All dates are built with Date.UTC so the corpus is timezone-independent.
 */
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const DAY_MS = 86_400_000;
export const utc = (y, m, d) => new Date(Date.UTC(y, m - 1, d));
const addDays = (date, n) => new Date(date.getTime() + n * DAY_MS);
const addYears = (date, n) => new Date(Date.UTC(date.getUTCFullYear() + n, date.getUTCMonth(), date.getUTCDate()));
const iso = (date) => date.toISOString().slice(0, 10);

export const FIRST_DATES = Array.from({ length: 26 }, (_, k) => addDays(utc(2027, 1, 1), 29 * k));
export const FREQUENCIES = ['weekly', 'biweekly', 'semiMonthly', 'monthly'];
export const PAYMENT_BY_FREQUENCY = { weekly: 300, biweekly: 600, semiMonthly: 650, monthly: 1300 };
export const PRODUCT_RATES = [
  ['mortgage', 'fixed'],
  ['mortgage', 'variable'],
  ['personalLoan', 'fixed'],
  ['personalLoan', 'variable'],
];
const FIN = { name: 'Financed fee', amount: 2000, financed: true, includedInCob: true };
const CASH = { name: 'Cash fee', amount: 400, financed: false, includedInCob: true };
export const FEE_SETS = { none: [], fin2000: [FIN], fin2000cash400: [FIN, CASH] };
export const FLOWS = {
  new: { flow: 'newMortgageOrLoan' },
  renewal0: { flow: 'renewal', accruedInterest: 0 },
  renewal850: { flow: 'renewal', accruedInterest: 850.25 },
};

/** One engine input. Everything not named here is the §5 A0 default. */
export function makeInput({ first, frequency, productType, rateType, feeSet, flowKey, payment, years = 2 }) {
  const start = addDays(first, -10);
  const f = FLOWS[flowKey];
  const input = {
    // B21 (decision 9): Renewal is mortgage-only, so a personal-loan renewal key is sent as paymentChange.
    // The corpus keeps its keys and this fixture stays byte-identical: the engine treats the two flows
    // identically (B18-INV-flow-equivalence).
    flow: f.flow === 'renewal' && productType === 'personalLoan' ? 'paymentChange' : f.flow,
    productType,
    rateType,
    loanAmount: 250000,
    fees: { fees: FEE_SETS[feeSet].map((fee) => ({ ...fee })) },
    contractRatePercent: 5.19,
    paymentAmount: payment ?? PAYMENT_BY_FREQUENCY[frequency],
    paymentFrequency: frequency,
    firstPaymentDate: first,
    endDate: addYears(first, years),
    termYears: years,
    termMonths: 0,
  };
  if (f.flow === 'newMortgageOrLoan') input.disbursalDate = start;
  else {
    input.renewalDate = start;
    input.accruedInterest = f.accruedInterest;
  }
  if (productType === 'mortgage' && rateType === 'fixed') input.semiAnnualCompoundingDate = start;
  return input;
}

const describeCase = (p) =>
  `first=${iso(p.first)} ${p.frequency} ${p.productType}/${p.rateType} fees=${p.feeSet} flow=${p.flowKey}` +
  (p.payment !== undefined ? ` payment=${p.payment}` : '');

// B33 (DEC-B33-FREQ): every product at every frequency again; B27's personal-loan filter is removed.
/** The full pre-filter corpus (internal). */
function buildGroupsAll() {
  const groups = [];
  for (const frequency of FREQUENCIES)
    for (const [productType, rateType] of PRODUCT_RATES)
      for (const feeSet of Object.keys(FEE_SETS))
        for (const flowKey of Object.keys(FLOWS)) {
          const cases = FIRST_DATES.map((first) => {
            const params = { first, frequency, productType, rateType, feeSet, flowKey };
            return { label: describeCase(params), params };
          });
          groups.push({ key: `${frequency}|${productType}/${rateType}|${feeSet}|${flowKey}`, extra: false, cases });
        }

  const product = (dates, freqs, productType, rateType, feeSet, paymentOf) => {
    const cases = [];
    for (const frequency of freqs)
      for (const first of dates)
        for (const flowKey of Object.keys(FLOWS)) {
          const params = { first, frequency, productType, rateType, feeSet, flowKey, payment: paymentOf(frequency) };
          cases.push({ label: describeCase(params), params });
        }
    return cases;
  };
  // B14 / OQ-Y revised (2026-09-28): the payment must be > 0, so the former T7 / OQ-Y $0 group
  // (extra:zeroPayment) is swapped, at the same position, for the minimum $0.01 payment. It keeps
  // the paths the $0 group was there for: nothing but interest is ever paid (no fee, no
  // principal), the balance grows under OQ-L, the IN-11 renewal850 cases stay flat at 250,000
  // (OQ-W interim), and the trigger-rate path runs (mortgage/variable).
  groups.push({
    key: 'extra:minimumPayment',
    extra: true,
    cases: product(FIRST_DATES, FREQUENCIES, 'mortgage', 'variable', 'fin2000cash400', () => 0.01),
  });
  // T6 / OQ-L: payment below the first period's interest (first period = 10 days, about
  // $342-356 of interest) and below every later period's interest: negative amortisation.
  const UNDERPAY = { weekly: 200, biweekly: 300, semiMonthly: 300, monthly: 300 };
  groups.push({
    key: 'extra:underpayment',
    extra: true,
    cases: product(FIRST_DATES, FREQUENCIES, 'personalLoan', 'fixed', 'fin2000', (f) => UNDERPAY[f]),
  });
  // T4: semi-monthly getNextSemiMonthly (15th / month-end, 14th, 16th, 30th/31st, Feb).
  const SEMI_DATES = [
    [2027, 1, 14], [2027, 1, 15], [2027, 1, 16], [2027, 1, 30], [2027, 1, 31], [2027, 2, 14],
    [2027, 2, 15], [2027, 2, 28], [2027, 3, 30], [2027, 4, 30], [2027, 12, 31], [2028, 1, 31],
    [2028, 2, 14], [2028, 2, 28], [2028, 2, 29],
  ].map(([y, m, d]) => utc(y, m, d));
  groups.push({
    key: 'extra:semiMonthlyMonthEnd',
    extra: true,
    cases: product(SEMI_DATES, ['semiMonthly'], 'mortgage', 'fixed', 'fin2000', () => 650),
  });
  // T3 + OQ-X: monthly DateAdd clamp and the month-end rule.
  const MONTHLY_DATES = [
    [2027, 1, 28], [2027, 1, 29], [2027, 1, 30], [2027, 1, 31], [2027, 2, 28], [2027, 3, 31],
    [2027, 4, 30], [2027, 6, 30], [2027, 8, 31], [2027, 12, 31], [2028, 1, 29], [2028, 1, 31],
    [2028, 2, 28], [2028, 2, 29],
  ].map(([y, m, d]) => utc(y, m, d));
  groups.push({
    key: 'extra:monthlyMonthEnd',
    extra: true,
    cases: product(MONTHLY_DATES, ['monthly'], 'personalLoan', 'variable', 'fin2000cash400', () => 1300),
  });
  return groups;
}

/** Returns [{ key, extra, cases: [{ label, params }] }] in a fixed order (B33: every product at every frequency). */
export function buildGroups() {
  return buildGroupsAll()
    .filter((g) => g.cases.length > 0);
}

/** 6 long cases: 30 years, new mortgage/fixed, fin+cash fees. "noPayoff" payments are below
 *  the 30-year amortising payment; "payoff" payments clear the loan before End. */
export function buildLongCases() {
  const first = utc(2027, 1, 1);
  const spec = [
    ['weekly', 'noPayoff', 300], ['weekly', 'payoff', 400],
    ['biweekly', 'noPayoff', 600], ['biweekly', 'payoff', 800],
    ['monthly', 'noPayoff', 1300], ['monthly', 'payoff', 1700],
  ];
  return spec.map(([frequency, kind, payment]) => ({
    key: `long:${frequency}:${kind}`,
    kind,
    params: { first, frequency, productType: 'mortgage', rateType: 'fixed', feeSet: 'fin2000cash400', flowKey: 'new', payment, years: 30 },
  }));
}

/** Headline figures stored per case so a mismatch can show a readable field diff. */
export const HEADLINE_FIELDS = ['cobAmount', 'cobRatePercent', 'totalInterest', 'numberOfPayments', 'endingBalance', 'termDays'];

const sha = (s) => createHash('sha256').update(s).digest('hex');

/** Runs the whole corpus through `calculate` (calculateCobCanada). */
export function computeGolden(calculate) {
  const groups = {};
  for (const g of buildGroups()) {
    const jsons = [];
    const cases = [];
    for (const c of g.cases) {
      const result = calculate(makeInput(c.params));
      const json = JSON.stringify(result);
      jsons.push(json);
      cases.push([sha(json).slice(0, 16), ...HEADLINE_FIELDS.map((f) => result[f])]);
    }
    groups[g.key] = { hash: sha(jsons.join('\n')), n: cases.length, cases };
  }
  const long = {};
  for (const c of buildLongCases()) long[c.key] = JSON.parse(JSON.stringify(calculate(makeInput(c.params))));
  return { groups, long };
}

/** Compact but line-oriented serialisation (one group / one schedule row per line). */
export function serialise(golden) {
  const out = [];
  out.push('{');
  out.push(' "version": "golden_engine_v1",');
  out.push(' "note": "Generated by generate_golden.mjs. Do not hand-edit. Regenerate only in an approved behaviour-change task, listing changed groups in CHANGES.md.",');
  out.push(` "caseFields": ${JSON.stringify(['hash16', ...HEADLINE_FIELDS])},`);
  out.push(' "groups": {');
  const gk = Object.keys(golden.groups);
  gk.forEach((k, i) => out.push(`  ${JSON.stringify(k)}: ${JSON.stringify(golden.groups[k])}${i < gk.length - 1 ? ',' : ''}`));
  out.push(' },');
  out.push(' "long": {');
  const lk = Object.keys(golden.long);
  lk.forEach((k, i) => {
    const { amortizationSchedule, ...scalars } = golden.long[k];
    out.push(`  ${JSON.stringify(k)}: {"scalars": ${JSON.stringify(scalars)}, "amortizationSchedule": [`);
    amortizationSchedule.forEach((r, j) => out.push(`   ${JSON.stringify(r)}${j < amortizationSchedule.length - 1 ? ',' : ''}`));
    out.push(`  ]}${i < lk.length - 1 ? ',' : ''}`);
  });
  out.push(' }');
  out.push('}');
  return out.join('\n') + '\n';
}

if (process.argv.includes('--write')) {
  const { calculateCobCanada } = await import('../../../src/ca/cobCanada.ts');
  const outIdx = process.argv.indexOf('--out');
  const target = outIdx > 0 ? process.argv[outIdx + 1] : fileURLToPath(new URL('./golden_engine_v1.json', import.meta.url));
  const t0 = Date.now();
  const golden = computeGolden(calculateCobCanada);
  writeFileSync(target, serialise(golden));
  const n = Object.values(golden.groups).reduce((s, g) => s + g.n, 0);
  console.log(`wrote ${target}: ${Object.keys(golden.groups).length} groups, ${n} cases, ${Object.keys(golden.long).length} long cases, ${Date.now() - t0} ms`);
}
