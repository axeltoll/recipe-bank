// Recipe filtering, shared by the dashboard (served at /lib/filter.mjs) and the tests.
// Pure functions, no DOM.
//
// A filter is a plain object; every field is optional:
//   q            free-text search over title, summary, creator, tags, components and ingredients
//   keys         ingredient keys the recipe must have: all of them (mode 'all') or at least one (mode 'any')
//   mode         'all' (default) | 'any'
//   without      ingredient keys the recipe must NOT have ("no pork", "nothing I'm out of")
//   tags         tags the recipe must all have
//   minProtein   grams; only recipes whose nutrition states protein_g >= this
//   maxCalories  kcal; only recipes whose nutrition states calories <= this
// `keys`, `without` and `tags` may be arrays or Sets.
//
// "without" matches the shopping-level ingredient key exactly. It is not an allergen
// check: a recipe can contain something that is not listed as its own ingredient.

import { ingredientKeys } from './recipe.mjs';

export { ingredientKeys };

const list = (v) => {
  const arr = v instanceof Set ? [...v] : Array.isArray(v) ? v : [];
  return [...new Set(arr.filter((x) => typeof x === 'string' && x.trim()).map((x) => x.trim().toLowerCase()))];
};
const num = (v) => {
  if (v == null || typeof v === 'boolean') return null;
  // A blank field (also one holding only spaces, which Number() reads as 0) sets no limit.
  if (typeof v === 'string' && !v.trim()) return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
};

/** Fill in defaults and drop junk, so stored or URL-provided filters are safe to use. */
export function normalizeFilter(f = {}) {
  return {
    q: typeof f?.q === 'string' ? f.q : '',
    keys: list(f?.keys),
    mode: f?.mode === 'any' ? 'any' : 'all',
    without: list(f?.without),
    tags: list(f?.tags),
    minProtein: num(f?.minProtein),
    maxCalories: num(f?.maxCalories),
  };
}

/** True when any part of the filter narrows the list. */
export function isFiltering(f) {
  const n = normalizeFilter(f);
  return Boolean(n.q.trim() || n.keys.length || n.without.length || n.tags.length || n.minProtein != null || n.maxCalories != null);
}

/** The text a free-text search looks in, lowercased. */
export function searchText(r) {
  return [
    r.title, r.summary, r.creator?.name, ...(r.tags ?? []),
    ...(r.components ?? []).flatMap((c) => [c.name, ...(c.ingredients ?? []).flatMap((i) => [i.item, i.key])]),
  ].filter((x) => x != null).join(' ').toLowerCase();
}

/** Every whitespace-separated word of `q` must appear somewhere in the recipe. */
export function matchesSearch(r, q) {
  const words = String(q ?? '').trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const hay = searchText(r);
  return words.every((w) => hay.includes(w));
}

/** Has all / Has any over ingredient keys. An empty selection matches everything. */
export function matchesIngredients(r, keys, mode = 'all') {
  const sel = list(keys);
  if (!sel.length) return true;
  const have = new Set(ingredientKeys(r));
  return mode === 'any' ? sel.some((k) => have.has(k)) : sel.every((k) => have.has(k));
}

/** True when the recipe has none of the excluded ingredient keys. */
export function matchesWithout(r, without) {
  const sel = list(without);
  if (!sel.length) return true;
  const have = new Set(ingredientKeys(r));
  return !sel.some((k) => have.has(k));
}

/** True when the recipe has every selected tag. */
export function matchesTags(r, tags) {
  const sel = list(tags);
  if (!sel.length) return true;
  const have = new Set((r.tags ?? []).map((t) => String(t).toLowerCase()));
  return sel.every((t) => have.has(t));
}

/**
 * A nutrition value the creator actually stated, or null.
 * `field` is one of calories, protein_g, carbs_g, fat_g. Values are per `nutrition.per`
 * (per serving, per nugget, per bar…), exactly as the recipe gives them.
 */
export function statedNutrition(r, field) {
  const v = r?.nutrition?.[field];
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** True when the recipe states protein or calories, so the nutrition filters can say something about it. */
export function statesMacros(r) {
  return statedNutrition(r, 'protein_g') != null || statedNutrition(r, 'calories') != null;
}

/** Recipes that don't state the value never pass an active nutrition filter. */
export function matchesNutrition(r, { minProtein = null, maxCalories = null } = {}) {
  const minP = num(minProtein);
  const maxC = num(maxCalories);
  if (minP != null) {
    const p = statedNutrition(r, 'protein_g');
    if (p == null || p < minP) return false;
  }
  if (maxC != null) {
    const c = statedNutrition(r, 'calories');
    if (c == null || c > maxC) return false;
  }
  return true;
}

/** The whole filter. Works with the dashboard's own state object ({ q, keys: Set, mode }). */
export function matchesFilter(r, f) {
  const n = normalizeFilter(f);
  return matchesIngredients(r, n.keys, n.mode)
    && matchesWithout(r, n.without)
    && matchesTags(r, n.tags)
    && matchesNutrition(r, n)
    && matchesSearch(r, n.q);
}

export function filterRecipes(recipes, f) {
  const n = normalizeFilter(f);
  return (recipes ?? []).filter((r) => matchesFilter(r, n));
}

/** [[key, recipeCount]] sorted by count, then name. Same order as the dashboard's ingredient chips. */
export function keyCounts(recipes) {
  return counts((recipes ?? []).map((r) => ingredientKeys(r)));
}

/** [[tag, recipeCount]] sorted by count, then name. */
export function tagCounts(recipes) {
  return counts((recipes ?? []).map((r) => [...new Set((r.tags ?? []).map((t) => String(t).toLowerCase()))]));
}

function counts(perRecipe) {
  const m = new Map();
  for (const keys of perRecipe) for (const k of keys) m.set(k, (m.get(k) ?? 0) + 1);
  return [...m].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

/** Highest stated protein and calories across the bank, for sizing number inputs. */
export function nutritionRange(recipes) {
  let maxProtein = null;
  let maxCalories = null;
  let stating = 0;
  for (const r of recipes ?? []) {
    const p = statedNutrition(r, 'protein_g');
    const c = statedNutrition(r, 'calories');
    if (p != null) maxProtein = Math.max(maxProtein ?? 0, p);
    if (c != null) maxCalories = Math.max(maxCalories ?? 0, c);
    if (p != null || c != null) stating++;
  }
  return { maxProtein, maxCalories, stating };
}

/** Short human summary, e.g. "with chicken · without pork · tag: air fryer · ≥ 40 g protein". */
export function describeFilter(f) {
  const n = normalizeFilter(f);
  const parts = [];
  if (n.keys.length) parts.push(`${n.mode === 'any' ? 'with any of' : 'with'} ${n.keys.join(', ')}`);
  if (n.without.length) parts.push(`without ${n.without.join(', ')}`);
  if (n.tags.length) parts.push(`${n.tags.length === 1 ? 'tag' : 'tags'}: ${n.tags.join(', ')}`);
  if (n.minProtein != null) parts.push(`≥ ${n.minProtein} g protein`);
  if (n.maxCalories != null) parts.push(`≤ ${n.maxCalories} kcal`);
  if (n.q.trim()) parts.push(`“${n.q.trim()}”`);
  return parts.join(' · ');
}
