/**
 * B29 build rules R1..R12 on mini document sets and a STUB renderer (no Chrome, B29 tests list).
 * The builder runs as a child process: node help/build-help.mjs --docs <tmp> --out <tmp> --renderer <stub>.
 * QA 2026-09-30. Needs the packages (skipped when help/node_modules is absent, B29-X7 vi) and is red
 * until sr-dev writes help/build-help.mjs. Deleted with the help/ folder.
 * Contract of the stub and its model: fixtures/STUB-CONTRACT.md.
 */
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  COB, HELP, INSTALLED, STUB, STUB_EMPTY, STUB_FAIL, STUB_SHORT, STUB_SYNC, allIds, article, balanced, build, buildDocs, byClass, chips, elements,
  inlineScripts, mermaidBlock, mkDocs, read, tags, textOf, tmp,
} from './support/common.mjs';
import { countCells as oracleCountCells } from './support/docs-lint.mjs';

const d = describe.skipIf(!INSTALLED);
const lazy = (fn) => {
  let v;
  let done = false;
  return () => (done ? v : ((done = true), (v = fn())));
};
const sha = (s) => createHash('sha256').update(s).digest('hex');
const fail = (r, re) => {
  expect(r.status, `stderr: ${r.stderr.slice(0, 400)}`).toBe(1);
  if (re) expect(r.stderr + r.stdout).toMatch(re);
  expect(r.html, 'a failed build must not write the output').toBeNull();
};

d('T1 registry (B29-R1, decision 2)', () => {
  it('a missing registry file fails the build and names it', () => {
    const m = mkDocs();
    rmSync(join(m.dir, 'COB-coverage.md'));
    const r = build({ docs: m.dir, out: m.out, renderer: STUB });
    expect(r.status).toBe(1);
    expect(r.stderr + r.stdout).toMatch(/COB-coverage\.md/);
    expect(existsSync(m.out)).toBe(false);
  });

  it('an extra .md in the documents folder fails the build ("add it to the registry or move it")', () => {
    const m = mkDocs();
    writeFileSync(join(m.dir, 'EXTRA-NOTES.md'), '# Extra\n');
    const r = build({ docs: m.dir, out: m.out, renderer: STUB });
    expect(r.status).toBe(1);
    expect(r.stderr + r.stdout).toMatch(/EXTRA-NOTES\.md/);
    expect(r.stderr + r.stdout).toMatch(/registry/i);
    expect(existsSync(m.out)).toBe(false);
  });

  it('keys, tab order and article ids: manual, coverage, domain', () => {
    const r = buildDocs();
    expect(r.status, r.stderr).toBe(0);
    const nav = elements(r.html, 'nav').find((n) => n.attrs['aria-label'] === 'Documents');
    expect(nav, 'nav[aria-label="Documents"] missing').toBeTruthy();
    const hrefs = tags(nav.inner, 'a').map((a) => a.attrs.href);
    expect(hrefs).toEqual(['#doc-manual', '#doc-coverage', '#doc-domain']);
    const labels = elements(nav.inner, 'a').map((a) => textOf(a.inner));
    expect(labels[0]).toMatch(/^User manual/);
    expect(labels[1]).toMatch(/^Coverage report/);
    expect(labels[2]).toMatch(/^Domain overview/);
    const order = ['doc-manual', 'doc-coverage', 'doc-domain'].map((id) => r.html.indexOf(`id="${id}"`));
    expect(order.every((i) => i > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });
});

d('T2 Markdown subset (B29-R2, revision 36): each violation fails with docs/<file>:<line>, all failures reported together', () => {
  /** The distinct line numbers the build names for COB-user-manual.md, sorted. */
  const linesOf = (r, file = 'COB-user-manual\\.md') =>
    [...new Set([...(r.stderr + r.stdout).matchAll(new RegExp(`${file}:(\\d+)`, 'g'))].map((m) => Number(m[1])))].sort((x, y) => x - y);
  const T = (body) => `# T\n\n## A\n\n${body}\n`; // the body starts on line 5
  const tbl = (...rows) => T(['| a | b |', '|---|---|', ...rows].join('\n')); // header 5, delimiter 6, first row 7

  it.each([
    // [what, markdown, expected reported lines]
    ['a heading deeper than H3', '# T\n\n## A\n\n### B\n\n#### Too deep\n', [7]],
    ['an image without alt text', T('![](picture.png)'), [5]],
    ['an image with alt text but a relative source', T('![logo](picture.png)'), [5]],
    ['an image with alt text and an http source (the CSP allows only data: and the logo)', T('![logo](https://example.com/x.png)'), [5]],
    ['a data: image without alt text', T('![](data:image/png;base64,AAAA)'), [5]],
    ['a task-list item "[ ]"', T('- [ ] open task'), [5]],
    ['a task-list item "[x]"', T('- [x] done task'), [5]],
    ['a task-list item "[X]" under an asterisk', T('* [X] done task'), [5]],
    ['a footnote reference and its definition (every matching source line)', '# T\n\n## A\n\nText with a note.[^1]\n\n[^1]: The note.\n', [5, 7]],
    ['a footnote definition alone (the parser swallows it silently; the source-line scan finds it)', T('[^1]: The note.'), [5]],
    ['a relative link', T('See [the file](other.md).'), [5]],
    ['a mailto link', T('Write to [us](mailto:someone@example.com).'), [5]],
    ['a link to a #id that resolves nowhere', T('See [nothing](#nowhere-here).'), [5]],
    ['a relative link inside a table cell (the line of the row, not of the table)', tbl('| [x](rel.md) | 2 |'), [7]],
    ['a one-column table', T('| a |\n|---|\n| 1 |'), [5]],
    ['a body row with 3 cells under a 2-column header (the row line)', tbl('| 1 | 2 | 3 |'), [7]],
    ['a body row with 1 cell under a 2-column header (the row line; the parser pads it, so only the source line shows it)', tbl('| 1 |'), [7]],
    ['the second body row is ragged (its own line)', tbl('| 1 | 2 |', '| 3 |', '| 5 | 6 |'), [8]],
    ['a header whose delimiter row has fewer cells (the parser refuses the table; rule 9, the header line)', T('| a | b |\n|---|\n| 1 | 2 |'), [5]],
    ['a header whose delimiter row has more cells (rule 9)', T('| a |\n|---|---|\n| 1 |'), [5]],
    ['an html block <div>', T('<div>raw</div>'), [5]],
    ['an html comment block', T('<!-- hidden note -->'), [5]],
    ['a <br> on a line of its own', T('<br>'), [5]],
    ['inline html <b> in a paragraph', T('Some <b>bold</b> text.'), [5]],
    ['inline html on the second line of a paragraph (the line of the paragraph start)', T('first line\nsecond <b>line</b>'), [5]],
    ['an inline html comment', T('Text <!-- gone --> text.'), [5]],
    ['<br> inside a table body cell (the row line: tr_open)', tbl('| x<br>y | 2 |'), [7]],
    ['<b> inside a table header cell (the header row line)', T('| a<b>x</b> | b |\n|---|---|\n| 1 | 2 |'), [5]],
    ['an html comment inside a table cell', tbl('| x <!-- c --> | 2 |'), [7]],
  ])('%s -> exit 1, names exactly these lines %j, nothing written', (_n, md, lines) => {
    const r = buildDocs({ manual: md });
    fail(r);
    expect(linesOf(r), `stderr: ${r.stderr.slice(0, 500)}`).toEqual(lines);
  });

  it('every failure of every document is reported before exit 1, in file order then line order (a heading on line 7, a task on 9, a relative link on 11; plus a failing coverage report)', () => {
    const manual = '# T\n\n## A\n\n### B\n\n#### deep\n\n- [ ] task\n\nSee [x](rel.md).\n';
    const coverage = '# C\n\n## 1. T\n\n#### deep too\n';
    const r = buildDocs({ manual, coverage });
    fail(r);
    expect(linesOf(r)).toEqual([7, 9, 11]);
    expect(linesOf(r, 'COB-coverage\\.md')).toEqual([5]);
    const out = r.stderr + r.stdout;
    const at = (re) => out.search(re);
    expect(at(/COB-user-manual\.md:7\b/)).toBeGreaterThan(-1);
    expect(at(/COB-user-manual\.md:9\b/)).toBeGreaterThan(at(/COB-user-manual\.md:7\b/));
    expect(at(/COB-user-manual\.md:11\b/)).toBeGreaterThan(at(/COB-user-manual\.md:9\b/));
    expect(at(/COB-coverage\.md:5\b/)).toBeGreaterThan(at(/COB-user-manual\.md:11\b/));
  });

  it('a document without exactly one H1 fails (none, and two)', () => {
    fail(buildDocs({ manual: '## A\n\ntext\n' }), /COB-user-manual\.md/);
    fail(buildDocs({ manual: '# One\n\n# Two\n\n## A\n' }), /COB-user-manual\.md/);
  });

  it('what is NOT raw html or a footnote passes: an autolink, a code span with <b>, fenced code with <div> and [^1], a code span with [^1], and a Mermaid block holding <br/> (MUT-13, MUT-40)', () => {
    const md = T([
      'An autolink <https://example.com/x> is a link, not html.',
      '',
      'A code span `<b>x</b>` and a note-like `[^1]` in code.',
      '',
      '```',
      '<div>in a fence</div>',
      '[^1]: not a footnote',
      '```',
    ].join('\n'));
    const r = buildDocs({ manual: md });
    expect(r.status, r.stderr).toBe(0);
    expect(article(r.html, 'manual')).toContain('&lt;div&gt;in a fence&lt;/div&gt;');
    const dom = buildDocs({ domain: '# D\n\n## A\n\n' + mermaidBlock(null, 'flowchart LR\n    A["Line one<br/>Line two"]:::today --> B["Beta"]') });
    expect(dom.status, dom.stderr).toBe(0);
  });

  it('a data: image with alt text builds', () => {
    const r = buildDocs({ manual: T('![a dot](data:image/png;base64,iVBORw0KGgo=)') });
    expect(r.status, r.stderr).toBe(0);
  });

  it('the allowed subset builds: bold, code spans, nested lists, blockquote, rule, fenced code, strikethrough, http links, #id links', () => {
    const md = [
      '# T', '', '## 1. A', '', '**bold** `code` ~~gone~~ and [site](https://example.com/page).', '',
      '- one', '  - nested', '    - deeper', '', '1. first', '2. second', '', '> a quote', '', '---', '',
      '```', 'plain fence', '```', '', 'See [section A](#manual-a).', '',
    ].join('\n');
    const r = buildDocs({ manual: md });
    expect(r.status, r.stderr).toBe(0);
    expect(r.html).toContain('<blockquote');
    expect(r.html).toMatch(/<(?:s|del)>gone<\/(?:s|del)>/);
  });

  // The ten vectors of countCells(line) in B29-R2. The function is internal to the build, so each vector is
  // pinned through the build: a header with exactly n cells over the vector as a body row passes only when
  // the build counts n (a count of n-1 or n+1 differs from the header; MUT-41, MUT-42). `| 1 |` (n = 1) has
  // no 1-column legal header, so it is the failing case under a 2-column header.
  it.each([
    ['| a | b |', 2],
    ['| 1 | 2 | 3 |', 3],
    ['| `x|y` | 2 |', 2],
    ['| p \\| q | 2 |', 2],
    ['| `` a|b `` | c |', 2],
    ['a | b', 2],
    ['| a | b', 2],
    ['|a|b|', 2],
    ['| | |', 2],
  ])('countCells vector %j is %i cells: a %i-column header over it builds', (row, n) => {
    const head = '| ' + Array.from({ length: n }, (_, i) => `h${i + 1}`).join(' | ') + ' |';
    const delim = '|' + '---|'.repeat(n);
    const r = buildDocs({ manual: T([head, delim, row].join('\n')) });
    expect(r.status, `${row} -> expected ${n} cells; ${r.stderr.slice(0, 300)}`).toBe(0);
  });

  it('countCells vector "| 1 |" is 1 cell: it fails under a 2-column header, naming its line', () => {
    const r = buildDocs({ manual: tbl('| 1 |') });
    fail(r);
    expect(linesOf(r)).toEqual([7]);
  });
});

// Revision 38: countCells is a named export of help/lib/markdown.mjs (a pure function, no I/O). Direct tests against QA's
// own oracle (support/docs-lint.mjs, never the library copy) on the ten vectors, 200 random rows and the edge strings.
describe('T2a countCells, imported directly from help/lib/markdown.mjs (B29-R2, revision 38)', () => {
  const lib = async () => {
    const p = join(HELP, 'lib', 'markdown.mjs');
    expect(existsSync(p), 'help/lib/markdown.mjs is missing (red until sr-dev writes it)').toBe(true);
    const mod = await import(pathToFileURL(p).href);
    expect(typeof mod.countCells, 'countCells must be a named export of help/lib/markdown.mjs').toBe('function');
    return mod.countCells;
  };
  const VECTORS = [
    ['| a | b |', 2], ['| 1 |', 1], ['| 1 | 2 | 3 |', 3], ['| `x|y` | 2 |', 2], ['| p \\| q | 2 |', 2],
    ['| `` a|b `` | c |', 2], ['a | b', 2], ['| a | b', 2], ['|a|b|', 2], ['| | |', 2],
  ];

  it('the ten vectors of B29-R2 give the pinned counts, and the oracle agrees with them', async () => {
    const countCells = await lib();
    expect(VECTORS.map(([row]) => countCells(row))).toEqual(VECTORS.map(([, n]) => n));
    expect(VECTORS.map(([row]) => oracleCountCells(row))).toEqual(VECTORS.map(([, n]) => n));
  });

  it('200 random rows (fixed seed; pipes, backticks, backslashes, spaces) equal the oracle', async () => {
    const countCells = await lib();
    const alphabet = ['a', 'b', 'x', ' ', ' ', '|', '|', '|', '`', '``', '```', '\\', '\\|', '| ', ' |'];
    let seed = 20260930;
    const rnd = (n) => ((seed = (seed * 1103515245 + 12345) % 2147483648), seed % n);
    const rows = Array.from({ length: 200 }, () => Array.from({ length: 3 + rnd(14) }, () => alphabet[rnd(alphabet.length)]).join(''));
    const diff = rows.filter((r) => countCells(r) !== oracleCountCells(r)).map((r) => `${JSON.stringify(r)} lib ${countCells(r)} oracle ${oracleCountCells(r)}`);
    expect(diff).toEqual([]);
    expect(new Set(rows.map(oracleCountCells)).size, 'the random rows are not all alike').toBeGreaterThan(3);
  });

  it.each(['', '|', '||', '   ', '\\', '`', '``|', '| `a', '| a \\', '|| a ||', '  | x |  '])('edge input %j equals the oracle and is a non-negative integer', async (line) => {
    const countCells = await lib();
    const n = countCells(line);
    expect(Number.isInteger(n) && n >= 0).toBe(true);
    expect(n).toBe(oracleCountCells(line));
  });
});

d('T3 heading ids and aliases (B29-R3)', () => {
  const cut48 = (full) => {
    if (full.length <= 48) return full;
    if (full[48] === '-') return full.slice(0, 48);
    const i = full.slice(0, 48).lastIndexOf('-');
    return i > 0 ? full.slice(0, i) : full.slice(0, 48);
  };
  const doc = (heads) => ({ manual: '# T\n\n' + heads.map((h) => `${h}\n\ntext\n`).join('\n') });
  const heading = (html, level, id) => {
    const art = article(html, 'manual');
    const hs = elements(art, `h${level}`);
    return hs.find((h) => h.attrs.id === id);
  };

  it('primary id is <key>-<slug> without the number, lower-case, runs of non-alphanumerics become one hyphen; heading has tabindex -1', () => {
    const r = buildDocs(doc(['## 4. Intentional differences (Excel) & more!']));
    expect(r.status, r.stderr).toBe(0);
    const h = heading(r.html, 2, 'manual-intentional-differences-excel-more');
    expect(h, 'no h2 with the expected primary id').toBeTruthy();
    expect(h.attrs.tabindex).toBe('-1');
  });

  it('a numbered H2 gets the alias <key>-<number> on an empty span immediately before the heading (MUT-7)', () => {
    const r = buildDocs(doc(['## 4. Intentional differences']));
    expect(r.html).toMatch(/<span\s+id="manual-4"\s*>\s*<\/span>\s*<h2\b/);
  });

  it('a numbered H3 "4.2 Pending" gets the alias manual-4-2 and the primary id manual-pending', () => {
    const r = buildDocs(doc(['## 4. Differences', '### 4.2 Pending']));
    expect(r.html).toMatch(/<span\s+id="manual-4-2"\s*>\s*<\/span>\s*<h3\b/);
    expect(heading(r.html, 3, 'manual-pending')).toBeTruthy();
  });

  it('a long slug is cut at most 48 characters at a hyphen boundary (MUT-22)', () => {
    const text = 'This is a really long heading about the waterfall calculation of interest';
    const slug = text.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const expected = cut48(slug);
    expect(expected.length).toBeLessThanOrEqual(48);
    expect(expected.endsWith('-')).toBe(false);
    const r = buildDocs(doc([`## ${text}`]));
    expect(heading(r.html, 2, `manual-${expected}`), `expected id manual-${expected}`).toBeTruthy();
  });

  it('a first word longer than 48 characters is hard-cut at 48', () => {
    const word = 'a'.repeat(60);
    const r = buildDocs(doc([`## ${word} tail`]));
    expect(heading(r.html, 2, `manual-${'a'.repeat(48)}`)).toBeTruthy();
  });

  it('a repeated primary id gets -2, -3 in document order', () => {
    const r = buildDocs(doc(['## Overview', '## Overview', '## Overview']));
    const ids = elements(article(r.html, 'manual'), 'h2').map((h) => h.attrs.id);
    expect(ids).toEqual(['manual-overview', 'manual-overview-2', 'manual-overview-3']);
  });

  it('accents are removed (NFKD) and apostrophes become hyphens', () => {
    const r = buildDocs(doc(["## Zoë's naïve façade"]));
    expect(heading(r.html, 2, 'manual-zoe-s-naive-facade')).toBeTruthy();
  });

  it('two numbered headings with the same number collide on the alias and fail the build', () => {
    fail(buildDocs(doc(['## 4. First', '## 4. Second'])), /manual-4|alias|collid|duplicate/i);
  });

  it('a heading id equal to a figure id fails the build (ids unique case-insensitively across the page; MUT-8)', () => {
    const domain = '# D\n\n## Fig 1\n\ntext\n\n' + mermaidBlock(null);
    fail(buildDocs({ domain }), /domain-fig-1|collid|duplicate/i);
  });

  it('H1 gets no anchor link, no alias and no TOC entry, but carries id <key>-title (revision 36); the article carries id doc-<key>', () => {
    const r = buildDocs(doc(['## A']));
    for (const key of ['manual', 'coverage', 'domain']) {
      const h1 = elements(article(r.html, key), 'h1')[0];
      expect(h1, `${key} h1`).toBeTruthy();
      expect(h1.attrs.id, `${key} h1 id`).toBe(`${key}-title`);
      expect(h1.inner).not.toMatch(/class="[^"]*\banchor\b/);
    }
    expect(r.html).not.toContain('href="#manual-title"'); // no anchor and no TOC entry
    expect(r.html).not.toMatch(/<span\s+id="manual-title"/); // no alias span
    expect(tags(r.html, 'article')[0].attrs.id).toBe('doc-manual');
  });

  it('the H1 id takes part in the collision check: a heading "Title" (primary id manual-title) fails the build', () => {
    fail(buildDocs(doc(['## Title'])), /manual-title|collid|duplicate/i);
  });

  it('every H2/H3 has <a class="anchor" href="#id" aria-label="Link to section: <text>">#</a>', () => {
    const r = buildDocs(doc(['## 1. Alpha section', '### 1.1 Beta part']));
    for (const [lvl, id, text] of [[2, 'manual-alpha-section', '1. Alpha section'], [3, 'manual-beta-part', '1.1 Beta part']]) {
      const h = heading(r.html, lvl, id);
      const a = tags(h.inner, 'a').find((x) => (x.attrs.class ?? '').split(/\s+/).includes('anchor'));
      expect(a, `no anchor in ${id}`).toBeTruthy();
      expect(a.attrs.href).toBe(`#${id}`);
      expect(a.attrs['aria-label']).toBe(`Link to section: ${text.replace(/^[\d.]+\s+/, (m) => m)}`);
    }
  });
});

d('T4 table of contents (B29-R4)', () => {
  const md = '# Doc title\n\n## 1. Alpha\n\n### 1.1 Alpha one\n\n### 1.2 Alpha two\n\n## 2. Beta\n\ntext\n';
  const toc = (html) => elements(html, 'nav').find((n) => /^Contents of the /.test(n.attrs['aria-label'] ?? '') && n.inner.includes('Alpha'));

  it('one nav per document, labelled "Contents of the <title>", link text equals the heading text with numbers kept', () => {
    const r = buildDocs({ manual: md });
    const navs = elements(r.html, 'nav').filter((n) => /^Contents of the /.test(n.attrs['aria-label'] ?? ''));
    expect(navs.length).toBe(3);
    const t = toc(r.html);
    expect(t.attrs['aria-label']).toBe('Contents of the Doc title');
    expect(elements(t.inner, 'a').map((a) => textOf(a.inner))).toEqual(['1. Alpha', '1.1 Alpha one', '1.2 Alpha two', '2. Beta']);
  });

  it('H3 entries sit one list level deeper than H2 entries', () => {
    const t = toc(buildDocs({ manual: md }).html);
    const depthAt = (needle) => {
      const at = t.inner.indexOf(needle);
      const before = t.inner.slice(0, at);
      return (before.match(/<ul\b|<ol\b/g) ?? []).length - (before.match(/<\/ul>|<\/ol>/g) ?? []).length;
    };
    expect(depthAt('1.1 Alpha one')).toBe(depthAt('1. Alpha') + 1);
    expect(depthAt('2. Beta')).toBe(depthAt('1. Alpha'));
  });

  it('every TOC href is unique and resolves to an id in the page', () => {
    const r = buildDocs({ manual: md });
    const ids = new Set(allIds(r.html));
    for (const nav of elements(r.html, 'nav').filter((n) => /^Contents of the /.test(n.attrs['aria-label'] ?? ''))) {
      const hrefs = tags(nav.inner, 'a').map((a) => a.attrs.href);
      expect(new Set(hrefs).size).toBe(hrefs.length);
      for (const h of hrefs) expect(ids.has(h.slice(1)), h).toBe(true);
    }
  });
});

d('T5 ID chips (B29-R5): the pattern, in text nodes only', () => {
  const run = (para) => {
    const r = buildDocs({ manual: `# T\n\n## A\n\n${para}\n` });
    expect(r.status, r.stderr).toBe(0);
    return { r, art: article(r.html, 'manual') };
  };
  const bodyChips = (art) => chips(art.replace(/<nav[\s\S]*?<\/nav>/g, '')).map((c) => c.id);

  it.each([
    ['B24 is planned', ['B24']],
    ['B2400 is not a chip', []],
    ['See US-04 now', ['US-04']],
    ['Wait for Q-SEMI-SHOW first', ['Q-SEMI-SHOW']],
    ['The rule DEV-W-interim applies', ['DEV-W']],
    ['Decisions (OQ-P, OQ-Q) apply', ['OQ-P', 'OQ-Q']],
    ['A trailing hyphen DEV-OQP- is not part of the id', ['DEV-OQP']],
    ['Lower case us-04 is not a chip', []],
    ['Item A4 and F1', ['A4', 'F1']],
    ['Feedback FB-11 arrives', ['FB-11']],
    ['One chip only for Q-B8-1', ['Q-B8-1']],
  ])('"%s" -> chips %j', (text, expected) => {
    const { art } = run(text);
    expect(bodyChips(art)).toEqual(expected);
  });

  it('DEV-W-interim is the chip DEV-W followed by the plain text "-interim" (revision 36; the pattern is uppercase and digits only)', () => {
    const { art } = run('The rule DEV-W-interim applies.');
    expect(art).toMatch(/<span class="id" data-id="DEV-W">DEV-W<\/span>-interim applies/);
    expect(bodyChips(art)).toEqual(['DEV-W']);
  });

  it('B2400 and us-04 stay plain text; B24 and B240 are chips', () => {
    const { art } = run('B2400 us-04 B24 B240');
    expect(bodyChips(art)).toEqual(['B24', 'B240']);
  });

  it('inside a code span: no chip (MUT-6)', () => {
    const { art } = run('Use `US-04` and `B24` literally.');
    expect(bodyChips(art)).toEqual([]);
  });

  it('inside a heading: no chip; inside link text: no chip', () => {
    const r = buildDocs({ manual: '# T\n\n## About US-04\n\nSee [US-04](https://example.com/) here.\n' });
    const art = article(r.html, 'manual');
    const h2 = elements(art, 'h2')[0];
    expect(h2.inner).not.toMatch(/class="[^"]*\bid\b/);
    const link = elements(art, 'a').find((a) => a.attrs.href === 'https://example.com/');
    expect(link, 'external link missing').toBeTruthy();
    expect(link.inner).not.toMatch(/class="[^"]*\bid\b/);
  });

  it('a chip is <span class="id" data-id="ID">ID</span> when the ID is not defined in the page', () => {
    const { art } = run('Plain B24 here.');
    expect(art).toMatch(/<span class="id" data-id="B24">B24<\/span>/);
  });
});

d('T6 definitions, links and the ID index (B29-R5)', () => {
  const COVERAGE = [
    '# Cov', '', '## 1. Rows', '',
    '| ID | What | Status |', '|---|---|---|',
    '| US-04 | Title | Covered |',
    '| OQ-W3, OQ-W5 | A question | Open decision |',
    '| **DEV-W-interim** / **DEV-W** | A rule | Covered |',
    '| UC-01 Calculate COB | A use case | Covered |',
    '', 'Prose cites US-04, OQ-W5, UC-01 and also B24 and the unknown FB-77.', '',
  ].join('\n');
  const MANUAL = '# M\n\n## A\n\nThe manual mentions US-04 and DEV-W.\n';
  const build1 = () => buildDocs({ coverage: COVERAGE, manual: MANUAL });

  it('defining rows: id on the <tr>, extra IDs in the leading list on empty spans, UC-01 with a title, DEV-W once; the first cell has a copy-link #', () => {
    const r = build1();
    expect(r.status, r.stderr).toBe(0);
    const art = article(r.html, 'coverage');
    const trs = elements(art, 'tr');
    const row = (id) => trs.find((t) => t.attrs.id === id);
    expect(row('US-04'), 'tr id=US-04').toBeTruthy();
    expect(row('OQ-W3'), 'tr id=OQ-W3').toBeTruthy();
    expect(row('UC-01'), 'tr id=UC-01').toBeTruthy();
    expect(row('DEV-W'), 'tr id=DEV-W').toBeTruthy();
    expect(row('OQ-W3').inner).toMatch(/<span\s+id="OQ-W5"\s*>\s*<\/span>/);
    expect(allIds(r.html).filter((i) => i === 'DEV-W').length).toBe(1);
    expect(allIds(r.html).filter((i) => i === 'US-04').length).toBe(1);
    const firstCell = /<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/.exec(row('US-04').inner)[1];
    expect(firstCell).toMatch(/>#</);
    expect(firstCell).toContain('#US-04');
  });

  it('an ID that appears twice in the same first cell is ONE definition, and DEV-W-interim in prose becomes a link plus the plain text -interim (revision 36)', () => {
    const cov = '# Cov\n\n## 1. Rows\n\n| ID | Status |\n|---|---|\n| US-09 / US-09 | Covered |\n| **DEV-W-interim** / **DEV-W** | Covered |\n| DEV-X-interim, DEV-Y | Covered |\n\nProse: DEV-W-interim and US-09 and DEV-Y.\n';
    const r = buildDocs({ coverage: cov });
    expect(r.status, r.stderr).toBe(0);
    expect(allIds(r.html).filter((i) => i === 'US-09').length).toBe(1);
    expect(allIds(r.html).filter((i) => i === 'DEV-W').length).toBe(1);
    // a lowercase suffix belongs to its ID, so the next ID in the list is still part of the leading list
    expect(allIds(r.html).filter((i) => i === 'DEV-X').length).toBe(1);
    expect(allIds(r.html).filter((i) => i === 'DEV-Y').length).toBe(1);
    expect(article(r.html, 'coverage')).toMatch(/<a\b[^>]*\bhref="#DEV-W"[^>]*>DEV-W<\/a>-interim and/);
  });

  it('every other occurrence of a defined ID is <a class="id" href="#ID">, in the same document and in another one', () => {
    const r = build1();
    const cov = chips(article(r.html, 'coverage')).filter((c) => c.tag === 'a');
    expect(cov.map((c) => [c.id, c.href]).filter(([id]) => ['US-04', 'OQ-W5', 'UC-01'].includes(id))).toEqual(
      expect.arrayContaining([['US-04', '#US-04'], ['OQ-W5', '#OQ-W5'], ['UC-01', '#UC-01']]),
    );
    const man = chips(article(r.html, 'manual'));
    expect(man.find((c) => c.id === 'US-04')).toMatchObject({ tag: 'a', href: '#US-04' });
    expect(man.find((c) => c.id === 'DEV-W')).toMatchObject({ tag: 'a', href: '#DEV-W' });
  });

  it('IDs not defined in the page stay plain chips (B24, FB-77) and are printed as a sorted "not defined in this page" list; exit 0', () => {
    const r = build1();
    expect(r.status).toBe(0);
    const art = article(r.html, 'coverage');
    expect(chips(art).filter((c) => ['B24', 'FB-77'].includes(c.id)).every((c) => c.tag === 'span')).toBe(true);
    const out = r.stdout + r.stderr;
    expect(out).toMatch(/not defined in this page/i);
    const after = out.slice(out.search(/not defined in this page/i));
    expect(after.indexOf('B24')).toBeGreaterThan(-1);
    expect(after.indexOf('FB-77')).toBeGreaterThan(after.indexOf('B24')); // sorted
  });

  it('an ID defined by two rows fails the build and names both lines', () => {
    const dup = COVERAGE.replace('| UC-01 Calculate COB | A use case | Covered |', '| UC-01 Calculate COB | A use case | Covered |\n| US-04 | Again | Covered |');
    const r = buildDocs({ coverage: dup, manual: MANUAL });
    fail(r, /COB-coverage\.md:7\b/);
    expect(r.stderr + r.stdout).toMatch(/COB-coverage\.md:11\b/);
  });

  it('an ID defined once in each of two documents fails the build too', () => {
    const man = '# M\n\n## A\n\n| ID | Status |\n|---|---|\n| US-04 | Covered |\n';
    fail(buildDocs({ coverage: COVERAGE, manual: man }), /US-04/);
  });

  it('the Go-to-ID datalist equals the sorted set of all chip IDs plus all defined IDs', () => {
    const r = build1();
    const dl = elements(r.html, 'datalist')[0];
    expect(dl, 'no <datalist>').toBeTruthy();
    const opts = tags(dl.inner, 'option').map((o) => o.attrs.value);
    const expected = new Set(chips(r.html).map((c) => c.id));
    for (const id of allIds(r.html)) if (/^(?:(?:US|UC|BR|IN|FB|DEV|OQ|Q)-[A-Z0-9]+(?:-[A-Z0-9]+)*|B\d{1,3}|F\d{1,3}|A\d{1,3})$/.test(id)) expected.add(id);
    expect(new Set(opts)).toEqual(expected);
    expect(opts).toEqual([...opts].sort());
    expect(opts.length).toBe(new Set(opts).size);
  });
});

d('T7 status chips (B29-R6, revision 36): the 13-row mapping, word boundary, longest first, fallback', () => {
  const cov = (cell, header = 'Status') => `# C\n\n## 1. T\n\n| ID | ${header} |\n|---|---|\n| US-01 | ${cell} |\n`;
  const statusOf = (html) => {
    const art = article(html, 'coverage');
    return byClass(art, 'span', 'status').map((s) => ({ state: s.attrs['data-state'], text: textOf(s.inner), inner: s.inner }));
  };
  const rowText = (html) => textOf(elements(article(html, 'coverage'), 'tr').find((t) => /US-01/.test(t.inner)).inner);

  // [cell source, data-state, the words the chip wraps]. Rows 1..13 of the brief's table, then the live examples.
  it.each([
    ['In code, QA-verified', 'covered', 'In code, QA-verified'],
    ['In code, QA-verified (B14, B22)', 'covered', 'In code, QA-verified'],
    ['Partly covered', 'partial', 'Partly covered'],
    ['Partly covered (Not verified)', 'partial', 'Partly covered'],
    ['Partly covered (OQ-J open)', 'partial', 'Partly covered'],
    ['Not covered', 'wrong', 'Not covered'],
    ['Not covered – planned', 'planned', 'Not covered'],
    ['Not covered (planned B25)', 'planned', 'Not covered'],
    ['Not covered – out of scope', 'out', 'Not covered'],
    ['Not covered, out of scope (a deliberate exclusion)', 'out', 'Not covered'],
    ['Not covered – planned (out of scope later)', 'out', 'Not covered'], // "out of scope" is tested first
    ['Not verified', 'open', 'Not verified'],
    ['Open decision', 'open', 'Open decision'],
    ['On hold', 'open', 'On hold'],
    ["Parked (today's behaviour kept)", 'open', 'Parked'],
    ['Covered', 'covered', 'Covered'],
    ['Covered – differs from Excel (DEV-OQS)', 'covered', 'Covered'],
    ['Covered (API only; not on screen)', 'covered', 'Covered'],
    ['Delivered', 'covered', 'Delivered'],
    ['Delivered (B22, B24)', 'covered', 'Delivered'],
    ['Delivered and QA-verified in B27 (3 items)', 'covered', 'Delivered'],
    ['Today', 'covered', 'Today'],
    ['Today; open', 'covered', 'Today'],
    ['Today (B22)', 'covered', 'Today'],
    ['Decided', 'planned', 'Decided'],
    ['Decided, not yet delivered', 'planned', 'Decided'],
    ['Planned', 'planned', 'Planned'],
    ['Planned B25', 'planned', 'Planned'],
    ['change planned', 'planned', 'change planned'],
    ['change planned: B25 (the fee base)', 'planned', 'change planned'],
    ['**Covered**', 'covered', 'Covered'],
    ['**Not covered** – out of scope', 'out', 'Not covered'],
  ])('cell "%s" -> data-state %s; the chip wraps "%s" and the rest of the text follows unchanged', (cell, state, words) => {
    const r = buildDocs({ coverage: cov(cell) });
    expect(r.status, r.stderr).toBe(0);
    const s = statusOf(r.html);
    expect(s.length, `chips for "${cell}"`).toBe(1);
    expect(s[0].state).toBe(state);
    expect(s[0].text.endsWith(words), `chip text "${s[0].text}"`).toBe(true);
    expect(s[0].text.endsWith(words + ' ')).toBe(false);
    expect(s[0].inner).toMatch(/aria-hidden="true"/); // the glyph
    // the document's words are never rewritten: the row's text carries the whole cell (bold markers aside)
    expect(rowText(r.html)).toContain(cell.replace(/\*\*/g, '').replace(/^\s+/, '').replace(/\s+/g, ' '));
  });

  it('"Not covered – out of scope" is the grey `out` state, never the red `wrong` (user decision Q-HELP-OUTSCOPE; MUT-38)', () => {
    const s = statusOf(buildDocs({ coverage: cov('Not covered – out of scope') }).html);
    expect(s.map((x) => x.state)).toEqual(['out']);
    expect(s[0].state).not.toBe('wrong');
  });

  it('"Partly covered" is not read as "Covered", and a bare "Not covered" is `wrong` (MUT-9)', () => {
    expect(statusOf(buildDocs({ coverage: cov('Partly covered') }).html).map((x) => x.state)).toEqual(['partial']);
    expect(statusOf(buildDocs({ coverage: cov('Not covered') }).html).map((x) => x.state)).toEqual(['wrong']);
  });

  it.each([
    ['See Covered rows', 'MUT-36: a status word that is not at the start is no chip'],
    ['covered', 'MUT-9: another letter case is no chip'],
    ['today', 'MUT-9: lower-case Today'],
    ['parked', 'MUT-9: lower-case Parked'],
    ['Change planned', 'the one lower-case entry is case-sensitive: "Change planned" does not match'],
    ['Coveredness', 'MUT-37: no word boundary after the prefix'],
    ['Todays plan', 'MUT-37: Today followed by a letter'],
    ['Delivered2', 'MUT-37: Delivered followed by a digit'],
    ['Partlycovered', 'no space, no chip'],
  ])('cell "%s" matches nothing: no chip, the text stays plain (%s)', (cell) => {
    const r = buildDocs({ coverage: cov(cell) });
    expect(r.status, r.stderr).toBe(0);
    expect(statusOf(r.html)).toEqual([]);
    expect(rowText(r.html)).toContain(cell);
  });

  it('a word boundary is the end of the text or a character that is neither a letter nor a digit: "Today;", "Decided," and "Covered (x)" match', () => {
    for (const [cell, state] of [['Today;', 'covered'], ['Decided,', 'planned'], ['Covered(x)', 'covered'], ['Open decision.', 'open']]) {
      expect(statusOf(buildDocs({ coverage: cov(cell) }).html).map((x) => x.state), cell).toEqual([state]);
    }
  });

  it('"Covered - differs from Excel (DEV-OQS)" keeps the rest of the words and links DEV-OQS when it is defined in the page', () => {
    const md = '# C\n\n## 1. T\n\n| ID | Status |\n|---|---|\n| DEV-OQS | Covered |\n| US-02 | Covered - differs from Excel (DEV-OQS) |\n';
    const r = buildDocs({ coverage: md });
    const art = article(r.html, 'coverage');
    const row = elements(art, 'tr').find((t) => /US-02/.test(t.inner));
    expect(textOf(row.inner)).toContain('differs from Excel (DEV-OQS)');
    expect(chips(row.inner).find((c) => c.id === 'DEV-OQS')).toMatchObject({ tag: 'a', href: '#DEV-OQS' });
  });

  it('a column that is not named Status is untouched (MUT-10); the header "status" in lower case counts (case-insensitive, trimmed)', () => {
    expect(statusOf(buildDocs({ coverage: cov('Covered', 'Notes') }).html)).toEqual([]);
    expect(statusOf(buildDocs({ coverage: cov('Covered', 'status') }).html).map((x) => x.state)).toEqual(['covered']);
  });

  it('an unmatched Status value stays plain text, is printed in the sorted "unmatched Status values" list (distinct, after ** removal, code-unit order), exit 0', () => {
    const md = [
      '# C', '', '## 1. T', '', '| ID | Status |', '|---|---|',
      '| US-01 | Zebra state |', '| US-02 | alpha state |', '| US-03 | Alpha state |', '| US-04 | **Alpha state** |', '| US-05 | Covered |', '',
    ].join('\n');
    const r = buildDocs({ coverage: md });
    expect(r.status).toBe(0);
    expect(statusOf(r.html).map((x) => x.state)).toEqual(['covered']); // only US-05
    const out = r.stdout + r.stderr;
    expect(out).toMatch(/unmatched Status values/i);
    const after = out.slice(out.search(/unmatched Status values/i));
    const at = (v) => after.indexOf(v);
    expect(at('Alpha state')).toBeGreaterThan(-1);
    expect(at('Zebra state')).toBeGreaterThan(at('Alpha state'));
    expect(at('alpha state')).toBeGreaterThan(at('Zebra state')); // code-unit order: upper case before lower case
    expect((after.match(/Alpha state/g) ?? []).length, 'Alpha state is listed once (distinct values)').toBe(1);
    expect(after).not.toContain('**');
    expect(after).not.toMatch(/\bCovered\b/); // a matched value is not listed
  });

  it('revision 38: when every Status cell matches, the build prints no "unmatched Status values" heading or line at all (a clean build is silent)', () => {
    const md = ['# C', '', '## 1. T', '', '| ID | Status |', '|---|---|', '| US-01 | Covered |', '| US-02 | **Planned** |', '| US-03 | Not covered \u2013 out of scope |', ''].join('\n');
    const r = buildDocs({ coverage: md });
    expect(r.status, r.stderr).toBe(0);
    expect(statusOf(r.html).length).toBe(3);
    expect(r.stdout + r.stderr).not.toMatch(/unmatched Status values/i);
  });
});

d('T8 tables (B29-R7)', () => {
  const tbl = (first) => `# T\n\n## 1. Rows here\n\n| Key | Value |\n|---|---|\n| ${first} | x |\n| short | y |\n`;
  const wrapOf = (html, key = 'manual') => byClass(article(html, key), 'div', 'table-wrap')[0];

  it('every table sits in div.table-wrap role=region tabindex=0 with an aria-labelledby that resolves to the nearest preceding heading (MUT-11)', () => {
    const r = buildDocs({ manual: tbl('a') });
    const w = wrapOf(r.html);
    expect(w).toBeTruthy();
    expect(w.attrs.role).toBe('region');
    expect(w.attrs.tabindex).toBe('0');
    expect(w.attrs['aria-labelledby']).toBe('manual-rows-here');
    expect(allIds(r.html)).toContain('manual-rows-here');
  });

  it('a visually hidden <caption> repeats the heading text', () => {
    const w = wrapOf(buildDocs({ manual: tbl('a') }).html);
    const cap = elements(w.inner, 'caption')[0];
    expect(cap, 'no caption').toBeTruthy();
    expect(textOf(cap.inner)).toBe('1. Rows here');
    expect(cap.attrs.class ?? '').toMatch(/visually-hidden|sr-only/);
  });

  it('header cells are th scope="col"', () => {
    const w = wrapOf(buildDocs({ manual: tbl('a') }).html);
    const ths = tags(elements(w.inner, 'thead')[0]?.inner ?? '', 'th');
    expect(ths.length).toBe(2);
    for (const t of ths) expect(t.attrs.scope).toBe('col');
  });

  const firstCells = (html, key = 'manual') => {
    const w = byClass(article(html, key), 'div', 'table-wrap')[0];
    const body = elements(w.inner, 'tbody')[0].inner;
    return elements(body, 'tr').map((tr) => /<(th|td)\b([^>]*)>/.exec(tr.inner));
  };

  it.each([
    [40, true],
    [41, false],
    [60, false],
  ])('a first column whose longest cell is %i characters: row header (th scope=row) is %s; the 41-or-more case is an ordinary td with no scope', (n, rowHeader) => {
    const cells = firstCells(buildDocs({ manual: tbl('k'.repeat(n)) }).html);
    expect(cells.length).toBe(2);
    for (const m of cells) {
      if (rowHeader) {
        expect(m[1]).toBe('th');
        expect(m[2]).toMatch(/scope="row"/);
      } else {
        expect(m[1]).toBe('td');
        expect(m[2]).not.toMatch(/scope=/);
      }
    }
  });

  it('the longest cell decides for the whole column, wherever it sits (the 41-character cell in the LAST row makes every row a td)', () => {
    const md = '# T\n\n## 1. Rows here\n\n| Key | Value |\n|---|---|\n| short | y |\n| ' + 'k'.repeat(41) + ' | x |\n';
    for (const m of firstCells(buildDocs({ manual: md }).html)) expect(m[1]).toBe('td');
  });

  it('the length is counted on the cell\'s plain text: 40 characters inside ** or backticks is still a row header, 41 inside ** is not', () => {
    const doc = (cell) => `# T\n\n## 1. Rows here\n\n| Key | Value |\n|---|---|\n| ${cell} | x |\n`;
    for (const cell of ['**' + 'k'.repeat(40) + '**', '`' + 'k'.repeat(40) + '`']) {
      for (const m of firstCells(buildDocs({ manual: doc(cell) }).html)) expect(m[1], cell).toBe('th');
    }
    for (const m of firstCells(buildDocs({ manual: doc('**' + 'k'.repeat(41) + '**') }).html)) expect(m[1]).toBe('td');
  });

  it('a table before the first H2 is labelled by the H1 (id <key>-title, which resolves); its caption repeats the H1 text (revision 36; MUT-46)', () => {
    const md = '# The manual title\n\n| Key | Value |\n|---|---|\n| a | b |\n\n## 1. First section\n\ntext\n';
    const r = buildDocs({ manual: md });
    expect(r.status, r.stderr).toBe(0);
    const w = wrapOf(r.html);
    expect(w, 'table-wrap before the first H2').toBeTruthy();
    const ref = w.attrs['aria-labelledby'];
    expect(ref, 'aria-labelledby').toBeTruthy();
    expect(allIds(r.html)).toContain(ref);
    expect(ref).toBe('manual-title'); // the id the build uses (QA accepts any resolving id; this is the documented one)
    const h1 = elements(article(r.html, 'manual'), 'h1')[0];
    expect(h1.attrs.id).toBe(ref);
    const cap = elements(w.inner, 'caption')[0];
    expect(textOf(cap.inner)).toBe('The manual title');
  });

  it('a table after an H3 is labelled by the H3 (the nearest preceding heading, not the H2)', () => {
    const md = '# T\n\n## 1. Outer\n\n### 1.1 Inner heading\n\n| Key | Value |\n|---|---|\n| a | b |\n';
    const r = buildDocs({ manual: md });
    expect(wrapOf(r.html).attrs['aria-labelledby']).toBe('manual-inner-heading');
    expect(textOf(elements(wrapOf(r.html).inner, 'caption')[0].inner)).toBe('1.1 Inner heading');
  });
});

d('T9 diagrams with the stub renderer (B29-R8, decision 5)', () => {
  const dom = (blocks, head = '## 2. The waterfall') => `# D\n\n${head}\n\n${blocks.join('\n')}`;
  const figs = (html) => byClass(article(html, 'domain'), 'figure', 'diagram');
  const M = (nodes, edges = []) => ({ type: 'flowchart', nodes, edges });

  it('figure markup: figure.diagram#domain-fig-<k>, figcaption "Figure <k>. <nearest heading>", copy-link, frame region on a white panel, ids stable', () => {
    const r = buildDocs({ domain: dom([mermaidBlock(null), mermaidBlock(null)]) });
    expect(r.status, r.stderr).toBe(0);
    const f = figs(r.html);
    expect(f.map((x) => x.attrs.id)).toEqual(['domain-fig-1', 'domain-fig-2']);
    const cap = elements(f[0].inner, 'figcaption')[0];
    expect(textOf(cap.inner)).toMatch(/^Figure 1\. 2\. The waterfall/);
    expect(cap.inner).toContain('href="#domain-fig-1"');
    const frame = byClass(f[0].inner, 'div', 'diagram-frame')[0];
    expect(frame.attrs.role).toBe('region');
    expect(frame.attrs.tabindex).toBe('0');
    expect(allIds(r.html)).toContain(frame.attrs['aria-labelledby'].split(/\s+/)[0]);
  });

  it('the SVG is role=img with a non-empty <title> (the caption text) and <desc>; Mermaid width/max-width is replaced by the natural size', () => {
    const r = buildDocs({ domain: dom([mermaidBlock(null)]) });
    const f = figs(r.html)[0];
    const svgTag = tags(f.inner, 'svg')[0];
    expect(svgTag.attrs.role).toBe('img');
    expect(svgTag.raw).not.toMatch(/max-width/);
    expect(svgTag.raw).toMatch(/\b200\b/);
    const title = elements(f.inner, 'title')[0];
    const desc = elements(f.inner, 'desc')[0];
    expect(textOf(title.inner)).toMatch(/2\. The waterfall/);
    expect(textOf(desc.inner).length).toBeGreaterThan(10);
  });

  it('desc and the "Read this diagram as text" list: one sentence per node with the state of each of the five classes, and per edge (dashed for a dotted stroke)', () => {
    const model = M(
      [
        { id: 'A', text: 'Tdy', classes: ['today'] },
        { id: 'B', text: 'Pln', classes: ['planned'] },
        { id: 'C', text: 'Wrg', classes: ['wrong'] },
        { id: 'D', text: 'Opn', classes: ['open'] },
        { id: 'E', text: 'Out', classes: ['out'] },
        { id: 'F', text: 'Plain', classes: [] },
      ],
      [
        { start: 'A', end: 'B', stroke: 'normal', text: '' },
        { start: 'B', end: 'C', stroke: 'dotted', text: 'planned path' },
        { start: 'C', end: 'D', stroke: 'normal', text: 'why' },
      ],
    );
    const r = buildDocs({ domain: dom([mermaidBlock(model)]) });
    expect(r.status, r.stderr).toBe(0);
    const f = figs(r.html)[0];
    const desc = textOf(elements(f.inner, 'desc')[0].inner);
    const list = textOf(elements(f.inner, 'details')[0].inner);
    for (const text of [desc, list]) {
      expect(text).toContain('Box "Tdy" (today)');
      expect(text).toContain('Box "Pln" (planned)');
      expect(text).toContain('Box "Wrg" (known wrong result today)');
      expect(text).toContain('Box "Opn" (open or on hold)');
      expect(text).toContain('Box "Out" (outside this tool)');
      expect(text).toContain('Box "Plain"');
      expect(text).toContain('Arrow from "Tdy" to "Pln"');
      expect(text).toMatch(/Arrow from "Pln" to "Wrg": planned path \(dashed: planned path\)/);
      expect(text).toContain('Arrow from "Wrg" to "Opn": why');
    }
    expect(list).toContain('Read this diagram as text');
  });

  it('a line break in a label becomes a space', () => {
    const model = M([{ id: 'A', text: 'Line one<br/>Line two', classes: ['today'] }]);
    const f = figs(buildDocs({ domain: dom([mermaidBlock(model)]) }).html)[0];
    expect(textOf(elements(f.inner, 'desc')[0].inner)).toContain('Box "Line one Line two" (today)');
  });

  it('a sequence diagram: one sentence per message, in order', () => {
    const model = { type: 'sequence', actors: [{ name: 'User' }, { name: 'App' }], messages: [{ from: 'User', to: 'App', message: 'first ask' }, { from: 'App', to: 'User', message: 'then answer' }] };
    const f = figs(buildDocs({ domain: dom([mermaidBlock(model, 'sequenceDiagram\n  User->>App: first ask')]) }).html)[0];
    const list = textOf(elements(f.inner, 'details')[0].inner);
    expect(list.indexOf('first ask')).toBeGreaterThan(-1);
    expect(list.indexOf('then answer')).toBeGreaterThan(list.indexOf('first ask'));
  });

  it('the Mermaid source is kept as text inside the <details> so a missing SVG is never an empty box', () => {
    const src = 'flowchart LR\n    A["Alpha"]:::today --> B["Beta"]';
    const f = figs(buildDocs({ domain: dom([mermaidBlock(null, src)]) }).html)[0];
    const det = byClass(f.inner, 'details', 'diagram-text')[0];
    expect(det, 'details.diagram-text').toBeTruthy();
    expect(det.inner).toMatch(/flowchart LR/);
    expect(det.inner).toMatch(/Alpha/);
  });

  it.each([
    ['a class outside the five', M([{ id: 'A', text: 'X', classes: ['bogus'] }])],
    ['a model with zero nodes', M([])],
    ['a diagram type other than flowchart and sequence', { type: 'gantt', nodes: [{ id: 'A', text: 'X', classes: ['today'] }], edges: [] }],
  ])('%s fails the build, naming the document (nothing written)', (_n, model) => {
    const r = buildDocs({ domain: dom([mermaidBlock(model)]) });
    fail(r, /domain|COB-domain-overview\.md/i);
  });

  it('a renderer that throws exits 1 with Mermaid\'s text; the page is not written', () => {
    const r = buildDocs({ domain: dom([mermaidBlock(null)]) }, { renderer: STUB_FAIL });
    fail(r, /Parse error on line 3/);
    expect(r.stderr + r.stdout).toMatch(/mermaid/i);
  });

  it('an empty SVG and a non-svg result both fail the build (MUT-4)', () => {
    fail(buildDocs({ domain: dom([mermaidBlock(null)]) }, { renderer: STUB_EMPTY }), /svg|empty|diagram/i);
    fail(buildDocs({ domain: dom(['```mermaid\n%% stub-mode: nosvg\nflowchart LR\n  A-->B\n```\n']) }), /svg|diagram/i);
  });

  describe('the renderer contract (B29-R8a, revision 36; fixtures/STUB-CONTRACT.md is the executable copy)', () => {
    const B1 = 'flowchart LR\n    A["Alpha"]:::today --> B["Beta"]';
    const B2 = 'flowchart TD\n    C["Gamma"]:::planned --> D["Delta"]';
    const fenceLine = (md, nth = 1) => {
      let at = -1;
      for (let i = 0; i < nth; i++) at = md.indexOf('```mermaid', at + 1);
      return md.slice(0, at).split('\n').length; // 1-based line of the opening fence
    };
    const DOCS3 = {
      manual: '# M\n\n## A\n\n' + mermaidBlock(null, B1),
      coverage: '# C\n\n## 1. R\n\ntext\n\n' + mermaidBlock(null, B2),
      domain: '# D\n\n## A\n\n' + mermaidBlock(null, B1) + '\ntext between\n\n' + mermaidBlock(null, B2),
    };
    const logged = () => {
      const log = join(tmp('b29-stublog-'), 'calls.log');
      const r = buildDocs(DOCS3, { env: { HELP_STUB_LOG: log } });
      const calls = existsSync(log) ? read(log).trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
      return { r, calls };
    };

    it('the build calls the renderer exactly ONCE per run, with every Mermaid block of every document (Chrome starts once)', () => {
      const { r, calls } = logged();
      expect(r.status, r.stderr).toBe(0);
      expect(calls.length, 'number of renderDiagrams calls').toBe(1);
      expect(calls[0].n).toBe(4);
    });

    it('each source is { key, k, line, source }: registry order, then document order; k is 1-based per document; line is the 1-based line of the opening fence; source has no fence lines', () => {
      const { calls } = logged();
      const src = calls[0].sources;
      expect(src.map((x) => [x.key, x.k])).toEqual([['manual', 1], ['coverage', 1], ['domain', 1], ['domain', 2]]);
      expect(src.map((x) => x.line)).toEqual([fenceLine(DOCS3.manual), fenceLine(DOCS3.coverage), fenceLine(DOCS3.domain, 1), fenceLine(DOCS3.domain, 2)]);
      const norm = (t) => t.replace(/\n$/, '');
      expect(src.map((x) => norm(x.source))).toEqual([B1, B2, B1, B2]);
      for (const x of src) {
        expect(Object.keys(x).sort()).toEqual(['k', 'key', 'line', 'source']);
        expect(x.source).not.toMatch(/```/);
      }
    });

    it('results are matched to sources by position: figure k of a document shows the SVG returned for that source', () => {
      const { r } = logged();
      const fig = (key, k) => byClass(article(r.html, key), 'figure', 'diagram')[k - 1].inner;
      expect(fig('manual', 1)).toContain('stub 0');
      expect(fig('coverage', 1)).toContain('stub 1');
      expect(fig('domain', 1)).toContain('stub 2');
      expect(fig('domain', 2)).toContain('stub 3');
    });

    it('a synchronous renderer (returns an array, not a Promise) works', () => {
      const r = buildDocs(DOCS3, { renderer: STUB_SYNC });
      expect(r.status, r.stderr).toBe(0);
      expect(byClass(article(r.html, 'domain'), 'figure', 'diagram').length).toBe(2);
    });

    it('a renderer that returns fewer results than sources (a missing entry) fails the build; nothing is written', () => {
      fail(buildDocs(DOCS3, { renderer: STUB_SHORT }), /diagram|svg|renderer|mermaid/i);
    });

    it('an edge with stroke "invisible" is dropped from the description; "thick" reads as a normal arrow (no "dashed")', () => {
      const model = M(
        [{ id: 'A', text: 'One', classes: ['today'] }, { id: 'B', text: 'Two', classes: ['today'] }, { id: 'C', text: 'Three', classes: ['today'] }],
        [
          { start: 'A', end: 'B', stroke: 'invisible', text: '' },
          { start: 'B', end: 'C', stroke: 'thick', text: 'strong' },
        ],
      );
      const f = figs(buildDocs({ domain: dom([mermaidBlock(model)]) }).html)[0];
      for (const text of [textOf(elements(f.inner, 'desc')[0].inner), textOf(elements(f.inner, 'details')[0].inner)]) {
        expect(text).not.toContain('Arrow from "One" to "Two"');
        expect(text).toContain('Arrow from "Two" to "Three": strong');
        expect(text).not.toMatch(/Arrow from "Two" to "Three"[^.]*dashed/);
      }
    });
  });

  it('a build with no Mermaid block works and has no figure', () => {
    const r = buildDocs();
    expect(r.status, r.stderr).toBe(0);
    expect(r.html).not.toMatch(/<figure\b/);
  });

  describe('zero Mermaid blocks: the renderer is neither called nor loaded (B29-R8a, revision 38)', () => {
    it('a renderer that logs its calls writes no log line, not even one with an empty list', () => {
      const log = join(tmp('b29-stublog-'), 'calls.log');
      const r = buildDocs({}, { env: { HELP_STUB_LOG: log } });
      expect(r.status, r.stderr).toBe(0);
      expect(existsSync(log) ? read(log).trim() : '').toBe('');
    });

    it('a renderer module that throws when imported does not matter: the build exits 0 (it is not loaded)', () => {
      const r = buildDocs({}, { renderer: join(HELP, 'tests', 'fixtures', 'stub-renderer-load-throws.mjs') });
      expect(r.status, r.stderr.slice(0, 400)).toBe(0);
      expect(r.html).not.toMatch(/<figure\b/);
    });

    it('a renderer module path that does not exist does not matter either (not imported)', () => {
      const r = buildDocs({}, { renderer: join(HELP, 'tests', 'fixtures', 'no-such-renderer.mjs') });
      expect(r.status, r.stderr.slice(0, 400)).toBe(0);
    });

    it('control: with one Mermaid block the same throwing module is loaded and fails the build', () => {
      const r = buildDocs({ domain: '# D\n\n## A\n\n' + mermaidBlock(null) }, { renderer: join(HELP, 'tests', 'fixtures', 'stub-renderer-load-throws.mjs') });
      expect(r.status).toBe(1);
      expect(r.html).toBeNull();
    });
  });
});

d('T10 failure atomicity (B29-R10, B29-INV-NOPARTIAL)', () => {
  const SENTINEL = '<!-- previous output: must survive a failed build byte for byte -->\n';
  const failing = (md, renderer = STUB) => {
    const m = mkDocs({ manual: md });
    writeFileSync(m.out, SENTINEL);
    const r = build({ docs: m.dir, out: m.out, renderer });
    return { m, r };
  };

  it('a Markdown error leaves the previous output byte-identical and no temp file next to it', () => {
    const { m, r } = failing('# T\n\n## A\n\n#### no\n');
    expect(r.status).toBe(1);
    expect(read(m.out)).toBe(SENTINEL);
    expect(readdirSync(join(m.out, '..'))).toEqual(['help.html']);
  });

  it('a renderer failure leaves the previous output byte-identical (MUT-5)', () => {
    const m = mkDocs({ domain: '# D\n\n## A\n\n' + mermaidBlock(null) });
    writeFileSync(m.out, SENTINEL);
    const r = build({ docs: m.dir, out: m.out, renderer: STUB_FAIL });
    expect(r.status).toBe(1);
    expect(read(m.out)).toBe(SENTINEL);
    expect(readdirSync(join(m.out, '..'))).toEqual(['help.html']);
  });

  it('a successful build replaces the output atomically (exit 0, new content, no temp file)', () => {
    const m = mkDocs();
    writeFileSync(m.out, SENTINEL);
    const r = build({ docs: m.dir, out: m.out, renderer: STUB });
    expect(r.status, r.stderr).toBe(0);
    expect(read(m.out)).not.toBe(SENTINEL);
    expect(readdirSync(join(m.out, '..'))).toEqual(['help.html']);
  });
});

d('T11 --check and the fingerprint (B29-R11, B29-R12, decision 3)', () => {
  /** A private copy of help/ (without node_modules, tests) so a generator byte can be changed; node_modules is linked. */
  function helpCopy() {
    const root = tmp('b29-helpcopy-');
    const dst = join(root, 'help');
    cpSync(HELP, dst, { recursive: true, filter: (s) => !/[\\/](?:node_modules|tests|\.tmp)(?:[\\/]|$)/.test(s.slice(HELP.length)) });
    symlinkSync(join(HELP, 'node_modules'), join(dst, 'node_modules'));
    return { root, dst, builder: join(dst, 'build-help.mjs') };
  }
  function built() {
    const m = mkDocs({ domain: '# D\n\n## A\n\n' + mermaidBlock(null) });
    const h = helpCopy();
    const b = build({ docs: m.dir, out: m.out, renderer: STUB, builder: h.builder });
    expect(b.status, b.stderr).toBe(0);
    const check = (args = [], env = {}) => build({ docs: m.dir, out: m.out, builder: h.builder, args: ['--check', ...args], env });
    return { m, h, check };
  }

  it('fresh: prints "Help is up to date." and exits 0', () => {
    const { check } = built();
    const r = check();
    expect(r.status).toBe(0);
    expect(r.stdout + r.stderr).toContain('Help is up to date.');
  });

  it('a changed document byte: prints the WARNING (stale), exits 0; with --strict exits 1', () => {
    const { m, check } = built();
    writeFileSync(join(m.dir, 'COB-user-manual.md'), read(join(m.dir, 'COB-user-manual.md')) + '\nOne more line.\n');
    const r = check();
    expect(r.status).toBe(0);
    expect(r.stdout + r.stderr).toMatch(/WARNING: Help is stale \(docs changed after the last build\)\. Run: node help\/build-help\.mjs/);
    expect(check(['--strict']).status).toBe(1);
  });

  it('a changed generator byte (a file under help/lib): stale; --strict exits 1 (MUT-2)', () => {
    const { h, check } = built();
    const lib = join(h.dst, 'lib');
    const f = readdirSync(lib).find((n) => n.endsWith('.mjs'));
    writeFileSync(join(lib, f), read(join(lib, f)) + '\n// changed byte\n');
    expect(check().stdout + check().stderr).toMatch(/stale/i);
    expect(check(['--strict']).status).toBe(1);
  });

  it('a changed package pin in help/package.json: stale', () => {
    const { h, check } = built();
    const p = join(h.dst, 'package.json');
    writeFileSync(p, read(p).replace('"11.17.2"', '"11.17.1"'));
    expect(check(['--strict']).status).toBe(1);
  });

  it('the build date does not count: a different SOURCE_DATE_EPOCH is still fresh (MUT-3)', () => {
    const { check } = built();
    const r = check(['--strict'], { SOURCE_DATE_EPOCH: '1800000000' });
    expect(r.status).toBe(0);
  });

  describe('--check --json (B29-R11a, revision 36)', () => {
    const one = (r) => {
      const lines = r.stdout.split('\n').filter((l) => l.trim() !== '');
      expect(lines.length, `stdout: ${r.stdout.slice(0, 300)}`).toBe(1); // one object, one line
      return JSON.parse(lines[0]);
    };
    const HEX = /^[0-9a-f]{64}$/;

    it('fresh: exactly the keys fresh, skipped, forbidden, differs (revision 38 adds forbidden); { fresh: true, skipped: false, forbidden: [], differs: [] }; exit 0 (also with --strict)', () => {
      const { check } = built();
      const r = check(['--json']);
      expect(r.status).toBe(0);
      expect(one(r)).toEqual({ fresh: true, skipped: false, forbidden: [], differs: [] });
      expect(check(['--json', '--strict']).status).toBe(0);
    });

    it('a changed document: differs holds { kind: "document", name: <file>, recorded: <old sha256>, current: <new sha256> }; exit 0 without --strict, 1 with it (the JSON is printed either way)', () => {
      const { m, check } = built();
      const f = join(m.dir, 'COB-coverage.md');
      const before = sha(readFileSync(f));
      writeFileSync(f, read(f) + '\nMore.\n');
      const after = sha(readFileSync(f));
      const r = check(['--json']);
      expect(r.status).toBe(0);
      const j = one(r);
      expect(j.fresh).toBe(false);
      expect(j.skipped).toBe(false);
      expect(j.differs).toEqual([{ kind: 'document', name: 'COB-coverage.md', recorded: before, current: after }]);
      const strict = check(['--json', '--strict']);
      expect(strict.status).toBe(1);
      expect(one(strict).fresh).toBe(false);
    });

    it('a changed generator byte: { kind: "generator", name: "generator", recorded, current } with two different sha256 values', () => {
      const { h, check } = built();
      const lib = join(h.dst, 'lib');
      const f = readdirSync(lib).find((n) => n.endsWith('.mjs'));
      writeFileSync(join(lib, f), read(join(lib, f)) + '\n// changed byte\n');
      const j = one(check(['--json']));
      expect(j.fresh).toBe(false);
      expect(j.differs.length).toBe(1);
      expect(j.differs[0]).toMatchObject({ kind: 'generator', name: 'generator' });
      expect(j.differs[0].recorded).toMatch(HEX);
      expect(j.differs[0].current).toMatch(HEX);
      expect(j.differs[0].recorded).not.toBe(j.differs[0].current);
    });

    it('a changed package pin: { kind: "package", name: "mermaid", recorded: "11.17.2", current: "11.17.1" }', () => {
      const { h, check } = built();
      const p = join(h.dst, 'package.json');
      writeFileSync(p, read(p).replace('"mermaid": "11.17.2"', '"mermaid": "11.17.1"'));
      const j = one(check(['--json']));
      expect(j.differs).toEqual([{ kind: 'package', name: 'mermaid', recorded: '11.17.2', current: '11.17.1' }]);
    });

    it('with help/node_modules absent the versions are compared from the page fingerprint against help/package.json: fresh stays fresh, a changed pin still differs', () => {
      const { h, check } = built();
      rmSync(join(h.dst, 'node_modules')); // the symlink only
      expect(one(check(['--json']))).toEqual({ fresh: true, skipped: false, forbidden: [], differs: [] });
      const p = join(h.dst, 'package.json');
      writeFileSync(p, read(p).replace('"markdown-it": "15.0.2"', '"markdown-it": "15.0.1"'));
      expect(one(check(['--json'])).differs).toEqual([{ kind: 'package', name: 'markdown-it', recorded: '15.0.2', current: '15.0.1' }]);
    });

    it('a changed diagram count: { kind: "diagrams", name: "diagrams", recorded: "1", current: "2" } (counts as strings)', () => {
      const { m, check } = built();
      const f = join(m.dir, 'COB-domain-overview.md');
      writeFileSync(f, read(f) + '\n' + mermaidBlock(null));
      const j = one(check(['--json']));
      const d = j.differs.find((x) => x.kind === 'diagrams');
      expect(d, JSON.stringify(j)).toEqual({ kind: 'diagrams', name: 'diagrams', recorded: '1', current: '2' });
    });

    it('differs lists documents first, then generator, then diagrams (the brief\'s order)', () => {
      const { m, h, check } = built();
      const f = join(m.dir, 'COB-domain-overview.md');
      writeFileSync(f, read(f) + '\n' + mermaidBlock(null));
      const lib = join(h.dst, 'lib');
      const lf = readdirSync(lib).find((n) => n.endsWith('.mjs'));
      writeFileSync(join(lib, lf), read(join(lib, lf)) + '\n// changed byte\n');
      const kinds = one(check(['--json'])).differs.map((x) => x.kind);
      expect(kinds).toEqual(['document', 'generator', 'diagrams']);
    });

    it('the build date never appears: a different SOURCE_DATE_EPOCH gives { fresh: true, forbidden: [], differs: [] } (MUT-3)', () => {
      const { check } = built();
      expect(one(check(['--json'], { SOURCE_DATE_EPOCH: '1800000000' }))).toEqual({ fresh: true, skipped: false, forbidden: [], differs: [] });
    });

    it('docs/ absent: { fresh: true, skipped: true, forbidden: [], differs: [] } and exit 0, even with --strict', () => {
      const { m, h } = built();
      const gone = join(m.dir, 'no-such-docs');
      const run = (extra = []) => build({ docs: gone, out: m.out, builder: h.builder, args: ['--check', '--json', ...extra] });
      const r = run();
      expect(r.status).toBe(0);
      expect(one(r)).toEqual({ fresh: true, skipped: true, forbidden: [], differs: [] });
      const strict = run(['--strict']);
      expect(strict.status).toBe(0);
      expect(one(strict)).toEqual({ fresh: true, skipped: true, forbidden: [], differs: [] });
    });
  });
});

d('T12 determinism (B29-R11)', () => {
  it('the same inputs and the same SOURCE_DATE_EPOCH give a byte-identical file', () => {
    const over = { domain: '# D\n\n## A\n\n' + mermaidBlock(null), coverage: '# C\n\n## 1. R\n\n| ID | Status |\n|---|---|\n| US-01 | Covered |\n' };
    const a = buildDocs(over);
    const b = buildDocs(over);
    expect(a.status, a.stderr).toBe(0);
    expect(a.html).toBe(b.html);
  });
});

d('T13 CSP and external references (B29 decision 7, B29-INV-OFFLINE)', () => {
  const get = lazy(() => buildDocs({ domain: '# D\n\n## A\n\n' + mermaidBlock(null) }));
  const csp = () => tags(get().html, 'meta').find((m) => (m.attrs['http-equiv'] ?? '').toLowerCase() === 'content-security-policy');

  it('the CSP meta has default-src none, no connect or frame allowance, and a script hash for EVERY inline executable script (MUT-12)', () => {
    const r = get();
    expect(r.status, r.stderr).toBe(0);
    const c = csp();
    expect(c, 'no CSP meta').toBeTruthy();
    const content = c.attrs.content;
    expect(content).toMatch(/default-src 'none'/);
    expect(content).toMatch(/base-uri 'none'/);
    expect(content).toMatch(/form-action 'none'/);
    const scripts = inlineScripts(r.html);
    expect(scripts.length).toBeGreaterThanOrEqual(1);
    for (const s of scripts) {
      const h = createHash('sha256').update(s.inner).digest('base64');
      expect(content, `no hash for a ${s.inner.length}-byte script`).toContain(`'sha256-${h}'`);
    }
    expect(content).not.toMatch(/unsafe-eval|unsafe-inline.*script-src|script-src[^;]*unsafe-inline/);
  });

  it('one hash per inline executable script, base64 (not hex), and none for the JSON fingerprint block (B29-R9, B29-R12; MUT-44, MUT-45)', () => {
    const r = get();
    const content = csp().attrs.content;
    const scripts = inlineScripts(r.html); // the head script (sets <html class="js">) and the end-of-body script
    expect(scripts.length, 'inline executable scripts').toBeGreaterThanOrEqual(2);
    const hashes = [...content.matchAll(/'sha256-([^']+)'/g)].map((m) => m[1]);
    expect(hashes.length, `hashes in the CSP: ${hashes.length}, scripts: ${scripts.length}`).toBe(scripts.length);
    expect(new Set(hashes).size).toBe(hashes.length);
    for (const h of hashes) {
      expect(h, 'base64 of a 32-byte digest').toMatch(/^[A-Za-z0-9+/]{43}=$/);
      expect(h).not.toMatch(/^[0-9a-f]{64}$/); // never the hex form
    }
    for (const sc of scripts) {
      expect(hashes, `a ${sc.inner.length}-byte script`).toContain(createHash('sha256').update(sc.inner).digest('base64'));
    }
    const json = elements(r.html, 'script').find((x) => x.attrs.id === 'help-build');
    expect(json, 'script#help-build').toBeTruthy();
    expect(hashes).not.toContain(createHash('sha256').update(json.inner).digest('base64'));
    expect(scripts.some((x) => x.attrs.id === 'help-build')).toBe(false);
  });

  it('no <link>, no <script src>, no @import, no inline event-handler attribute', () => {
    const r = get();
    expect(tags(r.html, 'link')).toEqual([]);
    expect(tags(r.html, 'script').filter((s) => 'src' in s.attrs)).toEqual([]);
    expect(r.html).not.toMatch(/@import/);
    expect(r.html).not.toMatch(/\son[a-z]+\s*=\s*["']/i);
  });

  it('the only external reference is the Alterna logo; no http(s) URL elsewhere (xmlns excluded)', () => {
    const r = get();
    const urls = [...r.html.replace(/<meta\b[^>]*>/gi, '').matchAll(/https?:\/\/[^\s"'<>)]+/g)].map((m) => m[0]).filter((u) => !/^http:\/\/www\.w3\.org\//.test(u));
    const unique = [...new Set(urls)];
    expect(unique).toEqual(['https://www.alterna.ca/media/t0onoi0m/alterna-savings.svg']);
  });

  it('an external link in a document gets target=_blank and rel="noopener noreferrer" (MUT-14)', () => {
    const rr = buildDocs({ manual: '# T\n\n## A\n\nSee [the site](https://example.com/x).\n' });
    const a = tags(article(rr.html, 'manual'), 'a').find((x) => x.attrs.href === 'https://example.com/x');
    expect(a.attrs.target).toBe('_blank');
    expect(a.attrs.rel.split(/\s+/).sort()).toEqual(['noopener', 'noreferrer']);
  });

  it('html:false: raw HTML in a document never reaches the page (the build fails instead)', () => {
    fail(buildDocs({ manual: '# T\n\n## A\n\n<script>alert(1)</script>\n' }), /COB-user-manual\.md/);
  });
});

d('T14 page structure and fingerprint (B29-R9, B29-R12)', () => {
  const over = { domain: '# D\n\n## A\n\n' + mermaidBlock(null) };
  const get = lazy(() => buildDocs(over));

  it('first line is the GENERATED comment; <html lang="en">; one <main>; skip link first; footer; noscript', () => {
    const r = get();
    expect(r.status, r.stderr).toBe(0);
    expect(r.html.split('\n')[0]).toMatch(/^<!-- GENERATED by help\/build-help\.mjs/);
    expect(r.html).toMatch(/<!doctype html>/i);
    expect(tags(r.html, 'html')[0].attrs.lang).toBe('en');
    expect(tags(r.html, 'main').length).toBe(1);
    expect(tags(r.html, 'main')[0].attrs.id).toBe('doc-content');
    const firstA = tags(r.html, 'a')[0];
    expect(firstA.attrs.class).toMatch(/\bskip\b/);
    expect(firstA.attrs.href).toBe('#doc-content');
    expect(tags(r.html, 'footer').length).toBe(1);
    expect(r.html).toMatch(/<noscript\b/);
  });

  it('all three articles are visible in the static HTML (no hidden attribute written by the build); one <h1> per document', () => {
    const r = get();
    const arts = tags(r.html, 'article');
    expect(arts.map((a) => a.attrs.id)).toEqual(['doc-manual', 'doc-coverage', 'doc-domain']);
    for (const a of arts) expect('hidden' in a.attrs).toBe(false);
    expect(elements(r.html, 'h1').length).toBe(3);
  });

  it('Back to calculator is the root-absolute /ui/ca.html', () => {
    const r = get();
    const a = elements(r.html, 'a').find((x) => /Back to calculator/i.test(textOf(x.inner)));
    expect(a, 'Back to calculator link').toBeTruthy();
    expect(a.attrs.href).toBe('/ui/ca.html');
  });

  it('the footer shows the three file names with the first 12 hex digits of their sha256 and the build date from SOURCE_DATE_EPOCH', () => {
    const r = get();
    const foot = textOf(elements(r.html, 'footer')[0].inner);
    for (const [key, file] of Object.entries({ manual: 'COB-user-manual.md', coverage: 'COB-coverage.md', domain: 'COB-domain-overview.md' })) {
      expect(foot).toContain(file);
      expect(foot).toContain(sha(readFileSync(join(r.dir, file))).slice(0, 12));
    }
    expect(foot).toContain('2026-01-01');
  });

  it('script#help-build is JSON carrying the document hashes, generator hash, package versions, date and diagram count', () => {
    const r = get();
    const fp = elements(r.html, 'script').find((s) => s.attrs.id === 'help-build');
    expect(fp, 'script#help-build').toBeTruthy();
    expect(fp.attrs.type).toBe('application/json');
    const j = JSON.parse(fp.inner);
    const s = JSON.stringify(j);
    for (const file of ['COB-user-manual.md', 'COB-coverage.md', 'COB-domain-overview.md']) {
      expect(s).toContain(sha(readFileSync(join(r.dir, file))));
    }
    expect(s).toContain('15.0.2');
    expect(s).toContain('11.17.2');
    expect(s).toContain('2026-01-01');
    expect(/"[^"]*(?:count|diagrams)[^"]*"\s*:\s*1\b/.test(s), 'diagram count 1').toBe(true);
    expect(/[0-9a-f]{64}/.test(s)).toBe(true);
  });
});
