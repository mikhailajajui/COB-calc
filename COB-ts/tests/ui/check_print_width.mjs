// F12 / B17-PW (COB-architecture.md §5 B17 and §6 F12, revision 17): the printed schedule fits the page.
// A Chrome page check, not a vitest test (vitest has no layout engine; Chrome and the global
// @playwright/mcp are not project dependencies, as for tests/ca/fixtures/capture_a10_ui.mjs).
//
// usage (from COB-ts/, after `npm run build`):  node tests/ui/check_print_width.mjs [baseUrl]
// Without baseUrl it starts `node ui/serve.mjs` on a free port and stops it afterwards.
//
// For 8 scenarios x 2 column modes, with print media emulated at a 965 px viewport (letter landscape,
// 279.4 mm - 2 x 12 mm margins = 965.3 px), the natural width of #printScheduleTable (width: auto) must
// be <= 965 px, and the heading texts must be Q-PRINT-HEAD's print headings. Exit code 1 on any failure.
// B24 (DEV-OQP): the script no longer fills #termYears, #termMonths, #contractDate or #semiAnnualCompoundingDate (removed or hidden
// behind switches); every page that calculates must show a non-empty read-only #contractTerm whose text is the printed 'Contract term' row.
// B26: the SHORTFALL scenario (unpaid interest at the End Date) also asserts the 'Unpaid interest at end date' figure ($3,015.17) in #printFigures.
// B28: the DEFAULT scenario also asserts the shipped page has four Payment frequency options.
import { createRequire } from 'node:module';
import { execSync, spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';

const req = createRequire(execSync('npm root -g').toString().trim() + '/@playwright/mcp/');
const { chromium } = req('playwright-core');
const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const MAX_WIDTH = 965;

// Q-PRINT-HEAD (COB-user-stories.md §7.5) / B17-R1: [key, print heading, group, compact?].
// B23: the shipped page has the Financed option off, so the three fee columns are not here (11 columns; compact 6).
const PRINT_COLUMNS = [
  ['period', '#', null, true], ['date', 'Date', null, true], ['daysInPeriod', 'Days', null, false],
  ['openingBalance', 'Balance', 'Opening', false],
  ['periodInterest', 'Period', 'Interest', false], ['carriedAccruedInterestOpening', 'Accrued', 'Interest', false],
  ['paymentAmount', 'Payment', 'Payment breakdown', true], ['interestPaid', 'Interest', 'Payment breakdown', true],
  ['principalPortion', 'Principal', 'Payment breakdown', true],
  ['carriedAccruedInterestClosing', 'Accrued', 'Closing', false],
  ['closingBalance', 'Balance', 'Closing', true],
];
const expectedHeads = (mode) => {
  const cols = PRINT_COLUMNS.filter(([, , , compact]) => mode === 'all' || compact);
  const groups = [];
  for (const [, head, group] of cols) {
    if (group === null) groups.push(head);
    else if (groups.at(-1) !== group) groups.push(group);
  }
  return { groups, leaves: cols.filter(([, , group]) => group !== null).map(([, head]) => head) };
};

const A10 = (loan, payment, fees) => ({ loanAmount: loan, contractRatePercent: '3.74', paymentAmount: payment,
  disbursalDate: '2026-03-17', firstPaymentDate: '2026-03-23', endDate: '2029-03-17', fees });
const LARGE = (loan, payment, big) => ({
  selects: { flow: 'renewal', rateType: 'fixed', paymentFrequency: 'monthly' },
  fields: { loanAmount: loan, contractRatePercent: '9.99', paymentAmount: payment,
    renewalDate: '2026-04-01', firstPaymentDate: '2026-05-01', endDate: '2036-04-01', accruedInterest: big },
  fees: [{ name: 'Big financed', amount: big, financed: true }, { name: 'Big cash', amount: big, financed: false }],
});
const NEW_FIXED_WEEKLY = { flow: 'newMortgageOrLoan', productType: 'mortgage', rateType: 'fixed', paymentFrequency: 'weekly' };
const withoutFees = ({ fees, ...fields }) => fields;
const SCENARIOS = [
  { id: 'DEFAULT', selects: null }, // the page as loaded: nothing filled, no fee rows (B23)
  { id: 'REF-01', selects: NEW_FIXED_WEEKLY, fields: { ...withoutFees(A10('227829.65', '465.46')) }, fees: [] },
  { id: 'S1_fees', selects: NEW_FIXED_WEEKLY, fields: { ...withoutFees(A10('227829.65', '465.46')) },
    fees: [{ name: 'Financed fees', amount: '2000', financed: true }, { name: 'Non-financed fees', amount: '500', financed: false }] },
  { id: 'RENEWAL', selects: { flow: 'renewal', rateType: 'fixed', paymentFrequency: 'monthly' },
    fields: { loanAmount: '150000', contractRatePercent: '4.19', paymentAmount: '900',
      renewalDate: '2026-04-01', firstPaymentDate: '2026-05-01', endDate: '2028-10-01', accruedInterest: '125.50' },
    fees: [{ name: 'Renewal & admin <fee>', amount: '250', financed: false }] },
  { id: 'VRPC_zero_accrued', selects: { flow: 'variableRatePaymentChange', paymentFrequency: 'biweekly' },
    fields: { loanAmount: '300000', contractRatePercent: '5.2', paymentAmount: '850',
      renewalDate: '2026-06-15', firstPaymentDate: '2026-06-26', endDate: '2031-06-15', accruedInterest: '0.00' }, fees: [] }, // B20 (decision 4): blank is rejected, $0 is a value
  { id: 'SHORTFALL', selects: { flow: 'newMortgageOrLoan', productType: 'mortgage', rateType: 'fixed', paymentFrequency: 'monthly' }, // B26: 200,000 at 5%, payment 700 leaves $3,015.17 unpaid
    fields: { loanAmount: '200000', contractRatePercent: '5', paymentAmount: '700',
      disbursalDate: '2026-04-01', firstPaymentDate: '2026-05-01', endDate: '2028-04-15' }, fees: [] },
  { id: 'LARGE_7D', ...LARGE('9999999.99', '60000', '999999.99') },
  { id: 'LARGE_8D', ...LARGE('99999999.99', '600000', '9999999.99') },
];

async function freePort() {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
  });
}
async function startServer() {
  const port = await freePort();
  const child = spawn(process.execPath, ['ui/serve.mjs'], { cwd: ROOT, env: { ...process.env, PORT: String(port) }, stdio: ['ignore', 'pipe', 'inherit'] });
  await new Promise((resolve, reject) => {
    child.once('exit', (code) => reject(new Error(`ui/serve.mjs exited with ${code}`)));
    child.stdout.on('data', (d) => { if (String(d).includes(`:${port}`)) resolve(); });
  });
  return { base: `http://localhost:${port}`, stop: () => child.kill() };
}

// VRPC-hide (2026-10-01): the shipped page removes the VRPC <option>; put it back in the live page before selecting it.
const ensureVrpcOption = (page) => page.evaluate(() => {
  const f = document.getElementById('flow');
  if (f && ![...f.options].some((o) => o.value === 'variableRatePaymentChange')) {
    const o = document.createElement('option');
    o.value = 'variableRatePaymentChange';
    o.textContent = 'Variable rate payment change';
    f.appendChild(o);
  }
});

const server = process.argv[2] ? { base: process.argv[2].replace(/\/$/, ''), stop: () => {} } : await startServer();
const browser = await chromium.launch({ channel: 'chrome', headless: true });
let failures = 0;
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'en-CA', timezoneId: 'America/Toronto' });
  console.log(`F12 print width (max ${MAX_WIDTH} px), Chrome ${browser.version()}`);
  for (const sc of SCENARIOS) {
    const page = await context.newPage();
    await page.goto(server.base + '/ui/ca.html');
    await page.waitForLoadState('load'); // B23: no default fee rows, so no count to wait on
    await ensureVrpcOption(page);
    if (sc.selects) {
      for (const [id, v] of Object.entries(sc.selects)) await page.selectOption('#' + id, v);
      for (const [id, v] of Object.entries(sc.fields)) await page.fill('#' + id, v);
      for (const [i, f] of sc.fees.entries()) {
        await page.click('#addFee');
        const row = page.locator('#feesBody tr').nth(i);
        await row.locator('[data-field="name"]').fill(f.name);
        await row.locator('[data-field="amount"]').fill(f.amount);
        if (f.financed && await row.locator('[data-field="financed"]').count()) await row.locator('[data-field="financed"]').check();
      }
    }
    if (sc.id === 'DEFAULT') {
      // B23-R7: a fresh page has no fee rows, no Financed control and the fee table reads Name / Amount / Actions.
      const d = await page.evaluate(() => ({
        rows: document.querySelectorAll('#feesBody tr').length,
        financed: document.querySelectorAll('[data-field="financed"]').length,
        heads: [...document.querySelectorAll('#feesWrap th')].filter((th) => th.getClientRects().length > 0 && getComputedStyle(th).display !== 'none').map((th) => th.textContent.trim()),
      }));
      // B28-R7: a fresh page offers exactly four payment frequencies (the accelerated two are switched off).
      const freq = await page.evaluate(() => [...document.querySelectorAll('#paymentFrequency option')].map((o) => o.value));
      const okFreq = JSON.stringify(freq) === JSON.stringify(['weekly', 'biweekly', 'semiMonthly', 'monthly']);
      if (!okFreq) failures++;
      console.log(`${sc.id.padEnd(19)} freq    ${okFreq ? 'ok' : `FAIL  options ${freq.join('|')}, expected weekly|biweekly|semiMonthly|monthly`}`);
      const okDefault = d.rows === 0 && d.financed === 0 && JSON.stringify(d.heads) === JSON.stringify(['Name', 'Amount ($)', 'Actions']);
      if (!okDefault) failures++;
      console.log(`${sc.id.padEnd(19)} fees    ${okDefault ? 'ok' : `FAIL  rows ${d.rows}, financed controls ${d.financed}, headers ${d.heads.join('|')}`}`);
    }
    const error = await page.evaluate(() => { const e = document.getElementById('error'); return e.style.display === 'block' ? e.textContent : null; });
    if (error !== null) {
      failures++;
      console.log(`${sc.id.padEnd(19)} FAIL  the page shows an error: ${error}`);
      await page.close();
      continue;
    }
    {
      // B24: one read-only #contractTerm, filled after a calculation, and the printed 'Contract term' row is the same text;
      // the Term years / Term months inputs and the Contract date are not on the page.
      const t = await page.evaluate(() => ({
        field: document.getElementById('contractTerm')?.value ?? null,
        readonly: document.getElementById('contractTerm')?.hasAttribute('readonly') ?? false,
        removed: ['termYears', 'termMonths', 'contractDate'].every((id) => document.getElementById(id) === null),
        printed: [...document.querySelectorAll('#printInputs .print-input')].filter((r) => r.querySelector('dt').textContent === 'Contract term').map((r) => r.querySelector('dd').textContent),
      }));
      const okTerm = t.readonly && t.removed && /^\d+ years?, \d+ months?, \d+ days?$/.test(t.field ?? '') && t.printed.length === 1 && t.printed[0] === t.field;
      if (!okTerm) failures++;
      console.log(`${sc.id.padEnd(19)} term    ${okTerm ? `ok  ${t.field}` : `FAIL  ${JSON.stringify(t)}`}`);
    }
    if (sc.id === 'SHORTFALL') {
      // B26: the printed figures list carries the unpaid-interest line (F12 measures the schedule width only).
      const figs = await page.evaluate(() => [...document.querySelectorAll('#printFigures .figure')].map((f) => {
        const hint = f.querySelector('dt .figure-hint');
        return [f.querySelector('dt').firstChild.textContent, f.querySelector('dd').textContent, hint ? hint.textContent : null];
      }));
      const at = figs.findIndex(([label]) => label === 'Unpaid interest at end date');
      const okFig = at > 0 && figs[at][1] === '$3,015.17' && figs[at][2] === 'Unpaid after the last payment; interest since then is not included'
        && figs[at - 1][0] === 'Balance at end date' && figs[at - 1][1] === '$200,000.00';
      if (!okFig) failures++;
      console.log(`${sc.id.padEnd(19)} figure  ${okFig ? 'ok' : `FAIL  printed figures ${JSON.stringify(figs)}`}`);
    }
    for (const mode of ['all', 'compact']) {
      // A radio is not clickable under print media: choose the mode on screen first.
      await page.emulateMedia({ media: 'screen' });
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.check(`#scheduleColumns-${mode}`);
      await page.emulateMedia({ media: 'print' });
      // A11: the print table is built when printing (matchMedia 'change' fires on the next task).
      // It must be the table for THIS mode (a stale one from the other mode must not satisfy the wait), so wait for its headings.
      await page.waitForFunction((leaves) => {
        const t = document.getElementById('printScheduleTable');
        return t.tBodies.length > 0 && t.tHead?.rows[1] !== undefined && [...t.tHead.rows[1].cells].map((c) => c.textContent).join('|') === leaves;
      }, expectedHeads(mode).leaves.join('|'), { timeout: 3000 }).catch(() => {});
      await page.setViewportSize({ width: MAX_WIDTH, height: 700 });
      const m = await page.evaluate(() => {
        const t = document.getElementById('printScheduleTable');
        const s = document.createElement('style');
        s.textContent = '@media print{#printScheduleTable{width:auto !important}}';
        document.head.append(s);
        const natural = t.getBoundingClientRect().width;
        s.remove();
        const text = (row) => [...row.cells].map((c) => c.textContent);
        return { natural, groups: text(t.tHead.rows[0]), leaves: text(t.tHead.rows[1]), bodies: t.tBodies.length };
      });
      const want = expectedHeads(mode);
      const fits = m.natural <= MAX_WIDTH;
      const headsOk = JSON.stringify(m.groups) === JSON.stringify(want.groups) && JSON.stringify(m.leaves) === JSON.stringify(want.leaves);
      const ok = fits && headsOk && m.bodies > 0;
      if (!ok) failures++;
      const why = [fits ? '' : `over by ${(m.natural - MAX_WIDTH).toFixed(1)} px`, headsOk ? '' : `headings ${m.leaves.join('|')}`, m.bodies > 0 ? '' : 'no rows']
        .filter(Boolean).join('; ');
      console.log(`${sc.id.padEnd(19)} ${mode.padEnd(8)} ${m.natural.toFixed(1).padStart(7)} px  ${ok ? 'ok' : `FAIL  ${why}`}`);
    }
    await page.close();
  }
} finally {
  await browser.close();
  server.stop();
}
console.log(failures === 0 ? 'F12 PASS: 16/16' : `F12 FAIL: ${failures} failing case(s)`);
process.exitCode = failures === 0 ? 0 : 1;
