# Roadmap

Work I plan to do on Recipe Bank, roughly in order. Estimates are my own and include tests and docs. An item is ticked once its code and tests are in the repository and it is reachable in the dashboard; [CHANGELOG.md](CHANGELOG.md) says what shipped when.

## Next

- [x] **Week plan and combined shopping list** (~6 h). Pick several recipes for the week and get one shopping list, with the same ingredient merged by its `key` and amounts kept in the creators' own words. *`lib/plan.mjs`, `public/features/week-plan.mjs` and `shopping-list.mjs`, on `#/plan` with "Add to week" on cards and recipe pages.*
- [x] **Exclude ingredients** (~2 h). A "without" filter next to *Has all* / *Has any*: no nuts, no pork, nothing I'm out of. *`lib/filter.mjs`, `public/features/filters.mjs`, in the filter panel.*
- [x] **Filter by tag and nutrition** (~3 h). Tags such as "air fryer" or "high protein" as chips, and a minimum-protein / maximum-calorie filter for recipes that state macros. *Same modules, same panel.*
- [x] **Server and API tests** (~4 h). `node:test` coverage for `/api/recipes` and `/api/queue` (add, duplicate → 409, delete, bad input), plus the static build. *`test/server.test.mjs`, `server-recipes.test.mjs`, `packs-api.test.mjs`, `platform-queue.test.mjs`.*
- [ ] **Browser smoke test** (~3 h). A headless run that loads the dashboard, filters, opens a recipe and presses a step's timestamp. *`npm run smoke`, `npm run device-check` and the CI workflow are built; tick after the first passing run with a real browser.*

## Later

- [x] **Serving scaling** (~5 h). Scale amounts that are plain numbers and units, and leave words like "a good amount" untouched, marking scaled amounts clearly. *`lib/scale.mjs`, `public/features/scale.mjs`, on the recipe page.*
- [x] **Add and edit recipes in the dashboard** (~8 h). A form that writes a valid `recipes/<id>.json` through the contract in `lib/recipe.mjs`, so a recipe doesn't need hand-written JSON. *`lib/draft.mjs`, `public/features/recipe-editor.mjs`, `POST`/`PUT /api/recipes`; `#/new`, `#/new/<queueId>`, `#/edit/<id>`.*
- [ ] **Queue from the static site** (~4 h). Let the deployed copy queue a video (for example through a small Cloudflare Function) instead of only copying a request.
- [x] **Schema version and migration** (~3 h). A `schema` field, a migration script and a JSON Schema of the recipe contract. *`lib/migrate.mjs`, `npm run migrate`, `schema/recipe.schema.json` (checked against `validateRecipe` by `test/schema.test.mjs` and by `npm run validate`).*
- [x] **Offline and mobile** (~4 h). Installable PWA with the recipes cached for cooking without signal, and a pass on the mobile layout and keyboard navigation. *`public/sw.js` and the redesigned dashboard; layout still to be confirmed with `npm run device-check`.*

## Household planning and budget

- [x] **Household profile** (~6 h). Set up the household once: how many people, age groups (for example "2 adults, 1 child aged 6–10") and general eating habits (portion size, vegetarian days, how often you cook). It is anonymous and stays on the device: no names, no accounts, nothing sent to a server. *`#/household`; its servings per meal feed the week plan and serving scaling.*
- [ ] **Amounts for your household** (~8 h). Use the profile to turn a week plan into purchase amounts: how much chicken, rice or cheese to buy for everyone, built on serving scaling and the combined shopping list. Amounts that the creator only gave in words stay as words and are flagged. *Logic (`lib/purchase.mjs`), tests, a pantry that is left out, and the purchase option of `public/features/shopping-list.mjs` are built ([PURCHASE.md](public/features/PURCHASE.md)); left: placing it in the dashboard, and a way to say how many servings a recipe that counts items ("12 nuggets") makes.*
- [x] **Food budget** (~6 h). Set a weekly or monthly food budget, record what each shop actually cost, and see spend per meal and per person over time, so purchase amounts and plans get more accurate. *`#/household`.*
- [ ] **Local prices and deals** (~12 h). Link each shopping-list ingredient to current prices and offers at nearby supermarkets, and suggest where the week's list is cheapest. Uses official store APIs or published offer feeds only (no scraping), cached locally, with a clear "last updated" time. *Groundwork built, no real source yet: provider interface, cache with expiry, cheapest-shop comparison and a fake provider (`lib/prices.mjs`); what a source must give us is in [docs/PRICES.md](docs/PRICES.md).*

## Recipe Agent and self-hosting

The self-hosted Recipe Agent can run with the coding agent you already use. See [SELF-HOSTING.md](SELF-HOSTING.md) and [agent/RECIPE-AGENT.md](agent/RECIPE-AGENT.md).

- [x] **Recipe Agent definition** (~6 h). An `agent/` folder that describes the agent's job (capture a video, write `recipes/<id>.json` by the contract, validate, credit the creator) once, with thin entry files per harness: `CLAUDE.md` for Claude Code, `AGENTS.md` for Codex and other AGENTS.md-aware tools, and `SOUL.md` for agents that use a persona file.
- [x] **Analysis skill** (~8 h). Package the video-analysis workflow as a reusable skill: read the platform's captions and description first, fall back to local speech-to-text on the audio, sample keyframes for on-screen text, then write the recipe in its own words with amounts only as the creator gave them.
- [x] **Local dependencies and setup** (~4 h). A `SELF-HOSTING.md` and a `npm run doctor` check for the optional tools the agent needs: `ffmpeg`, `yt-dlp`, a local speech-to-text engine (for example faster-whisper) and `tesseract` for on-screen text. The dashboard keeps working without any of them.
- [x] **Keep captures private** (~2 h). The agent writes transcripts, captions and frames to a configurable folder outside the repository and never commits them; only the finished recipe goes in `recipes/`. Users are responsible for following each platform's terms.
- [x] **More platforms** (~6 h). URL parsing, public embeds, recipe validation and queue metadata support YouTube (including Shorts), TikTok, Instagram Reels, Facebook, Pinterest, X and explicitly opted-in HTTPS web pages; the dashboard takes its labels from the platform table and asks before queueing a web page. See [PLATFORMS.md](docs/PLATFORMS.md).

## Sharing

- [x] **Recipe packs** (~5 h). Export favourite recipes as a single file or link and import someone else's pack, with duplicates detected by video. No accounts and no server needed. *`lib/pack.mjs`, `npm run packs`, `POST /api/packs/import` and the "Share" page (`#/packs`).*
- [ ] **Community list for self-hosters** (~6 h). An optional, read-only "top recipes" page for a self-hosted copy, built from the packs its owner chooses to include. Ratings stay local.

About 111 hours in total, ticked items included; the open items add up to about 33 hours.
