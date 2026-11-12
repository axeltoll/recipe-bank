# Recipe Bank

Turn the cooking videos you save into recipes you can actually cook from.

![A Recipe Bank recipe page: ingredient checklist, steps with play-from-here timestamps, and nutrition per serving. The embedded video is blurred in this screenshot.](docs/screenshot.png)

Recipe Bank keeps recipe videos from YouTube (including Shorts), TikTok, Instagram Reels, Facebook, Pinterest and X, plus explicitly opted-in HTTPS web pages, as structured recipes: the ingredients in the creator's own amounts, and step-by-step instructions with video timestamps. Public embeds are used where supported, with a link otherwise; timestamp seeking is supported on YouTube. A small dashboard filters the collection by what you have in the fridge, plans the week and builds one shopping list for it. See [platform support](docs/PLATFORMS.md).

## Who it's for

Me, first: I save a lot of cooking videos and could never find the one I wanted, or work out the amounts, when it was time to cook. It suits anyone who wants a private, searchable cookbook built from short-form videos, without retyping every recipe by hand.

## What it does

- **Filter by ingredient.** Pick ingredients and switch between *Has all* and *Has any*, or search by dish or creator. *Without* hides recipes with pork, nuts or whatever you're out of (it goes by the ingredient list, so it is not an allergy check); tag chips and a minimum protein / maximum calories filter cover recipes that state their macros.
- **Cook from the video.** Each recipe embeds the original video where the platform allows it. Every step has a timestamp (a "play from here" button on YouTube), and you can tick off ingredients as you go.
- **Cook mode.** One step at a time in large type, laid out for a phone in one hand: ingredients, the video and Back / Next sit at the bottom, the screen is kept awake where the browser allows it (with a switch to turn that off), and a step that states a duration gets a kitchen timer.
- **Serving scaling.** Scale plain numbers and units (fractions, ranges, decimals); amounts given in words stay as they are, and every scaled amount is marked. With a household profile, one button scales a recipe to your household.
- **Week plan and one shopping list.** Add recipes to the days of the week and get one list, merged by ingredient and grouped by aisle. Each recipe's amount stays in the creator's words; nothing is added up or guessed. You can still copy a single recipe's list, or print it.
- **Household and food budget.** An anonymous, device-local household profile (age groups, portion size, cooking days, editable portion estimates) and a weekly or monthly food budget with recorded shops and spend per meal and per person. Currencies are kept apart, never converted.
- **Honest amounts.** Amounts are the creator's own words ("1 can", "about 1 cup"). When a video doesn't say, the recipe says "amount not given" instead of guessing, and recipes with a withheld method are marked *partial* with the gaps listed.
- **Add and edit recipes.** A form writes a valid `recipes/<id>.json` through the recipe contract, with live checks, from scratch or from a queued video. The static copy offers the file as a download instead.
- **Queue new videos.** Paste a video link to add it to the queue for analysis. A web page needs an explicit "it's a web page" tick.
- **Recipe packs.** Share a few recipes as one file or a link, and import someone else's: recipes whose video you already have are skipped, and nothing is overwritten.
- **Offline.** Turn on "Keep recipes for offline use" and the dashboard and recipes are cached for cooking without signal.
- **Credit.** Every recipe links back to the creator and the original video. Videos are embedded from the platform, never re-hosted.

## Built with

- Node.js 22 and nothing else: no runtime dependencies, no framework, no build step for development.
- `node:http` server with a small JSON API (`server.mjs`).
- Vanilla ES-module dashboard with light and dark themes (`public/`), built to a written design contract (`docs/design/`). Features plug in through mount points (`public/features/`).
- A versioned recipe contract with a validator (`lib/recipe.mjs`, `npm run validate`), a JSON Schema of the full file format (`schema/recipe.schema.json`), migrations between contract versions (`lib/migrate.mjs`) and tests on the built-in `node:test` runner.
- Static export for Cloudflare Pages (`npm run build`).

## Run it

Requires Node.js 22 or newer.

```bash
git clone https://github.com/axeltoll/recipe-bank.git
cd recipe-bank
npm start          # dashboard at http://127.0.0.1:4780 (PORT / HOST to override)
```

Other commands:

```bash
npm run dev        # restarts on server/lib changes
npm run validate   # checks every recipes/*.json (contract + JSON Schema) and data/queue.json; add -- --json for a report
npm test           # all node:test suites: lib/, API, scripts, static build, dashboard wiring, feature modules, website
npm run check      # npm test, npm run validate and npm run build in one go; see CONTRIBUTING.md
npm run build      # static copy in dist/ (read-only: no queueing, no saving, no pack import)
npm run migrate    # bring recipe files up to the current contract version (dry run; add -- --write)
npm run packs -- export banana-milk --out my.recipe-pack.json   # or: import my.recipe-pack.json [--write]
npm run doctor     # which optional tools the Recipe Agent can use on this machine
npm run smoke      # real-browser checks of the local server and the static build
npm run device-check # layout audit at 390, 768, 1280, 1920 and 2560 pixels
npm run site       # previews the public website in site/ at http://127.0.0.1:4790
npm run site:data  # regenerates site/data/showcase.js from the showcased recipe files
npm run site:sync  # rewrites the website's generated parts after editing site/data/features.json or site.json
```

Recipe packs are described in [public/features/PACKS.md](public/features/PACKS.md), the editor in [public/features/EDITOR.md](public/features/EDITOR.md).

### Browser checks

Browser checks use system Chrome/Chromium and Node's built-in WebSocket, with no
packages to install. Set `CHROME_PATH` to override browser discovery. If no browser
is found, both commands print a skip and exit successfully; `SMOKE_REQUIRED=1`
makes a missing browser fail (as in CI). Browser startup failures always fail.
Each run uses a fresh temporary profile and removes it on exit. External fonts,
images and video embeds are fulfilled locally, so checks make no third-party
requests and screenshots use fallback fonts and placeholder images. The smoke
check leaves the queue and the recipes unchanged.

Screenshots are written under git-ignored `.smoke/`. The device audit measures the
home page, a recipe and every feature route, also writes `.smoke/device/summary.json`
and `summary.txt`, and exits with an error for sideways scroll, mobile tap targets
below 44×44 pixels, prose lines over approximately 80 characters, unpainted
wide-screen edges, or console errors. Checkbox labels count as their tap area; edge
paint and line length use DOM/style measurements. Use the screenshots for visual
review, especially with production fonts and video embeds. The selectors both
checks use are in `scripts/browser/selectors.mjs`.

For local debugging, append `-- --headed` to either command. Narrow a smoke run
with `-- --only grid|filters|creator|recipe|timestamp|queue|keyboard|features`
(choose one), or a device audit with
`-- --only home|recipe|plan|household|packs|editor|390|768|1280|1920|2560`. Keyboard
smoke checks use Tab and Enter on every timestamp button. CI runs unit tests,
validation, the static build and a required Chrome smoke check on pushes to `main`
and pull requests; it does not deploy.

## Analyse your own videos

Use the coding agent you already have to turn a supported video link into a credited, validated recipe. Start with [SELF-HOSTING.md](SELF-HOSTING.md) for setup and optional capture tools (`npm run doctor`), then [the Recipe Agent instructions](agent/RECIPE-AGENT.md) in [`agent/`](agent/). Captured source material stays in your private data folder outside the repository.

## Project layout

| Path | What |
|---|---|
| `recipes/<id>.json` | One file per recipe. The format is documented in [CLAUDE.md](CLAUDE.md), enforced by `lib/recipe.mjs` and described in full by `schema/recipe.schema.json`. |
| `data/queue.json` | Videos waiting for analysis. |
| `lib/` | Shared by the server, the scripts and the browser: video-URL parsing (`video.mjs`), the recipe contract (`recipe.mjs`), migrations (`migrate.mjs`), filters (`filter.mjs`), dashboard queries (`catalog.mjs`), week plan and shopping list (`plan.mjs`), serving scaling (`scale.mjs`), household and budget (`household.mjs`, `budget.mjs`), the editor's drafts (`draft.mjs`), recipe packs (`pack.mjs`). |
| `server.mjs` | Static files plus the JSON API: recipes (read, create, replace), the queue, pack import. |
| `public/` | The dashboard: `app.js` (boot and router), views in `ui/`. |
| `public/features/` | Self-contained feature modules and the small installers that put them in the dashboard. |
| `docs/` | Design contract and mount points (`docs/design/`), platform support (`PLATFORMS.md`), architecture (`ARCHITECTURE.md`). |
| `schema/` | JSON Schema of the recipe file. |
| `agent/` | The Recipe Agent's instructions and skill. |
| `site/` | The public website for the project (static, separate from the dashboard): home page, docs and changelog. What it says about each feature comes from `site/data/features.json`. See [site/README.md](site/README.md). |
| `scripts/` | Validator, static build, migration, recipe packs, queue helper, capture and doctor, browser checks, the website's preview server, sample-data generator and sync script. |
| `test/` | `node:test` suites. |

## Plans

See [ROADMAP.md](ROADMAP.md) and [CHANGELOG.md](CHANGELOG.md). Next up: purchase amounts for your household (the logic and the shopping-list option are built, see [`public/features/PURCHASE.md`](public/features/PURCHASE.md), but the dashboard does not show them yet), queueing from the static site, and prices from nearby shops ([`docs/PRICES.md`](docs/PRICES.md)).

## License

[MIT](LICENSE). The license covers this repository's code and recipe files. The videos belong to their creators; Recipe Bank only links to and embeds them.
