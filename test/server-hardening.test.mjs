// Request handling that must hold for every client: a body whose multi-byte characters straddle two chunks, a
// request target that URL parsing rejects, and the Host check on reads (DNS rebinding). Handler-level calls feed
// exact chunks; socket calls show the real server keeps running.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { request as httpRequest } from 'node:http';
import { connect } from 'node:net';
import { Readable } from 'node:stream';
import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { createApp, createHandler, hostRefusal } from '../server.mjs';
import { makeRecipe, tempBank } from './helpers/bank.mjs';

const JSON_TYPE = { 'content-type': 'application/json' };

let dir, server, port, handle;

before(async () => {
  dir = await tempBank([makeRecipe('alpha', 1)]);
  const options = { dataDir: dir, oembed: null, resolve: async (video) => video, hosts: [] };
  handle = createHandler(options);
  server = createApp(options);
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  port = server.address().port;
});

after(async () => {
  server.closeAllConnections?.();
  await new Promise((ok) => server.close(ok));
  await rm(dir, { recursive: true, force: true });
});

/** Calls the handler directly with the body as exactly these chunks (Buffers), so no socket can merge them. */
function call({ method = 'POST', url, headers = {}, chunks = [], remoteAddress }) {
  return new Promise((ok) => {
    const req = Object.assign(Readable.from(chunks), { method, url, headers, socket: { remoteAddress } });
    const res = {
      writeHead(status) { this.status = status; },
      setHeader() {},
      end(text) { ok({ status: this.status, json: text ? JSON.parse(text) : null }); },
    };
    handle(req, res);
  });
}

/** A raw HTTP/1.1 request line, sent as written (no client normalises the target). */
function raw(target, host = '127.0.0.1') {
  return new Promise((ok, fail) => {
    const sock = connect(port, '127.0.0.1', () => sock.end(`GET ${target} HTTP/1.1\r\nHost: ${host}\r\nConnection: close\r\n\r\n`));
    let text = '';
    sock.setEncoding('utf8');
    sock.on('data', (c) => { text += c; });
    sock.on('end', () => ok(text));
    sock.on('error', fail);
  });
}

function get(path, headers = {}) {
  return new Promise((ok, fail) => {
    const req = httpRequest({ host: '127.0.0.1', port, method: 'GET', path, headers }, (res) => {
      res.resume();
      res.on('end', () => ok(res.statusCode));
    });
    req.on('error', fail);
    req.end();
  });
}

test('a multi-byte character split across two chunks is saved intact', async () => {
  const recipe = makeRecipe('split-half', 2);
  recipe.components[0].ingredients[0] = { item: 'Flour', key: 'flour', amount: '1½ cups', basis: 'spoken' };
  const body = Buffer.from(JSON.stringify(recipe));
  const at = body.indexOf(Buffer.from('½')) + 1; // between the two bytes of ½ (C2 BD)
  assert.ok(at > 0);
  const res = await call({ url: '/api/recipes', headers: JSON_TYPE, chunks: [body.subarray(0, at), body.subarray(at)] });
  assert.equal(res.status, 201, JSON.stringify(res.json));
  const saved = JSON.parse(await readFile(join(dir, 'recipes', 'split-half.json'), 'utf8'));
  assert.equal(saved.components[0].ingredients[0].amount, '1½ cups');
});

test('the body limit counts bytes, not characters', async () => {
  // 4,000 three-byte characters: 4,000 UTF-16 units, about 12,000 bytes, over the 10,000-byte queue limit.
  const body = Buffer.from(JSON.stringify({ url: 'https://youtu.be/BBBBBBBBBBB', note: '盐'.repeat(4000) }));
  const res = await call({ url: '/api/queue', headers: JSON_TYPE, chunks: [body] });
  assert.equal(res.status, 413);
});

test('GET // answers 400, and the server keeps serving', async () => {
  const direct = await call({ method: 'GET', url: '//' });
  assert.equal(direct.status, 400);
  assert.equal(direct.json.error, 'Bad request path');

  const answer = await raw('//');
  assert.match(answer, /^HTTP\/1\.1 400 /);
  assert.match(answer, /Bad request path/);
  assert.equal(await get('/api/recipes'), 200, 'still running');
});

test('hostRefusal: loopback or a listed name, and a loopback name only from this machine', () => {
  assert.equal(hostRefusal({ host: '127.0.0.1:4780' }), null);
  assert.equal(hostRefusal({ host: 'localhost:4780' }, { peer: '::1' }), null);
  assert.equal(hostRefusal({}), null, 'tools that send no Host');
  assert.equal(hostRefusal({ host: 'kitchen.lan:4780' }, { hosts: ['kitchen.lan'], peer: '192.168.1.30' }), null);
  assert.equal(hostRefusal({ host: 'evil.example:4780' })?.status, 403);
  assert.equal(hostRefusal({ host: '127.0.0.1.evil.example' })?.status, 403);
  assert.equal(hostRefusal({ host: '127.0.0.1:4780' }, { peer: '192.168.1.30' })?.status, 403);
  assert.equal(hostRefusal({}, { peer: '192.168.1.30' })?.status, 403);
});

test('reads are refused for an unknown Host (DNS rebinding), allowed for loopback', async () => {
  for (const path of ['/api/recipes', '/api/queue']) {
    assert.equal(await get(path, { host: `evil.example:${port}` }), 403, path);
    assert.equal(await get(path, { host: `127.0.0.1:${port}` }), 200, path);
    assert.equal(await get(path, { host: `localhost:${port}` }), 200, path);
  }
  const remote = await call({ method: 'GET', url: '/api/recipes', headers: { host: '127.0.0.1:4780' }, remoteAddress: '192.168.1.30' });
  assert.equal(remote.status, 403, 'another machine cannot read by sending Host: 127.0.0.1');
  // The dashboard page is served as before.
  assert.equal(await get('/', { host: `127.0.0.1:${port}` }), 200);
});

test('a null component, ingredient or step is a 400 with problems, not a server error', async () => {
  const shapes = [
    (r) => { r.components = [null]; },
    (r) => { r.components[0].ingredients = [null]; },
    (r) => { r.components[0].steps = [null]; },
  ];
  for (const [n, shape] of shapes.entries()) {
    const recipe = makeRecipe(`broken-${n}`, 10 + n);
    shape(recipe);
    const body = Buffer.from(JSON.stringify(recipe));
    const created = await call({ url: '/api/recipes', headers: JSON_TYPE, chunks: [body] });
    assert.equal(created.status, 400, `POST, shape ${n}`);
    assert.match(created.json.problems.join('\n'), /not an object/);
    const replaced = await call({ method: 'PUT', url: '/api/recipes/alpha', headers: JSON_TYPE, chunks: [Buffer.from(JSON.stringify({ ...recipe, id: 'alpha' }))] });
    assert.equal(replaced.status, 400, `PUT, shape ${n}`);
  }
  assert.equal(JSON.parse(await readFile(join(dir, 'recipes', 'alpha.json'), 'utf8')).title, 'Recipe alpha', 'unchanged');
});
