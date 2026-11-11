STATUS: DONE

# Lane rbank-merge: round 1 as one product

All five work-package steps are done, in order, plus three stretch items: `CHANGELOG.md` for 0.2.0,
`docs/ARCHITECTURE.md`, and dead-code removal (listed under "Delete or rename").

**Nothing has been run.** There was no shell, Node or browser. I traced every test I wrote or changed by hand against
the code. A separate read-only reviewer then traced the riskiest suites again:

- feature installers, selectors, schema, service worker, design;
- the four server suites and the platform suites.

It found one failing assertion: a JSDoc example in `shared.mjs` matched the new service-worker crawl. That is now fixed
on both sides. It found nothing that throws on import.

The first real check is `npm test`, then `npm run validate`, then `npm run smoke` and `npm run device-check`.

## Why 28 tests failed, and what fixed them

| Cause | Tests | Fix |
|---|---|---|
| `lib/recipe.mjs` declared `PLATFORMS` and `SCHEMA_VERSION` twice (two branches' lines kept). | catalog, draft, features, filter, migrate, pack-cli, packs-ui, queue, recipes, schema, site, site-showcase, validate ×2 | One merged contract. |
| `server.mjs` declared `saveQueue` twice and mixed three factories. | oembed, pack, packs-api, server, server-recipes, platform-queue ×4, platform-validation | Rewritten around one factory (below). |
| `public/features/shared.mjs` had lost the household lane's helpers (`field`, `storageFor`, …). | budget-csv, household-ui | One merged helper module. |
| `public/app.js` was a mash of the old app and the redesign, with two `prompt(` calls. | design "partial-recipe copy … unsafe sinks" | The redesign's `app.js`. |
| `/lib/filter.mjs` was imported but not precached. | sw "every module … is precached" | Added to `SHELL`, with every feature file. |

These would have failed next, once the above were fixed. I fixed them too:

- **`site/data/showcase.js`** still had parsley as "some" / spoken. The editor lane changed `recipes/cold-pan-chicken.json` to `null` / unstated, which made the showcase test fail. The data file now matches the recipe; it is not a recipe change.
- **The schema test table had 27 rows**, but the merged contract has 28 `need(` rules: the platforms lane added the rule that `video.id` must be null or omitted.
- **The JSON Schema** only knew three platforms.
- **The platform fixture** did not copy `schema/`, which `scripts/validate.mjs` now reads.
- **`scripts/validate.mjs`** used the packs lane's `process.exitCode` everywhere. The platforms lane's in-process test needs an explicit `process.exit(1)`.
- **The server test expected** "YouTube, TikTok or Instagram" in the 400 message. The platforms test needs every label.

## Tests I changed, and why

None of these changes weakens a test.

- **`test/server.test.mjs`**: the 400-message regex now expects the full list, "YouTube, TikTok, Instagram, Facebook, Pinterest or X". The old regex was wrong about the intended behaviour once the more-platforms lane landed.
- **`test/server-recipes.test.mjs`**:
  - it uses `createApp({ dataDir, oembed: null })` instead of the removed `createRecipeServer`;
  - new test: recipe writes without a JSON content type get 415 and write nothing.
- **`test/recipe-editor.test.mjs`**: the expected imports are now `../../lib/draft.mjs`, `../../lib/video.mjs` and `./shared.mjs`. The editor now uses the one shared helper module, with relative paths like every other feature module, so Node can import it.
- **`test/schema.test.mjs`**: this is the packs lane's version, extended:
  - a 28th rule row, and the existing `video.id must be` row narrowed to `video.id must be "`;
  - good fixtures for Facebook, Pinterest, X, web pages and short links;
  - two more bad fixtures;
  - a check that the schema's platform enum and per-platform rules follow the `PLATFORMS` table.
- **`test/pack.test.mjs`**: the packs lane's version, plus the functions lane's "every real recipe round-trips through a pack" test, rewritten for the packs API.
- **`test/helpers/platform-fixture.mjs`**: also copies `schema/`.
- **`test/sw.test.mjs`**: new test. It follows `features/index.js`, every import and every `new URL('./x.css', import.meta.url)` stylesheet, and requires each one to be in `SHELL`. Comments are stripped first.

New test files:

- **`test/feature-installers.test.mjs`** (11 tests): the installers against a fake `rb` and DOM stand-ins.
  - Filters: registration, `clear()`, mounting per section, the chip click, and redraw after "Clear all".
  - Scaling: hooks and restore.
  - Household target.
  - Week plan: route, card and recipe buttons, the click.
  - Household and packs routes, including `#pack=` handover.
  - Editor: routes, the "New recipe" button, save and cancel reactions.
  - Static-build honesty, checked by reading the sources.
- **`test/selectors.test.mjs`** (3 tests): every id, class and data attribute in the browser-check selectors is rendered by the dashboard.

## Recipe packs: one set

I kept the packs lane's code:

- `lib/pack.mjs`, `lib/migrate.mjs`, `lib/json-schema.mjs`;
- `schema/recipe.schema.json`, extended to seven platforms;
- `scripts/pack.mjs`, `scripts/migrate.mjs`;
- its tests;
- `POST /api/packs/import` with the write lock;
- `public/features/packs.mjs`, which now loads its own CSS and uses `shared.mjs`.

From the functions lane I took over three things:

- the real-bank round-trip test;
- the resolvable `$id` URL for the schema;
- the npm script names `migrate` and `packs`, used everywhere.

I dropped the rest of the functions lane's version:

- **`createPack`'s silent de-duplication:** `exportPack` refuses doubles, which is clearer.
- **`#/import/` links:** `#pack=` is used instead.
- **`lib/schema.mjs` and the generated schema with `npm run schema`:** the packs lane's hand-written schema is stricter, with per-platform host and id rules, and is cross-checked by test.

## What I built or changed, file by file

**Merged files (step 1)**

- **`lib/recipe.mjs`**
  - The packs lane's contract: `SCHEMA_VERSION`, exported `SLUG`/`DATE`, and the one-line `schema` rule.
  - Plus the platforms lane's rules: web opt-in, labels from `PLATFORMS`, and null ids for web pages and short links.
- **`server.mjs`**
  - **The factory.** `createHandler(options)`, wrapped by `createApp(options)`. Options: `dataDir`, `recipesDir`, `queueFile`, `oembed`, `resolve`. `server` and `handleRequest` are the default app, used by the smoke test and the platform tests. `dataPaths()` is shared with the scripts.
  - **Routes.** Every lane's routes: queue with `allowWeb`, short-link resolution and oEmbed for 4 providers; recipe `POST`/`PUT`; pack import; queue delete.
  - **Writes.** One lock for all writes, and atomic writes.
  - **415 checks.** Recipe writes and pack import require `application/json`. This is new for recipe writes; it is CSRF protection, as the packs lane did for import.
  - **Data folder.** `RECIPE_BANK_DIR` is the one data-folder variable. The editor lane's `RECIPE_BANK_DATA_DIR` is gone.
- **`scripts/validate.mjs`**
  - The packs lane's contract-then-schema checks and `--json` output.
  - The platforms lane's queue checks: platform and id.
  - The functions lane's aisle warnings, now also in the `--json` warnings.
- **`scripts/pack.mjs`, `scripts/migrate.mjs`**: the packs lane's versions. `pack.mjs` reads the data folder through `dataPaths()`.
- **`scripts/build-static.mjs`**
  - Defaults to `RECIPE_BANK_DIR` too.
  - The comment no longer names a private chat channel.
- **`package.json`**
  - The union of every lane's scripts, minus `schema`. No dependencies.
  - Version 0.2.0.
- **`public/features/shared.mjs`**: one helper module, the union of the functions and household lanes.
  - `emit` uses the target's own window when there is one, and sends composed events.
  - `packs.mjs` and `recipe-editor.mjs` now import `esc` from it.
- **`public/app.js`**: the redesign's file, plus `rb.reload()`. That is documented in `MOUNT-POINTS.md`.
- **`lib/catalog.mjs`**: the dashboard's own copy of the filter code is gone. `matchesQuery`, `matchesKeys`, `filterRecipes`, `keyCounts` and `tagCounts` now delegate to `lib/filter.mjs`, so the dashboard filters through one implementation.
- **Docs: `README.md`, `CLAUDE.md`, `ROADMAP.md`**: one text that is true of this tree.
  - Ticked: week plan, Without, tag and nutrition, scaling, editor, offline and mobile, more platforms, recipe packs. Code and tests are here and each is reachable in the dashboard.
  - Not ticked: Browser smoke test. It is built but needs one passing real run.

**Platform wiring**

- `ui/core.js`: `PLATFORM` and `PLATFORM_LIST` come from `PLATFORMS`.
- `index.html` and `ui/add.js`:
  - copy for all six sources;
  - an "It's a web page with a video on it" checkbox that sends `allowWeb: true`;
  - hints for short links and web pages;
  - the static request names a web source.
- `lib/catalog.mjs` `analysisRequest`: adds a line for web pages.
- Copy that said "Paste it in the Recipe Bank topic" now reads "Request copied".

**Feature wiring (step 3)**

`public/features/index.js` lists six installers (`*-feature.js`).

| Installer | What it wires |
|---|---|
| `filters-feature.js` | Without, tags and nutrition. One section in each of the three filter mount points, one shared stored state, and three `rb.addFilter` registrations, so the chips, the Filters count and "Clear all" work per section. |
| `scale-feature.js` | Scaling control in `recipe-scaling`. Scaled amounts go through the `.ing-amt` hooks and are restored from `data-amount`. A "Scale to your household" button appears when a profile is saved. |
| `plan-feature.js` | `#/plan` with the week plan beside the shopping list, and "Add to week" on cards and recipe pages. The shopping list's `mount()` is called with `{ recipes }` only. I did not touch its purchase option or `lib/purchase.mjs`. |
| `household-feature.js` | `#/household` with household and budget side by side. It loads their CSS, since those modules don't load it themselves. |
| `packs-feature.js` | `#/packs` ("Share"). A `#pack=` link, on first load or on hashchange, becomes `#/packs` and opens the pack. |
| `editor-feature.js` | `#/new`, `#/new/<queueId>` and `#/edit/<id>`, a "New recipe" button in `home-tools`, and reload-then-open after a save. Cancel asks before discarding changes. |

Changes in the views:

- `ui/recipe.js`: an Edit link. On the static build it reads "Edit a copy".
- `ui/queue.js`: "Write it up yourself", which opens `#/new/<queueId>`.

Styling and precaching:

- **`public/styles.css`**, block "feature modules": the one place that maps `--rbf-*`, `--rb-*`, `--re-*` and `--pk-*` to the design tokens. `:root` in front outranks each module's own defaults. The block also has the feature page frame, a two-column layout from 1280 px, and the add-dialog checkbox.
- **`public/sw.js`**: `SHELL` lists every module, feature module, feature stylesheet and lib file the dashboard loads. `VERSION` is now v2.

**Static build (step 4)**

- The editor gets `readOnly: rb.isStatic`, and defaults to it anyway. It shows Download JSON and has no Save button.
- The packs panel gets `static: rb.isStatic`, so it has no Import button.
- The add dialog copies a request instead of queueing.
- Remove is hidden.

**Browser checks (step 5)**

- **`scripts/browser/selectors.mjs`** (new): `SELECTORS` for the redesigned dashboard, and the `PAGES` list.
- **`scripts/smoke.mjs`**
  - Re-exports `SELECTORS`; the selectors match the redesign (card links, `.ing-name`, `button.ts`).
  - New `features` check:
    - the header nav;
    - every feature route renders;
    - "Add to week" is on recipe pages;
    - the editor saves live but only offers a download on the static build.
- **`scripts/device-check.mjs`**
  - Measures home, a recipe, plan, household, packs and the editor.
  - On phones it opens the filter sheet through `#filter-toggle`; the old `details.filters` element no longer exists.

**Other docs**

- `docs/design/MOUNT-POINTS.md`: `rb.reload`, and the list of installed features.
- `INTEGRATION.md`, `PACKS.md`, `docs/PLATFORMS.md`: wiring status.
- `CHANGELOG.md` and `docs/ARCHITECTURE.md`: new.

## Untested

- **Everything at runtime.** No test, script, server or browser has run.
- **The dashboard in a browser:**
  - the six installers' `mount()` paths;
  - focus after route changes;
  - the filter sheet with three extra sections on a phone;
  - the two-column feature pages;
  - the theme mapping in both themes;
  - the `#pack=` handover, including `requestSubmit` on the panel's URL field;
  - editor save then reload;
  - the household scale button.
- **Keyboard (stretch):** done by reading only. Every new control is a native button, link or input. The router moves focus to `main` on every route.
- **`npm run smoke` and `npm run device-check`:** never run. A same-document `page.goto` followed by `waitFor` may pass early on a page whose selector is already present, for example `#/new` to `#/edit`. That is harmless but worth knowing.

## What the PAM must check

1. **Run the checks:** `npm test`, `npm run validate` and `npm run build`. Then run `npm run smoke` and `npm run device-check` in a browser slot. Tick "Browser smoke test" only after a pass.
2. **Look at every route** at 390 and 1280 px, in light and dark: `#/plan`, `#/household`, `#/packs`, `#/new`, `#/edit/<id>`, and a recipe page with the scaling control.
3. **The purchase-amounts lane** will change `shopping-list.mjs`. `plan-feature.js` mounts it with `{ recipes }`. If that lane adds a new mount option, such as a household profile, pass it there.
4. **The website (`site/`) is stale** against this tree. It says three platforms, says the editor, the Recipe Agent and offline mode are planned, and `brand.json` facts say the same. I left it alone: its tests tie copy to `brand.json`, and it is outside the named files. Update `site/index.html`, `self-hosting.html`, `changelog.html` and `brand.json` together.
5. **`.claude/launch.json`** still lacks the website lane's `recipe-bank-site` entry: `{"name": "recipe-bank-site", "runtimeExecutable": "npm", "runtimeArgs": ["run", "site"], "port": 4790}`.
6. **`recipes/thai-chicken-satay-sandwich.json`:** the website lane flagged that its note names a private person and a date. I did not change it; it is not a contract error. The owner should look.
7. **CSRF on the queue:** `POST /api/queue` and `DELETE /api/queue/<id>` still accept any content type. The platform tests call the handler without headers. Requiring JSON there means updating those tests too.

## Delete or rename

- `lib/schema.mjs`: the functions lane's duplicate of migrations plus a schema generator. It is superseded by `lib/migrate.mjs` and the hand-written, test-checked `schema/recipe.schema.json`. It imports `PLATFORMS` from `lib/recipe.mjs`, which no longer exports it, so it fails if anything imports it. Nothing does.
- `scripts/export-schema.mjs`: generated the schema from `lib/schema.mjs`. The `npm run schema` script that ran it is removed from `package.json`.
