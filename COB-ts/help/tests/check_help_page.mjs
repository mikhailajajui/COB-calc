// F14 (COB-architecture.md section 6, B29): the Help page works in Chrome. A Chrome page check, NOT a vitest test
// (vitest has no layout engine; Chrome and the global @playwright/mcp are not project dependencies: the F12 and A10
// capture precedent). QA-owned. Disappears with the help/ folder. Exit code 1 on any failure.
//
// usage (from COB-ts/, after `npm run build`):  node help/tests/check_help_page.mjs [baseUrl]
// Without baseUrl it starts `node ui/serve.mjs` on a free port and stops it afterwards.
//
// The Chrome-only share of the 31 acceptance checks of visual_design/help-page-design.md section 19 (numbers in
// brackets), at 360 / 768 / 992 / 1280 px, light and dark where the design says so, JavaScript on and off, print,
// computed contrast and sizes, Go to ID, copy link, reflow at 200 % zoom (640 css px) and 320 css px.
// Not here: checks 5 and 16 (capture fixture: F15 --chrome and the QA verify step; dangling IDs: vitest), 9, 28
// (vitest). Revision 38 (QA 2026-09-30): six status states incl. out (17, 18), table before the first H2 named by the H1 (R7),
// 41-character first column is a td and not sticky (R7), no unmatched Status value (R6), no UIG-1..3 string in the page (R13).
// The Help smoke part (B29-X7, B29-INV-NOPROBE, B29-INV-REVERT) is at the top. `check_page_smoke.mjs` is not edited.
import { createRequire } from 'node:module';
import { execSync, spawn } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const req = createRequire(execSync('npm root -g').toString().trim() + '/@playwright/mcp/');
const { chromium } = req('playwright-core');
const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const LOGO = 'https://www.alterna.ca/media/t0onoi0m/alterna-savings.svg';
const LOGO_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="236" height="37"><rect width="236" height="37" fill="#bd5a00"/></svg>';
const WIDTHS = [360, 768, 992, 1280];

async function freePort() {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
  });
}
async function startServer(root = ROOT) {
  const port = await freePort();
  const child = spawn(process.execPath, [join(root, 'ui', 'serve.mjs')], { cwd: root, env: { ...process.env, PORT: String(port) }, stdio: ['ignore', 'pipe', 'inherit'] });
  await new Promise((resolve, reject) => {
    child.once('exit', (code) => reject(new Error(`ui/serve.mjs exited with ${code}`)));
    child.stdout.on('data', (d) => { if (String(d).includes(`:${port}`)) resolve(); });
  });
  return { base: `http://localhost:${port}`, stop: () => child.kill() };
}

let failures = 0;
let total = 0;
const say = (id, name, ok, detail = '') => {
  total++;
  if (!ok) failures++;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  [${id}] ${name}${ok || !detail ? '' : `  ${String(detail).slice(0, 400)}`}`);
};

const rgb = (s) => { const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(s); return m ? [+m[1], +m[2], +m[3]] : null; };
const lum = ([r, g, b]) => { const f = (c) => { const x = c / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

const server = process.argv[2] ? { base: process.argv[2].replace(/\/$/, ''), stop: () => {} } : await startServer();
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const HELP = `${server.base}/ui/help.html`;
const CALC = `${server.base}/ui/ca.html`;

async function newContext(opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'en-CA', timezoneId: 'America/Toronto', ...opts });
  await ctx.route(LOGO, (route) => route.fulfill({ status: 200, contentType: 'image/svg+xml', body: LOGO_SVG }));
  return ctx;
}
/** Collects pageerror, console error/warning and failed requests (logo excluded) for a page. */
function watch(page) {
  const w = { errors: [], failed: [], requests: [] };
  page.on('pageerror', (e) => w.errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) w.errors.push(`console.${m.type()}: ${m.text()}`); });
  page.on('requestfailed', (r) => w.failed.push(`${r.url()} ${r.failure()?.errorText}`));
  page.on('response', (r) => { if (r.status() >= 400) w.failed.push(`${r.url()} HTTP ${r.status()}`); });
  page.on('request', (r) => w.requests.push(r.url()));
  return w;
}
const visible = (page, sel) => page.evaluate((s) => { const e = document.querySelector(s); if (!e) return false; const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 0 && r.height > 0; }, sel);
const activeDoc = (page) => page.evaluate(() => ['manual', 'coverage', 'domain'].filter((k) => { const a = document.getElementById('doc-' + k); const r = a.getBoundingClientRect(); return getComputedStyle(a).display !== 'none' && !a.hidden && r.height > 0; }));
const tabCurrent = (page) => page.evaluate(() => [...document.querySelectorAll('nav[aria-label="Documents"] a')].filter((a) => a.getAttribute('aria-current') === 'page').map((a) => a.getAttribute('href')));

try {
  console.log(`F14 Help page, Chrome ${browser.version()}`);

  // ------------------------------------------------------------------ smoke: the Help page itself (check 6, 7)
  {
    const ctx = await newContext();
    const page = await ctx.newPage();
    const w = watch(page);
    await page.goto(HELP);
    await page.waitForLoadState('load');
    say('6', 'help.html loads with zero pageerror and zero console error or warning', w.errors.length === 0, w.errors.join(' | '));
    say('6', 'zero failed requests (the logo is served locally by the test) and zero requests beyond the page and the logo', w.failed.length === 0 && w.requests.every((u) => u === HELP || u === LOGO), `${w.failed.join(' | ')} ${w.requests.filter((u) => u !== HELP && u !== LOGO).join(' | ')}`);
    const h = await page.evaluate(() => ({ h1: [...document.querySelectorAll('h1')].filter((e) => !e.closest('[hidden]') && e.getBoundingClientRect().height > 0).length, main: document.querySelectorAll('main').length, lang: document.documentElement.lang }));
    say('7', 'exactly one visible h1 and one main, lang en', h.h1 === 1 && h.main === 1 && h.lang === 'en', JSON.stringify(h));
    const paint = await page.evaluate(() => performance.getEntriesByType('paint').find((p) => p.name === 'first-contentful-paint')?.startTime ?? null);
    say('30', 'first contentful paint <= 1000 ms (local)', paint !== null && paint <= 1000, `fcp ${paint}`);
    const dom = await page.evaluate(() => document.getElementsByTagName('*').length);
    say('30', 'DOM nodes <= 25,000', dom <= 25000, `nodes ${dom}`);
    // logo fallback (offline): block the logo and expect the text fallback, no console error from the page's own code
    const ctx2 = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await ctx2.route(LOGO, (route) => route.abort());
    const p2 = await ctx2.newPage();
    await p2.goto(HELP);
    await p2.waitForLoadState('load');
    await p2.waitForTimeout(300);
    const fb = await p2.evaluate(() => { const t = [...document.querySelectorAll('.brand-fallback, .help-header *')].find((e) => /Alterna Savings/.test(e.textContent) && e.tagName !== 'IMG' && e.getClientRects().length > 0); return !!t; });
    say('6', 'with the logo unreachable the text fallback "Alterna Savings" is visible', fb);
    await ctx2.close();
    await ctx.close();
  }

  // ------------------------------------------------------------------ smoke: the calculator side (checks 1-4, B29-X7, INV-NOPROBE, INV-REVERT)
  {
    const ctx = await newContext({ permissions: [] });
    const page = await ctx.newPage();
    const w = watch(page);
    await page.goto(CALC);
    await page.waitForLoadState('load');
    const link = page.getByRole('link', { name: 'Help (opens in a new tab)' });
    say('1', 'the calculator header has one link with the accessible name "Help (opens in a new tab)"', (await link.count()) === 1);
    const a = await link.first().evaluate((e) => ({ href: e.getAttribute('href'), target: e.target, rel: e.rel, text: (() => { const c = e.cloneNode(true); c.querySelectorAll('svg').forEach((x) => x.remove()); return c.textContent.replace(/\s+/g, ' ').trim(); })() }));
    say('1', 'href /ui/help.html, target _blank, rel contains noopener, visible text starts with Help', a.href === '/ui/help.html' && a.target === '_blank' && /\bnoopener\b/.test(a.rel) && /^Help/.test(a.text), JSON.stringify(a));
    await page.keyboard.press('Tab');
    const first = await page.evaluate(() => document.activeElement.className);
    await page.keyboard.press('Tab');
    const second = await page.evaluate(() => ({ cls: document.activeElement.className, outline: getComputedStyle(document.activeElement).outlineWidth, style: getComputedStyle(document.activeElement).outlineStyle }));
    say('2', 'Tab order: logo link, then Help, with a visible 3px outline', /brand-logo/.test(first) && /help-link/.test(second.cls) && second.outline === '3px' && second.style !== 'none', `${first} / ${JSON.stringify(second)}`);
    await page.fill('#loanAmount', '123,456.78');
    const before = await page.inputValue('#loanAmount');
    const [help] = await Promise.all([ctx.waitForEvent('page'), link.first().click()]);
    await help.waitForLoadState('load');
    const opener = await help.evaluate(() => window.opener);
    say('3', 'activating Help opens a second page at /ui/help.html with window.opener === null', help.url().endsWith('/ui/help.html') && opener === null, `${help.url()} opener ${opener}`);
    say('3', 'the calculator tab is unchanged (input keeps its value)', (await page.inputValue('#loanAmount')) === before);
    await help.close();
    say('B29-X7', 'the calculator page has zero pageerror, zero console error or warning and zero failed request', w.errors.length === 0 && w.failed.length === 0, `${w.errors.join(' | ')} ${w.failed.join(' | ')}`);
    say('B29-INV-NOPROBE', 'the calculator page requested nothing named help before the click', !w.requests.slice(0, w.requests.length).some((u) => /help/i.test(u) && !u.endsWith('/ui/help.html')) , w.requests.filter((u) => /help/i.test(u)).join(' | '));
    await page.emulateMedia({ media: 'print' });
    const pr = await page.evaluate(() => ({ brand: getComputedStyle(document.querySelector('.brand')).display, helpShown: document.querySelector('.help-link').getClientRects().length > 0 }));
    say('4', 'with print emulated .brand computes display none and the Help link is not shown (the Help rule does not defeat the print hide)', pr.brand === 'none' && !pr.helpShown, JSON.stringify(pr));
    await ctx.close();
  }

  // ------------------------------------------------------------------ B29-X7 (ii) and B29-INV-REVERT: scratch copies of the served tree
  {
    const root = mkdtempSync(join(tmpdir(), 'b29-f14-'));
    try {
      mkdirSync(join(root, 'ui'));
      for (const f of ['ca.html', 'ca.js', 'ca-view.js', 'serve.mjs']) cpSync(join(ROOT, 'ui', f), join(root, 'ui', f));
      cpSync(join(ROOT, 'dist'), join(root, 'dist'), { recursive: true });
      cpSync(join(ROOT, 'package.json'), join(root, 'package.json'));
      // (ii) ui/help.html missing, the link still present
      const s1 = await startServer(root);
      const ctx = await newContext();
      const page = await ctx.newPage();
      const w = watch(page);
      await page.goto(`${s1.base}/ui/ca.html`);
      await page.waitForLoadState('load');
      say('B29-X7', 'ui/help.html absent, link present: the calculator page has zero pageerror, zero console error or warning, zero failed request', w.errors.length === 0 && w.failed.length === 0, `${w.errors.join(' | ')} ${w.failed.join(' | ')}`);
      const nf = await page.request.get(`${s1.base}/ui/help.html`);
      say('B29-X7', 'the missing page answers 404 with the plain text "Not found"', nf.status() === 404 && (await nf.text()) === 'Not found');
      s1.stop();
      await ctx.close();
      // INV-REVERT: the page with both Help blocks deleted loads cleanly
      let ca = readFileSync(join(ROOT, 'ui', 'ca.html'), 'utf8');
      const out = []; let end = null;
      for (const line of ca.split('\n')) {
        if (!end && line.includes('/* HELP:BEGIN */')) end = '/* HELP:END */'; else if (!end && line.includes('<!-- HELP:BEGIN -->')) end = '<!-- HELP:END -->';
        if (!end) out.push(line); else if (line.includes(end)) end = null;
      }
      writeFileSync(join(root, 'ui', 'ca.html'), out.join('\n'));
      const s2 = await startServer(root);
      const ctx2 = await newContext();
      const p2 = await ctx2.newPage();
      const w2 = watch(p2);
      await p2.goto(`${s2.base}/ui/ca.html`);
      await p2.waitForLoadState('load');
      const gone = await p2.evaluate(() => document.querySelectorAll('.help-link').length);
      say('B29-INV-REVERT', 'the calculator with the Help blocks deleted loads with no console message, no failed request and no Help link', w2.errors.length === 0 && w2.failed.length === 0 && gone === 0, `${w2.errors.join(' | ')} links ${gone}`);
      s2.stop();
      await ctx2.close();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }

  // ------------------------------------------------------------------ structure, per width and scheme (checks 8, 10-12, 20, 22-23)
  for (const scheme of ['light', 'dark']) {
    for (const width of WIDTHS) {
      const tag = `${width}px ${scheme}`;
      const ctx = await newContext({ viewport: { width, height: 900 }, colorScheme: scheme, hasTouch: width < 768, permissions: ['clipboard-read', 'clipboard-write'] });
      const page = await ctx.newPage();
      await page.goto(HELP);
      await page.waitForLoadState('load');
      // [8] documents and tabs
      let docs = await activeDoc(page);
      say('8', `${tag}: no hash shows only the User manual, tab aria-current`, docs.join() === 'manual' && (await tabCurrent(page)).join() === '#doc-manual', `${docs} ${await tabCurrent(page)}`);
      for (const [hash, key] of [['#doc-coverage', 'coverage'], ['#domain', 'domain'], ['#doc-manual', 'manual']]) {
        await page.evaluate((h) => { location.hash = h; }, hash);
        await page.waitForTimeout(80);
        docs = await activeDoc(page);
        say('8', `${tag}: ${hash} shows only ${key}`, docs.join() === key && (await tabCurrent(page)).join() === `#doc-${key}`, `${docs} ${await tabCurrent(page)}`);
      }
      // [10] TOC link scroll position and focus (default document)
      await page.evaluate(() => { location.hash = '#doc-manual'; });
      const tocHref = await page.evaluate(() => { const nav = [...document.querySelectorAll('article:not([hidden]) nav[aria-label^="Contents of"], nav.toc')].find((n) => n.getClientRects().length > 0) ?? document.querySelector('nav[aria-label^="Contents of"]'); const sum = nav.closest('details'); if (sum) sum.open = true; const links = [...nav.querySelectorAll('a')]; return links[Math.min(5, links.length - 1)].getAttribute('href'); });
      await page.click(`a[href="${tocHref}"]`);
      await page.waitForTimeout(250);
      const t = await page.evaluate((h) => { const el = document.getElementById(h.slice(1)); const hd = document.querySelector('header'); const sticky = hd && getComputedStyle(hd).position === 'sticky' ? hd.getBoundingClientRect().bottom : 0; return { top: el.getBoundingClientRect().top, sticky, focused: document.activeElement === el }; }, tocHref);
      say('10', `${tag}: after a TOC click the heading top is >= 16px below the sticky header and has focus`, t.top >= t.sticky + 16 - 1 && t.focused, JSON.stringify(t));
      // [11] sticky TOC and details
      if (width >= 992) {
        const pos = await page.evaluate(() => { const nav = document.querySelector('nav.toc, nav[aria-label^="Contents of"]'); const r0 = nav.getBoundingClientRect().top; window.scrollBy(0, 700); return { r0, r1: nav.getBoundingClientRect().top }; });
        say('11', `${tag}: the TOC is sticky (its top stays put while scrolling)`, Math.abs(pos.r0 - pos.r1) < 2 || pos.r1 >= 0 && pos.r1 <= 120, JSON.stringify(pos));
      } else {
        const det = await page.evaluate(() => { const d = [...document.querySelectorAll('details')].find((x) => x.querySelector('nav[aria-label^="Contents of"]') && !x.classList.contains('diagram-text')); return d ? { open: d.open } : null; });
        say('11', `${tag}: below 992 px the TOC is a <details> closed by default`, det !== null && det.open === false, JSON.stringify(det));
      }
      // [12] anchors
      await page.evaluate(() => { location.hash = '#doc-manual'; window.scrollTo(0, 0); });
      const anchor = await page.evaluate(() => { const a = document.querySelector('article:not([hidden]) h2 .anchor'); const r = a.getBoundingClientRect(); return { w: r.width, h: r.height, op: getComputedStyle(a).opacity }; });
      if (width < 768) say('12', `${tag}: on a touch viewport the anchor is always visible (opacity 1) and >= 24x24`, anchor.op === '1' && anchor.w >= 24 && anchor.h >= 24, JSON.stringify(anchor));
      else {
        await page.hover('article:not([hidden]) h2');
        const hov = await page.evaluate(() => getComputedStyle(document.querySelector('article:not([hidden]) h2 .anchor')).opacity);
        say('12', `${tag}: hovering a heading shows its anchor (opacity 1), size >= 24x24`, hov === '1' && anchor.w >= 24 && anchor.h >= 24, `${hov} ${JSON.stringify(anchor)}`);
      }
      // [20] reflow and table regions
      await page.evaluate(() => { location.hash = '#doc-coverage'; });
      await page.waitForTimeout(100);
      const t20 = await page.evaluate(() => { const wraps = [...document.querySelectorAll('#doc-coverage .table-wrap')]; return { pageScroll: document.documentElement.scrollWidth - innerWidth, overflowing: wraps.filter((w) => w.scrollWidth > w.clientWidth + 1).length, bad: wraps.filter((w) => w.getAttribute('role') !== 'region' || w.tabIndex !== 0 || !document.getElementById(w.getAttribute('aria-labelledby'))).length, n: wraps.length }; });
      say('20', `${tag}: no page-level horizontal scroll; all ${t20.n} coverage tables are focusable named regions${width === 360 ? '; wide tables scroll inside their region' : ''}`, t20.pageScroll <= 0 && t20.bad === 0 && (width !== 360 || t20.overflowing > 0), JSON.stringify(t20));
      // [22] cell caps, no clipping
      const t22 = await page.evaluate(() => { const ch = (() => { const c = document.createElement('canvas').getContext('2d'); const td = document.querySelector('#doc-coverage td'); const cs = getComputedStyle(td); c.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`; return c.measureText('0').width; })(); let over = 0; let clipped = 0; for (const tb of document.querySelectorAll('#doc-coverage table')) { const cols = tb.rows[0].cells.length; for (const tr of tb.rows) for (const [i, c] of [...tr.cells].entries()) { const cs = getComputedStyle(c); const pad = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight) + 2; const cap = (i === cols - 1 ? 64 : 38) * ch + pad; if (c.getBoundingClientRect().width > cap + 2) over++; if (c.scrollWidth > c.clientWidth + 1) clipped++; } } return { over, clipped }; });
      say('22', `${tag}: no coverage table cell wider than its cap (38ch, last column 64ch) and none clipped`, t22.over === 0 && t22.clipped === 0, JSON.stringify(t22));
      // [23] diagrams
      await page.evaluate(() => { location.hash = '#doc-domain'; });
      await page.waitForTimeout(100);
      const t23 = await page.evaluate(() => { const figs = [...document.querySelectorAll('#doc-domain figure.diagram')]; const small = []; for (const f of figs) for (const e of f.querySelectorAll('svg text, svg foreignObject *')) { const fs = parseFloat(getComputedStyle(e).fontSize); if (e.textContent.trim() && e.children.length === 0 && fs < 11) small.push(fs); } return { n: figs.length, svg: figs.filter((f) => { const s = f.querySelector('svg'); return s && s.getAttribute('role') === 'img' && s.querySelector('title')?.textContent.trim() && s.querySelector('desc')?.textContent.trim(); }).length, ids: figs.filter((f) => f.id).length, lists: figs.filter((f) => /Read this diagram as text/.test(f.textContent)).length, frame: figs.map((f) => getComputedStyle(f.querySelector('.diagram-frame')).backgroundColor), small: small.length }; });
      say('23', `${tag}: ${t23.n} diagrams are svg role=img with title and desc, an id, a text list; frame rgb(255, 255, 255); no text under 11px`, t23.n === 14 && t23.svg === 14 && t23.ids === 14 && t23.lists === 14 && t23.frame.every((c) => c === 'rgb(255, 255, 255)') && t23.small === 0, JSON.stringify({ ...t23, frame: [...new Set(t23.frame)] }));
      await ctx.close();
    }
  }

  // ------------------------------------------------------------------ anchors, IDs, Go to ID, copy link (checks 13-15)
  {
    const ctx = await newContext({ permissions: ['clipboard-read', 'clipboard-write'] });
    const page = await ctx.newPage();
    const w = watch(page);
    await page.goto(HELP);
    await page.waitForLoadState('load');
    await page.hover('article:not([hidden]) h2');
    const target = await page.evaluate(() => document.querySelector('article:not([hidden]) h2 .anchor').getAttribute('href'));
    await page.click('article:not([hidden]) h2 .anchor');
    await page.waitForTimeout(200);
    const clip = await page.evaluate(() => navigator.clipboard.readText());
    const status = await page.evaluate(() => [...document.querySelectorAll('[role="status"]')].map((e) => e.textContent).join(' '));
    say('13', 'activating a heading anchor puts the absolute URL with the hash on the clipboard and the status region reads "Link copied"', clip === page.url().split('#')[0] + target && /Link copied/.test(status), `${clip} | ${status}`);
    // [14] deep link to a defined ID in a hidden document
    const id = await page.evaluate(() => document.querySelector('#doc-coverage tr[id]')?.id ?? null);
    await page.goto(`${HELP}#${id}`);
    await page.waitForLoadState('load');
    await page.waitForTimeout(200);
    const t14 = await page.evaluate((i) => { const tr = document.getElementById(i); const r = tr.getBoundingClientRect(); const cs = getComputedStyle(tr); return { shown: r.height > 0 && r.bottom > 0 && r.top < innerHeight, bg: cs.backgroundColor, doc: tr.closest('article').id }; }, id);
    const markBg = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--mark-bg').trim());
    say('14', `loading #${id} (a row of the Coverage report) switches document, scrolls to it and highlights it with --mark-bg`, t14.shown && t14.doc === 'doc-coverage' && !!rgb(t14.bg) && markBg !== '' , JSON.stringify(t14) + ' ' + markBg);
    // [15] Go to ID
    await page.goto(HELP);
    await page.waitForLoadState('load');
    const box = page.getByRole('searchbox', { name: /Go to ID/i }).or(page.locator('input[type="search"]')).first();
    const before = w.requests.length;
    await box.fill('us-04');
    await box.press('Enter');
    await page.waitForTimeout(250);
    const found = await page.evaluate(() => ({ hash: location.hash, doc: document.getElementById('US-04')?.closest('article')?.id ?? null, shown: (document.getElementById('US-04')?.getBoundingClientRect().height ?? 0) > 0 }));
    say('15', 'Go to ID: "us-04" + Enter finds US-04 case-insensitively (document switched, row shown)', /us-04/i.test(found.hash) && found.shown, JSON.stringify(found));
    await box.fill('ZZ-99');
    await box.press('Enter');
    await page.waitForTimeout(150);
    const none = await page.evaluate(() => [...document.querySelectorAll('[role="status"]')].map((e) => e.textContent).join(' '));
    say('15', 'Go to ID: "ZZ-99" shows "No entry"', /No entry/.test(none), none);
    const opts = await page.evaluate(() => [...document.querySelectorAll('datalist option')].map((o) => o.value));
    say('15', 'the datalist contains US-01 and the entered text is not sent anywhere (no request after typing)', opts.includes('US-01') && w.requests.length === before, `opts ${opts.length}; requests +${w.requests.length - before}`);
    await ctx.close();
  }

  // ------------------------------------------------------------------ statuses and contrast (checks 17-19, 29)
  for (const scheme of ['light', 'dark']) {
    const ctx = await newContext({ colorScheme: scheme });
    const page = await ctx.newPage();
    await page.goto(`${HELP}#doc-coverage`);
    await page.waitForLoadState('load');
    const s = await page.evaluate(() => { const out = {}; for (const el of document.querySelectorAll('#doc-coverage .status')) { const st = el.getAttribute('data-state'); if (out[st]) continue; const cs = getComputedStyle(el); const g = el.querySelector('[aria-hidden="true"]'); out[st] = { ink: cs.color, bg: cs.backgroundColor, line: cs.borderTopColor, style: cs.borderTopStyle, width: cs.borderTopWidth, text: el.textContent.trim(), glyph: !!g, glyphText: g ? g.textContent.trim() + '|' + g.innerHTML.length + '|' + (g.querySelector('svg') ? g.querySelector('svg').innerHTML : '') : '' }; } return { states: out, n: document.querySelectorAll('#doc-coverage .status').length, empty: [...document.querySelectorAll('#doc-coverage .status')].filter((e) => !e.textContent.trim()).length }; });
    // Revision 38: six states (covered, planned, wrong, open, partial, out), the sixth being the grey "outside this tool" state.
    const SIX = ['covered', 'planned', 'wrong', 'open', 'partial', 'out'];
    say('17', `${scheme}: status chips exist (${s.n}), each with visible text and a glyph`, s.n > 50 && s.empty === 0 && Object.values(s.states).every((v) => v.glyph), JSON.stringify(Object.keys(s.states)));
    say('17', `${scheme}: all six states occur in the coverage report (including out)`, SIX.every((k) => s.states[k]), JSON.stringify(Object.keys(s.states)));
    if (scheme === 'light') {
      const st = (k) => `${s.states[k]?.style}/${s.states[k]?.width}`;
      say('18', 'greyscale: the four states stay distinguishable by border style (solid, dashed, solid 2px, dotted)', st('covered') === 'solid/1px' && st('planned') === 'dashed/1px' && st('wrong') === 'solid/2px' && st('open') === 'dotted/1px', ['covered', 'planned', 'wrong', 'open'].map(st).join(' '));
      // check 26 / R6 (f): out differs from open by border style and from every other state by glyph (not by colour alone).
      const glyphs = SIX.map((k) => s.states[k]?.glyphText);
      say('18', 'greyscale: the out chip has a solid 1px border (not open\'s dotted) and a glyph that differs from the other five states', st('out') === 'solid/1px' && st('out') !== st('open') && glyphs.every(Boolean) && new Set(glyphs).size === 6, `${st('out')} vs open ${st('open')}; distinct glyphs ${new Set(glyphs).size}`);
    }
    const bad = [];
    for (const [k, v] of Object.entries(s.states)) { const [ink, bg, line] = [rgb(v.ink), rgb(v.bg), rgb(v.line)]; if (!ink || !bg || !line || contrast(ink, bg) < 4.5 || contrast(line, bg) < 3) bad.push(`${k} ${v.ink} on ${v.bg}, line ${v.line}`); }
    say('19', `${scheme}: computed ink/background >= 4.5 and border/background >= 3 for every status state`, bad.length === 0, bad.join(' | '));
    await ctx.close();
  }
  // ------------------------------------------------------------------ revision 38: tables (R7), Status fallback (R6), UI-scan guard (R13)
  {
    const ctx = await newContext({ viewport: { width: 1280, height: 800 } });
    const page = await ctx.newPage();
    await page.goto(HELP);
    await page.waitForLoadState('load');
    // R7: a table before the first H2 of its document is named by the H1 (id <key>-title).
    const early = await page.evaluate(() => {
      const res = [];
      for (const art of document.querySelectorAll('article')) {
        const key = art.id.replace(/^doc-/, '');
        const h2 = art.querySelector('h2');
        for (const w of art.querySelectorAll('.table-wrap')) {
          if (h2 && !(h2.compareDocumentPosition(w) & Node.DOCUMENT_POSITION_FOLLOWING)) {
            const ref = document.getElementById(w.getAttribute('aria-labelledby') ?? '');
            res.push({ key, ok: !!ref && ref.id === `${key}-title` && ref.tagName === 'H1' });
          }
        }
      }
      return res;
    });
    say('R7', `a table before the first H2 is labelled by the H1 <key>-title (${early.length} such table(s) in the live documents)`, early.every((x) => x.ok), JSON.stringify(early.filter((x) => !x.ok)));
    // R7: a first column whose longest cell has 41 or more characters is plain td and not sticky; otherwise th scope=row and sticky.
    const cols = await page.evaluate(() => {
      const bad = []; let wide = 0; let narrow = 0;
      for (const tb of document.querySelectorAll('article table')) {
        const rows = [...tb.tBodies].flatMap((b) => [...b.rows]);
        if (!rows.length) continue;
        const firsts = rows.map((r) => r.cells[0]);
        const longest = Math.max(...firsts.map((c) => c.textContent.trim().length));
        const rowHeaders = firsts.filter((c) => c.tagName === 'TH' && c.getAttribute('scope') === 'row').length;
        const sticky = firsts.filter((c) => getComputedStyle(c).position === 'sticky').length;
        if (longest >= 41) { wide++; if (rowHeaders !== 0 || sticky !== 0) bad.push({ longest, rowHeaders, sticky, rows: rows.length, kind: 'wide' }); }
        else { narrow++; if (rowHeaders !== rows.length || sticky !== rows.length) bad.push({ longest, rowHeaders, sticky, rows: rows.length, kind: 'narrow' }); }
      }
      return { bad, wide, narrow };
    });
    say('R7', `first column of 41 or more characters: td and not sticky; otherwise th scope=row and sticky (${cols.wide} wide, ${cols.narrow} narrow tables)`, cols.bad.length === 0, JSON.stringify(cols.bad.slice(0, 3)));
    // R6: the live documents have zero unmatched Status values (every cell of a Status column carries a chip).
    const plain = await page.evaluate(() => {
      const out = [];
      for (const tb of document.querySelectorAll('article table')) {
        const hr = tb.tHead?.rows[0]; if (!hr) continue;
        const idx = [...hr.cells].findIndex((c) => c.textContent.trim().toLowerCase() === 'status');
        if (idx < 0) continue;
        for (const b of tb.tBodies) for (const r of b.rows) if (r.cells[idx] && !r.cells[idx].querySelector('.status')) out.push(r.cells[idx].textContent.trim().slice(0, 60));
      }
      return out;
    });
    say('R6', 'every cell of a Status column carries a status chip (no unmatched Status value in the live documents)', plain.length === 0, JSON.stringify(plain.slice(0, 5)));
    await ctx.close();
    // R13: the served page holds none of the three strings the baseline scans of the UI folder forbid.
    const html = await (await fetch(HELP)).text();
    const needles = [['UIG-1', new RegExp('included' + 'InCob')], ['UIG-2', new RegExp('\\btotal' + 'Fees\\b')], ['UIG-3', new RegExp('archive' + '\\/pre-b27')]];
    const hits = html.split('\n').flatMap((l, i) => needles.filter(([, re]) => re.test(l)).map(([id]) => `${id}@${i + 1}`));
    say('R13', 'the served Help page contains none of the UIG-1..3 strings', hits.length === 0, hits.join(' '));
  }
  {
    const ctx = await newContext({ reducedMotion: 'reduce' });
    const page = await ctx.newPage();
    await page.goto(`${HELP}#manual-intentional-differences`);
    const an = await page.evaluate(() => { const t = document.querySelector(':target') ?? document.querySelector('h2'); return getComputedStyle(t).animationName; });
    say('29', 'prefers-reduced-motion: reduce disables the target highlight animation', an === 'none', an);
    await ctx.close();
  }

  // ------------------------------------------------------------------ sticky header row and first column (check 21)
  {
    const ctx = await newContext({ viewport: { width: 1280, height: 800 } });
    const page = await ctx.newPage();
    await page.goto(`${HELP}#doc-coverage`);
    await page.waitForLoadState('load');
    const r = await page.evaluate(() => { const wraps = [...document.querySelectorAll('#doc-coverage .table-wrap')].sort((a, b) => b.scrollWidth - a.scrollWidth); const w = wraps[0]; w.scrollIntoView(); w.scrollLeft = 0; const th = w.querySelector('tbody th[scope="row"]'); const l0 = th ? th.getBoundingClientRect().left : null; w.scrollLeft = 300; const l1 = th ? th.getBoundingClientRect().left : null; w.scrollTop = 0; const head = w.querySelector('thead th'); const t0 = head.getBoundingClientRect().top - w.getBoundingClientRect().top; w.scrollTop = 200; const t1 = head.getBoundingClientRect().top - w.getBoundingClientRect().top; return { canScrollX: w.scrollWidth > w.clientWidth, l0, l1, canScrollY: w.scrollHeight > w.clientHeight, t0, t1 }; });
    say('21', 'the sticky first column keeps its left edge while the region scrolls sideways', r.l0 === null || !r.canScrollX || Math.abs(r.l0 - r.l1) < 2, JSON.stringify(r));
    say('21', 'the sticky header row keeps its top while the region scrolls down', !r.canScrollY || Math.abs(r.t0 - r.t1) < 2, JSON.stringify(r));
    await ctx.close();
  }

  // ------------------------------------------------------------------ zoom reflow (check 24, browser-zoom part only)
  for (const [w, label] of [[640, '200 % zoom (640 css px)'], [320, '320 css px']]) {
    const ctx = await newContext({ viewport: { width: w, height: 800 } });
    const page = await ctx.newPage();
    for (const h of ['#doc-manual', '#doc-coverage', '#doc-domain']) {
      await page.goto(HELP + h);
      await page.waitForLoadState('load');
      const over = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
      say('24', `${label}, ${h}: no horizontal page scroll outside the scroll regions`, over <= 0, `over by ${over}`);
    }
    await ctx.close();
  }

  // ------------------------------------------------------------------ print (checks 25-27)
  {
    const ctx = await newContext({ viewport: { width: 965, height: 700 } });
    const page = await ctx.newPage();
    const pages = {};
    for (const key of ['manual', 'coverage', 'domain']) {
      await page.goto(`${HELP}#doc-${key}`);
      await page.waitForLoadState('load');
      await page.emulateMedia({ media: 'print' });
      const p = await page.evaluate((k) => {
        const hidden = (sel) => [...document.querySelectorAll(sel)].every((e) => getComputedStyle(e).display === 'none');
        const art = [...document.querySelectorAll('article')].filter((a) => getComputedStyle(a).display !== 'none' && a.getClientRects().length > 0).map((a) => a.id);
        const cs = getComputedStyle(document.body);
        return { art, chrome: hidden('.help-header, .doc-nav, nav[aria-label="Documents"], .toc, nav[aria-label^="Contents of"], .anchor, button'), bg: cs.backgroundColor, fg: cs.color, theadGroup: [...document.querySelectorAll(`#doc-${k} thead`)].every((t) => getComputedStyle(t).display === 'table-header-group'), rowBreak: [...document.querySelectorAll(`#doc-${k} tbody tr`)].slice(0, 20).every((r) => getComputedStyle(r).breakInside === 'avoid'), figBreak: [...document.querySelectorAll(`#doc-${k} figure.diagram`)].every((f) => getComputedStyle(f).breakInside === 'avoid') };
      }, key);
      say('25', `print ${key}: only that document, no header, TOC, document tabs, buttons or anchors; white background, black text`, p.art.join() === `doc-${key}` && p.chrome && rgb(p.bg)?.every((c) => c === 255) && rgb(p.fg)?.every((c) => c === 0), JSON.stringify(p));
      say('27', `print ${key}: the table header row repeats, rows and diagrams are not split`, p.theadGroup && p.rowBreak && p.figBreak, JSON.stringify({ t: p.theadGroup, r: p.rowBreak, f: p.figBreak }));
      if (key === 'coverage') {
        const fit = await page.evaluate(() => { let worst = 0; for (const w of document.querySelectorAll('#doc-coverage .table-wrap')) worst = Math.max(worst, w.scrollWidth - w.clientWidth, w.getBoundingClientRect().right - 965); return worst; });
        say('26', 'print coverage (landscape, 965 px): the widest table fits the page width, no clipped column', fit <= 1, `over by ${fit}`);
      }
      try { const pdf = await page.pdf({ preferCSSPageSize: true }); pages[key] = (Buffer.from(pdf).toString('latin1').match(/\/Type\s*\/Page[^s]/g) ?? []).length; } catch (e) { pages[key] = `n/a (${e.message.slice(0, 40)})`; }
      await page.emulateMedia({ media: 'screen' });
    }
    console.log(`note [27] printed page counts (recorded, no expectation): ${JSON.stringify(pages)}`);
    await ctx.close();
  }

  // ------------------------------------------------------------------ JavaScript disabled (check 31)
  {
    const ctx = await newContext({ javaScriptEnabled: false, viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    await page.goto(HELP);
    await page.waitForLoadState('load');
    const vis = [];
    for (const k of ['manual', 'coverage', 'domain']) vis.push(await page.locator(`#doc-${k}`).boundingBox());
    say('31', 'JavaScript off: all three documents are visible, stacked in order', vis.every((b) => b && b.height > 0) && vis[0].y < vis[1].y && vis[1].y < vis[2].y, JSON.stringify(vis.map((b) => b && Math.round(b.y))));
    const href = await page.locator('article nav a').first().getAttribute('href');
    await page.locator('article nav a').first().click();
    say('31', 'JavaScript off: a TOC link works (the hash changes to the target)', page.url().endsWith(href), `${page.url()} ${href}`);
    await ctx.close();
  }
} finally {
  await browser.close();
  server.stop();
}
console.log(failures === 0 ? `F14 PASS: ${total}/${total}` : `F14 FAIL: ${failures} of ${total} check(s) failing`);
process.exitCode = failures === 0 ? 0 : 1;
