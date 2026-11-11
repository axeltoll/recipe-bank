import { test } from 'node:test';
import assert from 'node:assert/strict';
import { oembed } from '../server.mjs';
import { parseVideoUrl } from '../lib/video.mjs';

// Replace fetch for every test; no call can reach a third-party service.
const sources = [
  ['https://youtu.be/mhNQ8y5ud0A', 'https://www.youtube.com/oembed'],
  ['https://www.tiktok.com/@kitchen/video/12345', 'https://www.tiktok.com/oembed'],
  ['https://www.pinterest.com/pin/12345/', 'https://www.pinterest.com/oembed.json'],
  // X documents its oEmbed endpoint on the twitter.com host.
  ['https://x.com/kitchen/status/12345', 'https://publish.twitter.com/oembed'],
];

test('public key-free oEmbed providers supply title and creator metadata', async (t) => {
  const fetch = t.mock.method(globalThis, 'fetch', async (input, options) => {
    assert.ok(options.signal instanceof AbortSignal);
    assert.equal(options.signal.aborted, false);
    return new Response(JSON.stringify({ title: 'Recipe video', author_name: 'Kitchen',
      author_url: 'https://example.com/kitchen', html: '<script>never used</script>' }));
  });
  for (const [input, endpoint] of sources) {
    const video = parseVideoUrl(input);
    assert.deepEqual(await oembed(video), { title: 'Recipe video', creator: 'Kitchen', creatorUrl: 'https://example.com/kitchen' });
    const [url] = fetch.mock.calls.at(-1).arguments;
    const actual = new URL(url);
    assert.equal(actual.origin + actual.pathname, endpoint);
    assert.equal(actual.searchParams.get('url'), video.url);
    assert.equal(actual.username, '');
    assert.equal(actual.searchParams.has('access_token'), false);
  }
  assert.equal(fetch.mock.callCount(), sources.length);
});

test('oEmbed skips token-required platforms and arbitrary web pages', async (t) => {
  const fetch = t.mock.method(globalThis, 'fetch', () => { throw new Error('unexpected network request'); });
  for (const input of ['https://facebook.com/reel/12345', 'https://fb.watch/AbC123/',
    'https://instagram.com/reel/AbC123/', 'https://example.com/recipe']) {
    assert.deepEqual(await oembed(parseVideoUrl(input, { allowWeb: true })), {});
  }
  assert.equal(fetch.mock.callCount(), 0);
});

test('oEmbed ignores error status, non-JSON bodies and network failures', async (t) => {
  const fetch = t.mock.method(globalThis, 'fetch');
  for (const [input] of sources) {
    const video = parseVideoUrl(input);
    fetch.mock.mockImplementation(async () => new Response('Unavailable', { status: 503 }));
    assert.deepEqual(await oembed(video), {});
    fetch.mock.mockImplementation(async () => new Response('<html>Not JSON</html>'));
    assert.deepEqual(await oembed(video), {});
    fetch.mock.mockImplementation(async () => { throw new TypeError('offline'); });
    assert.deepEqual(await oembed(video), {});
  }
});

test('oEmbed retains its five-second timeout and tolerates aborts', async (t) => {
  const signal = AbortSignal.abort(new DOMException('Timed out', 'TimeoutError'));
  const timeout = t.mock.method(AbortSignal, 'timeout', () => signal);
  const fetch = t.mock.method(globalThis, 'fetch', async (input, options) => {
    assert.equal(options.signal, signal);
    options.signal.throwIfAborted();
  });
  assert.deepEqual(await oembed(parseVideoUrl(sources[3][0])), {});
  assert.equal(fetch.mock.callCount(), 1);
  assert.deepEqual(timeout.mock.calls[0].arguments, [5000]);
});

test('oEmbed keeps only plain text and an http(s) creator link from the provider', async (t) => {
  const answers = [
    [{ title: 'T', author_name: 'A', author_url: 'javascript:alert(1)' }, { title: 'T', creator: 'A', creatorUrl: null }],
    [{ title: 'T', author_name: 'A', author_url: ' JavaScript:alert(1)' }, { title: 'T', creator: 'A', creatorUrl: null }],
    [{ title: 'T', author_name: 'A', author_url: 'data:text/html,x' }, { title: 'T', creator: 'A', creatorUrl: null }],
    [{ title: { html: '<b>' }, author_name: 7, author_url: 42 }, { title: null, creator: null, creatorUrl: null }],
    [{ title: '  Spaced  ', author_name: 'A', author_url: 'http://example.com/a' }, { title: 'Spaced', creator: 'A', creatorUrl: 'http://example.com/a' }],
    [{ title: 'x'.repeat(1000) }, { title: 'x'.repeat(300), creator: null, creatorUrl: null }],
    [null, { title: null, creator: null, creatorUrl: null }],
  ];
  const fetch = t.mock.method(globalThis, 'fetch');
  for (const [body, expected] of answers) {
    fetch.mock.mockImplementation(async () => new Response(JSON.stringify(body)));
    assert.deepEqual(await oembed(parseVideoUrl(sources[0][0])), expected, JSON.stringify(body));
  }
});

test('oEmbed tolerates an absent title (common on X) and missing author fields', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => new Response('{}'));
  assert.deepEqual(await oembed(parseVideoUrl(sources[3][0])), { title: null, creator: null, creatorUrl: null });
});
