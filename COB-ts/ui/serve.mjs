// Zero-dependency static file server for the test UI. Serves only /ui, /dist and
// /package.json from the project root so the page (ui/ca.html, the default) can import the built
// engine from ../dist/*.js via an ES module import — a plain file:// page can't do
// that, it needs to come over http.
import { createServer } from 'node:http';
import { readFile, realpath } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = join(fileURLToPath(import.meta.url), '..', '..');
const port = Number(process.env.PORT) || 5173;

const allowedDirs = [join(projectRoot, 'ui'), join(projectRoot, 'dist')];
const allowedFiles = [join(projectRoot, 'package.json')];

function isAllowed(filePath) {
  return (
    allowedFiles.includes(filePath) ||
    allowedDirs.some((dir) => filePath.startsWith(dir + sep))
  );
}

// A symlink inside an allowed folder must not lead out of it: the real path has to stay inside the real
// path of an allowed folder (or be an allowed file).
const realRoots = async (paths) =>
  (await Promise.all(paths.map((p) => realpath(p).catch(() => null)))).filter((p) => p !== null);
const realDirs = await realRoots(allowedDirs);
const realFiles = await realRoots(allowedFiles);

function isInsideReal(realPath) {
  return realFiles.includes(realPath) || realDirs.some((dir) => realPath.startsWith(dir + sep));
}

const headers = { 'X-Content-Type-Options': 'nosniff' };

const contentTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
};

const okHosts = new Set(['localhost', '127.0.0.1', `localhost:${port}`, `127.0.0.1:${port}`]);

const server = createServer(async (req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { ...headers, Allow: 'GET, HEAD' }).end('Method not allowed');
    return;
  }
  if (!okHosts.has(String(req.headers.host ?? '').toLowerCase())) {
    res.writeHead(403, headers).end('Forbidden');
    return;
  }
  const head = req.method === 'HEAD';
  const notFound = (r) => r.writeHead(404, headers).end(head ? undefined : 'Not found');
  let urlPath;
  try {
    urlPath = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname);
  } catch {
    notFound(res);
    return;
  }
  if (urlPath === '/') urlPath = '/ui/ca.html';

  const filePath = resolve(projectRoot, '.' + sep + urlPath);
  if (!isAllowed(filePath)) {
    notFound(res);
    return;
  }

  try {
    const realPath = await realpath(filePath);
    if (!isInsideReal(realPath)) {
      notFound(res);
      return;
    }
    const body = await readFile(realPath);
    const type = contentTypes[extname(filePath)] ?? 'application/octet-stream';
    res.writeHead(200, { ...headers, 'Content-Type': type }).end(head ? undefined : body);
  } catch {
    notFound(res);
  }
});

server.listen(port, '127.0.0.1', () => {
  console.log(`cob-calculator test UI (Canada): http://localhost:${port} (listening on 127.0.0.1:${port} only)`);
});
