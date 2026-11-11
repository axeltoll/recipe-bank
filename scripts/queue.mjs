// Offline queue maintenance. Stop the dashboard before changing its queue file.
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { open, readFile, readdir, rename, rm } from 'node:fs/promises';
import { parseVideoUrl as parseUrl, videoKey } from '../lib/video.mjs';

// Web pages are a valid queue input when the entry says so (the dashboard's "It's a web page" box).
const parseVideoUrl = (url, video) => parseUrl(url, { allowWeb: video?.platform === 'web' });
import { validateRecipe } from '../lib/recipe.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');

export function assertQueue(queue) {
  if (!Array.isArray(queue)) throw new Error('Queue must be an array.');
  const ids = new Set();
  for (const entry of queue) {
    if (!entry?.id || ids.has(entry.id) || !['queued', 'analyzing', 'failed'].includes(entry.status) || !parseVideoUrl(entry.video?.url, entry.video)) {
      throw new Error('Queue has an invalid entry or duplicate ID; run npm run validate and fix it first.');
    }
    ids.add(entry.id);
  }
}

export function nextQueued(queue) {
  assertQueue(queue);
  const time = (entry) => Number.isFinite(Date.parse(entry.addedAt)) ? Date.parse(entry.addedAt) : Infinity;
  return queue.filter((entry) => entry.status === 'queued').sort((a, b) => time(a) - time(b))[0] ?? null;
}

export function markEntry(queue, id, status, { reason, recipes = [], now = new Date().toISOString() } = {}) {
  assertQueue(queue);
  const entry = queue.find((item) => item.id === id);
  if (!entry) throw new Error(`Queue entry not found: ${id}`);
  if (status === 'done') {
    if (entry.status !== 'analyzing') throw new Error('Only an analyzing entry can be completed.');
    const key = videoKey(parseVideoUrl(entry.video.url, entry.video));
    const recipe = recipes.find((item) => item.recipe && videoKey(parseVideoUrl(item.recipe.video?.url, item.recipe.video)) === key);
    if (!recipe || validateRecipe(recipe.recipe, recipe.fileId).length) {
      // A recipe file that does not parse cannot be matched; name it, it may be the one being completed.
      const unreadable = recipes.filter((item) => item.error).map((item) => `recipes/${item.fileId}.json (${item.error})`);
      throw new Error(`Completion requires a matching valid recipe file.${unreadable.length ? ` Unreadable: ${unreadable.join('; ')}.` : ''}`);
    }
    return queue.filter((item) => item.id !== id);
  }
  const transitions = { queued: ['analyzing'], analyzing: ['failed'], failed: ['queued'] };
  if (!transitions[entry.status].includes(status)) throw new Error(`Cannot mark ${entry.status} as ${status}.`);
  if (status === 'failed' && (typeof reason !== 'string' || !reason.trim())) throw new Error('A failed entry needs a reason.');
  return queue.map((item) => {
    if (item.id !== id) return item;
    const updated = { ...item, status, updatedAt: now };
    delete updated.failureReason;
    if (status === 'failed') updated.failureReason = reason.trim();
    return updated;
  });
}

export async function updateQueueFile(file, transform) {
  // An exclusive temporary file serializes helper instances. The server does not
  // share this lock, so the documented workflow requires stopping it first.
  const temporary = `${file}.agent.tmp`;
  let handle;
  try {
    handle = await open(temporary, 'wx', 0o600);
  } catch (err) {
    if (err.code !== 'EEXIST') throw err;
    throw new Error(`${path.basename(temporary)} exists (EEXIST): another queue helper is running, or one stopped `
      + 'without cleaning up. If no helper is running, delete that file and retry (see agent/QUEUE.md).');
  }
  try {
    const before = await readFile(file, 'utf8');
    const next = await transform(JSON.parse(before));
    await handle.writeFile(JSON.stringify(next, null, 2) + '\n');
    await handle.close();
    if (await readFile(file, 'utf8') !== before) throw new Error('Queue changed during update; retry after stopping other writers.');
    await rename(temporary, file);
    return next;
  } finally {
    await handle.close();
    await rm(temporary, { force: true });
  }
}

// Every recipe file; one that does not parse is kept as { fileId, recipe: null, error } so an unrelated
// broken file neither blocks completion nor hides behind a bare SyntaxError.
export async function recipeFiles(root) {
  return Promise.all((await readdir(path.join(root, 'recipes'))).filter((f) => f.endsWith('.json')).map(async (file) => {
    const fileId = file.slice(0, -5);
    try {
      return { fileId, recipe: JSON.parse(await readFile(path.join(root, 'recipes', file), 'utf8')) };
    } catch (err) {
      return { fileId, recipe: null, error: err.message };
    }
  }));
}

export async function queueMain(args, { root = ROOT, log = console.log, error = console.error } = {}) {
  const [command, id, status, ...rest] = args;
  const file = path.join(root, 'data', 'queue.json');
  try {
    if (command === 'next' && args.length === 1) {
      log(JSON.stringify(nextQueued(JSON.parse(await readFile(file, 'utf8'))), null, 2));
    } else if (command === 'mark' && id && ['analyzing', 'failed', 'queued', 'done'].includes(status) && (status === 'failed' || !rest.length)) {
      const recipes = status === 'done' ? await recipeFiles(root) : [];
      const queue = await updateQueueFile(file, (items) => markEntry(items, id, status, { reason: rest.join(' '), recipes }));
      log(JSON.stringify({ id, status, remaining: queue.length }));
    } else throw new Error('Usage: node scripts/queue.mjs next | mark <id> analyzing|queued|done | mark <id> failed <reason>');
    return 0;
  } catch (err) { error(err.message); return 1; }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  process.exitCode = await queueMain(process.argv.slice(2));
}
