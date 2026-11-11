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
const recipeJs = await read('public', 'ui', 'recipe.js');

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

/** The text between the braces that follow the first occurrence of `head {`. */
function block(source, head) {
  const start = source.indexOf(`${head} {`);
  assert.ok(start >= 0, `no rule for ${head}`);
  const open = source.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}' && --depth === 0) return source.slice(open + 1, i);
  }
  throw new Error(`unbalanced braces after ${head}`);
}

/** The selectors (comma-split) that the rules in `source` hide with display: none. */
function hidden(source) {
  return [...source.matchAll(/([^{}]+)\{[^{}]*display:\s*none[^{}]*\}/g)]
    .flatMap((m) => m[1].split(',').map((s) => s.trim()));
}

test('print: timestamps stay on the sheet as text, only the timers are left out', () => {
  const recipe = recipeJs;
  // YouTube timestamps are buttons, other platforms a span: both are .ts.
  assert.match(recipe, /<button type="button" class="ts" data-t=/);
  assert.match(recipe, /<span class="ts ts-static">/);
  const print = block(css, '@media print');
  const gone = hidden(print);
  assert.ok(gone.includes('.step-tools .timer'), 'timers are not printed');
  // Hiding the icon inside a timestamp is fine; hiding the timestamp (or every button in a step) is not.
  for (const sel of gone) assert.doesNotMatch(sel, /\.step-tools button|\.ts$|^button$/, `${sel} hides the timestamps`);
  assert.match(block(print, '.ts'), /border:\s*0/, 'a printed timestamp is text, not a pill');
});
