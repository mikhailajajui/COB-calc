// Help page builder (B29). Usage, from COB-ts/:
//   node help/build-help.mjs [--check [--json] [--strict]] [--docs <dir>] [--out <file>] [--renderer <module>]
// Needs `npm install --prefix help` once, plus Chrome through the global browser tooling for the diagrams.
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildPage } from './lib/build.mjs';
import { runCheck } from './lib/check.mjs';

const helpDir = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const value = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};

const docsDir = resolve(value('--docs') ?? join(helpDir, '..', 'docs'));
const outFile = resolve(value('--out') ?? join(helpDir, '..', 'ui', 'help.html'));

try {
  process.exitCode = flag('--check')
    ? runCheck({ docsDir, outFile, helpDir, json: flag('--json'), strict: flag('--strict') })
    : await buildPage({ docsDir, outFile, helpDir, rendererPath: value('--renderer') });
} catch (e) {
  process.stderr.write(`Help build failed: ${e && e.message ? e.message : e}\n`);
  process.exitCode = 1;
}
