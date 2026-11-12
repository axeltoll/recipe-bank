// Purchase amounts for your household. Pure functions, no DOM and no storage: shared by the
// browser (served at /lib/purchase.mjs) and the tests.
//
// purchaseList(plan, recipes, profile) turns a week plan into how much to buy. Per
// shopping-list line (one ingredient key, see lib/plan.mjs):
//   - every creator amount is scaled from what its recipe serves to the household's
//     servings per meal (lib/household.mjs), times the number of times it is planned;
//   - amounts in the same unit are added up. Exact metric relations are used (g and kg,
//     ml, cl, dl and l, oz and lb); nothing else is converted: grams and cups, spoons and
//     millilitres, "1 large" and "2" stay separate parts of the line;
//   - amounts that cannot be scaled keep the creator's words and are flagged: words
//     ("a good amount"), rates ("2 per person"), unstated amounts, numbers that cannot be
//     read, and every amount of a recipe whose `serves` is null or not a plain number.
// Every line keeps the creator amounts it came from, so the UI can always show them.

import { shoppingListForPlan } from './plan.mjs';
import { parseNumber, formatDecimal, formatFraction, scaleAmount, parseServes, servingCount } from './scale.mjs';
import { normalizeProfile, servingsPerMeal, describeProfile } from './household.mjs';

/** Keys most kitchens always have. The UI lets the user change the list. */
export const DEFAULT_PANTRY = Object.freeze(['salt', 'black pepper', 'cooking oil']);

/** Why an amount is shown as written instead of scaled. */
export const FLAGS = Object.freeze({
  words: 'given in words, shown as written',
  unparsed: 'could not read the amount, shown as written',
  'per-unit': 'given per person or per item, shown as written',
  unstated: 'amount not given',
  'serves-unstated': 'servings not stated, shown as written',
  'serves-unclear': 'servings not a plain number, shown as written',
  'serves-items': 'recipe makes items, not servings, shown as written',
});

// What `serves` may count and still be servings: "4", "4 servings", "10 bowls". "12 nuggets",
// "9 rolls" or "7 burritos" count items, and how many items one person eats is not ours to guess.

// ---------- units ----------

// [canonical unit, base unit, size in base units, spellings]. Only exact relations.
const UNIT_TABLE = [
  ['g', 'g', 1, ['g', 'gr', 'gram', 'grams', 'gramme', 'grammes']],
  ['kg', 'g', 1000, ['kg', 'kgs', 'kilo', 'kilos', 'kilogram', 'kilograms', 'kilogramme', 'kilogrammes']],
  ['ml', 'ml', 1, ['ml', 'millilitre', 'millilitres', 'milliliter', 'milliliters']],
  ['cl', 'ml', 10, ['cl', 'centilitre', 'centilitres', 'centiliter', 'centiliters']],
  ['dl', 'ml', 100, ['dl', 'decilitre', 'decilitres', 'deciliter', 'deciliters']],
  ['l', 'ml', 1000, ['l', 'litre', 'litres', 'liter', 'liters']],
  ['oz', 'oz', 1, ['oz', 'ounce', 'ounces']],
  ['lb', 'oz', 16, ['lb', 'lbs', 'pound', 'pounds']],
  ['fl oz', 'fl oz', 1, ['fl oz', 'fluid ounce', 'fluid ounces']],
  ['tsp', 'tsp', 1, ['tsp', 'tsps', 'teaspoon', 'teaspoons']],
  ['tbsp', 'tbsp', 1, ['tbsp', 'tbsps', 'tbs', 'tablespoon', 'tablespoons']],
  ['cup', 'cup', 1, ['cup', 'cups']],
];
const UNITS = new Map();
for (const [unit, base, size, spellings] of UNIT_TABLE) for (const s of spellings) UNITS.set(s, { unit, base, size });
const BY_UNIT = new Map(UNIT_TABLE.map(([unit, base, size]) => [unit, { unit, base, size }]));
// Weights and volumes read better as decimals ("520 g", "1.6 kg"); spoons, cups and counts as fractions.
const DECIMAL_BASES = new Set(['g', 'ml', 'oz']);

const ADJECTIVES = new Set(['large', 'medium', 'small', 'big', 'whole', 'heaped', 'level', 'heaping', 'rounded', 'generous', 'scant']);
// A word like these after the number means the amount is a phrase, not a measure.
const STOP = new Set(['a', 'an', 'the', 'of', 'or', 'and', 'to', 'for', 'per', 'plus', 'with', 'each', 'x', 'in', 'on']);
const IRREGULAR = { leaf: 'leaves', loaf: 'loaves', half: 'halves', potato: 'potatoes', tomato: 'tomatoes' };
const IRREGULAR_ONE = Object.fromEntries(Object.entries(IRREGULAR).map(([one, many]) => [many, one]));

function singular(word) {
  if (ADJECTIVES.has(word)) return word;
  if (Object.hasOwn(IRREGULAR_ONE, word)) return IRREGULAR_ONE[word];
  if (/(?:ch|sh|x|ss)es$/.test(word)) return word.slice(0, -2);
  if (/[^aeiou]ies$/.test(word)) return `${word.slice(0, -3)}y`;
  if (word.length > 2 && /[^s]s$/.test(word)) return word.slice(0, -1);
  return word;
}

function plural(word) {
  if (ADJECTIVES.has(word)) return word;
  if (Object.hasOwn(IRREGULAR, word)) return IRREGULAR[word];
  if (/(?:ch|sh|x|s)$/.test(word)) return `${word}es`;
  if (/[^aeiou]y$/.test(word)) return `${word.slice(0, -1)}ies`;
  return `${word}s`;
}

/** The unit of a measure from the words after the number (already lowercased, without brackets). */
function unitFor(words) {
  if (!words.length) return { unit: '', base: '', size: 1, one: '', many: '' };
  const known = UNITS.get(words.join(' '));
  if (known) return { ...known, one: known.unit, many: known.unit === 'cup' ? 'cups' : known.unit };
  // A counted thing: "can", "large onion", "whole garlic bulbs". Only the last word agrees with the number.
  const head = words.slice(0, -1);
  const last = words[words.length - 1];
  const lastUnit = UNITS.get(last);
  const one = lastUnit ? lastUnit.unit : singular(last);
  const many = lastUnit ? (lastUnit.unit === 'cup' ? 'cups' : lastUnit.unit) : plural(one);
  const unit = [...head, one].join(' ');
  return { unit, base: unit, size: 1, one: unit, many: [...head, many].join(' ') };
}

// ---------- reading an amount ----------

const UF = '½⅓⅔¼¾⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞';
// Same number forms as lib/scale.mjs: "1 1/2", "1½", "1 ½", "1/2", "½", "1.5", "1,5", "1,000", "12".
const NUM = `(?:\\d+\\s+\\d+\\/\\d+|\\d+\\s?[${UF}]|\\d+\\/\\d+|[${UF}]|\\d+(?:[.,]\\d+)?)`;
const MEASURE = new RegExp(`^(${NUM})(?:\\s*(?:[-–—]|to\\b)\\s*(${NUM}))?(?![\\d/])\\s*([\\s\\S]*)$`, 'u');
const LEAD = /^(?:(approximately|approx\.|approx|about|around|roughly|nearly|almost|up to|at least|ca\.)\s+|([~≈])\s*|((?:the\s+)?(?:juice|zest)\s+of)\s+)/i;
const STARTS_WITH_NUMBER = new RegExp(`^(?:\\d|[${UF}])`, 'u');
const WORD = /^[a-zà-öø-ÿ][a-zà-öø-ÿ-]*$/u;

/** Drop "about", "~", "juice of" … from the front; `approx` is true when the creator hedged. */
function stripLead(text) {
  let rest = String(text).trim();
  let approx = false;
  let m;
  while ((m = rest.match(LEAD))) {
    if (m[1] || m[2]) approx = true;
    rest = rest.slice(m[0].length);
  }
  return { rest, approx };
}

/**
 * Read one creator amount as a quantity and a unit, or null when it is not a single plain measure.
 *   "800g" → { lo: 800, hi: 800, unit: 'g', base: 'g', size: 1, approx: false, one: 'g', many: 'g' }
 *   "about 1 cup" → approx; "2–3 cloves" → lo 2, hi 3, unit 'clove'; "1 large" → unit 'large';
 *   "½ cup (about 110 g)" → the cup (text in brackets is ignored); "Juice of 1/2 lime" → ½ lime.
 * Null for words, rates, two measures ("200g / 2dl"), pack sizes ("2 x 400g") and broken numbers.
 * `size` is how many base units one unit is (kg → 1000 g); count words have size 1.
 */
export function parseMeasure(text) {
  if (typeof text !== 'string' || !text.trim()) return null;
  const { rest, approx } = stripLead(text);
  const m = rest.match(MEASURE);
  if (!m) return null;
  const a = parseNumber(m[1]);
  const b = m[2] != null ? parseNumber(m[2]) : null;
  if (!a || (m[2] != null && !b)) return null;
  const lo = a.value;
  const hi = b ? b.value : a.value;
  if (!(lo > 0) || !(hi >= lo)) return null;
  const words = m[3].replace(/\([^()]*\)/g, ' ').replace(/\./g, '').trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length && words[words.length - 1] === 'each') words.pop(); // "1 tsp each" (of salt and of pepper)
  if (words.length > 3 || words.some((w) => !WORD.test(w) || STOP.has(w))) return null;
  return { lo, hi, approx, ...unitFor(words) };
}

/**
 * The base unit a unit name adds up in, and its size: 'kg' → { base: 'g', size: 1000 },
 * 'dl' → { base: 'ml', size: 100 }, 'cans' → { base: 'can', size: 1 }, '' or 'each' → { base: '', size: 1 }.
 * Null when the text is not a unit. lib/prices.mjs uses it so a price per kg meets an amount in grams.
 */
export function unitKey(unit) {
  if (unit != null && typeof unit !== 'string') return null;
  const m = parseMeasure(`1 ${unit ?? ''}`);
  return m ? { base: m.base, size: m.size } : null;
}

// ---------- formatting ----------

const range = (lo, hi, f) => {
  const a = f(lo);
  const b = f(hi);
  return a === b ? a : `${a}–${b}`;
};

/** How an added-up total reads: "1.6 kg", "about 2 cups", "2–3 cloves", "1½". */
function formatTotal(t) {
  let text;
  if (DECIMAL_BASES.has(t.base)) {
    // Show it in the largest unit a creator used that the total reaches; grams and millilitres move up at 1000.
    const used = [...t.units].map((u) => BY_UNIT.get(u)).filter(Boolean).sort((x, y) => y.size - x.size);
    let pick = used.find((u) => t.lo / u.size >= 1 - 1e-9) ?? used[used.length - 1] ?? BY_UNIT.get(t.base);
    if (t.base === 'g' && pick.size < 1000 && t.lo >= 1000) pick = BY_UNIT.get('kg');
    if (t.base === 'ml' && pick.size < 1000 && t.lo >= 1000) pick = BY_UNIT.get('l');
    text = `${range(t.lo, t.hi, (x) => formatDecimal(x / pick.size))} ${pick.unit}`;
  } else {
    const top = formatFraction(t.hi);
    const label = t.hi <= 1 + 1e-9 || Number(top) === 1 ? t.one : t.many;
    const qty = range(t.lo, t.hi, (x) => formatFraction(x));
    text = label ? `${qty} ${label}` : qty;
  }
  return t.approx ? `about ${text}` : text;
}

const timesText = (amount, times) => (times > 1 ? `${amount} (cooking it ${times} times)` : amount);

// ---------- pantry ----------

/**
 * A clean pantry list: lowercase keys, trimmed, no duplicates, at most 100 of at most 60 characters.
 * Takes an array or a text with commas, semicolons or new lines ("salt, black pepper").
 */
export function normalizePantry(raw) {
  const list = Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split(/[,;\n]/) : [];
  const out = [];
  for (const v of list) {
    if (typeof v !== 'string') continue;
    const k = v.trim().toLowerCase().replace(/\s+/g, ' ');
    if (!k || k.length > 60 || out.includes(k)) continue;
    out.push(k);
    if (out.length >= 100) break;
  }
  return out;
}

// ---------- the purchase list ----------

function recipeFlag(serves) {
  if (serves == null || (typeof serves === 'string' && !serves.trim())) return 'serves-unstated';
  return 'serves-unclear';
}

/** One creator amount → what to buy for it. */
function purchaseSource(line, info) {
  const times = line.times ?? 1;
  const factor = info?.factor ?? null;
  const base = {
    recipeId: line.recipeId,
    title: line.title,
    component: line.component,
    item: line.item,
    original: line.amount ?? null,
    basis: line.basis,
    note: line.note ?? null,
    times,
    factor,
  };
  const kept = (status) => ({ ...base, status, amount: line.amount == null ? null : timesText(line.amount, times), measure: null });
  if (line.amount == null) return kept('unstated');
  if (factor == null) return kept(info?.flag ?? 'serves-unstated');
  const mult = factor * times;
  // Probe with ×2 at ×1, so "a good amount" is still recognised as words when nothing needs scaling.
  const probe = scaleAmount(line.amount, mult === 1 ? 2 : mult);
  if (probe.reason === 'per-unit') return kept('per-unit');
  if (probe.reason !== 'scaled') {
    const { rest } = stripLead(line.amount);
    // "½ a garlic head" is speech; "1/0 cup" or "5%" is a number we could not read.
    return kept(STARTS_WITH_NUMBER.test(rest) && !/^\S+\s+an?\b/i.test(rest) ? 'unparsed' : 'words');
  }
  const measure = parseMeasure(line.amount);
  return { ...base, status: measure ? 'added' : 'scaled', amount: mult === 1 ? line.amount : probe.amount, measure };
}

function purchaseItem(it, info) {
  const sources = it.lines.map((l) => purchaseSource(l, info.get(l.recipeId)));
  const totals = new Map();
  const texts = [];
  sources.forEach((s, i) => {
    if (s.status === 'added') {
      const m = s.measure;
      const mult = s.factor * s.times;
      let t = totals.get(m.base);
      if (!t) {
        t = { base: m.base, lo: 0, hi: 0, approx: false, units: new Set(), one: m.one, many: m.many, sources: [] };
        totals.set(m.base, t);
      }
      t.lo += m.lo * m.size * mult;
      t.hi += m.hi * m.size * mult;
      t.approx ||= m.approx;
      t.units.add(m.unit);
      t.sources.push(i);
    } else if (s.amount != null) {
      texts.push({ kind: 'text', unit: null, text: s.amount, flag: Object.hasOwn(FLAGS, s.status) ? s.status : null, sources: [i] });
    }
  });
  const parts = [
    ...[...totals.values()].map((t) => ({
      kind: 'total', unit: t.base, lo: t.lo, hi: t.hi, approx: t.approx, text: formatTotal(t), sources: t.sources,
    })),
    ...texts,
  ];
  const flags = [...new Set(sources.map((s) => s.status).filter((s) => Object.hasOwn(FLAGS, s)))];
  return {
    key: it.key,
    aisle: it.aisle,
    recipes: it.recipes,
    amount: parts.length ? parts.map((p) => p.text).join(' + ') : null,
    parts,
    sources: sources.map(({ measure, ...s }) => ({
      ...s,
      measure: measure ? { lo: measure.lo, hi: measure.hi, unit: measure.unit, approx: measure.approx } : null,
    })),
    flags,
    flagged: flags.length > 0,
  };
}

/**
 * Purchase amounts for a week plan and a household profile.
 *
 * plan: a week plan (lib/plan.mjs); recipes: the recipe objects; profile: a household profile
 * (lib/household.mjs; normalised, so a missing profile means the default two adults).
 * Options: pantry (keys to leave out, default none: the UI passes DEFAULT_PANTRY or the user's list);
 *          aisles (aisle overrides, as for shoppingList);
 *          servesOverride ({ recipeId: servings }: the user's own answer for a recipe whose `serves`
 *          is missing or counts items; never filled in automatically).
 * A recipe is scaled only when `serves` is a plain number of servings ("4", "4 servings", "10 bowls").
 *
 * Returns {
 *   servings, household, people, meals,
 *   recipes: [{ id, title, times, days, serves, servesCount, factor, flag }],
 *   groups:  [{ aisle, label, items: [{
 *     key, aisle, recipes, amount: 'text to buy' | null, flags: [flag], flagged,
 *     parts:   [{ kind: 'total', unit: base unit, lo, hi, approx, text, sources: [index] }
 *              | { kind: 'text', unit: null, text, flag, sources: [index] }],
 *     sources: [{ recipeId, title, component, item, original, basis, note, times, factor, status, amount, measure }]
 *   }] }],
 *   leftOut: [keys from the pantry that the plan uses], itemCount, flaggedCount
 * }
 * `factor` is the household's servings per meal divided by what the recipe serves (null when `serves`
 * isn't a plain number); each source is scaled by factor × times. Source `status` is 'added' (part of a
 * total), 'scaled' (scaled but kept apart, e.g. "200g / 2dl") or one of the FLAGS keys.
 * Totals are in base units (g, ml, oz, or the unit itself).
 */
export function purchaseList(plan, recipes, profile, { pantry = [], aisles = null, servesOverride = null } = {}) {
  const p = normalizeProfile(profile);
  const servings = servingsPerMeal(p);
  const list = shoppingListForPlan(plan, recipes, { aisles });
  const byId = new Map((recipes ?? []).filter((r) => r?.id).map((r) => [r.id, r]));

  const info = new Map();
  for (const r of list.recipes) {
    const serves = byId.get(r.id)?.serves ?? null;
    const parsed = parseServes(serves);
    const given = servesOverride && Object.hasOwn(servesOverride, r.id) ? Number(servesOverride[r.id]) : NaN;
    let count = null;
    let flag = null;
    if (Number.isFinite(given) && given > 0) count = given;
    else if (servingCount(serves) != null) count = servingCount(serves);
    else flag = parsed ? 'serves-items' : recipeFlag(serves);
    info.set(r.id, {
      ...r,
      serves,
      servesCount: count,
      factor: count ? servings / count : null,
      flag,
    });
  }

  const skip = new Set(normalizePantry(pantry));
  const leftOut = [];
  const groups = [];
  for (const g of list.groups) {
    const items = [];
    for (const it of g.items) {
      if (skip.has(it.key)) leftOut.push(it.key);
      else items.push(purchaseItem(it, info));
    }
    if (items.length) groups.push({ aisle: g.aisle, label: g.label, items });
  }
  const all = groups.flatMap((g) => g.items);
  return {
    servings,
    household: describeProfile(p),
    people: Object.values(p.people).reduce((n, v) => n + v, 0),
    meals: list.recipes.reduce((n, r) => n + r.times, 0),
    recipes: [...info.values()],
    groups,
    leftOut: leftOut.sort((a, b) => a.localeCompare(b)),
    itemCount: all.length,
    flaggedCount: all.filter((it) => it.flagged).length,
  };
}

/** "For 2 adults, 1 child aged 6-10 (2.6 servings per meal)". */
export function householdLine(purchase) {
  const s = purchase.servings;
  return `For ${purchase.household} (${String(s)} serving${s === 1 ? '' : 's'} per meal)`;
}

/**
 * Plain-text purchase list for the clipboard or a printout, grouped by aisle.
 * `checked` (a Set of keys) leaves out what is already in the basket; `sources: true` adds each creator amount.
 */
export function purchaseListText(purchase, { title = 'Purchase list', checked = null, sources = false } = {}) {
  const out = [title, householdLine(purchase)];
  if (purchase.recipes.length) {
    out.push(`Meals: ${purchase.recipes.map((r) => (r.times > 1 ? `${r.title} (×${r.times})` : r.title)).join('; ')}`);
  }
  for (const g of purchase.groups) {
    const items = g.items.filter((it) => !checked?.has(it.key));
    if (!items.length) continue;
    out.push('', `${g.label}:`);
    for (const it of items) {
      const check = it.flagged ? ` (check: ${it.flags.map((f) => FLAGS[f]).join('; ')})` : '';
      out.push(`- ${it.key}: ${it.amount ?? 'amount not given'}${check}`);
      if (sources) for (const s of it.sources) out.push(`    ${timesText(s.original ?? 'amount not given', s.times)}, ${s.title}`);
    }
  }
  if (purchase.leftOut.length) out.push('', `Left out, you have these: ${purchase.leftOut.join(', ')}`);
  return out.join('\n');
}

/**
 * A rough cost for the planned meals from what shops actually cost so far: the food budget's
 * recorded spend per meal (summary() in lib/budget.mjs) × the planned meals, and that per person
 * (head count, as the budget counts it). Null when the budget has no per-meal figure yet.
 * Returns { currency, perMealMinor, meals, totalMinor, perPersonMinor }.
 */
export function planCostEstimate(purchase, budgetSummary) {
  const perMeal = budgetSummary?.perMealMinor;
  if (!Number.isSafeInteger(perMeal) || perMeal < 0 || !(purchase?.meals > 0)) return null;
  const totalMinor = perMeal * purchase.meals;
  if (!Number.isSafeInteger(totalMinor)) return null;
  const people = purchase.people > 0 ? purchase.people : null;
  return {
    currency: budgetSummary.currency ?? null,
    perMealMinor: perMeal,
    meals: purchase.meals,
    totalMinor,
    perPersonMinor: people ? Math.round(totalMinor / people) : null,
  };
}
