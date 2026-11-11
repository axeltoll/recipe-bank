// Small helpers shared by the feature modules in this folder. No DOM access at import
// time, so the modules can also be imported (and their render functions tested) in Node.

/** HTML-escape anything that came from a data file, oEmbed or the user. */
export const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/** localStorage, or null when the browser blocks it. */
export function defaultStorage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/** JSON get/set where every read and write is wrapped in try/catch (private mode, full quota, blocked storage). */
export function makeStore(storage = defaultStorage()) {
  return {
    get(key, fallback) {
      try {
        const raw = storage?.getItem(key);
        return raw == null ? fallback : JSON.parse(raw) ?? fallback;
      } catch {
        return fallback;
      }
    },
    set(key, value) {
      try {
        storage?.setItem(key, JSON.stringify(value));
        return Boolean(storage);
      } catch {
        return false;
      }
    },
  };
}

/** Add the module's stylesheet once. `href` is usually new URL('./x.css', import.meta.url).href. */
export function ensureStylesheet(href) {
  if (typeof document === 'undefined') return;
  for (const l of document.querySelectorAll('link[rel="stylesheet"]')) if (l.href === href) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = href;
  document.head.append(link);
}

/** Fire a bubbling CustomEvent from `target`. */
export function emit(target, name, detail) {
  target.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, composed: true }));
}

/** Copy text to the clipboard; resolves to true on success. */
export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
