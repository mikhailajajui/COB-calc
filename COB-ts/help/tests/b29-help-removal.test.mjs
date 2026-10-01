/**
 * B29-X5 T-X: the documented removal procedure, performed by the test on a scratch copy (never on the
 * real tree). QA 2026-09-30. The steps come from the `removal-steps` block of help/README.md, run by
 * the QA interpreter in support/removal-steps.mjs, so the documented steps are the tested steps.
 *
 * Scenario A: documents kept, Help removed. Scenario C: nothing removed, docs/ deleted in the copy.
 * Scenario D: the interpreter fails closed. Needs no installed package. Red until sr-dev writes
 * help/README.md (with the block) and the ca.html blocks. The whole-suite layer is F15
 * (check_help_removal.mjs). Deleted with the help/ folder.
 */
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join, sep } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { COB, FIXTURES, HELP, read, readJson, sha256, sha256File, tmp, treeHash, walk } from './support/common.mjs';
import { checkAllowlist, parseRemovalSteps, parseStep, runSteps } from './support/removal-steps.mjs';

const BASE = readJson(join(FIXTURES, 'pre-b29-baseline.json'));
const LOCKSET = readJson(join(FIXTURES, 'pre-help-lock-packages.json')).packages;
const TOKENS = BASE.noTraceTokens;
const README = join(HELP, 'README.md');
const T = 300_000;

const SKIP = new Set(['node_modules', 'dist', '.git']);
/**
 * <parent>/COB-ts is the copy; the parent also receives COB-user-stories.md because F7 reads
 * ../COB-user-stories.md (the brief's "copy of COB-ts" alone makes F7 fail: QA finding). Returns the COB-ts copy.
 */
function copyTree({ stories = true } = {}) {
  const parent = tmp('b29-removal-');
  const dst = join(parent, 'COB-ts');
  cpSync(COB, dst, {
    recursive: true,
    filter: (src) => !src.split(sep).some((p) => SKIP.has(p)) || src === COB,
  });
  if (stories) cpSync(join(COB, '..', 'COB-user-stories.md'), join(parent, 'COB-user-stories.md'));
  symlinkSync(join(COB, 'node_modules'), join(dst, 'node_modules'));
  return dst;
}

function sh(cwd, cmd, args, timeout = T) {
  const r = spawnSync(cmd, args, { cwd, encoding: 'utf8', timeout, env: { ...process.env, CI: '1', NO_COLOR: '1', FORCE_COLOR: '0' } });
  return { status: r.status, out: ((r.stdout ?? '') + (r.stderr ?? '')).replace(/\u001b\[[0-9;]*m/g, '') };
}
const SUBSET = ['vitest', 'run', 'tests/architecture', 'tests/tooling', 'tests/ca/golden', 'tests/ui'];

function independentStrip(src) {
  const out = [];
  let end = null;
  for (const line of src.split('\n')) {
    if (!end && line.includes('/* HELP:BEGIN */')) end = '/* HELP:END */';
    else if (!end && line.includes('<!-- HELP:BEGIN -->')) end = '<!-- HELP:END -->';
    if (!end) out.push(line);
    else if (line.includes(end)) end = null;
  }
  return out.join('\n');
}

describe('B29-X5: the README holds the one machine-readable removal block, and the numbered text says the same', () => {
  it('help/README.md has exactly one removal-steps block with exactly the four documented actions, in order', () => {
    const lines = parseRemovalSteps(read(README));
    expect(lines).toEqual([
      'delete ui/help.html',
      'strip ui/ca.html /* HELP:BEGIN */ /* HELP:END */',
      'strip ui/ca.html <!-- HELP:BEGIN --> <!-- HELP:END -->',
      'delete help',
    ]);
    checkAllowlist(lines.map(parseStep)); // no other verb or path (MUT-35)
  });

  it('the numbered text outside the block names the same three paths and the four markers, and never the docs folder as a deletion', () => {
    const text = read(README).replace(/^```[ \t]*removal-steps[\s\S]*?^```/m, '');
    for (const needle of ['ui/help.html', 'ui/ca.html', 'rm -r help', '/* HELP:BEGIN */', '/* HELP:END */', '<!-- HELP:BEGIN -->', '<!-- HELP:END -->']) {
      expect(text, needle).toContain(needle);
    }
    expect(text).not.toMatch(/rm\s+(?:-\w+\s+)*docs/);
    expect(read(README)).toMatch(/How to remove Help/i);
  });
});

describe('B29-X5 scenario A: documents kept, Help removed by the documented steps', () => {
  let copy;
  let docsBefore;
  let lines;
  let steps;
  let setupError = null;
  beforeAll(() => {
    try {
      lines = parseRemovalSteps(read(README));
      copy = copyTree();
      docsBefore = treeHash(join(copy, 'docs'));
      steps = runSteps(copy, lines);
    } catch (e) {
      setupError = e;
    }
  }, T);
  beforeEach(() => {
    if (setupError) throw new Error(`scenario A setup failed: ${setupError.message}`);
  });
  afterAll(() => copy && rmSync(join(copy, '..'), { recursive: true, force: true }));

  it('the three paths are gone (ui/help.html, the help/ folder) and four steps ran', () => {
    expect(steps.length).toBe(4);
    expect(existsSync(join(copy, 'ui', 'help.html'))).toBe(false);
    expect(existsSync(join(copy, 'help'))).toBe(false);
  });

  it('B29-INV-REVERT: ca.html equals the independent strip of the marker lines AND the pre-B29 sha256', () => {
    const original = read(join(COB, 'ui', 'ca.html'));
    const now = read(join(copy, 'ui', 'ca.html'));
    expect(now).toBe(independentStrip(original));
    expect(sha256(now)).toBe(BASE.files['ui/ca.html']);
  });

  it('the procedure edits nothing outside COB-ts: the scratch parent still holds only COB-ts and the verbatim COB-user-stories.md (B29-X5a (1))', () => {
    const parent = join(copy, '..');
    expect(walk(parent, new Set(['COB-ts'])).sort()).toEqual(['COB-user-stories.md']);
    expect(sha256File(join(parent, 'COB-user-stories.md'))).toBe(sha256File(join(COB, '..', 'COB-user-stories.md')));
  });

  it('B29-INV-DOCSKEPT: the docs tree hash is unchanged by the procedure', () => {
    expect(treeHash(join(copy, 'docs'))).toBe(docsBefore);
    expect(walk(join(copy, 'docs')).sort()).toEqual(['COB-coverage.md', 'COB-domain-overview.md', 'COB-user-manual.md']);
  });

  it('B29-INV-OWNPKG: root package.json and package-lock.json equal the baseline and the lock name@version set equals the fixture', () => {
    expect(sha256File(join(copy, 'package.json'))).toBe(BASE.files['package.json']);
    expect(sha256File(join(copy, 'package-lock.json'))).toBe(BASE.files['package-lock.json']);
    const lock = JSON.parse(read(join(copy, 'package-lock.json')));
    const set = [...new Set(Object.entries(lock.packages).filter(([k]) => k).map(([k, v]) => `${k.replace(/^(?:.*\/)?node_modules\//, '')}@${v.version}`))].sort();
    expect(set).toEqual(LOCKSET);
  });

  it('B29-INV-NOTRACE: no Help token in package.json, package-lock.json, ui/, src/, tests/ of the copy', () => {
    const found = {};
    const files = ['package.json', 'package-lock.json', ...['ui', 'src', 'tests'].flatMap((d) => walk(join(copy, d)).map((f) => `${d}/${f}`))];
    for (const rel of files) {
      if (/\.(?:png|jpg|pdf|woff2?)$/.test(rel)) continue;
      const src = read(join(copy, rel));
      const t = TOKENS.filter((tok) => src.includes(tok));
      if (t.length) found[rel] = t;
    }
    expect(found).toEqual({});
  });

  it('npm run build, typecheck and typecheck:tests exit 0 in the copy', () => {
    for (const script of ['build', 'typecheck', 'typecheck:tests']) {
      const r = sh(copy, 'npm', ['run', script, '--silent']);
      expect(r.status, `${script}: ${r.out.slice(-600)}`).toBe(0);
    }
  }, T);

  it('vitest on tests/architecture tests/tooling tests/ca/golden tests/ui is green (F1 to F11, A13 build and serve, both goldens)', () => {
    const r = sh(copy, 'npx', SUBSET);
    expect(r.status, r.out.slice(-1500)).toBe(0);
    expect(r.out).toMatch(/Tests\s+\d+ passed/);
    expect(r.out).not.toMatch(/failed/);
  }, T);

  it('the golden and capture fixtures keep their sha256 in the copy', () => {
    for (const f of ['golden_engine_v1.json', 'golden_engine_pc_v1.json', 'a10_ui_capture_v1.json', 'b23_on_state_pins.json']) {
      expect(sha256File(join(copy, 'tests', 'ca', 'fixtures', f))).toBe(BASE.files[`tests/ca/fixtures/${f}`]);
    }
  });
});

describe('B29-X5 scenario C / B29-INV-NOOUTSIDE: nothing outside help/ needs docs/ (Help kept, docs/ deleted in the copy)', () => {
  let copy;
  beforeAll(() => {
    copy = copyTree();
    rmSync(join(copy, 'docs'), { recursive: true, force: true });
  }, T);
  afterAll(() => copy && rmSync(join(copy, '..'), { recursive: true, force: true }));

  it('build, typecheck, typecheck:tests exit 0', () => {
    expect(existsSync(join(copy, 'help'))).toBe(true); // Help is still there
    for (const script of ['build', 'typecheck', 'typecheck:tests']) {
      const r = sh(copy, 'npm', ['run', script, '--silent']);
      expect(r.status, `${script}: ${r.out.slice(-600)}`).toBe(0);
    }
  }, T);

  it('the same vitest subset is green', () => {
    const r = sh(copy, 'npx', SUBSET);
    expect(r.status, r.out.slice(-1500)).toBe(0);
  }, T);

  it('B29-X7 (iii): `node help/build-help.mjs --check` prints the skip sentence and exits 0 with docs/ absent', () => {
    const r = sh(copy, process.execPath, ['help/build-help.mjs', '--check']);
    expect(r.status).toBe(0);
    expect(r.out).toContain('Help sources (docs/) not found: nothing to check.');
  });
});

describe('B29-X5a negative control (revision 36, QA finding F-3): F7 reads ../COB-user-stories.md, with or without Help', () => {
  const F7 = ['vitest', 'run', 'tests/architecture/f7-decisions-registered.test.ts'];
  let without;
  let withIt;
  beforeAll(() => {
    without = copyTree({ stories: false }); // an UNREMOVED copy (Help still there) without the parent file
    withIt = copyTree({ stories: true });
  }, T);
  afterAll(() => {
    for (const c of [without, withIt]) if (c) rmSync(join(c, '..'), { recursive: true, force: true });
  });

  it('an unremoved scratch copy WITHOUT COB-user-stories.md beside it fails F7 (so a red F7 in a removal run is the layout, never the removal)', () => {
    expect(existsSync(join(without, 'help'))).toBe(true);
    expect(existsSync(join(without, '..', 'COB-user-stories.md'))).toBe(false);
    const r = sh(without, 'npx', F7);
    expect(r.status, r.out.slice(-800)).not.toBe(0);
    expect(r.out).toMatch(/COB-user-stories|failed/);
  }, T);

  it('an unremoved scratch copy WITH the verbatim COB-user-stories.md beside it passes F7', () => {
    expect(existsSync(join(withIt, 'help'))).toBe(true);
    expect(sha256File(join(withIt, '..', 'COB-user-stories.md'))).toBe(sha256File(join(COB, '..', 'COB-user-stories.md')));
    const r = sh(withIt, 'npx', F7);
    expect(r.status, r.out.slice(-800)).toBe(0);
    expect(r.out).toMatch(/Tests\s+\d+ passed/);
  }, T);
});

describe('B29-X5 scenario D: the interpreter fails closed (leaves the tree byte-identical)', () => {
  const GOOD_CA = ['<style>', '/* HELP:BEGIN */', '.help-link{}', '/* HELP:END */', '</style>', '<header>', '<!-- HELP:BEGIN -->', '<a class="help-link"></a>', '<!-- HELP:END -->', '</header>', ''].join('\n');
  const STEPS = [
    'delete ui/help.html',
    'strip ui/ca.html /* HELP:BEGIN */ /* HELP:END */',
    'strip ui/ca.html <!-- HELP:BEGIN --> <!-- HELP:END -->',
    'delete help',
  ];
  function mini(ca) {
    const d = tmp('b29-mini-');
    mkdirSync(join(d, 'ui'));
    mkdirSync(join(d, 'help'));
    mkdirSync(join(d, 'docs'));
    writeFileSync(join(d, 'ui', 'ca.html'), ca);
    writeFileSync(join(d, 'ui', 'help.html'), '<html></html>');
    writeFileSync(join(d, 'help', 'x.txt'), 'x');
    writeFileSync(join(d, 'docs', 'a.md'), '# a');
    return d;
  }

  it('control: on a well-formed copy the four steps remove exactly the Help lines and paths', () => {
    const d = mini(GOOD_CA);
    runSteps(d, STEPS);
    expect(read(join(d, 'ui', 'ca.html'))).toBe('<style>\n</style>\n<header>\n</header>\n');
    expect(existsSync(join(d, 'help'))).toBe(false);
    expect(existsSync(join(d, 'docs', 'a.md'))).toBe(true);
  });

  it.each([
    ['a missing css BEGIN marker', GOOD_CA.replace('/* HELP:BEGIN */\n', '')],
    ['a missing html END marker', GOOD_CA.replace('<!-- HELP:END -->\n', '')],
    ['an unpaired marker (END before BEGIN)', ['<style>', '/* HELP:END */', '.help-link{}', '/* HELP:BEGIN */', '</style>', '<header>', '<!-- HELP:BEGIN -->', '<!-- HELP:END -->', '</header>', ''].join('\n')],
    ['a doubled BEGIN marker', GOOD_CA.replace('<header>', '<header>\n<!-- HELP:BEGIN -->')],
  ])('%s: throws and the copy is byte-identical afterwards (MUT-34)', (_n, ca) => {
    const d = mini(ca);
    const before = treeHash(d);
    expect(() => runSteps(d, STEPS)).toThrow();
    expect(treeHash(d)).toBe(before);
  });

  it.each([
    ['delete src', 'delete src'],
    ['delete docs (MUT-35)', 'delete docs'],
    ['delete a parent path', 'delete ../x'],
    ['delete an absolute path', 'delete /etc'],
    ['strip another file', 'strip ui/ca.js /* HELP:BEGIN */ /* HELP:END */'],
    ['an unknown verb', 'move ui/help.html ui/x.html'],
  ])('%s: throws and the copy is byte-identical afterwards', (_n, extra) => {
    const d = mini(GOOD_CA);
    const before = treeHash(d);
    expect(() => runSteps(d, [...STEPS.slice(0, 1), extra, ...STEPS.slice(1)])).toThrow();
    expect(treeHash(d)).toBe(before);
  });

  it('a README without the block, or with two blocks, throws', () => {
    expect(() => parseRemovalSteps('# no block')).toThrow();
    expect(() => parseRemovalSteps('```removal-steps\ndelete help\n```\n\n```removal-steps\ndelete help\n```\n')).toThrow();
  });
});
