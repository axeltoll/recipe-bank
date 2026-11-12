import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveShortVideo } from '../lib/video-resolver.mjs';
import { parseVideoUrl, videoKey } from '../lib/video.mjs';

const redirect = (location, status = 302) => new Response(null, { status, headers: { location } });
const pairs = [
  ['https://fb.watch/AbC123/', 'https://m.facebook.com/kitchen/videos/12345/?si=abc'],
  ['https://pin.it/AbC123', 'https://www.pinterest.co.uk/pin/12345/'],
  ['https://vm.tiktok.com/AbC123/', 'https://www.tiktok.com/@kitchen/video/12345?si=abc'],
  ['https://vt.tiktok.com/AbC123/', 'https://m.tiktok.com/@kitchen/video/12345'],
  ['https://www.tiktok.com/t/ZTAbC123/', 'https://www.tiktok.com/@kitchen/video/12345'],
  ['https://www.facebook.com/share/r/1AbC23/', 'https://www.facebook.com/reel/12345/?mibextid=x'],
  ['https://www.facebook.com/share/v/1AbC23/', 'https://www.facebook.com/kitchen/videos/12345/'],
];

for (const [source, target] of pairs) {
  test(`resolves ${source.slice('https://'.length)} to a canonical video`, async (t) => {
    const video = parseVideoUrl(source);
    const fetch = t.mock.method(globalThis, 'fetch', async (url, options) => {
      assert.equal(options.method, 'HEAD');
      assert.equal(options.redirect, 'manual');
      assert.ok(options.signal instanceof AbortSignal);
      assert.ok([video.url, target].includes(url));
      return url === video.url ? redirect(target) : new Response(null);
    });
    const resolved = await resolveShortVideo(video);
    assert.deepEqual(resolved, parseVideoUrl(target));
    assert.equal(videoKey(resolved), `${video.platform}:12345`);
    assert.equal(fetch.mock.callCount(), 2);
    assert.equal(fetch.mock.calls[0].arguments[1].signal, fetch.mock.calls[1].arguments[1].signal);
    assert.deepEqual(video, parseVideoUrl(source));
  });
}

test('allows three same-platform redirects including relative locations', async (t) => {
  const video = parseVideoUrl(pairs[0][0]);
  const urls = [video.url, 'https://fb.watch/step2/', 'https://fb.watch/step3/',
    'https://www.facebook.com/reel/12345/'];
  let calls = 0;
  const fetch = t.mock.method(globalThis, 'fetch', async (url) => {
    assert.equal(url, urls[calls++]);
    if (url === urls[0]) return redirect('/step2/', 301);
    if (url === urls[1]) return redirect('/step3/', 307);
    if (url === urls[2]) return redirect(urls[3], 308);
    return new Response(null);
  });
  assert.deepEqual(await resolveShortVideo(video), parseVideoUrl(urls[3]));
  assert.equal(fetch.mock.callCount(), 4);
});

test('a vm.tiktok.com link may pass through a tiktok.com/t/ hop', async (t) => {
  const video = parseVideoUrl('https://vm.tiktok.com/ZMAbC123/');
  const urls = [video.url, 'https://www.tiktok.com/t/ZTAbC123/', 'https://www.tiktok.com/@kitchen/video/12345'];
  let calls = 0;
  const fetch = t.mock.method(globalThis, 'fetch', async (url) => {
    assert.equal(url, urls[calls++]);
    return url === urls[2] ? new Response(null) : redirect(urls[calls]);
  });
  assert.deepEqual(await resolveShortVideo(video), parseVideoUrl(urls[2]));
  assert.equal(fetch.mock.callCount(), 3);
});

test('a fourth redirect is not followed and keeps the short link', async (t) => {
  const video = parseVideoUrl(pairs[0][0]);
  const fetch = t.mock.method(globalThis, 'fetch', async () => redirect(`https://fb.watch/hop${fetch.mock.callCount()}/`));
  assert.equal(await resolveShortVideo(video), video);
  assert.equal(fetch.mock.callCount(), 4);
});

test('never follows unsafe, look-alike or cross-platform redirects', async (t) => {
  const fetch = t.mock.method(globalThis, 'fetch');
  for (const [source] of pairs) {
    const video = parseVideoUrl(source);
    for (const target of [
      'https://evil.example/video', 'http://www.facebook.com/reel/12345/',
      'https://facebook.com.evil.example/reel/12345/',
      'https://facebook.com@evil.example/reel/12345/',
      'https://user:password@www.facebook.com/reel/12345/',
      'https://www.facebook.com:444/reel/12345/',
      'https://l.facebook.com/l.php?u=https://example.com',
      'https://pinterest.com.evil.example/pin/12345/',
      'https://untrusted.tiktok.com/@kitchen/video/12345',
      'javascript:alert(1)', 'data:text/html,video',
      'https://x.com/kitchen/status/12345',
    ]) {
      const before = fetch.mock.callCount();
      fetch.mock.mockImplementation(async () => redirect(target));
      assert.equal(await resolveShortVideo(video), video, target);
      assert.equal(fetch.mock.callCount() - before, 1, target);
    }
  }
  const fb = parseVideoUrl(pairs[0][0]);
  const pin = parseVideoUrl(pairs[1][0]);
  fetch.mock.mockImplementation(async () => redirect(pairs[1][1]));
  assert.equal(await resolveShortVideo(fb), fb);
  fetch.mock.mockImplementation(async () => redirect(pairs[0][1]));
  assert.equal(await resolveShortVideo(pin), pin);
});

test('failures, redirect loops, missing locations and unresolved responses keep the original', async (t) => {
  const video = parseVideoUrl(pairs[0][0]);
  const fetch = t.mock.method(globalThis, 'fetch');
  for (const response of [new Response(null, { status: 405 }), new Response(null, { status: 503 }),
    new Response(null, { status: 302 }), redirect('https://['), redirect(video.url), new Response(null)]) {
    const before = fetch.mock.callCount();
    fetch.mock.mockImplementation(async () => response);
    assert.equal(await resolveShortVideo(video), video);
    assert.equal(fetch.mock.callCount() - before, 1);
  }
  fetch.mock.mockImplementation(async () => { throw new TypeError('offline'); });
  assert.equal(await resolveShortVideo(video), video);
});

test('uses one three-second timeout for the whole redirect chain', async (t) => {
  const controller = new AbortController();
  const timeout = t.mock.method(AbortSignal, 'timeout', () => controller.signal);
  let calls = 0;
  const fetch = t.mock.method(globalThis, 'fetch', async (url, { signal }) => {
    assert.equal(signal, controller.signal);
    if (++calls === 1) return redirect(pairs[0][1]);
    controller.abort(new DOMException('Timed out', 'TimeoutError'));
    signal.throwIfAborted();
  });
  const video = parseVideoUrl(pairs[0][0]);
  assert.equal(await resolveShortVideo(video), video);
  assert.equal(fetch.mock.callCount(), 2);
  assert.equal(timeout.mock.callCount(), 1);
  assert.deepEqual(timeout.mock.calls[0].arguments, [3000]);
});

test('does not request full URLs, arbitrary pages, HTTP links or untrusted short hosts', async (t) => {
  const fetch = t.mock.method(globalThis, 'fetch', () => { throw new Error('unexpected network request'); });
  for (const input of [pairs[0][1], pairs[1][1], pairs[2][1], 'https://example.com/video']) {
    const video = parseVideoUrl(input, { allowWeb: true });
    assert.equal(await resolveShortVideo(video), video);
  }
  // The parser now stores http short links as https (test/platform-nits.test.mjs); an http link that
  // reaches the resolver some other way is still never requested.
  for (const [platform, url] of [['facebook', 'https://fb.watch.evil.example/AbC123'], ['facebook', 'https://fb.watch@evil.example/AbC123'],
    ['facebook', 'https://user:password@fb.watch/AbC123'], ['facebook', 'https://fb.watch:444/AbC123'],
    ['facebook', 'http://fb.watch/AbC123/'], ['tiktok', 'http://vm.tiktok.com/AbC123/'],
    ['tiktok', 'https://untrusted.tiktok.com/t/AbC123/'], ['facebook', 'https://l.facebook.com/share/r/AbC123/']]) {
    const video = { platform, id: null, url };
    assert.equal(await resolveShortVideo(video), video);
  }
  assert.equal(await resolveShortVideo(null), null);
  assert.equal(fetch.mock.callCount(), 0);
});
