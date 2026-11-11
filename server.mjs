// Recipe Bank local server: serves the dashboard and a small JSON API.
// Zero dependencies. Data lives in recipes/*.json (one file per recipe) and
// data/queue.json (videos waiting for analysis).
//
// `npm start` runs it. Everything is built by one factory, `createApp(options)`:
//   - tests and scripts call it with their own data folder and stubs;
//   - `server` (not listening) and `handleRequest` are the default app, for the browser
//     smoke test (it listens on port 0) and for handler-level tests;
//   - `loadRecipes` / `loadQueue` / `dataPaths` are shared with the scripts.
// RECIPE_BANK_DIR points the server and the scripts at another folder holding recipes/ and data/.

import { createServer } from 'node:http';
import { readFile, readdir, writeFile, rename, mkdir, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dirname, extname, join, normalize, resolve, sep } from 'node:path';
import { parseVideoUrl, videoKey, PLATFORMS } from './lib/video.mjs';
import { validateRecipe, isWebLink, SLUG } from './lib/recipe.mjs';
import { resolveShortVideo } from './lib/video-resolver.mjs';
import { readPack, planImport, applyImport, MAX_PACK_CHARS } from './lib/pack.mjs';

const ROOT = resolve(import.meta.dirname);

/** The data folder an environment asks for: RECIPE_BANK_DIR, else this repository. */
export function defaultDataDir(env = process.env) {
  return resolve(env.RECIPE_BANK_DIR || ROOT);
}

const DATA_ROOT = defaultDataDir();
const PORT = Number(process.env.PORT ?? 4780);
const HOST = process.env.HOST ?? '127.0.0.1';
const QUEUE_BODY_LIMIT = 10_000;
const RECIPE_BODY_LIMIT = 500_000;

const STATIC = { '/': join(ROOT, 'public'), '/lib/': join(ROOT, 'lib') };
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

/** The recipes folder and queue file inside a data folder (default: RECIPE_BANK_DIR, else this repository). */
export function dataPaths(dataDir = DATA_ROOT) {
  const root = resolve(dataDir);
  return { root, recipesDir: join(root, 'recipes'), queueFile: join(root, 'data', 'queue.json') };
}

const DEFAULT = dataPaths();

export async function loadRecipes(dir = DEFAULT.recipesDir) {
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

export async function loadQueue(file = DEFAULT.queueFile) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
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

// Best-effort title/creator lookup from public, key-free oEmbed endpoints; the queue entry is
// still saved if this fails. Facebook, Instagram and web pages are never looked up.
export async function oembed(video) {
  const endpoint = {
    youtube: 'https://www.youtube.com/oembed?format=json&url=',
    tiktok: 'https://www.tiktok.com/oembed?url=',
    pinterest: 'https://www.pinterest.com/oembed.json?url=',
    // X's documented oEmbed endpoint (docs.x.com, "oEmbed API") is still on the twitter.com host.
    x: 'https://publish.twitter.com/oembed?url=',
  }[video.platform];
  if (!endpoint) return {};
  try {
    const res = await fetch(endpoint + encodeURIComponent(video.url), { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return {};
    const j = await res.json();
    // Third-party answers: only short plain text, and only an http(s) link, are kept.
    const text = (v) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 300) : null);
    return { title: text(j?.title), creator: text(j?.author_name), creatorUrl: isWebLink(j?.author_url) ? j.author_url : null };
  } catch {
    return {};
  }
}

// "YouTube, TikTok, Instagram, Facebook, Pinterest or X"
const LINK_SOURCES = (() => {
  const labels = PLATFORMS.filter((p) => p.id !== 'web').map((p) => p.label);
  return `${labels.slice(0, -1).join(', ')} or ${labels.at(-1)}`;
})();
const BAD_LINK = `Paste a video link from ${LINK_SOURCES}. For another HTTPS page, set allowWeb: true.`;

function json(res, status, body) {
  res.writeHead(status, { 'content-type': TYPES['.json'], 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

async function readBody(req, max = QUEUE_BODY_LIMIT) {
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

// ---------- who may change data ----------
//
// The server listens on 127.0.0.1, but every web page open in the same browser can still send it
// requests. Three checks keep those pages out of every state-changing request (POST, PUT, DELETE, …):
//   1. Sec-Fetch-Site, when the browser sends it, must say "same-origin" (or "none": typed by the user).
//   2. Origin, when present, must be this server's own origin; Host must be a loopback name or one
//      listed in RECIPE_BANK_HOSTS (or the HOST the server binds to). That also stops DNS rebinding.
//   3. The body must be sent as application/json. A foreign page can only send that after a CORS
//      preflight, which this server never grants.
// Requests without Origin, Sec-Fetch-Site or Host (curl, scripts, tests calling the handler) pass 1 and 2.

const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const LOOPBACK = /^(?:localhost|127(?:\.\d{1,3}){3}|\[::1\])$/;

const isJson = (headers) => /^application\/json\s*(?:;|$)/i.test(String(headers['content-type'] ?? '').trim());

/** The hostname of a Host header value ("127.0.0.1:4780" → "127.0.0.1"), lowercased; null if malformed. */
function hostName(value) {
  const text = String(value).trim().toLowerCase();
  if (!/^[a-z0-9.\-[\]:]+$/.test(text)) return null;
  try {
    return new URL(`http://${text}`).hostname;
  } catch {
    return null;
  }
}

/** Host names a write may be addressed to, besides loopback: RECIPE_BANK_HOSTS and a non-wildcard HOST. */
export function allowedHosts(env = process.env) {
  const names = String(env.RECIPE_BANK_HOSTS ?? '').split(',').map((h) => h.trim().toLowerCase()).filter(Boolean);
  const bind = String(env.HOST ?? '').trim().toLowerCase();
  if (bind && !['0.0.0.0', '::', '[::]'].includes(bind)) names.push(bind.includes(':') && !bind.startsWith('[') ? `[${bind}]` : bind);
  return names;
}

/**
 * Why a state-changing request must be refused, as { status, error }, or null when it may go ahead.
 * `headers` are Node's lowercased request headers; `hosts` the extra allowed host names.
 */
export function writeRefusal(headers = {}, { hosts = [] } = {}) {
  const site = headers['sec-fetch-site'];
  if (site != null && site !== 'same-origin' && site !== 'none') {
    return { status: 403, error: 'Refused: this request came from another website.' };
  }
  let host = null;
  if (headers.host != null) {
    host = hostName(headers.host);
    if (!host || !(LOOPBACK.test(host) || hosts.includes(host))) {
      return { status: 403, error: 'Refused: the request is addressed to an unknown host name. Add it to RECIPE_BANK_HOSTS.' };
    }
  }
  if (headers.origin != null) {
    let origin;
    try {
      origin = new URL(headers.origin);
    } catch {
      origin = null;
    }
    const own = headers.host != null && origin && origin.protocol === 'http:'
      && origin.host === String(headers.host).trim().toLowerCase();
    if (!own) return { status: 403, error: 'Refused: this request came from another website.' };
  }
  if (!isJson(headers)) return { status: 415, error: 'Send the request as application/json.' };
  return null;
}

/**
 * The request handler. Options (all optional):
 *   dataDir     folder holding recipes/ and data/queue.json (default: RECIPE_BANK_DIR, else this repository)
 *   recipesDir  recipe folder, overrides dataDir's
 *   queueFile   queue file, overrides dataDir's
 *   oembed      async (video) => ({ title, creator, creatorUrl }), or null to skip the lookup
 *   resolve     async (video) => video, short-link resolution (default lib/video-resolver.mjs)
 *   hosts       host names besides loopback that writes may be addressed to (default: allowedHosts())
 */
export function createHandler({
  dataDir, recipesDir, queueFile, oembed: lookup = oembed, resolve: resolveVideo = resolveShortVideo,
  hosts = allowedHosts(),
} = {}) {
  const paths = dataPaths(dataDir ?? DATA_ROOT);
  const dirs = { recipesDir: recipesDir ?? paths.recipesDir, queueFile: queueFile ?? paths.queueFile };

  // Serialise queue, recipe and pack writes so concurrent requests can't drop entries or race on an id.
  let lock = Promise.resolve();
  const withLock = (fn) => (lock = lock.then(fn, fn));

  async function queueRequest(req, res) {
    const body = await readBody(req);
    const video = await resolveVideo(parseVideoUrl(body?.url, { allowWeb: body?.allowWeb === true }));
    if (!video) return json(res, 400, { error: BAD_LINK });
    const note = typeof body.note === 'string' ? body.note.trim().slice(0, 500) : '';
    const meta = (lookup ? await lookup(video) : null) ?? {};
    return withLock(async () => {
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

  // Creates (id = null) or replaces (id = the file to replace) a recipe file. Shared by POST and PUT.
  async function saveRecipe(res, body, id) {
    const problems = validateRecipe(body, id ?? undefined);
    return withLock(async () => {
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

  // POST /api/packs/import { pack, include?: [position, …] }. Plans the import against the
  // recipes on disk right now (never trusting a plan from the browser) and only creates new
  // files: the 'wx' flag fails instead of overwriting, even if a file appeared meanwhile.
  async function importPack(res, body) {
    if (!body || typeof body !== 'object' || Array.isArray(body) || body.pack == null) {
      return json(res, 400, { error: 'Send JSON: { "pack": <recipe pack>, "include": [positions] }.' });
    }
    const { include } = body;
    if (include != null && !(Array.isArray(include) && include.every(Number.isInteger))) {
      return json(res, 400, { error: '"include" must be a list of recipe positions in the pack.' });
    }
    const read = readPack(body.pack);
    if (!read.ok) return json(res, 400, { error: read.errors[0], errors: read.errors });
    return withLock(async () => {
      const { recipes, invalid } = await loadRecipes(dirs.recipesDir);
      const taken = invalid.map((i) => ({ id: i.file.slice(0, -5) }));
      const plan = planImport(read, [...recipes, ...taken]);
      const { files, skipped } = applyImport(plan, include ? { include } : {});
      const created = [];
      for (const f of files) {
        if (!SLUG.test(f.id)) {
          skipped.push({ index: f.index, id: f.id, reason: 'not a valid id' });
          continue;
        }
        try {
          await writeFile(join(dirs.recipesDir, `${f.id}.json`), f.contents, { flag: 'wx' });
          created.push(f.id);
        } catch (e) {
          if (e.code !== 'EEXIST') throw e;
          skipped.push({ index: f.index, id: f.id, reason: 'a recipe file with this id already exists' });
        }
      }
      skipped.sort((a, b) => a.index - b.index);
      return json(res, created.length ? 201 : 200, { created, skipped, counts: plan.counts });
    });
  }

  async function api(req, res, path) {
    if (!READ_METHODS.has(req.method)) {
      const refused = writeRefusal(req.headers ?? {}, { hosts });
      if (refused) return json(res, refused.status, { error: refused.error });
    }
    if (req.method === 'GET' && path === '/api/recipes') {
      return json(res, 200, await loadRecipes(dirs.recipesDir));
    }
    if (req.method === 'POST' && path === '/api/recipes') {
      return saveRecipe(res, await readBody(req, RECIPE_BODY_LIMIT), null);
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
      return saveRecipe(res, await readBody(req, RECIPE_BODY_LIMIT), id);
    }
    if (req.method === 'GET' && path === '/api/queue') {
      const { recipes } = await loadRecipes(dirs.recipesDir);
      const done = new Set(recipes.map((r) => videoKey(r.video)));
      const queue = (await loadQueue(dirs.queueFile)).map((q) => (done.has(videoKey(q.video)) ? { ...q, status: 'done' } : q));
      return json(res, 200, { queue });
    }
    if (req.method === 'POST' && path === '/api/queue') return queueRequest(req, res);
    if (req.method === 'POST' && path === '/api/packs/import') {
      return importPack(res, await readBody(req, MAX_PACK_CHARS + 10_000));
    }
    const del = path.match(/^\/api\/queue\/([\w-]+)$/);
    if (req.method === 'DELETE' && del) {
      return withLock(async () => {
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

  return async function handle(req, res) {
    const { pathname } = new URL(req.url, 'http://localhost');
    try {
      if (pathname.startsWith('/api/')) return await api(req, res, pathname);
      if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, 405, { error: 'Method not allowed' });
      return await serveStatic(res, pathname);
    } catch (e) {
      console.error(e);
      json(res, e.status ?? 500, { error: e.status ? e.message : 'Server error' });
    }
  };
}

/** The HTTP server, not yet listening. Same options as createHandler. */
export function createApp(options = {}) {
  return createServer(createHandler(options));
}

/** The default app (RECIPE_BANK_DIR or this repository, real oEmbed and short-link lookups). */
export const handleRequest = createHandler();
export const server = createServer(handleRequest);

if (process.argv[1] === import.meta.filename) {
  server.listen(PORT, HOST, () => console.log(`Recipe Bank → http://${HOST}:${PORT}`));
}
