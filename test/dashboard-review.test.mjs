// Regression tests for review findings on the dashboard (public/ui, public/styles.css). Like test/design.test.mjs,
// most of them read the files: the views need a browser, so these guard the markup and selectors they rely on.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const read = (...parts) => readFile(join(ROOT, ...parts), 'utf8');
const noComments = (source) => source.replace(/\/\*[\s\S]*?\*\//g, '');

const css = noComments(await read('public', 'styles.css'));
const home = await read('public', 'ui', 'home.js');

test('home: the match-mode listener is bound to the Has all / Has any buttons only, not to the grid', () => {
  // The grid's list/cards switch is data-view; data-mode is left to the segmented buttons.
  assert.match(home, /<div class="grid" id="grid" data-view="\$\{listMode \? 'list' : 'grid'\}">/);
  assert.match(home, /\$\('#grid'\)\.dataset\.view = /);
  assert.doesNotMatch(home, /\$\('#grid'\)\.dataset\.mode/);
  const modeTags = [...home.matchAll(/<[a-z]+[^>]*\sdata-mode=/g)].map((m) => m[0]);
  assert.equal(modeTags.length, 2, 'only the two segmented buttons carry data-mode');
  for (const tag of modeTags) assert.match(tag, /^<button /);
  // Every query for data-mode is scoped to the segmented group.
  const queries = [...home.matchAll(/\$\$?\('([^']*\[data-mode[^']*)'/g)].map((m) => m[1]);
  assert.ok(queries.length >= 1, 'the mode buttons are looked up');
  for (const q of queries) assert.match(q, /^\.segmented \[data-mode\]$/, `unscoped query ${q}`);
  assert.doesNotMatch(css, /\.grid\[data-mode/, 'the stylesheet reads the grid\'s data-view');
  assert.match(css, /\.grid\[data-view='list'\]/);
});
