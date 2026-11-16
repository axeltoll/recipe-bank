// validateRecipe edges the schema cross-check does not hit: several problems at once,
// timestamps, a missing filename, and list shapes that currently throw.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateRecipe } from '../lib/recipe.mjs';
import { makeRecipe } from './helpers/bank.mjs';

const has = (errs, fragment) => assert.ok(errs.some((e) => e.includes(fragment)), `${fragment} missing from ${JSON.stringify(errs)}`);

test('a step timestamp of 0 or a fraction is kept; NaN, Infinity and non-numbers are not', () => {
  const withT = (t) => {
    const r = makeRecipe('alpha', 1);
    if (t === 'omit') delete r.components[0].steps[0].t;
    else r.components[0].steps[0].t = t;
    return validateRecipe(r, 'alpha');
  };
  assert.deepEqual(withT(0), []);
  assert.deepEqual(withT(12.5), []);
  assert.deepEqual(withT('omit'), []);
  for (const t of [NaN, Infinity, -Infinity, '3', true, false]) has(withT(t), 'steps[0].t must be seconds >= 0');
});

test('one recipe returns every problem, including the second component', () => {
  const r = {
    id: 'not a slug',
    status: 'partial',
    schema: false,
    tags: [''],
    notes: 'stir it',
    components: [
      { name: '  ', ingredients: [], steps: [] },
      {
        name: 'Second',
        ingredients: [{ item: '', key: 'Egg', basis: 'Spoken', amount: null }],
        steps: [{ text: '', t: -1 }],
      },
    ],
  };
  const errs = validateRecipe(r, 'alpha');
  for (const fragment of [
    'schema must be an integer',
    'id must be a kebab-case slug',
    'must match filename',
    'title is required',
    'summary is required',
    'analyzed must be YYYY-MM-DD',
    'tags must be lowercase strings',
    'notes must be an array of strings',
    'components[0].name is required',
    'components[1].ingredients[0].item is required',
    'components[1].ingredients[0].key must be a lowercase filter key',
    'components[1].ingredients[0].basis must be one of',
    'components[1].steps[0].text is required',
    'components[1].steps[0].t must be seconds',
    'partial recipes must list gaps',
  ]) has(errs, fragment);
  assert.ok(errs.length >= 15);
});

test('the filename is checked only when the caller passes one', () => {
  const r = makeRecipe('alpha', 1);
  assert.deepEqual(validateRecipe(r), []);
  assert.deepEqual(validateRecipe(r, 'alpha'), []);
  has(validateRecipe(r, 'beta'), 'id "alpha" must match filename "beta.json"');
});

test('an unstated amount may be omitted; blank tags, a blank gap and a double hyphen may not', () => {
  const r = makeRecipe('alpha', 1);
  delete r.components[0].ingredients[1].amount;
  assert.equal(r.components[0].ingredients[1].basis, 'unstated');
  assert.deepEqual(validateRecipe(r, 'alpha'), []);

  r.components[0].ingredients[1].amount = '';
  has(validateRecipe(r, 'alpha'), 'ingredients[1].amount must be null');

  const partial = makeRecipe('alpha', 1, { status: 'partial', gaps: ['  '] });
  const gaps = validateRecipe(partial, 'alpha');
  has(gaps, 'gaps must be an array of strings');
  assert.ok(!gaps.some((e) => e.includes('partial recipes must list gaps')), 'a whitespace gap still counts as an item');

  has(validateRecipe(makeRecipe('a--b', 2), 'a--b'), 'id must be a kebab-case slug');
  const keyed = makeRecipe('alpha', 1);
  keyed.components[0].ingredients[0].key = 'soy sauce';
  assert.deepEqual(validateRecipe(keyed, 'alpha'), [], 'a lowercase key may contain a space');
});

test('a null or non-array component, ingredient or step is a problem list', { todo: 'bug: validateRecipe throws TypeError instead of returning problems' }, () => {
  const base = () => makeRecipe('alpha', 1);
  const shapes = {
    'null component': (() => { const r = base(); r.components = [null]; return r; })(),
    'components string': (() => { const r = base(); r.components = 'nope'; return r; })(),
    'null ingredient': (() => { const r = base(); r.components[0].ingredients = [null]; return r; })(),
    'ingredients string': (() => { const r = base(); r.components[0].ingredients = 'salt'; return r; })(),
    'null step': (() => { const r = base(); r.components[0].steps = [null]; return r; })(),
    'steps number': (() => { const r = base(); r.components[0].steps = 5; return r; })(),
  };
  const thrown = [];
  for (const [name, recipe] of Object.entries(shapes)) {
    try {
      const errs = validateRecipe(recipe, 'alpha');
      if (!errs.some((e) => /component|ingredient|step/.test(e))) thrown.push(`${name} returned ${JSON.stringify(errs)}`);
    } catch (e) {
      thrown.push(`${name}: ${e.name}: ${e.message}`);
    }
  }
  assert.deepEqual(thrown, []);
});
