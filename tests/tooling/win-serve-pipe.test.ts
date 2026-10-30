/**
 * WIN-DEPLOY (user decision 2026-10-30: Azure App Service on Windows, branch win_deploy; docs/DEPLOY-AZURE-WINDOWS.md).
 * iisnode passes a Windows named pipe (\\.\pipe\<name>) in PORT. In hosted mode ui/serve.mjs listens on it; in local
 * mode it still takes only a port number, and a malformed pipe name is refused with the SEC-5 R5-2 message.
 *
 * On Windows the child listens on a real named pipe. Elsewhere Node treats the same string as a Unix socket path,
 * created in the child's working directory (a temporary folder), so the case runs on the Linux CI agent too. Requests
 * go through that socket with an explicit Host header. server.cjs (the iisnode entry point) is started the same way.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SERVE = join(ROOT, 'ui', 'serve.mjs');
const ENTRY = join(ROOT, 'server.cjs');
const AZ_HOST = 'cob-win.azurewebsites.net';
const PORT_MSG = 'PORT must be a whole number from 1 to 65535';

let cwd = '';
let seq = 0;

/** The parent env minus the three variables serve.mjs reads, plus the case's own. */
function serveEnv(extra: Record<string, string>): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env.PORT;
  delete env.WEBSITE_HOSTNAME;
  delete env.COB_ALLOWED_HOSTS;
  return { ...env, ...extra };
}

const pipeName = (): string => `\\\\.\\pipe\\cob-win-${process.pid}-${++seq}`;
/** Where a client connects: the pipe itself on Windows, the socket file in the child's cwd elsewhere. */
const socketFor = (pipe: string): string => (process.platform === 'win32' ? pipe : join(cwd, pipe));

type Started = { child: ChildProcess; stdout: string };

function start(script: string, env: NodeJS.ProcessEnv): Promise<Started> {
  return new Promise((res, rej) => {
    const child = spawn(process.execPath, [script], { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
    const st: Started = { child, stdout: '' };
    let stderr = '';
    const t = setTimeout(() => {
      child.kill('SIGKILL');
      rej(new Error(`did not start within 10 s; stderr=${JSON.stringify(stderr)}`));
    }, 10_000);
    child.stdout!.on('data', (d: Buffer) => {
      st.stdout += d.toString();
      if (st.stdout.includes('listening on')) {
        clearTimeout(t);
        res(st);
      }
    });
    child.stderr!.on('data', (d: Buffer) => (stderr += d.toString()));
    child.once('exit', (code) => {
      clearTimeout(t);
      rej(new Error(`exited early (${code}); stderr=${JSON.stringify(stderr)}`));
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

/** Runs serve.mjs expecting it to refuse the configuration and exit. */
function runExpectingExit(env: NodeJS.ProcessEnv): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((res) => {
    const child = spawn(process.execPath, [SERVE], { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
    const o = { code: null as number | null, stdout: '', stderr: '' };
    const t = setTimeout(() => child.kill('SIGKILL'), 8_000);
    child.stdout!.on('data', (d: Buffer) => {
      o.stdout += d.toString();
      child.kill('SIGKILL');
    });
    child.stderr!.on('data', (d: Buffer) => (o.stderr += d.toString()));
    child.once('exit', (code) => {
      clearTimeout(t);
      o.code = code;
      res(o);
    });
  });
}

function get(socketPath: string, path: string, host: string): Promise<{ status: number; headers: Record<string, unknown>; body: string }> {
  return new Promise((res, rej) => {
    const req = request({ socketPath, path, method: 'GET', setHost: false, agent: false, headers: { Host: host } }, (r) => {
      let body = '';
      r.setEncoding('utf8');
      r.on('data', (c) => (body += c));
      r.on('end', () => res({ status: r.statusCode ?? 0, headers: r.headers, body }));
    });
    req.on('error', rej);
    req.end();
  });
}

beforeAll(() => {
  cwd = mkdtempSync(join(tmpdir(), 'cob-win-pipe-'));
});

afterAll(() => {
  if (cwd) rmSync(cwd, { recursive: true, force: true });
});

describe.each([
  ['ui/serve.mjs', SERVE],
  ['server.cjs (iisnode entry)', ENTRY],
])('WIN-DEPLOY: hosted mode on a named pipe, started through %s', (_name, script) => {
  let s: Started | undefined;
  let pipe = '';

  beforeAll(async () => {
    pipe = pipeName();
    s = await start(script, serveEnv({ PORT: pipe, WEBSITE_HOSTNAME: AZ_HOST }));
  }, 15_000);

  afterAll(async () => {
    await stop(s);
  });

  it('logs the hosted start-up line naming the pipe', () => {
    expect(s!.stdout).toContain(`cob-calculator (Canada): hosted mode, listening on ${pipe}; allowed hosts: ${AZ_HOST}`);
  });

  it('/healthz answers ok', async () => {
    const r = await get(socketFor(pipe), '/healthz', AZ_HOST);
    expect(r.status).toBe(200);
    expect(r.body).toBe('ok');
  });

  it('/ serves the calculator with the security headers and HSTS', async () => {
    const r = await get(socketFor(pipe), '/', AZ_HOST);
    expect(r.status).toBe(200);
    expect(r.body).toContain('Cost of Borrowing Calculator');
    expect(String(r.headers['content-security-policy'])).toContain("default-src 'none'");
    expect(r.headers['strict-transport-security']).toBe('max-age=31536000');
  });

  it('a Host outside the allow-list gets 403', async () => {
    expect((await get(socketFor(pipe), '/', 'other.example')).status).toBe(403);
  });

  it('files outside ui/ and dist/ stay unpublished (server.cjs, package.json)', async () => {
    for (const p of ['/server.cjs', '/web.config', '/package.json']) {
      expect((await get(socketFor(pipe), p, AZ_HOST)).status, p).toBe(404);
    }
  });
});

describe('WIN-DEPLOY: a pipe is accepted only in hosted mode and only in the \\\\.\\pipe\\<name> form', () => {
  it('local mode refuses a pipe with the R5-2 message', async () => {
    const pipe = pipeName();
    const o = await runExpectingExit(serveEnv({ PORT: pipe }));
    expect(o.stdout).toBe('');
    expect(o.code).toBe(1);
    expect(o.stderr).toContain(`serve.mjs: ${PORT_MSG} (got "${pipe}")`);
  });

  it.each(['\\\\.\\pipe\\', '\\\\.\\pipe\\a/b', '\\\\.\\pipe\\a\\b', '\\\\server\\pipe\\x', '//./pipe/x', ' \\\\.\\pipe\\x'])(
    'hosted PORT=%j -> exit 1 with the R5-2 message',
    async (v) => {
      const o = await runExpectingExit(serveEnv({ PORT: v, WEBSITE_HOSTNAME: AZ_HOST }));
      expect(o.stdout).toBe('');
      expect(o.code).toBe(1);
      expect(o.stderr).toContain(`serve.mjs: ${PORT_MSG} (got "${v}")`);
    },
  );
});
