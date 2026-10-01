/**
 * A13 (COB-architecture.md §5 A13, revision 4): ui/serve.mjs serves only /ui, /dist and
 * /package.json. QA 2026-09-27. The "denied" cases are red until A13 lands.
 *
 * The real script is started as a child process on a free port (serve.mjs has no exported
 * handler; PORT=0 falls back to 5173, so a free port is picked first). Requests go through
 * node:http with the raw path, so "/../" and "/ui/../" are sent unnormalised. The child is
 * killed in afterAll. Denied = 403 or 404.
 * Behaviour kept from today: "/" serves ui/ca.html (200); a redirect to /ui/ca.html is
 * also accepted.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { request } from 'node:http';
import { createServer } from 'node:net';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
let child: ChildProcess | undefined;
let port = 0;

function freePort(): Promise<number> {
  return new Promise((res, rej) => {
    const s = createServer();
    s.once('error', rej);
    s.listen(0, '127.0.0.1', () => {
      const p = (s.address() as { port: number }).port;
      s.close(() => res(p));
    });
  });
}

function get(path: string): Promise<{ status: number; headers: Record<string, unknown>; body: string }> {
  return new Promise((res, rej) => {
    const req = request({ host: '127.0.0.1', port, path, method: 'GET' }, (r) => {
      let body = '';
      r.setEncoding('utf8');
      r.on('data', (c) => (body += c));
      r.on('end', () => res({ status: r.statusCode ?? 0, headers: r.headers, body }));
    });
    req.on('error', rej);
    req.end();
  });
}

beforeAll(async () => {
  port = await freePort();
  child = spawn(process.execPath, [join(ROOT, 'ui', 'serve.mjs')], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await new Promise<void>((res, rej) => {
    const t = setTimeout(() => rej(new Error('serve.mjs did not start within 10 s')), 10_000);
    child!.stdout!.on('data', (d: Buffer) => {
      if (d.toString().includes(`localhost:${port}`)) {
        clearTimeout(t);
        res();
      }
    });
    child!.once('exit', (code) => {
      clearTimeout(t);
      rej(new Error(`serve.mjs exited early (${code})`));
    });
  });
}, 15_000);

afterAll(async () => {
  if (child && child.exitCode === null) {
    const done = new Promise((r) => child!.once('exit', r));
    child.kill('SIGTERM');
    await done;
  }
});

describe('A13 serve.mjs: allowed paths (green today, must stay green)', () => {
  it.each([
    '/ui/ca.html',
    '/ui/ca.js',
    '/dist/ca/index.js',
    '/dist/ca/cobCanada.js',
    '/dist/ca/equations.js',
    '/dist/ca/fees.js',
    '/dist/ca/types.js',
    '/dist/ca/validate.js',
    '/package.json',
  ])('%s -> 200', async (p) => {
    const r = await get(p);
    expect(r.status).toBe(200);
  });

  it('/dist/ca/index.js is served as JavaScript', async () => {
    const r = await get('/dist/ca/index.js');
    expect(String(r.headers['content-type'])).toMatch(/javascript/);
  });

  it('/ serves ui/ca.html (or redirects to /ui/ca.html)', async () => {
    const r = await get('/');
    if (r.status >= 300 && r.status < 400) {
      expect(String(r.headers.location)).toMatch(/\/ui\/ca\.html$/);
    } else {
      expect(r.status).toBe(200);
      expect(r.body).toBe(readFileSync(join(ROOT, 'ui', 'ca.html'), 'utf8'));
    }
  });
});

describe('A13 serve.mjs: everything outside /ui, /dist, /package.json is denied', () => {
  it.each([
    '/src/ca/cobCanada.ts',
    '/src/index.ts',
    '/tests/ca/fixtures/golden_engine_v1.json',
    '/tests/architecture/support.ts',
    '/package-lock.json',
    '/README.md',
    '/CHANGES.md',
    '/tsconfig.json',
    '/serve.log',
    '/node_modules/vitest/package.json',
    '/../HANDOFF.md',
    '/../CLAUDE.md',
    '/ui/../src/ca/cobCanada.ts',
    '/dist/../package-lock.json',
    '/ui/%2e%2e/src/ca/cobCanada.ts',
    '/dist/%2E%2E/tests/architecture/support.ts',
    '/ui/..%2fREADME.md',
    '/package.json/../README.md',
  ])('%s -> 403 or 404', async (p) => {
    const r = await get(p);
    expect([403, 404], `status ${r.status}`).toContain(r.status);
  });
});

/**
 * Generic serve hardening (B29 decision 11, S2 and S4; QA 2026-09-30). These are NOT features of
 * any add-on and stay for good. serve.mjs derives its project root from its own location, so each
 * case copies it to <tmp>/ui/serve.mjs next to a stub page and starts that copy on a free port.
 * S2: after the lexical allowlist, the real path of the file must stay inside an allowed root
 * (a symlink out of /ui is 404; a symlink to a file inside /ui keeps working).
 * S4: X-Content-Type-Options: nosniff on every response (the security-reviewer may reject S4; if so
 * QA removes the two nosniff cases and records it).
 */
describe('B29 S2/S4: serve.mjs on a temporary project root', () => {
  let root = '';
  let outside = '';
  let kid: ChildProcess | undefined;
  let p2 = 0;

  function get2(path: string): Promise<{ status: number; headers: Record<string, unknown>; body: string }> {
    return new Promise((res, rej) => {
      const req = request({ host: '127.0.0.1', port: p2, path, method: 'GET' }, (r) => {
        let body = '';
        r.setEncoding('utf8');
        r.on('data', (c) => (body += c));
        r.on('end', () => res({ status: r.statusCode ?? 0, headers: r.headers, body }));
      });
      req.on('error', rej);
      req.end();
    });
  }

  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), 'b29-serve-root-'));
    outside = mkdtempSync(join(tmpdir(), 'b29-serve-outside-'));
    mkdirSync(join(root, 'ui'));
    copyFileSync(join(ROOT, 'ui', 'serve.mjs'), join(root, 'ui', 'serve.mjs'));
    writeFileSync(join(root, 'ui', 'ca.html'), '<!doctype html><title>stub</title>\n');
    writeFileSync(join(root, 'ui', 'inside.txt'), 'inside\n');
    writeFileSync(join(root, 'package.json'), '{}\n');
    writeFileSync(join(outside, 'secret.txt'), 'SECRET\n');
    mkdirSync(join(outside, 'dir'));
    writeFileSync(join(outside, 'dir', 'x.txt'), 'SECRET-IN-DIR\n');
    symlinkSync(join(outside, 'secret.txt'), join(root, 'ui', 'link-out-file.txt'));
    symlinkSync(join(outside, 'dir'), join(root, 'ui', 'link-out-dir'));
    symlinkSync(join(root, 'ui', 'inside.txt'), join(root, 'ui', 'link-in-file.txt'));
    p2 = await freePort();
    kid = spawn(process.execPath, [join(root, 'ui', 'serve.mjs')], {
      cwd: root,
      env: { ...process.env, PORT: String(p2) },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    await new Promise<void>((res, rej) => {
      const t = setTimeout(() => rej(new Error('temp serve.mjs did not start within 10 s')), 10_000);
      kid!.stdout!.on('data', (d: Buffer) => {
        if (d.toString().includes(`localhost:${p2}`)) {
          clearTimeout(t);
          res();
        }
      });
      kid!.once('exit', (code) => {
        clearTimeout(t);
        rej(new Error(`temp serve.mjs exited early (${code})`));
      });
    });
  }, 15_000);

  afterAll(async () => {
    if (kid && kid.exitCode === null) {
      const done = new Promise((r) => kid!.once('exit', r));
      kid.kill('SIGTERM');
      await done;
    }
    if (root) rmSync(root, { recursive: true, force: true });
    if (outside) rmSync(outside, { recursive: true, force: true });
  });

  it('S1-generic: a missing file under /ui answers the plain text "Not found" with 404', async () => {
    const r = await get2('/ui/other-missing.html');
    expect(r.status).toBe(404);
    expect(r.body).toBe('Not found');
  });

  it('S2a: a symlink in /ui to a FILE outside the project root is 404 and the body is not served', async () => {
    const r = await get2('/ui/link-out-file.txt');
    expect(r.status).toBe(404);
    expect(r.body).not.toContain('SECRET');
  });

  it('S2b: a symlink in /ui to a DIRECTORY outside the project root is 404 for a file below it', async () => {
    const r = await get2('/ui/link-out-dir/x.txt');
    expect(r.status).toBe(404);
    expect(r.body).not.toContain('SECRET');
  });

  it('S2c: a symlink in /ui to a file inside /ui keeps working (200, same body)', async () => {
    const r = await get2('/ui/link-in-file.txt');
    expect(r.status).toBe(200);
    expect(r.body).toBe('inside\n');
  });

  it('S4a: X-Content-Type-Options: nosniff on a 200 response', async () => {
    const r = await get2('/ui/inside.txt');
    expect(r.status).toBe(200);
    expect(String(r.headers['x-content-type-options']).toLowerCase()).toBe('nosniff');
  });

  it('S4b: X-Content-Type-Options: nosniff on a 404 response', async () => {
    const r = await get2('/ui/other-missing.html');
    expect(r.status).toBe(404);
    expect(String(r.headers['x-content-type-options']).toLowerCase()).toBe('nosniff');
  });
});
