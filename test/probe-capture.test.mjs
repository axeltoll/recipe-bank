// Probes of capture planning (scripts/capture.mjs): capture folder names from odd video ids, folder
// containment edge cases and the argv of every planned command. Nothing is executed or downloaded.
// Real bugs are marked `todo`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { buildCapturePlan, captureKey, captureMain, isInside, resolveCaptureDir, captionLanguages, isOriginalCaption, hasCaptionText } from '../scripts/capture.mjs';
import { parseVideoUrl } from '../lib/video.mjs';

const URLS = [
  'https://youtu.be/abcdefghijk', 'https://www.tiktok.com/@cook/video/123', 'https://vm.tiktok.com/ZMabc/', 'https://www.instagram.com/reel/C0de_-x/',
  'https://www.instagram.com/reel/..%2F..%2Fx/', 'https://www.instagram.com/reel/a%25b/', 'https://www.facebook.com/watch?v=1', 'https://fb.watch/abc',
  'https://de.pinterest.com/pin/123/', 'https://pin.it/AbC', 'https://x.com/cook/status/1',
];

// The parser refuses Instagram ids holding "%" or "/"; capture names are still safe for hand-made ones.
const HOSTILE = [{ platform: 'instagram', id: '../../x', url: 'https://www.instagram.com/reel/x/' }, { platform: 'instagram', id: 'a%b', url: 'https://www.instagram.com/reel/x/' }];

test('every capture folder name is one safe path segment', () => {
  for (const url of [...URLS, ...HOSTILE]) {
    const video = typeof url === 'string' ? parseVideoUrl(url) : url;
    if (!video) continue; // refused by the parser
    const key = captureKey(video);
    assert.match(key, /^[a-z]+-[A-Za-z0-9._-]+$/, video.url);
    assert.ok(!key.includes('..') || !key.includes('/'), url);
    assert.equal(path.basename(key), key);
    const dir = resolveCaptureDir(video, { env: { RECIPE_BANK_CAPTURE_DIR: '/captures' }, platform: 'linux', home: '/srv/u' });
    assert.equal(path.dirname(dir), '/captures', url);
  }
});

test('different videos never share a capture folder', () => {
  // captureKey maps "%" to "_", so an id holding "%" could collide with another; the parser refuses such ids.
  const a = parseVideoUrl('https://www.instagram.com/reel/a%5F/');
  const b = parseVideoUrl('https://www.instagram.com/reel/a_255F/');
  if (a) {
    assert.notEqual(a.id, b.id);
    assert.notEqual(captureKey(a), captureKey(b));
  }
  assert.notEqual(captureKey(parseVideoUrl('https://www.instagram.com/reel/a_b/')), captureKey(parseVideoUrl('https://www.instagram.com/reel/a-b/')));
});

test('relative capture and data folders are refused on every platform', () => {
  const v = parseVideoUrl(URLS[0]);
  assert.throws(() => resolveCaptureDir(v, { env: { RECIPE_BANK_CAPTURE_DIR: 'captures' }, platform: 'linux', home: '/h' }));
  assert.throws(() => resolveCaptureDir(v, { env: { XDG_DATA_HOME: 'rel' }, platform: 'linux', home: '/h' }));
  assert.throws(() => resolveCaptureDir(v, { env: { LOCALAPPDATA: 'rel' }, platform: 'win32', home: 'C:\\Users\\u' }));
  assert.equal(resolveCaptureDir(v, { env: {}, platform: 'darwin', home: '/Users/u' }), `/Users/u/Library/Application Support/recipe-bank/captures/${captureKey(v)}`);
  assert.equal(resolveCaptureDir(v, { env: { LOCALAPPDATA: 'C:\\Data' }, platform: 'win32', home: 'C:\\Users\\u' }), `C:\\Data\\recipe-bank\\captures\\${captureKey(v)}`);
});

test('isInside: prefixes, dot-dot names and the root itself', () => {
  assert.equal(isInside('/a/b', '/a/b'), true);
  assert.equal(isInside('/a/b/c', '/a/b'), true);
  assert.equal(isInside('/a/b/..x', '/a/b'), true);
  assert.equal(isInside('/a/bc', '/a/b'), false);
  assert.equal(isInside('/a/b..c', '/a/b'), false);
  assert.equal(isInside('/a', '/a/b'), false);
  assert.equal(isInside('/a/b/../c', '/a/b'), false);
});

test('every planned command passes the URL after "--" and as one argument, with no shell', () => {
  const tools = { 'yt-dlp': '/bin/yt-dlp', ffmpeg: '/bin/ffmpeg', 'whisper-ctranslate2': '/bin/w', tesseract: '/bin/t' };
  for (const url of URLS) {
    const video = parseVideoUrl(url);
    if (!video) continue; // refused by the parser
    const plan = buildCapturePlan({ video, captureDir: '/captures/%(title)s; rm -rf ~', tools, modelPath: '/models/m', transcribe: true });
    for (const c of plan.commands) {
      assert.ok(c.args.every((a) => typeof a === 'string'), c.id);
      if (c.command === '/bin/yt-dlp') {
        assert.equal(c.args.at(-1), video.url, c.id);
        assert.equal(c.args.at(-2), '--', c.id);
        assert.equal(c.args[c.args.indexOf('-P') + 1], '/captures/%(title)s; rm -rf ~', 'the folder goes through -P, never into -o');
        assert.ok(!c.args[c.args.indexOf('-o') + 1].includes('/captures'), c.id);
      }
      assert.ok(c.timeout > 0, c.id);
    }
  }
});

test('caption languages never ask for every track and match only the original language', () => {
  for (const lang of [null, '', '*', 'en,de', '../x', 'x'.repeat(50)]) assert.equal(captionLanguages(lang), '.*-orig', String(lang));
  assert.equal(captionLanguages('en-GB'), 'en,en-.*');
  assert.equal(isOriginalCaption('source.en-orig.vtt', null), true);
  assert.equal(isOriginalCaption('source.de.vtt', 'en'), false);
  assert.equal(isOriginalCaption('source.en.vtt', 'en-US'), true);
  assert.equal(isOriginalCaption('../source.en.vtt', 'en'), false);
  assert.equal(hasCaptionText('WEBVTT\n\n00:00.000 --> 00:01.000\n<c>  </c>\n1\n'), false);
  assert.equal(hasCaptionText('WEBVTT\n\n1\n00:00.000 --> 00:01.000\nAdd the garlic\n'), true);
});

test('a video whose language code is "all" does not ask yt-dlp for every caption track',
  () => {
    assert.ok(!captionLanguages('all').split(',').includes('all'));
    assert.equal(captionLanguages('all'), 'al[l],al[l]-.*', 'still asks for the Allar captions themselves');
  });

test('the capture command refuses web pages, odd flags and several URLs without touching anything', async () => {
  for (const args of [['https://example.com/recipe'], ['--dry-run', '--evil', URLS[0]], [URLS[0], URLS[1]], [], ['--dry-run'], ['youtu.be/abcdefghijk']]) {
    const errors = [];
    assert.equal(await captureMain(args, { lookup: assert.fail, run: assert.fail, error: (m) => errors.push(m), log: () => {} }), 1, args.join(' '));
    assert.equal(errors.length, 1);
  }
});
