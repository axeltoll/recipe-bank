// Static checks on the dashboard: there is no browser in CI, so these read the files and verify that the design
// contract (docs/design/DESIGN.md), the mount-point contract (docs/design/MOUNT-POINTS.md) and the module wiring hold.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile, readdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { MOUNTS, REPEATED_MOUNTS, EVENTS } from '../lib/hub.mjs';
import { BREAKPOINTS } from '../lib/nav.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const PUBLIC = join(ROOT, 'public');
const read = (...parts) => readFile(join(ROOT, ...parts), 'utf8');
const exists = (path) => access(path).then(() => true, () => false);

const css = await read('public', 'styles.css');
const html = await read('public', 'index.html');
const mountDoc = await read('docs', 'design', 'MOUNT-POINTS.md');

// Every script the browser loads from public/: path relative to public/ → source.
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

/** Declarations of a rule body as a Map of property → value. */
function declarations(body) {
  const map = new Map();
  for (const m of body.matchAll(/([a-z0-9-]+)\s*:\s*([^;]+);/g)) map.set(m[1], m[2].trim().replace(/\s+/g, ' '));
  return map;
}

const light = declarations(block(css, ':root'));
const darkSystem = declarations(block(css, ":root:not([data-theme='light'])"));
const darkChosen = declarations(block(css, ":root[data-theme='dark']"));

// Raw colours are allowed only where tokens are defined: the light rule, the two dark rules and the print palette.
const PALETTE_RULES = [
  ':root',
  ":root:not([data-theme='light'])",
  ":root[data-theme='dark']",
  ":root, :root[data-theme], :root:not([data-theme='light'])",
];
const componentCss = PALETTE_RULES.reduce((rest, selector) => rest.replace(block(css, selector), ''), css);

// ---------- tokens ----------

test('the light theme defines every token the contract names', () => {
  const required = [
    '--bg', '--surface', '--surface-2', '--surface-3', '--ink', '--ink-2', '--muted', '--line', '--line-strong',
    '--accent', '--accent-ink', '--accent-text', '--accent-soft', '--ok', '--ok-soft', '--warn', '--warn-soft',
    '--info', '--info-soft', '--danger', '--danger-soft', '--focus', '--stage', '--scrim',
    '--shadow-1', '--shadow-2', '--shadow-3',
    '--font-display', '--font-body', '--text-xs', '--text-sm', '--text-md', '--text-lg', '--text-xl', '--text-2xl',
    '--text-3xl', '--text-cook', '--lh-tight', '--lh-snug', '--lh-body', '--measure',
    '--s-1', '--s-2', '--s-3', '--s-4', '--s-5', '--s-6', '--s-7', '--s-8',
    '--r-sm', '--r-md', '--r-lg', '--r-pill', '--dur-1', '--dur-2', '--dur-3', '--ease',
    '--z-bar', '--z-sheet', '--z-toast', '--tap', '--gutter', '--content-max', '--bar-h',
  ];
  for (const name of required) assert.ok(light.has(name), `${name} is not defined on :root`);
  assert.equal(light.get('--tap'), '44px');
  assert.equal(light.get('--text-md'), '1rem', 'inputs and body stay at 16px');
  assert.equal(light.get('--measure'), '72ch');
  assert.equal(light.get('color-scheme'), 'light');
});

test('the two dark palettes (system preference and the toggle) are identical and only override light tokens', () => {
  assert.deepEqual([...darkSystem], [...darkChosen]);
  assert.equal(darkChosen.get('color-scheme'), 'dark');
  assert.ok(darkChosen.size > 20);
  for (const name of darkChosen.keys()) assert.ok(light.has(name), `${name} has no light value`);
});

test('every custom property used in the stylesheet is defined', () => {
  const defined = new Set([...css.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((m) => m[1]));
  const used = new Set([...css.matchAll(/var\(\s*(--[a-z0-9-]+)/g)].map((m) => m[1]));
  assert.ok(used.size > 40);
  for (const name of used) assert.ok(defined.has(name), `${name} is used but never defined`);
});

test('component rules use tokens, not raw colours', () => {
  assert.ok(componentCss.length < css.length);
  const raw = componentCss.match(/#[0-9a-f]{3,8}\b|rgba?\(/gi) ?? [];
  assert.deepEqual(raw, []);
});

// ---------- contrast (WCAG 2 relative luminance) ----------

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

test('the contrast formula matches known values', () => {
  assert.equal(Math.round(contrast('#000000', '#ffffff')), 21);
  assert.equal(contrast('#777777', '#777777'), 1);
  assert.ok(Math.abs(contrast('#767676', '#ffffff') - 4.54) < 0.02);
});

const TEXT_PAIRS = [
  ['--ink', '--bg'], ['--ink', '--surface'], ['--ink-2', '--bg'], ['--ink-2', '--surface-2'],
  ['--muted', '--bg'], ['--muted', '--surface'], ['--muted', '--surface-2'], ['--muted', '--surface-3'],
  ['--accent-ink', '--accent'], ['--accent-text', '--accent-soft'], ['--accent-text', '--bg'], ['--accent-text', '--surface'],
  ['--ok', '--ok-soft'], ['--warn', '--warn-soft'], ['--info', '--info-soft'],
  ['--danger', '--danger-soft'], ['--danger', '--surface'],
  ['--bg', '--ink'],
];
const BOUNDARY_PAIRS = [['--line-strong', '--bg'], ['--line-strong', '--surface'], ['--focus', '--bg'], ['--focus', '--surface']];

for (const [themeName, theme] of [['light', light], ['dark', new Map([...light, ...darkChosen])]]) {
  test(`${themeName} theme: text pairs meet WCAG AA (4.5:1) and control boundaries meet 3:1`, () => {
    for (const [fg, bg] of TEXT_PAIRS) {
      const ratio = contrast(theme.get(fg), theme.get(bg));
      assert.ok(ratio >= 4.5, `${fg} on ${bg} is ${ratio.toFixed(2)}:1`);
    }
    for (const [fg, bg] of BOUNDARY_PAIRS) {
      const ratio = contrast(theme.get(fg), theme.get(bg));
      assert.ok(ratio >= 3, `${fg} on ${bg} is ${ratio.toFixed(2)}:1`);
    }
  });
}

// ---------- layout contract ----------

test('the stylesheet is mobile-first with exactly the contract breakpoints', () => {
  const widths = new Set([...css.matchAll(/@media[^{]*\(min-width:\s*(\d+)px\)/g)].map((m) => Number(m[1])));
  assert.deepEqual([...widths].sort((a, b) => a - b), Object.values(BREAKPOINTS));
  assert.doesNotMatch(css, /@media[^{]*max-width/, 'no max-width media queries: each step adds to the one below');
});

test('the shell paints to the edge and caps content with padding, not width', () => {
  assert.match(block(css, 'html'), /background:\s*var\(--bg\)/);
  assert.match(block(css, 'body'), /background:\s*transparent/);
  for (const selector of ['.topbar', 'main', '.footer']) {
    const body = block(css, selector);
    assert.doesNotMatch(body, /max-width/, `${selector} must not have a max-width`);
    assert.match(body, /padding-inline:[^;]*var\(--content-max\)/, `${selector} caps content with padding`);
    assert.match(body, /safe-area-inset-left/, `${selector} respects the side safe areas`);
  }
});

test('reduced motion, print, focus and safe areas are handled', () => {
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(css, /@media print/);
  assert.match(css, /:focus-visible\s*\{[^}]*outline:\s*2px solid var\(--focus\)/);
  assert.match(css, /env\(safe-area-inset-bottom\)/);
  assert.match(css, /env\(safe-area-inset-top\)/);
  assert.match(css, /\[hidden\]\s*\{\s*display:\s*none\s*!important/);
});

test('controls take their minimum size from the tap token', () => {
  for (const selector of ['.btn', '.chip', '.segmented button', '.search input', '.ing', '.ts', '.back', '.nav a', '.switch']) {
    assert.match(block(css, selector), /min-height:\s*var\(--tap\)/, `${selector} needs min-height: var(--tap)`);
  }
});

// ---------- index.html ----------

test('index.html keeps what the static build, phones and the modules rely on', () => {
  assert.ok(html.includes('<html lang="en">'), 'scripts/build-static.mjs replaces this exact tag');
  assert.match(html, /<meta name="viewport" content="[^"]*viewport-fit=cover/);
  assert.doesNotMatch(html, /user-scalable=no|maximum-scale/);
  assert.match(html, /<script type="module" src="\/app\.js"><\/script>/);
  assert.match(html, /<link rel="stylesheet" href="\/styles\.css">/);
  assert.match(html, /<main id="view" tabindex="-1"/);
  const hosts = [...html.matchAll(/(?:src|href)="(https?:\/\/[^/"]+)/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(hosts)].sort(), ['https://fonts.googleapis.com', 'https://fonts.gstatic.com'],
    'the only third-party hosts are the font ones the repo already used');
});

test('every element id the scripts and the stylesheet look up exists in the markup', () => {
  const defined = new Set([...`${html}\n${allJs}`.matchAll(/\bid="([a-z][a-z0-9-]*)"/g)].map((m) => m[1]));
  const fromJs = [...allJs.matchAll(/\$\(\s*['"`]#([a-z][a-z0-9-]*)/g)].map((m) => m[1]);
  const fromCss = [...componentCss.matchAll(/(?:^|[\s,>+~])#([a-z][a-z0-9-]*)/gm)].map((m) => m[1]);
  assert.ok(fromJs.length > 40);
  for (const id of new Set([...fromJs, ...fromCss])) assert.ok(defined.has(id), `#${id} is looked up but never rendered`);
});

// ---------- module wiring ----------

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function exportsName(source, name) {
  const n = escapeRe(name);
  return new RegExp(`export\\s+(?:async\\s+)?(?:const|let|function|class)\\s+${n}(?![\\w$])`).test(source)
    || new RegExp(`export\\s*\\{[^}]*(?<![\\w$])${n}(?![\\w$])[^}]*\\}`).test(source);
}

function resolveImport(spec, fromFile) {
  if (spec.startsWith('/lib/')) return join(ROOT, spec);
  if (spec.startsWith('/')) return join(PUBLIC, spec);
  if (spec.startsWith('.')) return join(PUBLIC, dirname(fromFile), spec);
  return null;
}

test('exportsName recognises the export forms the code uses', () => {
  const sample = 'export const $ = 1;\nexport const $$ = 2;\nexport async function load() {}\nexport { ingredientKeys };\nconst hidden = 1;';
  assert.equal(exportsName(sample, '$'), true);
  assert.equal(exportsName(sample, '$$'), true);
  assert.equal(exportsName(sample, 'load'), true);
  assert.equal(exportsName(sample, 'ingredientKeys'), true);
  assert.equal(exportsName(sample, 'hidden'), false);
  assert.equal(exportsName(sample, 'loa'), false);
});

test('every import in public/ resolves to a file that exports the imported names; there are no dependencies', async () => {
  let checked = 0;
  for (const [file, raw] of scripts) {
    const source = raw.replace(/^\s*\/\/.*$/gm, '');
    const imports = [
      ...[...source.matchAll(/\bimport\s*(?:\{([^}]*)\}\s*from\s*)?['"]([^'"]+)['"]/g)].map((m) => [m[2], m[1] ?? '']),
      ...[...source.matchAll(/\bimport\(\s*['"]([^'"]+)['"]\s*\)/g)].map((m) => [m[1], '']),
    ];
    for (const [spec, names] of imports) {
      const target = resolveImport(spec, file);
      assert.ok(target, `${file}: "${spec}" is a bare specifier; the dashboard has no dependencies`);
      assert.ok(await exists(target), `${file}: ${spec} does not exist`);
      const targetSource = await readFile(target, 'utf8');
      for (const name of names.split(',').map((n) => n.trim().split(/\s+as\s+/)[0]).filter(Boolean)) {
        assert.ok(exportsName(targetSource, name), `${file}: ${spec} does not export ${name}`);
        checked++;
      }
    }
  }
  assert.ok(checked > 60, `only ${checked} imported names were checked`);
});

test('the scripts keep the partial-recipe copy honest and avoid unsafe sinks', () => {
  // Partial can mean access failed, not that the creator withheld the method (see test/partial-copy.test.mjs).
  assert.doesNotMatch(allJs, /the creator held details back/i);
  // prompt() is the documented last-resort clipboard fallback and must stay the only one.
  assert.equal((allJs.match(/\bprompt\(/g) ?? []).length, 1);
  assert.doesNotMatch(allJs, /\beval\(|document\.write\(/);
});

// ---------- mount points ----------

test('every mount point is rendered and documented', () => {
  const markup = `${html}\n${allJs}`;
  for (const [name, id] of Object.entries(MOUNTS)) {
    assert.ok(markup.includes(`id="${id}"`), `mount "${name}": no element with id ${id}`);
    assert.ok(markup.includes(`data-mount="${name}"`), `mount "${name}": element lacks data-mount`);
    assert.ok(mountDoc.includes(`\`#${id}\``), `mount "${name}": #${id} is not in MOUNT-POINTS.md`);
    assert.ok(mountDoc.includes(`\`${name}\``), `mount "${name}" is not named in MOUNT-POINTS.md`);
  }
  for (const name of REPEATED_MOUNTS) {
    assert.ok(allJs.includes(`data-mount="${name}"`), `repeated mount "${name}" is not rendered`);
    assert.ok(mountDoc.includes(`[data-mount="${name}"]`), `repeated mount "${name}" is not in MOUNT-POINTS.md`);
  }
  assert.match(css, /\.mount:empty\s*\{\s*display:\s*none/);
});

test('every event is dispatched and documented', () => {
  for (const name of EVENTS) {
    assert.ok(allJs.includes(`emit('${name}'`), `rb:${name} is never dispatched`);
    assert.ok(mountDoc.includes(`\`rb:${name}\``), `rb:${name} is not in MOUNT-POINTS.md`);
  }
  const dispatched = new Set([...allJs.matchAll(/\bemit\('([a-z-]+)'/g)].map((m) => m[1]));
  assert.deepEqual([...dispatched].sort(), [...EVENTS].sort(), 'no undocumented events');
});

test('the rb API documented for features is what app.js hands out', async () => {
  const app = scripts.get('app.js');
  const members = [
    'version', 'isStatic', 'recipes', 'recipe', 'queue', 'filters', 'current', 'mount', 'mounts', 'on',
    'addFilter', 'refresh', 'addRoute', 'navigate', 'store', 'toast', 'copy', 'esc', 'icon',
  ];
  const api = block(app, 'const rb =');
  for (const m of members) {
    assert.match(api, new RegExp(`(?:^|\\n)\\s{2}${m}\\b`), `rb.${m} is missing from app.js`);
    assert.ok(mountDoc.includes(`rb.${m}`), `rb.${m} is not in MOUNT-POINTS.md`);
  }
  assert.equal((await read('public', 'features', 'index.js')).includes('export const features = ['), true);
});
