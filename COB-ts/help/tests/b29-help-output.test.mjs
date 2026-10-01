/**
 * B29 output: the COMMITTED ui/help.html against the live documents (B29-INV-COUNT, -IDS, -OFFLINE,
 * -STEP). QA 2026-09-30. Tests that read docs/ are skipped when docs/ is absent (B29-X7 iii); the
 * tests that read only the page and help.css always run (red until the page is built). Counts are
 * re-derived from the Markdown at test time by the independent scanner in support/md-scan.mjs,
 * never hard-coded. Deleted with the help/ folder.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DOCS, DOCS_PRESENT, DOC_FILES, HELP, INSTALLED, PAGE, STUB, TOKENS_CSS, allIds, article, build, byClass, chips, elements, inlineScripts, read, tags, textOf, tmp,
} from './support/common.mjs';
import { lintDocument } from './support/docs-lint.mjs';
import { contrast, cssBlocks, cssTokens } from './support/css-tokens.mjs';
import { STATUS_WORDS, headings, leadingIds, mermaidBlocks, statusCounts, tables } from './support/md-scan.mjs';

const KEYS = Object.keys(DOC_FILES);
const page = () => read(PAGE); // throws (red) when the page is not built
const docMd = (key) => read(join(DOCS, DOC_FILES[key]));
const dd = describe.skipIf(!DOCS_PRESENT);
const ddi = describe.skipIf(!DOCS_PRESENT || !INSTALLED); // the document lint parses with markdown-it (help/node_modules)
const ID_RE = /^(?:(?:US|UC|BR|IN|FB|DEV|OQ|Q)-[A-Z0-9]+(?:-[A-Z0-9]+)*|B\d{1,3}|F\d{1,3}|A\d{1,3})$/;
const CSS_PATH = join(HELP, 'assets', 'help.css');

dd('B29 output vs the live documents: structure counts (B29-INV-COUNT)', () => {
  it.each(KEYS)('%s: the article exists and its h1 is the document title', (key) => {
    const art = article(page(), key);
    expect(art, `article#doc-${key}`).toBeTruthy();
    const h1 = elements(art, 'h1');
    expect(h1.length).toBe(1);
    expect(textOf(h1[0].inner)).toBe(headings(docMd(key)).find((h) => h.level === 1).text.replace(/`/g, ''));
  });

  it.each(KEYS.flatMap((k) => [[k, 2], [k, 3]]))('%s: the number of H%i headings equals the Markdown line-scan count', (key, level) => {
    const want = headings(docMd(key)).filter((h) => h.level === level).length;
    const got = elements(article(page(), key), `h${level}`).length;
    expect(got).toBe(want);
  });

  it('every table of the Markdown is in a .table-wrap with role=region, tabindex=0 and an aria-labelledby that resolves (counts equal per document)', () => {
    const html = page();
    const ids = new Set(allIds(html));
    for (const key of KEYS) {
      const art = article(html, key);
      const wraps = byClass(art, 'div', 'table-wrap');
      expect(wraps.length, `${key} tables`).toBe(tables(docMd(key)).length);
      expect(elements(art, 'table').length).toBe(wraps.length);
      for (const w of wraps) {
        expect(w.attrs.role).toBe('region');
        expect(w.attrs.tabindex).toBe('0');
        expect(ids.has(w.attrs['aria-labelledby'])).toBe(true);
      }
    }
  });

  it('each status word: the number of .status chips equals the independent count of Status-column cells (re-counted now, all documents)', () => {
    const html = page();
    const chipsAll = KEYS.flatMap((k) => byClass(article(html, k), 'span', 'status').map((s) => textOf(s.inner)));
    const total = Object.fromEntries(STATUS_WORDS.map(([w]) => [w, 0]));
    for (const k of KEYS) for (const [w, n] of Object.entries(statusCounts(docMd(k)).counts)) total[w] += n;
    expect(Object.values(total).reduce((a, b) => a + b, 0), 'the live documents have Status cells').toBeGreaterThan(50);
    for (const [w] of STATUS_WORDS) {
      expect(chipsAll.filter((t) => t.endsWith(w)).length, w).toBe(total[w]);
    }
  });

  it.each(STATUS_WORDS.map(([w]) => [w]))('status entry "%s" (B29-R6, 13 rows) has a chip count equal to its independent count', (w) => {
    const html = page();
    const got = KEYS.flatMap((k) => byClass(article(html, k), 'span', 'status').map((s) => textOf(s.inner))).filter((t) => t.endsWith(w)).length;
    const want = KEYS.reduce((n, k) => n + statusCounts(docMd(k)).counts[w], 0);
    expect(got).toBe(want);
  });

  it('14 figures (the count is re-read from the Markdown), each with role=img, a non-empty <title> and <desc>, a figure id and a text list', () => {
    const html = page();
    let total = 0;
    for (const key of KEYS) {
      const want = mermaidBlocks(docMd(key)).length;
      const figs = byClass(article(html, key), 'figure', 'diagram');
      expect(figs.length, `${key} figures`).toBe(want);
      figs.forEach((f, i) => {
        expect(f.attrs.id).toBe(`${key}-fig-${i + 1}`);
        const svg = tags(f.inner, 'svg')[0];
        expect(svg.attrs.role).toBe('img');
        expect(textOf(elements(f.inner, 'title')[0].inner).length).toBeGreaterThan(0);
        expect(textOf(elements(f.inner, 'desc')[0].inner).length).toBeGreaterThan(0);
        expect(byClass(f.inner, 'details', 'diagram-text').length).toBe(1);
      });
      total += figs.length;
    }
    expect(total).toBe(14);
  });

  it('the page has exactly the headings of the three documents: no id repeated case-insensitively (B29-INV-IDS)', () => {
    const ids = allIds(page());
    const lower = ids.map((i) => i.toLowerCase());
    const dup = lower.filter((v, i) => lower.indexOf(v) !== i);
    expect([...new Set(dup)]).toEqual([]);
  });

  it('every TOC link is unique and resolves; every <a href="#x"> in the page resolves (B29-INV-IDS)', () => {
    const html = page();
    const ids = new Set(allIds(html));
    const bad = tags(html, 'a').map((a) => a.attrs.href).filter((h) => h && h.startsWith('#') && h.length > 1 && !ids.has(decodeURIComponent(h.slice(1))));
    expect(bad).toEqual([]);
    for (const nav of elements(html, 'nav').filter((n) => /^Contents of the /.test(n.attrs['aria-label'] ?? ''))) {
      const hrefs = tags(nav.inner, 'a').map((a) => a.attrs.href);
      expect(hrefs.length).toBeGreaterThan(3);
      expect(new Set(hrefs).size).toBe(hrefs.length);
    }
  });
});

ddi('B29 live documents satisfy the build rules (revision 36: zero raw-HTML, ragged-row, refused-table, footnote, image, task, link failures; zero unmatched Status values; no ID defined twice)', () => {
  const lint = async () => {
    const out = {};
    for (const key of KEYS) out[key] = await lintDocument(docMd(key));
    return out;
  };
  const RULES = [
    [1, 'raw HTML tokens (html_block, html_inline, comments, <br>)'],
    [2, 'headings deeper than H3'],
    [3, 'images without alt text or with a source that is not a data: URI'],
    [4, 'task-list items'],
    [5, 'footnotes'],
    [6, 'links that are not http(s), mailto or #id'],
    [7, 'tables with fewer than 2 columns'],
    [8, 'ragged table rows (source-line cell count differs from the header)'],
    [9, 'tables the parser silently refused (header and delimiter row of different widths)'],
  ];
  it.each(RULES)('rule %i: zero %s in the three live documents', async (rule) => {
    const all = await lint();
    const hits = KEYS.flatMap((k) => all[k].filter((f) => f.rule === rule).map((f) => `${DOC_FILES[k]}:${f.line} ${f.what}`));
    expect(hits).toEqual([]);
  });

  it('zero unmatched Status values: every cell of every Status column starts with a word of the B29-R6 mapping (13 rows, word boundary, case-sensitive)', () => {
    const bad = KEYS.flatMap((k) => statusCounts(docMd(k)).unmatched.map((u) => `${DOC_FILES[k]}:${u.line} "${u.cell}"`));
    expect(bad).toEqual([]);
    const total = KEYS.reduce((n, k) => n + Object.values(statusCounts(docMd(k)).counts).reduce((a, b) => a + b, 0), 0);
    expect(total, 'Status cells found').toBeGreaterThan(100);
  });

  it('no ID is defined by two rows (a leading ID list counts an ID once; an ID may carry a lowercase suffix such as DEV-W-interim)', () => {
    const where = new Map();
    const dups = [];
    for (const key of KEYS) {
      for (const t of tables(docMd(key))) {
        for (const r of t.rows) {
          for (const id of new Set(leadingIds(r.cells[0] ?? ''))) {
            const here = `${DOC_FILES[key]}:${r.line}`;
            if (where.has(id)) dups.push(`${id}: ${where.get(id)} and ${here}`);
            else where.set(id, here);
          }
        }
      }
    }
    expect(dups).toEqual([]);
    expect(where.size).toBeGreaterThan(100);
  });

  it('a dry run of the builder on the live documents with the stub renderer exits 0 and writes a page (every R2 / R5 / R6 rule holds on the live Markdown)', () => {
    const out = join(tmp('b29-live-'), 'help.html');
    const r = build({ docs: DOCS, out, renderer: STUB 
});

dd('B29 live documents in the committed page: Status cells, states and the grey out state (B29-R6, Q-HELP-OUTSCOPE)', () => {
  /** [{ doc, header: [..], rows: [[cell html, ...]] }] for every table of the page. */
  const pageTables = () => {
    const html = page();
    return KEYS.flatMap((key) =>
      elements(article(html, key), 'table').map((t) => ({
        key,
        header: elements(elements(t.inner, 'thead')[0]?.inner ?? '', 'th').map((h) => textOf(h.inner)),
        rows: elements(elements(t.inner, 'tbody')[0]?.inner ?? '', 'tr').map((tr) => [...tr.inner.matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/g)].map((c) => c[1])),
      })),
    );
  };

  it('every body cell of every Status column carries a .status chip: the page has zero plain Status cells (the fallback safeguard)', () => {
    let n = 0;
    const plain = [];
    for (const t of pageTables()) {
      const col = t.header.findIndex((h) => h.trim().toLowerCase() === 'status');
      if (col < 0) continue;
      for (const row of t.rows) {
        n++;
        if (!/class="status"|class="[^"]*\bstatus\b[^"]*"/.test(row[col] ?? '')) plain.push(`${t.key}: ${textOf(row[col] ?? '')}`);
      }
    }
    expect(n, 'Status cells in the page').toBeGreaterThan(100);
    expect(plain).toEqual([]);
  });

  it.each(['covered', 'partial', 'wrong', 'planned', 'open', 'out'])('the number of .status chips with data-state "%s" equals the independent count of Status cells that map to it', (state) => {
    const html = page();
    const got = KEYS.reduce((n, k) => n + byClass(article(html, k), 'span', 'status').filter((s) => s.attrs['data-state'] === state).length, 0);
    const want = KEYS.reduce((n, k) => n + statusCounts(docMd(k)).states[state], 0);
    expect(got).toBe(want);
  });

  it('"Not covered – out of scope" cells are grey `out` chips, never red `wrong` (none of the live Status cells is wrong today)', () => {
    const html = page();
    const outCells = KEYS.reduce((n, k) => n + statusCounts(docMd(k)).states.out, 0);
    expect(outCells, 'the coverage report has out-of-scope rows').toBeGreaterThan(0);
    for (const k of KEYS) {
      for (const row of elements(article(html, k), 'tr')) {
        if (!/out of scope/.test(textOf(row.inner)) || !/Not covered/.test(textOf(row.inner))) continue;
        const s = byClass(row.inner, 'span', 'status');
        for (const c of s) if (/Not covered/.test(textOf(c.inner))) expect(c.attrs['data-state'], textOf(row.inner).slice(0, 80)).toBe('out');
      }
    }
  });
});
    expect(r.status, `stderr: ${r.stderr.slice(0, 600)}`).toBe(0);
    expect(existsSync(out)).toBe(true);
  });
});

dd('B29 output vs the live documents: IDs (B29-R5)', () => {
  it('every leading ID of a first table cell in the live documents is the id of a row (or an empty span in it)', () => {
    const html = page();
    const ids = new Set(allIds(html));
    const missing = [];
    let n = 0;
    for (const key of KEYS) {
      for (const t of tables(docMd(key))) {
        for (const r of t.rows) {
          for (const id of leadingIds(r.cells[0] ?? '')) {
            n++;
            if (!ids.has(id)) missing.push(`${DOC_FILES[key]}:${r.line} ${id}`);
          }
        }
      }
    }
    expect(n).toBeGreaterThan(100);
    expect(missing).toEqual([]);
  });

  it('every chip whose ID is defined in the page is an <a href="#ID"> that resolves; an undefined ID stays a span', () => {
    const html = page();
    const ids = new Set(allIds(html));
    const wrong = chips(html).filter((c) => (ids.has(c.id) ? !(c.tag === 'a' && c.href === `#${c.id}`) : c.tag !== 'span'));
    expect(wrong.map((c) => `${c.tag} ${c.id}`)).toEqual([]);
  });

  it('the Go-to-ID datalist equals the set of all chip IDs plus all defined IDs, sorted', () => {
    const html = page();
    const dl = elements(html, 'datalist')[0];
    const opts = tags(dl.inner, 'option').map((o) => o.attrs.value);
    const expected = new Set(chips(html).map((c) => c.id));
    for (const id of allIds(html)) if (ID_RE.test(id)) expected.add(id);
    expect(new Set(opts)).toEqual(expected);
    expect(opts).toEqual([...opts].sort());
    expect(opts).toContain('US-01');
  });

  it('the Legend diagram (first figure of the domain overview) names all five box states, including "outside this tool" (revision 35)', () => {
    const first = mermaidBlocks(docMd('domain'))[0].src;
    for (const c of ['today', 'planned', 'wrong', 'open', 'out']) expect(first).toMatch(new RegExp(`classDef ${c}\\b`));
    const fig = byClass(article(page(), 'domain'), 'figure', 'diagram')[0];
    const list = textOf(byClass(fig.inner, 'details', 'diagram-text')[0].inner);
    for (const s of ['(today)', '(planned)', '(known wrong result today)', '(open or on hold)', '(outside this tool)']) expect(list).toContain(s);
  });
});

describe('B29 output: offline, CSP, size and script (B29-INV-OFFLINE, decision 7)', () => {
  it.each([
    ['<script src>', (h) => tags(h, 'script').filter((s) => 'src' in s.attrs).length],
    ['<link>', (h) => tags(h, 'link').length],
    ['@import', (h) => (h.match(/@import/g) ?? []).length],
    ['inline event-handler attributes', (h) => (h.match(/\son[a-z]+\s*=\s*["']/gi) ?? []).length],
  ])('no %s', (_n, count) => {
    expect(count(page())).toBe(0);
  });

  it('the only external URL is the Alterna logo (xmlns and the CSP meta excluded)', () => {
    const urls = [...page().replace(/<meta\b[^>]*>/gi, '').matchAll(/https?:\/\/[^\s"'<>)]+/g)].map((m) => m[0]).filter((u) => !/^http:\/\/www\.w3\.org\//.test(u));
    expect([...new Set(urls)]).toEqual(['https://www.alterna.ca/media/t0onoi0m/alterna-savings.svg']);
  });

  it('the CSP hash of every inline executable script is in script-src (MUT-12)', () => {
    const html = page();
    const csp = tags(html, 'meta').find((m) => (m.attrs['http-equiv'] ?? '').toLowerCase() === 'content-security-policy');
    expect(csp.attrs.content).toMatch(/default-src 'none'/);
    for (const s of inlineScripts(html)) {
      expect(csp.attrs.content).toContain(`'sha256-${createHash('sha256').update(s.inner).digest('base64')}'`);
    }
  });

  it('script-src carries exactly one base64 sha256 per inline executable script and none for the JSON block (revision 36)', () => {
    const html = page();
    const csp = tags(html, 'meta').find((m) => (m.attrs['http-equiv'] ?? '').toLowerCase() === 'content-security-policy');
    const hashes = [...csp.attrs.content.matchAll(/'sha256-([^']+)'/g)].map((m) => m[1]);
    const scripts = inlineScripts(html);
    expect(scripts.length).toBeGreaterThanOrEqual(2);
    expect(hashes.length).toBe(scripts.length);
    for (const h of hashes) expect(h).toMatch(/^[A-Za-z0-9+/]{43}=$/);
    const json = elements(html, 'script').find((x) => x.attrs.id === 'help-build');
    expect(hashes).not.toContain(createHash('sha256').update(json.inner).digest('base64'));
  });

  it('size is below 3 MB and the tag count below 25,000 (design budget 14)', () => {
    const html = page();
    expect(Buffer.byteLength(html)).toBeLessThan(3 * 1024 * 1024);
    expect((html.match(/<[a-zA-Z][^>]*>/g) ?? []).length).toBeLessThan(25_000);
  });

  it('every inline executable script parses (node --check) and is at most 8,192 bytes', () => {
    const scripts = inlineScripts(page());
    expect(scripts.length).toBeGreaterThanOrEqual(1);
    scripts.forEach((s, i) => {
      expect(Buffer.byteLength(s.inner)).toBeLessThanOrEqual(8192);
      const f = join(tmp('b29-script-'), `s${i}.mjs`);
      writeFileSync(f, s.inner);
      const r = spawnSync(process.execPath, ['--check', f], { encoding: 'utf8' });
      expect(r.status, r.stderr).toBe(0);
    });
  });

  it('the fingerprint block lists the three documents (full sha256) and both package versions', () => {
    const fp = elements(page(), 'script').find((s) => s.attrs.id === 'help-build');
    expect(fp).toBeTruthy();
    const s = JSON.stringify(JSON.parse(fp.inner));
    for (const file of Object.values(DOC_FILES)) expect(s).toContain(file);
    expect(s).toContain('15.0.2');
    expect(s).toContain('11.17.2');
    expect((s.match(/[0-9a-f]{64}/g) ?? []).length).toBeGreaterThanOrEqual(4); // 3 documents + generator
  });

  it('no article carries a hidden attribute in the static HTML, and a <noscript> fallback exists', () => {
    const html = page();
    for (const a of tags(html, 'article')) expect('hidden' in a.attrs).toBe(false);
    expect(tags(html, 'article').length).toBe(3);
    expect(html).toMatch(/<noscript\b/);
  });

  it('one <main>, <html lang="en">, the skip link first, header / two labelled navs plus per-document TOCs / footer', () => {
    const html = page();
    expect(tags(html, 'main').length).toBe(1);
    expect(tags(html, 'html')[0].attrs.lang).toBe('en');
    expect(tags(html, 'a')[0].attrs.href).toBe('#doc-content');
    expect(tags(html, 'header').length).toBe(1);
    expect(tags(html, 'footer').length).toBe(1);
    expect(elements(html, 'nav').filter((n) => n.attrs['aria-label'] === 'Documents').length).toBe(1);
    expect(elements(html, 'nav').every((n) => (n.attrs['aria-label'] ?? '').length > 0)).toBe(true);
  });
});

describe('B29 output: tokens and contrast arithmetic on help.css (check 19, differences list 8)', () => {
  const css = () => read(CSS_PATH);
  const tok = () => cssTokens(css());
  const STATES = ['covered', 'planned', 'wrong', 'open', 'partial', 'out']; // out: the grey state of Q-HELP-OUTSCOPE

  it.each(STATES.flatMap((s) => [[s, 'light'], [s, 'dark']]))('status %s (%s): ink on bg >= 4.5 and line on bg >= 3', (state, scheme) => {
    const t = tok()[scheme];
    const [bg, line, ink] = ['bg', 'line', 'ink'].map((k) => t[`--status-${state}-${k}`]);
    expect(bg && line && ink, `--status-${state}-{bg,line,ink} defined for ${scheme}`).toBeTruthy();
    expect(contrast(ink, bg)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(line, bg)).toBeGreaterThanOrEqual(3);
  });

  it.each(['light', 'dark'])('%s: body ink on paper >= 4.5, mark ink on mark bg >= 4.5, muted ink on paper >= 4.5', (scheme) => {
    const t = tok()[scheme];
    expect(contrast(t['--ink'], t['--paper'])).toBeGreaterThanOrEqual(4.5);
    expect(contrast(t['--mark-ink'], t['--mark-bg'])).toBeGreaterThanOrEqual(4.5);
    expect(contrast(t['--ink-muted'], t['--paper'])).toBeGreaterThanOrEqual(4.5);
  });

  it('the shared tokens in help.css equal visual_design/app-ui.tokens.css, light and dark (drift guard; fonts excluded)', () => {
    if (!existsSync(TOKENS_CSS)) return; // skipIf: the design folder is absent
    const mine = tok();
    const theirs = cssTokens(read(TOKENS_CSS));
    const norm = (v) => v.replace(/\s+/g, ' ').toLowerCase();
    for (const scheme of ['light', 'dark']) {
      const shared = Object.keys(theirs[scheme]).filter((k) => k in mine[scheme] && !k.startsWith('--font-'));
      expect(shared.length, `${scheme}: tokens shared with the design file`).toBeGreaterThanOrEqual(11);
      for (const k of ['--paper', '--paper-raised', '--ink', '--ink-muted', '--heading', '--accent', '--accent-hover', '--accent-soft', '--rule', '--rule-strong', '--focus']) {
        expect(k in mine[scheme], `${k} (${scheme}) in help.css`).toBe(true);
      }
      for (const k of shared) expect(norm(mine[scheme][k]), `${scheme} ${k}`).toBe(norm(theirs[scheme][k]));
    }
  });

  it('CSS pins in the shipped page: planned line #b45309, dark scheme, forced colours, reduced motion, white diagram frame, landscape @page for the coverage report', () => {
    const html = page();
    const style = elements(html, 'style').map((s) => s.inner).join('\n');
    expect(style).toMatch(/--status-planned-line\s*:\s*#b45309/i);
    expect(style).toMatch(/@media\s*\(\s*prefers-color-scheme\s*:\s*dark\s*\)/);
    expect(style).toMatch(/@media\s*\(\s*forced-colors\s*:\s*active\s*\)/);
    expect(style).toMatch(/prefers-reduced-motion/);
    const frame = cssBlocks(style).find((b) => /\.diagram-frame\s*$/.test(b.selector.trim()) && b.parents.length === 0);
    expect(frame, '.diagram-frame rule').toBeTruthy();
    expect(frame.body).toMatch(/background(?:-color)?\s*:\s*(?:#fff(?:fff)?|white)\b/i);
    expect(style).toMatch(/@page[^{]*\{[^}]*landscape/);
    expect(style).toMatch(/doc-coverage/);
  });

  it('the page inlines help.css and help.client.js verbatim (one self-contained file)', () => {
    const html = page();
    const style = elements(html, 'style').map((s) => s.inner).join('\n');
    expect(style).toContain(css().trim().slice(0, 200));
    const client = read(join(HELP, 'assets', 'help.client.js')).trim();
    expect(inlineScripts(html).some((s) => s.inner.includes(client.slice(0, 200)))).toBe(true);
    expect(Buffer.byteLength(read(join(HELP, 'assets', 'help.client.js')))).toBeLessThanOrEqual(8192);
  });
});
