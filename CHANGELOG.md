# Changelog

What changed in each version of Recipe Bank. Built from the work packages' own reports; dates are the day a version
was put together.

## Unreleased

Fixes from the review of 0.2.0.

- **Security.** Recipe files may only carry `http(s)` creator and video links (`validateRecipe`), so a pack with a
  `javascript:` link is reported invalid; the dashboard and the website render every link from data through one
  `safeUrl()` helper. The local server refuses a `POST` or `PUT` that is not JSON, and any change with a cross-site
  `Sec-Fetch-Site` or an `Origin` that is not its own; a request without either header (curl, scripts) is allowed.
  On every API request, reads included (so a rebinding domain cannot read the collection), it also refuses a `Host`
  that is not a loopback name, not in `RECIPE_BANK_HOSTS` and not the `HOST` it binds to
  (a wildcard `HOST` such as `0.0.0.0` or `::` adds no name), and a loopback or missing `Host` from another machine.
  oEmbed answers keep only plain text and an `http(s)` author link.
- **Recipe Agent capture.** Each speech-to-text engine gets its own model flag (`--model_directory` for
  whisper-ctranslate2); captions are fetched in the video's own language only, never every automatic translation;
  the capture-folder guard compares folder identity, not spelling; yt-dlp writes through `-P`; video up to 1080p
  for OCR; every step has a time limit; tools are found only in absolute `PATH` entries; the queue helper's errors
  say what to do. The privacy test skips its git half in a copy without `.git`.
- **Platforms.** Short links are stored as `https://<host>/<code>` without the share query; Pinterest language
  subdomains, X `/video/1` and `/photo/1` links and trailing-dot hosts are understood; web pages need a public host
  name; `pin.it` links resolve through Pinterest's shortener; X oEmbed uses `publish.twitter.com`.
- **Browser checks.** Chrome is killed and its profile removed on every way out (crash, unhandled rejection,
  `process.exit()`, a second Ctrl-C); CI actions are pinned to commit SHAs and the tests also run on Node 24.
- **Budget.** Formatters are made once, the currency list works without `Intl.supportedValuesOf` and refuses
  non-money codes, blank CSV lines are skipped, and "this week" is taken from today's date each time the budget is
  drawn (opening the page, a save, a shop), so an open tab moves on at its next redraw; there is no midnight timer.
- `npm run check` runs the tests, the validator and the build; `CONTRIBUTING.md` and `.editorconfig` are new.

## 0.2.0 (2026-11-11)

Round 1: nine work packages built side by side, then merged into one product.

### New in the dashboard

- **Redesign.** The dashboard was rebuilt to a written design contract (`docs/design/DESIGN.md`): tokens for light and
  dark themes with WCAG AA contrast checked by test, a mobile-first layout at 768 / 1280 / 1920 px, 44 px tap targets,
  a bottom-sheet filter panel on phones and a filter rail on desktop, cook mode (one step at a time, screen kept awake
  where allowed), print styles, reduced motion and keyboard navigation through the recipe grid.
- **Feature mount points.** Features plug in through `public/features/index.js` and the `rb` API
  (`docs/design/MOUNT-POINTS.md`) instead of editing the dashboard.
- **More filters.** *Without* (exact ingredient keys; not an allergy check), tag chips, minimum protein and maximum
  calories for recipes that state their macros.
- **Week plan and one shopping list** (`#/plan`): recipes per day or "any day", one list merged by ingredient key and
  grouped by aisle, every amount in the creator's words. "Add to week" on recipe cards and pages.
- **Serving scaling** on the recipe page: plain numbers, fractions, ranges and decimals scale; words, rates and
  unstated amounts stay as given; scaled amounts are marked.
- **Household and food budget** (`#/household`): an anonymous, device-local household profile with editable portion
  estimates (its servings per meal feed scaling and the week plan), and a weekly or monthly budget with recorded shops,
  spend per meal and per person, history, a chart and CSV import/export.
- **Recipe editor** (`#/new`, `#/new/<queueId>`, `#/edit/<id>`): a form that writes `recipes/<id>.json` through the
  contract, with live problems, reordering, undo and a JSON preview. The static copy offers "Download JSON" instead.
- **Recipe packs** (`#/packs`, "Share"): share recipes as a file or a `#pack=` link and import someone else's; nothing
  is overwritten, recipes for a video already in the bank are skipped, and packs are treated as untrusted input.
- **More platforms.** Facebook, Pinterest and X links, short links (fb.watch, pin.it, vm/vt.tiktok.com) resolved on
  the server, and HTTPS web pages after an explicit "it's a web page" tick. Labels come from one platform table.
- **Offline.** An optional service worker keeps the dashboard and recipes available without signal.

### New for people who run it

- **API.** `POST /api/recipes`, `PUT /api/recipes/<id>` and `POST /api/packs/import`, all requiring a JSON content
  type; `RECIPE_BANK_DIR` points the server and scripts at another data folder.
- **Recipe contract.** An optional `schema` version field, `lib/migrate.mjs` and `npm run migrate`, and a JSON Schema
  of the whole file (`schema/recipe.schema.json`) that `npm run validate` also applies; `--json` output.
- **Recipe Agent.** Shared agent instructions (`agent/`), an analysis skill, `npm run doctor`, a private capture
  script that refuses to write inside the repository, a queue helper and `SELF-HOSTING.md`.
- **Browser checks and CI.** `npm run smoke` and `npm run device-check` drive a system Chrome with no dependencies;
  a GitHub Actions workflow runs tests, validation, the build and the smoke check.
- **Website.** A static project website in `site/` (`npm run site`).

### Changed

- One filter implementation (`lib/filter.mjs`) for the dashboard, the feature modules and the tests.
- One server factory (`createApp`) for the dashboard, the tests and the smoke test.
- `recipes/cold-pan-chicken.json`: parsley's "some" is now "amount not given", as the contract's rule on vague filler
  says.

### Not yet verified

No browser has run this version: the browser checks, the device check and a look at every page in both themes are
the first things to do with it.

## 0.1.0

The first version: recipes from YouTube, TikTok and Instagram analyzed into ingredients and steps, a dashboard that
filters by ingredient, a queue for new videos and a read-only static copy.
