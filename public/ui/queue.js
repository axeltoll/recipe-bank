// Queued-video page (layout type: detail): the video, where it is in the analysis, and what you can do meanwhile.
import { esc, formatDate } from '/lib/format.mjs';
import { analysisRequest, queueState, recipeForVideo } from '/lib/catalog.mjs';
import { recipeHash } from '/lib/nav.mjs';
import { $, view, state, STATIC, PLATFORM, icon, copy, removeQueued } from './core.js';
import { renderMissing } from './states.js';
import { player } from './recipe.js';

const STAGES = ['Queued', 'Being analyzed', 'Recipe ready'];

const EXPLAIN = {
  queued: 'This video is waiting for the research agent. Once the recipe file lands in recipes/ it moves to your recipes automatically.',
  analyzing: 'The research agent is writing this one up: the ingredients in the creator’s own amounts, and the steps with timestamps.',
  failed: 'The analysis could not be completed for this video. You can still watch it here, ask again with a copied request, or remove it from the queue.',
  done: 'The recipe has been written up from this video.',
};

export function renderQueued(id) {
  const x = state.queue.find((q) => q.id === id);
  if (!x) return renderMissing('queue');
  const title = x.title ?? 'Untitled video';
  document.title = `${title} · Recipe Bank`;

  const s = queueState(x.status);
  const failed = x.status === 'failed';
  const recipe = x.status === 'done' ? recipeForVideo(state.recipes, x.video) : undefined;
  const platform = PLATFORM[x.video.platform] ?? 'the platform';
  const stageState = (i) => (i < s.stage ? 'done' : i > s.stage ? 'todo' : failed ? 'failed' : s.stage === 2 ? 'done' : 'current');
  const stageNote = { done: 'done', current: 'in progress', failed: 'failed', todo: 'not yet' };
  const removable = (x.status === 'queued' || failed) && !STATIC;

  view.innerHTML = `
    <article class="recipe recipe-queued">
      <header class="recipe-head">
        <a class="back" href="#/">${icon('back')}<span>All recipes</span></a>
        <p class="recipe-status"><span class="badge badge-${s.tone}${x.status === 'analyzing' ? ' badge-pulse' : ''}">${esc(s.label)}</span></p>
        <h1>${esc(title)}</h1>
        <p class="recipe-by">${x.creator ? `by ${esc(x.creator)} · ` : ''}${x.addedAt ? `added ${esc(formatDate(x.addedAt))}` : 'in the queue'}</p>
      </header>

      <div class="recipe-media">
        <div class="media-stick">
          <div class="player">${player(x.video, `Video: ${title}`)}</div>
          <p class="player-links"><a href="${esc(x.video.url)}" target="_blank" rel="noopener">Open on ${esc(platform)}${icon('external')}</a></p>
        </div>
      </div>

      <section class="panel queue-panel" aria-labelledby="queue-panel-h">
        <h2 id="queue-panel-h">${x.status === 'done' ? 'The recipe is ready' : failed ? 'This one could not be analyzed' : 'Ingredients and steps are on the way'}</h2>
        <ol class="progress">
          ${STAGES.map((label, i) => `<li data-state="${stageState(i)}">${i === 1 && failed ? 'Analysis failed' : label}<span class="sr-only"> (${stageNote[stageState(i)]})</span></li>`).join('')}
        </ol>
        <p>${esc(EXPLAIN[x.status] ?? EXPLAIN.queued)}</p>
        ${x.note ? `<div class="callout callout-notes"><h3>Your note</h3><p>${esc(x.note)}</p></div>` : ''}
        <div class="q-actions">
          ${recipe ? `<a class="btn btn-primary" href="${esc(recipeHash(recipe.id))}">Open the recipe</a>` : ''}
          ${x.status === 'done' ? '' : `<button class="btn" type="button" id="copy-req">${icon('copy')}<span>Copy request</span></button>`}
          ${removable ? '<button class="btn btn-quiet btn-danger" type="button" id="remove-req">Remove from queue</button>' : ''}
        </div>
      </section>
    </article>`;

  $('#copy-req')?.addEventListener('click', () => copy(analysisRequest(x), 'Request copied. Paste it in the Recipe Bank topic'));
  $('#remove-req')?.addEventListener('click', async (e) => {
    if (await removeQueued(x.id, e.currentTarget)) location.hash = '#/';
  });
  return { name: 'queue', layout: 'detail', id: x.id, entry: x };
}
