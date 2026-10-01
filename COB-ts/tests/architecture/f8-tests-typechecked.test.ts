/**
 * F8 (COB-architecture.md §6): tests are typechecked.
 * tsconfig.test.json exists, includes tests/**, sets noEmit, and package.json has a
 * `typecheck:tests` script. Enabled by A12a (COB-architecture.md §5 A12a, revision 12), split out
 * of A12 so the tests are typechecked before A8 (whose red test is type-level).
 * This check is structural only; it does not run tsc (the script itself does that in CI).
 * A18-R2 (A12a QA notes N1/N2, COB-architecture.md §5 A18, revision 13): package.json
 * devDependencies must contain @types/node, pinned to the A18-R1 range `~22.12.0` (Node v22.12.0),
 * so the tests' Node types come from the project and never from a parent folder such as
 * ~/node_modules/@types/node.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
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
  else if (nodeTypes !== '~22.12.0') out.push(`package.json devDependencies @types/node is ${nodeTypes}, expected ~22.12.0 (A18-R1)`);
  return out;
}

describe('F8 tests are typechecked', () => {
  it('F8: tsconfig.test.json (tests/**, noEmit), npm run typecheck:tests and devDependency @types/node ~22.12.0 exist', () => {
    expect(problems()).toEqual([]);
  });
});
