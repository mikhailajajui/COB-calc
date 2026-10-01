// F18 (A11, scope B, QA): in real Chrome, the print schedule table is built ON DEMAND (when printing), not on every keystroke,
// and holds exactly the content it held before A11. Vitest cannot load ui/ca.js, so this loads the real page. Not part of vitest.
// User decisions 2026-10-01: Q-A11-SCOPE = B only (no pause / debounce: the screen table still rebuilds on every keystroke),
// Q-A11-FIX = no (tests/ca/fixtures/a10_ui_capture_v1.json is not changed; this script READS it as the reference for "same content").
// Checks: INV-LAZY (typing never touches #printScheduleTable), INV-SCREEN (typing still rebuilds #scheduleTable at once),
// INV-FIGURES (the print record, figures included, is still immediate), INV-SAME (after beforeprint, after the print-media
// change, and after window.print(), the print table and count line equal the capture fixture, both column modes),
// INV-CACHE (a second print event with nothing changed does not rebuild; a changed value or column mode does),
// INV-NORESULT (a print event with no valid result throws nothing and builds nothing), INV-PARITY (weekly 30 years: print rows
// = screen rows). Timing for weekly 30 years is LOGGED (handler time, keystroke to paint), never asserted tightly.
// usage (from COB-ts/, after `npm run build`):  node tests/ui/check_render_cost.mjs [baseUrl]
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
let checks = 0;
const same = (got, want, where) => { checks++; if (got !== want) fail(`${where}: got ${JSON.stringify(String(got).slice(0, 160))} want ${JSON.stringify(String(want).slice(0, 160))}`); };
const yes = (cond, where) => { checks++; if (!cond) fail(where); };

const FIX = JSON.parse(readFileSync(ROOT + 'tests/ca/fixtures/a10_ui_capture_v1.json', 'utf8'));
const REF = FIX.scenarios.find((s) => s.id === 'REF-01');
const REF_FIELDS = { loanAmount: '227829.65', contractRatePercent: '3.74', paymentAmount: '465.46', disbursalDate: '2026-03-17', firstPaymentDate: '2026-03-23', endDate: '2029-03-17' };
const LONG_FIELDS = { loanAmount: '400000', contractRatePercent: '5', paymentAmount: '100', disbursalDate: '2026-01-01', firstPaymentDate: '2026-01-08', endDate: '2056-01-01' };
const median = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];

const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const ctx = await browser.newContext({ acceptDownloads: true, locale: 'en-CA', timezoneId: 'America/Toronto', viewport: { width: 1280, height: 900 } });
  async function open(fields) {
    const page = await ctx.newPage();
    page.on('pageerror', (e) => fail('pageerror: ' + e.message));
    page.on('console', (m) => { if (['error', 'warning'].includes(m.type()) && !/alterna\.ca\/media|\/favicon\.ico/.test(m.location().url)) fail(`console.${m.type()}: ${m.text()}`); });
    await page.goto(base + '/ui/ca.html'); await page.waitForLoadState('load');
    await page.selectOption('#flow', 'newMortgageOrLoan');
    await page.selectOption('#paymentFrequency', 'weekly');
    for (const [k, v] of Object.entries(fields)) await page.fill('#' + k, v);
    return page;
  }
  const printState = (page) => page.evaluate(() => ({ table: document.getElementById('printScheduleTable').innerHTML, count: document.getElementById('printScheduleCount').innerHTML, kids: document.getElementById('printScheduleTable').childNodes.length }));
  const screenState = (page) => page.evaluate(() => ({ table: document.getElementById('scheduleTable').innerHTML, count: document.getElementById('scheduleCount').innerHTML }));
  const watch = (page) => page.evaluate(() => {
    window.__mut = { print: 0, screen: 0 };
    const obs = (id, key) => new MutationObserver((l) => { window.__mut[key] += l.filter((m) => m.type === 'childList').length; }).observe(document.getElementById(id), { childList: true });
    obs('printScheduleTable', 'print'); obs('scheduleTable', 'screen');
  });
  const muts = async (page) => { await page.evaluate(() => new Promise((r) => setTimeout(r, 0))); return page.evaluate(() => ({ ...window.__mut })); };
  const beforeprint = (page) => page.evaluate(() => window.dispatchEvent(new Event('beforeprint')));
  const err = (page) => page.evaluate(() => { const e = document.getElementById('error'); return e.style.display === 'block' ? e.textContent : null; });

  // ---- S1: typing never builds the print table; the screen table and the print record stay immediate ----
  {
    const page = await open({ ...REF_FIELDS, loanAmount: '1' });
    await watch(page);
    await page.click('#loanAmount'); await page.keyboard.press('Control+A');
    const before = await muts(page);
    for (const ch of '227829') await page.keyboard.type(ch);   // six keystrokes
    await page.fill('#loanAmount', '227829.65');
    same(await err(page), null, 'S1 no error');
    const after = await muts(page);
    same(after.print - before.print, 0, 'S1 INV-LAZY: #printScheduleTable not touched by typing');
    yes(after.screen - before.screen >= 7, `S1 INV-SCREEN: the screen table rebuilt on every keystroke (${after.screen - before.screen} childList mutations, expected >= 7)`);
    const ps = await printState(page);
    same(ps.kids, 0, 'S1 INV-LAZY: no child nodes in #printScheduleTable before any print event');
    same(ps.count, '', 'S1 INV-LAZY: #printScheduleCount empty before any print event');
    const figs = await page.evaluate(() => document.getElementById('printFigures').textContent.length);
    yes(figs > 50, 'S1 INV-FIGURES: the printed figures are filled without a print event');
    const inputs = await page.evaluate(() => document.getElementById('printInputs').textContent.includes('227,829.65'));
    yes(inputs, 'S1 INV-FIGURES: the printed inputs show the typed amount without a print event');
    same((await screenState(page)).table, REF.modes.all.html.scheduleTable, 'S1 screen table equals the capture');

    // ---- S2: beforeprint builds the table; it equals the capture ----
    await beforeprint(page);
    let p2 = await printState(page);
    same(p2.table, REF.modes.all.html.printScheduleTable, 'S2 INV-SAME: print table after beforeprint (all columns)');
    same(p2.count, REF.modes.all.html.printScheduleCount, 'S2 INV-SAME: print count line after beforeprint');
    same((await muts(page)).print > 0, true, 'S2 the table was built by the print event');

    // ---- S3: cache. A second print event with nothing changed does not rebuild ----
    const m3 = (await muts(page)).print;
    await beforeprint(page);
    same((await muts(page)).print, m3, 'S3 INV-CACHE: a second beforeprint with nothing changed does not rebuild');

    // ---- S4: a changed value is picked up at the next print event, and equals a fresh page with that value ----
    await page.fill('#loanAmount', '300000');
    same((await printState(page)).table, p2.table, 'S4 the print table is not rebuilt by the keystroke (still the earlier build)');
    await beforeprint(page);
    const p4 = await printState(page);
    yes(p4.table !== p2.table, 'S4 INV-CACHE: a changed result is rebuilt at the next print event');
    const fresh = await open({ ...REF_FIELDS, loanAmount: '300000' });
    await beforeprint(fresh);
    same(p4.table, (await printState(fresh)).table, 'S4 the rebuilt table equals a fresh page typed with the same value');
    await fresh.close();
    await page.fill('#loanAmount', '227829.65');

    // ---- S5: column mode. Switching on screen, then printing, gives that mode's print table (both modes equal the capture) ----
    await page.check('#scheduleColumns-compact');
    await beforeprint(page);
    same((await printState(page)).table, REF.modes.compact.html.printScheduleTable, 'S5 INV-SAME: compact columns after the radio and beforeprint');
    same((await printState(page)).count, REF.modes.compact.html.printScheduleCount, 'S5 INV-SAME: compact count line');
    same((await screenState(page)).table, REF.modes.compact.html.scheduleTable, 'S5 screen table compact equals the capture (rebuilt at once)');
    await page.check('#scheduleColumns-all');
    await beforeprint(page);
    same((await printState(page)).table, REF.modes.all.html.printScheduleTable, 'S5 INV-SAME: back to all columns');
    await page.close();
  }

  // ---- S6: the print-media change (what Playwright emulateMedia and a real print do) also builds it ----
  {
    const page = await open(REF_FIELDS);
    same((await printState(page)).kids, 0, 'S6 empty before printing');
    await page.emulateMedia({ media: 'print' });
    await page.waitForFunction(() => document.getElementById('printScheduleTable').childNodes.length > 0, null, { timeout: 3000 }).catch(() => {});
    const p = await printState(page);
    same(p.table, REF.modes.all.html.printScheduleTable, 'S6 INV-SAME: print table after the print-media change');
    same(p.count, REF.modes.all.html.printScheduleCount, 'S6 INV-SAME: count line after the print-media change');
    await page.emulateMedia({ media: 'screen' });
    await page.close();
  }

  // ---- S7: the Print button's window.print() path. Headless Chrome may not fire beforeprint for window.print(); if it does not, ----
  // ---- the path is reported as not exercised (not a failure), because S2 and S6 already cover the two triggers.             ----
  {
    const page = await open(REF_FIELDS);
    await page.evaluate(() => { window.__bp = 0; window.addEventListener('beforeprint', () => { window.__bp += 1; }); });
    const btn = await page.getAttribute('#printSchedule', 'aria-disabled').catch(() => 'missing');
    if (btn === 'missing') { console.log('S7 note: no #printSchedule button found, window.print() path skipped'); }
    else {
      await page.evaluate(() => { window.print(); });
      await page.waitForTimeout(500);
      const fired = await page.evaluate(() => window.__bp);
      if (fired > 0) {
        same((await printState(page)).table, REF.modes.all.html.printScheduleTable, 'S7 INV-SAME: print table after window.print()');
      } else {
        console.log('S7 note: headless Chrome did not fire beforeprint for window.print(); that path is not exercised here (S2 and S6 cover the triggers)');
      }
    }
    await page.close();
  }

  // ---- S8: a print event with no valid result: nothing thrown (pageerror is a failure), nothing built ----
  {
    const page = await open({ ...REF_FIELDS, contractRatePercent: '' });
    yes(typeof (await err(page)) === 'string', 'S8 blank rate gives an error');
    await beforeprint(page);
    await page.emulateMedia({ media: 'print' }); await page.waitForTimeout(200); await page.emulateMedia({ media: 'screen' });
    same((await printState(page)).kids, 0, 'S8 INV-NORESULT: nothing built without a valid result');
    await page.close();
  }

  // ---- S9: weekly 30 years: parity of rows, and timing (logged) ----
  {
    const page = await open(LONG_FIELDS);
    same(await err(page), null, 'S9 no error');
    await beforeprint(page);
    const rows = await page.evaluate(() => ({ screen: document.querySelectorAll('#scheduleTable tbody tr').length, print: document.querySelectorAll('#printScheduleTable tbody tr').length }));
    yes(rows.screen > 1500, `S9 the long scenario is long (${rows.screen} screen rows)`);
    same(rows.print, rows.screen, 'S9 INV-PARITY: print rows equal screen rows after printing');
    // timing: handler (sync) and keystroke to second animation frame, median of 7 after 2 warm-ups
    const t = await page.evaluate(async () => {
      const el = document.getElementById('loanAmount');
      const run = async (v) => {
        el.value = v;
        const t0 = performance.now();
        el.dispatchEvent(new Event('input', { bubbles: true }));
        const handler = performance.now() - t0;
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        return [handler, performance.now() - t0];
      };
      const out = [];
      for (let i = 0; i < 9; i++) out.push(await run(String(400000 + i)));
      return out.slice(2);
    });
    console.log(`TIMING weekly 30y (${rows.screen} rows), median of 7: handler ${median(t.map((x) => x[0])).toFixed(0)} ms, keystroke to paint ${median(t.map((x) => x[1])).toFixed(0)} ms (logged, not asserted; pre-A11 baseline measured 162 / 383 ms)`);
    // the print table is untouched by that typing
    same((await page.evaluate(() => document.getElementById('printScheduleTable').childNodes.length)) > 0, true, 'S9 the earlier print build is still there (no clearing on typing)');
    await page.close();
  }
} catch (e) { fail('script error (a missing element or timeout is a failed check): ' + String(e.message).split('\n')[0]); }
finally { await browser.close(); child?.kill(); }
if (problems.length) { console.log('F18 FAIL\n' + problems.join('\n')); process.exit(1); }
console.log(`F18 PASS: ${checks} checks; print table built on demand (beforeprint and print-media change), not on keystrokes; identical to the A10 capture in both column modes; cached; screen table and print record still immediate; no console errors`);
