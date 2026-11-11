import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import {
  PACK_FORMAT, PACK_VERSION, MAX_PACK_CHARS, MAX_PACK_RECIPES, MAX_LINK_CHARS, MAX_TITLE_CHARS, PackError,
  exportPack, serializePack, packFileName, readPack, packFromRead, planImport, applyImport,
  packLink, packFromLink, packParam, hasPackLink, toBase64url, fromBase64url, slugify, uniqueId,
} from '../lib/pack.mjs';
import { validateRecipe } from '../lib/recipe.mjs';
import { makeRecipe, ROOT } from './helpers/bank.mjs';

const EXPORTED = '2026-11-11T10:00:00.000Z';
const wrap = (recipes, extra = {}) => ({ format: PACK_FORMAT, version: PACK_VERSION, title: 'T', exported: EXPORTED, recipes, ...extra });
const notPolluted = () => {
  assert.equal(({}).polluted, undefined);
  assert.equal(Object.prototype.polluted, undefined);
};

// ---------- export ----------

test('exportPack builds the documented wrapper with copies of the recipes', () => {
  const a = makeRecipe('alpha', 1);
  const b = makeRecipe('beta', 2);
  const pack = exportPack([a, b], { title: '  Weeknight\n  dinners ', exported: EXPORTED });
  assert.deepEqual(Object.keys(pack), ['format', 'version', 'title', 'exported', 'recipes']);
  assert.equal(pack.format, 'recipe-bank-pack');
  assert.equal(pack.version, 1);
  assert.equal(pack.title, 'Weeknight dinners');
  assert.equal(pack.exported, EXPORTED);
  assert.deepEqual(pack.recipes, [a, b]);
  assert.notEqual(pack.recipes[0], a);
  assert.equal(exportPack([a]).title, 'Recipe alpha', 'one recipe: its title');
  assert.equal(exportPack([a, b]).title, '2 recipes');
  assert.ok(!Number.isNaN(Date.parse(exportPack([a]).exported)), 'exported defaults to now');
  assert.equal(exportPack([a], { title: 'x'.repeat(500) }).title.length, MAX_TITLE_CHARS);
});

test('exportPack refuses empty, invalid and doubled recipes', () => {
  const a = makeRecipe('alpha', 1);
  const code = (fn) => { try { fn(); } catch (e) { assert.ok(e instanceof PackError); return e.code; } return 'no error'; };
  assert.equal(code(() => exportPack([])), 'empty');
  assert.equal(code(() => exportPack(null)), 'empty');
  assert.equal(code(() => exportPack([{ ...a, status: 'draft' }])), 'invalid-recipe');
  assert.equal(code(() => exportPack([a, a])), 'duplicate');
  assert.equal(code(() => exportPack([a, { ...makeRecipe('other', 1) }])), 'duplicate', 'same video, other id');
  assert.equal(code(() => exportPack(Array.from({ length: MAX_PACK_RECIPES + 1 }, (_, i) => makeRecipe(`r${i}`, i)))), 'too-many');
});

test('serializePack and packFileName', () => {
  const pack = exportPack([makeRecipe('alpha', 1)], { title: 'Crème Brûlée & Friends!', exported: EXPORTED });
  assert.deepEqual(JSON.parse(serializePack(pack)), pack);
  assert.ok(serializePack(pack).endsWith('}\n'));
  assert.equal(packFileName(pack), 'creme-brulee-friends.recipe-pack.json');
  assert.equal(packFileName({ title: '<<>>' }), 'recipes.recipe-pack.json');
});

// ---------- read ----------

test('readPack round-trips an exported pack', () => {
  const a = makeRecipe('alpha', 1);
  const b = makeRecipe('beta', 2, { schema: 1 });
  const read = readPack(serializePack(exportPack([a, b], { title: 'Two', exported: EXPORTED })));
  assert.equal(read.ok, true);
  assert.deepEqual(read.errors, []);
  assert.equal(read.title, 'Two');
  assert.equal(read.exported, EXPORTED);
  assert.equal(read.version, 1);
  assert.equal(read.entries.length, 2);
  assert.deepEqual(read.entries.map((e) => [e.index, e.id, e.title, e.problems]), [[0, 'alpha', 'Recipe alpha', []], [1, 'beta', 'Recipe beta', []]]);
  assert.deepEqual(read.entries[0].recipe, a);
  assert.deepEqual(read.entries[1].recipe, b);
  assert.deepEqual(readPack(wrap([a])).entries[0].recipe, a, 'accepts a parsed object too');
});

test('readPack rejects wrappers that are not a usable pack', () => {
  const a = makeRecipe('alpha', 1);
  const cases = [
    ['not json {', /not a JSON file/],
    ['[]', /not a recipe pack/],
    ['"text"', /not a recipe pack/],
    [JSON.stringify(wrap([a], { format: 'zip' })), /"format" must be "recipe-bank-pack"/],
    [JSON.stringify(wrap([a], { version: 2 })), /newer Recipe Bank/],
    [JSON.stringify(wrap([a], { version: '1' })), /valid "version"/],
    [JSON.stringify(wrap([a], { version: 0 })), /valid "version"/],
    [JSON.stringify(wrap(undefined)), /no "recipes" list/],
    [JSON.stringify(wrap({ 0: a })), /no "recipes" list/],
    [JSON.stringify(wrap([])), /no recipes/],
    [JSON.stringify(wrap(Array(MAX_PACK_RECIPES + 1).fill(null))), /limit is 200/],
    ['x'.repeat(MAX_PACK_CHARS + 1), /too large/],
  ];
  for (const [input, re] of cases) {
    const read = readPack(input);
    assert.equal(read.ok, false, String(input).slice(0, 60));
    assert.match(read.errors[0], re);
    assert.deepEqual(read.entries, []);
  }
  for (const v of [null, undefined, 42, []]) assert.equal(readPack(v).ok, false);
});

test('hostile packs: prototype-pollution keys are refused, nothing is polluted', () => {
  const recipe = JSON.stringify(makeRecipe('alpha', 1));
  const top = `{"format":"recipe-bank-pack","version":1,"__proto__":{"polluted":true},"recipes":[${recipe}]}`;
  let read = readPack(top);
  assert.equal(read.ok, false);
  assert.match(read.errors[0], /forbidden key "__proto__"/);

  const inTitle = `{"format":"recipe-bank-pack","version":1,"title":{"constructor":{"prototype":{"polluted":true}}},"recipes":[${recipe}]}`;
  read = readPack(inTitle);
  assert.equal(read.ok, false);
  assert.match(read.errors[0], /forbidden key "constructor" at title\.constructor/);

  const inRecipe = recipe.replace('"components":[{', '"components":[{"__proto__":{"polluted":true},');
  assert.notEqual(inRecipe, recipe);
  const other = recipe.replace('"id":"alpha"', '"id":"beta"').replaceAll('testvideo01', 'testvideo02');
  read = readPack(`{"format":"recipe-bank-pack","version":1,"recipes":[${other},${inRecipe}]}`);
  assert.equal(read.ok, true, 'one bad recipe does not sink the pack');
  assert.notEqual(read.entries[0].recipe, null);
  assert.equal(read.entries[1].recipe, null);
  assert.match(read.entries[1].problems[0], /forbidden key "__proto__" at components\[0\]\.__proto__/);

  const plan = planImport(read, []);
  assert.deepEqual(plan.counts, { new: 1, conflict: 0, duplicate: 0, invalid: 1 });
  const { files } = applyImport(plan);
  assert.equal(files.length, 1);
  assert.equal(JSON.parse(files[0].contents).id, 'beta');
  notPolluted();

  // A JS caller passing a prototype-carrying object is refused too.
  assert.equal(readPack(Object.create({ format: PACK_FORMAT, version: 1, recipes: [] })).ok, false);
});

test('hostile packs: absurd nesting is refused without blowing the stack', () => {
  let deep = '1';
  for (let i = 0; i < 1000; i++) deep = `[${deep}]`;
  const read = readPack(`{"format":"recipe-bank-pack","version":1,"extra":${deep},"recipes":[${JSON.stringify(makeRecipe('alpha', 1))}]}`);
  assert.equal(read.ok, false);
  assert.match(read.errors[0], /nested too deeply/);

  const deepRecipe = { ...makeRecipe('alpha', 1), extra: JSON.parse(deep) };
  const r2 = readPack(wrap([deepRecipe]));
  assert.equal(r2.ok, true);
  assert.match(r2.entries[0].problems[0], /nested too deeply/);
});

test('readPack reports problems per recipe and survives malformed ones', () => {
  const good = makeRecipe('alpha', 1);
  const invented = makeRecipe('beta', 2);
  invented.components[0].ingredients[1].amount = '1 tsp';
  const read = readPack(wrap([
    good,
    invented,
    null,
    'a string',
    { ...makeRecipe('gamma', 3), schema: 99 },
    { ...makeRecipe('delta', 4), components: [null] },
    { ...makeRecipe('eps', 5), components: [{ name: 'x', ingredients: 'salt', steps: [] }] },
    { ...makeRecipe('zeta', 6), title: '', summary: '' },
  ]));
  assert.equal(read.ok, true);
  const p = read.entries.map((e) => e.problems.join(' | '));
  assert.equal(p[0], '');
  assert.match(p[1], /ingredients\[1\]\.amount must be null/);
  assert.equal(read.entries[1].id, 'beta', 'invalid entries keep their id for display');
  assert.match(p[2], /not a recipe object/);
  assert.match(p[3], /not a recipe object/);
  assert.match(p[4], /newer than this Recipe Bank/);
  assert.match(p[5], /malformed recipe/);
  assert.match(p[6], /malformed recipe/);
  assert.match(p[7], /title is required/);
  assert.match(p[7], /summary is required/);
  assert.deepEqual(read.entries.map((e) => e.recipe !== null), [true, false, false, false, false, false, false, false]);
});

test('HTML and control characters in titles stay plain text, bounded', () => {
  const html = '<img src=x onerror=alert(1)>';
  const read = readPack(wrap([makeRecipe('alpha', 1, { title: html })], { title: html }));
  assert.equal(read.title, html, 'kept as text; renderers escape it');
  assert.equal(read.entries[0].title, html);
  assert.equal(readPack(wrap([makeRecipe('alpha', 1)], { title: 'a\u0000b‮c\n\nd' })).title, 'a b c d');
  assert.equal(readPack(wrap([makeRecipe('alpha', 1)], { title: 'é'.repeat(400) })).title.length, MAX_TITLE_CHARS);
  assert.equal(readPack(wrap([makeRecipe('alpha', 1)], { title: 42 })).title, 'Untitled pack');
  assert.equal(readPack(wrap([makeRecipe('alpha', 1)], { exported: 'not a date' })).exported, null);
});

test('packFromRead rebuilds a pack that reads the same', () => {
  const read = readPack(wrap([makeRecipe('alpha', 1), null]));
  const again = readPack(packFromRead(read));
  assert.equal(again.ok, true);
  assert.deepEqual(again.entries[0].recipe, read.entries[0].recipe);
  assert.match(again.entries[1].problems[0], /not a recipe object/);
});

// ---------- plan and apply ----------

function planFixture() {
  const existing = [makeRecipe('alpha', 1), makeRecipe('beta', 2), { id: 'alpha-2' }];
  const pack = wrap([
    makeRecipe('gamma', 3), //          0 new
    makeRecipe('alpha', 4), //          1 same id, other video → alpha-3 (alpha-2 is taken by a file)
    makeRecipe('delta', 1), //          2 same video as alpha in the bank
    { id: 'broken' }, //                3 invalid
    makeRecipe('gamma', 5), //          4 same id as item 0 → gamma-2
    makeRecipe('epsilon', 3), //        5 same video as item 0
  ]);
  return { existing, pack, plan: planImport(pack, existing) };
}

test('planImport sorts recipes into new, conflict, duplicate and invalid', () => {
  const { plan } = planFixture();
  assert.equal(plan.ok, true);
  assert.equal(plan.title, 'T');
  assert.deepEqual(plan.counts, { new: 1, conflict: 2, duplicate: 2, invalid: 1 });
  assert.deepEqual(plan.items.map((i) => [i.index, i.status, i.id]), [
    [0, 'new', 'gamma'],
    [1, 'conflict', 'alpha-3'],
    [2, 'duplicate', 'delta'],
    [3, 'invalid', 'broken'],
    [4, 'conflict', 'gamma-2'],
    [5, 'duplicate', 'epsilon'],
  ]);
  assert.equal(plan.items[1].packId, 'alpha');
  assert.equal(plan.items[1].recipe.id, 'alpha-3');
  assert.equal(plan.items[1].recipe.video.id, 'testvideo04');
  assert.equal(plan.items[2].duplicateOf, 'alpha');
  assert.equal(plan.items[2].inBank, true);
  assert.equal(plan.items[5].duplicateOf, 'gamma');
  assert.equal(plan.items[5].inBank, false);
  assert.equal(plan.items[0].creator, 'A creator');
  assert.ok(plan.items[3].problems.length > 0);
});

test('planImport accepts a read result, and never trusts look-alikes', () => {
  const { existing, pack } = planFixture();
  assert.deepEqual(planImport(readPack(pack), existing).counts, planImport(pack, existing).counts);
  const bad = planImport('nope', existing);
  assert.equal(bad.ok, false);
  assert.match(bad.errors[0], /not a JSON file/);
  assert.deepEqual(bad.items, []);
  const forged = planImport({ ok: true, errors: [], entries: [{ index: 0, recipe: makeRecipe('../../evil', 7), problems: [] }] }, []);
  assert.equal(forged.ok, false, 'a forged read result goes through readPack');
});

test('applyImport returns only files for new and renamed recipes', () => {
  const { plan } = planFixture();
  const { files, skipped } = applyImport(plan);
  assert.deepEqual(files.map((f) => [f.index, f.id, f.path]), [
    [0, 'gamma', 'recipes/gamma.json'],
    [1, 'alpha-3', 'recipes/alpha-3.json'],
    [4, 'gamma-2', 'recipes/gamma-2.json'],
  ]);
  for (const f of files) {
    const r = JSON.parse(f.contents);
    assert.deepEqual(validateRecipe(r, f.id), []);
    assert.ok(f.contents.endsWith('}\n'));
  }
  assert.deepEqual(skipped.map((s) => s.index), [2, 3, 5]);
  assert.match(skipped[0].reason, /same video as "alpha"/);
  assert.match(skipped[1].reason, /not a valid recipe/);

  assert.deepEqual(applyImport(plan, { include: [1] }).files.map((f) => f.id), ['alpha-3']);
  assert.deepEqual(applyImport(plan, { exclude: [0] }).files.map((f) => f.id), ['alpha-3', 'gamma-2']);
  const dup = applyImport(plan, { include: [2] });
  assert.deepEqual(dup.files, []);
  assert.match(dup.skipped.find((s) => s.index === 2).reason, /same video/);
  assert.deepEqual(applyImport(plan, { include: ['0'] }).files, [], 'positions are numbers');

  assert.throws(() => applyImport(planImport('nope', [])), (e) => e instanceof PackError && e.code === 'invalid-pack');
  assert.throws(() => applyImport(null), PackError);
});

test('applyImport re-checks every file, so a tampered plan cannot write elsewhere', () => {
  const { plan } = planFixture();
  plan.items[0].id = '../../outside';
  const { files, skipped } = applyImport(plan);
  assert.ok(!files.some((f) => f.path.includes('..')));
  assert.match(skipped.find((s) => s.index === 0).reason, /kebab-case|must match filename/);
});

test('uniqueId and slugify', () => {
  assert.equal(uniqueId('a', new Set()), 'a');
  assert.equal(uniqueId('a', new Set(['a'])), 'a-2');
  assert.equal(uniqueId('a', new Set(['a', 'a-2', 'a-3'])), 'a-4');
  assert.equal(uniqueId('top-10', new Set(['top-10'])), 'top-10-2');
  assert.equal(slugify('  Gochujang Chicken: Thighs!  '), 'gochujang-chicken-thighs');
  assert.equal(slugify('Crème Brûlée'), 'creme-brulee');
  assert.equal(slugify('x'.repeat(100) + ' y').length, 60);
  assert.equal(slugify(null), '');
});

// Taken over from the roadmap-functions lane's pack tests: the real bank must survive a pack.
test('every real recipe round-trips through a pack, and re-importing it adds nothing', async () => {
  const dir = join(ROOT, 'recipes');
  const recipes = [];
  for (const f of (await readdir(dir)).filter((n) => n.endsWith('.json')).sort()) {
    recipes.push(JSON.parse(await readFile(join(dir, f), 'utf8')));
  }
  assert.ok(recipes.length > 0);
  const read = readPack(serializePack(exportPack(recipes, { exported: EXPORTED })));
  assert.equal(read.ok, true);
  assert.deepEqual(read.entries.map((e) => e.problems), recipes.map(() => []));
  assert.deepEqual(read.entries.map((e) => e.recipe), recipes);
  const plan = planImport(read, recipes);
  assert.deepEqual(plan.counts, { new: 0, conflict: 0, duplicate: recipes.length, invalid: 0 });
  assert.deepEqual(applyImport(plan).files, []);
});

// ---------- links ----------

test('pack links round-trip, including non-ASCII text', () => {
  const a = makeRecipe('alpha', 1, { title: 'Crème brûlée 🍮 “quoted”' });
  const pack = exportPack([a], { title: 'Désserts 🍰', exported: EXPORTED });
  const link = packLink(pack, 'http://127.0.0.1:4780/#/r/old');
  assert.ok(link.startsWith('http://127.0.0.1:4780/#pack='));
  assert.match(link.split('#pack=')[1], /^[A-Za-z0-9_-]+$/);
  const read = packFromLink(link);
  assert.equal(read.ok, true);
  assert.equal(read.title, 'Désserts 🍰');
  assert.deepEqual(read.entries[0].recipe, a);
  assert.deepEqual(packFromLink(`#pack=${packParam(link)}`).entries[0].recipe, a);
  assert.equal(packLink(pack).startsWith('#pack='), true);
  assert.deepEqual(planImport(read, []).counts.new, 1, 'a link read result plans directly');
});

test('packParam and hasPackLink find the pack in links and hashes', () => {
  assert.equal(packParam('pack=abc'), 'abc');
  assert.equal(packParam('#pack=abc'), 'abc');
  assert.equal(packParam('https://x.test/#/r/one&pack=abc'), 'abc');
  assert.equal(packParam('https://x.test/#pack=abc&other=1'), 'abc');
  assert.equal(packParam('https://x.test/#/r/one'), null);
  assert.equal(packParam(''), null);
  assert.equal(hasPackLink('#pack='), true);
  assert.equal(hasPackLink('#/'), false);
});

test('links past the size limit fail clearly, both ways', () => {
  const big = makeRecipe('alpha', 1, { summary: 'A long summary. '.repeat(2500) });
  const pack = exportPack([big], { exported: EXPORTED });
  assert.throws(() => packLink(pack), (e) => e instanceof PackError && e.code === 'too-large-for-link' && /Download it as a file/.test(e.message));
  const read = packFromLink('#pack=' + 'A'.repeat(MAX_LINK_CHARS + 1));
  assert.equal(read.ok, false);
  assert.match(read.errors[0], /too long/);
});

test('damaged and empty links fail without throwing', () => {
  for (const [link, re] of [
    ['https://x.test/#/r/abc', /no pack/],
    ['#pack=%%%', /damaged/],
    ['#pack=A', /damaged/],
    ['#pack=_w', /damaged/], // decodes to the single byte 0xff, which is not UTF-8
    ['#pack=' + toBase64url('hello'), /not a JSON file/],
    ['#pack=' + toBase64url('{"format":"recipe-bank-pack","version":1,"recipes":[]}'), /no recipes/],
  ]) {
    const read = packFromLink(link);
    assert.equal(read.ok, false, link);
    assert.match(read.errors[0], re);
  }
});

test('base64url helpers', () => {
  for (const s of ['', 'a', 'ab', 'abc', 'abcd', '{"x":"é🍮"}', 'x'.repeat(100_000)]) {
    const enc = toBase64url(s);
    assert.match(enc, /^[A-Za-z0-9_-]*$/);
    assert.equal(fromBase64url(enc), s);
  }
  assert.throws(() => fromBase64url('a+b/'), PackError);
});
