// Light / dark toggle. With no saved choice the page follows the system; index.html applies a saved one before first paint.
import { $, store, icon } from './core.js';

export function setupTheme() {
  const btn = $('#theme-toggle');
  if (!btn) return;
  const root = document.documentElement;
  const system = matchMedia('(prefers-color-scheme: dark)');
  const current = () => root.dataset.theme ?? (system.matches ? 'dark' : 'light');
  const paint = () => {
    const dark = current() === 'dark';
    btn.innerHTML = icon(dark ? 'sun' : 'moon');
    btn.setAttribute('aria-label', dark ? 'Switch to the light theme' : 'Switch to the dark theme');
  };
  btn.addEventListener('click', () => {
    const next = current() === 'dark' ? 'light' : 'dark';
    root.dataset.theme = next;
    store.set('rb:theme', next);
    paint();
  });
  system.addEventListener('change', paint);
  paint();
}
