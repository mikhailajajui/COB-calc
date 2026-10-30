/**
 * SEC-5 (COB-architecture.md §5 "SEC-5 and SEC-6 brief", revision 62, R5-1..R5-6, tests T5-*; fitness check F22
 * runtime half; operator note docs/DEPLOY-AZURE.md). User decision DEC-SEC-AZURE (2026-10-29): Azure App Service,
 * Linux, Node 22, startup `node ui/serve.mjs`, internal network only. QA red tests, 2026-10-28.
 *
 * Every case spawns the real ui/serve.mjs (or a copy of it on a temporary project root, the B29 S2/S4 pattern) as a
 * child process. Each child gets an environment WITHOUT PORT, WEBSITE_HOSTNAME and COB_ALLOWED_HOSTS unless the case
 * sets them, so a developer or CI shell cannot switch the mode by accident. Servers that should start use a free
 * port; the two "PORT empty / unset" cases use the mode default (5173 local, 8080 hosted) and accept either outcome
 * the brief allows (started on it, or "cannot listen on" naming it), so they never skip. Every child is killed.
 * Requests go to 127.0.0.1 with an explicit Host header. The developer must not edit this file.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ROOT } from '../architecture/support.js';
import { neutraliseCaJs, NEUTRALISED_CA_JS_SHA } from '../ca/support/caJsFeeRow.js';

const SERVE = join(ROOT, 'ui', 'serve.mjs');
const VERSION = (JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { version: string }).version;
const sha = (b: Buffer | string): string => createHash('sha256').update(b).digest('hex');

// ---- R5-4 constants (exact values from the brief) ----
const CSP =
  "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; font-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
const FIXED_HEADERS: Record<string, string> = {
  'content-security-policy': CSP,
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'no-referrer',
  'permissions-policy':
    'accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()',
  'cross-origin-opener-policy': 'same-origin',
  'cross-origin-resource-policy': 'same-origin',
  'cache-control': 'no-store',
};
const HSTS = 'max-age=31536000';
const TEXT = 'text/plain; charset=utf-8';

// ---- R5-2 / R5-1 refusal messages ----
const PORT_MSG = 'PORT must be a whole number from 1 to 65535';
const LOCAL_HOSTS_MSG = 'serve.mjs: COB_ALLOWED_HOSTS is only read on Azure App Service (WEBSITE_HOSTNAME is not set)';
const badHostMsg = (v: string): string => `serve.mjs: invalid host name in WEBSITE_HOSTNAME or COB_ALLOWED_HOSTS: "${v}"`;

// ---- hosted-mode fixture from T5-MODE-H ----
const AZ_HOST = 'cob-test.azurewebsites.net';
const AZ_ALLOWED = ' cob.example.internal ,COB2.Example.Internal:8443,';

/** The child environment: the parent's, minus the three variables serve.mjs reads, plus the case's own. */
function serveEnv(extra: Record<string, string | undefined>): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env.PORT;
  delete env.WEBSITE_HOSTNAME;
  delete env.COB_ALLOWED_HOSTS;
  for (const [k, v] of Object.entries(extra)) if (v !== undefined) env[k] = v;
  return env;
}

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

type Started = { child: ChildProcess; stdout: string; stderr: string; port: number };

/** Starts a server and resolves once stdout names `:<port>`; rejects if it exits first or stays silent for 10 s. */
function start(env: NodeJS.ProcessEnv, port: number, script = SERVE, cwd = ROOT): Promise<Started> {
  return new Promise((res, rej) => {
    const child = spawn(process.execPath, [script], { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
    const st: Started = { child, stdout: '', stderr: '', port };
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

type Outcome = { code: number | null; stdout: string; stderr: string; listened: boolean };

/**
 * Runs serve.mjs expecting a fail-fast exit. Resolves on exit; if the process writes anything to stdout instead (the
 * start-up line, i.e. it listened) or is still running after 8 s, it is killed and reported with listened = true
 * (code null), so a red case fails quickly instead of hanging.
 */
function runExpectingExit(env: NodeJS.ProcessEnv): Promise<Outcome> {
  return new Promise((res) => {
    const child = spawn(process.execPath, [SERVE], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
    const o: Outcome = { code: null, stdout: '', stderr: '', listened: false };
    let settled = false;
    const kill = () => {
      if (settled) return;
      o.listened = true;
      child.kill('SIGKILL');
    };
    const t = setTimeout(kill, 8_000);
    child.stdout!.on('data', (d: Buffer) => {
      o.stdout += d.toString();
      setTimeout(kill, 100);
    });
    child.stderr!.on('data', (d: Buffer) => (o.stderr += d.toString()));
    child.once('exit', (code) => {
      clearTimeout(t);
      settled = true;
      o.code = o.listened ? null : code;
      res(o);
    });
  });
}

type Res = { status: number; headers: Record<string, string | string[] | undefined>; body: Buffer; rawHeaders: string[] };

/** One request to 127.0.0.1:<port> with an explicit Host header (an empty string is sent as `Host: `). */
function send(port: number, method: string, path: string, host: string): Promise<Res> {
  return new Promise((res, rej) => {
    const req = request(
      { host: '127.0.0.1', port, path, method, setHost: false, agent: false, headers: { Host: host } },
      (r) => {
        const chunks: Buffer[] = [];
        r.on('data', (c: Buffer) => chunks.push(c));
        r.on('end', () =>
          res({ status: r.statusCode ?? 0, headers: r.headers, body: Buffer.concat(chunks), rawHeaders: r.rawHeaders }),
        );
      },
    );
    req.on('error', rej);
    req.end();
  });
}

/** Header names that occur more than once in a response (each R5-4 header must be one constant value). */
const duplicates = (raw: string[]): string[] => {
  const names = raw.filter((_, i) => i % 2 === 0).map((n) => n.toLowerCase());
  return names.filter((n, i) => names.indexOf(n) !== i);
};

// =====================================================================================================================
// Two long-running servers for the request-handling cases: one local, one hosted (T5-MODE-H environment).
// =====================================================================================================================
let L: Started | undefined;
let H: Started | undefined;

beforeAll(async () => {
  const [pl, ph] = [await freePort(), await freePort()];
  L = await start(serveEnv({ PORT: String(pl) }), pl);
  H = await start(serveEnv({ PORT: String(ph), WEBSITE_HOSTNAME: AZ_HOST, COB_ALLOWED_HOSTS: AZ_ALLOWED }), ph);
}, 30_000);

afterAll(async () => {
  await stop(L);
  await stop(H);
});

type Mode = 'local' | 'hosted';
const MODES: Mode[] = ['local', 'hosted'];
const srv = (m: Mode): Started => (m === 'local' ? L! : H!);
const goodHost = (m: Mode): string => (m === 'local' ? `127.0.0.1:${L!.port}` : AZ_HOST);
const go = (m: Mode, method: string, path: string, host = goodHost(m)): Promise<Res> => send(srv(m).port, method, path, host);

// ---------------------------------------------------------------------------------------------------------------------
describe('SEC-5 R5-1 / T5-MODE-L: local mode is unchanged', () => {
  it('the start-up line is exactly the pre-SEC-5 line (127.0.0.1 only)', () => {
    const p = L!.port;
    expect(L!.stdout.trim()).toBe(
      `cob-calculator test UI (Canada): http://localhost:${p} (listening on 127.0.0.1:${p} only)`,
    );
  });

  it.each(['localhost', '127.0.0.1', 'LOCALHOST', 'local:port', '127:port'])('local Host %s -> 200', async (h) => {
    const host = h === 'local:port' ? `localhost:${L!.port}` : h === '127:port' ? `127.0.0.1:${L!.port}` : h;
    expect((await go('local', 'GET', '/ui/ca.html', host)).status).toBe(200);
  });

  it.each([AZ_HOST, 'cob.example.internal', 'evil.com', ''])('local Host "%s" -> 403', async (h) => {
    const r = await go('local', 'GET', '/ui/ca.html', h);
    expect(r.status).toBe(403);
    expect(r.body.toString()).toBe('Forbidden');
  });

  it('a whitespace-only WEBSITE_HOSTNAME means local mode (hosted only when non-empty after trimming)', async () => {
    const p = await freePort();
    const s = await start(serveEnv({ PORT: String(p), WEBSITE_HOSTNAME: '   ' }), p);
    try {
      expect(s.stdout.trim()).toBe(`cob-calculator test UI (Canada): http://localhost:${p} (listening on 127.0.0.1:${p} only)`);
      expect((await send(p, 'GET', '/ui/ca.html', `localhost:${p}`)).status).toBe(200);
    } finally {
      await stop(s);
    }
  });

  it('a whitespace-only COB_ALLOWED_HOSTS in local mode is not "set": the server starts', async () => {
    const p = await freePort();
    const s = await start(serveEnv({ PORT: String(p), COB_ALLOWED_HOSTS: '  ' }), p);
    await stop(s);
    expect(s.stdout).toContain(`127.0.0.1:${p}`);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe('SEC-5 R5-1 / T5-MODE-H: hosted mode (WEBSITE_HOSTNAME set)', () => {
  it('the start-up line names 0.0.0.0:<port> and the three hosts in order, lower-case, trimmed', () => {
    const p = H!.port;
    expect(H!.stdout).toContain(`0.0.0.0:${p}`);
    expect(H!.stdout.trim()).toBe(
      `cob-calculator (Canada): hosted mode, listening on 0.0.0.0:${p}; allowed hosts: cob-test.azurewebsites.net, cob.example.internal, cob2.example.internal:8443`,
    );
  });

  it.each([AZ_HOST, 'COB-TEST.AZUREWEBSITES.NET', 'cob.example.internal', 'cob2.example.internal:8443'])(
    'Host %s -> 200 with the page',
    async (h) => {
      const r = await go('hosted', 'GET', '/ui/ca.html', h);
      expect(r.status).toBe(200);
      expect(r.body.equals(readFileSync(join(ROOT, 'ui', 'ca.html')))).toBe(true);
    },
  );

  it.each([
    'cob2.example.internal',
    'cob-test.azurewebsites.net:443',
    'localhost:<port>',
    '127.0.0.1:<port>',
    'localhost',
    '127.0.0.1',
    'evil.com',
    'cob-test.azurewebsites.net.evil.com',
    'x.cob-test.azurewebsites.net',
    '',
  ])('Host "%s" -> 403, body Forbidden, no file content', async (h) => {
    const host = h.replace('<port>', String(H!.port));
    for (const path of ['/', '/ui/ca.html', '/version.json']) {
      const r = await go('hosted', 'GET', path, host);
      expect(r.status, `${path} with Host ${host}`).toBe(403);
      expect(r.body.toString(), path).toBe('Forbidden');
    }
  });

  it('duplicates are dropped (case-insensitively) and WEBSITE_HOSTNAME comes first in the start-up line', async () => {
    const p = await freePort();
    const s = await start(
      serveEnv({ PORT: String(p), WEBSITE_HOSTNAME: 'app-one.azurewebsites.net', COB_ALLOWED_HOSTS: 'b.example,APP-ONE.azurewebsites.net,B.EXAMPLE,a.example' }),
      p,
    );
    await stop(s);
    expect(s.stdout.trim()).toBe(
      `cob-calculator (Canada): hosted mode, listening on 0.0.0.0:${p}; allowed hosts: app-one.azurewebsites.net, b.example, a.example`,
    );
  });

  it('with COB_ALLOWED_HOSTS unset only WEBSITE_HOSTNAME is allowed', async () => {
    const p = await freePort();
    const s = await start(serveEnv({ PORT: String(p), WEBSITE_HOSTNAME: 'solo.azurewebsites.net' }), p);
    try {
      expect(s.stdout.trim()).toBe(`cob-calculator (Canada): hosted mode, listening on 0.0.0.0:${p}; allowed hosts: solo.azurewebsites.net`);
      expect((await send(p, 'GET', '/ui/ca.html', 'solo.azurewebsites.net')).status).toBe(200);
      expect((await send(p, 'GET', '/ui/ca.html', `localhost:${p}`)).status).toBe(403);
    } finally {
      await stop(s);
    }
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe('SEC-5 R5-3 step 2 / T5-HEALTH: /healthz answers ok whatever the Host', () => {
  describe.each(MODES)('%s mode', (m) => {
    it.each(['good', 'evil.com', 'localhost', ''])('GET /healthz with Host %s -> 200, text/plain, body exactly ok', async (h) => {
      const r = await go(m, 'GET', '/healthz', h === 'good' ? goodHost(m) : h);
      expect(r.status).toBe(200);
      expect(r.headers['content-type']).toBe(TEXT);
      expect(r.body.toString()).toBe('ok');
    });

    it('HEAD /healthz -> 200 with an empty body (also with Host evil.com)', async () => {
      for (const h of [goodHost(m), 'evil.com']) {
        const r = await go(m, 'HEAD', '/healthz', h);
        expect(r.status, h).toBe(200);
        expect(r.body.length, h).toBe(0);
      }
    });

    it('POST /healthz -> 405 with Allow: GET, HEAD (method is judged first)', async () => {
      const r = await go(m, 'POST', '/healthz', 'evil.com');
      expect(r.status).toBe(405);
      expect(r.headers.allow).toBe('GET, HEAD');
    });

    // SEC-5b (QA red step 2026-10-29, brief T5b "Adapted"): "not 200" becomes "404" (R5-3 step 4a).
    it.each(['/healthz/', '/healthz.txt', '/ui/healthz', '/HEALTHZ'])('%s -> 404 (path must be exactly /healthz)', async (p) => {
      expect((await go(m, 'GET', p)).status).toBe(404);
    });
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe('SEC-5 R5-2 / T5-PORT: PORT is strict; a bad value fails fast', () => {
  const REFUSED = ['0', '-1', '65536', '8080.5', ' 8080', '8080 ', '0x50', '1e3', '08080', 'abc'];

  it.each(REFUSED)('local PORT=%j -> exit 1, the R5-2 message on stderr, never listens', async (v) => {
    const o = await runExpectingExit(serveEnv({ PORT: v }));
    expect(o.listened, `listened; stdout=${JSON.stringify(o.stdout)}`).toBe(false);
    expect(o.code).toBe(1);
    expect(o.stdout).toBe('');
    expect(o.stderr).toContain(`serve.mjs: ${PORT_MSG} (got "${v}")`);
    expect(o.stderr.trim().split('\n')).toHaveLength(1);
  });

  it.each(['abc', '0', '65536'])('hosted PORT=%j -> exit 1 with the same message', async (v) => {
    const o = await runExpectingExit(serveEnv({ PORT: v, WEBSITE_HOSTNAME: AZ_HOST }));
    expect(o.listened).toBe(false);
    expect(o.code).toBe(1);
    expect(o.stderr).toContain(`serve.mjs: ${PORT_MSG} (got "${v}")`);
  });

  it.each(['1', '65535'])('PORT=%s is accepted (bounds; the value itself is not bound here, only parsed)', async (v) => {
    // Binding 1 needs privileges on Linux and 65535 may be taken, so either the server starts on it or it fails with
    // "cannot listen on 127.0.0.1:<v>"; what must NOT happen is the PORT refusal.
    const o = await runExpectingExit(serveEnv({ PORT: v }));
    expect(o.stderr).not.toContain(PORT_MSG);
    if (!o.listened) {
      expect(o.code).toBe(1);
      expect(o.stderr).toContain(`serve.mjs: cannot listen on 127.0.0.1:${v}: `);
    } else {
      expect(o.stdout).toContain(`127.0.0.1:${v}`);
    }
  });

  it.each([
    ['local', 'empty', {}, '127.0.0.1', 5173],
    ['local', 'unset', {}, '127.0.0.1', 5173],
    ['hosted', 'empty', { WEBSITE_HOSTNAME: AZ_HOST }, '0.0.0.0', 8080],
    ['hosted', 'unset', { WEBSITE_HOSTNAME: AZ_HOST }, '0.0.0.0', 8080],
  ] as const)('%s mode, PORT %s -> the mode default (started on it, or "cannot listen on" naming it)', async (_m, how, extra, addr, def) => {
    const o = await runExpectingExit(serveEnv({ ...extra, PORT: how === 'empty' ? '' : undefined }));
    expect(o.stderr).not.toContain(PORT_MSG);
    if (o.listened) {
      expect(o.stdout).toContain(`${addr}:${def}`);
    } else {
      expect(o.code).toBe(1);
      expect(o.stderr).toContain(`serve.mjs: cannot listen on ${addr}:${def}: `);
    }
  });

  it('a port in use -> exit 1, one line "serve.mjs: cannot listen on 127.0.0.1:<port>: EADDRINUSE"', async () => {
    const p = L!.port; // held by the local server
    const o = await runExpectingExit(serveEnv({ PORT: String(p) }));
    expect(o.listened).toBe(false);
    expect(o.code).toBe(1);
    expect(o.stderr.trim()).toBe(`serve.mjs: cannot listen on 127.0.0.1:${p}: EADDRINUSE`);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe('SEC-5 R5-1 / T5-HOSTCFG: host-name configuration fails fast', () => {
  it('COB_ALLOWED_HOSTS=x.example in local mode -> exit 1 with the R5-1 message', async () => {
    const p = await freePort();
    const o = await runExpectingExit(serveEnv({ PORT: String(p), COB_ALLOWED_HOSTS: 'x.example' }));
    expect(o.listened).toBe(false);
    expect(o.code).toBe(1);
    expect(o.stderr.trim()).toBe(LOCAL_HOSTS_MSG);
  });

  const REFUSED = ['*', '*.example.com', 'https://x', 'x/y', 'a b', '-bad.com', 'host:0', 'host:65536', 'bad-.com', 'a..b', 'host:'];

  it.each(REFUSED)('COB_ALLOWED_HOSTS entry %j -> exit 1, the value named', async (v) => {
    const p = await freePort();
    const o = await runExpectingExit(serveEnv({ PORT: String(p), WEBSITE_HOSTNAME: AZ_HOST, COB_ALLOWED_HOSTS: `ok.example,${v}` }));
    expect(o.listened).toBe(false);
    expect(o.code).toBe(1);
    expect(o.stderr.trim()).toBe(badHostMsg(v));
  });

  it.each(REFUSED)('WEBSITE_HOSTNAME %j -> exit 1, the value named', async (v) => {
    const p = await freePort();
    const o = await runExpectingExit(serveEnv({ PORT: String(p), WEBSITE_HOSTNAME: v }));
    expect(o.listened).toBe(false);
    expect(o.code).toBe(1);
    expect(o.stderr.trim()).toBe(badHostMsg(v));
  });

  it('"a.example,,b.example," is accepted (empty entries dropped)', async () => {
    const p = await freePort();
    const s = await start(serveEnv({ PORT: String(p), WEBSITE_HOSTNAME: AZ_HOST, COB_ALLOWED_HOSTS: 'a.example,,b.example,' }), p);
    try {
      expect(s.stdout.trim()).toBe(`cob-calculator (Canada): hosted mode, listening on 0.0.0.0:${p}; allowed hosts: ${AZ_HOST}, a.example, b.example`);
      expect((await send(p, 'GET', '/ui/ca.html', 'b.example')).status).toBe(200);
    } finally {
      await stop(s);
    }
  });

  it('a host with a port up to 65535 is accepted (name:65535, name:1)', async () => {
    const p = await freePort();
    const s = await start(serveEnv({ PORT: String(p), WEBSITE_HOSTNAME: AZ_HOST, COB_ALLOWED_HOSTS: 'n.example:65535,m.example:1' }), p);
    try {
      expect((await send(p, 'GET', '/ui/ca.html', 'n.example:65535')).status).toBe(200);
      expect((await send(p, 'GET', '/ui/ca.html', 'm.example:1')).status).toBe(200);
      expect((await send(p, 'GET', '/ui/ca.html', 'n.example')).status).toBe(403);
    } finally {
      await stop(s);
    }
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe('SEC-5 R5-4 / T5-HEADERS (F22 runtime): the fixed header set on every response, both modes', () => {
  const CASES: Array<[string, string, string, 'good' | 'evil', number]> = [
    ['200 html', 'GET', '/ui/ca.html', 'good', 200],
    ['200 engine js', 'GET', '/dist/ca/index.js', 'good', 200],
    ['200 font', 'GET', '/ui/assets/fonts/Inter-Regular.woff2', 'good', 200],
    ['200 /', 'GET', '/', 'good', 200],
    ['200 version.json', 'GET', '/version.json', 'good', 200],
    ['HEAD 200', 'HEAD', '/ui/ca.html', 'good', 200],
    ['403 bad Host', 'GET', '/ui/ca.html', 'evil', 403],
    ['HEAD 403', 'HEAD', '/ui/ca.html', 'evil', 403],
    ['404 source', 'GET', '/src/ca/index.ts', 'good', 404],
    ['404 package.json', 'GET', '/package.json', 'good', 404],
    ['HEAD 404', 'HEAD', '/src/ca/index.ts', 'good', 404],
    ['405 POST /', 'POST', '/', 'good', 405],
    ['405 bad Host', 'DELETE', '/ui/ca.html', 'evil', 405],
    ['/healthz', 'GET', '/healthz', 'good', 200],
    ['/healthz bad Host', 'GET', '/healthz', 'evil', 200],
  ];

  describe.each(MODES)('%s mode', (m) => {
    it.each(CASES)('%s: %s %s -> %s headers exact, HSTS only when hosted', async (_n, method, path, h, status) => {
      const r = await go(m, method, path, h === 'good' ? goodHost(m) : 'evil.com');
      expect(r.status).toBe(status);
      for (const [name, value] of Object.entries(FIXED_HEADERS)) expect(r.headers[name], name).toBe(value);
      if (m === 'hosted') expect(r.headers['strict-transport-security']).toBe(HSTS);
      else expect(r.headers['strict-transport-security']).toBeUndefined();
      expect(duplicates(r.rawHeaders)).toEqual([]);
      if (method === 'HEAD') expect(r.body.length).toBe(0);
    });

    it.each([
      ['403', 'GET', '/ui/ca.html', 'evil', 403, 'Forbidden'],
      ['404', 'GET', '/src/ca/index.ts', 'good', 404, 'Not found'],
      ['405', 'POST', '/', 'good', 405, 'Method not allowed'],
    ] as const)('%s carries Content-Type text/plain; charset=utf-8 and its fixed body', async (_n, method, path, h, status, body) => {
      const r = await go(m, method, path, h === 'good' ? goodHost(m) : 'evil.com');
      expect(r.status).toBe(status);
      expect(r.headers['content-type']).toBe(TEXT);
      expect(r.body.toString()).toBe(body);
      if (status === 405) expect(r.headers.allow).toBe('GET, HEAD');
    });

    it('HEAD of a served file: same Content-Type as GET, empty body', async () => {
      const g = await go(m, 'GET', '/ui/ca.html');
      const h = await go(m, 'HEAD', '/ui/ca.html');
      expect(h.status).toBe(200);
      expect(h.headers['content-type']).toBe(g.headers['content-type']);
      expect(h.body.length).toBe(0);
    });
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe('SEC-5 R5-4 / T5-CSP (F22 runtime): the policy is the constant and has no weak source', () => {
  it('the served CSP equals the R5-4 constant in both modes', async () => {
    for (const m of MODES) expect((await go(m, 'GET', '/')).headers['content-security-policy'], m).toBe(CSP);
  });

  it('parsed: default-src and frame-ancestors are none; no unsafe-, wildcard, scheme, hash or nonce source', async () => {
    const value = String((await go('hosted', 'GET', '/')).headers['content-security-policy'] ?? '');
    const directives = new Map(
      value
        .split(';')
        .map((d) => d.trim())
        .filter(Boolean)
        .map((d) => {
          const [name, ...sources] = d.split(/\s+/);
          return [name!.toLowerCase(), sources] as const;
        }),
    );
    expect(directives.get('default-src')).toEqual(["'none'"]);
    expect(directives.get('frame-ancestors')).toEqual(["'none'"]);
    for (const d of ['script-src', 'style-src', 'img-src', 'font-src', 'connect-src']) expect(directives.get(d), d).toEqual(["'self'"]);
    expect(directives.get('base-uri')).toEqual(["'none'"]);
    expect(directives.get('form-action')).toEqual(["'none'"]);
    const sources = [...directives.values()].flat();
    expect(sources.length).toBeGreaterThan(0);
    for (const s of sources) {
      for (const bad of ['unsafe-', '*', 'http:', 'https:', 'data:', 'blob:', "'sha", "'nonce"]) {
        expect(s.toLowerCase().includes(bad), `${s} contains ${bad}`).toBe(false);
      }
    }
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe('SEC-5 R5-3 steps 6-8 / T5-EXT: extension allow-list and content types', () => {
  describe.each(MODES)('%s mode', (m) => {
    it.each([
      ['/ui/ca.html', 'text/html; charset=utf-8', 'ui/ca.html'],
      ['/', 'text/html; charset=utf-8', 'ui/ca.html'],
      ['/ui/ca.js', 'text/javascript; charset=utf-8', 'ui/ca.js'],
      ['/ui/ca-view.js', 'text/javascript; charset=utf-8', 'ui/ca-view.js'],
      ['/dist/ca/index.js', 'text/javascript; charset=utf-8', 'dist/ca/index.js'],
      ['/ui/ca.css', 'text/css; charset=utf-8', 'ui/ca.css'],
      ['/ui/assets/alterna-savings.svg', 'image/svg+xml', 'ui/assets/alterna-savings.svg'],
      ['/ui/assets/fonts/Inter-Regular.woff2', 'font/woff2', 'ui/assets/fonts/Inter-Regular.woff2'],
      ['/ui/assets/fonts/LICENSE.txt', 'text/plain; charset=utf-8', 'ui/assets/fonts/LICENSE.txt'],
    ])('%s -> 200 %s, byte for byte', async (path, type, file) => {
      const r = await go(m, 'GET', path);
      expect(r.status).toBe(200);
      expect(r.headers['content-type']).toBe(type);
      expect(r.body.equals(readFileSync(join(ROOT, file)))).toBe(true);
    });

    it.each([
      ['/ui/serve.mjs', 'ui/serve.mjs'],
      ['/ui/ca-view.d.ts', 'ui/ca-view.d.ts'],
      ['/dist/index.d.ts', 'dist/index.d.ts'],
      ['/dist/ca/index.d.ts', 'dist/ca/index.d.ts'],
      ['/dist/ca/index.js.map', 'dist/ca/index.js.map'],
      ['/dist/index.d.ts.map', 'dist/index.d.ts.map'],
      ['/ui/CA.HTML', null],
      ['/ui/ca.JS', null],
      ['/package.json', 'package.json'],
      ['/package-lock.json', 'package-lock.json'],
    ] as Array<[string, string | null]>)('%s -> 404 Not found (the file exists, its extension or place is not allowed)', async (path, file) => {
      if (file) expect(() => readFileSync(join(ROOT, file)), `${file} exists (precondition)`).not.toThrow();
      const r = await go(m, 'GET', path);
      expect(r.status).toBe(404);
      expect(r.body.toString()).toBe('Not found');
    });
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe('SEC-5 R5-3 step 4 / T5-VERSION: /version.json replaces /package.json', () => {
  describe.each(MODES)('%s mode', (m) => {
    it('/version.json -> 200 application/json, body exactly JSON.stringify({ version })', async () => {
      const r = await go(m, 'GET', '/version.json');
      expect(r.status).toBe(200);
      expect(r.headers['content-type']).toBe('application/json; charset=utf-8');
      expect(r.body.toString()).toBe(JSON.stringify({ version: VERSION }));
      expect(r.body.toString()).toBe('{"version":"0.1.0"}');
    });
    it('HEAD /version.json -> 200, empty body', async () => {
      const r = await go(m, 'HEAD', '/version.json');
      expect(r.status).toBe(200);
      expect(r.body.length).toBe(0);
    });
    it('/package.json -> 404 (it published the devDependency list)', async () => {
      const r = await go(m, 'GET', '/package.json');
      expect(r.status).toBe(404);
      expect(r.body.toString()).not.toContain('devDependencies');
    });
  });

  describe('on a temporary project root (B29 S2/S4 pattern)', () => {
    const roots: string[] = [];
    afterAll(() => {
      for (const r of roots) rmSync(r, { recursive: true, force: true });
    });

    async function withRoot(pkg: string | null, fn: (port: number, root: string) => Promise<void>): Promise<void> {
      const root = mkdtempSync(join(tmpdir(), 'sec5-serve-root-'));
      roots.push(root);
      mkdirSync(join(root, 'ui'));
      copyFileSync(SERVE, join(root, 'ui', 'serve.mjs'));
      writeFileSync(join(root, 'ui', 'ca.html'), '<!doctype html><title>stub</title>\n');
      if (pkg !== null) writeFileSync(join(root, 'package.json'), pkg);
      const p = await freePort();
      const s = await start(serveEnv({ PORT: String(p) }), p, join(root, 'ui', 'serve.mjs'), root);
      try {
        await fn(p, root);
      } finally {
        await stop(s);
      }
    }

    it.each([
      ['{} (no version)', '{}\n'],
      ['a numeric version', '{"version": 1}\n'],
      ['unparsable JSON', '{not json'],
      ['no package.json at all', null],
    ] as Array<[string, string | null]>)('package.json is %s -> /version.json 404, the page still served', async (_n, pkg) => {
      await withRoot(pkg, async (p) => {
        expect((await send(p, 'GET', '/version.json', `localhost:${p}`)).status).toBe(404);
        expect((await send(p, 'GET', '/', `localhost:${p}`)).status).toBe(200);
      });
    });

    it('the version is read once at start-up (a later edit of package.json does not change the answer)', async () => {
      await withRoot('{"version":"1.2.3","devDependencies":{"x":"1"}}\n', async (p, root) => {
        const first = await send(p, 'GET', '/version.json', `localhost:${p}`);
        expect(first.status).toBe(200);
        expect(first.body.toString()).toBe('{"version":"1.2.3"}');
        writeFileSync(join(root, 'package.json'), '{"version":"9.9.9"}\n');
        expect((await send(p, 'GET', '/version.json', `localhost:${p}`)).body.toString()).toBe('{"version":"1.2.3"}');
        expect((await send(p, 'GET', '/package.json', `localhost:${p}`)).status).toBe(404);
      });
    });
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe('SEC-5 R5-5: ui/ca.js fetches /version.json; nothing else in ca.js changes', () => {
  const ca = (): string => readFileSync(join(ROOT, 'ui', 'ca.js'), 'utf8');
  const PRE_SEC5_CA_SHA = 'c85852c670d594a17ba63f704b2cbd36c991fc25ae1270a015bf36a32c958e50';

  it("ca.js has fetch('/version.json') exactly once and no /package.json", () => {
    expect(ca().split("fetch('/version.json')").length - 1).toBe(1);
    expect(ca()).not.toContain('/package.json');
  });

  it('putting /package.json back gives the pre-SEC-5 ca.js outside addFeeRow (structural re-pin)', () => {
    // SEC-7 (QA 2026-10-29): addFeeRow is the one function SEC-7 may change, so the byte-for-byte pin (c85852c6…,
    // kept below as history) moved to "neutralised" ca.js: addFeeRow cut to `function addFeeRow() {}` and the fetch
    // put back (tests/ca/support/caJsFeeRow.ts, sha256 ff8d8ef5…, taken from the same file as c85852c6…).
    const s = ca();
    expect(s).toContain("fetch('/version.json')");
    expect(PRE_SEC5_CA_SHA).toBe('c85852c670d594a17ba63f704b2cbd36c991fc25ae1270a015bf36a32c958e50');
    expect(sha(neutraliseCaJs(s))).toBe(NEUTRALISED_CA_JS_SHA);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe('SEC-5 R5-1: serve.mjs reads exactly PORT, WEBSITE_HOSTNAME and COB_ALLOWED_HOSTS (static)', () => {
  it('no process.env name other than the three is read; each of the three is named; no bind-address variable', () => {
    const src = readFileSync(SERVE, 'utf8');
    const names = new Set([...src.matchAll(/process\.env(?:\.([A-Za-z_]\w*)|\[\s*['"]([^'"]+)['"]\s*\])/g)].map((x) => x[1] ?? x[2]));
    for (const n of names) expect(['COB_ALLOWED_HOSTS', 'PORT', 'WEBSITE_HOSTNAME'], `process.env.${n}`).toContain(n);
    for (const n of ['PORT', 'WEBSITE_HOSTNAME', 'COB_ALLOWED_HOSTS']) expect(src, n).toMatch(new RegExp(`\\b${n}\\b`));
    expect(src).not.toMatch(/X-Forwarded/i); // R5-4: the server never reads X-Forwarded-Proto
  });
});
