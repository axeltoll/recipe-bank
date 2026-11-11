// Minimal Chrome DevTools Protocol driver. Node 22+, no packages.
import { accessSync, constants, rmSync } from 'node:fs';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, win32 } from 'node:path';
import { spawn } from 'node:child_process';

export function findChrome({ env = process.env, platform = process.platform, exists = (file) => {
  try { accessSync(file, platform === 'win32' ? constants.F_OK : constants.X_OK); return true; } catch { return false; }
} } = {}) {
  // An explicit override is authoritative, including when it points at a missing binary.
  if (env.CHROME_PATH) return exists(env.CHROME_PATH) ? env.CHROME_PATH : null;
  const path = platform === 'win32' ? win32 : { join };
  const names = platform === 'win32' ? ['chrome.exe', 'chromium.exe', 'msedge.exe']
    : ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'chrome'];
  // An injected Windows environment may spell it "Path" (process.env itself is case-insensitive there).
  const candidates = (env.PATH ?? env.Path ?? '').split(platform === 'win32' ? ';' : ':').filter(Boolean)
    .flatMap((dir) => names.map((name) => path.join(dir, name)));
  if (platform === 'darwin') candidates.push(
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    join(env.HOME ?? '', 'Applications/Google Chrome.app/Contents/MacOS/Google Chrome'));
  if (platform === 'win32') for (const dir of [env.PROGRAMFILES, env['PROGRAMFILES(X86)'], env.LOCALAPPDATA].filter(Boolean)) {
    candidates.push(win32.join(dir, 'Google/Chrome/Application/chrome.exe'), win32.join(dir, 'Chromium/Application/chrome.exe'));
  }
  return candidates.find(exists) ?? null;
}

export function devToolsUrl(line) {
  return line.match(/DevTools listening on (ws:\/\/[^\s]+)/)?.[1] ?? null;
}

export class StderrParser {
  buffer = '';
  push(chunk) {
    this.buffer += chunk;
    const lines = this.buffer.split(/\r?\n/);
    this.buffer = lines.pop();
    return lines.map(devToolsUrl).find(Boolean) ?? null;
  }
}

export class Connection {
  nextId = 0;
  closed = false;
  pending = new Map();
  listeners = new Set();
  constructor(socket, timeout = 10_000) {
    this.socket = socket;
    this.timeout = timeout;
    socket.addEventListener('message', ({ data }) => this.receive(JSON.parse(data)));
    socket.addEventListener('close', () => this.dispose(new Error('DevTools connection closed')));
    socket.addEventListener('error', () => this.dispose(new Error('DevTools connection failed')));
  }
  send(method, params = {}, sessionId) {
    if (this.closed) return Promise.reject(new Error('DevTools connection closed'));
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`DevTools timeout: ${method}`));
      }, this.timeout);
      this.pending.set(id, { resolve, reject, timer });
      try { this.socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) })); }
      catch (e) { this.receive({ id, error: { message: e.message } }); }
    });
  }
  receive(message) {
    if (message.id != null) {
      const request = this.pending.get(message.id);
      if (!request) return;
      this.pending.delete(message.id);
      clearTimeout(request.timer);
      if (message.error) request.reject(new Error(message.error.message));
      else request.resolve(message.result);
    } else for (const listener of this.listeners) listener(message);
  }
  dispose(error = new Error('DevTools connection closed')) {
    this.closed = true;
    for (const { reject, timer } of this.pending.values()) { clearTimeout(timer); reject(error); }
    this.pending.clear();
  }
  close() { this.dispose(); this.socket.close(); }
}

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Start Chrome with a throw-away profile. Until close() has finished, the browser and its profile are
 * cleaned up on every way out: close(), a failed start, Ctrl-C or SIGTERM (a second one too), an uncaught
 * exception or unhandled rejection anywhere in the process (exit code 1), and, as a last resort,
 * process.exit() (a synchronous kill and profile removal in the 'exit' event).
 */
export async function launch({ headed = false, executable = findChrome(), graceMs = 1500 } = {}) {
  if (!executable) return null;
  const profile = await mkdtemp(join(tmpdir(), 'recipe-bank-chrome-'));
  let child, connection, closing;
  const alive = () => Boolean(child?.pid) && child.exitCode === null && child.signalCode === null;
  const onSignal = () => { close().catch(() => {}).finally(() => process.exit(130)); };
  const onFatal = (error) => {
    console.error(error);
    close().catch(() => {}).finally(() => process.exit(1));
  };
  const onExit = () => {
    // Synchronous only: the event loop is gone.
    try { if (alive()) child.kill('SIGKILL'); } catch { /* already gone */ }
    try { rmSync(profile, { recursive: true, force: true }); } catch { /* best effort */ }
  };
  const guards = [['SIGINT', onSignal], ['SIGTERM', onSignal], ['uncaughtException', onFatal], ['unhandledRejection', onFatal], ['exit', onExit]];
  for (const [event, fn] of guards) process.on(event, fn);
  // Each step has its own try, so a failing step never skips the next; the first error is rethrown.
  const close = () => closing ??= (async () => {
    const errors = [];
    const step = async (fn) => { try { await fn(); } catch (e) { errors.push(e); } };
    await step(async () => {
      if (!alive()) return;
      const exited = new Promise((resolve) => child.once('exit', resolve));
      // Ask Chrome to quit, so its renderer and GPU processes go with it; SIGKILL if it does not in time.
      if (connection && !connection.closed) connection.send('Browser.close').catch(() => {});
      let timer;
      const quit = await Promise.race([exited.then(() => true), new Promise((resolve) => { timer = setTimeout(resolve, graceMs, false); })]);
      clearTimeout(timer);
      if (!quit && alive()) {
        child.kill('SIGKILL');
        await exited;
      }
    });
    await step(() => connection?.close());
    await step(() => rm(profile, { recursive: true, force: true, maxRetries: 3 }));
    for (const [event, fn] of guards) process.off(event, fn);
    if (errors.length) throw errors[0];
  })();
  try {
    child = spawn(executable, [
      ...(headed ? [] : ['--headless=new']), `--user-data-dir=${profile}`, '--remote-debugging-port=0',
      '--no-first-run', '--no-default-browser-check', '--disable-background-networking',
      '--disable-component-update', '--disable-sync', '--disable-extensions',
      // Also prevent DNS/preconnect traffic before request interception is installed.
      '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost', 'about:blank',
    ], { stdio: ['ignore', 'ignore', 'pipe'] });
    const url = await new Promise((resolve, reject) => {
      const parser = new StderrParser();
      const timer = setTimeout(() => finish(new Error('Chrome startup timed out')), 15_000);
      const finish = (error, value) => {
        clearTimeout(timer);
        child.stderr.off('data', onData);
        child.off('error', onError);
        child.off('exit', onExit);
        error ? reject(error) : resolve(value);
      };
      const onData = (chunk) => { const found = parser.push(String(chunk)); if (found) finish(null, found); };
      const onError = () => finish(new Error('Chrome could not start'));
      const onExit = (code, signal) => finish(new Error(`Chrome exited during startup (${signal ?? code})`));
      child.stderr.on('data', onData);
      child.once('error', onError);
      child.once('exit', onExit);
    });
    child.stderr.resume();
    // A later 'error' (a failed kill, say) must not become an uncaught exception.
    child.on('error', () => {});
    const socket = new WebSocket(url);
    connection = new Connection(socket);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('DevTools WebSocket timed out')), 10_000);
      socket.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
      socket.addEventListener('error', () => { clearTimeout(timer); reject(new Error('DevTools WebSocket failed')); }, { once: true });
    });
    const { targetId } = await connection.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await connection.send('Target.attachToTarget', { targetId, flatten: true });
    const send = (method, params) => connection.send(method, params, sessionId);
    const consoleMessages = [], exceptions = [], loaded = new Set();
    let origins = new Set(), intercepting = false;
    connection.listeners.add((event) => {
      if (event.sessionId !== sessionId) return;
      const p = event.params;
      if (event.method === 'Runtime.consoleAPICalled') consoleMessages.push({ type: p.type, text: p.args.map((a) => a.value ?? a.description ?? '').join(' ') });
      if (event.method === 'Runtime.exceptionThrown') exceptions.push(p.exceptionDetails.exception?.description ?? p.exceptionDetails.text);
      if (event.method === 'Log.entryAdded' && p.entry.level === 'error') consoleMessages.push({ type: 'error', text: p.entry.text });
      if (event.method === 'Page.lifecycleEvent' && p.name === 'load') loaded.add(p.loaderId);
    });
    const page = {
      console: consoleMessages, exceptions, send,
      async evaluate(fn) {
        const result = await send('Runtime.evaluate', {
          expression: typeof fn === 'function' ? `(${fn})()` : fn, awaitPromise: true, returnByValue: true,
        });
        if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
        return result.result.value;
      },
      async waitFor(selectorOrPredicate, timeout = 5000) {
        const expression = typeof selectorOrPredicate === 'string'
          ? `Boolean(document.querySelector(${JSON.stringify(selectorOrPredicate)}))` : selectorOrPredicate;
        const deadline = Date.now() + timeout;
        do {
          if (await page.evaluate(expression)) return;
          await pause(50);
        } while (Date.now() < deadline);
        throw new Error('Timed out waiting for page condition');
      },
      async goto(url) {
        const result = await send('Page.navigate', { url });
        if (result.errorText) throw new Error(`Navigation failed: ${result.errorText}`);
        const deadline = Date.now() + 10_000;
        while (result.loaderId && !loaded.has(result.loaderId)) {
          if (Date.now() > deadline) throw new Error('Navigation load timed out');
          await pause(50);
        }
      },
      async click(selector) {
        const point = await page.evaluate(`(() => {
          const el = document.querySelector(${JSON.stringify(selector)});
          if (!el) throw new Error('Click target missing');
          el.scrollIntoView({block: 'center', inline: 'center', behavior: 'instant'});
          const r = el.getBoundingClientRect();
          if (!r.width || !r.height) throw new Error('Click target hidden');
          return {x: r.x + r.width / 2, y: r.y + r.height / 2};
        })()`);
        await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 });
        await send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: 1 });
      },
      async setViewport(width, height, mobile = false) {
        await send('Emulation.setDeviceMetricsOverride', { width, height, mobile, deviceScaleFactor: 1 });
        await send('Emulation.setTouchEmulationEnabled', { enabled: mobile });
      },
      async screenshot(path) {
        const { data } = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
        await mkdir(dirname(path), { recursive: true });
        await writeFile(path, Buffer.from(data, 'base64'));
      },
      // Fulfil remote assets locally: tests must not call video, image or font services.
      async localOnly(origin) {
        origins = new Set(Array.isArray(origin) ? origin : [origin]);
        if (intercepting) return;
        intercepting = true;
        connection.listeners.add((event) => {
          if (event.sessionId !== sessionId || event.method !== 'Fetch.requestPaused') return;
          const { requestId, request, resourceType } = event.params;
          const local = origins.has(new URL(request.url).origin);
          const body = resourceType === 'Image'
            ? '<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"><rect width="4" height="4" fill="#ddd"/></svg>' : '';
          const params = local ? { requestId } : {
            requestId, responseCode: 200, body: Buffer.from(body).toString('base64'),
            responseHeaders: [{ name: 'Content-Type', value: resourceType === 'Image' ? 'image/svg+xml' : resourceType === 'Stylesheet' ? 'text/css' : 'text/html' }],
          };
          send(local ? 'Fetch.continueRequest' : 'Fetch.fulfillRequest', params).catch((e) => exceptions.push(e.message));
        });
        await send('Fetch.enable', { patterns: [{ urlPattern: '*' }] });
      },
    };
    await send('Page.enable');
    await send('Page.setLifecycleEventsEnabled', { enabled: true });
    await send('Runtime.enable');
    await send('Log.enable');
    return { page, close };
  } catch (e) {
    // The startup error is the one worth reporting, not a cleanup error after it.
    await close().catch(() => {});
    throw e;
  }
}
