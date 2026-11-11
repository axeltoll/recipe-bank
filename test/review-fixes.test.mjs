// Regression tests for the findings of a review of the whole tree: request bodies split across chunks, a
// path that used to stop the server, Host checks on reads, web pages in the agent's queue helper, and household
// scaling for recipes that count items.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { request as httpRequest } from 'node:http';
import { connect } from 'node:net';
import { Readable } from 'node:stream';
import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { createApp, createHandler, hostRefusal } from '../server.mjs';
import { server as siteServer } from '../scripts/serve-site.mjs';
import { assertQueue, nextQueued } from '../scripts/queue.mjs';
import { servingCount, parseServes, factorFor } from '../lib/scale.mjs';
import { makeRecipe, tempBank, ROOT } from './helpers/bank.mjs';

let dir, server, port, handle, sitePort;

before(async () => {
  dir = await tempBank([makeRecipe('alpha', 1)]);
  const options = { dataDir: dir, oembed: null, resolve: async (video) => video, hosts: [] };
  handle = createHandler(options);
  server = createApp(options);
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  port = server.address().port;
  await new Promise((ok) => siteServer.listen(0, '127.0.0.1', ok));
  sitePort = siteServer.address().port;
});

after(async () => {
  for (const s of [server, siteServer]) {
    s.closeAllConnections?.();
    await new Promise((ok) => s.close(ok));
  }
  await rm(dir, { recursive: true, force: true });
});

/** Calls the handler directly with the body as exactly these chunks, so no socket can merge them into one. */
function callWithChunks({ method = 'POST', url, headers = {}, chunks }) {
  return new Promise((ok) => {
    const req = Object.assign(Readable.from(chunks), { method, url, headers, socket: {} });
    const res = {
      writeHead(status) { this.status = status; },
      setHeader() {},
      end(text) { ok({ status: this.status, text: String(text ?? '') }); },
    };
    handle(req, res);
  });
}

/** A raw request line sent as written, so no client normalises the target. */
function rawGet(target, toPort) {
  return new Promise((ok, fail) => {
    // write, not end: the server closes the connection after answering (Connection: close).
    const sock = connect(toPort, '127.0.0.1', () => sock.write(`GET ${target} HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n`));
    let text = '';
    sock.setEncoding('utf8');
    sock.setTimeout(5000, () => { sock.destroy(); fail(new Error(`no answer to GET ${target}`)); });
    sock.on('data', (c) => { text += c; });
    sock.on('end', () => ok(text));
    sock.on('error', fail);
  });
}

/** One request whose body is written in the given pieces (Buffers), so a character can straddle two chunks. */
function sendPieces({ method = 'POST', path, headers = {}, pieces }) {
  return new Promise((ok, fail) => {
    const req = httpRequest({ host: '127.0.0.1', port, method, path, headers }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { text += c; });
      res.on('end', () => ok({ status: res.statusCode, text }));
    });
    req.on('error', fail);
    (async () => {
      for (const piece of pieces) {
        req.write(piece);
        await new Promise((r) => setTimeout(r, 20)); // separate TCP writes, separate chunks on the server
      }
      req.end();
    })();
  });
}

test('a multi-byte character split across two chunks is saved intact', async () => {
  const recipe = makeRecipe('split-half', 2);
  recipe.components[0].ingredients[0] = { item: 'Flour', key: 'flour', amount: '1½ cups', basis: 'spoken' };
  const body = Buffer.from(JSON.stringify(recipe));
  const at = body.indexOf(Buffer.from('½')) + 1; // between the two bytes of ½ (C2 BD)
  assert.ok(at > 0);
  const res = await callWithChunks({
    url: '/api/recipes',
    headers: { 'content-type': 'application/json' },
    chunks: [body.subarray(0, at), body.subarray(at)],
  });
  assert.equal(res.status, 201, res.text);
  const saved = JSON.parse(await readFile(join(dir, 'recipes', 'split-half.json'), 'utf8'));
  assert.equal(saved.components[0].ingredients[0].amount, '1½ cups');
});

test('GET // answers 400 and the server keeps serving', async () => {
  const raw = await rawGet('//', port);
  assert.match(raw, /^HTTP\/1\.1 400 /);
  assert.match(raw, /Bad request path/);
  const after = await sendPieces({ method: 'GET', path: '/api/recipes', pieces: [] });
  assert.equal(after.status, 200);
});

test('the site preview answers GET // with 400 and keeps serving', async () => {
  const raw = await rawGet('//', sitePort);
  assert.match(raw, /^HTTP\/1\.1 400 /);
  assert.match(raw, /Bad request path/);
  assert.match(await rawGet('/', sitePort), /^HTTP\/1\.1 200 /);
});

test('reads are refused for an unknown Host (DNS rebinding), allowed for loopback', async () => {
  assert.equal(hostRefusal({ host: 'evil.example:4780' })?.status, 403);
  assert.equal(hostRefusal({ host: '127.0.0.1:4780' }), null);
  assert.equal(hostRefusal({}), null, 'tools that send no Host');
  const foreign = await sendPieces({ method: 'GET', path: '/api/recipes', headers: { host: `evil.example:${port}` }, pieces: [] });
  assert.equal(foreign.status, 403);
  const queue = await sendPieces({ method: 'GET', path: '/api/queue', headers: { host: `rebind.example:${port}` }, pieces: [] });
  assert.equal(queue.status, 403);
  const own = await sendPieces({ method: 'GET', path: '/api/recipes', headers: { host: `127.0.0.1:${port}` }, pieces: [] });
  assert.equal(own.status, 200);
});

test('the queue helper accepts an entry the dashboard marked as a web page', () => {
  const web = { id: 'w1', status: 'queued', addedAt: '2026-11-11', video: { platform: 'web', id: null, url: 'https://example.com/recipes/stew' } };
  const yt = { id: 'y1', status: 'queued', addedAt: '2026-11-12', video: { platform: 'youtube', id: 'mhNQ8y5ud0A', url: 'https://youtu.be/mhNQ8y5ud0A' } };
  assert.doesNotThrow(() => assertQueue([web, yt]));
  assert.equal(nextQueued([web, yt]).id, 'w1');
  // A plain page that does not say it is a web page is still not a video link.
  assert.throws(() => assertQueue([{ ...web, video: { ...web.video, platform: 'youtube' } }]));
});

test('servingCount: servings scale to a household, counted items do not', async () => {
  assert.equal(servingCount('4'), 4);
  assert.equal(servingCount('4 servings'), 4);
  assert.equal(servingCount('10 bowls'), 10);
  for (const items of ['about 12 nuggets', '9 rolls', '12 subs', '2 burritos', '7 burritos', '2 wraps (the description lists 2 flatbreads)']) {
    assert.ok(parseServes(items), `${items} still parses as a count for the scale control`);
    assert.equal(servingCount(items), null, items);
  }
  assert.equal(servingCount(null), null);
  assert.equal(servingCount('2 thighs per person'), null);
  const feature = await readFile(join(ROOT, 'public', 'features', 'scale-feature.js'), 'utf8');
  assert.match(feature, /servingCount\(recipe\.serves\) != null/, 'the household button is only offered for servings');
});

test('factorFor scales servings to a household, never a count of items', () => {
  assert.equal(factorFor({ serves: '4' }, 6), 1.5);
  assert.equal(factorFor({ serves: '4 servings' }, 2), 0.5);
  for (const serves of ['9 rolls', '12 subs', 'about 12 nuggets', '2 thighs per person', null]) {
    assert.equal(factorFor({ serves }, 4), null, String(serves));
  }
});
