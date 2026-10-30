/**
 * SEC-6 S6-T8 and S6-R3 (COB-architecture.md §5 "SEC-5 and SEC-6 brief", revision 62). QA red tests, 2026-10-28.
 * ui/serve.mjs gains exactly two content types, '.svg' -> 'image/svg+xml' and '.woff2' -> 'font/woff2', so the
 * self-hosted logo and fonts are served correctly before SEC-5's larger rewrite. Nothing else in serve.mjs changes.
 *
 * The sha256 pin of ui/serve.mjs moves out of the share package's pre-B30 pin list into the structural check below
 * (S6-R3: "QA re-pins it"): serve.mjs minus exactly the two new lines must be the pre-SEC-6 file (63a26531...).
 * SEC-5 rewrites serve.mjs; its QA red step replaces that structural check (planned change, owned by QA).
 * The developer must not edit this file.
 *
 * SEC-5 red step (QA 2026-10-28, revision 62 R5-3/R5-6; recorded in CHANGES.md): the structural check (serve.mjs minus
 * the two lines = 63a26531...) is removed, because SEC-5 rewrites serve.mjs; the final sha256 is re-pinned in
 * the share package's pre-B30 pin list at SEC-5 verify. '/package.json' is no longer served (R5-3 step 6), so the
 * "existing content types" case now checks html and js only; the json type is covered by /version.json in
 * tests/tooling/sec5-serve-azure.test.ts. The child env strips WEBSITE_HOSTNAME and COB_ALLOWED_HOSTS (local mode).
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { request } from 'node:http';
import { createServer } from 'node:net';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ROOT } from '../architecture/support.js';


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

function get(path: string, method = 'GET'): Promise<{ status: number; headers: Record<string, unknown>; body: Buffer }> {
  return new Promise((res, rej) => {
    const req = request({ host: '127.0.0.1', port, path, method }, (r) => {
      const chunks: Buffer[] = [];
      r.on('data', (c: Buffer) => chunks.push(c));
      r.on('end', () => res({ status: r.statusCode ?? 0, headers: r.headers, body: Buffer.concat(chunks) }));
    });
    req.on('error', rej);
    req.end();
  });
}

beforeAll(async () => {
  port = await freePort();
  child = spawn(process.execPath, [join(ROOT, 'ui', 'serve.mjs')], {
    cwd: ROOT,
    env: (() => {
      const env: NodeJS.ProcessEnv = { ...process.env, PORT: String(port) };
      delete env.WEBSITE_HOSTNAME;
      delete env.COB_ALLOWED_HOSTS;
      return env;
    })(),
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

describe('SEC-6 S6-T8: the self-hosted assets are served with the right content type, byte for byte', () => {
  it.each([
    ['/ui/assets/alterna-savings.svg', 'image/svg+xml', 'ui/assets/alterna-savings.svg'],
    ['/ui/assets/fonts/Inter-Regular.woff2', 'font/woff2', 'ui/assets/fonts/Inter-Regular.woff2'],
    ['/ui/assets/fonts/Inter-Medium.woff2', 'font/woff2', 'ui/assets/fonts/Inter-Medium.woff2'],
    ['/ui/assets/fonts/Inter-SemiBold.woff2', 'font/woff2', 'ui/assets/fonts/Inter-SemiBold.woff2'],
    ['/ui/assets/fonts/Inter-Bold.woff2', 'font/woff2', 'ui/assets/fonts/Inter-Bold.woff2'],
    ['/ui/ca.css', 'text/css; charset=utf-8', 'ui/ca.css'],
  ])('%s -> 200 %s', async (path, type, file) => {
    const r = await get(path);
    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toBe(type);
    expect(r.headers['x-content-type-options']).toBe('nosniff');
    expect(existsSync(join(ROOT, file)), `${file} exists`).toBe(true);
    expect(r.body.equals(readFileSync(join(ROOT, file)))).toBe(true);
  });

  it('/ui/assets/fonts/LICENSE.txt -> 200 (the licence travels with the fonts)', async () => {
    const r = await get('/ui/assets/fonts/LICENSE.txt');
    expect(r.status).toBe(200);
    expect(r.body.toString('utf8')).toContain('SIL OPEN FONT LICENSE Version 1.1');
  });

  it('HEAD on a font -> 200 font/woff2 with no body', async () => {
    const r = await get('/ui/assets/fonts/Inter-Bold.woff2', 'HEAD');
    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toBe('font/woff2');
    expect(r.body.length).toBe(0);
  });

  it('the existing content types are unchanged (html, js)', async () => {
    expect((await get('/ui/ca.html')).headers['content-type']).toBe('text/html; charset=utf-8');
    expect((await get('/ui/ca.js')).headers['content-type']).toBe('text/javascript; charset=utf-8');
  });
});
