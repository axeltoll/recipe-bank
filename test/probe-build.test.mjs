// Probes of the static build (scripts/build-static.mjs) into a temporary folder: every file the dashboard
// loads (service-worker shell, static imports, dynamic imports, index.html references) exists in the
// output, the copy is marked static, the data files match the bank, and a failed build leaves the
// previous output alone. Real bugs are marked `todo`.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, statSync } from 'node:fs';
import { mkdtemp, readFile, readdir, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, resolve, sep } from 'node:path';
import { buildStatic } from '../scripts/build-static.mjs';
import { loadRecipes } from '../server.mjs';
import { makeRecipe, tempBank } from './helpers/bank.mjs';

const ROOT = resolve(import.meta.dirname, '..');
let work;
let out;
let result;

before(async () => {
  work = await mkdtemp(join(tmpdir(), 'recipe-bank-probe-build-'));
  out = join(work, 'dist');
  result = await buildStatic({ outDir: out, recipesDir: join(ROOT, 'recipes'), queueFile: join(ROOT, 'data', 'queue.json') });
});

after(async () => {
  await rm(work, { recursive: true, force: true });
});

async function walk(dir) {
  const files = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) files.push(...(await walk(p)));
    else files.push(p);
  }
  return files;
}

/** Module specifiers a JS file loads: static imports, re-exports, side-effect imports and literal import(). */
function specifiers(source) {
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const out = new Set();
  for (const re of [/\bimport\s+(?:[\w*{}\s,$]+\s+from\s+)?['"]([^'"]+)['"]/g, /\bexport\s+[\w*{}\s,$]+\s+from\s+['"]([^'"]+)['"]/g, /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g]) {
    for (const m of code.matchAll(re)) out.add(m[1]);
  }
  return [...out];
}

const inOut = (file) => file.startsWith(out + sep);
const servedPath = (path) => join(out, path === '/' ? 'index.html' : path.replace(/^\//, ''));

test('the build reports the bank and writes the two read APIs as JSON', async () => {
  const { recipes } = await loadRecipes(join(ROOT, 'recipes'));
  assert.equal(result.recipes, recipes.length);
  const api = JSON.parse(await readFile(join(out, 'api', 'recipes.json'), 'utf8'));
  assert.deepEqual(api, { recipes, invalid: [] });
  const queue = JSON.parse(await readFile(join(out, 'api', 'queue.json'), 'utf8'));
  assert.ok(Array.isArray(queue.queue));
});

test('index.html in the copy is marked static, so nothing in it tries to write', async () => {
  const html = await readFile(join(out, 'index.html'), 'utf8');
  assert.match(html, /<html[^>]*\bdata-static="1"/);
  assert.equal((html.match(/data-static=/g) ?? []).length, 1);
});

test('the static marker does not depend on the exact <html lang="en"> spelling',
  async () => {
    const src = await readFile(join(ROOT, 'scripts', 'build-static.mjs'), 'utf8');
    assert.doesNotMatch(src, /\.replace\('<html lang="en">'/);
  });

test('every path in the service-worker shell exists in the copy', async () => {
  const sw = await readFile(join(out, 'sw.js'), 'utf8');
  const shell = [...sw.match(/const SHELL = \[([\s\S]*?)\];/)[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
  assert.ok(shell.length > 20);
  for (const path of shell) assert.ok(existsSync(servedPath(path)) && statSync(servedPath(path)).isFile(), path);
});

test('every module any script in the copy imports resolves to a file inside the copy', async () => {
  const scripts = (await walk(out)).filter((f) => /\.(m?js)$/.test(f));
  assert.ok(scripts.length > 30);
  const missing = [];
  for (const file of scripts) {
    for (const spec of specifiers(await readFile(file, 'utf8'))) {
      if (/^(node:|https?:)/.test(spec)) {
        // Browser files must not import Node built-ins; lib/ files the server alone uses may.
        if (spec.startsWith('node:') && !relative(out, file).startsWith(`lib${sep}`)) missing.push(`${relative(out, file)} → ${spec}`);
        continue;
      }
      // Resolve as the browser does: as a URL against the file's own URL ("../" stops at the site root).
      const page = new URL(relative(out, file).split(sep).join('/'), 'https://copy.invalid/');
      const target = join(out, decodeURIComponent(new URL(spec, page).pathname));
      if (!inOut(target) || !existsSync(target)) missing.push(`${relative(out, file)} → ${spec}`);
    }
  }
  assert.deepEqual(missing, []);
});

test('every local file index.html and the manifest refer to exists in the copy', async () => {
  const html = await readFile(join(out, 'index.html'), 'utf8');
  const refs = [...html.matchAll(/\b(?:src|href)="(\/[^"#?]*)"/g)].map((m) => m[1]).filter((p) => p !== '/');
  assert.ok(refs.length >= 3);
  for (const p of refs) assert.ok(existsSync(servedPath(p)), p);
  const manifest = JSON.parse(await readFile(join(out, 'manifest.json'), 'utf8'));
  for (const icon of manifest.icons ?? []) if (icon.src.startsWith('/')) assert.ok(existsSync(servedPath(icon.src)), icon.src);
});

test('the copy holds no server code, scripts, recipe sources or temp files', async () => {
  const files = (await walk(out)).map((f) => relative(out, f).split(sep).join('/'));
  for (const f of files) {
    assert.doesNotMatch(f, /^(server\.mjs|scripts\/|recipes\/|data\/|test\/|evidence\/|\.git)/, f);
    assert.doesNotMatch(f, /\.tmp$|~$|\.DS_Store$/, f);
  }
  const headers = await readFile(join(out, '_headers'), 'utf8');
  assert.match(headers, /\/lib\/\*\n  Content-Type: text\/javascript/);
});

test('an invalid recipe stops the build and leaves the previous copy untouched', async () => {
  const bank = await tempBank([makeRecipe('probe-ok', 1)]);
  const target = join(work, 'keep');
  await mkdir(target, { recursive: true });
  await writeFile(join(target, 'sentinel.txt'), 'previous build');
  try {
    await writeFile(join(bank, 'recipes', 'probe-bad.json'), '{"id": "probe-bad"}');
    await assert.rejects(buildStatic({ outDir: target, recipesDir: join(bank, 'recipes'), queueFile: join(bank, 'data', 'queue.json') }), /probe-bad\.json/);
    assert.equal(await readFile(join(target, 'sentinel.txt'), 'utf8'), 'previous build');
  } finally {
    await rm(bank, { recursive: true, force: true });
  }
});

test('a bank without a queue file builds with an empty queue; queued videos already in the bank show as done', async () => {
  const bank = await tempBank([makeRecipe('probe-ok', 1)]);
  const target = join(work, 'q');
  try {
    assert.equal((await buildStatic({ outDir: target, recipesDir: join(bank, 'recipes'), queueFile: join(bank, 'data', 'queue.json') })).queue, 0);
    const r = makeRecipe('probe-ok', 1);
    await writeFile(join(bank, 'data', 'queue.json'), JSON.stringify([{ id: 'q1', video: r.video, status: 'queued' }, { id: 'q2', video: makeRecipe('x', 2).video, status: 'queued' }]));
    await buildStatic({ outDir: target, recipesDir: join(bank, 'recipes'), queueFile: join(bank, 'data', 'queue.json') });
    const { queue } = JSON.parse(await readFile(join(target, 'api', 'queue.json'), 'utf8'));
    assert.deepEqual(queue.map((q) => q.status), ['done', 'queued']);
  } finally {
    await rm(bank, { recursive: true, force: true });
  }
});

test('recipe text that looks like markup stays inside the JSON data file', async () => {
  const bank = await tempBank([makeRecipe('probe-html', 1, { title: '</script><script>alert(1)</script>' })]);
  const target = join(work, 'h');
  try {
    await buildStatic({ outDir: target, recipesDir: join(bank, 'recipes'), queueFile: join(bank, 'data', 'queue.json') });
    assert.doesNotMatch(await readFile(join(target, 'index.html'), 'utf8'), /alert\(1\)/);
    assert.equal(JSON.parse(await readFile(join(target, 'api', 'recipes.json'), 'utf8')).recipes[0].title, '</script><script>alert(1)</script>');
  } finally {
    await rm(bank, { recursive: true, force: true });
  }
});
