// Combined shopping list for the week plan (or any set of recipes). Self-contained; see INTEGRATION.md.
//
//   import { mount } from '/features/shopping-list.mjs';
//   mount(document.querySelector('#shop'), { recipes });          // follows the stored week plan
//   mount(el, { recipes, plan: { items: [{ recipe: 'banana-milk', day: null }] }, persist: false });
//
// Ticked items persist in localStorage ('rb:shopping-checked'). Fires 'rb:shopping-check' { checked }
// and 'rb:shopping-copy' { text, copied }.
//
// Purchase option (see PURCHASE.md): mount(el, { recipes, household: true }) shows how
// much to buy for the household profile instead, with a pantry of keys that are left out
// ('rb:pantry', fires 'rb:pantry-change' { pantry }). Without the option nothing changes.

import { shoppingListForPlan, shoppingListText, lineAmount, normalizePlan } from '../../lib/plan.mjs';
import { esc, makeStore, ensureStylesheet, emit, copyText } from './shared.mjs';
import { PLAN_KEY, PLAN_EVENT, readPlan } from './week-plan.mjs';
// purchase option
import { purchaseList, purchaseListText, householdLine, normalizePantry, DEFAULT_PANTRY, FLAGS } from '../../lib/purchase.mjs';
import { normalizeProfile } from '../../lib/household.mjs'; // purchase option

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

// ---------- purchase option ----------

export const PANTRY_KEY = 'rb:pantry';
export const PANTRY_EVENT = 'rb:pantry-change';
// The household profile as public/features/household.mjs stores and announces it. The key is repeated
// here instead of imported, so this module keeps loading on its own.
export const HOUSEHOLD_KEY = 'recipe-bank:household';
export const HOUSEHOLD_EVENT = 'recipe-bank:household-change';

/** The stored household profile, normalised (two adults when there is none or storage is blocked). */
export function readHousehold({ key = HOUSEHOLD_KEY, storage } = {}) {
  return normalizeProfile(makeStore(storage).get(key, null));
}

/** The stored pantry; DEFAULT_PANTRY until the user changes it (an emptied pantry stays empty). */
export function readPantry({ key = PANTRY_KEY, storage } = {}) {
  const raw = makeStore(storage).get(key, null);
  return raw == null ? [...DEFAULT_PANTRY] : normalizePantry(raw);
}

/** Store the pantry; returns false when storage is unavailable. */
export function writePantry(pantry, { key = PANTRY_KEY, storage } = {}) {
  return makeStore(storage).set(key, normalizePantry(pantry));
}

/** What a creator amount became: "800g → 520g", or the creator's words as they were. */
function sourceAmount(s) {
  if (s.original == null) return 'amount not given';
  return (s.status === 'added' || s.status === 'scaled') && s.amount !== s.original ? `${s.original} → ${s.amount}` : s.original;
}

function renderPantry(pantry, leftOut, open) {
  if (!pantry) return '';
  const said = leftOut.length
    ? `Left out: you have these: ${esc(leftOut.join(', '))}.`
    : 'Nothing left out: none of this week’s ingredients is in your pantry.';
  return `
      <section class="rbf-pantry" aria-label="Pantry">
        <p class="rbf-note" data-left-out>${said}</p>
        <details class="rbf-pantry-edit"${open ? ' open' : ''}>
          <summary>Pantry: ${pantry.length ? `${pantry.length} ${pantry.length === 1 ? 'thing' : 'things'} you always have` : 'empty'}</summary>
          <ul class="rbf-chips">
            ${pantry.map((k) => `<li><button type="button" class="rbf-chip" data-pantry-remove="${esc(k)}" aria-label="Remove ${esc(k)} from the pantry">${esc(k)} <span aria-hidden="true">×</span></button></li>`).join('')}
          </ul>
          <form class="rbf-pantry-form" data-pantry-form>
            <label>Add to the pantry <input name="pantry" type="text" maxlength="200" autocomplete="off" placeholder="olive oil, sugar"></label>
            <button type="submit" class="rbf-btn">Add</button>
          </form>
          <button type="button" class="rbf-btn rbf-btn-quiet" data-pantry-reset>Reset to ${esc(DEFAULT_PANTRY.join(', '))}</button>
        </details>
      </section>`;
}

/**
 * The purchase list (lib/purchase.mjs purchaseList()) as HTML. Pure: used by mount() and the tests.
 * `checked` is a Set of keys; options: title, href, pantry (the pantry list, shows the editor), pantryOpen.
 */
export function renderPurchaseList(purchase, checked = new Set(), {
  title = 'Shopping list for your household', href = (id) => `#/r/${encodeURIComponent(id)}`, pantry = null, pantryOpen = false,
} = {}) {
  const pantryHtml = renderPantry(pantry, purchase.leftOut, pantryOpen);
  if (!purchase.recipes.length) {
    return `
    <section class="rbf rbf-shop rbf-purchase" aria-label="${esc(title)}">
      <header class="rbf-head"><h2>${esc(title)}</h2></header>
      <p class="rbf-for rbf-household">${esc(householdLine(purchase))}</p>
      <p class="rbf-empty">Add recipes to the week plan and the amounts to buy for your household show up here.</p>
      ${pantryHtml}
    </section>`;
  }
  const done = purchase.groups.reduce((n, g) => n + g.items.filter((it) => checked.has(it.key)).length, 0);
  const unscaled = purchase.recipes.filter((r) => r.flag);
  return `
    <section class="rbf rbf-shop rbf-purchase" aria-label="${esc(title)}">
      <header class="rbf-head">
        <h2>${esc(title)}</h2>
        <p class="rbf-muted" data-progress>${done} of ${purchase.itemCount} ticked</p>
        <span class="rbf-actions">
          <button type="button" class="rbf-btn" data-copy>Copy list</button>
          <button type="button" class="rbf-btn rbf-btn-quiet" data-print>Print</button>
          ${done ? '<button type="button" class="rbf-btn rbf-btn-quiet" data-untick>Untick all</button>' : ''}
        </span>
      </header>
      <p class="rbf-for rbf-household">${esc(householdLine(purchase))}</p>
      <p class="rbf-for">Meals: ${purchase.recipes.map((r) => `<a href="${esc(href(r.id))}">${esc(r.title)}</a>${r.times > 1 ? ` <span class="rbf-times">×${r.times}</span>` : ''}`).join(', ')}</p>
      <p class="rbf-note">Amounts are scaled from what each recipe serves to your household and added up when the units match; grams, cups and spoons are never converted into each other. Amounts in words, per person, or from a recipe that doesn’t state its servings are shown as the creator gave them and marked <b>check</b>.</p>
      ${unscaled.length ? `<p class="rbf-note rbf-unscaled">Not scaled: ${unscaled.map((r) => `${esc(r.title)} (${esc(FLAGS[r.flag])})`).join('; ')}.</p>` : ''}
      ${purchase.groups.map((g) => `
        <section class="rbf-aisle" data-aisle="${esc(g.aisle)}">
          <h3>${esc(g.label)}</h3>
          <ul class="rbf-items">
            ${g.items.map((it) => `
              <li class="rbf-item${checked.has(it.key) ? ' rbf-done' : ''}">
                <label>
                  <input type="checkbox" data-key="${esc(it.key)}"${checked.has(it.key) ? ' checked' : ''}>
                  <span class="rbf-key">${esc(it.key)}</span>
                  <span class="rbf-amt rbf-buy${it.amount == null ? ' rbf-unstated' : ''}">${esc(it.amount ?? 'amount not given')}</span>
                  ${it.flagged ? `<span class="rbf-check" title="${esc(it.flags.map((f) => FLAGS[f]).join('; '))}">check</span>` : ''}
                </label>
                <ul class="rbf-lines">
                  ${it.sources.map((s) => `
                    <li>
                      <span class="rbf-amt${s.original == null ? ' rbf-unstated' : ''}" title="${esc(BASIS_LABEL[s.basis] ?? '')}">${esc(sourceAmount(s))}</span>
                      <span class="rbf-from">${esc(s.item)} · ${esc(s.title)}${s.times > 1 ? ` ×${s.times}` : ''}</span>
                      ${Object.hasOwn(FLAGS, s.status) && s.status !== 'unstated' ? `<span class="rbf-flag-note">${esc(FLAGS[s.status])}</span>` : ''}
                    </li>`).join('')}
                </ul>
              </li>`).join('')}
          </ul>
        </section>`).join('')}
      ${pantryHtml}
      <p class="rbf-copy-fallback" hidden><label>Copy this list<textarea readonly rows="8"></textarea></label></p>
    </section>`;
}

/**
 * Mount the shopping list into `el`.
 * options: recipes (required); plan (fixed plan; default: follow the stored week plan and 'rb:plan-change');
 *          planKey, checkedKey, storage, persist (default true), title, href, css (default true),
 *          copyChecked (default false: ticked items are left out of the copied text).
 *          Purchase option: household (default false: show purchase amounts for the
 *          household profile); profile (fixed profile; default: the stored one, following
 *          'recipe-bank:household-change'); pantry (initial pantry; default the stored one or DEFAULT_PANTRY);
 *          householdKey, pantryKey.
 * Returns { getList, getText, update, destroy } and, for the purchase option, getPurchase, getPantry, setPantry.
 */
export function mount(el, options = {}) {
  let opts = {
    planKey: PLAN_KEY, checkedKey: CHECKED_KEY, persist: true, css: true, copyChecked: false,
    householdKey: HOUSEHOLD_KEY, pantryKey: PANTRY_KEY, // purchase option
    ...options,
  };
  if (opts.css) ensureStylesheet(new URL('./shopping-list.css', import.meta.url).href);
  const store = makeStore(opts.storage);
  const follow = !opts.plan;
  let recipes = opts.recipes ?? [];
  let plan = normalizePlan(opts.plan ?? readPlan({ key: opts.planKey, storage: opts.storage }));
  let checked = new Set(opts.persist ? store.get(opts.checkedKey, []) : []);
  let list;

  // ---- purchase option: state is only read when opts.household is on ----
  const followHousehold = !options.profile;
  let purchase = null;
  let profile = null;
  let pantry = null;
  let pantryOpen = false;
  const loadPurchaseState = () => {
    profile ??= normalizeProfile(opts.profile ?? readHousehold({ key: opts.householdKey, storage: opts.storage }));
    pantry ??= opts.pantry ? normalizePantry(opts.pantry)
      : opts.persist ? readPantry({ key: opts.pantryKey, storage: opts.storage }) : [...DEFAULT_PANTRY];
  };
  const renderPurchase = () => {
    loadPurchaseState();
    purchase = purchaseList(plan, recipes, profile, { pantry });
    el.innerHTML = renderPurchaseList(purchase, checked, { ...opts, pantry, pantryOpen });
  };
  const setPantry = (next) => {
    loadPurchaseState();
    pantry = normalizePantry(next);
    if (opts.persist) writePantry(pantry, { key: opts.pantryKey, storage: opts.storage });
    emit(el, PANTRY_EVENT, { pantry: [...pantry] });
    render();
  };
  // ---- end purchase option ----

  const render = () => {
    list = shoppingListForPlan(plan, recipes);
    if (opts.household) return renderPurchase(); // purchase option
    purchase = null; // purchase option
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
    const shown = purchase ?? list; // purchase option: count what is on screen
    const done = shown.groups.reduce((n, g) => n + g.items.filter((it) => checked.has(it.key)).length, 0);
    const progress = el.querySelector('[data-progress]');
    if (progress) progress.textContent = `${done} of ${shown.itemCount} ticked`;
    saveChecked();
  };
  // purchase option: the plain text of whatever is shown
  const textNow = () => (purchase
    ? purchaseListText(purchase, { checked: opts.copyChecked ? null : checked })
    : shoppingListText(list, { checked: opts.copyChecked ? null : checked }));
  const onClick = async (e) => {
    if (e.target.closest('[data-untick]')) {
      checked = new Set();
      saveChecked();
      return render();
    }
    // ---- purchase option: pantry chips, reset and print ----
    const remove = e.target.closest('[data-pantry-remove]');
    if (remove) {
      pantryOpen = true;
      return setPantry(pantry.filter((k) => k !== remove.dataset.pantryRemove));
    }
    if (e.target.closest('[data-pantry-reset]')) {
      pantryOpen = true;
      return setPantry(DEFAULT_PANTRY);
    }
    if (e.target.closest('[data-print]')) {
      globalThis.print?.();
      return;
    }
    // ---- end purchase option ----
    if (e.target.closest('[data-copy]')) {
      const text = textNow(); // purchase option
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
    } else if (opts.household && e.key === opts.householdKey && followHousehold) { // purchase option
      profile = null;
      render();
    } else if (opts.household && e.key === opts.pantryKey && opts.persist) { // purchase option
      pantry = readPantry({ key: opts.pantryKey, storage: opts.storage });
      render();
    }
  };
  // ---- purchase option: household changes and the pantry form ----
  const onHousehold = (e) => {
    if (!opts.household || !followHousehold || !e.detail?.profile) return;
    profile = normalizeProfile(e.detail.profile);
    render();
  };
  const onSubmit = (e) => {
    const form = e.target.closest?.('[data-pantry-form]');
    if (!form) return;
    e.preventDefault();
    const add = normalizePantry(form.elements.pantry?.value ?? '');
    if (!add.length) return;
    pantryOpen = true;
    setPantry([...pantry, ...add]);
    el.querySelector('[data-pantry-form] input')?.focus();
  };
  el.addEventListener('submit', onSubmit);
  document.addEventListener(HOUSEHOLD_EVENT, onHousehold);
  // ---- end purchase option ----

  el.addEventListener('change', onChange);
  el.addEventListener('click', onClick);
  document.addEventListener(PLAN_EVENT, onPlan);
  window.addEventListener('storage', onStorage);
  render();

  return {
    getList: () => list,
    getText: () => textNow(), // purchase option: purchase text when it is shown
    getPurchase: () => purchase, // purchase option
    getPantry: () => (loadPurchaseState(), [...pantry]), // purchase option
    setPantry, // purchase option
    update(next = {}) {
      opts = { ...opts, ...next };
      if (next.recipes) recipes = next.recipes;
      if (next.plan) plan = normalizePlan(next.plan);
      if (next.profile) profile = normalizeProfile(next.profile); // purchase option
      if (next.pantry) pantry = normalizePantry(next.pantry); // purchase option
      render();
    },
    destroy() {
      el.removeEventListener('change', onChange);
      el.removeEventListener('click', onClick);
      el.removeEventListener('submit', onSubmit); // purchase option
      document.removeEventListener(PLAN_EVENT, onPlan);
      document.removeEventListener(HOUSEHOLD_EVENT, onHousehold); // purchase option
      window.removeEventListener('storage', onStorage);
      el.innerHTML = '';
    },
  };
}
