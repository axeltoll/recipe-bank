# Recipe Bank

A personal recipe bank. Recipe videos from social media (YouTube Shorts, TikTok, Instagram Reels) get analyzed into exact ingredients and step-by-step guides, then shown on a local dashboard. The dashboard embeds each video, filters recipes by ingredient, and queues new videos for analysis.

## Run

```bash
npm start          # http://127.0.0.1:4780 (PORT / HOST env to override)
npm run dev        # same, restarts on server/lib changes
npm run validate   # checks every recipes/*.json and data/queue.json
npm test           # node:test: lib/, API on a random port, static build, feature modules
npm run schema     # regenerate schema/recipe.schema.json after changing the contract
npm run migrate    # dry run; `npm run migrate -- --write` upgrades recipe files to SCHEMA_VERSION
npm run packs      # export / import recipe packs (see scripts/pack.mjs)
```

No dependencies. Node ≥ 22 (built-in `fetch`, `node:test`, `import.meta.dirname`). `.claude/launch.json` has the `recipe-bank` preview config.

## Layout

| Path | What |
|---|---|
| `recipes/<id>.json` | One file per analyzed recipe. **The data.** The filename must equal `id`. |
| `data/queue.json` | Videos waiting for analysis (`queued` → `analyzing` → removed once the recipe file lands; `failed` if analysis is impossible). |
| `lib/video.mjs` | URL parsing, embed and thumbnail URLs. Shared by the server, validator and browser (served at `/lib/`). |
| `lib/recipe.mjs` | Recipe contract (`validateRecipe`, `SCHEMA_VERSION`). The enforced source of truth for the format below. |
| `lib/schema.mjs` | Contract versions: `migrateRecipe` and `MIGRATIONS`, plus the JSON Schema export (`schema/recipe.schema.json`). |
| `lib/filter.mjs` | Search, Has all / Has any, Without, tags and nutrition filters. `public/app.js` uses it. |
| `lib/plan.mjs` | Week plan and the combined shopping list (merged by `key`, grouped by aisle via `AISLE_KEYS`). |
| `lib/scale.mjs` | Serving scaling of plain-number amounts; words and rates stay untouched. |
| `lib/pack.mjs` | Recipe packs: export, import plan with duplicate detection by video, share links. |
| `server.mjs` | `node:http` server: static `public/` and `/lib/`, plus the JSON API. `createApp()` for tests. |
| `public/` | Dashboard (vanilla ES modules + CSS, light/dark). Hash routes: `#/`, `#/r/<id>`, `#/q/<queueId>`. |
| `public/features/` | Self-contained UI modules (`mount(el, options)`) for the week plan, shopping list, scaling and filters; `INTEGRATION.md` explains them. |
| `scripts/validate.mjs` | CLI validator; exits 1 on any problem. Warns about ingredient keys with no shopping-list aisle. |

API: `GET /api/recipes` → `{recipes, invalid}` · `GET /api/queue` · `POST /api/queue {url, note}` (409 if the video is already a recipe or queued; best-effort oEmbed title) · `DELETE /api/queue/<id>`.

## Recipe file contract (for analysis agents)

```jsonc
{
  "schema": 1,                                 // optional; contract version, absent = 1
  "id": "gochujang-chicken-thighs",          // kebab-case, == filename
  "title": "…",
  "status": "analyzed" | "partial",           // partial = creator withheld the method; gaps[] required
  "video": { "platform": "youtube|tiktok|instagram", "id": "…", "url": "…" },
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

Rules that matter more than the format:

1. **Never invent amounts.** `amount` is the creator's own words ("4", "1 can", "about 1 cup", "a good amount"). If nothing was said, set `amount: null` and `basis: "unstated"`; the UI shows "amount not given". `basis` is one of `on-screen`, `spoken`, `description` or `unstated`. Vague filler like "some" counts as unstated.
2. **Steps come from the video.** Don't fill withheld methods with generic cooking knowledge. Mark the recipe `partial` and list what's missing in `gaps`.
3. **`key` is the shopping-level filter key**: lowercase, singular, what you'd filter by (`chicken`, not `skin-on chicken thighs`; `chicken stock` stays distinct). Reuse existing keys: `npm start`, then the chip list, or `grep -h '"key"' recipes/*.json | sort -u`. A new key also needs an aisle in `AISLE_KEYS` (`lib/plan.mjs`); `npm run validate` warns when one is missing.
4. Add a `t` timestamp to each step where possible. The dashboard turns it into a "play from here" button.
5. Run `npm run validate` before committing. Once the recipe file exists, remove the matching entry from `data/queue.json`. The dashboard already hides queue entries whose video is in `recipes/`.

## Analysis pipeline

1. A video comes in through the dashboard's **Add video** (`data/queue.json`, `status: queued`). The static site can't queue, so it copies a request message instead.
2. An analysis agent captures the video's transcript, captions, description and keyframes into a private research store **outside this repository**. Transcripts, captions and frames are the creators' own content: never commit them here (`evidence/` is git-ignored for that reason).
3. The agent writes `recipes/<id>.json` from that material (rules above), in its own words with the creator credited, runs `npm run validate`, clears the queue entry, and commits.

## Conventions

- Keep it dependency-free unless there's a real need; adding a build step is a decision to raise with the owner first.
- The UI escapes every string from data files and oEmbed (`esc()` in `lib/format.mjs`), because queue titles come from third parties.
- Dashboard logic that needs no DOM goes in `lib/` with a test; `public/ui/` only renders. `test/design.test.mjs` checks the stylesheet tokens, contrast, imports and mount points by reading the files. When a module is added to `public/` or `lib/` and imported by the dashboard, add it to `SHELL` in `public/sw.js`.
- Browser storage only holds conveniences (filters, ingredient checkboxes), each read and write wrapped in try/catch.
