// The "Add video" dialog. On the local server it queues the video; on the static copy it copies a request instead.
import { parseVideoUrl } from '/lib/video.mjs';
import { analysisRequest } from '/lib/catalog.mjs';
import { recipeHash } from '/lib/nav.mjs';
import { $, state, STATIC, PLATFORM, toast, copy, renderStats } from './core.js';

/** `rerender` redraws the current route after the queue changed. */
export function setupAdd({ rerender }) {
  const dlg = $('#add-dialog');
  const url = $('#add-url');
  const hint = $('#add-detect');
  const err = $('#add-error');
  const submit = $('#add-submit');
  const idle = STATIC ? 'Copy request' : 'Add to queue';

  $('#open-add').addEventListener('click', () => {
    $('#add-form').reset();
    hint.textContent = '';
    hint.className = 'field-hint';
    err.textContent = '';
    dlg.showModal();
    url.focus();
  });
  $('#add-cancel').addEventListener('click', () => dlg.close());
  url.addEventListener('input', () => {
    const v = parseVideoUrl(url.value);
    hint.className = 'field-hint' + (v ? ' ok' : '');
    hint.textContent = url.value.trim() === '' ? '' : v ? `✓ ${PLATFORM[v.platform]} video` : 'Not a supported video link yet';
  });
  if (STATIC) {
    $('#add-intro').textContent =
      'Paste a YouTube Short, TikTok or Instagram Reel. This online copy cannot queue it, so it copies a request for the Recipe Bank topic in Telegram.';
  }
  submit.textContent = idle;

  $('#add-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    err.textContent = '';
    if (STATIC) {
      if (!parseVideoUrl(url.value)) { err.textContent = 'Not a supported video link yet'; return; }
      dlg.close();
      copy(analysisRequest({ video: { url: url.value.trim() }, note: $('#add-note').value.trim() }),
        'Request copied. Paste it in the Recipe Bank topic');
      return;
    }
    submit.disabled = true;
    submit.setAttribute('aria-busy', 'true');
    submit.textContent = 'Adding…';
    try {
      const res = await fetch('/api/queue', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url: url.value, note: $('#add-note').value }),
      });
      const body = await res.json();
      if (res.status === 409 && body.recipeId) {
        dlg.close();
        location.hash = recipeHash(body.recipeId);
        toast('That one is already in the bank');
        return;
      }
      if (!res.ok) { err.textContent = body.error ?? 'Could not add it'; return; }
      state.queue.push(body.entry);
      dlg.close();
      renderStats();
      if (location.hash === '' || location.hash === '#/') rerender();
      else location.hash = '#/';
      toast(`Queued${body.entry.title ? `: ${body.entry.title}` : ''}`);
    } catch {
      err.textContent = 'The Recipe Bank server is not reachable. Is `npm start` running?';
    } finally {
      submit.disabled = false;
      submit.removeAttribute('aria-busy');
      submit.textContent = idle;
    }
  });
}
