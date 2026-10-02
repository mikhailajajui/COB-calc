// F17 (B25 UI step, QA): in real Chrome, a semi-monthly first payment date that the engine moves forward is SHOWN.
// Vitest cannot load ui/ca.js, so this loads the real page. Not part of vitest.
// Expected (user decisions 2026-10-01): on-screen note under the First payment date field, the same note in the printed
// inputs (typed date kept) and under the Contract terms tiles (typed date kept), CSV file name = the moved date,
// Contract term from the moved date, 'Next payment moved to ...' on the Next payment flows, nothing at all when not moved.
// usage (from COB-ts/, after `npm run build`):  node tests/ui/check_semimonthly_move.mjs [baseUrl]
import { createRequire } from 'node:module';
import { execSync, spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const req = createRequire(execSync('npm root -g').toString().trim() + '/@playwright/mcp/');
const { chromium } = req('playwright-core');
const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const freePort = () => new Promise((r) => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => r(port)); }); });
// COB_PAGE_URL (optional): a full page URL; when set the page is opened there and no server is started.
const PAGE_URL = process.env.COB_PAGE_URL || '';
let child = null; let base = process.argv[2]?.replace(/\/$/, '');
if (!base && !PAGE_URL) {
  const port = await freePort();
  child = spawn(process.execPath, ['ui/serve.mjs'], { cwd: ROOT, env: { ...process.env, PORT: String(port) }, stdio: 'ignore' });
  base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 100; i++) { try { if ((await fetch(base + '/ui/ca.html')).ok) break; } catch {} await new Promise((r) => setTimeout(r, 100)); }
}
const problems = []; const fail = (m) => problems.push(m);
let checks = 0;
const same = (got, want, where) => { checks++; if (got !== want) fail(`${where}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`); };
const TAIL = '(semi-monthly payments fall on the 15th and month-end)';
const norm = (s) => (s ?? '').replace(/ /g, ' ').replace(/\s+/g, ' ').trim();
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const ctx = await browser.newContext({ acceptDownloads: true, locale: 'en-CA', timezoneId: 'America/Toronto', viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => fail('pageerror: ' + e.message));
  page.on('console', (m) => { if (['error', 'warning'].includes(m.type()) && !/alterna\.ca\/media|\/favicon\.ico/.test(m.location().url)) fail(`console.${m.type()}: ${m.text()} @${m.location().url}`); });
  await page.goto(PAGE_URL || base + '/ui/ca.html'); await page.waitForLoadState('load');
  const fill = async (f) => { for (const [k, v] of Object.entries(f)) await page.fill('#' + k, v); };
  const settle = () => page.waitForTimeout(400);
  const err = () => page.evaluate(() => { const e = document.getElementById('error'); return e.style.display === 'block' ? e.textContent : null; });
  // The note as the user sees it: '' when absent, hidden, or empty.
  const visibleText = (sel) => page.evaluate((s) => {
    const n = document.querySelector(s); if (!n) return null;
    return n.hidden || n.getClientRects().length === 0 || getComputedStyle(n).visibility === 'hidden' ? '' : n.textContent;
  }, sel);
  const printedInputs = () => page.evaluate(() => [...document.querySelectorAll('#printInputs .print-input')].map((r) => [r.querySelector('dt')?.textContent ?? '', r.querySelector('dd')?.textContent ?? '']));
  const tiles = () => page.evaluate(() => [...document.querySelectorAll('#contractTermsList .term')].map((t) => [t.querySelector('dt')?.textContent ?? '', t.querySelector('dd')?.textContent ?? '']));
  const csv = async () => { const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 5000 }), page.click('#downloadCsv')]); return { name: dl.suggestedFilename(), text: readFileSync(await dl.path(), 'utf8') }; };
  const rawText = (sel) => page.evaluate((q) => document.querySelector(q)?.textContent ?? '', sel);
  const countIn = (s, sub) => s.split(sub).length - 1;

  // ---- Scenario 1: semi-monthly, typed Jan 10 -> moved to Jan 15, 2027 ----
  await page.selectOption('#paymentFrequency', 'semiMonthly');
  await fill({ loanAmount: '100000', contractRatePercent: '5', paymentAmount: '1000', disbursalDate: '2027-01-01', firstPaymentDate: '2027-01-10', endDate: '2029-01-15' });
  await settle();
  same(await err(), null, 'S1 no error');
  const NOTE1 = `First payment moved to Jan 15, 2027 ${TAIL}`;
  same(norm(await visibleText('#firstDateNote')), NOTE1, 'S1 on-screen note');
  same(await page.evaluate(() => document.getElementById('firstDateNote')?.getAttribute('role') ?? null), 'status', 'S1 note role');
  same(await page.inputValue('#firstPaymentDate'), '2027-01-10', 'S1 typed field value is kept');
  same(await page.inputValue('#contractTerm'), '2 years, 0 months, 0 days', 'S1 Contract term runs from the moved date');
  const cap = norm(await page.textContent('#scheduleTable caption'));
  same(/from Jan 15, 2027 to /.test(cap), true, 'S1 schedule caption starts at the moved date: ' + cap);
  const tile1 = (await tiles()).find(([k]) => norm(k) === 'First payment date');
  same(norm(tile1?.[1]), 'Jan 10, 2027', 'S1 tile keeps the typed date');
  same(norm(await visibleText('#contractTermsNote')), NOTE1, 'S1 note under the Contract terms tiles');
  const pin = await printedInputs();
  const i = pin.findIndex(([k]) => norm(k) === 'First payment date');
  same(norm(pin[i]?.[1]), 'Jan 10, 2027', 'S1 printed row keeps the typed date');
  same(norm(pin[i + 1]?.[1]), NOTE1, 'S1 printed note is directly under the First payment date row');
  same(countIn(norm((await page.textContent('#printInputs')) ?? ''), 'moved to'), 1, 'S1 the printout shows the note once');
  const c1 = await csv();
  same(c1.name, 'cost-of-borrowing-schedule-2027-01-15.csv', 'S1 CSV file name uses the moved date');
  same(c1.text.split('\r\n')[1].includes('2027-01-15'), true, 'S1 first CSV data row is the moved date');
  await page.emulateMedia({ media: 'print' });
  // A11: the print table is built when printing (matchMedia 'change' fires on the next task).
  await page.waitForFunction(() => document.querySelectorAll('#printScheduleTable tbody tr').length > 0, null, { timeout: 3000 }).catch(() => {});
  const firstRow = norm(await page.evaluate(() => [...document.querySelectorAll('#printScheduleTable tbody tr')].map((r) => r.textContent).find((t) => /[A-Z][a-z]{2} \d{1,2}, \d{4}/.test(t)) ?? ''));
  same(firstRow.includes('Jan 15, 2027'), true, 'S1 first printed schedule row is Jan 15, 2027: ' + firstRow.slice(0, 60));
  same(norm(await visibleText('#printInputs')).includes(NOTE1), true, 'S1 the printed note is visible in print media');
  await page.emulateMedia({ media: 'screen' });

  // ---- Scenario 2: typed on the 15th and on month-end -> nothing shown anywhere ----
  for (const d of ['2027-01-15', '2027-01-31']) {
    await fill({ firstPaymentDate: d }); await settle();
    same(await err(), null, `S2 ${d} no error`);
    same(norm(await visibleText('#firstDateNote')), '', `S2 ${d} no on-screen note`);
    same(norm(await visibleText('#contractTermsNote')), '', `S2 ${d} no tile note`);
    same(await rawText('#firstDateNote'), '', `S2 ${d} note element is empty`);
    same(countIn((await page.textContent('#printInputs')) ?? '', 'moved to'), 0, `S2 ${d} no printed note`);
    same((await csv()).name, `cost-of-borrowing-schedule-${d}.csv`, `S2 ${d} CSV name keeps the date`);
  }

  // ---- Scenario 3: other frequencies, same typed date -> no note ----
  for (const [f, pay] of [['weekly', '300'], ['biweekly', '600'], ['monthly', '1000']]) {
    await page.selectOption('#paymentFrequency', f);
    await fill({ firstPaymentDate: '2027-01-10', paymentAmount: pay }); await settle();
    same(await err(), null, `S3 ${f} no error`);
    same(norm(await visibleText('#firstDateNote')), '', `S3 ${f} no note`);
    same(norm(await visibleText('#contractTermsNote')), '', `S3 ${f} no tile note`);
    same(countIn((await page.textContent('#printInputs')) ?? '', 'moved to'), 0, `S3 ${f} no printed note`);
    same((await csv()).name, 'cost-of-borrowing-schedule-2027-01-10.csv', `S3 ${f} CSV name keeps the typed date`);
  }

  // ---- Scenario 4: a calculation error clears the notes ----
  await page.selectOption('#paymentFrequency', 'semiMonthly');
  await fill({ firstPaymentDate: '2027-01-10', paymentAmount: '1000' }); await settle();
  same(norm(await visibleText('#firstDateNote')), NOTE1, 'S4 note back');
  await page.fill('#contractRatePercent', ''); await settle();
  same(typeof (await err()), 'string', 'S4 blank rate gives an error');
  same(norm(await visibleText('#firstDateNote')), '', 'S4 error clears the on-screen note');
  same(await rawText('#firstDateNote'), '', 'S4 error empties the note element');
  same(norm(await visibleText('#contractTermsNote')), '', 'S4 error hides the tile note');
  await page.fill('#contractRatePercent', '5'); await settle();
  same(norm(await visibleText('#firstDateNote')), NOTE1, 'S4 note returns when valid again');

  // ---- Scenario 5: Next payment flow (Payment change) -> 'Next payment moved to ...' ----
  await page.selectOption('#flow', 'paymentChange');
  await fill({ renewalDate: '2027-01-01', accruedInterest: '0', firstPaymentDate: '2027-01-20', endDate: '2029-01-15' }); await settle();
  same(await err(), null, 'S5 no error');
  const NOTE5 = `Next payment moved to Jan 31, 2027 ${TAIL}`;
  same(norm(await visibleText('#firstDateNote')), NOTE5, 'S5 on-screen note follows the flow label');
  same(norm(await visibleText('#contractTermsNote')), NOTE5, 'S5 tile note follows the flow label');
  const pin5 = await printedInputs();
  const j = pin5.findIndex(([k]) => norm(k) === 'Next payment date');
  same(norm(pin5[j]?.[1]), 'Jan 20, 2027', 'S5 printed row keeps the typed date');
  same(norm(pin5[j + 1]?.[1]), NOTE5, 'S5 printed note under the Next payment date row');
  same((await csv()).name, 'cost-of-borrowing-schedule-2027-01-31.csv', 'S5 CSV name uses the moved date');
} catch (e) { fail('script error (a missing element or timeout is a failed check): ' + String(e.message).split('\n')[0]); }
finally { await browser.close(); child?.kill(); }
if (problems.length) { console.log('F17 FAIL\n' + problems.join('\n')); process.exit(1); }
console.log(`F17 PASS: ${checks} checks; semi-monthly move shown on screen, in the printout and the tiles; CSV name and Contract term from the moved date; no note when unmoved, for other frequencies, or after an error; Next payment wording on the Payment change flow; no console errors`);
