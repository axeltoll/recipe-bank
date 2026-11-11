// API tests for the recipe write routes, against a temporary copy of recipes/ and data/.
// The server runs in-process on a random port; nothing here calls a third-party service
// (POST /api/queue looks up oEmbed titles, so it is not exercised).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, readdir, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createRecipeServer } from '../server.mjs';

const ROOT = resolve(import.meta.dirname, '..');
let dir;
let server;
let base;

before(async () => {
  dir = await mkdtemp(join(tmpdir(), 'recipe-bank-test-'));
  await cp(join(ROOT, 'recipes'), join(dir, 'recipes'), { recursive: true });
  await mkdir(join(dir, 'data'), { recursive: true });
  await writeFile(join(dir, 'data', 'queue.json'), JSON.stringify([
    {
      id: 'queued-1',
      video: { platform: 'youtube', id: 'TestVideo02', url: 'https://www.youtube.com/shorts/TestVideo02' },
      title: 'Queued test video', creator: null, creatorUrl: null, note: null,
      addedAt: '2026-11-11T10:00:00.000Z', addedBy: 'dashboard', status: 'queued',
    },
    {
      id: 'queued-2',
      video: { platform: 'youtube', id: 'TestVideo03', url: 'https://www.youtube.com/shorts/TestVideo03' },
      title: 'Another queued video', creator: null, creatorUrl: null, note: null,
      addedAt: '2026-11-11T10:05:00.000Z', addedBy: 'dashboard', status: 'queued',
    },
  ], null, 2) + '\n');
  server = createRecipeServer({ dataDir: dir });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  server.closeAllConnections?.();
  await new Promise((ok) => server.close(ok));
  await rm(dir, { recursive: true, force: true });
});

const send = (method, path, body) =>
  fetch(base + path, {
    method,
    headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });

function recipe(over = {}) {
  return {
    id: 'test-toast',
    title: 'Test Toast',
    status: 'analyzed',
    video: { platform: 'youtube', id: 'TestVideo01', url: 'https://www.youtube.com/shorts/TestVideo01' },
    creator: { name: 'A Creator' },
    analyzed: '2026-11-11',
    summary: 'Bread, toasted.',
    serves: null,
    tags: ['bread'],
    components: [{
      name: 'Toast',
      ingredients: [{ item: 'Bread', key: 'bread', amount: '2 slices', basis: 'spoken' }],
      steps: [{ text: 'Toast the bread.', t: 5 }],
    }],
    ...over,
  };
}

const readRecipe = async (id) => readFile(join(dir, 'recipes', `${id}.json`), 'utf8');
const readQueue = async () => JSON.parse(await readFile(join(dir, 'data', 'queue.json'), 'utf8'));

test('GET /api/recipes still lists every recipe', async () => {
  const res = await fetch(`${base}/api/recipes`);
  assert.equal(res.status, 200);
  const body = await res.json();
  const files = (await readdir(join(ROOT, 'recipes'))).filter((f) => f.endsWith('.json'));
  assert.equal(body.recipes.length, files.length);
  assert.deepEqual(body.invalid, []);
});

test('POST /api/recipes creates a pretty-printed file and GET lists it', async () => {
  const res = await send('POST', '/api/recipes', recipe());
  assert.equal(res.status, 201);
  const body = await res.json();
  assert.deepEqual(body.recipe, recipe());
  assert.deepEqual(body.dequeued, []);
  assert.equal(await readRecipe('test-toast'), JSON.stringify(recipe(), null, 2) + '\n');
  const list = await (await fetch(`${base}/api/recipes`)).json();
  assert.ok(list.recipes.some((r) => r.id === 'test-toast'));
});

test('POST /api/recipes refuses a duplicate id with 409', async () => {
  const res = await send('POST', '/api/recipes', recipe({
    video: { platform: 'youtube', id: 'TestVideo09', url: 'https://www.youtube.com/shorts/TestVideo09' },
  }));
  assert.equal(res.status, 409);
  assert.equal((await res.json()).recipeId, 'test-toast');
});

test('POST /api/recipes refuses a video that is already a recipe with 409', async () => {
  const res = await send('POST', '/api/recipes', recipe({
    id: 'gochujang-again',
    video: { platform: 'youtube', id: 'mhNQ8y5ud0A', url: 'https://youtu.be/mhNQ8y5ud0A' },
  }));
  assert.equal(res.status, 409);
  assert.equal((await res.json()).recipeId, 'gochujang-chicken-thighs');
  await assert.rejects(readRecipe('gochujang-again'));
});

test('POST /api/recipes refuses a recipe that breaks the contract with 400 and the problem list', async () => {
  const bad = recipe({ id: 'bad-toast', video: { platform: 'youtube', id: 'TestVideo08', url: 'https://www.youtube.com/shorts/TestVideo08' } });
  bad.components[0].ingredients[0] = { item: 'Salt', key: 'salt', amount: '1 tsp', basis: 'unstated' };
  const res = await send('POST', '/api/recipes', bad);
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.ok(Array.isArray(body.problems));
  assert.ok(body.problems.some((p) => p.includes('amount must be null')), body.problems.join('\n'));
  await assert.rejects(readRecipe('bad-toast'));
});

test('POST /api/recipes answers 400 for a body that is not JSON or not a recipe', async () => {
  const notJson = await send('POST', '/api/recipes', '{nope');
  assert.equal(notJson.status, 400);
  assert.deepEqual((await notJson.json()).problems, ['not a JSON object']);
  const badId = await send('POST', '/api/recipes', recipe({ id: '../escape' }));
  assert.equal(badId.status, 400);
  assert.ok((await badId.json()).problems.includes('id must be a kebab-case slug'));
});

test('creating a recipe for a queued video removes that queue entry only', async () => {
  const res = await send('POST', '/api/recipes', recipe({
    id: 'queued-toast',
    video: { platform: 'youtube', id: 'TestVideo02', url: 'https://www.youtube.com/shorts/TestVideo02' },
  }));
  assert.equal(res.status, 201);
  assert.deepEqual((await res.json()).dequeued, ['queued-1']);
  assert.deepEqual((await readQueue()).map((q) => q.id), ['queued-2']);
  const queue = (await (await fetch(`${base}/api/queue`)).json()).queue;
  assert.deepEqual(queue.map((q) => q.id), ['queued-2']);
});

test('PUT /api/recipes/<id> replaces the file', async () => {
  const changed = recipe({ title: 'Better Test Toast', notes: ['Edited in the dashboard'] });
  const res = await send('PUT', '/api/recipes/test-toast', changed);
  assert.equal(res.status, 200);
  assert.deepEqual((await res.json()).recipe, changed);
  assert.equal(await readRecipe('test-toast'), JSON.stringify(changed, null, 2) + '\n');
});

test('PUT /api/recipes/<id> answers 404 for an unknown id', async () => {
  const res = await send('PUT', '/api/recipes/no-such-recipe', recipe({ id: 'no-such-recipe' }));
  assert.equal(res.status, 404);
  const odd = await send('PUT', '/api/recipes/..%2Fserver', recipe());
  assert.equal(odd.status, 404);
  await assert.rejects(readRecipe('no-such-recipe'));
});

test('PUT /api/recipes/<id> refuses a body whose id differs from the URL', async () => {
  const res = await send('PUT', '/api/recipes/test-toast', recipe({ id: 'renamed-toast' }));
  assert.equal(res.status, 400);
  assert.ok((await res.json()).problems.some((p) => p.includes('must match filename')));
});

test('PUT /api/recipes/<id> refuses another recipe\'s video with 409', async () => {
  const res = await send('PUT', '/api/recipes/test-toast', recipe({
    video: { platform: 'youtube', id: 'mhNQ8y5ud0A', url: 'https://www.youtube.com/shorts/mhNQ8y5ud0A' },
  }));
  assert.equal(res.status, 409);
  assert.equal((await res.json()).recipeId, 'gochujang-chicken-thighs');
});

test('PUT /api/recipes/<id> refuses a contract problem with 400 and leaves the file alone', async () => {
  const before = await readRecipe('test-toast');
  const res = await send('PUT', '/api/recipes/test-toast', recipe({ components: [] }));
  assert.equal(res.status, 400);
  assert.ok((await res.json()).problems.includes('components must be a non-empty array'));
  assert.equal(await readRecipe('test-toast'), before);
});

test('writes leave no temp files behind', async () => {
  for (const sub of ['recipes', 'data']) {
    const left = (await readdir(join(dir, sub))).filter((f) => f.endsWith('.tmp'));
    assert.deepEqual(left, [], sub);
  }
});

test('existing routes answer as before', async () => {
  assert.equal((await send('DELETE', '/api/queue/not-there')).status, 404);
  const del = await send('DELETE', '/api/queue/queued-2');
  assert.equal(del.status, 200);
  assert.deepEqual(await del.json(), { ok: true });
  const missing = await fetch(`${base}/api/nothing`);
  assert.equal(missing.status, 404);
  assert.deepEqual(await missing.json(), { error: 'Not found' });
  assert.equal((await send('DELETE', '/api/recipes/test-toast')).status, 404);
  const page = await fetch(`${base}/`);
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-type'), /text\/html/);
  const lib = await fetch(`${base}/lib/draft.mjs`);
  assert.equal(lib.status, 200);
  assert.match(lib.headers.get('content-type'), /javascript/);
});
