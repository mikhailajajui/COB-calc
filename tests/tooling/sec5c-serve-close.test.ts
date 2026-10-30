/**
 * SEC-5c (COB-architecture.md §5 "SEC-5c brief", revision 64, R5c-1..R5c-6, tests T5c-*; fitness check F22 runtime
 * extension). User decision 2026-10-29: fix SEC-5c F-1 and F-2 before the handover; F-3 accepted (N-SEC5C-1, not
 * tested: it is Node's own behaviour). Coordinator: R5c-3 (checkContinue, no interim 100) is kept. QA red tests,
 * 2026-10-29. The developer must not edit this file.
 *
 * Harness (same rules as SEC-5b): every live case spawns the real ui/serve.mjs on a free port (never 5173 or 8080)
 * with an environment WITHOUT PORT, WEBSITE_HOSTNAME, COB_ALLOWED_HOSTS and the probe switches unless the case sets
 * them; every child is killed. Requests are raw net.connect bytes to 127.0.0.1. Client socket errors (EPIPE,
 * ECONNRESET) are ignored; assertions are on the bytes received.
 *
 * Server-side closes (T5c-HALFOPEN) are observed with tests/tooling/support/sec5b-probe-preload.mjs and
 * SEC5C_REPORT_CLOSE=1, which prints "SEC5C-CLOSE <ms>" when each server socket closes.
 *
 * Timing (robustness). No assertion depends on a race being won within a tight window:
 * - every wait is a poll on a condition with a hard upper bound (never a fixed sleep used as a synchronisation);
 * - the one timing bound from the brief is 2000 ms for the server to release a socket after the last client write.
 *   The architect measured 0-7 ms with the fix and ~150 s (Node's request-timeout sweep) without it, so the bound
 *   has a margin of more than 250x on the passing side and cannot be met by chance on the failing side;
 * - T5c-NOTRUNC is timing-dependent by nature (N9: it may pass on the delivered file by chance; measured on macOS
 *   loopback only), and the brief's own limit applies (R5c-1 "What is guaranteed"): if the server closes while the
 *   client is still sending, TCP may reset the connection and the client's OS may drop the reply. QA measured this
 *   on the architect's prototype at the red step (macOS loopback, Node 22.23.4): case (b) received 0 bytes with
 *   ECONNRESET in some runs. A literal "exactly the bytes" assertion is therefore flaky against a correct
 *   implementation. So T5c-NOTRUNC asserts what R5c-1 guarantees, deterministically, from the server side: the
 *   preload reports socket.writableFinished at 'close', which must be true (every byte of the reply was handed to
 *   the OS before the socket was destroyed). On the client side it asserts the exact reply bytes, except that when
 *   the client saw a connection error the bytes received must be a prefix of the reply (possibly empty; never
 *   anything else). T5c-SRC also carries the red for R5c-1.
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

// ---- R5-4 header set, in the object order of the `headers` constant of ui/serve.mjs ----
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
const headerLines = (m: Mode): string => modeHeaders(m).map(([n, v]) => `${n}: ${v}\r\n`).join('');

/** R5b-1 step 3 (unchanged by SEC-5c): the exact bytes of a clientError reply. */
function clientErrorBytes(m: Mode, status: number): string {
  const { reason, body } = CLIENT_ERR[status]!;
  return (
    `HTTP/1.1 ${status} ${reason}\r\n` +
    headerLines(m) +
    `Content-Type: ${TEXT}\r\n` +
    `Content-Length: ${Buffer.byteLength(body)}\r\n` +
    'Connection: close\r\n' +
    '\r\n' +
    body
  );
}

const DATE_MASK = 'Date: <masked>\r\n';
const IMF_FIXDATE = /^Date: (Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4} \d{2}:\d{2}:\d{2} GMT\r$/m;

/**
 * R5c-2: the 417 as `send(417, TEXT, 'Expectation failed', { Connection: 'close' })` writes it through ServerResponse:
 * writeHead({ ...headers, Connection, Content-Type }) -> those lines in that order; Node adds Date (user set
 * Connection, so Node adds no Connection/Keep-Alive) and, because writeHead stores the head before any body is known,
 * Transfer-Encoding: chunked; a HEAD response has no body, so no Transfer-Encoding and no chunk.
 */
function expectationFailedBytes(m: Mode, head: boolean): string {
  const body = 'Expectation failed';
  return (
    'HTTP/1.1 417 Expectation Failed\r\n' +
    headerLines(m) +
    'Connection: close\r\n' +
    `Content-Type: ${TEXT}\r\n` +
    DATE_MASK +
    (head ? '' : 'Transfer-Encoding: chunked\r\n') +
    '\r\n' +
    (head ? '' : `${body.length.toString(16)}\r\n${body}\r\n0\r\n\r\n`)
  );
}
/** The Date value is a fixed-length IMF-fixdate (29 characters), so the unmasked length is fixed. */
const unmaskedLength = (s: string): number => Buffer.byteLength(s) - DATE_MASK.length + 'Date: \r\n'.length + 29;

function maskDate(text: string): string {
  return text.replace(/^Date: [^\r\n]*\r\n/m, DATE_MASK);
}

// ---- process helpers (the SEC-5 / SEC-5b pattern) ----
function serveEnv(extra: Record<string, string | undefined>): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env.PORT;
  delete env.WEBSITE_HOSTNAME;
  delete env.COB_ALLOWED_HOSTS;
  delete env.SEC5B_REPORT;
  delete env.SEC5B_EMIT_CODE;
  delete env.SEC5C_REPORT_CLOSE;
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
    const t = setTimeout(() => s.child.kill('SIGKILL'), 5_000);
    await done;
    clearTimeout(t);
  }
}

/** Polls `cond` every 10 ms until it holds or `ms` pass; returns whether it held. */
async function waitFor(cond: () => boolean, ms: number): Promise<boolean> {
  const deadline = Date.now() + ms;
  while (!cond()) {
    if (Date.now() >= deadline) return false;
    await new Promise((r) => setTimeout(r, 10));
  }
  return true;
}

// ---- raw socket probes ----
type Raw = { buf: Buffer; text: string; closed: boolean; ms: number; error?: string };

/**
 * Opens a connection, writes `writes[0]` on connect and each further entry `gapMs` later (a write on a socket that
 * is already gone is skipped; write errors are ignored), and reads until the server closes (closed = true) or
 * `waitMs` pass after the first write. `ms` is the time from the first write to the close.
 */
function raw(port: number, writes: Array<string | Buffer>, opts: { waitMs?: number; gapMs?: number } = {}): Promise<Raw> {
  const waitMs = opts.waitMs ?? 2_000;
  const gapMs = opts.gapMs ?? 50;
  return new Promise((res) => {
    const chunks: Buffer[] = [];
    let done = false;
    let error: string | undefined;
    let t0 = Date.now();
    const timers: NodeJS.Timeout[] = [];
    const sock = connect(port, '127.0.0.1');
    const finish = (closed: boolean): void => {
      if (done) return;
      done = true;
      for (const x of timers) clearTimeout(x);
      sock.destroy();
      const buf = Buffer.concat(chunks);
      res({ buf, text: buf.toString('latin1'), closed, ms: Date.now() - t0, error });
    };
    sock.on('connect', () => {
      t0 = Date.now();
      timers.push(setTimeout(() => finish(false), waitMs));
      writes.forEach((w, i) => {
        const go = (): void => {
          if (!done && !sock.destroyed && sock.writable) sock.write(w);
        };
        if (i === 0) go();
        else timers.push(setTimeout(go, i * gapMs));
      });
    });
    sock.on('data', (c: Buffer) => chunks.push(c));
    sock.on('error', (e: NodeJS.ErrnoException) => (error ??= e.code ?? String(e)));
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

function expectR54(p: Parsed, m: Mode, what: string): void {
  for (const [n, v] of R54) expect(header(p, n), `${what}: ${n}`).toEqual([v]);
  expect(header(p, HSTS[0]), `${what}: HSTS`).toEqual(m === 'hosted' ? [HSTS[1]] : []);
}

const req = (line: string, hostLines: string[], extra: string[] = []): string =>
  [line, ...hostLines.map((h) => `Host: ${h}`), ...extra, '', ''].join('\r\n');

/** The preload's SEC5C-CLOSE lines (SEC5C_REPORT_CLOSE=1), in order. */
function closeReports(s: Started): Array<{ ms: number; finished: boolean }> {
  return [...s.stdout.matchAll(/^SEC5C-CLOSE (\d+) finished=(true|false)$/gm)].map((x) => ({ ms: Number(x[1]), finished: x[2] === 'true' }));
}
const closeLines = (s: Started): number => closeReports(s).length;

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
const goodHost = (m: Mode, port?: number): string => (m === 'local' ? `127.0.0.1:${port ?? L!.port}` : AZ_HOST);

// ---------------------------------------------------------------------------------------------------------------------
describe('SEC-5c expected bytes (QA derivation from R5c-2, cross-checked with the brief\'s byte counts)', () => {
  it.each([
    ['local', false, 711],
    ['local', true, 654],
    ['hosted', false, 756],
    ['hosted', true, 699],
  ] as const)('417 %s, HEAD=%s: %s bytes', (m, head, n) => {
    expect(unmaskedLength(expectationFailedBytes(m, head))).toBe(n);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe('SEC-5c R5c-1 / T5c-HALFOPEN (F-1): an error reply releases the server socket even if the client never closes', () => {
  const RELEASE_MS = 2_000;

  type HalfOpen = { sock: Socket; chunks: Buffer[]; ended: boolean };

  /** A client with allowHalfOpen that never ends or destroys its side until the test cleans up. */
  function halfOpen(port: number, data: string | null): Promise<HalfOpen> {
    return new Promise((res) => {
      const sock = connect({ port, host: '127.0.0.1', allowHalfOpen: true });
      const h: HalfOpen = { sock, chunks: [], ended: false };
      sock.on('data', (c: Buffer) => h.chunks.push(c));
      sock.on('end', () => (h.ended = true));
      sock.on('error', () => undefined);
      sock.on('connect', () => {
        if (data !== null) sock.write(data, () => res(h));
        else res(h);
      });
    });
  }


  type Case = {
    name: string;
    n: number;
    data: (host: string) => string | null;
    emit?: string;
    expectBytes: (m: Mode, text: string) => void;
  };
  const exact = (status: number) => (m: Mode, text: string) => expect(text).toBe(clientErrorBytes(m, status));
  const badRequestResponse = (m: Mode, text: string): void => {
    expect(statusLines(text)).toEqual(['HTTP/1.1 400 Bad Request']);
    const p = parse(text);
    expectR54(p, m, '400');
    expect(header(p, 'Connection')).toEqual(['close']);
    expect(p.body).toBe('Bad request');
  };
  const CASES: Case[] = [
    { name: 'GARBAGE request line (400)', n: 30, data: () => 'GARBAGE\r\n\r\n', expectBytes: exact(400) },
    { name: '20,000-byte header (431)', n: 5, data: (h) => req('GET / HTTP/1.1', [h], [`X-Big: ${'a'.repeat(20_000)}`]), expectBytes: exact(431) },
    { name: 'clientError ERR_HTTP_REQUEST_TIMEOUT, no client bytes (408)', n: 5, data: () => null, emit: 'ERR_HTTP_REQUEST_TIMEOUT', expectBytes: exact(408) },
    { name: 'clientError HPE_CHUNK_EXTENSIONS_OVERFLOW, no client bytes (413)', n: 5, data: () => null, emit: 'HPE_CHUNK_EXTENSIONS_OVERFLOW', expectBytes: exact(413) },
    { name: 'regression guard: HTTP/1.1 with no Host (400, step 0)', n: 5, data: () => req('GET /ui/ca.html HTTP/1.1', []), expectBytes: badRequestResponse },
    { name: 'regression guard: GET http://evil.com/ui/ca.js, allowed Host (400, step 1a)', n: 5, data: (h) => req('GET http://evil.com/ui/ca.js HTTP/1.1', [h]), expectBytes: badRequestResponse },
    {
      name: 'GET / with Expect: foo (417, R5c-2)',
      n: 5,
      data: (h) => req('GET / HTTP/1.1', [h], ['Expect: foo']),
      expectBytes: (m, text) => {
        expect(text).toMatch(IMF_FIXDATE);
        expect(maskDate(text)).toBe(expectationFailedBytes(m, false));
      },
    },
  ];

  describe.each(MODES)('%s mode', (m) => {
    it.each(CASES.map((c) => [c.name, c.n] as const))('%s: %s half-open clients each get the reply and a FIN; the server releases every socket within 2000 ms', async (name) => {
      const c = CASES.find((x) => x.name === name)!;
      const port = await freePort();
      const s = await start(m, port, { preload: true, extra: { SEC5C_REPORT_CLOSE: '1', SEC5B_EMIT_CODE: c.emit } });
      const clients: HalfOpen[] = [];
      try {
        const data = c.data(goodHost(m, port));
        clients.push(...(await Promise.all(Array.from({ length: c.n }, () => halfOpen(port, data)))));
        const lastWrite = Date.now();
        const released = await waitFor(() => closeLines(s) >= c.n && clients.every((h) => h.ended), RELEASE_MS);
        const elapsed = Date.now() - lastWrite;
        for (const [i, h] of clients.entries()) {
          const text = Buffer.concat(h.chunks).toString('latin1');
          c.expectBytes(m, text);
          expect(h.ended, `client ${i}: FIN received`).toBe(true);
        }
        expect(closeLines(s), `server sockets released within ${RELEASE_MS} ms of the last write (waited ${elapsed} ms)`).toBe(c.n);
        expect(released).toBe(true);
        expect(closeReports(s).map((x) => x.finished), 'every reply handed to the OS before the socket closed').toEqual(Array(c.n).fill(true));
        expect(s.stderr).toBe('');
      } finally {
        for (const h of clients) h.sock.destroy();
        await stop(s);
      }
    }, 30_000);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe('SEC-5c R5c-1 / T5c-NOTRUNC (F-1): bytes the client keeps sending after a malformed request do not cut the reply', () => {
  // See the file header: server side strict (writableFinished at close), client side exact unless the client saw a
  // connection error (TCP reset), then a prefix of the reply. Each probe reads until the server closes or 5 s pass;
  // the server's close report is awaited for at most 2 s (bounded). One probe at a time per child, so the newest
  // close report belongs to the probe just made.
  const big = 'a'.repeat(20_000);
  describe.each(MODES)('%s mode', (m) => {
    let S: Started | undefined;
    beforeAll(async () => {
      const port = await freePort();
      S = await start(m, port, { preload: true, extra: { SEC5C_REPORT_CLOSE: '1' } });
    }, 30_000);
    afterAll(async () => {
      await stop(S);
    });

    async function probe(writes: Array<string | Buffer>, expected: string, gapMs?: number): Promise<void> {
      const before = closeLines(S!);
      const r = await raw(S!.port, writes, { waitMs: 5_000, gapMs });
      expect(r.closed, 'server closed the connection').toBe(true);
      expect(await waitFor(() => closeLines(S!) > before, 2_000), 'server close report').toBe(true);
      expect(closeLines(S!), 'exactly one server socket closed').toBe(before + 1);
      expect(closeReports(S!).at(-1)!.finished, 'the reply was handed to the OS before the socket was destroyed').toBe(true);
      if (r.error === undefined) expect(r.text).toBe(expected);
      else expect(expected.startsWith(r.text), `client saw ${r.error}; received ${r.buf.length} bytes, must be a prefix of the reply`).toBe(true);
    }

    it.each([1, 2, 3, 4, 5])('(a) run %s: a 20,000-byte header plus 2,000,000 bytes of J in one write -> the 431 bytes', async () => {
      await probe([req('GET / HTTP/1.1', [goodHost(m, S!.port)], [`X-Big: ${big}`]) + 'J'.repeat(2_000_000)], clientErrorBytes(m, 431));
    }, 30_000);

    it('(b) GARBAGE plus 5,000,000 bytes of y in one write -> the 400 bytes', async () => {
      await probe(['GARBAGE\r\n\r\n' + 'y'.repeat(5_000_000)], clientErrorBytes(m, 400));
    }, 30_000);

    it('(c) GARBAGE, then three more writes 50 ms apart -> the 400 bytes', async () => {
      await probe(['GARBAGE\r\n\r\n', 'more junk', 'more junk 2', 'x'.repeat(100_000)], clientErrorBytes(m, 400), 50);
    }, 30_000);

    it('the server still answers /healthz afterwards; stderr stays empty', async () => {
      const r = await raw(S!.port, [req('GET /healthz HTTP/1.1', [goodHost(m, S!.port)], ['Connection: close'])]);
      expect(statusLines(r.text)).toEqual(['HTTP/1.1 200 OK']);
      expect(parse(r.text).body).toBe('ok');
      expect(S!.child.exitCode).toBeNull();
      expect(S!.stderr).toBe('');
    });
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe('SEC-5c T5c-SRC: the source of ui/serve.mjs', () => {
  const src = (): string => readFileSync(SERVE, 'utf8');
  it.each(['checkExpectation', 'checkContinue', 'clientError'])('exactly one .on(%j listener', (ev) => {
    expect(src().match(new RegExp(`\\.on\\(\\s*['"]${ev}['"]`, 'g')) ?? []).toHaveLength(1);
  });
  it('the clientError handler checks socket.writableEnded (R5c-1 step 2)', () => {
    expect(src()).toContain('writableEnded');
  });
  it('the reply is sent with socket.end(bytes, () => socket.destroy()) (R5c-1 step 4)', () => {
    expect(src()).toMatch(/socket\.end\([^;]*,\s*\(\)\s*=>\s*socket\.destroy\(\)\s*\)/);
  });
  it('417 and the body "Expectation failed" are in the source (R5c-2)', () => {
    expect(src()).toMatch(/\b417\b/);
    expect(src()).toContain("'Expectation failed'");
  });
  it('no setTimeout (no lingering close timer, R5c-1)', () => {
    expect(src()).not.toContain('setTimeout');
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe('SEC-5c R5c-5 / T5c-TEXT (QA addition): the two comments', () => {
  const norm = (s: string): string => s.replace(/\s+/g, ' ').trim();
  const lines = (): string[] => readFileSync(SERVE, 'utf8').split('\n');

  it('the header comment is the SEC-5b text followed by the R5c-5 sentence (wrapping free)', () => {
    const ls = lines();
    const end = ls.findIndex((l) => !l.startsWith('//'));
    const comment = norm(ls.slice(0, end).map((l) => l.replace(/^\/\/\s?/, '')).join(' '));
    expect(comment).toBe(
      norm(
        'Zero-dependency static file server for the calculator. It answers GET and HEAD only, and serves only files under ' +
          '/ui and /dist with an allowed extension, plus /version.json and /healthz; nothing else in the project folder. ' +
          'The page (ui/ca.html, the default) imports the built engine from /dist as ES modules, which a file:// page ' +
          'cannot do, so it has to come over http. ' +
          'Two modes (COB-architecture.md §5 SEC-5, docs/DEPLOY-AZURE.md): local (default; 127.0.0.1, port 5173, localhost ' +
          'Host names only) and hosted on Azure App Service (WEBSITE_HOSTNAME set; 0.0.0.0, port 8080, Host allow-list ' +
          'WEBSITE_HOSTNAME plus COB_ALLOWED_HOSTS). ' +
          'Every reply carries one fixed set of security headers, including the 400/408/413/431 replies to requests Node ' +
          'cannot parse; a connection that is reset or has already sent a reply is closed without one (SEC-5b). ' +
          'A request with an Expect other than 100-continue gets 417 with the same headers; a 100-continue request gets ' +
          'its final reply at once, with no interim 100 (SEC-5c).',
      ),
    );
  });

  it('the comment directly above const clientErrors has the R5c-5 wording', () => {
    const ls = lines();
    const at = ls.findIndex((l) => l.startsWith('const clientErrors'));
    expect(at).toBeGreaterThan(0);
    let i = at;
    while (i > 0 && ls[i - 1]!.startsWith('//')) i -= 1;
    const comment = norm(ls.slice(i, at).map((l) => l.replace(/^\/\/\s?/, '')).join(' '));
    expect(comment).toContain(
      "Requests Node cannot parse get Node's own status (431, 413, 408, else 400) with the security headers, then the " +
        'connection closes as soon as the reply has been handed to the OS (SEC-5c).',
    );
    expect(comment).toContain('A reset connection, or one that has already sent bytes of a reply, is closed silently.');
    expect(comment).toContain('A parse error on a connection whose reply has already been ended changes nothing.');
    expect(comment).not.toContain('then the connection closes.');
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe('SEC-5c R5c-2 / T5c-EXPECT (F-2): Expect other than 100-continue -> 417 with the R5-4 headers, step 0b', () => {
  describe.each(MODES)('%s mode', (m) => {
    const expect417 = (r: Raw, head = false): void => {
      expect(r.text).toMatch(IMF_FIXDATE);
      expect(maskDate(r.text)).toBe(expectationFailedBytes(m, head));
      expect(r.closed, 'server closed the connection').toBe(true);
    };

    it('GET /ui/ca.html + Expect: foo -> the exact 417 bytes, then close', async () => {
      const r = await raw(srv(m).port, [req('GET /ui/ca.html HTTP/1.1', [goodHost(m)], ['Expect: foo'])]);
      expect(r.buf.length).toBe(m === 'local' ? 711 : 756);
      expect417(r);
    });

    it('HEAD /ui/ca.html + Expect: foo -> the same head, no Transfer-Encoding, no body, then close', async () => {
      const r = await raw(srv(m).port, [req('HEAD /ui/ca.html HTTP/1.1', [goodHost(m)], ['Expect: foo'])]);
      expect(r.buf.length).toBe(m === 'local' ? 654 : 699);
      expect417(r, true);
    });

    const SAME: Array<[string, (h: string) => string]> = [
      ['Expect: with an empty value', (h) => req('GET /ui/ca.html HTTP/1.1', [h], ['Expect:'])],
      ['Expect: foo on GET /healthz', (h) => req('GET /healthz HTTP/1.1', [h], ['Expect: foo'])],
      ['Expect: foo on POST / with Content-Length: 3 and body abc (417, not 405)', (h) => req('POST / HTTP/1.1', [h], ['Expect: foo', 'Content-Length: 3']) + 'abc'],
      ['Expect: foo on GET http://evil.com/x (417, not the step 1a 400)', (h) => req('GET http://evil.com/x HTTP/1.1', [h], ['Expect: foo'])],
      ['Expect: foo with Host evil.com (417, not 403)', () => req('GET /ui/ca.html HTTP/1.1', ['evil.com'], ['Expect: foo'])],
      [
        'GET /healthz + Expect: foo, then a second GET /healthz on the same connection (one status line)',
        (h) => req('GET /healthz HTTP/1.1', [h], ['Expect: foo']) + req('GET /healthz HTTP/1.1', [h]),
      ],
    ];
    it.each(SAME.map(([n]) => n))('%s -> the same 417, then close', async (name) => {
      const data = SAME.find(([n]) => n === name)![1](goodHost(m));
      const r = await raw(srv(m).port, [data]);
      expect(statusLines(r.text)).toEqual(['HTTP/1.1 417 Expectation Failed']);
      expect417(r);
    });

    it.each([
      ['two Host lines + Expect: foo', (h: string) => req('GET /ui/ca.html HTTP/1.1', [h, h], ['Expect: foo'])],
      ['HTTP/1.1 with no Host + Expect: foo', () => req('GET /ui/ca.html HTTP/1.1', [], ['Expect: foo'])],
    ] as const)('step 0 first: %s -> 400 Bad request (R5b-2), then close', async (_n, mk) => {
      const r = await raw(srv(m).port, [mk(goodHost(m))]);
      expect(statusLines(r.text)).toEqual(['HTTP/1.1 400 Bad Request']);
      const p = parse(r.text);
      expectR54(p, m, '400');
      expect(header(p, 'Connection')).toEqual(['close']);
      expect(header(p, 'Content-Type')).toEqual([TEXT]);
      expect(p.body).toBe('Bad request');
      expect(r.closed, 'server closed the connection').toBe(true);
    });

    it('HTTP/1.0: GET /healthz, no Host, Expect: foo -> 200 ok (unchanged)', async () => {
      const r = await raw(srv(m).port, [req('GET /healthz HTTP/1.0', [], ['Expect: foo'])]);
      expect(statusLines(r.text)).toEqual(['HTTP/1.1 200 OK']);
      const p = parse(r.text);
      expectR54(p, m, '200');
      expect(p.body).toBe('ok');
      expect(r.closed, 'server closed the connection').toBe(true);
    });
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe('SEC-5c R5c-3 / T5c-CONTINUE: Expect: 100-continue gets the final reply at once, never a 100 Continue', () => {
  describe.each(MODES)('%s mode', (m) => {
    const ok200 = (r: Raw): void => {
      expect(r.text).not.toContain('100 Continue');
      expect(statusLines(r.text)).toEqual(['HTTP/1.1 200 OK']);
      const p = parse(r.text);
      expectR54(p, m, '200');
      expect(header(p, 'Connection')).toEqual(['close']);
      expect(header(p, 'Content-Type')).toEqual([TEXT]);
      expect(p.body).toBe('ok');
      expect(r.closed, 'server closed the connection').toBe(true);
    };

    it.each(['100-continue', 'foo, 100-Continue'])('GET /healthz + Expect: %s -> one 200 OK, R5-4 headers, Connection: close, body ok, closed', async (v) => {
      ok200(await raw(srv(m).port, [req('GET /healthz HTTP/1.1', [goodHost(m)], [`Expect: ${v}`])]));
    });

    it('QA addition (N11): GET /healthz + Expect: 100-continue, then a second GET /healthz on the same connection -> exactly one 200, closed', async () => {
      const h = goodHost(m);
      ok200(await raw(srv(m).port, [req('GET /healthz HTTP/1.1', [h], ['Expect: 100-continue']) + req('GET /healthz HTTP/1.1', [h])]));
    });

    it('POST / + Expect: 100-continue + Content-Length: 3, no body sent -> 405 with Allow and Connection: close, closed within 2000 ms', async () => {
      const r = await raw(srv(m).port, [req('POST / HTTP/1.1', [goodHost(m)], ['Expect: 100-continue', 'Content-Length: 3'])], { waitMs: 2_000 });
      expect(r.text).not.toContain('100 Continue');
      expect(statusLines(r.text)).toEqual(['HTTP/1.1 405 Method Not Allowed']);
      const p = parse(r.text);
      expectR54(p, m, '405');
      expect(header(p, 'Allow')).toEqual(['GET, HEAD']);
      expect(header(p, 'Connection')).toEqual(['close']);
      expect(p.body).toBe('Method not allowed');
      expect(r.closed, 'server closed the connection within 2000 ms').toBe(true);
    });

    it('HTTP/1.1 with no Host + Expect: 100-continue -> 400 Bad request (step 0), no 100 Continue', async () => {
      const r = await raw(srv(m).port, [req('GET /healthz HTTP/1.1', [], ['Expect: 100-continue'])]);
      expect(r.text).not.toContain('100 Continue');
      expect(statusLines(r.text)).toEqual(['HTTP/1.1 400 Bad Request']);
      const p = parse(r.text);
      expectR54(p, m, '400');
      expect(p.body).toBe('Bad request');
      expect(r.closed, 'server closed the connection').toBe(true);
    });

    it('GET /healthz HTTP/1.0 + Expect: 100-continue -> 200 ok, no 100 Continue (unchanged)', async () => {
      const r = await raw(srv(m).port, [req('GET /healthz HTTP/1.0', [], ['Expect: 100-continue'])]);
      expect(r.text).not.toContain('100 Continue');
      expect(statusLines(r.text)).toEqual(['HTTP/1.1 200 OK']);
      const p = parse(r.text);
      expectR54(p, m, '200');
      expect(p.body).toBe('ok');
      expect(r.closed, 'server closed the connection').toBe(true);
    });
  });
});
