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
// A number right after "/" is refused only when a digit comes before the slash (the "2" of "1/2"), so both
// halves of a dual unit written without spaces ("200g/7oz") are numbers.
const QTY = new RegExp(`(?<![\\w.,]|\\d\\/)(${NUM})(?:(\\s*[-–—]\\s*|\\s+to\\s+)(${NUM}))?(?![\\d/])`, 'gu');

// Words that may come before the first number without making the amount "words".
const LEAD = /^(?:(?:approximately|approx\.?|about|around|roughly|nearly|almost|up to|at least|max\.?|min\.?|ca\.|(?:the )?(?:juice|zest) of)\s+|[~≈]\s*)*/i;
// "each" is not here on purpose: "1 tsp each" (of salt and pepper) scales normally.
const PER = /\b(per|apiece)\b|\/\s*(person|serving|portion|head)\b/i;

// Between the two halves of a dual unit ("400g/14oz", "400 g / 14 oz"): a unit, then a slash.
const DUAL_UNIT = /^\s*[A-Za-z\u00b5]+\.?\s*\/\s*$/;

// Units where decimals read better than fractions.
const METRIC = /^(g|gr|grams?|kg|kilos?|kilograms?|mg|ml|millilit(?:er|re)s?|cl|dl|l|lit(?:er|re)s?|oz|lbs?|pounds?)$/i;
// A measure, as opposed to a counted pack ("2 cans", "1 400g can"): spoons and cups too.
const MEASURE_UNIT = /^(?:tsp|tsps|teaspoons?|tbsp|tbsps?|tbs|tablespoons?|cups?)$/i;
const isMeasureUnit = (word) => METRIC.test(word ?? '') || MEASURE_UNIT.test(word ?? '');
// Weight and volume, including "ounce" written out. A hyphen may sit in front ("14-ounce").
const isSizeUnit = (word) => METRIC.test(word ?? '') || /^ounces?$/i.test(word ?? '');
// Count words that take an "s" (or other plural) after a number above one.
const PLURALS = {
  bag: 'bags', block: 'blocks', bulb: 'bulbs', bunch: 'bunches', can: 'cans', clove: 'cloves', cup: 'cups', egg: 'eggs',
  handful: 'handfuls', head: 'heads', jar: 'jars', lemon: 'lemons', lime: 'limes', onion: 'onions', packet: 'packets',
  pack: 'packs', piece: 'pieces', pinch: 'pinches', pot: 'pots', sheet: 'sheets', slice: 'slices', sprig: 'sprigs',
  stalk: 'stalks', stick: 'sticks', tin: 'tins', tortilla: 'tortillas', wrap: 'wraps',
};
const SINGULARS = Object.fromEntries(Object.entries(PLURALS).map(([s, p]) => [p, s]));
const ADJECTIVES = new Set(['large', 'medium', 'small', 'big', 'whole', 'heaped', 'level', 'heaping', 'rounded', 'generous', 'scant']);
// A bracket after one of these is the size of one container ("2 cans (400g)"), not a second measure.
const CONTAINERS = new Set([
  'bag', 'bags', 'block', 'blocks', 'bottle', 'bottles', 'can', 'cans', 'carton', 'cartons',
  'jar', 'jars', 'pack', 'packet', 'packets', 'packs', 'pot', 'pots', 'tin', 'tins', 'tub', 'tubs',
]);
// "2 x 400g (14 oz)": the parenthesis is the pack's other unit. "2 x 400g tins (about 3 cups)" is not.
const PACK_PAREN = /^\s*[A-Za-z\u00b5]+\.?\s*\(\s*[~≈]?\s*$/;

// The fraction slash (U+2044) and the division slash (U+2215) are read as "/", so one, U+2044, two and "cup"
// is half a cup, not two numbers.
const SLASHES = /[\u2044\u2215]/g;
export const normalizeSlashes = (text) => String(text).replace(SLASHES, '/');

/** Parse one number token ("1 1/2", "1½", "½", "1,5", "1,000", "3") to { value, style, comma }. */
export function parseNumber(token) {
  const t = normalizeSlashes(token).trim();
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

/** Fix "1 cups" / "2 cup" after scaling: pluralise or singularise known count words.
 *  A bracket or a size token may sit between the count and its word ("2 (400g) cans",
 *  "1 400g can", "1 (14 oz) can"), so skip those before looking at the word. The size's
 *  number is its own token, which leaves the unit and a closing parenthesis ("g) cans", "-ounce can"). */
function agree(rest, value) {
  const skipped = leadingPack(rest);
  if (skipped) return skipped + agree(rest.slice(skipped.length), value);
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

// What sits between a count and the word that agrees with it: a whole bracket, a size
// ("400g", "14-ounce", "14 oz"), or the unit left after that size's number was its own token.
function leadingPack(rest) {
  const bracket = rest.match(/^\s*\([^)]*\)/);
  if (bracket) return bracket[0];
  const sized = rest.match(/^\s*\d+(?:[.,]\d+)?(?:\s*-\s*|\s+)([A-Za-zÀ-ÖØ-öø-ÿ]+)\.?/);
  if (sized && isSizeUnit(sized[1])) return sized[0];
  const tail = rest.match(/^(\s*-?\s*)([A-Za-zÀ-ÖØ-öø-ÿ]+)\.?(\s*\))?/);
  if (!tail || !isSizeUnit(tail[2])) return '';
  const next = rest.slice(tail[0].length).match(NEXT_WORD)?.[2]?.replace(/\.$/, '').toLowerCase() ?? '';
  if (tail[3] || Object.hasOwn(PLURALS, next) || Object.hasOwn(SINGULARS, next)) return tail[0];
  return '';
}

const STARTS_WITH_NUMBER = new RegExp(`^(?:\\d|${UF})`, 'u');

// The number at `index` sits in a bracket. Freeze it only when the bracket is one container's size:
// it says "each", it opens straight after the count ("2 (400g)", "2-3 (200g)"), or a container word
// sits just before it or just after it ("1 large (28 oz) can"). A total ("800g total", "in all") and a
// cup or spoon ("2 jars (about 2 cups)") are the whole amount, so they scale. A bracket after an "x"
// pack ("2 x 400g tins (about 3 cups)") is the whole amount too.
function bracketIsPack(text, prevEnd, index) {
  const open = text.lastIndexOf('(', index);
  if (open < prevEnd) return false;
  const close = text.indexOf(')', index);
  const inside = text.slice(open + 1, close === -1 ? text.length : close);
  if (/\beach\b/i.test(inside)) return true;
  if (/\b(?:total|altogether|combined|in all)\b/i.test(inside)) return false;
  if (inside.split(/[^A-Za-zÀ-ÖØ-öø-ÿ]+/).some((w) => MEASURE_UNIT.test(w))) return false;
  if (/^\s*$/.test(text.slice(prevEnd, open))) return true;
  const word = text.slice(0, open).match(/([A-Za-zÀ-ÖØ-öø-ÿ]+)\s*$/)?.[1]?.toLowerCase() ?? '';
  // "1 large (28 oz) can": the container is the word after the bracket, not the adjective before it.
  const after = close === -1 ? '' : text.slice(close + 1).match(/^\s*([A-Za-zÀ-ÖØ-öø-ÿ]+)/)?.[1]?.toLowerCase() ?? '';
  if (!CONTAINERS.has(word) && !CONTAINERS.has(after)) return false;
  return !/(?:^|[^A-Za-zÀ-ÖØ-öø-ÿ])[x×](?:[^A-Za-zÀ-ÖØ-öø-ÿ]|$)/.test(text.slice(0, open));
}

// "1 400g can", "1 14-ounce can", "1 large 800g tin": a count, optional adjectives, then a weight
// or volume and a word. The second number is the size of one pack, so it stays. "200g 50g flour"
// is two measures (the first word is a unit), so both numbers scale.
function barePackSize(gap, span, prevWasMeasure) {
  if (prevWasMeasure) return false;
  const fillers = gap.trim().split(/\s+/).filter(Boolean);
  if (!fillers.every((w) => ADJECTIVES.has(w.toLowerCase()))) return false;
  const unit = span.match(/^\s*-?\s*([A-Za-zÀ-ÖØ-öø-ÿ]+)\b\.?/);
  if (!unit || !isSizeUnit(unit[1])) return false;
  return /^\s+[A-Za-zÀ-ÖØ-öø-ÿ]/.test(span.slice(unit[0].length));
}

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
  const text = normalizeSlashes(original);
  if (PER.test(text)) return keep('per-unit');
  const lead = text.match(LEAD)[0];
  if (!STARTS_WITH_NUMBER.test(text.slice(lead.length))) return keep('words');

  const matches = [...text.matchAll(QTY)];
  if (!matches.length) return keep('words');
  // "½ a garlic head", "1 an onion": a number used with an article is speech, not a measure.
  if (matches.some((m) => /^\s+an?\b/i.test(text.slice(m.index + m[0].length)))) return keep('words');

  let out = '';
  let last = 0;
  let packSize = false;
  let prevWasMeasure = false;
  let formatted = false;
  let countShown = null;
  let prevCountedPack = false;
  for (let i = 0; i < matches.length; i++) {
    const m = matches[i];
    const end = m.index + m[0].length;
    const nextStart = i + 1 < matches.length ? matches[i + 1].index : text.length;
    const span = text.slice(end, nextStart); // the text between this number and the next
    out += text.slice(last, m.index);
    last = end;
    const a = parseNumber(m[1]);
    const b = m[3] != null ? parseNumber(m[3]) : null;
    const unit = span.match(NEXT_WORD)?.[2]?.replace(/\.$/, '');
    // A pack size written before its count ("400g x 2", "1 can x 3"): the count after the "x" is what scales.
    const countFollows = /^\s*[A-Za-zÀ-ÖØ-öø-ÿ]+\.?\s*[x×]\s*$/.test(span) && i + 1 < matches.length
      && matches[i + 1][3] == null && /^\d+$/.test(matches[i + 1][1]);
    // A counted pack keeps the size of one container: "1 400g can", "2 (400g) cans", "2-3 (200g) fillets",
    // "2 cans (400g each)". Any other bracket is the measure's own equivalent and scales
    // ("3 eggs (about 150 g)", "2 tbsp (30 ml)", "2 x 400g tins (about 3 cups)").
    let countedPack = false;
    if (i > 0 && !packSize) {
      const prev = matches[i - 1];
      const prevEnd = prev.index + prev[0].length;
      const gap = text.slice(prevEnd, m.index);
      const open = text.lastIndexOf('(', m.index);
      const closeBefore = text.lastIndexOf(')', m.index);
      // "14 oz / 400 g": the bracket opened before the previous number, so this number
      // is the same pack. Reuse that verdict instead of asking again.
      if (open !== -1 && open > closeBefore && text.lastIndexOf('(', prev.index) === open) {
        countedPack = prevCountedPack;
      } else if (gap.includes('(')) {
        countedPack = bracketIsPack(text, prevEnd, m.index);
      } else if (barePackSize(gap, span, prevWasMeasure)) {
        countedPack = true;
      }
    }
    // Percentages ("5% fat"), pack sizes (the 400 in "2 x 400g", "400g x 2" and "2 (400g) cans") and broken
    // numbers ("1/0") stay as written.
    if (packSize || countedPack || countFollows || /^\s*%/.test(span) || !a || (m[3] != null && !b)) {
      out += m[0];
      // The count word follows the pack ("2 (400g) cans", "1 400g can"), so it agrees with the count.
      // A number kept inside a bracket must not lend that count to the words still inside it
      // ("1 jar (about 2 cups)"): copy through the closing bracket, then agree what follows.
      if (countedPack && countShown != null) {
        const open = text.lastIndexOf('(', m.index);
        const closeBefore = text.lastIndexOf(')', m.index);
        if (open > closeBefore) {
          const closeAt = span.indexOf(')');
          out += closeAt === -1 ? span : span.slice(0, closeAt + 1) + agree(span.slice(closeAt + 1), countShown);
        } else {
          out += agree(span, countShown);
        }
        last = nextStart;
      }
      // "2 x 400g/14oz" and "2 x 400g (14 oz)": the other unit is the same pack, so it stays too.
      // A later equivalent ("tins (about 3 cups)") is a different measure and scales below.
      packSize = packSize && i + 1 < matches.length && (DUAL_UNIT.test(span) || PACK_PAREN.test(span));
      prevCountedPack = countedPack;
      continue;
    }
    packSize = /^\s*[x×]\s*$/.test(span) && i + 1 < matches.length;
    prevCountedPack = false;
    prevWasMeasure = isMeasureUnit(unit);
    const va = a.value * factor;
    let scaled = formatScaled(va, a, unit);
    let topText = scaled;
    if (b) {
      // "1/2–1": write both ends the same way ("1/4–1/2", not "1/4–½").
      const style = b.style === 'int' && (a.style === 'fraction' || a.style === 'unicode') ? { ...b, style: a.style } : b;
      topText = formatScaled(b.value * factor, style, unit);
      scaled += m[2] + topText;
    }
    // Keep the count word in agreement: "1 can" → "2 cans", "1½ cups" → "¾ cup". It agrees with the number as
    // written, which may be rounded: 1.02 cups is shown as "1", so it is "1 cup".
    formatted = true;
    countShown = parseNumber(topText)?.value ?? (b ? b.value : a.value) * factor;
    out += scaled + agree(span, countShown);
    last = nextStart;
  }
  out += text.slice(last);
  // Rounding can print the same text ("1 cup" × 6.1/6). A number was still scaled; only text with
  // no usable number ("a good amount", "5%") stays words.
  if (!formatted) return keep('words');
  return { amount: out, original, scaled: true, reason: 'scaled' };
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

/** Words that make a `serves` count a number of servings rather than a number of items. */
export const SERVING_UNITS = /^(?:servings?|portions?|people|persons?|bowls?|plates?|meals?)$/i;

/**
 * The number of servings `serves` states, or null: "4", "4 servings", "10 bowls" → a number; "about 12 nuggets",
 * "9 rolls" and anything parseServes can't read → null. A count of items is not a count of servings, so it never
 * scales to a household.
 */
export function servingCount(serves) {
  const s = parseServes(serves);
  return s && (s.unit == null || SERVING_UNITS.test(s.unit)) ? s.count : null;
}

/**
 * Factor to go from the servings a recipe makes to `target` servings, or null when `serves` is not a serving count
 * (servingCount: "4", "4 servings", but not "9 rolls" or "2 thighs per person").
 */
export function factorFor(recipe, target) {
  const count = servingCount(recipe?.serves);
  const t = Number(target);
  if (count == null || !Number.isFinite(t) || t <= 0) return null;
  return t / count;
}

/** "×2", "×½", "×1.25": how a factor reads on a badge. */
export function formatFactor(factor) {
  return `×${formatFraction(factor)}`;
}
