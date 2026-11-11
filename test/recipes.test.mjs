import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { validateRecipe } from '../lib/recipe.mjs';
import { parseVideoUrl, PLATFORMS } from '../lib/video.mjs';

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

test('recipe video validation accepts the new platforms and only explicit HTTPS web sources', async () => {
  const [file] = (await readdir(DIR)).filter((f) => f.endsWith('.json'));
  const recipe = JSON.parse(await readFile(join(DIR, file), 'utf8'));
  for (const url of [
    'https://facebook.com/watch?v=12345', 'https://fb.watch/AbC123/',
    'https://pinterest.com/pin/12345/', 'https://pin.it/AbC123',
    'https://x.com/kitchen/status/12345', 'https://example.com/recipe-video',
  ]) {
    const video = parseVideoUrl(url, { allowWeb: true });
    assert.deepEqual(validateRecipe({ ...recipe, video }), [], url);
    const errors = validateRecipe({ ...recipe, video: { ...video, platform: 'youtube' } });
    assert.ok(errors.some((e) => /video\.(?:url|platform)/.test(e)), url);
    if (video.id) {
      assert.ok(validateRecipe({ ...recipe, video: { ...video, id: 'wrong' } })
        .some((e) => e.includes('video.id')));
    }
  }
  const bad = { ...recipe, video: { platform: 'web', id: null, url: 'http://example.com/video' } };
  const [message] = validateRecipe(bad);
  for (const { label } of PLATFORMS) assert.ok(message.includes(label), label);
  assert.ok(validateRecipe({ ...bad, video: { ...bad.video, url: 'https://facebook.com/reel/abc' } }).length);
});
