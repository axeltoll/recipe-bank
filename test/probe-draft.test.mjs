// Probes of the recipe editor logic (lib/draft.mjs): draft → recipe round trips for every recipe file
// and for every source kind (platform video, short link, web page), queue entries with third-party
// data, timestamps, slugs and garbage drafts. Real bugs are marked `todo`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  draftFromRecipe, recipeFromDraft, emptyDraft, checkDraft, handleFromUrl, parseTimestamp, formatTimestamp, slugify,
  problemField, formatRecipe,
} from '../lib/draft.mjs';
import { validateRecipe, SLUG } from '../lib/recipe.mjs';
import { videoKey } from '../lib/video.mjs';
import { makeRecipe } from './helpers/bank.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const FILES = readdirSync(join(ROOT, 'recipes')).filter((f) => f.endsWith('.json'));
const RECIPES = FILES.map((f) => JSON.parse(readFileSync(join(ROOT, 'recipes', f), 'utf8')));

// ---------- round trips over the real bank ----------

test('every recipe file survives draftFromRecipe → recipeFromDraft unchanged, byte for byte', () => {
  for (const [i, r] of RECIPES.entries()) {
    const back = recipeFromDraft(draftFromRecipe(r));
    assert.deepEqual(back, r, r.id);
    // The editor saves formatRecipe(); for an untouched recipe that is the file as it is on disk,
    // except for key order, which JSON.stringify takes from the draft.
    assert.deepEqual(JSON.parse(formatRecipe(back)), JSON.parse(readFileSync(join(ROOT, 'recipes', FILES[i]), 'utf8')));
  }
});

test('the draft of every recipe file passes checkDraft when editing it (its own id and video do not count)', () => {
  const ids = RECIPES.map((r) => r.id);
  const keys = new Map(RECIPES.map((r) => [videoKey(r.video), r.id]));
  for (const r of RECIPES) assert.deepEqual(checkDraft(draftFromRecipe(r), { existingIds: ids, existingVideoKeys: keys }), [], r.id);
});

test('a copy of a recipe under a new id is flagged as a duplicate video', () => {
  const r = RECIPES[0];
  const d = draftFromRecipe(r);
  d.original = null;
  d.id = `${r.id}-copy`;
  const problems = checkDraft(d, { existingIds: RECIPES.map((x) => x.id), existingVideoKeys: new Map([[videoKey(r.video), r.id]]) });
  assert.ok(problems.some((p) => p.startsWith('video is already in the bank')), problems.join('\n'));
});

test('a draft round trip keeps unknown fields at every level and the empty forms of optional fields', () => {
  const r = makeRecipe('probe-extras', 1, {
    future: { nested: [1, { a: null }] },
    serves: null, notes: [], source: {},
    nutrition: { per: 'serving', basis: 'description', calories: 0, extraNut: 'x' },
  });
  r.video.extraVideo = true;
  r.creator.extraCreator = 'y';
  r.components[0].extraComponent = 1;
  r.components[0].ingredients[0].extraIngredient = [];
  r.components[0].steps[0].extraStep = { z: 1 };
  r.components[0].steps.push({ text: 'Rest.', t: 0 });
  assert.deepEqual(recipeFromDraft(draftFromRecipe(r)), r);
});

// ---------- sources other than platform videos ----------

const webRecipe = () => makeRecipe('probe-web', 1, { video: { platform: 'web', id: null, url: 'https://cooking.example.com/recipes/42' } });
// Stored in the parser's canonical form (no trailing slash), as the dashboard and the agent write it.
const shortRecipe = () => makeRecipe('probe-short', 1, { video: { platform: 'tiktok', url: 'https://vm.tiktok.com/ZMabc123' } });

test('fixtures: a web-page recipe and a short-link recipe are valid recipe files', () => {
  assert.deepEqual(validateRecipe(webRecipe()), []);
  assert.deepEqual(validateRecipe(shortRecipe()), []);
});

test('a web-page recipe survives the editor round trip and stays valid',
  () => {
    const r = webRecipe();
    const back = recipeFromDraft(draftFromRecipe(r));
    assert.deepEqual(validateRecipe(back), []);
    assert.deepEqual(back, r);
  });

test('a queued web page can be written up in the editor (#/new/<queueId>)',
  () => {
    const entry = { id: 'q1', video: { platform: 'web', id: null, url: 'https://cooking.example.com/recipes/42' }, title: 'Soup', creator: 'Cook', creatorUrl: null };
    const d = emptyDraft(entry, { date: '2026-11-11' });
    Object.assign(d, { id: 'soup', summary: 'Soup.' });
    d.creator.name = 'Cook';
    d.components[0].name = 'Soup';
    d.components[0].ingredients[0] = { ...d.components[0].ingredients[0], item: 'Water', key: 'water' };
    d.components[0].steps[0] = { ...d.components[0].steps[0], text: 'Boil.' };
    assert.deepEqual(checkDraft(d), []);
  });

test('a short-link recipe without video.id round-trips without gaining "id": null',
  () => {
    const r = shortRecipe();
    const back = recipeFromDraft(draftFromRecipe(r));
    assert.deepEqual(validateRecipe(back), []);
    assert.deepEqual(back, r);
  });

test('a recipe stored with a non-canonical but valid URL keeps a valid video after the round trip', () => {
  const r = makeRecipe('probe-watch', 1);
  r.video.url = `https://www.youtube.com/watch?v=${r.video.id}`;
  assert.deepEqual(validateRecipe(r), []);
  const back = recipeFromDraft(draftFromRecipe(r));
  assert.deepEqual(validateRecipe(back), []);
  assert.equal(videoKey(back.video), videoKey(r.video));
});

// ---------- third-party data in queue entries ----------

test('a queue entry with a malformed percent-escape in its creator URL still opens in the editor',
  () => {
    assert.equal(typeof handleFromUrl('https://www.tiktok.com/@a%E0'), 'string');
    const d = emptyDraft({ id: 'q', video: { url: 'https://youtu.be/testvideo01' }, creatorUrl: 'https://www.tiktok.com/@a%E0b' });
    assert.equal(d.video.url, 'https://youtu.be/testvideo01');
  });

test('handleFromUrl reads plain and encoded handles and ignores other URLs', () => {
  assert.equal(handleFromUrl('https://www.youtube.com/@cook'), '@cook');
  assert.equal(handleFromUrl('https://www.tiktok.com/@caf%C3%A9?lang=en'), '@café');
  for (const u of [null, undefined, '', 'https://example.com/user', 'javascript:alert(1)//@x', 42]) assert.equal(handleFromUrl(u), '', String(u));
});

test('queue entries with hostile titles keep the text as text (escaping is the renderer\'s job)', () => {
  const d = emptyDraft({ id: 'q', video: { url: 'https://youtu.be/testvideo01' }, title: '  <img src=x onerror=alert(1)>  ', creator: { toString: () => 'x' } });
  assert.equal(d.title, '<img src=x onerror=alert(1)>');
  assert.equal(typeof d.creator.name, 'string');
});

// ---------- timestamps ----------

test('formatTimestamp → parseTimestamp round-trips the times a recipe can hold', () => {
  for (const t of [0, 1, 59, 60, 61, 599.5, 3599, 3600, 3661, 86399, 90061, 0.1, 17.25, 1234.5]) {
    assert.equal(parseTimestamp(formatTimestamp(t)), t, String(t));
  }
});

test('formatTimestamp → parseTimestamp holds for every number validateRecipe accepts ("always holds")',
  () => {
    for (const t of [1e-7, 5e-324, 1e21]) assert.equal(parseTimestamp(formatTimestamp(t)), t, String(t));
  });

test('parseTimestamp refuses junk and accepts what people type', () => {
  for (const s of ['1:60', '1:2:3', '-5', '1e3', 'abc', '1::2', ':30', '1:30:', '٣٠', '1 30']) assert.ok(Number.isNaN(parseTimestamp(s)), s);
  for (const [s, v] of [['83', 83], ['83s', 83], [' 1:23 ', 83], ['1:02:03', 3723], ['0:05', 5], ['2.5', 2.5], ['', null], [null, null]]) {
    assert.equal(parseTimestamp(s), v, String(s));
  }
});

// ---------- slugs ----------

test('slugify always returns a valid id, at most 60 characters, unique against the taken ids', () => {
  const titles = ['Crème Brûlée!', '鶏の唐揚げ', '🍗🍗🍗', '', null, '   ', '---', 'Ærtesuppe & Øl', 'Straße', 'İstanbul köfte',
    'a'.repeat(200), `${'word '.repeat(40)}end`, 'ǅemal', 'Mac’n’cheese', '1/2 price', '__proto__', 'constructor'];
  for (const t of titles) {
    const id = slugify(t);
    assert.match(id, SLUG, JSON.stringify(t));
    assert.ok(id.length <= 60, JSON.stringify(t));
  }
  const taken = new Set(['recipe', 'recipe-2']);
  assert.equal(slugify('🍗', taken), 'recipe-3');
  assert.equal(slugify('Straße'), 'strasse');
  assert.equal(slugify('Mac’n’cheese'), 'macncheese');
});

// ---------- garbage drafts ----------

test('recipeFromDraft and checkDraft never throw on partial or garbage drafts', () => {
  for (const d of [{}, { components: [{}] }, { components: [{ ingredients: [{}], steps: [{}] }] }, { video: null, creator: null, nutrition: {}, source: null },
    { tags: ['  ', 'UPPER'], notes: [null], gaps: [''] }, emptyDraft(), emptyDraft('not a url'), emptyDraft(42), emptyDraft({ url: 'https://youtu.be/testvideo01' })]) {
    const r = recipeFromDraft(d);
    assert.equal(typeof r, 'object');
    const problems = checkDraft(d);
    assert.ok(problems.length > 0);
    for (const p of problems) assert.equal(typeof problemField(p, d) === 'string' || problemField(p, d) === null, true);
  }
});

test('the form never invents an amount: blank amounts become unstated, typed ones keep their words', () => {
  const d = draftFromRecipe(RECIPES[0]);
  d.components[0].ingredients[0].amount = '   ';
  d.components[0].ingredients[0].basis = 'spoken';
  const r = recipeFromDraft(d);
  assert.equal(r.components[0].ingredients[0].amount, null);
  assert.equal(r.components[0].ingredients[0].basis, 'unstated');
  d.components[0].ingredients[0].amount = 'some';
  assert.ok(checkDraft(d).some((p) => /vague filler/.test(p)));
});
