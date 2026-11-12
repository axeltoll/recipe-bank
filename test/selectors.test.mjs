// The browser checks (scripts/smoke.mjs, scripts/device-check.mjs) can only run with Chrome, so this file checks
// without a browser that every id, class and data attribute their selectors name is rendered by the dashboard.
// After a redesign it fails here first, pointing at scripts/browser/selectors.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { SELECTORS, PAGES, TEXT } from '../scripts/browser/selectors.mjs';

const PUBLIC = resolve(import.meta.dirname, '..', 'public');
let markup = await readFile(join(PUBLIC, 'index.html'), 'utf8');
for (const dir of ['', 'ui', 'features']) {
  for (const f of await readdir(join(PUBLIC, dir))) {
    if (/\.(m?js)$/.test(f)) markup += `\n${await readFile(join(PUBLIC, dir, f), 'utf8')}`;
  }
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const word = (s) => `(?<![\\w-])${escapeRe(s)}(?![\\w-])`;
const hasClass = (cls) => new RegExp(`class="[^"]*${word(cls)}[^"]*"|className = '[^']*${word(cls)}|classList\\.add\\('${escapeRe(cls)}'\\)`).test(markup);

/** The ids, classes and data attributes a CSS selector names. */
function parts(selector) {
  const noAttrs = selector.replace(/\[[^\]]*\]/g, ' ');
  return {
    ids: [...noAttrs.matchAll(/#([\w-]+)/g)].map((m) => m[1]),
    classes: [...noAttrs.matchAll(/\.([\w-]+)/g)].map((m) => m[1]),
    attrs: [...selector.matchAll(/\[(data-[\w-]+)/g)].map((m) => m[1]),
  };
}

// The feature installers, one source each, so a route registration is matched within the file that makes it.
const FEATURES = join(PUBLIC, 'features');
const featureFiles = await Promise.all((await readdir(FEATURES)).filter((f) => /\.m?js$/.test(f))
  .map((f) => readFile(join(FEATURES, f), 'utf8')));

/** True when a file registers `route`: addRoute('route' / "route", or addRoute(ROUTE with const ROUTE = 'route'. */
function registered(sources, route) {
  const name = escapeRe(route);
  return sources.some((src) => new RegExp(`addRoute\\((['"])${name}\\1`).test(src)
    || (new RegExp(`\\bconst ROUTE = (['"])${name}\\1`).test(src) && /addRoute\(ROUTE\b/.test(src)));
}

test('the route check needs the named route, not any addRoute(ROUTE', () => {
  const plan = "const ROUTE = 'plan';\nrb.addRoute(ROUTE, {});";
  assert.ok(registered([plan], 'plan'));
  assert.ok(!registered([plan], 'household'), 'another file\'s ROUTE does not register household');
  assert.ok(registered(["rb.addRoute('new', {})"], 'new'));
  assert.ok(registered(['rb.addRoute("new", {})'], 'new'));
  assert.ok(!registered(["rb.addRoute('newer', {})"], 'new'));
  assert.ok(!registered(["const ROUTE = 'packs';"], 'packs'), 'a ROUTE constant alone does not register it');
});

const staticSelectors = Object.entries(SELECTORS).filter(([, v]) => typeof v === 'string');
const sample = { card: SELECTORS.card('gochujang-chicken-thighs'), chip: SELECTORS.chip('chicken'), timestampAt: SELECTORS.timestampAt(17) };

test('every selector the browser checks use names something the dashboard renders', () => {
  assert.ok(staticSelectors.length > 25);
  for (const [name, selector] of [...staticSelectors, ...Object.entries(sample)]) {
    const { ids, classes, attrs } = parts(selector);
    for (const id of ids) assert.ok(markup.includes(`id="${id}"`), `${name}: #${id} is never rendered`);
    for (const cls of classes) assert.ok(hasClass(cls), `${name}: .${cls} is never rendered`);
    for (const attr of attrs) assert.ok(markup.includes(attr), `${name}: [${attr}] is never rendered`);
  }
});

test('the copy the checks read back is still in the views', async () => {
  const add = await readFile(join(PUBLIC, 'ui', 'add.js'), 'utf8');
  assert.ok(add.includes(`'${TEXT.unsupportedLink}'`), 'public/ui/add.js still says TEXT.unsupportedLink');
  const smoke = await readFile(resolve(PUBLIC, '..', 'scripts', 'smoke.mjs'), 'utf8');
  assert.ok(!smoke.includes(TEXT.unsupportedLink), 'scripts/smoke.mjs reads the text from TEXT, not a copy');
});

test('parameterised selectors match the hashes and attributes the views write', () => {
  assert.equal(SELECTORS.card('a b'), '#grid .card-link[href="#/r/a%20b"]');
  assert.equal(SELECTORS.chip('chicken stock'), '#chips .chip[data-key="chicken stock"]');
  assert.equal(SELECTORS.timestampAt(17), 'button.ts[data-t="17"]');
});

test('the device check measures home, a recipe and every feature route', () => {
  assert.deepEqual(PAGES.map(([name]) => name), ['home', 'recipe', 'plan', 'household', 'packs', 'editor']);
  assert.equal(PAGES[1][1]('banana-milk'), '#/r/banana-milk');
  for (const route of ['plan', 'household', 'packs', 'new']) {
    assert.ok(registered(featureFiles, route), `#/${route} is registered`);
  }
});
