import { parseVideoUrl, embedUrl, thumbnailUrl } from '/lib/video.mjs';
import { ingredientKeys, matchesFilter } from '/lib/filter.mjs';

const $ = (sel, root = document) => root.querySelector(sel);
const view = $('#view');
// The Cloudflare Pages copy (scripts/build-static.mjs) has no server: it reads JSON files and can't change the queue.
const STATIC = document.documentElement.dataset.static === '1';
const apiPath = (name) => (STATIC ? `/api/${name}.json` : `/api/${name}`);

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

const recipeKeys = ingredientKeys;
const stepCount = (r) => r.components.reduce((n, c) => n + c.steps.length, 0);

// Search + Has all / Has any live in lib/filter.mjs (also: without, tags, nutrition; see public/features/).
const matches = (r) => matchesFilter(r, state);

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
setupAdd({ rerender: () => booted && route() });
setupOffline();
$('#skip').addEventListener('click', (e) => {
  e.preventDefault();
  view.focus();
});
window.addEventListener('hashchange', () => booted && route());
boot();
