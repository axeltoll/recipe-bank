import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { parseVideoUrl, videoKey } from '../lib/video.mjs';

const root = new URL('../', import.meta.url);
const readJSON = async (path) => JSON.parse(await readFile(new URL(path, root), 'utf8'));

// Captured before adding platforms. Deliberately pin the values, rather than
// calculating the expected keys with the parser under test.
test('every stored recipe and queue entry keeps its parsed URL and videoKey', async () => {
  const expected = await readJSON('test/video-compat.json');
  const files = (await readdir(new URL('recipes/', root))).filter((f) => f.endsWith('.json')).sort();
  for (const file of files) {
    const { video } = await readJSON(`recipes/${file}`);
    const parsed = parseVideoUrl(video.url);
    const pinned = expected.recipes[file];
    if (!pinned) {
      // Added after the capture: its link must still parse, to the key the recipe file implies.
      assert.ok(parsed, `${file}: ${video.url} no longer parses`);
      assert.equal(videoKey(parsed), videoKey(video), file);
      continue;
    }
    assert.deepEqual(parsed, pinned.parsed, file);
    assert.equal(videoKey(video), pinned.key, file);
    assert.equal(videoKey(parsed), pinned.key, file);
  }
  const queue = await readJSON('data/queue.json');
  assert.equal(queue.length, expected.queue.length);
  for (const [i, { video }] of queue.entries()) {
    const parsed = parseVideoUrl(video.url);
    assert.deepEqual(parsed, expected.queue[i].parsed, `queue[${i}]`);
    assert.equal(videoKey(video), expected.queue[i].key, `queue[${i}]`);
    assert.equal(videoKey(parsed), expected.queue[i].key, `queue[${i}]`);
  }
});
