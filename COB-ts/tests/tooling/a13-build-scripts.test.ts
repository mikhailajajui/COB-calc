/**
 * A13 (COB-architecture.md §5 A13, revision 4): build and timezone hygiene. QA 2026-09-27.
 * Red until A13 lands (package.json is dev-owned).
 *
 * Design:
 * - The normal suite must never wipe the live dist/. So the `clean`/`build` wiring is
 *   pinned (a) statically from package.json and (b) behaviourally by running the real
 *   `npm run build` in a throw-away copy (package.json + tsconfig.json + src/, with
 *   node_modules symlinked) that is pre-seeded with stale output. The live dist/ is never
 *   touched by these tests.
 * - (c) checks the live dist/: every emitted file maps to a src/**\/*.ts. It is red today
 *   because of dist/biweekly.* and the 18 US modules A15 left behind; it goes green once
 *   `npm run build` (with clean) has been run. With no dist/ at all it passes vacuously.
 * - test:tz must equal the spec's command: both timezones over tests/ca/golden and the
 *   whole tests/architecture directory (today it names only f6-purity-determinism).
 *   A4 (revision 6, Goal 7) extends it with the 5 date test files; QA updated the expected
 *   path list 2026-09-28 (red until the developer edits package.json in A4).
 *   B15 (QA 2026-09-28) adds tests/ca/b15-semimonthly-time-of-day.test.ts (8 paths; red until
 *   the developer appends it to both zone lists in package.json).
 *   B8 (QA 2026-09-29) adds tests/ca/b8-accelerated-frequencies.test.ts (9 paths; red until
 *   the developer appends it to both zone lists in package.json).
 */
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { listFiles, read } from '../architecture/support.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const pkg = JSON.parse(read(join(ROOT, 'package.json'))) as { scripts: Record<string, string> };
const scripts = pkg.scripts;

/** The 18 US modules deleted in A15, plus the orphan biweekly. */
const US_MODULES = [
  'arm', 'compare', 'costs', 'dscr', 'extraPayment', 'importOverrides', 'loan', 'ltv', 'money',
  'mortgage', 'payment', 'paymentFrequency', 'pmi', 'points', 'refinance', 'segment', 'types',
  'validate',
];
const FORBIDDEN_TOP = [...US_MODULES, 'biweekly'];

/** dist-relative files whose stem has no src/<stem>.ts (stem = path minus .js/.d.ts/.map). */
function orphans(distDir: string, srcDir: string): string[] {
  if (!existsSync(distDir)) return [];
  return listFiles(distDir, /./)
    .map((f) => relative(distDir, f).split(sep).join('/'))
    .filter((r) => {
      const stem = r.replace(/\.map$/, '').replace(/\.d\.ts$/, '').replace(/\.js$/, '');
      return !existsSync(join(srcDir, stem + '.ts'));
    });
}

describe('A13 build hygiene: package.json scripts (static)', () => {
  it('has a `clean` script that removes dist/', () => {
    const clean = scripts.clean ?? '';
    expect(clean, 'package.json scripts.clean').not.toBe('');
    expect(clean).toMatch(/\bdist\b/);
    expect(clean).toMatch(/rm\s+-r?f?r?|rimraf|rmSync|rmdir/);
  });

  it('`build` runs `clean` before tsc (inline or via prebuild)', () => {
    const build = scripts.build ?? '';
    const prebuild = scripts.prebuild ?? '';
    const inline = /npm run clean\s*&&[^]*\btsc\b/.test(build);
    const viaPre = /npm run clean/.test(prebuild) && /\btsc\b/.test(build);
    expect(inline || viaPre, `build="${build}" prebuild="${prebuild}"`).toBe(true);
  });
});

describe('A13 build hygiene: `npm run build` in a scratch copy removes stale output', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'cob-a13-build-'));
  afterAll(() => rmSync(tmp, { recursive: true, force: true }));

  it('after build, every dist file maps to src/**/*.ts; no biweekly or US module is left', () => {
    cpSync(join(ROOT, 'package.json'), join(tmp, 'package.json'));
    cpSync(join(ROOT, 'tsconfig.json'), join(tmp, 'tsconfig.json'));
    cpSync(join(ROOT, 'src'), join(tmp, 'src'), { recursive: true });
    symlinkSync(join(ROOT, 'node_modules'), join(tmp, 'node_modules'), 'dir');
    mkdirSync(join(tmp, 'dist'), { recursive: true });
    for (const m of ['biweekly', 'mortgage', 'money']) {
      writeFileSync(join(tmp, 'dist', `${m}.js`), '// stale\n');
      writeFileSync(join(tmp, 'dist', `${m}.d.ts`), '// stale\n');
    }

    const r = spawnSync('npm', ['run', 'build'], { cwd: tmp, encoding: 'utf8', timeout: 90_000 });
    expect(r.status, `npm run build failed:\n${r.stdout}\n${r.stderr}`).toBe(0);
    expect(existsSync(join(tmp, 'dist', 'ca', 'index.js'))).toBe(true);
    expect(existsSync(join(tmp, 'dist', 'index.js'))).toBe(true);
    expect(orphans(join(tmp, 'dist'), join(tmp, 'src'))).toEqual([]);
  }, 120_000);
});

describe('A13 build hygiene: live dist/ has no stale output', () => {
  it('every live dist/**/* file maps to a src/**/*.ts (red until `npm run build` with clean)', () => {
    expect(orphans(join(ROOT, 'dist'), join(ROOT, 'src'))).toEqual([]);
  });

  it('no dist/biweekly.* and none of the 18 deleted US modules', () => {
    const left = FORBIDDEN_TOP.filter((m) =>
      ['.js', '.d.ts', '.js.map', '.d.ts.map'].some((ext) => existsSync(join(ROOT, 'dist', m + ext))),
    );
    expect(left).toEqual([]);
  });
});

describe('A13 timezone hygiene: test:tz matches the spec command', () => {
  it('runs tests/ca/golden and tests/architecture under America/Toronto then Pacific/Kiritimati', () => {
    const cmd = scripts['test:tz'] ?? '';
    const segs = cmd.split('&&').map((s) => s.trim().split(/\s+/));
    expect(segs.map((s) => s[0])).toEqual(['TZ=America/Toronto', 'TZ=Pacific/Kiritimati']);
    for (const s of segs) {
      expect(s.slice(1, 3)).toEqual(['vitest', 'run']);
      const paths = s.slice(3).map((p) => p.replace(/\/$/, ''));
      expect(paths.sort()).toEqual([
        'tests/architecture',
        'tests/ca/b15-semimonthly-time-of-day.test.ts', // B15 (QA 2026-09-28): asserts payment dates
        'tests/ca/b24-term-rule.test.ts', // B24 (QA 2026-09-30): the term rule reads UTC calendar dates; must give the same answers in both zones
        'tests/ca/b25-semimonthly-move.test.ts', // B25 (QA 2026-10-01): the semi-monthly move reads UTC calendar dates; same answers in both zones
        'tests/ca/b32-term-start.test.ts', // B32 (DEC-B32-TERM, QA 2026-10-05): the term from the start date reads UTC calendar dates; same answers in both zones
        'tests/ca/b33-personal-loan-frequencies.test.ts', // B33 (DEC-B33-FREQ, QA 2026-10-05): personal-loan schedules at every frequency (payment dates, semi-monthly move, workbook vectors); same answers in both zones
        'tests/ca/b34-term-options.test.ts', // B34 (DEC-B34-TERM, QA 2026-10-06): the terms rounded up to whole months read UTC calendar dates; same answers in both zones (B34-BV-99)
        'tests/ca/b37-leap-aware-n.test.ts', // B37 (DEC-B37-LEAP-N, QA 2026-10-09): D and Y read UTC calendar dates; same answers in both zones (B37-INV-PURE)
        'tests/ca/b3b-date-validation.test.ts',
        'tests/ca/b8-accelerated-frequencies.test.ts', // B8 (QA 2026-09-29): asserts payment dates
        'tests/ca/calendar-a4.test.ts',
        'tests/ca/golden',
        'tests/ca/monthlyDates-t3.test.ts',
        'tests/ca/monthlyMonthEnd-oqx.test.ts',
        'tests/ca/semiMonthlyDates-t4.test.ts',
      ]);
    }
  });
});
