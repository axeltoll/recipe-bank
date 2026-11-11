// Keep independent of app.js: feature modules must also work on a standalone page.
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g,
  (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
export const selected = (a, b) => a === b ? ' selected' : '';
export const field = (form, name) => form.elements.namedItem(name)?.value ?? '';
export const numberField = (form, name) => field(form, name).trim() === '' ? NaN : Number(field(form, name));
export const localToday = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
export function storageFor(options) {
  return () => Object.hasOwn(options, 'storage') ? options.storage : globalThis.localStorage;
}
export function readStored(storage, key, fallback) {
  try {
    const target = storage();
    if (!target) return { value: fallback, available: false };
    return { value: JSON.parse(target.getItem(key)) ?? fallback, available: true };
  } catch { return { value: fallback, available: false }; }
}
export function writeStored(storage, key, value) {
  try { storage().setItem(key, JSON.stringify(value)); return true; }
  catch { return false; }
}
export function emit(element, name, detail) {
  const Event = element.ownerDocument?.defaultView?.CustomEvent ?? globalThis.CustomEvent;
  element.dispatchEvent(new Event(name, { detail, bubbles: true }));
}
export function renderNotice(message, errors = []) {
  return `<p class="rb-feature-status" role="status">${esc(message)}</p>${errors.length ?
    `<ul class="rb-feature-errors" role="alert">${errors.map((e) => `<li>${esc(e)}</li>`).join('')}</ul>` : ''}`;
}
