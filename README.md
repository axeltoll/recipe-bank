# Recipe Bank

Turn the cooking videos you save into recipes you can actually cook from.

![A Recipe Bank recipe page: ingredient checklist, steps with play-from-here timestamps, and nutrition per serving. The embedded video is blurred in this screenshot.](docs/screenshot.png)

Recipe Bank keeps short recipe videos (today YouTube, including Shorts, TikTok and Instagram Reels; more platforms are planned) as structured recipes: the ingredients in the creator's own amounts, and step-by-step instructions whose timestamps jump straight to that moment in the embedded video. A small dashboard filters the collection by what you have in the fridge and builds a shopping list.

## Who it's for

Me, first: I save a lot of cooking videos and could never find the one I wanted, or work out the amounts, when it was time to cook. It suits anyone who wants a private, searchable cookbook built from short-form videos, without retyping every recipe by hand.

## What it does

- **Filter by ingredient.** Pick ingredients and switch between *Has all* and *Has any*, or search by dish or creator.
- **Cook from the video.** Each recipe embeds the original video. Every step has a "play from here" timestamp, and you can tick off ingredients as you go.
- **Cook mode.** One step at a time in large type, with the screen kept awake where the browser allows it.
- **Shopping list.** Copy a recipe's ingredients as a shopping list, or print the recipe.
- **Honest amounts.** Amounts are the creator's own words ("1 can", "about 1 cup"). When a video doesn't say, the recipe says "amount not given" instead of guessing, and recipes with a withheld method are marked *partial* with the gaps listed.
- **Queue new videos.** Paste a video link to add it to the queue for analysis.
- **Credit.** Every recipe links back to the creator and the original video. Videos are embedded from the platform, never re-hosted.

Built and tested, waiting to be placed in the dashboard's new design (see [`public/features/INTEGRATION.md`](public/features/INTEGRATION.md)):

- **Week plan and combined shopping list.** Pick recipes for the days of the week and get one list, merged by ingredient and grouped by aisle. Each recipe's amount stays in the creator's words; nothing is added up or guessed.
- **More filters.** *Without* (hide recipes with pork, nuts, or whatever you're out of), tags, a minimum protein and a maximum calories for recipes that state their macros.
- **Serving scaling.** Scale plain numbers and units (fractions, ranges, decimals); amounts given in words stay as they are, and every scaled amount shows the creator's original.
- **Recipe packs.** Export recipes as one file or link and import someone else's; recipes for a video you already have are skipped (`npm run packs`).

## Built with

- Node.js 22 and nothing else: no runtime dependencies, no framework, no build step for development.
- `node:http` server with a small JSON API (`server.mjs`).
- Vanilla ES-module dashboard with light and dark themes (`public/`).
- A recipe schema with a validator (`lib/recipe.mjs`, `npm run validate`) and tests on the built-in `node:test` runner.
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
npm run validate   # checks every recipes/*.json and data/queue.json
npm test           # all node:test suites: lib/, API, static build, feature modules
npm run build      # static copy in dist/ (read-only: "Add video" copies a request instead of queueing)
npm run schema     # regenerate schema/recipe.schema.json from lib/schema.mjs
npm run migrate    # bring recipe files up to the current contract version (dry run; add -- --write)
npm run packs -- export banana-milk --out my.pack.json    # or: import my.pack.json [--write]
```

## Project layout

| Path | What |
|---|---|
| `recipes/<id>.json` | One file per recipe. The format is documented in [CLAUDE.md](CLAUDE.md), enforced by `lib/recipe.mjs` and exported as JSON Schema in `schema/recipe.schema.json`. |
| `data/queue.json` | Videos waiting for analysis. |
| `lib/` | Shared by the server, the scripts and the browser: video-URL parsing (`video.mjs`), the recipe contract (`recipe.mjs`), filters (`filter.mjs`), week plan and shopping list (`plan.mjs`), serving scaling (`scale.mjs`), recipe packs (`pack.mjs`) and contract versions (`schema.mjs`). |
| `server.mjs` | Static files plus the JSON API (`/api/recipes`, `/api/queue`). |
| `public/` | The dashboard. |
| `public/features/` | Self-contained UI modules (week plan, shopping list, scaling, filters) with an integration guide. |
| `schema/` | JSON Schema export of the recipe contract. |
| `scripts/` | Validator, static build, schema export, migration and recipe packs. |
| `test/` | `node:test` suites. |

## Plans

See [ROADMAP.md](ROADMAP.md). Next up: putting the week plan, shopping list, scaling and filters into the redesigned dashboard, household planning with a food budget, and a self-hosted Recipe Agent that turns a video link into a recipe with the coding agent you already use.

## License

[MIT](LICENSE). The license covers this repository's code and recipe files. The videos belong to their creators; Recipe Bank only links to and embeds them.
