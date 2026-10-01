/**
 * B29-R13 (revision 38, F-6): the UI-scan guard. Three baseline tests read every file of the UI folder and fail on a
 * string; the Help page quotes the documents, so the build (and --check) refuses a document line, and finally the
 * generated page, that contains one. QA 2026-09-30. Red until sr-dev writes help/lib/ui-scan-guard.mjs and wires it.
 * Groups: G1 pins and module, G2 cross-check against the baseline tests (read AS TEXT), G3 tripwire for new scans,
 * G4 build refuses, G5 near misses build, G6 reported together, G7 backstop on the page, G8 --check, G9 live.
 * The forbidden spellings are built from pieces so that this file is itself never a hit. Deleted with help/.
 */
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  COB, DOCS, DOCS_PRESENT, DOC_FILES, FIXTURES, HELP, INSTALLED, PAGE, PAGE_PRESENT, STUB, build, buildDocs, mermaidBlock,
  mkDocs, read, readJson, sha256File, tmp,
} from './support/common.mjs';

// ---- the three forbidden spellings and the pinned rows (B29-R13) ------------------------------------------------
const S1 = 'included' + 'InCob';
const S2 = 'total' + 'Fees';
const S3 = 'archive' + '/pre-b27';
const ROWS = [
  { id: 'UIG-1', source: S1, match: S1, origin: 'b10-includedincob-optional.test.ts' },
  { id: 'UIG-2', source: '\\b' + S2 + '\\b', match: S2, origin: 'fees.test.ts' },
  { id: 'UIG-3', source: 'archive\\/pre-b27', match: S3, origin: 'b27-personal-loan-monthly-only.test.ts' },
];
const NEAR_MISSES = [
  ['the capitalised ' + S2 + 'Included' + 'InCob (UIG-2 needs a word boundary, UIG-1 is case-sensitive)', S2 + 'Included' + 'InCob'],
  ['Included in COB', 'Included in COB'],
  ['total fees', 'total fees'],
  ['archive/pre-b26', 'archive/pre-b26'],
  ['archive pre-b27', 'archive pre-b27'],
];
const TESTS_DIR = join(COB, 'tests');
const GUARD = join(HELP, 'lib', 'ui-scan-guard.mjs');

/** The regex of one exported row, whatever the row's shape: { id, pattern | re | regex } or [id, regex]. */
const idOf = (row) => (Array.isArray(row) ? row[0] : row.id);
const reOf = (row) => (Array.isArray(row) ? row[1] : row.pattern ?? row.re ?? row.regex);
const guard = async () => {
  expect(existsSync(GUARD), 'help/lib/ui-scan-guard.mjs is missing (red until sr-dev writes it)').toBe(true);
  return import(pathToFileURL(GUARD).href);
};

// ======================================================================================================== G1
describe('G1 the guard module: the pinned list (B29-R13)', () => {
  it('UI_SCAN_PATTERNS is exactly the three rows UIG-1, UIG-2, UIG-3 with these regex sources, in this order (value pin)', async () => {
    const { UI_SCAN_PATTERNS } = await guard();
    expect(Array.isArray(UI_SCAN_PATTERNS)).toBe(true);
    expect(UI_SCAN_PATTERNS.map((r) => [idOf(r), reOf(r) instanceof RegExp ? reOf(r).source : reOf(r)])).toEqual(ROWS.map((r) => [r.id, r.source]));
  });

  it('no pattern has the g or y flag (a stateful regex would skip lines) and none is case-insensitive', async () => {
    const { UI_SCAN_PATTERNS } = await guard();
    for (const row of UI_SCAN_PATTERNS) expect(reOf(row).flags, idOf(row)).toBe('');
  });

  it.each(ROWS)('findForbidden reports $id for "$match" on its 1-based line, with the match text', async (row) => {
    const { findForbidden } = await guard();
    const text = ['one', 'two', `three ${row.match} here`, 'four'].join('\n');
    expect(findForbidden(text)).toEqual([{ line: 3, id: row.id, match: row.match }]);
  });

  it.each(NEAR_MISSES)('findForbidden returns nothing for the near miss: %s', async (_name, text) => {
    const { findForbidden } = await guard();
    expect(findForbidden(`before\n${text}\nafter`)).toEqual([]);
  });

  it('one entry per line and pattern: two occurrences of one string on a line give one entry; two patterns on one line give two', async () => {
    const { findForbidden } = await guard();
    expect(findForbidden(`${S1} and ${S1}`)).toEqual([{ line: 1, id: 'UIG-1', match: S1 }]);
    const two = findForbidden(`${S1} ${S2}`);
    expect(two.map((h) => [h.line, h.id]).sort()).toEqual([[1, 'UIG-1'], [1, 'UIG-2']]);
  });

  it('the module imports nothing and its non-comment source names no path under the UI folder or the tests folder (F16 READONLY wording)', async () => {
    await guard();
    const src = read(GUARD);
    expect(src).not.toMatch(/^\s*import\s/m);
    expect(src).not.toMatch(/\bimport\s*\(/);
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(code).not.toMatch(/\bui\//);
    expect(code).not.toMatch(/\btests\//);
  });
});

// ======================================================================================================== G2
describe('G2 cross-check: the baseline tests (read as text, never imported) still scan what the guard list says', () => {
  const FILES = ROWS.map((r) => [r.id, r.origin]);
  const text = (name) => {
    const p = join(TESTS_DIR, 'ca', name);
    expect(existsSync(p), `baseline test ${name} was not found under tests/ca (renamed or removed: UIG row needs review)`).toBe(true);
    return readFileSync(p, 'utf8');
  };

  it.each(FILES)('%s: the origin file %s exists under tests/ca', (_id, name) => {
    text(name);
  });

  it('b10-includedincob-optional.test.ts contains the scan /' + S1 + '/ and the phrase "mentions ' + S1 + '"', () => {
    const t = text('b10-includedincob-optional.test.ts');
    expect(t).toContain('/' + S1 + '/');
    expect(t).toContain('mentions ' + S1);
  });

  it('fees.test.ts contains the scan /\\b' + S2 + '\\b/', () => {
    expect(text('fees.test.ts')).toContain('/\\b' + S2 + '\\b/');
  });

  it("b27-personal-loan-monthly-only.test.ts builds the needle as 'archive' + '/pre-b27'", () => {
    expect(text('b27-personal-loan-monthly-only.test.ts')).toContain("'archive' + '/pre-b27'");
  });

  it('each baseline test still scans the UI folder with the extensions the guard assumes (js, mjs, html; and ts for the third)', () => {
    expect(text('b10-includedincob-optional.test.ts')).toMatch(/listFiles\(join\(ROOT, 'ui'\), \/\\\.\(js\|mjs\|html\)\$\/\)/);
    expect(text('fees.test.ts')).toMatch(/listFiles\(join\(ROOT, 'ui'\), \/\\\.\(js\|mjs\|html\)\$\/\)/);
    expect(text('b27-personal-loan-monthly-only.test.ts')).toMatch(/listFiles\(join\(ROOT, 'ui'\), \/\\\.\(js\|mjs\|html\|ts\)\$\/\)/);
  });

  it('the guard list and the baseline texts agree, derived from the module rather than from this file (drift in either direction fails)', async () => {
    const { UI_SCAN_PATTERNS } = await guard();
    const byId = Object.fromEntries(UI_SCAN_PATTERNS.map((r) => [idOf(r), reOf(r).source]));
    expect(text('b10-includedincob-optional.test.ts')).toContain(`/${byId['UIG-1']}/`);
    expect(text('fees.test.ts')).toContain(`/${byId['UIG-2']}/`);
    const needle = byId['UIG-3'].replace(/\\\//g, '/');
    expect(text('b27-personal-loan-monthly-only.test.ts')).toContain(`'${needle.slice(0, 7)}' + '${needle.slice(7)}'`);
  });
});

// ======================================================================================================== G3
/** Files under tests/ that read the UI folder: a join/resolve/readdirSync/listFiles call that names 'ui' (or 'ui/..'). */
const SCANS_UI = /(?:\bjoin|\bresolve|\breaddirSync|\blistFiles)\s*\([^)]*['"`]ui(?:['"`]|\/)/;
function testFiles(dir = TESTS_DIR) {
  const out = [];
  for (const name of readdirSync(dir).sort()) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) out.push(...testFiles(full));
    else if (/\.(?:[cm]?[jt]s)$/.test(name) && !name.endsWith('.d.ts')) out.push(full);
  }
  return out;
}
const rel = (p) => relative(COB, p).split(sep).join('/');
const FIXTURE = readJson(join(FIXTURES, 'ui-scanning-tests.json'));

describe('G3 tripwire: a new test that reads the UI folder must be looked at (B29-R13 maintenance)', () => {
  it('every file under tests/ that reads the UI folder is in help/tests/fixtures/ui-scanning-tests.json', () => {
    const live = testFiles().filter((f) => SCANS_UI.test(readFileSync(f, 'utf8'))).map(rel);
    const pinned = new Set(FIXTURE.files.map((f) => f.file));
    const fresh = live.filter((f) => !pinned.has(f));
    expect(
      fresh,
      'a new test scans the UI folder: decide whether help.html can break it; add it to the fixture and, if it forbids strings, to ui-scan-guard.mjs',
    ).toEqual([]);
  });

  it('every pinned file still exists and still matches the detector (a renamed or changed test is noticed)', () => {
    const gone = FIXTURE.files.filter((f) => !existsSync(join(COB, f.file)) || !SCANS_UI.test(readFileSync(join(COB, f.file), 'utf8'))).map((f) => f.file);
    expect(gone).toEqual([]);
  });

  it('the fixture marks exactly the three baseline files as negative scans, each with its UIG id', () => {
    const neg = Object.fromEntries(FIXTURE.files.filter((f) => f.negative).map((f) => [f.file.split('/').pop(), f.negative]));
    expect(neg).toEqual(Object.fromEntries(ROWS.map((r) => [r.origin, r.id])));
  });

  it('the detector is not vacuous: it matches the three baseline scan lines and ignores a file that never names the UI folder', () => {
    expect(SCANS_UI.test("listFiles(join(ROOT, 'ui'), /\\.(js|mjs|html)$/)")).toBe(true);
    expect(SCANS_UI.test("readFileSync(join(ROOT, 'ui/ca.html'))")).toBe(true);
    expect(SCANS_UI.test("readdirSync(resolve(ROOT, 'ui'))")).toBe(true);
    expect(SCANS_UI.test("join(ROOT, 'src', 'ca.ts')")).toBe(false);
    expect(testFiles().length).toBeGreaterThan(60);
  });
});

// ======================================================================================================== builds
const d = describe.skipIf(!INSTALLED);
const SENTINEL = '<!-- previous page: must survive a refused build byte for byte -->\n';
const ORIGIN = Object.fromEntries(ROWS.map((r) => [r.id, r.origin]));
const SUMMARY = (n) => `Help build refused: ${n} forbidden string(s). Documents must not contain identifiers that the UI-folder scans forbid; reword them.`;
const lineOf = (md, s) => md.split('\n').findIndex((l) => l.includes(s)) + 1;
const MANUAL = 'COB-user-manual.md';

/** Build `over` with a sentinel page in place; returns the result, the document text and whether the page survived. */
function refuse(over, opts = {}) {
  const m = mkDocs(over);
  writeFileSync(m.out, SENTINEL);
  const before = sha256File(m.out);
  const r = build({ docs: m.dir, out: m.out, renderer: STUB, ...opts });
  return { m, r, intact: sha256File(m.out) === before, all: r.stderr + r.stdout };
}

const PLACEMENTS = [
  ['body text', (s) => `# T\n\n## A\n\nSome text with ${s} inside.\n`],
  ['a code span', (s) => `# T\n\n## A\n\nSome \`${s}\` text.\n`],
  ['a table cell', (s) => `# T\n\n## A\n\n| a | b |\n|---|---|\n| ${s} | y |\n`],
  ['a heading', (s) => `# T\n\n## Heading ${s}\n\nText.\n`],
  ['a Mermaid fence', (s) => '# T\n\n## A\n\n' + mermaidBlock(null, `flowchart LR\n    A["${s}"]:::today --> B["Beta"]`)],
];

d('G4 the build refuses a forbidden string (B29-R13, R10, INV-NOPARTIAL)', () => {
  const CASES = ROWS.flatMap((row) => PLACEMENTS.map(([where, make]) => [row.id, row.match, row.origin, where, make]));

  it.each(CASES)('%s "%s" in %s %s: exit 1, docs/<file>:<line>: with the match, the id and the origin file; the old page is byte-identical', (id, match, origin, where, make) => {
    const md = make(match);
    const { r, all, intact } = refuse({ manual: md });
    const line = lineOf(md, match);
    expect(r.status, all.slice(0, 500)).toBe(1);
    expect(r.stderr).toContain(`docs/${MANUAL}:${line}: forbidden string "${match}" (${id}): a baseline test that scans the UI folder fails on it (${origin}); reword the document`);
    expect(r.stderr).toContain(SUMMARY(1));
    expect(intact, 'the previous page must be left byte-identical').toBe(true);
  });

  it.each(Object.keys(DOC_FILES))('the string is found in the %s document too, named by that document\'s file', (key) => {
    const md = `# T\n\n## A\n\nText with ${S1} here.\n`;
    const { r, intact } = refuse({ [key]: md });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain(`docs/${DOC_FILES[key]}:${lineOf(md, S1)}: forbidden string "${S1}" (UIG-1)`);
    expect(intact).toBe(true);
  });

  it('the exact error format: prefix up to the first colon is docs/<file>, then the line, then the sentence; every refused line is one line', () => {
    const { r } = refuse({ manual: `# T\n\n## A\n\nx ${S2}() y\n` });
    const hit = r.stderr.split('\n').filter((l) => l.startsWith('docs/'));
    expect(r.stderr).toContain(SUMMARY(1));
    expect(hit).toEqual([`docs/${MANUAL}:5: forbidden string "${S2}" (UIG-2): a baseline test that scans the UI folder fails on it (fees.test.ts); reword the document`]);
  });

  it('the messages name origin files by bare file name: no ui/ or tests/ path appears in any line about a forbidden string', () => {
    const { r } = refuse({ manual: `# T\n\n## A\n\n${S1} ${S2} ${S3}\n` });
    const hit = r.stderr.split('\n').filter((l) => /forbidden string|Help build refused/.test(l));
    expect(hit.length).toBe(4);
    for (const l of hit) {
      expect(l).not.toMatch(/\bui\//);
      expect(l).not.toMatch(/\btests\//);
    }
  });

  it('three patterns on one line are three hits (one per pattern) and the summary counts hits, not lines', () => {
    const { r } = refuse({ manual: `# T\n\n## A\n\n${S1} ${S2} ${S3}\n` });
    expect(r.status).toBe(1);
    for (const row of ROWS) expect(r.stderr).toContain(`forbidden string "${row.match}" (${row.id})`);
    expect(r.stderr).toContain(SUMMARY(3));
  });

  it('two occurrences of one string on one line are one hit', () => {
    const { r } = refuse({ manual: `# T\n\n## A\n\n${S1} twice ${S1}\n` });
    expect(r.stderr).toContain(SUMMARY(1));
  });

  it('hits are listed in document order (manual, coverage, domain), then by line', () => {
    const body = (n) => `# T\n\n## A\n\n${'x\n\n'.repeat(n)}${S1}\n`;
    const m = mkDocs({ manual: body(2), coverage: '# C\n\n## 1. R\n\n| ID | Status |\n|---|---|\n| US-01 | Covered |\n\n' + S2 + '\n', domain: body(0) });
    const r = build({ docs: m.dir, out: m.out, renderer: STUB });
    expect(r.status).toBe(1);
    const order = r.stderr.split('\n').filter((l) => l.startsWith('docs/')).map((l) => l.split(':')[0] + ':' + l.split(':')[1]);
    expect(order).toEqual([`docs/${MANUAL}:${lineOf(body(2), S1)}`, `docs/COB-coverage.md:9`, `docs/COB-domain-overview.md:5`]);
    expect(r.stderr).toContain(SUMMARY(3));
  });

  it('a refused build writes nothing when there was no previous page, and leaves no temporary file next to the output', () => {
    const m = mkDocs({ manual: `# T\n\n## A\n\n${S1}\n` });
    const r = build({ docs: m.dir, out: m.out, renderer: STUB });
    expect(r.status).toBe(1);
    expect(existsSync(m.out)).toBe(false);
    expect(readdirSync(m.outDir)).toEqual([]);
  });

  it('there is no way round it: the stderr has no "WARNING" form of the message and the exit code is 1, not 0', () => {
    const { r, all } = refuse({ manual: `# T\n\n## A\n\n${S3}\n` });
    expect(r.status).toBe(1);
    expect(all).not.toMatch(/warning:.*forbidden/i);
  });
});

d('G5 the near misses build (B29-R13 allowed list)', () => {
  it.each(NEAR_MISSES)('%s: exit 0, no forbidden-string line, the page is written', (_name, text) => {
    const r = buildDocs({ manual: `# T\n\n## A\n\nBefore ${text} after.\n` });
    expect(r.status, r.stderr.slice(0, 400)).toBe(0);
    expect(r.stderr + r.stdout).not.toMatch(/forbidden string/);
    expect(r.html).toContain(text);
  });
});

d('G6 a forbidden string is reported together with another rule\'s failure (R2: all failures together)', () => {
  it('one raw <div> and one forbidden string give two lines and a summary count of 1', () => {
    const md = `# T\n\n## A\n\n<div>raw</div>\n\nText with ${S1}.\n`;
    const { r, intact } = refuse({ manual: md });
    expect(r.status).toBe(1);
    const lines = r.stderr.split('\n').filter((l) => l.startsWith(`docs/${MANUAL}:`));
    expect(lines.length).toBe(2);
    expect(lines[0]).toMatch(new RegExp(`^docs/${MANUAL.replace('.', '\\.')}:5[:\\s]`));
    expect(lines[1]).toContain(`docs/${MANUAL}:7: forbidden string "${S1}" (UIG-1)`);
    expect(r.stderr).toContain(SUMMARY(1));
    expect(intact).toBe(true);
  });
});

d('G7 backstop: the final page string is scanned before the rename (B29-R13 (b))', () => {
  const md = '# T\n\n## A\n\n' + mermaidBlock(null);
  it.each(ROWS)('a renderer whose SVG carries "$match" ($id): exit 1, generated page:<line>:, the match, the id and the origin; no page written', (row) => {
    const m = mkDocs({ domain: md });
    const r = build({ docs: m.dir, out: m.out, renderer: join(FIXTURES, 'stub-renderer-forbidden.mjs'), env: { HELP_STUB_EMIT: row.match } });
    expect(r.status, r.stderr.slice(0, 500)).toBe(1);
    const re = new RegExp(`^generated page:(\\d+): forbidden string "${row.match.replace(/[/]/g, '\\/')}" \\(${row.id}\\): a baseline test that scans the UI folder fails on it \\(${row.origin.replace(/\./g, '\\.')}\\); `, 'm');
    const hit = re.exec(r.stderr);
    expect(hit, r.stderr.slice(0, 500)).toBeTruthy();
    expect(Number(hit[1])).toBeGreaterThan(0);
    expect(r.stderr).not.toMatch(/^docs\//m); // no document line contains it
    expect(r.stderr).toContain(SUMMARY(1));
    expect(existsSync(m.out)).toBe(false);
  });

  it('with a previous page in place the refused backstop build leaves it byte-identical', () => {
    const m = mkDocs({ domain: md });
    writeFileSync(m.out, SENTINEL);
    const before = sha256File(m.out);
    const r = build({ docs: m.dir, out: m.out, renderer: join(FIXTURES, 'stub-renderer-forbidden.mjs'), env: { HELP_STUB_EMIT: S1 } });
    expect(r.status).toBe(1);
    expect(sha256File(m.out)).toBe(before);
  });

  it('control: the same renderer with a harmless string builds (the fixture itself is not the cause)', () => {
    const m = mkDocs({ domain: md });
    const r = build({ docs: m.dir, out: m.out, renderer: join(FIXTURES, 'stub-renderer-forbidden.mjs'), env: { HELP_STUB_EMIT: 'harmless text' } });
    expect(r.status, r.stderr.slice(0, 300)).toBe(0);
    expect(read(m.out)).toContain('harmless text');
  });
});

// ======================================================================================================== G8
d('G8 --check also reports the document hits (B29-R11, R11a, R13)', () => {
  const dirty = `# T\n\n## A\n\nText ${S1} here.\n`;
  /** Build a clean set, then make the manual dirty; --check never builds. */
  function setup(md = dirty) {
    const m = mkDocs();
    const b = build({ docs: m.dir, out: m.out, renderer: STUB });
    expect(b.status, b.stderr.slice(0, 300)).toBe(0);
    writeFileSync(join(m.dir, MANUAL), md);
    const check = (args = [], env = {}) => build({ docs: m.dir, out: m.out, args: ['--check', ...args], env });
    return { m, check, before: sha256File(m.out) };
  }
  const one = (r) => {
    const lines = r.stdout.split('\n').filter((l) => l.trim() !== '');
    expect(lines.length, r.stdout.slice(0, 300)).toBe(1);
    return JSON.parse(lines[0]);
  };

  it('a forbidden string: the same docs/ line and the summary, exit 1 WITHOUT --strict; the page is not touched', () => {
    const { check, m, before } = setup();
    const r = check();
    expect(r.status).toBe(1);
    const all = r.stdout + r.stderr;
    expect(all).toContain(`docs/${MANUAL}:5: forbidden string "${S1}" (UIG-1): a baseline test that scans the UI folder fails on it (b10-includedincob-optional.test.ts); reword the document`);
    expect(all).toContain(SUMMARY(1));
    expect(sha256File(m.out)).toBe(before);
  });

  it('a stale and forbidden state prints both the stale warning and the forbidden line, and still exits 1', () => {
    const { check } = setup();
    const all = check().stdout + check().stderr;
    expect(all).toMatch(/stale/i);
    expect(all).toContain(`docs/${MANUAL}:5: forbidden string`);
  });

  it('--check --json: forbidden holds { file, line, id, match } with exactly those keys, the file is the bare document name, exit 1 without --strict', () => {
    const { check } = setup();
    const r = check(['--json']);
    expect(r.status).toBe(1);
    const j = one(r);
    expect(Object.keys(j).sort()).toEqual(['differs', 'forbidden', 'fresh', 'skipped']);
    expect(j.forbidden).toEqual([{ file: MANUAL, line: 5, id: 'UIG-1', match: S1 }]);
    expect(Object.keys(j.forbidden[0]).sort()).toEqual(['file', 'id', 'line', 'match']);
  });

  it('forbidden does not change fresh: fresh is true exactly when differs is empty', () => {
    const { check } = setup();
    const j = one(check(['--json']));
    expect(j.fresh).toBe(j.differs.length === 0);
    expect(j.differs.map((x) => x.kind)).toEqual(['document']); // the dirty edit is a changed byte, nothing else
  });

  it('a clean set: forbidden is [] and the object is { fresh: true, skipped: false, forbidden: [], differs: [] }, exit 0', () => {
    const { check } = setup('# Test manual\n\n## 1. Introduction\n\nSome text.\n');
    const r = check(['--json', '--strict']);
    expect(r.status).toBe(0);
    expect(one(r)).toEqual({ fresh: true, skipped: false, forbidden: [], differs: [] });
  });

  it('docs/ absent (skipped): forbidden is [] and the exit code is 0', () => {
    const m = mkDocs();
    const r = build({ docs: join(m.dir, 'no-such-docs'), out: m.out, args: ['--check', '--json'] });
    expect(r.status).toBe(0);
    expect(one(r)).toEqual({ fresh: true, skipped: true, forbidden: [], differs: [] });
  });

  it('several hits are listed in document order then line, one entry per line and pattern', () => {
    const { check } = setup(`# T\n\n## A\n\n${S1} ${S2}\n\n${S3}\n`);
    const j = one(check(['--json']));
    expect(j.forbidden.map((h) => [h.file, h.line, h.id])).toEqual([[MANUAL, 5, 'UIG-1'], [MANUAL, 5, 'UIG-2'], [MANUAL, 7, 'UIG-3']]);
  });
});

// ======================================================================================================== G9
describe('G9 live: the documents and the committed page hold none of the three strings (the F-6 regression guard)', () => {
  const independent = [new RegExp(S1), new RegExp('\\b' + S2 + '\\b'), new RegExp('archive\\/pre-b27')];
  const hits = (text, label) => text.split('\n').flatMap((l, i) => independent.filter((re) => re.test(l)).map((re) => `${label}:${i + 1} ${re.source}`));

  it.skipIf(!DOCS_PRESENT)('COB-user-manual.md, COB-coverage.md and COB-domain-overview.md give zero hits for UIG-1..3', () => {
    const all = Object.values(DOC_FILES).flatMap((f) => hits(read(join(DOCS, f)), `docs/${f}`));
    expect(all).toEqual([]);
  });

  it.skipIf(!PAGE_PRESENT)('the committed ui/help.html gives zero hits for UIG-1..3', () => {
    expect(hits(read(PAGE), 'ui/help.html')).toEqual([]);
  });

  it.skipIf(!DOCS_PRESENT || !INSTALLED)('the real builder agrees: --check --json on the live documents has forbidden: []', () => {
    const r = build({ args: ['--check', '--json'] });
    const line = r.stdout.split('\n').find((l) => l.trim().startsWith('{'));
    expect(line, r.stderr.slice(0, 300)).toBeTruthy();
    expect(JSON.parse(line).forbidden).toEqual([]);
  });
});
