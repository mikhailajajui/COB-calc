// B27 re-verify (QA): page-load smoke in real Chrome, which vitest cannot see. A duplicate declaration made
// ui/ca.js a SyntaxError (dead page) while every vitest test stayed green. This script fails on ANY pageerror or
// console error/warning, then drives the Payment frequency select (B33, DEC-B33-FREQ: no lock for a personal loan; B27's lock
// and its hint are gone), Renewal, a personal-loan calculation, CSV and the print record.
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
// B31 (DEC-B31-LAYOUT, revision 49; B31-INV-PAGE screen part, B31-INV-HINT Chrome part): the screen keeps the KPI cards,
// the main list (= the printout's right column; Cost of borrowing amount WITHOUT its hint) and the collapsed
// "More figures" (= the printout's left column without the APR). Expected lists typed from the decision.
const B31_MAIN = ['Total of all payments', 'Cost of borrowing amount', 'Total principal paid', 'Total interest'];
const B31_MORE = ['Calculated rate', 'Number of payments', 'Term in days', 'Balance at end date'];
const COB_LABEL = 'Cost of borrowing amount';
const COB_HINT = 'Interest plus all fees over the term.';
const b31Screen = async (page, where) => {
  const s = await page.evaluate(() => {
    const labels = (id) => [...document.querySelectorAll(`#${id} .figure`)].map((f) => f.querySelector('dt').firstChild.textContent);
    const cobDt = [...document.querySelectorAll('#mainFigures .figure dt')].find((d) => d.firstChild.textContent === 'Cost of borrowing amount');
    const d = document.querySelector('details.more-figures');
    return { main: labels('mainFigures'), more: labels('moreFigures'), cobHint: cobDt ? cobDt.querySelector('.figure-hint') !== null : null,
      details: d === null ? null : d.open, moreInside: d !== null && d.contains(document.getElementById('moreFigures')) };
  });
  if (JSON.stringify(s.main) !== JSON.stringify(B31_MAIN)) fail(`B31 ${where}: #mainFigures labels ${JSON.stringify(s.main)}`);
  if (JSON.stringify(s.more) !== JSON.stringify(B31_MORE)) fail(`B31 ${where}: #moreFigures labels ${JSON.stringify(s.more)}`);
  if (s.cobHint !== false) fail(`B31 ${where}: the main list's Cost of borrowing amount must have no .figure-hint (got ${s.cobHint})`);
  if (s.details !== false) fail(`B31 ${where}: details.more-figures must exist and be closed (got ${s.details})`);
  if (!s.moreInside) fail(`B31 ${where}: #moreFigures is not inside details.more-figures`);
};
const b31Counts = async (page, media, wantLabel, wantHint) => {
  await page.emulateMedia({ media });
  const text = await page.evaluate(() => document.body.innerText);
  const n = (needle) => text.split(needle).length - 1;
  if (n(COB_LABEL) !== wantLabel || n(COB_HINT) !== wantHint) fail(`B31-INV-HINT ${media}: "${COB_LABEL}" ${n(COB_LABEL)} (want ${wantLabel}), hint ${n(COB_HINT)} (want ${wantHint})`);
};
// B32 (DEC-B32-TERM, 2026-10-05; B32-INV-PAGE): the Contract term runs from the flow's start date; its label is
// "Remaining contract term" for Renewal and Payment change, "Contract term" otherwise (field, tile, print row); the hint
// names the start date. Typed from the decision.
const B32_LABEL = { newMortgageOrLoan: 'Contract term', renewal: 'Remaining contract term', paymentChange: 'Remaining contract term' };
const B32_HINT = {
  newMortgageOrLoan: 'Calculated from the disbursal date to the last scheduled payment date.',
  renewal: 'Calculated from the renewal date to the last scheduled payment date.',
  paymentChange: 'Calculated from the date of change to the last scheduled payment date.',
};
// The term's label, hint, field value, and the tile / print rows whose dt equals the label (values as shown).
const b32State = (page) => page.evaluate(() => {
  const label = document.querySelector('label[for="contractTerm"]')?.textContent ?? null;
  const rows = (sel, item) => [...document.querySelectorAll(`${sel} ${item}`)].filter((r) => r.querySelector('dt')?.textContent === label).map((r) => r.querySelector('dd').textContent);
  return { label, hint: document.getElementById('contractTerm-hint')?.textContent ?? null, value: document.getElementById('contractTerm')?.value ?? null,
    tile: rows('#contractTermsList', '.term'), printed: rows('#printInputs', '.print-input') };
});
const b32Labels = async (page, flow, where) => {
  const s = await b32State(page);
  if (s.label !== B32_LABEL[flow]) fail(`B32 ${where}: label ${JSON.stringify(s.label)} want ${JSON.stringify(B32_LABEL[flow])}`);
  if (s.hint !== B32_HINT[flow]) fail(`B32 ${where}: hint ${JSON.stringify(s.hint)} want ${JSON.stringify(B32_HINT[flow])}`);
  return s;
};
const b32Shown = (s, value, where) => {
  const nb = value.replace(/(\d+) (year|month|day)/g, '$1\u00a0$2');
  if (s.value !== value) fail(`B32 ${where}: field ${JSON.stringify(s.value)} want ${JSON.stringify(value)}`);
  if (JSON.stringify(s.tile) !== JSON.stringify([nb])) fail(`B32 ${where}: tile under "${s.label}" ${JSON.stringify(s.tile)} want ${JSON.stringify([nb])}`);
  if (JSON.stringify(s.printed) !== JSON.stringify([value])) fail(`B32 ${where}: print row under "${s.label}" ${JSON.stringify(s.printed)} want ${JSON.stringify([value])}`);
};
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const ctx = await browser.newContext({ acceptDownloads: true, locale: 'en-CA', timezoneId: 'America/Toronto', viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => fail('pageerror: ' + e.message));
  page.on('console', (m) => { if (['error', 'warning'].includes(m.type()) && !/alterna\.ca\/media|\/favicon\.ico/.test(m.location().url)) fail(`console.${m.type()}: ${m.text()} @${m.location().url}`); });
  page.on('requestfailed', (r) => { if (!r.url().includes('alterna.ca/media')) fail('requestfailed: ' + r.url()); }); // external logo is not ours
  await page.goto(PAGE_URL || base + '/ui/ca.html'); await page.waitForLoadState('load');
  // B33 (DEC-B33-FREQ): the select has no aria-describedby and the page has no #paymentFrequencyHint (describedBy / hintNode).
  const st = () => page.evaluate(() => {
    const s = document.getElementById('paymentFrequency'); const h = document.getElementById(s.getAttribute('aria-describedby') ?? '');
    return { disabled: s.disabled, value: s.value, opts: [...s.options].map((o) => o.value).join(','),
      hint: h && h.getClientRects().length > 0 && !h.hidden && getComputedStyle(h).display !== 'none' ? h.textContent.trim() : null,
      describedBy: s.getAttribute('aria-describedby'), hintNode: document.getElementById('paymentFrequencyHint') === null ? 0 : 1,
      monthlyText: document.body.textContent.includes('Personal loans are paid monthly.') ? 1 : 0 };
  });
  const UNLOCKED = { disabled: false, hint: null, describedBy: null, hintNode: 0, monthlyText: 0 };
  const eq = (got, want, where) => { for (const k of Object.keys(want)) if (got[k] !== want[k]) fail(`${where}: ${k}=${JSON.stringify(got[k])} want ${JSON.stringify(want[k])}`); };
  const OPTS = 'weekly,biweekly,semiMonthly,monthly';
  if (await page.locator('#feesBody tr').count() !== 0) fail('fee table does not start empty');
  eq(await st(), { ...UNLOCKED, value: 'weekly', opts: OPTS }, 'initial (B33-INV-PAGE: enabled, Weekly, four options, no hint)');
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
  eq(await termState(), { value: '2 years, 11 months, 23 days' }, 'REF-01 Contract term after a calculation'); // B32 (DEC-B32-TERM): was 17 days
  // Blank while the form is invalid (a failed calculation clears it), filled again once valid.
  await page.fill('#contractRatePercent', '');
  if (!(await calc())) fail('blank rate did not produce an error');
  eq(await termState(), { value: '' }, 'Contract term after a failed calculation');
  await page.fill('#contractRatePercent', '3.74');
  err = await calc(); if (err) fail('REF-01 error after refill: ' + err);
  eq(await termState(), { value: '2 years, 11 months, 23 days' }, 'Contract term after refilling the rate');
  // B32 (DEC-B32-TERM): the print / tile rows are found by the label element's text (per flow), not a literal.
  const termLabelText = () => page.evaluate(() => document.querySelector('label[for="contractTerm"]')?.textContent ?? null);
  if ((await termLabelText()) !== 'Contract term') fail('B32 REF-01 (New): label ' + JSON.stringify(await termLabelText()));
  const printedTerm = await page.evaluate(() => { const l = document.querySelector('label[for="contractTerm"]')?.textContent; return [...document.querySelectorAll('#printInputs .print-input')].filter((r) => r.querySelector('dt').textContent === l).map((r) => r.querySelector('dd').textContent); });
  if (JSON.stringify(printedTerm) !== JSON.stringify(['2 years, 11 months, 23 days'])) fail('printed Contract term row: ' + JSON.stringify(printedTerm));
  const tileTerm = await page.evaluate(() => { const l = document.querySelector('label[for="contractTerm"]')?.textContent; return [...document.querySelectorAll('#contractTermsList .term')].filter((t) => t.querySelector('dt').textContent === l).map((t) => t.querySelector('dd').textContent); });
  if (JSON.stringify(tileTerm) !== JSON.stringify(['2\u00a0years, 11\u00a0months, 23\u00a0days'])) fail('tile Contract term: ' + JSON.stringify(tileTerm));
  const heading = await page.textContent('#contractTerms-heading');
  if (heading.trim() !== 'Contract terms') fail('tile heading with the Contract date switch off: ' + JSON.stringify(heading));
  const ref = await page.textContent('#printFigures'); if (!ref || ref.length < 20) fail('REF-01 no figures');
  await b31Screen(page, 'REF-01');
  await b31Counts(page, 'print', 1, 1); // the printout: label and hint once each (right column)
  await b31Counts(page, 'screen', 2, 1); // the screen: label on the card and in the main list; hint on the card only
  // B33-INV-PAGE (DEC-B33-FREQ): no lock. Personal loan keeps Weekly, enabled; a Semi-monthly choice survives
  // Product -> Mortgage -> Personal loan.
  await page.selectOption('#productType', 'personalLoan');
  eq(await st(), { ...UNLOCKED, value: 'weekly', opts: OPTS }, 'B33 personal loan (from weekly): still enabled, still Weekly');
  await page.selectOption('#paymentFrequency', 'semiMonthly');
  await page.selectOption('#productType', 'mortgage');
  eq(await st(), { ...UNLOCKED, value: 'semiMonthly', opts: OPTS }, 'B33 semi-monthly, then mortgage');
  await page.selectOption('#productType', 'personalLoan');
  eq(await st(), { ...UNLOCKED, value: 'semiMonthly', opts: OPTS }, 'B33 semi-monthly, mortgage, back to personal loan');
  // personal loan calc, CSV, print. B33: Monthly is chosen explicitly (no lock sets it), so the "Monthly" print check below
  // still means the page printed what was chosen.
  await page.selectOption('#paymentFrequency', 'monthly');
  await page.selectOption('#rateType', 'fixed');
  await fill({ loanAmount: '10000', contractRatePercent: '7.5', paymentAmount: '311', firstPaymentDate: '2026-04-17' });
  err = await calc(); if (err) fail('personal loan error: ' + err);
  const figs = await page.textContent('#printFigures'); if (!figs || figs === ref) fail('personal loan figures missing or equal to REF-01');
  await b31Screen(page, 'personal loan');
  const pi = await page.textContent('#printInputs'); if (!/Personal loan/.test(pi) || !/Monthly/i.test(pi)) fail('print inputs lack Personal loan / Monthly: ' + pi.slice(0, 200));
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#downloadCsv')]);
  const csv = readFileSync(await dl.path(), 'utf8'); if (csv.split('\n').length < 30) fail('CSV too short');
  await page.emulateMedia({ media: 'print' });
  // A11: the print table is built when printing; Chrome's print-media change (matchMedia 'change') triggers it asynchronously.
  await page.waitForFunction(() => document.querySelectorAll('#printScheduleTable tbody tr').length >= 30, null, { timeout: 3000 }).catch(() => {});
  if (await page.locator('#printScheduleTable tbody tr').count() < 30) fail('print schedule has too few rows');
  await page.emulateMedia({ media: 'screen' });
  // Renewal allows Personal loan again (2026-10-01); product stays enabled
  await page.selectOption('#flow', 'renewal');
  const prod = await page.evaluate(() => ({ v: document.getElementById('productType').value, d: document.getElementById('productType').disabled }));
  if (prod.v !== 'personalLoan' || prod.d) fail('renewal changed or locked the product: ' + JSON.stringify(prod));
  eq(await st(), { ...UNLOCKED, value: 'monthly', opts: OPTS }, 'B33 renewal (personal loan): enabled, value kept');
  // B32-INV-PAGE: a fresh page, then New -> Renewal -> Payment change -> New; RENEWAL (capture inputs, no fee) under
  // "Remaining contract term" = 2 years, 6 months, 0 days (field, tile, print row).
  {
    const p2 = await ctx.newPage();
    p2.on('pageerror', (e) => fail('B32 pageerror: ' + e.message));
    p2.on('console', (m) => { if (['error', 'warning'].includes(m.type()) && !/alterna\.ca\/media|\/favicon\.ico/.test(m.location().url)) fail(`B32 console.${m.type()}: ${m.text()}`); });
    await p2.goto(PAGE_URL || base + '/ui/ca.html'); await p2.waitForLoadState('load');
    await b32Labels(p2, 'newMortgageOrLoan', 'fresh page (New)');
    await p2.selectOption('#flow', 'renewal');
    await b32Labels(p2, 'renewal', 'after New -> Renewal');
    await p2.selectOption('#paymentFrequency', 'monthly'); // the page opens on Weekly; RENEWAL is monthly
    for (const [k, v] of Object.entries({ loanAmount: '150000', contractRatePercent: '4.19', paymentAmount: '900', firstPaymentDate: '2026-05-01', endDate: '2028-10-01', renewalDate: '2026-04-01', accruedInterest: '125.50' })) await p2.fill('#' + k, v);
    await p2.waitForTimeout(400);
    const e2 = await p2.evaluate(() => { const e = document.getElementById('error'); return e.style.display === 'block' ? e.textContent : null; });
    if (e2) fail('B32 RENEWAL error: ' + e2);
    b32Shown(await b32Labels(p2, 'renewal', 'RENEWAL calculated'), '2 years, 6 months, 0 days', 'RENEWAL');
    await p2.selectOption('#flow', 'paymentChange');
    await p2.waitForTimeout(400);
    b32Shown(await b32Labels(p2, 'paymentChange', 'after Renewal -> Payment change'), '2 years, 6 months, 0 days', 'Payment change (Date of change 2026-04-01)');
    await p2.selectOption('#flow', 'newMortgageOrLoan');
    await p2.waitForTimeout(400);
    await b32Labels(p2, 'newMortgageOrLoan', 'after Payment change -> New');
    await p2.close();
  }
} finally { await browser.close(); child?.kill(); }
if (problems.length) { console.log('SMOKE FAIL\n' + problems.join('\n')); process.exit(1); }
console.log('SMOKE PASS: no pageerror/console error; B33 no frequency lock (enabled, value kept, no hint), 4 options, REF-01, Contract term (filled, cleared, printed, tile), B31 screen lists and hint counts, personal loan calc, CSV, print, renewal, B32 term label/hint per flow and RENEWAL term');
