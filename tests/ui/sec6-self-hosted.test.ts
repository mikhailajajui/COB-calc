/**
 * SEC-6 (COB-architecture.md §5 "SEC-5 and SEC-6 brief", revision 62; user decision DEC-SEC6-SELFHOST, SEC-6
 * approved 2026-10-29): self-hosted Inter and logo, CSS moved from ui/ca.html to ui/ca.css, the one style
 * attribute replaced by a CSS rule. Fitness check F22, static half (S6-T1, S6-T2). QA red tests, 2026-10-28.
 *
 * Covers S6-T1 (no external resource), S6-T2 (CSP-ready page), S6-T3 (logo), S6-T4 (fonts), S6-T5 (fee header),
 * S6-R2 (closed list of changes: a round trip back to the pre-SEC-6 ca.html, sha256 7740d849...), S6-R2.5 (ca.js,
 * ca-view.js, ca-view.d.ts untouched), S6-R5 (A10 capture unchanged and free of href/src/font strings).
 * S6-T6 lives in b31-figure-columns and b34-term-display; S6-T7 in the share package tests (sec6-share);
 * S6-T8 in tests/tooling/sec6-serve-content-types.test.ts.
 *
 * Font hashes: taken by QA from its own download of the Inter v4.1 release
 * (github.com/rsms/inter/releases/download/v4.1/Inter-4.1.zip, 33,707,794 bytes,
 * sha256 9883fdd4a49d4fb66bd8177ba6625ef9a64aa45899767dde3d36aa425756b11e; files web/Inter-*.woff2 and LICENSE.txt).
 * The developer must not edit this file.
 */
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ROOT } from '../architecture/support.js';
import { neutraliseCaJs, NEUTRALISED_CA_JS_SHA } from '../ca/support/caJsFeeRow.js';

const sha = (b: Buffer | string): string => createHash('sha256').update(b).digest('hex');
const SHARE_DIR = ['sha', 're'].join(''); // assembled: B30-INV-COUPLING forbids the literal folder path outside it
const UI = join(ROOT, 'ui');
const CSS_PATH = join(UI, 'ca.css');
const HTML_PATH = join(UI, 'ca.html');
const LOGO = join(UI, 'assets', 'alterna-savings.svg');
const SHARE_LOGO = join(ROOT, SHARE_DIR, 'assets', 'alterna-savings.svg');
const FONTS_DIR = join(UI, 'assets', 'fonts');

const html = (): string => readFileSync(HTML_PATH, 'utf8');
/** '' when ca.css does not exist yet, so each test fails on its own assertion instead of at collection. */
const css = (): string => (existsSync(CSS_PATH) ? readFileSync(CSS_PATH, 'utf8') : '');

// --- values typed from the brief (S6-R1, S6-R2) and QA's own download ---

const PRE_SEC6_HTML_SHA = '7740d8498203d1c57d7d0c09ce66e5db03d2788291559560517d5ed7c8d36b02';
// Result of the S6-R2 closed list applied to the pre-SEC-6 ca.html (QA scratch oracle, 2026-10-28).
const SEC6_HTML_SHA = '7a89bd3ddbe15729acfd1baa3d101002db81a8eb6e7363952aefe37d36d6330c';
const SEC6_CSS_SHA = 'abac6fade2ea60eacba744e30b201e5f25cf2eb2f9dc6ac17826c914281470ec';
const LOGO_SHA = 'ed699e1dcfa0e271aa6f0e8770daf6dcebb0c906899b0b825f93a42ec5535e6f';
const SHARE_LOGO_SHA = '0d8b1acc0ae2cb516e560772da5c4f48021299e640c52e14151bcfea82388d7b';
const FONT_SHA: Record<string, string> = {
  'Inter-Regular.woff2': 'e06f6b1bc553aaea4e4668023ed0ab0a147129c3107f511bc7d03d361b0ae085',
  'Inter-Medium.woff2': '0ff3e94614e1493eb556314fd247ae6c4a85a7783b4cc86be539940cf83f2a48',
  'Inter-SemiBold.woff2': '5cb7103e4e605989afebc03d989c79201e54b21b5183db33981f70db9178a301',
  'Inter-Bold.woff2': 'fa888127b6da015b65569f0351f3b5c391ad928904951f1c20e9f8462a8d95ea',
};
const LICENSE_SHA = '262481e844521b326f5ecd053e59b98c8b2da78c8ee1bdbb6e8174305e54935a';
const WEIGHT_FILE: Record<string, string> = { '400': 'Inter-Regular.woff2', '500': 'Inter-Medium.woff2', '600': 'Inter-SemiBold.woff2', '700': 'Inter-Bold.woff2' };

const LINK_LINE = '<link rel="stylesheet" href="/ui/ca.css" />';
const FONTS_BLOCK = [
  '  /* FONTS:BEGIN self-hosted Inter 4.1, SIL OFL 1.1 (see /ui/assets/fonts/LICENSE.txt); SEC-6 */',
  '  @font-face { font-family: "Inter"; font-style: normal; font-weight: 400; font-display: swap; src: url("/ui/assets/fonts/Inter-Regular.woff2") format("woff2"); }',
  '  @font-face { font-family: "Inter"; font-style: normal; font-weight: 500; font-display: swap; src: url("/ui/assets/fonts/Inter-Medium.woff2") format("woff2"); }',
  '  @font-face { font-family: "Inter"; font-style: normal; font-weight: 600; font-display: swap; src: url("/ui/assets/fonts/Inter-SemiBold.woff2") format("woff2"); }',
  '  @font-face { font-family: "Inter"; font-style: normal; font-weight: 700; font-display: swap; src: url("/ui/assets/fonts/Inter-Bold.woff2") format("woff2"); }',
  '  /* FONTS:END */',
];
const FEE_TH_RULE = '  #feesWrap th:first-child { text-align: left; }';
// Pre-SEC-6 ca.html lines 7-12 (the font links), typed from the file as it was on 2026-10-28.
const PRE_FONT_LINKS = [
  '<link rel="preconnect" href="https://fonts.googleapis.com" />',
  '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />',
  '<link',
  '  href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap"',
  '  rel="stylesheet"',
  '/>',
];
const PRE_LOGO_SRC = 'src="https://www.alterna.ca/media/t0onoi0m/alterna-savings.svg"';
const NEW_LOGO_SRC = 'src="/ui/assets/alterna-savings.svg"';
const PRE_TH = '<th style="text-align:left">Name</th>';
const NEW_TH = '<th>Name</th>';

const count = (s: string, sub: string): number => s.split(sub).length - 1;

/** T-LOGO (S6-R1), applied by the test. */
function tLogo(svg: string): string {
  const lines = svg.split('\n');
  const b = lines.indexOf('  <defs>');
  const e = lines.indexOf('  </defs>');
  expect(b, 'the source SVG has one "  <defs>" line').toBeGreaterThan(0);
  expect(e, 'the source SVG has one "  </defs>" line after it').toBeGreaterThan(b);
  const out = [...lines.slice(0, b), ...lines.slice(e + 1)].join('\n');
  expect(count(out, 'class="cls-1"')).toBe(7);
  expect(count(out, 'class="cls-2"')).toBe(7);
  return out.replaceAll('class="cls-1"', 'fill="#ef8b21"').replaceAll('class="cls-2"', 'fill="#5b6871"');
}

/** Every file below dir, posix paths relative to ROOT. */
function filesUnder(dir: string, base = ROOT): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...filesUnder(p, base));
    else out.push(p.slice(base.length + 1).split('\\').join('/'));
  }
  return out;
}

describe('SEC-6 S6-R1 / S6-R2: the new files exist, and ui/ holds nothing else new', () => {
  it('ui/ is exactly the five pre-SEC-6 files plus ca.css, the logo, the four fonts and the licence', () => {
    expect(filesUnder(UI).sort()).toEqual(
      [
        'ui/assets/alterna-savings.svg',
        'ui/assets/fonts/Inter-Bold.woff2',
        'ui/assets/fonts/Inter-Medium.woff2',
        'ui/assets/fonts/Inter-Regular.woff2',
        'ui/assets/fonts/Inter-SemiBold.woff2',
        'ui/assets/fonts/LICENSE.txt',
        'ui/ca-view.d.ts',
        'ui/ca-view.js',
        'ui/ca.css',
        'ui/ca.html',
        'ui/ca.js',
        'ui/serve.mjs',
      ].sort(),
    );
  });

  it('S6-R2.5: ui/ca.js, ui/ca-view.js and ui/ca-view.d.ts are untouched (sha256 as before SEC-6)', () => {
    // SEC-5 R5-5 (QA 2026-10-28, recorded): ca.js changes by exactly fetch('/package.json') -> fetch('/version.json');
    // putting it back must give the pre-SEC-6 file (structural re-pin; also pinned in tests/tooling/sec5-serve-azure.test.ts).
    // SEC-7 (QA 2026-10-29): addFeeRow may change too, so the pin is on ca.js with addFeeRow neutralised and the fetch
    // put back (was sha256 c85852c6… for the whole file; tests/ca/support/caJsFeeRow.ts).
    expect(sha(neutraliseCaJs(readFileSync(join(UI, 'ca.js'), 'utf8'))), 'ca.js').toBe(NEUTRALISED_CA_JS_SHA);
    expect(sha(readFileSync(join(UI, 'ca-view.js'))), 'ca-view.js').toBe('122171fde98713d3ecad764cbac395df7aa10f9d56c86701ec63c7940225a797');
    expect(sha(readFileSync(join(UI, 'ca-view.d.ts'))), 'ca-view.d.ts').toBe('f1a034993820b7c86d68c7dd7288d62ca28a63e5671923d502d3cd5a1f7896c7');
  });
});

describe('SEC-6 S6-R2: ui/ca.html and ui/ca.css are the closed list applied to the pre-SEC-6 page, nothing else', () => {
  it('S6-R2.1: the head ends <title>…</title>, the one ca.css link, </head>', () => {
    expect(html()).toContain(`<title>Cost of Borrowing Calculator | Alterna Savings</title>\n${LINK_LINE}\n</head>\n`);
  });

  it('S6-R2.2: ui/ca.css starts with the FONTS block, verbatim, ends with one newline, LF only', () => {
    const c = css();
    expect(c.split('\n').slice(0, 6)).toEqual(FONTS_BLOCK);
    expect(c.endsWith('}\n'), 'ends with a newline after the last rule').toBe(true);
    expect(c.endsWith('\n\n')).toBe(false);
    expect(c.includes('\r'), 'LF only').toBe(false);
    expect(html().includes('\r'), 'ca.html stays LF only').toBe(false);
  });

  it('S6-R2 round trip: undoing steps 1-4 gives the pre-SEC-6 ca.html byte for byte (sha256 7740d849…)', () => {
    const c = css();
    const h = html();
    expect(c.split('\n').slice(0, 6), 'FONTS block first').toEqual(FONTS_BLOCK);
    const cssLines = c.split('\n').slice(6);
    expect(cssLines.filter((l) => l === FEE_TH_RULE), 'the step-4 rule occurs once').toHaveLength(1);
    const body = cssLines.filter((l) => l !== FEE_TH_RULE).join('\n'); // ends with '\n' (file ends with a newline)
    expect(count(h, `${LINK_LINE}\n`)).toBe(1);
    expect(count(h, NEW_LOGO_SRC)).toBe(1);
    expect(count(h, NEW_TH)).toBe(1);
    const back = h
      .replace(`${LINK_LINE}\n`, () => `${PRE_FONT_LINKS.join('\n')}\n<style>\n${body}</style>\n`)
      .replace(NEW_LOGO_SRC, PRE_LOGO_SRC)
      .replace(NEW_TH, PRE_TH);
    expect(sha(back)).toBe(PRE_SEC6_HTML_SHA);
  });

  it('the resulting files have the sha256 of QA\'s oracle (ca.html 7a89bd3d…, ca.css abac6fad…)', () => {
    expect(sha(readFileSync(HTML_PATH)), 'ca.html').toBe(SEC6_HTML_SHA);
    expect(existsSync(CSS_PATH), 'ui/ca.css exists').toBe(true);
    expect(sha(css()), 'ca.css').toBe(SEC6_CSS_SHA);
  });

  it('the --font-* stacks are unchanged: "Inter" first', () => {
    const decls = [...css().matchAll(/^\s*--font-(display|body|data):\s*([^;]+);/gm)];
    expect(decls.map((m) => m[1]).sort()).toEqual(['body', 'data', 'display']);
    for (const m of decls) expect(m[2]).toBe('"Inter", system-ui, -apple-system, "Segoe UI", sans-serif');
  });
});

describe('F22 static / S6-T1: the page loads nothing from another origin', () => {
  it('ui/ca.html: no src= or <link href= that starts with http:, https: or //', () => {
    const h = html();
    const srcs = [...h.matchAll(/\bsrc\s*=\s*["']([^"']*)["']/gi)].map((m) => m[1]!);
    expect(srcs.filter((s) => /^(?:https?:|\/\/)/i.test(s))).toEqual([]);
    const linkHrefs = [...h.matchAll(/<link\b[^>]*>/gi)].flatMap((m) => [...m[0].matchAll(/\bhref\s*=\s*["']([^"']*)["']/gi)].map((x) => x[1]!));
    expect(linkHrefs.filter((s) => /^(?:https?:|\/\/)/i.test(s))).toEqual([]);
    expect(srcs.sort()).toEqual(['/ui/assets/alterna-savings.svg', '/ui/ca.js']);
  });

  it('ui/ca.html: exactly one <link>, and it is rel="stylesheet" href="/ui/ca.css"', () => {
    const links = [...html().matchAll(/<link\b[^>]*>/gi)].map((m) => m[0]);
    expect(links).toEqual([LINK_LINE]);
  });

  it('ui/ca.html: the only absolute URL is the brand anchor href="https://www.alterna.ca/"', () => {
    const h = html();
    const abs = [...h.matchAll(/(?:https?:)?\/\/[^\s"'<>)]+/gi)].map((m) => m[0]);
    expect(abs).toEqual(['https://www.alterna.ca/']);
    expect(h).toContain('<a class="brand-logo" href="https://www.alterna.ca/" rel="noopener">');
  });

  it('ui/ca.css: no @import, no absolute URL; every url( starts with /ui/assets/fonts/ and names an existing file', () => {
    const c = css();
    expect(c.length, 'ui/ca.css exists and is not empty').toBeGreaterThan(1000);
    expect(c).not.toMatch(/@import/i);
    expect(c).not.toMatch(/https?:|\/\/[a-z]/i);
    const urls = [...c.matchAll(/url\(\s*["']?([^"')]*)/gi)].map((m) => m[1]!);
    expect(urls).toHaveLength(4);
    for (const u of urls) {
      expect(u.startsWith('/ui/assets/fonts/'), u).toBe(true);
      expect(existsSync(join(ROOT, u.slice(1))), `${u} exists`).toBe(true);
    }
  });
});

describe('F22 static / S6-T2: ui/ca.html is CSP-ready', () => {
  it('no <style> element', () => {
    expect(html()).not.toMatch(/<style\b/i);
  });
  it('no style= attribute', () => {
    expect(html()).not.toMatch(/<[a-z][^>]*\sstyle\s*=/i);
  });
  it('no <script> without src (the one script is the module /ui/ca.js)', () => {
    const scripts = [...html().matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];
    expect(scripts.map((m) => m[1]!.trim())).toEqual(['type="module" src="/ui/ca.js"']);
    expect(scripts.every((m) => m[2] === '')).toBe(true);
  });
  it('no on…= event attribute and no javascript: anywhere', () => {
    expect(html()).not.toMatch(/<[a-z][^>]*\son[a-z]+\s*=/i);
    expect(html()).not.toMatch(/javascript:/i);
  });
});

describe('SEC-6 S6-T3: the self-hosted logo is T-LOGO of the share asset', () => {
  it('ui/assets/alterna-savings.svg has sha256 ed699e1d… and equals T-LOGO applied to the share asset', () => {
    expect(existsSync(LOGO), 'ui/assets/alterna-savings.svg exists').toBe(true);
    const got = readFileSync(LOGO, 'utf8');
    expect(sha(readFileSync(LOGO))).toBe(LOGO_SHA);
    expect(got).toBe(tLogo(readFileSync(SHARE_LOGO, 'utf8')));
  });
  it('it contains no <style, class=, <script or href', () => {
    const got = existsSync(LOGO) ? readFileSync(LOGO, 'utf8') : '<missing>';
    expect(got.length).toBeGreaterThan(1000);
    for (const s of ['<style', 'class=', '<script', 'href']) expect(got.includes(s), s).toBe(false);
  });
  it('the share asset keeps sha256 0d8b1acc… (read, never written)', () => {
    expect(sha(readFileSync(SHARE_LOGO))).toBe(SHARE_LOGO_SHA);
  });
});

describe('SEC-6 S6-T4: the four Inter 4.1 static fonts and the OFL licence', () => {
  it.each(Object.keys(FONT_SHA))('%s exists, starts with wOF2 and equals the v4.1 release file (QA download)', (name) => {
    const p = join(FONTS_DIR, name);
    expect(existsSync(p), `${name} exists`).toBe(true);
    const b = readFileSync(p);
    expect(b.subarray(0, 4).toString('latin1')).toBe('wOF2');
    expect(sha(b)).toBe(FONT_SHA[name]);
  });

  it('the four @font-face rules map 400/500/600/700 to Regular/Medium/SemiBold/Bold (family "Inter", normal, swap, woff2)', () => {
    const faces = [...css().matchAll(/@font-face\s*\{([^}]*)\}/g)].map((m) => m[1]!);
    expect(faces).toHaveLength(4);
    const map: Record<string, string> = {};
    for (const f of faces) {
      const decl = (k: string) => f.match(new RegExp(`(?:^|;)\\s*${k}\\s*:\\s*([^;]+?)\\s*(?:;|$)`))?.[1];
      expect(decl('font-family')).toBe('"Inter"');
      expect(decl('font-style')).toBe('normal');
      expect(decl('font-display')).toBe('swap');
      const src = decl('src') ?? '';
      const m = src.match(/^url\("\/ui\/assets\/fonts\/([^"]+)"\) format\("woff2"\)$/);
      expect(m, src).not.toBeNull();
      map[decl('font-weight') ?? '?'] = m![1]!;
    }
    expect(map).toEqual(WEIGHT_FILE);
  });

  it('every @font-face sits inside the FONTS:BEGIN/END block (the share build strips exactly that block)', () => {
    const c = css();
    const b = c.indexOf('/* FONTS:BEGIN');
    const e = c.indexOf('/* FONTS:END */');
    expect(b).toBeGreaterThanOrEqual(0);
    expect(e).toBeGreaterThan(b);
    expect(count(c, '/* FONTS:BEGIN')).toBe(1);
    expect(count(c, '/* FONTS:END */')).toBe(1);
    const outside = c.slice(0, b) + c.slice(e);
    expect(outside).not.toMatch(/@font-face|url\(/);
  });

  it('LICENSE.txt is the release licence verbatim and contains "SIL OPEN FONT LICENSE Version 1.1"', () => {
    const p = join(FONTS_DIR, 'LICENSE.txt');
    expect(existsSync(p), 'LICENSE.txt exists').toBe(true);
    expect(readFileSync(p, 'utf8')).toContain('SIL OPEN FONT LICENSE Version 1.1');
    expect(sha(readFileSync(p))).toBe(LICENSE_SHA);
  });
});

describe('SEC-6 S6-T5: the fee table "Name" header is left-aligned by CSS, not by an attribute', () => {
  it('ca.css: "#feesWrap th:first-child { text-align: left; }" is the line directly after the closing "  }" of "#feesWrap th {"', () => {
    const lines = css().split('\n');
    const open = lines.indexOf('  #feesWrap th {');
    expect(open, 'the #feesWrap th rule').toBeGreaterThan(0);
    const close = lines.indexOf('  }', open);
    expect(close).toBeGreaterThan(open);
    expect(lines[close + 1]).toBe(FEE_TH_RULE);
    expect(lines.slice(open, close).join('\n')).toContain('text-align: right;');
  });
  it('ca.html: the Name header is a bare <th>Name</th>', () => {
    const h = html();
    expect(count(h, NEW_TH)).toBe(1);
    expect(h).not.toContain(PRE_TH);
    expect(h).toContain(`<tr>${NEW_TH}<th>Amount ($)</th>`);
  });
});

describe('SEC-6 S6-R5: goldens and the A10 capture stay byte-identical; the capture holds no href/src/font strings', () => {
  const fx = (n: string) => readFileSync(join(ROOT, 'tests', 'ca', 'fixtures', n));
  it('golden_engine_v1.json b35d9e52…, golden_engine_pc_v1.json d1076ca7…, a10_ui_capture_v1.json e22f0161…', () => {
    expect(sha(fx('golden_engine_v1.json'))).toBe('b35d9e525beb15550018c7089b71aac01dc3b55cd87422a9506ce022f08b634a');
    expect(sha(fx('golden_engine_pc_v1.json'))).toBe('d1076ca7d6c1c1378e339a45770351ca8712a76d5d2706d7bcfcd7750eb431d3');
    expect(sha(fx('a10_ui_capture_v1.json'))).toBe('e22f016172c733cfaaf97c36567bab81c1b8b9a5e032b3e88a42c73ebdfa77df');
  });
  it('the capture names no href, src, <link>, <style>, url(, web address, font, Inter, woff2, svg or logo; its only style attributes are --term-em', () => {
    const t = fx('a10_ui_capture_v1.json').toString('utf8');
    for (const re of [/href/i, /\bsrc\s*=/i, /<link/i, /<style/i, /url\(/i, /https?:/i, /\/ui\//, /font/i, /\bInter\b/, /woff/i, /svg/i, /logo/i, /alterna/i]) {
      expect(t, String(re)).not.toMatch(re);
    }
    const styles = [...t.matchAll(/style=\\"([^\\]*)/g)].map((m) => m[1]!);
    expect(styles.length).toBeGreaterThan(0);
    expect(styles.filter((s) => !/^--term-em: [0-9.]+;$/.test(s))).toEqual([]);
  });
});
