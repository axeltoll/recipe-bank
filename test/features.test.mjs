// The feature modules in public/features/ touch the DOM only inside mount(), so their
// render functions, storage helpers and wiring can be checked here without a browser.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import * as weekPlan from '../public/features/week-plan.mjs';
import * as shoppingListUi from '../public/features/shopping-list.mjs';
import * as scaleUi from '../public/features/scale.mjs';
import * as filtersUi from '../public/features/filters.mjs';
import { makeStore, esc } from '../public/features/shared.mjs';
import { normalizePlan, shoppingList } from '../lib/plan.mjs';
import { scaleRecipe } from '../lib/scale.mjs';

const FEATURES = resolve(import.meta.dirname, '..', 'public', 'features');
const MODULES = { 'week-plan': weekPlan, 'shopping-list': shoppingListUi, scale: scaleUi, filters: filtersUi };

const memory = () => {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), m };
};
const blocked = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('quota'); } };

const ing = (item, key, amount) => ({ item, key, amount, basis: amount == null ? 'unstated' : 'spoken' });
const alpha = {
  id: 'alpha', title: 'Alpha', serves: '4', tags: ['quick', 'high protein'], nutrition: { per: 'serving', calories: 500, protein_g: 45 },
  components: [{ name: 'Main', steps: [], ingredients: [ing('Chicken', 'chicken', '800g'), ing('Salt', 'salt', 'a pinch'), ing('Oil', 'cooking oil', null)] }],
};
const evil = {
  id: 'evil', title: '<img src=x onerror=alert(1)>', serves: null, tags: ['<script>'],
  components: [{ name: '<b>x</b>', steps: [], ingredients: [ing('<i>Pork</i>', 'pork', '<svg onload=alert(1)>')] }],
};
const beta = {
  id: 'beta', title: 'Beta', serves: null, tags: ['quick'],
  components: [{ name: 'All', steps: [], ingredients: [ing('Pork mince', 'pork', '500g'), ing('Chicken', 'chicken', '2 per person')] }],
};

test('every feature module exports mount() and ships its own themeable CSS', async () => {
  for (const [name, mod] of Object.entries(MODULES)) {
    assert.equal(typeof mod.mount, 'function', name);
    const css = await readFile(join(FEATURES, `${name}.css`), 'utf8');
    assert.match(css, /var\(--rbf-accent/, `${name}.css uses the --rbf-* custom properties`);
    assert.match(css, /var\(--rbf-gap/, `${name}.css spacing is themeable`);
  }
});

test('feature modules only import files that exist', async () => {
  for (const name of [...Object.keys(MODULES), 'shared']) {
    const file = join(FEATURES, `${name}.mjs`);
    const src = await readFile(file, 'utf8');
    // Real import statements only (the header comments show browser paths as examples).
    for (const [, spec] of src.matchAll(/^import\b[^;]*?\bfrom '([^']+)'/gm)) {
      assert.match(spec, /^\.\.?\//, `${name}.mjs: use relative imports so Node and both servers resolve them (${spec})`);
      await stat(resolve(dirname(file), spec));
    }
  }
});

test('INTEGRATION.md documents every module, its events and storage keys', async () => {
  const doc = await readFile(join(FEATURES, 'INTEGRATION.md'), 'utf8');
  for (const name of Object.keys(MODULES)) assert.match(doc, new RegExp(`${name}\\.mjs`), name);
  for (const token of ['rb:plan-change', 'rb:shopping-check', 'rb:shopping-copy', 'rb:scale-change', 'rb:filter-change',
    'rb:week-plan', 'rb:shopping-checked', 'rb:filters-extra', '--rbf-accent', 'mount(']) {
    assert.ok(doc.includes(token), token);
  }
});

test('makeStore survives blocked or missing storage', () => {
  const s = makeStore(blocked);
  assert.deepEqual(s.get('k', { a: 1 }), { a: 1 });
  assert.equal(s.set('k', 1), false);
  const none = makeStore(null);
  assert.equal(none.get('k', 'x'), 'x');
  assert.equal(none.set('k', 1), false);
  const mem = memory();
  mem.setItem('bad', '{ not json');
  assert.equal(makeStore(mem).get('bad', 'fallback'), 'fallback');
  assert.equal(makeStore(mem).set('good', [1]), true);
  assert.equal(mem.getItem('good'), '[1]');
  assert.equal(esc(`<a href="x">'&'</a>`), '&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;');
});

test('week plan: read, write and add from anywhere, with storage that may fail', () => {
  const mem = memory();
  assert.deepEqual(weekPlan.readPlan({ storage: mem }), normalizePlan(null));
  assert.equal(weekPlan.writePlan({ items: [{ recipe: 'alpha', day: 'mon' }] }, { storage: mem }), true);
  assert.deepEqual(JSON.parse(mem.getItem('rb:week-plan')), { version: 1, items: [{ recipe: 'alpha', day: 'mon' }] });
  assert.deepEqual(weekPlan.readPlan({ storage: mem, recipes: [beta] }).items, []);

  const target = new EventTarget();
  let seen = null;
  target.addEventListener('rb:plan-change', (e) => { seen = e.detail; });
  const plan = weekPlan.addRecipeToWeek('beta', 'fri', { storage: mem, target });
  assert.deepEqual(plan.items, [{ recipe: 'alpha', day: 'mon' }, { recipe: 'beta', day: 'fri' }]);
  assert.deepEqual(seen.plan, plan);
  assert.equal(seen.source, 'addRecipeToWeek');
  assert.deepEqual(weekPlan.readPlan({ storage: mem }), plan);

  assert.deepEqual(weekPlan.readPlan({ storage: blocked }).items, []);
  assert.equal(weekPlan.writePlan(plan, { storage: blocked }), false);
  assert.deepEqual(weekPlan.addRecipeToWeek('alpha', null, { storage: blocked, target: null }).items, [{ recipe: 'alpha', day: null }]);
});

test('week plan renders days, links and escapes titles', () => {
  const plan = normalizePlan([{ recipe: 'alpha', day: 'mon' }, { recipe: 'ghost', day: 'tue' }, 'evil']);
  const html = weekPlan.renderWeekPlan(plan, [alpha, evil]);
  assert.match(html, /2 meals planned/);
  assert.match(html, /href="#\/r\/alpha">Alpha<\/a>/);
  assert.match(html, /data-day="tue">\s*<h3>Tuesday<\/h3>\s*<p class="rbf-empty">Nothing planned/);
  assert.match(html, /<option value="mon" selected>Monday<\/option>/);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.doesNotMatch(html, /<img/);
  assert.doesNotMatch(weekPlan.renderWeekPlan(plan, [alpha, evil], { showEmptyDays: false }), /data-day="tue"/);
  assert.match(weekPlan.renderWeekPlan(null, [alpha]), /Nothing planned yet/);
  assert.match(weekPlan.renderWeekPlan(plan, [alpha], { href: (r) => `/recipes/${r.id}` }), /href="\/recipes\/alpha"/);
});

test('shopping list renders merged items, ticks and the empty state', () => {
  const list = shoppingList([alpha, beta]);
  const html = shoppingListUi.renderShoppingList(list, new Set(['salt']));
  assert.match(html, /1 of 4 ticked/);
  assert.match(html, /<li class="rbf-item rbf-done">\s*<label>\s*<input type="checkbox" data-key="salt" checked>/);
  assert.match(html, /<span class="rbf-count">2 recipes<\/span>/);
  assert.match(html, /class="rbf-amt rbf-unstated"[^>]*>amount not given</);
  assert.match(html, />2 per person</);
  assert.match(html, /For <a href="#\/r\/alpha">Alpha<\/a>, <a href="#\/r\/beta">Beta<\/a>/);
  assert.match(html, /data-untick/);
  assert.doesNotMatch(shoppingListUi.renderShoppingList(list), /data-untick/);
  assert.match(shoppingListUi.renderShoppingList(shoppingList([])), /Add recipes to the week plan/);
  const bad = shoppingListUi.renderShoppingList(shoppingList([evil]));
  assert.doesNotMatch(bad, /<img|<svg|<i>Pork|<script/);
});

test('scale renders servings or factors and marks what changed', () => {
  const one = scaleUi.renderScale(alpha, 1);
  assert.match(one, /<output class="rbf-target" data-target aria-live="polite">4<\/output>\s*<span class="rbf-unit">servings<\/span>/);
  assert.match(one, /Amounts as the creator gave them\./);
  assert.doesNotMatch(one, /data-reset|rbf-scaled/);

  const two = scaleUi.renderScale(alpha, 2);
  assert.match(two, /data-target aria-live="polite">8</);
  assert.match(two, /class="rbf-amt rbf-scaled"[^>]*><span class="rbf-badge" aria-hidden="true">×2<\/span> 1600g<\/span><span class="rbf-orig">creator: 800g<\/span>/);
  assert.match(two, /not scaled \(given in words\)/);
  assert.match(two, /Scaled ×2: 1 amount changed, 1 kept in the creator’s words, 1 not given\./);
  assert.match(two, /data-reset/);

  const factors = scaleUi.renderScale(beta, 0.5);
  assert.match(factors, /data-factor="0.5" aria-pressed="true">×½</);
  assert.match(factors, /data-factor="1" aria-pressed="false">×1</);
  assert.match(factors, /250g/);
  assert.match(factors, /not scaled \(already per person or per item\)/);
  assert.doesNotMatch(scaleUi.renderScale(alpha, 1, { list: false }), /rbf-scale-list/);
  assert.match(scaleUi.renderScale({ ...alpha, serves: '1' }, 1), /data-step="-1" aria-label="Fewer" disabled/);
  assert.doesNotMatch(scaleUi.renderScale(evil, 2), /<img|<svg|<i>|<b>/);
});

test('amountHtml for each kind of amount', () => {
  const [chicken, salt, oil] = scaleRecipe(alpha, 2).components[0].ingredients;
  assert.match(scaleUi.amountHtml(chicken, 2), /rbf-scaled/);
  assert.match(scaleUi.amountHtml(salt, 2), /rbf-kept/);
  assert.equal(scaleUi.amountHtml(oil, 2), '<span class="rbf-amt rbf-unstated">amount not given</span>');
  const same = scaleRecipe(alpha, 1).components[0].ingredients[1];
  assert.equal(scaleUi.amountHtml(same, 1), '<span class="rbf-amt">a pinch</span>');
});

test('filters render chips, numbers and a summary', () => {
  const recipes = [alpha, beta, evil];
  const html = filtersUi.renderFilters(recipes, { without: ['pork'], tags: ['quick'], minProtein: 40, q: 'ignored', keys: ['x'] });
  assert.match(html, /data-without="pork" aria-pressed="true">pork<span class="rbf-chip-count">2<\/span>/);
  assert.match(html, /data-without="chicken" aria-pressed="false"/);
  assert.match(html, /data-tag="quick" aria-pressed="true"/);
  assert.match(html, /name="minProtein" placeholder="any" value="40"/);
  assert.match(html, /name="maxCalories" placeholder="any" value=""/);
  assert.match(html, /Only 1 of 3 recipes state their macros/);
  assert.match(html, /data-summary aria-live="polite">without pork · tag: quick · ≥ 40 g protein</);
  assert.doesNotMatch(html, /data-clear hidden/);
  assert.match(filtersUi.renderFilters(recipes, {}), /data-clear hidden/);
  assert.doesNotMatch(filtersUi.renderFilters(recipes, {}, { sections: ['tags'] }), /data-group="without"|data-group="nutrition"/);
  assert.match(filtersUi.renderFilters(recipes, {}, { limit: 1 }), /data-more="without">Show all 4</);
  assert.match(filtersUi.renderFilters(recipes, {}, { limit: 1, expanded: { without: true } }), /data-more="without">Show fewer</);
  assert.doesNotMatch(html, /<script>/);
  assert.deepEqual(filtersUi.extraFilter({ q: 'x', keys: ['a'], without: ['Pork'], maxCalories: '600' }), {
    without: ['pork'], tags: [], minProtein: null, maxCalories: 600,
  });
});
