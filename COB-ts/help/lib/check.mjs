// --check (B29-R11, R11a, R13 (a)): is the page in step with the documents, the generator and the package pins?
// It never builds, so it needs neither Chrome nor the packages.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { forbiddenText, refusedLine } from './refuse.mjs';
import { compare, countDiagrams, generatorHash, pinnedPackages, readFingerprint, sha256 } from './fingerprint.mjs';
import { DOCS } from './registry.mjs';
import { findForbidden } from './ui-scan-guard.mjs';

/** @returns {number} the exit code */
export function runCheck({ docsDir, outFile, helpDir, json, strict }) {
  const out = (s) => process.stdout.write(`${s}\n`);
  const err = (s) => process.stderr.write(`${s}\n`);
  const say = json ? err : out;
  const emit = (o) => out(JSON.stringify(o));

  if (!existsSync(docsDir)) {
    if (json) emit({ fresh: true, skipped: true, forbidden: [], differs: [] });
    else out('Help sources (docs/) not found: nothing to check.');
    return 0;
  }

  const docs = DOCS.map((d) => {
    const file = join(docsDir, d.file);
    if (!existsSync(file)) return { ...d, text: '', sha: '' };
    const buf = readFileSync(file);
    return { ...d, text: buf.toString('utf8'), sha: sha256(buf) };
  });

  const forbidden = docs.flatMap((d) => findForbidden(d.text).map((h) => ({ file: d.file, line: h.line, id: h.id, match: h.match })));

  const recorded = existsSync(outFile) ? readFingerprint(readFileSync(outFile, 'utf8')) : null;
  const differs = compare(recorded, {
    docs,
    generator: generatorHash(helpDir),
    packages: pinnedPackages(helpDir),
    diagrams: docs.reduce((n, d) => n + countDiagrams(d.text), 0),
  });
  const fresh = differs.length === 0;

  if (json) emit({ fresh, skipped: false, forbidden, differs });
  if (fresh) say('Help is up to date.');
  else {
    const why = differs.some((d) => d.kind === 'document') || !recorded ? 'docs changed after the last build' : 'generator or packages changed after the last build';
    say(`WARNING: Help is stale (${why}). Run: node help/build-help.mjs`);
    for (const d of differs) say(`  ${d.kind} ${d.name}: recorded ${d.recorded.slice(0, 12) || '(none)'}, now ${d.current.slice(0, 12)}`);
  }
  for (const f of forbidden) err(`docs/${f.file}:${f.line}: ${forbiddenText(f)}`);
  if (forbidden.length) err(refusedLine(forbidden.length));
  if (forbidden.length) return 1;
  return strict && !fresh ? 1 : 0;
}
