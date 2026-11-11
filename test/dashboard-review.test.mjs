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

test('withShownAmounts: scaled amounts replace the file\'s, the file is untouched, unstated stays unstated', async () => {
  const { withShownAmounts, shoppingList } = await import('../lib/catalog.mjs');
  const r = {
    title: 'Soup',
    components: [
      { name: 'Soup', ingredients: [
        { item: 'Chicken', key: 'chicken', amount: '800g', basis: 'spoken' },
        { item: 'Salt', key: 'salt', amount: null, basis: 'unstated' },
      ], steps: [] },
      { name: 'To serve', ingredients: [{ item: 'Bread', key: 'bread', amount: '2 slices', basis: 'spoken' }], steps: [] },
    ],
  };
  const before = structuredClone(r);
  const shown = withShownAmounts(r, new Map([['0.0', '1600g'], ['0.1', '10g'], ['1.0', ' ']]));
  assert.equal(shown.components[0].ingredients[0].amount, '1600g');
  assert.equal(shown.components[0].ingredients[1].amount, null, 'an unstated amount never gets a number');
  assert.equal(shown.components[1].ingredients[0].amount, '2 slices', 'blank text keeps the creator\'s words');
  assert.deepEqual(r, before, 'the recipe from the file is not changed');
  assert.equal(withShownAmounts(r, new Map()), r);
  assert.equal(withShownAmounts(r, undefined), r);
  assert.match(shoppingList(shown), /^- Chicken: 1600g$/m);
  assert.match(shoppingList(shown), /^- Salt$/m);
});

test('after a scale, Copy list and cook mode use the amounts the page shows', async () => {
  const cook = await read('public', 'ui', 'cook.js');
  // Copy list goes through the page's amounts, never straight from the file.
  assert.doesNotMatch(recipeJs, /shoppingList\(r\)/);
  assert.match(recipeJs, /shoppingList\(withShownAmounts\(r, shownAmounts\(\)\)\)/);
  assert.match(recipeJs, /\$\$\('\.ing-amt\[data-scaled\]', view\)/, 'the page\'s scaled amounts are read from the hooks');
  assert.match(recipeJs, /openCook\(r, \{[\s\S]*?amounts: shownAmounts\(\)/);
  // Cook mode renders the same hooks as the page, keeps data-amount as the creator's words, and marks scaled ones.
  assert.match(cook, /withShownAmounts\(recipe, amounts\)/);
  for (const hook of ['data-ci="${ci}"', 'data-ii="${ii}"', 'data-amount="${esc(i.amount ?? \'\')}"', 'data-scaled="true"', '<span class="ing-amt-text">${esc(amount ?? \'amount not given\')}</span>']) {
    assert.ok(cook.includes(hook), `cook mode lacks ${hook}`);
  }
});

test('steps are numbered across the parts on the recipe page, as in cook mode', async () => {
  const recipe = await read('public', 'ui', 'recipe.js');
  assert.doesNotMatch(block(css, '.steps'), /counter-reset/, 'a part does not restart the count at 1');
  assert.match(block(css, '.recipe-steps'), /counter-reset:\s*step/, 'one counter for the whole steps panel');
  assert.match(block(css, '.steps li'), /counter-increment:\s*step/);
  // The list itself and the timer labels use the same running number as the circles.
  assert.match(recipe, /<ol class="steps" start="\$\{firstStep\[ci\] \+ 1\}">/);
  assert.match(recipe, /step \$\{firstStep\[ci\] \+ si \+ 1\}`\)/);
  assert.doesNotMatch(recipe, /step \$\{si \+ 1\}/);
  // Cook mode counts across the parts too: flattenSteps numbers from 1 over every component.
  const { flattenSteps } = await import('../lib/catalog.mjs');
  const steps = flattenSteps({ components: [{ name: 'A', steps: [{ text: 'a1' }, { text: 'a2' }] }, { name: 'B', steps: [{ text: 'b1' }] }] });
  assert.deepEqual(steps.map((s) => s.n), [1, 2, 3]);
});

test('cook mode: a refused wake lock turns the switch off for the session, so returning to the tab does not retake it', async () => {
  const cook = await read('public', 'ui', 'cook.js');
  const request = cook.slice(cook.indexOf('async function requestWake'), cook.indexOf('function releaseWake'));
  const refused = request.slice(request.indexOf('} catch {'));
  assert.match(refused, /wakeWanted = false;/, 'the visibility handler checks wakeWanted, so it must follow the switch');
  assert.doesNotMatch(refused, /store\.set/, 'a refusal is not the reader\'s choice: the next session asks again');
  assert.match(cook.slice(cook.indexOf('export function openCook'), cook.indexOf('session = {')), /wakeWanted = store\.get\(WAKE_KEY, true\) !== false/);
  // Without the Wake Lock API the switch is rendered off, not checked and then snapped off.
  assert.match(cook, /id="cook-wake-on"\$\{wakeWanted && 'wakeLock' in navigator \? ' checked' : ''\}/);
});

test('add: a 409 for a recipe this page has not loaded yet reloads before opening it', async () => {
  const add = await read('public', 'ui', 'add.js');
  const app = await read('public', 'app.js');
  const conflict = add.slice(add.indexOf('if (res.status === 409 && body.recipeId)'), add.indexOf("toast('That one is already in the bank')"));
  assert.ok(conflict.indexOf('await reload') >= 0 && conflict.indexOf('await reload') < conflict.indexOf('location.hash ='),
    'reload() runs before the hash changes');
  assert.match(app, /setupAdd\(\{ rerender: [^}]*\}?, reload \}\)/, 'the dashboard hands reload to the dialog');
});

test('home: turning a chip off redraws the chips, so a chip past the limit shown only while on goes away', () => {
  const click = home.slice(home.indexOf("$('#chips').addEventListener('click'"), home.indexOf("if (e.target.closest('#more'))"));
  assert.match(click, /if \(!state\.keys\.has\(k\)\) \{[\s\S]*?renderChips\(\);/);
});

test('recipe page: a damaged checklist in storage cannot throw, and a view that throws shows an error state', async () => {
  const app = await read('public', 'app.js');
  for (const file of ['recipe.js', 'home.js', 'cook.js', 'queue.js', 'core.js']) {
    assert.doesNotMatch(await read('public', 'ui', file), /new Set\(store\.get\(/, `${file}: a stored value is checked before it is iterated`);
  }
  assert.match(recipeJs, /const checked = new Set\(Array\.isArray\(saved\) \? saved\.filter\(\(k\) => typeof k === 'string'\) : \[\]\);/);
  // Same fallback as a feature route: the hash has changed, so the old view must not stay on screen.
  assert.match(app, /if \(next\.name === 'recipe'\) detail = renderDetail\(next, renderRecipe\);/);
  assert.match(app, /else if \(next\.name === 'queue'\) detail = renderDetail\(next, renderQueued\);/);
  assert.match(app, /function renderDetail\(next, render\) \{\s*try \{\s*return render\(next\.id\);\s*\} catch \(e\) \{\s*return renderFailed\(next, e\);/);
});
