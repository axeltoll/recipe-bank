// Static checks on the public site (site/): page basics, links, the brand definition, the facts quoted
// from recipes, and the preview server's path handling. No browser: layout and rendering are not covered here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile, readdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { SHOWCASE_IDS } from '../scripts/build-site-data.mjs';
import { resolveSitePath, SITE_ROOT, TYPES } from '../scripts/serve-site.mjs';
import { PALETTES } from '../site/js/hero.js';

const ROOT = resolve(import.meta.dirname, '..');
const SITE = join(ROOT, 'site');
const PAGES = ['index.html', 'self-hosting.html', 'changelog.html', '404.html'];
const read = (rel) => readFile(join(SITE, rel), 'utf8');
const exists = (file) => access(file).then(() => true, () => false);
const idsOf = (html) => [...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);

test('every page has the basics: language, viewport, title, description, one h1, a skip link', async () => {
  for (const page of PAGES) {
    const html = await read(page);
    assert.match(html, /^<!doctype html>\n<html lang="en"/, page);
    assert.match(html, /<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">/, page);
    assert.doesNotMatch(html, /user-scalable|maximum-scale/, `${page} must not block zoom`);
    assert.match(html, /<title>[^<]{10,}<\/title>/, page);
    assert.match(html, /<meta name="description" content="[^"]{20,}">/, page);
    assert.match(html, /<link rel="icon" href="\/?assets\/favicon\.svg"/, page);
    assert.equal((html.match(/<h1[\s>]/g) ?? []).length, 1, `${page}: exactly one h1`);
    assert.match(html, /<a class="skip-link" href="#main">/, page);
    assert.match(html, /<main id="main">/, page);
    assert.match(html, /<footer class="site-footer"/, page);
  }
});

test('page copy uses no em or en dashes', async () => {
  for (const page of PAGES) {
    assert.doesNotMatch(await read(page), /[–—]|&mdash;|&ndash;|&#8211;|&#8212;|&#x2013;|&#x2014;/i, page);
  }
});

test('ids are unique and every reference to an id resolves', async () => {
  for (const page of PAGES) {
    const html = await read(page);
    const ids = idsOf(html);
    assert.equal(new Set(ids).size, ids.length, `${page}: duplicate id in ${ids.join(' ')}`);
    for (const m of html.matchAll(/\shref="#([^"]+)"/g)) assert.ok(ids.includes(m[1]), `${page}: #${m[1]}`);
    for (const m of html.matchAll(/\s(?:aria-labelledby|aria-controls|for|data-copy-from)="([^"]+)"/g)) {
      assert.ok(ids.includes(m[1]), `${page}: ${m[0].trim()}`);
    }
  }
});

test('local links, scripts and styles point at files that exist, and at ids that exist in them', async () => {
  for (const page of PAGES) {
    const html = await read(page);
    for (const m of html.matchAll(/\s(?:href|src)="([^"]+)"/g)) {
      const url = m[1];
      if (/^(https?:|#|mailto:|data:)/.test(url)) continue;
      const [path, hash] = url.split('#');
      assert.ok(await exists(join(SITE, path)), `${page}: ${url} does not exist`);
      if (hash) assert.ok(idsOf(await read(path)).includes(hash), `${page}: ${url} has no such id`);
    }
  }
});

test('site scripts import only their own files, plus three.js through the import map', async () => {
  const dir = join(SITE, 'js');
  for (const name of (await readdir(dir)).filter((f) => f.endsWith('.js'))) {
    const src = await readFile(join(dir, name), 'utf8');
    for (const m of src.matchAll(/(?:\bfrom|\bimport)\s*\(?\s*['"]([^'"]+)['"]/g)) {
      const spec = m[1];
      if (spec.startsWith('.')) assert.ok(await exists(join(dirname(join(dir, name)), spec)), `${name}: ${spec}`);
      else assert.equal(spec, 'three', `${name} imports ${spec}`);
    }
  }
});

test('the pages match site/brand.json', async () => {
  const brand = JSON.parse(await read('brand.json'));
  const index = await read('index.html');
  const css = await read('css/site.css');

  assert.ok(index.includes(`<title>${brand.title}</title>`));
  assert.ok(index.includes(`<script type="importmap">{"imports":{"three":"${brand.three_url}"}}</script>`));
  assert.ok(index.indexOf('type="importmap"') < index.indexOf('type="module"'), 'the import map must come first');
  assert.ok(index.includes(`href="${brand.fonts.google_fonts_url}"`));

  for (const theme of ['light', 'dark']) {
    for (const [name, value] of Object.entries(brand.colors[theme])) {
      assert.ok(css.includes(value), `${theme}.${name} ${value} is not in site.css`);
    }
    assert.deepEqual(PALETTES[theme], brand.palette_3d[theme], `hero palette, ${theme}`);
    assert.ok(css.includes(`--tile: ${brand.palette_3d[theme].tile};`), `--tile, ${theme}`);
  }
  for (const file of ['js/theme.js', 'js/main.js']) {
    assert.ok((await read(file)).includes(`'${brand.theme_storage_key}'`), file);
  }
});

test('the dark theme is the same with and without JavaScript', async () => {
  const css = await read('css/site.css');
  const block = (re) => css.match(re)?.[1].split(';').map((d) => d.trim()).filter(Boolean);
  const scripted = block(/:root\[data-theme='dark'\] \{([^}]*)\}/);
  const system = block(/:root:not\(\[data-theme\]\) \{([^}]*)\}/);
  assert.ok(scripted?.length > 10);
  assert.deepEqual(system, scripted);
});

test('the primary action is the same everywhere and leads to the repository', async () => {
  const brand = JSON.parse(await read('brand.json'));
  const index = await read('index.html');
  const tags = [...index.matchAll(/<a\b[^>]*data-cta="primary"[^>]*>/g)].map((m) => m[0]);
  assert.ok(tags.length >= 4, 'hero, self-hosting, close and the sticky bar');
  for (const tag of tags) assert.ok(tag.includes(`href="${brand.primary_cta.href}"`), tag);
  assert.equal(index.split(`<span>${brand.primary_cta.label}</span>`).length - 1, tags.length);
  assert.equal(brand.primary_cta.href, brand.repo_url);
  assert.ok(index.includes(`<h1 id="hero-title">Turn any recipe video into <em>exact ingredients and steps.</em></h1>`));
});

test('amounts quoted on the home page are the amounts in the recipe files', async () => {
  const index = await read('index.html');
  const examples = [...index.matchAll(/data-example="([^"|]+)\|([^"|]+)\|([^"|]*)\|([^"|]+)"/g)];
  assert.equal(examples.length, 4);
  for (const [, id, item, amount, basis] of examples) {
    assert.ok(SHOWCASE_IDS.includes(id), `${id} is not one of the showcased recipes`);
    const recipe = JSON.parse(await readFile(join(ROOT, 'recipes', `${id}.json`), 'utf8'));
    const found = recipe.components.flatMap((c) => c.ingredients).find((i) => i.item === item);
    assert.ok(found, `${id}: no ingredient "${item}"`);
    assert.equal(found.amount ?? '', amount, `${id}: ${item}`);
    assert.equal(found.basis, basis, `${id}: ${item}`);
  }
  assert.equal(SHOWCASE_IDS.length, 3);
  assert.match(index, /Three recipes from the repository/);
});

test('the preview server only serves files inside site/', () => {
  assert.equal(resolveSitePath('/'), join(SITE_ROOT, 'index.html'));
  assert.equal(resolveSitePath('/js/main.js'), join(SITE_ROOT, 'js', 'main.js'));
  assert.equal(resolveSitePath('/self-hosting.html'), join(SITE_ROOT, 'self-hosting.html'));
  assert.equal(resolveSitePath('/../package.json'), null);
  assert.equal(resolveSitePath('/%2e%2e/%2e%2e/etc/passwd'), null);
  assert.equal(resolveSitePath('/%E0%A4%A'), null, 'malformed escape');
  assert.equal(resolveSitePath('/a%00b'), null, 'NUL byte');
  assert.equal(SITE_ROOT, SITE);
  assert.match(TYPES['.js'], /^text\/javascript/);
  assert.match(TYPES['.svg'], /^image\/svg\+xml/);
});
