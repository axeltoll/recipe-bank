// Probes of recipe packs (lib/pack.mjs and POST /api/packs/import): export → file/link → import round
// trips over the whole bank, hostile packs (deep nesting, prototype keys, bidi titles, huge inputs,
// unsafe links), id conflicts and import through the API. Real bugs are marked `todo`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { readFile, readdir, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import {
  exportPack, serializePack, readPack, planImport, applyImport, packLink, packFromLink, packParam, packFileName,
  toBase64url, fromBase64url, MAX_PACK_CHARS, MAX_PACK_RECIPES, MAX_LINK_CHARS, PACK_FORMAT,
} from '../lib/pack.mjs';
import { validateRecipe } from '../lib/recipe.mjs';
import { createApp } from '../server.mjs';
import { makeRecipe, tempBank, videoId } from './helpers/bank.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const FILES = readdirSync(join(ROOT, 'recipes')).filter((f) => f.endsWith('.json')).sort();
const TEXTS = new Map(FILES.map((f) => [f.slice(0, -5), readFileSync(join(ROOT, 'recipes', f), 'utf8')]));
const RECIPES = [...TEXTS.values()].map((t) => JSON.parse(t));
const wrap = (recipes, extra = {}) => ({ format: PACK_FORMAT, version: 1, title: 'T', recipes, ...extra });

async function withServer(dir, fn) {
  const app = createApp({ dataDir: dir, oembed: null, resolve: async (v) => v });
  await new Promise((ok) => app.listen(0, '127.0.0.1', ok));
  const base = `http://127.0.0.1:${app.address().port}`;
  try {
    return await fn((body) => fetch(`${base}/api/packs/import`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: typeof body === 'string' ? body : JSON.stringify(body) }));
  } finally {
    app.closeAllConnections?.();
    await new Promise((ok) => app.close(ok));
  }
}

// ---------- round trips ----------

// Recipe files in the repo are hand-formatted (short arrays on one line); an import writes canonical
// two-space JSON, so "the same file" means the same data in the canonical form.
const canonical = (id) => JSON.stringify(JSON.parse(TEXTS.get(id)), null, 2) + '\n';

test('the whole bank exported as a file and imported into an empty bank gives the same files', () => {
  const pack = exportPack(RECIPES, { title: 'Everything', exported: '2026-11-11T00:00:00.000Z' });
  const plan = planImport(serializePack(pack), []);
  assert.deepEqual(plan.counts, { new: RECIPES.length, conflict: 0, duplicate: 0, invalid: 0 });
  const { files, skipped } = applyImport(plan);
  assert.equal(skipped.length, 0);
  for (const f of files) assert.equal(f.contents, canonical(f.id), f.id);
});

test('importing the bank into itself finds only duplicates', () => {
  const plan = planImport(serializePack(exportPack(RECIPES)), RECIPES);
  assert.deepEqual(plan.counts, { new: 0, conflict: 0, duplicate: RECIPES.length, invalid: 0 });
  assert.equal(applyImport(plan).files.length, 0);
});

test('every recipe fits in a link on its own, and the link gives the recipe back unchanged', () => {
  for (const r of RECIPES) {
    const link = packLink(exportPack([r]), 'http://127.0.0.1:4780/#/packs');
    assert.ok(link.startsWith('http://127.0.0.1:4780/#pack='));
    const read = packFromLink(link);
    assert.equal(read.ok, true, r.id);
    assert.deepEqual(read.entries[0].recipe, r);
  }
});

test('links with unicode titles, and a link that is too big, behave', () => {
  const r = makeRecipe('probe-uni', 1, { title: 'Bánh mì 🥖 — 鶏 — مرحبا' });
  assert.equal(packFromLink(packLink(exportPack([r]))).entries[0].recipe.title, r.title);
  const big = Array.from({ length: 40 }, (_, i) => makeRecipe(`probe-big-${i}`, 10 + i, { notes: ['x'.repeat(2000)] }));
  assert.throws(() => packLink(exportPack(big)), (e) => e.code === 'too-large-for-link');
});

test('damaged links never throw and say why', () => {
  const good = packLink(exportPack([RECIPES[0]]));
  const payload = packParam(good);
  for (const link of [
    '#pack=', '#pack=@@@', `#pack=${payload.slice(0, -7)}`, `#pack=${payload}=`, `#pack=${payload.slice(1)}`, `#pack=${'A'.repeat(MAX_LINK_CHARS + 1)}`,
    `#pack=${toBase64url('[]')}`, `#pack=${toBase64url('not json')}`, '#pack=gA', 'https://x/', null, undefined, 42,
  ]) {
    const read = packFromLink(link);
    assert.equal(read.ok, false, String(link).slice(0, 40));
    assert.ok(read.errors.length > 0);
  }
  assert.throws(() => fromBase64url('_w'), Error, 'invalid UTF-8 is refused');
});

// ---------- hostile packs ----------

test('deeply nested data in a recipe or in the wrapper is refused without a stack overflow', () => {
  let deep = {};
  let cur = deep;
  for (let i = 0; i < 10_000; i++) cur = cur.a = {};
  assert.match(readPack(wrap([makeRecipe('probe-deep', 1, { deep })])).entries[0].problems[0], /nested too deeply/);
  assert.equal(readPack(wrap([makeRecipe('probe-deep', 1)], { meta: deep })).ok, false);
  const arrays = `{"format":"${PACK_FORMAT}","version":1,"recipes":[${'['.repeat(50_000)}${']'.repeat(50_000)}]}`;
  const read = readPack(arrays);
  assert.equal(read.entries[0].recipe, null);
});

test('prototype keys anywhere are refused and never pollute Object.prototype', () => {
  const texts = [
    `{"format":"${PACK_FORMAT}","version":1,"__proto__":{"polluted":1},"recipes":[]}`,
    JSON.stringify(wrap([makeRecipe('probe-p', 1)])).replace('"components":[{', '"components":[{"__proto__":{"polluted":1},'),
    JSON.stringify(wrap([makeRecipe('probe-p', 1)])).replace('"video":{', '"video":{"constructor":{"prototype":{"polluted":1}},'),
  ];
  for (const t of texts) {
    const read = readPack(t);
    assert.ok(!read.ok || read.entries.every((e) => e.recipe == null), t.slice(0, 60));
  }
  assert.equal({}.polluted, undefined);
});

test('exportPack refuses a recipe that readPack would refuse',
  { todo: 'bug: exportPack only runs validateRecipe, so a recipe holding a "__proto__" key (which POST /api/recipes accepts) exports into a pack that every importer rejects' },
  () => {
    const r = JSON.parse(JSON.stringify(makeRecipe('probe-proto', 1)).replace('{"id"', '{"__proto__":{"a":1},"id"'));
    let pack;
    try { pack = exportPack([r]); } catch { return; } // refusing at export is the fix
    assert.ok(readPack(serializePack(pack)).entries[0].recipe, 'an exported pack must import');
  });

test('titles are single-line plain text: control and bidi characters gone, HTML kept as text, length capped', () => {
  const read = readPack(wrap([makeRecipe('probe-t', 1, { title: 'A\u202eB\u0000C\nD' })], { title: `\u202e<img src=x onerror=alert(1)>\u2028${'x'.repeat(500)}` }));
  assert.ok(read.title.startsWith('<img src=x onerror=alert(1)>'));
  assert.ok([...read.title].length <= 120);
  assert.doesNotMatch(read.title, /[\u0000-\u001f\u202a-\u202e\u2028]/);
  const plan = planImport(read, []);
  assert.doesNotMatch(plan.items[0].title, /[\u0000-\u001f\u202e]/);
});

test('recipes with javascript:, data: or look-alike links are invalid entries', () => {
  for (const url of ['javascript:alert(1)', 'JAVASCRIPT:alert(1)', ' https://x.example', 'data:text/html,x', 'https://x.example/ a', 'java\tscript:alert(1)']) {
    const r = makeRecipe('probe-l', 1, { creator: { name: 'x', url } });
    assert.equal(readPack(wrap([r])).entries[0].recipe, null, url);
  }
  const v = makeRecipe('probe-v', 1);
  v.video.url = 'javascript://www.youtube.com/shorts/testvideo01';
  assert.equal(readPack(wrap([v])).entries[0].recipe, null);
});

test('wrapper limits: size, count, version, format', () => {
  assert.equal(readPack('x'.repeat(MAX_PACK_CHARS + 1)).ok, false);
  assert.equal(readPack(wrap(Array.from({ length: MAX_PACK_RECIPES + 1 }, () => ({})))).ok, false);
  for (const version of [0, -1, 1.5, '1', null, 2]) assert.equal(readPack(wrap([makeRecipe('a', 1)], { version })).ok, false, String(version));
  for (const format of ['Recipe-Bank-Pack', '', null]) assert.equal(readPack(wrap([makeRecipe('a', 1)], { format })).ok, false);
  for (const input of [null, undefined, 42, [], 'null', '[]', new Date(), Object.create({ format: PACK_FORMAT })]) assert.equal(readPack(input).ok, false);
});

test('a look-alike read result is not trusted by planImport', () => {
  const fake = { ok: true, errors: [], entries: [{ index: 0, id: 'x', title: 'x', recipe: { id: '../../evil' }, problems: [] }] };
  const plan = planImport(fake, []);
  assert.equal(plan.ok, false);
});

test('id conflicts number upwards and stay unique inside one pack', () => {
  const pack = wrap(Array.from({ length: 5 }, (_, i) => makeRecipe('same', 10 + i)));
  const plan = planImport(pack, [{ id: 'same' }, { id: 'same-3' }]);
  assert.deepEqual(plan.items.map((i) => i.id), ['same-2', 'same-4', 'same-5', 'same-6', 'same-7']);
  for (const f of applyImport(plan).files) assert.deepEqual(validateRecipe(f.recipe, f.id), []);
});

test('packFileName never yields a path, and always ends in .recipe-pack.json', () => {
  for (const title of ['../../etc/passwd', '..\\..\\x', '鶏', '', null, 'a'.repeat(300), 'CON', '.hidden']) {
    const name = packFileName({ title });
    assert.match(name, /^[a-z0-9-]+\.recipe-pack\.json$/, String(title));
    assert.ok(name.length <= 60 + '.recipe-pack.json'.length);
  }
});

// ---------- import through the API ----------

test('API: the whole bank imports into an empty bank as the same files, then again as duplicates only', async () => {
  const dir = await tempBank([]);
  try {
    await withServer(dir, async (post) => {
      const pack = exportPack(RECIPES);
      const res = await post({ pack: serializePack(pack) });
      assert.equal(res.status, 201);
      const j = await res.json();
      assert.equal(j.created.length, RECIPES.length);
      for (const id of j.created) assert.equal(await readFile(join(dir, 'recipes', `${id}.json`), 'utf8'), canonical(id), id);
      const again = await post({ pack });
      assert.equal(again.status, 200);
      assert.equal((await again.json()).counts.duplicate, RECIPES.length);
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('API: include picks positions; bad include lists are 400', async () => {
  const dir = await tempBank([]);
  try {
    await withServer(dir, async (post) => {
      const pack = wrap([makeRecipe('probe-a', 1), makeRecipe('probe-b', 2), makeRecipe('probe-c', 3)]);
      for (const include of ['0', [0.5], [null], { 0: true }, [0, '1']]) assert.equal((await post({ pack, include })).status, 400, JSON.stringify(include));
      const res = await post({ pack, include: [2, 99, -1] });
      const j = await res.json();
      assert.deepEqual(j.created, ['probe-c']);
      assert.deepEqual(await readdir(join(dir, 'recipes')), ['probe-c.json']);
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('API: concurrent imports of the same pack create each recipe once', async () => {
  const dir = await tempBank([]);
  try {
    await withServer(dir, async (post) => {
      const pack = wrap([makeRecipe('probe-a', 1), makeRecipe('probe-b', 2)]);
      const res = await Promise.all(Array.from({ length: 8 }, () => post({ pack })));
      const created = (await Promise.all(res.map((r) => r.json()))).flatMap((j) => j.created);
      assert.deepEqual(created.sort(), ['probe-a', 'probe-b']);
      assert.deepEqual((await readdir(join(dir, 'recipes'))).sort(), ['probe-a.json', 'probe-b.json']);
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('API: a pack with one recipe whose id is too long for the file system imports the rest and reports it',
  { todo: 'bug: the contract has no id length limit; a 251-character id makes writeFile fail with ENAMETOOLONG, the import answers 500 and the recipes written before it stay without a report' },
  async () => {
    const dir = await tempBank([]);
    try {
      await withServer(dir, async (post) => {
        const long = 'a'.repeat(251);
        const pack = wrap([makeRecipe('probe-first', 1), makeRecipe(long, 2), makeRecipe('probe-last', 3)]);
        const res = await post({ pack });
        assert.equal(res.status, 201);
        const j = await res.json();
        assert.deepEqual(j.created, ['probe-first', 'probe-last']);
        assert.ok(j.skipped.some((s) => s.index === 1));
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

test('API: a pack sent as a parsed object, as text, and as text inside JSON all work; junk is 400', async () => {
  const dir = await tempBank([]);
  try {
    await withServer(dir, async (post) => {
      assert.equal((await post({ pack: wrap([makeRecipe('probe-o', 1)]) })).status, 201);
      assert.equal((await post({ pack: JSON.stringify(wrap([makeRecipe('probe-s', 2)])) })).status, 201);
      for (const body of [{}, { pack: null }, { pack: 'nope' }, { pack: [] }, [], { pack: wrap([]) }, { pack: wrap([makeRecipe('x', 3)], { version: 9 }) }]) {
        assert.equal((await post(body)).status, 400, JSON.stringify(body).slice(0, 60));
      }
      const r = await post({ pack: wrap([{ id: 'only-junk' }]) });
      assert.equal(r.status, 200);
      assert.equal((await r.json()).counts.invalid, 1);
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('API: an imported recipe whose video is queued does not stay "waiting" in the queue view', async () => {
  const dir = await tempBank([]);
  const { writeFile } = await import('node:fs/promises');
  await writeFile(join(dir, 'data', 'queue.json'), JSON.stringify([{ id: 'q1', video: { platform: 'youtube', id: videoId(5), url: `https://www.youtube.com/shorts/${videoId(5)}` }, status: 'queued' }]));
  try {
    await withServer(dir, async (post) => {
      assert.equal((await post({ pack: wrap([makeRecipe('probe-q', 5)]) })).status, 201);
    });
    const app = createApp({ dataDir: dir, oembed: null });
    const { queue } = await new Promise((ok) => app.listen(0, '127.0.0.1', async () => {
      const j = await (await fetch(`http://127.0.0.1:${app.address().port}/api/queue`)).json();
      app.closeAllConnections?.();
      app.close(() => ok(j));
    }));
    assert.equal(queue[0].status, 'done');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
