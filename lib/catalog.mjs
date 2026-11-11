// Read-only queries over recipes and queue entries: matching, counting, sorting and the plain-text
// exports (shopping list, analysis request). DOM-free; shared by the dashboard, feature modules and tests.
// Nothing here changes a recipe or invents data: a missing amount stays missing.

import { ingredientKeys } from './recipe.mjs';
import { videoKey } from './video.mjs';

export { ingredientKeys };

/** Total number of steps across all components. */
export const stepCount = (r) => (r.components ?? []).reduce((n, c) => n + (c.steps?.length ?? 0), 0);

const haystacks = new WeakMap();

/** Lower-cased text a search runs against: title, summary, creator, tags, component names, ingredient items and keys. */
export function searchText(r) {
  let hay = haystacks.get(r);
  if (hay === undefined) {
    hay = [
      r.title, r.summary, r.creator?.name, ...(r.tags ?? []),
      ...(r.components ?? []).flatMap((c) => [c.name, ...(c.ingredients ?? []).flatMap((i) => [i.item, i.key])]),
    ].filter(Boolean).join(' ').toLowerCase();
    haystacks.set(r, hay);
  }
  return hay;
}

/** Every whitespace-separated word of `q` must occur somewhere in the recipe's search text. Empty query matches. */
export function matchesQuery(r, q) {
  const words = String(q ?? '').trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const hay = searchText(r);
  return words.every((w) => hay.includes(w));
}

/** mode 'all': the recipe has every selected key; 'any': at least one. No selection matches everything. */
export function matchesKeys(r, keys, mode = 'all') {
  const sel = [...(keys ?? [])];
  if (!sel.length) return true;
  const have = new Set(ingredientKeys(r));
  return mode === 'any' ? sel.some((k) => have.has(k)) : sel.every((k) => have.has(k));
}

/**
 * Recipes that pass the core filters and every extra test (feature filters: exclude, tags, nutrition).
 * Order is kept. `extra` is a list of (recipe) => boolean.
 */
export function filterRecipes(recipes, { q = '', keys = [], mode = 'all' } = {}, extra = []) {
  const sel = [...keys];
  return recipes.filter((r) => matchesKeys(r, sel, mode) && matchesQuery(r, q) && extra.every((test) => test(r)));
}

function counts(recipes, valuesOf) {
  const map = new Map();
  for (const r of recipes) for (const v of new Set(valuesOf(r))) map.set(v, (map.get(v) ?? 0) + 1);
  return [...map].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

/** [[key, recipeCount], …], most used first, then A–Z. */
export const keyCounts = (recipes) => counts(recipes, ingredientKeys);

/** [[tag, recipeCount], …], most used first, then A–Z. */
export const tagCounts = (recipes) => counts(recipes, (r) => r.tags ?? []);

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

/** The message that asks an analysis agent to write up a queued video. */
export function analysisRequest(x) {
  return [
    `Recipe Bank: analyze this video → ${x.video.url}`,
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
