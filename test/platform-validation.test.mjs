import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseVideoUrl } from '../lib/video.mjs';
import { platformFixture } from './helpers/platform-fixture.mjs';

test('CLI queue validation requires the declared platform and matching IDs', async (t) => {
  const fixture = await platformFixture(t);
  // Import the CLI in-process so the tests also run where child processes are
  // restricted. Capture the CLI's diagnostics and explicit failure exit.
  const failed = new Error('validation failed');
  t.mock.method(process, 'exit', (code) => {
    assert.equal(code, 1);
    throw failed;
  });
  t.mock.method(console, 'log', () => {});
  let run = 0;
  const validate = async () => {
    const messages = [];
    const error = t.mock.method(console, 'error', (...args) => messages.push(args.join(' ')));
    try {
      const url = pathToFileURL(join(fixture.dir, 'scripts/validate.mjs'));
      url.searchParams.set('run', ++run);
      await import(url.href);
      return { status: 0, output: messages.join('\n') };
    } catch (e) {
      if (e !== failed) throw e;
      return { status: 1, output: messages.join('\n') };
    } finally {
      error.mock.restore();
    }
  };
  for (const url of ['https://facebook.com/reel/12345', 'https://pinterest.com/pin/12345/',
    'https://x.com/kitchen/status/12345', 'https://example.com/recipe', 'https://fb.watch/AbC123/']) {
    const entry = { id: 'queued-video', status: 'queued', video: parseVideoUrl(url, { allowWeb: true }) };
    await fixture.writeQueue([entry]);
    assert.equal((await validate()).status, 0, url);
    await fixture.writeQueue([{ ...entry, video: { ...entry.video, platform: 'youtube' } }]);
    assert.equal((await validate()).status, 1, url);
    await fixture.writeQueue([{ ...entry, video: { ...entry.video, id: 'invented' } }]);
    const invalidId = await validate();
    assert.equal(invalidId.status, 1, url);
    assert.match(invalidId.output, /video.id/);
  }
});
