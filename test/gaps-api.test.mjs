// API error paths the other server tests do not hit: a slug the filesystem cannot store,
// list fields that are not arrays, a queue file that is not a list, and a recipe file
// that makes the contract throw while it is being read.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createApp } from '../server.mjs';
import { makeRecipe, tempBank, videoId } from './helpers/bank.mjs';

async function withApp(dir, fn) {
  const server = createApp({ dataDir: dir, oembed: null, resolve: async (v) => v });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await fn(base);
  } finally {
    server.closeAllConnections?.();
    await new Promise((ok) => server.close(ok));
  }
}

const post = (base, path, body) => fetch(base + path, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

test('POST /api/recipes answers 400 when the id is too long for a file name and writes nothing', async () => {
  const dir = await tempBank([]);
  try {
    await withApp(dir, async (base) => {
      const res = await post(base, '/api/recipes', makeRecipe('a'.repeat(251), 1));
      assert.equal(res.status, 400);
      assert.deepEqual(await res.json(), {
        error: 'The recipe does not match the contract.',
        problems: ['id is too long for a file name'],
      });
      assert.deepEqual(await readdir(join(dir, 'recipes')), []);
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('POST /api/recipes answers 400 when components, ingredients or steps are not arrays', async () => {
  const dir = await tempBank([]);
  try {
    await withApp(dir, async (base) => {
      const shapes = [];
      for (const value of ['nope', 3]) {
        const recipe = makeRecipe('shape', 2);
        recipe.components = value;
        shapes.push(recipe);
      }
      const ingredients = makeRecipe('shape', 3);
      ingredients.components[0].ingredients = 'salt';
      shapes.push(ingredients);
      const steps = makeRecipe('shape', 4);
      steps.components[0].steps = 5;
      shapes.push(steps);
      for (const recipe of shapes) {
        const res = await post(base, '/api/recipes', recipe);
        assert.equal(res.status, 400);
        assert.deepEqual((await res.json()).problems, [
          'malformed recipe (a component, ingredient or step is not an object)',
        ]);
      }
      assert.deepEqual(await readdir(join(dir, 'recipes')), []);
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('POST /api/queue answers 409 when the queue file is not a list and does not replace it', async () => {
  const dir = await tempBank([]);
  const file = join(dir, 'data', 'queue.json');
  await writeFile(file, '{"nope":true}');
  try {
    await withApp(dir, async (base) => {
      const res = await post(base, '/api/queue', { url: `https://youtu.be/${videoId(8)}` });
      assert.equal(res.status, 409);
      assert.match((await res.json()).error, /queue\.json must be a JSON list/);
      assert.equal(await readFile(file, 'utf8'), '{"nope":true}');
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('GET /api/recipes stays 200 when a saved file makes the contract throw', async () => {
  const dir = await tempBank([makeRecipe('alpha', 1)]);
  const broken = makeRecipe('broken', 2);
  broken.components = [null];
  await writeFile(join(dir, 'recipes', 'broken.json'), JSON.stringify(broken));
  try {
    await withApp(dir, async (base) => {
      const res = await fetch(base + '/api/recipes');
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.deepEqual(body.recipes.map((r) => r.id), ['alpha']);
      assert.equal(body.invalid.length, 1);
      assert.equal(body.invalid[0].file, 'broken.json');
      assert.ok(body.invalid[0].errors.length > 0);
      assert.ok(body.invalid[0].errors.every((e) => typeof e === 'string'));
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
