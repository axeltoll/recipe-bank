// URL shapes people actually paste: trailing-dot hosts, Pinterest language subdomains, X media
// suffixes, and web pages that only pretend to be public hosts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseVideoUrl } from '../lib/video.mjs';
import { resolveShortVideo } from '../lib/video-resolver.mjs';
import { ROOT } from './helpers/bank.mjs';

test('a trailing dot on the host does not escape the platform lists', () => {
  assert.deepEqual(parseVideoUrl('https://www.facebook.com./reel/12345'),
    { platform: 'facebook', id: '12345', url: 'https://www.facebook.com/watch/?v=12345' });
  assert.deepEqual(parseVideoUrl('https://youtube.com./shorts/mhNQ8y5ud0A'),
    { platform: 'youtube', id: 'mhNQ8y5ud0A', url: 'https://www.youtube.com/shorts/mhNQ8y5ud0A' });
  assert.equal(parseVideoUrl('https://x.com./kitchen/status/12345').id, '12345');
  assert.equal(parseVideoUrl('https://www.pinterest.com./pin/12345/').platform, 'pinterest');
  for (const input of ['https://l.facebook.com./l.php?u=https://example.com', 'https://www.facebook.com./reel/nope',
    'https://pinterest.com./pin/nope', 'https://fb.watch./AbC/other']) {
    assert.equal(parseVideoUrl(input, { allowWeb: true }), null, input);
  }
});

test('Pinterest language subdomains are accepted and made canonical; look-alikes are not', () => {
  for (const host of ['br.pinterest.com', 'de.pinterest.com', 'fr.pinterest.fr', 'in.pinterest.com', 'www.pinterest.co.uk']) {
    assert.deepEqual(parseVideoUrl(`https://${host}/pin/12345/`),
      { platform: 'pinterest', id: '12345', url: 'https://www.pinterest.com/pin/12345/' }, host);
  }
  for (const input of ['https://bra.pinterest.com/pin/12345/', 'https://br.pinterest.evil.example/pin/12345/',
    'https://br.br.pinterest.com/pin/12345/', 'https://pinterest.com.br.evil.example/pin/12345/']) {
    assert.equal(parseVideoUrl(input, { allowWeb: true }), null, input);
  }
  // Where a shared pin.it link lands.
  assert.equal(parseVideoUrl('https://www.pinterest.com/pin/12345/sent/?invite_code=abc&sender=1').id, '12345');
  assert.equal(parseVideoUrl('https://www.pinterest.com/pin/12345/other/'), null);
});

test('X links with a /video/<n> or /photo/<n> suffix are the same post', () => {
  for (const suffix of ['/video/1', '/photo/1', '/video/2/', '/photo/4?s=20']) {
    assert.deepEqual(parseVideoUrl(`https://x.com/kitchen/status/12345${suffix}`),
      { platform: 'x', id: '12345', url: 'https://x.com/kitchen/status/12345' }, suffix);
  }
  for (const suffix of ['/video', '/video/one', '/gif/1', '/video/1/extra', '/analytics']) {
    assert.equal(parseVideoUrl(`https://x.com/kitchen/status/12345${suffix}`), null, suffix);
  }
});

test('host names that are also property names match nothing', () => {
  for (const host of ['constructor', '__proto__', 'tostring', 'hasownproperty']) {
    assert.equal(parseVideoUrl(`https://${host}/AbC123`), null, host);
    assert.equal(parseVideoUrl(`https://${host}/AbC123`, { allowWeb: true }), null, host);
  }
});

test('web pages need a dotted public host name, not an IP literal or a single label', () => {
  for (const input of ['https://127.0.0.1/recipe', 'https://192.168.1.10/recipe', 'https://10.0.0.1/x', 'https://2130706433/x',
    'https://0x7f.1/x', 'https://[::1]/recipe', 'https://[2001:db8::1]/recipe', 'https://router/recipe', 'https://localhost/recipe']) {
    assert.equal(parseVideoUrl(input, { allowWeb: true }), null, input);
  }
  for (const input of ['https://example.com/recipe', 'https://cook.example.co.uk/a?b=1', 'https://xn--bcher-kva.example/x']) {
    assert.equal(parseVideoUrl(input, { allowWeb: true })?.platform, 'web', input);
  }
});

test('an http short link is stored as https, so it can be resolved', async (t) => {
  const short = parseVideoUrl('http://vm.tiktok.com/AbC123/?si=share');
  assert.equal(short.url, 'https://vm.tiktok.com/AbC123/');
  const target = 'https://www.tiktok.com/@kitchen/video/12345';
  t.mock.method(globalThis, 'fetch', async (url) => (url === short.url
    ? new Response(null, { status: 302, headers: { location: target } })
    : new Response(null)));
  assert.deepEqual(await resolveShortVideo(short), parseVideoUrl(target));
});

test("pin.it resolves through Pinterest's shortener service and the /sent/ landing page", async (t) => {
  const short = parseVideoUrl('https://pin.it/AbC123');
  const hops = {
    'https://pin.it/AbC123': 'https://api.pinterest.com/url_shortener/AbC123/redirect/',
    'https://api.pinterest.com/url_shortener/AbC123/redirect/': 'https://www.pinterest.com/pin/12345/sent/?invite_code=x',
  };
  const fetch = t.mock.method(globalThis, 'fetch', async (url) => (hops[url]
    ? new Response(null, { status: 302, headers: { location: hops[url] } })
    : new Response(null)));
  assert.deepEqual(await resolveShortVideo(short), { platform: 'pinterest', id: '12345', url: 'https://www.pinterest.com/pin/12345/' });
  assert.equal(fetch.mock.callCount(), 3);
});

test('the shortener hop is allowed only for Pinterest, and never as the result', async (t) => {
  const fetch = t.mock.method(globalThis, 'fetch');
  const pin = parseVideoUrl('https://pin.it/AbC123');
  // It answers 200 itself: no pin id, the short link is kept.
  fetch.mock.mockImplementation(async (url) => (url === pin.url
    ? new Response(null, { status: 302, headers: { location: 'https://api.pinterest.com/url_shortener/AbC123/redirect/' } })
    : new Response(null)));
  assert.equal(await resolveShortVideo(pin), pin);
  // Other paths on the api host, and the same hop for another platform, are refused.
  for (const [video, location] of [
    [pin, 'https://api.pinterest.com/v5/pins/12345'],
    [pin, 'http://api.pinterest.com/url_shortener/AbC123/redirect/'],
    [parseVideoUrl('https://fb.watch/AbC123/'), 'https://api.pinterest.com/url_shortener/AbC123/redirect/'],
  ]) {
    const before = fetch.mock.callCount();
    fetch.mock.mockImplementation(async () => new Response(null, { status: 302, headers: { location } }));
    assert.equal(await resolveShortVideo(video), video, location);
    assert.equal(fetch.mock.callCount() - before, 1, location);
  }
});

test('the X oEmbed request goes to the documented host', async () => {
  const source = await readFile(join(ROOT, 'server.mjs'), 'utf8');
  assert.match(source, /x: 'https:\/\/publish\.twitter\.com\/oembed\?url='/);
});

test('the dashboard labels every platform from the one PLATFORMS table', async () => {
  const core = await readFile(join(ROOT, 'public', 'ui', 'core.js'), 'utf8');
  assert.match(core, /export const PLATFORM = Object\.fromEntries\(PLATFORMS\.map/);
  for (const file of ['recipe.js', 'queue.js', 'home.js', 'add.js']) {
    const src = await readFile(join(ROOT, 'public', 'ui', file), 'utf8');
    for (const m of src.matchAll(/PLATFORM\[[^\]]+\]( \?\? '[^']+')?/g)) assert.ok(m[1], `${file}: ${m[0]} has a fallback label`);
  }
});
