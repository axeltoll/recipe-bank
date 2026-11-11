// Small text helpers shared by the dashboard and its tests. DOM-free.

const ENTITIES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** Escape a value for use in HTML text or a quoted attribute. null and undefined become ''. */
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ENTITIES[c]);

/**
 * A URL that is safe to put in an href or src: an absolute http: or https: URL, returned in the
 * form the browser will use (scheme and host lowercased, surrounding spaces, tabs and newlines
 * removed). Anything else (javascript:, data:, vbscript:, relative or broken text, non-strings)
 * gives null, so the caller can render plain text instead of a link. The result still needs esc().
 * Recipe files, packs, queue entries and oEmbed titles come from third parties: route every link
 * from them through here. site/js/showcase-core.js has the same function for the website.
 */
export function safeUrl(value) {
  if (typeof value !== 'string') return null;
  let u;
  try {
    u = new URL(value.trim());
  } catch {
    return null;
  }
  return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : null;
}

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

// ---------- durations stated in a step (kitchen timers) ----------

const FRACTIONS = { '½': 0.5, '¼': 0.25, '¾': 0.75 };
const NUMBER = String.raw`(?:\d+\s+\d+\/\d+|\d+\/\d+|\d+\s+[½¼¾]|\d+(?:\.\d+)?[½¼¾]?|[½¼¾])`;
const DURATION = new RegExp(
  String.raw`(${NUMBER})(?:\s*(?:-|–|—|to)\s*(${NUMBER}))?[\s-]*(hours?|hrs?|minutes?|mins?|seconds?|secs?)(?![a-z])`,
  'gi',
);
// Largest first: "1 hour 30 minutes" is one duration only when the units go down.
const UNITS = [
  { first: 'h', seconds: 3600, short: 'h' },
  { first: 'm', seconds: 60, short: 'min' },
  { first: 's', seconds: 1, short: 'sec' },
];
const DAY = 86400;

/** "10", "1.5", "1/2", "1 1/2", "1½", "1 ½", "½" → a number; NaN for anything else. */
function quantity(text) {
  const s = text.trim().replace(/^(\d+)\s+(?=[½¼¾]$)/, '$1');
  if (Object.hasOwn(FRACTIONS, s)) return FRACTIONS[s];
  const mixed = /^(\d+)\s+(\d+)\/(\d+)$/.exec(s);
  if (mixed) return Number(mixed[3]) ? Number(mixed[1]) + Number(mixed[2]) / Number(mixed[3]) : NaN;
  const fraction = /^(\d+)\/(\d+)$/.exec(s);
  if (fraction) return Number(fraction[2]) ? Number(fraction[1]) / Number(fraction[2]) : NaN;
  const last = s.slice(-1);
  if (Object.hasOwn(FRACTIONS, last)) return Number(s.slice(0, -1)) + FRACTIONS[last];
  return Number(s);
}

/**
 * The durations a step states in figures, in reading order: [{ seconds, label }].
 * "Simmer for 10 minutes" → [{ seconds: 600, label: '10 min' }]. A range ("3-4 mins") runs for its lower
 * bound, so the cook looks early, and keeps both figures in the label ("3–4 min"). "1 hour 30 minutes" is
 * one duration. Durations in words ("half an hour", "a few minutes") are left alone: nothing is guessed.
 * Anything under 5 seconds or over a day is ignored, and at most `limit` are returned. A range counts when
 * its upper bound is in that span, and then runs for at least 5 seconds ("0–10 min" → 5 s).
 */
export function durations(text, limit = 3) {
  if (typeof text !== 'string') return [];
  const found = [];
  for (const m of text.matchAll(DURATION)) {
    const rank = UNITS.findIndex((u) => m[3].toLowerCase().startsWith(u.first));
    const unit = UNITS[rank];
    const seconds = Math.round(quantity(m[1]) * unit.seconds);
    const upper = m[2] ? Math.round(quantity(m[2]) * unit.seconds) : seconds;
    if (!Number.isFinite(seconds) || !Number.isFinite(upper)) continue;
    const figure = (s) => s.trim().replace(/\s+/g, ' ');
    const label = `${figure(m[1])}${m[2] ? `–${figure(m[2])}` : ''} ${unit.short}`;
    const range = Boolean(m[2]);
    const prev = found.at(-1);
    const joins = prev && !prev.range && !range && prev.rank < rank
      && /^\s*(?:,|and)?\s*$/i.test(text.slice(prev.end, m.index));
    if (joins) {
      prev.seconds += seconds;
      prev.label += ` ${label}`;
      prev.rank = rank;
      prev.end = m.index + m[0].length;
    } else {
      const timer = range ? Math.min(upper, Math.max(seconds, 5)) : seconds;
      found.push({ seconds: timer, upper, label, rank, range, end: m.index + m[0].length });
    }
  }
  return found
    .filter((d) => {
      const longest = d.range ? d.upper : d.seconds;
      return longest >= 5 && longest <= DAY;
    })
    .slice(0, limit)
    .map(({ seconds, label }) => ({ seconds, label }));
}
