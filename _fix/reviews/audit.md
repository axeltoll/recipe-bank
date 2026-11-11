# Privacy and security audit of five more branches

Findings only, no verdicts. Reviewer: claude fable-5.2 (recipe-bank-pam lane). Source: the five `_review/audit-*.diff` files; line numbers below are line numbers **in the diff file**, because the branch trees were not provided.

**Scope, stated plainly.** The five diffs total about 19,000 lines and I did not read them line by line. I read in full: every `server.mjs` hunk, every script that writes files, both pack libraries, the redesign's service worker, core and the recipe, home, queue and add views, and the website's preview server and data generator. I searched all five for HTML sinks, storage access, network calls, external hosts, process spawning and private-data patterns, and read what those searches turned up. Nothing was executed. A finding below is something I saw; the absence of a finding in a file I only searched is weaker evidence than in a file I read.

## Across all five

### A1. `creator.url` is rendered as a link and validated nowhere
- **Where:** redesign `audit-feat-redesign.diff:4047-4048, 4074`; website `audit-feat-website.diff:2829-2830`; main `public/app.js:288`. The contract (`validateRecipe`) checks `video.url` only.
- **What goes wrong:** a recipe file with `"creator": { "url": "javascript:alert(1)" }` passes validation and becomes `<a href="javascript:…" target="_blank">`. `esc()` protects the attribute, not the scheme.
- **Why it matters now:** on main, recipe files are written by the owner's own agent. `feat/recipe-packs` and the pack code in `feat/roadmap-functions` import recipes from strangers, and `feat/recipe-editor` accepts them over HTTP. The packs branch knows the gap: its JSON Schema requires `^https?://` for `creator.url`, and its own test states that `validateRecipe` ignores it (`audit-feat-recipe-packs.diff:3232-3248`), yet import is gated by `validateRecipe`, not by the schema.
- **Related, on main:** `parseVideoUrl` has no scheme check, so `javascript://www.youtube.com/…?v=<11 chars>` parses as a YouTube link and `video.url` is rendered raw in `href`. `feat/more-platforms` closes that one (`lib/video.mjs:38` there); the other branches do not have it.
- **Fix:** in `validateRecipe`, require `creator.url` (when present) to parse as `http:` or `https:`, and render links through one helper that returns `#` for anything else. Merge `feat/more-platforms` (or its one-line scheme check) before any branch that imports recipes.

### A2. Any web page can write to the local server through simple POSTs
- **Where:** editor `POST /api/recipes` (`audit-feat-recipe-editor.diff:1836-1838`); `POST /api/queue` on every branch and on main.
- **What goes wrong:** `readBody` accepts any content type, so a page on another origin can send `fetch('http://127.0.0.1:4780/api/recipes', { method: 'POST', body: '{…}' })` with the default `text/plain` type. No preflight is triggered and the server acts on it. With the editor branch that **creates a recipe file in the working tree of a public repository** and removes the matching queue entry. It cannot overwrite (409 on an existing id), and `PUT` needs a preflight the server never grants.
- **Already solved once:** the packs branch requires `application/json` on its import route for exactly this reason, with a comment explaining it (`audit-feat-recipe-packs.diff:2120-2125`).
- **Fix:** move that check into `readBody` for every write route, and also reject requests whose `Origin` header is present and is not the server's own origin. Checking `Host` against `127.0.0.1:<port>` / `localhost:<port>` would close DNS rebinding as well.

### A3. Internal process words in public documents
- **Where:** redesign `docs/design/AUDIT.md` ("this lane has no Node or browser", `audit-feat-redesign.diff:69`); the same pattern as in `docs/PLATFORMS.md` and `public/features/HOUSEHOLD.md` on the reviewed branches.
- **What it is:** not private data. No private names, home paths, hosts, tokens or account names turned up in any of the five diffs; the only account-like strings are the public repository address and the `--project-name=recipe-bank` flag that main already has.
- **Fix:** reword before publishing.

## feat/recipe-editor

- **E1. Unknown fields are written to disk as sent** (`audit-feat-recipe-editor.diff:1806-1828`). The server validates the body and then writes the whole object, so up to 500 kB of arbitrary extra keys land in `recipes/<id>.json`. Combined with A2 that is attacker-chosen content in a tracked file. Fix: write a copy that holds only contract fields, or reject unknown top-level keys on this route.
- **E2. Data-folder switch** (`:1727`): `RECIPE_BANK_DATA_DIR` moves `recipes/` and `data/` anywhere. Fine for tests; note it in SELF-HOSTING so nobody points it at a shared folder. The packs branch uses a different name for the same thing (see `merge-risks.md`).
- **In order:**
  - The id is slug-checked before it becomes a file name, for both POST and PUT (`:1803, 1847`), and `validateRecipe` ties `body.id` to the path id.
  - Writes are atomic with a random temp name that does not end in `.json` (`:1776-1786`), under the queue lock.
  - The one `innerHTML` status message with markup escapes both the error text and the id (`:1658`); problem lists are escaped (`:1341-1346`); the JSON preview uses `textContent`.
  - No browser storage (asserted by a test, `:2267`).
  - A blank amount is always saved as `amount: null, basis: "unstated"`, and "some" typed as an amount is flagged (`:347, 420-455`). The contract rule is enforced in the form, not left to the user.
  - The change to `recipes/cold-pan-chicken.json` (`:1699-1700`, parsley "some" → `null`/`unstated`) fixes a real contract error under rule 1.

## feat/recipe-packs

- **P1. Imported recipes are only as safe as `validateRecipe`**: see A1. This is the branch where A1 turns from hygiene into an input-validation hole, because a pack is by definition someone else's file.
- **P2. Pack links put recipe text in the URL fragment** (`audit-feat-recipe-packs.diff:696-706`). A fragment is not sent to the server, which is right. It does end up in browser history and in whatever chat app the link is pasted into. The content is the user's recipes, so this is a note for the docs, not a defect.
- **In order (this is the most defensively written of the five):**
  - Size, count and depth caps (`:388-396`); `__proto__`, `constructor` and `prototype` keys refused at any depth (`:533-549`).
  - Control and bidi-override characters are stripped from every string that reaches a terminal or a title (`:763-770`).
  - A forged "already read" result is not trusted, because genuine results are tracked in a `WeakSet` (`:626-634`).
  - The server re-plans against the disk instead of trusting the browser's plan, checks the slug again, and writes with the `wx` flag so nothing is ever overwritten (`:2138-2170`); the CLI does the same (`:1969`).
  - The JSON content type is required (`:2123`).

## feat/roadmap-functions

- **F1. Its pack importer can overwrite a file** (`audit-feat-roadmap-functions.diff:2975-2994`). `planImport` only knows the *valid* recipes returned by `loadRecipes`. If `recipes/foo.json` exists but is currently invalid, a pack recipe with id `foo` is planned as new and `writeFile` replaces the file, with no `wx` flag. The comment above says "Import never overwrites".
- **F2. No limits and no cleaning in its pack reader** (`:380-415`): no size or count cap, no prototype-key check, and the pack title and validation messages are printed to the terminal unfiltered (`:2983-2986`), so a pack can carry terminal escape sequences.
- **F3. Two pack formats.** This branch links with `#/import/<data>` and has `created`/`note`; the packs branch links with `#pack=<data>` and has `exported`. Both call themselves `recipe-bank-pack` version 1. A pack from one cannot be told from the other by its header. Keep the packs branch's implementation and delete this one (see `merge-risks.md`).
- **F4. `.md` files are now served** (`:3072`), and `public/features/INTEGRATION.md` is deployed with the static copy. Harmless content; mentioned because it is a new file type on a public host.
- **In order:**
  - The static handler now answers 400 on a malformed `%` instead of throwing into the 500 path (`:3282-3287`); the traversal check is unchanged and correct.
  - `createApp` moves the queue lock inside the instance, so tests cannot share state.
  - The feature modules' storage helper wraps every read and write in `try`, including the `localStorage` getter (`:1874-1901`), and `esc` is the same function as the dashboard's.
  - The static build adds a `Content-Type` rule for `/features/*.mjs` (`:2798`), which the household branch needs too.
  - I did not read `lib/scale.mjs` and `lib/plan.mjs` line by line. The diff's own tests assert that an unstated ingredient never gets an amount (`:3929`) and that amounts given in words are not scaled; whoever reviews this branch properly should confirm that against contract rule 1, because scaling is where an invented amount would come from.

## feat/redesign

- **R1. The service worker caches every same-origin GET** (`audit-feat-redesign.diff:2988-3001, 3028-3040`). Anything that is not `/api/*` is "shell" and is stored on first fetch, and `ignoreSearch: true` means `/app.js?v=2` is answered with the cached `/app.js`.
  - It is opt-in, off by default, and switching it off unregisters the worker and deletes the caches (`:3883-3897`), which is the right default.
  - Cost: cache-first means a new recipe written by the agent appears only on the second reload while the switch is on.
  - Cost: `cache.addAll(SHELL)` fails as a whole if any listed file is missing (`:3007-3008`), so a rename in another branch silently disables offline use.
  - Fix: add a test that every file in `SHELL` exists, and state the staleness in the switch's help text.
- **R2. Platform label** (`:3370`, `:3096`): `PLATFORM` is still the three-entry map. The recipe and queue views fall back to "Video" / "the platform" (`:3806, 3850, 4038`), which is good; the Add dialog hint does not, so it shows `✓ undefined video` once `feat/more-platforms` is merged.
- **R3. Third-party requests:** Google Fonts as on main. No new external host.
- **In order:**
  - Every interpolation I read in `ui/home.js`, `ui/recipe.js` and the queue list goes through `esc()` or is a number or a constant, including `data-*` attributes.
  - Timestamps become buttons only for YouTube and plain text elsewhere (`:4113-4115`), which makes the control truthful.
  - Saved filters are type-checked when restored (`:3396-3402`); storage is wrapped in `try`.
  - The queue `DELETE` id is URL-encoded (`:3477`).

## feat/website

- **W1. three.js is loaded from a CDN at run time, without an integrity hash** (`audit-feat-website.diff:1551`, `brand.json` at `:451`). The version is pinned (`three@0.170.0`), but the import map has no `integrity` entry, so the page runs whatever jsDelivr serves for that URL. It also tells jsDelivr and Google Fonts about every visitor. `site/README.md` documents how to self-host both (`:372`).
  - This is a dependency in all but name, and CLAUDE.md asks for that to be raised with the owner first.
  - Fix: vendor `three.module.js` into `site/js/` (one MIT-licensed file), or add the `integrity` map to the import map.
- **W2. The showcase is a committed copy of three recipe files** (`:49-127`), kept honest by a test. It goes stale the moment a recipe changes, and `feat/recipe-editor` changes one of the three (`cold-pan-chicken`). See `merge-risks.md`.
- **In order:**
  - The preview server decodes, rejects NUL, normalises and requires the result to be the root or under `root + sep` (`:163-174`); it serves GET and HEAD only and listens on `127.0.0.1`.
  - The showcase keeps each creator's name, handle and link, and embeds nothing that is not already in `recipes/`.
  - `brand.json` contains a rule against invented users, numbers and reviews, and a source for every claim on the page.
  - Theme storage is wrapped in `try`.
  - No analytics, no cookies, no form that posts anywhere.
