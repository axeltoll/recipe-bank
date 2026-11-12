// Recipe packs: share a few recipes as one JSON file or a link, and import someone
// else's without accounts or a server. Pure functions (no fs, no DOM), shared by the
// browser (/lib/pack.mjs), server.mjs and scripts/pack.mjs.
//
//   { "format": "recipe-bank-pack", "version": 1, "title": "…", "exported": "<ISO time>",
//     "recipes": [ <recipe file>, … ] }
//
// A pack is untrusted input. readPack() checks the wrapper and each recipe (through
// lib/migrate.mjs and validateRecipe), refuses prototype-polluting keys and caps sizes;
// titles keep their text as-is, so whoever renders them must escape them.

import { validateRecipe } from './recipe.mjs';
import { videoKey } from './video.mjs';
import { migrate } from './migrate.mjs';

export const PACK_FORMAT = 'recipe-bank-pack';
export const PACK_VERSION = 1;
/** Largest pack file, as JSON text. */
export const MAX_PACK_CHARS = 2_000_000;
/** Largest pack file on disk: UTF-8 needs at most 3 bytes per UTF-16 unit, so a bigger file is always too long. */
export const MAX_PACK_BYTES = MAX_PACK_CHARS * 3;
export const MAX_PACK_RECIPES = 200;
/** Longest base64url payload after #pack= in a link (about 3 typical recipes). */
export const MAX_LINK_CHARS = 32_000;
export const MAX_TITLE_CHARS = 120;

const MAX_DEPTH = 32;
const MAX_PROBLEMS = 20;
const MAX_PROBLEM_CHARS = 300;
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

export class PackError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'PackError';
    this.code = code;
  }
}

// ---------- export ----------

/**
 * Build a pack from valid recipes. Throws PackError when the list is empty, too long,
 * holds an invalid recipe, holds the same recipe or video twice, or would make a file
 * larger than readPack accepts.
 */
export function exportPack(recipes, { title, exported = new Date().toISOString() } = {}) {
  if (!Array.isArray(recipes) || recipes.length === 0) throw new PackError('Pick at least one recipe.', 'empty');
  if (recipes.length > MAX_PACK_RECIPES) {
    throw new PackError(`A pack holds at most ${MAX_PACK_RECIPES} recipes.`, 'too-many');
  }
  const ids = new Set();
  const videos = new Set();
  const out = recipes.map((r) => {
    const errs = validateRecipe(r);
    if (errs.length) throw new PackError(`"${r?.id ?? '?'}" is not a valid recipe: ${errs[0]}`, 'invalid-recipe');
    // readPack refuses these, so a pack holding them could be exported but never imported.
    const bad = forbiddenKey(r);
    if (bad) throw new PackError(`"${r.id}" contains ${bad}.`, 'invalid-recipe');
    const key = videoKey(r.video);
    if (ids.has(r.id) || videos.has(key)) throw new PackError(`"${r.id}" is in the pack twice.`, 'duplicate');
    ids.add(r.id);
    videos.add(key);
    return JSON.parse(JSON.stringify(r));
  });
  const pack = {
    format: PACK_FORMAT,
    version: PACK_VERSION,
    title: cleanText(title, MAX_TITLE_CHARS) || defaultTitle(out),
    exported,
    recipes: out,
  };
  const size = serializePack(pack).length;
  if (size > MAX_PACK_CHARS) throw new PackError(`${tooLarge(size)} Pick fewer recipes.`, 'too-large');
  return pack;
}

/** The pack as file contents. */
export const serializePack = (pack) => JSON.stringify(pack, null, 2) + '\n';

/** A download name such as weeknight-chicken.recipe-pack.json. */
export const packFileName = (pack) => `${slugify(pack?.title) || 'recipes'}.recipe-pack.json`;

function defaultTitle(recipes) {
  return recipes.length === 1 ? cleanText(recipes[0].title, MAX_TITLE_CHARS) : `${recipes.length} recipes`;
}

// ---------- read ----------

/**
 * Check a pack (JSON text or a parsed value). Never throws. Returns
 * { ok, errors, title, exported, version, entries }: `errors` are wrapper problems (ok is
 * false when there are any), and each entry is { index, id, title, recipe, problems } where
 * `recipe` is a clean, migrated, valid copy or null.
 */
export function readPack(input) {
  const result = emptyRead();
  const fail = (msg) => { result.errors.push(msg); return result; };

  let data = input;
  if (typeof input === 'string') {
    if (input.length > MAX_PACK_CHARS) return fail(tooLarge(input.length));
    try {
      data = JSON.parse(input);
    } catch {
      return fail('This is not a JSON file.');
    }
  } else {
    // A parsed pack gets the same limit, measured as JSON text.
    let size;
    try {
      size = JSON.stringify(input)?.length ?? 0;
    } catch (e) {
      return fail(e instanceof RangeError ? tooLarge(Infinity) : 'This is not a recipe pack.');
    }
    if (size > MAX_PACK_CHARS) return fail(tooLarge(size));
  }
  if (!isPlainObject(data)) return fail('This is not a recipe pack.');
  for (const k of Object.keys(data)) {
    if (FORBIDDEN_KEYS.has(k)) return fail(`The pack contains a forbidden key "${k}".`);
  }
  if (data.format !== PACK_FORMAT) return fail(`This is not a recipe pack ("format" must be "${PACK_FORMAT}").`);
  if (!Number.isInteger(data.version) || data.version < 1) return fail('The pack has no valid "version".');
  if (data.version > PACK_VERSION) {
    return fail(`This pack was made by a newer Recipe Bank (pack version ${data.version}). Update Recipe Bank to import it.`);
  }
  for (const k of Object.keys(data)) {
    if (k === 'recipes') continue;
    const bad = findForbidden(data[k], k, 1);
    if (bad) return fail(`The pack contains ${bad}.`);
  }
  if (!Array.isArray(data.recipes)) return fail('The pack has no "recipes" list.');
  if (data.recipes.length === 0) return fail('The pack has no recipes.');
  if (data.recipes.length > MAX_PACK_RECIPES) {
    return fail(`The pack has ${count(data.recipes.length)} recipes; the limit is ${MAX_PACK_RECIPES}.`);
  }

  result.version = data.version;
  result.title = cleanText(data.title, MAX_TITLE_CHARS) || 'Untitled pack';
  result.exported = typeof data.exported === 'string' && !Number.isNaN(Date.parse(data.exported))
    ? cleanText(data.exported, 40)
    : null;
  result.entries = data.recipes.map((raw, index) => readEntry(raw, index));
  result.ok = true;
  return result;
}

function readEntry(raw, index) {
  const entry = { index, id: null, title: '', recipe: null, problems: [] };
  const problem = (msg) => { entry.problems.push(cleanText(String(msg), MAX_PROBLEM_CHARS)); return entry; };
  if (!isPlainObject(raw)) return problem('not a recipe object');
  entry.id = typeof raw.id === 'string' ? cleanText(raw.id, 80) || null : null;
  entry.title = cleanText(raw.title, MAX_TITLE_CHARS);
  const bad = findForbidden(raw, '', 0);
  if (bad) return problem(`contains ${bad}`);

  let recipe;
  try {
    recipe = migrate(raw).recipe;
  } catch (e) {
    return problem(e.message);
  }
  // The preview shows the title and creator name cleaned, so the file gets the same text (migrate made a copy).
  if (typeof recipe.title === 'string') recipe.title = cleanText(recipe.title, MAX_TITLE_CHARS);
  if (isPlainObject(recipe.creator) && typeof recipe.creator.name === 'string') {
    recipe.creator.name = cleanText(recipe.creator.name, MAX_TITLE_CHARS);
  }
  // A pack is untrusted: every other string in the recipe loses control and bidi-override characters too, so the
  // file cannot hold text that reads differently from what the screen shows. Line breaks inside a string stay.
  recipe = stripUnsafeChars(recipe);
  let errs;
  try {
    errs = validateRecipe(recipe);
  } catch {
    errs = ['malformed recipe (a component, ingredient or step is not an object)'];
  }
  if (errs.length) {
    for (const e of errs.slice(0, MAX_PROBLEMS)) problem(e);
    if (errs.length > MAX_PROBLEMS) problem(`…and ${errs.length - MAX_PROBLEMS} more`);
    return entry;
  }
  entry.recipe = JSON.parse(JSON.stringify(recipe));
  return entry;
}

/**
 * Prototype keys (__proto__, constructor, prototype) or absurd nesting anywhere in a recipe:
 * a description such as 'a forbidden key "__proto__" at video.__proto__', or null. Packs refuse
 * them, so the server refuses to save them too.
 */
export const forbiddenKey = (value) => findForbidden(value, '', 0);

// Walks parsed JSON for keys that could pollute prototypes when someone later copies the
// data with Object.assign or a merge helper, and for absurd nesting. Returns a description or null.
function findForbidden(value, path, depth) {
  if (depth > MAX_DEPTH) return `data nested too deeply at ${path || 'the top'}`;
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      const bad = findForbidden(value[i], `${path}[${i}]`, depth + 1);
      if (bad) return bad;
    }
  } else if (value !== null && typeof value === 'object') {
    for (const k of Object.keys(value)) {
      const p = path ? `${path}.${k}` : k;
      if (FORBIDDEN_KEYS.has(k)) return `a forbidden key "${k}" at ${p}`;
      const bad = findForbidden(value[k], p, depth + 1);
      if (bad) return bad;
    }
  }
  return null;
}

/** A plain pack again from a readPack result: valid recipes in place, null where one was invalid. */
export function packFromRead(read) {
  return {
    format: PACK_FORMAT,
    version: PACK_VERSION,
    title: read.title,
    exported: read.exported,
    recipes: read.entries.map((e) => e.recipe),
  };
}

// ---------- plan ----------

/**
 * Decide what importing a pack into `existing` recipes would do, without writing anything.
 * `pack` is a readPack result or anything readPack accepts. `existing` items need `id` and,
 * for duplicate detection, `video` (pass { id } alone for files that only take up a name).
 * Each item gets a status:
 *   new        imported under its own id
 *   conflict   same id as another recipe but a different video: imported under a new id (id-2, id-3, …)
 *   duplicate  same video as a recipe in the bank (inBank) or earlier in this pack: skipped
 *   invalid    fails the contract: skipped, `problems` says why
 */
export function planImport(pack, existing = []) {
  const read = isReadResult(pack) ? pack : readPack(pack);
  const plan = {
    ok: read.ok,
    errors: [...read.errors],
    title: read.title,
    exported: read.exported,
    items: [],
    counts: { new: 0, conflict: 0, duplicate: 0, invalid: 0 },
  };
  if (!read.ok) return plan;

  const ids = new Set();
  const videos = new Map();
  for (const r of existing) {
    if (typeof r?.id === 'string') ids.add(r.id);
    if (r?.video) videos.set(videoKey(r.video), { id: r.id, inBank: true });
  }
  for (const e of read.entries) {
    const item = {
      index: e.index,
      status: 'invalid',
      id: e.id,
      packId: e.id,
      title: e.title || e.id || `Recipe ${e.index + 1}`,
      creator: '',
      recipe: null,
      problems: [...e.problems],
    };
    if (e.recipe) {
      item.creator = cleanText(e.recipe.creator.name, MAX_TITLE_CHARS);
      const key = videoKey(e.recipe.video);
      const dup = videos.get(key);
      if (dup) {
        item.status = 'duplicate';
        item.duplicateOf = dup.id;
        item.inBank = dup.inBank;
      } else {
        const id = uniqueId(e.recipe.id, ids);
        item.status = id === e.recipe.id ? 'new' : 'conflict';
        item.id = id;
        item.recipe = id === e.recipe.id ? e.recipe : { ...e.recipe, id };
        ids.add(id);
        videos.set(key, { id, inBank: false });
      }
    }
    plan.counts[item.status]++;
    plan.items.push(item);
  }
  return plan;
}

// Only objects made by readPack/packFromLink count as read results, so a pack that merely
// looks like one ({ ok: true, entries: [...] }) still goes through readPack.
const readResults = new WeakSet();
const isReadResult = (v) => typeof v === 'object' && v !== null && readResults.has(v);
function emptyRead() {
  const result = { ok: false, errors: [], title: '', exported: null, version: null, entries: [] };
  readResults.add(result);
  return result;
}

/** `base` if it is free, else base-2, base-3, … */
export function uniqueId(base, taken) {
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) {
    const id = `${base}-${n}`;
    if (!taken.has(id)) return id;
  }
}

/** Kebab-case slug of any text: "Crème Brûlée!" → "creme-brulee". */
export function slugify(text, max = 60) {
  return String(text ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, max)
    .replace(/-+$/, '');
}

// ---------- apply ----------

/**
 * The files to write for a plan. `choices` narrows it: { include: [index, …] } imports only
 * those pack positions, { exclude: [index, …] } skips them; by default every new and
 * conflict item is imported. Duplicates and invalid recipes are never imported.
 * Returns { files: [{ index, id, path, contents, recipe }], skipped: [{ index, id, reason }] }.
 * Writing is the caller's job, and callers must never overwrite an existing file.
 */
export function applyImport(plan, choices = {}) {
  if (!plan?.ok) throw new PackError(plan?.errors?.[0] ?? 'There is no valid pack to import.', 'invalid-pack');
  const include = Array.isArray(choices.include) ? new Set(choices.include) : null;
  const exclude = new Set(Array.isArray(choices.exclude) ? choices.exclude : []);
  const files = [];
  const skipped = [];
  for (const item of plan.items) {
    const skip = (reason) => skipped.push({ index: item.index, id: item.id, reason });
    if (include ? !include.has(item.index) : exclude.has(item.index)) { skip('not selected'); continue; }
    if (item.status === 'duplicate') { skip(`same video as "${item.duplicateOf}"`); continue; }
    if (item.status === 'invalid' || !item.recipe) { skip('not a valid recipe'); continue; }
    const errs = validateRecipe(item.recipe, item.id);
    if (errs.length) { skip(errs[0]); continue; }
    files.push({
      index: item.index,
      id: item.id,
      path: `recipes/${item.id}.json`,
      contents: JSON.stringify(item.recipe, null, 2) + '\n',
      recipe: item.recipe,
    });
  }
  return { files, skipped };
}

// ---------- links ----------

/**
 * A link that carries the whole pack in its fragment: `${base}#pack=<base64url of the JSON>`.
 * Throws PackError (code "too-large-for-link") past MAX_LINK_CHARS.
 */
export function packLink(pack, base = '') {
  const data = toBase64url(JSON.stringify(pack));
  if (data.length > MAX_LINK_CHARS) {
    throw new PackError(
      `This pack is too big for a link (${count(data.length)} characters; links hold up to ${count(MAX_LINK_CHARS)}). ` +
        'Download it as a file instead, or pick fewer recipes.',
      'too-large-for-link',
    );
  }
  return `${String(base).split('#')[0]}#pack=${data}`;
}

/** The base64url payload of a pack link (a full URL, a "#pack=…" hash or "pack=…"), or null. */
export function packParam(link) {
  const s = String(link ?? '').trim();
  const i = s.indexOf('#');
  const fragment = i >= 0 ? s.slice(i + 1) : s;
  const m = fragment.match(/(?:^|&)pack=([^&]*)/);
  return m ? m[1] : null;
}

export const hasPackLink = (link) => packParam(link) != null;

/** Read a pack from a link. Never throws; returns a readPack result. */
export function packFromLink(link) {
  const data = packParam(link);
  const failed = (msg) => { const r = emptyRead(); r.errors.push(msg); return r; };
  if (data == null) return failed('This link has no pack in it.');
  if (data.length > MAX_LINK_CHARS) {
    return failed(`This pack link is too long (${count(data.length)} characters; the limit is ${count(MAX_LINK_CHARS)}).`);
  }
  let json;
  try {
    json = fromBase64url(data);
  } catch {
    return failed('This pack link is damaged or incomplete.');
  }
  return readPack(json);
}

export function toBase64url(text) {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromBase64url(data) {
  if (!/^[A-Za-z0-9_-]*$/.test(data) || data.length % 4 === 1) throw new PackError('not base64url', 'bad-link');
  const b64 = data.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (data.length % 4)) % 4);
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

// ---------- utils ----------

function isPlainObject(v) {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}
const count = (n) => n.toLocaleString('en-US');
const tooLarge = (n) => Number.isFinite(n)
  ? `This pack is too large (${count(n)} characters; the limit is ${count(MAX_PACK_CHARS)}).`
  : `This pack is too large (the limit is ${count(MAX_PACK_CHARS)} characters).`;

// Every string in parsed JSON, keys untouched: control characters (except tab and line feed) and bidi overrides,
// isolates and marks are removed. Not length-limited: validateRecipe and the pack size limit bound the text.
const UNSAFE_CHARS = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u061c\u200e\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069]/g;
function stripUnsafeChars(value) {
  if (typeof value === 'string') return value.replace(UNSAFE_CHARS, '');
  if (Array.isArray(value)) return value.map(stripUnsafeChars);
  if (isPlainObject(value)) return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, stripUnsafeChars(v)]));
  return value;
}

// Plain, single-line, bounded text: control and bidi-override characters become spaces.
// HTML is kept as text on purpose; renderers escape it.
function cleanText(value, max) {
  if (typeof value !== 'string') return '';
  const s = value
    .replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return [...s].slice(0, max).join('').trim();
}
