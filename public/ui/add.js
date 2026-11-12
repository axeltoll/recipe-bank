// The "Add video" dialog. On the local server it queues the video; on the static copy it copies a request instead.
// Supported sources come from the PLATFORMS table in /lib/video.mjs. Other HTTPS pages are accepted only while
// the "web page" box is ticked (allowWeb), and are labelled as a page to check rather than a verified video.
import { parseVideoUrl } from '/lib/video.mjs';
import { analysisRequest } from '/lib/catalog.mjs';
import { recipeHash } from '/lib/nav.mjs';
import { $, state, STATIC, PLATFORM, PLATFORM_LIST, toast, copy, renderStats } from './core.js';

/** What the hint under the link says about a parsed link (or null). */
function describe(video, raw) {
  if (raw.trim() === '') return '';
  if (!video) return 'Not a supported video link yet';
  if (video.platform === 'web') return '✓ A web page: the agent checks whether it holds a recipe video';
  const label = PLATFORM[video.platform] ?? 'Video';
  return video.id ? `✓ ${label} video` : `✓ ${label} short link (resolved when it is queued)`;
}

/** `rerender` redraws the current route after the queue changed; `reload` re-reads recipes and queue. */
export function setupAdd({ rerender, reload }) {
  const dlg = $('#add-dialog');
  const url = $('#add-url');
  const web = $('#add-web');
  const hint = $('#add-detect');
  const err = $('#add-error');
  const submit = $('#add-submit');
  const idle = STATIC ? 'Copy request' : 'Add to queue';
  const parse = () => parseVideoUrl(url.value, { allowWeb: web.checked });
  const showHint = () => {
    const v = parse();
    hint.className = 'field-hint' + (v ? ' ok' : '');
    hint.textContent = describe(v, url.value);
  };

  $('#open-add').addEventListener('click', () => {
    $('#add-form').reset();
    hint.textContent = '';
    hint.className = 'field-hint';
    err.textContent = '';
    dlg.showModal();
    url.focus();
  });
  $('#add-cancel').addEventListener('click', () => dlg.close());
  url.addEventListener('input', showHint);
  web.addEventListener('change', showHint);
  $('#add-intro').textContent = STATIC
    ? `Paste a video link from ${PLATFORM_LIST}. This online copy cannot queue it, so it copies a request you can pass to your analysis agent.`
    : `Paste a video link from ${PLATFORM_LIST}. It joins the queue, and the research agent writes up the ingredients and steps.`;
  submit.textContent = idle;

  $('#add-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    err.textContent = '';
    const video = parse();
    if (STATIC) {
      if (!video) { err.textContent = 'Not a supported video link yet'; return; }
      dlg.close();
      copy(analysisRequest({ video, note: $('#add-note').value.trim() }), 'Request copied');
      return;
    }
    submit.disabled = true;
    submit.setAttribute('aria-busy', 'true');
    submit.textContent = 'Adding…';
    try {
      const res = await fetch('/api/queue', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url: url.value, note: $('#add-note').value, ...(web.checked ? { allowWeb: true } : {}) }),
      });
      const body = await res.json();
      if (res.status === 409 && body.recipeId) {
        // The recipe may have been written after this page loaded: load it before opening it.
        if (!state.recipes.some((r) => r.id === body.recipeId)) await reload?.().catch(() => {});
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
