// Recipe contract migrations. A recipe's `schema` field says which contract version it
// was written for (missing = 1); SCHEMA_VERSION in lib/recipe.mjs is the current one.
// Shared by scripts/migrate.mjs, pack import and the browser (served at /lib/), so keep
// it pure: no fs, no DOM.
//
// To change the contract:
//   1. bump SCHEMA_VERSION in lib/recipe.mjs (and `maximum` of `schema` in schema/recipe.schema.json),
//   2. add one step below, { from: <old>, describe, up(recipe) { ...; return { recipe, changes } } },
//   3. run `node scripts/migrate.mjs` to see what changes, then `--write`.
// A step gets its own deep copy, so it may edit it in place. It must not set `schema`;
// migrate() does that.

import { SCHEMA_VERSION } from './recipe.mjs';

/** Ordered steps; MIGRATIONS[i] upgrades version i + 1 to i + 2. Version 1 is the first contract. */
export const MIGRATIONS = Object.freeze([]);

/** The contract version a recipe was written for: its `schema` field, or 1 when missing. */
export function schemaVersion(recipe) {
  return recipe?.schema ?? 1;
}

/**
 * Upgrade a recipe to `to` (default: the current SCHEMA_VERSION). Pure: the input is not changed.
 * Returns { recipe, changes, from, to }; `changes` is a human-readable list, empty when nothing
 * changed. With `stamp: true` a recipe without a `schema` field gets one.
 * Throws RangeError when the recipe is newer than `to`, has an invalid `schema`, or a step is missing.
 */
export function migrate(recipe, { to = SCHEMA_VERSION, migrations = MIGRATIONS, stamp = false } = {}) {
  if (!recipe || typeof recipe !== 'object' || Array.isArray(recipe)) {
    throw new TypeError('a recipe must be a JSON object');
  }
  const from = schemaVersion(recipe);
  if (!Number.isInteger(from) || from < 1) {
    throw new RangeError(`schema must be a positive integer, not ${JSON.stringify(recipe.schema)}`);
  }
  if (from > to) {
    throw new RangeError(`schema ${from} is newer than this Recipe Bank understands (${to}); update Recipe Bank`);
  }

  let out = structuredClone(recipe);
  const changes = [];
  for (let v = from; v < to; v++) {
    const step = migrations.find((m) => m.from === v);
    if (!step) throw new RangeError(`no migration from schema ${v} to ${v + 1}`);
    const res = step.up(structuredClone(out));
    if (!res || typeof res.recipe !== 'object' || res.recipe === null) {
      throw new TypeError(`migration ${v} → ${v + 1} must return { recipe, changes }`);
    }
    out = withSchema(res.recipe, v + 1);
    for (const c of res.changes ?? []) changes.push(`${v} → ${v + 1}: ${c}`);
  }
  if (from < to) changes.push(`schema ${from} → ${to}`);
  else if (stamp && out.schema == null) {
    out = withSchema(out, to);
    changes.push(`add "schema": ${to}`);
  }
  return { recipe: out, changes, from, to };
}

// `schema` goes first so it is the first thing a reader sees in the file.
function withSchema(recipe, version) {
  const { schema, ...rest } = recipe;
  return { schema: version, ...rest };
}
