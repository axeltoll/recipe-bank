// Serving scaling. Pure functions, no DOM: shared by the browser (served at
// /lib/scale.mjs) and the tests.
//
// Only amounts that are plain numbers and units are scaled ("800g", "1.5dl", "2 tbsp",
// "½ cup (about 110 g)", "1/2–1", "Juice of 1/2 lime"). Everything else keeps the
// creator's exact words and is reported as not scaled, so the UI can say so:
//   - words ("a good amount", "a couple", "½ a garlic head", "enough for 12 subs")
//   - rates ("2 per person", "20 g per roll"): they already follow the number of servings
//   - unstated amounts (null)
// Every result carries the original text, so a scaled amount can always be shown
// next to what the creator actually said.

const UNICODE_FRACTIONS = {
  '½': [1, 2], '⅓': [1, 3], '⅔': [2, 3], '¼': [1, 4], '¾': [3, 4], '⅕': [1, 5], '⅖': [2, 5], '⅗': [3, 5], '⅘': [4, 5],
  '⅙': [1, 6], '⅚': [5, 6], '⅛': [1, 8], '⅜': [3, 8], '⅝': [5, 8], '⅞': [7, 8],
};
const GLYPH = Object.fromEntries(Object.entries(UNICODE_FRACTIONS).map(([g, [n, d]]) => [`${n}/${d}`, g]));
const UF = `[${Object.keys(UNICODE_FRACTIONS).join('')}]`;

// One number: "1 1/2", "1½", "1 ½", "1/2", "½", "1.5", "1,5", "1,000", "12".
const NUM = `(?:\\d+\\s+\\d+\\/\\d+|\\d+\\s?${UF}|\\d+\\/\\d+|${UF}|\\d+(?:[.,]\\d+)?)`;
// A number or a range of numbers ("2–3", "2-3", "2 to 3", "1/2–1").
const QTY = new RegExp(`(?<![\\w.,/])(${NUM})(?:(\\s*[-–—]\\s*|\\s+to\\s+)(${NUM}))?(?![\\d/])`, 'gu');

// Words that may come before the first number without making the amount "words".
const LEAD = /^(?:(?:approximately|approx\.?|about|around|roughly|nearly|almost|up to|at least|max\.?|min\.?|ca\.|(?:the )?(?:juice|zest) of)\s+|[~≈]\s*)*/i;
// "each" is not here on purpose: "1 tsp each" (of salt and pepper) scales normally.
const PER = /\b(per|apiece)\b|\/\s*(person|serving|portion|head)\b/i;

// Units where decimals read better than fractions.
const METRIC = /^(g|gr|grams?|kg|kilos?|kilograms?|mg|ml|millilit(?:er|re)s?|cl|dl|l|lit(?:er|re)s?|oz|lbs?|pounds?)$/i;
// Count words that take an "s" (or other plural) after a number above one.
const PLURALS = {
  bag: 'bags', block: 'blocks', bulb: 'bulbs', bunch: 'bunches', can: 'cans', clove: 'cloves', cup: 'cups', egg: 'eggs',
  handful: 'handfuls', head: 'heads', jar: 'jars', lemon: 'lemons', lime: 'limes', onion: 'onions', packet: 'packets',
  pack: 'packs', piece: 'pieces', pinch: 'pinches', pot: 'pots', sheet: 'sheets', slice: 'slices', sprig: 'sprigs',
  stalk: 'stalks', stick: 'sticks', tin: 'tins', tortilla: 'tortillas', wrap: 'wraps',
};
const SINGULARS = Object.fromEntries(Object.entries(PLURALS).map(([s, p]) => [p, s]));
const ADJECTIVES = new Set(['large', 'medium', 'small', 'big', 'whole', 'heaped', 'level', 'heaping', 'rounded', 'generous', 'scant']);

/** Parse one number token ("1 1/2", "1½", "½", "1,5", "1,000", "3") to { value, style, comma }. */
export function parseNumber(token) {
  const t = String(token).trim();
  let m;
  if ((m = t.match(new RegExp(`^(\\d+)\\s?(${UF})$`, 'u')))) {
    const [n, d] = UNICODE_FRACTIONS[m[2]];
    return { value: Number(m[1]) + n / d, style: 'unicode', comma: false };
  }
  if ((m = t.match(new RegExp(`^(${UF})$`, 'u')))) {
    const [n, d] = UNICODE_FRACTIONS[m[1]];
    return { value: n / d, style: 'unicode', comma: false };
  }
  if ((m = t.match(/^(\d+)\s+(\d+)\/(\d+)$/))) {
    if (Number(m[3]) === 0) return null;
    return { value: Number(m[1]) + Number(m[2]) / Number(m[3]), style: 'fraction', comma: false };
  }
  if ((m = t.match(/^(\d+)\/(\d+)$/))) {
    if (Number(m[2]) === 0) return null;
    return { value: Number(m[1]) / Number(m[2]), style: 'fraction', comma: false };
  }
  if (/^\d{1,3}(?:,\d{3})+$/.test(t)) return { value: Number(t.replace(/,/g, '')), style: 'int', comma: false };
  if ((m = t.match(/^(\d+)([.,])(\d+)$/))) return { value: Number(`${m[1]}.${m[3]}`), style: 'decimal', comma: m[2] === ',' };
  if (/^\d+$/.test(t)) return { value: Number(t), style: 'int', comma: false };
  return null;
}

const gcd = (a, b) => (b ? gcd(b, a % b) : a);

/** Decimal with sensible precision: 0 dp from 100, 1 dp from 10, else 2 dp; trailing zeros trimmed. */
export function formatDecimal(x, { comma = false } = {}) {
  const dp = x >= 100 ? 0 : x >= 10 ? 1 : 2;
  let s = String(Number(x.toFixed(dp)));
  if (s === '0' && x > 0) s = String(Number(x.toPrecision(1)));
  return comma ? s.replace('.', ',') : s;
}

/**
 * Number as a kitchen fraction when one is close (halves, thirds, quarters, eighths):
 * 1.5 → "1½" (or "1 1/2" with ascii), 0.25 → "¼", 2 → "2". Falls back to a decimal.
 */
export function formatFraction(x, { ascii = false } = {}) {
  const whole = Math.floor(x + 1e-9);
  const frac = x - whole;
  if (frac < 1e-9) return String(whole);
  for (const d of [2, 3, 4, 8]) {
    const n = Math.round(frac * d);
    if (Math.abs(frac - n / d) > 0.02) continue;
    if (n === 0) return whole ? String(whole) : formatDecimal(x);
    if (n === d) return String(whole + 1);
    const g = gcd(n, d);
    const key = `${n / g}/${d / g}`;
    if (ascii || !GLYPH[key]) return whole ? `${whole} ${key}` : key;
    return `${whole || ''}${GLYPH[key]}`;
  }
  return formatDecimal(x);
}

function formatScaled(value, parsed, unit) {
  if (parsed.style === 'unicode') return formatFraction(value);
  if (parsed.style === 'fraction') return formatFraction(value, { ascii: true });
  const isWhole = Math.abs(value - Math.round(value)) < 1e-9;
  if (isWhole) return String(Math.round(value));
  if (parsed.style === 'decimal' || METRIC.test(unit ?? '')) return formatDecimal(value, { comma: parsed.comma });
  return formatFraction(value);
}

// The word after a number: "g" in "800g", "cup" in "1 cup", "onion" in "1 large onion".
// Latin letters only: × and ÷ sit inside À-ÿ, so that range is split around them.
const NEXT_WORD = /^(\s*)([A-Za-zÀ-ÖØ-öø-ÿ]+\.?)/;

/** Fix "1 cups" / "2 cup" after scaling: pluralise or singularise known count words. */
function agree(rest, value) {
  let m = rest.match(NEXT_WORD);
  if (!m) return rest;
  let offset = 0;
  if (ADJECTIVES.has(m[2].toLowerCase())) {
    offset = m[0].length;
    m = rest.slice(offset).match(NEXT_WORD);
    if (!m) return rest;
  }
  const word = m[2];
  const lower = word.toLowerCase();
  let next = null;
  if (value > 1 && PLURALS[lower]) next = PLURALS[lower];
  else if (value <= 1 && SINGULARS[lower]) next = SINGULARS[lower];
  if (!next) return rest;
  if (word[0] !== lower[0]) next = next[0].toUpperCase() + next.slice(1);
  const at = offset + m[1].length;
  return rest.slice(0, at) + next + rest.slice(at + word.length);
}

const STARTS_WITH_NUMBER = new RegExp(`^(?:\\d|${UF})`, 'u');

/**
 * Scale one amount string by `factor` (a positive number).
 * Returns { amount, original, scaled, reason }; `amount` is the text to show and
 * `original` the creator's text. reason is one of:
 *   'scaled'     the numbers in the amount were scaled
 *   'same'       the factor is 1: nothing to do
 *   'unstated'   no amount given (null or empty)
 *   'words'      the creator gave words, not plain numbers: kept exactly
 *   'per-unit'   a rate such as "2 per person": kept exactly
 */
export function scaleAmount(amount, factor) {
  if (!(typeof factor === 'number' && Number.isFinite(factor) && factor > 0)) {
    throw new RangeError('factor must be a positive number');
  }
  const original = typeof amount === 'string' && amount.trim() ? amount : null;
  const keep = (reason) => ({ amount: original, original, scaled: false, reason });
  if (original == null) return keep('unstated');
  if (factor === 1) return keep('same');
  if (PER.test(original)) return keep('per-unit');
  const lead = original.match(LEAD)[0];
  if (!STARTS_WITH_NUMBER.test(original.slice(lead.length))) return keep('words');

  const matches = [...original.matchAll(QTY)];
  if (!matches.length) return keep('words');
  // "½ a garlic head", "1 an onion": a number used with an article is speech, not a measure.
  if (matches.some((m) => /^\s+an?\b/i.test(original.slice(m.index + m[0].length)))) return keep('words');

  let out = '';
  let last = 0;
  let packSize = false;
  for (let i = 0; i < matches.length; i++) {
    const m = matches[i];
    const end = m.index + m[0].length;
    const nextStart = i + 1 < matches.length ? matches[i + 1].index : original.length;
    const span = original.slice(end, nextStart); // the text between this number and the next
    out += original.slice(last, m.index);
    last = end;
    const a = parseNumber(m[1]);
    const b = m[3] != null ? parseNumber(m[3]) : null;
    // Percentages ("5% fat"), pack sizes (the 400 in "2 x 400g") and broken numbers ("1/0") stay as written.
    if (packSize || /^\s*%/.test(span) || !a || (m[3] != null && !b)) {
      out += m[0];
      packSize = false;
      continue;
    }
    packSize = /^\s*[x×]\s*$/.test(span) && i + 1 < matches.length;
    const unit = span.match(NEXT_WORD)?.[2]?.replace(/\.$/, '');
    const va = a.value * factor;
    let text = formatScaled(va, a, unit);
    let top = va;
    if (b) {
      top = b.value * factor;
      // "1/2–1": write both ends the same way ("1/4–1/2", not "1/4–½").
      const style = b.style === 'int' && (a.style === 'fraction' || a.style === 'unicode') ? { ...b, style: a.style } : b;
      text += m[2] + formatScaled(top, style, unit);
    }
    // Keep the count word in agreement: "1 can" → "2 cans", "1½ cups" → "¾ cup".
    out += text + agree(span, top);
    last = nextStart;
  }
  out += original.slice(last);
  return out === original ? keep('words') : { amount: out, original, scaled: true, reason: 'scaled' };
}

/** Scale one ingredient; adds `scaled` (boolean), `originalAmount` and `scaleReason`. */
export function scaleIngredient(ing, factor) {
  const amount = ing.basis === 'unstated' ? null : ing.amount;
  const r = scaleAmount(amount, factor);
  return { ...ing, amount: r.amount, scaled: r.scaled, originalAmount: r.original, scaleReason: r.reason };
}

/**
 * A copy of the recipe with every ingredient scaled, plus
 * `scale: { factor, scaled, kept, unstated }`: how many amounts changed, how many kept the
 * creator's words (words or per-unit rates) and how many had no amount to begin with.
 * Steps, nutrition (per serving / per item) and everything else are left as they are.
 */
export function scaleRecipe(recipe, factor) {
  const scale = { factor, scaled: 0, kept: 0, unstated: 0 };
  const components = (recipe.components ?? []).map((c) => ({
    ...c,
    ingredients: (c.ingredients ?? []).map((ing) => {
      const s = scaleIngredient(ing, factor);
      if (s.scaled) scale.scaled++;
      else if (s.scaleReason === 'words' || s.scaleReason === 'per-unit') scale.kept++;
      else if (s.scaleReason === 'unstated') scale.unstated++;
      return s;
    }),
  }));
  return { ...recipe, components, scale };
}

/**
 * How many the recipe makes, when `serves` says so plainly: "4" → { count: 4, unit: null },
 * "10 bowls" → { count: 10, unit: 'bowls' }, "about 12 nuggets" → { count: 12, unit: 'nuggets' }.
 * Returns null for rates ("2 thighs per person"), "not stated", and anything with two
 * different numbers ("2 large or 4 smaller sandwiches"). Text in brackets is ignored.
 */
export function parseServes(serves) {
  if (typeof serves !== 'string') return null;
  const s = serves.replace(/\([^)]*\)/g, ' ').trim();
  if (!s || PER.test(s)) return null;
  const found = [...s.matchAll(QTY)];
  if (!found.length || found.some((m) => m[3] != null)) return null;
  const values = [...new Set(found.map((m) => parseNumber(m[1])?.value))];
  if (values.length !== 1 || !(values[0] > 0)) return null;
  const first = found[0];
  const unit = s.slice(first.index + first[0].length).match(/^\s*([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ-]*)/)?.[1] ?? null;
  return { count: values[0], unit: unit && !/^(or|and|to|in|on)$/i.test(unit) ? unit : null };
}

/** Factor to go from what the recipe makes to `target`, or null when `serves` isn't a plain number. */
export function factorFor(recipe, target) {
  const s = parseServes(recipe?.serves);
  const t = Number(target);
  if (!s || !Number.isFinite(t) || t <= 0) return null;
  return t / s.count;
}

/** "×2", "×½", "×1.25": how a factor reads on a badge. */
export function formatFactor(factor) {
  return `×${formatFraction(factor)}`;
}
