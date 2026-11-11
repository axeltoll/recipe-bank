// Browser smoke test of the dashboard, live (npm start) and static (dist/). The selectors for the redesigned
// dashboard live in scripts/browser/selectors.mjs, the one place to update after a redesign.
import assert from 'node:assert/strict';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { loadRecipes } from '../server.mjs';
import { ROOT, options, browserAvailable, withBrowser, assertClean } from './browser/support.mjs';
import { SELECTORS, TEXT } from './browser/selectors.mjs';

export { SELECTORS };

const checks = ['grid', 'filters', 'creator', 'recipe', 'timestamp', 'queue', 'keyboard', 'features'];
let opts = { headed: false, only: null }; // set in the try block below, so bad options print a FAIL line
const enabled = (name) => !opts.only || opts.only === name;
const q = JSON.stringify;
const keys = (r) => new Set(r.components.flatMap((c) => c.ingredients.map((i) => i.key)));

async function smoke(page, origin, label, recipes) {
  await page.setViewport(1280, 800);
  await page.goto(`${origin}/#/`);
  await page.waitFor(SELECTORS.cards);
  const ids = () => page.evaluate(`Array.from(document.querySelectorAll(${q(SELECTORS.cards)}), el => decodeURIComponent(el.hash.slice(4))).sort()`);
  const expectIds = async (expected) => assert.deepEqual(await ids(), expected.map((r) => r.id).sort());
  const input = async (selector, value) => page.evaluate(`(() => {
    const input = document.querySelector(${q(selector)});
    input.value = ${q(value)};
    input.dispatchEvent(new Event('input', {bubbles: true}));
  })()`);
  if (enabled('grid')) {
    const files = (await readdir(join(ROOT, 'recipes'))).filter((f) => f.endsWith('.json'));
    assert.equal((await ids()).length, files.length, 'one card per recipe file');
    await expectIds(recipes);
    console.log(`PASS ${label}: grid (${files.length} recipes)`);
  }
  if (enabled('filters')) {
    if (await page.evaluate(`Boolean(document.querySelector(${q(SELECTORS.more)}))`)) await page.click(SELECTORS.more);
    const available = await page.evaluate(`Array.from(document.querySelectorAll(${q(SELECTORS.chips)}), el => el.dataset.key)`);
    const first = available.find((key) => recipes.some((r) => keys(r).has(key)) && recipes.some((r) => !keys(r).has(key)));
    const second = available.find((key) => key !== first && recipes.some((r) => keys(r).has(first) !== keys(r).has(key)));
    assert.ok(first && second, 'recipe collection must contain two discriminating ingredient chips');
    const chip = SELECTORS.chip;
    await page.click(chip(first));
    const one = recipes.filter((r) => keys(r).has(first));
    await expectIds(one);
    assert.ok(one.length < recipes.length && one.length > 0, 'ingredient chip narrows the grid');
    await page.click(chip(second));
    const all = recipes.filter((r) => keys(r).has(first) && keys(r).has(second));
    await expectIds(all);
    await page.click(SELECTORS.any);
    const any = recipes.filter((r) => keys(r).has(first) || keys(r).has(second));
    await expectIds(any);
    assert.ok(any.length > all.length, 'Has any changes results');
    await page.click(SELECTORS.all);
    await expectIds(all);
    await page.click(SELECTORS.clear);
    await expectIds(recipes);
    console.log(`PASS ${label}: ingredient filters and Has all / Has any`);
  }
  if (enabled('creator')) {
    const recipe = recipes.find((r) => r.creator.name.trim());
    assert.ok(recipe, 'creator fixture exists');
    await input(SELECTORS.search, recipe.creator.name);
    const found = await ids();
    assert.ok(found.includes(recipe.id), 'search finds the creator recipe');
    assert.ok(found.length < recipes.length, 'creator search narrows the grid (this needs recipes from at least two creators in recipes/)');
    await page.click(SELECTORS.clear);
    console.log(`PASS ${label}: creator search`);
  }
  const recipe = recipes.find((r) => r.video.platform === 'youtube' && r.components.some((c) => c.steps.some((s) => s.t > 0)));
  assert.ok(recipe, 'a YouTube recipe with a positive timestamp is required');
  if (['recipe', 'timestamp', 'keyboard'].some(enabled)) {
    await page.click(SELECTORS.card(recipe.id));
    await page.waitFor(SELECTORS.steps);
    if (enabled('recipe')) {
      const ingredients = await page.evaluate(`Array.from(document.querySelectorAll(${q(SELECTORS.ingredients)}), el => el.textContent.trim())`);
      assert.deepEqual(ingredients, recipe.components.flatMap((c) => c.ingredients.map((i) => i.item)));
      const steps = await page.evaluate(`Array.from(document.querySelectorAll(${q(SELECTORS.steps)}), el => el.textContent)`);
      const expected = recipe.components.flatMap((c) => c.steps);
      assert.equal(steps.length, expected.length);
      expected.forEach((s, i) => assert.ok(steps[i].includes(s.text), 'step text present'));
      console.log(`PASS ${label}: recipe ingredients and steps`);
    }
    const step = recipe.components.flatMap((c) => c.steps).find((s) => s.t > 0);
    const timestamp = SELECTORS.timestampAt(step.t);
    const assertStart = async (t) => {
      const src = await page.evaluate(`document.querySelector(${q(SELECTORS.player)}).src`);
      assert.equal(new URL(src).searchParams.get('start'), String(Math.floor(t)));
    };
    if (enabled('timestamp')) {
      await page.click(timestamp);
      await assertStart(step.t);
      console.log(`PASS ${label}: timestamp sets player start=${step.t}`);
    }
    if (enabled('keyboard')) {
      // Start from the document's beginning, then use real Tab events to reach every step button.
      await page.evaluate(() => { document.activeElement?.blur(); window.scrollTo(0, 0); });
      await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Home', code: 'Home', modifiers: 2 });
      await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Home', code: 'Home', modifiers: 2 });
      const count = await page.evaluate(`document.querySelectorAll(${q(SELECTORS.timestamp)}).length`);
      const seen = new Set();
      for (let i = 0; i < 300 && seen.size < count; i++) {
        await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
        await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
        const focused = await page.evaluate(`(() => {
          const buttons = Array.from(document.querySelectorAll(${q(SELECTORS.timestamp)}));
          const index = buttons.indexOf(document.activeElement);
          return index < 0 ? null : {index, t: Number(buttons[index].dataset.t)};
        })()`);
        if (!focused) continue;
        seen.add(focused.index);
        // Reset the attribute so the Enter assertion cannot pass on a prior click's value.
        await page.evaluate(`document.querySelector(${q(SELECTORS.player)}).src = 'about:blank'`);
        await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r', unmodifiedText: '\r' });
        await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
        if (focused.t > 0) await assertStart(focused.t);
        else {
          const src = await page.evaluate(`document.querySelector(${q(SELECTORS.player)}).src`);
          assert.notEqual(src, 'about:blank', 'Enter activates zero timestamp');
        }
      }
      assert.equal(seen.size, count, 'Tab reaches every step timestamp');
      console.log(`PASS ${label}: keyboard reaches and activates ${count} step buttons`);
    }
  }
  await page.screenshot(join(ROOT, '.smoke', `${label}-recipe.png`));
  if (enabled('queue')) {
    await page.click(SELECTORS.add);
    await input(SELECTORS.url, 'https://example.invalid/not-a-video');
    assert.equal(await page.evaluate(`document.querySelector(${q(SELECTORS.hint)}).textContent`), TEXT.unsupportedLink);
    await page.click(SELECTORS.cancel);
    console.log(`PASS ${label}: unsupported link warning (no queue writes)`);
  }
  if (enabled('features')) {
    // Every feature route renders, without writing anything (no save, no import is clicked).
    await page.goto(`${origin}/#/`);
    await page.waitFor(SELECTORS.withoutChips);
    const nav = await page.evaluate(`Array.from(document.querySelectorAll(${q(SELECTORS.nav)}), (a) => a.textContent.trim())`);
    assert.deepEqual(nav, ['Recipes', 'Week plan', 'Household', 'Share'], 'header navigation lists the feature routes');
    for (const [hash, selector] of [
      ['#/plan', SELECTORS.weekPlan], ['#/plan', SELECTORS.shoppingList],
      ['#/household', SELECTORS.household], ['#/household', SELECTORS.budget],
      ['#/packs', SELECTORS.packs], ['#/new', SELECTORS.editor],
      [`#/edit/${encodeURIComponent(recipe.id)}`, SELECTORS.editor],
      [`#/r/${encodeURIComponent(recipe.id)}`, SELECTORS.scale],
    ]) {
      await page.goto(`${origin}/${hash}`);
      await page.waitFor(selector);
    }
    assert.ok(await page.evaluate(`Boolean(document.querySelector(${q(SELECTORS.addToWeek)}))`), 'recipe page offers Add to week');
    await page.goto(`${origin}/#/new`);
    await page.waitFor(SELECTORS.editorDownload);
    const canSave = await page.evaluate(`Boolean(document.querySelector(${q(SELECTORS.editorSave)}))`);
    assert.equal(canSave, label === 'live', 'the editor saves on the local server and only downloads on the static build');
    console.log(`PASS ${label}: feature routes render; the static editor offers Download JSON only`);
  }
  assertClean(page);
  await page.goto(`${origin}/#/`);
  await page.waitFor(SELECTORS.cards);
  await page.screenshot(join(ROOT, '.smoke', `${label}-home.png`));
  assertClean(page);
}

try {
  opts = options();
  if (opts.only && !checks.includes(opts.only)) throw new Error(`--only must be one of: ${checks.join(', ')}`);
  if (browserAvailable()) {
    const { recipes, invalid } = await loadRecipes();
    assert.deepEqual(invalid, [], 'all recipe files must be valid');
    await withBrowser(async (page, [live], startStatic) => {
      try {
        await smoke(page, live, 'live', recipes);
        const staticOrigin = await startStatic();
        await smoke(page, staticOrigin, 'static', recipes);
      } catch (error) {
        await page.screenshot(join(ROOT, '.smoke', 'failure.png')).catch(() => {});
        throw error;
      }
    }, opts);
    console.log('PASS: smoke checks complete; no console errors or uncaught exceptions.');
  }
} catch (error) { console.error(`FAIL: ${error.message}`); process.exitCode = 1; }
