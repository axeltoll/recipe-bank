// Test helpers: small valid recipes, a temporary data folder and a script runner.
// Not a test file itself (npm test only runs test/*.test.mjs).

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

export const ROOT = resolve(import.meta.dirname, '..', '..');
const exec = promisify(execFile);

/** An 11-character YouTube-style id: testvideo01, testvideo02, … */
export const videoId = (n) => `testvideo${String(n).padStart(2, '0')}`;

/** A small recipe that passes validateRecipe, for video number `n`. */
export function makeRecipe(id, n, extra = {}) {
  return {
    id,
    title: `Recipe ${id}`,
    status: 'analyzed',
    video: { platform: 'youtube', id: videoId(n), url: `https://www.youtube.com/shorts/${videoId(n)}` },
    creator: { name: 'A creator', handle: '@creator', url: 'https://www.youtube.com/@creator' },
    uploaded: '2026-10-01',
    analyzed: '2026-11-01',
    summary: 'A test recipe.',
    serves: null,
    tags: ['test'],
    components: [{
      name: 'Main',
      ingredients: [
        { item: 'Eggs', key: 'egg', amount: '2', basis: 'spoken' },
        { item: 'Salt', key: 'salt', amount: null, basis: 'unstated' },
      ],
      steps: [{ text: 'Whisk the eggs with salt.', t: 3 }],
    }],
    ...extra,
  };
}

/** A temporary data folder with recipes/ and data/, holding the given recipes. */
export async function tempBank(recipes = []) {
  const dir = await mkdtemp(join(tmpdir(), 'recipe-bank-test-'));
  await mkdir(join(dir, 'recipes'));
  await mkdir(join(dir, 'data'));
  for (const r of recipes) await writeRecipe(dir, r);
  return dir;
}

export const recipeText = (r) => JSON.stringify(r, null, 2) + '\n';

export async function writeRecipe(dir, r, name = `${r.id}.json`) {
  await writeFile(join(dir, 'recipes', name), typeof r === 'string' ? r : recipeText(r));
}

/** Run scripts/<script> with Node; resolves to { code, stdout, stderr } whatever the exit code. */
export async function runScript(script, args = [], env = {}) {
  try {
    const { stdout, stderr } = await exec(process.execPath, [join(ROOT, 'scripts', script), ...args], {
      env: { ...process.env, ...env },
      cwd: ROOT,
    });
    return { code: 0, stdout, stderr };
  } catch (e) {
    if (typeof e.code !== 'number') throw e;
    return { code: e.code, stdout: e.stdout, stderr: e.stderr };
  }
}
