// The site scripts (npm run site, site:data, site:sync) only do their work when run as the entry script.
// The guard must hold for a relative path, an absolute one and a symlink, and stay quiet on import.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { isMain } from '../scripts/is-main.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const SCRIPTS = ['build-site-data.mjs', 'serve-site.mjs', 'sync-site.mjs'];

async function scratch(t) {
  const dir = await mkdtemp(join(tmpdir(), 'recipe-is-main-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

test('isMain matches the entry script by absolute path, relative path and symlink', async (t) => {
  const dir = await scratch(t);
  const file = join(dir, 'script.mjs');
  await writeFile(file, '');
  const link = join(dir, 'link.mjs');
  await symlink(file, link);
  const url = pathToFileURL(file).href;
  assert.equal(isMain(url, file), true);
  assert.equal(isMain(url, relative(process.cwd(), file)), true);
  assert.equal(isMain(url, link), true, 'a symlink to the script is still the script');
  assert.equal(isMain(url, join(dir, 'other.mjs')), false);
  assert.equal(isMain(url, undefined), false, 'no entry script (a REPL or node -e)');
});

test('a script started through a symlink runs its main block', async (t) => {
  const dir = await scratch(t);
  const file = join(dir, 'script.mjs');
  await writeFile(file, `import { isMain } from ${JSON.stringify(pathToFileURL(join(ROOT, 'scripts', 'is-main.mjs')).href)};
console.log(isMain(import.meta.url) ? 'main' : 'imported');
`);
  await symlink(file, join(dir, 'link.mjs'));
  const run = (entry) => new Promise((ok, fail) => {
    const child = spawn(process.execPath, [entry], { cwd: dir, stdio: ['ignore', 'pipe', 'inherit'] });
    let out = '';
    child.stdout.on('data', (c) => { out += c; });
    child.on('error', fail);
    child.on('exit', () => ok(out.trim()));
  });
  assert.equal(await run('script.mjs'), 'main');
  assert.equal(await run('link.mjs'), 'main');
});

test('every site script guards its main block with isMain', async () => {
  for (const name of SCRIPTS) {
    const src = await readFile(join(ROOT, 'scripts', name), 'utf8');
    assert.match(src, /^if \(isMain\(import\.meta\.url\)\) \{$/m, `${name} uses isMain`);
    assert.doesNotMatch(src, /process\.argv\[1\] === import\.meta\.filename/, `${name} has no path-string guard`);
  }
});

test('npm run site, started through a symlink, listens', async (t) => {
  const dir = await scratch(t);
  const link = join(dir, 'serve-site.mjs');
  await symlink(join(ROOT, 'scripts', 'serve-site.mjs'), link);
  const child = spawn(process.execPath, [link], { env: { ...process.env, SITE_PORT: '0' }, stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(() => child.kill('SIGKILL'));
  const line = await new Promise((ok) => {
    let out = '';
    const timer = setTimeout(() => ok(out), 5000);
    child.stdout.on('data', (c) => { out += c; if (out.includes('\n')) { clearTimeout(timer); ok(out); } });
    child.on('exit', () => { clearTimeout(timer); ok(out); });
  });
  assert.match(line, /Recipe Bank site/);
});
