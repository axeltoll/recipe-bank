// scripts/pack.mjs against a temporary data folder.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { exportPack, packLink, serializePack } from '../lib/pack.mjs';
import { makeRecipe, tempBank, recipeText, runScript } from './helpers/bank.mjs';

const alpha = makeRecipe('alpha', 1);
const beta = makeRecipe('beta', 2);
let dir;
let env;
const pack = (...args) => runScript('pack.mjs', args, env);
const listFiles = async () => (await readdir(join(dir, 'recipes'))).sort();

before(async () => {
  dir = await tempBank([alpha, beta]);
  env = { RECIPE_BANK_DIR: dir };
});
after(() => rm(dir, { recursive: true, force: true }));

test('export writes a pack file, prints one, or prints a link', async () => {
  const out = join(dir, 'out.json');
  let r = await pack('export', 'alpha', '--title', 'Just alpha', '--out', out);
  assert.equal(r.code, 0, r.stderr);
  const saved = JSON.parse(await readFile(out, 'utf8'));
  assert.equal(saved.format, 'recipe-bank-pack');
  assert.equal(saved.title, 'Just alpha');
  assert.deepEqual(saved.recipes, [alpha]);

  r = await pack('export', 'alpha', 'beta');
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout).recipes.map((x) => x.id), ['alpha', 'beta']);

  r = await pack('export', '--all');
  assert.deepEqual(JSON.parse(r.stdout).recipes.map((x) => x.id), ['alpha', 'beta']);

  r = await pack('export', 'alpha', '--link', '--base', 'http://localhost:9999/');
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout.trim(), /^http:\/\/localhost:9999\/#pack=[A-Za-z0-9_-]+$/);

  r = await pack('export', 'alpha', 'nope');
  assert.equal(r.code, 1);
  assert.match(r.stderr, /Not in the bank \(or invalid\): nope/);

  r = await pack('export');
  assert.equal(r.code, 2);
});

test('import is a dry run by default and --write only creates new files', async () => {
  const file = join(dir, 'incoming.json');
  await writeFile(file, serializePack(exportPack([makeRecipe('gamma', 3), makeRecipe('alpha', 4), makeRecipe('delta', 1)], { title: 'Incoming' })));
  const before = await listFiles();

  let r = await pack('import', file);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /Pack "Incoming"/);
  assert.match(r.stdout, /\+ new +gamma/);
  assert.match(r.stdout, /\+ renamed +alpha → alpha-2/);
  assert.match(r.stdout, /= duplicate +delta \(same video as alpha\)/);
  assert.match(r.stdout, /Dry run: 2 recipe file\(s\) would be created/);
  assert.deepEqual(await listFiles(), before);

  r = await pack('import', file, '--write');
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /2 recipe file\(s\) created/);
  assert.deepEqual(await listFiles(), ['alpha-2.json', 'alpha.json', 'beta.json', 'gamma.json']);
  assert.equal(await readFile(join(dir, 'recipes', 'alpha.json'), 'utf8'), recipeText(alpha));

  r = await pack('import', file, '--write');
  assert.match(r.stdout, /Nothing to import|0 recipe file/);
  assert.equal((await listFiles()).length, 4);
});

test('import reads pack links and refuses broken input', async () => {
  const link = packLink(exportPack([makeRecipe('zeta', 8)]), 'http://127.0.0.1:4780/');
  let r = await pack('import', link);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /\+ new +zeta/);

  const bad = join(dir, 'bad.json');
  await writeFile(bad, '{"format":"zip"}');
  r = await pack('import', bad);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /not a recipe pack/);

  r = await pack('import', join(dir, 'missing.json'));
  assert.equal(r.code, 1);
  assert.match(r.stderr, /Cannot read/);

  r = await pack('frobnicate');
  assert.equal(r.code, 2);
});
