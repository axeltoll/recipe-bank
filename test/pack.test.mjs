import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadRecipes } from '../server.mjs';
import {
  PACK_FORMAT, PACK_VERSION, PackError, createPack, readPack, planImport, encodePack, decodePack, packLink, packFromLink,
} from '../lib/pack.mjs';

const recipe = (id, ytId, title = id) => ({
  id, title, status: 'analyzed', summary: 's', analyzed: '2026-11-11',
  video: { platform: 'youtube', id: ytId, url: `https://www.youtube.com/shorts/${ytId}` },
  creator: { name: 'Crème Brûlée Kitchen' }, tags: ['dessert'],
  components: [{ name: 'Main', steps: [{ text: 'Whisk ½ cup — gently.', t: 2 }], ingredients: [{ item: 'Sugar', key: 'sugar', amount: '½ cup', basis: 'spoken' }] }],
});
const a = recipe('alpha', 'AAAAAAAAAAA', 'Alpha');
const b = recipe('beta', 'BBBBBBBBBBB', 'Beta');

test('createPack copies recipes, adds metadata and drops a second copy of the same video', () => {
  const pack = createPack([a, b, { ...a, id: 'alpha-again' }, null], { title: 'Desserts', created: '2026-11-11', note: 'try these' });
  assert.equal(pack.format, PACK_FORMAT);
  assert.equal(pack.version, PACK_VERSION);
  assert.equal(pack.title, 'Desserts');
  assert.equal(pack.created, '2026-11-11');
  assert.equal(pack.note, 'try these');
  assert.deepEqual(pack.recipes.map((r) => r.id), ['alpha', 'beta']);
  assert.notEqual(pack.recipes[0], a, 'deep copy');
  pack.recipes[0].title = 'changed';
  assert.equal(a.title, 'Alpha');
  assert.equal('note' in createPack([a]), false);
  assert.match(createPack([]).created, /^\d{4}-\d{2}-\d{2}$/);
});

test('readPack checks the format and each recipe', () => {
  const pack = createPack([a, b], { created: '2026-11-11' });
  const bad = { ...b, id: 'Bad Id' };
  const read = readPack(JSON.stringify({ ...pack, recipes: [a, bad, 'nonsense', null] }));
  assert.deepEqual(read.recipes.map((r) => r.id), ['alpha']);
  assert.deepEqual(read.invalid.map((x) => [x.index, x.id]), [[1, 'Bad Id'], [2, null], [3, null]]);
  assert.ok(read.invalid[0].errors.some((e) => e.includes('kebab-case')));
  assert.equal(read.title, 'Recipe pack');
  assert.equal(read.created, '2026-11-11');
  assert.equal(read.note, null);

  for (const input of ['{ nope', '[]', '{}', JSON.stringify({ format: 'other' }), null]) {
    assert.throws(() => readPack(input), PackError, String(input));
  }
  assert.throws(() => readPack({ ...pack, version: 2 }), /version 2 is not supported/);
  assert.throws(() => readPack({ ...pack, version: '1' }), PackError);
  assert.throws(() => readPack({ ...pack, recipes: 'x' }), /no recipe list/);
});

test('planImport skips videos already in the bank and renames taken ids', () => {
  const existing = [a, recipe('beta', 'ZZZZZZZZZZZ'), recipe('beta-2', 'YYYYYYYYYYY')];
  const incoming = [
    { ...a, id: 'alpha-copy' }, // same video as alpha: skip
    b, // different video, id "beta" taken (and beta-2 too): becomes beta-3
    recipe('gamma', 'CCCCCCCCCCC'), // new
    recipe('gamma-dupe', 'CCCCCCCCCCC'), // same video as gamma earlier in the pack: skip
  ];
  const plan = planImport(incoming, existing);
  assert.deepEqual(plan.add.map((r) => r.id), ['beta-3', 'gamma']);
  assert.equal(plan.add[0].video.id, 'BBBBBBBBBBB');
  assert.equal(b.id, 'beta', 'input untouched');
  assert.deepEqual(plan.duplicates, [
    { id: 'alpha-copy', title: 'Alpha', existing: 'alpha' },
    { id: 'gamma-dupe', title: 'gamma-dupe', existing: 'gamma' },
  ]);
  assert.deepEqual(plan.renamed, [{ from: 'beta', to: 'beta-3' }]);
  assert.deepEqual(planImport([a]).add, [a]);
});

test('a pack survives a link, including non-ASCII text', () => {
  const pack = createPack([a], { title: 'Crème & brûlée', created: '2026-11-11' });
  const encoded = encodePack(pack);
  assert.match(encoded, /^[A-Za-z0-9_-]+$/);
  const back = decodePack(encoded);
  assert.equal(back.title, 'Crème & brûlée');
  assert.deepEqual(back.recipes, [a]);

  const link = packLink(pack, 'https://example.org/#/r/old');
  assert.ok(link.startsWith('https://example.org/#/import/'));
  assert.deepEqual(packFromLink(link).recipes, [a]);
  assert.throws(() => packFromLink('https://example.org/#/r/alpha'), PackError);
  assert.throws(() => decodePack('%%%not base64%%%'), PackError);
  assert.throws(() => decodePack(btoa('{"format":"other"}')), PackError);
});

test('every real recipe round-trips through a pack', async () => {
  const { recipes } = await loadRecipes();
  const read = decodePack(encodePack(createPack(recipes)));
  assert.equal(read.invalid.length, 0);
  assert.deepEqual(read.recipes, recipes);
  const plan = planImport(read.recipes, recipes);
  assert.equal(plan.add.length, 0);
  assert.equal(plan.duplicates.length, recipes.length);
});
