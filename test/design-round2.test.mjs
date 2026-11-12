// Round 2 of the design (docs/design/ROUND2.md), checked the same way as round 1: by reading the files.
// test/design.test.mjs keeps guarding the contract; this file guards what round 2 added to it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { BREAKPOINTS } from '../lib/nav.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const PUBLIC = join(ROOT, 'public');
const FEATURES = join(PUBLIC, 'features');
const read = (...parts) => readFile(join(ROOT, ...parts), 'utf8');
const noComments = (source) => source.replace(/\/\*[\s\S]*?\*\//g, '');

const css = await read('public', 'styles.css');
const html = await read('public', 'index.html');
const mountDoc = await read('docs', 'design', 'MOUNT-POINTS.md');
const designDoc = await read('docs', 'design', 'DESIGN.md');

const featureCss = new Map();
for (const f of (await readdir(FEATURES)).filter((name) => name.endsWith('.css'))) {
  featureCss.set(f, noComments(await readFile(join(FEATURES, f), 'utf8')));
}
const scripts = new Map();
for (const dir of ['', 'ui', 'features']) {
  for (const f of await readdir(join(PUBLIC, dir))) {
    if (f.endsWith('.js')) scripts.set(join(dir, f), await read('public', dir, f));
  }
}
const allJs = [...scripts.values()].join('\n');

/** The text between the braces that follow the first occurrence of `selector {`. */
function block(source, selector) {
  const start = source.indexOf(`${selector} {`);
  assert.ok(start >= 0, `no rule for ${selector}`);
  const open = source.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}' && --depth === 0) return source.slice(open + 1, i);
  }
  throw new Error(`unbalanced braces after ${selector}`);
}
function declarations(body) {
  const map = new Map();
  for (const m of body.matchAll(/([a-z0-9-]+)\s*:\s*([^;]+);/g)) map.set(m[1], m[2].trim().replace(/\s+/g, ' '));
  return map;
}
const light = declarations(block(css, ':root'));
const darkSystem = declarations(block(css, ":root:not([data-theme='light'])"));
const darkChosen = declarations(block(css, ":root[data-theme='dark']"));

function luminance(hex) {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  assert.ok(m, `${hex} is not a 6-digit hex colour`);
  const [r, g, b] = [0, 2, 4].map((i) => {
    const c = parseInt(m[1].slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

// ---------- tokens ----------

test('round 2 tokens exist, in the light theme and in both dark palettes', () => {
  for (const name of ['--accent-strong', '--measure-text', '--head-h', '--nav-h', '--tap-lg', '--stagger']) {
    assert.ok(light.has(name), `${name} is not defined on :root`);
  }
  assert.equal(light.get('--measure-text'), '60ch');
  assert.equal(light.get('--tap-lg'), '56px');
  assert.ok(darkSystem.has('--accent-strong') && darkChosen.has('--accent-strong'));
  for (const name of ['--accent-strong', '--measure-text', '--head-h', '--tap-lg']) {
    assert.ok(designDoc.includes(`\`${name}\``), `${name} is not in DESIGN.md`);
  }
});

// The pairs the brief named (muted, ok, warn) keep a margin over AA, and so do the pairs round 2 introduced.
// --muted on --surface-3 is left out on purpose: the contract forbids that pairing (DESIGN.md, Colour).
const MARGIN_PAIRS = [
  ['--muted', '--bg'], ['--muted', '--surface'], ['--muted', '--surface-2'],
  ['--ok', '--ok-soft'], ['--ok', '--surface'], ['--warn', '--warn-soft'], ['--warn', '--surface'],
];
const AA_PAIRS = [['--accent-ink', '--accent-strong'], ['--danger', '--bg']];

for (const [themeName, theme] of [['light', light], ['dark', new Map([...light, ...darkChosen])]]) {
  test(`${themeName} theme: muted, ok and warn text keep a margin (5:1); the hover fill and danger text meet AA`, () => {
    for (const [fg, bg] of MARGIN_PAIRS) {
      const ratio = contrast(theme.get(fg), theme.get(bg));
      assert.ok(ratio >= 5, `${fg} on ${bg} is ${ratio.toFixed(2)}:1`);
    }
    for (const [fg, bg] of AA_PAIRS) {
      const ratio = contrast(theme.get(fg), theme.get(bg));
      assert.ok(ratio >= 4.5, `${fg} on ${bg} is ${ratio.toFixed(2)}:1`);
    }
  });
}

test('no rule in the dashboard stylesheet puts muted text on --surface-3', () => {
  for (const m of noComments(css).matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const body = m[2];
    if (!/background(?:-color)?:\s*var\(--surface-3\)/.test(body)) continue;
    assert.doesNotMatch(body, /(?:^|[;\s])color:\s*var\(--muted\)/, `muted text on --surface-3 in ${m[1].trim()}`);
  }
});

// ---------- layout ----------

test('running text is capped with --measure-text', () => {
  for (const selector of ['.recipe-summary', '.step-text', '.callout p', '.callout ul', '.source', '.feature-head p', '.feature-note', '.footer-note']) {
    assert.match(block(css, selector), /max-width:\s*var\(--measure-text\)/, `${selector} has no measure`);
  }
  assert.doesNotMatch(noComments(css), /var\(--measure\)/, '--measure is only the named outer cap; text uses --measure-text');
});

test('below desktop the header collapses to its nav row, and sticky offsets use --head-h', () => {
  // Under a notch the safe-area padding scrolls away with the brand row, and the stuck nav row carries the inset.
  assert.match(block(css, '.topbar'), /top:\s*calc\(-1 \* \(var\(--bar-h\) \+ env\(safe-area-inset-top, 0px\)\)\)/);
  assert.match(block(css, '.topbar'), /padding-top:\s*env\(safe-area-inset-top\)/);
  assert.match(block(css, '.nav'), /min-height:\s*var\(--nav-h\)/);
  assert.match(block(css, '.nav'), /padding-top:\s*env\(safe-area-inset-top, 0px\)/);
  assert.match(light.get('--head-h'), /^calc\(48px \+ env\(safe-area-inset-top, 0px\)\)$/, 'the part that stays includes the inset');
  assert.match(css, /--head-h:\s*calc\(64px \+ env\(safe-area-inset-top, 0px\)\)/);
  assert.match(block(css, '.brand'), /min-height:\s*var\(--bar-h\)/);
  assert.match(block(css, 'html'), /scroll-padding-top:\s*calc\(var\(--head-h\)/);
  const sticky = [...noComments(css).matchAll(/position:\s*sticky;\s*top:\s*([^;]+);/g)].map((m) => m[1]);
  assert.ok(sticky.length >= 3, `only ${sticky.length} sticky offsets were found`);
  for (const top of sticky) assert.match(top, /--head-h|--bar-h|^0$/, `sticky offset ${top}`);
  assert.equal(sticky.filter((top) => /--bar-h/.test(top)).length, 1, 'only the header itself is offset by --bar-h');
});

test('links that the device check measures get a 44px box', () => {
  const card = block(css, '.card-link');
  assert.match(card, /padding-block:\s*10px/);
  assert.match(card, /margin-block:\s*-10px/, 'the padding is cancelled, so the layout does not move');
  assert.match(block(css, '.q-title a'), /padding-block:\s*11px/);
  assert.match(block(css, '.recipe-by a, .feature-head p a, .feature-note a, .scale-household a'), /min-height:\s*var\(--tap\)/);
  assert.match(featureCss.get('week-plan.css'), /\.rbf-planned a \{[^}]*min-height:\s*var\(--_tap\)/);
  assert.match(featureCss.get('shopping-list.css'), /\.rbf-for a \{[^}]*min-height:\s*var\(--_tap\)/);
  assert.match(featureCss.get('filters.css'), /\.rbf-chip \{[^}]*min-height:\s*var\(--_tap\)/);
  assert.match(featureCss.get('household.css'), /summary \{[^}]*min-height:\s*var\(--_tap\)/);
  assert.match(featureCss.get('budget.css'), /summary \{[^}]*min-height:\s*var\(--_tap\)/);
  assert.match(featureCss.get('recipe-editor.css'), /\.re-status a \{[^}]*min-height:\s*var\(--re-target\)/);
});

test('nothing in a feature module can set the page width', () => {
  assert.match(featureCss.get('week-plan.css'), /\.rbf-week select \{[^}]*width:\s*100%;[^}]*min-width:\s*0;/);
  assert.match(featureCss.get('recipe-editor.css'), /\.re-footer > \* \{ min-width: 0; \}/);
  assert.match(featureCss.get('budget.css'), /\.rb-budget-scroll \{[^}]*overflow-x:\s*auto/);
});

test('reduced motion also removes delays; more contrast and forced colours are handled', () => {
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{[^}]*animation-delay:\s*0s !important/);
  assert.match(css, /@media \(prefers-contrast: more\)/);
  assert.match(css, /@media \(forced-colors: active\)/);
  assert.match(css, /\.grid-enter > \.card \{[^}]*animation:\s*card-in/);
  assert.match(scripts.get(join('ui', 'home.js')), /classList\.toggle\('grid-enter', enterGrid\)/, 'only the first draw animates');
});

// ---------- feature modules ----------

test('feature stylesheets take every colour from a token: a literal is only ever a fallback inside var()', () => {
  assert.equal(featureCss.size, 8);
  for (const [file, source] of featureCss) {
    const literals = source.match(/#[0-9a-f]{3,8}\b/gi) ?? [];
    const fallbacks = source.match(/var\(--[\w-]+,\s*#[0-9a-f]{3,8}\)/gi) ?? [];
    assert.equal(literals.length, fallbacks.length, `${file}: a hex colour outside a var() fallback`);
    assert.doesNotMatch(source, /\brgba?\(|\bhsla?\(/i, `${file}: a literal colour function`);
  }
});

test('feature stylesheets never dim text with opacity (only disabled controls and the loading pulse)', () => {
  for (const [file, source] of featureCss) {
    for (const m of source.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      if (!/(?:^|[;\s])opacity\s*:/.test(m[2])) continue;
      const selector = m[1].trim();
      assert.match(selector, /:disabled|^\d+%$/, `${file}: opacity on ${selector}`);
    }
  }
});

test('feature stylesheets are mobile-first on the contract breakpoints', () => {
  const allowed = Object.values(BREAKPOINTS);
  for (const [file, source] of featureCss) {
    assert.doesNotMatch(source, /@media[^{]*max-width/, `${file}: a max-width media query`);
    for (const m of source.matchAll(/@media[^{]*\(min-width:\s*(\d+)px\)/g)) {
      assert.ok(allowed.includes(Number(m[1])), `${file}: ${m[1]}px is not a contract breakpoint`);
    }
  }
});

test('every feature module shows errors as the danger block and has a focus ring from the focus token', () => {
  assert.match(featureCss.get('household.css'), /\.rb-feature-errors \{[^}]*background:\s*var\(--_danger-soft\)/);
  assert.match(featureCss.get('budget.css'), /\.rb-budget-warning \{[^}]*background:\s*var\(--_danger-soft\)/);
  assert.match(featureCss.get('packs.css'), /\.pk-error \{[^}]*background:\s*var\(--pk-danger-soft\)/);
  for (const [file, source] of featureCss) {
    assert.match(source, /:focus-visible[^{]*\{[^}]*outline:\s*2px solid var\(--(?:_focus|pk-focus|re-focus)\)/, `${file}: focus ring`);
  }
});

// ---------- markup ----------

test('index.html carries a skeleton for the list and one for a detail page, and picks by the address', () => {
  assert.match(html, /class="home skel-list"/);
  assert.match(html, /class="recipe skel skel-detail"/);
  assert.match(html, /dataset\.boot = 'detail'/);
  assert.match(css, /:root:not\(\[data-boot='detail'\]\) \.skel-detail \{ display: none; \}/);
  assert.match(css, /\[data-boot='detail'\] \.skel-list \{ display: none; \}/);
  assert.match(html, /id="open-add"[^>]*>\s*<svg[\s\S]*?<span class="label-wide">Add video<\/span>/);
});

test('cook mode: what you press while cooking is in the foot; the wake switch is a labelled switch', () => {
  const cook = scripts.get(join('ui', 'cook.js'));
  const bar = cook.indexOf('class="cook-bar"');
  const body = cook.indexOf('class="cook-body"');
  const foot = cook.indexOf('class="cook-foot"');
  assert.ok(bar > 0 && body > bar && foot > body);
  for (const id of ['cook-ing-toggle', 'cook-watch', 'cook-prev', 'cook-next']) {
    assert.ok(cook.indexOf(`id="${id}"`) > foot, `#${id} is not in the foot`);
  }
  const wake = cook.indexOf('id="cook-wake-on"');
  assert.ok(wake > bar && wake < body, 'the wake switch is in the top bar');
  assert.match(cook, /<label class="switch" for="cook-wake-on">\s*<input type="checkbox" role="switch" id="cook-wake-on"/);
  assert.match(cook, /store\.set\(WAKE_KEY, on\)/, 'the choice is remembered');
  assert.match(cook, /releaseWake\(\);\s*sayWake\(''\);/, 'switching off releases the lock');
  assert.match(block(css, '.cook-text'), /font:[^;]*var\(--text-cook\)/);
});

test('the recipe page: one-row action bar on phones, Edit in the head, timers beside the timestamps', () => {
  const recipe = scripts.get(join('ui', 'recipe.js'));
  const actions = recipe.slice(recipe.indexOf('class="recipe-actions"'), recipe.indexOf('class="recipe-media"'));
  assert.doesNotMatch(actions, /recipe-edit/, 'Edit is not in the action bar');
  assert.match(recipe, /class="recipe-top">[\s\S]*?class="btn btn-quiet recipe-edit"/);
  assert.match(actions, /id="copy-list">\$\{icon\('copy'\)\}<span class="label-wide">Copy list<\/span>/);
  assert.match(block(css, '.recipe-actions .btn:not(.btn-primary)'), /width:\s*var\(--tap\)/);
  assert.match(recipe, /class="step-tools">[\s\S]*?timerChips\(/);
  assert.match(scripts.get(join('features', 'plan-feature.js')), /rb\.icon\('week'\)\}<span class="label-wide">Add to week<\/span>/);
});

test('the theme button cycles device, light and dark; the list view and the wake choice use the safe store', () => {
  const theme = scripts.get(join('ui', 'theme.js'));
  assert.match(theme, /const ORDER = \['system', 'light', 'dark'\];/);
  assert.match(theme, /store\.remove\('rb:theme'\)/, '"same as the device" stores nothing');
  assert.match(html, /t === 'light' \|\| t === 'dark'/, 'index.html applies only a stored light or dark');
  assert.match(scripts.get(join('ui', 'home.js')), /store\.set\(VIEW_KEY, listMode \? 'list' : 'grid'\)/);
  assert.doesNotMatch(allJs.replace(scripts.get(join('ui', 'core.js')), ''), /localStorage\.(?:get|set|remove)Item/, 'views go through store');
});

// ---------- icons ----------

test('every icon a script asks for is drawn inline, and every icon is documented for features', () => {
  const core = scripts.get(join('ui', 'core.js'));
  const start = core.indexOf('const ICONS = {');
  const names = [...core.slice(start, core.indexOf('\n};', start)).matchAll(/^\s{2}([a-z]+): '/gm)].map((m) => m[1]);
  assert.ok(names.length >= 23, `only ${names.length} icons were found`);
  for (const name of names) assert.ok(mountDoc.includes(`\`${name}\``), `icon "${name}" is not in MOUNT-POINTS.md`);

  const used = new Set([...allJs.matchAll(/\bicon\('([a-z]+)'\)/g)].map((m) => m[1]));
  for (const name of ['auto', 'sun', 'moon']) used.add(name); // ui/theme.js picks these from a map
  assert.match(scripts.get(join('ui', 'theme.js')), /const ICON = \{ system: 'auto', light: 'sun', dark: 'moon' \};/);
  assert.ok(used.size > 15);
  for (const name of used) assert.ok(names.includes(name), `icon('${name}') has no drawing`);

  assert.doesNotMatch(html + css, /font-awesome|material-icons|icon-?font|@font-face/i, 'no icon font');
});
