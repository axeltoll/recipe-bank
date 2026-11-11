// Probes of serving scaling (lib/scale.mjs) and purchase amounts (lib/purchase.mjs): every amount in
// the bank, unusual number forms, dual units, pack sizes, huge and tiny factors. Real bugs are marked
// `todo`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { scaleAmount, scaleRecipe, parseServes, factorFor, formatFraction, formatDecimal, parseNumber } from '../lib/scale.mjs';
import { parseMeasure, purchaseList, purchaseListText, DEFAULT_PANTRY } from '../lib/purchase.mjs';
import { defaultProfile } from '../lib/household.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const RECIPES = readdirSync(join(ROOT, 'recipes')).filter((f) => f.endsWith('.json'))
  .map((f) => JSON.parse(readFileSync(join(ROOT, 'recipes', f), 'utf8')));
const AMOUNTS = RECIPES.flatMap((r) => r.components.flatMap((c) => c.ingredients.map((i) => i.amount)));

// ---------- every amount in the bank ----------

test('every amount in the bank scales by many factors without NaN, Infinity, "undefined" or a lost original', () => {
  for (const factor of [0.01, 0.25, 1 / 3, 0.5, 1, 1.5, 2, 3, 7, 100, 1e6]) {
    for (const amount of AMOUNTS) {
      const r = scaleAmount(amount, factor);
      assert.equal(r.original, amount == null || !amount.trim() ? null : amount);
      if (r.amount != null) assert.doesNotMatch(r.amount, /NaN|Infinity|undefined|null/, `${amount} ×${factor}`);
      if (!r.scaled) assert.equal(r.amount, r.original);
    }
  }
});

test('scaling every recipe keeps everything except ingredient amounts, and counts add up', () => {
  for (const recipe of RECIPES) {
    const before = JSON.stringify(recipe);
    const s = scaleRecipe(recipe, 2);
    assert.equal(JSON.stringify(recipe), before, 'the input recipe is not mutated');
    const n = recipe.components.reduce((k, c) => k + c.ingredients.length, 0);
    assert.equal(s.scale.scaled + s.scale.kept + s.scale.unstated, n, recipe.id);
    assert.deepEqual(s.components.map((c) => c.steps), recipe.components.map((c) => c.steps));
  }
});

test('scaling up then down returns to the same quantity (value, not necessarily the same glyphs)', () => {
  const value = (text) => [...text.matchAll(/\d+(?:\.\d+)?/g)].map((m) => Number(m[0]));
  for (const amount of AMOUNTS) {
    if (amount == null) continue;
    const up = scaleAmount(amount, 4);
    if (!up.scaled) continue;
    const down = scaleAmount(up.amount, 0.25);
    if (/[½⅓⅔¼¾⅛⅜⅝⅞/]/.test(amount + down.amount)) continue; // fraction glyphs may change form
    assert.deepEqual(value(down.amount), value(amount), `${amount} → ${up.amount} → ${down.amount}`);
  }
});

// ---------- number forms ----------

test('bad factors throw a RangeError', () => {
  for (const f of [0, -1, NaN, Infinity, '2', null, undefined, 2n]) assert.throws(() => scaleAmount('1 cup', f), RangeError, String(f));
});

test('empty, whitespace and non-string amounts are "unstated"', () => {
  for (const a of [null, undefined, '', '   ', 42, {}, ['1 cup']]) assert.equal(scaleAmount(a, 2).reason, 'unstated', JSON.stringify(a));
});

test('ordinary forms scale as documented', () => {
  const cases = [
    ['800g', 2, '1600g'], ['1 1/2 cups', 2, '3 cups'], ['½ cup (about 110 g)', 2, '1 cup (about 220 g)'],
    ['2–3 cloves', 2, '4–6 cloves'], ['1/2–1 tsp', 2, '1–2 tsp'], ['2 x 400g', 2, '4 x 400g'],
    ['1,5 dl', 3, '4,5 dl'], ['1,000 g', 2, '2000 g'], ['Juice of 1/2 lime', 2, 'Juice of 1 lime'], ['1 can', 3, '3 cans'],
    ['3 eggs', 1 / 3, '1 egg'], ['200g / 7oz', 2, '400g / 14oz'], ['about 2 cups', 0.5, 'about 1 cup'],
  ];
  for (const [a, f, want] of cases) assert.equal(scaleAmount(a, f).amount, want, `${a} ×${f}`);
});

test('words, rates, percentages and broken fractions are kept exactly', () => {
  for (const a of ['a good amount', 'some', '2 per person', '20 g per roll', '1 / person', '½ a garlic head', '5% fat', '1/0 cup', '٣ eggs']) {
    const r = scaleAmount(a, 2);
    assert.equal(r.amount, a, a);
    assert.equal(r.scaled, false, a);
  }
});

test('both sides of a dual-unit amount written without spaces are scaled ("200g/7oz")',
  { todo: 'bug: QTY lookbehind (?<![\\w.,/]) skips a number right after "/", so "200g/7oz" ×2 gives "400g/7oz" and "2 cups/480ml" gives "4 cups/480ml"' },
  () => {
    assert.equal(scaleAmount('200g/7oz', 2).amount, '400g/14oz');
    assert.equal(scaleAmount('2 cups/480ml', 2).amount, '4 cups/960ml');
    assert.equal(scaleAmount('15ml/1 tbsp', 2).amount, '30ml/2 tbsp');
  });

test('a fraction written with the fraction slash (U+2044) is read as one number',
  { todo: 'bug: "1⁄2 cup" is scaled as two numbers: ×2 gives "2⁄4 cups", ×0.5 gives "½⁄1 cup"' },
  () => {
    const r = scaleAmount('1⁄2 cup', 2);
    assert.ok(r.amount === '1 cup' || r.reason === 'words', r.amount);
  });

test('a pack size written after the count ("400g x 2") is not scaled twice',
  { todo: 'bug: "400g x 2" ×2 gives "800g x 4" (four times the food); only "2 x 400g" is recognised as a pack size' },
  () => {
    const r = scaleAmount('400g x 2', 2);
    assert.ok(['400g x 4', '800g x 2'].includes(r.amount), r.amount);
  });

test('formatFraction and formatDecimal stay readable at the extremes', () => {
  assert.equal(formatFraction(1e-12), '0');
  assert.equal(formatFraction(0.999999), '1');
  assert.equal(formatFraction(2 / 3), '⅔');
  assert.equal(formatFraction(1.5, { ascii: true }), '1 1/2');
  assert.equal(formatDecimal(0.004), '0.004');
  assert.equal(formatDecimal(1234.56), '1235');
  assert.equal(formatDecimal(12.345, { comma: true }), '12,3');
  for (const x of [1e-9, 0.0001, 1e9, 123456789.5]) assert.doesNotMatch(formatFraction(x) + formatDecimal(x), /NaN|undefined/);
});

test('parseNumber refuses division by zero and odd tokens', () => {
  for (const t of ['1/0', '0/0', '1 1/0', '', ' ', 'a', '1.2.3', '1,2,3', '--1']) assert.equal(parseNumber(t), null, t);
  assert.equal(parseNumber('1,000,000').value, 1_000_000);
  assert.equal(parseNumber('3 ½').value, 3.5);
});

test('parseServes and factorFor: rates, ranges, zero and junk give null', () => {
  for (const s of ['2 per person', '2-3', '2 to 3', '0', '1/0', 'not stated', '', null, 4, {}, '2 large or 4 small']) {
    assert.equal(parseServes(s), null, JSON.stringify(s));
  }
  assert.deepEqual(parseServes(' Serves 4 '), { count: 4, unit: null });
  assert.deepEqual(parseServes('10 bowls'), { count: 10, unit: 'bowls' });
  assert.equal(factorFor({ serves: '4' }, 2), 0.5);
  for (const t of [0, -1, 'x', NaN, Infinity]) assert.equal(factorFor({ serves: '4' }, t), null, String(t));
  assert.equal(factorFor(null, 2), null);
});

// ---------- purchase amounts ----------

const plan = (...ids) => ({ items: ids.map((recipe) => ({ recipe, day: null })) });

test('a plan with every recipe in the bank, twice, gives a clean purchase list', () => {
  const ids = RECIPES.map((r) => r.id);
  const p = purchaseList({ items: [...ids.map((recipe) => ({ recipe, day: 'mon' })), ...ids.map((recipe) => ({ recipe, day: 'fri' }))] }, RECIPES, defaultProfile(), { pantry: DEFAULT_PANTRY });
  assert.equal(p.meals, ids.length * 2);
  const items = p.groups.flatMap((g) => g.items);
  assert.equal(p.itemCount, items.length);
  for (const it of items) {
    for (const part of it.parts) {
      assert.doesNotMatch(part.text, /NaN|Infinity|undefined/, it.key);
      if (part.kind === 'total') assert.ok(Number.isFinite(part.lo) && part.lo > 0 && part.hi >= part.lo, it.key);
    }
    for (const s of it.sources) assert.equal(s.times, 2);
  }
  for (const k of DEFAULT_PANTRY) assert.ok(!items.some((it) => it.key === k));
  const text = purchaseListText(p, { sources: true });
  assert.doesNotMatch(text, /NaN|undefined|\[object/);
});

test('purchaseList survives garbage plans, recipes and overrides', () => {
  const r = RECIPES[0];
  for (const args of [
    [null, null, null], [{}, [], undefined], [plan('missing'), RECIPES, null], [plan(r.id), [{}, r], { people: 'x' }],
    [plan(r.id), RECIPES, defaultProfile(), { servesOverride: { [r.id]: -2 } }],
    [plan(r.id), RECIPES, defaultProfile(), { servesOverride: JSON.parse('{"__proto__": 4}') }],
    [plan(r.id), RECIPES, defaultProfile(), { pantry: 'salt;; ;PEPPER\n' }],
  ]) {
    const p = purchaseList(...args);
    assert.ok(Array.isArray(p.groups));
  }
});

test('the purchase amount for a fraction-slash amount is never a wrong number',
  { todo: 'bug: follows from the scale bug: "1⁄2 cup" for a recipe serving 1 and a household of 2 is listed as "2⁄4 cups"' },
  () => {
    const recipe = { id: 'p', title: 'P', serves: '1', components: [{ name: 'M', steps: [], ingredients: [{ item: 'Milk', key: 'milk', amount: '1⁄2 cup', basis: 'on-screen' }] }] };
    const p = purchaseList(plan('p'), [recipe], defaultProfile());
    const milk = p.groups.flatMap((g) => g.items).find((it) => it.key === 'milk');
    assert.doesNotMatch(milk.amount, /2⁄4/);
  });

test('parseMeasure refuses zero, pack sizes and two measures, and reads "each"', () => {
  for (const a of ['0 g', '2 x 400g cans', '200g / 2dl', '1/0 cup', '', '   ', 'a pinch']) assert.equal(parseMeasure(a), null, a);
  assert.equal(parseMeasure('1 tsp each').unit, 'tsp');
  assert.equal(parseMeasure('2 lbs').base, 'oz');
  assert.equal(parseMeasure('2 lbs').size, 16);
});
