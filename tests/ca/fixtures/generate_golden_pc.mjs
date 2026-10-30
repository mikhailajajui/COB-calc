/**
 * B18 golden-master corpus + generator for Payment Change and VRPC (COB-architecture.md §5 B18,
 * revision 18). Output: golden_engine_pc_v1.json. Tests: tests/ca/golden/engineGoldenPc.test.ts.
 *
 * WHY A SECOND FIXTURE: golden_engine_v1.json (generate_golden.mjs) has no paymentChange or
 * variableRatePaymentChange case. Before B19-B22 touch those flows (stakeholder decision 2,
 * FB-16), this file pins today's engine output for both, so every later item shows its effect
 * as a named group diff, or proves it has none. It is a separate file so that v1 stays
 * byte-identical (sha 27a28c35...6519) and the group counts already approved on v1 stay exact.
 * v1's generator is not edited: its serialise() hard-codes the v1 version/note strings, so the
 * layout is copied here with those two strings changed.
 *
 * WHEN REGENERATING IS ALLOWED (same rule as v1)
 *   Only in a task that is an APPROVED BEHAVIOUR CHANGE (a "B" backlog item, or a decided OQ),
 *   and only in that same task, with every changed group key listed in CHANGES.md under that
 *   task's entry. A refactor (R item) must NEVER regenerate: a red golden test during a refactor
 *   means the refactor changed behaviour. Never hand-edit golden_engine_pc_v1.json.
 *
 * REGENERATE (from COB-ts/):
 *   npx vite-node tests/ca/fixtures/generate_golden_pc.mjs --write
 *   (optional: --out <path> writes elsewhere, e.g. a scratch file to diff against.)
 *
 * CORPUS (rule B18-R1):
 *   First payment dates: weekly / biweekly / monthly use v1's FIRST_DATES (every 29th day from
 *   2027-01-01); semi-monthly uses SEMI_FIRST_DATES (Jan 2027 + k, day 15 for even k, month end
 *   for odd k; contains 2028-02-29), so every semi-monthly first date is valid under decision 10.
 *   Start (renewalDate) = the last regular payment date before the first one (decision 2):
 *   lastPaymentDate(). End = first + 2 years; loan 250,000; 5.19%; v1 payments and fee sets;
 *   term 2 / 0; semiAnnualCompoundingDate = start for mortgage/fixed only. accruedInterest is
 *   ALWAYS passed: acc0 = 0, acc850 = 850.25.
 *   Regular groups: pc (paymentChange) x 4 frequencies x 4 product/rate x 3 fee sets x 2 accrued
 *   = 96; vrpc (variableRatePaymentChange, mortgage/variable only) x 4 x 3 x 2 = 24. 120 groups,
 *   26 cases each = 3,120 cases.
 *   Extra groups (208 cases each; order frequency, first date, acc0, acc850):
 *     pcx:underpayment (pc, personalLoan/fixed, fin2000, payment weekly 200 / other 300: T6 and
 *     QA's F-1 path); vrpcx:minimumPayment (vrpc, fin2000cash400, payment 0.01: B14, trigger rate).
 *   Long cases (full JSON, first 2027-01-01, 30 years): long:vrpc:monthly:acc850,
 *   long:pc:weekly:acc850:underpayment (personal loan, payment 200; B33 restores this pre-B27 case).
 *
 * All dates are built with Date.UTC so the corpus is timezone-independent.
 */
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
// v1's generator runs its own `--write` block when process.argv contains '--write', and with
// no `--out` that would rewrite golden_engine_v1.json. A static import would run it whenever
// this file is run with --write, so v1 is imported dynamically with '--write' hidden from argv.
const argv = process.argv;
process.argv = argv.filter((a) => a !== '--write');
const v1 = await import('./generate_golden.mjs');
process.argv = argv;
const { utc, FIRST_DATES, FREQUENCIES, PAYMENT_BY_FREQUENCY, PRODUCT_RATES, FEE_SETS, HEADLINE_FIELDS } = v1;

const DAY_MS = 86_400_000;
const addDays = (date, n) => new Date(date.getTime() + n * DAY_MS);
const addYears = (date, n) => new Date(Date.UTC(date.getUTCFullYear() + n, date.getUTCMonth(), date.getUTCDate()));
const iso = (date) => date.toISOString().slice(0, 10);
/** Day 0 of the next month = the last day of month m (1-based) of year y. */
const monthEnd = (y, m) => utc(y, m + 1, 0);

/** Semi-monthly first dates: Jan 2027 + k, the 15th when k is even, the month's last day when odd. */
export const SEMI_FIRST_DATES = Array.from({ length: 26 }, (_, k) => {
  const y = 2027 + Math.floor(k / 12);
  const m = (k % 12) + 1;
  return k % 2 === 0 ? utc(y, m, 15) : monthEnd(y, m);
});

const firstDatesOf = (frequency) => (frequency === 'semiMonthly' ? SEMI_FIRST_DATES : FIRST_DATES);

/** The last regular payment date before `first` (decision 2: the Payment Change / VRPC start). */
export function lastPaymentDate(frequency, first) {
  const y = first.getUTCFullYear();
  const m = first.getUTCMonth() + 1;
  const d = first.getUTCDate();
  switch (frequency) {
    case 'weekly':
      return addDays(first, -7);
    case 'biweekly':
      return addDays(first, -14);
    case 'semiMonthly':
      // 15th -> last day of the previous month; month end -> the 15th of the same month.
      if (d === 15) return utc(y, m, 0);
      if (d === monthEnd(y, m).getUTCDate()) return utc(y, m, 15);
      throw new Error(`semi-monthly first date ${iso(first)} is neither the 15th nor a month end`);
    case 'monthly': {
      // VBA DateAdd("m", -1, first): same day one month earlier, clamped to that month's length.
      const pm = m === 1 ? 12 : m - 1;
      const py = m === 1 ? y - 1 : y;
      return utc(py, pm, Math.min(d, monthEnd(py, pm).getUTCDate()));
    }
    default:
      throw new Error(`unknown frequency ${frequency}`);
  }
}

export const FLOW_KEYS = { pc: 'paymentChange', vrpc: 'variableRatePaymentChange' };
export const ACCRUED = { acc0: 0, acc850: 850.25 };

/** One engine input. Everything not named here is the rule B18-R1 default. */
export function makeInput({ first, frequency, productType, rateType, feeSet, flowKey, accKey, payment, years = 2 }) {
  const start = lastPaymentDate(frequency, first);
  const input = {
    flow: FLOW_KEYS[flowKey],
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
    renewalDate: start,
    accruedInterest: ACCRUED[accKey],
  };
  if (productType === 'mortgage' && rateType === 'fixed') input.semiAnnualCompoundingDate = start;
  return input;
}

const describeCase = (p) =>
  `first=${iso(p.first)} ${p.frequency} ${p.productType}/${p.rateType} fees=${p.feeSet} flow=${p.flowKey} ${p.accKey}` +
  (p.payment !== undefined ? ` payment=${p.payment}` : '');

// B33 (DEC-B33-FREQ): every product at every frequency again; B27's personal-loan filter is removed.
/** The full pre-filter corpus (internal). */
function buildGroupsAll() {
  const groups = [];
  for (const flowKey of Object.keys(FLOW_KEYS))
    for (const frequency of FREQUENCIES)
      for (const [productType, rateType] of flowKey === 'pc' ? PRODUCT_RATES : [['mortgage', 'variable']])
        for (const feeSet of Object.keys(FEE_SETS))
          for (const accKey of Object.keys(ACCRUED)) {
            const cases = firstDatesOf(frequency).map((first) => {
              const params = { first, frequency, productType, rateType, feeSet, flowKey, accKey };
              return { label: describeCase(params), params };
            });
            groups.push({ key: `${flowKey}|${frequency}|${productType}/${rateType}|${feeSet}|${accKey}`, extra: false, cases });
          }

  const product = (flowKey, productType, rateType, feeSet, paymentOf) => {
    const cases = [];
    for (const frequency of FREQUENCIES)
      for (const first of firstDatesOf(frequency))
        for (const accKey of Object.keys(ACCRUED)) {
          const params = { first, frequency, productType, rateType, feeSet, flowKey, accKey, payment: paymentOf(frequency) };
          cases.push({ label: describeCase(params), params });
        }
    return cases;
  };
  // T6 / OQ-L + QA's F-1: payment below every period's interest; with acc850 the IN-11 pool
  // never clears.
  const UNDERPAY = { weekly: 200, biweekly: 300, semiMonthly: 300, monthly: 300 };
  groups.push({
    key: 'pcx:underpayment',
    extra: true,
    cases: product('pc', 'personalLoan', 'fixed', 'fin2000', (f) => UNDERPAY[f]),
  });
  // B14 minimum payment: nothing but interest is ever paid; trigger-rate path; F-1 path.
  groups.push({
    key: 'vrpcx:minimumPayment',
    extra: true,
    cases: product('vrpc', 'mortgage', 'variable', 'fin2000cash400', () => 0.01),
  });
  return groups;
}

/** Returns [{ key, extra, cases: [{ label, params }] }] in a fixed order (B33: every product at every frequency). */
export function buildGroups() {
  return buildGroupsAll()
    .filter((g) => g.cases.length > 0);
}

/** 2 long cases: 30 years from 2027-01-01, full JSON. */
export function buildLongCases() {
  const first = utc(2027, 1, 1);
  return [
    {
      key: 'long:vrpc:monthly:acc850',
      params: { first, frequency: 'monthly', productType: 'mortgage', rateType: 'variable', feeSet: 'fin2000cash400', flowKey: 'vrpc', accKey: 'acc850', payment: 1300, years: 30 },
    },
    {
      key: 'long:pc:weekly:acc850:underpayment',
      params: { first, frequency: 'weekly', productType: 'personalLoan', rateType: 'fixed', feeSet: 'fin2000', flowKey: 'pc', accKey: 'acc850', payment: 200, years: 30 },
    },
  ];
}

const sha = (s) => createHash('sha256').update(s).digest('hex');

/** Runs the whole corpus through `calculate` (calculateCobCanada). Same as v1's computeGolden. */
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

/** v1's layout with the version and note strings changed. */
export function serialise(golden) {
  const out = [];
  out.push('{');
  out.push(' "version": "golden_engine_pc_v1",');
  out.push(' "note": "Generated by generate_golden_pc.mjs. Do not hand-edit. Regenerate only in an approved behaviour-change task, listing changed groups in CHANGES.md.",');
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
  const target = outIdx > 0 ? process.argv[outIdx + 1] : fileURLToPath(new URL('./golden_engine_pc_v1.json', import.meta.url));
  const t0 = Date.now();
  const golden = computeGolden(calculateCobCanada);
  writeFileSync(target, serialise(golden));
  const n = Object.values(golden.groups).reduce((s, g) => s + g.n, 0);
  console.log(`wrote ${target}: ${Object.keys(golden.groups).length} groups, ${n} cases, ${Object.keys(golden.long).length} long cases, ${Date.now() - t0} ms`);
}
