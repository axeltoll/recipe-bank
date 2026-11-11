import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm, readdir } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { assertQueue, nextQueued, markEntry, updateQueueFile, queueMain } from '../scripts/queue.mjs';

const video = { platform: 'youtube', id: 'mhNQ8y5ud0A', url: 'https://youtu.be/mhNQ8y5ud0A' };
const entry = (id, addedAt, status = 'queued') => ({ id, video, addedAt, status });

test('next chooses oldest queued entry without mutating the queue and handles empty/missing dates', () => {
  const queue = [entry('new', '2026-11-10'), entry('failed', '2026-01-01', 'failed'), entry('old', '2026-11-01'), entry('missing')];
  const before = structuredClone(queue);
  assert.equal(nextQueued(queue).id, 'old');
  assert.deepEqual(queue, before);
  assert.equal(nextQueued([]), null);
  assert.equal(nextQueued([entry('a'), entry('b')]).id, 'a');
  assert.equal(nextQueued([entry('a', '2026-11-01'), entry('b', '2026-11-01')]).id, 'a');
  assert.equal(nextQueued([entry('a', '2026-11-01', 'analyzing')]), null);
});

test('queue transitions require claims and failure reasons, and retry clears the old reason', () => {
  const initial = [entry('a', '2026-11-01')];
  const analyzing = markEntry(initial, 'a', 'analyzing');
  assert.equal(initial[0].status, 'queued');
  assert.equal(analyzing[0].status, 'analyzing');
  assert.throws(() => markEntry(initial, 'a', 'failed', { reason: 'No captions' }), /Cannot mark/);
  assert.throws(() => markEntry(analyzing, 'a', 'failed'), /reason/);
  const failed = markEntry(analyzing, 'a', 'failed', { reason: ' No usable evidence ' });
  assert.equal(failed[0].failureReason, 'No usable evidence');
  const retry = markEntry(failed, 'a', 'queued');
  assert.equal(retry[0].status, 'queued');
  assert.equal(retry[0].failureReason, undefined);
  assert.throws(() => markEntry(initial, 'missing', 'analyzing'), /not found/);
});

test('completion requires a matching recipe with a valid filename and contract', async () => {
  const recipe = JSON.parse(await readFile(new URL('../recipes/gochujang-chicken-thighs.json', import.meta.url), 'utf8'));
  const queue = [entry('a', '2026-11-01', 'analyzing')];
  const file = { recipe, fileId: recipe.id };
  assert.deepEqual(markEntry(queue, 'a', 'done', { recipes: [file] }), []);
  for (const recipes of [[], [{ ...file, fileId: 'wrong-name' }], [{ ...file, recipe: { ...recipe, creator: null } }]]) {
    assert.throws(() => markEntry(queue, 'a', 'done', { recipes }), /matching valid recipe/);
  }
  assert.throws(() => markEntry([entry('a')], 'a', 'done', { recipes: [file] }), /Only an analyzing/);
});

test('malformed queue entries and duplicate IDs fail before a change', () => {
  for (const queue of [null, {}, [null], [entry('a'), entry('a')], [{ ...entry('a'), status: 'done' }], [{ ...entry('a'), video: {} }]]) {
    assert.throws(() => assertQueue(queue), /Queue/);
  }
});

async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'recipe-queue-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, 'data'));
  await mkdir(path.join(root, 'recipes'));
  const file = path.join(root, 'data', 'queue.json');
  await writeFile(file, JSON.stringify([entry('a', '2026-11-01')]));
  return { root, file };
}

test('queue CLI handles next, claim, failure, retry and completion through atomic writes', async (t) => {
  const { root, file } = await fixture(t);
  const output = [];
  const options = { root, log: (line) => output.push(JSON.parse(line)), error: assert.fail };
  assert.equal(await queueMain(['next'], options), 0);
  assert.equal(output[0].id, 'a');
  assert.equal(JSON.parse(await readFile(file, 'utf8'))[0].status, 'queued');
  assert.equal(await queueMain(['mark', 'a', 'analyzing'], options), 0);
  assert.equal(await queueMain(['mark', 'a', 'failed', 'Unavailable'], options), 0);
  assert.equal(JSON.parse(await readFile(file, 'utf8'))[0].failureReason, 'Unavailable');
  assert.equal(await queueMain(['mark', 'a', 'queued'], options), 0);
  assert.equal(await queueMain(['mark', 'a', 'analyzing'], options), 0);
  const source = new URL('../recipes/gochujang-chicken-thighs.json', import.meta.url);
  await writeFile(path.join(root, 'recipes', 'gochujang-chicken-thighs.json'), await readFile(source));
  assert.equal(await queueMain(['mark', 'a', 'done'], options), 0);
  assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), []);
  assert.deepEqual(await readdir(path.dirname(file)), ['queue.json']);
});

test('failed transformations and competing helper locks preserve the original queue', async (t) => {
  const { file } = await fixture(t);
  const original = await readFile(file, 'utf8');
  await assert.rejects(updateQueueFile(file, () => { throw new Error('Invalid update'); }), /Invalid update/);
  assert.equal(await readFile(file, 'utf8'), original);
  await writeFile(`${file}.agent.tmp`, 'another helper');
  await assert.rejects(updateQueueFile(file, assert.fail), /EEXIST/);
  // The message says what to do, not just the error code.
  await assert.rejects(updateQueueFile(file, assert.fail), /queue\.json\.agent\.tmp exists .*delete that file and retry .*agent\/QUEUE\.md/s);
  assert.equal(await readFile(`${file}.agent.tmp`, 'utf8'), 'another helper');
  assert.equal(await readFile(file, 'utf8'), original);
});

test('concurrent external edits abort rather than overwrite the changed queue', async (t) => {
  const { file } = await fixture(t);
  const changed = JSON.stringify([entry('other', '2026-11-02')]);
  await assert.rejects(updateQueueFile(file, async () => { await writeFile(file, changed); return []; }), /Queue changed/);
  assert.equal(await readFile(file, 'utf8'), changed);
  assert.deepEqual(await readdir(path.dirname(file)), ['queue.json']);
});

test('an unrelated broken recipe file neither blocks completion nor hides behind a SyntaxError', async (t) => {
  const { root, file } = await fixture(t);
  const errors = [];
  const options = { root, log() {}, error: (m) => errors.push(m) };
  await writeFile(path.join(root, 'recipes', 'half-written.json'), '{ "id": "half-');
  assert.equal(await queueMain(['mark', 'a', 'analyzing'], options), 0);
  // No matching recipe yet: the unreadable file is named.
  assert.equal(await queueMain(['mark', 'a', 'done'], options), 1);
  assert.match(errors.join('\n'), /matching valid recipe file\. Unreadable: recipes\/half-written\.json \(/);
  // With the matching recipe written, the broken neighbour does not stop completion.
  const source = new URL('../recipes/gochujang-chicken-thighs.json', import.meta.url);
  await writeFile(path.join(root, 'recipes', 'gochujang-chicken-thighs.json'), await readFile(source));
  assert.equal(await queueMain(['mark', 'a', 'done'], options), 0);
  assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), []);
});

test('CLI rejects unsupported arguments and malformed files without modifying them', async (t) => {
  const { root, file } = await fixture(t);
  const options = { root, log: assert.fail, error() {} };
  for (const args of [[], ['next', 'extra'], ['mark', 'a', 'bad'], ['mark', 'a', 'failed'], ['mark', 'a', 'analyzing', 'extra']]) {
    assert.equal(await queueMain(args, options), 1);
  }
  await writeFile(file, 'broken JSON');
  assert.equal(await queueMain(['next'], options), 1);
  assert.equal(await queueMain(['mark', 'a', 'analyzing'], options), 1);
  assert.equal(await readFile(file, 'utf8'), 'broken JSON');
});

test('web page entries are valid queue rows and complete only against the matching web recipe', async () => {
  const web = (url) => ({ platform: 'web', id: null, url });
  const page = web('https://cooking.example/stew');
  const queue = [entry('yt', '2026-11-02'), { id: 'page', video: page, addedAt: '2026-11-01', status: 'queued' }];
  // One web row must not make the whole file look broken (validate accepts it too).
  assert.doesNotThrow(() => assertQueue(queue));
  assert.equal(nextQueued(queue).id, 'page');
  const claimed = markEntry(queue, 'page', 'analyzing');
  assert.equal(markEntry(claimed, 'yt', 'analyzing').find((q) => q.id === 'yt').status, 'analyzing');

  const base = JSON.parse(await readFile(new URL('../recipes/gochujang-chicken-thighs.json', import.meta.url), 'utf8'));
  const recipeFor = (video, id) => ({ fileId: id, recipe: { ...base, id, video } });
  const other = recipeFor(web('https://cooking.example/soup'), 'other-web-recipe');
  // A different web page is not this entry's recipe (both used to collapse to the same empty key).
  assert.throws(() => markEntry(claimed, 'page', 'done', { recipes: [other] }), /matching valid recipe/);
  const done = markEntry(claimed, 'page', 'done', { recipes: [other, recipeFor(page, 'stew-from-the-web')] });
  assert.deepEqual(done.map((q) => q.id), ['yt']);
  // A web URL without platform "web" is still not a valid queue row.
  assert.throws(() => assertQueue([{ ...queue[1], video: { ...page, platform: 'youtube' } }]), /Queue/);
});
