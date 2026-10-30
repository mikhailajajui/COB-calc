/**
 * B25 QA snapshot, taken on the PRE-B25 engine (before sr-dev touched src/ca). Test-only.
 * Writes b25_pre_snapshot.json: sha256 (first 16 hex) of JSON.stringify(calculateCobCanada(input)) for
 *   - weekly, biweekly and monthly for every typed first date 2027-01-01 .. 2028-12-31 (the move must not touch them)
 *   - semi-monthly for the typed dates that are already the 15th or a month-end (the move must leave them alone)
 * `snapInput` is shared with tests/ca/b25-semimonthly-move.test.ts (one definition of the input).
 * Do NOT regenerate after the engine change: the snapshot is the "before" side of B25-T2.
 * Run (COB-ts/): npx vite-node tests/ca/fixtures/generate_b25_pre_snapshot.mjs --write
 */
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const DAY = 86_400_000;
export const PAY = { weekly: 300, biweekly: 600, semiMonthly: 650, monthly: 1300 };
const utc = (iso) => new Date(`${iso}T00:00:00.000Z`);

/** Mortgage / fixed, new flow, $250,000 at 5.19%, no fees; start = typed - 10 days; End = endIso. */
export function snapInput(typedIso, frequency, endIso) {
  const first = utc(typedIso);
  const start = new Date(first.getTime() - 10 * DAY);
  return {
    flow: 'newMortgageOrLoan',
    productType: 'mortgage',
    rateType: 'fixed',
    loanAmount: 250000,
    fees: { fees: [] },
    contractRatePercent: 5.19,
    paymentAmount: PAY[frequency],
    paymentFrequency: frequency,
    firstPaymentDate: first,
    endDate: utc(endIso),
    termYears: 2,
    termMonths: 0,
    disbursalDate: start,
    semiAnnualCompoundingDate: start,
  };
}

export const addDaysIso = (iso, n) => new Date(utc(iso).getTime() + n * DAY).toISOString().slice(0, 10);
export const lastDayOf = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate(); // m = 1..12
export const isUnmovedSemi = (iso) => {
  const day = Number(iso.slice(8, 10));
  return day === 15 || day === lastDayOf(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)));
};
export const sha16 = (s) => createHash('sha256').update(s).digest('hex').slice(0, 16);
export const allTypedDates = () => {
  const out = [];
  for (let t = Date.UTC(2027, 0, 1); t <= Date.UTC(2028, 11, 31); t += DAY) out.push(new Date(t).toISOString().slice(0, 10));
  return out;
};

if (process.argv.includes('--write')) {
  const { calculateCobCanada } = await import('../../../src/ca/cobCanada.ts');
  const hashes = {};
  for (const typed of allTypedDates()) {
    for (const f of ['weekly', 'biweekly', 'monthly']) {
      hashes[`${f}|${typed}`] = sha16(JSON.stringify(calculateCobCanada(snapInput(typed, f, addDaysIso(typed, 730)))));
    }
    if (isUnmovedSemi(typed)) {
      hashes[`semiMonthly|${typed}`] = sha16(JSON.stringify(calculateCobCanada(snapInput(typed, 'semiMonthly', addDaysIso(typed, 730)))));
    }
  }
  const target = fileURLToPath(new URL('./b25_pre_snapshot.json', import.meta.url));
  writeFileSync(target, JSON.stringify({ note: 'B25 pre-engine-change snapshot; see generate_b25_pre_snapshot.mjs', hashes }) + '\n');
  console.log(`wrote ${target}: ${Object.keys(hashes).length} hashes`);
}
