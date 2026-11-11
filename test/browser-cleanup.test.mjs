// The browser checks must never leave Chrome running or its profile on disk, and their static server
// must never serve a file outside dist/. A fake "Chrome" (a small Node script) stands in for the browser:
// it records its pid and profile folder, then prints the DevTools line after a chosen delay.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { request as httpRequest } from 'node:http';
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { chmod, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { launch } from '../scripts/browser/cdp.mjs';
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

// ---------- launch and close with a fake browser ----------

const posix = process.platform !== 'win32' && !/\s/.test(process.execPath);
const skip = posix ? false : 'needs a POSIX shebang script as the fake browser';

async function fakeBrowser(t) {
  const dir = await mkdtemp(join(tmpdir(), 'recipe-fake-chrome-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const executable = join(dir, 'fake-chrome');
  await writeFile(executable, `#!${process.execPath}
const { writeFileSync } = require('node:fs');
const profile = process.argv.find((a) => a.startsWith('--user-data-dir='))?.slice('--user-data-dir='.length);
writeFileSync(process.env.FAKE_CHROME_OUT, JSON.stringify({ pid: process.pid, profile }));
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
  const { pid, profile } = JSON.parse(await readFile(fake.out, 'utf8'));
  assert.match(profile, /recipe-bank-chrome-/);
  assert.equal(existsSync(profile), false, 'profile removed');
  assert.ok(await eventually(() => gone(pid)), 'browser killed');
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
  const { pid, profile } = JSON.parse(await readFile(fake.out, 'utf8'));
  return { code, stderr, pid, profile };
}

test('an uncaught exception kills the browser, removes the profile and exits 1', { skip }, async (t) => {
  const r = await crashScenario(t, 'throw');
  assert.equal(r.code, 1, r.stderr);
  assert.match(r.stderr, /boom in a listener/);
  assert.equal(existsSync(r.profile), false, 'profile removed');
  assert.ok(await eventually(() => gone(r.pid)), 'browser killed');
});

test('an unhandled rejection kills the browser, removes the profile and exits 1', { skip }, async (t) => {
  const r = await crashScenario(t, 'reject');
  assert.equal(r.code, 1, r.stderr);
  assert.equal(existsSync(r.profile), false, 'profile removed');
  assert.ok(await eventually(() => gone(r.pid)), 'browser killed');
});

test('process.exit() still kills the browser and removes the profile', { skip }, async (t) => {
  const r = await crashScenario(t, 'exit');
  assert.equal(r.code, 3, r.stderr);
  assert.equal(existsSync(r.profile), false, 'profile removed');
  assert.ok(await eventually(() => gone(r.pid)), 'browser killed');
});

test('Ctrl-C kills the browser, removes the profile and exits 130', { skip }, async (t) => {
  const r = await crashScenario(t, 'signal');
  assert.equal(r.code, 130, r.stderr);
  assert.equal(existsSync(r.profile), false, 'profile removed');
  assert.ok(await eventually(() => gone(r.pid)), 'browser killed');
});
