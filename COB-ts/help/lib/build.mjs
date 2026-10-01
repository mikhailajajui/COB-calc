// The build pipeline (B29-R1 to R13): documents -> checks -> diagrams -> one page. Prints to the console and returns
// the exit code; nothing is written unless every step succeeded (B29-R10).
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync, copyFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { checkResult, figureHtml } from './diagram.mjs';
import { countDiagrams, generatorHash, makeFingerprint, pinnedPackages, sha256 } from './fingerprint.mjs';
import { analyze, createParser } from './markdown.mjs';
import { assemblePage, SPRITE_IDS } from './page.mjs';
import { DOCS } from './registry.mjs';
import { installRules, newEnv, renderBody } from './render.mjs';
import { aliasOf, slugify } from './slug.mjs';
import { forbiddenText, refusedLine } from './refuse.mjs';
import { findForbidden, originOf } from './ui-scan-guard.mjs';

const FIXED_IDS = ['doc-content', 'id-index', 'goto', 'goto-msg', 'notice', 'live', 'brandLogo', 'help-build', ...SPRITE_IDS];

/** The build date (UTC, yyyy-mm-dd): SOURCE_DATE_EPOCH when set, otherwise today. */
export function buildDate(env = process.env) {
  const epoch = env.SOURCE_DATE_EPOCH;
  const d = epoch && /^\d+$/.test(epoch) ? new Date(Number(epoch) * 1000) : new Date();
  return d.toISOString().slice(0, 10);
}

/** Writes the page through a temp file and a rename, so a failed write never leaves a half page. */
function writeAtomic(outFile, text, helpDir) {
  mkdirSync(dirname(outFile), { recursive: true });
  const tmpDir = join(helpDir, '.tmp');
  mkdirSync(tmpDir, { recursive: true });
  const tmp = join(tmpDir, `help-${process.pid}.html`);
  writeFileSync(tmp, text);
  try {
    renameSync(tmp, outFile);
  } catch (e) {
    if (e.code !== 'EXDEV') {
      rmSync(tmp, { force: true });
      throw e;
    }
    const side = join(dirname(outFile), `.help-${process.pid}.tmp`);
    try {
      copyFileSync(tmp, side);
      renameSync(side, outFile);
    } finally {
      rmSync(side, { force: true });
      rmSync(tmp, { force: true });
    }
  }
  if (existsSync(tmpDir) && readdirSync(tmpDir).length === 0) rmSync(tmpDir, { recursive: true, force: true });
}

/** @returns {Promise<number>} the exit code */
export async function buildPage({ docsDir, outFile, helpDir, rendererPath, env = process.env }) {
  const out = (s) => process.stdout.write(`${s}\n`);
  const err = (s) => process.stderr.write(`${s}\n`);

  if (!existsSync(docsDir)) {
    err('Help cannot be rebuilt: docs/ not found. To remove Help see help/README.md.');
    return 1;
  }
  const pins = pinnedPackages(helpDir);
  for (const name of Object.keys(pins)) {
    if (!existsSync(join(helpDir, 'node_modules', name, 'package.json'))) {
      err('Help packages are not installed. Run: npm install --prefix help');
      return 1;
    }
    const have = JSON.parse(readFileSync(join(helpDir, 'node_modules', name, 'package.json'), 'utf8')).version;
    if (have !== pins[name]) {
      err(`Help package ${name} ${have} is installed but package.json pins ${pins[name]}. Run: npm install --prefix help`);
      return 1;
    }
  }

  // B29-R1: the registry and the folder must agree.
  const registryErrors = [];
  const registered = new Set(DOCS.map((d) => d.file));
  for (const f of readdirSync(docsDir).filter((n) => n.endsWith('.md')).sort()) {
    if (!registered.has(f)) registryErrors.push(`docs/${f}: not in the registry (help/lib/registry.mjs); add it to the registry or move it`);
  }
  for (const d of DOCS) {
    if (!existsSync(join(docsDir, d.file))) registryErrors.push(`docs/${d.file}: file not found (it is listed in the registry)`);
  }
  if (registryErrors.length) {
    registryErrors.forEach(err);
    return 1;
  }

  const docs = DOCS.map((d) => {
    const buf = readFileSync(join(docsDir, d.file));
    return { ...d, text: buf.toString('utf8'), sha: sha256(buf) };
  });

  const errors = [];
  let seq = 0;
  let hits = 0;
  const add = (di, line, text) => errors.push({ di, line, text, seq: seq++ });

  // B29-R13 (a): the forbidden strings, on the raw lines of every document.
  docs.forEach((d, di) => {
    for (const h of findForbidden(d.text)) {
      hits++;
      add(di, h.line, forbiddenText(h));
    }
  });

  // B29-R2: parse and check every document.
  const md = await createParser();
  installRules(md);
  docs.forEach((d, di) => {
    d.analysis = analyze(d.text, md);
    for (const e of d.analysis.errors) add(di, e.line, e.msg);
  });

  // B29-R3 and R5: ids, aliases, definitions; the whole page shares one id space (case-insensitive).
  const claimed = new Map();
  const exact = new Set();
  const claim = (id, di, line, what) => {
    const k = id.toLowerCase();
    if (claimed.has(k)) {
      add(di, line, `id "${id}" (${what}) collides with ${claimed.get(k)}`);
      return;
    }
    claimed.set(k, `${what} "${id}"`);
    exact.add(id);
  };
  FIXED_IDS.forEach((id) => claim(id, -1, 0, 'page id'));
  const defined = new Map();
  docs.forEach((d, di) => {
    const a = d.analysis;
    const h1 = a.headings.find((h) => h.level === 1);
    d.title = h1 ? h1.text : d.label;
    claim(`doc-${d.key}`, di, 1, 'article id');
    claim(`${d.key}-title`, di, h1 ? h1.line : 1, 'title id');
    a.blocks.forEach((b, i) => claim(`${d.key}-fig-${i + 1}`, di, b.line, 'figure id'));
    const primary = new Set();
    for (const h of a.headings) {
      if (h.level === 1) {
        h.id = `${d.key}-title`;
        continue;
      }
      const base = `${d.key}-${slugify(h.text)}`;
      let id = base;
      for (let n = 2; primary.has(id.toLowerCase()); n++) id = `${base}-${n}`;
      primary.add(id.toLowerCase());
      claim(id, di, h.line, 'heading id');
      h.id = id;
      const alias = aliasOf(h.text);
      if (alias) {
        h.alias = `${d.key}-${alias}`;
        claim(h.alias, di, h.line, 'heading alias');
      }
    }
    for (const row of a.rows) {
      for (const id of row.ids) {
        if (defined.has(id)) {
          const first = defined.get(id);
          add(di, row.line, `ID ${id} is defined twice (first defined at docs/${first.file}:${first.line})`);
        } else {
          defined.set(id, { file: d.file, line: row.line });
          claim(id, di, row.line, 'defined ID');
        }
      }
    }
  });
  docs.forEach((d, di) => {
    for (const l of d.analysis.links) {
      if (!exact.has(l.id)) add(di, l.line, `link to #${l.id}, which is not an id in the page`);
    }
  });

  const report = (extra = []) => {
    const lines = [...errors]
      .sort((a, b) => (a.di === b.di ? a.line - b.line || a.seq - b.seq : a.di - b.di))
      .map((e) => (e.di < 0 ? e.text : `docs/${docs[e.di].file}:${e.line}: ${e.text}`));
    [...lines, ...extra].forEach(err);
    if (hits) err(refusedLine(hits));
  };
  if (errors.length) {
    report();
    return 1;
  }

  // B29-R8: the diagrams, one renderer call for the whole run.
  const sources = [];
  docs.forEach((d) => d.analysis.blocks.forEach((b, i) => sources.push({ key: d.key, k: i + 1, line: b.line, source: b.source })));
  let results = [];
  if (sources.length) {
    const file = rendererPath ? resolve(rendererPath) : join(helpDir, 'lib', 'mermaid-render.mjs');
    try {
      const mod = await import(pathToFileURL(file).href);
      results = await mod.renderDiagrams(sources);
    } catch (e) {
      const m = String((e && e.message) || e);
      err(/^mermaid /.test(m) ? m : `mermaid: ${m}`);
      return 1;
    }
    const bad = [];
    sources.forEach((s, i) => {
      try {
        checkResult(results?.[i]);
      } catch (e) {
        bad.push(`mermaid ${s.key} block ${s.k} (line ${s.line}): ${e.message}`);
      }
    });
    if (bad.length) {
      bad.forEach(err);
      return 1;
    }
  }

  // B29-R3 to R9: the bodies.
  const used = new Set();
  const unmatched = new Set();
  let at = 0;
  const pageDocs = docs.map((d) => {
    const env2 = newEnv(new Set(defined.keys()));
    const figures = new Map(
      d.analysis.blocks.map((b, i) => {
        const s = sources[at + i];
        return [i, figureHtml({ key: d.key, k: i + 1, heading: (b.heading ?? { text: d.title }).text, source: s.source, result: results[at + i] })];
      }),
    );
    at += d.analysis.blocks.length;
    const body = renderBody({ md, tokens: d.analysis.tokens, key: d.key, headings: d.analysis.headings, figures, env: env2 });
    env2.used.forEach((i) => used.add(i));
    env2.unmatched.forEach((u) => unmatched.add(u));
    return {
      ...d,
      body,
      toc: d.analysis.headings.filter((h) => h.level > 1).map((h) => ({ level: h.level, id: h.id, text: h.text })),
    };
  });

  const ids = [...new Set([...used, ...defined.keys()])].sort();
  const builtOn = buildDate(env);
  const generator = generatorHash(helpDir);
  const diagrams = docs.reduce((n, d) => n + countDiagrams(d.text), 0);
  const fingerprint = makeFingerprint({ docs, generator, packages: pins, diagrams, builtOn });
  const read = (f) => readFileSync(join(helpDir, 'assets', f), 'utf8');
  const page = assemblePage({ docs: pageDocs, ids, css: read('help.css'), clientJs: read('help.client.js'), fingerprint, builtOn });

  // B29-R13 (b): the backstop on the finished page.
  const pageHits = findForbidden(page);
  if (pageHits.length) {
    pageHits.forEach((h) =>
      err(
        `generated page:${h.line}: forbidden string "${h.match}" (${h.id}): a baseline test that scans the UI folder fails on it (${originOf(h.id)}); ` +
          'no document line contains it, so it comes from help/assets, the page template or a diagram',
      ),
    );
    err(refusedLine(pageHits.length));
    return 1;
  }

  if (unmatched.size) {
    out('unmatched Status values (kept as plain text):');
    [...unmatched].sort().forEach((u) => out(`  ${u}`));
  }
  const dangling = [...used].filter((i) => !defined.has(i)).sort();
  if (dangling.length) {
    out(`IDs not defined in this page (information only): ${dangling.length}`);
    out(`  ${dangling.join(', ')}`);
  }
  writeAtomic(outFile, page, helpDir);
  out(`Help page written: ${Buffer.byteLength(page)} bytes, ${diagrams} diagram(s), built ${builtOn}.`);
  return 0;
}
