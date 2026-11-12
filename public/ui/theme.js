// The theme button: same as the device, light, dark, in that order. "Same as the device" stores nothing and
// follows prefers-color-scheme; the other two are remembered (rb:theme), and index.html applies a remembered
// one before first paint.
import { $, store, icon, toast } from './core.js';

const ORDER = ['system', 'light', 'dark'];
const NAME = { system: 'same as your device', light: 'light', dark: 'dark' };
const ICON = { system: 'auto', light: 'sun', dark: 'moon' };

export function setupTheme() {
  const btn = $('#theme-toggle');
  if (!btn) return;
  const root = document.documentElement;
  const choice = () => (root.dataset.theme === 'light' || root.dataset.theme === 'dark' ? root.dataset.theme : 'system');
  const after = (name) => ORDER[(ORDER.indexOf(name) + 1) % ORDER.length];
  // The icon shows the current choice; the label says it in words and names what a press does.
  const paint = () => {
    const now = choice();
    btn.innerHTML = icon(ICON[now]);
    btn.setAttribute('aria-label', `Theme: ${NAME[now]}. Switch to ${NAME[after(now)]}`);
  };
  btn.addEventListener('click', () => {
    const next = after(choice());
    if (next === 'system') {
      delete root.dataset.theme;
      store.remove('rb:theme');
    } else {
      root.dataset.theme = next;
      store.set('rb:theme', next);
    }
    paint();
    toast(`Theme: ${NAME[next]}`);
  });
  paint();
}
