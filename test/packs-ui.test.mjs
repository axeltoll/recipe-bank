// The packs panel's pure renderers. Importing the module must not touch the DOM.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { renderPicker, renderPlan, esc, mount, importMessage } from '../public/features/packs.mjs';
import { exportPack, planImport, PACK_FORMAT } from '../lib/pack.mjs';
import { makeRecipe } from './helpers/bank.mjs';

const HTML = '<img src=x onerror=alert(1)>';

test('the module loads without a DOM and exports mount', () => {
  assert.equal(typeof mount, 'function');
  assert.equal(esc(`<a href="x">'&'</a>`), '&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;');
});

test('renderPicker escapes titles and creators, ticks selected ids and filters', () => {
  const recipes = [
    makeRecipe('alpha', 1, { title: HTML, creator: { name: '"Chef" <b>' } }),
    makeRecipe('beta', 2, { title: 'Banana milk', tags: ['drink'] }),
  ];
  const html = renderPicker(recipes, new Set(['beta']));
  assert.ok(!html.includes('<img'), 'no raw HTML from data');
  assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'));
  assert.ok(html.includes('&quot;Chef&quot; &lt;b&gt;'));
  assert.match(html, /data-pick="beta" checked/);
  assert.match(html, /data-pick="alpha" >/);
  const filtered = renderPicker(recipes, new Set(), 'DRINK');
  assert.ok(filtered.includes('Banana milk'));
  assert.ok(!filtered.includes('data-pick="alpha"'));
  assert.match(renderPicker(recipes, new Set(), 'zzz'), /No recipe matches/);
  assert.match(renderPicker([], new Set()), /No recipes in the bank yet/);
});

test('renderPlan escapes everything that comes from a pack', () => {
  const bad = makeRecipe('broken', 3);
  bad.components[0].ingredients[1].basis = '<script>alert(1)</script>';
  const pack = exportPack([makeRecipe('alpha', 4, { title: HTML }), makeRecipe('dup', 1)], { title: `Pack ${HTML}` });
  pack.recipes.push(bad);
  const plan = planImport(pack, [makeRecipe('alpha', 1)]);
  assert.deepEqual(plan.counts, { new: 0, conflict: 1, duplicate: 1, invalid: 1 });

  const html = renderPlan(plan, { include: new Set([0]), canImport: true });
  assert.ok(!/<img|<script/i.test(html), 'no raw HTML from data');
  assert.ok(html.includes('Pack &lt;img src=x onerror=alert(1)&gt;'));
  assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'), 'problems are shown, escaped');
  assert.match(html, /saved as <code>alpha-2<\/code> because <code>alpha<\/code> is taken/);
  assert.match(html, /same video as <a href="#\/r\/alpha">alpha<\/a>/);
  assert.match(html, /data-include="0" {2}checked/);
  assert.match(html, /data-include="1" disabled/);
  assert.match(html, /Import 1 recipe</);
  assert.match(html, /1 renamed · 1 already in your bank · 1 can’t be imported/);
});

test('renderPlan: import button state and the static-copy note', () => {
  const plan = planImport(exportPack([makeRecipe('alpha', 1), makeRecipe('beta', 2)]), []);
  assert.match(renderPlan(plan, { include: new Set([0, 1]), canImport: true }), /Import 2 recipes<\/button>/);
  assert.match(renderPlan(plan, { include: new Set(), canImport: true }), /data-act="import" disabled/);
  assert.match(renderPlan(plan, { include: new Set([0]), canImport: true, busy: true }), /disabled>Importing…/);
  const staticHtml = renderPlan(plan, { include: new Set([0, 1]), canImport: false });
  assert.ok(!staticHtml.includes('data-act="import"'));
  assert.match(staticHtml, /scripts\/pack\.mjs import &lt;file&gt; --write/);
});

test('renderPlan shows wrapper errors escaped', () => {
  const html = renderPlan({ ok: false, errors: ['<b>bad</b>'], items: [] });
  assert.match(html, /role="alert">&lt;b&gt;bad&lt;\/b&gt;</);
  const real = renderPlan(planImport(JSON.stringify({ format: PACK_FORMAT, version: 7, recipes: [] }), []));
  assert.match(real, /newer Recipe Bank/);
});

test('packs.css uses custom properties for every colour and spacing value', async () => {
  const css = await readFile(new URL('../public/features/packs.css', import.meta.url), 'utf8');
  const rules = css.replace(/\/\*[\s\S]*?\*\//g, '');
  // Literal colours may only appear where a custom property is defined.
  for (const line of rules.split('\n')) {
    if (/^\s*--[\w-]+\s*:/.test(line)) continue;
    assert.doesNotMatch(line, /#[0-9a-f]{3,8}\b|\brgba?\(|\bhsla?\(|\boklch\(/i, `literal colour: ${line.trim()}`);
    const m = line.match(/^\s*(margin|padding|gap|row-gap|column-gap)[\w-]*\s*:\s*([^;]+);/);
    if (m) assert.match(m[2], /^(?:var\(--[\w-]+\)|0|auto)(?:\s+(?:var\(--[\w-]+\)|0|auto))*$/, `spacing via custom properties: ${line.trim()}`);
  }
});

// Just enough DOM for mount(): every [data-el] is one stub element, and nothing touches a global document.
function fakePanel() {
  const els = new Map();
  const el = (sel) => els.get(sel) ?? els.set(sel, { dataset: {}, value: '', textContent: '', innerHTML: '', hidden: false }).get(sel);
  const win = Object.assign(new EventTarget(), { location: { hash: '', href: 'http://localhost/' }, fetch: async () => { throw new Error('offline'); } });
  const element = Object.assign(new EventTarget(), {
    innerHTML: '',
    classList: { add() {}, remove() {} },
    ownerDocument: { defaultView: win, documentElement: { dataset: {} } },
    querySelector: el,
    querySelectorAll: () => [],
    contains: () => true,
  });
  return { element, el };
}

test('the file input is cleared on each pick, so the same file can be opened again', async () => {
  const { element, el } = fakePanel();
  const panel = mount(element, { recipes: [], static: false });
  const input = el('[data-el="file"]');
  let reads = 0;
  const file = { size: 20, text: async () => { reads++; return '{ not json'; } };
  const pick = () => {
    input.files = [file];
    input.value = 'C:\\fakepath\\pack.json';
    const e = new Event('change');
    Object.defineProperty(e, 'target', { value: input });
    element.dispatchEvent(e);
  };
  pick();
  assert.equal(input.value, '');
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(reads, 1);
  assert.match(el('[data-el="plan"]').innerHTML, /not a JSON file/);
  pick();
  assert.equal(input.value, '');
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(reads, 2);
  panel.destroy();
});

test('importMessage: a recipe the server could not write is named with its reason, never reported as success', () => {
  assert.deepEqual(importMessage({ created: ['alpha'], skipped: [] }), ['Imported 1 recipe: alpha.', 'ok']);
  const [text, kind] = importMessage({
    created: ['alpha'],
    skipped: [{ index: 1, id: 'beta', reason: 'the id is too long for a file name' }, { index: 2, id: 'gamma', reason: 'not selected' }],
  });
  assert.equal(text, 'Imported 1 recipe: alpha. Not imported: beta (the id is too long for a file name).');
  assert.equal(kind, 'error');
  assert.deepEqual(importMessage({ created: [], skipped: [{ index: 0, id: 'alpha', reason: 'the recipe file could not be written' }] }),
    ['Not imported: alpha (the recipe file could not be written).', 'error']);
  assert.deepEqual(importMessage({ created: [], skipped: [{ index: 0, id: 'x', reason: 'not selected' }] }),
    ['Nothing was imported; those recipes are already in your bank.', '']);
});

/** A packs panel whose nodes disappear when it is destroyed, as they do after leaving the page. */
function removablePanel(options = {}) {
  const nodes = new Map();
  const node = (name) => {
    if (!nodes.has(name)) {
      let hidden = false;
      let hiddenWrites = 0;
      const el = {
        dataset: {},
        value: '',
        textContent: '',
        innerHTML: '',
        files: null,
        select() {},
        hiddenWrites: () => hiddenWrites,
      };
      Object.defineProperty(el, 'hidden', {
        get() { return hidden; },
        set(value) { hidden = value; hiddenWrites += 1; },
      });
      nodes.set(name, el);
    }
    return nodes.get(name);
  };
  let html = '';
  const win = Object.assign(new EventTarget(), {
    location: { hash: '', href: '/packs' },
    navigator: { clipboard: options.clipboard ?? { async writeText() {} } },
    fetch: async () => { throw new Error('offline'); },
    setTimeout,
  });
  const element = Object.assign(new EventTarget(), {
    classList: { add() {}, remove() {} },
    ownerDocument: {
      defaultView: win,
      documentElement: { dataset: {} },
      createElement: () => ({ click() {}, remove() {} }),
      body: { append() {} },
    },
    querySelector(sel) {
      const name = /\[data-el="([^"]+)"\]/.exec(sel)?.[1];
      if (!name || !html.includes(`data-el="${name}"`)) return null;
      return node(name);
    },
    querySelectorAll: () => [],
    contains: () => true,
  });
  Object.defineProperty(element, 'innerHTML', {
    get() { return html; },
    set(value) { html = String(value ?? ''); },
  });
  const panel = mount(element, { static: false, readHash: false, recipes: options.recipes ?? [], ...options, fetch: options.fetch });
  return { element, panel, node, win };
}

function act(element, name) {
  const event = new Event('click');
  Object.defineProperty(event, 'target', { value: { closest: (sel) => (sel === '[data-act]' ? { dataset: { act: name } } : null) } });
  element.dispatchEvent(event);
}

test('a late copy, import or open after leaving packs does not touch a removed status line', async (t) => {
  const errors = [];
  const onRejection = (error) => errors.push(error);
  process.on('unhandledRejection', onRejection);
  t.after(() => process.off('unhandledRejection', onRejection));

  let rejectCopy;
  const copy = removablePanel({
    recipes: [makeRecipe('alpha', 1)],
    clipboard: { writeText: () => new Promise((_, reject) => { rejectCopy = reject; }) },
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  const pick = new Event('change');
  Object.defineProperty(pick, 'target', { value: { dataset: { pick: 'alpha' }, checked: true } });
  copy.element.dispatchEvent(pick);
  act(copy.element, 'link');
  const linkOut = copy.node('link-out');
  const writesAtAwait = linkOut.hiddenWrites();
  copy.panel.destroy();
  rejectCopy(new Error('clipboard unavailable'));
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(linkOut.hiddenWrites(), writesAtAwait, 'the copy result must not update the link field after destroy');
  assert.equal(copy.node('share-status').textContent, '');

  let imported = 0;
  let releaseImport;
  const importer = removablePanel({
    recipes: [makeRecipe('alpha', 1)],
    onImported: () => { imported += 1; },
    fetch: (url) => (String(url).includes('/api/packs/import')
      ? new Promise((resolve) => {
        releaseImport = () => resolve({
          ok: true,
          status: 200,
          json: async () => ({ created: ['beta'], skipped: [] }),
        });
      })
      : { ok: true, json: async () => ({ recipes: [], invalid: [] }) }),
  });
  const pack = JSON.stringify(exportPack([makeRecipe('beta', 2)], { title: 't' }));
  const file = importer.node('file');
  file.files = [{ size: pack.length, text: async () => pack }];
  const change = new Event('change');
  Object.defineProperty(change, 'target', { value: file });
  importer.element.dispatchEvent(change);
  await new Promise((resolve) => setTimeout(resolve, 0));
  act(importer.element, 'import');
  importer.panel.destroy();
  releaseImport();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(imported, 0, 'a finished import must not apply after the page is gone');

  let releaseText;
  const opener = removablePanel({ recipes: [] });
  const input = opener.node('file');
  input.files = [{ size: 8, text: () => new Promise((resolve) => { releaseText = () => resolve('{'); }) }];
  const open = new Event('change');
  Object.defineProperty(open, 'target', { value: input });
  opener.element.dispatchEvent(open);
  opener.panel.destroy();
  releaseText();
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.deepEqual(errors, []);
});

test('the import status line survives the refresh after an import', async () => {
  const { element, el } = fakePanel();
  const pack = JSON.stringify(exportPack([makeRecipe('alpha', 1)], { title: 't' }));
  const fetch = async (url) => ({
    ok: true,
    json: async () => (String(url).includes('/api/packs/import')
      ? { created: [], skipped: [{ index: 0, id: 'alpha', reason: 'the recipe file could not be written' }] }
      : { recipes: [], invalid: [] }),
  });
  const panel = mount(element, { recipes: [], static: false, fetch, readHash: false });
  const input = el('[data-el="file"]');
  input.files = [{ size: pack.length, text: async () => pack }];
  const change = new Event('change');
  Object.defineProperty(change, 'target', { value: input });
  element.dispatchEvent(change);
  await new Promise((r) => setTimeout(r, 10));
  const click = new Event('click');
  Object.defineProperty(click, 'target', { value: { closest: () => ({ dataset: { act: 'import' } }) } });
  element.dispatchEvent(click);
  await new Promise((r) => setTimeout(r, 10));
  const status = el('[data-el="import-status"]');
  assert.equal(status.textContent, 'Not imported: alpha (the recipe file could not be written).');
  assert.equal(status.dataset.kind, 'error');
  panel.destroy();
});
