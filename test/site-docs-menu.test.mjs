// The docs list on a phone or tablet is folded behind a menu button that js/main.js shows. The fold must come
// from that same module, so a page whose module is slow, blocked or broken still shows the list.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const SITE = resolve(import.meta.dirname, '..', 'site');

test('the CSS folds the docs list only behind the class main.js adds, not behind .js', async () => {
  const css = (await readFile(join(SITE, 'css', 'site.css'), 'utf8')).replace(/\/\*[\s\S]*?\*\//g, '');
  const hides = [...css.matchAll(/([^{}]*\.docs-nav[^{}]*)\{\s*display:\s*none/g)].map((m) => m[1].trim());
  assert.deepEqual(hides, ['.docs-nav.is-collapsible']);
  assert.doesNotMatch(css, /\.js \.docs-nav/, 'theme.js sets .js before the module has run');
});

function fakeElement() {
  const classes = new Set(), attrs = {};
  return {
    hidden: true, listeners: {},
    classList: {
      add: (c) => classes.add(c), remove: (c) => classes.delete(c), contains: (c) => classes.has(c),
      toggle: (c, on = !classes.has(c)) => { if (on) classes.add(c); else classes.delete(c); return on; },
    },
    setAttribute(k, v) { attrs[k] = String(v); }, getAttribute: (k) => attrs[k] ?? null,
    addEventListener(type, fn) { this.listeners[type] = fn; }, focus() {},
  };
}

test('main.js folds the docs list in the same turn as it shows the menu button', async (t) => {
  const button = fakeElement(), nav = fakeElement(), root = fakeElement();
  const media = () => ({ matches: false, addEventListener() {} });
  const saved = { document: globalThis.document, matchMedia: globalThis.matchMedia, error: console.error };
  globalThis.document = {
    documentElement: root,
    getElementById: (id) => ({ 'docs-menu-toggle': button, 'docs-nav': nav })[id] ?? null,
    querySelector: () => null, querySelectorAll: () => [], addEventListener() {}, dispatchEvent() {},
  };
  globalThis.matchMedia = media;
  console.error = () => {}; // the other parts find no page to work on
  t.after(() => {
    globalThis.document = saved.document;
    globalThis.matchMedia = saved.matchMedia;
    console.error = saved.error;
  });
  await import(`${pathToFileURL(join(SITE, 'js', 'main.js')).href}?docs-menu`);
  assert.equal(button.hidden, false, 'the button is shown');
  assert.ok(nav.classList.contains('is-collapsible'), 'and the list is folded behind it');
  button.listeners.click();
  assert.ok(nav.classList.contains('is-open'));
});
