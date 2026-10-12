# Recipe Bank

Axel's personal recipe bank. Recipe videos from social media (YouTube Shorts, TikTok, Instagram Reels) get analyzed into exact ingredients and step-by-step guides, then shown on a local dashboard. The dashboard embeds each video, filters recipes by ingredient, and queues new videos for analysis.

The operator rules in `~/.claude/CLAUDE.md` / `~/dev/CLAUDE.md` apply: one folder per project, variants are branches, and worktrees go under `~/dev/worktrees/recipe-bank-<branch>`.

## Run

```bash
npm start          # http://127.0.0.1:4780 (PORT / HOST env to override)
npm run dev        # same, restarts on server/lib changes
npm run validate   # checks every recipes/*.json and data/queue.json
npm test           # node:test: URL parsing + recipe contract
```

No dependencies. Node ≥ 22 (built-in `fetch`, `node:test`, `import.meta.dirname`). `.claude/launch.json` has the `recipe-bank` preview config.

## Layout

| Path | What |
|---|---|
| `recipes/<id>.json` | One file per analyzed recipe. **The data.** The filename must equal `id`. |
| `data/queue.json` | Videos waiting for analysis (`queued` → `analyzing` → removed once the recipe file lands; `failed` if analysis is impossible). |
| `lib/video.mjs` | URL parsing, embed and thumbnail URLs. Shared by the server, validator and browser (served at `/lib/`). |
| `lib/recipe.mjs` | Recipe contract (`validateRecipe`). The enforced source of truth for the format below. |
| `server.mjs` | `node:http` server: static `public/` and `/lib/`, plus the JSON API. |
| `public/` | Dashboard (vanilla ES modules + CSS, light/dark). Hash routes: `#/`, `#/r/<id>`, `#/q/<queueId>`. |
| `scripts/validate.mjs` | CLI validator; exits 1 on any problem. |

API: `GET /api/recipes` → `{recipes, invalid}` · `GET /api/queue` · `POST /api/queue {url, note}` (409 if the video is already a recipe or queued; best-effort oEmbed title) · `DELETE /api/queue/<id>`.

## Recipe file contract (for analysis agents)

```jsonc
{
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
  "source": { "finding": "axels-vault/…#finding-N", "evidence": "axels-vault/…/evidence/<slug>/", "quantity_basis": "…" }
}
```

Rules that matter more than the format:

1. **Never invent amounts.** `amount` is the creator's own words ("4", "1 can", "about 1 cup", "a good amount"). If nothing was said, set `amount: null` and `basis: "unstated"`; the UI shows "amount not given". `basis` is one of `on-screen`, `spoken`, `description` or `unstated`. Vague filler like "some" counts as unstated.
2. **Steps come from the video.** Don't fill withheld methods with generic cooking knowledge. Mark the recipe `partial` and list what's missing in `gaps`.
3. **`key` is the shopping-level filter key**: lowercase, singular, what you'd filter by (`chicken`, not `skin-on chicken thighs`; `chicken stock` stays distinct). Reuse existing keys: `npm start`, then the chip list, or `grep -h '"key"' recipes/*.json | sort -u`.
4. Add a `t` timestamp to each step where possible. The dashboard turns it into a "play from here" button.
5. Run `npm run validate` before committing. Once the recipe file exists, remove the matching entry from `data/queue.json`. The dashboard already hides queue entries whose video is in `recipes/`.

## Analysis pipeline

1. A video comes in through the dashboard's **Add video** (`data/queue.json`, `status: queued`) or through the **Recipe Bank** Telegram topic.
2. The Hermes research agent captures it (transcript, keyframes, OCR, oEmbed) with the `vault-research-capture` skill. The evidence goes to `axels-vault/research/findings/food-content-culture/evidence/<slug>/`, and the format/funnel finding is appended to the food-content-culture findings file.
3. The same agent writes `recipes/<id>.json` here from the transcript (rules above), runs `npm run validate`, clears the queue entry, and commits.
4. The finding is format intelligence, kept in the vault; the recipe file is the cookable output, kept here. They link to each other through `source.finding`.

## Vault and routing

- Project card: `~/dev/axels-vault/Projects/Recipe-Bank/README.md`
- Lane note: `~/dev/axels-vault/ops/lanes/recipe-bank.md`
- Topic Creator handoff: `~/dev/axels-vault/handoffs/2026-10-12-recipe-bank-topic-creator-handoff.md`
- Delivery category `recipe_bank`; notify prefix `recipebank-`. The Telegram thread is `180986` (Recipe Bank); Topic Creator recorded it in `_system/config/telegram-topic-map.yaml` and `ops/topics.md` on 2026-10-12.
- The first four recipes were analyzed from the Personal topic (75757). The research findings are F1–F4 in `research/findings/food-content-culture/research-findings-food-content-culture-2026-09-27.md`.

## Conventions

- Keep it dependency-free unless there's a real need; adding a build step is a decision to raise with Axel first.
- The UI escapes every string from data files and oEmbed (`esc()` in `public/app.js`), because queue titles come from third parties.
- Browser storage only holds conveniences (filters, ingredient checkboxes), each read and write wrapped in try/catch.
