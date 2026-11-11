// The purchase option of public/features/shopping-list.mjs (mount(el, { household: true })).
// Rendering and storage are checked directly; mount() runs against a tiny EventTarget stand-in for the DOM.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import * as ui from '../public/features/shopping-list.mjs';
import { purchaseList, DEFAULT_PANTRY } from '../lib/purchase.mjs';
import { shoppingListForPlan } from '../lib/plan.mjs';
import { defaultProfile } from '../lib/household.mjs';

const memory = () => {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), m };
};
const blocked = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('quota'); } };

const ing = (item, key, amount) => ({ item, key, amount, basis: amount == null ? 'unstated' : 'spoken' });
const alpha = {
  id: 'alpha', title: 'Alpha', serves: '4',
  components: [{ name: 'Main', steps: [], ingredients: [
    ing('Chicken', 'chicken', '800g'), ing('Salt', 'salt', 'a pinch'), ing('Oil', 'cooking oil', null), ing('Parsley', 'parsley', 'a few sprigs'),
  ] }],
};
const beta = {
  id: 'beta', title: 'Beta', serves: null,
  components: [{ name: 'All', steps: [], ingredients: [ing('Pork mince', 'pork', '500g'), ing('Chicken', 'chicken', '2 per person')] }],
};
const evil = {
  id: 'evil', title: '<img src=x onerror=alert(1)>', serves: '2',
  components: [{ name: '<b>x</b>', steps: [], ingredients: [ing('<i>Pork</i>', 'pork', '<svg onload=alert(1)>'), ing('x', '<script>', '1 cup')] }],
};
const family = { ...defaultProfile(), people: { ...defaultProfile().people, child6to10: 1 } };
const oneAdult = { ...defaultProfile(), people: { ...defaultProfile().people, adult: 1 } };
const week = { items: [{ recipe: 'alpha', day: 'mon' }, { recipe: 'beta', day: null }] };

test('purchase list renders the household, amounts to buy, creator amounts and flags', () => {
  const p = purchaseList(week, [alpha, beta], family, { pantry: DEFAULT_PANTRY });
  const html = ui.renderPurchaseList(p, new Set(['pork']), { pantry: DEFAULT_PANTRY });
  assert.match(html, /<p class="rbf-for rbf-household">For 2 adults, 1 child aged 6-10 \(2\.6 servings per meal\)<\/p>/);
  assert.match(html, /Meals: <a href="#\/r\/alpha">Alpha<\/a>, <a href="#\/r\/beta">Beta<\/a>/);
  assert.match(html, /1 of 3 ticked/);
  assert.match(html, /<li class="rbf-item rbf-done">\s*<label>\s*<input type="checkbox" data-key="pork" checked>/);
  assert.match(html, /<span class="rbf-amt rbf-buy">520 g \+ 2 per person<\/span>/);
  assert.match(html, /<span class="rbf-check" title="servings not stated, shown as written">check<\/span>/);
  assert.match(html, /<span class="rbf-check" title="given in words, shown as written">check<\/span>/);
  assert.match(html, />800g → 520g<\/span>/);
  assert.match(html, /<span class="rbf-flag-note">servings not stated, shown as written<\/span>/);
  assert.match(html, /Not scaled: Beta \(servings not stated, shown as written\)\./);
  assert.match(html, /data-copy/);
  assert.match(html, /data-print/);
  assert.match(html, /data-untick/);
  assert.match(html, /Left out: you have these: cooking oil, salt\./);
  assert.match(html, /Pantry: 3 things you always have/);
  assert.match(html, /data-pantry-remove="black pepper" aria-label="Remove black pepper from the pantry">black pepper/);
  assert.match(html, /Reset to salt, black pepper, cooking oil/);
  assert.match(html, /<details class="rbf-pantry-edit">/);
  assert.match(ui.renderPurchaseList(p, new Set(), { pantry: DEFAULT_PANTRY, pantryOpen: true }), /<details class="rbf-pantry-edit" open>/);
  assert.doesNotMatch(ui.renderPurchaseList(p), /rbf-pantry/);
  assert.match(ui.renderPurchaseList(p), /data-untick hidden>Untick all</, 'nothing ticked: the button waits, hidden');
});

test('purchase list empty state, and an empty pantry', () => {
  const p = purchaseList(null, [alpha], family);
  const html = ui.renderPurchaseList(p, undefined, { pantry: [] });
  assert.match(html, /Add recipes to the week plan and the amounts to buy for your household show up here/);
  assert.match(html, /For 2 adults, 1 child aged 6-10/);
  assert.match(html, /Nothing left out/);
  assert.match(html, /Pantry: empty/);
  assert.doesNotMatch(html, /data-copy/);
  assert.match(ui.renderPurchaseList(p, undefined, { pantry: ['salt'] }), /Pantry: 1 thing you always have/);
});

test('purchase list escapes recipe text and pantry keys', () => {
  const p = purchaseList({ items: [{ recipe: 'evil', day: null }] }, [evil], family);
  const html = ui.renderPurchaseList(p, new Set(), { pantry: ['<b>bold</b>'] });
  assert.doesNotMatch(html, /<img|<svg|<i>Pork|<script|<b>x|<b>bold/);
  assert.match(html, /data-key="&lt;script&gt;"/);
  assert.match(html, /&lt;svg onload=alert\(1\)&gt;/);
});

test('pantry and household storage survive blocked, empty and broken storage', async () => {
  const mem = memory();
  assert.deepEqual(ui.readPantry({ storage: mem }), [...DEFAULT_PANTRY]);
  assert.equal(ui.writePantry(['Olive Oil', 'salt', 'salt'], { storage: mem }), true);
  assert.equal(mem.getItem('rb:pantry'), '["olive oil","salt"]');
  assert.deepEqual(ui.readPantry({ storage: mem }), ['olive oil', 'salt']);
  ui.writePantry([], { storage: mem });
  assert.deepEqual(ui.readPantry({ storage: mem }), [], 'an emptied pantry stays empty');
  mem.setItem('rb:pantry', '{ not json');
  assert.deepEqual(ui.readPantry({ storage: mem }), [...DEFAULT_PANTRY]);
  assert.deepEqual(ui.readPantry({ storage: blocked }), [...DEFAULT_PANTRY]);
  assert.equal(ui.writePantry(['salt'], { storage: blocked }), false);

  assert.deepEqual(ui.readHousehold({ storage: mem }), defaultProfile());
  mem.setItem('recipe-bank:household', JSON.stringify(family));
  assert.equal(ui.readHousehold({ storage: mem }).people.child6to10, 1);
  assert.deepEqual(ui.readHousehold({ storage: blocked }), defaultProfile());

  // The key and event are the household module's own (not imported, so this module loads on its own).
  const householdSrc = await readFile(resolve(import.meta.dirname, '..', 'public', 'features', 'household.mjs'), 'utf8');
  assert.ok(householdSrc.includes(`export const HOUSEHOLD_KEY = '${ui.HOUSEHOLD_KEY}'`));
  assert.ok(householdSrc.includes(`'${ui.HOUSEHOLD_EVENT}'`));
  assert.equal(ui.PANTRY_KEY, 'rb:pantry');
});

/** Run `fn` with EventTarget stand-ins for document and window. */
async function withFakeDom(fn) {
  const saved = { document: globalThis.document, window: globalThis.window };
  globalThis.document = new EventTarget();
  globalThis.window = new EventTarget();
  try {
    await fn(globalThis.document);
  } finally {
    globalThis.document = saved.document;
    globalThis.window = saved.window;
  }
}
const fakeElement = () => Object.assign(new EventTarget(), { innerHTML: '', querySelector: () => null, closest: () => null });

test('without the option, mount renders the plain shopping list and reads no household or pantry', async () => {
  await withFakeDom(() => {
    const mem = memory();
    const reads = [];
    const storage = { getItem: (k) => { reads.push(k); return mem.getItem(k); }, setItem: (k, v) => mem.setItem(k, v) };
    const el = fakeElement();
    const plan = { items: [{ recipe: 'alpha', day: null }] };
    const shop = ui.mount(el, { recipes: [alpha], plan, storage, css: false });
    assert.equal(el.innerHTML, ui.renderShoppingList(shoppingListForPlan(plan, [alpha]), new Set()));
    assert.equal(shop.getPurchase(), null);
    assert.match(shop.getText(), /^Shopping list\n/);
    assert.ok(!reads.includes('recipe-bank:household') && !reads.includes('rb:pantry'), reads.join());
    assert.equal(mem.getItem('rb:pantry'), null);
    shop.destroy();
  });
});

test('with { household: true }, mount follows the household, edits the pantry and can switch back', async () => {
  await withFakeDom((doc) => {
    const mem = memory();
    mem.setItem('recipe-bank:household', JSON.stringify(family));
    const el = fakeElement();
    const pantryEvents = [];
    el.addEventListener('rb:pantry-change', (e) => pantryEvents.push(e.detail.pantry));
    const shop = ui.mount(el, { recipes: [alpha, beta], plan: week, storage: mem, css: false, household: true });

    assert.equal(shop.getPurchase().servings, 2.6);
    assert.match(el.innerHTML, /For 2 adults, 1 child aged 6-10/);
    assert.deepEqual(shop.getPantry(), [...DEFAULT_PANTRY]);
    assert.deepEqual(shop.getPurchase().leftOut, ['cooking oil', 'salt']);
    assert.match(shop.getText(), /^Purchase list\nFor 2 adults, 1 child aged 6-10 \(2\.6 servings per meal\)/);

    doc.dispatchEvent(new CustomEvent('recipe-bank:household-change', { detail: { profile: oneAdult, servingsPerMeal: 1 } }));
    assert.equal(shop.getPurchase().servings, 1);
    assert.match(el.innerHTML, /For 1 adult \(1 serving per meal\)/);

    shop.setPantry(['Chicken', 'salt']);
    assert.equal(mem.getItem('rb:pantry'), '["chicken","salt"]');
    assert.deepEqual(pantryEvents.at(-1), ['chicken', 'salt']);
    assert.deepEqual(shop.getPurchase().leftOut, ['chicken', 'salt']);

    // A click on a pantry chip removes that key (the fake element answers closest() for the chip).
    el.closest = (sel) => (sel === '[data-pantry-remove]' ? { dataset: { pantryRemove: 'chicken' } } : null);
    el.dispatchEvent(new Event('click'));
    assert.deepEqual(shop.getPantry(), ['salt']);
    assert.match(el.innerHTML, /<details class="rbf-pantry-edit" open>/);
    el.closest = () => null;

    shop.update({ household: false });
    assert.equal(shop.getPurchase(), null);
    assert.match(el.innerHTML, /Amounts are as each creator gave them/);
    assert.match(shop.getText(), /^Shopping list\n/);

    shop.update({ household: true, profile: family });
    assert.equal(shop.getPurchase().servings, 2.6);

    shop.destroy();
    assert.equal(el.innerHTML, '');
    doc.dispatchEvent(new CustomEvent('recipe-bank:household-change', { detail: { profile: oneAdult } }));
    assert.equal(el.innerHTML, '', 'no listeners after destroy');
  });
});

test('a fixed profile is not replaced by household events, and persist: false keeps the pantry in memory', async () => {
  await withFakeDom((doc) => {
    const mem = memory();
    const el = fakeElement();
    const shop = ui.mount(el, { recipes: [alpha], plan: week, storage: mem, css: false, household: true, profile: oneAdult, persist: false });
    doc.dispatchEvent(new CustomEvent('recipe-bank:household-change', { detail: { profile: family } }));
    assert.equal(shop.getPurchase().servings, 1);
    shop.setPantry(['parsley']);
    assert.equal(mem.getItem('rb:pantry'), null);
    assert.deepEqual(shop.getPurchase().leftOut, ['parsley']);
    shop.destroy();
  });
});

/** A fake element that answers querySelector for the progress text and the Untick all button. */
function listElement() {
  const progress = { textContent: '' };
  const untick = { hidden: true };
  const el = Object.assign(new EventTarget(), {
    innerHTML: '', closest: () => null,
    querySelector: (sel) => ({ '[data-progress]': progress, '[data-untick]': untick })[sel] ?? null,
  });
  return { el, progress, untick };
}
function tick(el, key, checked) {
  const e = new Event('change');
  const box = { checked, dataset: { key }, closest: () => null };
  Object.defineProperty(e, 'target', { value: { closest: (sel) => (sel === 'input[data-key]' ? box : null) } });
  el.dispatchEvent(e);
}

test('Untick all shows as soon as a box is ticked and hides when the last one is unticked', async () => {
  for (const household of [false, true]) {
    await withFakeDom(() => {
      const { el, progress, untick } = listElement();
      const shop = ui.mount(el, { recipes: [alpha], plan: week, storage: memory(), css: false, household });
      assert.match(el.innerHTML, /data-untick hidden/);
      tick(el, 'chicken', true);
      assert.match(progress.textContent, /^1 of \d+ ticked$/);
      assert.equal(untick.hidden, false, `shown after the first tick (household: ${household})`);
      tick(el, 'chicken', false);
      assert.equal(untick.hidden, true, 'hidden again with nothing ticked');
      shop.destroy();
    });
  }
});
