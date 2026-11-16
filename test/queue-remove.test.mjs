// Removing a queued video sends the reader home only when they are still on that queue page.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installUiResolver, installBrowser } from './helpers/ui-dom.mjs';

installUiResolver();
const dom = installBrowser(['view', 'toast', 'stats']);
const { state } = await import('../public/ui/core.js');
const { renderQueued } = await import('../public/ui/queue.js');

const entry = {
  id: 'q1',
  status: 'queued',
  title: 'Soup',
  video: { platform: 'youtube', id: 'abcdefghijk', url: 'https://www.youtube.com/watch?v=abcdefghijk' },
};

function arm() {
  state.recipes = [];
  state.queue = [{ ...entry, video: { ...entry.video } }];
  state.invalid = [];
  let release;
  globalThis.fetch = (requestUrl, init) => new Promise((resolve) => {
    release = () => resolve({ ok: true, status: 200, requestUrl, init });
  });
  renderQueued(entry.id);
  const button = dom.get('remove-req');
  const click = button.listeners.click[0]({ currentTarget: button });
  return { release, click };
}

test('Remove stays on the page the reader moved to while the request was in flight', async () => {
  location.hash = '#/q/q1';
  const { release, click } = arm();
  location.hash = '#/r/alpha';
  release();
  await click;
  assert.equal(location.hash, '#/r/alpha');
});

test('Remove goes home when the reader is still on that queue page', async () => {
  location.hash = '#/q/q1';
  const { release, click } = arm();
  release();
  await click;
  assert.equal(location.hash, '#/');
  assert.equal(state.queue.length, 0);
});
