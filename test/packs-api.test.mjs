// POST /api/packs/import on a random port, against a temporary data folder (RECIPE_BANK_DIR).

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { exportPack } from '../lib/pack.mjs';
import { validateRecipe } from '../lib/recipe.mjs';
import { makeRecipe, tempBank, writeRecipe, recipeText } from './helpers/bank.mjs';

const alpha = makeRecipe('alpha', 1);
let dir;
let server;
let base;

before(async () => {
  dir = await tempBank([alpha]);
  await writeRecipe(dir, '{ not json', 'broken-file.json');
  // The data folder RECIPE_BANK_DIR=dir selects, passed to the factory. Setting process.env before the first
  // import of server.mjs only worked while every test file ran in its own process.
  const { createApp, defaultDataDir } = await import('../server.mjs');
  server = createApp({ dataDir: defaultDataDir({ RECIPE_BANK_DIR: dir }), oembed: null });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  server.closeAllConnections?.();
  await new Promise((ok) => server.close(ok));
  await rm(dir, { recursive: true, force: true });
});

const post = (body, type = 'application/json') =>
  fetch(`${base}/api/packs/import`, {
    method: 'POST',
    headers: { 'content-type': type },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
const listFiles = async () => (await readdir(join(dir, 'recipes'))).sort();
const read = (name) => readFile(join(dir, 'recipes', name), 'utf8');

test('the server reads recipes from RECIPE_BANK_DIR', async () => {
  const res = await fetch(`${base}/api/recipes`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual(body.recipes.map((r) => r.id), ['alpha']);
  assert.deepEqual(body.invalid.map((i) => i.file), ['broken-file.json']);
});

const mixedPack = () => {
  const pack = exportPack([
    makeRecipe('gamma', 3), //        0 new
    makeRecipe('alpha', 4), //        1 id taken, other video → alpha-2
    makeRecipe('delta', 1), //        2 same video as alpha → skipped
    makeRecipe('broken-file', 6), //  3 id taken by an unreadable file → broken-file-2
  ], { title: 'Mixed <b>pack</b>' });
  pack.recipes.push({ id: 'nope' }); // 4 invalid
  return pack;
};

test('import creates only new files and never touches existing ones', async () => {
  const res = await post({ pack: mixedPack() });
  assert.equal(res.status, 201);
  const body = await res.json();
  assert.deepEqual(body.created, ['gamma', 'alpha-2', 'broken-file-2']);
  assert.deepEqual(body.skipped.map((s) => s.index), [2, 4]);
  assert.match(body.skipped[0].reason, /same video as "alpha"/);
  assert.deepEqual(body.counts, { new: 1, conflict: 2, duplicate: 1, invalid: 1 });

  assert.equal(await read('alpha.json'), recipeText(alpha), 'existing recipe untouched');
  assert.equal(await read('broken-file.json'), '{ not json', 'unreadable file untouched');
  for (const id of body.created) {
    const r = JSON.parse(await read(`${id}.json`));
    assert.deepEqual(validateRecipe(r, id), [], id);
  }
  assert.equal(JSON.parse(await read('alpha-2.json')).video.id, 'testvideo04');

  const all = await (await fetch(`${base}/api/recipes`)).json();
  assert.equal(all.recipes.length, 4);
});

test('importing the same pack again changes nothing', async () => {
  const before = await listFiles();
  const res = await post({ pack: mixedPack() });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual(body.created, []);
  assert.deepEqual(body.counts, { new: 0, conflict: 0, duplicate: 4, invalid: 1 });
  assert.deepEqual(await listFiles(), before);
});

test('include picks which pack positions to import', async () => {
  const pack = exportPack([makeRecipe('eps', 7), makeRecipe('zeta', 8)]);
  const res = await post({ pack, include: [1] });
  assert.equal(res.status, 201);
  const body = await res.json();
  assert.deepEqual(body.created, ['zeta']);
  assert.deepEqual(body.skipped, [{ index: 0, id: 'eps', reason: 'not selected' }]);
  assert.ok(!(await listFiles()).includes('eps.json'));
});

test('bad requests are refused and write nothing', async () => {
  const before = await listFiles();
  const recipe = JSON.stringify(makeRecipe('omega', 9));
  const cases = [
    [post({ pack: mixedPack() }, 'text/plain'), 415, /application\/json/],
    [post('{ not json'), 400, /Send JSON/],
    [post({}), 400, /Send JSON/],
    [post([]), 400, /Send JSON/],
    [post({ pack: { format: 'zip', version: 1, recipes: [] } }), 400, /not a recipe pack/],
    [post({ pack: exportPack([makeRecipe('omega', 9)]), include: ['0'] }), 400, /"include"/],
    [post({ pack: exportPack([makeRecipe('omega', 9)]), include: 0 }), 400, /"include"/],
    [post(`{"pack":{"format":"recipe-bank-pack","version":1,"__proto__":{"polluted":true},"recipes":[${recipe}]}}`), 400, /forbidden key "__proto__"/],
    [post({ pack: { format: 'recipe-bank-pack', version: 9, recipes: [] } }), 400, /newer Recipe Bank/],
  ];
  for (const [pending, status, re] of cases) {
    const res = await pending;
    assert.equal(res.status, status);
    assert.match((await res.json()).error, re);
  }
  assert.equal(({}).polluted, undefined);
  assert.deepEqual(await listFiles(), before);
});
