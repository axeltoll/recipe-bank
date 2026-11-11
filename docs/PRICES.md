# Local prices: what a price source must give us

Groundwork for the roadmap item *Local prices and deals*. `lib/prices.mjs` can compare shops for a purchase list (see [PURCHASE.md](../public/features/PURCHASE.md)), but it ships with **no real price source**: it calls no API, names no shop and has no partner. The only provider in the code is `fakeProvider()`, with made-up prices, for tests and demos; its name always ends in "(example prices)".

## Why no scraping

Prices come only from an **official store API** or an **offer feed the shop publishes** for reuse. We don't scrape shop websites or apps:

- shop terms usually forbid it, and a self-hosted copy would put its owner in breach, not us;
- scraped pages change without notice, so prices would silently go wrong, and a wrong price is worse than none;
- logged-in or member prices are personal and must not end up in a cache on someone else's device;
- an official source says how fresh its prices are and what they apply to. A scraper has to guess.

If a shop has no official source, it is not in the comparison.

## What a source must give us

A source is turned into a **snapshot** and checked by `normalizeSnapshot()`. Anything missing makes the whole snapshot unusable; a bad price row is dropped and reported.

| Field | Required | What |
|---|---|---|
| `id` | yes | Lowercase letters, digits and dashes, unique per source (`shop-a`). |
| `name` | yes | What the user sees, at most 80 characters. |
| `currency` | yes | ISO 4217 code (`SEK`, `EUR`). Shops in other currencies are never converted, only left out of the comparison. |
| `lastUpdated` | yes | When the shop's prices were valid, as an ISO date or date-time with a time zone. Prices without a date are not shown. |
| `expires` | no | When the shop says these prices end (an offer period). The cache stops using them then. |
| `source` | yes | `official-api`, `offer-feed`, or `example` for made-up data. |
| `prices[]` | yes | Rows of `{ key, unit, per, minor, offer }`, as below. |

A price row:

- `key`: the ingredient key as recipes use it (`chicken`, `coconut milk`); see CLAUDE.md for how keys are chosen. Mapping a shop's product names to keys is the provider's job and should be checked by a person, not guessed.
- `unit` and `per`: what the price is for, for example `{ unit: 'kg', per: 1 }`, `{ unit: 'g', per: 500 }`, `{ unit: 'each', per: 12 }` or `{ unit: 'can' }`. Units use the same reader as purchase amounts (`unitKey()` in `lib/purchase.mjs`). Exact metric relations are applied (kg to g, l to ml, lb to oz) and nothing else, so a price per kg never prices an amount in cups.
- `minor`: the price in minor units (öre, cents), a whole number.
- `offer`: the shop's own offer text, if any (`"2 for 30"`), shown as is. Multi-buy rules are not applied to the total.

Snapshots are untrusted: sizes are capped (5,000 prices, 20 sources), `__proto__`, `constructor` and `prototype` are refused as keys, and every text must be escaped when shown, as everywhere in the dashboard.

## How a provider plugs in

A provider is any object with `{ id, name, lastUpdated, priceFor(key, unit) }`, where `priceFor` returns `{ minor, currency, per, unit, offer }` in base units, or `null`. The simplest way to get one is from a snapshot:

```js
import { createPriceCache, comparePrices } from '/lib/prices.mjs';
import { purchaseList } from '/lib/purchase.mjs';

const cache = createPriceCache({ storage: localStorage });   // 24 h expiry by default
// An adapter, written per official source, turns its answer into a snapshot and stores it:
cache.put(snapshotFromOfficialSource);                        // { ok, problems, saved }
cache.status();     // [{ id, name, lastUpdated, fetchedAt, expiresAt, expired, prices }] for the "last updated" line

const result = comparePrices(purchaseList(plan, recipes, profile, { pantry }), cache.providers());
```

The adapter is the only part that would talk to the network, and none is written yet. Each one should be its own small module, called only when the user asks for prices, and should state its source and terms in its header. A server-side proxy (for a key that must stay secret) would be a change to `server.mjs` and is a decision for the owner.

## What the comparison does

`comparePrices(purchase, providers, { currency, now, maxAgeMs })`:

- prices only the **added-up totals** of the purchase list. Amounts in words, unstated amounts and amounts kept apart are listed in `unpriced`, never guessed;
- costs each line as *amount ÷ per × price*, rounded to whole minor units. There are no pack sizes yet, so the result is an estimate of the food, not of the receipt;
- suggests `cheapest` only over the lines **every** compared shop prices (`common`), so a shop can't win by missing items. With no common line there is no suggestion;
- also gives `bestPerItem` (the cheapest shop per line) for a split shop, each shop's `missing` keys, and `stale` when a provider's `lastUpdated` is older than `maxAgeMs`;
- skips providers that fail `validateProvider()` and treats a `priceFor` that throws or answers nonsense as "no price".

The cache (`createPriceCache`) keeps each snapshot with the time it was stored. An entry expires `maxAgeMs` after that, or at the snapshot's own `expires`, whichever is sooner. Expired entries stay listed in `status()`, so the UI can say how old they are, but `providers()` leaves them out unless asked. Storage is optional and every read and write is in try/catch.
