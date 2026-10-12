import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseVideoUrl, embedUrl, videoKey } from '../lib/video.mjs';

test('parses YouTube Shorts, watch, youtu.be and embed links to the same video', () => {
  const urls = [
    'https://www.youtube.com/shorts/mhNQ8y5ud0A',
    'https://youtube.com/shorts/mhNQ8y5ud0A?si=abc',
    'https://m.youtube.com/watch?v=mhNQ8y5ud0A&t=4',
    'https://youtu.be/mhNQ8y5ud0A',
    'https://www.youtube-nocookie.com/embed/mhNQ8y5ud0A',
  ];
  for (const u of urls) assert.equal(videoKey(parseVideoUrl(u)), 'youtube:mhNQ8y5ud0A', u);
});

test('parses TikTok and Instagram links', () => {
  assert.deepEqual(parseVideoUrl('https://www.tiktok.com/@saerijane/video/7366000000000000000?lang=en'), {
    platform: 'tiktok', id: '7366000000000000000', url: 'https://www.tiktok.com/@saerijane/video/7366000000000000000',
  });
  assert.equal(parseVideoUrl('https://www.instagram.com/reel/C9xYz123/?igsh=x').id, 'C9xYz123');
});

test('rejects non-video links', () => {
  for (const u of ['', 'not a url', 'https://example.com/shorts/mhNQ8y5ud0A', 'https://www.youtube.com/@FeastRecipes']) {
    assert.equal(parseVideoUrl(u), null, u);
  }
});

test('embed URL carries the start time', () => {
  const v = parseVideoUrl('https://www.youtube.com/shorts/mhNQ8y5ud0A');
  assert.match(embedUrl(v, { start: 62.4 }), /youtube-nocookie\.com\/embed\/mhNQ8y5ud0A\?.*start=62/);
});
