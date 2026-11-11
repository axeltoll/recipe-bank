// Combined shopping list for the week plan (or any set of recipes). Self-contained; see INTEGRATION.md.
//
//   import { mount } from '/features/shopping-list.mjs';
//   mount(document.querySelector('#shop'), { recipes });          // follows the stored week plan
//   mount(el, { recipes, plan: { items: [{ recipe: 'banana-milk', day: null }] }, persist: false });
//
// Ticked items persist in localStorage ('rb:shopping-checked'). Fires 'rb:shopping-check' { checked }
// and 'rb:shopping-copy' { text, copied }.

import { shoppingListForPlan, shoppingListText, lineAmount, normalizePlan } from '../../lib/plan.mjs';
import { esc, makeStore, ensureStylesheet, emit, copyText } from './shared.mjs';
import { PLAN_KEY, PLAN_EVENT, readPlan } from './week-plan.mjs';

export const CHECKED_KEY = 'rb:shopping-checked';

const BASIS_LABEL = {
  'on-screen': 'shown on screen',
  spoken: 'said in the video',
  description: 'from the video description',
  unstated: 'amount not given',
};

/** The list as HTML. Pure: used by mount() and by the tests. `checked` is a Set of ingredient keys. */
export function renderShoppingList(list, checked = new Set(), { title = 'Shopping list', href = (id) => `#/r/${encodeURIComponent(id)}` } = {}) {
  if (!list.recipes.length) {
    return `
      <section class="rbf rbf-shop" aria-label="${esc(title)}">
        <header class="rbf-head"><h2>${esc(title)}</h2></header>
        <p class="rbf-empty">Add recipes to the week plan and their ingredients show up here, merged by ingredient.</p>
      </section>`;
  }
  const done = list.groups.reduce((n, g) => n + g.items.filter((it) => checked.has(it.key)).length, 0);
  return `
    <section class="rbf rbf-shop" aria-label="${esc(title)}">
      <header class="rbf-head">
        <h2>${esc(title)}</h2>
        <p class="rbf-muted" data-progress>${done} of ${list.itemCount} ticked</p>
        <span class="rbf-actions">
          <button type="button" class="rbf-btn" data-copy>Copy list</button>
          ${done ? '<button type="button" class="rbf-btn rbf-btn-quiet" data-untick>Untick all</button>' : ''}
        </span>
      </header>
      <p class="rbf-for">For ${list.recipes.map((r) => `<a href="${esc(href(r.id))}">${esc(r.title)}</a>${r.times > 1 ? ` <span class="rbf-times">×${r.times}</span>` : ''}`).join(', ')}</p>
      <p class="rbf-note">Amounts are as each creator gave them, listed per recipe and never added up. <i>Amount not given</i> means the video didn't say.</p>
      ${list.groups.map((g) => `
        <section class="rbf-aisle" data-aisle="${esc(g.aisle)}">
          <h3>${esc(g.label)}</h3>
          <ul class="rbf-items">
            ${g.items.map((it) => `
              <li class="rbf-item${checked.has(it.key) ? ' rbf-done' : ''}">
                <label>
                  <input type="checkbox" data-key="${esc(it.key)}"${checked.has(it.key) ? ' checked' : ''}>
                  <span class="rbf-key">${esc(it.key)}</span>
                  ${it.recipes > 1 ? `<span class="rbf-count">${it.recipes} recipes</span>` : ''}
                </label>
                <ul class="rbf-lines">
                  ${it.lines.map((l) => `
                    <li>
                      <span class="rbf-amt${l.amount == null ? ' rbf-unstated' : ''}" title="${esc(BASIS_LABEL[l.basis] ?? '')}">${esc(lineAmount(l))}</span>
                      <span class="rbf-from">${esc(l.item)} · ${esc(l.title)}${it.lines.filter((x) => x.recipeId === l.recipeId).length > 1 ? ` (${esc(l.component)})` : ''}</span>
                    </li>`).join('')}
                </ul>
              </li>`).join('')}
          </ul>
        </section>`).join('')}
      <p class="rbf-copy-fallback" hidden><label>Copy this list<textarea readonly rows="8"></textarea></label></p>
    </section>`;
}

/**
 * Mount the shopping list into `el`.
 * options: recipes (required); plan (fixed plan; default: follow the stored week plan and 'rb:plan-change');
 *          planKey, checkedKey, storage, persist (default true), title, href, css (default true),
 *          copyChecked (default false: ticked items are left out of the copied text).
 * Returns { getList, getText, update, destroy }.
 */
export function mount(el, options = {}) {
  let opts = { planKey: PLAN_KEY, checkedKey: CHECKED_KEY, persist: true, css: true, copyChecked: false, ...options };
  if (opts.css) ensureStylesheet(new URL('./shopping-list.css', import.meta.url).href);
  const store = makeStore(opts.storage);
  const follow = !opts.plan;
  let recipes = opts.recipes ?? [];
  let plan = normalizePlan(opts.plan ?? readPlan({ key: opts.planKey, storage: opts.storage }));
  let checked = new Set(opts.persist ? store.get(opts.checkedKey, []) : []);
  let list;

  const render = () => {
    list = shoppingListForPlan(plan, recipes);
    el.innerHTML = renderShoppingList(list, checked, opts);
  };
  const saveChecked = () => {
    if (opts.persist) store.set(opts.checkedKey, [...checked]);
    emit(el, 'rb:shopping-check', { checked: [...checked] });
  };

  const onChange = (e) => {
    const box = e.target.closest('input[data-key]');
    if (!box) return;
    box.checked ? checked.add(box.dataset.key) : checked.delete(box.dataset.key);
    box.closest('.rbf-item')?.classList.toggle('rbf-done', box.checked);
    const done = list.groups.reduce((n, g) => n + g.items.filter((it) => checked.has(it.key)).length, 0);
    const progress = el.querySelector('[data-progress]');
    if (progress) progress.textContent = `${done} of ${list.itemCount} ticked`;
    saveChecked();
  };
  const onClick = async (e) => {
    if (e.target.closest('[data-untick]')) {
      checked = new Set();
      saveChecked();
      return render();
    }
    if (e.target.closest('[data-copy]')) {
      const text = shoppingListText(list, { checked: opts.copyChecked ? null : checked });
      const copied = await copyText(text);
      const fallback = el.querySelector('.rbf-copy-fallback');
      if (!copied && fallback) {
        fallback.hidden = false;
        const area = fallback.querySelector('textarea');
        area.value = text;
        area.focus();
        area.select();
      }
      const btn = el.querySelector('[data-copy]');
      if (copied && btn) {
        btn.textContent = 'Copied';
        setTimeout(() => { btn.textContent = 'Copy list'; }, 2000);
      }
      emit(el, 'rb:shopping-copy', { text, copied });
    }
  };
  const onPlan = (e) => {
    if (!follow || !e.detail?.plan) return;
    plan = normalizePlan(e.detail.plan);
    render();
  };
  const onStorage = (e) => {
    if (e.key === opts.planKey && follow) {
      plan = readPlan({ key: opts.planKey, storage: opts.storage });
      render();
    } else if (e.key === opts.checkedKey && opts.persist) {
      checked = new Set(store.get(opts.checkedKey, []));
      render();
    }
  };

  el.addEventListener('change', onChange);
  el.addEventListener('click', onClick);
  document.addEventListener(PLAN_EVENT, onPlan);
  window.addEventListener('storage', onStorage);
  render();

  return {
    getList: () => list,
    getText: () => shoppingListText(list, { checked: opts.copyChecked ? null : checked }),
    update(next = {}) {
      opts = { ...opts, ...next };
      if (next.recipes) recipes = next.recipes;
      if (next.plan) plan = normalizePlan(next.plan);
      render();
    },
    destroy() {
      el.removeEventListener('change', onChange);
      el.removeEventListener('click', onClick);
      document.removeEventListener(PLAN_EVENT, onPlan);
      window.removeEventListener('storage', onStorage);
      el.innerHTML = '';
    },
  };
}
