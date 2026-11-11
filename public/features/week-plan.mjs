// Week plan: pick recipes for the days of the week. Self-contained; see INTEGRATION.md.
//
//   import { mount } from '/features/week-plan.mjs';
//   const plan = mount(document.querySelector('#week'), { recipes });
//
// Persists to localStorage ('rb:week-plan') and fires 'rb:plan-change' { plan, source }.

import {
  DAYS, DAY_LABELS, ANY_DAY_LABEL, emptyPlan, normalizePlan, addToPlan, removeFromPlan, moveInPlan, planByDay,
} from '../../lib/plan.mjs';
import { esc, makeStore, ensureStylesheet, emit } from './shared.mjs';

export const PLAN_KEY = 'rb:week-plan';
export const PLAN_EVENT = 'rb:plan-change';

/** The stored plan (never throws). Pass `recipes` to drop recipes that are no longer in the bank. */
export function readPlan({ key = PLAN_KEY, storage, recipes } = {}) {
  const raw = makeStore(storage).get(key, null);
  return normalizePlan(raw, recipes ? recipes.map((r) => r.id) : null);
}

/** Store the plan; returns false when storage is unavailable. */
export function writePlan(plan, { key = PLAN_KEY, storage } = {}) {
  return makeStore(storage).set(key, normalizePlan(plan));
}

/**
 * Add a recipe to the stored week from anywhere (e.g. an "Add to week" button on a recipe page).
 * Mounted week plans and shopping lists update through the 'rb:plan-change' event.
 */
export function addRecipeToWeek(recipeId, day = null, { key = PLAN_KEY, storage, target = globalThis.document } = {}) {
  const plan = addToPlan(readPlan({ key, storage }), recipeId, day);
  writePlan(plan, { key, storage });
  if (target) emit(target, PLAN_EVENT, { plan, source: 'addRecipeToWeek' });
  return plan;
}

const dayOptions = (selected) =>
  [...DAYS.map((d) => [d, DAY_LABELS[d]]), ['', ANY_DAY_LABEL]]
    .map(([v, l]) => `<option value="${v}"${(selected ?? '') === v ? ' selected' : ''}>${esc(l)}</option>`).join('');

/**
 * The week plan as HTML. Pure: used by mount() and by the tests.
 * `href(recipe)` makes the link for a planned recipe.
 */
export function renderWeekPlan(plan, recipes, { href = (r) => `#/r/${encodeURIComponent(r.id)}`, showEmptyDays = true, title = 'Week plan' } = {}) {
  const byId = new Map((recipes ?? []).map((r) => [r.id, r]));
  const p = normalizePlan(plan, [...byId.keys()]);
  const byDay = planByDay(p);
  const count = p.items.length;
  const sorted = [...byId.values()].sort((a, b) => a.title.localeCompare(b.title));

  const day = (d) => {
    const ids = byDay[d === '' ? 'any' : d];
    if (!ids.length && !showEmptyDays) return '';
    const label = d === '' ? ANY_DAY_LABEL : DAY_LABELS[d];
    return `
      <li class="rbf-day${ids.length ? '' : ' rbf-day-empty'}" data-day="${d}">
        <h3>${esc(label)}</h3>
        ${ids.length ? `<ul class="rbf-planned">${ids.map((id) => {
          const r = byId.get(id);
          return `<li>
            <a href="${esc(href(r))}">${esc(r.title)}</a>
            <span class="rbf-row-actions">
              <select data-move="${esc(id)}" data-from="${d}" aria-label="Move ${esc(r.title)} to another day">${dayOptions(d)}</select>
              <button type="button" class="rbf-btn rbf-btn-quiet" data-remove="${esc(id)}" data-from="${d}" aria-label="Remove ${esc(r.title)} from ${esc(label)}">Remove</button>
            </span>
          </li>`;
        }).join('')}</ul>` : '<p class="rbf-empty">Nothing planned</p>'}
      </li>`;
  };

  return `
    <section class="rbf rbf-week" aria-label="${esc(title)}">
      <header class="rbf-head">
        <h2>${esc(title)}</h2>
        <p class="rbf-muted" data-count>${count === 0 ? 'Nothing planned yet' : `${count} ${count === 1 ? 'meal' : 'meals'} planned`}</p>
        ${count ? '<button type="button" class="rbf-btn rbf-btn-quiet" data-clear>Clear week</button>' : ''}
      </header>
      <form class="rbf-add" data-add>
        <label><span>Recipe</span>
          <select name="recipe" required>
            <option value="">Choose a recipe…</option>
            ${sorted.map((r) => `<option value="${esc(r.id)}">${esc(r.title)}</option>`).join('')}
          </select>
        </label>
        <label><span>Day</span><select name="day">${dayOptions('')}</select></label>
        <button type="submit" class="rbf-btn rbf-btn-primary">Add to week</button>
      </form>
      <ol class="rbf-days">${[...DAYS, ''].map(day).join('')}</ol>
    </section>`;
}

/**
 * Mount the week plan into `el`.
 * options: recipes (required), plan (initial; default: the stored plan), storageKey, storage,
 *          persist (default true), href, showEmptyDays, title, css (default true), onChange(plan).
 * Returns { getPlan, setPlan, add, update, destroy }.
 */
export function mount(el, options = {}) {
  let opts = { storageKey: PLAN_KEY, persist: true, css: true, ...options };
  const token = Symbol('week-plan');
  if (opts.css) ensureStylesheet(new URL('./week-plan.css', import.meta.url).href);
  let recipes = opts.recipes ?? [];
  // Kept unfiltered: a recipe that isn't loaded (yet) is hidden when rendering, never dropped from storage.
  let plan = normalizePlan(opts.plan ?? readPlan({ key: opts.storageKey, storage: opts.storage }));

  const render = () => {
    el.innerHTML = renderWeekPlan(plan, recipes, opts);
  };
  const commit = (next) => {
    plan = normalizePlan(next);
    if (opts.persist) writePlan(plan, { key: opts.storageKey, storage: opts.storage });
    render();
    opts.onChange?.(plan);
    emit(el, PLAN_EVENT, { plan, source: token });
  };

  const onClick = (e) => {
    const rm = e.target.closest('[data-remove]');
    if (rm) return commit(removeFromPlan(plan, rm.dataset.remove, rm.dataset.from || null));
    if (e.target.closest('[data-clear]')) return commit(emptyPlan());
  };
  const onChange = (e) => {
    const mv = e.target.closest('[data-move]');
    if (mv) commit(moveInPlan(plan, mv.dataset.move, mv.dataset.from || null, mv.value || null));
  };
  const onSubmit = (e) => {
    const form = e.target.closest('[data-add]');
    if (!form) return;
    e.preventDefault();
    const id = form.elements.recipe.value;
    if (!id) return;
    commit(addToPlan(plan, id, form.elements.day.value || null));
  };
  // Another module (or addRecipeToWeek) changed the plan.
  const onExternal = (e) => {
    if (e.detail?.source === token || !e.detail?.plan) return;
    plan = normalizePlan(e.detail.plan);
    render();
  };
  // Another tab changed the stored plan.
  const onStorage = (e) => {
    if (e.key !== opts.storageKey || !opts.persist) return;
    plan = readPlan({ key: opts.storageKey, storage: opts.storage });
    render();
  };

  el.addEventListener('click', onClick);
  el.addEventListener('change', onChange);
  el.addEventListener('submit', onSubmit);
  document.addEventListener(PLAN_EVENT, onExternal);
  window.addEventListener('storage', onStorage);
  render();

  return {
    getPlan: () => plan,
    setPlan: (next) => commit(next),
    add: (recipeId, day = null) => commit(addToPlan(plan, recipeId, day)),
    update(next = {}) {
      opts = { ...opts, ...next };
      if (next.recipes) recipes = next.recipes;
      if (next.plan) plan = normalizePlan(next.plan);
      render();
    },
    destroy() {
      el.removeEventListener('click', onClick);
      el.removeEventListener('change', onChange);
      el.removeEventListener('submit', onSubmit);
      document.removeEventListener(PLAN_EVENT, onExternal);
      window.removeEventListener('storage', onStorage);
      el.innerHTML = '';
    },
  };
}
