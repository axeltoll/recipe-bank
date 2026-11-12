// Home (layout type: list): search, filters, the recipe grid and the queue section.
import { thumbnailUrl } from '/lib/video.mjs';
import { esc, plural } from '/lib/format.mjs';
import {
  filterRecipes, keyCounts, ingredientKeys, stepCount, cardMacros, analysisRequest, queueState, waiting,
} from '/lib/catalog.mjs';
import { columnCount, gridMove, recipeHash, queueHash } from '/lib/nav.mjs';
import {
  $, $$, view, state, store, STATIC, PLATFORM, hub, emit, icon, copy, isPhone, onPhoneChange, removeQueued,
} from './core.js';
import { stateBlock } from './states.js';

const CHIP_LIMIT = 16;
const VIEW_KEY = 'rb:view'; // 'list' = the compact list; anything else = cards
let filtersOpen = false;
let listMode = store.get(VIEW_KEY, 'grid') === 'list';
let enterGrid = false; // the first draw of the grid on a view animates in; filter redraws do not

export function renderHome() {
  document.title = 'Recipe Bank';
  filtersOpen = false;
  enterGrid = true;

  view.innerHTML = `
    <div class="home">
      <header class="home-head">
        <div class="home-title">
          <h1>What are we cooking?</h1>
          <p class="home-sub" id="result-label" role="status"></p>
        </div>
        <div class="home-tools">
          <div class="search">
            ${icon('search')}
            <input id="search" type="search" placeholder="Dish, creator, ingredient…" aria-label="Search recipes"
                   autocomplete="off" enterkeyhint="search" value="${esc(state.q)}">
          </div>
          <button class="btn filter-toggle" type="button" id="filter-toggle" aria-expanded="false" aria-controls="filters">
            ${icon('filter')}<span>Filters</span><span class="count-dot" id="filter-count" hidden></span>
          </button>
          <button class="btn icon-btn" type="button" id="view-toggle" aria-pressed="${listMode}" aria-label="Compact list">${icon('rows')}</button>
          <div class="mount" id="mount-home-tools" data-mount="home-tools"></div>
        </div>
        <div class="active-filters" id="active-filters"></div>
      </header>

      <div class="scrim" id="filter-scrim" hidden></div>
      <aside class="filters" id="filters" aria-labelledby="filters-h" data-open="false">
        <div class="filters-head">
          <h2 id="filters-h">Filters</h2>
          <button class="btn btn-quiet icon-btn" type="button" id="filter-close" aria-label="Close filters">${icon('close')}</button>
        </div>
        <div class="filters-body">
          <section class="filter-group" aria-labelledby="fg-ingredients">
            <h3 id="fg-ingredients">Ingredients</h3>
            <div class="segmented" role="group" aria-label="Match mode">
              <button type="button" data-mode="all" aria-pressed="${state.mode === 'all'}">Has all</button>
              <button type="button" data-mode="any" aria-pressed="${state.mode === 'any'}">Has any</button>
            </div>
            <div class="chip-list" id="chips"></div>
          </section>
          <div class="mount filter-group" id="mount-filter-exclude" data-mount="filter-exclude"></div>
          <div class="mount filter-group" id="mount-filter-tags" data-mount="filter-tags"></div>
          <div class="mount filter-group" id="mount-filter-nutrition" data-mount="filter-nutrition"></div>
        </div>
        <div class="filters-foot">
          <button class="btn btn-quiet" type="button" id="clear">Clear all</button>
          <button class="btn btn-primary" type="button" id="filter-done">Show recipes</button>
        </div>
      </aside>

      <div class="home-main">
        <div class="mount" id="mount-home-top" data-mount="home-top"></div>
        <section aria-labelledby="recipes-h">
          <h2 class="sr-only" id="recipes-h">Recipes</h2>
          <div class="grid" id="grid" data-view="${listMode ? 'list' : 'grid'}"></div>
        </section>
        <section class="queue-section" id="queue-section" aria-labelledby="queue-h" hidden>
          <div class="section-head"><h2 id="queue-h">In the queue</h2><p>Waiting for the research agent</p></div>
          <div class="queue" id="queue"></div>
        </section>
      </div>
    </div>`;

  $('#search').addEventListener('input', (e) => {
    state.q = e.target.value;
    filtersChanged();
  });
  $('#filter-toggle').addEventListener('click', () => setFiltersOpen(!filtersOpen));
  $('#view-toggle').addEventListener('click', (e) => {
    listMode = !listMode;
    store.set(VIEW_KEY, listMode ? 'list' : 'grid');
    e.currentTarget.setAttribute('aria-pressed', String(listMode));
    $('#grid').dataset.view = listMode ? 'list' : 'grid';
  });
  $('#filter-close').addEventListener('click', () => setFiltersOpen(false));
  $('#filter-done').addEventListener('click', () => setFiltersOpen(false));
  $('#filter-scrim').addEventListener('click', () => setFiltersOpen(false));
  $('#clear').addEventListener('click', clearAll);

  // Only the Has all / Has any buttons: a click anywhere else (inside the grid, say) never changes the match mode.
  const modeButtons = $$('.segmented [data-mode]', view);
  modeButtons.forEach((b) =>
    b.addEventListener('click', () => {
      state.mode = b.dataset.mode;
      modeButtons.forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      filtersChanged();
    }));

  $('#chips').addEventListener('click', (e) => {
    const chip = e.target.closest('.chip[data-key]');
    if (chip) {
      const k = chip.dataset.key;
      if (state.keys.has(k)) state.keys.delete(k);
      else state.keys.add(k);
      chip.setAttribute('aria-pressed', String(state.keys.has(k)));
      if (!state.keys.has(k)) {
        // A chip past the first CHIP_LIMIT is shown only while it is on: turned off, it goes back under "Show all".
        renderChips();
        const chips = e.currentTarget;
        (chips.querySelector(`.chip[data-key="${CSS.escape(k)}"]`) ?? chips.querySelector('#more'))?.focus();
      }
      filtersChanged();
      return;
    }
    if (e.target.closest('#more')) {
      state.showAllChips = !state.showAllChips;
      renderChips();
      $('#more')?.focus();
    }
  });

  $('#active-filters').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.removeKey != null) {
      state.keys.delete(b.dataset.removeKey);
      renderChips();
      filtersChanged();
    } else if (b.dataset.clearFilter != null) {
      hub.clear(b.dataset.clearFilter);
      refresh();
    }
    ($('#active-filters button') ?? $('#search')).focus();
  });

  const grid = $('#grid');
  grid.addEventListener('click', (e) => {
    const action = e.target.closest('[data-action]')?.dataset.action;
    if (action === 'clear') clearAll();
    if (action === 'add') $('#open-add').click();
  });
  grid.addEventListener('keydown', onGridKey);

  $('#queue').addEventListener('click', async (e) => {
    const copyBtn = e.target.closest('[data-copy]');
    if (copyBtn) {
      const x = state.queue.find((q) => q.id === copyBtn.dataset.copy);
      if (x) copy(analysisRequest(x), 'Request copied');
      return;
    }
    const removeBtn = e.target.closest('[data-remove]');
    if (removeBtn && (await removeQueued(removeBtn.dataset.remove, removeBtn))) renderQueue();
  });

  renderChips();
  renderQueue();
  refresh();
  return { name: 'home', layout: 'list' };
}

/** Undo anything the home view did outside `main` (the phone filter sheet makes the rest of the page inert). */
export function teardownHome() {
  filtersOpen = false;
  applySheet();
}

function setFiltersOpen(open) {
  const panel = $('#filters');
  if (!panel) return;
  filtersOpen = open;
  panel.dataset.open = String(open);
  $('#filter-toggle').setAttribute('aria-expanded', String(open));
  applySheet();
  if (isPhone()) (open ? $('#filter-close') : $('#filter-toggle')).focus();
}

// On a phone the open filter panel is a modal bottom sheet: the rest of the page is inert and scroll is locked.
// On wider screens the same panel is inline, so nothing else changes.
function applySheet() {
  const panel = $('#filters');
  const modal = Boolean(panel) && filtersOpen && isPhone();
  for (const el of [$('#topbar'), $('.footer'), $('.home-head'), $('.home-main')]) if (el) el.inert = modal;
  document.documentElement.classList.toggle('sheet-open', modal);
  const scrim = $('#filter-scrim');
  if (scrim) scrim.hidden = !modal;
  if (!panel) return;
  if (modal) {
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
  } else {
    panel.removeAttribute('role');
    panel.removeAttribute('aria-modal');
  }
}
onPhoneChange(applySheet);

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && filtersOpen && isPhone()) {
    setFiltersOpen(false);
    return;
  }
  // "/" jumps to the search field, unless the reader is typing or a dialog is open.
  if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return;
  const search = $('#search');
  const t = e.target;
  const typing = t instanceof HTMLElement && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName));
  if (!search || typing || document.querySelector('dialog[open]')) return;
  e.preventDefault();
  search.focus();
  search.select();
});

function clearAll() {
  state.q = '';
  state.keys.clear();
  hub.clear();
  const search = $('#search');
  if (search) search.value = '';
  renderChips();
  filtersChanged();
}

function filtersChanged() {
  store.set('rb:filters', { q: state.q, keys: [...state.keys], mode: state.mode });
  emit('filters', { q: state.q, keys: [...state.keys], mode: state.mode });
  refresh();
}

function renderChips() {
  const el = $('#chips');
  if (!el) return;
  const all = keyCounts(state.recipes);
  // Selected chips always stay visible even when the list is collapsed.
  const shown = state.showAllChips ? all : all.filter(([k], i) => i < CHIP_LIMIT || state.keys.has(k));
  el.innerHTML =
    shown.map(([k, n]) =>
      `<button type="button" class="chip" data-key="${esc(k)}" aria-pressed="${state.keys.has(k)}">${esc(k)}<span class="count">${n}</span></button>`
    ).join('') +
    (all.length > CHIP_LIMIT
      ? `<button type="button" class="btn btn-quiet" id="more" aria-expanded="${state.showAllChips}">${state.showAllChips ? 'Show fewer' : `Show all ${all.length}`}</button>`
      : '') +
    (all.length ? '' : '<p class="muted">Ingredients appear here once there are recipes.</p>');
}

function renderActive() {
  const core = [...state.keys].map((k) =>
    `<button type="button" class="chip chip-on" data-remove-key="${esc(k)}" aria-label="Remove filter: ${esc(k)}">${esc(k)}${icon('close')}</button>`);
  const extra = hub.describe().map(({ id, label }) =>
    `<button type="button" class="chip chip-on" data-clear-filter="${esc(id)}" aria-label="Remove filter: ${esc(label)}">${esc(label)}${icon('close')}</button>`);
  $('#active-filters').innerHTML = [...core, ...extra].join('');
}

/** Re-run the filters and redraw the grid. Safe to call from anywhere; does nothing when home isn't showing. */
export function refresh() {
  const grid = $('#grid');
  if (!grid) return;
  const list = filterRecipes(state.recipes, state, hub.tests());
  const total = state.recipes.length;
  const active = state.keys.size + hub.activeCount();
  const filtering = active > 0 || state.q.trim() !== '';

  $('#result-label').textContent = !total
    ? 'No recipes yet'
    : filtering ? `${list.length} of ${plural(total, 'recipe')}` : plural(total, 'recipe');
  const count = $('#filter-count');
  count.textContent = active ? String(active) : '';
  count.hidden = !active;
  $('#filter-done').textContent = `Show ${plural(list.length, 'recipe')}`;
  $('#clear').disabled = !filtering;
  renderActive();

  if (!total) {
    grid.innerHTML = stateBlock({
      title: 'Your recipe bank is empty',
      text: 'Add a cooking video and it is written up as a recipe: the ingredients in the creator’s own amounts, and the steps with timestamps.',
      actions: `<button class="btn btn-primary" type="button" data-action="add">${icon('plus')}<span>Add a video</span></button>`,
    });
  } else if (!list.length) {
    grid.innerHTML = stateBlock({
      glyph: 'search',
      title: 'No recipe matches',
      text: noMatchText(),
      actions: '<button class="btn btn-primary" type="button" data-action="clear">Clear filters</button>',
    });
  } else {
    grid.innerHTML = list.map(card).join('');
  }
  grid.classList.toggle('grid-enter', enterGrid);
  enterGrid = false;
  emit('grid', { recipes: list, total, root: grid });
}

function noMatchText() {
  const parts = [];
  if (state.q.trim()) parts.push(`“${state.q.trim()}”`);
  if (state.keys.size) parts.push(`${state.mode === 'all' ? 'all of' : 'any of'} ${[...state.keys].join(', ')}`);
  for (const { label } of hub.describe()) parts.push(label);
  const what = parts.length ? `Nothing in the bank has ${parts.join(' and ')}.` : 'Nothing in the bank fits these filters.';
  const hint = state.mode === 'all' && state.keys.size > 1 ? ' Try “Has any”, or remove a filter.' : ' Try removing a filter.';
  return what + hint;
}

function card(r) {
  const thumb = thumbnailUrl(r.video);
  const m = cardMacros(r);
  const keys = ingredientKeys(r);
  const hits = keys.filter((k) => state.keys.has(k));
  const tags = (r.tags ?? []).slice(0, 3);
  const moreTags = (r.tags ?? []).length - tags.length;
  // `time` is not part of the recipe contract today; a card shows it only if a recipe states it.
  const time = typeof r.time === 'string' && r.time.trim() ? `${esc(r.time.trim())} · ` : '';
  return `
    <article class="card" data-id="${esc(r.id)}">
      <div class="card-media">
        <span class="card-ph" aria-hidden="true">${icon('pot')}<span>${esc(PLATFORM[r.video.platform] ?? 'Video')}</span></span>
        ${thumb ? `<img src="${esc(thumb)}" alt="" loading="lazy" decoding="async">` : ''}
        ${r.status === 'partial' ? '<span class="badge badge-warn">Partial</span>' : ''}
      </div>
      <div class="card-body">
        <h3 class="card-title"><a class="card-link" href="${esc(recipeHash(r.id))}">${esc(r.title)}</a></h3>
        <p class="card-by">${esc(r.creator.name)}${r.status === 'partial' ? ' <span class="card-partial">· partial</span>' : ''}</p>
        ${m ? `<p class="card-macros"><strong>${esc(m.text)}</strong>${m.per ? ` per ${esc(m.per)}` : ''}</p>` : ''}
        ${hits.length ? `<p class="card-hits"><span class="sr-only">Has </span>${hits.map((k) => `<span class="hit">${esc(k)}</span>`).join(' ')}</p>` : ''}
        ${tags.length ? `<ul class="card-tags" aria-label="Tags">${tags.map((t) => `<li>${esc(t)}</li>`).join('')}${moreTags > 0 ? `<li>+${moreTags}</li>` : ''}</ul>` : ''}
        <div class="card-foot">
          <p class="card-meta">${time}${plural(keys.length, 'ingredient')} · ${plural(stepCount(r), 'step')}</p>
          <div class="mount card-slot" data-mount="card-actions" data-recipe-id="${esc(r.id)}"></div>
        </div>
      </div>
    </article>`;
}

// Arrow keys, Home and End move focus through the cards the way they are laid out on screen.
function onGridKey(e) {
  if (!e.target.classList?.contains('card-link')) return;
  if (!['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return;
  const links = $$('.card-link', e.currentTarget);
  const index = links.indexOf(e.target);
  const tops = links.map((l) => Math.round(l.closest('.card').getBoundingClientRect().top));
  const next = gridMove(index, e.key, columnCount(tops), links.length);
  e.preventDefault();
  if (next !== index) links[next].focus();
}

export function renderQueue() {
  const section = $('#queue-section');
  if (!section) return;
  const items = waiting(state.queue);
  section.hidden = items.length === 0;
  $('#queue').innerHTML = items.map((x) => {
    const thumb = thumbnailUrl(x.video);
    const s = queueState(x.status);
    return `
      <article class="q-item">
        <div class="q-thumb">
          <span class="card-ph" aria-hidden="true">${icon('pot')}</span>
          ${thumb ? `<img src="${esc(thumb)}" alt="" loading="lazy" decoding="async">` : ''}
        </div>
        <div>
          <h3 class="q-title"><a href="${esc(queueHash(x.id))}">${esc(x.title ?? x.video.url)}</a></h3>
          <p class="q-sub"><span>${esc(x.creator ?? PLATFORM[x.video.platform] ?? 'Video')}</span><span class="badge badge-${s.tone}${x.status === 'analyzing' ? ' badge-pulse' : ''}">${esc(s.label)}</span></p>
          ${x.note ? `<p class="q-note">${esc(x.note)}</p>` : ''}
          <div class="q-actions">
            <button class="btn btn-quiet" type="button" data-copy="${esc(x.id)}">${icon('copy')}<span>Copy request</span></button>
            ${(x.status === 'queued' || x.status === 'failed') && !STATIC ?`<button class="btn btn-quiet btn-danger" type="button" data-remove="${esc(x.id)}">Remove</button>` : ''}
          </div>
        </div>
      </article>`;
  }).join('');
}
