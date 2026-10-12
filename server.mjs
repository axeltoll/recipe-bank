// Recipe Bank local server: serves the dashboard and a small JSON API.
// Zero dependencies. Data lives in recipes/*.json (one file per recipe) and
// data/queue.json (videos waiting for analysis).

import { createServer } from 'node:http';
import { readFile, readdir, writeFile, rename, mkdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { parseVideoUrl, videoKey } from './lib/video.mjs';
import { validateRecipe } from './lib/recipe.mjs';

const ROOT = resolve(import.meta.dirname);
const RECIPES_DIR = join(ROOT, 'recipes');
const QUEUE_FILE = join(ROOT, 'data', 'queue.json');
const PORT = Number(process.env.PORT ?? 4780);
const HOST = process.env.HOST ?? '127.0.0.1';

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

export async function loadRecipes() {
  const files = (await readdir(RECIPES_DIR)).filter((f) => f.endsWith('.json')).sort();
  const recipes = [];
  const invalid = [];
  for (const f of files) {
    const id = f.slice(0, -5);
    try {
      const r = JSON.parse(await readFile(join(RECIPES_DIR, f), 'utf8'));
      const errs = validateRecipe(r, id);
      if (errs.length) invalid.push({ file: f, errors: errs });
      else recipes.push(r);
    } catch (e) {
      invalid.push({ file: f, errors: [e.message] });
    }
  }
  return { recipes, invalid };
}

async function loadQueue() {
  try {
    return JSON.parse(await readFile(QUEUE_FILE, 'utf8'));
  } catch (e) {
    if (e.code === 'ENOENT') return [];
    throw e;
  }
}

async function saveQueue(queue) {
  await mkdir(join(ROOT, 'data'), { recursive: true });
  const tmp = `${QUEUE_FILE}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(queue, null, 2) + '\n');
  await rename(tmp, QUEUE_FILE);
}

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

// Serialise queue writes so concurrent POSTs can't drop entries.
let queueLock = Promise.resolve();
const withQueue = (fn) => (queueLock = queueLock.then(fn, fn));

async function api(req, res, path) {
  if (req.method === 'GET' && path === '/api/recipes') {
    return json(res, 200, await loadRecipes());
  }
  if (req.method === 'GET' && path === '/api/queue') {
    const { recipes } = await loadRecipes();
    const done = new Set(recipes.map((r) => videoKey(r.video)));
    const queue = (await loadQueue()).map((q) => (done.has(videoKey(q.video)) ? { ...q, status: 'done' } : q));
    return json(res, 200, { queue });
  }
  if (req.method === 'POST' && path === '/api/queue') {
    const body = await readBody(req);
    const video = parseVideoUrl(body?.url);
    if (!video) return json(res, 400, { error: 'Paste a YouTube, TikTok or Instagram video link.' });
    const note = typeof body.note === 'string' ? body.note.trim().slice(0, 500) : '';
    const meta = await oembed(video);
    return withQueue(async () => {
      const { recipes } = await loadRecipes();
      const key = videoKey(video);
      const existing = recipes.find((r) => videoKey(r.video) === key);
      if (existing) return json(res, 409, { error: 'Already in the bank.', recipeId: existing.id });
      const queue = await loadQueue();
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
      await saveQueue(queue);
      return json(res, 201, { entry });
    });
  }
  const del = path.match(/^\/api\/queue\/([\w-]+)$/);
  if (req.method === 'DELETE' && del) {
    return withQueue(async () => {
      const queue = await loadQueue();
      const next = queue.filter((q) => q.id !== del[1]);
      if (next.length === queue.length) return json(res, 404, { error: 'Not in the queue.' });
      await saveQueue(next);
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

async function readBody(req) {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 10_000) throw Object.assign(new Error('Body too large'), { status: 413 });
  }
  try {
    return JSON.parse(raw || '{}');
  } catch {
    return null;
  }
}

const server = createServer(async (req, res) => {
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

if (process.argv[1] === import.meta.filename) {
  server.listen(PORT, HOST, () => console.log(`Recipe Bank → http://${HOST}:${PORT}`));
}
