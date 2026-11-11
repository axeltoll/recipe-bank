// Local prices groundwork. Pure functions and a small cache; no network, no DOM, no real shop.
// docs/PRICES.md explains what a price source must give us and why there is no scraping.
//
// A price provider is
//   { id, name, lastUpdated, currency?, priceFor(key, unit) }
// where priceFor returns the price of `key` (an ingredient key, as in recipes) measured in `unit`
// as { minor, currency, per, unit, offer } or null:
//   minor     the price in minor units (öre, cents), a non-negative safe integer
//   per       how many base units that price is for (1000 for "per kg" when unit is 'g')
//   unit      the base unit (lib/purchase.mjs unitKey(): g, ml, oz, tsp, can, '' for "each", …)
//   offer     the shop's own offer text, or null
// Providers are built from snapshots: a published offer feed or an official API answer,
// normalised by normalizeSnapshot(), cached by createPriceCache() with a clear "last updated"
// time and an expiry. fakeProvider() makes one from made-up prices, for tests and demos only.

import { unitKey } from './purchase.mjs';

export const PRICE_CACHE_KEY = 'rb:prices';
export const DEFAULT_MAX_AGE_MS = 24 * 60 * 60 * 1000;
export const SNAPSHOT_SOURCES = Object.freeze(['official-api', 'offer-feed', 'example']);
const LIMITS = Object.freeze({ providers: 20, prices: 5000, key: 60, name: 80, offer: 160 });
const BAD_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const ID = /^[a-z0-9][a-z0-9-]{0,62}$/;
const CURRENCY = /^[A-Z]{3}$/;
const object = (v) => v != null && typeof v === 'object' && !Array.isArray(v);
const text = (v, max) => (typeof v === 'string' && v.trim() && v.length <= max ? v.trim() : null);
const isoTime = (v) => {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}(?:T[\d:.]+(?:Z|[+-]\d{2}:\d{2}))?$/.test(v)) return null;
  const ms = Date.parse(v);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
};
const normKey = (k) => {
  const s = typeof k === 'string' ? k.trim().toLowerCase().replace(/\s+/g, ' ') : '';
  return s && s.length <= LIMITS.key && !BAD_KEYS.has(s) ? s : null;
};

/** Problems with a provider object, empty when it can be used. */
export function validateProvider(p) {
  if (!object(p)) return ['provider must be an object'];
  const problems = [];
  if (typeof p.id !== 'string' || !ID.test(p.id)) problems.push('id must be lowercase letters, digits and dashes');
  if (!text(p.name, LIMITS.name)) problems.push(`name must be a non-empty string of at most ${LIMITS.name} characters`);
  if (p.lastUpdated != null && !isoTime(p.lastUpdated)) problems.push('lastUpdated must be an ISO date or date-time');
  if (p.lastUpdated == null) problems.push('lastUpdated is required: prices without a date are not shown');
  if (typeof p.priceFor !== 'function') problems.push('priceFor(key, unit) must be a function');
  return problems;
}

/**
 * Check and clean an untrusted snapshot (a feed or an API answer, already parsed from JSON):
 *   { id, name, currency, lastUpdated, expires?, source: 'official-api' | 'offer-feed' | 'example',
 *     prices: [{ key, unit, per?, minor, offer? }] }
 * Units are moved to their base unit ("per 1 kg" becomes "per 1000 g"). Bad price rows are dropped
 * and listed; a bad header makes the whole snapshot unusable (snapshot: null).
 * Returns { snapshot, problems }.
 */
export function normalizeSnapshot(raw) {
  if (!object(raw)) return { snapshot: null, problems: ['snapshot must be an object'] };
  const problems = [];
  const id = typeof raw.id === 'string' && ID.test(raw.id) ? raw.id : null;
  const name = text(raw.name, LIMITS.name);
  const currency = typeof raw.currency === 'string' && CURRENCY.test(raw.currency) ? raw.currency : null;
  const lastUpdated = isoTime(raw.lastUpdated);
  const expires = raw.expires == null ? null : isoTime(raw.expires);
  const source = SNAPSHOT_SOURCES.includes(raw.source) ? raw.source : null;
  if (!id) problems.push('id must be lowercase letters, digits and dashes');
  if (!name) problems.push(`name must be a non-empty string of at most ${LIMITS.name} characters`);
  if (!currency) problems.push('currency must be a three-letter ISO 4217 code');
  if (!lastUpdated) problems.push('lastUpdated must be an ISO date or date-time');
  if (raw.expires != null && !expires) problems.push('expires must be an ISO date or date-time');
  if (!source) problems.push(`source must be one of ${SNAPSHOT_SOURCES.join(', ')}`);
  if (!Array.isArray(raw.prices)) problems.push('prices must be an array');
  if (problems.length) return { snapshot: null, problems };

  const prices = [];
  const seen = new Set();
  raw.prices.slice(0, LIMITS.prices).forEach((row, i) => {
    const where = `prices[${i}]`;
    if (!object(row)) return problems.push(`${where} must be an object`);
    const key = normKey(row.key);
    const unit = unitKey(row.unit ?? '');
    const per = row.per == null ? 1 : row.per;
    const offer = row.offer == null ? null : text(row.offer, LIMITS.offer);
    if (!key) return problems.push(`${where}.key must be an ingredient key`);
    if (!unit) return problems.push(`${where}.unit is not a unit`);
    if (!(typeof per === 'number' && Number.isFinite(per) && per > 0)) return problems.push(`${where}.per must be a positive number`);
    if (!(Number.isSafeInteger(row.minor) && row.minor >= 0)) return problems.push(`${where}.minor must be a whole number of minor units`);
    if (row.offer != null && !offer) return problems.push(`${where}.offer must be a short text`);
    const k = `${key}\u0000${unit.base}`;
    if (seen.has(k)) return problems.push(`${where}: a second price for ${key} per ${unit.base || 'item'} is ignored`);
    seen.add(k);
    prices.push({ key, unit: unit.base, per: per * unit.size, minor: row.minor, offer });
  });
  if (raw.prices.length > LIMITS.prices) problems.push(`only the first ${LIMITS.prices} prices are kept`);
  return { snapshot: { id, name, currency, lastUpdated, expires, source, prices }, problems };
}

/** A provider that answers from one snapshot. Throws a TypeError when the snapshot header is unusable. */
export function snapshotProvider(raw) {
  const { snapshot, problems } = normalizeSnapshot(raw);
  if (!snapshot) throw new TypeError(`unusable price snapshot: ${problems.join('; ')}`);
  const table = new Map(snapshot.prices.map((p) => [`${p.key}\u0000${p.unit}`, p]));
  return Object.freeze({
    id: snapshot.id,
    name: snapshot.name,
    currency: snapshot.currency,
    lastUpdated: snapshot.lastUpdated,
    source: snapshot.source,
    priceFor(key, unit) {
      const k = normKey(key);
      const u = unitKey(unit ?? '');
      if (!k || !u) return null;
      const p = table.get(`${k}\u0000${u.base}`);
      return p ? { minor: p.minor, currency: snapshot.currency, per: p.per, unit: p.unit, offer: p.offer } : null;
    },
  });
}

/**
 * A provider with made-up prices, for tests and demos. Never shown as a real shop: the name says so.
 * prices: [{ key, unit, per?, minor, offer? }] as in a snapshot.
 */
export function fakeProvider({ id = 'example-shop', name = 'Example shop', currency = 'SEK', lastUpdated = '2026-01-05T08:00:00Z', prices = [] } = {}) {
  return snapshotProvider({ id, name: `${name} (example prices)`, currency, lastUpdated, source: 'example', prices });
}

// ---------- cache ----------

/**
 * A device-local cache of snapshots with a "last updated" time and an expiry.
 * storage: a Storage-like object (localStorage) or null to keep it in memory only; every read and
 * write is in try/catch. Entries expire `maxAgeMs` after they were stored, or at the snapshot's own
 * `expires`, whichever comes first. Expired entries are kept (so the UI can say how old they are)
 * but are not handed out as providers unless asked for.
 */
export function createPriceCache({ storage = null, key = PRICE_CACHE_KEY, maxAgeMs = DEFAULT_MAX_AGE_MS, now = () => Date.now() } = {}) {
  if (!(Number.isFinite(maxAgeMs) && maxAgeMs > 0)) throw new RangeError('maxAgeMs must be a positive number');
  const entries = new Map(); // id -> { snapshot, fetchedAt }

  try {
    const raw = storage?.getItem(key);
    const list = raw ? JSON.parse(raw) : [];
    if (Array.isArray(list)) {
      for (const e of list.slice(0, LIMITS.providers)) {
        const { snapshot } = normalizeSnapshot(e?.snapshot);
        if (snapshot && Number.isFinite(e.fetchedAt)) entries.set(snapshot.id, { snapshot, fetchedAt: e.fetchedAt });
      }
    }
  } catch {
    // Blocked storage or broken JSON: start empty.
  }

  const save = () => {
    try {
      storage?.setItem(key, JSON.stringify([...entries.values()]));
      return Boolean(storage);
    } catch {
      return false;
    }
  };
  const describe = (e) => {
    const byAge = e.fetchedAt + maxAgeMs;
    const own = e.snapshot.expires ? Date.parse(e.snapshot.expires) : Infinity;
    const expiresAt = Math.min(byAge, own);
    return {
      id: e.snapshot.id,
      name: e.snapshot.name,
      source: e.snapshot.source,
      lastUpdated: e.snapshot.lastUpdated,
      fetchedAt: new Date(e.fetchedAt).toISOString(),
      expiresAt: new Date(expiresAt).toISOString(),
      expired: now() >= expiresAt,
      prices: e.snapshot.prices.length,
    };
  };

  return {
    /** Store a snapshot (replacing one with the same id). Returns { ok, problems, saved }. */
    put(raw) {
      const { snapshot, problems } = normalizeSnapshot(raw);
      if (!snapshot) return { ok: false, problems, saved: false };
      if (!entries.has(snapshot.id) && entries.size >= LIMITS.providers) {
        return { ok: false, problems: [...problems, `at most ${LIMITS.providers} price sources are cached`], saved: false };
      }
      entries.set(snapshot.id, { snapshot, fetchedAt: now() });
      return { ok: true, problems, saved: save() };
    },
    /** { snapshot, ...status } for one id, or null. */
    get(id) {
      const e = entries.get(id);
      return e ? { snapshot: e.snapshot, ...describe(e) } : null;
    },
    /** One line per cached source: id, name, lastUpdated, fetchedAt, expiresAt, expired, prices. */
    status() {
      return [...entries.values()].map(describe);
    },
    /** Providers for the cached snapshots; expired ones only with { includeExpired: true }. */
    providers({ includeExpired = false } = {}) {
      return [...entries.values()].filter((e) => includeExpired || !describe(e).expired).map((e) => snapshotProvider(e.snapshot));
    },
    remove(id) {
      const had = entries.delete(id);
      if (had) save();
      return had;
    },
    clear() {
      entries.clear();
      save();
    },
  };
}

// ---------- comparing shops ----------

/** The amounts of a purchase list that can be priced: one line per added-up total. */
export function priceableLines(purchase) {
  const lines = [];
  const unpriced = [];
  for (const g of purchase?.groups ?? []) {
    for (const it of g.items) {
      for (const part of it.parts) {
        if (part.kind === 'total') lines.push({ key: it.key, unit: part.unit, lo: part.lo, hi: part.hi, text: part.text });
        else unpriced.push({ key: it.key, text: part.text, reason: part.flag ?? 'scaled' });
      }
      if (!it.parts.length) unpriced.push({ key: it.key, text: null, reason: 'unstated' });
    }
  }
  return { lines, unpriced };
}

function ask(provider, key, unit) {
  try {
    const p = provider.priceFor(key, unit);
    if (!object(p) || !Number.isSafeInteger(p.minor) || p.minor < 0) return null;
    if (!(typeof p.per === 'number' && Number.isFinite(p.per) && p.per > 0) || typeof p.currency !== 'string') return null;
    return p;
  } catch {
    return null;
  }
}

/**
 * Where the purchase list is cheapest, from several providers. Nothing is converted between currencies
 * and nothing is guessed for an item a shop has no price for.
 *
 * Returns {
 *   currency,                 the currency compared (options.currency, else the first provider's)
 *   lines, unpriced,          what could be priced (added-up totals) and what not (words, unstated, …)
 *   shops: [{ id, name, lastUpdated, stale, totalMinor: { lo, hi }, commonMinor: { lo, hi },
 *             priced: [{ key, unit, minor: { lo, hi }, offer }], missing: [key] }],
 *   common: [keys every shop prices], cheapest: { id, name, commonMinor, savingMinor } | null,
 *   bestPerItem: [{ key, unit, id, minor }], skipped: [{ id, reason }]
 * }
 * `cheapest` compares only the lines every compared shop prices (`common`), so a shop does not win by
 * missing items; with no common line there is no suggestion. Costs are estimates: amount ÷ per × price,
 * rounded to whole minor units, with no pack sizes. `stale` is set when a provider's lastUpdated is
 * older than options.maxAgeMs (default one day) before options.now.
 */
export function comparePrices(purchase, providers, { currency = null, now = Date.now(), maxAgeMs = DEFAULT_MAX_AGE_MS } = {}) {
  const { lines, unpriced } = priceableLines(purchase);
  const skipped = [];
  const usable = [];
  for (const p of providers ?? []) {
    const problems = validateProvider(p);
    if (problems.length) skipped.push({ id: typeof p?.id === 'string' ? p.id : null, reason: problems.join('; ') });
    else usable.push(p);
  }
  // Without a stated currency, the first price answered sets it; other currencies count as missing.
  let cur = currency ?? usable.find((p) => typeof p.currency === 'string')?.currency ?? null;

  const shops = usable.map((p) => {
    const priced = [];
    const missing = [];
    for (const line of lines) {
      const price = ask(p, line.key, line.unit);
      if (price && !cur) cur = price.currency;
      if (!price || price.currency !== cur) {
        missing.push(line.key);
        continue;
      }
      priced.push({
        key: line.key,
        unit: line.unit,
        minor: { lo: (line.lo / price.per) * price.minor, hi: (line.hi / price.per) * price.minor },
        offer: price.offer ?? null,
      });
    }
    const updated = Date.parse(p.lastUpdated);
    return { id: p.id, name: p.name, lastUpdated: isoTime(p.lastUpdated), stale: now - updated > maxAgeMs, priced, missing };
  });

  const lineId = (l) => `${l.key}\u0000${l.unit}`;
  const commonIds = lines.map(lineId).filter((id) => shops.length && shops.every((s) => s.priced.some((x) => lineId(x) === id)));
  const sum = (items) => ({
    lo: Math.round(items.reduce((n, x) => n + x.minor.lo, 0)),
    hi: Math.round(items.reduce((n, x) => n + x.minor.hi, 0)),
  });
  for (const s of shops) {
    s.totalMinor = sum(s.priced);
    s.commonMinor = sum(s.priced.filter((x) => commonIds.includes(lineId(x))));
    s.priced = s.priced.map((x) => ({ ...x, minor: { lo: Math.round(x.minor.lo), hi: Math.round(x.minor.hi) } }));
  }

  let cheapest = null;
  if (commonIds.length && shops.length) {
    const ranked = [...shops].sort((a, b) => a.commonMinor.lo - b.commonMinor.lo || a.commonMinor.hi - b.commonMinor.hi);
    const [best, next] = ranked;
    cheapest = { id: best.id, name: best.name, commonMinor: best.commonMinor, savingMinor: next ? next.commonMinor.lo - best.commonMinor.lo : 0 };
  }

  const bestPerItem = [];
  for (const line of lines) {
    let best = null;
    for (const s of shops) {
      const x = s.priced.find((y) => lineId(y) === lineId(line));
      if (x && (!best || x.minor.lo < best.minor.lo)) best = { key: line.key, unit: line.unit, id: s.id, minor: x.minor };
    }
    if (best) bestPerItem.push(best);
  }

  return {
    currency: cur,
    lines,
    unpriced,
    shops,
    common: lines.filter((l) => commonIds.includes(lineId(l))).map((l) => l.key),
    cheapest,
    bestPerItem,
    skipped,
  };
}
