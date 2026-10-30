// Zero-dependency static file server for the calculator. It answers GET and HEAD only, and serves only files under
// /ui and /dist with an allowed extension, plus /version.json and /healthz; nothing else in the project folder. The
// page (ui/ca.html, the default) imports the built engine from /dist as ES modules, which a file:// page cannot do,
// so it has to come over http.
// Two modes (COB-architecture.md §5 SEC-5, docs/DEPLOY-AZURE.md): local (default; 127.0.0.1, port 5173, localhost
// Host names only) and hosted on Azure App Service (WEBSITE_HOSTNAME set; 0.0.0.0, port 8080, Host allow-list
// WEBSITE_HOSTNAME plus COB_ALLOWED_HOSTS). Every reply carries one fixed set of security headers, including the
// 400/408/413/431 replies to requests Node cannot parse; a connection that is reset or has already sent a reply is
// closed without one (SEC-5b). A request with an Expect other than 100-continue gets 417 with the same headers; a
// 100-continue request gets its final reply at once, with no interim 100 (SEC-5c).
import { createServer, STATUS_CODES } from 'node:http';
import { readFileSync } from 'node:fs';
import { readFile, realpath } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

function failFast(message) {
  console.error(`serve.mjs: ${message}`);
  process.exit(1);
}

const projectRoot = join(fileURLToPath(import.meta.url), '..', '..');

const websiteHostname = (process.env.WEBSITE_HOSTNAME ?? '').trim();
const hosted = websiteHostname !== '';
const rawAllowedHosts = process.env.COB_ALLOWED_HOSTS ?? '';
const rawPort = process.env.PORT;

function parsePort(raw, fallback) {
  if (raw === undefined || raw === '') return fallback;
  if (!/^[1-9][0-9]{0,4}$/.test(raw) || Number(raw) > 65535) {
    failFast(`PORT must be a whole number from 1 to 65535 (got "${raw}")`);
  }
  return Number(raw);
}

// On App Service for Windows, iisnode passes a named pipe (\\.\pipe\<name>) in PORT; hosted mode listens on it
// (docs/DEPLOY-AZURE-WINDOWS.md). Local mode still takes only a port number.
const WINDOWS_PIPE =/^\\\\\.\\pipe\\[A-Za-z0-9{}._-]{1,200}$/;
const pipe = hosted && rawPort !== undefined && WINDOWS_PIPE.test(rawPort) ? rawPort : null;
const port = pipe === null ? parsePort(rawPort, hosted ? 8080 : 5173) : null;
const address = hosted ? '0.0.0.0' : '127.0.0.1';
const listenTarget = pipe ?? `${address}:${port}`;

const HOST_NAME = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*(:[1-9][0-9]{0,4})?$/;

function checkHostName(value) {
  const name = value.toLowerCase();
  const hostPort = name.includes(':') ? Number(name.slice(name.indexOf(':') + 1)) : 0;
  if (!HOST_NAME.test(name) || hostPort > 65535) {
    failFast(`invalid host name in WEBSITE_HOSTNAME or COB_ALLOWED_HOSTS: "${value}"`);
  }
  return name;
}

let okHosts;
if (hosted) {
  const extra = rawAllowedHosts
    .split(',')
    .map((h) => h.trim())
    .filter((h) => h !== '');
  okHosts = new Set([websiteHostname, ...extra].map(checkHostName));
} else {
  if (rawAllowedHosts.trim() !== '') failFast('COB_ALLOWED_HOSTS is only read on Azure App Service (WEBSITE_HOSTNAME is not set)');
  okHosts = new Set(['localhost', '127.0.0.1', `localhost:${port}`, `127.0.0.1:${port}`]);
}

// /version.json: the version from package.json, read once at start-up; null (-> 404) if it is missing or not a string.
function readVersionBody() {
  try {
    const { version } = JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf8'));
    return typeof version === 'string' ? JSON.stringify({ version }) : null;
  } catch {
    return null;
  }
}
const versionBody = readVersionBody();

const allowedDirs = [join(projectRoot, 'ui'), join(projectRoot, 'dist')];

function isAllowed(filePath) {
  return allowedDirs.some((dir) => filePath.startsWith(dir + sep));
}

// A symlink inside an allowed folder must not lead out of it: the real path has to stay inside the real
// path of an allowed folder.
const realDirs = (await Promise.all(allowedDirs.map((p) => realpath(p).catch(() => null)))).filter((p) => p !== null);

function isInsideReal(realPath) {
  return realDirs.some((dir) => realPath.startsWith(dir + sep));
}

const headers = {
  'Content-Security-Policy':
    "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; font-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy':
    'accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Cache-Control': 'no-store',
  ...(hosted ? { 'Strict-Transport-Security': 'max-age=31536000' } : {}),
};

const TEXT = 'text/plain; charset=utf-8';

const contentTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.txt': TEXT,
};

async function handleRequest(req, res, expectationFailed = false) {
  const head = req.method === 'HEAD';
  const send = (status, type, body, extra = {}) =>
    res.writeHead(status, { ...headers, ...extra, 'Content-Type': type }).end(head ? undefined : body);
  const notFound = () => send(404, TEXT, 'Not found');
  const badRequest = () => send(400, TEXT, 'Bad request', { Connection: 'close' });

  let hostLines = 0;
  for (let i = 0; i < req.rawHeaders.length; i += 2) {
    if (req.rawHeaders[i].toLowerCase() === 'host') hostLines += 1;
  }
  if (hostLines > 1 || (hostLines === 0 && req.httpVersion !== '1.0')) {
    badRequest();
    return;
  }
  if (expectationFailed) {
    send(417, TEXT, 'Expectation failed', { Connection: 'close' });
    return;
  }
  if (req.method !== 'GET' && !head) {
    send(405, TEXT, 'Method not allowed', { Allow: 'GET, HEAD' });
    return;
  }
  const target = req.url ?? '';
  if (!target.startsWith('/')) {
    badRequest();
    return;
  }
  const query = target.indexOf('?');
  const rawPath = query < 0 ? target : target.slice(0, query);
  if (rawPath === '/healthz') {
    send(200, TEXT, 'ok');
    return;
  }
  if (!okHosts.has(String(req.headers.host ?? '').toLowerCase())) {
    send(403, TEXT, 'Forbidden');
    return;
  }
  if (rawPath === '/version.json') {
    if (versionBody === null) notFound();
    else send(200, 'application/json; charset=utf-8', versionBody);
    return;
  }
  if (rawPath.includes('//') || (rawPath.endsWith('/') && rawPath !== '/') || /%2f|%5c/i.test(rawPath)) {
    notFound();
    return;
  }
  let urlPath;
  try {
    urlPath = decodeURIComponent(rawPath);
  } catch {
    notFound();
    return;
  }
  if (urlPath === '/') urlPath = '/ui/ca.html';

  const filePath = resolve(projectRoot, '.' + sep + urlPath);
  const type = Object.hasOwn(contentTypes, extname(filePath)) ? contentTypes[extname(filePath)] : null;
  if (!isAllowed(filePath) || type === null) {
    notFound();
    return;
  }

  try {
    const realPath = await realpath(filePath);
    if (!isInsideReal(realPath)) {
      notFound();
      return;
    }
    send(200, type, await readFile(realPath));
  } catch {
    notFound();
  }
}

// Requests Node cannot parse get Node's own status (431, 413, 408, else 400) with the security headers, then
// the connection closes as soon as the reply has been handed to the OS (SEC-5c). A reset connection, or one that has
// already sent bytes of a reply, is closed silently. A parse error on a connection whose reply has already been ended
// changes nothing.
const clientErrors = {
  HPE_HEADER_OVERFLOW: [431, 'Request header fields too large'],
  HPE_CHUNK_EXTENSIONS_OVERFLOW: [413, 'Content too large'],
  ERR_HTTP_REQUEST_TIMEOUT: [408, 'Request timeout'],
};

function onClientError(err, socket) {
  if (err.code === 'ECONNRESET') {
    socket.destroy();
    return;
  }
  if (socket.writableEnded) return;
  if (!socket.writable || socket.bytesWritten > 0) {
    socket.destroy();
    return;
  }
  const [status, body] = Object.hasOwn(clientErrors, err.code) ? clientErrors[err.code] : [400, 'Bad request'];
  const lines = [
    `HTTP/1.1 ${status} ${STATUS_CODES[status]}`,
    ...Object.entries(headers).map(([name, value]) => `${name}: ${value}`),
    `Content-Type: ${TEXT}`,
    `Content-Length: ${Buffer.byteLength(body)}`,
    'Connection: close',
  ];
  socket.end(lines.join('\r\n') + '\r\n\r\n' + body, () => socket.destroy());
}

const server = createServer(
  { requireHostHeader: false, keepAliveTimeout: 120_000, headersTimeout: 125_000, requestTimeout: 125_000 },
  handleRequest,
);

server.on('error', (err) => failFast(`cannot listen on ${listenTarget}: ${err.code}`));
server.on('clientError', onClientError);
server.on('checkExpectation', (req, res) => handleRequest(req, res, true));
server.on('checkContinue', handleRequest);

const onListening = () => {
  if (hosted) {
    console.log(`cob-calculator (Canada): hosted mode, listening on ${listenTarget}; allowed hosts: ${[...okHosts].join(', ')}`);
  } else {
    console.log(`cob-calculator test UI (Canada): http://localhost:${port} (listening on 127.0.0.1:${port} only)`);
  }
};
if (pipe === null) server.listen(port, address, onListening);
else server.listen(pipe, onListening);
