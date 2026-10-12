import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { validateRecipe } from '../lib/recipe.mjs';

const DIR = resolve(import.meta.dirname, '..', 'recipes');

test('every recipe file passes the contract', async () => {
  const files = (await readdir(DIR)).filter((f) => f.endsWith('.json'));
  assert.ok(files.length > 0);
  for (const f of files) {
    const r = JSON.parse(await readFile(join(DIR, f), 'utf8'));
    assert.deepEqual(validateRecipe(r, f.slice(0, -5)), [], f);
  }
});

test('the validator catches an invented amount on an unstated ingredient', () => {
  const r = {
    id: 'x', title: 'X', status: 'analyzed', summary: 's', analyzed: '2026-10-12',
    video: { platform: 'youtube', id: 'mhNQ8y5ud0A', url: 'https://youtu.be/mhNQ8y5ud0A' },
    creator: { name: 'c' }, tags: [],
    components: [{ name: 'a', steps: [], ingredients: [{ item: 'Salt', key: 'salt', amount: '1 tsp', basis: 'unstated' }] }],
  };
  assert.ok(validateRecipe(r, 'x').some((e) => e.includes('amount must be null')));
});
