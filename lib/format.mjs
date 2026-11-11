// Small text helpers shared by the dashboard and its tests. DOM-free.

const ENTITIES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** Escape a value for use in HTML text or a quoted attribute. null and undefined become ''. */
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ENTITIES[c]);

/** Seconds → "m:ss". Negative or non-numeric input reads as 0:00. */
export function mmss(t) {
  const s = Number.isFinite(t) && t > 0 ? Math.floor(t) : 0;
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** "1 recipe", "2 recipes", "2 matches". */
export const plural = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * "2026-02-11" (or an ISO timestamp) → "11 Feb 2026". Anything else is returned as text, unchanged,
 * so a malformed date is shown rather than hidden. No Intl: the output is the same everywhere.
 */
export function formatDate(iso) {
  const text = String(iso ?? '');
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
  const month = m && MONTHS[Number(m[2]) - 1];
  if (!month) return text;
  return `${Number(m[3])} ${month} ${m[1]}`;
}
