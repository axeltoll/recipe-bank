// The interactive showcase: filters the sample recipes like the dashboard does and opens one as a recipe page.
// Every string from the data goes through esc() in showcase-core.js.

import recipes from '../data/showcase.js';
import {
  CHIP_LIMIT, filterRecipes, keyCounts, plural, renderCard, renderChips, renderDetail, shoppingList,
} from './showcase-core.js';

export function initShowcase() {
  const root = document.getElementById('demo');
  if (!root || !recipes.length) return;
  const el = (id) => document.getElementById(id);
  const side = el('demo-side');
  const search = el('demo-search');
  const chips = el('demo-chips');
  const count = el('demo-count');
  const list = el('demo-list');
  const detail = el('demo-detail');
  if (!side || !search || !chips || !count || !list || !detail) return;

  const counts = keyCounts(recipes);
  const state = { q: '', keys: new Set(), mode: 'all', showAll: false, activeId: recipes[0].id };
  const filter = () => ({ q: state.q, keys: state.keys, mode: state.mode });
  const active = () => recipes.find((r) => r.id === state.activeId) ?? recipes[0];

  function drawChips() {
    chips.innerHTML = renderChips(counts, state.keys, { showAll: state.showAll, limit: CHIP_LIMIT });
  }

  function drawDetail() {
    detail.innerHTML = renderDetail(active());
  }

  function drawList() {
    const found = filterRecipes(recipes, filter());
    const filtering = state.keys.size > 0 || state.q.trim() !== '';
    count.textContent = filtering
      ? `${found.length} of ${recipes.length} match`
      : `${plural(recipes.length, 'recipe')} from the repository`;
    // Keep an open recipe that still matches; otherwise open the first match.
    if (found.length && !found.some((r) => r.id === state.activeId)) {
      state.activeId = found[0].id;
      drawDetail();
    }
    list.innerHTML = found.length
      ? found.map((r) => renderCard(r, { selected: state.keys, active: r.id === state.activeId })).join('')
      : `<p class="demo-empty">No recipe has ${state.mode === 'all' ? 'all of' : 'any of'} those. Try removing an ingredient or switching to Has any.</p>`;
  }

  search.addEventListener('input', () => { state.q = search.value; drawList(); });

  root.addEventListener('click', async (e) => {
    const target = e.target instanceof Element ? e.target : null;
    if (!target) return;

    const chip = target.closest('[data-key]');
    if (chip) {
      const k = chip.dataset.key;
      if (state.keys.has(k)) state.keys.delete(k); else state.keys.add(k);
      chip.setAttribute('aria-pressed', String(state.keys.has(k)));
      return drawList();
    }
    if (target.closest('[data-more]')) {
      state.showAll = !state.showAll;
      drawChips();
      return el('demo-more')?.focus();
    }
    const mode = target.closest('[data-mode]');
    if (mode) {
      state.mode = mode.dataset.mode === 'any' ? 'any' : 'all';
      root.querySelectorAll('[data-mode]').forEach((b) => b.setAttribute('aria-pressed', String(b === mode)));
      return drawList();
    }
    if (target.closest('#demo-clear')) {
      state.q = '';
      state.keys.clear();
      search.value = '';
      drawChips();
      return drawList();
    }
    const card = target.closest('[data-recipe]');
    if (card) {
      state.activeId = card.dataset.recipe;
      list.querySelectorAll('[data-recipe]').forEach((b) => b.setAttribute('aria-pressed', String(b === card)));
      drawDetail();
      // Below 1024 px the recipe sits under the list, so bring it into view.
      if (!matchMedia('(min-width: 1024px)').matches) {
        const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;
        detail.scrollIntoView({ behavior: calm ? 'auto' : 'smooth', block: 'start' });
      }
      return;
    }
    if (target.closest('[data-copy-list]')) {
      const status = detail.querySelector('[data-copy-status]');
      const text = shoppingList(active());
      try {
        await navigator.clipboard.writeText(text);
        if (status) status.textContent = 'Shopping list copied.';
      } catch {
        // Clipboard access can be blocked (insecure origin, permissions). Show the list instead.
        if (status) status.textContent = `Copying is blocked here. The list: ${text.replace(/\n+/g, ' ; ')}`;
      }
    }
  });

  drawChips();
  drawDetail();
  drawList();
  el('demo-fallback')?.setAttribute('hidden', '');
  side.hidden = false;
  detail.hidden = false;
}
