# Recipe Bank

A personal recipe bank. Recipe videos from YouTube (including Shorts), TikTok, Instagram Reels, Facebook, Pinterest, X and explicitly opted-in HTTPS web pages get analyzed into exact ingredients and step-by-step guides, then shown on a local dashboard. The dashboard uses public embeds where supported and original links otherwise, filters recipes by ingredient, plans the week with one shopping list, scales servings, edits recipes, shares recipe packs and queues new videos for analysis. See docs/PLATFORMS.md for the platform contract.

## Run

```bash
npm start          # http://127.0.0.1:4780 (PORT / HOST env to override)
npm run dev        # same, restarts on server/lib changes
npm run validate   # checks every recipes/*.json (contract, then JSON Schema) and data/queue.json; add -- --json for a report
npm test           # node:test: lib/, API on a random port, scripts, static build, dashboard wiring, feature modules, website
npm run build      # read-only static copy in dist/
npm run check      # test, validate and build in one go (CONTRIBUTING.md)
npm run migrate    # dry run; `npm run migrate -- --write` upgrades recipe files to SCHEMA_VERSION (`--stamp` adds "schema")
npm run packs      # export / import recipe packs (scripts/pack.mjs; import is a dry run without --write)
npm run doctor     # optional tools for the Recipe Agent
npm run smoke      # browser smoke test, live and static (needs Chrome; skips without one)
npm run device-check # layout audit of every dashboard page at five widths
npm run site       # the public website in site/ on port 4790
```

No dependencies. Node ≥ 22 (built-in `fetch`, `node:test`, `import.meta.dirname`). `.claude/launch.json` has the `recipe-bank` preview config.

## Layout

| Path | What |
|---|---|
| `recipes/<id>.json` | One file per analyzed recipe. **The data.** The filename must equal `id`. |
| `data/queue.json` | Videos waiting for analysis (`queued` → `analyzing` → removed once the recipe file lands; `failed` if analysis is impossible). `scripts/queue.mjs` also writes `updatedAt` and, for `failed`, `failureReason` (agent/QUEUE.md). |
| `lib/video.mjs` | URL parsing, embed and thumbnail URLs, and the `PLATFORMS` table (ids, labels, embed capability). Shared by the server, validator and browser (served at `/lib/`). |
| `lib/video-resolver.mjs` | Server-only short-link resolution (fb.watch, pin.it, vm/vt.tiktok.com): HEAD requests, at most three same-platform redirects. |
| `lib/recipe.mjs` | Recipe contract (`validateRecipe`, `SCHEMA_VERSION`). The enforced source of truth for the format below. |
| `schema/recipe.schema.json` | JSON Schema (draft 2020-12) of the whole recipe file, optional fields included. `test/schema.test.mjs` keeps it in step with `validateRecipe`; `lib/json-schema.mjs` is the dependency-free validator `npm run validate` uses. |
| `lib/migrate.mjs` | Ordered, pure contract migrations: `migrate(recipe) → { recipe, changes, from, to }`. |
| `lib/filter.mjs` | Search, Has all / Has any, Without, tags and nutrition filters: the one filter implementation (the dashboard reaches it through `lib/catalog.mjs`). |
| `lib/catalog.mjs`, `lib/format.mjs`, `lib/nav.mjs` | DOM-free dashboard logic: queries and counts, text helpers, route parsing and keyboard maths. |
| `lib/hub.mjs` | Registry for feature modules: filters, routes, mount-point and event names. |
| `lib/plan.mjs` | Week plan and the combined shopping list (merged by `key`, grouped by aisle via `AISLE_KEYS`). |
| `lib/scale.mjs` | Serving scaling of plain-number amounts; words and rates stay untouched. |
| `lib/household.mjs`, `lib/budget.mjs` | Household profile (servings per meal) and food budget (minor-unit money, ISO weeks, CSV). |
| `lib/draft.mjs` | Recipe editor logic: `emptyDraft`, `draftFromRecipe` / `recipeFromDraft` (round-trip safe, unknown fields kept), `checkDraft`, `slugify`, `parseTimestamp` / `formatTimestamp`. |
| `lib/pack.mjs` | Recipe packs: export, read (untrusted input), plan an import, apply it, links. |
| `server.mjs` | `node:http` server: static `public/` and `/lib/`, plus the JSON API. One factory, `createApp({ dataDir, recipesDir, queueFile, oembed, resolve })`; `server` and `handleRequest` are the default app (the smoke test listens on port 0). |
| `public/` | Dashboard (vanilla ES modules + CSS, light/dark). `app.js` is boot and router; views are in `public/ui/`. Hash routes: `#/`, `#/r/<id>`, `#/q/<queueId>`, plus the feature routes `#/plan`, `#/household`, `#/packs`, `#/new[/<queueId>]`, `#/edit/<id>`. |
| `public/features/` | Self-contained feature modules (`*.mjs`, `mount(el, options)`) and their installers (`*-feature.js`), listed in `features/index.js`. Contract: `docs/design/MOUNT-POINTS.md`; module docs: `INTEGRATION.md`, `HOUSEHOLD.md`, `EDITOR.md`, `PACKS.md`. |
| `public/sw.js` | Offline service worker. Off unless the reader turns on the footer switch. |
| `docs/design/` | `DESIGN.md` (tokens, layout contract), `AUDIT.md`, `MOUNT-POINTS.md`. Change `public/styles.css` and `DESIGN.md` together. |
| `docs/ARCHITECTURE.md` | One page: modules, data flow, routes, API. |
| `scripts/validate.mjs` | CLI validator; exits 1 on any problem. Warns about ingredient keys with no shopping-list aisle. |
| `scripts/smoke.mjs`, `scripts/device-check.mjs`, `scripts/browser/` | Browser checks; their selectors are in `scripts/browser/selectors.mjs`. |
| `site/` | Public website (static home page, docs, changelog). Not the dashboard. `npm run site` previews it on port 4790; `site/README.md` has the rules. Its showcase data (`site/data/showcase.js`) is generated from three recipe files: after editing one of them, run `npm run site:data`, or `npm test` fails. What the site says about a feature comes from `site/data/features.json` (`status`: `shipped`, `next` or `planned`): when a feature merges, change its status there and run `npm run site:sync`, or `npm test` fails. |

API: `GET /api/recipes` → `{recipes, invalid}` · `GET /api/queue` · `POST /api/queue {url, note, allowWeb?}` (web pages require `allowWeb: true`; short links are resolved first; 409 if the video is already a recipe or queued; best-effort oEmbed title) · `DELETE /api/queue/<id>` · `POST /api/packs/import {pack, include?}` (JSON content type required; creates new recipe files only, never overwrites; duplicates by video are skipped). `RECIPE_BANK_DIR` points the server and scripts at another folder holding `recipes/` and `data/` (tests use a temp one). Every POST, PUT and DELETE must be sent as `application/json` (415 otherwise) and may not come from another website: a foreign `Origin`, a cross-site `Sec-Fetch-Site` or a `Host` that is not loopback (or listed in `RECIPE_BANK_HOSTS`) gets 403 (`writeRefusal` in `server.mjs`).

Recipe writes (local server only; the static build stays read-only): `POST /api/recipes <recipe>` creates `recipes/<id>.json` → 201 `{recipe, dequeued}` · `PUT /api/recipes/<id> <recipe>` replaces it → 200. Both need a JSON content type (415 otherwise), run `validateRecipe` (400 `{error, problems}`), refuse a duplicate id or video (409 `{error, recipeId}`; PUT answers 404 for an unknown id), write atomically as two-space JSON with a trailing newline, and remove the queue entry for the recipe's video.

## Recipe file contract (for analysis agents)

```jsonc
{
  "schema": 1,                                 // optional; contract version, absent = 1
  "id": "gochujang-chicken-thighs",          // kebab-case, == filename
  "title": "…",
  "status": "analyzed" | "partial",           // partial = creator withheld the method; gaps[] required
  "video": { "platform": "youtube|tiktok|instagram|facebook|pinterest|x|web", "id": "…", "url": "…" },
  "creator": { "name": "…", "handle": "@…", "url": "…" },
  "uploaded": "YYYY-MM-DD", "analyzed": "YYYY-MM-DD",
  "summary": "1–2 plain sentences",
  "serves": "as stated, or null",
  "tags": ["lowercase", "…"],
  "components": [                              // e.g. Chicken, Pan sauce, To serve
    { "name": "…",
      "ingredients": [{ "item": "Skin-on chicken thighs", "key": "chicken",
                        "amount": "2 per person", "basis": "spoken", "note": "optional" }],
      "steps": [{ "text": "…", "t": 17 }] }   // t = seconds into the video (optional)
  ],
  "nutrition": { "per": "sub", "basis": "description", "calories": 517, "protein_g": 43, "carbs_g": 39, "fat_g": 21, "note": "…" },
  "notes": ["…"], "gaps": ["what the video does not say"],
  "source": { "evidence": "what was checked, e.g. YouTube captions + video description (optional)", "quantity_basis": "…" }
}
```

`video.id` is null or omitted for explicitly declared HTTPS `web` pages and
unresolved short links. Their full URL is the deduplication key; other sources
use the parsed platform and string ID. See [PLATFORMS.md](docs/PLATFORMS.md).

Rules that matter more than the format:

1. **Never invent amounts.** `amount` is the creator's own words ("4", "1 can", "about 1 cup", "a good amount"). If nothing was said, set `amount: null` and `basis: "unstated"`; the UI shows "amount not given". `basis` is one of `on-screen`, `spoken`, `description` or `unstated`. Vague filler like "some" counts as unstated.
2. **Steps come from the video.** Don't fill withheld methods with generic cooking knowledge. Mark the recipe `partial` and list what's missing in `gaps`.
3. **`key` is the shopping-level filter key**: lowercase, singular, what you'd filter by (`chicken`, not `skin-on chicken thighs`; `chicken stock` stays distinct). Reuse existing keys: `npm start`, then the chip list, or `grep -h '"key"' recipes/*.json | sort -u`. A new key also needs an aisle in `AISLE_KEYS` (`lib/plan.mjs`); `npm run validate` warns when one is missing.
4. Add a `t` timestamp to each step where possible. The dashboard turns it into a "play from here" button.
5. Run `npm run validate` before committing. Once the recipe file exists, remove the matching entry from `data/queue.json`. The dashboard already hides queue entries whose video is in `recipes/`.

The full field reference, optional fields included, is `schema/recipe.schema.json`; `validateRecipe` stays the enforced contract, and `npm run validate` also applies the schema's optional-field rules (a handle starts with `@`, `nutrition` has `per` and `basis`, numbers are numbers).

## Schema version and migration

`SCHEMA_VERSION` in `lib/recipe.mjs` is the contract version (now 1). A recipe's optional `schema` field says which version it was written for; a missing field means 1, and a file newer than the code is rejected. To change the contract: bump `SCHEMA_VERSION` and the `maximum` of `schema` in the JSON Schema, add one pure step to `MIGRATIONS` in `lib/migrate.mjs`, update `validateRecipe`, the schema and its cross-check table in `test/schema.test.mjs`, then run `npm run migrate` (dry run) and `npm run migrate -- --write`. Written files are re-serialised as 2-space JSON.

## Recipe packs

A pack is one JSON file, `{ format: "recipe-bank-pack", version: 1, title, exported, recipes: [...] }`, or a link that carries it as `#pack=<base64url>` (up to 32,000 characters). Import sorts each recipe into new, conflict (same id, other video: saved as `<id>-2`), duplicate (same video: skipped) or invalid, and only ever creates files. Packs are untrusted: `lib/pack.mjs` caps sizes and refuses `__proto__`/`constructor`/`prototype` keys, and every title must still be escaped when shown. Details: `public/features/PACKS.md`.

## Analysis pipeline

For Recipe Agent tasks, start with [agent/RECIPE-AGENT.md](agent/RECIPE-AGENT.md), the shared instructions for every harness. Claude Code notes are in [agent/CLAUDE.md](agent/CLAUDE.md).

1. A video comes in through the dashboard's **Add video** (`data/queue.json`, `status: queued`). The static site can't queue, so it copies a request message instead.
2. An analysis agent captures the video's transcript, captions, description and keyframes into a private research store **outside this repository**. Transcripts, captions and frames are the creators' own content: never commit them here (`evidence/` is git-ignored for that reason).
3. The agent writes `recipes/<id>.json` from that material (rules above), in its own words with the creator credited, runs `npm run validate`, clears the queue entry, and commits. A person can do the same in the dashboard's editor (`#/new/<queueId>`).

## Conventions

- Keep it dependency-free unless there's a real need; adding a build step is a decision to raise with the owner first.
- The UI escapes every string from data files and oEmbed (`esc()` in `lib/format.mjs` for the dashboard, `public/features/shared.mjs` for feature modules), because queue titles and packs come from third parties.
- Dashboard logic that needs no DOM goes in `lib/` with a test; `public/ui/` only renders. `test/design.test.mjs` checks the stylesheet tokens, contrast, imports and mount points by reading the files. When a module is added to `public/` or `lib/` and loaded by the dashboard (directly or by a feature), add it to `SHELL` in `public/sw.js`; `test/sw.test.mjs` follows the imports and fails otherwise.
- A feature plugs in through `public/features/index.js` and the `rb` API, never by editing `app.js`. Its CSS custom properties are mapped to the design tokens in the one "feature modules" block of `public/styles.css`.
- Browser storage only holds conveniences (filters, ingredient checkboxes, week plan, household, budget), each read and write wrapped in try/catch.
