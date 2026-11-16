// Pack import edges: a recipe with more problems than the preview shows, values that
// cannot be serialised, include versus exclude, and a bank full of junk names.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PACK_FORMAT, PACK_VERSION, applyImport, planImport, readPack } from '../lib/pack.mjs';
import { validateRecipe } from '../lib/recipe.mjs';
import { makeRecipe } from './helpers/bank.mjs';

const wrap = (recipes, extra = {}) => ({ format: PACK_FORMAT, version: PACK_VERSION, title: 'T', recipes, ...extra });

test('a recipe with more than 20 contract problems keeps the first 20 and counts the rest', () => {
  const broken = makeRecipe('alpha', 1);
  broken.components[0].ingredients = Array.from({ length: 8 }, () => ({}));
  const errs = validateRecipe(broken);
  assert.ok(errs.length > 20, `expected more than 20 problems, got ${errs.length}`);
  const read = readPack(wrap([broken]));
  assert.equal(read.ok, true);
  const entry = read.entries[0];
  assert.equal(entry.recipe, null);
  assert.equal(entry.problems.length, 21);
  assert.deepEqual(entry.problems.slice(0, 20), errs.slice(0, 20));
  assert.equal(entry.problems[20], `…and ${errs.length - 20} more`);
});

test('a circular pack and a pack containing a bigint are refused without throwing', () => {
  const circular = wrap([makeRecipe('alpha', 1)]);
  circular.self = circular;
  const round = readPack(circular);
  assert.equal(round.ok, false);
  assert.deepEqual(round.errors, ['This is not a recipe pack.']);
  assert.deepEqual(round.entries, []);

  const huge = wrap([makeRecipe('alpha', 1)]);
  huge.recipes[0].n = 1n;
  assert.deepEqual(readPack(huge).errors, ['This is not a recipe pack.']);
});

test('include wins over exclude, and an empty include selects nothing', () => {
  const pack = wrap([makeRecipe('alpha', 1), makeRecipe('beta', 2)]);
  const plan = planImport(pack, []);
  const picked = applyImport(plan, { include: [1], exclude: [1, 0] });
  assert.deepEqual(picked.files.map((f) => f.id), ['beta']);
  assert.deepEqual(picked.skipped.map((s) => [s.index, s.reason]), [[0, 'not selected']]);

  const none = applyImport(plan, { include: [] });
  assert.deepEqual(none.files, []);
  assert.deepEqual(none.skipped.map((s) => s.reason), ['not selected', 'not selected']);
});

test('names that are not strings, and entries with no video, only occupy an id', () => {
  const pack = wrap([makeRecipe('alpha', 1), makeRecipe('beta', 2)]);
  const plan = planImport(pack, [null, 1, { id: 5 }, { id: 'alpha' }, { video: null }]);
  assert.equal(plan.ok, true);
  assert.deepEqual(plan.counts, { new: 1, conflict: 1, duplicate: 0, invalid: 0 });
  assert.equal(plan.items[0].status, 'conflict');
  assert.equal(plan.items[0].id, 'alpha-2');
  assert.equal(plan.items[0].recipe.id, 'alpha-2');
  assert.equal(plan.items[1].status, 'new');
  assert.equal(plan.items[1].id, 'beta');
});
