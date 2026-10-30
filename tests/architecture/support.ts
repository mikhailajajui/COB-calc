/**
 * Shared source scanners for the A1 architecture fitness suite (COB-architecture.md §6).
 * All paths are resolved from this file, so the suite checks whichever tree it sits in
 * (this is how the sensitivity runs on a scratch copy work).
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const SRC_CA = join(ROOT, 'src', 'ca');
export const rel = (p: string) => relative(ROOT, p).split(sep).join('/');

export function listFiles(dir: string, re: RegExp): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...listFiles(p, re));
    else if (re.test(name)) out.push(p);
  }
  return out;
}

export const read = (p: string) => readFileSync(p, 'utf8');

/**
 * Replaces comments with spaces, keeping line breaks (so line numbers still match) and
 * leaving string/template contents intact. Regex literals are not recognised; src/ca has
 * none (checked 2026-09-27).
 */
export function stripComments(src: string): string {
  let out = '';
  let i = 0;
  let quote: string | null = null;
  while (i < src.length) {
    const c = src[i]!;
    const n = src[i + 1];
    if (quote) {
      out += c;
      if (c === '\\') {
        out += n ?? '';
        i += 2;
        continue;
      }
      if (c === quote) quote = null;
      i += 1;
    } else if (c === '/' && n === '/') {
      while (i < src.length && src[i] !== '\n') {
        out += ' ';
        i += 1;
      }
    } else if (c === '/' && n === '*') {
      const end = src.indexOf('*/', i + 2);
      const stop = end < 0 ? src.length : end + 2;
      out += src.slice(i, stop).replace(/[^\n]/g, ' ');
      i = stop;
    } else {
      if (c === "'" || c === '"' || c === '`') quote = c;
      out += c;
      i += 1;
    }
  }
  return out;
}

export interface ImportEdge {
  file: string; // repo-relative importer
  line: number; // 1-based
  spec: string; // the specifier as written
  resolved: string | null; // repo-relative target for relative specifiers, else null
}

/** Static `import ... from 'x'`, `export ... from 'x'`, `import 'x'` and `import('x')`. */
export function importsOf(file: string): ImportEdge[] {
  const code = stripComments(read(file));
  const re = /(?:\bfrom\s*|\bimport\s*\(?\s*)(['"])([^'"]+)\1/g;
  const out: ImportEdge[] = [];
  for (const m of code.matchAll(re)) {
    const spec = m[2]!;
    const line = code.slice(0, m.index).split('\n').length;
    const resolved = spec.startsWith('.') ? rel(resolve(dirname(file), spec)) : null;
    out.push({ file: rel(file), line, spec, resolved });
  }
  return out;
}

/** Module name of a src/ca file or a resolved import target: 'src/ca/fees.js' -> 'fees'. */
export const moduleName = (p: string) => p.split('/').pop()!.replace(/\.(ts|js|mjs)$/, '');

export interface Hit {
  file: string;
  line: number;
  text: string;
}

/** Lines (after comment stripping) of `files` matching `re`; `text` is the original line. */
export function grepCode(files: string[], re: RegExp): Hit[] {
  const out: Hit[] = [];
  for (const f of files) {
    const orig = read(f).split('\n');
    stripComments(read(f))
      .split('\n')
      .forEach((l, i) => {
        if (re.test(l)) out.push({ file: rel(f), line: i + 1, text: orig[i]!.trim() });
      });
  }
  return out;
}

export const fmt = (hits: { file: string; line: number; text?: string; spec?: string }[]) =>
  hits.map((h) => `${h.file}:${h.line} ${h.text ?? h.spec ?? ''}`);
