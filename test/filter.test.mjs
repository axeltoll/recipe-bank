import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import {
  normalizeFilter, isFiltering, matchesSearch, matchesIngredients, matchesWithout, matchesTags, matchesNutrition,
  matchesFilter, filterRecipes, keyCounts, tagCounts, statedNutrition, statesMacros, nutritionRange, describeFilter,
} from '../lib/filter.mjs';

const recipe = (id, keys, { tags = [], nutrition = null, title = id } = {}) => ({
  id, title, summary: `${title} summary`, creator: { name: 'Some Creator' }, tags, nutrition,
  components: [{ name: 'Main', steps: [], ingredients: keys.map((k) => ({ item: k[0].toUpperCase() + k.slice(1), key: k, amount: null, basis: 'unstated' })) }],
});
const nuggets = recipe('nuggets', ['chicken', 'egg', 'cornflakes'], {
  tags: ['chicken', 'air fryer', 'high protein'], nutrition: { per: 'nugget', calories: 94, protein_g: 14 },
});
const padKraPao = recipe('pad-kra-pao', ['pork', 'garlic', 'rice', 'egg'], { tags: ['pork', 'thai'] });
const burrito = recipe('burrito', ['chicken', 'tortilla', 'cheese'], {
  tags: ['chicken', 'high protein', 'air fryer'], nutrition: { per: 'burrito', calories: 511, protein_g: 63 },
});
const shawarma = recipe('shawarma', ['minced beef', 'garlic', 'flatbread'], {
  tags: ['beef'], nutrition: { per: 'wrap', calories: 650, protein_g: 48, carbs_g: 45 },
});
const caloriesOnly = recipe('cal-only', ['banana'], { nutrition: { per: 'glass', calories: 300 } });
const all = [nuggets, padKraPao, burrito, shawarma, caloriesOnly];
const ids = (rs) => rs.map((r) => r.id);

test('normalizeFilter fills defaults and drops junk', () => {
  assert.deepEqual(normalizeFilter(), { q: '', keys: [], mode: 'all', without: [], tags: [], minProtein: null, maxCalories: null });
  assert.deepEqual(normalizeFilter(null).keys, []);
  const n = normalizeFilter({
    q: 7, keys: new Set(['Chicken', 'chicken', '', 3]), mode: 'ANY', without: ['pork '], tags: 'air fryer',
    minProtein: '40', maxCalories: -5,
  });
  assert.deepEqual(n, { q: '', keys: ['chicken'], mode: 'all', without: ['pork'], tags: [], minProtein: 40, maxCalories: null });
  assert.equal(normalizeFilter({ minProtein: '' }).minProtein, null);
  assert.equal(normalizeFilter({ minProtein: true }).minProtein, null);
  assert.equal(normalizeFilter({ maxCalories: 'abc' }).maxCalories, null);
  assert.equal(normalizeFilter({ maxCalories: 0 }).maxCalories, 0);
});

test('isFiltering', () => {
  assert.equal(isFiltering({}), false);
  assert.equal(isFiltering({ q: '   ', mode: 'any' }), false);
  assert.equal(isFiltering({ without: ['pork'] }), true);
  assert.equal(isFiltering({ maxCalories: 0 }), true);
});

test('Has all / Has any', () => {
  assert.deepEqual(ids(all.filter((r) => matchesIngredients(r, ['chicken', 'egg']))), ['nuggets']);
  assert.deepEqual(ids(all.filter((r) => matchesIngredients(r, ['chicken', 'egg'], 'any'))), ['nuggets', 'pad-kra-pao', 'burrito']);
  assert.equal(matchesIngredients(padKraPao, []), true);
  assert.equal(matchesIngredients(padKraPao, new Set(['pork'])), true);
});

test('Without excludes recipes that list the ingredient key', () => {
  assert.deepEqual(ids(filterRecipes(all, { without: ['pork'] })), ['nuggets', 'burrito', 'shawarma', 'cal-only']);
  assert.deepEqual(ids(filterRecipes(all, { without: ['egg', 'garlic'] })), ['burrito', 'cal-only']);
  // Exact keys only: "beef" does not exclude "minced beef".
  assert.equal(matchesWithout(shawarma, ['beef']), true);
  assert.equal(matchesWithout(shawarma, new Set(['minced beef'])), false);
  // Has + Without together: chicken but no egg.
  assert.deepEqual(ids(filterRecipes(all, { keys: ['chicken'], without: ['egg'] })), ['burrito']);
  // A key in both lists can never match.
  assert.deepEqual(filterRecipes(all, { keys: ['egg'], without: ['egg'] }), []);
});

test('tags: every selected tag must be present, case-insensitive', () => {
  assert.deepEqual(ids(filterRecipes(all, { tags: ['air fryer'] })), ['nuggets', 'burrito']);
  assert.deepEqual(ids(filterRecipes(all, { tags: ['Air Fryer', 'high protein'] })), ['nuggets', 'burrito']);
  assert.deepEqual(ids(filterRecipes(all, { tags: ['air fryer', 'thai'] })), []);
  assert.equal(matchesTags({ id: 'no-tags' }, ['x']), false);
  assert.equal(matchesTags({ id: 'no-tags' }, []), true);
});

test('nutrition filters only pass recipes that state the value', () => {
  assert.deepEqual(ids(filterRecipes(all, { minProtein: 40 })), ['burrito', 'shawarma']);
  assert.deepEqual(ids(filterRecipes(all, { maxCalories: 600 })), ['nuggets', 'burrito', 'cal-only']);
  assert.deepEqual(ids(filterRecipes(all, { minProtein: 14, maxCalories: 511 })), ['nuggets', 'burrito']);
  assert.deepEqual(ids(filterRecipes(all, { maxCalories: 0 })), []);
  // Boundaries are inclusive.
  assert.equal(matchesNutrition(burrito, { minProtein: 63, maxCalories: 511 }), true);
  assert.equal(matchesNutrition(burrito, { minProtein: 63.5 }), false);
  // No nutrition at all: passes only when no nutrition filter is set.
  assert.equal(matchesNutrition(padKraPao, {}), true);
  assert.equal(matchesNutrition(padKraPao, { minProtein: 0 }), false);
  // A string where a number belongs is not a stated value.
  assert.equal(statedNutrition({ nutrition: { calories: '500' } }, 'calories'), null);
  assert.equal(statesMacros(caloriesOnly), true);
  assert.equal(statesMacros(padKraPao), false);
});

test('search matches every word anywhere in the recipe', () => {
  assert.equal(matchesSearch(shawarma, 'MINCED flatbread'), true);
  assert.equal(matchesSearch(shawarma, 'minced chicken'), false);
  assert.equal(matchesSearch(shawarma, 'some creator'), true);
  assert.equal(matchesSearch(shawarma, '  '), true);
  assert.equal(matchesSearch({ id: 'bare', title: 'Bare' }, 'bare'), true);
});

test('matchesFilter accepts the dashboard state object as-is', () => {
  const state = { recipes: all, invalid: [], queue: [], q: 'air', keys: new Set(['chicken']), mode: 'all', showAllChips: false };
  assert.deepEqual(ids(all.filter((r) => matchesFilter(r, state))), ['nuggets', 'burrito']);
});

test('keyCounts and tagCounts sort by count, then name', () => {
  assert.deepEqual(keyCounts(all).slice(0, 3), [['chicken', 2], ['egg', 2], ['garlic', 2]]);
  assert.deepEqual(tagCounts(all).slice(0, 3), [['air fryer', 2], ['chicken', 2], ['high protein', 2]]);
  assert.deepEqual(tagCounts([{ tags: ['x', 'X'] }]), [['x', 1]]);
});

test('nutritionRange and describeFilter', () => {
  assert.deepEqual(nutritionRange(all), { maxProtein: 63, maxCalories: 650, stating: 4 });
  assert.deepEqual(nutritionRange([]), { maxProtein: null, maxCalories: null, stating: 0 });
  assert.equal(describeFilter({}), '');
  assert.equal(
    describeFilter({ keys: ['chicken'], without: ['pork'], tags: ['air fryer'], minProtein: 40, maxCalories: 600, q: ' wrap ' }),
    'with chicken · without pork · tag: air fryer · ≥ 40 g protein · ≤ 600 kcal · “wrap”',
  );
  assert.equal(describeFilter({ keys: ['a', 'b'], mode: 'any', tags: ['x', 'y'] }), 'with any of a, b · tags: x, y');
});

// The dashboard's original matches() before it moved to lib/filter.mjs, kept here to prove nothing changed.
function legacyMatches(r, state) {
  const keys = [...new Set(r.components.flatMap((c) => c.ingredients.map((i) => i.key)))];
  if (state.keys.size) {
    const sel = [...state.keys];
    const ok = state.mode === 'all' ? sel.every((k) => keys.includes(k)) : sel.some((k) => keys.includes(k));
    if (!ok) return false;
  }
  const q = state.q.trim().toLowerCase();
  if (!q) return true;
  const hay = [
    r.title, r.summary, r.creator.name, ...(r.tags ?? []),
    ...r.components.flatMap((c) => [c.name, ...c.ingredients.flatMap((i) => [i.item, i.key])]),
  ].join(' ').toLowerCase();
  return q.split(/\s+/).every((w) => hay.includes(w));
}

test('same results as the dashboard’s original filter on every real recipe', async () => {
  const dir = resolve(import.meta.dirname, '..', 'recipes');
  const recipes = [];
  for (const f of (await readdir(dir)).filter((f) => f.endsWith('.json'))) {
    recipes.push(JSON.parse(await readFile(join(dir, f), 'utf8')));
  }
  const states = [
    { q: '', keys: new Set(), mode: 'all' },
    { q: '', keys: new Set(['chicken']), mode: 'all' },
    { q: '', keys: new Set(['chicken', 'garlic']), mode: 'all' },
    { q: '', keys: new Set(['pork', 'banana']), mode: 'any' },
    { q: 'burrito', keys: new Set(), mode: 'all' },
    { q: '  high   protein ', keys: new Set(['minced beef']), mode: 'any' },
    { q: 'gochujang mayo', keys: new Set(), mode: 'all' },
  ];
  for (const s of states) {
    assert.deepEqual(ids(recipes.filter((r) => matchesFilter(r, s))), ids(recipes.filter((r) => legacyMatches(r, s))), JSON.stringify({ ...s, keys: [...s.keys] }));
  }
});
