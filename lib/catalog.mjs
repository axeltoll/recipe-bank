// Read-only queries over recipes and queue entries: matching, counting, sorting and the plain-text
// exports (shopping list, analysis request). DOM-free; shared by the dashboard, feature modules and tests.
// Nothing here changes a recipe or invents data: a missing amount stays missing.

// Filtering itself (search, Has all / Has any, Without, tags, nutrition) lives in ./filter.mjs, the
// one implementation the dashboard, the feature modules and the tests share; the names below are
// the dashboard's names for it.

import { ingredientKeys } from './recipe.mjs';
import { videoKey } from './video.mjs';
import {
  searchText, matchesSearch, matchesIngredients, matchesFilter, keyCounts, tagCounts,
} from './filter.mjs';

export { ingredientKeys, searchText, keyCounts, tagCounts };

/** Total number of steps across all components. */
export const stepCount = (r) => (r.components ?? []).reduce((n, c) => n + (c.steps?.length ?? 0), 0);

/** Every whitespace-separated word of `q` must occur somewhere in the recipe's search text. Empty query matches. */
export const matchesQuery = (r, q) => matchesSearch(r, q);

/** mode 'all': the recipe has every selected key; 'any': at least one. No selection matches everything. */
export const matchesKeys = (r, keys, mode = 'all') => matchesIngredients(r, keys, mode);

/**
 * Recipes that pass the filter (lib/filter.mjs: q, keys, mode, without, tags, minProtein, maxCalories)
 * and every extra test (feature filters registered through rb.addFilter). Order is kept.
 * `extra` is a list of (recipe) => boolean.
 */
export function filterRecipes(recipes, filter = {}, extra = []) {
  return (recipes ?? []).filter((r) => matchesFilter(r, filter) && extra.every((test) => test(r)));
}

/** A new array: most recently analyzed first, then by title. */
export function sortRecipes(recipes) {
  return [...recipes].sort(
    (a, b) => String(b.analyzed ?? '').localeCompare(String(a.analyzed ?? '')) || String(a.title).localeCompare(String(b.title)),
  );
}

const MACROS = [
  ['calories', 'kcal', 'Calories'],
  ['protein_g', 'g', 'Protein'],
  ['carbs_g', 'g', 'Carbs'],
  ['fat_g', 'g', 'Fat'],
];

/** The macros a recipe states, in a fixed order: [{ id, value, unit, label }]. Empty when none are stated. */
export function macros(r) {
  const n = r?.nutrition;
  if (!n || typeof n !== 'object') return [];
  return MACROS.filter(([id]) => Number.isFinite(n[id])).map(([id, unit, label]) => ({ id, value: n[id], unit, label }));
}

/**
 * One-line macro summary for a card: calories and protein when stated, e.g.
 * { text: '517 kcal · 43 g protein', per: 'sub' }. null when neither is stated.
 */
export function cardMacros(r) {
  const parts = macros(r)
    .filter((m) => m.id === 'calories' || m.id === 'protein_g')
    .map((m) => (m.id === 'calories' ? `${m.value} kcal` : `${m.value} g protein`));
  if (!parts.length) return null;
  const per = typeof r.nutrition.per === 'string' && r.nutrition.per.trim() ? r.nutrition.per.trim() : null;
  return { text: parts.join(' · '), per };
}

/**
 * Ingredient keys to preview on a card: the ones that match the current selection first, then the rest,
 * cut to `limit`. Returns { shown: [{ key, hit }], more } where `more` counts the keys left out.
 */
export function previewKeys(r, selected = [], limit = 5) {
  const sel = new Set(selected);
  const keys = ingredientKeys(r);
  const ordered = [...keys.filter((k) => sel.has(k)), ...keys.filter((k) => !sel.has(k))];
  return {
    shown: ordered.slice(0, limit).map((key) => ({ key, hit: sel.has(key) })),
    more: Math.max(0, ordered.length - limit),
  };
}

/**
 * Every step of a recipe in cooking order, for cook mode:
 * [{ n, of, component, componentIndex, text, t }] where n counts from 1 across components and t may be null.
 */
export function flattenSteps(r) {
  const flat = [];
  (r.components ?? []).forEach((c, componentIndex) => {
    for (const s of c.steps ?? []) flat.push({ component: c.name, componentIndex, text: s.text, t: s.t ?? null });
  });
  return flat.map((s, i) => ({ n: i + 1, of: flat.length, ...s }));
}

/** Plain-text shopping list for one recipe. Amounts are the creator's words; an unstated amount is left out. */
export function shoppingList(r) {
  const lines = [`${r.title}`];
  const parts = (r.components ?? []).filter((c) => c.ingredients?.length);
  for (const c of parts) {
    if ((r.components ?? []).length > 1) lines.push('', `${c.name}:`);
    for (const i of c.ingredients) lines.push(`- ${i.item}${i.amount ? `: ${i.amount}` : ''}`);
  }
  return lines.join('\n');
}

/**
 * A copy of the recipe with the amounts the page shows: `shown` maps "<ci>.<ii>" to the text a feature put in
 * .ing-amt-text (serving scaling). The file is not changed, and an unstated amount never gets one.
 */
export function withShownAmounts(r, shown) {
  if (!shown?.size) return r;
  return {
    ...r,
    components: (r.components ?? []).map((c, ci) => ({
      ...c,
      ingredients: (c.ingredients ?? []).map((i, ii) => {
        const text = shown.get(`${ci}.${ii}`);
        return i.amount == null || typeof text !== 'string' || !text.trim() ? i : { ...i, amount: text.trim() };
      }),
    })),
  };
}

/** The message that asks an analysis agent to write up a queued video. */
export function analysisRequest(x) {
  return [
    `Recipe Bank: analyze this video → ${x.video.url}`,
    // A web page was opted in by hand; say so, so the opt-in survives the handoff (docs/PLATFORMS.md).
    x.video.platform === 'web' ? 'Source: a web page (platform "web"); check that it holds a recipe video.' : null,
    x.note ? `Note: ${x.note}` : null,
    `Write recipes/<slug>.json (contract: CLAUDE.md) and run npm run validate.`,
  ].filter(Boolean).join('\n');
}

const QUEUE_STATES = {
  queued: { label: 'Queued', tone: 'info', stage: 0 },
  analyzing: { label: 'Being analyzed', tone: 'info', stage: 1 },
  done: { label: 'Recipe ready', tone: 'ok', stage: 2 },
  failed: { label: 'Could not be analyzed', tone: 'danger', stage: 1 },
};

/** Label, colour tone and progress stage (0 queued, 1 analysis, 2 ready) for a queue status. Unknown reads as queued. */
export const queueState = (status) => QUEUE_STATES[status] ?? QUEUE_STATES.queued;

/** Queue entries still waiting (everything except `done`). */
export const waiting = (queue) => (queue ?? []).filter((x) => x.status !== 'done');

/** The recipe written from the same video as a queue entry, or undefined. */
export function recipeForVideo(recipes, video) {
  const key = videoKey(video);
  return key ? recipes.find((r) => videoKey(r.video) === key) : undefined;
}
