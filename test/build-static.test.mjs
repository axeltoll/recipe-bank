// The static build is what `npm run deploy` publishes, so it must not pick up a private bank from
// RECIPE_BANK_DIR. It builds this repository's data unless another folder is passed explicitly.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { makeRecipe, tempBank, ROOT } from './helpers/bank.mjs';

const exec = promisify(execFile);

async function privateBank(t) {
  const dir = await tempBank([makeRecipe('private-recipe', 1)]);
  await writeFile(join(dir, 'data', 'queue.json'), JSON.stringify([{
    id: 'q1', video: { platform: 'youtube', id: 'testvideo02', url: 'https://youtu.be/testvideo02' },
    note: 'private note', addedAt: '2026-11-01T00:00:00.000Z', status: 'queued',
  }]));
  const out = await mkdtemp(join(tmpdir(), 'recipe-bank-dist-'));
  t.after(() => Promise.all([rm(dir, { recursive: true, force: true }), rm(out, { recursive: true, force: true })]));
  return { dir, out };
}

// Imported in a child process so RECIPE_BANK_DIR is set before any module reads it.
async function build(env, options) {
  const code = `const { buildStatic } = await import(${JSON.stringify(pathToFileURL(join(ROOT, 'scripts', 'build-static.mjs')).href)});
    console.log(JSON.stringify(await buildStatic(${JSON.stringify(options)})));`;
  const { stdout } = await exec(process.execPath, ['--input-type=module', '-e', code], { env: { ...process.env, ...env } });
  return JSON.parse(stdout);
}

const builtIds = async (out) => JSON.parse(await readFile(join(out, 'api', 'recipes.json'), 'utf8')).recipes.map((r) => r.id).sort();
const repoIds = async () => (await readdir(join(ROOT, 'recipes'))).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)).sort();

test('buildStatic ignores RECIPE_BANK_DIR and builds this repository', async (t) => {
  const { dir, out } = await privateBank(t);
  await build({ RECIPE_BANK_DIR: dir }, { outDir: out });
  const ids = await builtIds(out);
  assert.ok(!ids.includes('private-recipe'), 'the private bank is not published');
  assert.deepEqual(ids, await repoIds());
  assert.doesNotMatch(await readFile(join(out, 'api', 'queue.json'), 'utf8'), /private note/);
});

test('buildStatic builds another folder only when it is passed explicitly', async (t) => {
  const { dir, out } = await privateBank(t);
  const counts = await build({ RECIPE_BANK_DIR: '' }, { outDir: out, dataDir: dir });
  assert.deepEqual(counts, { recipes: 1, queue: 1 });
  assert.deepEqual(await builtIds(out), ['private-recipe']);
});
