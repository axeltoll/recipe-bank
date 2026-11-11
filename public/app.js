// Recipe Bank dashboard: boot, data loading, the hash router and the API handed to feature modules.
// Views live in ui/, logic that needs no DOM in /lib/ (filtering: /lib/filter.mjs through /lib/catalog.mjs).
// Contracts: docs/design/DESIGN.md and MOUNT-POINTS.md. Feature modules are listed in features/index.js.
import { parseRoute } from '/lib/nav.mjs';
import { sortRecipes } from '/lib/catalog.mjs';
import { esc } from '/lib/format.mjs';
import {
  $, $$, view, state, store, STATIC, apiPath, hub, emit, mount, icon, toast, copy, renderStats, restoreFilters,
} from './ui/core.js';
import { renderHome, refresh, teardownHome } from './ui/home.js';
import { renderRecipe } from './ui/recipe.js';
import { renderQueued } from './ui/queue.js';
import { renderLoading, renderError, stateBlock } from './ui/states.js';
import { closeCook } from './ui/cook.js';
import { setupAdd } from './ui/add.js';
import { setupTheme } from './ui/theme.js';
import { setupOffline } from './ui/offline.js';

let booted = false;
let featuresInstalled = false;
let current = { name: null };
let homeScroll = 0;

// ---------- data ----------
async function load() {
  const [r, q] = await Promise.all([fetch(apiPath('recipes')), fetch(apiPath('queue'))]);
  if (!r.ok || !q.ok) throw new Error('API unavailable');
  const rj = await r.json();
  state.recipes = sortRecipes(rj.recipes);
  state.invalid = rj.invalid ?? [];
  state.queue = (await q.json()).queue;
  if (state.invalid.length) console.warn('Invalid recipe files:', state.invalid);
}

// ---------- router ----------
function renderNav(activeName) {
  const nav = $('#nav');
  const items = hub.navItems();
  nav.hidden = items.length === 0;
  const active = hub.route(activeName) ? activeName : 'home';
  nav.innerHTML = items.length
    ? [{ name: 'home', label: 'Recipes', href: '#/' }, ...items]
      .map((i) => `<a href="${esc(i.href)}"${i.name === active ? ' aria-current="page"' : ''}>${esc(i.label)}</a>`)
      .join('')
    : '';
}

function renderCustom(next) {
  const def = hub.route(next.name);
  document.title = `${def.title ?? def.label ?? next.name} · Recipe Bank`;
  view.innerHTML = '';
  try {
    def.render(view, next.param, rb);
  } catch (e) {
    console.error(e);
    view.innerHTML = stateBlock({
      glyph: 'alert',
      title: 'This page could not be shown',
      actions: '<a class="btn btn-primary" href="#/">All recipes</a>',
    });
    return { name: next.name, layout: 'message', param: next.param };
  }
  return { name: next.name, layout: def.layout, param: next.param };
}

function route() {
  const next = parseRoute(location.hash, hub.routeNames());
  if (current.name === 'home') homeScroll = window.scrollY;
  closeCook();
  teardownHome();

  let detail;
  if (next.name === 'recipe') detail = renderRecipe(next.id);
  else if (next.name === 'queue') detail = renderQueued(next.id);
  else if (next.custom) detail = renderCustom(next);
  else detail = renderHome();

  view.dataset.layout = detail.layout;
  view.dataset.view = detail.name;
  renderNav(next.name);

  // Coming back to the list returns to where you were; every other view starts at the top.
  window.scrollTo(0, next.name === 'home' ? homeScroll : 0);
  if (current.name !== null) {
    view.focus({ preventScroll: true });
    view.classList.remove('view-enter');
    void view.offsetWidth; // restart the enter animation
    view.classList.add('view-enter');
  }
  current = next;
  emit('view', { ...detail, root: view });
}

/** Re-read recipes and queue (after a feature wrote a recipe file) and update the header count. */
async function reload() {
  await load();
  renderStats();
}

// ---------- the API feature modules receive (docs/design/MOUNT-POINTS.md) ----------
const rb = {
  version: 1,
  isStatic: STATIC,
  recipes: () => state.recipes,
  recipe: (id) => state.recipes.find((r) => r.id === id),
  queue: () => state.queue,
  filters: () => ({ q: state.q, keys: [...state.keys], mode: state.mode }),
  current: () => ({ ...current }),
  mount: (name, root = document) => mount(name, root),
  mounts: (name, root = document) => $$(`[data-mount="${name}"]`, root),
  on(name, fn) {
    const handler = (e) => fn(e.detail, e);
    document.addEventListener(`rb:${name}`, handler);
    return () => document.removeEventListener(`rb:${name}`, handler);
  },
  addFilter(id, filter) {
    const off = hub.addFilter(id, filter);
    refresh();
    return () => { off(); refresh(); };
  },
  refresh,
  addRoute(name, def) {
    const off = hub.addRoute(name, def);
    if (booted) {
      if (parseRoute(location.hash, [name]).name === name) route();
      else renderNav(current.name);
    }
    return off;
  },
  navigate(hash) { location.hash = hash; },
  reload,
  store,
  toast,
  copy,
  esc,
  icon,
};
window.recipeBank = rb;

// Feature modules are listed in /features/index.js; one that fails to load never takes the dashboard down.
async function installFeatures() {
  let features = [];
  try {
    ({ features = [] } = await import('/features/index.js'));
  } catch (e) {
    console.warn('[recipe-bank] features/index.js did not load', e);
    return;
  }
  for (const loadFeature of features) {
    try {
      const mod = await loadFeature();
      await mod.install?.(rb);
    } catch (e) {
      console.warn('[recipe-bank] a feature failed to install', e);
    }
  }
}

// ---------- boot ----------
async function boot() {
  try {
    await load();
  } catch {
    renderError(() => { renderLoading(); boot(); });
    return;
  }
  renderStats();
  if (!featuresInstalled) {
    featuresInstalled = true;
    restoreFilters();
    await installFeatures();
  }
  booted = true;
  emit('ready', { rb });
  route();
}

setupTheme();
setupAdd({ rerender: () => booted && route(), reload });
setupOffline();
$('#skip').addEventListener('click', (e) => {
  e.preventDefault();
  view.focus();
});
window.addEventListener('hashchange', () => booted && route());
boot();
