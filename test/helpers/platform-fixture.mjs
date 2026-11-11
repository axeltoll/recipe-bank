import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = new URL('../../', import.meta.url);

// Exercise the real server and CLI with disposable data, never the user's queue.
export async function platformFixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'recipe-bank-platforms-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  for (const path of ['server.mjs', 'lib', 'scripts']) {
    await cp(new URL(path, root), join(dir, path), { recursive: true });
  }
  await mkdir(join(dir, 'recipes'));
  await mkdir(join(dir, 'data'));
  const writeJSON = (path, value) => writeFile(join(dir, path), JSON.stringify(value));
  const writeQueue = (queue) => writeJSON('data/queue.json', queue);
  await writeQueue([]);
  const recipe = JSON.parse(await readFile(new URL('recipes/banana-milk.json', root), 'utf8'));
  const { handleRequest } = await import(pathToFileURL(join(dir, 'server.mjs')).href);
  return { dir, recipe, handleRequest, writeJSON, writeQueue,
    readQueue: async () => JSON.parse(await readFile(join(dir, 'data/queue.json'), 'utf8')) };
}
