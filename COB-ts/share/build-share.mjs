// Builds the single-file COB.html from ui/, dist/ and package.json (read-only). See README.md.
//   node share/build-share.mjs [--root <dir>] [--out <path>] [--date YYYY-MM-DD] [--check]
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BuildError, bundle } from './lib/modules.mjs';
import { buildPage } from './lib/html.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const opts = { check: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--check') opts.check = true;
    else if (a === '--root' || a === '--out' || a === '--date') {
      if (i + 1 >= argv.length) throw new BuildError(`${a} needs a value`);
      opts[a.slice(2)] = argv[++i];
    } else throw new BuildError(`unknown argument ${a}; usage: node share/build-share.mjs [--root <dir>] [--out <path>] [--date YYYY-MM-DD] [--check]`);
  }
  return opts;
}

function chooseDate(opts) {
  const date = opts.date !== undefined ? opts.date : process.env.COB_BUILD_DATE !== undefined ? process.env.COB_BUILD_DATE : new Date().toISOString().slice(0, 10);
  const ok = /^\d{4}-\d{2}-\d{2}$/.test(date) && new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) === date;
  if (!ok) throw new BuildError(`invalid build date ${JSON.stringify(date)}: expected a real calendar date as YYYY-MM-DD (--date or COB_BUILD_DATE)`);
  return date;
}

function check(root, out) {
  const sources = ['ui/ca.html', 'ui/ca.js', 'ui/ca-view.js', 'package.json'].map((f) => join(root, f));
  const distDir = join(root, 'dist', 'ca');
  if (existsSync(distDir)) for (const f of readdirSync(distDir).sort()) if (f.endsWith('.js')) sources.push(join(distDir, f));
  if (!existsSync(out)) {
    console.error(`${out} does not exist: rebuild before sharing`);
    return 1;
  }
  const built = statSync(out).mtimeMs;
  const newer = sources.filter((f) => existsSync(f) && statSync(f).mtimeMs > built);
  if (newer.length) {
    console.error(`warning: ${out} is older than ${newer.length} source file(s) (${newer.join(', ')}): rebuild before sharing`);
    return 1;
  }
  console.log(`${out} is up to date`);
  return 0;
}

function run() {
  const opts = parseArgs(process.argv.slice(2));
  const root = resolve(opts.root ?? join(HERE, '..'));
  const out = resolve(opts.out ?? join(root, 'COB.html'));
  if (opts.check) return check(root, out);

  const date = chooseDate(opts);
  const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
  if (typeof version !== 'string' || !/^[0-9A-Za-z.+-]+$/.test(version)) throw new BuildError(`package.json: unusable version ${JSON.stringify(version)}`);
  const logo = readFileSync(join(HERE, 'assets', 'alterna-savings.svg'));
  const { order, script } = bundle(root, 'ui/ca.js', { version });
  const html = buildPage({ source: readFileSync(join(root, 'ui', 'ca.html'), 'utf8'), script, version, date, logo });

  const tmp = `${out}.tmp`;
  try {
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(tmp, html);
    renameSync(tmp, out);
  } finally {
    rmSync(tmp, { force: true });
  }
  const bytes = Buffer.from(html);
  console.log(`output: ${out}`);
  console.log(`size: ${bytes.length} bytes`);
  console.log(`sha256: ${createHash('sha256').update(bytes).digest('hex')}`);
  console.log(`modules (${order.length}):\n${order.map((id) => `  ${id}`).join('\n')}`);
  return 0;
}

try {
  process.exitCode = run();
} catch (e) {
  console.error(`build-share: ${e instanceof BuildError ? e.message : e.stack ?? e}`);
  process.exitCode = 1;
}
