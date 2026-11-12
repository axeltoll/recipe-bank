import test from 'node:test';
import assert from 'node:assert/strict';
import { findChrome, devToolsUrl, StderrParser, Connection, fulfilment, interceptor } from '../scripts/browser/cdp.mjs';

const lookup = (options, available) => findChrome({ ...options, exists: (file) => available.includes(file) });
test('Chrome override is authoritative; PATH lookup is injected and ordered', () => {
  assert.equal(lookup({ env: { CHROME_PATH: '/custom/chrome', PATH: '/bin' } }, ['/custom/chrome', '/bin/chromium']), '/custom/chrome');
  assert.equal(lookup({ env: { CHROME_PATH: '/missing', PATH: '/bin' } }, ['/bin/chromium']), null);
  assert.equal(lookup({ env: { PATH: '/one:/two' }, platform: 'linux' }, ['/two/chromium', '/one/google-chrome']), '/one/google-chrome');
  assert.equal(lookup({ env: {}, platform: 'linux' }, []), null);
});
test('Chrome lookup supports macOS and Windows install paths', () => {
  const mac = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  assert.equal(lookup({ env: {}, platform: 'darwin' }, [mac]), mac);
  const win = 'C:\\Apps\\Google\\Chrome\\Application\\chrome.exe';
  assert.equal(lookup({ env: { PROGRAMFILES: 'C:\\Apps' }, platform: 'win32' }, [win]), win);
  assert.equal(lookup({ env: { PATH: 'C:\\Bin;D:\\Bin' }, platform: 'win32' }, ['D:\\Bin\\chromium.exe']), 'D:\\Bin\\chromium.exe');
});
test('DevTools URL parser handles noise, CRLF, split chunks and multiple lines', () => {
  const url = 'ws://127.0.0.1:1234/devtools/browser/example';
  assert.equal(devToolsUrl('unrelated warning'), null);
  assert.equal(devToolsUrl(`DevTools listening on ${url}\r`), url);
  const parser = new StderrParser();
  assert.equal(parser.push('warning\nDevTools lis'), null);
  assert.equal(parser.push(`tening on ${url}\r`), null);
  assert.equal(parser.push('\nmore output\n'), url);
});
function fakeSocket() {
  return { messages: [], addEventListener() {}, send(data) { this.messages.push(JSON.parse(data)); }, close() {} };
}
test('CDP matches out-of-order replies, isolates sessions and ignores unknown ids', async () => {
  const socket = fakeSocket(), cdp = new Connection(socket);
  const first = cdp.send('One'), second = cdp.send('Two', { n: 2 }, 'session');
  assert.deepEqual(socket.messages, [{ id: 1, method: 'One', params: {} }, { id: 2, method: 'Two', params: { n: 2 }, sessionId: 'session' }]);
  cdp.receive({ id: 900, result: {} });
  cdp.receive({ id: 2, result: 'second' });
  cdp.receive({ id: 1, result: 'first' });
  assert.deepEqual(await Promise.all([first, second]), ['first', 'second']);
  assert.equal(cdp.pending.size, 0);
  let event;
  cdp.listeners.add((value) => { event = value; });
  cdp.receive({ method: 'Event', sessionId: 'session' });
  assert.equal(event.method, 'Event');
});
test('CDP rejects protocol errors, closed connections, send failures and timeouts', async () => {
  const cdp = new Connection(fakeSocket(), 10);
  const protocol = assert.rejects(cdp.send('Bad'), /bad command/);
  cdp.receive({ id: 1, error: { message: 'bad command' } });
  await protocol;
  const closed = assert.rejects(cdp.send('Closed'), /closed/);
  cdp.close();
  await closed;
  const broken = new Connection({ ...fakeSocket(), send() { throw new Error('send failed'); } });
  await assert.rejects(broken.send('Broken'), /send failed/);
  await assert.rejects(cdp.send('Already closed'), /closed/);
  const slow = new Connection(fakeSocket(), 10);
  await assert.rejects(slow.send('Slow'), /timeout/);
  assert.equal(slow.pending.size, 0);
  assert.equal(cdp.pending.size, 0);
});

test('remote assets are stubbed with the right type and CORS; local origins go through', () => {
  const origins = new Set(['http://127.0.0.1:4780']);
  const at = (url, resourceType) => fulfilment({ request: { url }, resourceType }, origins);
  assert.deepEqual(at('http://127.0.0.1:4780/app.js', 'Script'), { method: 'Fetch.continueRequest', params: {} });
  const header = (r, name) => r.params.responseHeaders.find((h) => h.name === name)?.value;
  for (const [type, expected] of [['Stylesheet', 'text/css'], ['Script', 'application/javascript'],
    ['Image', 'image/svg+xml'], ['Font', 'text/html'], ['Document', 'text/html']]) {
    const r = at('https://cdn.example/x', type);
    assert.equal(r.method, 'Fetch.fulfillRequest');
    assert.equal(header(r, 'Content-Type'), expected, type);
    assert.equal(header(r, 'Access-Control-Allow-Origin'), '*', `${type} passes CORS`);
  }
  assert.equal(at('not a url', 'Other').method, 'Fetch.fulfillRequest');
});

test('a paused request Chrome already canceled is not recorded as a page exception', async () => {
  const exceptions = [];
  const failing = (message) => interceptor({ sessionId: 's', origins: () => new Set(), exceptions,
    send: () => Promise.reject(new Error(message)) });
  const event = { sessionId: 's', method: 'Fetch.requestPaused', params: { requestId: 'r1', request: { url: 'https://cdn.example/a.css' }, resourceType: 'Stylesheet' } };
  await failing('Invalid InterceptionId.')(event);
  assert.deepEqual(exceptions, []);
  await failing('Fetch domain is broken')(event);
  assert.deepEqual(exceptions, ['Fetch domain is broken']);
  const sent = [];
  interceptor({ sessionId: 's', origins: () => new Set(), exceptions, send: (m, p) => { sent.push([m, p.requestId]); return Promise.resolve(); } })(event);
  assert.deepEqual(sent, [['Fetch.fulfillRequest', 'r1']]);
  assert.equal(interceptor({ sessionId: 's', origins: () => new Set(), exceptions, send: () => assert.fail() })({ ...event, sessionId: 'other' }), undefined);
});
