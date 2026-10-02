/**
 * B30-INV-READONLY and B30-INV-COUPLING (QA red tests, 2026-10-01), F16-like. Also the share package (no
 * dependency), the README removal steps, the five Chrome scripts' COB_PAGE_URL hook, and the --check staleness mode (R10).
 * Self-contained; imports nothing from tests/ or help/. The Help tokens are assembled from parts (F16 scans share/**).
 */
import { existsSync, mkdirSync, readdirSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  BUILDER, COB, FIXED_DATE, FIXTURES, HELP_TOKENS, SHARE, build, ran, buildReal, copyTree, edit, read, readJson, sha256File, snapshot, stripComments, tmp, walk,
} from './support/common.mjs';

describe('B30-INV-READONLY', () => {
  it('a build changes nothing under ui/, dist/, package.json, share/assets; the only file created is the output (temp name gone)', () => {
    const watched = ['ui', 'dist', 'package.json', 'share/assets', 'src', 'share/tests/fixtures'];
    const before = snapshot(COB, watched);
    const dir = tmp();
    const r = build(['--out', join(dir, 'COB.html'), '--date', FIXED_DATE]);
    expect(r.status, r.stderr).toBe(0);
    expect(snapshot(COB, watched)).toBe(before);
    expect(readdirSync(dir)).toEqual(['COB.html']);
  });

  it('the builder source never writes anywhere but through the temp-then-rename of the output, and uses no network API', () => {
    expect(existsSync(BUILDER), 'share/build-share.mjs is missing').toBe(true);
    const files = [BUILDER, ...(existsSync(join(SHARE, 'lib')) ? walk(join(SHARE, 'lib')).map((f) => join(SHARE, 'lib', f)) : [])].filter((f) => f.endsWith('.mjs'));
    expect(files.length).toBeGreaterThan(1);
    for (const f of files) {
      const s = stripComments(read(f));
      expect(s, f).not.toMatch(/\b(?:fetch|XMLHttpRequest|WebSocket)\b|node:(?:http|https|net|dgram|child_process)|\bhttps?:\/\//);
      const specs = [...s.matchAll(/(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)['"]([^'"]+)['"]/g)].map((m) => m[1]);
      expect(specs.filter((x) => !x.startsWith('node:') && !x.startsWith('./') && !x.startsWith('../')), `${f}: only node: built-ins and own files`).toEqual([]);
      expect(specs.filter((x) => /(?:src|tests|help|dist|ui)\//.test(x)), `${f}: imports nothing of the calculator`).toEqual([]);
    }
  });

  it('the builder source holds none of the Help marker or file strings (comments aside), so F16 stays green', () => {
    const files = walk(SHARE, new Set(['node_modules', 'tests'])).filter((f) => /\.(?:mjs|js|json)$/.test(f));
    expect(files).toContain('build-share.mjs');
    for (const f of files) {
      const s = /\.(?:mjs|js)$/.test(f) ? stripComments(read(join(SHARE, f))) : read(join(SHARE, f));
      for (const t of HELP_TOKENS) expect(s.includes(t), `${f} contains ${t}`).toBe(false);
    }
  });
});

describe('B30-R1: the share package', () => {
  it('share/package.json: private, ESM, no dependencies of any kind, one build script', () => {
    const p = join(SHARE, 'package.json');
    expect(existsSync(p), 'share/package.json is missing').toBe(true);
    const pkg = readJson(p);
    expect(pkg.private).toBe(true);
    expect(pkg.type).toBe('module');
    for (const k of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) expect(Object.keys(pkg[k] ?? {}), k).toEqual([]);
    expect(pkg.scripts?.build).toBe('npm run build --prefix .. && node build-share.mjs');
    expect(existsSync(join(SHARE, 'package-lock.json')) && Object.keys(readJson(join(SHARE, 'package-lock.json')).packages ?? {}).length > 1).toBe(false);
    expect(existsSync(join(SHARE, 'node_modules'))).toBe(false);
  });

  it('share/README.md has the numbered removal steps and the rebuild-before-sharing advice', () => {
    const p = join(SHARE, 'README.md');
    expect(existsSync(p), 'share/README.md is missing').toBe(true);
    const r = read(p);
    expect(r).toMatch(/^\s*1\.\s.*share\//m);
    expect(r).toMatch(/^\s*2\.\s.*COB\.html/m);
    expect(r).toMatch(/^\s*3\.\s.*COB_PAGE_URL/m);
    expect(r).toContain('node share/build-share.mjs');
    expect(r).toContain('npm run build --prefix share');
    expect(r).toMatch(/rebuild before sharing/i);
  });
});

describe('B30-INV-COUPLING (F16-like)', () => {
  const PINS = readJson(join(FIXTURES, 'pre-b30-pins.json')).files;
  it.each(Object.keys(PINS))('%s is byte-identical to the pre-B30 pin', (rel) => {
    expect(sha256File(join(COB, rel))).toBe(PINS[rel]);
  });

  it('no file outside share/ (and outside the output, docs/, archive/, prose) mentions the share folder, its builder or the output file', () => {
    const skip = new Set(['node_modules', '.git', 'dist', 'share', 'docs', 'archive', 'snap-pre-a14']);
    const found = {};
    for (const rel of walk(COB, skip).filter((f) => /\.(?:ts|mts|js|mjs|cjs|json|html|css|ya?ml)$/.test(f) || f === '.gitignore')) {
      if (rel === 'COB.html') continue;
      const s = read(join(COB, rel));
      const m = s.match(/build-share|COB\.html|(?:^|[^\w])share\//);
      if (m) found[rel] = m[0];
    }
    expect(found).toEqual({});
  });

  it('the five Chrome scripts have the COB_PAGE_URL hook, and the rest of the calculator does not know it', () => {
    for (const rel of ['tests/ca/fixtures/capture_a10_ui.mjs', 'tests/ui/check_page_smoke.mjs', 'tests/ui/check_print_width.mjs', 'tests/ui/check_semimonthly_move.mjs', 'tests/ui/check_render_cost.mjs']) {
      expect(read(join(COB, rel)), rel).toContain('process.env.COB_PAGE_URL');
    }
    for (const rel of ['ui/ca.js', 'ui/ca.html', 'ui/ca-view.js', 'ui/serve.mjs', 'package.json']) expect(read(join(COB, rel)), rel).not.toContain('COB_PAGE_URL');
  });

  it('no existing source gained a path to the share folder: src/ and ui/ only mention nothing of it', () => {
    for (const rel of [...walk(join(COB, 'src')).map((f) => `src/${f}`), 'ui/ca.js', 'ui/ca-view.js', 'ui/serve.mjs']) {
      expect(read(join(COB, rel)), rel).not.toMatch(/build-share|COB\.html|singleFile/);
    }
  });
});

describe('B30-R10: --check (staleness by mtime; exit 1 and a warning when the output is older than a source)', () => {
  const touch = (p, t) => utimesSync(p, t, t);
  it('fresh output exits 0; a newer source makes it exit 1 with a warning', () => {
    const root = copyTree();
    const out = join(root, 'out.html');
    expect(build(['--root', root, '--out', out, '--date', FIXED_DATE]).status).toBe(0);
    const now = Date.now() / 1000;
    for (const f of ['ui/ca.html', 'ui/ca.js', 'ui/ca-view.js', 'package.json', ...walk(join(root, 'dist', 'ca')).filter((x) => x.endsWith('.js')).map((x) => `dist/ca/${x}`)]) touch(join(root, f), now - 100);
    touch(out, now);
    const fresh = build(['--check', '--root', root, '--out', out]);
    expect(fresh.status, fresh.stderr).toBe(0);
    touch(join(root, 'dist/ca/calendar.js'), now + 100);
    const stale = build(['--check', '--root', root, '--out', out]);
    expect(stale.status).toBe(1);
    expect((stale.stderr + stale.stdout).toLowerCase()).toMatch(/older|stale|rebuild/);
  });
  it('--check writes nothing', () => {
    const root = copyTree();
    const out = join(root, 'never.html');
    const r = build(['--check', '--root', root, '--out', out]);
    ran(r);
    expect(r.status).toBe(1); // nothing to compare against: missing output counts as stale
    expect(existsSync(out)).toBe(false);
  });
});
