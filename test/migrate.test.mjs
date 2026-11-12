import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { migrate, schemaVersion, MIGRATIONS } from '../lib/migrate.mjs';
import { SCHEMA_VERSION, validateRecipe } from '../lib/recipe.mjs';
import { makeRecipe, tempBank, writeRecipe, recipeText, runScript } from './helpers/bank.mjs';

test('version 1 is the identity and does not touch the input', () => {
  const r = makeRecipe('eggs', 1);
  const before = structuredClone(r);
  const res = migrate(r);
  assert.deepEqual(res.recipe, r);
  assert.notEqual(res.recipe, r, 'returns a copy');
  assert.deepEqual(res.changes, []);
  assert.equal(res.from, 1);
  assert.equal(res.to, SCHEMA_VERSION);
  assert.deepEqual(r, before);
});

test('there is one migration step per version after 1', () => {
  assert.equal(MIGRATIONS.length, SCHEMA_VERSION - 1);
  MIGRATIONS.forEach((m, i) => assert.equal(m.from, i + 1));
});

test('schemaVersion treats a missing field as 1', () => {
  assert.equal(schemaVersion({}), 1);
  assert.equal(schemaVersion({ schema: null }), 1);
  assert.equal(schemaVersion({ schema: 3 }), 3);
});

test('stamp adds the schema field first, only when it is missing', () => {
  const r = makeRecipe('eggs', 1);
  const res = migrate(r, { stamp: true });
  assert.equal(res.recipe.schema, SCHEMA_VERSION);
  assert.equal(Object.keys(res.recipe)[0], 'schema');
  assert.deepEqual(res.changes, [`add "schema": ${SCHEMA_VERSION}`]);
  assert.deepEqual(validateRecipe(res.recipe, 'eggs'), []);
  assert.equal('schema' in r, false, 'input untouched');
  assert.deepEqual(migrate(res.recipe, { stamp: true }).changes, []);
});

test('steps run in order from the recipe’s own version, pure', () => {
  const migrations = [
    { from: 1, up(r) { r.name = r.title; delete r.title; return { recipe: r, changes: ['rename title to name'] }; } },
    { from: 2, up(r) { r.tags = [...r.tags, 'v3']; return { recipe: r, changes: ['tag v3'] }; } },
  ];
  const r = makeRecipe('eggs', 1);
  const res = migrate(r, { to: 3, migrations });
  assert.equal(res.recipe.schema, 3);
  assert.equal(res.recipe.name, 'Recipe eggs');
  assert.equal('title' in res.recipe, false);
  assert.deepEqual(res.recipe.tags, ['test', 'v3']);
  assert.deepEqual(res.changes, ['1 → 2: rename title to name', '2 → 3: tag v3', 'schema 1 → 3']);
  assert.equal(r.title, 'Recipe eggs', 'input untouched');
  assert.equal('schema' in r, false);

  const from2 = migrate({ ...makeRecipe('eggs', 1), schema: 2 }, { to: 3, migrations });
  assert.deepEqual(from2.changes, ['2 → 3: tag v3', 'schema 2 → 3']);
  assert.equal(from2.recipe.title, 'Recipe eggs');
});

test('migrate refuses what it cannot handle', () => {
  const r = makeRecipe('eggs', 1);
  assert.throws(() => migrate({ ...r, schema: SCHEMA_VERSION + 1 }), /newer than this Recipe Bank/);
  assert.throws(() => migrate({ ...r, schema: 'x' }), /positive integer/);
  assert.throws(() => migrate({ ...r, schema: 0 }), /positive integer/);
  assert.throws(() => migrate(r, { to: 2, migrations: [] }), /no migration from schema 1 to 2/);
  assert.throws(() => migrate(r, { to: 2, migrations: [{ from: 1, up: () => null }] }), /must return/);
  assert.throws(() => migrate(null), TypeError);
  assert.throws(() => migrate([r]), TypeError);
});

test('scripts/migrate.mjs: dry run by default, writes only with --write', async () => {
  const a = makeRecipe('a-recipe', 1);
  const b = makeRecipe('b-recipe', 2);
  const dir = await tempBank([a, b]);
  const env = { RECIPE_BANK_DIR: dir };
  try {
    let out = await runScript('migrate.mjs', [], env);
    assert.equal(out.code, 0, out.stderr);
    assert.match(out.stdout, /nothing to migrate/);

    out = await runScript('migrate.mjs', ['--stamp'], env);
    assert.equal(out.code, 0, out.stderr);
    assert.match(out.stdout, /→ a-recipe\.json/);
    assert.match(out.stdout, /2 file\(s\) would change/);
    assert.equal(await readFile(join(dir, 'recipes', 'a-recipe.json'), 'utf8'), recipeText(a), 'dry run writes nothing');

    out = await runScript('migrate.mjs', ['--stamp', '--write'], env);
    assert.equal(out.code, 0, out.stderr);
    assert.match(out.stdout, /2 file\(s\) updated/);
    const saved = JSON.parse(await readFile(join(dir, 'recipes', 'a-recipe.json'), 'utf8'));
    assert.equal(Object.keys(saved)[0], 'schema');
    assert.deepEqual(saved, { schema: SCHEMA_VERSION, ...a });

    out = await runScript('migrate.mjs', ['--stamp'], env);
    assert.match(out.stdout, /nothing to migrate/);

    await writeRecipe(dir, { ...makeRecipe('c-recipe', 3), schema: SCHEMA_VERSION + 1 });
    out = await runScript('migrate.mjs', [], env);
    assert.equal(out.code, 1);
    assert.match(out.stderr, /c-recipe\.json: schema \d+ is newer/);

    out = await runScript('migrate.mjs', ['--force'], env);
    assert.equal(out.code, 2);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
