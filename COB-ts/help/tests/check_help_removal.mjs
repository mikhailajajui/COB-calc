// F15 (COB-architecture.md section 6, B29-X5, B29-X4 step 5): Help is removable. A script, NOT vitest, because it
// runs the whole suite in a scratch copy. QA-owned. Needs no installed Help package.
//
// usage (from COB-ts/):  node help/tests/check_help_removal.mjs [--chrome]
//
// Copies COB-ts (without node_modules, help/node_modules, dist, .git; the root node_modules is symlinked
// read-only), performs the documented removal steps (the `removal-steps` block of help/README.md, run by the
// QA interpreter), then on the copy: npm run build, typecheck, typecheck:tests, the WHOLE suite (counts must equal
// the pre-B29 baseline plus the generic serve cases), npm run test:tz, sha256 of both goldens, the capture
// fixture and b23_on_state_pins.json, the no-trace token check, the lock-set check, ca.html equals the pre-B29
// sha256, docs/ unchanged, root package.json and lock unchanged. With --chrome also F12 (16/16) and the capture
// diff against the fixture minus `provenance`. Exit code 1 on any difference.
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join, sep } from 'node:path';
import { COB, FIXTURES, HELP, read, readJson, sha256, sha256File, tmp, treeHash, walk } from './support/common.mjs';
import { parseRemovalSteps, runSteps } from './support/removal-steps.mjs';

const chrome = process.argv.includes('--chrome');
const BASE = readJson(join(FIXTURES, 'pre-b29-baseline.json'));
const LOCKSET = readJson(join(FIXTURES, 'pre-help-lock-packages.json')).packages;
let failures = 0;
const check = (name, ok, detail = '') => {
  if (!ok) failures++;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}${ok || !detail ? '' : `\n      ${String(detail).slice(-900).replace(/\n/g, '\n      ')}`}`);
};
const sh = (cwd, cmd, args, timeout = 900_000) => {
  const r = spawnSync(cmd, args, { cwd, encoding: 'utf8', timeout, env: { ...process.env, CI: '1', NO_COLOR: '1', FORCE_COLOR: '0' }, maxBuffer: 64 * 1024 * 1024 });
  return { status: r.status, out: ((r.stdout ?? '') + (r.stderr ?? '')).replace(/\u001b\[[0-9;]*m/g, '') };
};

const SKIP = new Set(['node_modules', 'dist', '.git']);
// <parent>/COB-ts is the copy; the parent also holds COB-user-stories.md because F7 reads ../COB-user-stories.md
const parent = tmp('b29-f15-');
const copy = join(parent, 'COB-ts');
cpSync(COB, copy, { recursive: true, filter: (src) => !src.split(sep).some((p) => SKIP.has(p)) || src === COB });
cpSync(join(COB, '..', 'COB-user-stories.md'), join(parent, 'COB-user-stories.md'));
symlinkSync(join(COB, 'node_modules'), join(copy, 'node_modules'));
console.log(`F15 Help removal on a scratch copy: ${copy}${chrome ? ' (with Chrome checks)' : ''}`);
const docsBefore = treeHash(join(copy, 'docs'));

// B29-X5a negative control (revision 36): an UNREMOVED copy fails F7 without ../COB-user-stories.md and passes with it,
// so a red F7 after the removal can never be blamed on the removal, nor a missing parent file on Help.
{
  const stories = join(parent, 'COB-user-stories.md');
  const F7 = ['vitest', 'run', 'tests/architecture/f7-decisions-registered.test.ts'];
  check('scratch layout: COB-user-stories.md beside the copy is verbatim', sha256File(stories) === sha256File(join(COB, '..', 'COB-user-stories.md')));
  const withIt = sh(copy, 'npx', F7);
  check('negative control: unremoved copy WITH COB-user-stories.md passes F7', withIt.status === 0 && /Tests\s+\d+ passed/.test(withIt.out), withIt.out);
  renameSync(stories, `${stories}.off`);
  const without = sh(copy, 'npx', F7);
  check('negative control: unremoved copy WITHOUT COB-user-stories.md fails F7', without.status !== 0, without.out);
  renameSync(`${stories}.off`, stories);
}

try {
  const steps = runSteps(copy, parseRemovalSteps(read(join(HELP, 'README.md'))));
  check('the documented steps ran (4 actions)', steps.length === 4);
} catch (e) {
  check('the documented steps ran', false, e.message);
  console.log('F15 FAIL: the procedure itself failed');
  process.exit(1);
}

check('ui/help.html and help/ are gone', !existsSync(join(copy, 'ui', 'help.html')) && !existsSync(join(copy, 'help')));
check('ui/ca.html equals the pre-B29 sha256 (B29-INV-REVERT)', sha256File(join(copy, 'ui', 'ca.html')) === BASE.files['ui/ca.html']);
check('docs/ tree hash unchanged (B29-INV-DOCSKEPT)', treeHash(join(copy, 'docs')) === docsBefore);
check('root package.json and package-lock.json sha256 unchanged (B29-INV-OWNPKG)',
  sha256File(join(copy, 'package.json')) === BASE.files['package.json'] && sha256File(join(copy, 'package-lock.json')) === BASE.files['package-lock.json']);
{
  const lock = JSON.parse(read(join(copy, 'package-lock.json')));
  const set = [...new Set(Object.entries(lock.packages).filter(([k]) => k).map(([k, v]) => `${k.replace(/^(?:.*\/)?node_modules\//, '')}@${v.version}`))].sort();
  check('lock name@version set equals the pre-B29 set', JSON.stringify(set) === JSON.stringify(LOCKSET));
}
{
  const found = [];
  for (const rel of ['package.json', 'package-lock.json', ...['ui', 'src', 'tests'].flatMap((d) => walk(join(copy, d)).map((f) => `${d}/${f}`))]) {
    if (/\.(?:png|jpg|pdf|woff2?)$/.test(rel)) continue;
    const src = readFileSync(join(copy, rel), 'utf8');
    for (const t of BASE.noTraceTokens) if (src.includes(t)) found.push(`${rel}: ${t}`);
  }
  check('no-trace tokens: zero hits in package.json, package-lock.json, ui/, src/, tests/', found.length === 0, found.join('\n'));
}
for (const f of ['golden_engine_v1.json', 'golden_engine_pc_v1.json', 'a10_ui_capture_v1.json', 'b23_on_state_pins.json']) {
  check(`${f} sha256 unchanged`, sha256File(join(copy, 'tests', 'ca', 'fixtures', f)) === BASE.files[`tests/ca/fixtures/${f}`]);
}

for (const script of ['build', 'typecheck', 'typecheck:tests']) {
  const r = sh(copy, 'npm', ['run', script, '--silent']);
  check(`npm run ${script}`, r.status === 0, r.out);
}
{
  const r = sh(copy, 'npx', ['vitest', 'run']);
  const files = /Test Files\s+(\d+) passed \((\d+)\)/.exec(r.out);
  const tests = /Tests\s+(\d+) passed \((\d+)\)/.exec(r.out);
  const ok = r.status === 0 && files && +files[1] === BASE.baselineTests.afterRemovalFiles && tests && +tests[1] === BASE.baselineTests.afterRemovalPassed && !/\bfailed\b/.test(r.out.split('Test Files')[1] ?? '');
  check(`npx vitest run: ${BASE.baselineTests.afterRemovalFiles} files, ${BASE.baselineTests.afterRemovalPassed} passed (found ${files?.[1]} files, ${tests?.[1]} tests)`, ok, r.out);
}
{
  const r = sh(copy, 'npm', ['run', 'test:tz', '--silent']);
  check('npm run test:tz (both time zones)', r.status === 0, r.out);
}
if (chrome) {
  const f12 = sh(copy, process.execPath, ['tests/ui/check_print_width.mjs']);
  check('F12 print width 16/16', f12.status === 0 && /F12 PASS: 16\/16/.test(f12.out), f12.out);
  const out = join(tmp('b29-f15-cap-'), 'capture.json');
  const cap = sh(copy, process.execPath, ['tests/ca/fixtures/capture_a10_ui.mjs', out]);
  let same = false;
  if (cap.status === 0 && existsSync(out)) {
    const strip = (o) => { const { provenance, ...rest } = o; return JSON.stringify(rest); };
    same = strip(JSON.parse(readFileSync(out, 'utf8'))) === strip(readJson(join(COB, 'tests', 'ca', 'fixtures', 'a10_ui_capture_v1.json')));
  }
  check('capture_a10_ui.mjs output equals the fixture minus provenance', same, cap.out);
}

rmSync(parent, { recursive: true, force: true });
console.log(failures === 0 ? 'F15 PASS' : `F15 FAIL: ${failures} failing check(s)`);
process.exitCode = failures === 0 ? 0 : 1;
