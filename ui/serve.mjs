// Zero-dependency static file server for the test UI. Serves the project root so the
// page (ui/index.html) can import the built engine from ../dist/*.js via a relative
// ES module import — a plain file:// page can't do that, it needs to come over http.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = join(fileURLToPath(import.meta.url), '..', '..');
const port = Number(process.env.PORT) || 5173;

const contentTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
};

const server = createServer(async (req, res) => {
  let urlPath = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname);
  if (urlPath === '/') urlPath = '/ui/index.html';

  const filePath = normalize(join(projectRoot, urlPath));
  if (!filePath.startsWith(projectRoot)) {
    res.writeHead(403).end('Forbidden');
    return;
  }

  try {
    const body = await readFile(filePath);
    const type = contentTypes[extname(filePath)] ?? 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type }).end(body);
  } catch {
    res.writeHead(404).end('Not found');
  }
});

server.listen(port, () => {
  console.log(`cob-calculator test UI: http://localhost:${port}`);
});
