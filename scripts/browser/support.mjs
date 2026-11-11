import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { spawn } from 'node:child_process';
import { server } from '../../server.mjs';
import { findChrome, launch } from './cdp.mjs';

export const ROOT = resolve(import.meta.dirname, '../..');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };

export async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => { server.off('error', reject); resolve(); });
  });
  return `http://127.0.0.1:${server.address().port}`;
}
export async function stop(server) {
  if (!server.listening) return;
  const closed = new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  server.closeAllConnections();
  await closed;
}
export function staticServer(root = resolve(ROOT, 'dist')) {
  return createServer(async (req, res) => {
    try {
      const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
      const file = resolve(root, `.${pathname === '/' ? '/index.html' : pathname}`);
      if (!file.startsWith(root + sep)) { res.writeHead(403).end(); return; }
      const data = await readFile(file);
      res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' }).end(data);
    } catch { res.writeHead(404).end(); }
  });
}
export async function build() {
  // Same entry point as npm run build, without a platform-dependent npm executable.
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['scripts/build-static.mjs'], { cwd: ROOT, stdio: 'inherit' });
    child.once('error', reject);
    child.once('exit', (code) => code === 0 ? resolve() : reject(new Error(`Static build exited ${code}`)));
  });
}
export function options(args = process.argv.slice(2)) {
  const result = { headed: false, only: null };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--headed') result.headed = true;
    else if (args[i] === '--only' && args[i + 1]) result.only = args[++i];
    else throw new Error(`Unknown or incomplete option: ${args[i]}`);
  }
  return result;
}
export function browserAvailable() {
  if (findChrome()) return true;
  const message = 'No Chrome or Chromium found. Install a system browser or set CHROME_PATH.';
  if (process.env.SMOKE_REQUIRED === '1') throw new Error(`${message} SMOKE_REQUIRED=1 makes this a failure.`);
  console.log(`SKIP: ${message}`);
  return false;
}
export function assertClean(page) {
  const errors = page.console.filter((entry) => entry.type === 'error').map((entry) => entry.text);
  if (errors.length || page.exceptions.length) throw new Error(JSON.stringify({ consoleErrors: errors, exceptions: page.exceptions }, null, 2));
}
export async function withBrowser(run, { headed = false } = {}) {
  let browser, staticSite;
  // Foreground signal handling ensures profiles and the child browser are cleaned up.
  let cleanupPromise;
  const cleanup = () => cleanupPromise ??= (async () => {
    try { await browser?.close(); }
    finally { await Promise.all([stop(server), staticSite ? stop(staticSite) : Promise.resolve()]); }
  })();
  const onSignal = () => { cleanup().finally(() => process.exit(130)); };
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);
  try {
    const live = await listen(server);
    const origins = [live];
    // launch handles signals until its browser handle becomes available.
    process.off('SIGINT', onSignal);
    process.off('SIGTERM', onSignal);
    browser = await launch({ headed });
    process.once('SIGINT', onSignal);
    process.once('SIGTERM', onSignal);
    if (!browser) throw new Error('Browser disappeared after discovery');
    await browser.page.localOnly(origins);
    const startStatic = async () => {
      if (staticSite) throw new Error('Static server already started');
      await build();
      staticSite = staticServer();
      const origin = await listen(staticSite);
      origins.push(origin);
      await browser.page.localOnly(origins);
      return origin;
    };
    await run(browser.page, origins, startStatic);
  } finally {
    await cleanup();
    process.off('SIGINT', onSignal);
    process.off('SIGTERM', onSignal);
  }
}
