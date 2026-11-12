// Links from recipe files, packs, queue entries and oEmbed end up in href and src attributes.
// The contract refuses anything that is not a plain http(s) link, and every renderer goes through
// one safeUrl() helper (lib/format.mjs for the dashboard, site/js/showcase-core.js for the website).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { safeUrl } from '../lib/format.mjs';
import { safeUrl as siteSafeUrl, renderDetail } from '../site/js/showcase-core.js';
import { validateRecipe, isWebLink } from '../lib/recipe.mjs';
import { readPack, planImport, applyImport, PACK_FORMAT, PACK_VERSION } from '../lib/pack.mjs';
import { makeRecipe, ROOT } from './helpers/bank.mjs';

// Every way of smuggling a script or a document through a link that we know of.
const HOSTILE = [
  'javascript:alert(1)',
  'JaVaScRiPt:alert(1)',
  'JAVASCRIPT:alert(1)',
  '  javascript:alert(1)',
  '\tjavascript:alert(1)',
  '\njavascript:alert(1)',
  'java\tscript:alert(1)',
  'java\nscript:alert(1)',
  '\u0000javascript:alert(1)',
  'javascript&#58;alert(1)',
  '&#106;avascript:alert(1)',
  'javascript&colon;alert(1)',
  '%6Aavascript:alert(1)',
  'data:text/html,<script>alert(1)</script>',
  'DATA:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==',
  'vbscript:msgbox(1)',
  'VBScript:msgbox(1)',
  'file:///etc/passwd',
  'ftp://example.com/x',
  'blob:https://example.com/0',
  '//evil.example/x',
  '/relative/path',
  '#/r/x',
  'not a link',
  '',
  '   ',
];

test('safeUrl keeps http(s) links in the form the browser uses', () => {
  for (const fn of [safeUrl, siteSafeUrl]) {
    assert.equal(fn('https://www.youtube.com/@creator'), 'https://www.youtube.com/@creator');
    assert.equal(fn('http://example.com/a?b=1#c'), 'http://example.com/a?b=1#c');
    assert.equal(fn('  https://example.com/x  '), 'https://example.com/x', 'surrounding spaces are dropped');
    assert.equal(fn('HTTPS://Example.COM/Path'), 'https://example.com/Path', 'scheme and host are lowercased');
    assert.equal(fn('https://example.com/a"b<c>'), 'https://example.com/a%22b%3Cc%3E', 'quotes cannot end an attribute');
  }
});

test('safeUrl drops every other scheme, mixed case, padding and entity tricks', () => {
  for (const fn of [safeUrl, siteSafeUrl]) {
    for (const value of HOSTILE) assert.equal(fn(value), null, JSON.stringify(value));
    for (const value of [null, undefined, 42, {}, ['https://example.com'], { toString: () => 'https://x.example' }]) {
      assert.equal(fn(value), null, `non-string ${JSON.stringify(value)}`);
    }
  }
});

test('the dashboard helper and the site helper are the same function', async () => {
  const body = (src) => src.match(/export function safeUrl\(value\) \{[\s\S]*?\n\}/)?.[0];
  const lib = body(await readFile(join(ROOT, 'lib', 'format.mjs'), 'utf8'));
  const site = body(await readFile(join(ROOT, 'site', 'js', 'showcase-core.js'), 'utf8'));
  assert.ok(lib, 'lib/format.mjs exports safeUrl');
  assert.equal(site, lib, 'site/js/showcase-core.js has the same safeUrl');
});

test('isWebLink: the contract accepts only plain lowercase http(s) links', () => {
  assert.equal(isWebLink('https://www.youtube.com/@creator'), true);
  assert.equal(isWebLink('http://example.com/'), true);
  for (const value of [...HOSTILE, 'HTTPS://example.com/', ' https://example.com/', 'https://exa mple.com/', 'https://', null, 7]) {
    assert.equal(isWebLink(value), false, JSON.stringify(value));
  }
});

test('validateRecipe refuses a creator or video link with another scheme', () => {
  assert.deepEqual(validateRecipe(makeRecipe('alpha', 1), 'alpha'), []);
  const { creator: _, ...noCreatorUrl } = makeRecipe('alpha', 1);
  assert.deepEqual(validateRecipe({ ...noCreatorUrl, creator: { name: 'C' } }, 'alpha'), [], 'creator.url is optional');
  assert.deepEqual(validateRecipe({ ...noCreatorUrl, creator: { name: 'C', url: null } }, 'alpha'), [], 'null is allowed');
  for (const url of HOSTILE) {
    const r = makeRecipe('alpha', 1);
    r.creator.url = url;
    assert.ok(validateRecipe(r, 'alpha').includes('creator.url must be an http:// or https:// link'), JSON.stringify(url));
  }
  for (const url of ['javascript://www.youtube.com/watch?v=testvideo01', ' https://www.youtube.com/shorts/testvideo01',
    'HTTPS://www.youtube.com/shorts/testvideo01', 'data:text/html,https://www.youtube.com/shorts/testvideo01']) {
    const r = makeRecipe('alpha', 1);
    r.video.url = url;
    assert.ok(validateRecipe(r, 'alpha').some((p) => p.startsWith('video.url must be')), JSON.stringify(url));
  }
});

test('every recipe file keeps plain http(s) links', async () => {
  const dir = join(ROOT, 'recipes');
  for (const f of (await readdir(dir)).filter((n) => n.endsWith('.json'))) {
    const r = JSON.parse(await readFile(join(dir, f), 'utf8'));
    assert.ok(isWebLink(r.video.url), `${f} video.url`);
    if (r.creator.url != null) assert.ok(isWebLink(r.creator.url), `${f} creator.url`);
  }
});

test('a pack carrying a hostile link is reported invalid and never written', () => {
  const good = makeRecipe('alpha', 1);
  const evil = makeRecipe('beta', 2);
  evil.creator.url = 'javascript:fetch("/api/queue",{method:"POST"})';
  const sneaky = makeRecipe('gamma', 3);
  sneaky.creator.url = ' JavaScript:alert(1)';
  const pack = { format: PACK_FORMAT, version: PACK_VERSION, title: 'T', exported: '2026-11-11T10:00:00.000Z', recipes: [good, evil, sneaky] };
  const read = readPack(JSON.stringify(pack));
  assert.equal(read.ok, true);
  assert.match(read.entries[1].problems.join('\n'), /creator\.url must be an http/);
  assert.match(read.entries[2].problems.join('\n'), /creator\.url must be an http/);
  const plan = planImport(read, []);
  assert.deepEqual(plan.items.map((i) => i.status), ['new', 'invalid', 'invalid']);
  const { files } = applyImport(plan);
  assert.deepEqual(files.map((f) => JSON.parse(f.contents).id), ['alpha']);
});

test('the website renders a hostile link as plain text', () => {
  const r = {
    id: 'x', title: 'X', status: 'analyzed',
    video: { platform: 'tiktok', id: null, url: 'javascript:alert(1)' },
    creator: { name: 'A creator', handle: null, url: 'JaVaScRiPt:alert(1)' },
    summary: 's', serves: null, tags: [],
    components: [{ name: 'Part', ingredients: [], steps: [{ text: 'Stir.', t: 5 }] }],
    nutrition: null, gaps: [],
  };
  const html = renderDetail(r);
  assert.doesNotMatch(html, /javascript:/i);
  assert.doesNotMatch(html, /href=/, 'no link at all');
  assert.match(html, /by A creator<\/p>/);
  assert.match(html, /<span class="ts">0:05<\/span>/);
});

/**
 * The href/src template expressions that name a URL without passing it through safeUrl or watchUrl. A plain
 * local (`esc(videoUrl)`) passes only when the same file assigns it from one of them.
 */
function rawUrlAttributes(src) {
  const checked = (name) => new RegExp(`\\b${name}\\s*=\\s*(?:safeUrl|watchUrl)\\(`).test(src);
  return [...src.matchAll(/\b(?:href|src)\s*=\s*["']?\$\{([^}]*)\}/gi)].map((m) => m[1]).filter((expr) => {
    if (!/url/i.test(expr) || /\b(?:safeUrl|watchUrl)\(/.test(expr)) return false;
    const local = expr.match(/^\s*(?:esc\(\s*)?([A-Za-z_$][\w$]*)\s*\)?\s*$/);
    return !(local && checked(local[1]));
  });
}

test('the raw-URL scan catches every quoting and expression form', () => {
  for (const bad of ['href="${esc(a.url)}"', 'href="${r.video.url}"', "href='${r.creator.url}'", 'src=${x.url}',
    'href="${esc(a.url || b.url)}"', 'SRC = "${thumbUrl}"']) {
    assert.equal(rawUrlAttributes(`<a ${bad}>`).length, 1, bad);
  }
  assert.deepEqual(rawUrlAttributes('const link = safeUrl(r.url); `<a href="${esc(link)}">` `<a href="${esc(rawUrl)}">`'), ['esc(rawUrl)']);
  assert.deepEqual(rawUrlAttributes('const videoUrl = safeUrl(x.url); `<a href="${esc(videoUrl)}">`'), []);
  for (const good of ['href="${esc(safeUrl(r.creator.url))}"', "src='${esc(watchUrl(r.video, t))}'", 'href="#/r/${esc(r.id)}"']) {
    assert.deepEqual(rawUrlAttributes(`<a ${good}>`), [], good);
  }
});

test('no renderer puts a URL from data into href or src without safeUrl', async () => {
  const files = [
    ...['recipe.js', 'queue.js', 'home.js', 'add.js'].map((f) => join(ROOT, 'public', 'ui', f)),
    ...(await readdir(join(ROOT, 'public', 'features'))).filter((f) => /\.m?js$/.test(f)).map((f) => join(ROOT, 'public', 'features', f)),
    join(ROOT, 'site', 'js', 'showcase-core.js'),
  ];
  for (const file of files) {
    const src = await readFile(file, 'utf8');
    assert.deepEqual(rawUrlAttributes(src), [], file);
  }
});
