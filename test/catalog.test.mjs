import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import {
  ingredientKeys, stepCount, searchText, matchesQuery, matchesKeys, filterRecipes, keyCounts, tagCounts,
  sortRecipes, macros, cardMacros, previewKeys, flattenSteps, shoppingList, analysisRequest, queueState,
  waiting, recipeForVideo,
} from '../lib/catalog.mjs';

const chicken = {
  id: 'a', title: 'Gochujang Chicken', summary: 'Cold-pan thighs.', status: 'analyzed', analyzed: '2026-10-02',
  video: { platform: 'youtube', id: 'mhNQ8y5ud0A', url: 'https://www.youtube.com/shorts/mhNQ8y5ud0A' },
  creator: { name: 'Eat Like an Adult' }, tags: ['korean', 'dinner'],
  components: [
    {
      name: 'Chicken',
      ingredients: [
        { item: 'Skin-on chicken thighs', key: 'chicken', amount: '2 per person', basis: 'spoken' },
        { item: 'Salt', key: 'salt', amount: null, basis: 'unstated' },
      ],
      steps: [{ text: 'Salt the thighs.', t: 10 }, { text: 'Cook skin side down.' }],
    },
    {
      name: 'Sauce',
      ingredients: [
        { item: 'Gochujang', key: 'gochujang', amount: 'a good amount', basis: 'spoken' },
        { item: 'Salt', key: 'salt', amount: null, basis: 'unstated' },
      ],
      steps: [{ text: 'Reduce.', t: 62 }],
    },
  ],
  nutrition: null,
};

const subs = {
  id: 'b', title: 'Pesto Chicken Subs', summary: 'Meal prep.', status: 'partial', analyzed: '2026-10-02',
  video: { platform: 'youtube', id: 'ge4oPMjBAII', url: 'https://www.youtube.com/shorts/ge4oPMjBAII' },
  creator: { name: 'FeastRecipes' }, tags: ['sandwich', 'dinner'],
  components: [{
    name: 'Subs',
    ingredients: [
      { item: 'Chicken', key: 'chicken', amount: null, basis: 'unstated' },
      { item: 'Pesto', key: 'pesto', amount: null, basis: 'unstated' },
    ],
    steps: [],
  }],
  nutrition: { per: 'sub', basis: 'description', calories: 517, protein_g: 43, carbs_g: 39, fat_g: 21 },
  gaps: ['No quantities are given.'],
};

const milk = {
  id: 'c', title: 'Banana Milk', summary: 'A drink.', status: 'analyzed', analyzed: '2026-11-01',
  video: { platform: 'instagram', id: 'C9xYz123', url: 'https://www.instagram.com/reel/C9xYz123/' },
  creator: { name: 'Someone' }, tags: [],
  components: [{
    name: 'Drink',
    ingredients: [{ item: 'Banana', key: 'banana', amount: '1', basis: 'on-screen' }],
    steps: [{ text: 'Blend.' }],
  }],
};

const all = [chicken, subs, milk];
const ids = (list) => list.map((r) => r.id);

test('stepCount and ingredientKeys', () => {
  assert.equal(stepCount(chicken), 3);
  assert.equal(stepCount(subs), 0);
  assert.equal(stepCount({}), 0);
  assert.deepEqual(ingredientKeys(chicken), ['chicken', 'salt', 'gochujang']);
});

test('search covers title, summary, creator, tags, component names and ingredients, case-insensitively', () => {
  assert.equal(matchesQuery(chicken, ''), true);
  assert.equal(matchesQuery(chicken, '   '), true);
  assert.equal(matchesQuery(chicken, 'gochujang chicken'), true);
  assert.equal(matchesQuery(chicken, 'GOCHU'), true);
  assert.equal(matchesQuery(chicken, 'korean'), true);
  assert.equal(matchesQuery(chicken, 'eat like'), true);
  assert.equal(matchesQuery(chicken, 'sauce'), true);
  assert.equal(matchesQuery(chicken, 'cold-pan'), true);
  assert.equal(matchesQuery(chicken, 'pesto'), false);
  assert.equal(matchesQuery(chicken, 'chicken pesto'), false, 'every word must match');
  assert.equal(searchText(chicken), searchText(chicken));
  assert.equal(searchText(chicken), searchText(chicken).toLowerCase());
});

test('Has all needs every key, Has any needs one, and no selection matches everything', () => {
  assert.equal(matchesKeys(chicken, [], 'all'), true);
  assert.equal(matchesKeys(chicken, ['chicken', 'salt'], 'all'), true);
  assert.equal(matchesKeys(chicken, ['chicken', 'pesto'], 'all'), false);
  assert.equal(matchesKeys(chicken, ['chicken', 'pesto'], 'any'), true);
  assert.equal(matchesKeys(chicken, ['pesto'], 'any'), false);
  assert.equal(matchesKeys(chicken, new Set(['salt'])), true, 'a Set works, and the mode defaults to all');
});

test('filterRecipes combines ingredient keys, search and feature filters, keeping the order', () => {
  assert.deepEqual(ids(filterRecipes(all)), ['a', 'b', 'c']);
  assert.deepEqual(ids(filterRecipes(all, { keys: ['chicken'] })), ['a', 'b']);
  assert.deepEqual(ids(filterRecipes(all, { keys: ['chicken'], q: 'pesto' })), ['b']);
  assert.deepEqual(ids(filterRecipes(all, { keys: new Set(['banana', 'pesto']), mode: 'any' })), ['b', 'c']);
  assert.deepEqual(ids(filterRecipes(all, { keys: ['chicken'] }, [(r) => r.status !== 'partial'])), ['a']);
  assert.deepEqual(ids(filterRecipes(all, {}, [() => true, (r) => r.id !== 'c'])), ['a', 'b']);
  assert.deepEqual(ids(filterRecipes(all, { q: 'zzz' })), []);
});

test('key and tag counts count recipes, most used first, then A–Z', () => {
  assert.deepEqual(keyCounts(all), [['chicken', 2], ['banana', 1], ['gochujang', 1], ['pesto', 1], ['salt', 1]]);
  assert.deepEqual(tagCounts(all), [['dinner', 2], ['korean', 1], ['sandwich', 1]]);
  assert.deepEqual(keyCounts([]), []);
});

test('sortRecipes puts the newest analysis first, then sorts by title, without changing its input', () => {
  const input = [chicken, subs, milk];
  assert.deepEqual(ids(sortRecipes(input)), ['c', 'a', 'b']);
  assert.deepEqual(ids(input), ['a', 'b', 'c']);
});

test('macros lists only what the recipe states', () => {
  assert.deepEqual(macros(chicken), []);
  assert.deepEqual(macros(milk), []);
  assert.deepEqual(macros(subs), [
    { id: 'calories', value: 517, unit: 'kcal', label: 'Calories' },
    { id: 'protein_g', value: 43, unit: 'g', label: 'Protein' },
    { id: 'carbs_g', value: 39, unit: 'g', label: 'Carbs' },
    { id: 'fat_g', value: 21, unit: 'g', label: 'Fat' },
  ]);
  assert.deepEqual(macros({ nutrition: { calories: 200, protein_g: null } }).map((m) => m.id), ['calories']);
  assert.deepEqual(macros({ nutrition: { calories: '200' } }), [], 'a number written as text is not a stated number');
});

test('cardMacros summarises calories and protein, or returns null', () => {
  assert.deepEqual(cardMacros(subs), { text: '517 kcal · 43 g protein', per: 'sub' });
  assert.equal(cardMacros(chicken), null);
  assert.equal(cardMacros({ nutrition: { carbs_g: 10 } }), null);
  assert.deepEqual(cardMacros({ nutrition: { protein_g: 6 } }), { text: '6 g protein', per: null });
});

test('previewKeys shows matching ingredients first and counts the rest', () => {
  assert.deepEqual(previewKeys(chicken, ['gochujang'], 2), {
    shown: [{ key: 'gochujang', hit: true }, { key: 'chicken', hit: false }],
    more: 1,
  });
  const none = previewKeys(chicken);
  assert.equal(none.shown.length, 3);
  assert.equal(none.more, 0);
  assert.ok(none.shown.every((k) => k.hit === false));
});

test('flattenSteps numbers the steps across components for cook mode', () => {
  assert.deepEqual(flattenSteps(chicken), [
    { n: 1, of: 3, component: 'Chicken', componentIndex: 0, text: 'Salt the thighs.', t: 10 },
    { n: 2, of: 3, component: 'Chicken', componentIndex: 0, text: 'Cook skin side down.', t: null },
    { n: 3, of: 3, component: 'Sauce', componentIndex: 1, text: 'Reduce.', t: 62 },
  ]);
  assert.deepEqual(flattenSteps(subs), []);
});

test('shoppingList keeps the creator’s amounts and never invents one', () => {
  assert.equal(shoppingList(chicken), [
    'Gochujang Chicken',
    '',
    'Chicken:',
    '- Skin-on chicken thighs: 2 per person',
    '- Salt',
    '',
    'Sauce:',
    '- Gochujang: a good amount',
    '- Salt',
  ].join('\n'));
  assert.equal(shoppingList(milk), 'Banana Milk\n- Banana: 1');
});

test('analysisRequest names the video and carries the note', () => {
  const withNote = analysisRequest({ video: { url: 'https://youtu.be/mhNQ8y5ud0A' }, note: 'sauce amounts' }).split('\n');
  assert.equal(withNote.length, 3);
  assert.match(withNote[0], /https:\/\/youtu\.be\/mhNQ8y5ud0A$/);
  assert.equal(withNote[1], 'Note: sauce amounts');
  assert.equal(analysisRequest({ video: { url: 'https://youtu.be/mhNQ8y5ud0A' }, note: '' }).split('\n').length, 2);
});

test('queue states have a label, a tone and a stage; unknown reads as queued', () => {
  assert.deepEqual(queueState('queued'), { label: 'Queued', tone: 'info', stage: 0 });
  assert.equal(queueState('analyzing').stage, 1);
  assert.equal(queueState('failed').tone, 'danger');
  assert.deepEqual(queueState('done'), { label: 'Recipe ready', tone: 'ok', stage: 2 });
  assert.deepEqual(queueState('weird'), queueState('queued'));
  assert.equal(waiting([{ status: 'queued' }, { status: 'done' }, { status: 'failed' }]).length, 2);
  assert.deepEqual(waiting(undefined), []);
});

test('recipeForVideo finds the recipe written from a queued video', () => {
  assert.equal(recipeForVideo(all, { platform: 'youtube', id: 'ge4oPMjBAII', url: 'https://youtu.be/ge4oPMjBAII' }), subs);
  assert.equal(recipeForVideo(all, { platform: 'youtube', id: 'aaaaaaaaaaa', url: 'https://youtu.be/aaaaaaaaaaa' }), undefined);
  assert.equal(recipeForVideo(all, {}), undefined);
});

test('the queries hold for every recipe in the bank', async () => {
  const dir = resolve(import.meta.dirname, '..', 'recipes');
  const files = (await readdir(dir)).filter((f) => f.endsWith('.json'));
  assert.ok(files.length > 0);
  for (const f of files) {
    const r = JSON.parse(await readFile(join(dir, f), 'utf8'));
    const flat = flattenSteps(r);
    assert.equal(flat.length, stepCount(r), f);
    assert.ok(flat.every((s, i) => s.n === i + 1 && s.of === flat.length), f);
    assert.ok(searchText(r).includes(r.title.toLowerCase()), f);
    assert.equal(matchesKeys(r, ingredientKeys(r), 'all'), true, f);

    const lines = shoppingList(r).split('\n');
    for (const c of r.components) {
      for (const i of c.ingredients) {
        const line = i.amount ? `- ${i.item}: ${i.amount}` : `- ${i.item}`;
        assert.ok(lines.includes(line), `${f}: ${line}`);
      }
    }
    const m = cardMacros(r);
    if (m) assert.match(m.text, /^\d/, f);
  }
  const pesto = JSON.parse(await readFile(join(dir, 'pesto-chicken-subs.json'), 'utf8'));
  assert.deepEqual(cardMacros(pesto), { text: '517 kcal · 43 g protein', per: 'sub' });
});
