// The Add video dialog (public/ui/add.js). A request that outlives the dialog must not land in whatever
// the reader opened next: closing aborts it, and a late result is applied only for the attempt that is
// still current while the dialog is open.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installUiResolver, installBrowser } from './helpers/ui-dom.mjs';

installUiResolver();
const dom = installBrowser([
  'view', 'toast', 'stats', 'open-add', 'add-dialog', 'add-form', 'add-url', 'add-web', 'add-note',
  'add-detect', 'add-error', 'add-cancel', 'add-submit', 'add-intro',
]);
const { setupAdd } = await import('../public/ui/add.js');
const { state } = await import('../public/ui/core.js');

const hooks = {
  renders: 0,
  reloadImpl: async () => {},
};
setupAdd({
  rerender: () => { hooks.renders += 1; },
  reload: () => hooks.reloadImpl(),
});

const dialog = dom.get('add-dialog');
const form = dom.get('add-form');
const submit = dom.get('add-submit');
const error = dom.get('add-error');
const url = dom.get('add-url');

function click(id) {
  dom.get(id).dispatchEvent({ type: 'click', preventDefault() {} });
}
function submitForm() {
  form.dispatchEvent({ type: 'submit', preventDefault() {}, defaultPrevented: false });
}
async function flush() {
  for (let i = 0; i < 6; i++) await Promise.resolve();
}

let pending;
function holdFetch() {
  pending = null;
  globalThis.fetch = (requestUrl, init) => new Promise((resolve, reject) => {
    pending = { requestUrl, init, resolve, reject };
  });
}

function reset() {
  if (dialog.open) dialog.close();
  state.recipes = [];
  state.queue = [];
  state.invalid = [];
  location.hash = '#/r/kept';
  error.textContent = '';
  url.value = 'https://www.youtube.com/watch?v=abcdefghijk';
  dom.get('add-note').value = '';
  dom.get('add-web').checked = false;
  submit.disabled = false;
  submit.removeAttribute('aria-busy');
  submit.textContent = 'Add to queue';
  hooks.renders = 0;
  hooks.reloadImpl = async () => {};
  holdFetch();
}

test('closing Add video aborts the request and re-enables the button before it finishes', async () => {
  reset();
  click('open-add');
  submitForm();
  assert.equal(submit.disabled, true);
  assert.equal(submit.textContent, 'Adding…');
  assert.equal(pending.init.signal instanceof AbortSignal, true, 'the POST is abortable');

  click('add-cancel');
  assert.equal(dialog.open, false);
  assert.equal(pending.init.signal.aborted, true, 'closing aborts that attempt');
  click('open-add');
  assert.equal(submit.disabled, false, 'reopening must not leave the button disabled');
  assert.equal(submit.textContent, 'Add to queue');
  assert.equal(submit.getAttribute('aria-busy'), null);
});

test('a late success is ignored once the dialog has been closed', async () => {
  reset();
  click('open-add');
  submitForm();
  click('add-cancel');
  click('open-add');
  const queueBefore = state.queue.length;

  pending.resolve({
    ok: true,
    status: 201,
    json: async () => ({ entry: { id: 'q-new', title: 'Soup', status: 'queued' } }),
  });
  await flush();

  assert.equal(location.hash, '#/r/kept', 'a late success must not navigate home');
  assert.equal(dialog.open, true, 'a late success must not close the dialog that is open now');
  assert.equal(state.queue.length, queueBefore);
  assert.equal(error.textContent, '');
  assert.equal(hooks.renders, 0);
});

test('a late error does not write into the dialog after it was closed', async () => {
  reset();
  click('open-add');
  submitForm();
  click('add-cancel');
  click('open-add');

  pending.resolve({ ok: false, status: 400, json: async () => ({ error: 'Not a supported video link yet' }) });
  await flush();

  assert.equal(error.textContent, '');
  assert.equal(dialog.open, true);
  assert.equal(location.hash, '#/r/kept');
});

test('a duplicate found after the dialog closed does not open that recipe', async () => {
  reset();
  let releaseReload;
  hooks.reloadImpl = () => new Promise((resolve) => { releaseReload = resolve; });
  click('open-add');
  submitForm();
  pending.resolve({ ok: false, status: 409, json: async () => ({ recipeId: 'alpha', error: 'Already queued' }) });
  await flush();
  assert.equal(typeof releaseReload, 'function', 'an unknown recipe is reloaded before it is opened');

  click('add-cancel');
  click('open-add');
  releaseReload();
  await flush();

  assert.equal(location.hash, '#/r/kept');
  assert.equal(dialog.open, true);
  assert.equal(error.textContent, '');
});

test('a success while the dialog is still open queues the video and returns home', async () => {
  reset();
  location.hash = '#/r/kept';
  click('open-add');
  submitForm();
  pending.resolve({
    ok: true,
    status: 201,
    json: async () => ({ entry: { id: 'q-new', title: 'Soup', status: 'queued' } }),
  });
  await flush();

  assert.equal(location.hash, '#/');
  assert.equal(dialog.open, false);
  assert.equal(state.queue.length, 1);
  assert.equal(state.queue[0].id, 'q-new');
  assert.equal(submit.disabled, false);
  assert.equal(submit.textContent, 'Add to queue');
});
