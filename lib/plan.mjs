// Week plan and combined shopping list. Pure functions, no DOM and no storage:
// shared by the browser (served at /lib/plan.mjs) and the tests.
//
// A plan is { version: 1, items: [{ recipe: '<recipe id>', day: 'mon' … 'sun' | null }] }.
// The same recipe may be planned on several days (cook it twice); a (recipe, day)
// pair appears at most once. day null means "this week, any day".
//
// The shopping list merges ingredients by their filter `key` and keeps every amount
// in the creator's own words: amounts are listed per recipe, never added up.

export const PLAN_VERSION = 1;
export const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
export const DAY_LABELS = {
  mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday', sun: 'Sunday',
};
export const ANY_DAY_LABEL = 'Any day';

const isDay = (d) => DAYS.includes(d);
const isId = (v) => typeof v === 'string' && v.trim().length > 0;

export function emptyPlan() {
  return { version: PLAN_VERSION, items: [] };
}

/**
 * Turn anything (a stored plan, a hand-edited value, garbage) into a valid plan.
 * Drops malformed items and duplicates; when `knownIds` is given, also drops items
 * whose recipe is no longer in the bank. Also accepts a bare array of recipe ids.
 */
export function normalizePlan(raw, knownIds = null) {
  const known = knownIds ? new Set(knownIds) : null;
  const list = Array.isArray(raw) ? raw : Array.isArray(raw?.items) ? raw.items : [];
  const items = [];
  const seen = new Set();
  for (const it of list) {
    const recipe = typeof it === 'string' ? it : it?.recipe;
    if (!isId(recipe)) continue;
    if (known && !known.has(recipe)) continue;
    const day = isDay(it?.day) ? it.day : null;
    const k = `${recipe}\u0000${day}`;
    if (seen.has(k)) continue;
    seen.add(k);
    items.push({ recipe, day });
  }
  return { version: PLAN_VERSION, items: sortItems(items) };
}

const dayRank = (d) => (d == null ? DAYS.length : DAYS.indexOf(d));
// Stable order: Monday first, "any day" last; insertion order within a day.
function sortItems(items) {
  return items
    .map((it, i) => [it, i])
    .sort((a, b) => dayRank(a[0].day) - dayRank(b[0].day) || a[1] - b[1])
    .map(([it]) => it);
}

/** Add a recipe on a day (or any day). Adding the same pair twice is a no-op. */
export function addToPlan(plan, recipeId, day = null) {
  if (!isId(recipeId)) throw new TypeError('recipeId must be a non-empty string');
  if (day != null && !isDay(day)) throw new RangeError(`day must be one of ${DAYS.join(', ')} or null`);
  const p = normalizePlan(plan);
  if (p.items.some((it) => it.recipe === recipeId && it.day === day)) return p;
  return { version: PLAN_VERSION, items: sortItems([...p.items, { recipe: recipeId, day }]) };
}

/**
 * Remove a recipe from one day (day given, null = the "any day" slot)
 * or from the whole week (day omitted).
 */
export function removeFromPlan(plan, recipeId, day) {
  const p = normalizePlan(plan);
  const all = day === undefined;
  return { version: PLAN_VERSION, items: p.items.filter((it) => !(it.recipe === recipeId && (all || it.day === (day ?? null)))) };
}

/** Move a planned recipe to another day. Merges if it is already planned there. */
export function moveInPlan(plan, recipeId, fromDay, toDay) {
  if (toDay != null && !isDay(toDay)) throw new RangeError(`day must be one of ${DAYS.join(', ')} or null`);
  const p = normalizePlan(plan);
  const from = fromDay ?? null;
  const to = toDay ?? null;
  if (!p.items.some((it) => it.recipe === recipeId && it.day === from)) return p;
  return addToPlan(removeFromPlan(p, recipeId, from), recipeId, to);
}

/** True when the recipe is planned on any day. */
export function isPlanned(plan, recipeId) {
  return normalizePlan(plan).items.some((it) => it.recipe === recipeId);
}

/** { mon: [ids], …, sun: [ids], any: [ids] } in plan order. */
export function planByDay(plan) {
  const out = Object.fromEntries([...DAYS, 'any'].map((d) => [d, []]));
  for (const it of normalizePlan(plan).items) out[it.day ?? 'any'].push(it.recipe);
  return out;
}

/** Resolve plan items to recipe objects: [{ recipe, day }], skipping ids not in `recipes`. */
export function planRecipes(plan, recipes) {
  const byId = new Map((recipes ?? []).map((r) => [r.id, r]));
  return normalizePlan(plan).items.filter((it) => byId.has(it.recipe)).map((it) => ({ recipe: byId.get(it.recipe), day: it.day }));
}

// ---------- aisles ----------

export const AISLES = [
  { id: 'produce', label: 'Fruit and veg' },
  { id: 'meat', label: 'Meat and fish' },
  { id: 'dairy', label: 'Dairy and eggs' },
  { id: 'bakery', label: 'Bread and wraps' },
  { id: 'dry', label: 'Pasta, rice and baking' },
  { id: 'sauces', label: 'Oils, sauces and tins' },
  { id: 'spices', label: 'Spices and seasoning' },
  { id: 'drinks', label: 'Drinks' },
  { id: 'other', label: 'Other' },
  { id: 'staples', label: 'Check the cupboard' },
];

// Keys used in recipes/ today, by aisle. Unknown keys fall back to word rules below.
const AISLE_KEYS = {
  produce: [
    'asparagus', 'banana', 'basil', 'carrot', 'cauliflower', 'chilli', 'chives', 'coriander', 'cucumber', 'dill',
    'garlic', 'ginger', 'green bean', 'lemon', 'lettuce', 'lime', 'mint', 'onion', 'parsley', 'pomegranate', 'potato',
    'raspberry', 'red cabbage', 'red onion', 'rocket', 'shallot', 'slaw', 'spring onion', 'thyme', 'tomato',
  ],
  meat: ['bacon', 'beef', 'chicken', 'ham', 'imitation crab', 'minced beef', 'pork'],
  dairy: [
    'butter', 'cheese', 'cottage cheese', 'cream cheese', 'egg', 'feta', 'greek yoghurt', 'heavy cream', 'mozzarella',
    'parmesan', 'queso', 'swiss cheese', 'yoghurt',
  ],
  bakery: ['baguette', 'bread', 'burger bun', 'flatbread', 'poppadom', 'tortilla', 'wonton wrapper'],
  dry: ['almond flour', 'brown sugar', 'cashew', 'cornflakes', 'cornflour', 'dark chocolate', 'nori', 'pasta', 'rice', 'sesame seeds', 'vanilla'],
  sauces: [
    'apple cider vinegar', 'beef stock', 'chicken stock', 'coconut milk', 'dark soy sauce', 'evaporated milk', 'fish sauce',
    'gochujang', 'green peppercorn', 'honey', 'hot honey', 'hot sauce', 'ketchup', 'maple syrup', 'mayonnaise', 'mustard',
    'olive oil', 'oyster sauce', 'peanut butter', 'pesto', 'pickles', 'red curry paste', 'refried beans', 'rice wine vinegar',
    'sesame oil', 'soy sauce', 'sun-dried tomato', 'sweet chilli sauce', 'sweetened condensed milk', 'tomato paste', 'veal stock',
  ],
  spices: [
    'cajun seasoning', 'cayenne', 'chilli flakes', 'cinnamon', 'cumin', 'garam masala', 'garlic powder', 'gochugaru',
    'onion powder', 'paprika', 'seasoning', 'smoked paprika', 'sumac', 'taco seasoning', 'tandoori masala', 'turmeric',
  ],
  drinks: ['brandy', 'coffee', 'soju', 'white wine'],
  // Things most kitchens already have. Still listed, so nothing is silently dropped.
  staples: ['black pepper', 'cooking oil', 'cooking spray', 'salt', 'sugar', 'water'],
};
const KEY_AISLE = new Map(Object.entries(AISLE_KEYS).flatMap(([aisle, keys]) => keys.map((k) => [k, aisle])));

// Word rules for keys that are not in the table, checked in order.
const AISLE_RULES = [
  ['sauces', /\b(stock|broth|sauce|paste|vinegar|oil|syrup|ketchup|mayo|jam|tinned|canned)\b/],
  ['dairy', /\b(cheese|yoghurt|yogurt|cream|milk|eggs?)\b/],
  ['meat', /\b(chicken|beef|pork|lamb|turkey|ham|bacon|sausages?|mince|salmon|tuna|fish|prawns?|shrimp|cod|chorizo)\b/],
  ['spices', /\b(powder|seasoning|masala|spice|flakes|ground)\b/],
  ['bakery', /\b(bread|buns?|rolls?|wraps?|tortillas?|pittas?|pitas?|bagels?|naan)\b/],
  ['dry', /\b(rice|pasta|noodles?|flour|oats|lentils?|nuts?|chocolate|sugar|cereal)\b/],
  ['drinks', /\b(wine|beer|juice|coffee|tea|rum|vodka|whisky|whiskey|gin|sake|cider)\b/],
  ['produce', /\b(apples?|berr(y|ies)|peppers?|cabbage|lettuce|herbs?|leaves|mushrooms?|beans?|peas|squash|spinach|kale|courgette|zucchini|aubergine|eggplant|avocado|lemon|lime|orange|onion|garlic)\b/],
];

/** Aisle id for an ingredient key. `overrides` ({ key: aisleId }) wins over the built-in table. */
export function aisleOf(key, overrides = null) {
  const k = String(key ?? '').trim().toLowerCase();
  if (overrides && Object.hasOwn(overrides, k) && AISLES.some((a) => a.id === overrides[k])) return overrides[k];
  if (KEY_AISLE.has(k)) return KEY_AISLE.get(k);
  for (const [aisle, re] of AISLE_RULES) if (re.test(k)) return aisle;
  return 'other';
}

// ---------- shopping list ----------

/**
 * One combined shopping list for several recipes.
 *
 * `entries` is an array of recipe objects, or of { recipe, day } (what planRecipes returns).
 * A recipe that appears more than once is cooked that many times: its lines get `times`.
 *
 * Returns {
 *   recipes: [{ id, title, times, days }],
 *   groups:  [{ aisle, label, items: [{
 *     key, aisle, recipes: <distinct recipe count>, unstated: <true when no line has an amount>,
 *     lines: [{ recipeId, title, component, item, amount, basis, note, times }]
 *   }] }],
 *   itemCount, lineCount
 * }
 * Groups follow AISLES order and are omitted when empty; items are sorted by key.
 */
export function shoppingList(entries, { aisles = null } = {}) {
  const uses = new Map(); // recipe id -> { recipe, times, days }
  for (const e of entries ?? []) {
    const recipe = e?.components ? e : e?.recipe;
    if (!recipe?.id || !Array.isArray(recipe.components)) continue;
    const u = uses.get(recipe.id) ?? { recipe, times: 0, days: [] };
    u.times += 1;
    const day = e?.components ? null : e?.day ?? null;
    if (!u.days.includes(day)) u.days.push(day);
    uses.set(recipe.id, u);
  }

  const items = new Map(); // key -> item
  for (const { recipe, times } of uses.values()) {
    for (const c of recipe.components) {
      for (const ing of c.ingredients ?? []) {
        const key = String(ing.key ?? '').trim().toLowerCase();
        if (!key) continue;
        let it = items.get(key);
        if (!it) {
          it = { key, aisle: aisleOf(key, aisles), lines: [] };
          items.set(key, it);
        }
        it.lines.push({
          recipeId: recipe.id,
          title: recipe.title,
          component: c.name,
          item: ing.item,
          amount: ing.basis === 'unstated' ? null : ing.amount ?? null,
          basis: ing.basis,
          note: ing.note ?? null,
          times,
        });
      }
    }
  }

  for (const it of items.values()) {
    it.recipes = new Set(it.lines.map((l) => l.recipeId)).size;
    it.unstated = it.lines.every((l) => l.amount == null);
  }

  const groups = AISLES.map(({ id, label }) => ({
    aisle: id,
    label,
    items: [...items.values()].filter((it) => it.aisle === id).sort((a, b) => a.key.localeCompare(b.key)),
  })).filter((g) => g.items.length);

  return {
    recipes: [...uses.values()].map(({ recipe, times, days }) => ({
      id: recipe.id,
      title: recipe.title,
      times,
      days: days.sort((a, b) => dayRank(a) - dayRank(b)),
    })),
    groups,
    itemCount: items.size,
    lineCount: [...items.values()].reduce((n, it) => n + it.lines.length, 0),
  };
}

/** Shopping list for a plan: resolves the plan against `recipes` first. */
export function shoppingListForPlan(plan, recipes, opts) {
  return shoppingList(planRecipes(plan, recipes), opts);
}

/**
 * How one shopping-list line reads, in the creator's words:
 * "800g", "amount not given", "1 can (cooking it 2 times)".
 */
export function lineAmount(line) {
  const amount = line.amount ?? 'amount not given';
  return line.times > 1 ? `${amount} (cooking it ${line.times} times)` : amount;
}

/**
 * Plain-text version for the clipboard. Lines from the same recipe are kept apart,
 * so "2 tbsp" from one recipe and "a little" from another stay readable.
 * Pass `checked` (a Set of keys) to leave out what is already in the basket.
 */
export function shoppingListText(list, { title = 'Shopping list', checked = null, sources = true } = {}) {
  const out = [title];
  if (list.recipes.length) {
    out.push(`For: ${list.recipes.map((r) => (r.times > 1 ? `${r.title} (×${r.times})` : r.title)).join('; ')}`);
  }
  for (const g of list.groups) {
    const items = g.items.filter((it) => !checked?.has(it.key));
    if (!items.length) continue;
    out.push('', `${g.label}:`);
    for (const it of items) {
      if (!sources) {
        out.push(`- ${it.key}`);
        continue;
      }
      const parts = it.lines.map((l) => `${lineAmount(l)}, ${l.title}${it.recipes === 1 && it.lines.length > 1 ? ` (${l.component})` : ''}`);
      out.push(it.lines.length === 1 ? `- ${it.key}: ${parts[0]}` : `- ${it.key}:\n${parts.map((p) => `    ${p}`).join('\n')}`);
    }
  }
  return out.join('\n');
}
