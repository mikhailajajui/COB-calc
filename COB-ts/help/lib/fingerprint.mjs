// The build fingerprint (B29-R12) and the staleness comparison used by --check (B29-R11, R11a).
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

export const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

/** Hash of the generator: the CLI, the modules and the assets (not the packages, which are compared by version). */
export function generatorHash(helpDir) {
  const files = ['build-help.mjs'];
  for (const dir of ['lib', 'assets']) {
    if (existsSync(join(helpDir, dir))) files.push(...readdirSync(join(helpDir, dir)).sort().map((f) => `${dir}/${f}`));
  }
  const h = createHash('sha256');
  for (const f of files) h.update(`${f}\0`).update(readFileSync(join(helpDir, f))).update('\n');
  return h.digest('hex');
}

/** The pinned versions in the Help package file: { 'markdown-it': '15.0.2', mermaid: '11.17.2' }. */
export function pinnedPackages(helpDir) {
  const dev = JSON.parse(readFileSync(join(helpDir, 'package.json'), 'utf8')).devDependencies ?? {};
  return { 'markdown-it': dev['markdown-it'] ?? '', mermaid: dev.mermaid ?? '' };
}

/** The number of Mermaid fences in a document, from the source lines (no parser needed). */
export function countDiagrams(text) {
  return text.split('\n').filter((l) => /^ {0,3}(?:`{3,}|~{3,})\s*mermaid\b/.test(l)).length;
}

/** The fingerprint object that goes into the page. */
export function makeFingerprint({ docs, generator, packages, diagrams, builtOn }) {
  return {
    built: builtOn,
    documents: docs.map((d) => ({ key: d.key, file: d.file, sha256: d.sha })),
    generator,
    packages,
    diagrams,
  };
}

/** The fingerprint recorded in a page, or null when the page has none. */
export function readFingerprint(html) {
  const m = /<script type="application\/json" id="help-build">([\s\S]*?)<\/script>/.exec(html);
  if (!m) return null;
  try {
    return JSON.parse(m[1]);
  } catch {
    return null;
  }
}

/** [{ kind, name, recorded, current }] in the order documents, generator, packages, diagrams; empty when fresh. */
export function compare(recorded, current) {
  const out = [];
  const rec = recorded ?? {};
  for (const d of current.docs) {
    const old = (rec.documents ?? []).find((x) => x.file === d.file);
    if (!old || old.sha256 !== d.sha) out.push({ kind: 'document', name: d.file, recorded: old?.sha256 ?? '', current: d.sha });
  }
  if (rec.generator !== current.generator) out.push({ kind: 'generator', name: 'generator', recorded: rec.generator ?? '', current: current.generator });
  for (const [name, version] of Object.entries(current.packages)) {
    const old = rec.packages?.[name] ?? '';
    if (old !== version) out.push({ kind: 'package', name, recorded: old, current: version });
  }
  if (String(rec.diagrams ?? '') !== String(current.diagrams)) {
    out.push({ kind: 'diagrams', name: 'diagrams', recorded: String(rec.diagrams ?? ''), current: String(current.diagrams) });
  }
  return out;
}
