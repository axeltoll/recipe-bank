import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { parseVideoUrl, PLATFORMS } from '../lib/video.mjs';
import { platformFixture } from './helpers/platform-fixture.mjs';

async function request(fixture, body, method = 'POST', path = '/api/queue') {
  const req = Readable.from(body === undefined ? [] : [JSON.stringify(body)]);
  // Writes carry the JSON content type the server requires (server.mjs writeRefusal).
  Object.assign(req, { method, url: path, headers: method === 'GET' ? {} : { 'content-type': 'application/json' } });
  const res = {
    writeHead(status, headers) { Object.assign(this, { status, headers }); },
    end(raw) { this.body = JSON.parse(raw); },
  };
  await fixture.handleRequest(req, res);
  return res;
}

test('queue API requires boolean web opt-in and never fetches a web page', async (t) => {
  const fixture = await platformFixture(t);
  const fetch = t.mock.method(globalThis, 'fetch', () => { throw new Error('unexpected network request'); });
  const url = 'https://example.com/recipe?video=2#method';
  for (const allowWeb of [undefined, false, 'true', 1, null]) {
    const res = await request(fixture, { url, allowWeb });
    assert.equal(res.status, 400);
    for (const { label, id } of PLATFORMS) {
      if (id !== 'web') assert.ok(res.body.error.includes(label));
    }
  }
  assert.deepEqual(await fixture.readQueue(), []);
  const res = await request(fixture, { url, allowWeb: true, note: '  Check for video  ' });
  assert.equal(res.status, 201);
  assert.deepEqual(res.body.entry.video, parseVideoUrl(url, { allowWeb: true }));
  assert.equal(res.body.entry.note, 'Check for video');
  assert.equal(res.body.entry.title, null);
  assert.equal(res.body.entry.status, 'queued');
  assert.deepEqual(await fixture.readQueue(), [res.body.entry]);
  assert.equal((await request(fixture, { url, allowWeb: true })).status, 409);
  // Query and fragment can identify a different video on the same page.
  assert.equal((await request(fixture, { url: `${url}2`, allowWeb: true })).status, 201);
  for (const bad of ['http://example.com/recipe', 'javascript:alert(1)',
    'https://facebook.com/reel/nope', 'https://l.facebook.com/l.php?u=https://example.com']) {
    assert.equal((await request(fixture, { url: bad, allowWeb: true })).status, 400);
  }
  assert.equal(fetch.mock.callCount(), 0);
});

test('queue API canonicalizes new platforms and deduplicates queue and recipe entries', async (t) => {
  const fixture = await platformFixture(t);
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({
    title: 'Recipe video', author_name: 'Kitchen', author_url: 'https://example.com/kitchen',
  })));
  for (const [url, alias] of [
    ['https://facebook.com/reel/12345', 'https://web.facebook.com/watch/?v=12345&si=abc'],
    ['https://pinterest.co.uk/pin/12345/', 'https://www.pinterest.com/pin/12345?si=abc'],
    ['https://mobile.twitter.com/kitchen/status/12345', 'https://x.com/kitchen/status/12345?s=20'],
  ]) {
    const res = await request(fixture, { url });
    assert.equal(res.status, 201);
    assert.deepEqual(res.body.entry.video, parseVideoUrl(url));
    assert.equal(res.body.entry.title, res.body.entry.video.platform === 'facebook' ? null : 'Recipe video');
    assert.equal((await request(fixture, { url: alias })).status, 409);
  }
  assert.equal((await fixture.readQueue()).length, 3);
  const recipe = { ...fixture.recipe, video: parseVideoUrl('https://pinterest.com/pin/67890/') };
  await fixture.writeJSON(`recipes/${recipe.id}.json`, recipe);
  const duplicate = await request(fixture, { url: 'https://pinterest.se/pin/67890/' });
  assert.equal(duplicate.status, 409);
  assert.equal(duplicate.body.recipeId, recipe.id);
});

test('queue API resolves short links before metadata lookup and deduplication', async (t) => {
  const fixture = await platformFixture(t);
  const short = 'https://pin.it/AbC123';
  const full = 'https://www.pinterest.co.uk/pin/12345/';
  const fetch = t.mock.method(globalThis, 'fetch', async (url, options) => {
    if (options.method === 'HEAD') {
      if (url === short) return new Response(null, { status: 302, headers: { location: full } });
      assert.equal(url, full);
      return new Response(null);
    }
    assert.equal(new URL(url).searchParams.get('url'), parseVideoUrl(full).url);
    return new Response('{"title":"Resolved recipe"}');
  });
  const res = await request(fixture, { url: short });
  assert.equal(res.status, 201);
  assert.deepEqual(res.body.entry.video, parseVideoUrl(full));
  assert.equal(res.body.entry.title, 'Resolved recipe');
  assert.equal(fetch.mock.callCount(), 3);
  assert.equal((await request(fixture, { url: full })).status, 409);
});

test('queue API saves unresolved short links and tolerates unavailable metadata', async (t) => {
  const fixture = await platformFixture(t);
  const fetch = t.mock.method(globalThis, 'fetch', async () => { throw new TypeError('offline'); });
  for (const url of ['https://fb.watch/AbC123/', 'https://pin.it/AbC123',
    'https://vm.tiktok.com/AbC123/', 'https://vt.tiktok.com/AbC123/',
    'https://x.com/kitchen/status/12345']) {
    const res = await request(fixture, { url });
    assert.equal(res.status, 201);
    assert.deepEqual(res.body.entry.video, parseVideoUrl(url));
    assert.equal(res.body.entry.title, null);
    assert.equal(res.body.entry.creator, null);
  }
  assert.equal(fetch.mock.callCount(), 8);
  const list = await request(fixture, undefined, 'GET');
  assert.equal(list.status, 200);
  assert.deepEqual(list.body.queue, await fixture.readQueue());
});
