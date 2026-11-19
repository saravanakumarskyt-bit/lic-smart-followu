// Tiny static server for local use and tests. PORT (default 8080). BASE=/some-prefix/ mimics GitHub Pages sub-path hosting.
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml', '.wasm': 'application/wasm', '.pfb': 'application/octet-stream', '.ttf': 'font/ttf', '.bcmap': 'application/octet-stream', '.gz': 'application/gzip' };

export function startServer(port = Number(process.env.PORT) || 8080, baseArg = process.env.BASE || '/') {
  const base = baseArg.replace(/\/?$/, '/');
  const server = http.createServer(async (req, res) => {
    try {
      let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      if (!p.startsWith(base)) { res.writeHead(404); res.end('Not found'); return; }
      p = p.slice(base.length);
      if (p === '' || p.endsWith('/')) p += 'index.html';
      const file = path.join(root, p);
      if (!file.startsWith(root)) { res.writeHead(403); res.end(); return; }
      const st = await stat(file);
      if (!st.isFile()) throw new Error('not file');
      res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
      res.end(await readFile(file));
    } catch { res.writeHead(404); res.end('Not found'); }
  });
  return new Promise((resolve) => server.listen(port, () => resolve(server)));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const s = await startServer();
  console.log(`LIC Smart Follow-up running at http://localhost:${s.address().port}${(process.env.BASE || '/').replace(/\/?$/, '/')}`);
}
