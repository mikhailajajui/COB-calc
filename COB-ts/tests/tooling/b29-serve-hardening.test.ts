/**
 * B29 security review, four approved fixes (QA 2026-10-01). Red until sr-dev lands fixes 1-3; fix 4 (block-level raw
 * HTML refused by the Help builder) is already in place, so group 4 is a characterisation that stays green.
 *  1. ui/serve.mjs listens on 127.0.0.1 only; the log line shows that address.
 *  2. Only GET and HEAD are served; anything else is 405 with Allow: GET, HEAD; HEAD has headers and no body.
 *  3. Host must be localhost:PORT or 127.0.0.1:PORT (bare localhost / 127.0.0.1 also accepted); otherwise 403.
 * The real script runs as a child process on a free port (the A13 pattern). Group 4 lives with the Help tests and
 * is deleted with help/ (help/tests/b29-security-html-block.test.mjs).
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { request } from 'node:http';
import { createConnection, createServer } from 'node:net';
import { networkInterfaces } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
let child: ChildProcess | undefined;
let port = 0;
let logged = '';

const freePort = (): Promise<number> =>
  new Promise((res, rej) => {
    const s = createServer();
    s.once('error', rej);
    s.listen(0, '127.0.0.1', () => {
      const p = (s.address() as { port: number }).port;
      s.close(() => res(p));
    });
  });

type Res = { status: number; headers: Record<string, unknown>; body: string };
function send(method: string, path: string, host?: string): Promise<Res> {
  return new Promise((res, rej) => {
    const headers: Record<string, string> = {};
    if (host !== undefined) headers.Host = host;
    const req = request({ host: '127.0.0.1', port, path, method, headers }, (r) => {
      let body = '';
      r.setEncoding('utf8');
      r.on('data', (c) => (body += c));
      r.on('end', () => res({ status: r.statusCode ?? 0, headers: r.headers, body }));
    });
    req.on('error', rej);
    req.end();
  });
}

/** Resolves true when a TCP connection to host:port is accepted, false when refused or unreachable. */
const connects = (host: string): Promise<boolean> =>
  new Promise((res) => {
    const s = createConnection({ host, port });
    s.setTimeout(3000, () => { s.destroy(); res(false); });
    s.once('connect', () => { s.destroy(); res(true); });
    s.once('error', () => res(false));
  });

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
      logged += d.toString();
      if (logged.includes(`:${port}`)) { clearTimeout(t); res(); }
    });
    child!.once('exit', (c) => { clearTimeout(t); rej(new Error(`serve.mjs exited early (${c})`)); });
  });
});
afterAll(() => { child?.kill(); });

describe('B29-SEC-1 loopback only', () => {
  it('the log line shows 127.0.0.1:PORT', () => {
    expect(logged).toContain(`127.0.0.1:${port}`);
  });
  it('accepts a connection on 127.0.0.1', async () => {
    expect(await connects('127.0.0.1')).toBe(true);
  });
  it('refuses a connection on ::1 (not bound to the IPv6 wildcard)', async () => {
    expect(await connects('::1')).toBe(false);
  });
  it('refuses a connection on every non-loopback IPv4 address of this machine', async () => {
    const external = Object.values(networkInterfaces()).flat().filter((i) => i && i.family === 'IPv4' && !i.internal).map((i) => i!.address);
    for (const addr of external) expect(await connects(addr), addr).toBe(false);
  });
});

describe('B29-SEC-2 methods', () => {
  it.each(['POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'])('%s is 405 with Allow: GET, HEAD', async (m) => {
    const r = await send(m, '/ui/ca.html');
    expect(r.status).toBe(405);
    expect(r.headers.allow).toBe('GET, HEAD');
  });
  it('405 also on a path that would be denied (method is judged first or both are refused, never 200)', async () => {
    const r = await send('POST', '/');
    expect(r.status).toBe(405);
  });
  it('HEAD of a served file: 200, same Content-Type and nosniff as GET, empty body', async () => {
    const g = await send('GET', '/ui/ca.html');
    const h = await send('HEAD', '/ui/ca.html');
    expect(h.status).toBe(200);
    expect(h.body).toBe('');
    expect(h.headers['content-type']).toBe(g.headers['content-type']);
    expect(h.headers['x-content-type-options']).toBe('nosniff');
  });
  it('HEAD of a denied path is still denied (404 or 403)', async () => {
    expect([403, 404]).toContain((await send('HEAD', '/COB-ts/src/ca/index.ts')).status);
  });
  it('GET is unchanged: 200, the page body, nosniff', async () => {
    const g = await send('GET', '/');
    expect(g.status).toBe(200);
    expect(g.body.length).toBeGreaterThan(100);
    expect(g.headers['x-content-type-options']).toBe('nosniff');
  });
});

describe('B29-SEC-3 Host header', () => {
  it('Host localhost:PORT, 127.0.0.1:PORT, bare localhost and bare 127.0.0.1 are served', async () => {
    for (const h of [`localhost:${port}`, `127.0.0.1:${port}`, 'localhost', '127.0.0.1']) {
      expect((await send('GET', '/ui/ca.html', h)).status, h).toBe(200);
    }
  });
  it('the default Host of node http (127.0.0.1:PORT) is served', async () => {
    expect((await send('GET', '/ui/ca.html')).status).toBe(200);
  });
  it.each(['evil.com', 'evil.com:80', '[::1]', '10.0.0.5', 'localhost.evil.com', 'localhost:1', '127.0.0.1:1', 'evil.localhost'])(
    'Host %s is 403',
    async (h) => {
      expect((await send('GET', '/ui/ca.html', h)).status).toBe(403);
    },
  );
  it('a bad Host is refused on HEAD and on / as well', async () => {
    expect((await send('HEAD', '/ui/ca.html', 'evil.com')).status).toBe(403);
    expect((await send('GET', '/', 'evil.com')).status).toBe(403);
  });
  it('a bad Host never receives file content', async () => {
    expect((await send('GET', '/ui/ca.html', 'evil.com')).body).not.toMatch(/<html/i);
  });
});
