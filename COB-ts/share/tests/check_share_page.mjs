// F20 Chrome layer (B30-INV-CHROME), QA 2026-10-01. Not a vitest file (needs Chrome); like check_page_smoke.mjs.
//
//   node share/tests/check_share_page.mjs [path/to/COB.html]
//
// Without an argument it builds the real tree into a temp folder (fixed date 2026-10-01) with
// `node share/build-share.mjs --out <tmp>/COB.html --date 2026-10-01` and opens that over file:// (no server).
// With an argument it checks that file (e.g. the delivered COB-ts/COB.html). Uses the globally installed
// @playwright/mcp (playwright-core) and Google Chrome, like the other Chrome scripts; no project dependency.
//
// Checks: zero pageerror / console messages; the request log holds only file: and data: URLs; the CSP is live (an injected
// inline script is blocked, exactly one violation); no link to anywhere, no Help link; the logo decodes (naturalWidth > 0);
// the REF-01 scenario calculates and its printout figures, "Engine" line and CSV (all-columns mode, under the CSP)
// equal tests/ca/fixtures/a10_ui_capture_v1.json; the footer is visible on screen and hidden in print; no horizontal
// overflow and no clipped headline number at 360, 768 and 1280 px (screenshots in the temp folder, paths printed).
// Then the five existing Chrome scripts run against the same file through COB_PAGE_URL: the capture (output equals
// the fixture minus provenance), the smoke check, F12 print width, the semi-monthly move check and the render-cost check.
import { createRequire } from 'node:module';
import { execSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const req = createRequire(execSync('npm root -g').toString().trim() + '/@playwright/mcp/');
const { chromium } = req('playwright-core');
const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const problems = [];
const fail = (m) => problems.push(m);
let checks = 0;
const yes = (c, w) => { checks++; if (!c) fail(w); };
const same = (got, want, w) => { checks++; if (JSON.stringify(got) !== JSON.stringify(want)) fail(`${w}: got ${JSON.stringify(got)?.slice(0, 200)} want ${JSON.stringify(want)?.slice(0, 200)}`); };

const work = mkdtempSync(join(tmpdir(), 'b30-chrome-'));
let file = process.argv[2];
if (!file) {
  file = join(work, 'COB.html');
  const b = spawnSync(process.execPath, ['share/build-share.mjs', '--out', file, '--date', '2026-10-01'], { cwd: ROOT, encoding: 'utf8' });
  if (b.status !== 0) { console.error('build failed:\n' + b.stderr); process.exit(1); }
}
if (!existsSync(file)) { console.error('no such file: ' + file); process.exit(1); }
const URL_ = pathToFileURL(file).href;
const FIX = JSON.parse(readFileSync(join(ROOT, 'tests/ca/fixtures/a10_ui_capture_v1.json'), 'utf8'));
const REF = FIX.scenarios.find((s) => s.id === 'REF-01');

const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const ctx = await browser.newContext({ acceptDownloads: true, locale: 'en-CA', timezoneId: 'America/Toronto', viewport: { width: 1280, height: 900 } });
  await ctx.addInitScript(() => {
    window.__csp = [];
    document.addEventListener('securitypolicyviolation', (e) => window.__csp.push(e.violatedDirective));
  });
  const page = await ctx.newPage();
  const requests = [];
  page.on('request', (r) => requests.push(r.url()));
  page.on('pageerror', (e) => fail('pageerror: ' + e.message));
  page.on('console', (m) => fail(`console.${m.type()}: ${m.text()} @${m.location().url}`));
  page.on('requestfailed', (r) => fail('requestfailed: ' + r.url()));
  await page.goto(URL_);
  await page.waitForLoadState('load');
  await page.waitForTimeout(300);

  // ---- static facts of the loaded page
  const facts = await page.evaluate(() => ({
    hrefs: [...document.querySelectorAll('[href]')].map((a) => a.getAttribute('href')),
    srcs: [...document.querySelectorAll('[src]')].map((a) => a.getAttribute('src').slice(0, 30)),
    help: document.querySelectorAll('.help' + '-link, a[href*="help"]').length,
    logo: (() => { const i = document.getElementById('brandLogo'); return { w: i.naturalWidth, hidden: i.hidden }; })(),
    fallbackHidden: document.querySelector('.brand-fallback').hidden,
    footer: (() => { const f = document.getElementById('shareFooter'); if (!f) return null; const r = f.getBoundingClientRect(); return { text: f.textContent.trim(), visible: r.width > 0 && r.height > 0 && getComputedStyle(f).display !== 'none' }; })(),
    termInputs: document.querySelectorAll('#termYears, #termMonths').length,
    scripts: document.scripts.length,
  }));
  same(facts.hrefs.filter((h) => !h.startsWith('#')), [], 'links to anywhere (the page has no web address)');
  same(facts.srcs.filter((s) => !s.startsWith('data:')), [], 'non-data: src');
  same(facts.help, 0, 'Help links');
  yes(facts.logo.w > 0 && !facts.logo.hidden && facts.fallbackHidden, `logo did not decode (naturalWidth ${facts.logo.w}, fallback shown)`);
  yes(facts.footer && facts.footer.visible, 'footer is not visible on screen');
  yes(facts.footer && /^COB Calculator v\d+\.\d+\.\d+ · built \d{4}-\d{2}-\d{2} · single-file edition, works offline$/.test(facts.footer.text), `footer text ${facts.footer?.text}`);
  same(facts.termInputs, 0, 'Term inputs present');
  same(facts.scripts, 1, 'script elements');

  // ---- REF-01 calculates; figures, printed engine line and CSV equal the capture fixture
  const sc = REF;
  const order = (id) => (id === 'flow' ? 0 : id === 'paymentFrequency' ? 1 : 2);
  const selects = { flow: 'newMortgageOrLoan', productType: 'mortgage', rateType: 'fixed', paymentFrequency: 'weekly' };
  for (const [id, v] of Object.entries(selects).sort(([a], [b]) => order(a) - order(b))) await page.selectOption('#' + id, v);
  const fields = { loanAmount: '227829.65', contractRatePercent: '3.74', paymentAmount: '465.46', disbursalDate: '2026-03-17', firstPaymentDate: '2026-03-23', endDate: '2029-03-17' };
  for (const [id, v] of Object.entries(fields)) await page.fill('#' + id, v);
  same(await page.locator('#contractTerm').inputValue(), '3 years', 'Contract term'); // B32 (DEC-B32-TERM): from the Disbursal date (was 17 days); B34 (DEC-B34-TERM): whole years and months, End date rule (was 2 years, 11 months, 23 days)
  await page.check('#scheduleColumns-all', { timeout: 5000 });
  await page.evaluate(() => window.dispatchEvent(new Event('beforeprint')));
  const figures = await page.evaluate(() => [...document.querySelectorAll('#printFigures .figure')].map((f) => {
    const dt = f.querySelector('dt'); const hint = dt.querySelector('.figure-hint');
    return hint ? [dt.firstChild.textContent, f.querySelector('dd').textContent, hint.textContent] : [dt.firstChild.textContent, f.querySelector('dd').textContent];
  }));
  same(figures, sc.modes.all.figures, 'REF-01 printout figures');
  yes(figures.length > 0, 'no figures calculated');
  const printed = await page.evaluate(() => document.getElementById('printedLine').textContent);
  const ver = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version;
  yes(printed.includes(` · Engine ${ver}`), `printed line lacks the engine version: ${JSON.stringify(printed)}`);
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#downloadCsv')]);
  same(dl.suggestedFilename(), sc.modes.all.csvFileName, 'CSV file name');
  same(readFileSync(await dl.path()).toString('base64') === sc.modes.all.csvBase64, true, 'CSV content equals the fixture (download under the CSP)');

  // ---- print: footer hidden, record shown
  await page.emulateMedia({ media: 'print' });
  same(await page.evaluate(() => getComputedStyle(document.getElementById('shareFooter')).display), 'none', 'footer display in print');
  yes(await page.evaluate(() => getComputedStyle(document.getElementById('printRecord')).display !== 'none'), 'print record is hidden in print');
  const pdf = await page.pdf({ format: 'Letter' });
  yes(pdf.length > 1000, 'page.pdf() produced nothing');
  await page.emulateMedia({ media: 'screen' });

  // ---- layout at three widths (B30-R8): no horizontal scroll, no clipped headline number
  for (const w of [360, 768, 1280]) {
    await page.setViewportSize({ width: w, height: 900 });
    const m = await page.evaluate(() => ({
      over: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      clipped: [...document.querySelectorAll('.kpi-value')].filter((e) => e.scrollWidth > e.clientWidth + 1).length,
      kpis: document.querySelectorAll('.kpi-value').length,
    }));
    yes(m.over <= 0, `${w}px: horizontal overflow ${m.over}px`);
    same(m.clipped, 0, `${w}px: clipped headline numbers`);
    yes(m.kpis > 0, `${w}px: no .kpi-value found (selector is stale)`);
    await page.screenshot({ path: join(work, `cob-${w}.png`), fullPage: true });
  }

  // ---- the CSP is live: an injected inline script is refused and reported (the one expected violation)
  const before = await page.evaluate(() => window.__csp.length);
  same(before, 0, 'CSP violations during normal use');
  const ran = await page.evaluate(async () => {
    const s = document.createElement('script'); s.textContent = 'window.__injected = 1'; document.body.appendChild(s);
    await new Promise((r) => setTimeout(r, 100));
    return { injected: window.__injected === 1, csp: window.__csp.length };
  });
  yes(!ran.injected && ran.csp === 1, `CSP is not enforced: ${JSON.stringify(ran)}`);
  problems.splice(0, problems.length, ...problems.filter((p) => !/Content Security Policy|Refused to execute inline script/i.test(p)));

  same(requests.filter((u) => !/^(file|data):/.test(u)), [], 'network requests');
  yes(requests.some((u) => u.startsWith('file:')), 'the file: document was not requested?');
  await page.close();
} catch (e) {
  fail('the page check stopped: ' + String(e.message).split('\n')[0]); // a dead page (script error) ends here, with the page errors above
} finally {
  await browser.close();
}

// ---- the five existing scripts against the same page
const run = (script, args = [], okTail = true) => {
  const r = spawnSync(process.execPath, [script, ...args], { cwd: ROOT, env: { ...process.env, COB_PAGE_URL: URL_ }, encoding: 'utf8', timeout: 900000 });
  checks++;
  if (r.status !== 0) fail(`${script} exited ${r.status}: ${(r.stdout + r.stderr).slice(-600)}`);
  return r;
};
const outJson = join(work, 'capture.json');
run('tests/ca/fixtures/capture_a10_ui.mjs', [outJson]);
if (existsSync(outJson)) {
  const got = JSON.parse(readFileSync(outJson, 'utf8')); delete got.provenance;
  const want = { ...FIX }; delete want.provenance;
  // FINDING (QA, B30): the scaled number fields store the MEASURED width of the live font (style="--term-em: 2.4001875;"), so
  // the system font stack legitimately gives other values than the fixture (Inter). Everything else must be identical, so
  // the one tolerated difference is the numeric value of the --*-em custom properties (masked on both sides, and each must
  // still be a positive number). The fixture itself stays unchanged.
  const EM = /(--[a-z]+-em:\s*)([\d.]+)(;)/g;
  const mask = (o) => JSON.stringify(o).replace(EM, '$1N$3');
  const ems = (JSON.stringify(got).match(EM) ?? []);
  yes(ems.length === (JSON.stringify(want).match(EM) ?? []).length && ems.length > 0, 'the number of --*-em values differs from the fixture');
  yes(ems.every((e) => parseFloat(e.split(':')[1]) > 0), 'a --*-em value is not a positive number');
  yes(mask(got) === mask(want), 'capture output differs from a10_ui_capture_v1.json (minus provenance, --*-em values masked)');
}
run('tests/ui/check_page_smoke.mjs');
run('tests/ui/check_print_width.mjs');
run('tests/ui/check_semimonthly_move.mjs');
run('tests/ui/check_render_cost.mjs');

console.log(`B30 F20 Chrome check on ${URL_}\nscreenshots and capture in ${work}\n${checks} checks`);
if (problems.length) { console.log('FAIL\n- ' + problems.join('\n- ')); process.exit(1); }
console.log('PASS');
