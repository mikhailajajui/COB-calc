// Shared helpers for the Help tests (B29). QA-owned. Self-contained: imports nothing from tests/
// (B29-INV-READONLY), only Node built-ins. Plain JavaScript on purpose (not typechecked, B29-X1).
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const COB = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..'); // COB-ts/
export const HELP = join(COB, 'help');
export const BUILDER = join(HELP, 'build-help.mjs');
export const DOCS = join(COB, 'docs');
export const PAGE = join(COB, 'ui', 'help.html');
export const CA_HTML = join(COB, 'ui', 'ca.html');
export const FIXTURES = join(HELP, 'tests', 'fixtures');
export const TOKENS_CSS = resolve(COB, '..', 'visual_design', 'app-ui.tokens.css');

/** The two Help packages are installed (B29-X7 vi). Tests that run the build are skipIf(!INSTALLED). */
export const INSTALLED =
  existsSync(join(HELP, 'node_modules', 'markdown-it', 'package.json')) &&
  existsSync(join(HELP, 'node_modules', 'mermaid', 'package.json'));
/** The three real documents are present (B29-X7 iii). Tests that read docs/ are skipIf(!DOCS_PRESENT). */
export const DOCS_PRESENT = ['COB-user-manual.md', 'COB-coverage.md', 'COB-domain-overview.md'].every((f) =>
  existsSync(join(DOCS, f)),
);
export const BUILDER_PRESENT = existsSync(BUILDER);
export const PAGE_PRESENT = existsSync(PAGE);

export const DOC_FILES = {
  manual: 'COB-user-manual.md',
  coverage: 'COB-coverage.md',
  domain: 'COB-domain-overview.md',
};

export const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
export const sha256File = (p) => sha256(readFileSync(p));
export const read = (p) => readFileSync(p, 'utf8');
export const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));

export function tmp(prefix = 'b29-') {
  return mkdtempSync(join(tmpdir(), prefix));
}

/** Every file below dir (relative posix-ish paths), skipping names in `skip` (exact directory names). */
export function walk(dir, skip = new Set(['node_modules', '.git']), base = dir) {
  const out = [];
  for (const name of readdirSync(dir).sort()) {
    if (skip.has(name)) continue;
    const full = join(dir, name);
    const st = statSync(full, { throwIfNoEntry: false });
    if (!st) continue;
    if (st.isDirectory()) out.push(...walk(full, skip, base));
    else if (st.isFile()) out.push(relative(base, full).split(sep).join('/'));
  }
  return out;
}

/** Deterministic hash of a directory tree: sha256 over sorted "path NUL filehash" lines. */
export function treeHash(dir, skip) {
  const lines = walk(dir, skip).map((f) => `${f}\0${sha256File(join(dir, f))}`);
  return sha256(lines.join('\n'));
}

/**
 * Remove comments from JS/MJS/TS source, leaving string and template literals alone.
 * A small state machine; regex literals containing quotes are not modelled (none in the scanned files).
 */
export function stripJsComments(src) {
  let out = '';
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    const d = src[i + 1];
    if (c === '/' && d === '/') {
      while (i < n && src[i] !== '\n') i++;
    } else if (c === '/' && d === '*') {
      i += 2;
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) i++;
      i += 2;
    } else if (c === '"' || c === "'" || c === '`') {
      const q = c;
      out += c;
      i++;
      while (i < n && src[i] !== q) {
        if (src[i] === '\\') {
          out += src[i] + (src[i + 1] ?? '');
          i += 2;
        } else {
          out += src[i++];
        }
      }
      out += q;
      i++;
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

/** Run the Help builder as a child process (B29-R11). Returns { status, stdout, stderr }. */
export function build({ docs, out, renderer, args = [], env = {}, cwd = COB, builder = BUILDER, timeout = 120_000 } = {}) {
  if (!existsSync(builder)) throw new Error(`the builder is missing (red until sr-dev builds it): ${builder}`);
  const a = [builder];
  if (docs) a.push('--docs', docs);
  if (out) a.push('--out', out);
  if (renderer) a.push('--renderer', renderer);
  a.push(...args);
  const r = spawnSync(process.execPath, a, {
    cwd,
    env: { ...process.env, SOURCE_DATE_EPOCH: '1767225600', ...env },
    encoding: 'utf8',
    timeout,
  });
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '', signal: r.signal };
}

export const STUB = join(FIXTURES, 'stub-renderer.mjs');
export const STUB_FAIL = join(FIXTURES, 'stub-renderer-fail.mjs');
export const STUB_EMPTY = join(FIXTURES, 'stub-renderer-empty.mjs');
export const STUB_SHORT = join(FIXTURES, 'stub-renderer-short.mjs'); // one entry missing (R8a)
export const STUB_SYNC = join(FIXTURES, 'stub-renderer-sync.mjs'); // returns an array, not a Promise (R8a)

/** Minimal valid documents (the registry needs all three files). `over` replaces a document's text. */
export function defaultDocs() {
  return {
    manual: '# Test manual\n\n## 1. Introduction\n\nSome text.\n',
    coverage: '# Test coverage\n\n## 1. Rows\n\n| ID | Status |\n|---|---|\n| US-01 | Covered |\n',
    domain: '# Test domain\n\n## 1. Overview\n\nSome text.\n',
  };
}

/** Write a document set to a fresh temp dir and return { dir, out } (out = <dir>-out/help.html). */
export function mkDocs(over = {}) {
  const dir = tmp('b29-docs-');
  const docs = { ...defaultDocs(), ...over };
  for (const [key, file] of Object.entries(DOC_FILES)) writeFileSync(join(dir, file), docs[key]);
  const outDir = tmp('b29-out-');
  return { dir, outDir, out: join(outDir, 'help.html') };
}

/** Build a document set with the stub renderer; returns the result plus the html (when written). */
export function buildDocs(over = {}, { renderer = STUB, env = {}, args = [] } = {}) {
  const d = mkDocs(over);
  const r = build({ docs: d.dir, out: d.out, renderer, env, args });
  const html = existsSync(d.out) ? read(d.out) : null;
  return { ...d, ...r, html };
}

/** A fenced Mermaid block whose stub model is given inline (see fixtures/STUB-CONTRACT.md). */
export function mermaidBlock(model, body = 'flowchart LR\n    A["Alpha"]:::today --> B["Beta"]') {
  const m = model ? `%% stub-model: ${JSON.stringify(model)}\n` : '';
  return '```mermaid\n' + m + body + '\n```\n';
}

// ---------------------------------------------------------------- tiny HTML helpers (generated page only)
const ATTR = /([^\s=>"'/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>"']+)))?/g;

export function parseAttrs(s) {
  const o = {};
  for (const m of s.matchAll(ATTR)) o[m[1].toLowerCase()] = m[2] ?? m[3] ?? m[4] ?? '';
  return o;
}

/** All start tags `<name ...>` in html: [{ attrs, raw, index }]. */
export function tags(html, name) {
  const re = new RegExp(`<${name}(?=[\\s/>])((?:[^>"']|"[^"]*"|'[^']*')*)>`, 'gi');
  const out = [];
  for (const m of html.matchAll(re)) out.push({ attrs: parseAttrs(m[1]), raw: m[0], index: m.index });
  return out;
}

/** Elements `<name ...>inner</name>` (non-greedy, no nesting of the same tag): [{ attrs, inner, index, raw }]. */
export function elements(html, name) {
  const re = new RegExp(`<${name}(?=[\\s>])((?:[^>"']|"[^"]*"|'[^']*')*)>([\\s\\S]*?)</${name}>`, 'gi');
  const out = [];
  for (const m of html.matchAll(re)) out.push({ attrs: parseAttrs(m[1]), inner: m[2], index: m.index, raw: m[0] });
  return out;
}

export const textOf = (h) =>
  h
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();

/** The <article id="doc-<key>"> element's html. */
export function article(html, key) {
  const m = new RegExp(`<article\\b[^>]*\\bid="doc-${key}"[^>]*>([\\s\\S]*?)</article>`, 'i').exec(html);
  return m ? m[1] : null;
}

/** Executable inline scripts (not type=application/json): [{ attrs, body }]. */
export function inlineScripts(html) {
  return elements(html, 'script').filter((s) => !/json/i.test(s.attrs.type ?? '') && !('src' in s.attrs));
}

/** Every id="..." in the page. */
export function allIds(html) {
  return [...html.matchAll(/\sid="([^"]*)"/g)].map((m) => m[1]);
}

/** Elements whose class list contains `cls` (span or a): [{ tag, attrs, inner }]. */
export function withClass(html, cls) {
  const out = [];
  for (const tag of ['span', 'a', 'div', 'figure', 'details', 'tr', 'table']) {
    for (const e of elements(html, tag)) if ((e.attrs.class ?? '').split(/\s+/).includes(cls)) out.push({ tag, ...e });
  }
  return out;
}

/** The chips (`.id` span or a) found in html: [{ tag, id, href }]. */
export function chips(html) {
  return ['span', 'a'].flatMap((t) =>
    byClass(html, t, 'id').map((e) => ({ tag: t, index: e.index, id: e.attrs['data-id'] ?? textOf(e.inner), href: e.attrs.href ?? null, inner: e.inner })),
  );
}

/** The balanced element starting at the start tag at `index` (handles nested same-name tags). */
export function balanced(html, index, name) {
  const re = new RegExp(`<(/?)${name}(?=[\\s>])(?:[^>"']|"[^"]*"|'[^']*')*>`, 'gi');
  re.lastIndex = index;
  let depth = 0;
  for (let m = re.exec(html); m; m = re.exec(html)) {
    depth += m[1] ? -1 : 1;
    if (depth === 0) {
      const open = /^<[^>]*>/.exec(html.slice(index))[0];
      return { raw: html.slice(index, re.lastIndex), inner: html.slice(index + open.length, m.index), attrs: parseAttrs(open.replace(/^<\w+/, '').replace(/>$/, '')) };
    }
  }
  return null;
}

/** Every element of `name` carrying class token `cls`, balanced: [{ attrs, inner, raw, index }]. */
export function byClass(html, name, cls) {
  return tags(html, name)
    .filter((t) => (t.attrs.class ?? '').split(/\s+/).includes(cls))
    .map((t) => ({ index: t.index, ...balanced(html, t.index, name) }));
}
