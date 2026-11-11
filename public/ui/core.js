// Shared state and small DOM helpers for the dashboard views. Everything testable without a DOM lives in /lib/.
import { plural } from '/lib/format.mjs';
import { waiting } from '/lib/catalog.mjs';
import { createHub, MOUNTS } from '/lib/hub.mjs';
import { BREAKPOINTS } from '/lib/nav.mjs';
import { PLATFORMS } from '/lib/video.mjs';

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
export const view = $('#view');

// The Cloudflare Pages copy (scripts/build-static.mjs) has no server: it reads JSON files and can't change the queue.
export const STATIC = document.documentElement.dataset.static === '1';
export const apiPath = (name) => (STATIC ? `/api/${name}.json` : `/api/${name}`);

/** Platform id → label, from the one table in lib/video.mjs. Callers fall back to a generic label for unknown ids. */
export const PLATFORM = Object.fromEntries(PLATFORMS.map(({ id, label }) => [id, label]));

/** "YouTube, TikTok, Instagram, Facebook, Pinterest or X": every source that needs no web-page opt-in. */
export const PLATFORM_LIST = (() => {
  const labels = PLATFORMS.filter(({ id }) => id !== 'web').map(({ label }) => label);
  return `${labels.slice(0, -1).join(', ')} or ${labels.at(-1)}`;
})();

export const state = {
  recipes: [],
  invalid: [],
  queue: [],
  q: '',
  keys: new Set(),
  mode: 'all', // 'all' = recipe must contain every selected ingredient; 'any' = at least one
  showAllChips: false,
};

/** Browser storage holds conveniences only; every read and write is allowed to fail. */
export const store = {
  get(k, fallback) {
    try { return JSON.parse(localStorage.getItem(k)) ?? fallback; } catch { return fallback; }
  },
  set(k, v) {
    try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage unavailable */ }
  },
  remove(k) {
    try { localStorage.removeItem(k); } catch { /* storage unavailable */ }
  },
};

/** Restore the saved search and ingredient filters into `state` (once, at boot). */
export function restoreFilters() {
  const saved = store.get('rb:filters', null);
  if (!saved || typeof saved !== 'object') return;
  state.q = typeof saved.q === 'string' ? saved.q : '';
  state.keys = new Set(Array.isArray(saved.keys) ? saved.keys.filter((k) => typeof k === 'string') : []);
  state.mode = saved.mode === 'any' ? 'any' : 'all';
}

export const hub = createHub({ warn: (...args) => console.warn('[recipe-bank]', ...args) });

/** Dispatch `rb:<name>` on document. Feature modules listen with rb.on(name, fn). */
export function emit(name, detail = {}) {
  document.dispatchEvent(new CustomEvent(`rb:${name}`, { detail }));
}

/** The element of a named mount point in the current view, or null. */
export function mount(name, root = document) {
  const id = MOUNTS[name];
  return id ? root.querySelector(`#${id}`) : null;
}

const phoneQuery = matchMedia(`(max-width: ${BREAKPOINTS.tablet - 0.02}px)`);
export const isPhone = () => phoneQuery.matches;
export const onPhoneChange = (fn) => phoneQuery.addEventListener('change', fn);
export const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

const ICONS = {
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  filter: '<path d="M4 6h16M7 12h10M10 18h4"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  play: '<path d="M8 5v14l11-7z"/>',
  back: '<path d="M19 12H5m6-6-6 6 6 6"/>',
  next: '<path d="M5 12h14m-6-6 6 6-6 6"/>',
  check: '<path d="m5 12 5 5 9-10"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  moon: '<path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z"/>',
  copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h9"/>',
  print: '<path d="M7 9V4h10v5M7 17H5a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-2"/><rect x="7" y="14" width="10" height="6"/>',
  pot: '<path d="M4 11h16v5a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4zM2 11h20M9 7c0-1 1-1.5 1-3M14 7c0-1 1-1.5 1-3"/>',
  external: '<path d="M14 5h5v5M19 5l-8 8M11 7H6a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1v-5"/>',
  alert: '<path d="M12 4 2.5 20h19zM12 10v4m0 3v.01"/>',
  list: '<path d="M8 6h12M8 12h12M8 18h12M4 6v.01M4 12v.01M4 18v.01"/>',
};

/** Inline SVG icon markup (decorative: always aria-hidden). */
export function icon(name) {
  const fill = name === 'play' ? ' icon-fill' : '';
  return `<svg class="icon${fill}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] ?? ''}</svg>`;
}

export function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => el.classList.remove('show'), 2600);
}

/** Copy text to the clipboard and confirm with a toast. Falls back to a prompt the reader can copy from. */
export async function copy(text, done = 'Copied') {
  try {
    await navigator.clipboard.writeText(text);
    toast(done);
  } catch {
    prompt('Copy this:', text);
  }
}

export function renderStats() {
  const n = waiting(state.queue).length;
  $('#stats').textContent = `${plural(state.recipes.length, 'recipe')} · ${n} in the queue`;
}

/** Remove a queued video on the server and from `state`. Resolves to true when it is gone. */
export async function removeQueued(id, btn) {
  if (btn) {
    btn.disabled = true;
    btn.setAttribute('aria-busy', 'true');
  }
  try {
    // The server refuses writes that are not JSON (server.mjs writeRefusal), DELETE included.
    const res = await fetch(`/api/queue/${encodeURIComponent(id)}`, { method: 'DELETE', headers: { 'content-type': 'application/json' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    state.queue = state.queue.filter((q) => q.id !== id);
    renderStats();
    return true;
  } catch {
    toast('Could not remove it');
    return false;
  } finally {
    if (btn?.isConnected) {
      btn.disabled = false;
      btn.removeAttribute('aria-busy');
    }
  }
}

/** A thumbnail that fails to load (offline, removed video) gives way to the drawn placeholder under it. */
document.addEventListener('error', (e) => {
  if (e.target instanceof HTMLImageElement && e.target.closest('.card-media, .q-thumb')) e.target.hidden = true;
}, true);
