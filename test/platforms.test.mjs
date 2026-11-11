import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseVideoUrl, videoKey, embedUrl, thumbnailUrl, PLATFORMS } from '../lib/video.mjs';

const shapes = [
  ['facebook', '12345', 'https://www.facebook.com/watch/?v=12345', [
    'https://facebook.com/watch?v=12345',
    'https://www.facebook.com/watch/?v=12345&si=abc&t=7',
    'https://m.facebook.com/reel/12345/?igsh=abc',
    'https://web.facebook.com/kitchen/videos/12345/',
    'https://facebook.com/kitchen/videos/12345?si=abc',
    'https://facebook.com/reel/12345',
  ]],
  ['pinterest', '12345', 'https://www.pinterest.com/pin/12345/', [
    'https://pinterest.com/pin/12345',
    'https://www.pinterest.com/pin/12345/?si=abc',
    'https://pinterest.co.uk/pin/12345/',
    'https://www.pinterest.se/pin/12345/?igsh=abc&t=7',
    'https://pinterest.com.au/pin/12345/',
  ]],
  ['x', '12345', 'https://x.com/kitchen/status/12345', [
    'https://x.com/kitchen/status/12345',
    'https://www.x.com/kitchen/status/12345/?si=abc&t=7',
    'https://twitter.com/kitchen/status/12345?s=20',
    'https://www.twitter.com/kitchen/status/12345/',
    'https://mobile.twitter.com/kitchen/status/12345',
    'https://mobile.x.com/kitchen/status/12345',
  ]],
];

for (const [platform, id, url, inputs] of shapes) {
  test(`${platform} URL shapes have one canonical URL and deduplication key`, () => {
    for (const input of inputs) {
      const parsed = parseVideoUrl(input);
      assert.deepEqual(parsed, { platform, id, url }, input);
      assert.equal(videoKey(parsed), `${platform}:${id}`, input);
    }
  });
}

test('every Facebook host accepts each supported video path', () => {
  for (const host of ['facebook.com', 'www.facebook.com', 'm.facebook.com', 'web.facebook.com']) {
    for (const path of ['/watch?v=12345', '/watch/?v=12345', '/reel/12345', '/kitchen/videos/12345']) {
      for (const suffix of ['', path.includes('?') ? '&si=abc&igsh=abc&t=7#video' : '/?si=abc&igsh=abc&t=7#video']) {
        assert.deepEqual(parseVideoUrl(`https://${host}${path}${suffix}`), {
          platform: 'facebook', id: '12345', url: 'https://www.facebook.com/watch/?v=12345',
        });
      }
    }
  }
});

test('large numeric platform IDs retain every digit', () => {
  const id = '900719925474099312345';
  for (const [platform, url] of [
    ['facebook', `https://facebook.com/reel/${id}/`],
    ['pinterest', `https://pinterest.com/pin/${id}/`],
    ['x', `https://twitter.com/kitchen/status/${id}`],
  ]) {
    const video = parseVideoUrl(url);
    assert.equal(video.id, id);
    assert.equal(videoKey(video), `${platform}:${id}`);
    assert.equal(videoKey(parseVideoUrl(video.url)), `${platform}:${id}`);
  }
});

// Short links are kept as https://<host>/<code>: an http: link could never be resolved (the resolver
// only fetches HTTPS), and neither a share query nor a trailing slash may make the same link a second entry.
test('short links keep their https host and code and use them as their unresolved key', () => {
  for (const [platform, input, url] of [
    ['facebook', 'https://fb.watch/AbC_123-/', 'https://fb.watch/AbC_123-'],
    ['facebook', 'https://fb.watch/AbC123?si=abc', 'https://fb.watch/AbC123'],
    ['facebook', 'http://fb.watch/AbC123#x', 'https://fb.watch/AbC123'],
    ['facebook', 'https://www.facebook.com/share/r/1AbC23/', 'https://www.facebook.com/share/r/1AbC23'],
    ['pinterest', 'https://pin.it/AbC123', 'https://pin.it/AbC123'],
    ['pinterest', 'https://pin.it/AbC123/?si=abc', 'https://pin.it/AbC123'],
    ['pinterest', 'HTTPS://PIN.IT/AbC123?si=1', 'https://pin.it/AbC123'],
    ['tiktok', 'https://vm.tiktok.com/AbC123/', 'https://vm.tiktok.com/AbC123'],
    ['tiktok', 'http://vm.tiktok.com/AbC123/', 'https://vm.tiktok.com/AbC123'],
    ['tiktok', 'https://vt.tiktok.com/AbC123/?si=abc', 'https://vt.tiktok.com/AbC123'],
    ['tiktok', 'https://vt.tiktok.com./AbC123/', 'https://vt.tiktok.com/AbC123'],
    ['tiktok', 'https://www.tiktok.com/t/ZTAbC123/', 'https://www.tiktok.com/t/ZTAbC123'],
  ]) {
    const parsed = parseVideoUrl(input);
    assert.deepEqual(parsed, { platform, id: null, url }, input);
    assert.equal(videoKey(parsed), url, input);
  }
  // The same link with and without a share query or a trailing slash is one video, also when the stored
  // form is an older one.
  assert.equal(videoKey(parseVideoUrl('https://pin.it/AbC123?si=1')), videoKey(parseVideoUrl('https://pin.it/AbC123')));
  for (const [a, b] of [['https://pin.it/AbC', 'https://pin.it/AbC/'], ['https://fb.watch/AbC', 'https://fb.watch/AbC/'],
    ['https://vm.tiktok.com/AbC', 'https://vm.tiktok.com/AbC/'], ['https://vt.tiktok.com/AbC', 'https://vt.tiktok.com/AbC/']]) {
    assert.equal(videoKey(parseVideoUrl(a)), videoKey(parseVideoUrl(b)), b);
    assert.equal(videoKey({ platform: parseVideoUrl(a).platform, id: null, url: b }), a, `stored ${b}`);
  }
  assert.equal(videoKey({ platform: 'pinterest', id: null, url: 'http://pin.it/AbC123?si=1' }), 'https://pin.it/AbC123');
  assert.equal(videoKey({ platform: 'web', id: null, url: 'https://example.com/r?v=2' }), 'https://example.com/r?v=2');
  assert.equal(videoKey({ platform: 'web', url: 'not a url' }), 'not a url', 'unparseable stored URLs stay as they are');
  assert.equal(videoKey(null), '');
});

test('share links people paste: X /i/web/status, TikTok /t/ and Facebook /share/r|v/', () => {
  for (const input of ['https://x.com/i/web/status/12345', 'https://twitter.com/i/web/status/12345?s=20',
    'https://mobile.x.com/i/web/status/12345/', 'https://x.com/i/web/status/12345/video/1']) {
    assert.deepEqual(parseVideoUrl(input), { platform: 'x', id: '12345', url: 'https://x.com/i/web/status/12345' }, input);
    assert.equal(videoKey(parseVideoUrl(input)), videoKey(parseVideoUrl('https://x.com/kitchen/status/12345')), input);
  }
  // A short link has no id yet: lib/video-resolver.mjs follows it.
  for (const [input, platform, url] of [
    ['https://www.tiktok.com/t/ZTAbC123/', 'tiktok', 'https://www.tiktok.com/t/ZTAbC123'],
    ['https://tiktok.com/t/ZTAbC123?_r=1', 'tiktok', 'https://www.tiktok.com/t/ZTAbC123'],
    ['https://www.facebook.com/share/r/1AbC23/', 'facebook', 'https://www.facebook.com/share/r/1AbC23'],
    ['https://m.facebook.com/share/v/1AbC23?mibextid=x', 'facebook', 'https://www.facebook.com/share/v/1AbC23'],
  ]) assert.deepEqual(parseVideoUrl(input), { platform, id: null, url }, input);
  for (const input of ['https://x.com/i/web/status/abc', 'https://x.com/i/web/12345', 'https://www.tiktok.com/t/',
    'https://www.tiktok.com/t/AbC/other', 'https://www.facebook.com/share/r/', 'https://www.facebook.com/share/x/AbC/',
    'https://www.facebook.com/share/r/AbC/other', 'https://l.facebook.com/share/r/AbC/']) {
    assert.equal(parseVideoUrl(input), null, input);
  }
});

test('rejects dangerous schemes, userinfo, look-alikes and unsupported hosts', () => {
  for (const input of [
    'javascript:alert(1)', 'data:text/html,video',
    'javascript://facebook.com/reel/12345',
    'https://facebook.com@evil.example/reel/12345',
    'https://name:password@facebook.com/reel/12345',
    'https://facebook.com.evil.example/reel/12345',
    'https://l.facebook.com/l.php?u=https://facebook.com/reel/12345',
    'https://evilfacebook.com/reel/12345',
    'https://facebook.com:444/reel/12345',
    'https://pinterest.com.evil.example/pin/12345',
    'https://pinterest.evil.example/pin/12345',
    'https://evilpinterest.com/pin/12345',
    'https://pin.it.evil.example/AbC123',
    'https://fb.watch.evil.example/AbC123',
    'https://twitter.com.evil.example/kitchen/status/12345',
    'https://x.com@evil.example/kitchen/status/12345',
    'ftp://x.com/kitchen/status/12345',
  ]) assert.equal(parseVideoUrl(input), null, input);
});

test('new platforms reject missing, non-numeric and extra path segments', () => {
  for (const input of [
    'https://facebook.com/watch', 'https://facebook.com/watch/?v=',
    'https://facebook.com/watch?v=abc', 'https://facebook.com/reel/',
    'https://facebook.com/reel/abc', 'https://facebook.com/kitchen/videos/abc/',
    'https://facebook.com/kitchen/videos/', 'https://facebook.com/reel/12345/other',
    'https://facebook.com/watch/other?v=12345', 'https://fb.watch/',
    'https://fb.watch/AbC123/other', 'https://pin.it/', 'https://pin.it/AbC123/other',
    'https://pinterest.com/pin/', 'https://pinterest.com/pin/abc/',
    'https://pinterest.com/pin/12345/other', 'https://pinterest.com/kitchen/',
    'https://x.com/kitchen/status/', 'https://x.com/kitchen/status/abc',
    'https://x.com/kitchen/status/12345/other', 'https://twitter.com/kitchen',
    'https://x.com/bad-user/status/12345', 'https://x.com//status/12345',
  ]) assert.equal(parseVideoUrl(input), null, input);
});

test('web pages require an explicit true opt-in, keep their identity and use HTTPS', () => {
  const url = 'https://example.com/recipes/curry?video=2#method';
  for (const options of [undefined, {}, { allowWeb: false }, { allowWeb: 'true' }]) {
    assert.equal(parseVideoUrl(url, options), null);
  }
  const parsed = parseVideoUrl(url, { allowWeb: true });
  assert.deepEqual(parsed, { platform: 'web', id: null, url });
  assert.equal(videoKey(parsed), url);
  assert.equal(parseVideoUrl('  https://EXAMPLE.com:443/recipes  ', { allowWeb: true }).url,
    'https://example.com/recipes');
  for (const input of [
    'http://example.com/recipes', 'ftp://example.com/video', 'data:text/html,video',
    'javascript:alert(1)', 'https://user:password@example.com/video',
    'https://facebook.com@evil.example/reel/12345', 'https://example.com:444/video',
    'https://l.facebook.com/l.php?u=https://example.com',
    'https://facebook.com/reel/abc', 'https://pinterest.com/pin/nope',
  ]) assert.equal(parseVideoUrl(input, { allowWeb: true }), null, input);
  // The opt-in must not turn a supported platform into a web source.
  for (const [, , , inputs] of shapes) {
    for (const input of inputs) assert.deepEqual(parseVideoUrl(input, { allowWeb: true }), parseVideoUrl(input));
  }
});

test('new public embeds use fixed platform URLs; link-only sources have no embed', () => {
  const facebook = new URL(embedUrl(parseVideoUrl('https://facebook.com/reel/12345')));
  assert.equal(facebook.origin + facebook.pathname, 'https://www.facebook.com/plugins/video.php');
  assert.equal(facebook.searchParams.get('href'), 'https://www.facebook.com/watch/?v=12345');
  assert.equal(facebook.searchParams.get('show_text'), 'false');
  assert.equal(embedUrl(parseVideoUrl('https://pinterest.se/pin/12345')),
    'https://assets.pinterest.com/ext/embed.html?id=12345');
  for (const url of ['https://x.com/kitchen/status/12345', 'https://example.com/video',
    'https://fb.watch/AbC123/', 'https://pin.it/AbC123']) {
    const video = parseVideoUrl(url, { allowWeb: true });
    assert.equal(embedUrl(video), null, url);
    assert.equal(thumbnailUrl(video), null, url);
  }
  for (const platform of ['facebook', 'pinterest']) {
    const video = { platform, id: '12345' };
    assert.equal(embedUrl(video, { start: 62.4, autoplay: true }), embedUrl(video));
    assert.equal(embedUrl({ platform, id: '123&other=value', url: 'https://example.com' }), null);
    assert.equal(thumbnailUrl({ platform, id: '12345' }), null);
  }
  assert.equal(embedUrl(null), null);
  assert.equal(thumbnailUrl(null), null);
});

test('PLATFORMS supplies the labels and embed capability for every supported source', () => {
  assert.deepEqual(PLATFORMS.map((p) => p.id), ['youtube', 'tiktok', 'instagram', 'facebook', 'pinterest', 'x', 'web']);
  for (const platform of PLATFORMS) {
    assert.equal(typeof platform.label, 'string');
    assert.equal(typeof platform.embeds, 'boolean');
    assert.ok(Object.isFrozen(platform));
  }
  assert.ok(Object.isFrozen(PLATFORMS));
  assert.equal(PLATFORMS.find((p) => p.id === 'x').embeds, false);
  assert.equal(PLATFORMS.find((p) => p.id === 'web').embeds, false);
});
