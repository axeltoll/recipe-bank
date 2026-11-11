// API and static-site tests. The server runs on a random port against a temporary
// recipes folder and queue file, with the oEmbed lookup stubbed (no network).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp, loadRecipes } from '../server.mjs';
import { buildStatic } from '../scripts/build-static.mjs';

const RECIPE_VIDEO = { platform: 'youtube', id: 'mhNQ8y5ud0A', url: 'https://www.youtube.com/shorts/mhNQ8y5ud0A' };
const fixture = {
  id: 'test-recipe', title: 'Test recipe', status: 'analyzed', summary: 'A test.', analyzed: '2026-11-11',
  video: RECIPE_VIDEO, creator: { name: 'Test Creator' }, tags: ['test'],
  components: [{ name: 'Main', ingredients: [{ item: 'Salt', key: 'salt', amount: null, basis: 'unstated' }], steps: [{ text: 'Season.', t: 1 }] }],
};
const queued = (id, ytId) => ({
  id, video: { platform: 'youtube', id: ytId, url: `https://www.youtube.com/shorts/${ytId}` },
  title: null, creator: null, creatorUrl: null, note: null, addedAt: '2026-11-11T00:00:00.000Z', addedBy: 'dashboard', status: 'queued',
});

let tmp, recipesDir, queueFile, server, base;
const lookups = [];

before(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'recipe-bank-test-'));
  recipesDir = join(tmp, 'recipes');
  queueFile = join(tmp, 'data', 'queue.json');
  await mkdir(recipesDir);
  await mkdir(join(tmp, 'data'));
  await writeFile(join(recipesDir, 'test-recipe.json'), JSON.stringify(fixture));
  await writeFile(join(recipesDir, 'broken.json'), '{ not json');
  await writeFile(queueFile, JSON.stringify([queued('already-done', RECIPE_VIDEO.id), queued('waiting', 'BBBBBBBBBBB')]));
  server = createApp({
    recipesDir, queueFile,
    oembed: async (video) => {
      lookups.push(video);
      return { title: 'Stub title', creator: 'Stub creator', creatorUrl: null };
    },
  });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  server.closeAllConnections?.();
  await new Promise((ok) => server.close(ok));
  await rm(tmp, { recursive: true, force: true });
});

// Every write is sent as JSON, like the dashboard does; the server refuses anything else (see server-guard.test.mjs).
async function call(method, path, body, { raw = false } = {}) {
  const init = { method, headers: {} };
  if (method !== 'GET') init.headers['content-type'] = 'application/json';
  if (body !== undefined) init.body = raw ? body : JSON.stringify(body);
  const res = await fetch(base + path, init);
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, type: res.headers.get('content-type'), json, text };
}
const readQueue = async () => JSON.parse(await readFile(queueFile, 'utf8'));

test('GET /api/recipes lists valid recipes and reports broken files', async () => {
  const r = await call('GET', '/api/recipes');
  assert.equal(r.status, 200);
  assert.match(r.type, /^application\/json/);
  assert.deepEqual(r.json.recipes.map((x) => x.id), ['test-recipe']);
  assert.equal(r.json.invalid.length, 1);
  assert.equal(r.json.invalid[0].file, 'broken.json');
});

test('GET /api/queue marks entries whose video is already a recipe as done', async () => {
  const r = await call('GET', '/api/queue');
  assert.equal(r.status, 200);
  assert.deepEqual(r.json.queue.map((q) => [q.id, q.status]), [['already-done', 'done'], ['waiting', 'queued']]);
});

test('POST /api/queue adds a video with the looked-up title and a trimmed note', async () => {
  const r = await call('POST', '/api/queue', { url: 'https://youtu.be/AAAAAAAAAAA', note: '  sauce amounts please  ' });
  assert.equal(r.status, 201);
  const e = r.json.entry;
  assert.match(e.id, /^[0-9a-f-]{36}$/);
  assert.deepEqual(e.video, { platform: 'youtube', id: 'AAAAAAAAAAA', url: 'https://www.youtube.com/shorts/AAAAAAAAAAA' });
  assert.equal(e.title, 'Stub title');
  assert.equal(e.creator, 'Stub creator');
  assert.equal(e.note, 'sauce amounts please');
  assert.equal(e.status, 'queued');
  assert.equal(e.addedBy, 'dashboard');
  assert.ok(!Number.isNaN(Date.parse(e.addedAt)));
  assert.equal(lookups.at(-1).id, 'AAAAAAAAAAA');
  const q = await readQueue();
  assert.equal(q.length, 3);
  assert.deepEqual(q.at(-1), e);
});

test('POST /api/queue: the same video again (any URL form) is a 409', async () => {
  const r = await call('POST', '/api/queue', { url: 'https://www.youtube.com/watch?v=AAAAAAAAAAA&t=3' });
  assert.equal(r.status, 409);
  assert.equal(r.json.error, 'Already waiting for analysis.');
  assert.equal((await readQueue()).length, 3);
});

test('POST /api/queue: a video that is already a recipe is a 409 with its id', async () => {
  const r = await call('POST', '/api/queue', { url: 'https://youtu.be/mhNQ8y5ud0A' });
  assert.equal(r.status, 409);
  assert.equal(r.json.recipeId, 'test-recipe');
  assert.equal((await readQueue()).length, 3);
});

test('POST /api/queue rejects bad input with 400 and changes nothing', async () => {
  const bad = [
    [{ url: 'https://example.com/shorts/AAAAAAAAAAA' }, false],
    [{ url: 'not a link' }, false],
    [{ note: 'no url' }, false],
    [{ url: 42 }, false],
    [[], false],
    ['{ not json', true],
    ['', true],
  ];
  for (const [body, raw] of bad) {
    const r = await call('POST', '/api/queue', body, { raw });
    assert.equal(r.status, 400, JSON.stringify(body));
    // Every supported source is named (built from PLATFORMS in lib/video.mjs).
    assert.match(r.json.error, /YouTube, TikTok, Instagram, Facebook, Pinterest or X/);
  }
  assert.equal((await readQueue()).length, 3);
});

test('POST /api/queue caps the note and ignores a note that is not text', async () => {
  const long = await call('POST', '/api/queue', { url: 'https://www.tiktok.com/@someone/video/7366000000000000001', note: 'x'.repeat(600) });
  assert.equal(long.status, 201);
  assert.equal(long.json.entry.note.length, 500);
  assert.equal(long.json.entry.video.platform, 'tiktok');
  const odd = await call('POST', '/api/queue', { url: 'https://www.instagram.com/reel/C9xYz123/', note: { evil: true } });
  assert.equal(odd.status, 201);
  assert.equal(odd.json.entry.note, null);
  assert.equal((await readQueue()).length, 5);
});

test('concurrent POSTs all land in the queue', async () => {
  const ids = ['CCCCCCCCCC1', 'CCCCCCCCCC2', 'CCCCCCCCCC3', 'CCCCCCCCCC4', 'CCCCCCCCCC5'];
  const results = await Promise.all(ids.map((id) => call('POST', '/api/queue', { url: `https://youtu.be/${id}` })));
  assert.deepEqual(results.map((r) => r.status), [201, 201, 201, 201, 201]);
  const q = await readQueue();
  assert.equal(q.length, 10);
  for (const id of ids) assert.ok(q.some((e) => e.video.id === id), id);
});

test('DELETE /api/queue/<id> removes once, then 404s', async () => {
  const r = await call('DELETE', '/api/queue/waiting');
  assert.equal(r.status, 200);
  assert.deepEqual(r.json, { ok: true });
  assert.ok(!(await readQueue()).some((e) => e.id === 'waiting'));
  const again = await call('DELETE', '/api/queue/waiting');
  assert.equal(again.status, 404);
  assert.equal(again.json.error, 'Not in the queue.');
  const odd = await call('DELETE', '/api/queue/bad%20id');
  assert.equal(odd.status, 404);
  assert.equal((await readQueue()).length, 9);
});

test('unknown API routes and methods', async () => {
  assert.equal((await call('GET', '/api/nope')).status, 404);
  assert.equal((await call('PUT', '/api/queue', { url: 'https://youtu.be/AAAAAAAAAAA' })).status, 404);
  assert.equal((await call('DELETE', '/api/recipes')).status, 404);
  assert.equal((await call('POST', '/', {})).status, 405);
});

test('static files: dashboard, shared lib, feature modules', async () => {
  const home = await call('GET', '/');
  assert.equal(home.status, 200);
  assert.match(home.type, /^text\/html/);
  assert.match(home.text, /<main id="view"/);
  for (const path of ['/lib/video.mjs', '/lib/plan.mjs', '/lib/filter.mjs', '/lib/scale.mjs', '/app.js', '/features/week-plan.mjs']) {
    const r = await call('GET', path);
    assert.equal(r.status, 200, path);
    assert.match(r.type, /^text\/javascript/, path);
  }
  const css = await call('GET', '/features/week-plan.css');
  assert.equal(css.status, 200);
  assert.match(css.type, /^text\/css/);
  assert.equal((await call('GET', '/nope.html')).status, 404);
});

test('static files: no way out of public/ or lib/', async () => {
  assert.equal((await call('GET', '/..%2fserver.mjs')).status, 403);
  assert.equal((await call('GET', '/lib/..%2fpackage.json')).status, 403);
  assert.equal((await call('GET', '/%E0%A4%A')).status, 400);
});

test('static build writes the site, the API files and the static marker', async () => {
  const out = join(tmp, 'dist');
  const okDir = join(tmp, 'recipes-ok');
  await mkdir(okDir);
  await writeFile(join(okDir, 'test-recipe.json'), JSON.stringify(fixture));
  const n = await buildStatic({ outDir: out, recipesDir: okDir, queueFile });
  assert.deepEqual(n, { recipes: 1, queue: 9 });
  assert.match(await readFile(join(out, 'index.html'), 'utf8'), /<html lang="en" data-static="1">/);
  const recipes = JSON.parse(await readFile(join(out, 'api', 'recipes.json'), 'utf8'));
  assert.deepEqual(recipes.recipes.map((r) => r.id), ['test-recipe']);
  assert.deepEqual(recipes.invalid, []);
  const queue = JSON.parse(await readFile(join(out, 'api', 'queue.json'), 'utf8')).queue;
  assert.equal(queue.find((q) => q.id === 'already-done').status, 'done');
  for (const f of ['app.js', 'styles.css', 'lib/video.mjs', 'lib/plan.mjs', 'features/week-plan.mjs', 'features/INTEGRATION.md', '_headers']) {
    await stat(join(out, f)); // throws if missing
  }
  assert.match(await readFile(join(out, '_headers'), 'utf8'), /\/lib\/\*\n {2}Content-Type: text\/javascript/);
});

test('static build refuses invalid recipes and leaves the output alone', async () => {
  const out = join(tmp, 'dist-bad');
  await assert.rejects(buildStatic({ outDir: out, recipesDir, queueFile }), /broken\.json/);
  await assert.rejects(stat(out), { code: 'ENOENT' });
});

test('loadRecipes on the real recipes folder finds no invalid files', async () => {
  const { recipes, invalid } = await loadRecipes();
  assert.deepEqual(invalid, []);
  assert.ok(recipes.length > 0);
});
