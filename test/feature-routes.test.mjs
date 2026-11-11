// The installers in public/features/*-feature.js against a small fake rb (no DOM in node:test): the filter panels
// on the home page, "Add to week", and leaving the recipe editor with unsaved changes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { esc } from '../public/features/shared.mjs';

// What the modules read from document: listeners, <html data-static> (not set), and the stylesheet links.
const freshDocument = () => Object.assign(new EventTarget(), {
  documentElement: { dataset: {} },
  querySelectorAll: () => [],
  createElement: () => ({}),
  head: { append() {} },
});
globalThis.document = freshDocument();
const { install: installFilters } = await import('../public/features/filters-feature.js');
const { install: installPlan } = await import('../public/features/plan-feature.js');
const { install: installEditor } = await import('../public/features/editor-feature.js');

const memory = () => {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) };
};
const blocked = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('quota'); } };
/** Run `fn` with `localStorage` replaced (Node has its own, or none). */
function withStorage(storage, fn) {
  const saved = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true, writable: true });
  try {
    return fn();
  } finally {
    if (saved) Object.defineProperty(globalThis, 'localStorage', saved);
    else delete globalThis.localStorage;
  }
}

function fakeRb({ recipes = [], stored = {}, mount = () => null } = {}) {
  const handlers = new Map();
  const store = new Map(Object.entries(stored).map(([k, v]) => [k, JSON.stringify(v)]));
  const rb = {
    isStatic: false,
    filters: new Map(),
    routes: new Map(),
    toasts: [],
    navigated: [],
    recipes: () => recipes,
    recipe: (id) => recipes.find((r) => r.id === id),
    queue: () => [],
    on(name, fn) { (handlers.get(name) ?? handlers.set(name, []).get(name)).push(fn); },
    emit(name, detail) { for (const fn of handlers.get(name) ?? []) fn(detail); },
    addFilter(id, f) { rb.filters.set(id, f); },
    addRoute(name, def) { rb.routes.set(name, def); },
    mount,
    mounts: () => [],
    refresh() {},
    async reload() {},
    navigate(hash) { rb.navigated.push(hash); },
    store: { get: (k, fallback) => (store.has(k) ? JSON.parse(store.get(k)) : fallback), set: (k, v) => store.set(k, JSON.stringify(v)) },
    stored: (k) => JSON.parse(store.get(k)),
    toast: (t) => rb.toasts.push(t),
    esc,
    icon: (name) => `<svg data-icon="${name}"></svg>`,
  };
  return rb;
}

const fakeEl = () => Object.assign(new EventTarget(), { innerHTML: '', querySelector: () => null });
function click(target, hits) {
  const e = new Event('click');
  Object.defineProperty(e, 'target', { value: { closest: (sel) => hits[sel] ?? null } });
  target.dispatchEvent(e);
}

const ing = (item, key, amount) => ({ item, key, amount, basis: amount == null ? 'unstated' : 'spoken' });
const alpha = {
  id: 'alpha', title: 'Alpha', serves: '4', tags: ['quick'], nutrition: { per: 'serving', calories: 500, protein_g: 45 },
  components: [{ name: 'Main', steps: [], ingredients: [ing('Chicken', 'chicken', '800g'), ing('Pork', 'pork', '1')] }],
};

test('filters: "Clear these" on one panel leaves the other panels\' fields on', () => {
  const els = { 'filter-exclude': fakeEl(), 'filter-tags': fakeEl(), 'filter-nutrition': fakeEl() };
  const rb = fakeRb({ recipes: [alpha], mount: (name) => els[name] ?? null,
    stored: { 'rb:filters-extra': { without: ['pork'], tags: ['quick'], minProtein: 40 } } });
  installFilters(rb);
  rb.emit('view', { name: 'home' });
  // Each panel's summary names only its own section.
  assert.match(els['filter-exclude'].innerHTML, /data-summary aria-live="polite">without pork</);
  assert.match(els['filter-tags'].innerHTML, /data-summary aria-live="polite">tag: quick</);
  assert.match(els['filter-nutrition'].innerHTML, /data-summary aria-live="polite">≥ 40 g protein</);

  click(els['filter-exclude'], { '[data-clear]': {} });
  assert.deepEqual(rb.stored('rb:filters-extra'), { without: [], tags: ['quick'], minProtein: 40, maxCalories: null });
  assert.equal(rb.filters.get('tags').active(), 1, 'the tag filter is still on');
  assert.match(els['filter-exclude'].innerHTML, /data-clear hidden/, 'nothing left for this panel to clear');

  click(els['filter-tags'], { '[data-clear]': {} });
  assert.deepEqual(rb.stored('rb:filters-extra'), { without: [], tags: [], minProtein: 40, maxCalories: null });
});

test('"Add to week" says added only when the stored plan gained the recipe', () => {
  const rb = fakeRb({ recipes: [alpha] });
  installPlan(rb);
  const add = () => click(document, { '[data-plan-add]': { dataset: { planAdd: 'alpha' } } });
  withStorage(memory(), () => {
    add();
    add();
  });
  assert.deepEqual(rb.toasts, ['Added to this week: Alpha', 'Already in this week: Alpha']);
  withStorage(blocked, add);
  assert.equal(rb.toasts.at(-1), 'Could not add it: this browser is not saving the week plan');
});

// ---------- the editor ----------

/** A view root: innerHTML makes one child "page"; replaceChildren puts a kept one back. */
function fakeRoot() {
  let pages = 0;
  return {
    children: [],
    set innerHTML(html) { this.children = html ? [{ page: ++pages, html }] : []; },
    get innerHTML() { return this.children.map((c) => c.html).join(''); },
    get firstElementChild() { return this.children[0] ?? null; },
    querySelector: () => ({}),
    replaceChildren(...nodes) { this.children = nodes; },
  };
}

function editorHarness() {
  const editors = [];
  const mountEditor = () => {
    const ed = { dirty: false, destroyed: false, isDirty: () => ed.dirty, destroy: () => { ed.destroyed = true; } };
    editors.push(ed);
    return ed;
  };
  let unload = null;
  globalThis.addEventListener = (type, fn) => { if (type === 'beforeunload') unload = fn; };
  const rb = fakeRb({ recipes: [alpha] });
  globalThis.document = freshDocument(); // only this install's listeners
  try {
    installEditor(rb, { mountEditor });
  } finally {
    delete globalThis.addEventListener;
  }
  const root = fakeRoot();
  const confirms = [];
  let answer = false;
  globalThis.confirm = (text) => { confirms.push(text); return answer; };
  globalThis.location = { hash: '' };
  /** What the dashboard does on a hash change: clear the view, render the route, then emit rb:view. */
  const go = (hash) => {
    location.hash = hash;
    root.innerHTML = '';
    const [, name, param] = hash.match(/^#\/([a-z-]+)(?:\/(.+))?$/) ?? [, 'home'];
    if (rb.routes.has(name)) rb.routes.get(name).render(root, param, rb);
    else root.innerHTML = `<div>${name}</div>`;
    rb.emit('view', { name });
  };
  return { rb, root, editors, confirms, go, unload: () => unload, answer: (a) => { answer = a; } };
}

test('editor: leaving with unsaved changes asks; Cancel puts the same editor back', (t) => {
  t.after(() => { delete globalThis.confirm; delete globalThis.location; });
  const h = editorHarness();
  h.go('#/edit/alpha');
  assert.equal(h.editors.length, 1);
  const page = h.root.firstElementChild;

  // No changes: leaving does not ask.
  h.go('#/plan');
  assert.equal(h.confirms.length, 0);
  assert.equal(h.editors[0].destroyed, true);

  h.go('#/edit/alpha');
  const ed = h.editors[1];
  const editorPage = h.root.firstElementChild;
  assert.notEqual(editorPage, page);
  ed.dirty = true;

  // A header link while there are changes: the reader says Cancel.
  h.answer(false);
  h.go('#/plan');
  assert.equal(h.confirms.length, 1);
  assert.match(h.confirms[0], /Leave without saving\?/);
  assert.equal(ed.destroyed, false, 'the draft is kept');
  assert.deepEqual(h.rb.navigated, ['#/edit/alpha'], 'and the route goes back to the editor');
  h.go('#/edit/alpha'); // the hash change that navigate() causes
  assert.equal(h.editors.length, 2, 'no new editor');
  assert.deepEqual(h.root.children, [editorPage], 'the same editor page is back');
  assert.equal(h.confirms.length, 1, 'coming back does not ask again');

  // Another editor route asks too.
  h.go('#/new');
  assert.equal(h.confirms.length, 2);
  assert.equal(h.editors.length, 2);
  assert.equal(h.rb.navigated.at(-1), '#/edit/alpha');
  h.go('#/edit/alpha');
  assert.deepEqual(h.root.children, [editorPage]);

  // Closing the tab: beforeunload asks while there are changes.
  const unload = { prevented: false, returnValue: undefined, preventDefault() { this.prevented = true; } };
  h.unload()(unload);
  assert.equal(unload.prevented, true);
  assert.equal(unload.returnValue, '');

  // The reader agrees to leave: the editor goes.
  h.answer(true);
  h.go('#/');
  assert.equal(h.confirms.length, 3);
  assert.equal(ed.destroyed, true);
  assert.equal(h.rb.navigated.length, 2, 'no navigation back');
  const quiet = { prevented: false, preventDefault() { this.prevented = true; } };
  h.unload()(quiet);
  assert.equal(quiet.prevented, false, 'nothing to lose: the tab closes without asking');
});

test('editor: Cancel with changes asks once, not again on the way out', (t) => {
  t.after(() => { delete globalThis.confirm; delete globalThis.location; });
  const h = editorHarness();
  h.go('#/edit/alpha');
  h.editors[0].dirty = true;
  h.answer(true);
  document.dispatchEvent(new CustomEvent('recipe-bank:editor-cancel', { detail: { id: 'alpha', dirty: true } }));
  assert.deepEqual(h.confirms, ['Discard your changes?']);
  assert.equal(h.editors[0].destroyed, true);
  assert.equal(h.rb.navigated.at(-1), '#/r/alpha');
  h.go('#/r/alpha');
  assert.equal(h.confirms.length, 1);
});
