// The browser checks must never leave Chrome running or its profile on disk, and their static server
// must never serve a file outside dist/. A fake "Chrome" (a small Node script) stands in for the browser:
// it starts a child of its own (as Chrome starts renderer and GPU processes), records both pids and its profile
// folder, then prints the DevTools line after a chosen delay.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { request as httpRequest } from 'node:http';
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { chmod, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { launch, killTree } from '../scripts/browser/cdp.mjs';
import { staticServer, listen, stop } from '../scripts/browser/support.mjs';
import { ROOT } from './helpers/bank.mjs';

// ---------- static server ----------

function get(port, path) {
  return new Promise((ok, fail) => {
    // node:http sends the path exactly as given; fetch would normalise the dot segments away first.
    const req = httpRequest({ host: '127.0.0.1', port, path, method: 'GET' }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { body += c; });
      res.on('end', () => ok({ status: res.statusCode, body }));
    });
    req.on('error', fail);
    req.end();
  });
}

test('the static server serves dist/ and nothing outside it', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'recipe-static-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const root = join(dir, 'dist');
  await mkdir(join(root, 'sub'), { recursive: true });
  await writeFile(join(root, 'index.html'), '<p>home</p>');
  await writeFile(join(root, 'a.txt'), 'inside');
  await writeFile(join(dir, 'secret.txt'), 'SECRET');
  const server = staticServer(root);
  const origin = await listen(server);
  t.after(() => stop(server));
  const port = Number(new URL(origin).port);

  assert.deepEqual(await get(port, '/'), { status: 200, body: '<p>home</p>' });
  assert.equal((await get(port, '/a.txt')).body, 'inside');
  for (const path of ['/..%2fsecret.txt', '/..%2f..%2f..%2fetc/passwd', '/%2e%2e/secret.txt', '/%2e%2e%2fsecret.txt',
    '/sub/..%2f..%2fsecret.txt', '/%00', '/a.txt%00', '/%', '/%E0%A4%A', '/sub', '/sub/', '/missing.html']) {
    const res = await get(port, path);
    assert.ok([403, 404].includes(res.status), `${path}: ${res.status}`);
    assert.ok(!res.body.includes('SECRET'), path);
  }
  assert.equal((await get(port, '/..%2fsecret.txt')).status, 403);
});

test('the static server labels fonts and images, so Chrome does not refuse them', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'recipe-static-types-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const expected = { 'a.woff': 'font/woff', 'a.woff2': 'font/woff2', 'a.webp': 'image/webp', 'a.jpg': 'image/jpeg', 'a.jpeg': 'image/jpeg' };
  for (const name of Object.keys(expected)) await writeFile(join(dir, name), 'x');
  const server = staticServer(dir);
  const origin = await listen(server);
  t.after(() => stop(server));
  for (const [name, type] of Object.entries(expected)) {
    assert.equal((await fetch(`${origin}/${name}`)).headers.get('content-type'), type, name);
  }
});

// ---------- launch and close with a fake browser ----------

const posix = process.platform !== 'win32' && !/\s/.test(process.execPath);
const skip = posix ? false : 'needs a POSIX shebang script as the fake browser';

async function fakeBrowser(t) {
  const dir = await mkdtemp(join(tmpdir(), 'recipe-fake-chrome-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const executable = join(dir, 'fake-chrome');
  await writeFile(executable, `#!${process.execPath}
const { writeFileSync } = require('node:fs');
const { spawn } = require('node:child_process');
const profile = process.argv.find((a) => a.startsWith('--user-data-dir='))?.slice('--user-data-dir='.length);
const renderer = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
writeFileSync(process.env.FAKE_CHROME_OUT, JSON.stringify({ pid: process.pid, renderer: renderer.pid, profile }));
setTimeout(() => process.stderr.write('DevTools listening on ws://127.0.0.1:9/devtools/browser/fake\\n'), Number(process.env.FAKE_CHROME_DELAY || 0));
setInterval(() => {}, 1000);
`);
  await chmod(executable, 0o755);
  return { dir, executable, out: join(dir, 'out.json') };
}

/** True once the process is gone (or only a zombie waiting for its parent to reap it). */
function gone(pid) {
  try {
    process.kill(pid, 0);
  } catch {
    return true;
  }
  try {
    return readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ')[1]?.startsWith('Z') ?? false;
  } catch {
    return false;
  }
}

/** A failing run must not leave the fake's child behind. */
function reap(pid) {
  try { process.kill(pid, 'SIGKILL'); } catch { /* gone, as it should be */ }
}

async function eventually(check, ms = 5000) {
  const deadline = Date.now() + ms;
  while (!check()) {
    if (Date.now() > deadline) return false;
    await new Promise((r) => setTimeout(r, 50));
  }
  return true;
}

const GUARDS = ['SIGINT', 'SIGTERM', 'uncaughtException', 'unhandledRejection', 'exit'];

test('a failed start kills the browser, removes its profile and its process guards', { skip }, async (t) => {
  const fake = await fakeBrowser(t);
  const before = Object.fromEntries(GUARDS.map((e) => [e, process.listenerCount(e)]));
  process.env.FAKE_CHROME_OUT = fake.out;
  process.env.FAKE_CHROME_DELAY = '0';
  t.after(() => { delete process.env.FAKE_CHROME_OUT; delete process.env.FAKE_CHROME_DELAY; });
  // Nothing listens on port 9, so the DevTools connection fails after the browser has started.
  await assert.rejects(launch({ executable: fake.executable, graceMs: 200 }), /DevTools WebSocket/);
  const { pid, renderer, profile } = JSON.parse(await readFile(fake.out, 'utf8'));
  t.after(() => reap(renderer));
  assert.match(profile, /recipe-bank-chrome-/);
  assert.equal(existsSync(profile), false, 'profile removed');
  assert.ok(await eventually(() => gone(pid)), 'browser killed');
  assert.ok(await eventually(() => gone(renderer)), 'browser child process killed');
  for (const e of GUARDS) assert.equal(process.listenerCount(e), before[e], `${e} guard removed`);
});

// A crash, process.exit() or Ctrl-C in the process that launched the browser: run in a child process.
async function crashScenario(t, how) {
  const fake = await fakeBrowser(t);
  const script = join(fake.dir, 'runner.mjs');
  await writeFile(script, `import { launch } from ${JSON.stringify(pathToFileURL(join(ROOT, 'scripts', 'browser', 'cdp.mjs')).href)};
launch({ executable: process.env.FAKE_CHROME, graceMs: 100 }).catch(() => {});
// Act once the fake browser is running (it writes its pid and profile first).
const wait = setInterval(async () => {
  const { existsSync } = await import('node:fs');
  if (!existsSync(process.env.FAKE_CHROME_OUT)) return;
  clearInterval(wait);
  setTimeout(() => {
    if (process.env.HOW === 'throw') throw new Error('boom in a listener');
    if (process.env.HOW === 'reject') Promise.reject(new Error('boom in a promise'));
    if (process.env.HOW === 'exit') process.exit(3);
    if (process.env.HOW === 'signal') process.stdout.write('ready\\n');
  }, 200);
}, 50);
`);
  const child = spawn(process.execPath, [script], {
    env: { ...process.env, FAKE_CHROME: fake.executable, FAKE_CHROME_OUT: fake.out, FAKE_CHROME_DELAY: '60000', HOW: how },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stderr = '';
  child.stderr.on('data', (c) => { stderr += c; });
  if (how === 'signal') child.stdout.on('data', (c) => { if (String(c).includes('ready')) child.kill('SIGINT'); });
  const timer = setTimeout(() => child.kill('SIGKILL'), 20_000);
  const code = await new Promise((ok) => child.on('exit', (c, s) => ok(c ?? s)));
  clearTimeout(timer);
  const { pid, renderer, profile } = JSON.parse(await readFile(fake.out, 'utf8'));
  t.after(() => reap(renderer));
  return { code, stderr, pid, renderer, profile };
}

test('an uncaught exception kills the browser, removes the profile and exits 1', { skip }, async (t) => {
  const r = await crashScenario(t, 'throw');
  assert.equal(r.code, 1, r.stderr);
  assert.match(r.stderr, /boom in a listener/);
  assert.equal(existsSync(r.profile), false, 'profile removed');
  assert.ok(await eventually(() => gone(r.pid)), 'browser killed');
  assert.ok(await eventually(() => gone(r.renderer)), 'browser child process killed');
});

test('an unhandled rejection kills the browser, removes the profile and exits 1', { skip }, async (t) => {
  const r = await crashScenario(t, 'reject');
  assert.equal(r.code, 1, r.stderr);
  assert.equal(existsSync(r.profile), false, 'profile removed');
  assert.ok(await eventually(() => gone(r.pid)), 'browser killed');
  assert.ok(await eventually(() => gone(r.renderer)), 'browser child process killed');
});

test('process.exit() still kills the browser and removes the profile', { skip }, async (t) => {
  const r = await crashScenario(t, 'exit');
  assert.equal(r.code, 3, r.stderr);
  assert.equal(existsSync(r.profile), false, 'profile removed');
  assert.ok(await eventually(() => gone(r.pid)), 'browser killed');
  assert.ok(await eventually(() => gone(r.renderer)), 'browser child process killed');
});

test('Ctrl-C kills the browser, removes the profile and exits 130', { skip }, async (t) => {
  const r = await crashScenario(t, 'signal');
  assert.equal(r.code, 130, r.stderr);
  assert.equal(existsSync(r.profile), false, 'profile removed');
  assert.ok(await eventually(() => gone(r.pid)), 'browser killed');
  assert.ok(await eventually(() => gone(r.renderer)), 'browser child process killed');
});

test('killTree kills the process group on POSIX and the whole tree on Windows', () => {
  const kills = [], runs = [];
  killTree(42, { platform: 'linux', kill: (pid, signal) => kills.push([pid, signal]), run: () => assert.fail() });
  assert.deepEqual(kills, [[-42, 'SIGKILL']]);
  killTree(42, { platform: 'darwin', kill: (pid, signal) => { kills.push([pid, signal]); if (pid < 0) throw new Error('ESRCH'); } });
  assert.deepEqual(kills.slice(1), [[-42, 'SIGKILL'], [42, 'SIGKILL']], 'falls back to the pid when there is no group');
  killTree(42, { platform: 'win32', kill: () => assert.fail(), run: (cmd, args) => runs.push([cmd, ...args]) });
  assert.deepEqual(runs, [['taskkill', '/pid', '42', '/t', '/f']]);
  killTree(undefined, { kill: () => assert.fail(), run: () => assert.fail() });
});

test('the static server does not follow a symlink out of its root', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'recipe-static-link-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const root = join(dir, 'dist');
  await mkdir(root, { recursive: true });
  await writeFile(join(root, 'index.html'), '<p>home</p>');
  await writeFile(join(dir, 'secret.txt'), 'SECRET');
  await symlink(join(dir, 'secret.txt'), join(root, 'leak.txt'));
  await writeFile(join(root, 'inside.txt'), 'inside');
  await symlink(join(root, 'inside.txt'), join(root, 'alias.txt'));
  const server = staticServer(root);
  const origin = await listen(server);
  t.after(() => stop(server));
  const port = Number(new URL(origin).port);
  const leak = await get(port, '/leak.txt');
  assert.equal(leak.status, 403);
  assert.ok(!leak.body.includes('SECRET'));
  assert.equal((await get(port, '/alias.txt')).body, 'inside', 'a link that stays inside the root still works');
});
