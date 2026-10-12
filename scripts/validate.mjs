// Validates every recipes/*.json against the contract in lib/recipe.mjs and
// checks data/queue.json entries. Exit code 1 on any problem.

import { readFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { validateRecipe } from '../lib/recipe.mjs';
import { parseVideoUrl, videoKey } from '../lib/video.mjs';

const ROOT = resolve(import.meta.dirname, '..');
let problems = 0;
const fail = (where, msg) => { problems++; console.error(`✗ ${where}: ${msg}`); };

const files = (await readdir(join(ROOT, 'recipes'))).filter((f) => f.endsWith('.json')).sort();
const seen = new Map();
for (const f of files) {
  let r;
  try {
    r = JSON.parse(await readFile(join(ROOT, 'recipes', f), 'utf8'));
  } catch (e) {
    fail(f, `invalid JSON (${e.message})`);
    continue;
  }
  for (const e of validateRecipe(r, f.slice(0, -5))) fail(f, e);
  const key = videoKey(r.video);
  if (seen.has(key)) fail(f, `same video as ${seen.get(key)}`);
  seen.set(key, f);
}

let queue = [];
try {
  queue = JSON.parse(await readFile(join(ROOT, 'data', 'queue.json'), 'utf8'));
  if (!Array.isArray(queue)) throw new Error('must be an array');
} catch (e) {
  if (e.code !== 'ENOENT') fail('data/queue.json', e.message);
}
const STATUSES = ['queued', 'analyzing', 'failed'];
queue.forEach((q, i) => {
  const at = `data/queue.json[${i}]`;
  if (!q.id) fail(at, 'id is required');
  if (!parseVideoUrl(q.video?.url)) fail(at, 'video.url is not a supported link');
  if (!STATUSES.includes(q.status)) fail(at, `status must be one of ${STATUSES.join(', ')}`);
  if (seen.has(videoKey(q.video))) {
    console.warn(`! ${at}: already analyzed as ${seen.get(videoKey(q.video))}; remove it from the queue`);
  }
});

if (problems) {
  console.error(`\n${problems} problem(s).`);
  process.exit(1);
}
console.log(`✓ ${files.length} recipe(s) and ${queue.length} queue entr${queue.length === 1 ? 'y' : 'ies'} valid.`);
