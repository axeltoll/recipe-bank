// Recipe page (layout type: detail): video, ingredient checklist, steps with timestamps, nutrition, gaps and notes.
import { embedUrl } from '/lib/video.mjs';
import { esc, mmss, formatDate, safeUrl } from '/lib/format.mjs';
import { ingredientKeys, stepCount, macros, shoppingList } from '/lib/catalog.mjs';
import {
  $, $$, view, state, store, STATIC, PLATFORM, emit, icon, copy, isPhone, reducedMotion, timerChips, paintTimers,
} from './core.js';
import { renderMissing } from './states.js';
import { openCook } from './cook.js';

const BASIS_LABEL = {
  'on-screen': 'shown on screen',
  spoken: 'said in the video',
  description: 'from the video description',
  unstated: 'amount not given',
};
const BASIS_SHORT = { 'on-screen': 'on screen', spoken: 'spoken', description: 'description' };

/** The embedded player, or a link when the platform gives nothing to embed. Shared with the queue page. */
export function player(video, title = 'Recipe video') {
  const src = embedUrl(video);
  if (!src) {
    const href = safeUrl(video.url);
    return `<div class="player-fallback"><p>This link can't be embedded.</p>${href ? `<a class="btn" href="${esc(href)}" target="_blank" rel="noopener">${icon('external')}<span>Open the video</span></a>` : ''}</div>`;
  }
  return `<iframe src="${esc(src)}" title="${esc(title)}" loading="lazy"
    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
    referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe>`;
}

function gapsCallout(r, level) {
  return `
    <div class="callout callout-gaps">
      <${level}>What the video doesn't say</${level}>
      <ul>${r.gaps.map((g) => `<li>${esc(g)}</li>`).join('')}</ul>
    </div>`;
}

export function renderRecipe(id) {
  const r = state.recipes.find((x) => x.id === id);
  if (!r) return renderMissing('recipe');
  document.title = `${r.title} · Recipe Bank`;

  const checked = new Set(store.get(`rb:checked:${r.id}`, []));
  const multi = r.components.length > 1;
  const partial = r.status === 'partial';
  const steps = stepCount(r);
  const total = r.components.reduce((n, c) => n + c.ingredients.length, 0);
  const ms = macros(r);
  const n = r.nutrition;
  // Only YouTube embeds can start at a given second; elsewhere a timestamp is shown as plain text.
  const seekable = r.video.platform === 'youtube';
  const platform = PLATFORM[r.video.platform] ?? 'the platform';
  const hasGaps = Boolean(r.gaps?.length);
  // Links from the recipe file are only rendered when they are http(s) (lib/format.mjs safeUrl).
  const videoUrl = safeUrl(r.video.url);
  const creatorUrl = safeUrl(r.creator.url);
  // Steps are numbered across the parts, as in cook mode, so a timer started here is the same timer there.
  let counted = 0;
  const firstStep = r.components.map((c) => {
    const start = counted;
    counted += c.steps.length;
    return start;
  });

  view.innerHTML = `
    <article class="recipe">
      <header class="recipe-head">
        <div class="recipe-top">
          <a class="back" href="#/">${icon('back')}<span>All recipes</span></a>
          <a class="btn btn-quiet recipe-edit" href="#/edit/${esc(encodeURIComponent(r.id))}">${icon('edit')}<span>${STATIC ? 'Edit a copy' : 'Edit'}</span></a>
        </div>
        <p class="recipe-status"><span class="badge ${partial ? 'badge-warn' : ''}">${partial ? 'Partial recipe: some details are missing' : 'Full recipe from the video'}</span></p>
        <h1>${esc(r.title)}</h1>
        <p class="recipe-by">by ${creatorUrl
          ? `<a href="${esc(creatorUrl)}" target="_blank" rel="noopener">${esc(r.creator.name)}</a>`
          : esc(r.creator.name)}${r.uploaded ? ` · posted ${esc(formatDate(r.uploaded))}` : ''}</p>
        <p class="print-only">Video: ${esc(r.video.url)}</p>
        <p class="recipe-summary">${esc(r.summary)}</p>
        ${r.tags?.length ? `<ul class="tags" aria-label="Tags">${r.tags.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>` : ''}
        <dl class="facts">
          <div><dt>Makes</dt><dd>${esc(r.serves ?? 'not stated')}</dd></div>
          <div><dt>Ingredients</dt><dd>${ingredientKeys(r).length}</dd></div>
          <div><dt>Steps</dt><dd>${steps}</dd></div>
          <div><dt>Analyzed</dt><dd>${esc(formatDate(r.analyzed))}</dd></div>
        </dl>
        ${partial && hasGaps ? gapsCallout(r, 'h2') : ''}
      </header>

      <div class="recipe-actions">
        ${steps ? `<button class="btn btn-primary" type="button" id="cook-open">${icon('pot')}<span>Start cooking</span></button>` : ''}
        <button class="btn" type="button" id="copy-list">${icon('copy')}<span class="label-wide">Copy list</span></button>
        <div class="mount" id="mount-recipe-actions" data-mount="recipe-actions"></div>
        <button class="btn btn-quiet print-btn" type="button" id="print">${icon('print')}<span>Print</span></button>
      </div>

      <div class="recipe-media">
        <div class="media-stick">
          <div class="player" id="player">${player(r.video, `Video: ${r.title}`)}</div>
          <p class="player-links">
            ${videoUrl ? `<a href="${esc(videoUrl)}" target="_blank" rel="noopener">Open on ${esc(platform)}${icon('external')}</a>` : ''}
            ${creatorUrl ? `<a href="${esc(creatorUrl)}" target="_blank" rel="noopener">${esc(r.creator.handle ?? 'Creator')}${icon('external')}</a>` : ''}
          </p>
        </div>
      </div>

      <section class="panel recipe-ingredients" aria-labelledby="ing-h">
        <div class="panel-head">
          <h2 id="ing-h">Ingredients</h2>
          <div class="panel-tools">
            <span id="ing-progress" role="status"></span>
            <button class="btn btn-quiet" type="button" id="ing-reset" hidden>Untick all</button>
          </div>
        </div>
        <div class="mount" id="mount-recipe-scaling" data-mount="recipe-scaling"></div>
        <p class="legend">Amounts are exactly as the creator gave them. <i>Amount not given</i> means the video didn't say.</p>
        ${r.components.map((c, ci) => (c.ingredients.length ? `
          ${multi ? `<h3>${esc(c.name)}</h3>` : ''}
          <ul class="ing-list">
            ${c.ingredients.map((i, ii) => `
              <li><label class="ing">
                <input type="checkbox" data-check="${ci}.${ii}" ${checked.has(`${ci}.${ii}`) ? 'checked' : ''}>
                <span class="ing-text"><span class="ing-name">${esc(i.item)}</span>${i.note ? `<span class="ing-note">${esc(i.note)}</span>` : ''}</span>
                <span class="ing-amt${i.basis === 'unstated' ? ' unstated' : ''}" data-ci="${ci}" data-ii="${ii}" data-key="${esc(i.key)}" data-basis="${esc(i.basis)}" data-amount="${esc(i.amount ?? '')}">
                  <span class="ing-amt-text">${esc(i.amount ?? 'amount not given')}</span>
                  ${BASIS_SHORT[i.basis] ? `<span class="ing-basis"><span class="sr-only">${esc(BASIS_LABEL[i.basis])}</span><span aria-hidden="true">${BASIS_SHORT[i.basis]}</span></span>` : ''}
                </span>
              </label></li>`).join('')}
          </ul>` : '')).join('')}
        <div class="mount" id="mount-recipe-aside" data-mount="recipe-aside"></div>
      </section>

      <section class="panel recipe-steps" aria-labelledby="steps-h">
        <div class="panel-head"><h2 id="steps-h">Step by step</h2></div>
        ${steps ? r.components.map((c, ci) => (c.steps.length ? `
          ${multi ? `<h3>${esc(c.name)}</h3>` : ''}
          <ol class="steps">
            ${c.steps.map((s, si) => `
              <li>
                <p class="step-text">${esc(s.text)}</p>
                <div class="step-tools">${s.t == null ? '' : seekable
                  ? `<button type="button" class="ts" data-t="${Number(s.t)}" aria-label="Play from ${mmss(s.t)}">${icon('play')}<span>${mmss(s.t)}</span></button>`
                  : `<span class="ts ts-static">at ${mmss(s.t)} in the video</span>`}${timerChips(`${r.id}:${firstStep[ci] + si + 1}`, s.text, `${multi ? `${c.name}, ` : ''}step ${si + 1}`)}</div>
              </li>`).join('')}
          </ol>` : '')).join('') : '<p class="muted">The video gives no method to follow.</p>'}
      </section>

      <div class="recipe-more">
        ${ms.length ? `
        <section class="panel" aria-labelledby="nut-h">
          <h2 id="nut-h">Nutrition${n.per ? ` <span class="per">per ${esc(n.per)}</span>` : ''}</h2>
          <dl class="nutrition">
            ${ms.map((m) => `<div><dt>${m.label}</dt><dd>${esc(m.value)} <span>${m.unit}</span></dd></div>`).join('')}
          </dl>
          <p class="source">Source: ${esc(BASIS_LABEL[n.basis] ?? n.basis ?? 'not stated')}.${n.note ? ` ${esc(n.note)}` : ''}</p>
        </section>` : ''}
        ${(hasGaps && !partial) || r.notes?.length || r.source ? `
        <section class="panel" aria-labelledby="about-h">
          <div class="panel-head"><h2 id="about-h">About this recipe</h2></div>
          ${hasGaps && !partial ? gapsCallout(r, 'h3') : ''}
          ${r.notes?.length ? `<div class="callout callout-notes"><h3>Notes</h3><ul>${r.notes.map((g) => `<li>${esc(g)}</li>`).join('')}</ul></div>` : ''}
          ${r.source ? `<p class="source">${esc(r.source.quantity_basis ?? '')}${r.source.evidence ? `${r.source.quantity_basis ? '<br>' : ''}Checked against: ${esc(r.source.evidence)}` : ''}</p>` : ''}
        </section>` : ''}
      </div>
    </article>`;

  const progress = () => {
    $('#ing-progress').textContent = total && checked.size ? `${Math.min(checked.size, total)} of ${total} ticked` : '';
    $('#ing-reset').hidden = checked.size === 0;
  };
  const setChecked = (key, on) => {
    if (on) checked.add(key);
    else checked.delete(key);
    store.set(`rb:checked:${r.id}`, [...checked]);
    const box = $(`[data-check="${key}"]`, view);
    if (box) box.checked = on;
    progress();
    emit('check', { recipe: r, key, checked: on, all: [...checked] });
  };

  $('.recipe-ingredients').addEventListener('change', (e) => {
    if (e.target.dataset?.check != null) setChecked(e.target.dataset.check, e.target.checked);
  });
  $('#ing-reset').addEventListener('click', () => {
    for (const key of [...checked]) setChecked(key, false);
    $('#ing-h').closest('.panel').querySelector('input')?.focus();
  });

  const playFrom = (t) => {
    const frame = $('#player iframe');
    const src = embedUrl(r.video, { start: Number(t), autoplay: true });
    if (!frame || !src) return;
    frame.src = src;
    // On a phone the player is not sticky, so bring it back into view.
    if (isPhone()) frame.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'center' });
  };
  const stepsPanel = $('.recipe-steps');
  stepsPanel.addEventListener('click', (e) => {
    const b = e.target.closest('button.ts');
    if (b) playFrom(b.dataset.t);
  });
  // Up and Down move between the timestamp buttons.
  stepsPanel.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const buttons = $$('button.ts', stepsPanel);
    const i = buttons.indexOf(e.target.closest?.('button.ts'));
    if (i < 0) return;
    e.preventDefault();
    buttons[Math.min(Math.max(i + (e.key === 'ArrowDown' ? 1 : -1), 0), buttons.length - 1)].focus();
  });

  $('#copy-list').addEventListener('click', () => copy(shoppingList(r), 'Shopping list copied'));
  $('#print').addEventListener('click', () => window.print());
  $('#cook-open')?.addEventListener('click', () =>
    openCook(r, {
      checked,
      onCheck: setChecked,
      canWatch: seekable,
      onWatch: playFrom,
      returnFocus: $('#cook-open'),
    }));

  progress();
  paintTimers(); // a timer started earlier, or in cook mode, shows its time left here too
  return { name: 'recipe', layout: 'detail', id: r.id, recipe: r };
}
