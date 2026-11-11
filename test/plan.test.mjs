import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import {
  DAYS, emptyPlan, normalizePlan, addToPlan, removeFromPlan, moveInPlan, isPlanned, planByDay, planRecipes,
  aisleOf, shoppingList, shoppingListForPlan, shoppingListText, lineAmount,
} from '../lib/plan.mjs';

const ing = (item, key, amount, basis = amount == null ? 'unstated' : 'spoken') => ({ item, key, amount, basis });
const alpha = {
  id: 'alpha', title: 'Alpha',
  components: [
    { name: 'Main', steps: [], ingredients: [
      ing('Chicken thighs', 'chicken', '800g'),
      ing('Salt', 'salt', null),
      ing('Garlic', 'garlic', '2 cloves', 'on-screen'),
    ] },
    { name: 'Sauce', steps: [], ingredients: [
      ing('Garlic, grated', 'garlic', '1 clove'),
      ing('Soy sauce', 'soy sauce', '2 tbsp', 'description'),
    ] },
  ],
};
const beta = {
  id: 'beta', title: 'Beta',
  components: [{ name: 'All', steps: [], ingredients: [
    ing('Chicken breast', 'chicken', '2 per person'),
    ing('Unobtainium', 'unobtainium', 'a pinch'),
  ] }],
};

test('normalizePlan cleans up stored or hand-edited plans', () => {
  assert.deepEqual(normalizePlan(null), emptyPlan());
  assert.deepEqual(normalizePlan('nonsense'), { version: 1, items: [] });
  assert.deepEqual(normalizePlan(['alpha', 'beta', 'alpha']).items, [
    { recipe: 'alpha', day: null }, { recipe: 'beta', day: null },
  ]);
  const p = normalizePlan({ items: [
    { recipe: 'a', day: 'sun' }, { recipe: 'b', day: 'mon' }, { recipe: 'c' }, { recipe: 'a', day: 'sun' },
    { recipe: '', day: 'mon' }, { recipe: 5 }, null, { recipe: 'd', day: 'funday' },
  ] });
  // Monday first, "any day" last, duplicates and junk dropped, unknown days become "any day".
  assert.deepEqual(p.items, [
    { recipe: 'b', day: 'mon' }, { recipe: 'a', day: 'sun' }, { recipe: 'c', day: null }, { recipe: 'd', day: null },
  ]);
  assert.deepEqual(normalizePlan(['a', 'gone'], ['a']).items, [{ recipe: 'a', day: null }]);
});

test('addToPlan adds once per day, validates, and never mutates', () => {
  const p0 = emptyPlan();
  const p1 = addToPlan(p0, 'alpha', 'mon');
  assert.equal(p0.items.length, 0);
  assert.deepEqual(addToPlan(p1, 'alpha', 'mon'), p1);
  const p2 = addToPlan(p1, 'alpha', 'thu');
  assert.deepEqual(p2.items, [{ recipe: 'alpha', day: 'mon' }, { recipe: 'alpha', day: 'thu' }]);
  assert.deepEqual(addToPlan(p2, 'beta').items.at(-1), { recipe: 'beta', day: null });
  assert.throws(() => addToPlan(p0, 'alpha', 'someday'), RangeError);
  assert.throws(() => addToPlan(p0, ''), TypeError);
  assert.equal(DAYS.length, 7);
});

const week = () => normalizePlan([
  { recipe: 'a', day: 'mon' }, { recipe: 'b', day: 'mon' }, { recipe: 'a', day: 'thu' }, { recipe: 'a' },
]);

test('removeFromPlan removes one day, the any-day slot, or the whole week', () => {
  assert.deepEqual(removeFromPlan(week(), 'a', 'thu').items, [
    { recipe: 'a', day: 'mon' }, { recipe: 'b', day: 'mon' }, { recipe: 'a', day: null },
  ]);
  assert.deepEqual(removeFromPlan(week(), 'a', null).items, [
    { recipe: 'a', day: 'mon' }, { recipe: 'b', day: 'mon' }, { recipe: 'a', day: 'thu' },
  ]);
  assert.deepEqual(removeFromPlan(week(), 'a').items, [{ recipe: 'b', day: 'mon' }]);
  assert.deepEqual(removeFromPlan(week(), 'nope').items, week().items);
});

test('moveInPlan moves, merges, and ignores recipes that are not planned there', () => {
  assert.deepEqual(moveInPlan(week(), 'b', 'mon', 'fri').items, [
    { recipe: 'a', day: 'mon' }, { recipe: 'a', day: 'thu' }, { recipe: 'b', day: 'fri' }, { recipe: 'a', day: null },
  ]);
  assert.deepEqual(moveInPlan(week(), 'a', 'mon', 'thu').items, [
    { recipe: 'b', day: 'mon' }, { recipe: 'a', day: 'thu' }, { recipe: 'a', day: null },
  ]);
  assert.deepEqual(moveInPlan(week(), 'b', 'tue', 'fri'), week());
  assert.throws(() => moveInPlan(week(), 'b', 'mon', 'later'), RangeError);
});

test('planByDay, isPlanned and planRecipes', () => {
  const byDay = planByDay(week());
  assert.deepEqual(byDay.mon, ['a', 'b']);
  assert.deepEqual(byDay.thu, ['a']);
  assert.deepEqual(byDay.any, ['a']);
  assert.deepEqual(byDay.sun, []);
  assert.equal(isPlanned(week(), 'b'), true);
  assert.equal(isPlanned(week(), 'z'), false);
  const resolved = planRecipes(normalizePlan([{ recipe: 'alpha', day: 'tue' }, 'ghost']), [alpha, beta]);
  assert.deepEqual(resolved, [{ recipe: alpha, day: 'tue' }]);
});

test('aisleOf: table, word rules, overrides', () => {
  assert.equal(aisleOf('chicken'), 'meat');
  assert.equal(aisleOf('chicken stock'), 'sauces');
  assert.equal(aisleOf(' Chicken '), 'meat');
  assert.equal(aisleOf('salt'), 'staples');
  assert.equal(aisleOf('lamb shoulder'), 'meat');
  assert.equal(aisleOf('smoked salmon'), 'meat');
  assert.equal(aisleOf('chipotle powder'), 'spices');
  assert.equal(aisleOf('pitta bread'), 'bakery');
  assert.equal(aisleOf('boiled sweets'), 'other'); // "oil" only matches as a whole word
  assert.equal(aisleOf('unobtainium'), 'other');
  assert.equal(aisleOf('salt', { salt: 'spices' }), 'spices');
  assert.equal(aisleOf('salt', { salt: 'nowhere' }), 'staples');
});

test('shoppingList merges by key and keeps every amount in the creator’s words', () => {
  const list = shoppingList([alpha, beta]);
  assert.equal(list.itemCount, 5);
  assert.equal(list.lineCount, 7);
  assert.deepEqual(list.groups.map((g) => g.aisle), ['produce', 'meat', 'sauces', 'other', 'staples']);
  const chicken = list.groups.find((g) => g.aisle === 'meat').items[0];
  assert.equal(chicken.key, 'chicken');
  assert.equal(chicken.recipes, 2);
  assert.deepEqual(chicken.lines.map((l) => [l.recipeId, l.amount, l.basis]), [
    ['alpha', '800g', 'spoken'], ['beta', '2 per person', 'spoken'],
  ]);
  const garlic = list.groups[0].items[0];
  assert.equal(garlic.recipes, 1);
  assert.deepEqual(garlic.lines.map((l) => [l.component, l.item, l.amount]), [
    ['Main', 'Garlic', '2 cloves'], ['Sauce', 'Garlic, grated', '1 clove'],
  ]);
  const salt = list.groups.at(-1).items[0];
  assert.equal(salt.unstated, true);
  assert.equal(salt.lines[0].amount, null);
  assert.equal(chicken.unstated, false);
  assert.deepEqual(list.recipes, [
    { id: 'alpha', title: 'Alpha', times: 1, days: [null] },
    { id: 'beta', title: 'Beta', times: 1, days: [null] },
  ]);
});

test('a recipe planned twice is counted, not listed twice', () => {
  const list = shoppingList([{ recipe: alpha, day: 'thu' }, { recipe: alpha, day: 'mon' }, { recipe: beta, day: null }]);
  assert.deepEqual(list.recipes[0], { id: 'alpha', title: 'Alpha', times: 2, days: ['mon', 'thu'] });
  const chicken = list.groups.find((g) => g.aisle === 'meat').items[0];
  assert.equal(chicken.lines.length, 2);
  assert.equal(lineAmount(chicken.lines[0]), '800g (cooking it 2 times)');
  assert.equal(lineAmount(chicken.lines[1]), '2 per person');
  assert.equal(list.groups[0].items[0].lines.length, 2);
});

test('shoppingList never shows an amount for an unstated ingredient, and skips junk entries', () => {
  const bad = { id: 'bad', title: 'Bad', components: [{ name: 'x', steps: [], ingredients: [ing('Salt', 'salt', '1 tsp', 'unstated')] }] };
  const list = shoppingList([bad, null, { nothing: true }, { recipe: { id: 'no-components' } }]);
  assert.equal(list.recipes.length, 1);
  assert.equal(list.groups[0].items[0].lines[0].amount, null);
  assert.equal(lineAmount(list.groups[0].items[0].lines[0]), 'amount not given');
  assert.deepEqual(shoppingList([]).groups, []);
});

test('shoppingListForPlan resolves the plan first', () => {
  const plan = addToPlan(addToPlan(emptyPlan(), 'beta', 'wed'), 'ghost', 'fri');
  const list = shoppingListForPlan(plan, [alpha, beta]);
  assert.deepEqual(list.recipes.map((r) => [r.id, r.days]), [['beta', ['wed']]]);
});

test('shoppingListText reads well, and leaves out ticked items', () => {
  const list = shoppingList([alpha, beta]);
  assert.equal(shoppingListText(list), [
    'Shopping list',
    'For: Alpha; Beta',
    '',
    'Fruit and veg:',
    '- garlic:',
    '    2 cloves, Alpha (Main)',
    '    1 clove, Alpha (Sauce)',
    '',
    'Meat and fish:',
    '- chicken:',
    '    800g, Alpha',
    '    2 per person, Beta',
    '',
    'Oils, sauces and tins:',
    '- soy sauce: 2 tbsp, Alpha',
    '',
    'Other:',
    '- unobtainium: a pinch, Beta',
    '',
    'Check the cupboard:',
    '- salt: amount not given, Alpha',
  ].join('\n'));
  const ticked = shoppingListText(list, { checked: new Set(['salt', 'unobtainium']), title: 'Week' });
  assert.ok(ticked.startsWith('Week\n'));
  assert.doesNotMatch(ticked, /Check the cupboard|Other:/);
  assert.match(shoppingListText(list, { sources: false }), /^- garlic$/m);
});

test('a list over every real recipe keeps every ingredient line', async () => {
  const dir = resolve(import.meta.dirname, '..', 'recipes');
  const recipes = [];
  for (const f of (await readdir(dir)).filter((f) => f.endsWith('.json'))) {
    recipes.push(JSON.parse(await readFile(join(dir, f), 'utf8')));
  }
  const total = recipes.reduce((n, r) => n + r.components.reduce((m, c) => m + c.ingredients.length, 0), 0);
  const list = shoppingList(recipes);
  assert.equal(list.lineCount, total);
  assert.equal(list.recipes.length, recipes.length);
  // Every key in the bank today has a real aisle; add new keys to AISLE_KEYS in lib/plan.mjs.
  const other = list.groups.find((g) => g.aisle === 'other');
  assert.equal(other, undefined, `keys without an aisle: ${other?.items.map((i) => i.key).join(', ')}`);
});
