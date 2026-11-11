// The offline switch in the footer. Off by default: the service worker (public/sw.js) is registered only while
// the reader has switched it on, and switching it off unregisters the worker and deletes its caches.
import { $, store } from './core.js';

const KEY = 'rb:offline';
const CACHE_PREFIX = 'recipe-bank-';

export function setupOffline() {
  const box = $('#offline-switch');
  const note = $('#offline-note');
  if (!box) return;
  if (!('serviceWorker' in navigator)) {
    box.disabled = true;
    note.textContent = 'Offline use needs a browser with service workers, on https or localhost.';
    return;
  }

  const apply = async (announce) => {
    const on = box.checked;
    try {
      if (on) {
        await navigator.serviceWorker.register('/sw.js');
        // The worker answers from its cache first and refreshes in the background (public/sw.js), so say so.
        note.textContent = 'On. Recipes open without a connection once they have loaded. Videos still need one. '
          + 'A recipe added since your last visit shows up after a second reload.';
      } else {
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map((r) => r.unregister()));
        if ('caches' in window) {
          const names = await caches.keys();
          await Promise.all(names.filter((n) => n.startsWith(CACHE_PREFIX)).map((n) => caches.delete(n)));
        }
        note.textContent = announce ? 'Off. The offline copy was removed.' : '';
      }
      store.set(KEY, on);
    } catch {
      box.checked = !on;
      note.textContent = 'Could not change the offline setting.';
    }
  };

  box.checked = store.get(KEY, false) === true;
  box.addEventListener('change', () => apply(true));
  apply(false);
}
