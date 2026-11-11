// Routing and keyboard-navigation maths for the dashboard. DOM-free, so it can be tested with node:test.

/** The layout contract's breakpoints in px (docs/design/DESIGN.md). styles.css uses the same numbers. */
export const BREAKPOINTS = { tablet: 768, desktop: 1280, wide: 1920 };

const SEGMENT = /^\/([a-z][a-z0-9-]*)(?:\/(.*))?$/;

function safeDecode(s) {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/**
 * Parse `location.hash` into a route.
 *   "#/"            → { name: 'home' }
 *   "#/r/<id>"      → { name: 'recipe', id }
 *   "#/q/<queueId>" → { name: 'queue', id }
 *   "#/<custom>" or "#/<custom>/<param>" → { name: '<custom>', param, custom: true }, only for names in `custom`
 * Anything else, including a malformed hash, is home.
 */
export function parseRoute(hash, custom = []) {
  const m = SEGMENT.exec(String(hash ?? '').replace(/^#/, ''));
  if (!m) return { name: 'home' };
  const seg = m[1];
  const rest = m[2] ?? '';
  if (seg === 'r' || seg === 'q') {
    if (!rest) return { name: 'home' };
    return { name: seg === 'r' ? 'recipe' : 'queue', id: safeDecode(rest) };
  }
  if (custom.includes(seg)) return { name: seg, param: safeDecode(rest), custom: true };
  return { name: 'home' };
}

/** Hash for a recipe or queue entry. */
export const recipeHash = (id) => `#/r/${encodeURIComponent(id)}`;
export const queueHash = (id) => `#/q/${encodeURIComponent(id)}`;

/** Keep an index inside 0 … total-1 (0 when the list is empty). */
export function clampIndex(i, total) {
  if (!(total > 0)) return 0;
  const n = Number.isFinite(i) ? Math.trunc(i) : 0;
  return Math.min(Math.max(n, 0), total - 1);
}

/**
 * How many columns a wrapped grid has, from the top offset of each item in order:
 * the number of leading items that share the first item's top.
 */
export function columnCount(tops) {
  if (!tops.length) return 1;
  let n = 0;
  for (const t of tops) {
    if (t !== tops[0]) break;
    n++;
  }
  return Math.max(1, n);
}

/**
 * Next focused index in a grid of `total` items laid out in `cols` columns, for a KeyboardEvent.key.
 * Arrow keys move one cell and stop at the edges; ArrowDown from above a short last row lands on the last item.
 * Home and End jump to the first and last item. Any other key, or an empty grid, returns the index unchanged.
 */
export function gridMove(index, key, cols, total) {
  if (!(total > 0)) return index;
  const c = Math.max(1, Math.trunc(cols) || 1);
  const i = clampIndex(index, total);
  switch (key) {
    case 'ArrowRight': return Math.min(i + 1, total - 1);
    case 'ArrowLeft': return Math.max(i - 1, 0);
    case 'ArrowDown': {
      if (i + c < total) return i + c;
      const lastRow = Math.floor((total - 1) / c);
      return Math.floor(i / c) < lastRow ? total - 1 : i;
    }
    case 'ArrowUp': return i - c >= 0 ? i - c : i;
    case 'Home': return 0;
    case 'End': return total - 1;
    default: return i;
  }
}
