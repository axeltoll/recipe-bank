import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import {
  DEFAULT_PANTRY, FLAGS, parseMeasure, unitKey, normalizePantry, purchaseList, householdLine, purchaseListText, planCostEstimate,
} from '../lib/purchase.mjs';
import { defaultProfile } from '../lib/household.mjs';
import { emptyPlan } from '../lib/plan.mjs';

const ing = (item, key, amount, basis = amount == null ? 'unstated' : 'spoken') => ({ item, key, amount, basis });
const recipe = (id, serves, ingredients, title = id) => ({ id, title, serves, components: [{ name: 'Main', steps: [], ingredients }] });
const household = (people) => ({ ...defaultProfile(), people: { ...defaultProfile().people, adult: 0, ...people } });
const adults = (n) => household({ adult: n });
const plan = (...items) => ({ items: items.map((x) => (typeof x === 'string' ? { recipe: x, day: null } : x)) });
const items = (p) => p.groups.flatMap((g) => g.items);
const item = (p, key) => items(p).find((it) => it.key === key);
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} ≈ ${b}`);

const alpha = recipe('alpha', '4', [
  ing('Chicken thighs', 'chicken', '800g'),
  ing('Basmati rice', 'rice', '1 1/2 cups'),
  ing('Onion', 'onion', '1 large'),
  ing('Salt', 'salt', 'a pinch'),
  ing('Oil', 'cooking oil', null),
  ing('Garlic', 'garlic', '2–3 cloves'),
  ing('Coconut milk', 'coconut milk', '1 can'),
], 'Alpha');

// ---------- reading amounts ----------

const measures = [
  // [creator's amount, lo, hi, unit, base, size, approx]
  ['800g', 800, 800, 'g', 'g', 1, false],
  ['1.5dl', 1.5, 1.5, 'dl', 'ml', 100, false],
  ['1,5 dl', 1.5, 1.5, 'dl', 'ml', 100, false],
  ['1,000 g', 1000, 1000, 'g', 'g', 1, false],
  ['2 kilos', 2, 2, 'kg', 'g', 1000, false],
  ['2 lb (~907 g)', 2, 2, 'lb', 'oz', 16, false],
  ['½ cup (about 110 g)', 0.5, 0.5, 'cup', 'cup', 1, false],
  ['about 1 cup', 1, 1, 'cup', 'cup', 1, true],
  ['~ 100 ml', 100, 100, 'ml', 'ml', 1, true],
  ['approx. 200 g', 200, 200, 'g', 'g', 1, true],
  ['1 1/2 cups', 1.5, 1.5, 'cup', 'cup', 1, false],
  ['1½ cups', 1.5, 1.5, 'cup', 'cup', 1, false],
  ['1 ½ tsp', 1.5, 1.5, 'tsp', 'tsp', 1, false],
  ['¾ tbsp', 0.75, 0.75, 'tbsp', 'tbsp', 1, false],
  ['3 Tbsp', 3, 3, 'tbsp', 'tbsp', 1, false],
  ['2–3 cloves', 2, 3, 'clove', 'clove', 1, false],
  ['2 to 3 cloves', 2, 3, 'clove', 'clove', 1, false],
  ['1/2–1', 0.5, 1, '', '', 1, false],
  ['7', 7, 7, '', '', 1, false],
  ['Juice of 1/2 lime', 0.5, 0.5, 'lime', 'lime', 1, false],
  ['1 large', 1, 1, 'large', 'large', 1, false],
  ['2 whole garlic bulbs', 2, 2, 'whole garlic bulb', 'whole garlic bulb', 1, false],
  ['1 tsp each', 1, 1, 'tsp', 'tsp', 1, false],
  ['2 heaped tbsp', 2, 2, 'heaped tbsp', 'heaped tbsp', 1, false],
  ['4 bunches', 4, 4, 'bunch', 'bunch', 1, false],
  ['2 tomatoes', 2, 2, 'tomato', 'tomato', 1, false],
  ['20 g (for both)', 20, 20, 'g', 'g', 1, false],
];

test('parseMeasure reads plain amounts: fractions, mixed numbers, unicode, ranges, units', () => {
  for (const [input, lo, hi, unit, base, size, approx] of measures) {
    const m = parseMeasure(input);
    assert.ok(m, input);
    close(m.lo, lo);
    close(m.hi, hi);
    assert.equal(m.unit, unit, input);
    assert.equal(m.base, base, input);
    assert.equal(m.size, size, input);
    assert.equal(m.approx, approx, input);
  }
});

test('parseMeasure refuses words, rates, two measures, pack sizes and broken numbers', () => {
  for (const input of [
    'a good amount', 'a couple', 'enough for 12 subs', '½ a garlic head', '200g / 2dl', '2 x 400g tins', '500g 5% beef mince',
    '1 tsp spoken / 1 tbsp in description', '2 per person', '1/0 cup', '0 g', '3–2 cups', '5%', '1 cup or 2', null, '', '   ', 42,
  ]) {
    assert.equal(parseMeasure(input), null, String(input));
  }
});

test('unitKey gives the base unit a price or amount adds up in', () => {
  assert.deepEqual(unitKey('kg'), { base: 'g', size: 1000 });
  assert.deepEqual(unitKey('g'), { base: 'g', size: 1 });
  assert.deepEqual(unitKey('dl'), { base: 'ml', size: 100 });
  assert.deepEqual(unitKey('Litres'), { base: 'ml', size: 1000 });
  assert.deepEqual(unitKey('Pounds'), { base: 'oz', size: 16 });
  assert.deepEqual(unitKey('cans'), { base: 'can', size: 1 });
  assert.deepEqual(unitKey('large onions'), { base: 'large onion', size: 1 });
  assert.deepEqual(unitKey(''), { base: '', size: 1 });
  assert.deepEqual(unitKey('each'), { base: '', size: 1 });
  assert.equal(unitKey('400g'), null);
  assert.equal(unitKey('a can'), null);
  assert.equal(unitKey(42), null);
});

test('normalizePantry cleans a list or a typed text', () => {
  assert.deepEqual(normalizePantry('Salt, black  pepper;\nsalt,, '), ['salt', 'black pepper']);
  assert.deepEqual(normalizePantry([1, null, 'x'.repeat(61), ' Oil ', 'oil']), ['oil']);
  assert.deepEqual(normalizePantry(null), []);
  assert.deepEqual(normalizePantry({ salt: true }), []);
  assert.equal(normalizePantry(Array.from({ length: 150 }, (_, i) => `k${i}`)).length, 100);
  assert.deepEqual([...DEFAULT_PANTRY], ['salt', 'black pepper', 'cooking oil']);
  assert.ok(Object.isFrozen(DEFAULT_PANTRY));
});

// ---------- the purchase list ----------

test('one recipe for two adults: halved from 4 servings, words and unstated amounts flagged', () => {
  const p = purchaseList(plan('alpha'), [alpha], adults(2));
  assert.equal(p.servings, 2);
  assert.equal(p.household, '2 adults');
  assert.equal(p.people, 2);
  assert.equal(p.meals, 1);
  assert.equal(p.recipes.length, 1);
  assert.equal(p.recipes[0].factor, 0.5);
  assert.equal(p.recipes[0].servesCount, 4);
  assert.equal(p.recipes[0].flag, null);
  assert.equal(p.itemCount, 7);
  assert.equal(p.flaggedCount, 2);
  assert.deepEqual(p.leftOut, []);
  assert.deepEqual(p.groups.map((g) => g.aisle), ['produce', 'meat', 'dry', 'sauces', 'staples']);

  assert.equal(item(p, 'chicken').amount, '400 g');
  assert.equal(item(p, 'rice').amount, '¾ cup');
  assert.equal(item(p, 'onion').amount, '½ large');
  assert.equal(item(p, 'garlic').amount, '1–1½ cloves');
  assert.equal(item(p, 'coconut milk').amount, '½ can');

  const chicken = item(p, 'chicken');
  assert.equal(chicken.flagged, false);
  assert.deepEqual(chicken.flags, []);
  assert.deepEqual(chicken.parts, [{ kind: 'total', unit: 'g', lo: 400, hi: 400, approx: false, text: '400 g', sources: [0] }]);
  assert.deepEqual(chicken.sources[0], {
    recipeId: 'alpha', title: 'Alpha', component: 'Main', item: 'Chicken thighs', original: '800g', basis: 'spoken', note: null,
    times: 1, factor: 0.5, status: 'added', amount: '400g', measure: { lo: 800, hi: 800, unit: 'g', approx: false },
  });

  const salt = item(p, 'salt');
  assert.equal(salt.amount, 'a pinch');
  assert.deepEqual(salt.flags, ['words']);
  assert.equal(salt.flagged, true);
  assert.deepEqual(salt.parts, [{ kind: 'text', unit: null, text: 'a pinch', flag: 'words', sources: [0] }]);

  const oil = item(p, 'cooking oil');
  assert.equal(oil.amount, null);
  assert.deepEqual(oil.flags, ['unstated']);
  assert.deepEqual(oil.parts, []);
  assert.equal(oil.sources[0].status, 'unstated');
});

test('a recipe planned twice and a second recipe: same units add up, different units stay apart', () => {
  const beta = recipe('beta', '2', [
    ing('Chicken breast', 'chicken', '1 kg'),
    ing('Rice', 'rice', '200 g'),
    ing('Garlic', 'garlic', '4 cloves'),
  ], 'Beta');
  const p = purchaseList(plan({ recipe: 'alpha', day: 'mon' }, { recipe: 'alpha', day: 'thu' }, { recipe: 'beta', day: 'tue' }), [alpha, beta], adults(2));
  assert.equal(p.meals, 3);
  assert.deepEqual(p.recipes.map((r) => [r.id, r.times, r.factor]), [['alpha', 2, 0.5], ['beta', 1, 1]]);
  assert.deepEqual(p.recipes[0].days, ['mon', 'thu']);

  // 800 g × ½ × 2 + 1 kg = 1.8 kg; shown in kg because a creator used kg.
  const chicken = item(p, 'chicken');
  assert.equal(chicken.amount, '1.8 kg');
  assert.equal(chicken.parts.length, 1);
  close(chicken.parts[0].lo, 1800);
  assert.deepEqual(chicken.parts[0].sources, [0, 1]);
  assert.equal(chicken.sources[0].times, 2);
  assert.equal(chicken.sources[0].amount, '800g', 'half the recipe twice is the creator amount');
  assert.equal(chicken.sources[1].amount, '1 kg');

  // Cups and grams are never merged.
  const rice = item(p, 'rice');
  assert.equal(rice.amount, '1½ cups + 200 g');
  assert.deepEqual(rice.parts.map((x) => x.unit), ['cup', 'g']);

  // A range plus an exact amount: 2–3 + 4 cloves.
  assert.equal(item(p, 'garlic').amount, '6–7 cloves');

  // Words are kept, with how often the recipe is cooked.
  assert.equal(item(p, 'salt').amount, 'a pinch (cooking it 2 times)');
});

test('fractions, mixed numbers, unicode, exact metric units, approximations and kilograms', () => {
  const eps = recipe('eps', '2 servings', [
    ing('Butter', 'butter', '½ cup'),
    ing('Butter', 'butter', '1 1/2 cups'),
    ing('Sugar', 'sugar', '1½ tbsp'),
    ing('Sugar', 'sugar', '¾ tbsp'),
    ing('Milk', 'milk', '1.5dl'),
    ing('Milk', 'milk', '200 ml'),
    ing('Beef', 'beef', '2 lb (~907 g)'),
    ing('Beef', 'beef', '8 oz'),
    ing('Cream', 'heavy cream', 'about 1 cup'),
    ing('Cream', 'heavy cream', '1 cup'),
    ing('Pasta', 'pasta', '600g'),
    ing('Pasta', 'pasta', '500 g'),
    ing('Stock', 'chicken stock', '1,5 dl'),
    ing('Stock', 'chicken stock', '1 l'),
  ]);
  const p = purchaseList(plan('eps'), [eps], adults(2));
  assert.equal(p.recipes[0].factor, 1);
  assert.equal(item(p, 'butter').amount, '2 cups');
  assert.equal(item(p, 'sugar').amount, '2¼ tbsp');
  assert.equal(item(p, 'milk').amount, '3.5 dl');
  assert.equal(item(p, 'beef').amount, '2.5 lb');
  assert.equal(item(p, 'heavy cream').amount, 'about 2 cups');
  assert.equal(item(p, 'pasta').amount, '1.1 kg');
  assert.equal(item(p, 'chicken stock').amount, '1.15 l');
  close(item(p, 'chicken stock').parts[0].lo, 1150);
  // At ×1 every source keeps the creator's exact text.
  assert.deepEqual(item(p, 'butter').sources.map((s) => s.amount), ['½ cup', '1 1/2 cups']);
  assert.equal(p.flaggedCount, 0);
});

test('a recipe with serves null is flagged and shown as written, next to scaled amounts', () => {
  const gamma = recipe('gamma', null, [ing('Pork mince', 'pork', '500g'), ing('Chicken', 'chicken', '2 per person'), ing('Salt', 'salt', null)]);
  const p = purchaseList(plan('alpha', 'gamma'), [alpha, gamma], adults(2));
  const g = p.recipes.find((r) => r.id === 'gamma');
  assert.equal(g.flag, 'serves-unstated');
  assert.equal(g.factor, null);
  assert.equal(FLAGS[g.flag], 'servings not stated, shown as written');

  const pork = item(p, 'pork');
  assert.equal(pork.amount, '500g');
  assert.deepEqual(pork.flags, ['serves-unstated']);
  assert.deepEqual(pork.parts, [{ kind: 'text', unit: null, text: '500g', flag: 'serves-unstated', sources: [0] }]);

  const chicken = item(p, 'chicken');
  assert.equal(chicken.amount, '400 g + 2 per person');
  assert.deepEqual(chicken.flags, ['serves-unstated']);
  // An unstated amount stays "unstated", whatever the recipe serves.
  assert.deepEqual(item(p, 'salt').sources.map((s) => s.status), ['words', 'unstated']);
});

test('serves that counts items, or is not a plain number, is not treated as servings', () => {
  const nuggets = recipe('nuggets', 'about 12 nuggets', [ing('Chicken', 'chicken', '680 g')]);
  const rate = recipe('rate', '2 thighs per person', [ing('Thighs', 'chicken', '2 per person')]);
  const bowls = recipe('bowls', '10 bowls', [ing('Chicken', 'chicken', '1600g')]);
  const p = purchaseList(plan('nuggets', 'rate', 'bowls'), [nuggets, rate, bowls], adults(2));
  assert.deepEqual(p.recipes.map((r) => [r.id, r.flag, r.factor]), [['nuggets', 'serves-items', null], ['rate', 'serves-unclear', null], ['bowls', null, 0.2]]);
  const chicken = item(p, 'chicken');
  assert.equal(chicken.amount, '320 g + 680 g + 2 per person');
  assert.deepEqual(chicken.flags, ['serves-items', 'serves-unclear']);

  // The user's own answer for a recipe can be passed in; it is never guessed.
  const q = purchaseList(plan('nuggets'), [nuggets], adults(2), { servesOverride: { nuggets: 4, other: 2 } });
  assert.equal(q.recipes[0].factor, 0.5);
  assert.equal(item(q, 'chicken').amount, '340 g');
  for (const bad of [0, -1, 'x', null]) {
    assert.equal(purchaseList(plan('nuggets'), [nuggets], adults(2), { servesOverride: { nuggets: bad } }).recipes[0].flag, 'serves-items', String(bad));
  }
});

test('words, rates, unreadable numbers and amounts scaled but kept apart', () => {
  const delta = recipe('delta', '4', [
    ing('Parsley', 'parsley', 'a few sprigs'),
    ing('Queso', 'queso', '1/0 cup'),
    ing('Buns', 'burger bun', '1 per burger'),
    ing('Stock', 'chicken stock', '200g / 2dl'),
    ing('Tomatoes', 'tomato', '2 x 400g tins'),
    ing('Garlic', 'garlic', '½ a garlic head'),
  ]);
  const p = purchaseList(plan('delta'), [delta], adults(2));
  const status = (key) => item(p, key).sources[0].status;
  assert.equal(status('parsley'), 'words');
  assert.equal(status('queso'), 'unparsed');
  assert.equal(status('burger bun'), 'per-unit');
  assert.equal(status('chicken stock'), 'scaled');
  assert.equal(status('tomato'), 'scaled');
  assert.equal(status('garlic'), 'words');
  assert.equal(item(p, 'queso').amount, '1/0 cup');
  assert.equal(item(p, 'burger bun').amount, '1 per burger');
  assert.equal(item(p, 'chicken stock').amount, '100g / 1dl');
  assert.equal(item(p, 'chicken stock').flagged, false);
  assert.deepEqual(item(p, 'chicken stock').parts, [{ kind: 'text', unit: null, text: '100g / 1dl', flag: null, sources: [0] }]);
  assert.equal(item(p, 'tomato').amount, '1 x 400g tins');
  assert.equal(p.flaggedCount, 4);
});

test('an empty plan, unknown recipes and a missing profile', () => {
  for (const p of [purchaseList(emptyPlan(), [alpha], adults(2)), purchaseList(null, null, null), purchaseList(plan('ghost'), [alpha], adults(2))]) {
    assert.deepEqual(p.groups, []);
    assert.deepEqual(p.recipes, []);
    assert.deepEqual(p.leftOut, []);
    assert.equal(p.meals, 0);
    assert.equal(p.itemCount, 0);
    assert.equal(p.flaggedCount, 0);
  }
  // No profile: the household module's default (two adults).
  assert.equal(purchaseList(null, null, null).servings, 2);
  assert.equal(purchaseList(null, null, null).household, '2 adults');
});

test('a household of one toddler gets a twentieth of a recipe for four', () => {
  const p = purchaseList(plan('alpha'), [alpha], household({ toddler: 1 }));
  assert.equal(p.servings, 0.2);
  assert.equal(p.household, '1 toddler under 2');
  assert.equal(p.people, 1);
  close(p.recipes[0].factor, 0.05);
  assert.equal(item(p, 'chicken').amount, '40 g');
  assert.equal(item(p, 'coconut milk').amount, '0.05 can');
  assert.equal(item(p, 'garlic').amount, '0.1–0.15 clove');
  assert.equal(householdLine(p), 'For 1 toddler under 2 (0.2 servings per meal)');
});

test('a mixed household: 2 adults and a child aged 6-10 is 2.6 servings', () => {
  const p = purchaseList(plan('alpha'), [alpha], household({ adult: 2, child6to10: 1 }));
  assert.equal(p.servings, 2.6);
  assert.equal(p.people, 3);
  assert.equal(householdLine(p), 'For 2 adults, 1 child aged 6-10 (2.6 servings per meal)');
  assert.equal(item(p, 'chicken').amount, '520 g'); // 800 g × 2.6 / 4
  assert.equal(householdLine(purchaseList(null, null, adults(1))), 'For 1 adult (1 serving per meal)');
});

test('the pantry leaves keys out and says which', () => {
  const p = purchaseList(plan('alpha'), [alpha], adults(2), { pantry: DEFAULT_PANTRY });
  assert.deepEqual(p.leftOut, ['cooking oil', 'salt']);
  assert.equal(item(p, 'salt'), undefined);
  assert.equal(p.groups.some((g) => g.aisle === 'staples'), false);
  assert.equal(p.itemCount, 5);
  assert.equal(p.flaggedCount, 0);
  const typed = purchaseList(plan('alpha'), [alpha], adults(2), { pantry: ' Garlic , ONION' });
  assert.deepEqual(typed.leftOut, ['garlic', 'onion']);
});

test('purchaseListText: grouped by aisle, flags spelled out, ticked items and pantry left out', () => {
  const p = purchaseList(plan('alpha'), [alpha], adults(2), { pantry: DEFAULT_PANTRY });
  assert.equal(purchaseListText(p), [
    'Purchase list',
    'For 2 adults (2 servings per meal)',
    'Meals: Alpha',
    '',
    'Fruit and veg:',
    '- garlic: 1–1½ cloves',
    '- onion: ½ large',
    '',
    'Meat and fish:',
    '- chicken: 400 g',
    '',
    'Pasta, rice and baking:',
    '- rice: ¾ cup',
    '',
    'Oils, sauces and tins:',
    '- coconut milk: ½ can',
    '',
    'Left out, you have these: cooking oil, salt',
  ].join('\n'));
  const ticked = purchaseListText(p, { checked: new Set(['chicken']), title: 'Shop' });
  assert.match(ticked, /^Shop\n/);
  assert.doesNotMatch(ticked, /Meat and fish|chicken/);

  const all = purchaseListText(purchaseList(plan({ recipe: 'alpha', day: 'mon' }, { recipe: 'alpha', day: 'tue' }), [alpha], adults(2)), { sources: true });
  assert.match(all, /Meals: Alpha \(×2\)/);
  assert.match(all, /- salt: a pinch \(cooking it 2 times\) \(check: given in words, shown as written\)/);
  assert.match(all, /- cooking oil: amount not given \(check: amount not given\)/);
  assert.match(all, /- chicken: 800 g\n {4}800g \(cooking it 2 times\), Alpha/);
  assert.doesNotMatch(all, /Left out/);
});

test('planCostEstimate uses the budget’s recorded spend per meal', () => {
  const p = purchaseList(plan({ recipe: 'alpha', day: 'mon' }, { recipe: 'alpha', day: 'tue' }, 'alpha'), [alpha], household({ adult: 2, child6to10: 1 }));
  assert.equal(p.meals, 3);
  assert.deepEqual(planCostEstimate(p, { currency: 'SEK', perMealMinor: 4550 }), {
    currency: 'SEK', perMealMinor: 4550, meals: 3, totalMinor: 13650, perPersonMinor: 4550,
  });
  assert.equal(planCostEstimate(p, { currency: 'SEK', perMealMinor: null }), null);
  assert.equal(planCostEstimate(p, null), null);
  assert.equal(planCostEstimate(p, { perMealMinor: 1.5 }), null);
  assert.equal(planCostEstimate(purchaseList(emptyPlan(), [alpha], adults(2)), { perMealMinor: 100 }), null);
  assert.equal(planCostEstimate({ meals: 1, people: 0 }, { perMealMinor: 100 }).perPersonMinor, null);
});

test('real recipes: every amount is added, scaled apart or flagged, never garbled', async () => {
  const dir = resolve(import.meta.dirname, '..', 'recipes');
  const recipes = [];
  for (const f of (await readdir(dir)).filter((f) => f.endsWith('.json'))) recipes.push(JSON.parse(await readFile(join(dir, f), 'utf8')));
  const known = new Set(['added', 'scaled', ...Object.keys(FLAGS)]);
  for (const profile of [defaultProfile(), household({ toddler: 1 }), household({ adult: 5, teen: 3 })]) {
    const p = purchaseList(plan(...recipes.map((r) => r.id)), recipes, profile, { pantry: DEFAULT_PANTRY });
    assert.equal(p.recipes.length, recipes.length);
    let added = 0;
    for (const it of items(p)) {
      assert.doesNotMatch(it.amount ?? '', /NaN|undefined|Infinity|null/, it.key);
      if (!it.flagged) assert.ok(it.amount, `${it.key} has an amount or a flag`);
      for (const part of it.parts) if (part.kind === 'total') assert.ok(part.lo > 0 && part.hi >= part.lo, it.key);
      for (const s of it.sources) {
        assert.ok(known.has(s.status), `${it.key}: ${s.status}`);
        if (s.status === 'added') added++;
      }
    }
    assert.ok(added >= 6, `only ${added} amounts added up`);
  }

  // Two recipes that state servings: the feta bake serves 4, the tandoori bowls make 10 bowls.
  const p = purchaseList(plan('feta-chicken-pasta-bake', 'tandoori-butter-chicken-bowls'), recipes, defaultProfile());
  assert.equal(item(p, 'chicken').amount, '620 g'); // 600 g × 2/4 + 1600 g × 2/10
  assert.equal(item(p, 'tomato').amount, '250 g');
  assert.deepEqual(item(p, 'tomato').flags, ['unstated']);
  assert.equal(item(p, 'garlic').amount, '½ a garlic head');
  assert.deepEqual(item(p, 'garlic').flags, ['words', 'unstated']);
});
