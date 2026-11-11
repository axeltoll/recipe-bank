// Probes of recipe filtering (lib/filter.mjs) with stored or URL-provided junk, unicode and the real bank.
// Real bugs are marked `todo`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  normalizeFilter, isFiltering, filterRecipes, matchesSearch, keyCounts, tagCounts, describeFilter, nutritionRange, ingredientKeys,
} from '../lib/filter.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const RECIPES = readdirSync(join(ROOT, 'recipes')).filter((f) => f.endsWith('.json'))
  .map((f) => JSON.parse(readFileSync(join(ROOT, 'recipes', f), 'utf8')));

test('normalizeFilter turns any junk into a safe filter', () => {
  for (const f of [undefined, null, 42, 'q', [], { q: 5, keys: 'chicken', mode: 'ANY', without: { a: 1 }, tags: [null, 1, ' ', 'X'] },
    JSON.parse('{"__proto__": {"q": "x"}, "keys": ["__proto__"]}'), { minProtein: 'abc', maxCalories: -1 }, { minProtein: true, maxCalories: Infinity }]) {
    const n = normalizeFilter(f);
    assert.equal(typeof n.q, 'string');
    for (const k of ['keys', 'without', 'tags']) assert.ok(Array.isArray(n[k]) && n[k].every((x) => typeof x === 'string' && x === x.trim().toLowerCase() && x));
    assert.ok(n.mode === 'all' || n.mode === 'any');
    assert.ok(n.minProtein === null || Number.isFinite(n.minProtein));
    assert.ok(n.maxCalories === null || Number.isFinite(n.maxCalories));
  }
  assert.equal(filterRecipes(RECIPES, null).length, RECIPES.length);
  assert.equal(filterRecipes(null, {}).length, 0);
});

test('a blank number field (spaces only, as typed or in a URL) does not turn the nutrition filter on',
  { todo: 'bug: num() treats "  " as 0 (Number("  ") === 0), so minProtein "  " hides every recipe without stated protein' },
  () => {
    const n = normalizeFilter({ minProtein: '  ', maxCalories: '\t' });
    assert.equal(n.minProtein, null);
    assert.equal(n.maxCalories, null);
    assert.equal(isFiltering({ minProtein: ' ' }), false);
  });

test('the empty filter matches every recipe; each key filter matches exactly the recipes holding it', () => {
  assert.equal(filterRecipes(RECIPES, {}).length, RECIPES.length);
  for (const [key, count] of keyCounts(RECIPES)) {
    assert.equal(filterRecipes(RECIPES, { keys: [key.toUpperCase()] }).length, count, key);
    assert.equal(filterRecipes(RECIPES, { without: [key] }).length, RECIPES.length - count, key);
  }
  for (const [tag, count] of tagCounts(RECIPES)) assert.equal(filterRecipes(RECIPES, { tags: new Set([tag]) }).length, count, tag);
});

test('Has all ⊆ Has any, and with/without split the bank', () => {
  const keys = keyCounts(RECIPES).slice(0, 4).map(([k]) => k);
  const all = filterRecipes(RECIPES, { keys, mode: 'all' });
  const any = filterRecipes(RECIPES, { keys, mode: 'any' });
  assert.ok(all.every((r) => any.includes(r)));
  const none = filterRecipes(RECIPES, { without: keys });
  assert.equal(any.length + none.length, RECIPES.length);
});

test('search: regex characters, unicode and many words never throw; every word must match', () => {
  for (const q of ['(', '.*', '[a-', '\\', '$^', '🍗', 'crème', '  ', 'a'.repeat(10_000), 'chicken '.repeat(500)]) {
    assert.doesNotThrow(() => filterRecipes(RECIPES, { q }), q.slice(0, 20));
  }
  const r = RECIPES[0];
  assert.ok(matchesSearch(r, r.title.toUpperCase()));
  assert.ok(!matchesSearch(r, `${r.title} zzzz-not-there`));
});

test('nutrition filters never pass a recipe that does not state the value', () => {
  const { maxProtein } = nutritionRange(RECIPES);
  for (const r of filterRecipes(RECIPES, { minProtein: 0 })) assert.equal(typeof r.nutrition?.protein_g, 'number');
  assert.equal(filterRecipes(RECIPES, { minProtein: (maxProtein ?? 0) + 1 }).length, 0);
  const odd = { ...RECIPES[0], nutrition: { protein_g: '50', calories: NaN } };
  assert.equal(filterRecipes([odd], { minProtein: 1 }).length, 0);
  assert.equal(filterRecipes([odd], { maxCalories: 10_000 }).length, 0);
});

test('describeFilter is stable and keeps user text as text', () => {
  assert.equal(describeFilter({}), '');
  const d = describeFilter({ q: '<b>x</b>', keys: ['chicken'], without: ['pork'], tags: ['air fryer'], minProtein: 40, maxCalories: 600, mode: 'any' });
  assert.equal(d, 'with any of chicken · without pork · tag: air fryer · ≥ 40 g protein · ≤ 600 kcal · “<b>x</b>”');
});

test('ingredientKeys and keyCounts tolerate recipes without components', () => {
  assert.deepEqual(ingredientKeys({}), []);
  assert.deepEqual(keyCounts([{}, { components: [{}] }]), []);
});
