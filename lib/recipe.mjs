// Recipe file contract. One JSON file per recipe in recipes/<id>.json.
// The full field reference lives in schema/recipe.schema.json; this module is the
// enforced subset (run `npm run validate`).

import { parseVideoUrl } from './video.mjs';

export const STATUSES = ['analyzed', 'partial'];
export const BASES = ['on-screen', 'spoken', 'description', 'unstated'];

/**
 * Version of this contract. A recipe's optional integer `schema` field says which version it
 * was written for; a missing field means 1. lib/migrate.mjs upgrades older files.
 */
export const SCHEMA_VERSION = 1;

export const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Returns a list of human-readable problems; empty means valid. */
export function validateRecipe(r, fileId) {
  const errs = [];
  const need = (cond, msg) => cond || errs.push(msg);
  const str = (v) => typeof v === 'string' && v.trim().length > 0;

  need(r && typeof r === 'object', 'not a JSON object');
  if (errs.length) return errs;

  if (r.schema != null) need(Number.isInteger(r.schema) && r.schema >= 1 && r.schema <= SCHEMA_VERSION, `schema must be an integer from 1 to ${SCHEMA_VERSION}`);
  need(str(r.id) && SLUG.test(r.id), 'id must be a kebab-case slug');
  if (fileId) need(r.id === fileId, `id "${r.id}" must match filename "${fileId}.json"`);
  need(str(r.title), 'title is required');
  need(STATUSES.includes(r.status), `status must be one of ${STATUSES.join(', ')}`);
  need(str(r.summary), 'summary is required');
  need(str(r.analyzed) && DATE.test(r.analyzed), 'analyzed must be YYYY-MM-DD');
  if (r.uploaded != null) need(DATE.test(r.uploaded), 'uploaded must be YYYY-MM-DD');

  const parsed = parseVideoUrl(r.video?.url);
  need(parsed, 'video.url must be a supported YouTube / TikTok / Instagram link');
  if (parsed) {
    need(r.video.platform === parsed.platform, `video.platform must be "${parsed.platform}"`);
    if (parsed.id) need(r.video.id === parsed.id, `video.id must be "${parsed.id}"`);
  }
  need(str(r.creator?.name), 'creator.name is required');
  need(Array.isArray(r.tags) && r.tags.every((t) => str(t) && t === t.toLowerCase()), 'tags must be lowercase strings');

  need(Array.isArray(r.components) && r.components.length > 0, 'components must be a non-empty array');
  (r.components ?? []).forEach((c, ci) => {
    const at = `components[${ci}]`;
    need(str(c.name), `${at}.name is required`);
    need(Array.isArray(c.ingredients), `${at}.ingredients must be an array`);
    need(Array.isArray(c.steps), `${at}.steps must be an array`);
    (c.ingredients ?? []).forEach((ing, ii) => {
      const p = `${at}.ingredients[${ii}]`;
      need(str(ing.item), `${p}.item is required`);
      need(str(ing.key) && ing.key === ing.key.toLowerCase(), `${p}.key must be a lowercase filter key`);
      need(BASES.includes(ing.basis), `${p}.basis must be one of ${BASES.join(', ')}`);
      if (ing.basis === 'unstated') need(ing.amount == null, `${p}.amount must be null when basis is "unstated"`);
      else need(str(ing.amount), `${p}.amount is required when basis is "${ing.basis}"`);
    });
    (c.steps ?? []).forEach((s, si) => {
      const p = `${at}.steps[${si}]`;
      need(str(s.text), `${p}.text is required`);
      if (s.t != null) need(Number.isFinite(s.t) && s.t >= 0, `${p}.t must be seconds >= 0`);
    });
  });

  for (const k of ['notes', 'gaps']) {
    if (r[k] != null) need(Array.isArray(r[k]) && r[k].every(str), `${k} must be an array of strings`);
  }
  if (r.status === 'partial') need(Array.isArray(r.gaps) && r.gaps.length > 0, 'partial recipes must list gaps');
  return errs;
}

/** Unique ingredient filter keys across a recipe. */
export function ingredientKeys(r) {
  const keys = new Set();
  for (const c of r.components ?? []) for (const i of c.ingredients ?? []) keys.add(i.key);
  return [...keys];
}
