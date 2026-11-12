// Extra recipe filters: Without (exclude ingredients), tags, minimum protein and maximum calories.
// Self-contained; see INTEGRATION.md. It sits beside the dashboard's own search and Has all / Has any.
//
//   import { mount } from '/features/filters.mjs';
//   import { matchesFilter } from '/lib/filter.mjs';
//   mount(el, { recipes });
//   el.addEventListener('rb:filter-change', (e) => {
//     const visible = recipes.filter((r) => matchesFilter(r, { ...dashboardState, ...e.detail.filter }));
//   });
//
// Persists to localStorage ('rb:filters-extra') and fires 'rb:filter-change' { filter }.

import { normalizeFilter, keyCounts, tagCounts, nutritionRange, describeFilter } from '../../lib/filter.mjs';
import { esc, makeStore, ensureStylesheet, emit } from './shared.mjs';

export const FILTER_KEY = 'rb:filters-extra';
export const FILTER_EVENT = 'rb:filter-change';
export const SECTIONS = ['without', 'tags', 'nutrition'];

/** The filter fields each section owns. */
const SECTION_FIELDS = { without: ['without'], tags: ['tags'], nutrition: ['minProtein', 'maxCalories'] };
const ownFields = (sections) => sections.flatMap((s) => SECTION_FIELDS[s] ?? []);

/**
 * `f` with only the fields of `sections` kept; the others are off. A panel's summary is built from this and
 * its "Clear these" clears only these fields, so a panel showing one section never reports or clears another's.
 */
export function sectionFilter(f, sections = SECTIONS) {
  const n = extraFilter(f);
  const own = new Set(ownFields(sections));
  return extraFilter(Object.fromEntries(Object.entries(n).map(([k, v]) => [k, own.has(k) ? v : null])));
}

/** Only the fields this module owns: { without, tags, minProtein, maxCalories }. */
export function extraFilter(f) {
  const n = normalizeFilter(f);
  return { without: n.without, tags: n.tags, minProtein: n.minProtein, maxCalories: n.maxCalories };
}

function chips(kind, all, selected, { limit, expanded }) {
  const shown = expanded ? all : all.filter(([k], i) => i < limit || selected.includes(k));
  return shown.map(([k, n]) => `<button type="button" class="rbf-chip" data-${kind}="${esc(k)}" aria-pressed="${selected.includes(k)}">${esc(k)}<span class="rbf-chip-count">${n}</span></button>`).join('')
    + (all.length > limit ? `<button type="button" class="rbf-btn rbf-btn-quiet rbf-more" data-more="${kind}">${expanded ? 'Show fewer' : `Show all ${all.length}`}</button>` : '');
}

/** The filter panel as HTML. Pure: used by mount() and the tests. */
export function renderFilters(recipes, filter, { sections = SECTIONS, limit = 16, expanded = {} } = {}) {
  const f = extraFilter(filter);
  const range = nutritionRange(recipes);
  const parts = [];
  if (sections.includes('without')) {
    parts.push(`
      <div class="rbf-group" data-group="without">
        <h3 id="rbf-without-h">Without</h3>
        <p class="rbf-hint">Hide recipes that list any of these. It goes by the ingredient list only, so it is not an allergy check.</p>
        <div class="rbf-chips" role="group" aria-labelledby="rbf-without-h">${chips('without', keyCounts(recipes), f.without, { limit, expanded: expanded.without })}</div>
      </div>`);
  }
  if (sections.includes('tags')) {
    parts.push(`
      <div class="rbf-group" data-group="tags">
        <h3 id="rbf-tags-h">Tags</h3>
        <div class="rbf-chips" role="group" aria-labelledby="rbf-tags-h">${chips('tag', tagCounts(recipes), f.tags, { limit, expanded: expanded.tag })}</div>
      </div>`);
  }
  if (sections.includes('nutrition')) {
    parts.push(`
      <div class="rbf-group" data-group="nutrition">
        <h3>Nutrition</h3>
        <p class="rbf-hint">Only ${range.stating} of ${recipes.length} recipes state their macros. Values are per serving or per piece, as the creator gives them.</p>
        <div class="rbf-numbers">
          <label><span>Protein at least (g)</span>
            <input type="number" inputmode="numeric" min="0" step="1" name="minProtein" placeholder="any" value="${f.minProtein ?? ''}">
          </label>
          <label><span>Calories at most (kcal)</span>
            <input type="number" inputmode="numeric" min="0" step="10" name="maxCalories" placeholder="any" value="${f.maxCalories ?? ''}">
          </label>
        </div>
      </div>`);
  }
  const summary = describeFilter(sectionFilter(f, sections));
  return `
    <section class="rbf rbf-filters" aria-label="More filters">
      ${parts.join('')}
      <div class="rbf-foot">
        <span class="rbf-summary" data-summary aria-live="polite">${esc(summary)}</span>
        <button type="button" class="rbf-btn rbf-btn-quiet" data-clear${summary ? '' : ' hidden'}>Clear these</button>
      </div>
    </section>`;
}

/**
 * Mount the filters into `el`.
 * options: recipes (required), filter (initial; default: the stored one), storageKey, storage,
 *          persist (default true), sections (any of 'without', 'tags', 'nutrition'), limit (chips before
 *          "Show all", default 16), css (default true), onChange(filter).
 * Returns { getFilter, setFilter, update, destroy }.
 */
export function mount(el, options = {}) {
  let opts = { storageKey: FILTER_KEY, persist: true, sections: SECTIONS, limit: 16, css: true, ...options };
  if (opts.css) ensureStylesheet(new URL('./filters.css', import.meta.url).href);
  const store = makeStore(opts.storage);
  let recipes = opts.recipes ?? [];
  let filter = extraFilter(opts.filter ?? (opts.persist ? store.get(opts.storageKey, {}) : {}));
  const expanded = { without: false, tag: false };

  const render = () => {
    el.innerHTML = renderFilters(recipes, filter, { ...opts, expanded });
  };
  const changed = ({ rerender = false } = {}) => {
    if (opts.persist) store.set(opts.storageKey, filter);
    if (rerender) render();
    else {
      const summary = describeFilter(sectionFilter(filter, opts.sections));
      const s = el.querySelector('[data-summary]');
      if (s) s.textContent = summary;
      const clear = el.querySelector('[data-clear]');
      if (clear) clear.hidden = !summary;
    }
    opts.onChange?.(filter);
    emit(el, FILTER_EVENT, { filter });
  };
  const toggle = (list, value) => (list.includes(value) ? list.filter((x) => x !== value) : [...list, value]);

  const onClick = (e) => {
    const w = e.target.closest('[data-without]');
    if (w) {
      filter = { ...filter, without: toggle(filter.without, w.dataset.without) };
      w.setAttribute('aria-pressed', String(filter.without.includes(w.dataset.without)));
      return changed();
    }
    const t = e.target.closest('[data-tag]');
    if (t) {
      filter = { ...filter, tags: toggle(filter.tags, t.dataset.tag) };
      t.setAttribute('aria-pressed', String(filter.tags.includes(t.dataset.tag)));
      return changed();
    }
    const more = e.target.closest('[data-more]');
    if (more) {
      expanded[more.dataset.more] = !expanded[more.dataset.more];
      return render();
    }
    if (e.target.closest('[data-clear]')) {
      // Only what this panel shows: fields of sections that are not mounted here stay as they are.
      const off = extraFilter({});
      filter = { ...filter, ...Object.fromEntries(ownFields(opts.sections).map((k) => [k, off[k]])) };
      return changed({ rerender: true });
    }
  };
  // Number inputs update the filter without re-rendering, so typing keeps focus.
  const onInput = (e) => {
    const input = e.target.closest('input[name="minProtein"], input[name="maxCalories"]');
    if (!input) return;
    filter = extraFilter({ ...filter, [input.name]: input.value });
    changed();
  };

  el.addEventListener('click', onClick);
  el.addEventListener('input', onInput);
  render();

  return {
    getFilter: () => filter,
    setFilter(next) {
      filter = extraFilter(next);
      changed({ rerender: true });
    },
    update(next = {}) {
      opts = { ...opts, ...next };
      if (next.recipes) recipes = next.recipes;
      if (next.filter) filter = extraFilter(next.filter);
      render();
    },
    destroy() {
      el.removeEventListener('click', onClick);
      el.removeEventListener('input', onInput);
      el.innerHTML = '';
    },
  };
}
