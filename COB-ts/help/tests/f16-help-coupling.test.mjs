/**
 * F16 (COB-architecture.md section 6, B29-X8, ADR-15): Help is a separate concern, the dependency
 * direction is one way. QA 2026-09-30. Always runs; needs no installed package and no docs/.
 * Self-contained: imports nothing from tests/. Scans by reading files, comments stripped for
 * js / mjs / ts. Disappears with the help/ folder.
 *
 * B29-INV-DEPDIR   no Help token / import / fetch of a help/ path in the calculator side.
 * B29-INV-ALLOWREF outside help/ and the prose files, Help tokens only in ui/help.html and, inside
 *                  the two marked blocks, ui/ca.html.
 * B29-INV-READONLY non-test files of help/ read nothing of the calculator; no network / storage API.
 * B29-INV-OWNPKG   root package.json and lock byte-identical to the pre-B29 files; the two packages
 *                  only in help/package.json, pinned exactly; only mermaid-render.mjs names playwright.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { COB, HELP, read, readJson, sha256File, stripJsComments, walk, FIXTURES } from './support/common.mjs';

const BASE = readJson(join(FIXTURES, 'pre-b29-baseline.json'));
const TOKENS = BASE.noTraceTokens; // help.html help-link build-help markdown-it mermaid HELP:BEGIN HELP:END
const CODE = /\.(?:ts|mts|cts|js|mjs|cjs)$/;
const strip = (rel, src) => (CODE.test(rel) ? stripJsComments(src) : src);
const REF_TO_HELP_DIR = /(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*|\bfetch\s*\(\s*|\bnew URL\s*\(\s*)['"`][^'"`]*\bhelp\//;

function hits(rel) {
  const full = join(COB, rel);
  if (!existsSync(full)) return [];
  const src = strip(rel, read(full));
  const found = TOKENS.filter((t) => src.includes(t)).map((t) => `token ${t}`);
  if (REF_TO_HELP_DIR.test(src)) found.push('reference to a help/ path');
  return found;
}

const files = (dir, ok = () => true) =>
  existsSync(join(COB, dir)) ? walk(join(COB, dir)).filter(ok).map((f) => `${dir}/${f}`) : [];

describe('F16 B29-INV-DEPDIR: the calculator side knows nothing of Help', () => {
  it.each([
    ['src/**', () => files('src', (f) => CODE.test(f))],
    ['ui/ca.js', () => ['ui/ca.js']],
    ['ui/ca-view.js and ui/ca-view.d.ts', () => ['ui/ca-view.js', 'ui/ca-view.d.ts']],
    ['ui/serve.mjs', () => ['ui/serve.mjs']],
    [
      'tests/** outside help/',
      () => files('tests', (f) => CODE.test(f) && !f.startsWith('node_modules/')),
    ],
    [
      'root package.json, package-lock.json, tsconfig*.json, .gitignore',
      () => ['package.json', 'package-lock.json', 'tsconfig.json', 'tsconfig.test.json', '.gitignore'],
    ],
  ])('%s: no Help token and no import, require or fetch of a help/ path', (_name, list) => {
    const found = {};
    for (const rel of list()) {
      const h = hits(rel);
      if (h.length) found[rel] = h;
    }
    expect(found).toEqual({});
  });

  it('the root package.json has no script or key named like help (MUT-30)', () => {
    const pkg = JSON.parse(read(join(COB, 'package.json')));
    const names = [...Object.keys(pkg.scripts ?? {}), ...Object.keys(pkg.devDependencies ?? {}), ...Object.keys(pkg.dependencies ?? {})];
    expect(names.filter((n) => /help|mermaid|markdown/i.test(n))).toEqual([]);
  });
});

describe('F16 B29-INV-ALLOWREF: the complete allowed-reference list', () => {
  it('outside help/ and the prose files, Help tokens occur only in ui/help.html and the two marked blocks of ui/ca.html', () => {
    const skip = new Set(['node_modules', '.git', 'help', 'dist', 'docs', 'archive']);
    const scanned = walk(COB, skip).filter(
      (f) => /\.(?:ts|mts|js|mjs|cjs|json|html|css|yml|yaml)$/.test(f) || f === '.gitignore',
    );
    const found = {};
    for (const rel of scanned) {
      if (rel === 'ui/help.html') continue; // T1: the generated page
      let src = read(join(COB, rel));
      if (rel === 'ui/ca.html') {
        src = src
          .replace(/\/\* HELP:BEGIN \*\/[\s\S]*?\/\* HELP:END \*\//g, '')
          .replace(/<!-- HELP:BEGIN -->[\s\S]*?<!-- HELP:END -->/g, '');
      }
      if (CODE.test(rel)) src = stripJsComments(src);
      const t = TOKENS.filter((tok) => src.includes(tok));
      if (t.length) found[rel] = t;
    }
    expect(found).toEqual({});
    expect(scanned).toContain('ui/ca.html'); // the scan is not vacuous
    expect(scanned.length).toBeGreaterThan(100);
  });
});

describe('F16 B29-INV-READONLY: Help never reads calculator state', () => {
  const nonTest = () =>
    existsSync(HELP) ? walk(HELP, new Set(['node_modules', '.git', 'tests', '.tmp'])).filter((f) => /\.(?:mjs|js|css)$/.test(f)) : [];

  it('the builder and its modules exist (the scan below is not vacuous) and import nothing from src/, dist/, ui/*.js, serve.mjs, tests/', () => {
    const list = nonTest();
    expect(list, 'help/build-help.mjs is missing (red until sr-dev builds it)').toContain('build-help.mjs');
    const bad = {};
    for (const rel of list) {
      if (!CODE.test(rel)) continue;
      const src = stripJsComments(read(join(HELP, rel)));
      const specs = [...src.matchAll(/(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)['"]([^'"]+)['"]/g)].map((m) => m[1]);
      const b = specs.filter((s) => /(?:^|\/)(?:src|dist|tests)\//.test(s) || /ui\/(?:ca|ca-view|serve)[^/]*\.(?:m?js|ts)/.test(s) || /\.\.\/\.\.\/(?:src|dist|tests)/.test(s));
      // the only ui/ names allowed anywhere in the non-test files: ui/help.html (output) and the URL /ui/ca.html
      const uiNames = [...src.matchAll(/ui\/[\w.-]+/g)].map((m) => m[0]).filter((n) => n !== 'ui/help.html' && n !== 'ui/ca.html');
      const uiBad = uiNames.filter((n) => n !== 'ui/ca.html');
      if (b.length || uiBad.length) bad[rel] = [...b, ...uiBad];
    }
    expect(bad).toEqual({});
  });

  it('help.client.js and the page inline scripts use none of fetch, XMLHttpRequest, WebSocket, sendBeacon, localStorage, sessionStorage, document.cookie, postMessage (MUT-33)', () => {
    const forbidden = /\b(?:fetch|XMLHttpRequest|WebSocket|sendBeacon|localStorage|sessionStorage|postMessage)\b|document\.cookie/;
    const client = join(HELP, 'assets', 'help.client.js');
    expect(existsSync(client), 'help/assets/help.client.js is missing (red until sr-dev builds it)').toBe(true);
    expect(stripJsComments(read(client))).not.toMatch(forbidden);
    const page = join(COB, 'ui', 'help.html');
    if (existsSync(page)) {
      const html = read(page);
      const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)]
        .filter((m) => !/json/i.test(m[1]))
        .map((m) => stripJsComments(m[2]));
      for (const s of scripts) expect(s).not.toMatch(forbidden);
    }
  });

  it('help/tests/** imports nothing from tests/ (self-contained)', () => {
    const list = walk(join(HELP, 'tests')).filter((f) => /\.m?js$/.test(f));
    const bad = {};
    for (const rel of list) {
      const src = stripJsComments(read(join(HELP, 'tests', rel)));
      const specs = [...src.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*)['"]([^'"]+)['"]/g)].map((m) => m[1]);
      const b = specs.filter((s) => /^\.\.\/\.\.\/\.\.\/(?:tests|src|dist)\//.test(s) || /^\.\.\/\.\.\/\.\.\/\.\.\//.test(s) || /(?:^|\/)tests\/(?:ca|api|architecture|tooling|types|ui)\//.test(s));
      if (b.length) bad[rel] = b;
    }
    expect(bad).toEqual({});
  });
});

describe('F16 B29-INV-OWNPKG: Help owns its package', () => {
  it('the root package.json and package-lock.json equal the pre-B29 sha256 (MUT-20, MUT-30)', () => {
    expect(sha256File(join(COB, 'package.json'))).toBe(BASE.files['package.json']);
    expect(sha256File(join(COB, 'package-lock.json'))).toBe(BASE.files['package-lock.json']);
  });

  it('markdown-it and mermaid occur in no package.json except help/package.json, where both are pinned exactly (MUT-21)', () => {
    const all = walk(COB, new Set(['node_modules', '.git', 'dist'])).filter((f) => f.endsWith('package.json') || f.endsWith('package-lock.json'));
    const naming = all.filter((f) => /"(?:markdown-it|mermaid)"/.test(read(join(COB, f))));
    expect(naming.sort()).toEqual(['help/package-lock.json', 'help/package.json'].filter((f) => existsSync(join(COB, f))).sort());
    const pkg = JSON.parse(read(join(HELP, 'package.json')));
    expect(pkg.devDependencies['markdown-it']).toBe('15.0.2');
    expect(pkg.devDependencies.mermaid).toBe('11.17.2');
    expect(pkg.dependencies ?? {}).toEqual({});
  });

  it('only help/lib/mermaid-render.mjs names playwright', () => {
    const list = existsSync(HELP) ? walk(HELP, new Set(['node_modules', '.git', 'tests', '.tmp'])).filter((f) => CODE.test(f)) : [];
    expect(list).toContain('build-help.mjs');
    const named = list.filter((f) => /playwright/i.test(stripJsComments(read(join(HELP, f)))));
    expect(named).toEqual(['lib/mermaid-render.mjs']);
  });
});
