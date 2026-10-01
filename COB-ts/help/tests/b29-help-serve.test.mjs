/**
 * B29 decision 11 / B29-INV-SERVE: what the local server serves of Help (and never serves).
 * The real ui/serve.mjs is started as a child process on a free port (the A13 pattern); raw paths
 * are sent unnormalised. Denied = 403 or 404. The generic hardening cases (symlinks, nosniff) are in
 * tests/tooling/a13-serve.test.ts and stay after Help is removed. QA 2026-09-30.
 * Red until sr-dev builds ui/help.html. Deleted with the help/ folder.
 */
import { spawn } from 'node:child_process';
import { request } from 'node:http';
import { copyFileSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { COB, PAGE, read, tmp } from './support/common.mjs';

function freePort() {
  return new Promise((res, rej) => {
    const s = createServer();
    s.once('error', rej);
    s.listen(0, '127.0.0.1', () => {
      const p = s.address().port;
      s.close(() => res(p));
    });
  });
}

function start(root) {
  return new Promise(async (res, rej) => {
    const port = await freePort();
    const child = spawn(process.execPath, [join(root, 'ui', 'serve.mjs')], {
      cwd: root,
      env: { ...process.env, PORT: String(port) },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const t = setTimeout(() => rej(new Error('serve.mjs did not start within 10 s')), 10_000);
    child.stdout.on('data', (d) => {
      if (d.toString().includes(`localhost:${port}`)) {
        clearTimeout(t);
        res({ child, port });
      }
    });
    child.once('exit', (c) => {
      clearTimeout(t);
      rej(new Error(`serve.mjs exited early (${c})`));
    });
  });
}

const get = (port, path) =>
  new Promise((res, rej) => {
    const req = request({ host: '127.0.0.1', port, path, method: 'GET' }, (r) => {
      const chunks = [];
      r.on('data', (c) => chunks.push(c));
      r.on('end', () => res({ status: r.statusCode ?? 0, headers: r.headers, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', rej);
    req.end();
  });

let main;
const stop = async (s) => {
  if (s && s.child.exitCode === null) {
    const done = new Promise((r) => s.child.once('exit', r));
    s.child.kill('SIGTERM');
    await done;
  }
};

beforeAll(async () => {
  main = await start(COB);
}, 15_000);
afterAll(async () => {
  await stop(main);
});

describe('B29 serve: the generated page is served', () => {
  it('/ui/help.html is 200, text/html, and the body equals the file', async () => {
    const r = await get(main.port, '/ui/help.html');
    expect(r.status).toBe(200);
    expect(String(r.headers['content-type'])).toMatch(/^text\/html/);
    expect(r.body).toBe(read(PAGE));
  });

  it.each([['/'], ['/ui/ca.html']])('from the base %s the Help href resolves to a 200 path', async (base) => {
    const page = await get(main.port, base);
    expect(page.status).toBe(200);
    const m = /<a\b[^>]*class="[^"]*\bhelp-link\b[^"]*"[^>]*>/.exec(page.body) ?? /<a\b[^>]*help-link[^>]*>/.exec(page.body);
    expect(m, 'no help-link in the served calculator page').toBeTruthy();
    const href = /href="([^"]*)"/.exec(m[0])[1];
    const resolved = new URL(href, `http://localhost${base}`);
    const r = await get(main.port, resolved.pathname);
    expect(r.status).toBe(200);
    expect(r.body).toContain('<html');
  });
});

describe('B29 serve: the Markdown sources, the build and the packages are never served (B29-INV-SERVE)', () => {
  it.each([
    '/docs/COB-user-manual.md',
    '/docs/',
    '/docs',
    '/COB-ts/docs/COB-coverage.md',
    '/ui/../docs/COB-domain-overview.md',
    '/ui/%2e%2e/docs/COB-user-manual.md',
    '/ui/..%2fdocs/COB-user-manual.md',
    '/help/build-help.mjs',
    '/help/assets/help.css',
    '/ui/../help/build-help.mjs',
    '/node_modules/markdown-it/package.json',
    '/node_modules/mermaid/dist/mermaid.min.js',
  ])('%s -> 403 or 404', async (p) => {
    const r = await get(main.port, p);
    expect([403, 404], `status ${r.status}`).toContain(r.status);
  });
});

describe('B29 serve: traversal and encoding on the help path never reach a different file', () => {
  it.each([
    '/ui/help.html/../../package-lock.json',
    '/ui/help.html%2f..%2f..%2fREADME.md',
    '/ui/help.html%00',
    '/ui\\help.html',
    '/ui/help.html/',
    '/ui/help.html?x=1#y',
  ])('%s -> 404, or the very same page', async (p) => {
    const r = await get(main.port, p);
    expect([200, 403, 404], `status ${r.status}`).toContain(r.status);
    if (r.status === 200) expect(r.body).toBe(read(PAGE));
    expect(r.body).not.toContain('"lockfileVersion"');
  });

  it.each(['/help', '/help/'])('no listing of %s (404)', async (p) => {
    const r = await get(main.port, p);
    expect([403, 404]).toContain(r.status);
    expect(r.body).not.toMatch(/build-help|<li>|<a href/i);
  });
});

describe('B29-X7 (ii): a project root without ui/help.html answers the ordinary plain Not found', () => {
  let root;
  let srv;
  beforeAll(async () => {
    root = tmp('b29-serve-nohelp-');
    mkdirSync(join(root, 'ui'));
    copyFileSync(join(COB, 'ui', 'serve.mjs'), join(root, 'ui', 'serve.mjs'));
    writeFileSync(join(root, 'ui', 'ca.html'), '<!doctype html><title>stub</title>\n');
    srv = await start(root);
  }, 15_000);
  afterAll(async () => {
    await stop(srv);
    if (root) rmSync(root, { recursive: true, force: true });
  });

  it('/ui/help.html is 404 with the body "Not found" (the same text as any other missing file; serve.mjs has no Help line)', async () => {
    const a = await get(srv.port, '/ui/help.html');
    const b = await get(srv.port, '/ui/some-other-missing.html');
    expect(a.status).toBe(404);
    expect(a.body).toBe('Not found');
    expect(a.body).toBe(b.body);
  });
});
