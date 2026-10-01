/**
 * F13 (COB-architecture.md section 6, B29-R12, B29-X7): the Help page is in step with the documents.
 * Staleness only; the coupling rules are F16. NOT in test:tz. QA 2026-09-30.
 * `node help/build-help.mjs --check --strict` never rebuilds (that needs Chrome). A documentation or
 * generator change turns it red until `node help/build-help.mjs` is run (process rule R-HELP).
 * Deleted with the help/ folder.
 */
import { cpSync, existsSync, readdirSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DOCS, DOCS_PRESENT, DOC_FILES, HELP, INSTALLED, PAGE, build, elements, read, readJson, tmp } from './support/common.mjs';

const dd = describe.skipIf(!DOCS_PRESENT);

dd('F13 staleness guard', () => {
  it('node help/build-help.mjs --check --strict exits 0: the committed ui/help.html is built from these documents, this generator and these package versions', () => {
    const r = build({ args: ['--check', '--strict'] });
    expect(r.status, `${r.stdout}${r.stderr}`).toBe(0);
    expect(r.stdout + r.stderr).toContain('Help is up to date.');
  });

  it('the registry equals `ls docs/*.md` and the page fingerprint lists exactly those files', () => {
    expect(readdirSync(DOCS).filter((f) => f.endsWith('.md')).sort()).toEqual(Object.values(DOC_FILES).sort());
    const fp = elements(read(PAGE), 'script').find((s) => s.attrs.id === 'help-build');
    const s = JSON.stringify(JSON.parse(fp.inner));
    for (const f of Object.values(DOC_FILES)) expect(s).toContain(f);
  });
});

describe('F13 states that need no installed package and no docs (B29-X7 iii, vi)', () => {
  it('with docs/ absent --check and --check --strict print the skip sentence and exit 0; the build exits 1 with the rebuild message', () => {
    const missing = join(tmp('b29-nodocs-'), 'docs');
    for (const args of [['--check'], ['--check', '--strict']]) {
      const r = build({ docs: missing, args });
      expect(r.status, `${r.stdout}${r.stderr}`).toBe(0);
      expect(r.stdout + r.stderr).toContain('Help sources (docs/) not found: nothing to check.');
    }
    const b = build({ docs: missing, out: join(tmp('b29-nodocs-out-'), 'help.html') });
    expect(b.status).toBe(1);
    expect(b.stdout + b.stderr).toContain('Help cannot be rebuilt: docs/ not found. To remove Help see help/README.md.');
  });

  it('with help/node_modules absent (a copy of help/ without it) the build exits 1 with the install message and --check still answers by freshness', () => {
    const root = tmp('b29-nopkg-');
    const dst = join(root, 'help');
    cpSync(HELP, dst, { recursive: true, filter: (s) => !/[\\/](?:node_modules|tests|\.tmp)(?:[\\/]|$)/.test(s.slice(HELP.length)) });
    expect(existsSync(join(dst, 'node_modules'))).toBe(false);
    const m = tmp('b29-nopkg-docs-');
    for (const f of Object.values(DOC_FILES)) cpSync(join(DOCS, f), join(m, f));
    const b = build({ docs: m, out: join(tmp('b29-nopkg-out-'), 'help.html'), builder: join(dst, 'build-help.mjs') });
    expect(b.status).toBe(1);
    expect(b.stdout + b.stderr).toContain('Help packages are not installed. Run: npm install --prefix help');
    const c = build({ docs: m, out: PAGE, builder: join(dst, 'build-help.mjs'), args: ['--check'] });
    expect([0, 1]).toContain(c.status);
    expect(c.stdout + c.stderr).toMatch(/Help is up to date\.|stale/i);
  });

  it('help/package.json pins markdown-it and mermaid exactly (no ^ or ~) and has the build and check scripts', () => {
    const pkg = readJson(join(HELP, 'package.json'));
    expect(pkg.devDependencies['markdown-it']).toBe('15.0.2');
    expect(pkg.devDependencies.mermaid).toBe('11.17.2');
    for (const v of Object.values(pkg.devDependencies)) expect(v).toMatch(/^\d+\.\d+\.\d+$/);
    expect(pkg.scripts.build).toBeTruthy();
    expect(pkg.scripts.check).toBeTruthy();
  });

  it('the fingerprint versions in the page equal the pins of help/package.json', () => {
    const fp = elements(read(PAGE), 'script').find((s) => s.attrs.id === 'help-build');
    const s = JSON.stringify(JSON.parse(fp.inner));
    const pkg = readJson(join(HELP, 'package.json'));
    expect(s).toContain(pkg.devDependencies['markdown-it']);
    expect(s).toContain(pkg.devDependencies.mermaid);
  });
});
