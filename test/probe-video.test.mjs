// Probes of video-link parsing (lib/video.mjs) and short-link resolution (lib/video-resolver.mjs, with a
// mocked fetch): look-alike hosts, odd ids, unicode hosts, fragments, embed URLs and hostile redirects.
// Real bugs are marked `todo`.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseVideoUrl, videoKey, embedUrl, thumbnailUrl } from '../lib/video.mjs';
import { resolveShortVideo } from '../lib/video-resolver.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const RECIPES = readdirSync(join(ROOT, 'recipes')).filter((f) => f.endsWith('.json'))
  .map((f) => JSON.parse(readFileSync(join(ROOT, 'recipes', f), 'utf8')));
const ID = 'abcdefghijk';

test('every recipe link parses to its own platform and id, and parsing is idempotent', () => {
  for (const r of RECIPES) {
    const v = parseVideoUrl(r.video.url, { allowWeb: r.video.platform === 'web' });
    assert.equal(v.platform, r.video.platform, r.id);
    assert.equal(v.id ?? null, r.video.id ?? null, r.id);
    assert.deepEqual(parseVideoUrl(v.url, { allowWeb: v.platform === 'web' }), v, r.id);
  }
});

test('look-alike, credentialed, port-carrying and non-http links are refused', () => {
  for (const u of [
    `https://www.youtube.com.evil.example/shorts/${ID}`, `https://evil.example/youtube.com/shorts/${ID}`, `https://youtube.com.evil.example/watch?v=${ID}`,
    `https://user@youtube.com/shorts/${ID}`, `https://youtube.com:8443/shorts/${ID}`, `ftp://youtube.com/shorts/${ID}`, `javascript://youtube.com/shorts/${ID}`,
    'https://pinterest.com.evil.example/pin/1/', 'https://xx.pinterest.evil.example/pin/1/', 'https://facebook.com.evil.example/reel/1',
    'https://notx.com/a/status/1', `https://fakeyoutu.be/${ID}`, 'https://fb.watch.evil.example/abc', '', '   ', null, undefined, {}, 42,
  ]) {
    assert.equal(parseVideoUrl(u), null, String(u));
  }
});

test('a broken link on a known service never falls back to a web page', () => {
  for (const u of ['https://www.youtube.com/channel/x', 'https://www.instagram.com/cook/', 'https://www.facebook.com/cook', 'https://pin.it/a/b', 'https://de.pinterest.com/cook/', 'https://x.com/cook']) {
    assert.equal(parseVideoUrl(u, { allowWeb: true }), null, u);
  }
});

test('equivalent spellings of one video give one key', () => {
  const forms = [
    `https://youtu.be/${ID}`, `https://youtu.be./${ID}?t=30`, `HTTPS://WWW.YOUTUBE.COM/watch?v=${ID}&feature=share`, `https://m.youtube.com/watch?v=${ID}#t=10`,
    `https://www.youtube.com/shorts/${ID}?si=x`, `https://youtube.com:443/embed/${ID}`, `http://youtube.com/live/${ID}`, `https://music.youtube.com/watch?v=${ID}`,
  ];
  assert.equal(new Set(forms.map((u) => videoKey(parseVideoUrl(u)))).size, 1);
  assert.equal(videoKey(parseVideoUrl('http://pin.it/AbC?si=1')), videoKey(parseVideoUrl('https://pin.it/AbC')));
});

test('a web page with and without a #fragment is one page (one queue entry, one recipe)',
  { todo: 'design decision: docs/PLATFORMS.md keeps the query and fragment of a web page because they can identify a particular video, so https://site/recipe#step-2 and https://site/recipe are different dedupe keys on purpose' },
  () => {
    const a = parseVideoUrl('https://cooking.example.com/recipe', { allowWeb: true });
    const b = parseVideoUrl('https://cooking.example.com/recipe#step-2', { allowWeb: true });
    assert.equal(videoKey(b), videoKey(a));
  });

test('web pages need a public dotted host name, HTTPS and the explicit opt-in', () => {
  for (const u of ['https://localhost/x', 'https://intranet/x', 'https://192.168.0.1/x', 'https://[::1]/x', 'https://0x7f.0.0.1/x', 'https://2130706433/x', 'http://example.com/x', 'https://a@example.com/x']) {
    assert.equal(parseVideoUrl(u, { allowWeb: true }), null, u);
  }
  assert.equal(parseVideoUrl('https://example.com/x'), null);
  assert.equal(parseVideoUrl('https://example.com/x', { allowWeb: 'yes' }), null);
  assert.equal(parseVideoUrl('https://example.com/x', { allowWeb: true }).platform, 'web');
});

test('Instagram ids are plain shortcodes, never encoded paths or quotes',
  () => {
    for (const u of ['https://www.instagram.com/reel/..%2F..%2Fx/', 'https://instagram.com/p/A%22B/', 'https://instagram.com/reel/a%3Cb/']) {
      assert.equal(parseVideoUrl(u), null, u);
    }
  });

test('embed and thumbnail URLs stay on the platform hosts and encode the start time', () => {
  for (const r of RECIPES) {
    const e = embedUrl(r.video, { start: 12.9 });
    if (e) assert.match(new URL(e).hostname, /(^|\.)(youtube-nocookie\.com|tiktok\.com|instagram\.com|facebook\.com|pinterest\.com)$/, r.id);
    const t = thumbnailUrl(r.video);
    if (t) assert.equal(new URL(t).hostname, 'i.ytimg.com');
  }
  assert.match(embedUrl({ platform: 'youtube', id: ID }, { start: 12.9 }), /start=12(&|$)/);
  assert.doesNotMatch(embedUrl({ platform: 'youtube', id: ID }, { start: -5 }), /start=/);
  for (const v of [null, {}, { platform: 'web', id: null, url: 'https://example.com' }, { platform: 'x', id: '1' }, { platform: 'facebook', id: 'abc' }, { platform: 'pinterest', id: '1"' }]) {
    assert.equal(embedUrl(v), null, JSON.stringify(v));
  }
});

// ---------- short links, with fetch mocked ----------

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

function mockFetch(routes) {
  const calls = [];
  globalThis.fetch = async (url, opts) => {
    calls.push({ url, method: opts?.method });
    const r = routes[url];
    if (!r) throw new Error(`unexpected fetch ${url}`);
    if (r === 'hang') return new Promise((_, fail) => opts.signal.addEventListener('abort', () => fail(opts.signal.reason)));
    return new Response(null, { status: r.status, headers: r.location ? { location: r.location } : {} });
  };
  return calls;
}

test('short-link resolution only ever sends HEAD requests to the platform hosts', async () => {
  // The parser stores short links without a trailing slash, so that is the URL requested first.
  // The resolver also follows TikTok /t/ and Facebook /share/r|v/ hops, through the same host allowlist.
  const calls = mockFetch({
    'https://vm.tiktok.com/ZMabc': { status: 301, location: 'https://www.tiktok.com/t/ZTabc/' },
    'https://www.tiktok.com/t/ZTabc/': { status: 301, location: 'https://www.tiktok.com/@cook/video/123?is_from_webapp=1' },
    'https://www.tiktok.com/@cook/video/123?is_from_webapp=1': { status: 200 },
    'https://www.facebook.com/share/r/abc': { status: 302, location: 'https://www.facebook.com/reel/1234567890/' },
    'https://www.facebook.com/reel/1234567890/': { status: 200 },
  });
  const v = await resolveShortVideo(parseVideoUrl('https://vm.tiktok.com/ZMabc/'));
  assert.deepEqual(v, { platform: 'tiktok', id: '123', url: 'https://www.tiktok.com/@cook/video/123' });
  const fb = await resolveShortVideo(parseVideoUrl('https://www.facebook.com/share/r/abc/'));
  assert.deepEqual(fb, { platform: 'facebook', id: '1234567890', url: 'https://www.facebook.com/watch/?v=1234567890' });
  assert.equal(calls.length, 5);
  assert.ok(calls.every((c) => c.method === 'HEAD'));
  assert.ok(calls.every((c) => ['vm.tiktok.com', 'www.tiktok.com', 'www.facebook.com'].includes(new URL(c.url).hostname)));
});

test('redirects to other hosts, other platforms, credentials, ports, http or javascript are not followed', async () => {
  for (const location of [
    'https://evil.example/video/1', 'http://www.tiktok.com/@a/video/1', 'https://user@www.tiktok.com/@a/video/1', 'https://www.tiktok.com:444/@a/video/1',
    `https://www.youtube.com/shorts/${ID}`, 'javascript:alert(1)', 'https://www.tiktok.com.evil.example/@a/video/1', '//evil.example/x', 'data:text/plain,x',
  ]) {
    const calls = mockFetch({ 'https://vm.tiktok.com/ZMabc': { status: 302, location } });
    const v = await resolveShortVideo(parseVideoUrl('https://vm.tiktok.com/ZMabc/'));
    assert.equal(v.id, null, location);
    assert.equal(calls.length, 1, location);
  }
});

test('a provider that never answers costs at most the three-second budget', async () => {
  mockFetch({ 'https://pin.it/AbC': 'hang' });
  const start = Date.now();
  const v = await resolveShortVideo(parseVideoUrl('https://pin.it/AbC'));
  assert.equal(v.id, null);
  assert.ok(Date.now() - start < 4000);
});

test('resolution of a non-short or null video makes no request', async () => {
  const calls = mockFetch({});
  assert.equal(await resolveShortVideo(null), null);
  const v = parseVideoUrl(`https://youtu.be/${ID}`);
  assert.equal(await resolveShortVideo(v), v);
  const web = parseVideoUrl('https://example.com/r', { allowWeb: true });
  assert.equal(await resolveShortVideo(web), web);
  assert.equal(calls.length, 0);
});
