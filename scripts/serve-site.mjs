// Previews the public site (site/) on http://127.0.0.1:4790 (`npm run site`; SITE_PORT / HOST to override).
// A plain static server with no dependencies. Unknown paths answer with site/404.html and status 404, the
// way a static host with a 404 page does. It is for local preview only; the site itself is static files.

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';

export const SITE_ROOT = resolve(import.meta.dirname, '..', 'site');
const PORT = Number(process.env.SITE_PORT ?? 4790);
const HOST = process.env.HOST ?? '127.0.0.1';

export const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
};

/**
 * Maps a URL path to a file path inside `root`, or null when the path is malformed or leaves the root.
 * A path that ends in "/" (or is empty) maps to index.html in that folder.
 */
export function resolveSitePath(pathname, root = SITE_ROOT) {
  let rel;
  try {
    rel = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  if (rel.includes('\0')) return null;
  if (rel === '' || rel.endsWith('/')) rel += 'index.html';
  const file = normalize(join(root, rel));
  return file === root || file.startsWith(root + sep) ? file : null;
}

async function send(res, status, file) {
  const data = await readFile(file);
  res.writeHead(status, {
    'content-type': TYPES[extname(file)] ?? 'application/octet-stream',
    'cache-control': 'no-cache',
  });
  res.end(data);
}

export const server = createServer(async (req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { 'content-type': 'text/plain; charset=utf-8' });
    return res.end('Method not allowed');
  }
  let pathname;
  try {
    ({ pathname } = new URL(req.url, 'http://localhost'));
  } catch {
    res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' });
    return res.end('Bad request path');
  }
  try {
    let file = resolveSitePath(pathname);
    if (file && (await stat(file)).isDirectory()) file = join(file, 'index.html');
    if (!file) throw new Error('outside the site');
    await send(res, 200, file);
  } catch {
    try {
      await send(res, 404, join(SITE_ROOT, '404.html'));
    } catch {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('Not found');
    }
  }
});

if (process.argv[1] === import.meta.filename) {
  server.listen(PORT, HOST, () => console.log(`Recipe Bank site → http://${HOST}:${PORT}`));
}
