// Builds a static copy of the dashboard in dist/ for Cloudflare Pages (`npm run build`, deploy with `npm run deploy`).
// The two read APIs become plain JSON files; the page is marked data-static="1", so app.js reads those files, hides
// "Remove", turns "Add video" into a copy-a-request message (there is no server to queue to), makes the recipe editor
// offer "Download JSON" instead of saving, and turns pack import off. Nothing in dist/ tries to write.
// public/features/ is copied with the rest of public/, so the feature modules work the same in the static copy.
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { loadQueue, loadRecipes, dataPaths } from '../server.mjs';
import { videoKey } from '../lib/video.mjs';

const ROOT = resolve(import.meta.dirname, '..');

/**
 * Build the static site into `outDir`. Throws (without touching `outDir`) when a recipe file is invalid.
 * Returns { recipes, queue } counts.
 *
 * The data is this repository's, never RECIPE_BANK_DIR's: `npm run deploy` publishes dist/, and a shell
 * that set the variable for a private bank must not publish that bank and its queue notes by accident.
 * Another folder is used only when it is passed here as `dataDir` (or as `recipesDir` / `queueFile`).
 */
export async function buildStatic({ outDir = join(ROOT, 'dist'), dataDir = ROOT, recipesDir, queueFile } = {}) {
  const data = dataPaths(dataDir);
  recipesDir ??= data.recipesDir;
  queueFile ??= data.queueFile;
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
  // Without the marker the copy's editor, Add video and pack import would try to write, so a missing <html> tag
  // stops the build instead of passing silently.
  const html = await readFile(index, 'utf8');
  if (!/<html\b[^>]*>/i.test(html)) throw new Error('public/index.html has no <html> tag to mark as static.');
  await writeFile(index, html.replace(/<html\b([^>]*)>/i, '<html$1 data-static="1">'));
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
