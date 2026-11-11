// The service worker is a classic script, so it is loaded here in a vm sandbox with a fake `self`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { access, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const ORIGIN = 'https://bank.example';
const source = await readFile(join(ROOT, 'public', 'sw.js'), 'utf8');

function loadWorker(globals = {}) {
  const listeners = {};
  const self = {
    location: { origin: ORIGIN },
    addEventListener: (type, fn) => { listeners[type] = fn; },
    skipWaiting: async () => {},
    clients: { claim: async () => {} },
  };
  vm.runInNewContext(source, { self, URL, Response, ...globals });
  return { api: self.RB_SW, listeners };
}

/** Run the worker's fetch handler for one request; resolves to what it responded with, or undefined. */
function dispatchFetch(listeners, method, path) {
  const event = {
    request: { method, url: path.startsWith('http') ? path : ORIGIN + path },
    responded: undefined,
    waiting: [],
    respondWith(p) { this.responded = p; },
    waitUntil(p) { this.waiting.push(p); },
  };
  listeners.fetch(event);
  return event;
}

const exists = (path) => access(path).then(() => true, () => false);
const fileFor = (urlPath) => {
  if (urlPath === '/') return join(ROOT, 'public', 'index.html');
  if (urlPath.startsWith('/lib/')) return join(ROOT, urlPath);
  return join(ROOT, 'public', urlPath);
};

test('the worker registers install, activate and fetch handlers', () => {
  const { listeners, api } = loadWorker();
  assert.deepEqual(Object.keys(listeners).sort(), ['activate', 'fetch', 'install']);
  assert.match(api.VERSION, /^v\d+$/);
});

test('policy: the shell is cached, recipes and the queue are network-first, everything else is left alone', () => {
  const { api } = loadWorker();
  const p = (method, url) => api.policy(method, url.startsWith('http') ? url : ORIGIN + url, ORIGIN);
  assert.equal(p('GET', '/api/recipes'), 'recipes');
  assert.equal(p('GET', '/api/recipes.json'), 'recipes');
  assert.equal(p('GET', '/api/queue'), 'queue');
  assert.equal(p('GET', '/api/queue.json?x=1'), 'queue');
  assert.equal(p('GET', '/api/queue/abc'), 'network');
  assert.equal(p('GET', '/'), 'shell');
  assert.equal(p('GET', '/styles.css'), 'shell');
  assert.equal(p('GET', '/lib/video.mjs'), 'shell');
  assert.equal(p('GET', '/app.js?v=2'), 'shell', 'the query string does not matter');
  // Same-origin paths outside SHELL are not cache first: only the precached shell is.
  assert.equal(p('GET', '/not-in-the-shell.js'), 'network');
  assert.equal(p('GET', '/features/unknown-feature.js'), 'network');
  assert.equal(p('GET', '/recipes/gochujang-chicken-thighs.json'), 'network');
  assert.equal(p('GET', '/api/whatever'), 'network');
  assert.equal(p('POST', '/api/queue'), 'network');
  assert.equal(p('DELETE', '/api/queue/abc'), 'network');
  assert.equal(p('GET', 'https://i.ytimg.com/vi/mhNQ8y5ud0A/hqdefault.jpg'), 'network');
  assert.equal(p('GET', 'https://www.youtube-nocookie.com/embed/mhNQ8y5ud0A'), 'network');
  assert.equal(api.policy('GET', 'not a url', ORIGIN), 'network');
});

test('every precached shell file exists, so install cannot fail on a 404', async () => {
  const { api } = loadWorker();
  const shell = [...api.SHELL];
  assert.ok(shell.includes('/'));
  assert.equal(new Set(shell).size, shell.length, 'no duplicates');
  for (const path of shell) assert.ok(await exists(fileFor(path)), `${path} is missing`);
});

test('every module the dashboard imports statically is precached', async () => {
  const { api } = loadWorker();
  const shell = new Set(api.SHELL);
  const seen = new Set();
  const todo = ['/app.js'];
  while (todo.length) {
    const urlPath = todo.pop();
    if (seen.has(urlPath)) continue;
    seen.add(urlPath);
    assert.ok(shell.has(urlPath), `${urlPath} is imported but not in SHELL`);
    const text = (await readFile(fileFor(urlPath), 'utf8')).replace(/^\s*\/\/.*$/gm, '');
    for (const m of text.matchAll(/\bfrom\s+['"]([^'"]+)['"]/g)) {
      const spec = m[1];
      todo.push(spec.startsWith('/') ? spec : join(dirname(urlPath), spec));
    }
  }
  assert.ok(seen.size > 10, 'the crawl found the ui and lib modules');
});

test('every feature module, everything it imports and every stylesheet it adds is precached', async () => {
  const { api } = loadWorker();
  const shell = new Set(api.SHELL);
  const index = await readFile(fileFor('/features/index.js'), 'utf8');
  const loaders = [...index.replace(/^\s*\/\/.*$/gm, '').matchAll(/\bimport\(\s*['"]([^'"]+)['"]\s*\)/g)]
    .map((m) => join('/features', m[1]));
  assert.ok(loaders.length >= 6, 'features/index.js lists the features');
  const seen = new Set();
  const todo = ['/features/index.js', ...loaders];
  while (todo.length) {
    const urlPath = todo.pop();
    if (seen.has(urlPath)) continue;
    seen.add(urlPath);
    assert.ok(shell.has(urlPath), `${urlPath} is loaded by a feature but not in SHELL`);
    if (urlPath.endsWith('.css')) continue;
    // Strip block and line comments: examples in comments are not imports.
    const text = (await readFile(fileFor(urlPath), 'utf8')).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    for (const m of text.matchAll(/\bfrom\s+['"]([^'"]+)['"]/g)) {
      todo.push(m[1].startsWith('/') ? m[1] : join(dirname(urlPath), m[1]));
    }
    for (const m of text.matchAll(/new URL\(\s*['"](\.\/[^'"]+\.css)['"]\s*,\s*import\.meta\.url\s*\)/g)) {
      todo.push(join(dirname(urlPath), m[1]));
    }
  }
  assert.ok([...seen].some((p) => p.endsWith('.css')), 'the crawl found the feature stylesheets');
});

test('writes and other origins never go through the worker', () => {
  const { listeners } = loadWorker();
  assert.equal(dispatchFetch(listeners, 'POST', '/api/queue').responded, undefined);
  assert.equal(dispatchFetch(listeners, 'DELETE', '/api/queue/abc').responded, undefined);
  assert.equal(dispatchFetch(listeners, 'GET', 'https://i.ytimg.com/vi/x/hqdefault.jpg').responded, undefined);
});

test('cache first: a cached file is served at once and refreshed in the background', async () => {
  const puts = [];
  const fresh = { ok: true, clone() { return 'FRESH-COPY'; } };
  const { listeners } = loadWorker({
    fetch: async () => fresh,
    caches: { open: async (name) => ({ match: async () => 'CACHED', put: async (req, res) => { puts.push([name, res]); } }) },
  });
  const event = dispatchFetch(listeners, 'GET', '/styles.css');
  assert.equal(await event.responded, 'CACHED');
  assert.equal(event.waiting.length, 1);
  await event.waiting[0];
  assert.equal(puts.length, 1);
  assert.match(puts[0][0], /^recipe-bank-shell-/);
  assert.equal(puts[0][1], 'FRESH-COPY');
});

test('network first: the recipes answer is returned and stored in the data cache', async () => {
  const puts = [];
  const fresh = { ok: true, clone() { return 'FRESH-COPY'; } };
  const { listeners } = loadWorker({
    fetch: async () => fresh,
    caches: { open: async (name) => ({ match: async () => undefined, put: async (req, res) => { puts.push([name, res]); } }) },
  });
  const event = dispatchFetch(listeners, 'GET', '/api/recipes');
  assert.equal(await event.responded, fresh);
  assert.equal(puts.length, 1);
  assert.match(puts[0][0], /^recipe-bank-data-/);
});

test('cache first: a failed refresh does not break a cached answer, and an error response is not stored', async () => {
  const puts = [];
  const cache = { match: async () => 'CACHED', put: async (...args) => { puts.push(args); } };
  const offline = loadWorker({ fetch: async () => { throw new Error('offline'); }, caches: { open: async () => cache } });
  const a = dispatchFetch(offline.listeners, 'GET', '/app.js');
  assert.equal(await a.responded, 'CACHED');
  await assert.doesNotReject(a.waiting[0]);

  const failing = loadWorker({ fetch: async () => ({ ok: false, clone() { return this; } }), caches: { open: async () => cache } });
  const b = dispatchFetch(failing.listeners, 'GET', '/app.js');
  assert.equal(await b.responded, 'CACHED');
  await b.waiting[0];
  assert.equal(puts.length, 0);
});

test('the queue is network first, and offline with nothing cached it is an empty queue rather than an error', async () => {
  const online = loadWorker({
    fetch: async () => ({ ok: true, clone() { return this; }, tag: 'LIVE' }),
    caches: { open: async () => ({ match: async () => 'STALE', put: async () => {} }) },
  });
  assert.equal((await dispatchFetch(online.listeners, 'GET', '/api/queue').responded).tag, 'LIVE');

  const stale = loadWorker({
    fetch: async () => { throw new Error('offline'); },
    caches: { open: async () => ({ match: async () => 'STALE', put: async () => {} }) },
  });
  assert.equal(await dispatchFetch(stale.listeners, 'GET', '/api/queue').responded, 'STALE');

  const empty = loadWorker({
    fetch: async () => { throw new Error('offline'); },
    caches: { open: async () => ({ match: async () => undefined, put: async () => {} }) },
  });
  const res = await dispatchFetch(empty.listeners, 'GET', '/api/queue.json').responded;
  assert.deepEqual(await res.json(), { queue: [] });
});

test('the manifest is valid and its icons exist', async () => {
  const manifest = JSON.parse(await readFile(join(ROOT, 'public', 'manifest.json'), 'utf8'));
  assert.equal(manifest.start_url, '/');
  assert.equal(manifest.display, 'standalone');
  assert.ok(manifest.icons.length > 0);
  for (const icon of manifest.icons) assert.ok(await exists(fileFor(icon.src)), icon.src);
});

test('recipes are network first: a save or an import shows at once, offline falls back to the cache or an empty list', async () => {
  const online = loadWorker({
    fetch: async () => ({ ok: true, clone() { return this; }, tag: 'LIVE' }),
    caches: { open: async () => ({ match: async () => 'STALE', put: async () => {} }) },
  });
  assert.equal((await dispatchFetch(online.listeners, 'GET', '/api/recipes').responded).tag, 'LIVE');

  const stale = loadWorker({
    fetch: async () => { throw new Error('offline'); },
    caches: { open: async () => ({ match: async () => 'STALE', put: async () => {} }) },
  });
  assert.equal(await dispatchFetch(stale.listeners, 'GET', '/api/recipes.json').responded, 'STALE');

  const empty = loadWorker({
    fetch: async () => { throw new Error('offline'); },
    caches: { open: async () => ({ match: async () => undefined, put: async () => {} }) },
  });
  const res = await dispatchFetch(empty.listeners, 'GET', '/api/recipes').responded;
  assert.deepEqual(await res.json(), { recipes: [], invalid: [] });
});

test('network first: a cache that refuses to store the answer does not hide it', async () => {
  for (const path of ['/api/recipes', '/api/queue']) {
    const { listeners } = loadWorker({
      fetch: async () => ({ ok: true, clone() { return this; }, tag: 'LIVE' }),
      caches: { open: async () => ({ match: async () => 'STALE', put: async () => { throw new Error('QuotaExceededError'); } }) },
    });
    assert.equal((await dispatchFetch(listeners, 'GET', path).responded).tag, 'LIVE', path);
  }
});
