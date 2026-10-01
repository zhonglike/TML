/**
 * MONO — 本地静态服务器（零依赖）
 *   node scripts/serve.mjs [port]
 * 只用于本地预览与套壳调试；GitHub Pages 上是纯静态托管，不需要它。
 */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.argv[2] || process.env.PORT || 4173);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2',
};

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    let path = decodeURIComponent(url.pathname);
    if (path.endsWith('/')) path += 'index.html';
    const target = join(ROOT, normalize(path).replace(/^(\.\.[/\\])+/, ''));
    if (!target.startsWith(ROOT)) {
      res.writeHead(403).end('forbidden');
      return;
    }
    const st = await stat(target).catch(() => null);
    const file = st && st.isDirectory() ? join(target, 'index.html') : target;
    const data = await readFile(file);
    res.writeHead(200, {
      'content-type': MIME[extname(file)] || 'application/octet-stream',
      'cache-control': 'no-cache',
      'service-worker-allowed': '/',
    });
    res.end(data);
  } catch (e) {
    if (req.url === '/favicon.ico') {
      res.writeHead(204).end();
      return;
    }
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('404 not found');
  }
});

server.listen(PORT, () => {
  console.log(`MONO dev server → http://127.0.0.1:${PORT}/`);
  console.log(`root: ${ROOT}`);
});
