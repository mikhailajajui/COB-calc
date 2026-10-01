/**
 * B29 decision 8 / X3 T2 / X7 / INV-REVERT / INV-NOSWITCH / INV-ENGINE: the Help link in ui/ca.html.
 * Static reading of ui/ca.html (no browser; the Chrome share is F14). QA 2026-09-30.
 * Red until sr-dev adds the two marked blocks. Disappears with the help/ folder.
 */
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CA_HTML, COB, FIXTURES, elements, parseAttrs, read, readJson, sha256, sha256File, stripJsComments, tags, textOf, treeHash } from './support/common.mjs';

const html = read(CA_HTML);
const BASE = readJson(join(FIXTURES, 'pre-b29-baseline.json'));

const CSS_BEGIN = '/* HELP:BEGIN */';
const CSS_END = '/* HELP:END */';
const HTML_BEGIN = '<!-- HELP:BEGIN -->';
const HTML_END = '<!-- HELP:END -->';
const count = (s, needle) => s.split(needle).length - 1;

function blockRanges(src, b, e) {
  const bi = src.indexOf(b);
  const ei = src.indexOf(e);
  return bi < 0 || ei < 0 ? null : [bi, ei + e.length];
}
const cssRange = blockRanges(html, CSS_BEGIN, CSS_END);
const htmlRange = blockRanges(html, HTML_BEGIN, HTML_END);
const cssBlock = cssRange ? html.slice(cssRange[0], cssRange[1]) : '';
const htmlBlock = htmlRange ? html.slice(htmlRange[0], htmlRange[1]) : '';

/** Independent strip (B29-INV-REVERT): delete every line from BEGIN to END inclusive, both kinds. */
function independentStrip(src) {
  const out = [];
  let inBlock = null;
  for (const line of src.split('\n')) {
    if (!inBlock && line.includes(CSS_BEGIN)) inBlock = CSS_END;
    else if (!inBlock && line.includes(HTML_BEGIN)) inBlock = HTML_END;
    if (!inBlock) out.push(line);
    else if (line.includes(inBlock)) inBlock = null;
  }
  return out.join('\n');
}

describe('B29 link: the marked blocks (B29-X3 T2, decision 8)', () => {
  it.each([
    ['css BEGIN', CSS_BEGIN],
    ['css END', CSS_END],
    ['html BEGIN', HTML_BEGIN],
    ['html END', HTML_END],
  ])('exactly one %s marker', (_n, m) => {
    expect(count(html, m)).toBe(1);
  });

  it('each BEGIN is before its END, the CSS pair is inside <style>, the HTML pair inside <header class="brand">', () => {
    expect(cssRange, 'CSS block missing').not.toBeNull();
    expect(htmlRange, 'HTML block missing').not.toBeNull();
    expect(html.indexOf(CSS_BEGIN)).toBeLessThan(html.indexOf(CSS_END));
    expect(html.indexOf(HTML_BEGIN)).toBeLessThan(html.indexOf(HTML_END));
    const style = elements(html, 'style').find((s) => s.index < cssRange[0] && s.index + s.raw.length > cssRange[1]);
    expect(style, 'CSS block is not inside a <style> element').toBeTruthy();
    const header = elements(html, 'header').find((h) => /\bbrand\b/.test(h.attrs.class ?? ''));
    expect(header).toBeTruthy();
    expect(htmlRange[0]).toBeGreaterThan(header.index);
    expect(htmlRange[1]).toBeLessThan(header.index + header.raw.length);
  });

  it('every help-link occurrence and the .brand flex rule sit inside a pair, and the original .brand rule is untouched outside (MUT-31, MUT-32)', () => {
    const outside = (cssRange ? html.slice(0, cssRange[0]) + html.slice(cssRange[1]) : html)
      .replace(htmlRange ? htmlBlock : '', '');
    expect(outside).not.toMatch(/help-link/);
    expect(outside).not.toMatch(/help\.html/);
    expect(outside).not.toMatch(/\.brand\s*\{[^}]*display\s*:\s*flex/);
    expect(cssBlock).toMatch(/\.brand\s*\{[^}]*display\s*:\s*flex/);
    expect(cssBlock).toMatch(/\.help-link/);
    expect(htmlBlock).toMatch(/help-link/);
    expect(outside).toMatch(/\.brand\s*\{\s*margin:\s*0 0 28px;\s*\}/); // the original rule stays
  });

  it('B29-INV-REVERT: deleting the two blocks restores the pre-B29 ca.html byte for byte (sha256 of the baseline)', () => {
    expect(sha256(independentStrip(html))).toBe(BASE.files['ui/ca.html']);
  });
});

describe('B29 link: the <a class="help-link"> (decision 8, design 16, checks 1 and 2)', () => {
  const header = elements(html, 'header').find((h) => /\bbrand\b/.test(h.attrs.class ?? ''));
  const links = header ? elements(header.inner, 'a') : [];
  const help = links.filter((a) => /\bhelp-link\b/.test(a.attrs.class ?? ''));

  it('exactly one a.help-link in header.brand, after the logo link', () => {
    expect(help.length).toBe(1);
    const logo = links.findIndex((a) => /\bbrand-logo\b/.test(a.attrs.class ?? ''));
    const hl = links.findIndex((a) => /\bhelp-link\b/.test(a.attrs.class ?? ''));
    expect(logo).toBeGreaterThanOrEqual(0);
    expect(hl).toBeGreaterThan(logo);
  });

  it('href is root-absolute /ui/help.html, target _blank, rel contains noopener (MUT-15, MUT-16)', () => {
    const a = help[0]?.attrs ?? {};
    expect(a.href).toBe('/ui/help.html');
    expect(a.target).toBe('_blank');
    expect((a.rel ?? '').split(/\s+/)).toContain('noopener');
  });

  it('accessible text is "Help" plus the visually hidden " (opens in a new tab)"', () => {
    const inner = help[0]?.inner ?? '';
    const hidden = elements(inner, 'span').find((s) => /\bvisually-hidden\b/.test(s.attrs.class ?? ''));
    expect(hidden, 'no .visually-hidden span').toBeTruthy();
    expect(textOf(hidden.inner)).toBe('(opens in a new tab)');
    expect(inner).toMatch(/> \(opens in a new tab\)</); // leading space kept inside the span
    expect(textOf(inner.replace(/<svg[\s\S]*?<\/svg>/g, ''))).toBe('Help (opens in a new tab)'); // aria-hidden glyphs add no text
  });

  it('the inline SVG glyphs (question mark, new window) are aria-hidden', () => {
    const svgs = tags(help[0]?.inner ?? '', 'svg');
    expect(svgs.length).toBeGreaterThanOrEqual(2);
    for (const s of svgs) expect(s.attrs['aria-hidden']).toBe('true');
  });

  it('the link carries no data-switch, no data-*, no inline handler, no script', () => {
    const a = help[0]?.attrs ?? {};
    expect(Object.keys(a).filter((k) => k.startsWith('data-') || k.startsWith('on'))).toEqual([]);
    expect(htmlBlock).not.toMatch(/<script|onclick|onerror|onload/i);
    expect(htmlBlock).not.toMatch(/data-switch/);
  });

  it('the CSS block gives .help-link a 3px :focus-visible outline with the 2px offset and the pill style', () => {
    const rule = /\.help-link\s*:focus-visible\s*\{([^}]*)\}/.exec(cssBlock);
    expect(rule, 'no .help-link:focus-visible rule in the CSS block').toBeTruthy();
    expect(rule[1]).toMatch(/outline\s*:\s*3px solid/);
    expect(rule[1]).toMatch(/outline-offset\s*:\s*2px/);
    expect(cssBlock).toMatch(/\.help-link\s*\{[^}]*border-radius\s*:\s*var\(--radius-pill\)/);
    expect(cssBlock).toMatch(/\.help-link\s*\{[^}]*min-height\s*:\s*40px/);
  });

  it('.brand is still in the print hide list (the Help rule does not defeat it)', () => {
    expect(html).toMatch(/\.brand\s*,\s*body\s*>\s*h1[^{]*\{[^}]*display\s*:\s*none\s*!important/);
    expect(cssBlock).not.toMatch(/@media\s+print/); // nothing in the Help block touches print
  });
});

describe('B29-X7 no probing: the calculator makes no request for Help', () => {
  it('no <link rel="help|prefetch|preload|dns-prefetch"> anywhere in ca.html (MUT-31)', () => {
    const rels = tags(html, 'link').map((l) => (l.attrs.rel ?? '').toLowerCase());
    expect(rels.filter((r) => /help|prefetch|preload/.test(r))).toEqual([]);
  });

  it('ca.js, ca-view.js and ca.html contain no fetch / XMLHttpRequest / EventSource / sendBeacon naming help (MUT-25)', () => {
    for (const f of ['ui/ca.js', 'ui/ca-view.js']) {
      const src = stripJsComments(read(join(COB, f)));
      expect(src, f).not.toMatch(/(?:fetch|XMLHttpRequest|EventSource|sendBeacon)[^;]{0,200}help/i);
      expect(src, f).not.toMatch(/help\.html/);
    }
    const inlineScripts = elements(html, 'script').map((s) => stripJsComments(s.inner)).join('\n');
    expect(inlineScripts).not.toMatch(/help/i);
  });
});

describe('B29-INV-NOSWITCH and B29-INV-ENGINE: nothing but ca.html changes on the calculator side', () => {
  it.each(['ui/ca.js', 'ui/ca-view.js', 'ui/ca-view.d.ts'])('%s is byte-identical to the pre-B29 file', (f) => {
    expect(sha256File(join(COB, f))).toBe(BASE.files[f]);
  });

  it('src/** is byte-identical to the pre-B29 tree (so both goldens stay) and UI_SWITCHES has no Help key', () => {
    expect(treeHash(join(COB, 'src'))).toBe(BASE.trees.src);
    expect(read(join(COB, 'ui', 'ca-view.js'))).not.toMatch(/help/i);
  });

  it.each([
    'tests/ca/fixtures/golden_engine_v1.json',
    'tests/ca/fixtures/golden_engine_pc_v1.json',
    'tests/ca/fixtures/a10_ui_capture_v1.json',
    'tests/ca/fixtures/b23_on_state_pins.json',
  ])('B29-INV-FIXTURE: %s keeps its sha256', (f) => {
    expect(sha256File(join(COB, f))).toBe(BASE.files[f]);
  });
});
