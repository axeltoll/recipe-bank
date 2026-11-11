// Recipe contract versioning: the schema version, migrations between versions and a
// JSON Schema export of the contract (schema/recipe.schema.json, `npm run schema`).
// Pure functions, no file access; scripts/migrate.mjs and scripts/export-schema.mjs do the I/O.

import { STATUSES, BASES, PLATFORMS, SCHEMA_VERSION } from './recipe.mjs';

export { SCHEMA_VERSION };

/**
 * Migrations, keyed by the version they produce: MIGRATIONS[2] turns a version-1 recipe
 * into version 2. Each one gets a deep copy and returns the new recipe (the `schema`
 * field is set for it). There are none yet: version 1 is the first versioned contract.
 *
 * Example for a future version 2 that renames `serves` to `yield`:
 *   2: ({ serves, ...r }) => ({ ...r, yield: serves ?? null }),
 */
export const MIGRATIONS = Object.freeze({});

/** The contract version of a recipe: its `schema` field, or 1 when there is none. */
export function schemaVersion(recipe) {
  return recipe?.schema == null ? 1 : recipe.schema;
}

/**
 * Bring a recipe up to `to` (default: the current version). Never mutates the input.
 * Returns { recipe, from, to, changed }. Throws on an unknown or newer-than-code version,
 * or when a migration step is missing.
 */
export function migrateRecipe(recipe, { migrations = MIGRATIONS, to = SCHEMA_VERSION } = {}) {
  const from = schemaVersion(recipe);
  if (!Number.isInteger(from) || from < 1) throw new Error(`unknown schema version: ${JSON.stringify(recipe?.schema)}`);
  if (from > to) throw new Error(`schema ${from} is newer than this copy of Recipe Bank understands (${to}); update the code`);
  let out = recipe;
  let v = from;
  while (v < to) {
    const step = migrations[v + 1];
    if (typeof step !== 'function') throw new Error(`no migration from schema ${v} to ${v + 1}`);
    out = { ...step(structuredClone(out)), schema: v + 1 };
    v++;
  }
  return { recipe: out, from, to: v, changed: v !== from };
}

const DATE = '^\\d{4}-\\d{2}-\\d{2}$';
const text = { type: 'string', minLength: 1 };
const lowercase = { type: 'string', minLength: 1, pattern: '^[^A-Z]*$' };

/** The recipe contract as a JSON Schema (draft 2020-12), built from the same constants as validateRecipe. */
export function recipeJsonSchema() {
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: 'https://github.com/axeltoll/recipe-bank/blob/main/schema/recipe.schema.json',
    title: 'Recipe Bank recipe',
    description: 'One recipe, analyzed from a social-media cooking video. One file per recipe: recipes/<id>.json. '
      + 'Generated from lib/schema.mjs by `npm run schema`; lib/recipe.mjs (validateRecipe) is the enforced source of truth.',
    type: 'object',
    required: ['id', 'title', 'status', 'video', 'creator', 'analyzed', 'summary', 'tags', 'components'],
    properties: {
      schema: {
        type: 'integer', minimum: 1, maximum: SCHEMA_VERSION,
        description: 'Contract version. Absent means 1.',
      },
      id: { type: 'string', pattern: '^[a-z0-9]+(?:-[a-z0-9]+)*$', description: 'Kebab-case slug; must equal the filename.' },
      title: text,
      status: { enum: STATUSES, description: 'partial = part of the method is missing; gaps[] lists what.' },
      video: {
        type: 'object',
        required: ['platform', 'url'],
        properties: {
          platform: { enum: PLATFORMS },
          id: { type: ['string', 'null'] },
          url: { type: 'string', minLength: 1 },
        },
      },
      creator: {
        type: 'object',
        required: ['name'],
        properties: {
          name: text,
          handle: { type: ['string', 'null'] },
          url: { type: ['string', 'null'] },
        },
      },
      uploaded: { type: ['string', 'null'], pattern: DATE },
      analyzed: { type: 'string', pattern: DATE },
      summary: text,
      serves: { type: ['string', 'null'], description: 'As stated by the creator, or null.' },
      tags: { type: 'array', items: lowercase },
      components: { type: 'array', minItems: 1, items: { $ref: '#/$defs/component' } },
      nutrition: { oneOf: [{ type: 'null' }, { $ref: '#/$defs/nutrition' }] },
      notes: { type: 'array', items: text },
      gaps: { type: 'array', items: text, description: 'What the video does not say.' },
      source: {
        type: 'object',
        properties: {
          evidence: { type: 'string', description: 'What was checked, e.g. captions and the video description.' },
          quantity_basis: { type: 'string' },
        },
      },
    },
    allOf: [
      {
        if: { properties: { status: { const: 'partial' } }, required: ['status'] },
        then: { required: ['gaps'], properties: { gaps: { minItems: 1 } } },
      },
    ],
    $defs: {
      component: {
        type: 'object',
        required: ['name', 'ingredients', 'steps'],
        properties: {
          name: text,
          ingredients: { type: 'array', items: { $ref: '#/$defs/ingredient' } },
          steps: { type: 'array', items: { $ref: '#/$defs/step' } },
        },
      },
      ingredient: {
        type: 'object',
        required: ['item', 'key', 'basis'],
        properties: {
          item: text,
          key: { ...lowercase, description: 'Shopping-level filter key, e.g. "chicken".' },
          amount: { type: ['string', 'null'], description: "The creator's own words; null when unstated. Never invented." },
          basis: { enum: BASES },
          note: { type: ['string', 'null'] },
        },
        if: { properties: { basis: { const: 'unstated' } }, required: ['basis'] },
        then: { properties: { amount: { type: 'null' } } },
        else: { required: ['amount'], properties: { amount: text } },
      },
      step: {
        type: 'object',
        required: ['text'],
        properties: {
          text,
          t: { type: ['number', 'null'], minimum: 0, description: 'Seconds into the video.' },
        },
      },
      nutrition: {
        type: 'object',
        properties: {
          per: { type: 'string' },
          basis: { enum: BASES },
          calories: { type: 'number' },
          protein_g: { type: 'number' },
          carbs_g: { type: 'number' },
          fat_g: { type: 'number' },
          note: { type: 'string' },
        },
      },
    },
  };
}
