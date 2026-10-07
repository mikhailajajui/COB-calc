/**
 * B30 / F20 vitest layer, part 1 (QA red tests, 2026-10-01): what the built COB.html contains.
 * B30-INV-SINGLE, NOEVAL, NOHELP, LOGO, FONTS, CSP, FOOTER, FETCH. User answers 2026-10-01: logo embedded and its
 * click-through to the web site STRIPPED (Q-B30-LINK = strip), system font stack, no root npm script.
 * The same checks run on a fresh build in a temp folder and on the delivered COB-ts/COB.html.
 * Red until share/build-share.mjs exists and COB.html is built.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  ASSET, BUILDER, COB, DELIVERABLE, FIXED_DATE, HELP_TOKENS, VERSION, build, buildReal, copyTree, edit, inlineScripts, read, sha256File, snapshot, walk,
} from './support/common.mjs';

const FOOTER = (date, version = VERSION) => `COB Calculator v${version} · built ${date} · single-file edition, works offline`;
const STACK = 'system-ui, -apple-system, "Segoe UI", sans-serif';
const mk = (a, b) => a + b;
const helpMarkers = [mk('HELP', ':BEGIN'), mk('HELP', ':END')];

let built;
beforeAll(() => {
  built = buildReal();
});

describe('F20 builder exists and builds the real tree', () => {
  it('share/build-share.mjs exists (red until sr-dev builds it)', () => {
    expect(existsSync(BUILDER)).toBe(true);
  });
  it('exit 0, writes the output, prints its path, byte size, sha256 and the module list', () => {
    expect(built.result.status, built.result.stderr).toBe(0);
    expect(existsSync(built.out)).toBe(true);
    const o = built.result.stdout;
    expect(o).toContain(built.out);
    expect(o).toContain(String(readFileSync(built.out).length));
    expect(o).toContain(createHash('sha256').update(readFileSync(built.out)).digest('hex'));
    for (const id of ['dist/ca/calendar.js', 'dist/ca/index.js', 'ui/ca-view.js', 'ui/ca.js']) expect(o).toContain(id);
  });
});

function suite(label, getHtml, date) {
  describe(`${label}`, () => {
    let html;
    let script;
    beforeAll(() => {
      html = getHtml();
      expect(html.length, 'no output to inspect (builder missing or failed)').toBeGreaterThan(1000);
      script = inlineScripts(html);
    });
    const markup = () => html.replace(/<script\b[\s\S]*?<\/script>/gi, '');

    it('B30-INV-SINGLE: no <link, no src other than data:, no href other than #..., no url() other than data:, no @import', () => {
      expect(html.length, 'no output').toBeGreaterThan(1000);
      expect(html).not.toMatch(/<link\b/i);
      const srcs = [...html.matchAll(/\bsrc\s*=\s*["']([^"']*)["']/gi)].map((m) => m[1]);
      expect(srcs.filter((s) => !s.startsWith('data:'))).toEqual([]);
      const hrefs = [...html.matchAll(/\bhref\s*=\s*["']([^"']*)["']/gi)].map((m) => m[1]);
      expect(hrefs.filter((h) => !h.startsWith('#'))).toEqual([]);
      const urls = [...markup().matchAll(/url\(\s*['"]?([^'")]*)/gi)].map((m) => m[1]);
      expect(urls.filter((u) => !u.startsWith('data:') && !u.startsWith('#'))).toEqual([]);
      expect(markup()).not.toMatch(/@import/);
    });

    it('B30-INV-SINGLE: no web address at all, no /dist/ or /ui/ path, no font host, no logo host path (Q-B30-LINK = strip)', () => {
      for (const s of ['http://', 'https://', '/dist/', '/ui/', 'fonts.googleapis', 'fonts.gstatic', 'alterna.ca/media', 'rel="preconnect"']) {
        expect(html.includes(s), s).toBe(false);
      }
      // the logo is not clickable: no anchor around it and no anchor to the company site
      expect(html).not.toMatch(/<a\b[^>]*alterna/i);
      expect(markup()).not.toMatch(/<a\b[^>]*class="brand-logo"/);
    });

    it('B30-INV-SINGLE: no module syntax and no network API left in the script', () => {
      expect(script.length).toBe(1);
      const t = script[0].text;
      expect(t).not.toMatch(/^\s*import\s/m);
      expect(t).not.toMatch(/^\s*export\s/m);
      expect(t).not.toMatch(/\bimport\s*\(/);
      expect(t).not.toMatch(/\bimport\.meta\b/);
      for (const w of ['fetch(', 'XMLHttpRequest', 'WebSocket', 'sendBeacon', 'EventSource']) expect(html.includes(w), w).toBe(false);
      expect(html).not.toMatch(/sourceMappingURL/);
    });

    it('B30-INV-NOEVAL: no eval, new Function, document.write, javascript:, string timers, inline event attributes', () => {
      for (const re of [/\beval\s*\(/, /new\s+Function\b/, /document\.write/, /javascript:/i, /setTimeout\s*\(\s*["'`]/, /setInterval\s*\(\s*["'`]/]) {
        expect(html).not.toMatch(re);
      }
      expect(markup()).not.toMatch(/<[a-z][^>]*\son[a-z]+\s*=/i);
    });

    it('B30-INV-NOHELP: no Help token and no Help link class in the output', () => {
      for (const t of HELP_TOKENS) expect(html.includes(t), t).toBe(false);
      expect(html).not.toContain(['help', '-link'].join('')); // (the tokens above already cover it; assembled from parts for F16)
    });

    it('B30-INV-LOGO: exactly one data:image/svg+xml;base64 URI, decoding to the asset; img and fallback span kept', () => {
      const uris = [...html.matchAll(/data:image\/svg\+xml;base64,([A-Za-z0-9+/=]+)/g)];
      expect(uris.length).toBe(1);
      expect(Buffer.from(uris[0][1], 'base64').equals(readFileSync(ASSET))).toBe(true);
      expect(html).toMatch(/<img\b[^>]*id="brandLogo"[^>]*src="data:image\/svg\+xml;base64,/);
      expect(html).toMatch(/class="brand-fallback"/);
      expect(html).toContain('alt="Alterna Savings"');
    });

    it('B30-INV-FONTS: the three --font-* variables are the system stack; Inter occurs nowhere', () => {
      const decls = [...html.matchAll(/^\s*--font-(display|body|data)\s*:\s*([^;]+);/gm)];
      expect(decls.map((m) => m[1]).sort()).toEqual(['body', 'data', 'display']);
      for (const m of decls) expect(m[2].trim()).toBe(STACK);
      // the verbatim ca.js comment on line 351 still says Inter (SAMECODE keeps comments), so scan the markup, and quoted names in the script
      expect(markup()).not.toMatch(/\bInter\b/);
      expect(script[0].text).not.toMatch(/["']Inter["']/);
    });

    it('B30-INV-CSP: one CSP meta right after the viewport meta; script-src is exactly the sha256 of the inline script text', () => {
      const metas = [...html.matchAll(/<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]*)"\s*\/?>/gi)];
      expect(metas.length).toBe(1);
      expect(script.length).toBe(1);
      expect(script[0].attrs).toMatch(/type="module"/);
      expect(script[0].attrs).not.toMatch(/\bsrc\s*=/);
      const h = createHash('sha256').update(script[0].text, 'utf8').digest('base64');
      const dirs = Object.fromEntries(metas[0][1].split(';').map((d) => d.trim()).filter(Boolean).map((d) => { const [k, ...v] = d.split(/\s+/); return [k, v.join(' ')]; }));
      expect(dirs['default-src']).toBe("'none'");
      expect(dirs['script-src']).toBe(`'sha256-${h}'`);
      expect(dirs['img-src']).toBe('data:');
      expect(dirs['base-uri']).toBe("'none'");
      expect(dirs['form-action']).toBe("'none'");
      expect(dirs['style-src']).toContain("'unsafe-inline'");
      expect(metas[0][1]).not.toContain('unsafe-eval');
      expect(metas[0][1]).not.toMatch(/https?:|\*/);
      expect(Object.keys(dirs).sort()).toEqual(['base-uri', 'default-src', 'form-action', 'img-src', 'script-src', 'style-src']);
      expect(html).toMatch(/<meta name="viewport"[^>]*>\s*<meta http-equiv="Content-Security-Policy"/);
      expect(script[0].text).not.toMatch(/<\/script/i);
      expect(script[0].text).not.toContain('<!--');
    });

    it('B30-INV-FOOTER: footer text, date and version; screen only', () => {
      const m = html.match(/<footer id="shareFooter"[^>]*>([\s\S]*?)<\/footer>/);
      expect(m, 'no <footer id="shareFooter">').not.toBeNull();
      expect(m[1].trim()).toBe(FOOTER(date));
      expect(html.indexOf('<footer id="shareFooter"')).toBeLessThan(html.lastIndexOf('</body>'));
      const printBlocks = [...html.matchAll(/@media\s+print\s*\{/g)].map((x) => {
        let depth = 0; let i = x.index + x[0].length - 1; const start = i;
        for (; i < html.length; i++) { if (html[i] === '{') depth++; else if (html[i] === '}' && --depth === 0) break; }
        return html.slice(start, i);
      });
      expect(printBlocks.some((b) => /#shareFooter\s*\{[^}]*display\s*:\s*none/.test(b))).toBe(true);
    });

    it('B30-INV-FETCH: no package.json text; the engine version is baked in', () => {
      expect(html).not.toContain('package.json');
      expect(html).toContain(`Engine ${VERSION}`);
    });
  });
}

suite('fresh build (fixed date) in a temp folder', () => built.html, FIXED_DATE);

describe('the delivered COB-ts/COB.html', () => {
  it('exists (red until sr-dev builds it)', () => {
    expect(existsSync(DELIVERABLE)).toBe(true);
  });
  const text = existsSync(DELIVERABLE) ? read(DELIVERABLE) : '';
  const date = (text.match(/built (\d{4}-\d{2}-\d{2}) ·/) ?? [])[1] ?? '0000-00-00';
  suite('delivered file', () => text, date);
});

describe('B30-INV-NOEVAL / NOHELP on the sources (pinned at zero)', () => {
  const srcs = ['ui/ca.html', 'ui/ca.js', 'ui/ca-view.js', ...walk(join(COB, 'dist', 'ca')).filter((f) => f.endsWith('.js')).map((f) => `dist/ca/${f}`)];
  it.each(srcs)('%s has no eval, new Function, document.write, javascript:, string timers or inline event attributes', (rel) => {
    const s = read(join(COB, rel));
    for (const re of [/\beval\s*\(/, /new\s+Function\b/, /document\.write/, /javascript:/i, /setTimeout\s*\(\s*["'`]/]) expect(s).not.toMatch(re);
    if (rel.endsWith('.html')) expect(s.replace(/<script\b[\s\S]*?<\/script>/gi, '')).not.toMatch(/<[a-z][^>]*\son[a-z]+\s*=/i);
  });
  it('the source ui/ca.html keeps its two Help block pairs and has no footer, and a build leaves ui/ unchanged', () => {
    const before = snapshot(COB, ['ui', 'dist', 'package.json', 'share/assets']);
    const src = read(join(COB, 'ui', 'ca.html'));
    for (const m of helpMarkers) expect((src.match(new RegExp(m.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) ?? []).length).toBe(2);
    expect(src).not.toContain('shareFooter');
    expect(snapshot(COB, ['ui', 'dist', 'package.json', 'share/assets'])).toBe(before);
  });
});

describe('B30-INV-FETCH: the version comes from package.json, the anchor must occur exactly once', () => {
  it('the source ui/ca.js has the anchor exactly once (precondition)', () => {
    expect((read(join(COB, 'ui', 'ca.js')).match(/fetch\('\/package\.json'\)/g) ?? []).length).toBe(1);
  });
  it('a different package.json version appears in the footer and in the baked Engine text (not hard-coded)', () => {
    const root = copyTree();
    edit(root, 'package.json', (s) => s.replace(/"version":\s*"[^"]*"/, '"version": "9.8.7"'));
    const out = join(root, 'out.html');
    const r = build(['--root', root, '--out', out, '--date', FIXED_DATE]);
    expect(r.status, r.stderr).toBe(0);
    const html = read(out);
    expect(html).toContain('Engine 9.8.7');
    expect(html).not.toContain('Engine 0.1.0');
    expect(html).toContain(FOOTER(FIXED_DATE, '9.8.7'));
  });
  it.each([
    ['zero occurrences', (s) => s.replace("fetch('/package.json')", "fetch('/pkg.json')")],
    ['two occurrences', (s) => s + "\nfetch('/package.json')\n  .then((res) => res.json())\n  .catch(() => {});\n"],
  ])('%s: exit 1, the message names ca.js, an existing output is untouched', (_n, fn) => {
    const root = copyTree();
    edit(root, 'ui/ca.js', fn);
    const out = join(root, 'out.html');
    const control = build(['--root', copyTree(), '--out', join(root, 'control.html'), '--date', FIXED_DATE]);
    expect(control.status, 'harness control (needs --root)').toBe(0);
    writeFileSync(out, 'SENTINEL');
    const r = build(['--root', root, '--out', out, '--date', FIXED_DATE]);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('ca.js');
    expect(read(out)).toBe('SENTINEL');
    expect(existsSync(out + '.tmp')).toBe(false);
  });
});

describe('Q-B30-NPM: no root script', () => {
  it('the root package.json has no script that mentions share (answer: none, F16 pins that file)', () => {
    const scripts = JSON.parse(read(join(COB, 'package.json'))).scripts;
    expect(Object.entries(scripts).filter(([k, v]) => /share|COB\.html/.test(k + v))).toEqual([]);
    // Re-pinned 2026-10-05 by QA (B32 red step, DEC-B32-TERM; recorded): test:tz gains tests/ca/b32-term-start.test.ts (was b8680e37...).
    // Re-pinned 2026-10-05 by QA (B33 red step, DEC-B33-FREQ; recorded): test:tz gains tests/ca/b33-personal-loan-frequencies.test.ts (was daa37ca1...).
    // Re-pinned 2026-10-06 by QA (B34 red step, DEC-B34-TERM; recorded): test:tz gains tests/ca/b34-term-options.test.ts (was 8c9c47d8...).
    expect(sha256File(join(COB, 'package.json'))).toBe('f1b11fcbb6c3c19adfd981b4e017b7d3af257f1fd699404573bf1da7eedd895b');
  });
});
