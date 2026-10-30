/**
 * SEC-6 S6-T7 (COB-architecture.md §5 "SEC-5 and SEC-6 brief", revision 62, S6-R4). QA red tests, 2026-10-28.
 * The single-file builder now reads ui/ca.css, strips its FONTS:BEGIN/END block, and inlines the rest as the one
 * <style> element in place of the ca.css link; the logo pattern is the self-hosted path. COB.html keeps no Inter and
 * keeps embedding share/assets/alterna-savings.svg. The removed rule "expected the external font links to be present"
 * is replaced by the rejections below. The B30-INV-* output scans (b30-build.test.mjs) stay as they are.
 *
 * Expected COB.html diff against the pre-SEC-6 build (S6-R4 item 4), checked by undoing it:
 *   (i) <th style="text-align:left">Name</th> -> <th>Name</th>, (ii) the inserted "#feesWrap th:first-child" line,
 *   (iii) the footer build date. Pre-SEC-6 sha256 (QA snapshot 2026-10-28): fresh build with --date 2026-10-01
 *   2e7bcf89..., delivered COB.html (built 2026-10-29) dbf41b63...
 * The developer must not edit this file.
 */
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { ASSET, DELIVERABLE, FIXED_DATE, SHARE, build, buildReal, copyTree, edit, ran, read, tmp } from './support/common.mjs';

const sha = (b) => createHash('sha256').update(b).digest('hex');
// SEC-7 (QA 2026-10-29): addFeeRow in ui/ca.js (embedded verbatim in COB.html) may change, and with it the CSP
// script-src hash (B30-INV-CSP checks that hash separately). The byte-for-byte pins 2e7bcf89… / dbf41b63… (kept as
// history) moved to the same pages with addFeeRow cut to `function addFeeRow() {}` and script-src hash set to SEC7
// (neutraliseSec7 below); the new values were taken from the same builds the old pins describe.
const PRE_FIXED_SHA_WHOLE = '2e7bcf89746425fa797ec8a0ab96a67e722f9ca8fe82b7a0c95337245aba8640';
const PRE_DELIVERABLE_SHA_WHOLE = 'dbf41b638b346fd8d6a8cc47483f5517644fcaec134833f924e454eca4306ad2';
const PRE_FIXED_SHA = '5e4682224dff9cf42a77838bd957d82a129b4a5b4a9d625c66a6a444a75d4aae';
const PRE_DELIVERABLE_SHA = '0610a7bc3067b977e96935cee049d4981857db849542a5211ad2070e5d9d8138';
const PRE_DELIVERABLE_DATE = '2026-10-29';
const FEE_TH_LINE = '  #feesWrap th:first-child { text-align: left; }\n';
const NEW_TH = '<th>Name</th>';
const PRE_TH = '<th style="text-align:left">Name</th>';
const LINK_LINE = '<link rel="stylesheet" href="/ui/ca.css" />';
const LOGO_SRC = 'src="/ui/assets/alterna-savings.svg"';
const count = (s, sub) => s.split(sub).length - 1;
const LOGO_COMMENT_SEC5B = "// --- brand logo: a self-hosted file (SEC-6); fall back to the name as text if it can't load ---";
const LOGO_COMMENT_PRE_SEC5B = "// --- brand logo: hotlinked from alterna.ca; fall back to the name as text if it can't load ---";

/** SEC-7: cut the one `function addFeeRow(…) { … }` to `function addFeeRow() {}` and blank the script-src hash. */
function neutraliseSec7(html) {
  const marker = 'function addFeeRow(';
  const start = html.indexOf(marker);
  expect(start, 'addFeeRow embedded').toBeGreaterThanOrEqual(0);
  expect(html.indexOf(marker, start + 1), 'addFeeRow embedded once').toBe(-1);
  const close = (from, o, c) => {
    let depth = 0;
    for (let i = from; i < html.length; i += 1) {
      if (html[i] === o) depth += 1;
      else if (html[i] === c && --depth === 0) return i;
    }
    throw new Error(`unbalanced ${o}${c}`);
  };
  const end = close(html.indexOf('{', close(start + marker.length - 1, '(', ')')), '{', '}') + 1;
  const csp = /script-src 'sha256-[A-Za-z0-9+/=]+'/;
  expect(csp.test(html), 'one script-src hash').toBe(true);
  // SEC-5b R5b-7.3 (QA red step 2026-10-29): the ca.js brand-logo comment, embedded verbatim, is put back to its
  // pre-SEC-5b text after the script-src blanking, so the S6-R4 item-4 pins below do not move. Before SEC-5b the
  // replace finds nothing and changes nothing.
  return (html.slice(0, start) + 'function addFeeRow() {}' + html.slice(end))
    .replace(csp, "script-src 'sha256-SEC7'")
    .replace(LOGO_COMMENT_SEC5B, LOGO_COMMENT_PRE_SEC5B);
}

/** Undo S6-R4 item 4 (i) and (ii); each change must be present exactly once. */
function undoSec6(html) {
  expect(count(html, NEW_TH), '<th>Name</th> once').toBe(1);
  expect(count(html, FEE_TH_LINE), 'the inserted #feesWrap th:first-child line once').toBe(1);
  expect(html.includes(PRE_TH)).toBe(false);
  return html.replace(NEW_TH, PRE_TH).replace(FEE_TH_LINE, '');
}

describe('SEC-6 S6-R4 item 4: the COB.html diff is exactly the th change, the inserted rule line and the date', () => {
  let fresh;
  beforeAll(() => {
    fresh = buildReal(FIXED_DATE);
  });

  it('a fresh build (--date 2026-10-01) minus (i) and (ii) is the pre-SEC-6 build byte for byte outside addFeeRow and the script-src hash (SEC-7; was 2e7bcf89…)', () => {
    expect(fresh.result.status, fresh.result.stderr).toBe(0);
    expect(PRE_FIXED_SHA_WHOLE).toMatch(/^2e7bcf89/);
    expect(sha(neutraliseSec7(undoSec6(fresh.html)))).toBe(PRE_FIXED_SHA);
  });

  it('the delivered COB.html is rebuilt: minus (i), (ii) and with the pre-SEC-6 date it is the pre-SEC-6 file outside addFeeRow and the script-src hash (SEC-7; was dbf41b63…)', () => {
    const html = read(DELIVERABLE);
    const dates = [...html.matchAll(/ · built (\d{4}-\d{2}-\d{2}) · /g)];
    expect(dates).toHaveLength(1);
    expect(PRE_DELIVERABLE_SHA_WHOLE).toMatch(/^dbf41b63/);
    const normalised = neutraliseSec7(undoSec6(html)).replace(` · built ${dates[0][1]} · `, ` · built ${PRE_DELIVERABLE_DATE} · `);
    expect(sha(normalised)).toBe(PRE_DELIVERABLE_SHA);
  });

  it('the built page carries no trace of the FONTS block, the ca.css link or the self-hosted paths', () => {
    expect(fresh.html.length).toBeGreaterThan(1000);
    for (const s of ['FONTS:', '@font-face', 'woff2', LINK_LINE, '/ui/assets/', 'ca.css']) expect(fresh.html.includes(s), s).toBe(false);
    expect(count(fresh.html, '<style>')).toBe(1);
  });
});

describe('SEC-6 S6-R4 items 1-3: the builder reads ui/ca.css (CRLF -> LF) and still embeds the share asset', () => {
  const buildRoot = (root) => {
    const out = join(root, 'o.html');
    const r = build(['--root', root, '--out', out, '--date', FIXED_DATE]);
    return { r, html: r.status === 0 ? read(out) : '' };
  };

  it('a rule added to ui/ca.css (outside the FONTS block) appears in the one <style> element', () => {
    const root = copyTree();
    edit(root, 'ui/ca.css', (s) => `${s}  .sec6-probe { color: red; }\n`);
    const { r, html } = buildRoot(root);
    expect(r.status, r.stderr).toBe(0);
    const style = html.match(/<style>\n([\s\S]*?)<\/style>/)?.[1] ?? '';
    expect(style).toContain('  .sec6-probe { color: red; }\n');
  });

  it('a change inside the FONTS block does not reach the output (the block is stripped)', () => {
    const root = copyTree();
    const base = buildRoot(copyTree());
    edit(root, 'ui/ca.css', (s) => s.replace('Inter-Bold.woff2', 'Inter-Black.woff2'));
    const { r, html } = buildRoot(root);
    expect(r.status, r.stderr).toBe(0);
    expect(base.html.length).toBeGreaterThan(1000);
    expect(html).toBe(base.html);
  });

  it('ui/ca.css with CRLF line ends builds the same page as with LF', () => {
    const root = copyTree();
    const base = buildRoot(copyTree());
    edit(root, 'ui/ca.css', (s) => s.replace(/\n/g, '\r\n'));
    const { r, html } = buildRoot(root);
    expect(r.status, r.stderr).toBe(0);
    expect(base.html.length).toBeGreaterThan(1000);
    expect(html).toBe(base.html);
  });

  it('the logo data URI still decodes to share/assets/alterna-savings.svg, not to the self-hosted copy', () => {
    const { r, html } = buildRoot(copyTree());
    expect(r.status, r.stderr).toBe(0);
    const m = html.match(/data:image\/svg\+xml;base64,([A-Za-z0-9+/=]+)/);
    expect(m).not.toBeNull();
    expect(Buffer.from(m[1], 'base64').equals(readFileSync(ASSET))).toBe(true);
  });
});

// [name, mutation of a temp copy, stderr must contain all of these]
const REJECT = [
  ['ca.css without a final newline', (r) => edit(r, 'ui/ca.css', (s) => s.replace(/\n+$/, '')), ['ui/ca.css: must end with a newline']],
  ['FONTS block missing (BEGIN line removed)', (r) => edit(r, 'ui/ca.css', (s) => s.split('\n').filter((l) => !l.includes('/* FONTS:BEGIN')).join('\n')), ['ui/ca.css: the FONTS:BEGIN/END block must occur exactly once']],
  ['FONTS block missing (END line removed)', (r) => edit(r, 'ui/ca.css', (s) => s.split('\n').filter((l) => !l.includes('/* FONTS:END */')).join('\n')), ['ui/ca.css: the FONTS:BEGIN/END block must occur exactly once']],
  ['FONTS block duplicated', (r) => edit(r, 'ui/ca.css', (s) => {
    const l = s.split('\n');
    const b = l.findIndex((x) => x.includes('/* FONTS:BEGIN'));
    const e = l.findIndex((x) => x.includes('/* FONTS:END */'));
    return [...l.slice(0, e + 1), ...l.slice(b, e + 1), ...l.slice(e + 1)].join('\n');
  }), ['ui/ca.css: the FONTS:BEGIN/END block must occur exactly once']],
  ['FONTS:END before FONTS:BEGIN', (r) => edit(r, 'ui/ca.css', (s) => {
    const l = s.split('\n');
    const b = l.findIndex((x) => x.includes('/* FONTS:BEGIN'));
    const e = l.findIndex((x) => x.includes('/* FONTS:END */'));
    [l[b], l[e]] = [l[e], l[b]];
    return l.join('\n');
  }), ['ui/ca.css: the FONTS:BEGIN/END block must occur exactly once']],
  ['ca.css link missing from ca.html', (r) => edit(r, 'ui/ca.html', (s) => s.replace(`${LINK_LINE}\n`, '')), ['ui/ca.html', 'exactly once (found 0)']],
  ['ca.css link duplicated in ca.html', (r) => edit(r, 'ui/ca.html', (s) => s.replace(`${LINK_LINE}\n`, `${LINK_LINE}\n${LINK_LINE}\n`)), ['ui/ca.html', 'exactly once (found 2)']],
  ['self-hosted logo path missing (the old alterna.ca/media source restored)', (r) => edit(r, 'ui/ca.html', (s) => s.replace(LOGO_SRC, 'src="https://www.alterna.ca/media/t0onoi0m/alterna-savings.svg"')), ['ui/ca.html', 'the logo image source must occur exactly once (found 0)']],
  ['self-hosted logo path duplicated', (r) => edit(r, 'ui/ca.html', (s) => s.replace('<span class="brand-fallback"', `<img ${LOGO_SRC} alt="" /><span class="brand-fallback"`)), ['ui/ca.html', 'the logo image source must occur exactly once (found 2)']],
  ['an external font link put back next to the ca.css link (still rejected)', (r) => edit(r, 'ui/ca.html', (s) => s.replace(`${LINK_LINE}\n`, `<link rel="preconnect" href="https://fonts.googleapis.com" />\n${LINK_LINE}\n`)), ['ui/ca.html', 'an unexpected <link> element remains']],
];

describe('SEC-6 S6-R4 item 2-3: malformed ca.css / ca.html fail loudly and leave the output alone', () => {
  it('harness control: the unmutated copy (with ui/ca.css) builds', () => {
    const root = copyTree();
    const r = build(['--root', root, '--out', join(root, 'out.html'), '--date', FIXED_DATE]);
    expect(r.status, r.stderr).toBe(0);
  });

  it.each(REJECT)('%s', (_name, mutate, needles) => {
    const root = copyTree();
    mutate(root);
    const dir = tmp('sec6-');
    const out = join(dir, 'COB.html');
    writeFileSync(out, 'SENTINEL');
    const r = build(['--root', root, '--out', out, '--date', FIXED_DATE]);
    ran(r);
    expect(r.status, r.stdout).toBe(1);
    for (const n of needles) expect(r.stderr, `stderr must contain ${JSON.stringify(n)}`).toContain(n);
    expect(read(out)).toBe('SENTINEL');
    expect(readdirSync(dir)).toEqual(['COB.html']);
  });

  it('the old rule is gone: the builder source no longer says "expected the external font links to be present"', () => {
    const src = read(join(SHARE, 'lib', 'html.mjs'));
    expect(src).not.toContain('expected the external font links to be present');
    expect(src).not.toMatch(/alterna\\\.ca\\\/media/);
  });
});
