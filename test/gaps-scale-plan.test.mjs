// Scale and plan branches the main suites do not assert: lead-in words, household
// serving words, filler words in `serves`, and shopping-list merging.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  formatFraction, normalizeSlashes, parseServes, scaleAmount, scaleRecipe, servingCount,
} from '../lib/scale.mjs';
import {
  addToPlan, aisleOf, emptyPlan, moveInPlan, shoppingList,
} from '../lib/plan.mjs';

test('words before a number scale with it, including zest and the short forms', () => {
  const cases = [
    ['around 2 cups', 2, 'around 4 cups'],
    ['roughly 3 tbsp', 0.5, 'roughly 1½ tbsp'],
    ['nearly 1 cup', 2, 'nearly 2 cups'],
    ['almost 4', 0.5, 'almost 2'],
    ['up to 2 tsp', 2, 'up to 4 tsp'],
    ['at least 1 egg', 3, 'at least 3 eggs'],
    ['max. 2 cloves', 2, 'max. 4 cloves'],
    ['min. 1 sheet', 2, 'min. 2 sheets'],
    ['ca. 200 g', 2, 'ca. 400 g'],
    ['zest of 1 lemon', 2, 'zest of 2 lemons'],
  ];
  for (const [input, factor, expected] of cases) {
    const r = scaleAmount(input, factor);
    assert.equal(r.amount, expected, input);
    assert.equal(r.reason, 'scaled', input);
  }
});

test('articles stay words, rates stay rates, and a size written first scales only its count', () => {
  assert.equal(scaleAmount('1 an onion', 2).reason, 'words');
  assert.equal(scaleAmount('1 an onion', 2).amount, '1 an onion');
  assert.equal(scaleAmount('2/head', 2).reason, 'per-unit');
  assert.equal(scaleAmount('1 / serving', 2).reason, 'per-unit');

  assert.equal(scaleAmount('1.2 cups', 2).amount, '2.4 cups');
  assert.equal(scaleAmount('1,2 cups', 2).amount, '2,4 cups');
  assert.equal(scaleAmount('400g x 2 tins', 2).amount, '400g x 4 tins');

  const slash = `1${String.fromCodePoint(0x2215)}2 cup`;
  assert.equal(normalizeSlashes(slash), '1/2 cup');
  assert.equal(scaleAmount(slash, 2).amount, '1 cup');
  assert.equal(formatFraction(1.01), '1');
});

test('serving words count as servings; in, on, to, and and or do not become the unit', () => {
  for (const [text, count] of [['4 people', 4], ['1 person', 1], ['2 persons', 2], ['3 plates', 3], ['2 meals', 2], ['1 portion', 1], ['1 serving', 1]]) {
    assert.equal(servingCount(text), count, text);
  }
  for (const text of ['4 in a pan', '4 on toast', '4 to serve', '4 and chips', '4 or nothing']) {
    assert.deepEqual(parseServes(text), { count: 4, unit: null }, text);
    assert.equal(servingCount(text), 4, text);
  }
  const bare = scaleRecipe({}, 2);
  assert.deepEqual(bare.components, []);
  assert.deepEqual(bare.scale, { factor: 2, scaled: 0, kept: 0, unstated: 0 });
  const noLists = scaleRecipe({ components: [{ name: 'Main' }] }, 3);
  assert.deepEqual(noLists.components[0].ingredients, []);
  assert.deepEqual(noLists.scale, { factor: 3, scaled: 0, kept: 0, unstated: 0 });
});

test('word rules place keys that are not in the aisle table', () => {
  const aisles = {
    mushroom: 'produce', kale: 'produce', courgette: 'produce', avocado: 'produce',
    beer: 'drinks', 'orange juice': 'drinks', whisky: 'drinks',
    oats: 'dry', noodles: 'dry', lentils: 'dry',
    bagel: 'bakery', naan: 'bakery',
    'ground nutmeg': 'spices',
    prawns: 'meat', chorizo: 'meat',
    yogurt: 'dairy', milk: 'dairy',
    'tinned tomatoes': 'sauces', 'strawberry jam': 'sauces',
  };
  for (const [key, aisle] of Object.entries(aisles)) assert.equal(aisleOf(key), aisle, key);
});

test('the shopping list merges case, skips a blank key, keeps notes, and counts a repeated recipe', () => {
  const eggs = {
    id: 'eggs', title: 'Eggs',
    components: [{ name: 'Pan', ingredients: [
      { item: 'Eggs', key: 'Egg', amount: '2', basis: 'spoken', note: 'large' },
      { item: 'Mystery', key: '  ', amount: '1', basis: 'spoken' },
      { item: 'Salt', key: 'salt', amount: 'a pinch', basis: 'spoken' },
    ] }],
  };
  const salted = {
    id: 'salted', title: 'Salted',
    components: [{ name: 'Bowl', ingredients: [{ item: 'Salt', key: 'SALT', amount: null, basis: 'unstated' }] }],
  };
  const once = shoppingList([eggs]);
  assert.equal(once.lineCount, 2, 'a blank key is not a line');
  const egg = once.groups.flatMap((g) => g.items).find((it) => it.key === 'egg');
  assert.equal(egg.lines[0].note, 'large');
  assert.equal(egg.aisle, 'dairy');

  const moved = shoppingList([eggs], { aisles: { egg: 'other' } });
  assert.equal(moved.groups.find((g) => g.items.some((it) => it.key === 'egg')).aisle, 'other');

  const both = shoppingList([eggs, salted]);
  const salt = both.groups.flatMap((g) => g.items).find((it) => it.key === 'salt');
  assert.equal(salt.lines.length, 2);
  assert.equal(salt.unstated, false, 'one stated amount keeps the line from being unstated');

  const twice = shoppingList([eggs, eggs]);
  assert.deepEqual(twice.recipes[0], { id: 'eggs', title: 'Eggs', times: 2, days: [null] });
  assert.equal(twice.groups.flatMap((g) => g.items).find((it) => it.key === 'egg').lines[0].times, 2);

  const days = shoppingList([
    { recipe: eggs, day: 'sun' },
    { recipe: eggs, day: null },
    { recipe: eggs, day: 'mon' },
  ]);
  assert.deepEqual(days.recipes[0].days, ['mon', 'sun', null]);
  assert.equal(days.recipes[0].times, 3);

  const empty = shoppingList([{ id: 'x', title: 'X', components: [{ name: 'Main' }] }]);
  assert.equal(empty.recipes.length, 1);
  assert.equal(empty.lineCount, 0);
  assert.deepEqual(empty.groups, []);
});

test('any-day moves onto a weekday, and a blank recipe id is rejected', () => {
  const plan = addToPlan(addToPlan(emptyPlan(), 'alpha', null), 'alpha', 'mon');
  assert.deepEqual(moveInPlan(plan, 'alpha', null, 'wed').items, [
    { recipe: 'alpha', day: 'mon' },
    { recipe: 'alpha', day: 'wed' },
  ]);
  assert.deepEqual(moveInPlan(plan, 'alpha', 'mon', null).items, [
    { recipe: 'alpha', day: null },
  ]);
  assert.throws(() => addToPlan(emptyPlan(), '   '), TypeError);
});
