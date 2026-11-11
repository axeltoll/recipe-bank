// Another website open in the same browser must not be able to change the bank through the local server.
// writeRefusal() is checked on its own, then through a real socket with node:http, which (unlike fetch)
// sends exactly the headers given, Host included.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { request as httpRequest } from 'node:http';
import { readFile, readdir, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createApp, writeRefusal, allowedHosts, defaultDataDir } from '../server.mjs';
import { exportPack } from '../lib/pack.mjs';
import { makeRecipe, tempBank, ROOT } from './helpers/bank.mjs';

const JSON_TYPE = { 'content-type': 'application/json' };

test('writeRefusal: JSON from the same origin, or from a tool without browser headers, may write', () => {
  assert.equal(writeRefusal({ ...JSON_TYPE }), null, 'curl, scripts and handler-level tests');
  assert.equal(writeRefusal({ 'content-type': 'application/json; charset=utf-8' }), null);
  assert.equal(writeRefusal({ 'content-type': 'Application/JSON' }), null);
  const dashboard = { ...JSON_TYPE, host: '127.0.0.1:4780', origin: 'http://127.0.0.1:4780', 'sec-fetch-site': 'same-origin' };
  assert.equal(writeRefusal(dashboard), null);
  assert.equal(writeRefusal({ ...JSON_TYPE, host: 'localhost:4780', origin: 'http://localhost:4780' }), null);
  assert.equal(writeRefusal({ ...JSON_TYPE, host: '[::1]:4780', origin: 'http://[::1]:4780' }), null);
  assert.equal(writeRefusal({ ...JSON_TYPE, host: 'LOCALHOST:4780' }), null, 'host names are case-insensitive');
  assert.equal(writeRefusal({ ...JSON_TYPE, 'sec-fetch-site': 'none' }), null, 'typed by the user, not sent by a page');
});

test('writeRefusal: anything but JSON is 415', () => {
  for (const type of [undefined, '', 'text/plain', 'text/plain;charset=UTF-8', 'application/x-www-form-urlencoded',
    'multipart/form-data; boundary=x', 'application/jsonp', 'application/json-seq', 'text/json']) {
    const refused = writeRefusal(type === undefined ? {} : { 'content-type': type });
    assert.equal(refused?.status, 415, String(type));
    assert.match(refused.error, /application\/json/);
  }
});

test('writeRefusal: another origin, a cross-site fetch or an unknown host is 403', () => {
  const cases = [
    { 'sec-fetch-site': 'cross-site' },
    { 'sec-fetch-site': 'same-site' },
    { host: '127.0.0.1:4780', origin: 'https://evil.example' },
    { host: '127.0.0.1:4780', origin: 'http://127.0.0.1:9999' },
    { host: '127.0.0.1:4780', origin: 'https://127.0.0.1:4780' },
    { host: '127.0.0.1:4780', origin: 'null' },
    { host: '127.0.0.1:4780', origin: 'not a url' },
    { origin: 'http://127.0.0.1:4780' },
    // DNS rebinding: the page's own origin, but a host name that only pretends to be this machine.
    { host: 'evil.example:4780', origin: 'http://evil.example:4780' },
    { host: 'evil.example:4780' },
    { host: '127.0.0.1.evil.example' },
    { host: 'localhost@evil.example' },
    { host: '' },
  ];
  for (const headers of cases) {
    // A JSON type does not help: the origin check comes first.
    const refused = writeRefusal({ ...JSON_TYPE, ...headers });
    assert.equal(refused?.status, 403, JSON.stringify(headers));
  }
});

test('writeRefusal and allowedHosts: extra host names come from RECIPE_BANK_HOSTS and HOST', () => {
  assert.deepEqual(allowedHosts({}), []);
  assert.deepEqual(allowedHosts({ HOST: '127.0.0.1' }), ['127.0.0.1']);
  assert.deepEqual(allowedHosts({ HOST: '0.0.0.0' }), [], 'a wildcard bind names no host');
  assert.deepEqual(allowedHosts({ RECIPE_BANK_HOSTS: ' Kitchen.lan , 192.168.1.20 ', HOST: '::1' }), ['kitchen.lan', '192.168.1.20', '[::1]']);
  const hosts = allowedHosts({ RECIPE_BANK_HOSTS: 'kitchen.lan' });
  assert.equal(writeRefusal({ ...JSON_TYPE, host: 'kitchen.lan:4780', origin: 'http://kitchen.lan:4780' }, { hosts }), null);
  assert.equal(writeRefusal({ ...JSON_TYPE, host: 'pantry.lan:4780' }, { hosts })?.status, 403);
});

test('the server binds to 127.0.0.1 unless HOST says otherwise', async () => {
  const source = await readFile(join(ROOT, 'server.mjs'), 'utf8');
  assert.match(source, /const HOST = process\.env\.HOST \?\? '127\.0\.0\.1';/);
  assert.match(source, /server\.listen\(PORT, HOST,/);
});

test('RECIPE_BANK_DIR picks the data folder, without depending on import order', () => {
  assert.equal(defaultDataDir({}), resolve(ROOT));
  assert.equal(defaultDataDir({ RECIPE_BANK_DIR: 'some/where' }), resolve('some/where'));
});

// ---------- through a socket ----------

let dir, server, port;

before(async () => {
  dir = await tempBank([makeRecipe('alpha', 1)]);
  server = createApp({ dataDir: dir, oembed: null, resolve: async (video) => video, hosts: [] });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  port = server.address().port;
});

after(async () => {
  server.closeAllConnections?.();
  await new Promise((ok) => server.close(ok));
  await rm(dir, { recursive: true, force: true });
});

function send({ method = 'POST', path = '/api/queue', headers = {}, body }) {
  return new Promise((ok, fail) => {
    const req = httpRequest({ host: '127.0.0.1', port, method, path, headers }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { text += c; });
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(text); } catch { /* not JSON */ }
        ok({ status: res.statusCode, json });
      });
    });
    req.on('error', fail);
    req.end(body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body));
  });
}

const own = () => ({ origin: `http://127.0.0.1:${port}`, 'sec-fetch-site': 'same-origin', ...JSON_TYPE });
const queue = async () => JSON.parse(await readFile(join(dir, 'data', 'queue.json'), 'utf8').catch(() => '[]'));
const files = async () => (await readdir(join(dir, 'recipes'))).sort();

test('a foreign page cannot queue, write, import or delete', async () => {
  const video = { url: 'https://youtu.be/AAAAAAAAAAA' };
  const foreign = [
    // The "simple" requests a page can send without a preflight.
    [{ headers: { 'content-type': 'text/plain;charset=UTF-8', origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' } }, 403],
    [{ headers: { 'content-type': 'text/plain;charset=UTF-8' } }, 415],
    [{ headers: { 'content-type': 'application/x-www-form-urlencoded' } }, 415],
    [{ headers: {} }, 415],
    // With a JSON type (only possible after a preflight that is never granted), the origin still decides.
    [{ headers: { ...JSON_TYPE, origin: 'https://evil.example' } }, 403],
    [{ headers: { ...JSON_TYPE, 'sec-fetch-site': 'cross-site' } }, 403],
    [{ headers: { ...JSON_TYPE, origin: 'null' } }, 403],
    [{ headers: { ...JSON_TYPE, host: `rebound.example:${port}`, origin: `http://rebound.example:${port}` } }, 403],
  ];
  for (const [req, status] of foreign) {
    const res = await send({ ...req, body: video });
    assert.equal(res.status, status, JSON.stringify(req.headers));
    assert.ok(res.json?.error, 'a JSON error');
  }
  assert.deepEqual(await queue(), []);

  const recipe = makeRecipe('beta', 2);
  const cross = { ...JSON_TYPE, origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' };
  assert.equal((await send({ path: '/api/recipes', headers: cross, body: recipe })).status, 403);
  assert.equal((await send({ path: '/api/recipes', headers: { 'content-type': 'text/plain' }, body: recipe })).status, 415);
  assert.equal((await send({ method: 'PUT', path: '/api/recipes/alpha', headers: cross, body: makeRecipe('alpha', 1, { title: 'Evil' }) })).status, 403);
  const pack = { pack: exportPack([makeRecipe('gamma', 3)]) };
  assert.equal((await send({ path: '/api/packs/import', headers: cross, body: pack })).status, 403);
  assert.equal((await send({ path: '/api/packs/import', headers: { 'content-type': 'text/plain' }, body: pack })).status, 415);
  assert.deepEqual(await files(), ['alpha.json']);
  assert.equal(JSON.parse(await readFile(join(dir, 'recipes', 'alpha.json'), 'utf8')).title, 'Recipe alpha');
});

test("the dashboard's own requests still work: queue, delete, create, replace, import", async () => {
  const added = await send({ headers: own(), body: { url: 'https://youtu.be/AAAAAAAAAAA', note: 'hi' } });
  assert.equal(added.status, 201);
  const id = added.json.entry.id;
  assert.deepEqual((await queue()).map((q) => q.id), [id]);

  assert.equal((await send({ method: 'DELETE', path: `/api/queue/${id}`, headers: { origin: 'https://evil.example', ...JSON_TYPE } })).status, 403);
  assert.equal((await send({ method: 'DELETE', path: `/api/queue/${id}`, headers: {} })).status, 415);
  assert.equal((await queue()).length, 1, 'still queued');
  const removed = await send({ method: 'DELETE', path: `/api/queue/${id}`, headers: own() });
  assert.equal(removed.status, 200);
  assert.deepEqual(await queue(), []);

  assert.equal((await send({ path: '/api/recipes', headers: own(), body: makeRecipe('beta', 2) })).status, 201);
  assert.equal((await send({ method: 'PUT', path: '/api/recipes/beta', headers: own(), body: makeRecipe('beta', 2, { title: 'Better' }) })).status, 200);
  assert.equal((await send({ path: '/api/packs/import', headers: own(), body: { pack: exportPack([makeRecipe('gamma', 3)]) } })).status, 201);
  assert.deepEqual(await files(), ['alpha.json', 'beta.json', 'gamma.json']);

  // localhost is the same machine.
  const local = await send({ headers: { host: `localhost:${port}`, origin: `http://localhost:${port}`, ...JSON_TYPE }, body: { url: 'https://youtu.be/BBBBBBBBBBB' } });
  assert.equal(local.status, 201);
});

test('reads are not affected', async () => {
  const res = await send({ method: 'GET', path: '/api/recipes', headers: { origin: 'https://evil.example' } });
  assert.equal(res.status, 200, 'the answer is readable only if CORS allowed it, and it never does');
  assert.ok(Array.isArray(res.json.recipes));
});
