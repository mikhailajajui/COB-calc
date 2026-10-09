// B27 re-verify (QA): page-load smoke in real Chrome, which vitest cannot see. A duplicate declaration made
// ui/ca.js a SyntaxError (dead page) while every vitest test stayed green. This script fails on ANY pageerror or
// console error/warning, then drives the Payment frequency select (B33, DEC-B33-FREQ: no lock for a personal loan; B27's lock
// and its hint are gone), Renewal, a personal-loan calculation, CSV and the print record.
// (The page recalculates on input; there is no Calculate button.)
// B34 (DEC-B34-TERM, revision 53; B34-INV-PAGE steps 1-15 in order, and the BA's Sequence B from COB-B34-test-boundaries.md
// section 8): the Contract term shows whole years and months; when the two rules differ a radio group "Term based on"
// (#contractTermChoice) offers "Start date to end date: {term}" (checked on a fresh page) and "Start date to final payment:
// {term}"; field, tile and print row show the picked rule; recalculation never changes the pick, only a page load does.
// Reload (step 13; main-session ruling on Q-BA-2): only "the End date radio is checked" is asserted; what Chrome restores
// in the other fields is printed as an observation.
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
// B34 (DEC-B34-TERM, revision 53): the hint (interim, Q-MSG) still names the start date (was "Calculated from the ... to the
// last scheduled payment date.").
const B32_HINT = {
  newMortgageOrLoan: 'From the disbursal date; part months count as a full month.',
  renewal: 'From the renewal date; part months count as a full month.',
  paymentChange: 'From the date of change; part months count as a full month.',
};
// B34: the radio group's state, read from the DOM (labels in document order; visible = rendered on screen).
const b34State = (page) => page.evaluate(() => {
  const g = document.getElementById('contractTermChoice');
  const radios = g ? [...g.querySelectorAll('input[type="radio"][name="contractTermBasis"]')] : [];
  const label = document.querySelector('label[for="contractTerm"]')?.textContent ?? null;
  const rows = (sel, item) => [...document.querySelectorAll(`${sel} ${item}`)].filter((r) => r.querySelector('dt')?.textContent === label).map((r) => r.querySelector('dd').textContent);
  return {
    exists: g !== null,
    visible: g !== null && !g.hidden && g.getClientRects().length > 0 && getComputedStyle(g).display !== 'none',
    legend: g?.querySelector('legend')?.textContent ?? null,
    values: radios.map((r) => r.value),
    checked: radios.filter((r) => r.checked).map((r) => r.value),
    labels: radios.map((r) => document.getElementById(`${r.id}-text`)?.textContent ?? null),
    value: document.getElementById('contractTerm')?.value ?? null,
    tile: rows('#contractTermsList', '.term'),
    printed: rows('#printInputs', '.print-input'),
    error: (() => { const e = document.getElementById('error'); return e.style.display === 'block' ? e.textContent : null; })(),
  };
});
// One step of a B34 sequence: group shown or hidden, which radio is checked, the text in field = tile = print row (null = no
// result: field empty), and the two labels when shown.
const b34Step = async (page, where, want) => {
  await page.waitForTimeout(400);
  const s = await b34State(page);
  if (!s.exists) { fail(`B34 ${where}: #contractTermChoice missing`); return s; }
  if (JSON.stringify(s.values) !== JSON.stringify(['endDate', 'lastPayment'])) fail(`B34 ${where}: radio values ${JSON.stringify(s.values)}`);
  if (s.legend !== 'Term based on') fail(`B34 ${where}: legend ${JSON.stringify(s.legend)}`);
  if (s.visible !== want.shown) fail(`B34 ${where}: group ${s.visible ? 'shown' : 'hidden'}, want ${want.shown ? 'shown' : 'hidden'}`);
  if (JSON.stringify(s.checked) !== JSON.stringify([want.checked])) fail(`B34 ${where}: checked ${JSON.stringify(s.checked)} want ${JSON.stringify([want.checked])}`);
  if (want.text === null) {
    if (s.value !== '' || s.error === null) fail(`B34 ${where}: want no result (field empty, error shown); field ${JSON.stringify(s.value)} error ${JSON.stringify(s.error)}`);
  } else {
    const nb = want.text.replace(/(\d+) (year|month)/g, '$1\u00a0$2');
    if (s.error !== null) fail(`B34 ${where}: unexpected error ${JSON.stringify(s.error)}`);
    if (s.value !== want.text) fail(`B34 ${where}: field ${JSON.stringify(s.value)} want ${JSON.stringify(want.text)}`);
    if (JSON.stringify(s.tile) !== JSON.stringify([nb])) fail(`B34 ${where}: tile ${JSON.stringify(s.tile)} want ${JSON.stringify([nb])}`);
    if (JSON.stringify(s.printed) !== JSON.stringify([want.text])) fail(`B34 ${where}: print row ${JSON.stringify(s.printed)} want ${JSON.stringify([want.text])}`);
  }
  if (want.labels && JSON.stringify(s.labels) !== JSON.stringify(want.labels)) fail(`B34 ${where}: labels ${JSON.stringify(s.labels)} want ${JSON.stringify(want.labels)}`);
  return s;
};
const L_END = (t) => `Start date to end date: ${t}`;
const L_LAST = (t) => `Start date to final payment: ${t}`;
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
  // B35 (DEC-B35-HINT, 2026-10-06): the Payment amount hint, as rendered and linked from the input, reads exactly
  // "The scheduled payment." (the sentence "It isn't calculated here." is deleted).
  {
    const b35 = await page.evaluate(() => {
      const i = document.getElementById('paymentAmount'); const h = document.getElementById(i?.getAttribute('aria-describedby') ?? '');
      return { id: h?.id ?? null, text: h ? h.textContent : null, shown: !!h && h.getClientRects().length > 0 && getComputedStyle(h).display !== 'none',
        old: /isn.t calculated here/i.test(document.body.textContent) };
    });
    if (b35.id !== 'paymentAmount-hint' || b35.text !== 'The scheduled payment.' || !b35.shown || b35.old) fail(`B35 Payment amount hint: ${JSON.stringify(b35)} want id paymentAmount-hint, text "The scheduled payment.", shown, old sentence absent`);
  }
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
  eq(await termState(), { value: '3 years' }, 'REF-01 Contract term after a calculation'); // B32 (DEC-B32-TERM): was 17 days; B34 (DEC-B34-TERM): was 2 years, 11 months, 23 days
  // Blank while the form is invalid (a failed calculation clears it), filled again once valid.
  await page.fill('#contractRatePercent', '');
  if (!(await calc())) fail('blank rate did not produce an error');
  eq(await termState(), { value: '' }, 'Contract term after a failed calculation');
  await page.fill('#contractRatePercent', '3.74');
  err = await calc(); if (err) fail('REF-01 error after refill: ' + err);
  eq(await termState(), { value: '3 years' }, 'Contract term after refilling the rate'); // B34 (DEC-B34-TERM)
  // B32 (DEC-B32-TERM): the print / tile rows are found by the label element's text (per flow), not a literal.
  const termLabelText = () => page.evaluate(() => document.querySelector('label[for="contractTerm"]')?.textContent ?? null);
  if ((await termLabelText()) !== 'Contract term') fail('B32 REF-01 (New): label ' + JSON.stringify(await termLabelText()));
  const printedTerm = await page.evaluate(() => { const l = document.querySelector('label[for="contractTerm"]')?.textContent; return [...document.querySelectorAll('#printInputs .print-input')].filter((r) => r.querySelector('dt').textContent === l).map((r) => r.querySelector('dd').textContent); });
  if (JSON.stringify(printedTerm) !== JSON.stringify(['3 years'])) fail('printed Contract term row: ' + JSON.stringify(printedTerm)); // B34 (DEC-B34-TERM)
  const tileTerm = await page.evaluate(() => { const l = document.querySelector('label[for="contractTerm"]')?.textContent; return [...document.querySelectorAll('#contractTermsList .term')].filter((t) => t.querySelector('dt').textContent === l).map((t) => t.querySelector('dd').textContent); });
  if (JSON.stringify(tileTerm) !== JSON.stringify(['3\u00a0years'])) fail('tile Contract term: ' + JSON.stringify(tileTerm)); // B34 (DEC-B34-TERM)
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
  // "Remaining contract term" = 2 years, 6 months (B34; was 2 years, 6 months, 0 days) (field, tile, print row); B34-INV-PAGE
  // step 15: the radio group stays hidden (the two rules agree).
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
    b32Shown(await b32Labels(p2, 'renewal', 'RENEWAL calculated'), '2 years, 6 months', 'RENEWAL'); // B34 (DEC-B34-TERM)
    await b34Step(p2, 'step 15 RENEWAL', { shown: false, checked: 'endDate', text: '2 years, 6 months' });
    await p2.selectOption('#flow', 'paymentChange');
    await p2.waitForTimeout(400);
    b32Shown(await b32Labels(p2, 'paymentChange', 'after Renewal -> Payment change'), '2 years, 6 months', 'Payment change (Date of change 2026-04-01)'); // B34
    await b34Step(p2, 'step 15 Payment change', { shown: false, checked: 'endDate', text: '2 years, 6 months' });
    await p2.selectOption('#flow', 'newMortgageOrLoan');
    await p2.waitForTimeout(400);
    await b32Labels(p2, 'newMortgageOrLoan', 'after Payment change -> New');
    await p2.close();
  }
  // B34-INV-PAGE steps 1-14 (revision 53), in order on one fresh page; inputs otherwise = REF-01 (the page defaults).
  const b34Observed = [];
  {
    const p3 = await ctx.newPage();
    p3.on('pageerror', (e) => fail('B34 pageerror: ' + e.message));
    p3.on('console', (m) => { if (['error', 'warning'].includes(m.type()) && !/alterna\.ca\/media|\/favicon\.ico/.test(m.location().url)) fail(`B34 console.${m.type()}: ${m.text()}`); });
    const url = PAGE_URL || base + '/ui/ca.html';
    p3.setDefaultTimeout(5000);
    await p3.goto(url); await p3.waitForLoadState('load');
    try {
    const pick = (v) => p3.check(`#contractTermBasis-${v}`);
    const A3 = [L_END('3 years, 1 month'), L_LAST('3 years')];
    // (1) fresh page and (2) REF-01 as loaded: group hidden, End date checked, "3 years" everywhere.
    await b34Step(p3, 'step 1-2 fresh page (REF-01)', { shown: false, checked: 'endDate', text: '3 years' });
    // (3) End date 2029-03-18: the rules differ; End date first and checked.
    await p3.fill('#endDate', '2029-03-18');
    await b34Step(p3, 'step 3 End 2029-03-18', { shown: true, checked: 'endDate', text: '3 years, 1 month', labels: A3 });
    // (4) click the final-payment option.
    await pick('lastPayment');
    await b34Step(p3, 'step 4 click final payment', { shown: true, checked: 'lastPayment', text: '3 years', labels: A3 });
    // (5) keyboard: focus the checked radio; ArrowUp -> End date; ArrowDown -> final payment.
    await p3.focus('#contractTermBasis-lastPayment');
    await p3.keyboard.press('ArrowUp');
    await b34Step(p3, 'step 5 ArrowUp', { shown: true, checked: 'endDate', text: '3 years, 1 month', labels: A3 });
    await p3.keyboard.press('ArrowDown');
    await b34Step(p3, 'step 5 ArrowDown', { shown: true, checked: 'lastPayment', text: '3 years', labels: A3 });
    // (6) Loan amount 230,000: the values still differ; the pick stays.
    await p3.fill('#loanAmount', '230,000.00');
    await b34Step(p3, 'step 6 loan 230,000', { shown: true, checked: 'lastPayment', text: '3 years', labels: A3 });
    // (7) End date 2029-04-18: both values follow (last row 2029-04-16).
    await p3.fill('#endDate', '2029-04-18');
    await b34Step(p3, 'step 7 End 2029-04-18', { shown: true, checked: 'lastPayment', text: '3 years, 1 month', labels: [L_END('3 years, 2 months'), L_LAST('3 years, 1 month')] });
    // (8) End date 2029-03-17: the values agree; group hidden; the final-payment radio stays checked (Q-B34-KEEP).
    await p3.fill('#endDate', '2029-03-17');
    await b34Step(p3, 'step 8 End 2029-03-17 (agree)', { shown: false, checked: 'lastPayment', text: '3 years' });
    // (9) End date 2029-03-18: the group comes back with the user's last pick.
    await p3.fill('#endDate', '2029-03-18');
    await b34Step(p3, 'step 9 End 2029-03-18 again', { shown: true, checked: 'lastPayment', text: '3 years', labels: A3 });
    // (10) Disbursal date 2026-03-10: the start moves; both "3 years, 1 month"; hidden; pick kept.
    await p3.fill('#disbursalDate', '2026-03-10');
    await b34Step(p3, 'step 10 Disbursal 2026-03-10 (agree)', { shown: false, checked: 'lastPayment', text: '3 years, 1 month' });
    // (11) Disbursal date 2026-03-17.
    await p3.fill('#disbursalDate', '2026-03-17');
    await b34Step(p3, 'step 11 Disbursal 2026-03-17', { shown: true, checked: 'lastPayment', text: '3 years', labels: A3 });
    // (12) blank the rate: no result, group hidden, pick kept; 3.74 again: shown with the pick.
    await p3.fill('#contractRatePercent', '');
    await b34Step(p3, 'step 12 rate blank (error)', { shown: false, checked: 'lastPayment', text: null });
    await p3.fill('#contractRatePercent', '3.74');
    await b34Step(p3, 'step 12 rate 3.74', { shown: true, checked: 'lastPayment', text: '3 years', labels: A3 });
    // B34-BV-82 / 83: the CSV and its file name are the same under both picks.
    const csvOf = async () => { const [d] = await Promise.all([p3.waitForEvent('download'), p3.click('#downloadCsv')]); return [d.suggestedFilename(), readFileSync(await d.path(), 'utf8')]; };
    const csvLast = await csvOf();
    await pick('endDate');
    await b34Step(p3, 'BV-82 End date picked for the CSV', { shown: true, checked: 'endDate', text: '3 years, 1 month', labels: A3 });
    const csvEnd = await csvOf();
    if (csvLast[0] !== 'cost-of-borrowing-schedule-2026-03-23.csv' || csvEnd[0] !== csvLast[0]) fail(`B34-BV-83 CSV file names ${JSON.stringify([csvLast[0], csvEnd[0]])}`);
    if (csvEnd[1] !== csvLast[1] || csvEnd[1].length < 100) fail('B34-BV-82: the CSV differs between the two picks');
    await pick('lastPayment');
    await b34Step(p3, 'back to final payment', { shown: true, checked: 'lastPayment', text: '3 years', labels: A3 });
    // (13) reload (Q-BA-2 ruling): assert only that the End date radio is checked; record what Chrome restored.
    await p3.reload(); await p3.waitForLoadState('load'); await p3.waitForTimeout(400);
    const r13 = await b34State(p3);
    if (JSON.stringify(r13.checked) !== JSON.stringify(['endDate'])) fail(`B34 step 13 reload: checked ${JSON.stringify(r13.checked)} want ["endDate"]`);
    const restored = await p3.evaluate(() => ({ endDate: document.getElementById('endDate').value, disbursalDate: document.getElementById('disbursalDate').value, loanAmount: document.getElementById('loanAmount').value, rate: document.getElementById('contractRatePercent').value }));
    b34Observed.push(`reload: group ${r13.visible ? 'shown' : 'hidden'}, field ${JSON.stringify(r13.value)}, inputs after reload ${JSON.stringify(restored)}`);
    // (14) print media: the group (inside the form) is not visible; the print row holds only the value text (B34-BV-85).
    await p3.fill('#loanAmount', '227,829.65'); await p3.fill('#disbursalDate', '2026-03-17'); await p3.fill('#endDate', '2029-03-18');
    await b34Step(p3, 'step 14 setup (screen)', { shown: true, checked: 'endDate', text: '3 years, 1 month', labels: A3 });
    await p3.emulateMedia({ media: 'print' });
    const printVis = await p3.evaluate(() => { const g = document.getElementById('contractTermChoice'); return g.getClientRects().length > 0 && getComputedStyle(g).visibility !== 'hidden'; });
    if (printVis) fail('B34 step 14: #contractTermChoice is visible in print');
    const printText = await p3.evaluate(() => document.getElementById('printInputs').textContent);
    if (/Start date to|Term based on/.test(printText)) fail('B34-BV-85: the print record names the rule: ' + printText.slice(0, 200));
    await p3.emulateMedia({ media: 'screen' });
    } catch (e) { fail('B34-INV-PAGE sequence aborted: ' + String(e.message).split('\n')[0]); }
    await p3.close();
  }
  // BA Sequence B (COB-B34-test-boundaries.md section 8): fee, frequency, payment, flow, error, back to the End date.
  {
    const p4 = await ctx.newPage();
    p4.on('pageerror', (e) => fail('B34-B pageerror: ' + e.message));
    p4.on('console', (m) => { if (['error', 'warning'].includes(m.type()) && !/alterna\.ca\/media|\/favicon\.ico/.test(m.location().url)) fail(`B34-B console.${m.type()}: ${m.text()}`); });
    p4.setDefaultTimeout(5000);
    await p4.goto(PAGE_URL || base + '/ui/ca.html'); await p4.waitForLoadState('load');
    try {
    const A3 = [L_END('3 years, 1 month'), L_LAST('3 years')];
    await p4.fill('#endDate', '2029-03-18');
    await p4.check('#contractTermBasis-lastPayment');
    await b34Step(p4, 'B start', { shown: true, checked: 'lastPayment', text: '3 years', labels: A3 });
    await p4.click('#addFee');
    await p4.locator('#feesBody tr').nth(0).locator('[data-field="name"]').fill('Admin');
    await p4.locator('#feesBody tr').nth(0).locator('[data-field="amount"]').fill('500');
    await b34Step(p4, 'B1 fee Admin 500', { shown: true, checked: 'lastPayment', text: '3 years', labels: A3 });
    await p4.selectOption('#paymentFrequency', 'monthly');
    await b34Step(p4, 'B2 Monthly', { shown: true, checked: 'lastPayment', text: '3 years', labels: A3 });
    await p4.selectOption('#paymentFrequency', 'biweekly');
    await b34Step(p4, 'B3 Bi-weekly', { shown: true, checked: 'lastPayment', text: '3 years', labels: A3 });
    await p4.selectOption('#paymentFrequency', 'semiMonthly');
    await b34Step(p4, 'B4 Semi-monthly', { shown: true, checked: 'lastPayment', text: '3 years', labels: A3 });
    await p4.selectOption('#paymentFrequency', 'weekly');
    await p4.fill('#paymentAmount', '5,000.00');
    await b34Step(p4, 'B5 Weekly, payment 5,000 (payoff)', { shown: true, checked: 'lastPayment', text: '11 months', labels: [L_END('3 years, 1 month'), L_LAST('11 months')] });
    await p4.fill('#paymentAmount', '465.46');
    await b34Step(p4, 'B6 payment 465.46', { shown: true, checked: 'lastPayment', text: '3 years', labels: A3 });
    await p4.selectOption('#flow', 'renewal');
    await b34Step(p4, 'B7 Renewal, accrued blank (error)', { shown: false, checked: 'lastPayment', text: null });
    await p4.fill('#accruedInterest', '0');
    await b34Step(p4, 'B8 accrued 0 (Renewal date 2026-01-01; agree)', { shown: false, checked: 'lastPayment', text: '3 years, 3 months' });
    await p4.selectOption('#flow', 'paymentChange');
    await b34Step(p4, 'B9 Payment change (agree)', { shown: false, checked: 'lastPayment', text: '3 years, 3 months' });
    await p4.fill('#renewalDate', '2026-03-17');
    await b34Step(p4, 'B10 Date of change 2026-03-17', { shown: true, checked: 'lastPayment', text: '3 years', labels: A3 });
    await p4.selectOption('#flow', 'newMortgageOrLoan');
    await b34Step(p4, 'B11 New (Disbursal 2026-03-17)', { shown: true, checked: 'lastPayment', text: '3 years', labels: A3 });
    await p4.check('#contractTermBasis-endDate');
    await b34Step(p4, 'B12 click End date', { shown: true, checked: 'endDate', text: '3 years, 1 month', labels: A3 });
    await p4.fill('#endDate', '');
    await b34Step(p4, 'B13 End date cleared (error)', { shown: false, checked: 'endDate', text: null });
    await p4.fill('#endDate', '2029-03-18');
    await b34Step(p4, 'B14 End 2029-03-18', { shown: true, checked: 'endDate', text: '3 years, 1 month', labels: A3 });
    await p4.check('#contractTermBasis-lastPayment');
    await b34Step(p4, 'B15 click final payment', { shown: true, checked: 'lastPayment', text: '3 years', labels: A3 });
    await p4.reload(); await p4.waitForLoadState('load'); await p4.waitForTimeout(400);
    const r15 = await b34State(p4);
    if (JSON.stringify(r15.checked) !== JSON.stringify(['endDate'])) fail(`B34 B15 reload: checked ${JSON.stringify(r15.checked)} want ["endDate"]`);
    b34Observed.push(`B15 reload: group ${r15.visible ? 'shown' : 'hidden'}, field ${JSON.stringify(r15.value)}`);
    // B34-BV-65 (Q-B34-ZERO): same-day start; the final-payment rule reads "0 months".
    await p4.goto(PAGE_URL || base + '/ui/ca.html'); await p4.waitForLoadState('load');
    await p4.selectOption('#paymentFrequency', 'monthly');
    for (const [k, v] of Object.entries({ loanAmount: '200,000.00', contractRatePercent: '5', paymentAmount: '1,200.00', disbursalDate: '2027-01-01', firstPaymentDate: '2027-01-01', endDate: '2027-01-02' })) await p4.fill('#' + k, v);
    await b34Step(p4, 'BV-65 same-day start', { shown: true, checked: 'endDate', text: '1 month', labels: [L_END('1 month'), L_LAST('0 months')] });
    await p4.check('#contractTermBasis-lastPayment');
    await b34Step(p4, 'BV-65 final payment picked', { shown: true, checked: 'lastPayment', text: '0 months', labels: [L_END('1 month'), L_LAST('0 months')] });
    } catch (e) { fail('B34 sequence B aborted: ' + String(e.message).split('\n')[0]); }
    await p4.close();
  }
  // B37 addendum (Q-B37-LABEL; DEC-B37-LEAP-N label format: whole numbers, user 2026-10-09): every Payment frequency option
  // text is frequencyOptionText(value, paymentsPerYearFor(input, value)) = "<label> (<Math.round(n)>/yr)". The leap-aware n
  // lies in 52.14..52.29 / 26.07..26.14, so the visible texts stay "(52/yr)" / "(26/yr)" in every state; the steps check the
  // texts survive every refresh (dates cleared, an error showing, variable rate, personal loan), the value is never
  // touched, the accessible name stays, the printout shows no "/yr", and V-CASE1 shows the shipped (leap-aware) total.
  {
    const p5 = await ctx.newPage();
    p5.on('pageerror', (e) => fail('B37 pageerror: ' + e.message));
    p5.on('console', (m) => { if (['error', 'warning'].includes(m.type()) && !/alterna\.ca\/media|\/favicon\.ico/.test(m.location().url)) fail(`B37 console.${m.type()}: ${m.text()}`); });
    p5.setDefaultTimeout(5000);
    await p5.goto(PAGE_URL || base + '/ui/ca.html'); await p5.waitForLoadState('load');
    const B37_TEXTS = ['Weekly (52/yr)', 'Bi-weekly (26/yr)', 'Semi-monthly (24/yr)', 'Monthly (12/yr)'];
    const freq = () => p5.evaluate(() => {
      const s = document.getElementById('paymentFrequency'); const e = document.getElementById('error');
      return { texts: [...s.querySelectorAll('option')].map((o) => o.textContent), value: s.value, name: s.labels[0]?.textContent ?? null,
        error: e.style.display === 'block' };
    });
    const b37Step = async (where, want) => {
      await p5.waitForTimeout(400);
      const s = await freq();
      if (JSON.stringify(s.texts) !== JSON.stringify(B37_TEXTS)) fail(`B37 ${where}: option texts ${JSON.stringify(s.texts)}`);
      if (s.value !== want.value) fail(`B37 ${where}: value ${s.value} want ${want.value}`);
      if (s.name !== 'Payment frequency') fail(`B37 ${where}: accessible name ${JSON.stringify(s.name)}`);
      if (want.error !== undefined && s.error !== want.error) fail(`B37 ${where}: error box ${s.error ? 'shown' : 'hidden'}, want ${want.error ? 'shown' : 'hidden'}`);
    };
    try {
      await b37Step('(a) on load', { value: 'weekly' });
      await p5.selectOption('#paymentFrequency', 'biweekly');
      await b37Step('(b) Bi-weekly selected', { value: 'biweekly' });
      for (const [k, v] of Object.entries({ loanAmount: '227829.65', contractRatePercent: '3.74', paymentAmount: '930.92', disbursalDate: '2026-03-17', firstPaymentDate: '2026-03-23', endDate: '2029-03-17' })) await p5.fill('#' + k, v);
      await b37Step('(b2) REF-01 dates, Bi-weekly', { value: 'biweekly', error: false });
      await p5.fill('#endDate', '');
      await b37Step('(c) End date cleared', { value: 'biweekly', error: true });
      await p5.fill('#paymentAmount', '');
      for (const [k, v] of Object.entries({ disbursalDate: '2028-01-10', firstPaymentDate: '2028-01-24', endDate: '2028-12-18' })) await p5.fill('#' + k, v);
      await b37Step('(d) 2028 span, Payment amount blank', { value: 'biweekly', error: true });
      await p5.selectOption('#rateType', 'variable');
      await b37Step('(e) Rate type Variable', { value: 'biweekly' });
      await p5.selectOption('#productType', 'personalLoan');
      await b37Step('(e) Personal loan', { value: 'biweekly' });
      // (h) V-CASE1 (the user's case 1): Payment change, fixed mortgage, Bi-weekly -> Total interest $60,137.62 (leap-aware n).
      await p5.selectOption('#productType', 'mortgage');
      await p5.selectOption('#rateType', 'fixed');
      await p5.selectOption('#flow', 'paymentChange');
      for (const [k, v] of Object.entries({ loanAmount: '495466.87', contractRatePercent: '4.34', paymentAmount: '1350.64', accruedInterest: '58.33', renewalDate: '2026-10-08', firstPaymentDate: '2026-10-21', endDate: '2029-09-23' })) await p5.fill('#' + k, v);
      await b37Step('(h) V-CASE1', { value: 'biweekly', error: false });
      const ti = await p5.evaluate(() => [...document.querySelectorAll('#mainFigures .figure')].filter((f) => f.querySelector('dt').firstChild.textContent === 'Total interest').map((f) => f.querySelector('dd').textContent));
      if (JSON.stringify(ti) !== JSON.stringify(['$60,137.62'])) fail(`B37 (h) V-CASE1 Total interest ${JSON.stringify(ti)} want ["$60,137.62"] (DEC-B37-LEAP-N)`);
      // (g) the printout carries no option text
      await p5.emulateMedia({ media: 'print' });
      const printed = await p5.evaluate(() => document.body.innerText);
      if (printed.includes('/yr')) fail('B37 (g) print media: "/yr" appears in the printed page');
      await p5.emulateMedia({ media: 'screen' });
    } catch (e) { fail('B37 sequence aborted: ' + String(e.message).split('\n')[0]); }
    await p5.close();
  }
  for (const o of b34Observed) console.log('B34 observed: ' + o);
} finally { await browser.close(); child?.kill(); }
if (problems.length) { console.log('SMOKE FAIL\n' + problems.join('\n')); process.exit(1); }
console.log('SMOKE PASS: no pageerror/console error; B33 no frequency lock (enabled, value kept, no hint), 4 options, REF-01, Contract term (filled, cleared, printed, tile), B31 screen lists and hint counts, personal loan calc, CSV, print, renewal, B32 term label/hint per flow and RENEWAL term, B34 term choice (INV-PAGE 1-15, BA sequence B, CSV under both picks, zero term), B37 frequency labels (whole numbers, every refresh, accessible name, no /yr in print) and V-CASE1 total interest');
