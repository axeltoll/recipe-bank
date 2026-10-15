// Builds a static copy of the dashboard in dist/ for Cloudflare Pages (`npm run build`, deploy with `npm run deploy`).
// The two read APIs become plain JSON files; the page is marked data-static="1", so app.js reads those files, hides
// "Remove" and turns "Add video" into a copy-a-request for the Recipe Bank Telegram topic (there is no server to queue to).
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { loadRecipes } from '../server.mjs';
import { videoKey } from '../lib/video.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const DIST = join(ROOT, 'dist');

async function loadQueue() {
  try {
    return JSON.parse(await readFile(join(ROOT, 'data', 'queue.json'), 'utf8'));
  } catch (e) {
    if (e.code === 'ENOENT') return [];
    throw e;
  }
}

const { recipes, invalid } = await loadRecipes();
if (invalid.length) {
  console.error('Invalid recipe files, fix them first (npm run validate):', invalid.map((i) => i.file).join(', '));
  process.exit(1);
}
const done = new Set(recipes.map((r) => videoKey(r.video)));
const queue = (await loadQueue()).map((q) => (done.has(videoKey(q.video)) ? { ...q, status: 'done' } : q));

await rm(DIST, { recursive: true, force: true });
await cp(join(ROOT, 'public'), DIST, { recursive: true });
await cp(join(ROOT, 'lib'), join(DIST, 'lib'), { recursive: true });
await mkdir(join(DIST, 'api'), { recursive: true });
await writeFile(join(DIST, 'api', 'recipes.json'), JSON.stringify({ recipes, invalid: [] }));
await writeFile(join(DIST, 'api', 'queue.json'), JSON.stringify({ queue }));

const index = join(DIST, 'index.html');
await writeFile(index, (await readFile(index, 'utf8')).replace('<html lang="en">', '<html lang="en" data-static="1">'));
await writeFile(join(DIST, '_headers'), [
  '/lib/*',
  '  Content-Type: text/javascript; charset=utf-8',
  '/api/*',
  '  Cache-Control: no-cache',
  '',
].join('\n'));

console.log(`dist/: ${recipes.length} recipes, ${queue.length} queued`);
