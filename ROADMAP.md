# Roadmap

Work I plan to do on Recipe Bank, roughly in order. Estimates are my own and include tests and docs.

## Next

- [ ] **Week plan and combined shopping list** (~6 h). Pick several recipes for the week and get one shopping list, with the same ingredient merged by its `key` and amounts kept in the creators' own words.
- [ ] **Exclude ingredients** (~2 h). A "without" filter next to *Has all* / *Has any*: no nuts, no pork, nothing I'm out of.
- [ ] **Filter by tag and nutrition** (~3 h). Tags such as "air fryer" or "high protein" as chips, and a minimum-protein / maximum-calorie filter for recipes that state macros.
- [ ] **Server and API tests** (~4 h). `node:test` coverage for `/api/recipes` and `/api/queue` (add, duplicate → 409, delete, bad input), plus the static build.
- [ ] **Browser smoke test** (~3 h). A headless run that loads the dashboard, filters, opens a recipe and presses a step's timestamp.

## Later

- [ ] **Serving scaling** (~5 h). Scale amounts that are plain numbers and units, and leave words like "a good amount" untouched, marking scaled amounts clearly.
- [ ] **Add and edit recipes in the dashboard** (~8 h). A form that writes a valid `recipes/<id>.json` through the contract in `lib/recipe.mjs`, so a recipe doesn't need hand-written JSON.
- [ ] **Queue from the static site** (~4 h). Let the deployed copy queue a video (for example through a small Cloudflare Function) instead of only copying a request.
- [ ] **Schema version and migration** (~3 h). A `schema` field, a migration script and a JSON Schema export of the recipe contract.
- [ ] **Offline and mobile** (~4 h). Installable PWA with the recipes cached for cooking without signal, and a pass on the mobile layout and keyboard navigation.

## Household planning and budget

- [ ] **Household profile** (~6 h). Set up the household once: how many people, age groups (for example "2 adults, 1 child aged 6–10") and general eating habits (portion size, vegetarian days, how often you cook). It is anonymous and stays on the device: no names, no accounts, nothing sent to a server.
- [ ] **Amounts for your household** (~8 h). Use the profile to turn a week plan into purchase amounts: how much chicken, rice or cheese to buy for everyone, built on serving scaling and the combined shopping list. Amounts that the creator only gave in words stay as words and are flagged.
- [ ] **Food budget** (~6 h). Set a weekly or monthly food budget, record what each shop actually cost, and see spend per meal and per person over time, so purchase amounts and plans get more accurate.
- [ ] **Local prices and deals** (~12 h). Link each shopping-list ingredient to current prices and offers at nearby supermarkets, and suggest where the week's list is cheapest. Uses official store APIs or published offer feeds only (no scraping), cached locally, with a clear "last updated" time.

## Recipe Agent and self-hosting

The self-hosted Recipe Agent can run with the coding agent you already use. See [SELF-HOSTING.md](SELF-HOSTING.md) and [agent/RECIPE-AGENT.md](agent/RECIPE-AGENT.md).

- [x] **Recipe Agent definition** (~6 h). An `agent/` folder that describes the agent's job (capture a video, write `recipes/<id>.json` by the contract, validate, credit the creator) once, with thin entry files per harness: `CLAUDE.md` for Claude Code, `AGENTS.md` for Codex and other AGENTS.md-aware tools, and `SOUL.md` for agents that use a persona file.
- [x] **Analysis skill** (~8 h). Package the video-analysis workflow as a reusable skill: read the platform's captions and description first, fall back to local speech-to-text on the audio, sample keyframes for on-screen text, then write the recipe in its own words with amounts only as the creator gave them.
- [x] **Local dependencies and setup** (~4 h). A `SELF-HOSTING.md` and a `npm run doctor` check for the optional tools the agent needs: `ffmpeg`, `yt-dlp`, a local speech-to-text engine (for example faster-whisper) and `tesseract` for on-screen text. The dashboard keeps working without any of them.
- [x] **Keep captures private** (~2 h). The agent writes transcripts, captions and frames to a configurable folder outside the repository and never commits them; only the finished recipe goes in `recipes/`. Users are responsible for following each platform's terms.
- [ ] **More platforms** (~6 h). Today: YouTube (including Shorts), TikTok and Instagram Reels. Next: Facebook and Pinterest videos, X, and plain web pages with a video, with embeds where the platform offers them and a link otherwise.

## Sharing

- [ ] **Recipe packs** (~5 h). Export favourite recipes as a single file or link and import someone else's pack, with duplicates detected by video. No accounts and no server needed.
- [ ] **Community list for self-hosters** (~6 h). An optional, read-only "top recipes" page for a self-hosted copy, built from the packs its owner chooses to include. Ratings stay local.

About 111 hours in total.
