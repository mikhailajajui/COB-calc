// Shared helpers for the B30 share tests. QA-owned. Self-contained: Node built-ins only; imports nothing from
// tests/ or help/ (B30-INV-COUPLING). Plain JavaScript on purpose.
//
// CONTRACT the builder must meet (share/build-share.mjs, B30-R1/R4/R6, plus one addition by QA, flagged to the caller):
//   node share/build-share.mjs [--root <dir>] [--out <path>] [--date YYYY-MM-DD]
//   --root <dir>  (QA addition, default = the COB-ts folder that holds share/): the folder from which ui/, dist/ and
//                 package.json are read. The logo is always read from the builder's own share/assets/. Needed so that
//                 the rejection tests can build from temp trees.
//   date precedence: --date, else env COB_BUILD_DATE, else today in UTC.
//   success: exit 0, writes only <out> (via <out>.tmp, gone afterwards), prints path, byte size, sha256, module list.
//   failure: exit 1, message on stderr naming the file (and line), <out> untouched.
//   module ids in the registry: root-relative posix paths, e.g. "dist/ca/calendar.js", "ui/ca.js".
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { expect } from 'vitest';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const COB = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..'); // COB-ts/
export const SHARE = join(COB, 'share');
export const BUILDER = join(SHARE, 'build-share.mjs');
export const DELIVERABLE = join(COB, 'COB.html');
export const ASSET = join(SHARE, 'assets', 'alterna-savings.svg');
export const FIXTURES = join(SHARE, 'tests', 'fixtures');
export const FIXED_DATE = '2026-10-01';

export const read = (p) => readFileSync(p, 'utf8');
export const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
export const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
export const sha256File = (p) => sha256(readFileSync(p));
export const VERSION = readJson(join(COB, 'package.json')).version;

export function tmp(prefix = 'b30-') {
  return mkdtempSync(join(tmpdir(), prefix));
}

/** Every file below dir, relative posix paths, skipping directory names in `skip`. */
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

/** Deterministic hash of the listed trees/files (sorted "path NUL filehash" lines). */
export function snapshot(root, rels) {
  const lines = [];
  for (const rel of rels) {
    const full = join(root, rel);
    if (!existsSync(full)) { lines.push(`${rel}\0MISSING`); continue; }
    if (statSync(full).isDirectory()) for (const f of walk(full)) lines.push(`${rel}/${f}\0${sha256File(join(full, f))}`);
    else lines.push(`${rel}\0${sha256File(full)}`);
  }
  return sha256(lines.sort().join('\n'));
}

/** Run the builder. Never throws; returns { status, stdout, stderr }. */
export function build(args = [], { env = {}, cwd = COB } = {}) {
  const e = { ...process.env, ...env };
  if (env.COB_BUILD_DATE === undefined) delete e.COB_BUILD_DATE;
  const r = spawnSync(process.execPath, [BUILDER, ...args], { cwd, env: e, encoding: 'utf8', timeout: 60000 });
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '', error: r.error };
}

/** A run that failed only because the builder file is missing proves nothing. */
export const ran = (r) => expect(r.stderr + String(r.error ?? ''), 'builder did not run').not.toMatch(/Cannot find module|ENOENT/);

/** Build the real tree into a fresh temp folder; returns { dir, out, html, result }. */
export function buildReal(date = FIXED_DATE, extra = []) {
  const dir = tmp();
  const out = join(dir, 'COB.html');
  const result = build(['--out', out, '--date', date, ...extra]);
  const html = existsSync(out) ? read(out) : '';
  return { dir, out, html, result };
}

/** Copy ui/, dist/ (js only) and package.json into a temp root so a test can edit one file and build with --root. */
export function copyTree() {
  const root = tmp('b30-root-');
  cpSync(join(COB, 'ui'), join(root, 'ui'), { recursive: true, filter: (s) => !s.endsWith(['help', '.html'].join('')) });
  cpSync(join(COB, 'dist'), join(root, 'dist'), { recursive: true });
  cpSync(join(COB, 'package.json'), join(root, 'package.json'));
  return root;
}

export function edit(root, rel, fn) {
  const p = join(root, rel);
  writeFileSync(p, fn(read(p)));
}

export function put(root, rel, text) {
  const p = join(root, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, text);
}

/** The inline module script of a built page: { text, count, all }. Text is the exact bytes between the tags. */
export function inlineScripts(html) {
  const all = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)].map((m) => ({ attrs: m[1], text: m[2] }));
  return all;
}

/** The Help tokens, assembled from parts so that this file itself holds none of them (F16 scans share/**). */
export const HELP_TOKENS = [
  ['help', '.html'], ['help', '-link'], ['build', '-help'], ['markdown', '-it'], ['mer', 'maid'], ['HELP', ':BEGIN'], ['HELP', ':END'],
].map((p) => p.join(''));

/** Naive JS comment stripper (enough for the builder source; F16 uses a similar one). */
export function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1');
}

/** The 12 modules reachable from ui/ca.js, root-relative ids, in the order a depth-first, source-order walk gives. */
export function independentModuleOrder(root = COB) {
  const order = [];
  const seen = new Set();
  const specsOf = (src) => {
    // line walk, not a regex over the whole file: collect the module specifier of each import / re-export statement
    const specs = [];
    const lines = src.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (!/^(?:import|export)\s*\{/.test(lines[i]) && !/^import\s/.test(lines[i])) continue;
      let j = i;
      while (j < lines.length && !/\bfrom\s*'[^']+'\s*;/.test(lines[j])) j++;
      const m = lines[j]?.match(/\bfrom\s*'([^']+)'/);
      if (m) specs.push(m[1]);
      i = j;
    }
    return specs;
  };
  const visit = (id) => {
    if (seen.has(id)) return;
    seen.add(id);
    for (const s of specsOf(read(join(root, id)))) {
      const target = s.startsWith('/') ? s.slice(1) : join(dirname(id), s).split(sep).join('/');
      visit(target);
    }
    order.push(id);
  };
  visit('ui/ca.js');
  return order;
}
