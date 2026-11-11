// Pure logic and HTML strings for the site's recipe showcase. No DOM access, so node:test can run it.
// The filter rules mirror the dashboard (public/app.js): "Has all" / "Has any" over ingredient keys, plus a
// word search over title, summary, creator, tags, component names and ingredients.

export const PLATFORM = { youtube: 'YouTube', tiktok: 'TikTok', instagram: 'Instagram' };
export const BASIS_LABEL = {
  'on-screen': 'shown on screen',
  spoken: 'said in the video',
  description: 'from the video description',
  unstated: 'amount not given',
};
export const CHIP_LIMIT = 10;

const ENTITIES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ENTITIES[c]);
export const mmss = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
export const plural = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`;

/** Unique ingredient filter keys of a recipe, in first-seen order. */
export function recipeKeys(r) {
  const keys = new Set();
  for (const c of r.components) for (const i of c.ingredients) keys.add(i.key);
  return [...keys];
}

export const stepCount = (r) => r.components.reduce((n, c) => n + c.steps.length, 0);

/** True when the recipe passes the ingredient filter (mode 'all' or 'any') and every search word. */
export function matches(r, { q = '', keys = [], mode = 'all' } = {}) {
  const own = recipeKeys(r);
  const sel = [...keys];
  if (sel.length) {
    const ok = mode === 'all' ? sel.every((k) => own.includes(k)) : sel.some((k) => own.includes(k));
    if (!ok) return false;
  }
  const query = q.trim().toLowerCase();
  if (!query) return true;
  const hay = [
    r.title, r.summary, r.creator.name, ...(r.tags ?? []),
    ...r.components.flatMap((c) => [c.name, ...c.ingredients.flatMap((i) => [i.item, i.key])]),
  ].join(' ').toLowerCase();
  return query.split(/\s+/).every((w) => hay.includes(w));
}

export const filterRecipes = (recipes, filter) => recipes.filter((r) => matches(r, filter));

/** [[key, recipeCount], ...] sorted by count (high first), then by key. */
export function keyCounts(recipes) {
  const counts = new Map();
  for (const r of recipes) for (const k of recipeKeys(r)) counts.set(k, (counts.get(k) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

/** Link to the video on its platform. YouTube links start at second `t` when it is above zero. */
export function watchUrl(video, t = 0) {
  const start = Math.floor(Number(t) || 0);
  if (video?.platform === 'youtube' && video.id && start > 0) {
    return `https://www.youtube.com/watch?v=${encodeURIComponent(video.id)}&t=${start}s`;
  }
  return video?.url ?? '';
}

/** The same plain-text shopping list the dashboard copies. */
export function shoppingList(r) {
  const lines = [`${r.title}`];
  for (const c of r.components) {
    if (!c.ingredients.length) continue;
    if (r.components.length > 1) lines.push('', `${c.name}:`);
    for (const i of c.ingredients) lines.push(`- ${i.item}${i.amount ? `: ${i.amount}` : ''}`);
  }
  return lines.join('\n');
}

// ---------- HTML strings ----------

/** Ingredient chips. Collapsed, it shows the first `limit` keys plus any selected ones. */
export function renderChips(counts, selected = [], { showAll = false, limit = CHIP_LIMIT } = {}) {
  const sel = new Set(selected);
  const shown = showAll ? counts : counts.filter(([k], i) => i < limit || sel.has(k));
  const chips = shown.map(([k, n]) =>
    `<button type="button" class="chip" data-key="${esc(k)}" aria-pressed="${sel.has(k)}">${esc(k)}<span class="n" aria-hidden="true">${n}</span></button>`
  ).join('');
  const more = counts.length > limit
    ? `<button type="button" class="chip chip-more" id="demo-more" data-more aria-expanded="${showAll}">${showAll ? 'Show fewer' : `Show all ${counts.length}`}</button>`
    : '';
  return chips + more;
}

/** One recipe in the result list. Selected ingredient keys are listed first and highlighted. */
export function renderCard(r, { selected = [], active = false } = {}) {
  const sel = new Set(selected);
  const keys = recipeKeys(r);
  const preview = [...keys.filter((k) => sel.has(k)), ...keys.filter((k) => !sel.has(k))].slice(0, 5);
  const parts = r.components.length;
  return `<button type="button" class="demo-card" data-recipe="${esc(r.id)}" aria-pressed="${active}">
    <span class="badge ${esc(r.status)}">${r.status === 'partial' ? 'Partial recipe' : 'Full recipe'}</span>
    <span class="demo-card-title">${esc(r.title)}</span>
    <span class="demo-card-by">${esc(r.creator.name)}</span>
    <span class="demo-card-ings">${preview.map((k) => `<span class="ing${sel.has(k) ? ' hit' : ''}">${esc(k)}</span>`).join('')}${keys.length > 5 ? `<span class="ing">+${keys.length - 5}</span>` : ''}</span>
    <span class="demo-card-meta">${plural(keys.length, 'ingredient')} · ${plural(stepCount(r), 'step')}${parts > 1 ? ` · ${plural(parts, 'part')}` : ''}</span>
  </button>`;
}

function renderIngredient(i) {
  const unstated = i.basis === 'unstated';
  return `<li><label>
      <input type="checkbox">
      <span class="rd-ing"><span class="rd-ing-name">${esc(i.item)}</span>${i.note ? `<small>${esc(i.note)}</small>` : ''}</span>
      <span class="rd-amt${unstated ? ' unstated' : ''}">${esc(i.amount ?? BASIS_LABEL.unstated)}${unstated ? '' : `<small>${esc(BASIS_LABEL[i.basis] ?? i.basis)}</small>`}</span>
    </label></li>`;
}

function renderStep(s, video) {
  if (s.t == null) return `<li><p>${esc(s.text)}</p></li>`;
  const label = mmss(s.t);
  const where = PLATFORM[video.platform] ?? 'its platform';
  return `<li><p>${esc(s.text)} <a class="ts" href="${esc(watchUrl(video, s.t))}" target="_blank" rel="noopener" aria-label="Open the video at ${label} on ${esc(where)}">${label}</a></p></li>`;
}

/** The recipe page: header, ingredient checklist, steps with timestamps, nutrition and gaps. */
export function renderDetail(r) {
  const multi = r.components.length > 1;
  const n = r.nutrition;
  const where = PLATFORM[r.video.platform] ?? 'the original site';
  const creator = r.creator.url
    ? `<a href="${esc(r.creator.url)}" target="_blank" rel="noopener">${esc(r.creator.name)}</a>`
    : esc(r.creator.name);
  const macros = n
    ? [['calories', 'kcal'], ['protein_g', 'protein g'], ['carbs_g', 'carbs g'], ['fat_g', 'fat g']]
        .filter(([k]) => n[k] != null).map(([k, l]) => `<div><b>${esc(n[k])}</b><span>${l}</span></div>`).join('')
    : '';
  return `
  <header class="rd-head">
    <span class="badge ${esc(r.status)}">${r.status === 'partial' ? 'Partial recipe: some details are missing' : 'Full recipe from the video'}</span>
    <h3 class="rd-title">${esc(r.title)}</h3>
    <p class="rd-by">by ${creator} · <a href="${esc(r.video.url)}" target="_blank" rel="noopener">Watch on ${esc(where)}</a></p>
    <p class="rd-summary">${esc(r.summary)}</p>
    <ul class="rd-tags" aria-label="Tags">${(r.tags ?? []).map((t) => `<li>${esc(t)}</li>`).join('')}</ul>
    <dl class="rd-facts">
      <div><dt>Makes</dt><dd>${esc(r.serves ?? 'not stated')}</dd></div>
      <div><dt>Ingredients</dt><dd>${recipeKeys(r).length}</dd></div>
      <div><dt>Steps</dt><dd>${stepCount(r)}</dd></div>
    </dl>
  </header>
  <div class="rd-cols">
    <section class="rd-panel" aria-label="Ingredients">
      <div class="rd-panel-head">
        <h4>Ingredients</h4>
        <button type="button" class="btn btn-small" data-copy-list>Copy shopping list</button>
      </div>
      <p class="rd-status" data-copy-status role="status"></p>
      <p class="rd-legend">Amounts are exactly as the creator gave them. <i>Amount not given</i> means the video did not say.</p>
      ${r.components.filter((c) => c.ingredients.length).map((c) => `
      ${multi ? `<h5>${esc(c.name)}</h5>` : ''}
      <ul class="rd-ings">${c.ingredients.map(renderIngredient).join('')}</ul>`).join('')}
    </section>
    <section class="rd-panel" aria-label="Step by step">
      <div class="rd-panel-head"><h4>Step by step</h4></div>
      ${r.components.filter((c) => c.steps.length).map((c) => `
      ${multi ? `<h5>${esc(c.name)}</h5>` : ''}
      <ol class="rd-steps">${c.steps.map((s) => renderStep(s, r.video)).join('')}</ol>`).join('')}
    </section>
  </div>
  ${n ? `
  <section class="rd-panel" aria-label="Nutrition">
    <div class="rd-panel-head"><h4>Nutrition per ${esc(n.per)}</h4></div>
    <div class="rd-nutrition">${macros}</div>
    <p class="rd-source">Source: ${esc(BASIS_LABEL[n.basis] ?? n.basis)}.${n.note ? ' ' + esc(n.note) : ''}</p>
  </section>` : ''}
  ${r.gaps?.length ? `
  <section class="rd-gaps" aria-label="What the video does not say">
    <h4>What the video does not say</h4>
    <ul>${r.gaps.map((g) => `<li>${esc(g)}</li>`).join('')}</ul>
  </section>` : ''}`;
}
