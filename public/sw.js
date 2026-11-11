// Recipe Bank service worker: keeps the app shell and the recipe data available without a connection.
// It is only registered while the reader has switched "Keep recipes for offline use" on (ui/offline.js).
//
// Strategy:
//   shell (HTML, CSS, JS under / and /lib/)  cache first, refreshed in the background for the next visit
//   /api/recipes(.json)                      cache first, refreshed in the background
//   /api/queue(.json)                        network first, the cached copy or an empty queue when offline
//   everything else (writes, other origins: video embeds, thumbnails, fonts)  left to the network
//
// Bump VERSION when the list of shell files changes.

const VERSION = 'v3';
const SHELL_CACHE = `recipe-bank-shell-${VERSION}`;
const DATA_CACHE = `recipe-bank-data-${VERSION}`;

// Every file the dashboard loads: app.js and its static imports, every feature installed from
// features/index.js with its imports, and the stylesheets the features add. test/sw.test.mjs checks this.
const SHELL = [
  '/',
  '/styles.css',
  '/app.js',
  '/icon.svg',
  '/manifest.json',
  '/ui/core.js',
  '/ui/states.js',
  '/ui/home.js',
  '/ui/recipe.js',
  '/ui/queue.js',
  '/ui/cook.js',
  '/ui/add.js',
  '/ui/theme.js',
  '/ui/offline.js',
  '/features/index.js',
  '/features/filters-feature.js',
  '/features/scale-feature.js',
  '/features/plan-feature.js',
  '/features/household-feature.js',
  '/features/packs-feature.js',
  '/features/editor-feature.js',
  '/features/household-target.js',
  '/features/shared.mjs',
  '/features/filters.mjs',
  '/features/scale.mjs',
  '/features/week-plan.mjs',
  '/features/shopping-list.mjs',
  '/features/household.mjs',
  '/features/budget.mjs',
  '/features/packs.mjs',
  '/features/recipe-editor.mjs',
  '/features/filters.css',
  '/features/scale.css',
  '/features/week-plan.css',
  '/features/shopping-list.css',
  '/features/household.css',
  '/features/budget.css',
  '/features/packs.css',
  '/features/recipe-editor.css',
  '/lib/video.mjs',
  '/lib/recipe.mjs',
  '/lib/format.mjs',
  '/lib/catalog.mjs',
  '/lib/filter.mjs',
  '/lib/nav.mjs',
  '/lib/hub.mjs',
  '/lib/plan.mjs',
  '/lib/scale.mjs',
  '/lib/household.mjs',
  '/lib/budget.mjs',
  '/lib/pack.mjs',
  '/lib/migrate.mjs',
  '/lib/draft.mjs',
  '/lib/purchase.mjs',
];

// The local server serves /api/recipes; the static build serves /api/recipes.json.
const RECIPES = ['/api/recipes', '/api/recipes.json'];
const QUEUE = ['/api/queue', '/api/queue.json'];

/**
 * Which strategy a request gets: 'shell', 'recipes', 'queue' or 'network'. Only the files in SHELL are cache first;
 * any other same-origin path (a new or dynamic URL) goes to the network, so a stale copy can never stand in for it.
 */
function policy(method, url, origin) {
  if (method !== 'GET') return 'network';
  let u;
  try {
    u = new URL(url);
  } catch {
    return 'network';
  }
  if (u.origin !== origin) return 'network';
  if (RECIPES.includes(u.pathname)) return 'recipes';
  if (QUEUE.includes(u.pathname)) return 'queue';
  return SHELL.includes(u.pathname) ? 'shell' : 'network';
}

const isJson = (res) => (res.headers.get('content-type') ?? '').includes('json');

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const shell = await caches.open(SHELL_CACHE);
    await shell.addAll(SHELL);
    // Best effort: have the data ready for the first offline visit. Only one of each pair exists.
    const data = await caches.open(DATA_CACHE);
    await Promise.allSettled([...RECIPES, ...QUEUE].map(async (path) => {
      const res = await fetch(path);
      if (res.ok && isJson(res)) await data.put(path, res);
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keep = [SHELL_CACHE, DATA_CACHE];
    const names = await caches.keys();
    await Promise.all(names.filter((n) => n.startsWith('recipe-bank-') && !keep.includes(n)).map((n) => caches.delete(n)));
    await self.clients.claim();
  })());
});

async function cacheFirst(event, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(event.request, { ignoreSearch: true });
  const refresh = fetch(event.request).then(async (res) => {
    if (res.ok) await cache.put(event.request, res.clone());
    return res;
  });
  if (cached) {
    event.waitUntil(refresh.catch(() => {}));
    return cached;
  }
  return refresh;
}

async function networkFirst(event) {
  const cache = await caches.open(DATA_CACHE);
  try {
    const res = await fetch(event.request);
    if (res.ok) await cache.put(event.request, res.clone());
    return res;
  } catch {
    const cached = await cache.match(event.request, { ignoreSearch: true });
    return cached ?? new Response('{"queue":[]}', { headers: { 'content-type': 'application/json; charset=utf-8' } });
  }
}

self.addEventListener('fetch', (event) => {
  const kind = policy(event.request.method, event.request.url, self.location.origin);
  if (kind === 'network') return;
  if (kind === 'queue') event.respondWith(networkFirst(event));
  else event.respondWith(cacheFirst(event, kind === 'recipes' ? DATA_CACHE : SHELL_CACHE));
});

// For test/sw.test.mjs, which loads this file in a sandbox.
self.RB_SW = { VERSION, SHELL, policy };
