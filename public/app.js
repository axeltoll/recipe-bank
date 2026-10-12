import { parseVideoUrl, embedUrl, thumbnailUrl } from '/lib/video.mjs';

const $ = (sel, root = document) => root.querySelector(sel);
const view = $('#view');

const state = {
  recipes: [],
  invalid: [],
  queue: [],
  q: '',
  keys: new Set(),
  mode: 'all', // 'all' = recipe must contain every selected ingredient; 'any' = at least one
  showAllChips: false,
};

const PLATFORM = { youtube: 'YouTube', tiktok: 'TikTok', instagram: 'Instagram' };
const BASIS_LABEL = {
  'on-screen': 'shown on screen',
  spoken: 'said in the video',
  description: 'from the video description',
  unstated: 'amount not given',
};

// ---------- utils ----------
const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const mmss = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
const plural = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`;
const store = {
  get(k, fallback) {
    try { return JSON.parse(localStorage.getItem(k)) ?? fallback; } catch { return fallback; }
  },
  set(k, v) {
    try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage unavailable */ }
  },
};

function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => el.classList.remove('show'), 2600);
}

async function copy(text, done = 'Copied') {
  try {
    await navigator.clipboard.writeText(text);
    toast(done);
  } catch {
    prompt('Copy this:', text);
  }
}

function recipeKeys(r) {
  const keys = new Set();
  for (const c of r.components) for (const i of c.ingredients) keys.add(i.key);
  return [...keys];
}
const stepCount = (r) => r.components.reduce((n, c) => n + c.steps.length, 0);

function matches(r) {
  const keys = recipeKeys(r);
  if (state.keys.size) {
    const sel = [...state.keys];
    const ok = state.mode === 'all' ? sel.every((k) => keys.includes(k)) : sel.some((k) => keys.includes(k));
    if (!ok) return false;
  }
  const q = state.q.trim().toLowerCase();
  if (!q) return true;
  const hay = [
    r.title, r.summary, r.creator.name, ...(r.tags ?? []),
    ...r.components.flatMap((c) => [c.name, ...c.ingredients.flatMap((i) => [i.item, i.key])]),
  ].join(' ').toLowerCase();
  return q.split(/\s+/).every((w) => hay.includes(w));
}

// ---------- data ----------
async function load() {
  const [r, q] = await Promise.all([fetch('/api/recipes'), fetch('/api/queue')]);
  if (!r.ok || !q.ok) throw new Error('API unavailable');
  const rj = await r.json();
  state.recipes = rj.recipes.sort((a, b) => b.analyzed.localeCompare(a.analyzed) || a.title.localeCompare(b.title));
  state.invalid = rj.invalid;
  state.queue = (await q.json()).queue;
  if (state.invalid.length) console.warn('Invalid recipe files:', state.invalid);
}

function renderStats() {
  const waiting = state.queue.filter((x) => x.status !== 'done').length;
  $('#stats').textContent = `${plural(state.recipes.length, 'recipe')} · ${waiting} in the queue`;
}

// ---------- home ----------
function renderHome() {
  document.title = 'Recipe Bank';
  const saved = store.get('rb:filters', null);
  if (saved && !renderHome.restored) {
    state.q = saved.q ?? '';
    state.keys = new Set(saved.keys ?? []);
    state.mode = saved.mode === 'any' ? 'any' : 'all';
    renderHome.restored = true;
  }

  view.innerHTML = `
    <section class="intro">
      <h1>What are we cooking?</h1>
      <p>Every recipe from the videos you've saved, with the video, the ingredients and the steps. Filter by what's in the fridge, or add a new video for the research agent to write up.</p>
    </section>
    <div class="layout">
      <details class="filters" ${state.keys.size || state.q ? 'open' : ''}>
        <summary><span>Filter by ingredient</span><span class="muted" id="filter-summary"></span></summary>
        <div class="filter-body">
          <h2>Search</h2>
          <div class="search">
            <svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="9" cy="9" r="6"/><path d="m14 14 4 4"/></svg>
            <input id="search" type="search" placeholder="Dish, creator, ingredient…" aria-label="Search recipes" value="${esc(state.q)}">
          </div>
          <h2>Ingredients</h2>
          <div class="filter-mode" role="group" aria-label="Match mode">
            <button type="button" data-mode="all" aria-pressed="${state.mode === 'all'}">Has all</button>
            <button type="button" data-mode="any" aria-pressed="${state.mode === 'any'}">Has any</button>
          </div>
          <div class="chip-list" id="chips" style="margin-top:10px"></div>
          <div class="filter-foot">
            <span class="muted" id="match-count"></span>
            <button class="btn btn-quiet btn-sm" type="button" id="clear">Clear</button>
          </div>
        </div>
      </details>
      <div>
        <section class="section">
          <div class="section-head"><h2>Recipes</h2><p id="result-label"></p></div>
          <div class="grid" id="grid"></div>
        </section>
        <section class="section" id="queue-section">
          <div class="section-head"><h2>In the queue</h2><p>Waiting for the research agent</p></div>
          <div class="queue" id="queue"></div>
        </section>
      </div>
    </div>`;

  // The filter panel collapses behind a summary on narrow screens only; on wide
  // screens the summary is hidden, so the panel must be forced open.
  const filters = $('.filters');
  const wide = matchMedia('(min-width: 901px)');
  const syncOpen = () => { if (wide.matches) filters.open = true; };
  wide.onchange = syncOpen;
  syncOpen();

  $('#search').addEventListener('input', (e) => { state.q = e.target.value; update(); });
  view.querySelectorAll('[data-mode]').forEach((b) =>
    b.addEventListener('click', () => {
      state.mode = b.dataset.mode;
      view.querySelectorAll('[data-mode]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      update();
    }));
  $('#clear').addEventListener('click', () => {
    state.q = '';
    state.keys.clear();
    $('#search').value = '';
    update();
  });
  renderQueue();
  update();
}

function renderChips() {
  const counts = new Map();
  for (const r of state.recipes) for (const k of recipeKeys(r)) counts.set(k, (counts.get(k) ?? 0) + 1);
  const all = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const LIMIT = 16;
  // Selected chips always stay visible even when collapsed.
  const shown = state.showAllChips ? all : all.filter(([k], i) => i < LIMIT || state.keys.has(k));
  const el = $('#chips');
  el.innerHTML =
    shown.map(([k, n]) =>
      `<button type="button" class="chip" data-key="${esc(k)}" aria-pressed="${state.keys.has(k)}">${esc(k)}<span class="count">${n}</span></button>`
    ).join('') +
    (all.length > LIMIT
      ? `<button type="button" class="btn btn-quiet btn-sm chip-toggle" id="more">${state.showAllChips ? 'Show fewer' : `Show all ${all.length}`}</button>`
      : '');
  el.querySelectorAll('.chip').forEach((c) =>
    c.addEventListener('click', () => {
      const k = c.dataset.key;
      state.keys.has(k) ? state.keys.delete(k) : state.keys.add(k);
      update();
    }));
  $('#more')?.addEventListener('click', () => { state.showAllChips = !state.showAllChips; renderChips(); });
}

function update() {
  store.set('rb:filters', { q: state.q, keys: [...state.keys], mode: state.mode });
  renderChips();
  const list = state.recipes.filter(matches);
  const filtering = state.keys.size || state.q.trim();
  $('#match-count').textContent = filtering ? `${list.length} of ${state.recipes.length} match` : '';
  $('#filter-summary').textContent = state.keys.size ? `${state.keys.size} selected` : '';
  $('#result-label').textContent = filtering ? plural(list.length, 'match', 'matches') : plural(list.length, 'recipe');
  $('#grid').innerHTML = list.length
    ? list.map(card).join('')
    : `<div class="empty">No recipe has ${state.mode === 'all' ? 'all of' : 'any of'} those.<br>Try removing an ingredient or switching to “Has any”.</div>`;
}

function card(r) {
  const keys = recipeKeys(r);
  const hits = keys.filter((k) => state.keys.has(k));
  const rest = keys.filter((k) => !state.keys.has(k));
  const preview = [...hits, ...rest].slice(0, 6);
  const thumb = thumbnailUrl(r.video);
  return `
    <a class="card" href="#/r/${esc(r.id)}">
      <div class="thumb">
        ${thumb ? `<img src="${esc(thumb)}" alt="" loading="lazy">` : ''}
        <span class="badge ${esc(r.status)}">${r.status === 'partial' ? 'Partial recipe' : 'Full recipe'}</span>
        <span class="play" aria-hidden="true"></span>
      </div>
      <div class="card-body">
        <h3>${esc(r.title)}</h3>
        <div class="by">${esc(r.creator.name)}</div>
        <div class="ings">${preview.map((k) => `<span class="ing ${state.keys.has(k) ? 'hit' : ''}">${esc(k)}</span>`).join('')}${keys.length > 6 ? `<span class="ing">+${keys.length - 6}</span>` : ''}</div>
        <div class="meta">${plural(keys.length, 'ingredient')} · ${plural(stepCount(r), 'step')}${r.components.length > 1 ? ` · ${plural(r.components.length, 'part')}` : ''}</div>
      </div>
    </a>`;
}

function renderQueue() {
  const items = state.queue.filter((x) => x.status !== 'done');
  $('#queue-section').hidden = items.length === 0;
  $('#queue').innerHTML = items.map((x) => {
    const thumb = thumbnailUrl(x.video);
    return `
      <div class="q-item">
        <a class="q-thumb" href="#/q/${esc(x.id)}" aria-label="Watch ${esc(x.title ?? 'video')}">${thumb ? `<img src="${esc(thumb)}" alt="" loading="lazy">` : ''}</a>
        <div>
          <div class="q-title">${esc(x.title ?? x.video.url)}</div>
          <div class="q-sub">${esc(x.creator ?? PLATFORM[x.video.platform])} · <span class="badge ${esc(x.status)}">${x.status === 'analyzing' ? 'Being analyzed' : 'Queued'}</span></div>
          ${x.note ? `<p class="q-note">${esc(x.note)}</p>` : ''}
          <div class="q-actions">
            <a class="btn btn-sm" href="#/q/${esc(x.id)}">Watch</a>
            <button class="btn btn-sm btn-quiet" type="button" data-copy="${esc(x.id)}" title="Copy a message for the Recipe Bank topic in Telegram">Copy request</button>
            ${x.status === 'queued' ? `<button class="btn btn-sm btn-quiet" type="button" data-remove="${esc(x.id)}">Remove</button>` : ''}
          </div>
        </div>
      </div>`;
  }).join('');
  view.querySelectorAll('[data-copy]').forEach((b) =>
    b.addEventListener('click', () => {
      const x = state.queue.find((q) => q.id === b.dataset.copy);
      copy(analysisRequest(x), 'Request copied. Paste it in the Recipe Bank topic');
    }));
  view.querySelectorAll('[data-remove]').forEach((b) =>
    b.addEventListener('click', async () => {
      const res = await fetch(`/api/queue/${b.dataset.remove}`, { method: 'DELETE' });
      if (!res.ok) return toast('Could not remove it');
      state.queue = state.queue.filter((q) => q.id !== b.dataset.remove);
      renderStats();
      renderQueue();
    }));
}

function analysisRequest(x) {
  return [
    `Recipe Bank: analyze this video → ${x.video.url}`,
    x.note ? `Note: ${x.note}` : null,
    `Write recipes/<slug>.json in ~/dev/recipe-bank (contract: CLAUDE.md), run npm run validate, and file the format finding in research/findings/food-content-culture.`,
  ].filter(Boolean).join('\n');
}

// ---------- detail ----------
function renderRecipe(id) {
  const r = state.recipes.find((x) => x.id === id);
  if (!r) return renderMissing();
  document.title = `${r.title} · Recipe Bank`;
  const checked = new Set(store.get(`rb:checked:${r.id}`, []));
  const n = r.nutrition;

  view.innerHTML = `
    <a class="back" href="#/">← All recipes</a>
    <article class="detail">
      <div class="player-col">
        <div class="player">${player(r.video)}</div>
        <div class="player-links">
          <a href="${esc(r.video.url)}" target="_blank" rel="noopener">Open on ${PLATFORM[r.video.platform]} ↗</a>
          ${r.creator.url ? `<a href="${esc(r.creator.url)}" target="_blank" rel="noopener">${esc(r.creator.handle ?? 'Creator')} ↗</a>` : ''}
        </div>
      </div>
      <div>
        <span class="badge ${esc(r.status)}">${r.status === 'partial' ? 'Partial recipe: the creator held details back' : 'Full recipe from the video'}</span>
        <h1>${esc(r.title)}</h1>
        <p class="by">by ${esc(r.creator.name)}${r.uploaded ? ` · posted ${esc(r.uploaded)}` : ''}</p>
        <p class="summary">${esc(r.summary)}</p>
        <div class="tags">${(r.tags ?? []).map((t) => `<span class="tag">${esc(t)}</span>`).join('')}</div>
        <dl class="facts">
          <div><dt>Makes</dt><dd>${esc(r.serves ?? 'not stated')}</dd></div>
          <div><dt>Ingredients</dt><dd>${recipeKeys(r).length}</dd></div>
          <div><dt>Steps</dt><dd>${stepCount(r)}</dd></div>
          <div><dt>Analyzed</dt><dd>${esc(r.analyzed)}</dd></div>
        </dl>

        <section class="panel" aria-labelledby="ing-h">
          <div class="panel-head">
            <h2 id="ing-h">Ingredients</h2>
            <button class="btn btn-sm btn-quiet" type="button" id="copy-list">Copy shopping list</button>
          </div>
          <p class="basis-legend">Amounts are exactly as the creator gave them. <i>Amount not given</i> means the video didn't say.</p>
          ${r.components.filter((c) => c.ingredients.length).map((c, ci) => `
            ${r.components.length > 1 ? `<h3>${esc(c.name)}</h3>` : ''}
            <ul class="ing-list">
              ${c.ingredients.map((i, ii) => {
                const key = `${ci}.${ii}`;
                return `<li><label>
                  <input type="checkbox" data-check="${key}" ${checked.has(key) ? 'checked' : ''}>
                  <span><span class="name">${esc(i.item)}</span>${i.note ? `<span class="note">${esc(i.note)}</span>` : ''}</span>
                  <span class="amt ${i.basis === 'unstated' ? 'unstated' : ''}" title="${esc(BASIS_LABEL[i.basis])}">${esc(i.amount ?? 'amount not given')}</span>
                </label></li>`;
              }).join('')}
            </ul>`).join('')}
        </section>

        <section class="panel" aria-labelledby="steps-h">
          <div class="panel-head"><h2 id="steps-h">Step by step</h2></div>
          ${r.components.filter((c) => c.steps.length).map((c) => `
            ${r.components.length > 1 ? `<h3>${esc(c.name)}</h3>` : ''}
            <ol class="steps">
              ${c.steps.map((s) => `<li><p>${esc(s.text)}${s.t != null ? `<button type="button" class="ts" data-t="${s.t}" aria-label="Play from ${mmss(s.t)}">${mmss(s.t)}</button>` : ''}</p></li>`).join('')}
            </ol>`).join('')}
        </section>

        ${n ? `
        <section class="panel" aria-labelledby="nut-h">
          <div class="panel-head"><h2 id="nut-h">Nutrition per ${esc(n.per)}</h2></div>
          <div class="nutrition">
            ${[['calories', 'kcal'], ['protein_g', 'protein g'], ['carbs_g', 'carbs g'], ['fat_g', 'fat g']]
              .filter(([k]) => n[k] != null).map(([k, l]) => `<div><b>${esc(n[k])}</b><span>${l}</span></div>`).join('')}
          </div>
          <p class="source">Source: ${esc(BASIS_LABEL[n.basis] ?? n.basis)}.${n.note ? ' ' + esc(n.note) : ''}</p>
        </section>` : ''}

        ${(r.gaps?.length || r.notes?.length) ? `
        <section class="panel">
          ${r.gaps?.length ? `<div class="callout gaps"><h3>What the video doesn't say</h3><ul>${r.gaps.map((g) => `<li>${esc(g)}</li>`).join('')}</ul></div>` : ''}
          ${r.notes?.length ? `<div class="callout notes"><h3>Notes</h3><ul>${r.notes.map((g) => `<li>${esc(g)}</li>`).join('')}</ul></div>` : ''}
          ${r.source ? `<p class="source">${esc(r.source.quantity_basis ?? '')}<br>Research: <code>${esc(r.source.finding ?? '')}</code></p>` : ''}
        </section>` : ''}
      </div>
    </article>`;

  view.querySelectorAll('[data-check]').forEach((box) =>
    box.addEventListener('change', () => {
      box.checked ? checked.add(box.dataset.check) : checked.delete(box.dataset.check);
      store.set(`rb:checked:${r.id}`, [...checked]);
    }));
  view.querySelectorAll('.ts').forEach((b) =>
    b.addEventListener('click', () => {
      const frame = $('.player iframe');
      const src = embedUrl(r.video, { start: Number(b.dataset.t), autoplay: true });
      if (frame && src) {
        frame.src = src;
        if (matchMedia('(max-width: 900px)').matches) frame.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }));
  $('#copy-list').addEventListener('click', () => copy(shoppingList(r), 'Shopping list copied'));
  view.focus({ preventScroll: true });
  scrollTo(0, 0);
}

function shoppingList(r) {
  const lines = [`${r.title}`];
  for (const c of r.components) {
    if (!c.ingredients.length) continue;
    if (r.components.length > 1) lines.push('', `${c.name}:`);
    for (const i of c.ingredients) lines.push(`- ${i.item}${i.amount ? `: ${i.amount}` : ''}`);
  }
  return lines.join('\n');
}

function player(video, start = 0) {
  const src = embedUrl(video, { start });
  if (!src) {
    return `<div class="empty" style="height:100%;display:grid;place-items:center;border:0;color:#bbb">This link can't be embedded.<br><a href="${esc(video.url)}" target="_blank" rel="noopener">Open the video ↗</a></div>`;
  }
  return `<iframe src="${esc(src)}" title="Recipe video" loading="lazy"
    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
    referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe>`;
}

function renderQueued(id) {
  const x = state.queue.find((q) => q.id === id);
  if (!x) return renderMissing();
  document.title = `${x.title ?? 'Queued video'} · Recipe Bank`;
  view.innerHTML = `
    <a class="back" href="#/">← All recipes</a>
    <article class="detail">
      <div class="player-col"><div class="player">${player(x.video)}</div>
        <div class="player-links"><a href="${esc(x.video.url)}" target="_blank" rel="noopener">Open on ${PLATFORM[x.video.platform]} ↗</a></div>
      </div>
      <div>
        <span class="badge ${esc(x.status)}">${x.status === 'analyzing' ? 'Being analyzed' : 'Queued'}</span>
        <h1>${esc(x.title ?? 'Untitled video')}</h1>
        <p class="by">${x.creator ? `by ${esc(x.creator)} · ` : ''}added ${esc(x.addedAt.slice(0, 10))}</p>
        <section class="panel">
          <h2>Ingredients and steps are on the way</h2>
          <p class="muted">The research agent is writing this one up. Once the recipe file lands in <code>recipes/</code> it moves to your recipes automatically.</p>
          ${x.note ? `<div class="callout notes"><h3>Your note</h3>${esc(x.note)}</div>` : ''}
          <p style="margin-top:14px"><button class="btn btn-sm" type="button" id="copy-req">Copy request for Telegram</button></p>
        </section>
      </div>
    </article>`;
  $('#copy-req').addEventListener('click', () => copy(analysisRequest(x), 'Request copied. Paste it in the Recipe Bank topic'));
  scrollTo(0, 0);
}

function renderMissing() {
  view.innerHTML = `<a class="back" href="#/">← All recipes</a><div class="empty">That recipe isn't in the bank.</div>`;
}

// ---------- add dialog ----------
function setupAdd() {
  const dlg = $('#add-dialog');
  const url = $('#add-url');
  const hint = $('#add-detect');
  const err = $('#add-error');
  $('#open-add').addEventListener('click', () => {
    $('#add-form').reset();
    hint.textContent = '';
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
  $('#add-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    err.textContent = '';
    const submit = $('#add-submit');
    submit.disabled = true;
    try {
      const res = await fetch('/api/queue', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url: url.value, note: $('#add-note').value }),
      });
      const body = await res.json();
      if (res.status === 409 && body.recipeId) {
        dlg.close();
        location.hash = `#/r/${body.recipeId}`;
        return toast('That one is already in the bank');
      }
      if (!res.ok) { err.textContent = body.error ?? 'Could not add it'; return; }
      state.queue.push(body.entry);
      dlg.close();
      renderStats();
      location.hash = '#/';
      route();
      toast(`Queued${body.entry.title ? `: ${body.entry.title}` : ''}`);
    } catch {
      err.textContent = 'The Recipe Bank server is not reachable. Is `npm start` running?';
    } finally {
      submit.disabled = false;
    }
  });
}

// ---------- router ----------
function route() {
  const [, kind, id] = location.hash.match(/^#\/(r|q)\/(.+)$/) ?? [];
  if (kind === 'r') return renderRecipe(decodeURIComponent(id));
  if (kind === 'q') return renderQueued(decodeURIComponent(id));
  renderHome();
}

setupAdd();
window.addEventListener('hashchange', route);
load()
  .then(() => { renderStats(); route(); })
  .catch(() => {
    view.innerHTML = `<div class="empty">Couldn't load the recipes. Start the server with <code>npm start</code> and open <code>http://127.0.0.1:4780</code>.</div>`;
  });
