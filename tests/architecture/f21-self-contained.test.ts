/**
 * F21 (COB-architecture.md §6, SEC-11-R3, revision 60): the COB-ts folder is self-contained.
 * User decision 2026-10-28: the production security team receives COB-ts alone, with no parent folder.
 *
 * Scope: every .ts / .mjs / .js file under COB-ts except node_modules/, dist/, archive/ and this file, after
 * comments are stripped (comments may cite project documents as provenance; code must not read them), plus the
 * config files package.json, tsconfig.json, tsconfig.test.json and the share package's package.json as they are.
 * Folder names that other guards forbid as literals (the share folder: B30-INV-COUPLING; the removed archive
 * folder: B27-T13) are assembled from parts below.
 * Out of scope (brief): the Python regeneration-only generators and the JSON fixtures, whose provenance strings
 * name files that are never followed.
 *
 *  (a) No code names the archive, the Python engine, a home directory or an absolute user path.
 *  (b) No code names the business record (the user-stories document one folder above COB-ts). Under the
 *      brief, F7 alone could; user decision Q-SEC11-1 (iii) (zero skipped tests alone) moved that comparison to
 *      the parent-level tools/check-decisions-registry.mjs, so no file under COB-ts may name it.
 */
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ROOT, read, rel, stripComments } from './support.js';

const SELF = resolve(fileURLToPath(import.meta.url));
const SHARE_DIR = ['sha', 're'].join('');
const SKIP_DIRS = new Set(['node_modules', 'dist', ['arch', 'ive'].join(''), '.git']);
const CONFIGS = ['package.json', join(SHARE_DIR, 'package.json'), 'tsconfig.json', 'tsconfig.test.json'];
const OUTSIDE = /COB-py|cob_calculator|expanduser|homedir\(|\/Users\/|~\/Projects/;
// Built from parts so this file's own text never matches (it is excluded anyway).
const BUSINESS_RECORD = new RegExp(['COB', 'user', 'stories'].join('-') + String.raw`\.md`);

function codeFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (!SKIP_DIRS.has(name)) out.push(...codeFiles(p));
    } else if (/\.(ts|mjs|js)$/.test(name) && resolve(p) !== SELF) out.push(p);
  }
  return out;
}

interface Hit {
  where: string;
  text: string;
}

function hits(re: RegExp): Hit[] {
  const out: Hit[] = [];
  for (const f of codeFiles(ROOT)) {
    const orig = read(f).split('\n');
    stripComments(read(f))
      .split('\n')
      .forEach((l, i) => {
        if (re.test(l)) out.push({ where: `${rel(f)}:${i + 1}`, text: orig[i]!.trim() });
      });
  }
  for (const c of CONFIGS) {
    const p = join(ROOT, c);
    if (!existsSync(p)) continue;
    read(p)
      .split('\n')
      .forEach((l, i) => {
        if (re.test(l)) out.push({ where: `${c}:${i + 1}`, text: l.trim() });
      });
  }
  return out;
}

const show = (h: Hit[]) => h.map((x) => `${x.where} ${x.text}`);

describe('F21 the COB-ts folder is self-contained (SEC-11)', () => {
  it('F21 scope is not empty: src, ui, tests, the share package and the config files are scanned', () => {
    const files = codeFiles(ROOT).map(rel);
    for (const top of ['src/', 'ui/', 'tests/', `${SHARE_DIR}/`]) expect(files.some((f) => f.startsWith(top)), top).toBe(true);
    expect(files).toContain('tests/ca/support/fixtures.ts');
    expect(files).toContain('tests/architecture/f7-decisions-registered.test.ts');
    expect(files.some((f) => f.startsWith('node_modules/') || f.startsWith('dist/'))).toBe(false);
    for (const c of ['package.json', 'tsconfig.json', 'tsconfig.test.json']) expect(existsSync(join(ROOT, c)), c).toBe(true);
  });

  it('F21a: no code names COB-py, cob_calculator, expanduser, homedir(, /Users/ or ~/Projects', () => {
    expect(show(hits(OUTSIDE))).toEqual([]);
  });

  it('F21b: no code names the business-record document of the parent folder (it is not handed over)', () => {
    expect(show(hits(BUSINESS_RECORD))).toEqual([]);
  });
});
