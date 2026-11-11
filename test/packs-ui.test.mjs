// The packs panel's pure renderers. Importing the module must not touch the DOM.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { renderPicker, renderPlan, esc, mount } from '../public/features/packs.mjs';
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
