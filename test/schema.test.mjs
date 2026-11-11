// Cross-checks schema/recipe.schema.json against the enforced contract in lib/recipe.mjs:
// every need(...) rule in validateRecipe has a matching schema rule, and good and bad
// fixtures (plus every real recipe file) are judged the same way by both.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { validateRecipe, STATUSES, BASES, SLUG, DATE, SCHEMA_VERSION } from '../lib/recipe.mjs';
import { validateSchema, SUPPORTED_KEYWORDS } from '../lib/json-schema.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const schema = JSON.parse(await readFile(join(ROOT, 'schema', 'recipe.schema.json'), 'utf8'));
const contractSource = await readFile(join(ROOT, 'lib', 'recipe.mjs'), 'utf8');

const at = (pointer) =>
  pointer.split('/').slice(1).reduce((node, k) => node?.[k.replace(/~1/g, '/').replace(/~0/g, '~')], schema);
const schemaOk = (r) => validateSchema(schema, r).length === 0;
const contractOk = (r, fileId) => validateRecipe(r, fileId).length === 0;

const good = () => ({
  schema: 1,
  id: 'good-recipe',
  title: 'Good recipe',
  status: 'analyzed',
  video: { platform: 'youtube', id: 'mhNQ8y5ud0A', url: 'https://www.youtube.com/shorts/mhNQ8y5ud0A' },
  creator: { name: 'A creator', handle: '@creator', url: 'https://www.youtube.com/@creator' },
  uploaded: '2026-02-11',
  analyzed: '2026-10-02',
  summary: 'Two plain sentences.',
  serves: '2',
  tags: ['chicken', 'pan sauce'],
  components: [{
    name: 'Chicken',
    ingredients: [
      { item: 'Chicken thighs', key: 'chicken', amount: '2 per person', basis: 'spoken', note: 'skin on' },
      { item: 'Salt', key: 'salt', amount: null, basis: 'unstated' },
    ],
    steps: [{ text: 'Salt the chicken.', t: 10 }, { text: 'Cook it.' }],
  }],
  nutrition: { per: 'serving', basis: 'description', calories: 500, protein_g: 40, carbs_g: null, fat_g: 20.5, note: 'From the description.' },
  notes: ['A note.'],
  gaps: [],
  source: { evidence: 'captions', quantity_basis: 'Spoken.' },
});
const mutate = (fn) => () => { const r = good(); fn(r); return r; };

const minimal = () => ({
  id: 'good-recipe', title: 'Minimal', status: 'analyzed',
  video: { platform: 'youtube', id: 'mhNQ8y5ud0A', url: 'https://youtu.be/mhNQ8y5ud0A' },
  creator: { name: 'C' }, analyzed: '2026-10-02', summary: 'S.', tags: [],
  components: [{ name: 'All', ingredients: [], steps: [] }],
});

// One entry per need(...) line in validateRecipe. `line` is a fragment of that source line,
// `expect` a fragment of the message it produces, `schema` the JSON pointer(s) of the matching
// schema rule (null when the rule cannot be expressed), `bad` a recipe that breaks the rule.
const RULES = [
  { line: 'not a JSON object', expect: 'not a JSON object', schema: '/type', bad: () => 'a string' },
  { line: 'schema must be', expect: 'schema must be an integer', schema: '/properties/schema/maximum', bad: mutate((r) => { r.schema = 2; }) },
  { line: 'id must be a kebab-case slug', expect: 'id must be a kebab-case slug', schema: '/properties/id/pattern', bad: mutate((r) => { r.id = 'Not A Slug'; }) },
  { line: 'must match filename', expect: 'must match filename', schema: null, why: 'the filename is not part of the document', fileId: 'other-name', bad: good },
  { line: 'title is required', expect: 'title is required', schema: '/properties/title/$ref', bad: mutate((r) => { r.title = '  '; }) },
  { line: 'status must be one of', expect: 'status must be one of', schema: '/properties/status/enum', bad: mutate((r) => { r.status = 'draft'; }) },
  { line: 'summary is required', expect: 'summary is required', schema: '/required', bad: mutate((r) => { delete r.summary; }) },
  { line: 'analyzed must be YYYY-MM-DD', expect: 'analyzed must be', schema: '/properties/analyzed/pattern', bad: mutate((r) => { r.analyzed = '2026-1-1'; }) },
  { line: 'uploaded must be YYYY-MM-DD', expect: 'uploaded must be', schema: '/properties/uploaded/pattern', bad: mutate((r) => { r.uploaded = 'yesterday'; }) },
  {
    line: 'video.url must be', expect: 'video.url must be', exact: false,
    schema: ['/$defs/video/properties/url/pattern', '/$defs/video/allOf/0/then/properties/url/pattern'],
    bad: mutate((r) => { r.video.url = 'https://example.com/watch?v=mhNQ8y5ud0A'; }),
  },
  {
    line: 'video.platform must be', expect: 'video.platform must be', exact: false,
    schema: ['/$defs/video/properties/platform/enum', '/$defs/video/allOf/1/then/properties/url/pattern'],
    bad: mutate((r) => { r.video.platform = 'tiktok'; }),
  },
  {
    line: 'video.id must be', expect: 'video.id must be', exact: false,
    schema: '/$defs/video/allOf/0/then/properties/id/pattern',
    bad: mutate((r) => { r.video.id = 'short'; }),
  },
  { line: 'creator.name is required', expect: 'creator.name is required', schema: '/$defs/creator/required', bad: mutate((r) => { r.creator = {}; }) },
  { line: 'tags must be lowercase strings', expect: 'tags must be lowercase', schema: '/$defs/lowercaseText/allOf/1/pattern', bad: mutate((r) => { r.tags = ['Chicken']; }) },
  { line: 'components must be a non-empty array', expect: 'components must be a non-empty array', schema: '/properties/components/minItems', bad: mutate((r) => { r.components = []; }) },
  { line: '${at}.name', expect: 'components[0].name is required', schema: '/$defs/component/properties/name/$ref', bad: mutate((r) => { r.components[0].name = ''; }) },
  { line: '${at}.ingredients', expect: 'components[0].ingredients must be an array', schema: '/$defs/component/properties/ingredients/type', bad: mutate((r) => { delete r.components[0].ingredients; }) },
  { line: '${at}.steps', expect: 'components[0].steps must be an array', schema: '/$defs/component/properties/steps/type', bad: mutate((r) => { delete r.components[0].steps; }) },
  { line: '${p}.item', expect: 'ingredients[0].item is required', schema: '/$defs/ingredient/properties/item/$ref', bad: mutate((r) => { r.components[0].ingredients[0].item = ''; }) },
  { line: '${p}.key', expect: 'ingredients[0].key must be a lowercase', schema: '/$defs/ingredient/properties/key/$ref', bad: mutate((r) => { r.components[0].ingredients[0].key = 'Chicken'; }) },
  { line: '${p}.basis', expect: 'ingredients[0].basis must be one of', schema: '/$defs/ingredient/properties/basis/enum', bad: mutate((r) => { r.components[0].ingredients[0].basis = 'guessed'; }) },
  { line: '${p}.amount must be null', expect: 'ingredients[1].amount must be null', schema: '/$defs/ingredient/then/properties/amount/type', bad: mutate((r) => { r.components[0].ingredients[1].amount = '1 tsp'; }) },
  { line: '${p}.amount is required', expect: 'ingredients[0].amount is required', schema: '/$defs/ingredient/else/required', bad: mutate((r) => { r.components[0].ingredients[0].amount = null; }) },
  { line: '${p}.text', expect: 'steps[0].text is required', schema: '/$defs/step/properties/text/$ref', bad: mutate((r) => { r.components[0].steps[0].text = ' '; }) },
  { line: '${p}.t must', expect: 'steps[0].t must be seconds', schema: '/$defs/step/properties/t/minimum', bad: mutate((r) => { r.components[0].steps[0].t = -1; }) },
  { line: '${k} must be', expect: 'notes must be an array of strings', schema: ['/properties/notes/items/$ref', '/properties/gaps/items/$ref'], bad: mutate((r) => { r.notes = ['ok', 3]; }) },
  { line: 'partial recipes must list gaps', expect: 'partial recipes must list gaps', schema: '/allOf/0/then/properties/gaps/minItems', bad: mutate((r) => { r.status = 'partial'; r.gaps = []; }) },
];

test('every validateRecipe rule has exactly one entry in the cross-check table', () => {
  const lines = contractSource.split('\n').filter((l) => l.includes('need('));
  assert.equal(lines.length, RULES.length, 'number of need(...) rules in lib/recipe.mjs');
  for (const l of lines) {
    const hits = RULES.filter((r) => l.includes(r.line));
    assert.equal(hits.length, 1, `rule line should match one table entry: ${l.trim()}`);
  }
  for (const r of RULES) assert.ok(lines.some((l) => l.includes(r.line)), `table entry has a rule: ${r.line}`);
});

for (const rule of RULES) {
  test(`schema mirrors rule: ${rule.line}`, () => {
    const value = rule.bad();
    const errs = validateRecipe(value, rule.fileId ?? 'good-recipe');
    assert.ok(errs.some((e) => e.includes(rule.expect)), `validateRecipe should say "${rule.expect}", got ${JSON.stringify(errs)}`);
    if (rule.schema === null) {
      assert.ok(rule.why, 'an inexpressible rule says why');
      assert.ok(schemaOk(value), 'the document itself is valid; only the filename is wrong');
      return;
    }
    for (const p of [].concat(rule.schema)) assert.notEqual(at(p), undefined, `schema has ${p}`);
    assert.ok(!schemaOk(value), `schema should reject: ${rule.line}`);
  });
}

test('good fixtures are accepted by both', () => {
  const fixtures = {
    full: good(),
    minimal: minimal(),
    partial: { ...minimal(), status: 'partial', gaps: ['No amounts are given.'] },
    'no schema field': (() => { const r = good(); delete r.schema; return r; })(),
    'null optionals': { ...good(), schema: null, uploaded: null, serves: null, nutrition: null, notes: null, source: null, gaps: null },
    'empty component lists': { ...minimal(), components: [{ name: 'x', ingredients: [], steps: [] }] },
    tiktok: { ...minimal(), video: { platform: 'tiktok', id: '7301234567890123456', url: 'https://www.tiktok.com/@cook/video/7301234567890123456' } },
    'tiktok short link': { ...minimal(), video: { platform: 'tiktok', id: null, url: 'https://vm.tiktok.com/ZMabc123/' } },
    instagram: { ...minimal(), video: { platform: 'instagram', id: 'DexeTQVzoT8', url: 'https://www.instagram.com/reel/DexeTQVzoT8/' } },
    'extra fields': { ...good(), favourite: true },
  };
  for (const [name, r] of Object.entries(fixtures)) {
    assert.deepEqual(validateRecipe(r, 'good-recipe'), [], `contract: ${name}`);
    assert.deepEqual(validateSchema(schema, r), [], `schema: ${name}`);
  }
});

test('bad fixtures are rejected by both', () => {
  const fixtures = {
    'null': null,
    array: [],
    'missing video': mutate((r) => { delete r.video; })(),
    'missing creator': mutate((r) => { delete r.creator; })(),
    'tags not a list': mutate((r) => { r.tags = 'chicken'; })(),
    'partial without gaps': mutate((r) => { r.status = 'partial'; delete r.gaps; })(),
    'basis missing': mutate((r) => { delete r.components[0].ingredients[0].basis; })(),
    'empty amount on spoken': mutate((r) => { r.components[0].ingredients[0].amount = ''; })(),
    'empty amount on unstated': mutate((r) => { r.components[0].ingredients[1].amount = ''; })(),
    'schema 0': mutate((r) => { r.schema = 0; })(),
    'schema 1.5': mutate((r) => { r.schema = 1.5; })(),
    'schema as text': mutate((r) => { r.schema = '1'; })(),
  };
  for (const [name, r] of Object.entries(fixtures)) {
    assert.ok(!contractOk(r, 'good-recipe'), `contract should reject: ${name}`);
    assert.ok(!schemaOk(r), `schema should reject: ${name}`);
  }
  for (const rule of RULES.filter((r) => r.schema !== null)) {
    const r = rule.bad();
    assert.equal(contractOk(r, 'good-recipe'), schemaOk(r), `same verdict: ${rule.line}`);
  }
});

test('the schema also checks optional fields that validateRecipe skips', () => {
  const stricter = {
    'handle without @': mutate((r) => { r.creator.handle = 'creator'; }),
    'creator url not http': mutate((r) => { r.creator.url = 'javascript:alert(1)'; }),
    'calories as text': mutate((r) => { r.nutrition.calories = 'lots'; }),
    'negative protein': mutate((r) => { r.nutrition.protein_g = -5; }),
    'nutrition without per': mutate((r) => { delete r.nutrition.per; }),
    'nutrition basis unstated': mutate((r) => { r.nutrition.basis = 'unstated'; }),
    'source evidence as number': mutate((r) => { r.source.evidence = 3; }),
    'ingredient note as number': mutate((r) => { r.components[0].ingredients[0].note = 3; }),
    'serves as number': mutate((r) => { r.serves = 4; }),
  };
  for (const [name, make] of Object.entries(stricter)) {
    const r = make();
    assert.deepEqual(validateRecipe(r, 'good-recipe'), [], `contract ignores: ${name}`);
    assert.ok(!schemaOk(r), `schema rejects: ${name}`);
  }
});

test('every recipe file passes the JSON Schema', async () => {
  const dir = join(ROOT, 'recipes');
  const files = (await readdir(dir)).filter((f) => f.endsWith('.json'));
  assert.ok(files.length > 0);
  for (const f of files) {
    const r = JSON.parse(await readFile(join(dir, f), 'utf8'));
    assert.deepEqual(validateSchema(schema, r), [], f);
  }
});

test('schema constants match lib/recipe.mjs', () => {
  assert.equal(schema.$schema, 'https://json-schema.org/draft/2020-12/schema');
  assert.deepEqual(schema.properties.status.enum, STATUSES);
  assert.deepEqual(schema.$defs.ingredient.properties.basis.enum, BASES);
  assert.equal(schema.properties.id.pattern, SLUG.source);
  assert.equal(schema.properties.analyzed.pattern, DATE.source);
  assert.equal(schema.properties.uploaded.pattern, DATE.source);
  assert.equal(schema.properties.schema.maximum, SCHEMA_VERSION);
});

test('the schema only uses keywords the subset validator understands', () => {
  const walk = (node, path) => {
    if (Array.isArray(node)) return node.forEach((n, i) => walk(n, `${path}/${i}`));
    if (!node || typeof node !== 'object') return;
    for (const [k, v] of Object.entries(node)) {
      assert.ok(SUPPORTED_KEYWORDS.has(k), `unsupported keyword ${path}/${k}`);
      if (k === 'properties' || k === '$defs') for (const [name, sub] of Object.entries(v)) walk(sub, `${path}/${k}/${name}`);
      else if (['items', 'additionalProperties', 'if', 'then', 'else', 'allOf', 'anyOf'].includes(k)) walk(v, `${path}/${k}`);
    }
  };
  walk(schema, '');
});

test('the subset validator handles the keywords it claims', () => {
  const s = {
    $defs: { n: { type: 'integer', minimum: 1 } },
    type: 'object',
    required: ['a'],
    properties: { a: { $ref: '#/$defs/n' }, b: { anyOf: [{ type: 'string', minLength: 2 }, { type: 'null' }] } },
    additionalProperties: false,
  };
  assert.deepEqual(validateSchema(s, { a: 2 }), []);
  assert.deepEqual(validateSchema(s, { a: 2, b: null }), []);
  assert.equal(validateSchema(s, { a: 0 })[0].path, 'a');
  assert.equal(validateSchema(s, {})[0].message, 'is required');
  assert.equal(validateSchema(s, { a: 1, b: 'x' }).length, 1);
  assert.equal(validateSchema(s, { a: 1, c: 1 })[0].path, 'c');
  assert.throws(() => validateSchema({ oneOf: [] }, 1), /unsupported schema keyword "oneOf"/);
  assert.throws(() => validateSchema({ $ref: 'https://example.com/x' }, 1), /only local \$ref/);
});
