// The one helper module shared by every feature module in this folder (week plan, shopping
// list, scaling, filters, household, budget, packs, recipe editor). Keep it independent of
// app.js: feature modules must also work on a standalone page (household-demo.html).
// No DOM access at import time, so the modules can be imported (and their render functions
// tested) in Node.

/** HTML-escape anything that came from a data file, oEmbed or the user. */
export const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/** ' selected' when a and b are equal, for <option> markup. */
export const selected = (a, b) => (a === b ? ' selected' : '');

/** A form control's value by name, or '' when it is missing. */
export const field = (form, name) => form.elements.namedItem(name)?.value ?? '';

/** A form control's value as a number; NaN when blank. */
export const numberField = (form, name) => (field(form, name).trim() === '' ? NaN : Number(field(form, name)));

/** Today's date in the browser's own time zone, as YYYY-MM-DD. */
export const localToday = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// ---------- storage: every read and write is wrapped in try/catch (private mode, full quota, blocked storage) ----------

/** localStorage, or null when the browser blocks it. */
export function defaultStorage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/** JSON get/set over a storage object (default: localStorage). */
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

/**
 * A getter for the storage a module should use: `options.storage` when the caller passed one
 * (even null, meaning "no storage"), else localStorage. A getter, because reading
 * globalThis.localStorage can itself throw.
 */
export function storageFor(options) {
  return () => (Object.hasOwn(options, 'storage') ? options.storage : globalThis.localStorage);
}

/** Read JSON through a storageFor() getter: { value, available }. Never throws. */
export function readStored(storage, key, fallback) {
  try {
    const target = storage();
    if (!target) return { value: fallback, available: false };
    return { value: JSON.parse(target.getItem(key)) ?? fallback, available: true };
  } catch {
    return { value: fallback, available: false };
  }
}

/** Write JSON through a storageFor() getter; false when storage is blocked or full. */
export function writeStored(storage, key, value) {
  try {
    storage().setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

// ---------- DOM helpers (only called after mount) ----------

/** Add the module's stylesheet once. `href` is usually the module's own .css file resolved against import.meta.url. */
export function ensureStylesheet(href) {
  if (typeof document === 'undefined') return;
  for (const l of document.querySelectorAll('link[rel="stylesheet"]')) if (l.href === href) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = href;
  document.head.append(link);
}

/**
 * Fire a bubbling CustomEvent from `target`. Uses the target's own window when it has one,
 * so it also works with test doubles and inside iframes.
 */
export function emit(target, name, detail) {
  const Event = target.ownerDocument?.defaultView?.CustomEvent ?? globalThis.CustomEvent;
  target.dispatchEvent(new Event(name, { detail, bubbles: true, composed: true }));
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

/** A status line plus an optional list of errors, escaped. */
export function renderNotice(message, errors = []) {
  return `<p class="rb-feature-status" role="status">${esc(message)}</p>${errors.length
    ? `<ul class="rb-feature-errors" role="alert">${errors.map((e) => `<li>${esc(e)}</li>`).join('')}</ul>`
    : ''}`;
}
