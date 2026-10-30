/**
 * F8 (COB-architecture.md §6): tests are typechecked.
 * tsconfig.test.json exists, includes tests/**, sets noEmit, and package.json has a
 * `typecheck:tests` script. Enabled by A12a (COB-architecture.md §5 A12a, revision 12), split out
 * of A12 so the tests are typechecked before A8 (whose red test is type-level).
 * This check is structural only; it does not run tsc (the script itself does that in CI).
 * A18-R2 (A12a QA notes N1/N2, COB-architecture.md §5 A18, revision 13): package.json
 * devDependencies must contain @types/node, pinned to a tilde range, so the tests' Node types come
 * from the project and never from a parent folder such as ~/node_modules/@types/node.
 * SEC-NODE26 (user decision 2026-10-29, COB-architecture.md §5 SEC-NODE26 brief R-N26-5/R-N26-8, revision 65;
 * re-pinned by QA, recorded): the range moves from the A18-R1 `~22.12.0` to `~26.6.6`; the rule is now
 * "major equals the engines floor's major" (F23, tests/tooling/node26-toolchain.test.ts).
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ROOT } from './support.js';

function problems(): string[] {
  const out: string[] = [];
  const cfgPath = join(ROOT, 'tsconfig.test.json');
  if (!existsSync(cfgPath)) out.push('tsconfig.test.json does not exist');
  else {
    const cfg = JSON.parse(readFileSync(cfgPath, 'utf8')) as { include?: string[]; compilerOptions?: { noEmit?: boolean } };
    if (!cfg.include?.some((p) => p.startsWith('tests/**'))) out.push('tsconfig.test.json does not include tests/**');
    if (cfg.compilerOptions?.noEmit !== true) out.push('tsconfig.test.json does not set noEmit');
  }
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as {
    scripts?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  const script = pkg.scripts?.['typecheck:tests'];
  if (!script) out.push('package.json has no typecheck:tests script');
  else if (!script.includes('tsconfig.test.json')) out.push('typecheck:tests does not use tsconfig.test.json');
  const nodeTypes = pkg.devDependencies?.['@types/node'];
  if (nodeTypes === undefined) out.push('package.json devDependencies has no @types/node');
  else if (nodeTypes !== '~26.6.6') out.push(`package.json devDependencies @types/node is ${nodeTypes}, expected ~26.6.6 (SEC-NODE26 R-N26-5)`);
  return out;
}

describe('F8 tests are typechecked', () => {
  it('F8: tsconfig.test.json (tests/**, noEmit), npm run typecheck:tests and devDependency @types/node ~26.6.6 exist', () => {
    expect(problems()).toEqual([]);
  });
});

/**
 * SEC-TSEDITOR (user report 2026-10-29): editors discover only files named tsconfig.json. The root tsconfig.json
 * excludes tests/ and tsconfig.test.json is not auto-discovered, so an editor put the test files in an inferred
 * project whose @types lookup started at the editor's workspace root (the parent folder, whose node_modules has
 * no @types/node): "Cannot find name 'node:path'" (also process, Buffer), while npm run typecheck:tests stayed green.
 * Guard: tests/tsconfig.json exists, extends ../tsconfig.test.json, names the node types explicitly and includes
 * the tests; tsc over it exits 0, and every file in its program (Node types included) comes from inside COB-ts.
 * tsconfig.test.json itself is byte-pinned by the B30 pins fixture and must not change.
 */
const EDITOR_CFG = join(ROOT, 'tests', 'tsconfig.json');

function editorConfigProblems(): string[] {
  if (!existsSync(EDITOR_CFG)) return ['tests/tsconfig.json does not exist'];
  const out: string[] = [];
  const cfg = JSON.parse(readFileSync(EDITOR_CFG, 'utf8')) as {
    extends?: string;
    include?: string[];
    compilerOptions?: { types?: string[] };
  };
  if (cfg.extends !== '../tsconfig.test.json') out.push(`tests/tsconfig.json extends ${String(cfg.extends)}, expected ../tsconfig.test.json`);
  if (!cfg.compilerOptions?.types?.includes('node')) out.push('tests/tsconfig.json compilerOptions.types does not include "node"');
  const inc = cfg.include ?? [];
  if (!inc.some((p) => /^(\.\/)?\*\*\/\*\.ts$/.test(p))) out.push('tests/tsconfig.json does not include the tests (./**/*.ts)');
  if (!inc.some((p) => /^\.\.\/src\/\*\*\/\*\.ts$/.test(p))) out.push('tests/tsconfig.json does not include ../src/**/*.ts');
  return out;
}

describe('F8 SEC-TSEDITOR: tests/tsconfig.json lets editors typecheck the tests with the project Node types', () => {
  it('tests/tsconfig.json exists, extends ../tsconfig.test.json, sets types ["node"] and includes the tests and src', () => {
    expect(editorConfigProblems()).toEqual([]);
  });

  it('tsc --noEmit -p tests/tsconfig.json exits 0 and its program (Node types included) lies wholly inside COB-ts', () => {
    expect(existsSync(EDITOR_CFG), 'tests/tsconfig.json does not exist').toBe(true);
    const tsc = join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc');
    const r = spawnSync(process.execPath, [tsc, '--noEmit', '--listFiles', '-p', EDITOR_CFG], { cwd: ROOT, encoding: 'utf8' });
    expect(r.status, `${r.stdout}\n${r.stderr}`).toBe(0);
    const real = realpathSync(ROOT); // tsc prints real paths (a scratch copy under /tmp is /private/tmp on macOS)
    const files = r.stdout.split('\n').map((l) => l.trim()).filter(Boolean).map((f) => resolve(f));
    const inside = (f: string) => f === real || f.startsWith(real + sep);
    // The TypeScript lib files live in ROOT/node_modules/typescript too, so the whole program must be inside.
    expect(files.filter((f) => !inside(f))).toEqual([]);
    const relFiles = files.map((f) => relative(real, f).split(sep).join('/'));
    expect(relFiles).toContain('node_modules/@types/node/index.d.ts');
    expect(relFiles).toContain('tests/architecture/f8-tests-typechecked.test.ts');
    expect(relFiles).toContain('src/ca/index.ts');
  });
});
