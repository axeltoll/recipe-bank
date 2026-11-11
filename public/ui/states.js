// Loading, error, empty and not-found states. One icon, one sentence, one action.
import { esc } from '/lib/format.mjs';
import { $, view, STATIC, icon } from './core.js';

// The loading skeleton ships in index.html so it paints before this module runs; keep a copy for "Try again".
const SKELETON = view.innerHTML;

/** Markup for a state block. `title` and `text` are escaped; `actions` is trusted markup built by the caller. */
export function stateBlock({ glyph = 'pot', title, text = '', actions = '' }) {
  return `
    <div class="state">
      ${icon(glyph)}
      <h2>${esc(title)}</h2>
      ${text ? `<p>${esc(text)}</p>` : ''}
      ${actions ? `<div class="state-actions">${actions}</div>` : ''}
    </div>`;
}

export function renderLoading() {
  view.dataset.layout = 'list';
  view.dataset.view = 'loading';
  view.innerHTML = SKELETON;
}

export function renderError(retry) {
  document.title = 'Recipe Bank';
  view.dataset.layout = 'message';
  view.dataset.view = 'error';
  view.innerHTML = stateBlock({
    glyph: 'alert',
    title: "Couldn't load the recipes",
    text: STATIC
      ? 'Check your connection, then try again.'
      : 'Start the server with “npm start” and open http://127.0.0.1:4780, then try again.',
    actions: '<button class="btn btn-primary" type="button" id="retry">Try again</button>',
  });
  $('#retry').addEventListener('click', retry);
}

/** Unknown recipe or queue id. Returns the view descriptor the router expects. */
export function renderMissing(kind = 'recipe') {
  document.title = 'Not found · Recipe Bank';
  view.innerHTML = stateBlock({
    title: kind === 'queue' ? "That video isn't in the queue" : "That recipe isn't in the bank",
    text: kind === 'queue'
      ? 'It may have been analyzed already, or removed.'
      : 'The link may be old, or the recipe was renamed.',
    actions: '<a class="btn btn-primary" href="#/">All recipes</a>',
  });
  return { name: 'missing', layout: 'message' };
}
