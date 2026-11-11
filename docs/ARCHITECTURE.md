# Architecture

One page on how Recipe Bank fits together. Details live in the files linked from each section.

## Modules

```
recipes/*.json, data/queue.json        the data (one file per recipe; the queue)
        │
lib/            pure ES modules, no DOM and no fs: shared by server, scripts, browser and tests
  video.mjs            URL parsing, embeds, thumbnails, PLATFORMS table, videoKey (dedup key)
  video-resolver.mjs   short-link resolution (server only: HEAD requests)
  recipe.mjs           the contract: validateRecipe, SCHEMA_VERSION
  migrate.mjs          contract migrations         json-schema.mjs   subset JSON Schema validator
  filter.mjs           every recipe filter          catalog.mjs       dashboard queries (delegates filtering)
  plan.mjs  scale.mjs  household.mjs  budget.mjs  draft.mjs  pack.mjs   feature logic
  format.mjs  nav.mjs  hub.mjs                       dashboard helpers, router maths, feature registry
        │
server.mjs      node:http: static public/ and /lib/, JSON API (createApp)
scripts/        validate, build-static, migrate, pack, queue, capture, doctor, smoke, device-check, site
public/         the dashboard
  app.js               boot, data load, hash router, the rb API
  ui/*.js              views: home, recipe, queue, cook, add dialog, theme, offline, states
  features/index.js    the feature list
  features/*-feature.js installers: mount a module into the dashboard through rb
  features/*.mjs       self-contained modules: mount(element, options) → controller
  sw.js                optional service worker
schema/         recipe.schema.json      agent/  Recipe Agent      site/  project website
```

## Data flow

1. **Into the bank.** A link goes into the queue (`POST /api/queue`): parsed by `lib/video.mjs`, short links resolved,
   a title looked up by oEmbed where the platform offers one, deduplicated by `videoKey` against recipes and the queue.
   An analysis agent (`agent/`) or a person in the editor writes `recipes/<id>.json`; the server's write routes
   validate it and remove its queue entry. Recipe packs add files the same way, never overwriting one.
2. **Out to the dashboard.** `GET /api/recipes` reads and validates every file (invalid ones are reported, not shown);
   `GET /api/queue` marks entries whose video is now a recipe as done. The static build writes the same two answers to
   `dist/api/*.json` and marks the page `data-static="1"`; every write is then switched off.
3. **In the browser.** `app.js` loads both, installs the features (each may add filters, routes and markup at mount
   points), then renders the route. Filtering is `lib/filter.mjs` plus each feature filter; feature state (filters,
   week plan, ticked items, household, budget) stays in `localStorage`, every access wrapped in try/catch.

## Routes

| Hash | View | From |
|---|---|---|
| `#/` | recipe grid, search, filters, queue | `ui/home.js` |
| `#/r/<id>` | recipe: video, ingredients (scalable), steps with timestamps, nutrition | `ui/recipe.js` |
| `#/q/<queueId>` | a queued video and where it is in the analysis | `ui/queue.js` |
| `#/plan` | week plan and the shopping list for it | `features/plan-feature.js` |
| `#/household` | household profile and food budget | `features/household-feature.js` |
| `#/packs` | share and import recipe packs; `#pack=…` links land here | `features/packs-feature.js` |
| `#/new`, `#/new/<queueId>`, `#/edit/<id>` | the recipe editor | `features/editor-feature.js` |

Anything else renders home. Feature routes are registered with `rb.addRoute` and appear in the header when labelled.

## API

| Route | What | Errors |
|---|---|---|
| `GET /api/recipes` | `{ recipes, invalid }` | |
| `POST /api/recipes` | create `recipes/<id>.json` → 201 `{ recipe, dequeued }` | 400 problems, 409 duplicate id or video, 415 |
| `PUT /api/recipes/<id>` | replace it → 200 `{ recipe, dequeued }` | 404, 400, 409, 415 |
| `GET /api/queue` | `{ queue }` | |
| `POST /api/queue` | `{ url, note, allowWeb? }` → 201 `{ entry }` | 400 not a supported link, 409 already there, 415 |
| `DELETE /api/queue/<id>` | → 200 `{ ok: true }` | 404, 403 |
| `POST /api/packs/import` | `{ pack, include? }` → 201/200 `{ created, skipped, counts }` | 400, 413, 415 |

Writes go through one lock per server and are atomic (temp file, then rename, or the `wx` flag for packs). Every
POST, PUT and DELETE passes `writeRefusal` in `server.mjs` first. A POST or PUT must be sent as `application/json`
(415), which a cross-site page cannot send without a CORS preflight the server never grants; DELETE has no body and is
not a simple request either, so it is exempt from that check. Any of the three gets 403 when `Sec-Fetch-Site` says
another site, when `Origin` is not the server's own, when `Host` is not a loopback name, a name listed in
`RECIPE_BANK_HOSTS` or the `HOST` the server binds to (a wildcard `HOST`, `0.0.0.0`, `::` or `[::]`, adds no name;
this stops DNS rebinding), or when a loopback or missing `Host` comes from another machine. A request with no
`Origin` and no `Sec-Fetch-Site` (curl, scripts) is allowed. There is no login: keep `HOST` on 127.0.0.1 unless the
network is trusted.

## Tests

`npm test` runs every `test/*.test.mjs` with `node:test`: the `lib/` modules, the API on a random port against a
temporary data folder (`RECIPE_BANK_DIR`), the scripts, the static build, the service worker in a `vm` sandbox, the
design contract and module wiring by reading the files, the feature modules' renderers and installers with stand-ins
for the DOM, and the website. Browser behaviour is covered by `npm run smoke` and `npm run device-check`, which need
Chrome.
