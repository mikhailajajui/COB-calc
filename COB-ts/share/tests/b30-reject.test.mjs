/**
 * B30-INV-REJECT (QA red tests, 2026-10-01): the builder accepts only the import/export forms the sources use today
 * and fails loudly (exit 1, a message naming a file, an existing output byte-identical, no temp file left) on
 * everything else. Each case edits one file of a temp copy of the tree (--root, see support/common.mjs).
 */
import { existsSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FIXED_DATE, HELP_TOKENS, build, copyTree, edit, put, ran, read, tmp } from './support/common.mjs';

const EXTRA = 'export const q = 1;\n';
const prepend = (line) => (s) => line + '\n' + s;
const append = (line) => (s) => s + '\n' + line + '\n';
const withExtra = (fn) => (root) => { put(root, 'ui/extra.js', EXTRA); fn(root); };

const CASES = [
  ['import * as x', withExtra((r) => edit(r, 'ui/ca-view.js', prepend("import * as x from './extra.js';"))), ['ca-view.js']],
  ['default import', withExtra((r) => edit(r, 'ui/ca-view.js', prepend("import x from './extra.js';"))), ['ca-view.js']],
  ['export default', (r) => edit(r, 'ui/ca-view.js', append('export default 1;')), ['ca-view.js']],
  ['export *', withExtra((r) => edit(r, 'ui/ca-view.js', append("export * from './extra.js';"))), ['ca-view.js']],
  ['export let', (r) => edit(r, 'ui/ca-view.js', append('export let z = 1;')), ['ca-view.js']],
  ['export class', (r) => edit(r, 'ui/ca-view.js', append('export class Z {}')), ['ca-view.js']],
  // QA finding F-1: the brief says the sources have no `as` alias, but dist/ca/cobCanada.js imports two (cobAmount as cobAmountEquation, triggerRatePercent as triggerRatePercentEquation).
  // Decision by QA, flagged for the architect: an alias in an IMPORT is accepted (rename in the destructure); an alias in an EXPORT list is rejected.
  ['export { a as b }', (r) => edit(r, 'dist/ca/index.js', append("export { collectInputIssues as cii } from './validate.js';")), ['index.js']],
  ['bare specifier', (r) => edit(r, 'ui/ca-view.js', prepend("import { q } from 'lodash';")), ['ca-view.js']],
  ['http specifier', (r) => edit(r, 'ui/ca-view.js', prepend("import { q } from 'http://example.com/x.js';")), ['ca-view.js']],
  ['https specifier', (r) => edit(r, 'ui/ca-view.js', prepend("import { q } from 'https://example.com/x.js';")), ['ca-view.js']],
  ['specifier that resolves outside ui/ and dist/ (relative)', (r) => { put(r, 'src/x.js', EXTRA); edit(r, 'ui/ca-view.js', prepend("import { q } from '../src/x.js';")); }, ['ca-view.js', 'x.js']],
  ['specifier that resolves outside ui/ and dist/ (absolute)', (r) => { put(r, 'src/x.js', EXTRA); edit(r, 'ui/ca-view.js', prepend("import { q } from '/src/x.js';")); }, ['ca-view.js', 'x.js']],
  ['specifier that climbs out of the tree', (r) => edit(r, 'ui/ca-view.js', prepend("import { q } from '../../../../../../etc/hosts.js';")), ['ca-view.js', 'hosts.js']],
  ['missing file', (r) => edit(r, 'ui/ca-view.js', prepend("import { q } from './nope.js';")), ['ca-view.js', 'nope.js']],
  ['two-module cycle', (r) => {
    put(r, 'ui/c1.js', "import { b } from './c2.js';\nexport const a = 1;\n");
    put(r, 'ui/c2.js', "import { a } from './c1.js';\nexport const b = 2;\n");
    edit(r, 'ui/ca-view.js', prepend("import { a } from './c1.js';"));
  }, ['c1.js', 'c2.js']],
  ['closing script tag inside a module', (r) => edit(r, 'ui/ca-view.js', append("const s = '</script>';")), ['ca-view.js']],
  ['unbalanced Help marker in ca.html', (r) => edit(r, 'ui/ca.html', (s) => s.replace('<!-- ' + HELP_TOKENS.find((t) => t.endsWith(':END')) + ' -->', '')), ['ca.html']],
];

describe('B30-INV-REJECT: harness control', () => {
  it('an unmutated copy of the tree builds with --root (so every failure below is the mutation)', () => {
    const root = copyTree();
    const r = build(['--root', root, '--out', join(root, 'out.html'), '--date', FIXED_DATE]);
    expect(r.status, r.stderr).toBe(0);
  });
});

describe('B30-INV-REJECT: an import alias is accepted (it is used by dist/ca/cobCanada.js)', () => {
  it('import { q as r } from a module builds, and the output renames in the destructure', () => {
    const root = copyTree();
    put(root, 'ui/extra.js', EXTRA);
    edit(root, 'ui/ca-view.js', prepend("import { q as renamedQ } from './extra.js';"));
    const out = join(root, 'o.html');
    const r = build(['--root', root, '--out', out, '--date', FIXED_DATE]);
    expect(r.status, r.stderr).toBe(0);
    expect(read(out)).toMatch(/const\s*\{[^}]*\bq\s*:\s*renamedQ\b[^}]*\}\s*=\s*__cobModules\["ui\/extra\.js"\]/);
  });
});

describe('B30-INV-REJECT: unsupported input fails loudly and leaves the output alone', () => {
  it.each(CASES)('%s', (_name, mutate, names) => {
    const root = copyTree();
    mutate(root);
    const dir = tmp();
    const out = join(dir, 'COB.html');
    writeFileSync(out, 'SENTINEL');
    const r = build(['--root', root, '--out', out, '--date', FIXED_DATE]);
    ran(r);
    expect(r.status, r.stdout).toBe(1);
    expect(names.some((n) => r.stderr.includes(n)), `stderr must name one of ${names}: ${r.stderr}`).toBe(true);
    expect(read(out)).toBe('SENTINEL');
    expect(readdirSync(dir)).toEqual(['COB.html']);
  });

  it('with no output before, a failed build creates no file and no temp file', () => {
    const root = copyTree();
    edit(root, 'ui/ca-view.js', prepend("import { q } from './nope.js';"));
    const dir = tmp();
    const out = join(dir, 'COB.html');
    const r = build(['--root', root, '--out', out, '--date', FIXED_DATE]);
    ran(r);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/ca-view\.js|nope\.js/);
    expect(existsSync(out)).toBe(false);
    expect(readdirSync(dir)).toEqual([]);
  });

  it('the line number is reported for a rejected statement', () => {
    const root = copyTree();
    edit(root, 'ui/ca-view.js', prepend("import x from './ui.js';"));
    const r = build(['--root', root, '--out', join(tmp(), 'o.html'), '--date', FIXED_DATE]);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/ca-view\.js[:\s(]+(?:line\s*)?1\b/);
  });
});

describe('B30-R3-d: Help blocks', () => {
  it('a tree whose ca.html has no Help blocks (Help removed) builds to the identical bytes', () => {
    const full = copyTree();
    const bare = copyTree();
    const [b, e] = [HELP_TOKENS.find((t) => t.endsWith(':BEGIN')), HELP_TOKENS.find((t) => t.endsWith(':END'))];
    edit(bare, 'ui/ca.html', (s) => s
      .replace(new RegExp('/\\* ' + b + ' \\*/[\\s\\S]*?/\\* ' + e + ' \\*/\\n?', 'g'), '')
      .replace(new RegExp('[ \\t]*<!-- ' + b + ' -->[\\s\\S]*?<!-- ' + e + ' -->\\n?', 'g'), ''));
    expect(read(join(bare, 'ui/ca.html'))).not.toContain(b);
    const o1 = join(full, 'o.html');
    const o2 = join(bare, 'o.html');
    expect(build(['--root', full, '--out', o1, '--date', FIXED_DATE]).status).toBe(0);
    const r = build(['--root', bare, '--out', o2, '--date', FIXED_DATE]);
    expect(r.status, r.stderr).toBe(0);
    // whitespace left behind by removing the blocks is the builder's business; nothing else may differ
    expect(read(o2).replace(/\s+/g, '')).toBe(read(o1).replace(/\s+/g, ''));
  });
});
