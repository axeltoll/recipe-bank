// Builds a static copy of the dashboard in dist/ for Cloudflare Pages (`npm run build`, deploy with `npm run deploy`).
// The two read APIs become plain JSON files; the page is marked data-static="1", so app.js reads those files, hides
// "Remove" and turns "Add video" into a copy-a-request for the Recipe Bank Telegram topic (there is no server to queue to).
// public/features/ is copied with the rest of public/, so the feature modules work the same in the static copy.
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { loadQueue, loadRecipes } from '../server.mjs';
import { videoKey } from '../lib/video.mjs';

const ROOT = resolve(import.meta.dirname, '..');

/**
 * Build the static site into `outDir`. Throws (without touching `outDir`) when a recipe file is invalid.
 * Returns { recipes, queue } counts.
 */
export async function buildStatic({
  outDir = join(ROOT, 'dist'),
  recipesDir = join(ROOT, 'recipes'),
  queueFile = join(ROOT, 'data', 'queue.json'),
} = {}) {
  const { recipes, invalid } = await loadRecipes(recipesDir);
  if (invalid.length) {
    throw Object.assign(new Error(`Invalid recipe files, fix them first (npm run validate): ${invalid.map((i) => i.file).join(', ')}`), { invalid });
  }
  const done = new Set(recipes.map((r) => videoKey(r.video)));
  const queue = (await loadQueue(queueFile)).map((q) => (done.has(videoKey(q.video)) ? { ...q, status: 'done' } : q));

  await rm(outDir, { recursive: true, force: true });
  await cp(join(ROOT, 'public'), outDir, { recursive: true });
  await cp(join(ROOT, 'lib'), join(outDir, 'lib'), { recursive: true });
  await mkdir(join(outDir, 'api'), { recursive: true });
  await writeFile(join(outDir, 'api', 'recipes.json'), JSON.stringify({ recipes, invalid: [] }));
  await writeFile(join(outDir, 'api', 'queue.json'), JSON.stringify({ queue }));

  const index = join(outDir, 'index.html');
  await writeFile(index, (await readFile(index, 'utf8')).replace('<html lang="en">', '<html lang="en" data-static="1">'));
  await writeFile(join(outDir, '_headers'), [
    '/lib/*',
    '  Content-Type: text/javascript; charset=utf-8',
    '/features/*.mjs',
    '  Content-Type: text/javascript; charset=utf-8',
    '/api/*',
    '  Cache-Control: no-cache',
    '',
  ].join('\n'));
  return { recipes: recipes.length, queue: queue.length };
}

if (process.argv[1] === import.meta.filename) {
  try {
    const n = await buildStatic();
    console.log(`dist/: ${n.recipes} recipes, ${n.queue} queued`);
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}
