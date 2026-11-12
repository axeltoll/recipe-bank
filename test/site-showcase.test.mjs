// The public site's showcase: the generated sample data must equal the real recipe files, and the filter
// and render logic (site/js/showcase-core.js) must behave like the dashboard's.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import showcase from '../site/data/showcase.js';
import { buildShowcase, SHOWCASE_IDS, slimRecipe } from '../scripts/build-site-data.mjs';
import { ingredientKeys } from '../lib/recipe.mjs';
import {
  emptyMessage, filterRecipes, keyCounts, mmss, recipeKeys, renderCard, renderChips, renderDetail, shoppingList, stepCount,
  watchUrl,
} from '../site/js/showcase-core.js';

const [coldPan, nuggets, banana] = showcase;

test('site/data/showcase.js equals the recipes it was generated from', async () => {
  assert.deepEqual(showcase.map((r) => r.id), SHOWCASE_IDS);
  assert.deepEqual(showcase, await buildShowcase(), 'out of date: run `npm run site:data`');
});

test('slimRecipe keeps a fixed shape and leaves out notes, dates and sources', () => {
  const slim = slimRecipe({
    id: 'x', title: 'X', status: 'partial', analyzed: '2026-01-01', notes: ['internal'], source: { quantity_basis: 'q' },
    video: { platform: 'tiktok', url: 'https://vm.tiktok.com/abc' },
    creator: { name: 'c' }, summary: 's', tags: [],
    components: [{ name: 'a', ingredients: [{ item: 'Salt', key: 'salt', basis: 'unstated' }], steps: [{ text: 'Mix.' }] }],
  });
  assert.deepEqual(slim, {
    id: 'x', title: 'X', status: 'partial',
    video: { platform: 'tiktok', id: null, url: 'https://vm.tiktok.com/abc' },
    creator: { name: 'c', handle: null, url: null },
    summary: 's', serves: null, tags: [],
    components: [{
      name: 'a',
      ingredients: [{ item: 'Salt', key: 'salt', amount: null, basis: 'unstated', note: null }],
      steps: [{ text: 'Mix.', t: null }],
    }],
    nutrition: null, gaps: [],
  });
});

test('the site reads ingredient keys the way the recipe contract does', () => {
  for (const r of showcase) assert.deepEqual(recipeKeys(r), ingredientKeys(r), r.id);
  assert.deepEqual([stepCount(coldPan), stepCount(nuggets), stepCount(banana)], [12, 7, 6]);
});

test('ingredient filter: Has all, Has any and search', () => {
  const ids = (filter) => filterRecipes(showcase, filter).map((r) => r.id);
  assert.deepEqual(ids({}), SHOWCASE_IDS);
  assert.deepEqual(ids({ keys: ['chicken'] }), ['cold-pan-chicken', 'air-fried-chicken-nuggets']);
  assert.deepEqual(ids({ keys: ['chicken', 'egg'], mode: 'all' }), ['air-fried-chicken-nuggets']);
  assert.deepEqual(ids({ keys: ['chicken', 'egg'], mode: 'any' }), ['cold-pan-chicken', 'air-fried-chicken-nuggets']);
  assert.deepEqual(ids({ keys: new Set(['banana', 'egg']), mode: 'any' }), ['air-fried-chicken-nuggets', 'banana-milk']);
  assert.deepEqual(ids({ keys: ['salt', 'banana', 'chicken'] }), []);
  assert.deepEqual(ids({ q: 'cinnamon' }), ['banana-milk']);
  assert.deepEqual(ids({ q: '  LOUIS howard ' }), ['air-fried-chicken-nuggets']);
  assert.deepEqual(ids({ q: 'chicken', keys: ['lemon'] }), ['cold-pan-chicken']);
});

test('ingredient chips are counted, sorted and collapsed', () => {
  const counts = keyCounts(showcase);
  assert.equal(counts.length, 24);
  assert.deepEqual(counts.slice(0, 3), [['salt', 3], ['chicken', 2], ['garlic', 2]]);

  const collapsed = renderChips(counts, ['water'], { showAll: false, limit: 10 });
  assert.equal((collapsed.match(/data-key="/g) ?? []).length, 11, 'ten chips plus the selected one');
  assert.match(collapsed, /data-key="water" aria-pressed="true"/);
  assert.match(collapsed, /data-key="salt" aria-pressed="false"/);
  assert.match(collapsed, /aria-expanded="false">Show all 24</);

  const open = renderChips(counts, new Set(), { showAll: true, limit: 10 });
  assert.equal((open.match(/data-key="/g) ?? []).length, 24);
  assert.match(open, /aria-expanded="true">Show fewer</);
});

test('timestamps, video links and the shopping list', () => {
  assert.equal(mmss(0), '0:00');
  assert.equal(mmss(92), '1:32');
  assert.equal(mmss(62.4), '1:02');
  assert.equal(watchUrl(coldPan.video, 46), 'https://www.youtube.com/watch?v=NcYdt03nz8Q&t=46s');
  assert.equal(watchUrl(nuggets.video, 0), 'https://www.youtube.com/shorts/irttbs0P-KE');
  const reel = { platform: 'instagram', id: 'abc', url: 'https://www.instagram.com/reel/abc/' };
  assert.equal(watchUrl(reel, 30), reel.url);

  const list = shoppingList(coldPan).split('\n');
  assert.equal(list[0], 'Cold Pan Chicken with Lemon Butter Pan Sauce');
  assert.deepEqual(list.slice(1, 5), ['', 'Chicken:', '- Skin-on chicken', '- Salt']);
  assert.ok(list.includes('- Chicken stock: about 1 cup'));
  assert.equal(shoppingList(nuggets).split('\n')[1], '- Chicken breast, diced: 680 g');
});

test('the recipe page shows amounts as given, missing amounts as missing, and the gaps', () => {
  const html = renderDetail(coldPan);
  assert.match(html, /Full recipe from the video/);
  assert.match(html, /<span class="rd-amt unstated">amount not given<\/span>/);
  assert.match(html, /about 1 cup<small>said in the video<\/small>/);
  assert.match(html, /href="https:\/\/www\.youtube\.com\/watch\?v=NcYdt03nz8Q&amp;t=46s"/);
  assert.match(html, /aria-label="Open the video at 0:46 on YouTube">0:46<\/a>/);
  assert.match(html, /What the video does not say/);
  assert.match(html, /href="https:\/\/www\.youtube\.com\/@saerijane"/);
  assert.doesNotMatch(html, /Nutrition per/);

  const withMacros = renderDetail(nuggets);
  assert.match(withMacros, /Nutrition per nugget/);
  assert.match(withMacros, /<b>94<\/b><span>kcal<\/span>/);
  assert.match(withMacros, /680 g<small>from the video description<\/small>/);
});

test('the recipe list card puts selected ingredients first', () => {
  const card = renderCard(nuggets, { selected: ['salt'], active: true });
  assert.match(card, /data-recipe="air-fried-chicken-nuggets" aria-pressed="true"/);
  assert.match(card, /<span class="demo-card-ings"><span class="ing hit">salt<\/span><span class="ing">chicken<\/span>/);
  assert.match(card, /<span class="ing">\+5<\/span>/);
  assert.match(card, /10 ingredients · 7 steps<\/span>/);
  assert.match(renderCard(coldPan), /11 ingredients · 12 steps · 3 parts<\/span>/);
});

test('strings from recipe data are escaped, and a partial recipe is labelled', () => {
  const hostile = {
    id: 'x', title: '<img src=x onerror=1>', status: 'partial',
    video: { platform: 'tiktok', id: null, url: 'https://vm.tiktok.com/a"b' },
    creator: { name: 'A & B', handle: null, url: null },
    summary: 's', serves: null, tags: ['<b>'],
    components: [{
      name: 'Part',
      ingredients: [{ item: 'Salt', key: 'salt', amount: null, basis: 'unstated', note: null }],
      steps: [{ text: '<script>alert(1)</script>', t: null }, { text: 'Stir.', t: 5 }],
    }],
    nutrition: null, gaps: ['<i>gap'],
  };
  const html = renderDetail(hostile) + renderCard(hostile);
  assert.doesNotMatch(html, /<img|<script|<b>|<i>gap|a"b/);
  assert.match(html, /&lt;img src=x onerror=1&gt;/);
  assert.match(html, /A &amp; B/);
  assert.match(html, /Partial recipe: some details are missing/);
  assert.match(html, /aria-label="Open the video at 0:05 on TikTok">0:05<\/a>/);
});

test('the empty-list message offers Has any only when it could help', () => {
  assert.match(emptyMessage({ keys: new Set(), mode: 'all' }), /^No recipe matches that search/);
  assert.match(emptyMessage({ keys: new Set(), mode: 'any' }), /^No recipe matches that search/);
  assert.match(emptyMessage({ keys: new Set(['egg']), mode: 'all' }), /switching to Has any/);
  const any = emptyMessage({ keys: new Set(['egg']), mode: 'any' });
  assert.doesNotMatch(any, /Has any/, 'already on Has any');
  for (const m of [emptyMessage({ keys: new Set() }), any]) assert.doesNotMatch(m, /switching/);
});
