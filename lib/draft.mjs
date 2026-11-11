// Recipe drafts: the editable form state behind the dashboard's recipe editor.
// Pure functions, no DOM and no I/O, shared by the browser (served at /lib/draft.mjs) and the tests.
//
// A draft holds what the form edits, as strings: amounts, timestamps ("1:23") and nutrition numbers are typed
// text until recipeFromDraft turns the draft into a recipe object for lib/recipe.mjs. Two rules from the contract
// are built in: a blank amount becomes `amount: null, basis: "unstated"` (the form never invents amounts), and
// fields the form does not know are kept verbatim, so recipeFromDraft(draftFromRecipe(r)) deep-equals r.
//
// Every draft object may carry two internal tracking fields that never reach the recipe:
//   extra  fields the form does not manage, copied back unchanged
//   blank  how an optional field was written when it was empty in the original file ("absent", null, [] or "")

import { parseVideoUrl, videoKey } from './video.mjs';
import { validateRecipe, BASES, STATUSES } from './recipe.mjs';

const ABSENT = 'absent';
const NUTRIENTS = ['calories', 'protein_g', 'carbs_g', 'fat_g'];

const TOP = ['id', 'title', 'status', 'video', 'creator', 'uploaded', 'analyzed', 'summary', 'serves', 'tags',
  'components', 'nutrition', 'notes', 'gaps', 'source'];
const VIDEO = ['platform', 'id', 'url'];
const CREATOR = ['name', 'handle', 'url'];
const COMPONENT = ['name', 'ingredients', 'steps'];
const INGREDIENT = ['item', 'key', 'amount', 'basis', 'note'];
const STEP = ['text', 't'];
const NUTRITION = ['per', 'basis', ...NUTRIENTS, 'note'];
const SOURCE = ['evidence', 'quantity_basis'];

// ---------- small helpers ----------

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
const text = (v) => (v == null ? '' : String(v));
const clean = (v) => text(v).trim();

/** Today's date as YYYY-MM-DD in local time. */
export function today(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function isEmptyValue(v) {
  return v === null || v === '' || (Array.isArray(v) && v.length === 0) || (isObj(v) && Object.keys(v).length === 0);
}

// JSON.parse keeps "__proto__" as an own field; copying it with `out[k] =` or Object.assign would call the
// prototype setter. lib/pack.mjs refuses the same keys in packs.
const BAD_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/** Fields of `obj` that are not in `managed`, deep-copied. Prototype keys are dropped. */
function extraOf(obj, managed) {
  const out = {};
  if (!isObj(obj)) return out;
  for (const [k, v] of Object.entries(obj)) if (!managed.includes(k) && !BAD_KEYS.has(k)) out[k] = clone(v);
  return out;
}

/** For each optional field that is absent or empty in `obj`, remember how it was written. */
function blankOf(obj, keys) {
  const out = {};
  for (const k of keys) {
    if (!isObj(obj) || !Object.hasOwn(obj, k)) out[k] = ABSENT;
    else if (isEmptyValue(obj[k])) out[k] = clone(obj[k]);
  }
  return out;
}

/** Writes `value` to out[key], or the field's empty form (from `blank`, else `fallback`) when value is empty. */
function put(out, key, value, blank, fallback = ABSENT) {
  if (value !== undefined && !isEmptyValue(value)) {
    out[key] = value;
    return;
  }
  const mode = blank && Object.hasOwn(blank, key) ? blank[key] : fallback;
  if (mode !== ABSENT) out[key] = clone(mode);
}

const withExtra = (out, extra) => Object.assign(out, clone(extra ?? {}));

// ---------- timestamps ----------

/**
 * Seconds from what a person types: "83", "83.5", "83s", "1:23", "1:02:03". Returns null for blank input and NaN
 * for anything else, so a typo is reported instead of silently dropped.
 */
export function parseTimestamp(input) {
  const s = text(input).trim();
  if (s === '') return null;
  let m = s.match(/^(\d+(?:\.\d+)?)\s*s?$/i);
  if (m) return Number(m[1]);
  m = s.match(/^(\d+):([0-5]?\d(?:\.\d+)?)$/);
  if (m) return Number(m[1]) * 60 + Number(m[2]);
  m = s.match(/^(\d+):([0-5]\d):([0-5]\d(?:\.\d+)?)$/);
  if (m) return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
  return NaN;
}

/**
 * "m:ss" (or "h:mm:ss") for whole seconds; other numbers are written as plain seconds ("17.5") so that
 * parseTimestamp(formatTimestamp(t)) === t always holds. Blank for null, undefined or anything that isn't seconds.
 */
export function formatTimestamp(t) {
  if (typeof t !== 'number' || !Number.isFinite(t) || t < 0) return t == null ? '' : text(t);
  if (!Number.isInteger(t)) return String(t);
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = String(t % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

// ---------- ids ----------

const FOLD = { ß: 'ss', æ: 'ae', œ: 'oe', ø: 'o', ł: 'l', đ: 'd', ð: 'd', þ: 'th', ı: 'i' };

/**
 * Kebab-case ASCII id from a title, unique against `existingIds` (a Set, array or other iterable) by adding
 * -2, -3, … Falls back to "recipe" when the title has no usable letters.
 */
export function slugify(title, existingIds = []) {
  let base = text(title)
    .normalize('NFKD')
    .replace(/\p{M}/gu, '') // combining accents left by NFKD: é → e
    .toLowerCase()
    .replace(/[ßæœøłđðþı]/g, (c) => FOLD[c])
    .replace(/&/g, ' and ')
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (base.length > 60) {
    // Cut at a word boundary: keep whole words within the first 60 characters.
    const cut = base.slice(0, 61);
    base = cut.includes('-') ? cut.slice(0, cut.lastIndexOf('-')) : base.slice(0, 60);
  }
  if (!base) base = 'recipe';
  const taken = new Set(existingIds ?? []);
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) if (!taken.has(`${base}-${n}`)) return `${base}-${n}`;
}

// ---------- drafts ----------

export const emptyIngredient = () => ({ item: '', key: '', amount: '', basis: 'unstated', note: '', extra: {}, blank: {} });
export const emptyStep = () => ({ text: '', t: '', extra: {}, blank: {} });
export const emptyComponent = (name = '') => ({ name, ingredients: [emptyIngredient()], steps: [emptyStep()], extra: {} });

/** The @handle in a creator URL such as https://www.youtube.com/@name or https://www.tiktok.com/@name. */
export function handleFromUrl(url) {
  const m = text(url).match(/^https?:\/\/[^/]+\/(@[^/?#]+)/);
  return m ? decodeURIComponent(m[1]) : '';
}

/**
 * A blank draft. `from` may be a video URL, a parsed video ({ platform, id, url }) or a queue entry
 * ({ video, title, creator, creatorUrl }); a queue entry also fills the title and creator from its oEmbed data.
 */
export function emptyDraft(from, { date = today() } = {}) {
  const d = {
    id: '',
    title: '',
    status: 'analyzed',
    video: { url: '', extra: {} },
    creator: { name: '', handle: '', url: '', extra: {}, blank: {} },
    uploaded: '',
    analyzed: date,
    summary: '',
    serves: '',
    tags: [],
    components: [emptyComponent()],
    nutrition: null,
    notes: [],
    gaps: [],
    source: { evidence: '', quantity_basis: '', extra: {}, blank: {} },
    extra: {},
    blank: {},
    original: null,
  };
  if (typeof from === 'string') {
    d.video.url = parseVideoUrl(from)?.url ?? from.trim();
  } else if (isObj(from) && isObj(from.video)) {
    d.video.url = text(from.video.url);
    d.title = clean(from.title);
    d.creator.name = clean(from.creator);
    d.creator.url = clean(from.creatorUrl);
    d.creator.handle = handleFromUrl(from.creatorUrl);
    if (from.id) d.queueId = String(from.id);
  } else if (isObj(from) && from.url) {
    d.video.url = text(from.url);
  }
  return d;
}

/** Form state for an existing recipe. */
export function draftFromRecipe(r) {
  const video = isObj(r.video) ? r.video : {};
  const creator = isObj(r.creator) ? r.creator : {};
  const nutrition = isObj(r.nutrition) ? r.nutrition : null;
  const source = isObj(r.source) ? r.source : {};
  return {
    id: text(r.id),
    title: text(r.title),
    status: text(r.status),
    video: { url: text(video.url), extra: extraOf(video, VIDEO) },
    creator: {
      name: text(creator.name),
      handle: text(creator.handle),
      url: text(creator.url),
      extra: extraOf(creator, CREATOR),
      blank: blankOf(creator, ['handle', 'url']),
    },
    uploaded: text(r.uploaded),
    analyzed: text(r.analyzed),
    summary: text(r.summary),
    serves: text(r.serves),
    tags: Array.isArray(r.tags) ? r.tags.map(text) : [],
    components: (Array.isArray(r.components) ? r.components : []).map((c) => ({
      name: text(c?.name),
      ingredients: (Array.isArray(c?.ingredients) ? c.ingredients : []).map((i) => ({
        item: text(i?.item),
        key: text(i?.key),
        amount: text(i?.amount),
        basis: text(i?.basis),
        note: text(i?.note),
        extra: extraOf(i, INGREDIENT),
        blank: blankOf(i, ['note']),
      })),
      steps: (Array.isArray(c?.steps) ? c.steps : []).map((s) => ({
        text: text(s?.text),
        t: formatTimestamp(s?.t),
        extra: extraOf(s, STEP),
        blank: blankOf(s, ['t']),
      })),
      extra: extraOf(c, COMPONENT),
    })),
    nutrition: nutrition && {
      per: text(nutrition.per),
      basis: text(nutrition.basis),
      ...Object.fromEntries(NUTRIENTS.map((k) => [k, nutrition[k] == null ? '' : String(nutrition[k])])),
      note: text(nutrition.note),
      extra: extraOf(nutrition, NUTRITION),
      blank: blankOf(nutrition, ['per', 'basis', ...NUTRIENTS, 'note']),
    },
    notes: Array.isArray(r.notes) ? r.notes.map(text) : [],
    gaps: Array.isArray(r.gaps) ? r.gaps.map(text) : [],
    source: {
      evidence: text(source.evidence),
      quantity_basis: text(source.quantity_basis),
      extra: extraOf(source, SOURCE),
      blank: blankOf(source, SOURCE),
    },
    extra: extraOf(r, TOP),
    blank: blankOf(r, ['uploaded', 'serves', 'nutrition', 'notes', 'gaps', 'source']),
    original: { id: text(r.id), videoKey: videoKey(r.video) },
  };
}

const ingredientIsEmpty = (i) =>
  !clean(i.item) && !clean(i.key) && !clean(i.amount) && !clean(i.note) && !Object.keys(i.extra ?? {}).length;
const stepIsEmpty = (s) => !clean(s.text) && !clean(s.t) && !Object.keys(s.extra ?? {}).length;
const componentIsEmpty = (c) =>
  !clean(c.name) && !Object.keys(c.extra ?? {}).length &&
  (c.ingredients ?? []).every(ingredientIsEmpty) && (c.steps ?? []).every(stepIsEmpty);

/** A number typed in the form, or the trimmed text when it isn't one (checkDraft reports that). */
function numberish(v) {
  const s = clean(v);
  if (s === '') return undefined;
  return /^-?\d+(?:\.\d+)?$/.test(s) ? Number(s) : s;
}

function ingredientFromDraft(i) {
  const out = { item: clean(i.item), key: clean(i.key).toLowerCase() };
  const amount = clean(i.amount);
  // A blank amount is always "not given": the form never invents one.
  out.amount = amount === '' ? null : amount;
  out.basis = amount === '' ? 'unstated' : clean(i.basis);
  put(out, 'note', clean(i.note), i.blank);
  return withExtra(out, i.extra);
}

function stepFromDraft(s) {
  const out = { text: clean(s.text) };
  const raw = clean(s.t);
  const t = parseTimestamp(raw);
  // An unreadable time is passed through as text so the contract check reports it.
  put(out, 't', t === null ? undefined : Number.isNaN(t) ? raw : t, s.blank);
  return withExtra(out, s.extra);
}

function nutritionFromDraft(n) {
  if (!n) return undefined;
  const out = {};
  put(out, 'per', clean(n.per), n.blank);
  put(out, 'basis', clean(n.basis), n.blank);
  for (const k of NUTRIENTS) put(out, k, numberish(n[k]), n.blank);
  put(out, 'note', clean(n.note), n.blank);
  withExtra(out, n.extra);
  // An all-blank nutrition panel writes nothing: treat it as no nutrition.
  return Object.keys(out).length ? out : undefined;
}

function sourceFromDraft(s) {
  if (!s) return undefined;
  const out = {};
  put(out, 'evidence', clean(s.evidence), s.blank);
  put(out, 'quantity_basis', clean(s.quantity_basis), s.blank);
  withExtra(out, s.extra);
  return Object.keys(out).length ? out : undefined;
}

/** The recipe object a draft describes. Empty ingredient, step and component rows are left out. */
export function recipeFromDraft(d) {
  const r = {};
  r.id = clean(d.id);
  r.title = clean(d.title);
  r.status = clean(d.status);

  const url = clean(d.video?.url);
  const parsed = parseVideoUrl(url);
  r.video = withExtra(parsed ? { platform: parsed.platform, id: parsed.id, url: parsed.url } : { url }, d.video?.extra);

  const c = d.creator ?? {};
  r.creator = { name: clean(c.name) };
  put(r.creator, 'handle', clean(c.handle), c.blank);
  put(r.creator, 'url', clean(c.url), c.blank);
  withExtra(r.creator, c.extra);

  put(r, 'uploaded', clean(d.uploaded), d.blank);
  r.analyzed = clean(d.analyzed);
  r.summary = clean(d.summary);
  put(r, 'serves', clean(d.serves), d.blank, null); // the contract writes "not stated" as null
  r.tags = (d.tags ?? []).map((t) => clean(t).toLowerCase()).filter(Boolean);

  r.components = (d.components ?? []).filter((x) => !componentIsEmpty(x)).map((x) => withExtra({
    name: clean(x.name),
    ingredients: (x.ingredients ?? []).filter((i) => !ingredientIsEmpty(i)).map(ingredientFromDraft),
    steps: (x.steps ?? []).filter((s) => !stepIsEmpty(s)).map(stepFromDraft),
  }, x.extra));

  put(r, 'nutrition', nutritionFromDraft(d.nutrition), d.blank);
  put(r, 'notes', (d.notes ?? []).map(clean).filter(Boolean), d.blank);
  put(r, 'gaps', (d.gaps ?? []).map(clean).filter(Boolean), d.blank);
  put(r, 'source', sourceFromDraft(d.source), d.blank);
  return withExtra(r, d.extra);
}

// ---------- checks ----------

// CLAUDE.md: "Vague filler like 'some' counts as unstated."
const VAGUE = /^some$/i;

/**
 * Everything wrong with a draft: the contract's problems (validateRecipe) plus form-level ones (an id or video
 * already in the bank, an amount typed while the basis says "unstated", vague filler typed as an amount, a time
 * that isn't m:ss or seconds, a nutrition value that isn't a number). Each problem starts with the field path.
 * The draft's own original id and video (when editing) don't count as duplicates.
 */
export function checkDraft(draft, { existingIds = [], existingVideoKeys = [] } = {}) {
  const r = recipeFromDraft(draft);
  const own = draft.original ?? null;
  const form = [];

  const ids = new Set(existingIds ?? []);
  if (r.id && r.id !== own?.id && ids.has(r.id)) form.push(`id "${r.id}" is already used by another recipe`);

  const parsed = parseVideoUrl(r.video.url);
  if (parsed) {
    const key = videoKey(parsed);
    const keys = existingVideoKeys instanceof Map ? existingVideoKeys : new Map([...(existingVideoKeys ?? [])].map((k) => [k, null]));
    if (key !== own?.videoKey && keys.has(key)) {
      const other = keys.get(key);
      form.push(`video is already in the bank${other ? ` as "${other}"` : ''}`);
    }
  }

  let ci = 0;
  for (const c of draft.components ?? []) {
    if (componentIsEmpty(c)) continue;
    let ii = 0;
    for (const i of c.ingredients ?? []) {
      if (ingredientIsEmpty(i)) continue;
      const p = `components[${ci}].ingredients[${ii}]`;
      const amount = clean(i.amount);
      if (amount && clean(i.basis) === 'unstated') {
        form.push(`${p}.basis says the amount is not given, but "${amount}" is typed: pick where the amount comes from, or clear it`);
      } else if (VAGUE.test(amount)) {
        form.push(`${p}.amount "${amount}" is vague filler: leave the amount blank (amount not given)`);
      }
      ii++;
    }
    let si = 0;
    for (const s of c.steps ?? []) {
      if (stepIsEmpty(s)) continue;
      if (Number.isNaN(parseTimestamp(s.t))) {
        form.push(`components[${ci}].steps[${si}].t "${clean(s.t)}" is not a time: use m:ss or seconds`);
      }
      si++;
    }
    ci++;
  }

  if (r.nutrition && isObj(r.nutrition)) {
    for (const k of NUTRIENTS) {
      const v = r.nutrition[k];
      if (v != null && !(typeof v === 'number' && Number.isFinite(v) && v >= 0)) form.push(`nutrition.${k} must be a number`);
    }
  }

  // The form-level message is the clearer one for a field; drop the contract's message for the same field.
  const paths = new Set(form.map((m) => m.split(' ')[0]));
  const contract = validateRecipe(r).filter((m) => {
    const head = m.split(' ')[0];
    if (paths.has(head)) return false;
    // "….amount must be null when basis is unstated" is covered by the form's "….basis says …" message.
    return !paths.has(head.replace(/\.amount$/, '.basis'));
  });
  return [...form, ...contract];
}

/**
 * Where each recipe component, ingredient and step came from in the draft (recipeFromDraft leaves out empty
 * rows, so recipe indexes can differ from draft indexes): [{ index, ingredients: [draftIndex…], steps: […] }].
 */
export function draftIndexMap(d) {
  const out = [];
  (d.components ?? []).forEach((c, index) => {
    if (componentIsEmpty(c)) return;
    out.push({
      index,
      ingredients: (c.ingredients ?? []).flatMap((i, n) => (ingredientIsEmpty(i) ? [] : [n])),
      steps: (c.steps ?? []).flatMap((s, n) => (stepIsEmpty(s) ? [] : [n])),
    });
  });
  return out;
}

const FIELD_FOR = {
  id: 'id', title: 'title', status: 'status', summary: 'summary', analyzed: 'analyzed', uploaded: 'uploaded',
  serves: 'serves', tags: 'tags', notes: 'notes', gaps: 'gaps', partial: 'gaps', video: 'video.url',
  'video.url': 'video.url', 'video.platform': 'video.url', 'video.id': 'video.url', 'creator.name': 'creator.name',
  'creator.url': 'creator.url',
};

/**
 * The draft field a checkDraft problem is about, as a dotted path ("components.1.ingredients.0.amount",
 * "creator.name", "gaps"), or null when the problem has no single field. The editor uses it to focus the field.
 */
export function problemField(problem, d) {
  const head = String(problem).split(' ')[0];
  const map = draftIndexMap(d);
  let m = head.match(/^components\[(\d+)\]\.(ingredients|steps)\[(\d+)\]\.(\w+)$/);
  if (m) {
    const c = map[Number(m[1])];
    const row = c?.[m[2]][Number(m[3])];
    return row == null ? null : `components.${c.index}.${m[2]}.${row}.${m[4]}`;
  }
  m = head.match(/^components\[(\d+)\]\.(\w+)$/);
  if (m) {
    const c = map[Number(m[1])];
    return c ? `components.${c.index}.name` : null;
  }
  m = head.match(/^nutrition\.(\w+)$/);
  if (m) return `nutrition.${m[1]}`;
  return FIELD_FOR[head] ?? null;
}

/** The text of a recipe file: two-space JSON with a trailing newline, like the files in recipes/. */
export function formatRecipe(r) {
  return JSON.stringify(r, null, 2) + '\n';
}

export { BASES, STATUSES };
