// scripts/validate.mjs on malformed recipe files and queue entries. A crash is a todo:
// the script should print a report and exit 1, and these inputs currently throw first.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeRecipe, runScript, tempBank, videoId, writeRecipe } from './helpers/bank.mjs';

async function validate(dir, args = ['--json']) {
  const r = await runScript('validate.mjs', args, { RECIPE_BANK_DIR: dir });
  let report = null;
  if (args.includes('--json') && r.stdout.trim().startsWith('{')) report = JSON.parse(r.stdout);
  return { ...r, report };
}

const messages = (report, where) => report.problems.filter((p) => p.where === where).map((p) => p.message);

test('invalid JSON is a problem in text and in --json, and the process still exits 1', async () => {
  const dir = await tempBank([]);
  try {
    await writeRecipe(dir, '{ not json', 'a.json');
    const json = await validate(dir);
    assert.equal(json.code, 1);
    assert.equal(json.report.ok, false);
    assert.equal(json.report.recipes, 1);
    assert.match(messages(json.report, 'a.json')[0], /^invalid JSON \(Expected property name/);
    assert.equal(json.stderr, '');

    const text = await validate(dir, []);
    assert.equal(text.code, 1);
    assert.match(text.stderr, /✗ a\.json: invalid JSON/);
    assert.match(text.stderr, /1 problem\(s\)\./);
    assert.equal(text.stdout, '');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('JSON null and a number are one problem; a JSON array is reported field by field', async () => {
  const dir = await tempBank([]);
  try {
    await writeRecipe(dir, 'null', 'null.json');
    await writeRecipe(dir, '42', 'number.json');
    await writeRecipe(dir, '[]', 'array.json');
    const { code, report, stderr } = await validate(dir);
    assert.equal(code, 1);
    assert.doesNotMatch(stderr, /TypeError/);
    assert.deepEqual(messages(report, 'null.json'), ['not a JSON object']);
    assert.deepEqual(messages(report, 'number.json'), ['not a JSON object']);
    const array = messages(report, 'array.json');
    assert.ok(array.includes('id must be a kebab-case slug'), array.join('; '));
    assert.ok(array.includes('components must be a non-empty array'), array.join('; '));
    assert.ok(!array.includes('not a JSON object'));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('two recipe files for one video are both invalid only on the later file', async () => {
  const dir = await tempBank([makeRecipe('alpha', 1), makeRecipe('beta', 1)]);
  try {
    const { code, report } = await validate(dir);
    assert.equal(code, 1);
    assert.deepEqual(messages(report, 'alpha.json'), []);
    assert.deepEqual(messages(report, 'beta.json'), ['same video as alpha.json']);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('the id inside a recipe file has to be the filename', async () => {
  const dir = await tempBank([]);
  try {
    await writeRecipe(dir, makeRecipe('alpha', 1), 'beta.json');
    const { report } = await validate(dir);
    assert.deepEqual(messages(report, 'beta.json'), ['id "alpha" must match filename "beta.json"']);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('queue entries: bad links, ids and statuses are problems; analyzing, failed and web pages pass', async () => {
  const alpha = makeRecipe('alpha', 1);
  const dir = await tempBank([alpha]);
  const queue = [
    { id: 'bad-url', status: 'queued', video: { platform: 'youtube', url: 'https://example.com/nope', id: 'abcdefghijk' } },
    { id: 'bad-platform', status: 'queued', video: { platform: 'tiktok', url: alpha.video.url, id: alpha.video.id } },
    { id: 'bad-id', status: 'queued', video: { ...alpha.video, id: 'wrongidxxxx' } },
    { id: 'bad-status', status: 'done', video: { platform: 'youtube', id: videoId(4), url: `https://www.youtube.com/shorts/${videoId(4)}` } },
    { status: 'queued', video: alpha.video },
    { id: 'web-id', status: 'queued', video: { platform: 'web', id: 'page', url: 'https://example.com/stew' } },
    { id: 'short-id', status: 'analyzing', video: { platform: 'tiktok', id: '123', url: 'https://vm.tiktok.com/ZMabc123/' } },
    { id: 'ok-failed', status: 'failed', video: { platform: 'youtube', id: videoId(5), url: `https://www.youtube.com/shorts/${videoId(5)}` } },
    { id: 'ok-web', status: 'queued', video: { platform: 'web', id: null, url: 'https://example.com/stew' } },
  ];
  try {
    await writeFile(join(dir, 'data', 'queue.json'), JSON.stringify(queue));
    const { code, report, stderr } = await validate(dir);
    assert.equal(code, 1, stderr);
    assert.equal(report.queue, 9);
    const at = (i) => messages(report, `data/queue.json[${i}]`);
    assert.match(at(0)[0], /video\.url is not a supported link/);
    assert.deepEqual(at(1), ['video.platform must be "youtube"']);
    assert.deepEqual(at(2), [`video.id must be "${alpha.video.id}"`]);
    assert.match(at(3)[0], /status must be one of queued, analyzing, failed/);
    assert.deepEqual(at(4), ['id is required']);
    assert.deepEqual(at(5), ['video.id must be null or omitted for web pages and unresolved short links']);
    assert.deepEqual(at(6), ['video.id must be null or omitted for web pages and unresolved short links']);
    assert.deepEqual(at(7), []);
    assert.deepEqual(at(8), []);
    // A wrong platform or a wrong id is a different video key, so only the exact copy is "already analyzed".
    assert.deepEqual(report.warnings.map((w) => w.where), ['data/queue.json[4]']);
    assert.match(report.warnings[0].message, /already analyzed as alpha\.json/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('an unknown ingredient key warns and still exits 0; a missing queue file is fine', async () => {
  const dir = await tempBank([makeRecipe('alpha', 1, {
    components: [{ name: 'Main', ingredients: [{ item: 'Unicorn', key: 'unicorn', amount: '1', basis: 'spoken' }], steps: [{ text: 'Admire it.' }] }],
  })]);
  try {
    let r = await validate(dir);
    assert.equal(r.code, 0, r.stderr);
    assert.equal(r.report.ok, true);
    assert.equal(r.report.queue, 0);
    assert.equal(r.report.problems.length, 0);
    assert.match(r.report.warnings[0].message, /ingredient key "unicorn" has no shopping-list aisle/);

    r = await validate(dir, []);
    assert.equal(r.code, 0);
    assert.match(r.stderr, /! alpha\.json: ingredient key "unicorn"/);
    assert.match(r.stdout, /✓ 1 recipe\(s\) and 0 queue entries valid\./);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('a queue file that is not a list is one problem; a null entry next to a real recipe is reported', async () => {
  const dir = await tempBank([makeRecipe('alpha', 1)]);
  try {
    await writeFile(join(dir, 'data', 'queue.json'), '{"items":[]}');
    let r = await validate(dir);
    assert.equal(r.code, 1);
    assert.deepEqual(r.report.problems, [{ where: 'data/queue.json', message: 'must be an array' }]);

    await writeFile(join(dir, 'data', 'queue.json'), '[null]');
    r = await validate(dir);
    assert.equal(r.code, 1);
    assert.doesNotMatch(r.stderr, /TypeError/);
    assert.ok(messages(r.report, 'data/queue.json[0]').includes('id is required'));
    assert.match(messages(r.report, 'data/queue.json[0]').join('\n'), /video\.url is not a supported link/);
    assert.match(messages(r.report, 'data/queue.json[0]').join('\n'), /status must be one of/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('a null or non-array component, ingredient or step is reported, not a stack trace', { todo: 'bug: validate.mjs crashes with TypeError and prints no report' }, async () => {
  const base = () => makeRecipe('a', 1);
  const shapes = {
    'null component': (() => { const r = base(); r.components = [null]; return r; })(),
    'components string': (() => { const r = base(); r.components = 'nope'; return r; })(),
    'components number': (() => { const r = base(); r.components = 3; return r; })(),
    'null ingredient': (() => { const r = base(); r.components[0].ingredients = [null]; return r; })(),
    'ingredients string': (() => { const r = base(); r.components[0].ingredients = 'salt'; return r; })(),
    'null step': (() => { const r = base(); r.components[0].steps = [null]; return r; })(),
    'steps number': (() => { const r = base(); r.components[0].steps = 5; return r; })(),
  };
  const crashes = [];
  for (const [name, recipe] of Object.entries(shapes)) {
    const dir = await tempBank([]);
    try {
      await writeRecipe(dir, recipe, 'a.json');
      const r = await validate(dir);
      if (!r.report || r.report.ok !== false || /TypeError/.test(r.stderr)) {
        crashes.push(`${name}: code ${r.code}; ${r.stderr.split('\n')[0] || 'no stderr'}`);
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
  assert.deepEqual(crashes, []);
});

test('a null queue entry is reported even when a recipe has no usable video', { todo: 'bug: null queue entry throws TypeError reading video when a recipe key is empty' }, async () => {
  const dir = await tempBank([]);
  try {
    await writeFile(join(dir, 'recipes', 'a.json'), '{}\n');
    await writeFile(join(dir, 'data', 'queue.json'), '[null]');
    const r = await runScript('validate.mjs', ['--json'], { RECIPE_BANK_DIR: dir });
    assert.equal(r.code, 1);
    assert.doesNotMatch(r.stderr, /TypeError/);
    const report = JSON.parse(r.stdout);
    assert.equal(report.ok, false);
    assert.ok(report.problems.some((p) => p.where === 'data/queue.json[0]' && p.message === 'id is required'));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('a data folder with no recipes directory is a reported problem', { todo: 'bug: missing recipes/ throws ENOENT and prints no report' }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'recipe-bank-test-'));
  try {
    await mkdir(join(dir, 'data'));
    await writeFile(join(dir, 'data', 'queue.json'), '[]');
    const r = await runScript('validate.mjs', ['--json'], { RECIPE_BANK_DIR: dir });
    assert.equal(r.code, 1);
    assert.doesNotMatch(r.stderr, /ENOENT/);
    const report = JSON.parse(r.stdout);
    assert.equal(report.ok, false);
    assert.ok(report.problems.some((p) => /recipes/.test(p.message)), JSON.stringify(report.problems));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
