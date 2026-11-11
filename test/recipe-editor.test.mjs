// Static checks on the browser module and its stylesheet (there is no DOM in node:test).
// The form logic itself is tested in draft.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (p) => readFile(new URL(`../public/features/${p}`, import.meta.url), 'utf8');

test('the editor module exports mount, emits its events and imports only shared lib modules and the shared feature helpers', async () => {
  const src = await read('recipe-editor.mjs');
  assert.match(src, /export function mount\(element, \{ recipe, video, readOnly = STATIC, recipes \} = \{\}\)/);
  assert.match(src, /'recipe-bank:recipe-saved'/);
  assert.match(src, /'recipe-bank:editor-cancel'/);
  const imports = [...src.matchAll(/^(?:import .*|\}) from '([^']+)'/gm)].map((m) => m[1]);
  // One helper module for every feature module (public/features/shared.mjs), plus lib/. Relative paths, like the
  // other feature modules, so the module also imports in Node (test/feature-installers.test.mjs).
  assert.deepEqual(imports.sort(), ['../../lib/draft.mjs', '../../lib/video.mjs', './shared.mjs']);
  assert.doesNotMatch(src, /localStorage|sessionStorage/);
  assert.doesNotMatch(src, /the creator held details back/i);
});

test('the editor saves only through the recipe API', async () => {
  const src = await read('recipe-editor.mjs');
  const urls = [...src.matchAll(/fetch\((.+?), \{/g)].map((m) => m[1].trim());
  assert.deepEqual(urls, [
    "STATIC ? '/api/recipes.json' : '/api/recipes'",
    "created ? '/api/recipes' : `/api/recipes/${encodeURIComponent(draft.original.id)}`",
  ]);
});

test('the stylesheet takes colour and spacing only from custom properties with fallbacks', async () => {
  const css = (await read('recipe-editor.css')).replace(/\/\*[\s\S]*?\*\//g, '');
  for (const line of css.split('\n')) {
    const l = line.trim();
    if (l.startsWith('--')) {
      assert.match(l, /^--[\w-]+: var\(--[\w-]+, .+\);$/, `custom property without a fallback: ${l}`);
      continue;
    }
    assert.doesNotMatch(l, /#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i, `literal colour: ${l}`);
    const m = l.match(/^(margin|padding|gap|row-gap|column-gap)(-[a-z-]+)?\s*:\s*(.+);$/);
    if (m) {
      const rest = m[3].replace(/var\([^()]*\)/g, '').replace(/env\([^()]*\)/g, '');
      assert.doesNotMatch(rest, /\d*\.?\d+(px|rem|em|%)/, `literal spacing: ${l}`);
    }
  }
});

test('the editor documentation exists and names the events', async () => {
  const md = await read('EDITOR.md');
  for (const s of ['recipe-bank:recipe-saved', 'recipe-bank:editor-cancel', 'POST /api/recipes', 'PUT /api/recipes/<id>', 'readOnly']) {
    assert.ok(md.includes(s), s);
  }
});
