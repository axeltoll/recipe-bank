// Recipe packs: export some recipes as one file (or a link) and import someone else's,
// with duplicates detected by video. No accounts and no server.
// Pure functions shared by scripts/pack.mjs, the browser (served at /lib/pack.mjs) and the tests.
//
// A pack is { format: 'recipe-bank-pack', version: 1, title, created: 'YYYY-MM-DD', note?, recipes: [recipe, …] }.
// The recipes are ordinary recipe objects, so they keep their creator credit and video link.

import { validateRecipe } from './recipe.mjs';
import { videoKey } from './video.mjs';

export const PACK_FORMAT = 'recipe-bank-pack';
export const PACK_VERSION = 1;
export const LINK_PREFIX = '#/import/';

export class PackError extends Error {
  constructor(message) {
    super(message);
    this.name = 'PackError';
  }
}

const today = () => new Date().toISOString().slice(0, 10);

/** Build a pack. Recipes are deep-copied; a second recipe for the same video is left out. */
export function createPack(recipes, { title = 'Recipe pack', created = today(), note = null } = {}) {
  const seen = new Set();
  const out = [];
  for (const r of recipes ?? []) {
    if (!r || typeof r !== 'object') continue;
    const key = videoKey(r.video);
    if (key && seen.has(key)) continue;
    seen.add(key);
    out.push(structuredClone(r));
  }
  const pack = { format: PACK_FORMAT, version: PACK_VERSION, title: String(title), created };
  if (note) pack.note = String(note);
  pack.recipes = out;
  return pack;
}

/**
 * Read a pack (object or JSON text). Throws PackError when it isn't a pack this code understands.
 * Each recipe is checked against the contract: valid ones are in `recipes`, the rest in
 * `invalid` ({ index, id, errors }), so one bad recipe doesn't block the others.
 */
export function readPack(input) {
  let p = input;
  if (typeof input === 'string') {
    try {
      p = JSON.parse(input);
    } catch {
      throw new PackError('This is not a recipe pack (not JSON).');
    }
  }
  if (!p || typeof p !== 'object' || Array.isArray(p) || p.format !== PACK_FORMAT) {
    throw new PackError('This is not a recipe pack.');
  }
  if (!Number.isInteger(p.version) || p.version < 1 || p.version > PACK_VERSION) {
    throw new PackError(`Pack version ${JSON.stringify(p.version)} is not supported; this copy reads version ${PACK_VERSION}.`);
  }
  if (!Array.isArray(p.recipes)) throw new PackError('The pack has no recipe list.');
  const recipes = [];
  const invalid = [];
  p.recipes.forEach((r, index) => {
    let errors;
    try {
      errors = validateRecipe(r);
    } catch (e) {
      errors = [`unreadable recipe (${e.message})`];
    }
    if (errors.length) invalid.push({ index, id: typeof r?.id === 'string' ? r.id : null, errors });
    else recipes.push(r);
  });
  return {
    title: typeof p.title === 'string' ? p.title : 'Recipe pack',
    created: typeof p.created === 'string' ? p.created : null,
    note: typeof p.note === 'string' ? p.note : null,
    recipes,
    invalid,
  };
}

/**
 * What importing `incoming` into a bank that already has `existing` would do:
 *   add:        recipes to write (ids made unique where needed)
 *   duplicates: [{ id, title, existing }]: same video as a recipe already in the bank (or earlier in the pack); skipped
 *   renamed:    [{ from, to }]: a different video whose id was taken, renamed to id-2, id-3, …
 */
export function planImport(incoming, existing = []) {
  const byVideo = new Map(existing.map((r) => [videoKey(r.video), r.id]));
  const ids = new Set(existing.map((r) => r.id));
  const add = [];
  const duplicates = [];
  const renamed = [];
  for (const r of incoming ?? []) {
    const key = videoKey(r.video);
    if (byVideo.has(key)) {
      duplicates.push({ id: r.id, title: r.title, existing: byVideo.get(key) });
      continue;
    }
    let id = r.id;
    if (ids.has(id)) {
      let n = 2;
      while (ids.has(`${r.id}-${n}`)) n++;
      id = `${r.id}-${n}`;
      renamed.push({ from: r.id, to: id });
    }
    ids.add(id);
    byVideo.set(key, id);
    add.push(id === r.id ? r : { ...r, id });
  }
  return { add, duplicates, renamed };
}

/** Pack → URL-safe text (base64url of the UTF-8 JSON), for a link. */
export function encodePack(pack) {
  const bytes = new TextEncoder().encode(JSON.stringify(pack));
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** URL-safe text → readPack() result. Throws PackError on anything that isn't an encoded pack. */
export function decodePack(text) {
  let json;
  try {
    const b64 = String(text).trim().replace(/-/g, '+').replace(/_/g, '/');
    const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
    json = new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
  } catch {
    throw new PackError('This link does not contain a recipe pack.');
  }
  return readPack(json);
}

/** A shareable link: `${base}#/import/<encoded pack>`. Keep packs small; very long links can be cut off by chat apps. */
export function packLink(pack, base) {
  return `${String(base).replace(/#.*$/, '')}${LINK_PREFIX}${encodePack(pack)}`;
}

/** Read the pack from a link made by packLink(). */
export function packFromLink(link) {
  const s = String(link);
  const at = s.indexOf(LINK_PREFIX);
  if (at < 0) throw new PackError('This link does not contain a recipe pack.');
  return decodePack(s.slice(at + LINK_PREFIX.length));
}
