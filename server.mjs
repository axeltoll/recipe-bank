// Recipe Bank local server: serves the dashboard and a small JSON API.
// Zero dependencies. Data lives in recipes/*.json (one file per recipe) and
// data/queue.json (videos waiting for analysis).
//
// `npm start` runs it. Tests and scripts import `createApp` (data folders and the
// oEmbed lookup can be swapped out) and `loadRecipes` / `loadQueue`.

import { createServer } from 'node:http';
import { readFile, readdir, writeFile, rename, mkdir, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dirname, extname, join, normalize, resolve, sep } from 'node:path';
import { parseVideoUrl, videoKey } from './lib/video.mjs';
import { validateRecipe, SLUG } from './lib/recipe.mjs';
import { readPack, planImport, applyImport, MAX_PACK_CHARS } from './lib/pack.mjs';

const ROOT = resolve(import.meta.dirname);
// RECIPE_BANK_DIR: a folder holding recipes/ and data/ to use instead of this repo's (tests use a temp folder).
const DATA_ROOT = resolve(process.env.RECIPE_BANK_DIR ?? ROOT);
const RECIPES_DIR = join(DATA_ROOT, 'recipes');
const QUEUE_FILE = join(DATA_ROOT, 'data', 'queue.json');
const PORT = Number(process.env.PORT ?? 4780);
const HOST = process.env.HOST ?? '127.0.0.1';
const RECIPE_BODY_LIMIT = 500_000;

const STATIC = { '/': join(ROOT, 'public'), '/lib/': join(ROOT, 'lib') };
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

export async function loadRecipes(dir = RECIPES_DIR) {
  const files = (await readdir(dir)).filter((f) => f.endsWith('.json')).sort();
  const recipes = [];
  const invalid = [];
  for (const f of files) {
    const id = f.slice(0, -5);
    try {
      const r = JSON.parse(await readFile(join(dir, f), 'utf8'));
      const errs = validateRecipe(r, id);
      if (errs.length) invalid.push({ file: f, errors: errs });
      else recipes.push(r);
    } catch (e) {
      invalid.push({ file: f, errors: [e.message] });
    }
  }
  return { recipes, invalid };
}

export async function loadQueue(file = QUEUE_FILE) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch (e) {
    if (e.code === 'ENOENT') return [];
    throw e;
  }
}

async function saveQueue(queue, file) {
  await mkdir(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(queue, null, 2) + '\n');
  await rename(tmp, file);
}

const saveQueue = (queueFile, queue) => writeJsonAtomic(queueFile, queue);

// Best-effort title/creator lookup; the queue entry is still saved if this fails.
export async function oembed(video) {
  const endpoint = {
    youtube: 'https://www.youtube.com/oembed?format=json&url=',
    tiktok: 'https://www.tiktok.com/oembed?url=',
    pinterest: 'https://www.pinterest.com/oembed.json?url=',
    x: 'https://publish.x.com/oembed?url=',
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

function json(res, status, body) {
  res.writeHead(status, { 'content-type': TYPES['.json'], 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

async function readBody(req, max = 10_000) {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > max) throw Object.assign(new Error('Body too large'), { status: 413 });
  }
  try {
    return JSON.parse(raw || '{}');
  } catch {
    return null;
  }
}

/**
 * The HTTP server, not yet listening. Options (all optional):
 *   recipesDir  folder of recipe JSON files (default recipes/)
 *   queueFile   queue JSON file (default data/queue.json)
 *   oembed      async (video) => ({ title, creator, creatorUrl }) or null to skip the lookup
 */
export function createApp({ recipesDir = RECIPES_DIR, queueFile = QUEUE_FILE, oembed: lookup = oembed } = {}) {
  // Serialise queue writes so concurrent POSTs can't drop entries.
  let queueLock = Promise.resolve();
  const withQueue = (fn) => (queueLock = queueLock.then(fn, fn));

  async function api(req, res, path) {
    if (req.method === 'GET' && path === '/api/recipes') {
      return json(res, 200, await loadRecipes(recipesDir));
    }
    if (req.method === 'GET' && path === '/api/queue') {
      const { recipes } = await loadRecipes(recipesDir);
      const done = new Set(recipes.map((r) => videoKey(r.video)));
      const queue = (await loadQueue(queueFile)).map((q) => (done.has(videoKey(q.video)) ? { ...q, status: 'done' } : q));
      return json(res, 200, { queue });
    }
    if (req.method === 'POST' && path === '/api/queue') {
      const body = await readBody(req);
      const video = parseVideoUrl(body?.url);
      if (!video) return json(res, 400, { error: 'Paste a YouTube, TikTok or Instagram video link.' });
      const note = typeof body.note === 'string' ? body.note.trim().slice(0, 500) : '';
      const meta = (lookup ? await lookup(video) : null) ?? {};
      return withQueue(async () => {
        const { recipes } = await loadRecipes(recipesDir);
        const key = videoKey(video);
        const existing = recipes.find((r) => videoKey(r.video) === key);
        if (existing) return json(res, 409, { error: 'Already in the bank.', recipeId: existing.id });
        const queue = await loadQueue(queueFile);
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
        await saveQueue(queue, queueFile);
        return json(res, 201, { entry });
      });
    }
    const del = path.match(/^\/api\/queue\/([\w-]+)$/);
    if (req.method === 'DELETE' && del) {
      return withQueue(async () => {
        const queue = await loadQueue(queueFile);
        const next = queue.filter((q) => q.id !== del[1]);
        if (next.length === queue.length) return json(res, 404, { error: 'Not in the queue.' });
        await saveQueue(next, queueFile);
        return json(res, 200, { ok: true });
      });
    }
    return json(res, 404, { error: 'Not found' });
  }

  async function serveStatic(res, path) {
    const prefix = path.startsWith('/lib/') ? '/lib/' : '/';
    const base = STATIC[prefix];
    let rel;
    try {
      rel = decodeURIComponent(path.slice(prefix.length)) || 'index.html';
    } catch {
      return json(res, 400, { error: 'Bad path' });
    }
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

  return createServer(async (req, res) => {
    const { pathname } = new URL(req.url, 'http://localhost');
    try {
      if (pathname.startsWith('/api/')) return await api(req, res, pathname);
      if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, 405, { error: 'Method not allowed' });
      return await serveStatic(res, pathname);
    } catch (e) {
      console.error(e);
      json(res, e.status ?? 500, { error: e.status ? e.message : 'Server error' });
    }
  });
}

if (process.argv[1] === import.meta.filename) {
  createApp().listen(PORT, HOST, () => console.log(`Recipe Bank → http://${HOST}:${PORT}`));
}
