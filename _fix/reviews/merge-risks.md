# Merge risks across the nine branches

Reviewer: claude fable-5.2 (recipe-bank-pam lane). Based on the nine diffs in `_review/` against `main`. Nothing was merged or run; "conflict" below means the same lines or the same new file, as read from the diffs. The audit branches were read selectively (see `audit.md` for scope).

## Proposed order

1. `feat/more-platforms`, with the three-line label fix from its review. It carries the scheme check every importing branch needs.
2. `test/browser-smoke-ci`, after one real browser run. From here on CI guards the rest.
3. `feat/recipe-agent`, after its four fixes.
4. `feat/roadmap-functions`, **without** its pack and schema files (risk 2).
5. `feat/recipe-packs`.
6. `feat/recipe-editor`.
7. `feat/household-budget`.
8. `feat/redesign`, last of the dashboard work, because it rewrites `public/app.js` and should absorb what is there by then.
9. `feat/website`, any time; regenerate its showcase data after step 6.

## The risks

### 1. `server.mjs` is restructured five different ways

| Branch | What it exports | Data folder |
|---|---|---|
| `test/browser-smoke-ci` | `server` (a constant) | fixed |
| `feat/more-platforms` | `handleRequest`, `oembed` | fixed (tests copy the server into a temp folder) |
| `feat/recipe-packs` | `server` | env `RECIPE_BANK_DIR` |
| `feat/recipe-editor` | `createRecipeServer({ dataDir })`, no `server` | env `RECIPE_BANK_DATA_DIR` |
| `feat/roadmap-functions` | `createApp({ recipesDir, queueFile, oembed })`, `loadQueue`, `oembed`, no `server` | options |

- **What breaks:** all five edit the same block at the bottom of the file, so every pair conflicts. Worse, a clean-looking resolution can leave importers dangling: `scripts/browser/support.mjs` imports `server`, the packs API test imports `server`, the platform tests import `handleRequest`, the editor tests `createRecipeServer`, the functions tests `createApp`.
- **Resolution:** settle on one factory, `createApp({ dataDir, oembed })` from the functions branch extended with the editor's `dataDir`, returning the server. Keep `handleRequest` as the function the factory wraps, so the platform tests need no socket. Export nothing called `server`; the smoke script calls `createApp()` itself. One env name: `RECIPE_BANK_DATA_DIR`, since it holds `recipes/` and `data/`. Then port each branch's tests to it, one import line each.

### 2. Recipe packs, schema and migration exist twice

- **Files added by both `feat/roadmap-functions` and `feat/recipe-packs`:** `lib/pack.mjs`, `scripts/pack.mjs`, `scripts/migrate.mjs`, `schema/recipe.schema.json`, `test/pack.test.mjs`, `test/schema.test.mjs`. The functions branch has `lib/schema.mjs`; the packs branch has `lib/json-schema.mjs` and `lib/migrate.mjs`. Both add `SCHEMA_VERSION` to `lib/recipe.mjs`.
- **What breaks:** six add/add conflicts, and two incompatible APIs behind the same names (`createPack`/`readPack` that throws, link `#/import/…`, versus `exportPack`/`readPack` that never throws, link `#pack=…`). Both write `"format": "recipe-bank-pack", "version": 1`.
- **Resolution:** keep the packs branch's implementation whole. It has the size caps, the key filtering, the no-overwrite write and the server route; the functions version can overwrite a file (`audit.md` F1). Drop those six files and `lib/schema.mjs` from the functions branch before merging it, keep its `npm run schema` / `migrate` / `packs` script names pointing at the packs branch's scripts, and take `SCHEMA_VERSION` from one side only.

### 3. `PLATFORMS` means two things

- **Where:** `feat/more-platforms` exports `PLATFORMS` from `lib/video.mjs` as seven `{ id, label, embeds }` objects. `feat/roadmap-functions` exports `PLATFORMS` from `lib/recipe.mjs` as three id strings and builds the JSON Schema enum from it. The packs branch's schema hard-codes URL patterns for the same three.
- **What breaks:** no textual conflict, so it merges silently. Afterwards a Facebook recipe passes `validateRecipe` and fails the JSON Schema, and "every recipe file passes the JSON Schema" goes red the day the first such recipe is added.
- **Resolution:** one source, `PLATFORMS` in `lib/video.mjs`. The schema generator takes its enum from `PLATFORMS.map((p) => p.id)`; the per-platform URL patterns in the schema gain the four new platforms or are reduced to `^https://`.

### 4. `public/features/shared.mjs` is added twice with different exports

- **Where:** `feat/household-budget` (`esc`, `selected`, `field`, `numberField`, `localToday`, `storageFor`, `readStored`, `writeStored`, `emit`, `renderNotice`) and `feat/roadmap-functions` (`esc`, `defaultStorage`, `makeStore`, `ensureStylesheet`, `emit`, `copyText`).
- **What breaks:** an add/add conflict. `emit` differs too: household looks the constructor up through the element's document, which its Node tests rely on.
- **Resolution:** one file with the union. Keep the household `emit` (it works in both environments) with `composed: true` added. Keep both storage helpers for now and note that `makeStore` and `readStored`/`writeStored` do the same job; fold them into one in a follow-up.

### 5. `public/app.js`: the redesign replaces what others patch or rely on

- **Where:** `feat/redesign` splits `app.js` into `public/ui/*.js` and moves matching into `lib/catalog.mjs`. `feat/roadmap-functions` patches the old `app.js` to import `matchesFilter` from its new `lib/filter.mjs`. `feat/more-platforms` needs the `PLATFORM` map changed (its review, finding 1).
- **What breaks:** a conflict in `app.js`; after it, two filter implementations (`lib/filter.mjs` and the matching in `lib/catalog.mjs`); and the `✓ undefined video` hint survives in `public/ui/add.js`, because `ui/core.js` still has the three-entry map.
- **Resolution:** merge the redesign after the others and, in that merge, have `lib/catalog.mjs` call `matchesFilter` from `lib/filter.mjs` so there is one matcher, and derive `PLATFORM` in `ui/core.js` from `PLATFORMS`. The redesign already falls back to "Video" in the recipe and queue views; the Add hint needs the same fallback.

### 6. The smoke test's selectors do not survive the redesign

- **Where:** `scripts/smoke.mjs:2-10`.
- **What breaks:**
  - `SELECTORS.card` expects `#grid .card[href="#/r/<id>"]` and reads `el.hash`. In the redesign a card is an `<article class="card" data-id>` with an inner `a.card-link`.
  - `SELECTORS.ingredients` expects `.ing-list .name`; the redesign uses `.ing-name`.
  - Step text and timestamp selectors still match; timestamps are buttons only for YouTube, which the smoke test already assumes.
  - The hint text `Not a supported video link yet` is unchanged in the redesign.
- **Resolution:** the smoke file was written with one selector map for this reason. Update the two selectors and the `ids()` helper (`el.dataset.id`) in the redesign's merge. Because CI requires the smoke step, the redesign cannot merge green without it, which is the gate working as intended.

### 7. The service worker's file list versus everyone else's new modules

- **Where:** `public/sw.js` in `feat/redesign` lists the shell files by name and installs with `cache.addAll`.
- **What breaks:** modules added by other branches (`/lib/filter.mjs`, `/features/*.mjs`, `/lib/budget.mjs`, …) are not in the list. They are cached on first use, so a first offline visit to a feature page fails. If any listed file is renamed, install fails as a whole and offline use stops silently.
- **Resolution:** a test that every `SHELL` entry exists on disk and that every module statically imported by the shell is listed; bump `VERSION` in the merge that adds modules.

### 8. The static build's `_headers` file

- **Where:** `feat/roadmap-functions` adds the `/features/*.mjs` content-type rule in `scripts/build-static.mjs` and turns the script into an exported `buildStatic()`.
- **What breaks:** `feat/household-budget`, `feat/recipe-editor` and `feat/recipe-packs` all ship `.mjs` files under `public/features/` and none of them adds the rule. Deployed without it, their modules may be refused by the browser.
- **Resolution:** the functions branch's `build-static.mjs` goes in before or with the first of those three. The smoke script spawns `scripts/build-static.mjs` as a process, which still works with the new main-module guard.

### 9. A changed recipe makes generated data stale

- **Where:** `feat/recipe-editor` changes `recipes/cold-pan-chicken.json` (parsley: "some" → not given). `feat/website` commits `site/data/showcase.js`, generated from that file and checked by a test.
- **What breaks:** whichever merges second turns `npm test` red.
- **Resolution:** run `npm run site:data` in the second merge. The same applies to `test/video-compat.json` in `feat/more-platforms`, which pins the list of 17 recipe files by name: any branch or later change that adds a recipe must update it on purpose.

### 10. Three naming schemes for the same things

| Thing | Main / redesign | `feat/roadmap-functions` | `feat/household-budget` | `feat/website` |
|---|---|---|---|---|
| Storage keys | `rb:filters`, `rb:checked:<id>`, `rb:offline` | `rb:week-plan`, `rb:shopping-checked`, `rb:filters-extra` | `recipe-bank:household`, `recipe-bank:budget` | `rb-site-theme` |
| Events | `rb:<name>` on `document` | `rb:plan-change` … on the element | `recipe-bank:household-change` on the element | — |
| CSS properties | `--surface`, `--ink`, … | `--rbf-*` | `--rb-*` | own tokens |

- **What breaks:** nothing at merge time. Afterwards the week plan (functions) has to listen for the household event under a different prefix, and a dark theme has to be set three times.
- **Resolution:** pick `rb:` for keys and events and the dashboard's own tokens for colour. Rename in the household branch before merging (two key constants, two event names, one CSS prefix; its tests reference the constants). The website is a separate origin and can keep its key.

### 11. How a feature module plugs into the dashboard

- **Where:** the redesign defines named mount points (`data-mount`, ids `mount-<name>`), a hub (`rb.on`, `rb.esc`) and a loader at `public/features/index.js` whose example imports are `.js` files. The functions, household, editor and packs modules each export `mount(element, options)` from `.mjs` files and know nothing about the hub.
- **What breaks:** nothing conflicts; nothing connects either. Four roadmap items are described as "built, waiting to be placed".
- **Resolution:** keep `mount(element, options)` as the module contract, and make `public/features/index.js` the one place that maps mount points to modules. Decide `.mjs` (served with the right type by the header rule in risk 8) and update the loader's examples.

### 12. Texts and tests that still say three platforms

- **Where:** `scripts/capture.mjs:199` and the agent documents (`feat/recipe-agent`); the 400 message `Paste a YouTube, TikTok or Instagram video link.` kept verbatim in the functions branch's rewritten server (`audit-feat-roadmap-functions.diff:3239`) and changed by `feat/more-platforms`; `brand.json` facts and page copy in `feat/website`; `public/index.html:31`.
- **What breaks:** a textual conflict on the server line. After the merge, `capture.mjs` accepts Facebook, Pinterest and X links (it calls the shared parser) while its error text and documents name three.
- **Resolution:** build every such sentence from `PLATFORMS`, as `feat/more-platforms` does for its own error message, and add one line to the agent docs saying capture depends on what yt-dlp supports.

### 13. The files every branch touches

- **`README.md`** (all nine), **`CLAUDE.md`** (seven), **`ROADMAP.md`** (six), **`package.json`** (four: `doctor`; `smoke`, `device-check`; `schema`, `migrate`, `packs`; `site`, `site:data`).
- **What breaks:** adjacent-line conflicts, all mechanical. The two that need thought:
  - `ROADMAP.md`, "Recipe Agent and self-hosting": `feat/recipe-agent` rewrites the intro and ticks four items, `feat/more-platforms` rewrites the fifth. Take both.
  - `CLAUDE.md`, the `API:` line: `feat/more-platforms` (`allowWeb`), `feat/recipe-packs` (`/api/packs/import`) and `feat/recipe-editor` (recipe routes) each rewrite the same line. Turn it into a short list in the first merge so later branches add a line instead of editing one.
- **Roadmap ticks:** `feat/household-budget` ticks two items that exist only as a standalone preview, and the functions branch annotates items as "built; left: placing them". Use one convention, for example tick only what is reachable from the dashboard.

### 14. Tests that depend on the environment

- `feat/recipe-agent`: `test/capture-privacy.test.mjs` needs a git checkout (its review, finding 4). Fine on CI, red in an archive.
- `feat/recipe-packs`: its API test sets `process.env.RECIPE_BANK_DIR` before first importing `server.mjs`. That works only while each test file runs in its own process, which several lane reports say they changed for diagnosis (`--test-isolation=none`). With the factory from risk 1 this goes away.
- `test/browser-smoke-ci`: the workflow runs `npm test` on Node 22 only; several lanes verified on Node 26. Keep 22 as the floor and consider adding the current release to the matrix.
