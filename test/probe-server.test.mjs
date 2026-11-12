// Probes of the JSON API and static file serving with hostile and unusual requests: wrong content
// types, bad JSON, huge bodies, UTF-8 split across packets, concurrent writes, odd paths and odd data
// on disk. The server runs in-process on a random port; oEmbed and short-link lookups are stubbed, so
// nothing here reaches the network. Real bugs found here are marked `todo`.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server.mjs';
import { makeRecipe, tempBank, videoId } from './helpers/bank.mjs';

let dir;
let server;
let base;
let port;

before(async () => {
  dir = await tempBank([makeRecipe('probe-eggs', 1)]);
  await writeFile(join(dir, 'data', 'queue.json'), '[]\n');
  server = createApp({ dataDir: dir, oembed: null, resolve: async (v) => v });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  port = server.address().port;
  base = `http://127.0.0.1:${port}`;
});

after(async () => {
  server.closeAllConnections?.();
  await new Promise((ok) => server.close(ok));
  await rm(dir, { recursive: true, force: true });
});

const send = (method, path, body, headers = { 'content-type': 'application/json' }) =>
  fetch(base + path, { method, headers, body: typeof body === 'string' ? body : JSON.stringify(body) });

/** A raw request whose body is written as separate packets, with a pause between them. */
function rawRequest(method, path, parts, headers = {}) {
  return new Promise((ok, fail) => {
    const total = parts.reduce((n, p) => n + p.length, 0);
    const req = request({ host: '127.0.0.1', port, method, path, headers: { 'content-type': 'application/json', 'content-length': total, ...headers } }, (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { data += c; });
      res.on('end', () => ok({ status: res.statusCode, body: data ? JSON.parse(data) : null }));
    });
    req.on('error', fail);
    (async () => {
      for (const p of parts) {
        req.write(p);
        await new Promise((r) => setTimeout(r, 30));
      }
      req.end();
    })();
  });
}

// ---------- content types and bodies ----------

test('every write route with a body refuses non-JSON content types with 415, including look-alikes', async () => {
  // POST and PUT carry a body, so they need JSON. DELETE has no body and is not a simple
  // cross-site request, so its content type does not matter: it gets its normal answer.
  const routes = [['POST', '/api/recipes'], ['PUT', '/api/recipes/probe-eggs'], ['POST', '/api/queue'], ['POST', '/api/packs/import']];
  for (const type of ['text/plain', 'application/x-www-form-urlencoded', 'multipart/form-data; boundary=x', 'application/jsonp', 'application/json-patch+json', 'text/json']) {
    for (const [method, path] of routes) {
      const res = await send(method, path, '{}', { 'content-type': type });
      assert.equal(res.status, 415, `${method} ${path} as ${type}`);
    }
    const del = await send('DELETE', '/api/queue/x', undefined, { 'content-type': type });
    assert.equal(del.status, 404, `DELETE /api/queue/x as ${type} is judged on its id, not its content type`);
  }
  const none = await fetch(base + '/api/queue', { method: 'POST', body: '{}' });
  assert.ok([415].includes(none.status), 'a body without content type is refused');
});

test('JSON content type is accepted with parameters and in any letter case', async () => {
  for (const type of ['application/json; charset=utf-8', 'Application/JSON', 'application/json ;charset=UTF-8']) {
    const res = await send('POST', '/api/queue', { url: 'not a link' }, { 'content-type': type });
    assert.equal(res.status, 400, type);
  }
});

test('bad JSON, JSON that is not an object, and an empty body give 400, never 500', async () => {
  for (const body of ['{', '{"id":', 'null', '[]', '"text"', '42', 'true', '', '\u0000', '{"a":1}{"b":2}']) {
    for (const [method, path] of [['POST', '/api/recipes'], ['PUT', '/api/recipes/probe-eggs'], ['POST', '/api/queue'], ['POST', '/api/packs/import']]) {
      const res = await send(method, path, body);
      assert.equal(res.status, 400, `${method} ${path} with ${JSON.stringify(body)}`);
      const j = await res.json();
      assert.equal(typeof j.error, 'string');
    }
  }
});

test('oversized bodies get 413 and nothing is written', async () => {
  const before = await readdir(join(dir, 'recipes'));
  const big = JSON.stringify({ url: 'https://youtu.be/' + videoId(7), note: 'x'.repeat(20_000) });
  assert.equal((await send('POST', '/api/queue', big)).status, 413);
  const huge = JSON.stringify(makeRecipe('probe-huge', 8, { notes: ['x'.repeat(600_000)] }));
  assert.equal((await send('POST', '/api/recipes', huge)).status, 413);
  assert.deepEqual(await readdir(join(dir, 'recipes')), before);
});

test('a recipe whose UTF-8 characters are split across packets is stored intact',
  async () => {
    const r = makeRecipe('probe-utf8', 9, { title: 'Crème brûlée — 鶏の唐揚げ 🍗' });
    const bytes = Buffer.from(JSON.stringify(r));
    // Split in the middle of the "è" (two bytes) and of the emoji (four bytes).
    const at = bytes.indexOf(Buffer.from('è')) + 1;
    const emoji = bytes.indexOf(Buffer.from('🍗')) + 2;
    const res = await rawRequest('POST', '/api/recipes', [bytes.subarray(0, at), bytes.subarray(at, emoji), bytes.subarray(emoji)]);
    assert.equal(res.status, 201);
    const saved = JSON.parse(await readFile(join(dir, 'recipes', 'probe-utf8.json'), 'utf8'));
    assert.equal(saved.title, r.title);
  });

test('unicode in one packet round-trips through POST and GET', async () => {
  const r = makeRecipe('probe-unicode', 10, { title: 'Pad kra pao ผัดกะเพรา 🌶️', summary: 'Right-to-left: مرحبا. Zero width: a\u200bb.' });
  assert.equal((await send('POST', '/api/recipes', r)).status, 201);
  const { recipes } = await (await fetch(base + '/api/recipes')).json();
  assert.equal(recipes.find((x) => x.id === 'probe-unicode').title, r.title);
  const file = await readFile(join(dir, 'recipes', 'probe-unicode.json'), 'utf8');
  assert.ok(file.endsWith('}\n') && file.startsWith('{\n  "id"'), 'two-space JSON with a trailing newline');
});

// ---------- duplicates and concurrency ----------

test('ten concurrent POSTs of the same new recipe create it once; the others get 409', async () => {
  const r = makeRecipe('probe-race', 11);
  const res = await Promise.all(Array.from({ length: 10 }, () => send('POST', '/api/recipes', r)));
  const codes = res.map((x) => x.status).sort();
  assert.deepEqual(codes, [201, ...Array(9).fill(409)]);
});

test('concurrent POSTs of one video under different ids create one recipe', async () => {
  const res = await Promise.all(Array.from({ length: 6 }, (_, i) => send('POST', '/api/recipes', makeRecipe(`probe-same-video-${i}`, 12))));
  assert.equal(res.filter((x) => x.status === 201).length, 1);
  assert.equal(res.filter((x) => x.status === 409).length, 5);
});

test('twenty concurrent queue requests for different videos all land; repeats are 409', async () => {
  const urls = Array.from({ length: 20 }, (_, i) => `https://www.youtube.com/watch?v=${videoId(20 + i)}`);
  const res = await Promise.all([...urls, ...urls.slice(0, 5)].map((url) => send('POST', '/api/queue', { url })));
  assert.equal(res.filter((x) => x.status === 201).length, 20);
  assert.equal(res.filter((x) => x.status === 409).length, 5);
  const queue = JSON.parse(await readFile(join(dir, 'data', 'queue.json'), 'utf8'));
  assert.equal(new Set(queue.map((q) => q.video.id)).size, queue.length);
  assert.ok(queue.length >= 20);
});

test('concurrent deletes and adds on the queue never lose an unrelated entry', async () => {
  const queue = JSON.parse(await readFile(join(dir, 'data', 'queue.json'), 'utf8'));
  const victims = queue.slice(0, 5).map((q) => q.id);
  const keep = queue.slice(5).map((q) => q.id);
  const adds = Array.from({ length: 5 }, (_, i) => send('POST', '/api/queue', { url: `https://youtu.be/${videoId(60 + i)}` }));
  const dels = victims.map((id) => send('DELETE', `/api/queue/${id}`, '{}'));
  const res = await Promise.all([...adds, ...dels]);
  assert.ok(res.every((x) => x.status === 201 || x.status === 200));
  const after = JSON.parse(await readFile(join(dir, 'data', 'queue.json'), 'utf8')).map((q) => q.id);
  for (const id of keep) assert.ok(after.includes(id));
  for (const id of victims) assert.ok(!after.includes(id));
  assert.equal(after.length, keep.length + 5);
});

test('saving a recipe removes its queue entry, and a queued video already in the bank is refused', async () => {
  const url = `https://youtu.be/${videoId(70)}`;
  assert.equal((await send('POST', '/api/queue', { url })).status, 201);
  const res = await send('POST', '/api/recipes', makeRecipe('probe-dequeue', 70));
  assert.equal(res.status, 201);
  assert.equal((await res.json()).dequeued.length, 1);
  const again = await send('POST', '/api/queue', { url });
  assert.equal(again.status, 409);
  assert.equal((await again.json()).recipeId, 'probe-dequeue');
});

// ---------- PUT ids and odd paths ----------

test('PUT refuses ids that are not slugs, encoded traversal and unknown ids with 404', async () => {
  for (const id of ['..%2F..%2Fpackage', '%2e%2e', 'Probe-Eggs', 'probe_eggs', '%E0%A4%A', 'probe-eggs%00', 'nope']) {
    const res = await send('PUT', `/api/recipes/${id}`, makeRecipe('probe-eggs', 1));
    assert.equal(res.status, 404, id);
  }
});

test('PUT with a body whose id differs from the URL is a 400, and the file is unchanged', async () => {
  const before = await readFile(join(dir, 'recipes', 'probe-eggs.json'), 'utf8');
  const res = await send('PUT', '/api/recipes/probe-eggs', makeRecipe('probe-other', 1));
  assert.equal(res.status, 400);
  assert.equal(await readFile(join(dir, 'recipes', 'probe-eggs.json'), 'utf8'), before);
});

test('PUT cannot move a recipe onto the video of another recipe', async () => {
  const res = await send('PUT', '/api/recipes/probe-eggs', makeRecipe('probe-eggs', 70));
  assert.equal(res.status, 409);
  assert.equal((await res.json()).recipeId, 'probe-dequeue');
});

test('a recipe carrying prototype keys is not written by POST (packs refuse the same keys)',
  async () => {
    const body = JSON.stringify(makeRecipe('probe-proto', 80)).replace('{"id"', '{"__proto__":{"polluted":true},"id"');
    const res = await send('POST', '/api/recipes', body);
    assert.equal(res.status, 400);
  });

test('unknown API routes and methods are 404 JSON, never a crash', async () => {
  for (const [method, path] of [['GET', '/api/'], ['GET', '/api/recipes/probe-eggs'], ['PATCH', '/api/recipes/probe-eggs'], ['DELETE', '/api/recipes/probe-eggs'], ['GET', '/api/queue/x'], ['POST', '/api/packs']]) {
    const res = await send(method, path, method === 'GET' ? undefined : '{}');
    assert.equal(res.status, 404, `${method} ${path}`);
    assert.match(res.headers.get('content-type'), /application\/json/);
  }
});

test('DELETE of an id that is not in the queue is 404; odd ids never match everything', async () => {
  for (const id of ['nope', '-', '_', 'a-b-c']) assert.equal((await send('DELETE', `/api/queue/${id}`, '{}')).status, 404, id);
});

// ---------- static files ----------

test('static paths never serve files outside public/ and lib/', async () => {
  for (const path of ['/%2e%2e/server.mjs', '/lib/%2e%2e/server.mjs', '/..%2fserver.mjs', '/lib/..%2fpackage.json', '/%2e%2e%2f%2e%2e%2fetc/passwd', '/lib/%2e%2e%2f.git/config']) {
    const res = await fetch(base + path);
    assert.ok([403, 404].includes(res.status), `${path} → ${res.status}`);
    assert.doesNotMatch(await res.text(), /createHandler|"scripts"|\[core\]/, path);
  }
});

test('broken percent-encoding, NUL bytes and directories are 4xx, never 500', async () => {
  for (const path of ['/%E0%A4%A', '/%', '/a%00b.js', '/features/', '/lib/', '/ui']) {
    const res = await fetch(base + path);
    assert.ok(res.status >= 400 && res.status < 500, `${path} → ${res.status}`);
  }
});

test('writes to non-API paths are 405', async () => {
  for (const method of ['POST', 'PUT', 'DELETE']) assert.equal((await send(method, '/index.html', '{}')).status, 405);
});

test('the lib/ files the browser imports are served as JavaScript', async () => {
  for (const f of ['video.mjs', 'pack.mjs', 'draft.mjs', 'scale.mjs', 'filter.mjs', 'purchase.mjs']) {
    const res = await fetch(`${base}/lib/${f}`);
    assert.equal(res.status, 200, f);
    assert.match(res.headers.get('content-type'), /text\/javascript/);
  }
});

// ---------- writes from other websites ----------

test('cross-site, foreign-origin and foreign-host writes are refused before the body is read', async () => {
  const r = makeRecipe('probe-foreign', 90);
  const cases = [
    { 'sec-fetch-site': 'cross-site' },
    { 'sec-fetch-site': 'same-site' },
    { origin: 'http://evil.example' },
    { origin: 'null' },
    { origin: `http://127.0.0.1:${port}.evil.example` },
    { origin: `https://127.0.0.1:${port}` },
  ];
  for (const h of cases) {
    const res = await send('POST', '/api/recipes', r, { 'content-type': 'application/json', ...h });
    assert.equal(res.status, 403, JSON.stringify(h));
  }
  // fetch does not let a test set Host; the raw request can.
  const bytes = Buffer.from(JSON.stringify(r));
  for (const host of ['evil.example', 'localhost.evil.example', '127.0.0.1.nip.io', 'localhost.']) {
    const res = await rawRequest('POST', '/api/recipes', [bytes], { host });
    assert.equal(res.status, 403, host);
  }
  await assert.rejects(readFile(join(dir, 'recipes', 'probe-foreign.json')));
});

test('a same-origin write from the dashboard (matching Origin and Host) is allowed', async () => {
  const r = makeRecipe('probe-own-origin', 91);
  const res = await send('POST', '/api/recipes', r, { 'content-type': 'application/json', origin: base, 'sec-fetch-site': 'same-origin' });
  assert.equal(res.status, 201);
});

// ---------- data on disk that is not quite right ----------

test('stray files in recipes/ (temp files, non-JSON, broken JSON) never break GET /api/recipes', async () => {
  await writeFile(join(dir, 'recipes', 'probe-eggs.json.123.abcd.tmp'), '{');
  await writeFile(join(dir, 'recipes', 'README.md'), '# not a recipe');
  await writeFile(join(dir, 'recipes', 'broken.json'), '{"id": "broken"');
  const res = await fetch(base + '/api/recipes');
  assert.equal(res.status, 200);
  const { recipes, invalid } = await res.json();
  assert.ok(recipes.some((r) => r.id === 'probe-eggs'));
  assert.deepEqual(invalid.map((i) => i.file), ['broken.json']);
  await rm(join(dir, 'recipes', 'broken.json'));
});

test('an invalid recipe file on disk still blocks its id for POST and pack import', async () => {
  await writeFile(join(dir, 'recipes', 'probe-taken.json'), '{"id": "probe-taken"}');
  assert.equal((await send('POST', '/api/recipes', makeRecipe('probe-taken', 92))).status, 409);
  await rm(join(dir, 'recipes', 'probe-taken.json'));
});

test('a fresh data folder without recipes/ answers GET and POST without a server error',
  async () => {
    const empty = await mkdtemp(join(tmpdir(), 'recipe-bank-probe-empty-'));
    const app = createApp({ dataDir: empty, oembed: null, resolve: async (v) => v });
    await new Promise((ok) => app.listen(0, '127.0.0.1', ok));
    const url = `http://127.0.0.1:${app.address().port}`;
    try {
      const get = await fetch(url + '/api/recipes');
      const post = await fetch(url + '/api/recipes', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(makeRecipe('probe-first', 93)) });
      assert.equal(get.status, 200);
      assert.equal(post.status, 201);
    } finally {
      app.closeAllConnections?.();
      await new Promise((ok) => app.close(ok));
      await rm(empty, { recursive: true, force: true });
    }
  });

test('a queue file that is not a list gives a clear error, not a generic 500',
  async () => {
    const bank = await tempBank([]);
    await writeFile(join(bank, 'data', 'queue.json'), '{"queue": []}');
    const app = createApp({ dataDir: bank, oembed: null, resolve: async (v) => v });
    await new Promise((ok) => app.listen(0, '127.0.0.1', ok));
    try {
      const res = await fetch(`http://127.0.0.1:${app.address().port}/api/queue`);
      assert.notEqual(res.status, 500);
      assert.match((await res.json()).error, /queue\.json must be a JSON list/);
    } finally {
      app.closeAllConnections?.();
      await new Promise((ok) => app.close(ok));
      await rm(bank, { recursive: true, force: true });
    }
  });

// ---------- queue input ----------

test('queue input: non-string url and note, prototype keys and whitespace are handled', async () => {
  for (const body of [{ url: 42 }, { url: { toString: 1 } }, { url: null }, { url: '   ' }, { url: 'javascript:alert(1)' }, { url: 'https://example.com/recipe' }]) {
    assert.equal((await send('POST', '/api/queue', body)).status, 400, JSON.stringify(body));
  }
  const res = await send('POST', '/api/queue', { url: `  https://youtu.be/${videoId(95)}  `, note: { evil: 1 } });
  assert.equal(res.status, 201);
  assert.equal((await res.json()).entry.note, null);
  const web = await send('POST', '/api/queue', { url: 'https://example.com/recipe', allowWeb: 'true' });
  assert.equal(web.status, 400, 'allowWeb must be the boolean true');
});

test('notes are trimmed and capped at 500 characters, counting characters not bytes', async () => {
  const res = await send('POST', '/api/queue', { url: `https://youtu.be/${videoId(96)}`, note: `  ${'é'.repeat(800)}  ` });
  assert.equal(res.status, 201);
  assert.equal((await res.json()).entry.note.length, 500);
});
