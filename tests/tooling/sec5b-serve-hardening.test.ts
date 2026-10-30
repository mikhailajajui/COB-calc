/**
 * SEC-5b (COB-architecture.md §5 "SEC-5b brief", revision 63, R5b-1..R5b-8, tests T5b-*; fitness check F22 runtime
 * extension; review reviews/security-review-2026-10-29.md M1, L1-L4, §4, §5). User decision 2026-10-29: fix SEC-5b
 * before the handover; the single-file page stays a deliverable. Coordinator decision: `engines` is `>=22`, moved to
 * `>=26.13.0` by SEC-NODE26 (user decision 2026-10-29, brief R-N26-1/R-N26-8; re-pinned by QA, recorded). QA red tests,
 * 2026-10-29. The developer must not edit this file.
 *
 * Every live case spawns the real ui/serve.mjs on a free port (never 5173 or 8080) with an environment WITHOUT PORT,
 * WEBSITE_HOSTNAME and COB_ALLOWED_HOSTS unless the case sets them; every child is killed. Requests go through
 * net.connect to 127.0.0.1 with the exact bytes (an http client adds a Host and cannot send malformed requests);
 * each probe reads until the server closes or 2 s pass, and asserts on the status line(s), the headers and the body.
 * Well-formed probes that are not about connection handling send `Connection: close` so the server ends the reply.
 *
 * 408 and 413 cannot be probed live (R5b-1). Besides the source check the brief asks for (T5b-CLIENTERR-SRC), the
 * replies for them are checked on the wire by loading tests/tooling/support/sec5b-probe-preload.mjs into the child
 * (`node --import`), which emits the server's own 'clientError' event with the given code on a fresh connection.
 * The same preload reports the server's timeout options as the server holds them (T5b-TIMEOUTS).
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { connect, createServer, type Socket } from 'node:net';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ROOT } from '../architecture/support.js';

const SERVE = join(ROOT, 'ui', 'serve.mjs');
const PRELOAD = pathToFileURL(join(ROOT, 'tests', 'tooling', 'support', 'sec5b-probe-preload.mjs')).href;
const VERSION = (JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { version: string }).version;

// ---- R5-4 header set, in the object order of the `headers` constant of ui/serve.mjs (R5b-1 step 3) ----
const CSP =
  "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; font-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
const R54: Array<[string, string]> = [
  ['Content-Security-Policy', CSP],
  ['X-Content-Type-Options', 'nosniff'],
  ['X-Frame-Options', 'DENY'],
  ['Referrer-Policy', 'no-referrer'],
  [
    'Permissions-Policy',
    'accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()',
  ],
  ['Cross-Origin-Opener-Policy', 'same-origin'],
  ['Cross-Origin-Resource-Policy', 'same-origin'],
  ['Cache-Control', 'no-store'],
];
const HSTS: [string, string] = ['Strict-Transport-Security', 'max-age=31536000'];
const TEXT = 'text/plain; charset=utf-8';

// ---- R5b-1 table ----
const CLIENT_ERR: Record<number, { reason: string; body: string }> = {
  400: { reason: 'Bad Request', body: 'Bad request' },
  408: { reason: 'Request Timeout', body: 'Request timeout' },
  413: { reason: 'Payload Too Large', body: 'Content too large' },
  431: { reason: 'Request Header Fields Too Large', body: 'Request header fields too large' },
};

const AZ_HOST = 'cob-test.azurewebsites.net';
const AZ_ALLOWED = ' cob.example.internal ,COB2.Example.Internal:8443,';

type Mode = 'local' | 'hosted';
const MODES: Mode[] = ['local', 'hosted'];
const modeHeaders = (m: Mode): Array<[string, string]> => (m === 'hosted' ? [...R54, HSTS] : R54);

/** R5b-1 step 3: the exact bytes of a clientError reply. */
function clientErrorBytes(m: Mode, status: number): string {
  const { reason, body } = CLIENT_ERR[status]!;
  return (
    `HTTP/1.1 ${status} ${reason}\r\n` +
    modeHeaders(m)
      .map(([n, v]) => `${n}: ${v}\r\n`)
      .join('') +
    `Content-Type: ${TEXT}\r\n` +
    `Content-Length: ${Buffer.byteLength(body)}\r\n` +
    'Connection: close\r\n' +
    '\r\n' +
    body
  );
}

// ---- process helpers (the SEC-5 pattern) ----
function serveEnv(extra: Record<string, string | undefined>): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env.PORT;
  delete env.WEBSITE_HOSTNAME;
  delete env.COB_ALLOWED_HOSTS;
  delete env.SEC5B_REPORT;
  delete env.SEC5B_EMIT_CODE;
  for (const [k, v] of Object.entries(extra)) if (v !== undefined) env[k] = v;
  return env;
}

async function freePort(): Promise<number> {
  for (;;) {
    const p = await new Promise<number>((res, rej) => {
      const s = createServer();
      s.once('error', rej);
      s.listen(0, '127.0.0.1', () => {
        const q = (s.address() as { port: number }).port;
        s.close(() => res(q));
      });
    });
    if (p !== 5173 && p !== 8080) return p;
  }
}

type Started = { child: ChildProcess; stdout: string; stderr: string; port: number; mode: Mode };

function modeEnv(m: Mode, port: number, extra: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  return serveEnv(
    m === 'local'
      ? { PORT: String(port), ...extra }
      : { PORT: String(port), WEBSITE_HOSTNAME: AZ_HOST, COB_ALLOWED_HOSTS: AZ_ALLOWED, ...extra },
  );
}

function start(m: Mode, port: number, opts: { preload?: boolean; extra?: Record<string, string | undefined> } = {}): Promise<Started> {
  const args = opts.preload ? ['--import', PRELOAD, SERVE] : [SERVE];
  return new Promise((res, rej) => {
    const child = spawn(process.execPath, args, { cwd: ROOT, env: modeEnv(m, port, opts.extra), stdio: ['ignore', 'pipe', 'pipe'] });
    const st: Started = { child, stdout: '', stderr: '', port, mode: m };
    const t = setTimeout(() => {
      child.kill('SIGKILL');
      rej(new Error(`serve.mjs did not start within 10 s; stdout=${JSON.stringify(st.stdout)} stderr=${JSON.stringify(st.stderr)}`));
    }, 10_000);
    child.stdout!.on('data', (d: Buffer) => {
      st.stdout += d.toString();
      if (st.stdout.includes(`:${port}`)) {
        clearTimeout(t);
        res(st);
      }
    });
    child.stderr!.on('data', (d: Buffer) => (st.stderr += d.toString()));
    child.once('exit', (code) => {
      clearTimeout(t);
      rej(new Error(`serve.mjs exited early (${code}); stderr=${JSON.stringify(st.stderr)}`));
    });
  });
}

async function stop(s: Started | undefined): Promise<void> {
  if (s && s.child.exitCode === null && s.child.signalCode === null) {
    const done = new Promise((r) => s.child.once('exit', r));
    s.child.kill('SIGTERM');
    await done;
  }
}

// ---- raw socket probes ----
type Raw = { buf: Buffer; text: string; closed: boolean; error?: string };

/** Writes `data` on a fresh connection and reads until the server closes it (closed = true) or `waitMs` pass. */
function raw(port: number, data: string | Buffer, waitMs = 2_000): Promise<Raw> {
  return new Promise((res) => {
    const chunks: Buffer[] = [];
    let done = false;
    let error: string | undefined;
    const sock = connect(port, '127.0.0.1');
    const finish = (closed: boolean): void => {
      if (done) return;
      done = true;
      clearTimeout(t);
      sock.destroy();
      const buf = Buffer.concat(chunks);
      res({ buf, text: buf.toString('latin1'), closed, error });
    };
    const t = setTimeout(() => finish(false), waitMs);
    sock.on('connect', () => sock.write(data));
    sock.on('data', (c: Buffer) => chunks.push(c));
    sock.on('error', (e: NodeJS.ErrnoException) => (error = e.code ?? String(e)));
    sock.on('close', () => finish(true));
  });
}

type Parsed = { statusLine: string; headers: Array<[string, string]>; body: string };

/** Parses the first response in `text` (latin1); de-chunks a chunked body. */
function parse(text: string): Parsed {
  const i = text.indexOf('\r\n\r\n');
  if (i < 0) return { statusLine: text.split('\r\n')[0] ?? '', headers: [], body: '' };
  const lines = text.slice(0, i).split('\r\n');
  const headers = lines.slice(1).map((l): [string, string] => {
    const k = l.indexOf(':');
    return [l.slice(0, k), l.slice(k + 1).trim()];
  });
  let body = text.slice(i + 4);
  if (headers.some(([n, v]) => n.toLowerCase() === 'transfer-encoding' && v.toLowerCase() === 'chunked')) {
    let out = '';
    let rest = body;
    for (;;) {
      const e = rest.indexOf('\r\n');
      if (e < 0) break;
      const size = parseInt(rest.slice(0, e), 16);
      if (!Number.isFinite(size) || size === 0) break;
      out += rest.slice(e + 2, e + 2 + size);
      rest = rest.slice(e + 2 + size + 2);
    }
    body = out;
  }
  return { statusLine: lines[0] ?? '', headers, body };
}

const header = (p: Parsed, name: string): string[] => p.headers.filter(([n]) => n.toLowerCase() === name.toLowerCase()).map(([, v]) => v);
const statusLines = (text: string): string[] => text.match(/HTTP\/1\.[01] \d{3}[^\r\n]*/g) ?? [];

/** Every R5-4 header exactly once with its exact value; HSTS exactly in hosted mode. */
function expectR54(p: Parsed, m: Mode, what: string): void {
  for (const [n, v] of R54) expect(header(p, n), `${what}: ${n}`).toEqual([v]);
  expect(header(p, HSTS[0]), `${what}: HSTS`).toEqual(m === 'hosted' ? [HSTS[1]] : []);
}

/** A request with a Host header (or none / several) and the given request line. */
const req = (line: string, hostLines: string[], extra: string[] = []): string =>
  [line, ...hostLines.map((h) => `Host: ${h}`), ...extra, '', ''].join('\r\n');

// =====================================================================================================================
let L: Started | undefined;
let H: Started | undefined;

beforeAll(async () => {
  const [pl, ph] = [await freePort(), await freePort()];
  L = await start('local', pl);
  H = await start('hosted', ph);
}, 30_000);

afterAll(async () => {
  await stop(L);
  await stop(H);
});

const srv = (m: Mode): Started => (m === 'local' ? L! : H!);
const goodHost = (m: Mode): string => (m === 'local' ? `127.0.0.1:${L!.port}` : AZ_HOST);

async function healthzOk(port: number, host: string): Promise<void> {
  const r = await raw(port, req('GET /healthz HTTP/1.1', [host], ['Connection: close']));
  const p = parse(r.text);
  expect(p.statusLine).toBe('HTTP/1.1 200 OK');
  expect(p.body).toBe('ok');
}

// ---------------------------------------------------------------------------------------------------------------------
describe('SEC-5b R5b-1 / T5b-CLIENTERR (M1): requests Node cannot parse get its status with the R5-4 headers', () => {
  const big = 'a'.repeat(20_000);
  const CASES = (host: string): Array<[string, string, number]> => [
    ['GARBAGE request line', 'GARBAGE\r\n\r\n', 400],
    ['header name with a space', req('GET / HTTP/1.1', [host], ['Bad Header: x']), 400],
    ['space in the URL', req('GET /ui/ca .html HTTP/1.1', [host]), 400],
    ['Content-Length with Transfer-Encoding', req('POST / HTTP/1.1', [host], ['Content-Length: 1', 'Transfer-Encoding: chunked']), 400],
    ['20,000-character URL', req(`GET /${big} HTTP/1.1`, [host]), 431],
    ['20,000-byte header value', req('GET / HTTP/1.1', [host], [`X-Big: ${big}`]), 431],
  ];

  describe.each(MODES)('%s mode', (m) => {
    it.each(CASES('HOST').map((c) => [c[0], c[2]] as const))('%s -> %s, exact bytes per R5b-1, then the server closes', async (name, status) => {
      const data = CASES(goodHost(m)).find((c) => c[0] === name)![1];
      const r = await raw(srv(m).port, data);
      expect(r.text).toBe(clientErrorBytes(m, status));
      expect(r.closed, 'server closed the connection').toBe(true);
    });

    it('the server still answers /healthz after the malformed requests', async () => {
      await healthzOk(srv(m).port, goodHost(m));
      expect(srv(m).child.exitCode).toBeNull();
    });
  });
});

describe('SEC-5b R5b-1 (408, 413 and the close-only cases on the wire, via the preload)', () => {
  const CODES: Array<[string, number | null]> = [
    ['ERR_HTTP_REQUEST_TIMEOUT', 408],
    ['HPE_CHUNK_EXTENSIONS_OVERFLOW', 413],
    ['HPE_HEADER_OVERFLOW', 431],
    ['HPE_INVALID_METHOD', 400],
    ['SEC5B_SOME_OTHER_CODE', 400],
    ['ECONNRESET', null],
  ];
  describe.each(MODES)('%s mode', (m) => {
    it.each(CODES)('clientError %s on a fresh connection -> %s (null: nothing written, connection closed)', async (code, status) => {
      const port = await freePort();
      const s = await start(m, port, { preload: true, extra: { SEC5B_EMIT_CODE: code } });
      try {
        const r = await raw(port, '');
        expect(r.text).toBe(status === null ? '' : clientErrorBytes(m, status));
        expect(r.closed, 'server closed the connection').toBe(true);
        expect(s.stderr).toBe('');
      } finally {
        await stop(s);
      }
    });
  });
});

describe('SEC-5b R5b-1 / T5b-PIPELINE: a malformed request after a reply on a kept-alive connection gets no second status line', () => {
  it.each(MODES)('%s: GET /healthz then GARBAGE on one connection -> exactly one status line (200 OK), then close', async (m) => {
    const r = await raw(srv(m).port, req('GET /healthz HTTP/1.1', [goodHost(m)]) + 'GARBAGE\r\n\r\n');
    expect(statusLines(r.text)).toEqual(['HTTP/1.1 200 OK']);
    expect(parse(r.text).body).toBe('ok');
    expect(r.closed, 'server closed the connection').toBe(true);
  });

  // QA addition: pipelined in one write (above), Node's own guard already suppresses the second reply today
  // (the 200 is still in flight), so that case is a regression guard only. Sent after the 200 has arrived, Node
  // today writes a bare 400 on the same connection; R5b-1 (bytesWritten > 0) closes without a reply.
  it.each(MODES)('%s: GET /healthz, wait for the 200, then GARBAGE on the same connection -> still one status line, then close', async (m) => {
    const sock = connect(srv(m).port, '127.0.0.1');
    let text = '';
    let closed = false;
    sock.on('data', (c: Buffer) => (text += c.toString('latin1')));
    sock.on('close', () => (closed = true));
    sock.on('error', () => undefined);
    try {
      await new Promise<void>((r) => sock.once('connect', () => r()));
      sock.write(req('GET /healthz HTTP/1.1', [goodHost(m)]));
      const d1 = Date.now() + 2_000;
      while (!text.includes('\r\n0\r\n\r\n') && !closed && Date.now() < d1) await new Promise((r) => setTimeout(r, 20));
      expect(statusLines(text)).toEqual(['HTTP/1.1 200 OK']);
      sock.write('GARBAGE\r\n\r\n');
      const d2 = Date.now() + 2_000;
      while (!closed && Date.now() < d2) await new Promise((r) => setTimeout(r, 20));
      expect(statusLines(text)).toEqual(['HTTP/1.1 200 OK']);
      expect(closed, 'server closed the connection').toBe(true);
    } finally {
      sock.destroy();
    }
  });
});

describe('SEC-5b R5b-1 / T5b-RESET: reset or abandoned connections are closed silently', () => {
  it('20 half requests destroyed by the client and 20 reset by the client: the server stays up, stderr stays empty', async () => {
    const port = await freePort();
    const s = await start('local', port);
    try {
      for (const how of ['destroy', 'reset'] as const) {
        for (let i = 0; i < 20; i += 1) {
          await new Promise<void>((res) => {
            const sock: Socket = connect(port, '127.0.0.1', () => {
              sock.write('GET /ui/ca');
              setTimeout(() => {
                if (how === 'destroy') sock.destroy();
                else sock.resetAndDestroy();
                res();
              }, 10);
            });
            sock.on('error', () => undefined);
          });
        }
      }
      await new Promise((r) => setTimeout(r, 300));
      await healthzOk(port, `127.0.0.1:${port}`);
      expect(s.child.exitCode).toBeNull();
      expect(s.stderr).toBe('');
    } finally {
      await stop(s);
    }
  });
});

describe('SEC-5b R5b-1 / T5b-CLIENTERR-SRC: the source of the clientError handler', () => {
  const src = (): string => readFileSync(SERVE, 'utf8');
  it('exactly one clientError listener is registered', () => {
    expect(src().match(/\.on\(\s*['"]clientError['"]/g) ?? []).toHaveLength(1);
    expect(src().split('clientError').length - 1).toBeGreaterThanOrEqual(1);
  });
  it.each([
    ['HPE_HEADER_OVERFLOW', 431],
    ['HPE_CHUNK_EXTENSIONS_OVERFLOW', 413],
    ['ERR_HTTP_REQUEST_TIMEOUT', 408],
  ] as const)('%s is mapped to %s (the status follows the code within 200 characters, before another code)', (code, status) => {
    const s = src();
    const i = s.indexOf(code);
    expect(i, code).toBeGreaterThanOrEqual(0);
    const window = s.slice(i + code.length, i + code.length + 200);
    const cut = window.search(/HPE_HEADER_OVERFLOW|HPE_CHUNK_EXTENSIONS_OVERFLOW|ERR_HTTP_REQUEST_TIMEOUT/);
    expect((cut < 0 ? window : window.slice(0, cut)).match(new RegExp(`\\b${status}\\b`)), `${code} -> ${status}`).not.toBeNull();
  });
  it('it guards on bytesWritten and ECONNRESET and carries the four bodies verbatim', () => {
    const s = src();
    for (const t of ['bytesWritten', 'ECONNRESET', ...Object.values(CLIENT_ERR).map((e) => e.body)]) expect(s, t).toContain(t);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe('SEC-5b R5b-2 / T5b-HOST (L1, M1): Host field count, R5-3 step 0', () => {
  describe.each(MODES)('%s mode', (m) => {
    const expect400 = (r: Raw, head: boolean, what: string): void => {
      const p = parse(r.text);
      expect(p.statusLine, what).toBe('HTTP/1.1 400 Bad Request');
      expectR54(p, m, what);
      expect(header(p, 'Content-Type'), what).toEqual([TEXT]);
      expect(header(p, 'Connection').map((v) => v.toLowerCase()), what).toEqual(['close']);
      expect(p.body, what).toBe(head ? '' : 'Bad request');
      expect(statusLines(r.text), what).toHaveLength(1);
      expect(r.closed, `${what}: server closed the connection`).toBe(true);
    };

    it.each([
      ['GET /', 'GET / HTTP/1.1', false],
      ['GET /healthz', 'GET /healthz HTTP/1.1', false],
      ['HEAD /', 'HEAD / HTTP/1.1', true],
    ] as const)('HTTP/1.1 with no Host: %s -> 400 with the R5-4 headers and Connection: close', async (what, line, head) => {
      expect400(await raw(srv(m).port, req(line, [])), head, what);
    });

    it.each([
      ['GET /ui/ca.html', 'GET /ui/ca.html HTTP/1.1'],
      ['GET /healthz', 'GET /healthz HTTP/1.1'],
      ['POST /', 'POST / HTTP/1.1'],
      ['HTTP/1.0 GET /healthz', 'GET /healthz HTTP/1.0'],
    ] as const)('two Host lines (Host / hOsT, same allowed value): %s -> 400', async (what, line) => {
      const h = goodHost(m);
      const data = [line, `Host: ${h}`, `hOsT: ${h}`, '', ''].join('\r\n');
      expect400(await raw(srv(m).port, data), false, what);
    });

    it('HTTP/1.0 with no Host: /healthz -> 200 ok, / -> 403 Forbidden (unchanged)', async () => {
      const a = parse((await raw(srv(m).port, req('GET /healthz HTTP/1.0', []))).text);
      expect(a.statusLine).toBe('HTTP/1.1 200 OK');
      expect(a.body).toBe('ok');
      expectR54(a, m, '1.0 /healthz');
      const b = parse((await raw(srv(m).port, req('GET / HTTP/1.0', []))).text);
      expect(b.statusLine).toBe('HTTP/1.1 403 Forbidden');
      expect(b.body).toBe('Forbidden');
      expectR54(b, m, '1.0 /');
    });

    it('one empty Host line counts as one: / -> 403, /healthz -> 200 (unchanged)', async () => {
      const a = parse((await raw(srv(m).port, 'GET / HTTP/1.1\r\nHost:\r\nConnection: close\r\n\r\n')).text);
      expect(a.statusLine).toBe('HTTP/1.1 403 Forbidden');
      const b = parse((await raw(srv(m).port, 'GET /healthz HTTP/1.1\r\nHost:\r\nConnection: close\r\n\r\n')).text);
      expect(b.statusLine).toBe('HTTP/1.1 200 OK');
      expect(b.body).toBe('ok');
    });

    it('a single Host with an invalid value (a b) stays 403 (N-SEC5B-1)', async () => {
      const a = parse((await raw(srv(m).port, req('GET / HTTP/1.1', ['a b'], ['Connection: close']))).text);
      expect(a.statusLine).toBe('HTTP/1.1 403 Forbidden');
    });
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe('SEC-5b R5b-3 / T5b-PATH (L2): routing on the raw path', () => {
  const NOT_FOUND = [
    '//evil.com/ui/ca.js',
    '/%2fui/ca.js',
    '/%2Fui/ca.js',
    '/ui//ca.html',
    '/ui/ca.html/',
    '/ui/',
    '//',
    '/ui%5Cca.js',
    '/ui/..%5cserve.mjs',
    '/%zz',
    '/healthz/',
    '/%68ealthz',
    '/version%2Ejson',
  ];
  const OK: Array<[string, string | null]> = [
    ['/', null],
    ['/?x=1', null],
    ['/ui/ca.js?v=1', null],
    ['/ui/ca%2Ejs', null],
    ['/healthz?x', 'ok'],
    ['/version.json?x', JSON.stringify({ version: VERSION })],
  ];
  const get = async (m: Mode, target: string, host = goodHost(m), method = 'GET'): Promise<Parsed> =>
    parse((await raw(srv(m).port, req(`${method} ${target} HTTP/1.1`, [host], ['Connection: close']))).text);

  describe.each(MODES)('%s mode', (m) => {
    it.each(NOT_FOUND)('%s -> 404 Not found with the R5-4 headers', async (t) => {
      const p = await get(m, t);
      expect(p.statusLine).toBe('HTTP/1.1 404 Not Found');
      expect(p.body).toBe('Not found');
      expectR54(p, m, t);
    });

    it.each(OK)('%s -> 200 (unchanged; the query is ignored)', async (t, body) => {
      const p = await get(m, t);
      expect(p.statusLine).toBe('HTTP/1.1 200 OK');
      if (body !== null) expect(p.body).toBe(body);
      expectR54(p, m, t);
    });

    it('/ and /ui/ca%2Ejs serve the same bytes as /ui/ca.html and /ui/ca.js', async () => {
      expect((await get(m, '/')).body).toBe(readFileSync(join(ROOT, 'ui', 'ca.html'), 'latin1'));
      expect((await get(m, '/ui/ca%2Ejs')).body).toBe(readFileSync(join(ROOT, 'ui', 'ca.js'), 'latin1'));
    });

    it('absolute form GET http://evil.com/ui/ca.js -> 400 Bad request, R5-4 headers, Connection: close (N-SEC5B-2)', async () => {
      const r = await raw(srv(m).port, req('GET http://evil.com/ui/ca.js HTTP/1.1', [goodHost(m)]));
      const p = parse(r.text);
      expect(p.statusLine).toBe('HTTP/1.1 400 Bad Request');
      expect(p.body).toBe('Bad request');
      expect(header(p, 'Content-Type')).toEqual([TEXT]);
      expect(header(p, 'Connection').map((v) => v.toLowerCase())).toEqual(['close']);
      expectR54(p, m, 'absolute form');
      expect(r.closed, 'server closed the connection').toBe(true);
    });

    it('OPTIONS * -> 405 with Allow: GET, HEAD (unchanged; step 1 before 1a)', async () => {
      const p = await get(m, '*', goodHost(m), 'OPTIONS');
      expect(p.statusLine).toBe('HTTP/1.1 405 Method Not Allowed');
      expect(header(p, 'Allow')).toEqual(['GET, HEAD']);
    });

    it.each(['/%68ealthz', '/version%2Ejson'])('%s with Host evil.com -> 403 (not the routes)', async (t) => {
      expect((await get(m, t, 'evil.com')).statusLine).toBe('HTTP/1.1 403 Forbidden');
    });

    it('/healthz and /healthz?x with Host evil.com -> 200 ok; / with an empty Host -> 403 (unchanged)', async () => {
      for (const t of ['/healthz', '/healthz?x']) {
        const p = await get(m, t, 'evil.com');
        expect(p.statusLine, t).toBe('HTTP/1.1 200 OK');
        expect(p.body, t).toBe('ok');
      }
      expect((await get(m, '/', '')).statusLine).toBe('HTTP/1.1 403 Forbidden');
    });
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe('SEC-5b R5b-4 / T5b-TIMEOUTS (L3)', () => {
  it('the source passes the four options to createServer, and does not assign the timeouts as properties', () => {
    const s = readFileSync(SERVE, 'utf8');
    expect(s).toMatch(/requireHostHeader:\s*false\b/);
    expect(s).toMatch(/keepAliveTimeout:\s*120_?000\b/);
    expect(s).toMatch(/headersTimeout:\s*125_?000\b/);
    expect(s).toMatch(/requestTimeout:\s*125_?000\b/);
    expect(s).not.toMatch(/\.\s*(keepAliveTimeout|headersTimeout|requestTimeout|requireHostHeader)\s*=(?!=)/);
  });

  it.each(MODES)('%s: the running server holds requireHostHeader false and 120 / 125 / 125 s', async (m) => {
    const port = await freePort();
    const s = await start(m, port, { preload: true, extra: { SEC5B_REPORT: '1' } });
    try {
      const line = s.stdout.split('\n').find((l) => l.startsWith('SEC5B-OPTIONS '));
      expect(line, 'preload report').toBeDefined();
      expect(JSON.parse(line!.slice('SEC5B-OPTIONS '.length))).toEqual({
        requireHostHeader: false,
        keepAliveTimeout: 120_000,
        headersTimeout: 125_000,
        requestTimeout: 125_000,
      });
    } finally {
      await stop(s);
    }
  });

  it('live: a kept-alive connection that idles 6 s (beyond the old 5 s default) still answers a second GET /healthz', async () => {
    const port = L!.port;
    const host = goodHost('local');
    const sock = connect(port, '127.0.0.1');
    let text = '';
    let closed = false;
    sock.on('data', (c: Buffer) => (text += c.toString('latin1')));
    sock.on('close', () => (closed = true));
    sock.on('error', () => undefined);
    try {
      await new Promise<void>((r) => sock.once('connect', () => r()));
      sock.write(req('GET /healthz HTTP/1.1', [host]));
      const deadline = Date.now() + 2_000;
      while (!text.includes('\r\n0\r\n\r\n') && !closed && Date.now() < deadline) await new Promise((r) => setTimeout(r, 20));
      expect(statusLines(text)).toEqual(['HTTP/1.1 200 OK']);
      await new Promise((r) => setTimeout(r, 6_000));
      expect(closed, 'the server closed the idle connection within 6 s').toBe(false);
      sock.write(req('GET /healthz HTTP/1.1', [host], ['Connection: close']));
      const d2 = Date.now() + 2_000;
      while (!closed && Date.now() < d2) await new Promise((r) => setTimeout(r, 20));
      expect(statusLines(text)).toEqual(['HTTP/1.1 200 OK', 'HTTP/1.1 200 OK']);
    } finally {
      sock.destroy();
    }
  }, 20_000);
});

// ---------------------------------------------------------------------------------------------------------------------
describe('SEC-5b R5b-5 / T5b-ENGINES (L4)', () => {
  it("package.json engines is exactly { node: '>=26.13.0' }, directly after types (SEC-NODE26 R-N26-1)", () => {
    const text = readFileSync(join(ROOT, 'package.json'), 'utf8');
    const pkg = JSON.parse(text) as Record<string, unknown>;
    expect(pkg.engines).toEqual({ node: '>=26.13.0' });
    const keys = Object.keys(pkg);
    expect(keys[keys.indexOf('types') + 1]).toBe('engines');
    expect(text).toContain('  "types": "./dist/index.d.ts",\n  "engines": {\n    "node": ">=26.13.0"\n  },\n');
  });

  it('package-lock.json packages[""].engines is the same', () => {
    const lock = JSON.parse(readFileSync(join(ROOT, 'package-lock.json'), 'utf8')) as { packages: Record<string, { engines?: unknown }> };
    expect(lock.packages['']!.engines).toEqual({ node: '>=26.13.0' });
  });

  it('ui/serve.mjs installs no uncaughtException / unhandledRejection handler (N7)', () => {
    const s = readFileSync(SERVE, 'utf8');
    expect(s).not.toMatch(/uncaughtException|unhandledRejection/);
  });
});

describe('SEC-5b R5b-6 / T5b-GITIGNORE', () => {
  it('.gitignore lines are exactly the eight lines, in order; COB deliverable not ignored', () => {
    const text = readFileSync(join(ROOT, '.gitignore'), 'utf8');
    expect(text.endsWith('\n')).toBe(true);
    expect(text.slice(0, -1).split('\n')).toEqual(['node_modules/', 'dist/', '_site/', '*.log', '.DS_Store', '__pycache__/', '*.pyc', '.env*']);
    expect(text).not.toMatch(/\.html/);
  });
});

describe('SEC-5b R5b-7 / T5b-TEXT: comments and README', () => {
  const norm = (s: string): string => s.replace(/\s+/g, ' ').trim();

  const R5B71 = norm(
    'Zero-dependency static file server for the calculator. It answers GET and HEAD only, and serves only files under ' +
      '/ui and /dist with an allowed extension, plus /version.json and /healthz; nothing else in the project folder. ' +
      'The page (ui/ca.html, the default) imports the built engine from /dist as ES modules, which a file:// page ' +
      'cannot do, so it has to come over http. ' +
      'Two modes (COB-architecture.md §5 SEC-5, docs/DEPLOY-AZURE.md): local (default; 127.0.0.1, port 5173, localhost ' +
      'Host names only) and hosted on Azure App Service (WEBSITE_HOSTNAME set; 0.0.0.0, port 8080, Host allow-list ' +
      'WEBSITE_HOSTNAME plus COB_ALLOWED_HOSTS). ' +
      'Every reply carries one fixed set of security headers, including the 400/408/413/431 replies to requests Node ' +
      'cannot parse; a connection that is reset or has already sent a reply is closed without one (SEC-5b).',
  );

  // Adapted 2026-10-29 by QA at the SEC-5c red step (COB-architecture.md §5 SEC-5c brief R5c-5, revision 64): R5c-5
  // appends one sentence after "(SEC-5b).", so this test now checks that the comment starts with the R5b-7.1 text;
  // the exact full text (R5b-7.1 + R5c-5) is checked in tests/tooling/sec5c-serve-close.test.ts (T5c-TEXT).
  it('the serve.mjs header comment starts with the R5b-7.1 text (wrapping free) and no longer says "project root"', () => {
    const lines = readFileSync(SERVE, 'utf8').split('\n');
    const end = lines.findIndex((l) => !l.startsWith('//'));
    const comment = norm(lines.slice(0, end).map((l) => l.replace(/^\/\/\s?/, '')).join(' '));
    expect(comment).not.toContain('project root');
    expect(comment.slice(0, R5B71.length)).toBe(R5B71);
  });

  it('README.md has the R5b-7.2 sentence and no "project root"', () => {
    const r = norm(readFileSync(join(ROOT, 'README.md'), 'utf8'));
    expect(r).not.toContain('project root');
    expect(r).toContain(
      '`npm run ui` builds the engine and serves the calculator on `http://localhost:5173` (or `$PORT`): only files under ' +
        '`ui/` and `dist/` with an allowed extension, plus `/version.json` and `/healthz` (see `docs/DEPLOY-AZURE.md`); ' +
        '`/` opens `ui/ca.html`.',
    );
  });

  it('ui/ca.js: the brand-logo comment is the R5b-7.3 line, once; "hotlinked" is gone', () => {
    const s = readFileSync(join(ROOT, 'ui', 'ca.js'), 'utf8');
    expect(s).not.toContain('hotlinked');
    expect(s.split('\n').filter((l) => l === "// --- brand logo: a self-hosted file (SEC-6); fall back to the name as text if it can't load ---")).toHaveLength(1);
  });
});
