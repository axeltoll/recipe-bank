// Recipe Bank local server: serves the dashboard and a small JSON API.
// Zero dependencies. Data lives in recipes/*.json (one file per recipe) and
// data/queue.json (videos waiting for analysis). RECIPE_BANK_DATA_DIR points the
// server at another folder holding recipes/ and data/ (default: this repository).

import { createServer } from 'node:http';
import { readFile, readdir, writeFile, rename, mkdir, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dirname, extname, join, normalize, resolve, sep } from 'node:path';
import { parseVideoUrl, videoKey } from './lib/video.mjs';
import { validateRecipe } from './lib/recipe.mjs';

const ROOT = resolve(import.meta.dirname);
const DATA_DIR = resolve(process.env.RECIPE_BANK_DATA_DIR || ROOT);
const RECIPES_DIR = join(DATA_DIR, 'recipes');
const QUEUE_FILE = join(DATA_DIR, 'data', 'queue.json');
const PORT = Number(process.env.PORT ?? 4780);
const HOST = process.env.HOST ?? '127.0.0.1';
const RECIPE_BODY_LIMIT = 500_000;

const STATIC = { '/': 'public', '/lib/': 'lib' };
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

export async function loadRecipes(recipesDir = RECIPES_DIR) {
  const files = (await readdir(recipesDir)).filter((f) => f.endsWith('.json')).sort();
  const recipes = [];
  const invalid = [];
  for (const f of files) {
    const id = f.slice(0, -5);
    try {
      const r = JSON.parse(await readFile(join(recipesDir, f), 'utf8'));
      const errs = validateRecipe(r, id);
      if (errs.length) invalid.push({ file: f, errors: errs });
      else recipes.push(r);
    } catch (e) {
      invalid.push({ file: f, errors: [e.message] });
    }
  }
  return { recipes, invalid };
}

async function loadQueue(queueFile) {
  try {
    return JSON.parse(await readFile(queueFile, 'utf8'));
  } catch (e) {
    if (e.code === 'ENOENT') return [];
    throw e;
  }
}

// Write to a temp file in the same folder, then rename over the target, so a crash never leaves half a file.
// The temp name doesn't end in .json, so loadRecipes never reads it.
async function writeJsonAtomic(file, value) {
  await mkdir(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${randomUUID().slice(0, 8)}.tmp`;
  try {
    await writeFile(tmp, JSON.stringify(value, null, 2) + '\n');
    await rename(tmp, file);
  } catch (e) {
    await unlink(tmp).catch(() => {});
    throw e;
  }
}

const saveQueue = (queueFile, queue) => writeJsonAtomic(queueFile, queue);

// Best-effort title/creator lookup; the queue entry is still saved if this fails.
async function oembed(video) {
  const endpoint = {
    youtube: 'https://www.youtube.com/oembed?format=json&url=',
    tiktok: 'https://www.tiktok.com/oembed?url=',
  }[video.platform];
  if (!endpoint) return {};
  try {
    const res = await fetch(endpoint + encodeURIComponent(video.url), { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return {};
    const j = await res.json();
    return { title: j.title ?? null, creator: j.author_name ?? null, creatorUrl: j.author_url ?? null };
  } catch {
    return {};
  }
}

// Serialise queue and recipe writes so concurrent requests can't drop entries or race on the same id.
let queueLock = Promise.resolve();
const withQueue = (fn) => (queueLock = queueLock.then(fn, fn));

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

// Creates (id = null) or replaces (id = the file to replace) a recipe file. Shared by POST and PUT.
async function saveRecipe(res, dirs, body, id) {
  const problems = validateRecipe(body, id ?? undefined);
  return withQueue(async () => {
    const files = new Set((await readdir(dirs.recipesDir)).filter((f) => f.endsWith('.json')));
    if (id && !files.has(`${id}.json`)) return json(res, 404, { error: 'No recipe with that id.' });
    if (problems.length) return json(res, 400, { error: 'The recipe does not match the contract.', problems });
    if (!id && files.has(`${body.id}.json`)) {
      return json(res, 409, { error: `A recipe with the id "${body.id}" already exists.`, recipeId: body.id });
    }
    const key = videoKey(body.video);
    const { recipes } = await loadRecipes(dirs.recipesDir);
    const other = recipes.find((r) => r.id !== body.id && videoKey(r.video) === key);
    if (other) return json(res, 409, { error: 'That video is already in the bank.', recipeId: other.id });

    await writeJsonAtomic(join(dirs.recipesDir, `${body.id}.json`), body);

    // The recipe file now exists, so its queue entry is done: remove it.
    const queue = await loadQueue(dirs.queueFile);
    const next = queue.filter((q) => videoKey(q.video) !== key);
    const dequeued = queue.filter((q) => videoKey(q.video) === key).map((q) => q.id);
    if (dequeued.length) await saveQueue(dirs.queueFile, next);
    return json(res, id ? 200 : 201, { recipe: body, dequeued });
  });
}

async function api(req, res, path, dirs) {
  if (req.method === 'GET' && path === '/api/recipes') {
    return json(res, 200, await loadRecipes(dirs.recipesDir));
  }
  if (req.method === 'POST' && path === '/api/recipes') {
    return saveRecipe(res, dirs, await readBody(req, RECIPE_BODY_LIMIT), null);
  }
  const one = path.match(/^\/api\/recipes\/([^/]+)$/);
  if (req.method === 'PUT' && one) {
    let id;
    try {
      id = decodeURIComponent(one[1]);
    } catch {
      id = '';
    }
    if (!SLUG.test(id)) return json(res, 404, { error: 'No recipe with that id.' });
    return saveRecipe(res, dirs, await readBody(req, RECIPE_BODY_LIMIT), id);
  }
  if (req.method === 'GET' && path === '/api/queue') {
    const { recipes } = await loadRecipes(dirs.recipesDir);
    const done = new Set(recipes.map((r) => videoKey(r.video)));
    const queue = (await loadQueue(dirs.queueFile)).map((q) => (done.has(videoKey(q.video)) ? { ...q, status: 'done' } : q));
    return json(res, 200, { queue });
  }
  if (req.method === 'POST' && path === '/api/queue') {
    const body = await readBody(req);
    const video = parseVideoUrl(body?.url);
    if (!video) return json(res, 400, { error: 'Paste a YouTube, TikTok or Instagram video link.' });
    const note = typeof body.note === 'string' ? body.note.trim().slice(0, 500) : '';
    const meta = await oembed(video);
    return withQueue(async () => {
      const { recipes } = await loadRecipes(dirs.recipesDir);
      const key = videoKey(video);
      const existing = recipes.find((r) => videoKey(r.video) === key);
      if (existing) return json(res, 409, { error: 'Already in the bank.', recipeId: existing.id });
      const queue = await loadQueue(dirs.queueFile);
      if (queue.some((q) => videoKey(q.video) === key)) return json(res, 409, { error: 'Already waiting for analysis.' });
      const entry = {
        id: randomUUID(),
        video,
        title: meta.title ?? null,
        creator: meta.creator ?? null,
        creatorUrl: meta.creatorUrl ?? null,
        note: note || null,
        addedAt: new Date().toISOString(),
        addedBy: 'dashboard',
        status: 'queued',
      };
      queue.push(entry);
      await saveQueue(dirs.queueFile, queue);
      return json(res, 201, { entry });
    });
  }
  const del = path.match(/^\/api\/queue\/([\w-]+)$/);
  if (req.method === 'DELETE' && del) {
    return withQueue(async () => {
      const queue = await loadQueue(dirs.queueFile);
      const next = queue.filter((q) => q.id !== del[1]);
      if (next.length === queue.length) return json(res, 404, { error: 'Not in the queue.' });
      await saveQueue(dirs.queueFile, next);
      return json(res, 200, { ok: true });
    });
  }
  return json(res, 404, { error: 'Not found' });
}

async function serveStatic(res, path) {
  const prefix = path.startsWith('/lib/') ? '/lib/' : '/';
  const base = join(ROOT, STATIC[prefix]);
  let rel = decodeURIComponent(path.slice(prefix.length)) || 'index.html';
  const file = normalize(join(base, rel));
  if (!file.startsWith(base + sep)) return json(res, 403, { error: 'Forbidden' });
  try {
    const data = await readFile(file);
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-cache' });
    res.end(data);
  } catch {
    json(res, 404, { error: 'Not found' });
  }
}

function json(res, status, body) {
  res.writeHead(status, { 'content-type': TYPES['.json'], 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

async function readBody(req, limit = 10_000) {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > limit) throw Object.assign(new Error('Body too large'), { status: 413 });
  }
  try {
    return JSON.parse(raw || '{}');
  } catch {
    return null;
  }
}

/**
 * The HTTP server, not yet listening. `dataDir` is a folder with recipes/ and data/queue.json
 * (default: RECIPE_BANK_DATA_DIR, else this repository). Tests point it at a temporary copy.
 */
export function createRecipeServer({ dataDir = DATA_DIR } = {}) {
  const root = resolve(dataDir);
  const dirs = { recipesDir: join(root, 'recipes'), queueFile: join(root, 'data', 'queue.json') };
  return createServer(async (req, res) => {
    const { pathname } = new URL(req.url, 'http://localhost');
    try {
      if (pathname.startsWith('/api/')) return await api(req, res, pathname, dirs);
      if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, 405, { error: 'Method not allowed' });
      return await serveStatic(res, pathname);
    } catch (e) {
      console.error(e);
      json(res, e.status ?? 500, { error: e.status ? e.message : 'Server error' });
    }
  });
}

if (process.argv[1] === import.meta.filename) {
  createRecipeServer().listen(PORT, HOST, () => console.log(`Recipe Bank → http://${HOST}:${PORT}`));
}
