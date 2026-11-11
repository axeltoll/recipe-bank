// The installers in public/features/*-feature.js wire the self-contained modules into the dashboard through the
// rb API (docs/design/MOUNT-POINTS.md). There is no DOM in node:test, so this file runs them against a fake rb and
// small stand-ins for the few browser objects they touch, and checks what they register and render.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { esc } from '../public/features/shared.mjs';
import { scaleRecipe } from '../lib/scale.mjs';

// ---------- browser stand-ins (set before the installers are imported) ----------

/** A tiny document: listeners by type, and what ensureStylesheet and recipe-editor.mjs read. */
function fakeDocument() {
  const listeners = new Map();
  return {
    listeners,
    documentElement: { dataset: {} },
    head: { append() {} },
    querySelector: () => null,
    querySelectorAll: () => [],
    createElement: () => ({ dataset: {} }),
    addEventListener(type, fn) { (listeners.get(type) ?? listeners.set(type, []).get(type)).push(fn); },
    removeEventListener(type, fn) { listeners.set(type, (listeners.get(type) ?? []).filter((f) => f !== fn)); },
    dispatchEvent(e) { for (const fn of listeners.get(e.type) ?? []) fn(e); return true; },
    /** Call the listeners of `type` with a plain event object; returns their results. */
    fire(type, event) { return (listeners.get(type) ?? []).map((fn) => fn(event)); },
  };
}
const doc = fakeDocument();
globalThis.document = doc;

const { install: installFilters } = await import('../public/features/filters-feature.js');
const { install: installScale, applyAmounts } = await import('../public/features/scale-feature.js');
const { install: installPlan } = await import('../public/features/plan-feature.js');
const { install: installHousehold } = await import('../public/features/household-feature.js');
const { install: installPacks } = await import('../public/features/packs-feature.js');
const { install: installEditor } = await import('../public/features/editor-feature.js');
const { householdTarget } = await import('../public/features/household-target.js');
const { features } = await import('../public/features/index.js');

// ---------- a fake rb ----------

function fakeRb({ recipes = [], queue = [], isStatic = false, stored = {}, mount = () => null, mounts = () => [] } = {}) {
  const handlers = new Map();
  const store = new Map(Object.entries(stored).map(([k, v]) => [k, JSON.stringify(v)]));
  const rb = {
    isStatic,
    filters: new Map(),
    routes: new Map(),
    toasts: [],
    navigated: [],
    refreshed: 0,
    reloaded: 0,
    recipes: () => recipes,
    recipe: (id) => recipes.find((r) => r.id === id),
    queue: () => queue,
    on(name, fn) {
      (handlers.get(name) ?? handlers.set(name, []).get(name)).push(fn);
      return () => {};
    },
    emit(name, detail) { for (const fn of handlers.get(name) ?? []) fn(detail); },
    addFilter(id, f) { rb.filters.set(id, f); return () => rb.filters.delete(id); },
    addRoute(name, def) { rb.routes.set(name, def); return () => rb.routes.delete(name); },
    mount,
    mounts,
    refresh() { rb.refreshed++; },
    async reload() { rb.reloaded++; },
    navigate(hash) { rb.navigated.push(hash); },
    store: {
      get: (k, fallback) => (store.has(k) ? JSON.parse(store.get(k)) : fallback),
      set: (k, v) => store.set(k, JSON.stringify(v)),
      remove: (k) => store.delete(k),
    },
    stored: (k) => (store.has(k) ? JSON.parse(store.get(k)) : undefined),
    toast: (t) => rb.toasts.push(t),
    esc,
    icon: (name) => `<svg data-icon="${name}"></svg>`,
  };
  return rb;
}

/** A mount-point stand-in that records markup and listeners. */
function fakeElement(extra = {}) {
  return {
    innerHTML: '',
    dataset: {},
    listeners: {},
    addEventListener(type, fn) { this.listeners[type] = fn; },
    removeEventListener(type) { delete this.listeners[type]; },
    dispatchEvent() { return true; },
    querySelector: () => null,
    insertAdjacentHTML(where, html) { this.innerHTML += html; },
    ...extra,
  };
}

const ing = (item, key, amount) => ({ item, key, amount, basis: amount == null ? 'unstated' : 'spoken' });
const alpha = {
  id: 'alpha', title: 'Alpha', serves: '4', tags: ['quick', 'high protein'],
  nutrition: { per: 'serving', calories: 500, protein_g: 45 },
  components: [{ name: 'Main', steps: [], ingredients: [ing('Chicken', 'chicken', '800g'), ing('Salt', 'salt', 'a pinch'), ing('Oil', 'cooking oil', null)] }],
};
const beta = {
  id: 'beta', title: 'Beta', serves: null, tags: ['quick'],
  components: [{ name: 'All', steps: [], ingredients: [ing('Pork mince', 'pork', '500g'), ing('Chicken', 'chicken', '2 per person')] }],
};

// ---------- tests ----------

test('features/index.js lists six loaders and each module exports install()', async () => {
  assert.equal(features.length, 6);
  for (const load of features) assert.equal(typeof (await load()).install, 'function');
});

test('filters: three rb filters over one stored state; each clears only its own section', () => {
  const rb = fakeRb({ recipes: [alpha, beta], stored: { 'rb:filters-extra': { without: ['pork'], tags: ['quick'], minProtein: 40 } } });
  installFilters(rb);
  assert.deepEqual([...rb.filters.keys()], ['without', 'tags', 'nutrition']);
  const f = (id) => rb.filters.get(id);

  assert.equal(f('without').test(alpha), true);
  assert.equal(f('without').test(beta), false, 'beta lists pork');
  assert.equal(f('tags').test(beta), true);
  assert.equal(f('nutrition').test(alpha), true, '45 g protein ≥ 40');
  assert.equal(f('nutrition').test(beta), false, 'beta states no protein, so an active filter hides it');
  assert.deepEqual([f('without').active(), f('tags').active(), f('nutrition').active()], [1, 1, 1]);
  assert.deepEqual(f('without').describe(), ['without pork']);
  assert.deepEqual(f('tags').describe(), ['tag: quick']);
  assert.deepEqual(f('nutrition').describe(), ['≥ 40 g protein']);

  f('without').clear();
  assert.deepEqual(rb.stored('rb:filters-extra'), { without: [], tags: ['quick'], minProtein: 40, maxCalories: null });
  assert.equal(f('without').test(beta), true);
  f('nutrition').clear();
  assert.equal(f('nutrition').active(), 0);
  assert.deepEqual(f('nutrition').describe(), []);
  assert.equal(f('tags').active(), 1, 'tags untouched');
});

test('filters: one section per mount point on the home view, and a chip click updates the shared state', () => {
  const slots = { 'filter-exclude': fakeElement(), 'filter-tags': fakeElement(), 'filter-nutrition': fakeElement() };
  const rb = fakeRb({ recipes: [alpha, beta], mount: (name) => slots[name] ?? null });
  installFilters(rb);
  rb.emit('view', { name: 'home' });
  assert.match(slots['filter-exclude'].innerHTML, /data-group="without"/);
  assert.doesNotMatch(slots['filter-exclude'].innerHTML, /data-group="tags"|data-group="nutrition"/);
  assert.match(slots['filter-tags'].innerHTML, /data-group="tags"/);
  assert.match(slots['filter-nutrition'].innerHTML, /data-group="nutrition"/);

  // The module's own click handler, as a browser would call it for a click on the "pork" chip.
  const chip = { dataset: { without: 'pork' }, setAttribute() {} };
  slots['filter-exclude'].listeners.click({ target: { closest: (sel) => (sel === '[data-without]' ? chip : null) } });
  assert.deepEqual(rb.stored('rb:filters-extra').without, ['pork']);
  assert.equal(rb.refreshed, 1);
  assert.equal(rb.filters.get('without').test(beta), false);

  // "Clear all" in the dashboard: clear(), then the grid redraws and the chips catch up.
  rb.filters.get('without').clear();
  rb.emit('grid', {});
  assert.match(slots['filter-exclude'].innerHTML, /data-without="pork" aria-pressed="false"/);

  // Leaving home unmounts every section.
  rb.emit('view', { name: 'recipe' });
  assert.equal(slots['filter-tags'].innerHTML, '');
});

test('scaling: scaled amounts replace the text and are marked; the creator\'s words come back', () => {
  const span = (ci, ii, amount) => {
    const text = { textContent: amount ?? 'amount not given' };
    return { dataset: { ci: String(ci), ii: String(ii), amount: amount ?? '' }, text, querySelector: () => text };
  };
  const spans = [span(0, 0, '800g'), span(0, 1, 'a pinch'), span(0, 2, null)];
  const root = { querySelectorAll: () => spans };

  applyAmounts(root, scaleRecipe(alpha, 2));
  assert.equal(spans[0].text.textContent, '1600g');
  assert.equal(spans[0].dataset.scaled, 'true');
  assert.equal(spans[0].dataset.amount, '800g', 'the creator\'s words stay in data-amount');
  assert.equal(spans[1].text.textContent, 'a pinch', 'words are not scaled');
  assert.equal(spans[1].dataset.scaled, undefined);
  assert.equal(spans[2].text.textContent, 'amount not given', 'an unstated amount never gets a number');

  applyAmounts(root, null);
  assert.equal(spans[0].text.textContent, '800g');
  assert.equal(spans[0].dataset.scaled, undefined);
});

test('scaling: the control goes into recipe-scaling on recipe pages only', () => {
  const slot = fakeElement({ querySelector: (sel) => (sel === '[data-scale]' ? inner : null) });
  const inner = fakeElement();
  const rb = fakeRb({ recipes: [alpha], mount: (name) => (name === 'recipe-scaling' ? slot : null) });
  installScale(rb);
  rb.emit('view', { name: 'home' });
  assert.equal(slot.innerHTML, '');
  rb.emit('view', { name: 'recipe', recipe: alpha, root: { querySelectorAll: () => [] } });
  assert.match(slot.innerHTML, /data-scale/);
  assert.match(inner.innerHTML, /class="rbf rbf-scale"/);
  assert.doesNotMatch(inner.innerHTML, /rbf-scale-list/, 'the page keeps its own ingredient list');
});

test('household target: servings per meal from the saved profile, null without one', () => {
  const storage = (value) => () => ({ getItem: (k) => (k === 'recipe-bank:household' ? JSON.stringify(value) : null) });
  const t = householdTarget(storage({ people: { adult: 2, child6to10: 1 } }));
  assert.equal(t.servings, 2.6);
  assert.equal(t.description, '2 adults, 1 child aged 6-10');
  assert.equal(householdTarget(storage(null)), null);
  assert.equal(householdTarget(storage([1])), null);
  assert.equal(householdTarget(() => { throw new Error('blocked'); }), null);
  assert.equal(householdTarget(() => null), null);
});

test('week plan: a route with a header link, and "Add to week" on cards and recipe pages', () => {
  const slot = fakeElement({ dataset: { recipeId: 'alpha' } });
  const actions = fakeElement();
  const rb = fakeRb({ recipes: [alpha], mounts: () => [slot], mount: (name) => (name === 'recipe-actions' ? actions : null) });
  installPlan(rb);
  const route = rb.routes.get('plan');
  assert.equal(route.label, 'Week plan');
  assert.equal(route.layout, 'list');

  rb.emit('grid', { root: {} });
  assert.match(slot.innerHTML, /data-plan-add="alpha"/);
  rb.emit('view', { name: 'recipe', recipe: alpha });
  assert.match(actions.innerHTML, /data-plan-add="alpha"[^>]*>.*Add to week/);

  // "Add to week" only reports success when the stored plan gained the recipe, so give it working storage.
  const saved = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const mem = new Map();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) },
  });
  try {
    const button = { dataset: { planAdd: 'alpha' } };
    doc.fire('click', { target: { closest: (sel) => (sel === '[data-plan-add]' ? button : null) } });
    assert.deepEqual(rb.toasts, ['Added to this week: Alpha']);
    doc.fire('click', { target: { closest: () => ({ dataset: { planAdd: 'not-a-recipe' } }) } });
    assert.equal(rb.toasts.length, 1, 'an unknown id adds nothing');
  } finally {
    if (saved) Object.defineProperty(globalThis, 'localStorage', saved);
    else delete globalThis.localStorage;
  }
});

test('household and budget: a route of their own', () => {
  const rb = fakeRb();
  installHousehold(rb);
  const route = rb.routes.get('household');
  assert.equal(route.label, 'Household');
  assert.equal(typeof route.render, 'function');
});

test('packs: a #pack= link on first load and later becomes #/packs; the route is "Share"', () => {
  const replaced = [];
  const winListeners = {};
  globalThis.location = { hash: '#pack=abc', href: 'http://127.0.0.1:4780/#pack=abc', replace: (h) => replaced.push(h) };
  globalThis.history = { replaceState: (state, title, url) => replaced.push(`replaceState ${url}`) };
  globalThis.window = { addEventListener: (type, fn) => { winListeners[type] = fn; } };
  try {
    const rb = fakeRb();
    installPacks(rb);
    assert.deepEqual(replaced, ['replaceState #/packs']);
    assert.equal(rb.routes.get('packs').label, 'Share');

    globalThis.location.hash = '#/r/alpha';
    winListeners.hashchange();
    assert.equal(replaced.length, 1, 'other hashes are left to the router');
    globalThis.location.hash = '#pack=xyz';
    winListeners.hashchange();
    assert.deepEqual(replaced, ['replaceState #/packs', '#/packs']);
  } finally {
    delete globalThis.location;
    delete globalThis.history;
    delete globalThis.window;
  }
});

test('the static build stays read-only: the installers hand rb.isStatic to every module that could write', async () => {
  const read = (p) => readFile(new URL(`../public/${p}`, import.meta.url), 'utf8');
  const editor = await read('features/editor-feature.js');
  assert.equal((editor.match(/readOnly: rb\.isStatic/g) ?? []).length, 2, '#/new and #/edit both pass readOnly');
  assert.match(await read('features/packs-feature.js'), /static: rb\.isStatic/);
  // The editor defaults to read-only on <html data-static="1"> by itself too, and then has no Save button.
  const editorModule = await read('features/recipe-editor.mjs');
  assert.match(editorModule, /readOnly = STATIC/);
  assert.match(editorModule, /\$\{readOnly \? '' : '<button type="button" class="re-btn re-primary" data-action="save">/);
  // The queue: the add dialog copies a request instead of posting, and Remove is not offered.
  assert.match(await read('ui/add.js'), /if \(STATIC\) \{[\s\S]*?copy\(analysisRequest[\s\S]*?return;\s*\}/);
  for (const view of ['ui/home.js', 'ui/queue.js']) assert.match(await read(view), /&& !STATIC/, view);
});

test('editor: #/new and #/edit routes, a "New recipe" button, and the save and cancel reactions', async () => {
  const tools = fakeElement();
  const rb = fakeRb({ recipes: [alpha], queue: [], mount: (name) => (name === 'home-tools' ? tools : null) });
  installEditor(rb);
  assert.deepEqual([...rb.routes.keys()], ['new', 'edit']);

  const root = { innerHTML: '' };
  rb.routes.get('edit').render(root, 'no-such-recipe', rb);
  assert.match(root.innerHTML, /There is no recipe with that id/);
  rb.routes.get('new').render(root, 'gone-queue-id', rb);
  assert.match(root.innerHTML, /no longer in the queue/);

  rb.emit('view', { name: 'home' });
  assert.match(tools.innerHTML, /href="#\/new"/);

  await Promise.all(doc.fire('recipe-bank:recipe-saved', { detail: { id: 'alpha', created: true } }));
  assert.equal(rb.reloaded, 1);
  assert.deepEqual(rb.navigated, ['#/r/alpha']);
  assert.deepEqual(rb.toasts, ['Recipe saved']);

  doc.fire('recipe-bank:editor-cancel', { detail: { id: null, dirty: false } });
  assert.deepEqual(rb.navigated.at(-1), '#/');
  globalThis.confirm = () => false;
  try {
    doc.fire('recipe-bank:editor-cancel', { detail: { id: 'alpha', dirty: true } });
    assert.equal(rb.navigated.length, 2, 'unsaved changes kept when the reader says no');
    globalThis.confirm = () => true;
    doc.fire('recipe-bank:editor-cancel', { detail: { id: 'alpha', dirty: true } });
    assert.equal(rb.navigated.at(-1), '#/r/alpha');
  } finally {
    delete globalThis.confirm;
  }
});
