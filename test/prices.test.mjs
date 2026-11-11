import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  PRICE_CACHE_KEY, validateProvider, normalizeSnapshot, snapshotProvider, fakeProvider, createPriceCache, priceableLines, comparePrices,
} from '../lib/prices.mjs';
import { purchaseList } from '../lib/purchase.mjs';
import { defaultProfile } from '../lib/household.mjs';

const memory = () => {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), m };
};
const blocked = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('quota'); } };

const ing = (item, key, amount) => ({ item, key, amount, basis: amount == null ? 'unstated' : 'spoken' });
const week = {
  id: 'week', title: 'Week', serves: '2',
  components: [{ name: 'Main', steps: [], ingredients: [
    ing('Garlic', 'garlic', '2–3 cloves'),
    ing('Chicken', 'chicken', '1 kg'),
    ing('Rice', 'rice', '500 g'),
    ing('Milk', 'milk', '1 l'),
    ing('Eggs', 'egg', '6'),
    ing('Salt', 'salt', 'a pinch'),
    ing('Butter', 'butter', null),
  ] }],
};
// Two adults and a recipe for two: every amount is the creator's.
const purchase = purchaseList({ items: [{ recipe: 'week', day: null }] }, [week], defaultProfile());

const rawA = {
  id: 'shop-a', name: 'Shop A', currency: 'SEK', lastUpdated: '2026-01-05T08:00:00Z', source: 'offer-feed',
  prices: [
    { key: 'garlic', unit: 'clove', minor: 50 },
    { key: 'chicken', unit: 'kg', minor: 9900 },
    { key: 'rice', unit: 'kg', minor: 3000 },
    { key: 'milk', unit: 'l', minor: 1500 },
    { key: 'egg', unit: 'each', per: 12, minor: 4200, offer: '12 for 42' },
  ],
};
const shopA = snapshotProvider(rawA);
const shopB = fakeProvider({
  id: 'shop-b', name: 'Shop B', lastUpdated: '2026-01-05T09:00:00Z',
  prices: [
    { key: 'chicken', unit: 'g', per: 1000, minor: 8900 },
    { key: 'rice', unit: 'g', per: 1000, minor: 3400 },
    { key: 'milk', unit: 'dl', per: 10, minor: 1400 },
  ],
});
const NOW = Date.parse('2026-01-05T20:00:00Z');

test('snapshots are checked, cleaned and moved to base units', () => {
  assert.equal(normalizeSnapshot(null).snapshot, null);
  assert.equal(normalizeSnapshot([]).snapshot, null);
  const bad = normalizeSnapshot({ id: 'Shop A', name: '', currency: 'sek', lastUpdated: 'yesterday', source: 'scraped', prices: {} });
  assert.equal(bad.snapshot, null);
  assert.equal(bad.problems.length, 6);

  const { snapshot, problems } = normalizeSnapshot({
    ...rawA,
    expires: '2026-01-06',
    prices: [
      { key: '__proto__', unit: 'g', minor: 1 },
      { key: 'rice', unit: '400g', minor: 1 },
      { key: 'rice', unit: 'kg', minor: -1 },
      { key: 'rice', unit: 'kg', per: 0, minor: 1 },
      { key: 'rice', unit: 'kg', minor: 100 },
      { key: 'Rice', unit: 'g', per: 1000, minor: 200 },
      'x',
      { key: 'egg', minor: 50 },
      { key: 'milk', unit: 'l', minor: 10, offer: 'y'.repeat(161) },
    ],
  });
  assert.deepEqual(snapshot.prices, [
    { key: 'rice', unit: 'g', per: 1000, minor: 100, offer: null },
    { key: 'egg', unit: '', per: 1, minor: 50, offer: null },
  ]);
  assert.equal(problems.length, 7);
  assert.equal(snapshot.lastUpdated, '2026-01-05T08:00:00.000Z');
  assert.equal(snapshot.expires, '2026-01-06T00:00:00.000Z');
  assert.throws(() => snapshotProvider({ ...rawA, lastUpdated: null }), TypeError);
});

test('a snapshot provider answers in base units, whatever unit is asked', () => {
  assert.deepEqual(validateProvider(shopA), []);
  assert.deepEqual(shopA.priceFor('chicken', 'kg'), { minor: 9900, currency: 'SEK', per: 1000, unit: 'g', offer: null });
  assert.deepEqual(shopA.priceFor(' Chicken ', 'g'), { minor: 9900, currency: 'SEK', per: 1000, unit: 'g', offer: null });
  assert.deepEqual(shopA.priceFor('egg', ''), { minor: 4200, currency: 'SEK', per: 12, unit: '', offer: '12 for 42' });
  assert.equal(shopA.priceFor('chicken', 'cup'), null);
  assert.equal(shopA.priceFor('tofu', 'g'), null);
  assert.equal(shopA.priceFor('chicken', '2 x 400g'), null);
  assert.equal(shopA.priceFor(null, 'g'), null);
  assert.ok(Object.isFrozen(shopA));

  assert.equal(shopB.name, 'Shop B (example prices)', 'fake data says so');
  assert.equal(shopB.source, 'example');
  assert.equal(shopB.currency, 'SEK');

  assert.deepEqual(validateProvider(null), ['provider must be an object']);
  const problems = validateProvider({ id: 'Bad Id', name: '', priceFor: 1 });
  assert.equal(problems.length, 4);
  assert.ok(problems.some((p) => p.includes('lastUpdated is required')));
  assert.ok(validateProvider({ ...shopA, lastUpdated: 'soon' }).some((p) => p.includes('ISO')));
});

test('priceableLines: added-up totals can be priced; words and unstated amounts cannot', () => {
  const { lines, unpriced } = priceableLines(purchase);
  assert.deepEqual(lines.map((l) => [l.key, l.unit, l.lo, l.hi]), [
    ['garlic', 'clove', 2, 3], ['chicken', 'g', 1000, 1000], ['egg', '', 6, 6], ['milk', 'ml', 1000, 1000], ['rice', 'g', 500, 500],
  ]);
  assert.deepEqual(unpriced, [
    { key: 'butter', text: null, reason: 'unstated' },
    { key: 'salt', text: 'a pinch', reason: 'words' },
  ]);
  assert.deepEqual(priceableLines(null), { lines: [], unpriced: [] });
});

test('comparePrices: the cheapest shop over the items every shop prices', () => {
  const r = comparePrices(purchase, [shopA, shopB], { now: NOW });
  assert.equal(r.currency, 'SEK');
  const [a, b] = r.shops;
  assert.equal(a.id, 'shop-a');
  assert.equal(a.lastUpdated, '2026-01-05T08:00:00.000Z');
  assert.equal(a.stale, false);
  assert.deepEqual(a.missing, []);
  assert.deepEqual(a.totalMinor, { lo: 15100, hi: 15150 }); // garlic 100–150 + chicken 9900 + egg 2100 + milk 1500 + rice 1500
  assert.deepEqual(a.commonMinor, { lo: 12900, hi: 12900 });
  assert.deepEqual(a.priced.find((x) => x.key === 'egg'), { key: 'egg', unit: '', minor: { lo: 2100, hi: 2100 }, offer: '12 for 42' });
  assert.deepEqual(b.missing, ['garlic', 'egg']);
  assert.deepEqual(b.totalMinor, { lo: 12000, hi: 12000 });
  assert.deepEqual(b.commonMinor, { lo: 12000, hi: 12000 });

  // Shop B is cheaper on what both sell, although Shop A has more of the list.
  assert.deepEqual(r.common, ['chicken', 'milk', 'rice']);
  assert.deepEqual(r.cheapest, { id: 'shop-b', name: 'Shop B (example prices)', commonMinor: { lo: 12000, hi: 12000 }, savingMinor: 900 });
  assert.deepEqual(r.bestPerItem.map((x) => [x.key, x.id, x.minor.lo]), [
    ['garlic', 'shop-a', 100], ['chicken', 'shop-b', 8900], ['egg', 'shop-a', 2100], ['milk', 'shop-b', 1400], ['rice', 'shop-a', 1500],
  ]);
  assert.equal(r.unpriced.length, 2);
  assert.deepEqual(r.skipped, []);
});

test('comparePrices: shop totals add up the rounded line prices shown, not the raw costs', () => {
  const tiny = { id: 'tiny', title: 'Tiny', serves: '2', components: [{ name: 'Main', steps: [], ingredients: [
    ing('Saffron', 'saffron', '1 g'),
    ing('Vanilla', 'vanilla', '1 g'),
  ] }] };
  const list = purchaseList({ items: [{ recipe: 'tiny', day: null }] }, [tiny], defaultProfile());
  const shop = fakeProvider({ id: 'shop-t', name: 'Shop T', prices: [
    { key: 'saffron', unit: 'g', per: 5, minor: 3 }, // 0.6 minor units a line
    { key: 'vanilla', unit: 'g', per: 5, minor: 3 },
  ] });
  const [s] = comparePrices(list, [shop], { now: NOW }).shops;
  assert.deepEqual(s.priced.map((x) => x.minor), [{ lo: 1, hi: 1 }, { lo: 1, hi: 1 }]);
  assert.deepEqual(s.totalMinor, { lo: 2, hi: 2 });
  assert.deepEqual(s.commonMinor, { lo: 2, hi: 2 });
});

test('comparePrices: stale prices, other currencies, broken providers and no common item', () => {
  const old = fakeProvider({ id: 'old', lastUpdated: '2026-01-01', prices: [{ key: 'chicken', unit: 'kg', minor: 1 }] });
  assert.equal(comparePrices(purchase, [old], { now: NOW }).shops[0].stale, true);
  assert.equal(comparePrices(purchase, [old], { now: NOW, maxAgeMs: 10 * 24 * 3600 * 1000 }).shops[0].stale, false);

  const euro = fakeProvider({ id: 'euro', currency: 'EUR', prices: [{ key: 'chicken', unit: 'kg', minor: 900 }] });
  const mixed = comparePrices(purchase, [shopA, euro], { now: NOW });
  assert.equal(mixed.currency, 'SEK');
  assert.equal(mixed.shops[1].missing.length, 5, 'no currency conversion');
  assert.deepEqual(mixed.common, []);
  assert.equal(mixed.cheapest, null);
  assert.equal(comparePrices(purchase, [shopA, euro], { now: NOW, currency: 'EUR' }).shops[1].priced.length, 1);

  const throws = { id: 'throws', name: 'Throws', lastUpdated: '2026-01-05', priceFor() { throw new Error('offline'); } };
  const junk = { id: 'junk', name: 'Junk', lastUpdated: '2026-01-05', priceFor: () => ({ minor: -5, per: 1, currency: 'SEK' }) };
  const r = comparePrices(purchase, [throws, junk, { id: 'Bad Id', name: '', priceFor: 1 }], { now: NOW });
  assert.deepEqual(r.shops.map((s) => s.missing.length), [5, 5]);
  assert.equal(r.skipped.length, 1);
  assert.equal(r.skipped[0].id, 'Bad Id');
  assert.equal(r.currency, null);
  assert.equal(r.cheapest, null);

  const none = comparePrices(purchaseList(null, [], defaultProfile()), [shopA, shopB], { now: NOW });
  assert.deepEqual(none.lines, []);
  assert.equal(none.cheapest, null);
  assert.equal(comparePrices(purchase, [], { now: NOW }).cheapest, null);
  assert.equal(comparePrices(purchase, null, { now: NOW }).shops.length, 0);

  // Without a currency on the provider, the first price sets it.
  const bare = { id: 'bare', name: 'Bare', lastUpdated: '2026-01-05', priceFor: (k, u) => shopA.priceFor(k, u) };
  assert.equal(comparePrices(purchase, [bare], { now: NOW }).currency, 'SEK');
});

test('the price cache keeps a last-updated time and expires entries', () => {
  let t = Date.parse('2026-01-05T10:00:00Z');
  const now = () => t;
  const mem = memory();
  const cache = createPriceCache({ storage: mem, maxAgeMs: 3600_000, now });
  assert.deepEqual(cache.put(rawA), { ok: true, problems: [], saved: true });
  assert.deepEqual(cache.status(), [{
    id: 'shop-a', name: 'Shop A', source: 'offer-feed', lastUpdated: '2026-01-05T08:00:00.000Z',
    fetchedAt: '2026-01-05T10:00:00.000Z', expiresAt: '2026-01-05T11:00:00.000Z', expired: false, prices: 5,
  }]);
  assert.equal(cache.get('shop-a').snapshot.prices.length, 5);
  assert.equal(cache.get('nope'), null);
  assert.equal(cache.providers().length, 1);
  assert.equal(cache.providers()[0].priceFor('chicken', 'kg').minor, 9900);
  assert.ok(mem.getItem(PRICE_CACHE_KEY));

  t += 3600_000;
  assert.equal(cache.status()[0].expired, true);
  assert.equal(cache.providers().length, 0);
  assert.equal(cache.providers({ includeExpired: true }).length, 1);

  // A new cache on the same storage sees the same entry, with the same times.
  const again = createPriceCache({ storage: mem, maxAgeMs: 3600_000, now });
  assert.equal(again.status()[0].fetchedAt, '2026-01-05T10:00:00.000Z');
  assert.equal(again.status()[0].expired, true);

  // The snapshot's own expiry wins when it is sooner.
  assert.equal(cache.put({ ...rawA, id: 'shop-c', expires: '2026-01-05T11:30:00Z' }).ok, true);
  assert.equal(cache.get('shop-c').expiresAt, '2026-01-05T11:30:00.000Z');
  t += 30 * 60_000;
  assert.equal(cache.get('shop-c').expired, true);

  assert.equal(cache.put({ ...rawA, source: 'scraped' }).ok, false);
  assert.equal(cache.remove('shop-c'), true);
  assert.equal(cache.remove('shop-c'), false);
  cache.clear();
  assert.deepEqual(cache.status(), []);
  assert.equal(mem.getItem(PRICE_CACHE_KEY), '[]');
});

test('the price cache survives blocked or broken storage and caps its size', () => {
  const offline = createPriceCache({ storage: blocked });
  assert.deepEqual(offline.put(rawA), { ok: true, problems: [], saved: false });
  assert.equal(offline.providers({ includeExpired: true }).length, 1);

  const mem = memory();
  mem.setItem(PRICE_CACHE_KEY, '{ not json');
  assert.deepEqual(createPriceCache({ storage: mem }).status(), []);
  mem.setItem(PRICE_CACHE_KEY, JSON.stringify([{ snapshot: { ...rawA, id: '__proto__' }, fetchedAt: 1 }, { snapshot: rawA, fetchedAt: 'x' }]));
  assert.deepEqual(createPriceCache({ storage: mem }).status(), []);

  const memoryOnly = createPriceCache();
  for (let i = 0; i < 20; i++) assert.equal(memoryOnly.put({ ...rawA, id: `shop-${i}` }).ok, true);
  const full = memoryOnly.put({ ...rawA, id: 'shop-20' });
  assert.equal(full.ok, false);
  assert.match(full.problems.at(-1), /at most 20/);
  assert.equal(memoryOnly.put({ ...rawA, id: 'shop-3' }).ok, true, 'replacing an entry is fine');
  assert.deepEqual(memoryOnly.put({ ...rawA, id: 'shop-4' }), { ok: true, problems: [], saved: false }, 'no storage: kept in memory');
  assert.throws(() => createPriceCache({ maxAgeMs: 0 }), RangeError);
});

test('the prices module calls nothing: no fetch, no network imports', async () => {
  const src = await readFile(resolve(import.meta.dirname, '..', 'lib', 'prices.mjs'), 'utf8');
  assert.doesNotMatch(src, /\bfetch\s*\(|XMLHttpRequest|WebSocket|node:https?|node:net/);
  assert.deepEqual([...src.matchAll(/^import .* from '([^']+)'/gm)].map((m) => m[1]), ['./purchase.mjs']);
});
