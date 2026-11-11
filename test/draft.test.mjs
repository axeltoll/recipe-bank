import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import {
  emptyDraft, draftFromRecipe, recipeFromDraft, slugify, checkDraft, parseTimestamp, formatTimestamp,
  handleFromUrl, emptyIngredient, emptyStep, formatRecipe, today, draftIndexMap, problemField,
} from '../lib/draft.mjs';
import { validateRecipe } from '../lib/recipe.mjs';
import { videoKey, PLATFORMS } from '../lib/video.mjs';

const DIR = resolve(import.meta.dirname, '..', 'recipes');

async function allRecipes() {
  const files = (await readdir(DIR)).filter((f) => f.endsWith('.json')).sort();
  return Promise.all(files.map(async (f) => ({ f, r: JSON.parse(await readFile(join(DIR, f), 'utf8')) })));
}

// A small valid draft, built the way the form builds one.
function filledDraft() {
  const d = emptyDraft('https://youtu.be/TestVideo01?si=share', { date: '2026-11-11' });
  d.id = 'test-toast';
  d.title = 'Test Toast';
  d.summary = 'Bread, toasted.';
  d.creator.name = 'A Creator';
  d.components[0].name = 'Toast';
  Object.assign(d.components[0].ingredients[0], { item: 'Bread', key: 'Bread', amount: '2 slices', basis: 'spoken' });
  Object.assign(d.components[0].steps[0], { text: 'Toast the bread.', t: '0:05' });
  return d;
}

// ---------- round trip ----------

test('recipeFromDraft(draftFromRecipe(r)) deep-equals r for every recipe file', async () => {
  const all = await allRecipes();
  assert.ok(all.length > 0);
  for (const { f, r } of all) assert.deepEqual(recipeFromDraft(draftFromRecipe(r)), r, f);
});

test('every recipe file opens in the editor without problems', async () => {
  const all = await allRecipes();
  const ids = all.map(({ r }) => r.id);
  const keys = all.map(({ r }) => videoKey(r.video));
  for (const { f, r } of all) assert.deepEqual(checkDraft(draftFromRecipe(r), { existingIds: ids, existingVideoKeys: keys }), [], f);
});

test('round trip keeps unknown fields, nulls and absent optional fields as they were', () => {
  const r = {
    id: 'x', title: 'X', status: 'partial', summary: 's', analyzed: '2026-10-12', uploaded: null,
    video: { platform: 'youtube', id: 'mhNQ8y5ud0A', url: 'https://www.youtube.com/shorts/mhNQ8y5ud0A', start: 3 },
    creator: { name: 'c', handle: null, extraField: [1, 2] },
    tags: [], notes: [], gaps: ['the method'], nutrition: { per: 'serving', calories: 1.5, fat_g: null, custom: 'x' },
    source: {}, schema: 2,
    components: [{
      name: 'a', optional: true,
      ingredients: [{ item: 'Salt', key: 'salt', amount: null, basis: 'unstated', note: '', brand: 'any' }],
      steps: [{ text: 'Do it', t: 17.5, shot: 'close-up' }, { text: 'Then', t: 3725 }, { text: 'Rest' }],
    }],
  };
  assert.deepEqual(recipeFromDraft(draftFromRecipe(r)), r);
});

test('serves left blank is written as null, other blank optional fields are left out', () => {
  const r = recipeFromDraft(filledDraft());
  assert.equal(r.serves, null);
  for (const k of ['uploaded', 'nutrition', 'notes', 'gaps', 'source']) assert.ok(!(k in r), k);
  assert.ok(!('handle' in r.creator));
  assert.ok(!('note' in r.components[0].ingredients[0]));
  assert.deepEqual(validateRecipe(r, 'test-toast'), []);
});

test('a filled draft becomes a valid recipe with a normalized video, lowercase key and seconds', () => {
  const r = recipeFromDraft(filledDraft());
  assert.deepEqual(r.video, { platform: 'youtube', id: 'TestVideo01', url: 'https://www.youtube.com/shorts/TestVideo01' });
  assert.equal(r.components[0].ingredients[0].key, 'bread');
  assert.equal(r.components[0].steps[0].t, 5);
  assert.equal(r.analyzed, '2026-11-11');
  assert.equal(r.status, 'analyzed');
});

// ---------- amounts ----------

test('a blank amount is always null with basis "unstated", whatever basis was picked', () => {
  const d = filledDraft();
  Object.assign(d.components[0].ingredients[0], { amount: '   ', basis: 'spoken' });
  const ing = recipeFromDraft(d).components[0].ingredients[0];
  assert.equal(ing.amount, null);
  assert.equal(ing.basis, 'unstated');
  assert.deepEqual(checkDraft(d), []);
});

test('an amount typed while the basis is "unstated" is a form problem, reported once', () => {
  const d = filledDraft();
  Object.assign(d.components[0].ingredients[0], { amount: '1 tsp', basis: 'unstated' });
  const problems = checkDraft(d);
  assert.equal(problems.length, 1, problems.join('\n'));
  assert.match(problems[0], /^components\[0\]\.ingredients\[0\]\.basis .*"1 tsp"/);
});

test('"some" as an amount is reported as vague filler', () => {
  const d = filledDraft();
  Object.assign(d.components[0].ingredients[0], { amount: 'Some', basis: 'spoken' });
  assert.match(checkDraft(d).join('\n'), /amount "Some" is vague filler/);
});

test('empty ingredient, step and component rows are left out, and indexes in problems skip them', () => {
  const d = filledDraft();
  d.components[0].ingredients.unshift(emptyIngredient());
  d.components[0].steps.push(emptyStep());
  d.components.unshift({ name: '', ingredients: [emptyIngredient()], steps: [emptyStep()], extra: {} });
  const r = recipeFromDraft(d);
  assert.equal(r.components.length, 1);
  assert.equal(r.components[0].ingredients.length, 1);
  assert.equal(r.components[0].steps.length, 1);
  d.components[1].ingredients[1].item = '';
  assert.deepEqual(checkDraft(d), ['components[0].ingredients[0].item is required']);
});

// ---------- form-level checks ----------

test('checkDraft reports a duplicate id and a duplicate video, but not the recipe being edited', () => {
  const d = filledDraft();
  const problems = checkDraft(d, {
    existingIds: new Set(['test-toast']),
    existingVideoKeys: new Map([['youtube:TestVideo01', 'other-toast']]),
  });
  assert.deepEqual(problems, ['id "test-toast" is already used by another recipe', 'video is already in the bank as "other-toast"']);

  const editing = draftFromRecipe(recipeFromDraft(d));
  assert.deepEqual(checkDraft(editing, { existingIds: ['test-toast'], existingVideoKeys: ['youtube:TestVideo01'] }), []);
});

test('checkDraft passes contract problems through', () => {
  const d = emptyDraft(undefined, { date: '2026-11-11' });
  const problems = checkDraft(d);
  for (const p of ['id must be a kebab-case slug', 'title is required', 'summary is required',
    'creator.name is required', 'components must be a non-empty array']) {
    assert.ok(problems.includes(p), p);
  }
  // The video message names every platform lib/video.mjs accepts, so it is built from PLATFORMS.
  const video = problems.find((p) => p.startsWith('video.url must be a supported '));
  assert.ok(video, 'the video problem is passed through');
  for (const { label } of PLATFORMS) assert.ok(video.includes(label), `${label} is named`);
  // A creator link with another scheme is a contract problem too, pointed at its field.
  d.creator.url = 'javascript:alert(1)';
  const bad = checkDraft(d).find((p) => p.startsWith('creator.url '));
  assert.ok(bad, 'creator.url problem');
  assert.equal(problemField(bad, d), 'creator.url');
  d.status = 'partial';
  assert.ok(checkDraft(d).includes('partial recipes must list gaps'));
});

test('a bad timestamp is reported in the form\'s words only', () => {
  const d = filledDraft();
  d.components[0].steps[0].t = '1:75';
  assert.deepEqual(checkDraft(d), ['components[0].steps[0].t "1:75" is not a time: use m:ss or seconds']);
  assert.equal(recipeFromDraft(d).components[0].steps[0].t, '1:75');
});

test('nutrition numbers are numbers; an all-blank nutrition panel is no nutrition', () => {
  const d = filledDraft();
  d.nutrition = { per: 'slice', basis: 'description', calories: '120', protein_g: '4.5', carbs_g: '', fat_g: 'lots', note: '', extra: {}, blank: {} };
  const r = recipeFromDraft(d);
  assert.deepEqual(r.nutrition, { per: 'slice', basis: 'description', calories: 120, protein_g: 4.5, fat_g: 'lots' });
  assert.deepEqual(checkDraft(d), ['nutrition.fat_g must be a number']);
  d.nutrition = { per: '', basis: '', calories: '', protein_g: '', carbs_g: '', fat_g: '', note: '', extra: {}, blank: {} };
  assert.ok(!('nutrition' in recipeFromDraft(d)));
});

test('tags, notes and gaps drop blank entries; tags are lowercased', () => {
  const d = filledDraft();
  d.tags = [' Air Fryer ', '', 'snack'];
  d.notes = ['A note', '  '];
  d.gaps = [''];
  const r = recipeFromDraft(d);
  assert.deepEqual(r.tags, ['air fryer', 'snack']);
  assert.deepEqual(r.notes, ['A note']);
  assert.ok(!('gaps' in r));
});

// ---------- emptyDraft ----------

test('emptyDraft starts with one empty component, today\'s date and no amounts', () => {
  const d = emptyDraft(undefined, { date: '2026-01-02' });
  assert.equal(d.analyzed, '2026-01-02');
  assert.equal(d.components.length, 1);
  assert.equal(d.components[0].ingredients[0].basis, 'unstated');
  assert.equal(d.components[0].ingredients[0].amount, '');
  assert.equal(d.original, null);
  assert.match(emptyDraft().analyzed, /^\d{4}-\d{2}-\d{2}$/);
});

test('emptyDraft takes a URL, a parsed video or a queue entry', () => {
  assert.equal(emptyDraft('https://youtube.com/watch?v=mhNQ8y5ud0A').video.url, 'https://www.youtube.com/shorts/mhNQ8y5ud0A');
  assert.equal(emptyDraft('not a link').video.url, 'not a link');
  assert.equal(emptyDraft({ platform: 'instagram', id: 'C9xYz123', url: 'https://www.instagram.com/reel/C9xYz123/' }).video.url,
    'https://www.instagram.com/reel/C9xYz123/');
  const q = emptyDraft({
    id: 'q-1', video: { platform: 'youtube', id: 'TestVideo01', url: 'https://www.youtube.com/shorts/TestVideo01' },
    title: ' Crispy Thing ', creator: 'Some Cook', creatorUrl: 'https://www.youtube.com/@SomeCook', note: 'for later',
  });
  assert.equal(q.title, 'Crispy Thing');
  assert.equal(q.creator.name, 'Some Cook');
  assert.equal(q.creator.handle, '@SomeCook');
  assert.equal(q.creator.url, 'https://www.youtube.com/@SomeCook');
  assert.equal(q.queueId, 'q-1');
  assert.ok(!('queueId' in recipeFromDraft(q)));
  assert.equal(emptyDraft({ id: 'q-2', video: { url: 'https://youtu.be/TestVideo01' }, title: null, creator: null }).title, '');
});

test('handleFromUrl reads @handles from creator URLs', () => {
  assert.equal(handleFromUrl('https://www.tiktok.com/@cook.name'), '@cook.name');
  assert.equal(handleFromUrl('https://www.youtube.com/@Name/videos'), '@Name');
  assert.equal(handleFromUrl('https://www.youtube.com/channel/UCabc'), '');
  assert.equal(handleFromUrl(null), '');
});

test('a "__proto__" field in a recipe file never reaches a prototype', () => {
  const r = JSON.parse(JSON.stringify(recipeFromDraft(emptyDraft('https://youtu.be/TestVideo01'))));
  const evil = '{"__proto__": {"polluted": true}}';
  const file = JSON.parse(JSON.stringify(r).replace(/^\{/, evil.slice(0, -1) + ',')
    .replace('"video":{', '"video":{"__proto__":{"polluted":true},'));
  assert.ok(Object.hasOwn(file, '__proto__') && Object.hasOwn(file.video, '__proto__'), 'fixture carries own __proto__ fields');
  const d = draftFromRecipe(file);
  assert.equal(Object.getPrototypeOf(d.extra), Object.prototype);
  assert.equal(Object.getPrototypeOf(d.video.extra), Object.prototype);
  const out = recipeFromDraft(d);
  assert.equal(Object.getPrototypeOf(out), Object.prototype);
  assert.equal(Object.getPrototypeOf(out.video), Object.prototype);
  assert.equal(out.polluted, undefined);
  assert.equal(out.video.polluted, undefined);
  assert.equal({}.polluted, undefined);
});

// ---------- slugify ----------

test('slugify makes kebab-case ASCII ids', () => {
  assert.equal(slugify('Gochujang Chicken Thighs'), 'gochujang-chicken-thighs');
  assert.equal(slugify('Crème Brûlée & Co.'), 'creme-brulee-and-co');
  assert.equal(slugify('Banana Milk (“Banana Water”)'), 'banana-milk-banana-water');
  assert.equal(slugify("Mom's Straße Ærter"), 'moms-strasse-aerter');
  assert.equal(slugify('  --Beefy 5-Layer Burritos!!  '), 'beefy-5-layer-burritos');
  assert.equal(slugify('ข้าวผัด'), 'recipe');
  assert.equal(slugify(''), 'recipe');
  assert.match(slugify('Pad Kra Pao'), /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
});

test('slugify keeps long ids under 60 characters at a word boundary', () => {
  const s = slugify('Steak au Poivre with Crispy Potatoes and Honey Thyme Carrots and Parmesan Cauliflower');
  assert.ok(s.length <= 60, s);
  assert.equal(s, 'steak-au-poivre-with-crispy-potatoes-and-honey-thyme-carrots');
  assert.equal(slugify('a'.repeat(80)), 'a'.repeat(60));
});

test('slugify is unique against existing ids', () => {
  assert.equal(slugify('Banana Milk', ['banana-milk']), 'banana-milk-2');
  assert.equal(slugify('Banana Milk', new Set(['banana-milk', 'banana-milk-2'])), 'banana-milk-3');
  assert.equal(slugify('Banana Milk', ['banana-milk-2']), 'banana-milk');
});

// ---------- timestamps ----------

test('parseTimestamp reads m:ss, h:mm:ss and seconds', () => {
  const cases = [['17', 17], ['17s', 17], [' 83 ', 83], ['0:17', 17], ['1:23', 83], ['1:5', 65], ['12:00', 720],
    ['1:02:03', 3723], ['17.5', 17.5], ['0:17.5', 17.5], ['0', 0], ['0:00', 0]];
  for (const [input, want] of cases) assert.equal(parseTimestamp(input), want, input);
  for (const blank of ['', '  ', null, undefined]) assert.equal(parseTimestamp(blank), null);
  for (const bad of ['1:75', 'abc', '-3', '1:2:3', '1::2', ':30', '1:60']) assert.ok(Number.isNaN(parseTimestamp(bad)), bad);
});

test('formatTimestamp writes m:ss and survives a round trip', () => {
  assert.equal(formatTimestamp(0), '0:00');
  assert.equal(formatTimestamp(17), '0:17');
  assert.equal(formatTimestamp(83), '1:23');
  assert.equal(formatTimestamp(720), '12:00');
  assert.equal(formatTimestamp(3723), '1:02:03');
  assert.equal(formatTimestamp(17.5), '17.5');
  assert.equal(formatTimestamp(null), '');
  assert.equal(formatTimestamp(undefined), '');
  for (const t of [0, 1, 59, 60, 61, 599, 3599, 3600, 3601, 36000, 17.5, 83.3, 0.25]) {
    assert.equal(parseTimestamp(formatTimestamp(t)), t, String(t));
  }
});

// ---------- problem → field ----------

test('draftIndexMap and problemField point recipe problems at draft fields, skipping empty rows', () => {
  const d = filledDraft();
  d.components.unshift({ name: '', ingredients: [emptyIngredient()], steps: [emptyStep()], extra: {} });
  d.components[1].ingredients.unshift(emptyIngredient());
  d.components[1].ingredients[1].item = '';
  d.components[1].steps[0].t = 'soon';
  assert.deepEqual(draftIndexMap(d), [{ index: 1, ingredients: [1], steps: [0] }]);

  const problems = checkDraft(d);
  assert.deepEqual(problems.map((p) => problemField(p, d)), [
    'components.1.steps.0.t',
    'components.1.ingredients.1.item',
  ]);
  assert.equal(problemField('title is required', d), 'title');
  assert.equal(problemField('video.platform must be "youtube"', d), 'video.url');
  assert.equal(problemField('video is already in the bank', d), 'video.url');
  assert.equal(problemField('partial recipes must list gaps', d), 'gaps');
  assert.equal(problemField('components[0].name is required', d), 'components.1.name');
  assert.equal(problemField('nutrition.calories must be a number', d), 'nutrition.calories');
  assert.equal(problemField('components must be a non-empty array', d), null);
  assert.equal(problemField('components[5].steps[0].text is required', d), null);
});

// ---------- helpers ----------

test('formatRecipe writes two-space JSON with a trailing newline', () => {
  assert.equal(formatRecipe({ a: [1] }), '{\n  "a": [\n    1\n  ]\n}\n');
});

test('today() is local YYYY-MM-DD', () => {
  assert.equal(today(new Date(2026, 0, 5)), '2026-01-05');
});
