// B27 re-verify (QA): page-load smoke in real Chrome, which vitest cannot see. A duplicate declaration made
// ui/ca.js a SyntaxError (dead page) while every vitest test stayed green. This script fails on ANY pageerror or
// console error/warning, then drives the B27 lock, Renewal, a personal-loan calculation, CSV and the print record.
// (The page recalculates on input; there is no Calculate button.)
// usage (from COB-ts/, after `npm run build`):  node tests/ui/check_page_smoke.mjs [baseUrl]
import { createRequire } from 'node:module';
import { execSync, spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const req = createRequire(execSync('npm root -g').toString().trim() + '/@playwright/mcp/');
const { chromium } = req('playwright-core');
const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const freePort = () => new Promise((r) => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => r(port)); }); });
let child = null; let base = process.argv[2]?.replace(/\/$/, '');
if (!base) {
  const port = await freePort();
  child = spawn(process.execPath, ['ui/serve.mjs'], { cwd: ROOT, env: { ...process.env, PORT: String(port) }, stdio: 'ignore' });
  base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 100; i++) { try { if ((await fetch(base + '/ui/ca.html')).ok) break; } catch {} await new Promise((r) => setTimeout(r, 100)); }
}
const problems = []; const fail = (m) => problems.push(m);
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const ctx = await browser.newContext({ acceptDownloads: true, locale: 'en-CA', timezoneId: 'America/Toronto', viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => fail('pageerror: ' + e.message));
  page.on('console', (m) => { if (['error', 'warning'].includes(m.type()) && !/alterna\.ca\/media|\/favicon\.ico/.test(m.location().url)) fail(`console.${m.type()}: ${m.text()} @${m.location().url}`); });
  page.on('requestfailed', (r) => { if (!r.url().includes('alterna.ca/media')) fail('requestfailed: ' + r.url()); }); // external logo is not ours
  await page.goto(base + '/ui/ca.html'); await page.waitForLoadState('load');
  const st = () => page.evaluate(() => {
    const s = document.getElementById('paymentFrequency'); const h = document.getElementById(s.getAttribute('aria-describedby') ?? '');
    return { disabled: s.disabled, value: s.value, opts: [...s.options].map((o) => o.value).join(','),
      hint: h && h.getClientRects().length > 0 && !h.hidden && getComputedStyle(h).display !== 'none' ? h.textContent.trim() : null };
  });
  const eq = (got, want, where) => { for (const k of Object.keys(want)) if (got[k] !== want[k]) fail(`${where}: ${k}=${JSON.stringify(got[k])} want ${JSON.stringify(want[k])}`); };
  const OPTS = 'weekly,biweekly,semiMonthly,monthly';
  if (await page.locator('#feesBody tr').count() !== 0) fail('fee table does not start empty');
  eq(await st(), { disabled: false, opts: OPTS, hint: null }, 'initial');
  const fill = async (f) => { for (const [k, v] of Object.entries(f)) await page.fill('#' + k, v); };
  const calc = async () => { await page.waitForTimeout(400); return page.evaluate(() => { const e = document.getElementById('error'); return e.style.display === 'block' ? e.textContent : null; }); };
  // REF-01
  await page.selectOption('#paymentFrequency', 'weekly');
  // B24: no Term years / Term months / Contract date / Semi-annual date to fill (removed or hidden behind switches).
  const termState = () => page.evaluate(() => ({
    value: document.getElementById('contractTerm')?.value ?? null,
    readonly: document.getElementById('contractTerm')?.hasAttribute('readonly') ?? false,
    gone: ['termYears', 'termMonths', 'contractDate'].filter((id) => document.getElementById(id) !== null),
    semiVisible: (() => { const n = document.getElementById('semiAnnualCompoundingDate'); return n !== null && n.getClientRects().length > 0; })(),
  }));
  eq(await termState(), { readonly: true, semiVisible: false }, 'term field on load');
  if ((await termState()).gone.length) fail('B24: these ids must not be on the page: ' + (await termState()).gone.join(','));
  await fill({ loanAmount: '227829.65', contractRatePercent: '3.74', paymentAmount: '465.46', disbursalDate: '2026-03-17', firstPaymentDate: '2026-03-23', endDate: '2029-03-17' });
  let err = await calc(); if (err) fail('REF-01 error: ' + err);
  eq(await termState(), { value: '2 years, 11 months, 17 days' }, 'REF-01 Contract term after a calculation');
  // Blank while the form is invalid (a failed calculation clears it), filled again once valid.
  await page.fill('#contractRatePercent', '');
  if (!(await calc())) fail('blank rate did not produce an error');
  eq(await termState(), { value: '' }, 'Contract term after a failed calculation');
  await page.fill('#contractRatePercent', '3.74');
  err = await calc(); if (err) fail('REF-01 error after refill: ' + err);
  eq(await termState(), { value: '2 years, 11 months, 17 days' }, 'Contract term after refilling the rate');
  const printedTerm = await page.evaluate(() => [...document.querySelectorAll('#printInputs .print-input')].filter((r) => r.querySelector('dt').textContent === 'Contract term').map((r) => r.querySelector('dd').textContent));
  if (JSON.stringify(printedTerm) !== JSON.stringify(['2 years, 11 months, 17 days'])) fail('printed Contract term row: ' + JSON.stringify(printedTerm));
  const tileTerm = await page.evaluate(() => [...document.querySelectorAll('#contractTermsList .term')].filter((t) => t.querySelector('dt').textContent === 'Contract term').map((t) => t.querySelector('dd').textContent));
  if (JSON.stringify(tileTerm) !== JSON.stringify(['2\u00a0years, 11\u00a0months, 17\u00a0days'])) fail('tile Contract term: ' + JSON.stringify(tileTerm));
  const heading = await page.textContent('#contractTerms-heading');
  if (heading.trim() !== 'Contract terms') fail('tile heading with the Contract date switch off: ' + JSON.stringify(heading));
  const ref = await page.textContent('#printFigures'); if (!ref || ref.length < 20) fail('REF-01 no figures');
  // lock
  await page.selectOption('#productType', 'personalLoan');
  eq(await st(), { disabled: true, value: 'monthly', opts: OPTS, hint: 'Personal loans are paid monthly.' }, 'personal loan (from weekly)');
  await page.selectOption('#productType', 'mortgage');
  eq(await st(), { disabled: false, value: 'monthly', opts: OPTS, hint: null }, 'back to mortgage');
  // personal loan calc, CSV, print
  await page.selectOption('#productType', 'personalLoan');
  await page.selectOption('#rateType', 'fixed');
  await fill({ loanAmount: '10000', contractRatePercent: '7.5', paymentAmount: '311', firstPaymentDate: '2026-04-17' });
  err = await calc(); if (err) fail('personal loan error: ' + err);
  const figs = await page.textContent('#printFigures'); if (!figs || figs === ref) fail('personal loan figures missing or equal to REF-01');
  const pi = await page.textContent('#printInputs'); if (!/Personal loan/.test(pi) || !/Monthly/i.test(pi)) fail('print inputs lack Personal loan / Monthly: ' + pi.slice(0, 200));
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#downloadCsv')]);
  const csv = readFileSync(await dl.path(), 'utf8'); if (csv.split('\n').length < 30) fail('CSV too short');
  await page.emulateMedia({ media: 'print' });
  if (await page.locator('#printScheduleTable tbody tr').count() < 30) fail('print schedule has too few rows');
  await page.emulateMedia({ media: 'screen' });
  // Renewal locks the product
  await page.selectOption('#flow', 'renewal');
  const prod = await page.evaluate(() => ({ v: document.getElementById('productType').value, d: document.getElementById('productType').disabled }));
  if (prod.v !== 'mortgage' || !prod.d) fail('renewal did not lock product: ' + JSON.stringify(prod));
  eq(await st(), { disabled: false, value: 'monthly', opts: OPTS, hint: null }, 'renewal');
} finally { await browser.close(); child?.kill(); }
if (problems.length) { console.log('SMOKE FAIL\n' + problems.join('\n')); process.exit(1); }
console.log('SMOKE PASS: no pageerror/console error; lock, hint, 4 options, REF-01, Contract term (filled, cleared, printed, tile), personal loan calc, CSV, print, renewal');
