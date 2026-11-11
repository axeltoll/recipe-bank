# Recipe Bank

Turn the cooking videos you save into recipes you can actually cook from.

![A Recipe Bank recipe page: ingredient checklist, steps with play-from-here timestamps, and nutrition per serving. The embedded video is blurred in this screenshot.](docs/screenshot.png)

Recipe Bank keeps short recipe videos (today YouTube, including Shorts, TikTok and Instagram Reels; more platforms are planned) as structured recipes: the ingredients in the creator's own amounts, and step-by-step instructions whose timestamps jump straight to that moment in the embedded video. A small dashboard filters the collection by what you have in the fridge and builds a shopping list.

## Who it's for

Me, first: I save a lot of cooking videos and could never find the one I wanted, or work out the amounts, when it was time to cook. It suits anyone who wants a private, searchable cookbook built from short-form videos, without retyping every recipe by hand.

## What it does

- **Filter by ingredient.** Pick ingredients and switch between *Has all* and *Has any*, or search by dish or creator.
- **Cook from the video.** Each recipe embeds the original video. Every step has a "play from here" timestamp, and you can tick off ingredients as you go.
- **Shopping list.** Copy a recipe's ingredients as a shopping list.
- **Honest amounts.** Amounts are the creator's own words ("1 can", "about 1 cup"). When a video doesn't say, the recipe says "amount not given" instead of guessing, and recipes with a withheld method are marked *partial* with the gaps listed.
- **Queue new videos.** Paste a video link to add it to the queue for analysis.
- **Recipe packs.** Share a few recipes as one file or a link, and import someone else's: recipes whose video you already have are skipped, and nothing is overwritten.
- **Credit.** Every recipe links back to the creator and the original video. Videos are embedded from the platform, never re-hosted.

## Built with

- Node.js 22 and nothing else: no runtime dependencies, no framework, no build step for development.
- `node:http` server with a small JSON API (`server.mjs`).
- Vanilla ES-module dashboard with light and dark themes (`public/`).
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
npm run validate   # checks every recipes/*.json (contract and JSON Schema) and data/queue.json
npm test           # URL parsing and recipe-contract tests
npm run build      # static copy in dist/ (read-only: "Add video" copies a request instead of queueing)
node scripts/pack.mjs export <id…> --out favourites.json   # share recipes as a pack
node scripts/pack.mjs import favourites.json --write       # import one (without --write: just show the plan)
node scripts/migrate.mjs                                   # upgrade recipe files after a contract change (--write to save)
```

Recipe packs are described in [public/features/PACKS.md](public/features/PACKS.md).

## Project layout

| Path | What |
|---|---|
| `recipes/<id>.json` | One file per recipe. The format is documented in [CLAUDE.md](CLAUDE.md) and enforced by `lib/recipe.mjs`. |
| `data/queue.json` | Videos waiting for analysis. |
| `lib/` | Video-URL parsing, the recipe contract, migrations and recipe packs, shared by the server, the scripts and the browser. |
| `schema/` | JSON Schema of the recipe file. |
| `server.mjs` | Static files plus the JSON API (`/api/recipes`, `/api/queue`, `/api/packs/import`). |
| `public/` | The dashboard. |
| `scripts/` | Validator, static build, migrations and recipe packs. |
| `test/` | `node:test` suites. |

## Plans

See [ROADMAP.md](ROADMAP.md). Next up: a week plan with a combined shopping list, household planning with a food budget, and a self-hosted Recipe Agent that turns a video link into a recipe with the coding agent you already use.

## License

[MIT](LICENSE). The license covers this repository's code and recipe files. The videos belong to their creators; Recipe Bank only links to and embeds them.
