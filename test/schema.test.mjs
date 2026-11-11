import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { validateRecipe } from '../lib/recipe.mjs';
import { SCHEMA_VERSION, MIGRATIONS, schemaVersion, migrateRecipe, recipeJsonSchema } from '../lib/schema.mjs';

const ROOT = resolve(import.meta.dirname, '..');

// A small JSON Schema checker for the keywords schema/recipe.schema.json uses (no dependencies).
function is(type, v) {
  switch (type) {
    case 'null': return v === null;
    case 'string': return typeof v === 'string';
    case 'number': return typeof v === 'number' && Number.isFinite(v);
    case 'integer': return Number.isInteger(v);
    case 'boolean': return typeof v === 'boolean';
    case 'array': return Array.isArray(v);
    case 'object': return v !== null && typeof v === 'object' && !Array.isArray(v);
    default: throw new Error(`unsupported type ${type}`);
  }
}
const KNOWN = new Set(['$schema', '$id', 'title', 'description', '$defs', '$ref', 'type', 'enum', 'const', 'minLength', 'pattern',
  'minimum', 'maximum', 'minItems', 'items', 'required', 'properties', 'allOf', 'oneOf', 'if', 'then', 'else']);
function check(schema, value, root, path = '$', errs = []) {
  for (const k of Object.keys(schema)) if (!KNOWN.has(k)) throw new Error(`checker does not know keyword ${k}`);
  if (schema.$ref) return check(schema.$ref.split('/').slice(1).reduce((s, p) => s[p], root), value, root, path, errs);
  if (schema.type != null && ![].concat(schema.type).some((t) => is(t, value))) {
    errs.push(`${path}: expected ${schema.type}`);
    return errs;
  }
  if (schema.enum && !schema.enum.includes(value)) errs.push(`${path}: not one of ${schema.enum}`);
  if ('const' in schema && value !== schema.const) errs.push(`${path}: not ${schema.const}`);
  if (typeof value === 'string') {
    if (schema.minLength != null && value.length < schema.minLength) errs.push(`${path}: too short`);
    if (schema.pattern != null && !new RegExp(schema.pattern, 'u').test(value)) errs.push(`${path}: pattern`);
  }
  if (typeof value === 'number') {
    if (schema.minimum != null && value < schema.minimum) errs.push(`${path}: below minimum`);
    if (schema.maximum != null && value > schema.maximum) errs.push(`${path}: above maximum`);
  }
  if (Array.isArray(value)) {
    if (schema.minItems != null && value.length < schema.minItems) errs.push(`${path}: too few items`);
    if (schema.items) value.forEach((v, i) => check(schema.items, v, root, `${path}[${i}]`, errs));
  }
  if (is('object', value)) {
    for (const k of schema.required ?? []) if (!(k in value)) errs.push(`${path}.${k}: required`);
    for (const [k, s] of Object.entries(schema.properties ?? {})) if (k in value) check(s, value[k], root, `${path}.${k}`, errs);
  }
  for (const s of schema.allOf ?? []) check(s, value, root, path, errs);
  if (schema.oneOf) {
    const passing = schema.oneOf.filter((s) => check(s, value, root, path, []).length === 0).length;
    if (passing !== 1) errs.push(`${path}: matches ${passing} of oneOf`);
  }
  if (schema.if) {
    const branch = check(schema.if, value, root, path, []).length === 0 ? schema.then : schema.else;
    if (branch) check(branch, value, root, path, errs);
  }
  return errs;
}

const SCHEMA = recipeJsonSchema();
const valid = () => ({
  id: 'x', title: 'X', status: 'analyzed', summary: 's', analyzed: '2026-10-12',
  video: { platform: 'youtube', id: 'mhNQ8y5ud0A', url: 'https://youtu.be/mhNQ8y5ud0A' },
  creator: { name: 'c' }, tags: [],
  components: [{ name: 'a', steps: [{ text: 'Do it.', t: 3 }], ingredients: [{ item: 'Salt', key: 'salt', amount: null, basis: 'unstated' }] }],
});

test('schema/recipe.schema.json is the current export of lib/schema.mjs (run npm run schema)', async () => {
  const file = JSON.parse(await readFile(join(ROOT, 'schema', 'recipe.schema.json'), 'utf8'));
  assert.deepEqual(file, SCHEMA);
});

test('every real recipe passes the JSON Schema', async () => {
  const dir = join(ROOT, 'recipes');
  for (const f of (await readdir(dir)).filter((f) => f.endsWith('.json'))) {
    const r = JSON.parse(await readFile(join(dir, f), 'utf8'));
    assert.deepEqual(check(SCHEMA, r, SCHEMA), [], f);
  }
  assert.deepEqual(check(SCHEMA, valid(), SCHEMA), []);
});

test('the JSON Schema and validateRecipe reject the same broken recipes', () => {
  const broken = {
    'invented amount': (r) => { r.components[0].ingredients[0].amount = '1 tsp'; },
    'missing amount': (r) => { r.components[0].ingredients[0].basis = 'spoken'; },
    'uppercase key': (r) => { r.components[0].ingredients[0].key = 'Salt'; },
    'bad basis': (r) => { r.components[0].ingredients[0].basis = 'guessed'; },
    'partial without gaps': (r) => { r.status = 'partial'; },
    'bad status': (r) => { r.status = 'done'; },
    'bad id': (r) => { r.id = 'Not A Slug'; },
    'no components': (r) => { r.components = []; },
    'uppercase tag': (r) => { r.tags = ['Quick']; },
    'negative timestamp': (r) => { r.components[0].steps[0].t = -1; },
    'bad date': (r) => { r.analyzed = '12/10/2026'; },
    'future schema': (r) => { r.schema = SCHEMA_VERSION + 1; },
    'no creator name': (r) => { r.creator = {}; },
  };
  for (const [name, breakIt] of Object.entries(broken)) {
    const r = valid();
    breakIt(r);
    assert.notDeepEqual(check(SCHEMA, r, SCHEMA), [], `schema accepts: ${name}`);
    assert.notDeepEqual(validateRecipe(r, r.id), [], `validateRecipe accepts: ${name}`);
  }
});

test('validateRecipe accepts the current schema version and nothing else', () => {
  assert.deepEqual(validateRecipe({ ...valid(), schema: 1 }, 'x'), []);
  for (const v of [0, 2, '1', 1.5]) {
    assert.ok(validateRecipe({ ...valid(), schema: v }, 'x').some((e) => e.startsWith('schema')), String(v));
  }
});

test('migrateRecipe: no-op at the current version', () => {
  assert.equal(SCHEMA_VERSION, 1);
  assert.deepEqual(MIGRATIONS, {});
  const r = valid();
  assert.equal(schemaVersion(r), 1);
  assert.equal(schemaVersion({ schema: 3 }), 3);
  const out = migrateRecipe(r);
  assert.deepEqual(out, { recipe: r, from: 1, to: 1, changed: false });
});

test('migrateRecipe runs each step in order on a copy', () => {
  const migrations = {
    2: ({ serves, ...r }) => ({ ...r, yield: serves ?? null }),
    3: (r) => ({ ...r, tags: [...r.tags, 'migrated'] }),
  };
  const r = { ...valid(), serves: '4' };
  const out = migrateRecipe(r, { migrations, to: 3 });
  assert.equal(out.from, 1);
  assert.equal(out.to, 3);
  assert.equal(out.changed, true);
  assert.equal(out.recipe.schema, 3);
  assert.equal(out.recipe.yield, '4');
  assert.equal('serves' in out.recipe, false);
  assert.deepEqual(out.recipe.tags, ['migrated']);
  assert.equal(r.serves, '4', 'input untouched');
  assert.deepEqual(r.tags, []);
  assert.equal(migrateRecipe({ ...r, schema: 2 }, { migrations, to: 3 }).recipe.tags.length, 1);
});

test('migrateRecipe refuses what it cannot do', () => {
  assert.throws(() => migrateRecipe(valid(), { migrations: {}, to: 2 }), /no migration from schema 1 to 2/);
  assert.throws(() => migrateRecipe({ ...valid(), schema: 5 }), /newer than this copy/);
  assert.throws(() => migrateRecipe({ ...valid(), schema: 0 }), /unknown schema version/);
  assert.throws(() => migrateRecipe({ ...valid(), schema: 'one' }), /unknown schema version/);
});
