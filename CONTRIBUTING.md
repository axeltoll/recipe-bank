# Contributing to Recipe Bank

Thanks for helping. Recipe Bank is plain ES modules on Node.js 22 or newer, with no dependencies and no build
step. Keep it that way unless there is a real need; a new dependency or build step is a decision to raise in an
issue first. [CLAUDE.md](CLAUDE.md) is the project reference: layout, API, the recipe file contract and the
conventions. [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) has the one-page overview.

## Before you open a pull request

```bash
npm run check   # npm test, npm run validate and npm run build, in that order
```

`npm test` includes the JSON Schema cross-check (`test/schema.test.mjs`), the website checks and the dashboard
wiring checks. If you have Chrome, also run `npm run smoke` and `npm run device-check`; CI runs the smoke test.
`.editorconfig` has the formatting: two spaces, LF, a final newline.

Things that make a test fail on purpose, so you notice:

- **A recipe file changed** that the website's showcase is built from (`cold-pan-chicken`,
  `air-fried-chicken-nuggets`, `banana-milk`): run `npm run site:data`.
- **A recipe file was added or removed:** `test/video-compat.json` pins every recipe's parsed video and
  deduplication key. Update it on purpose, with the new file's values.
- **A module was added to `public/` or `lib/` and the dashboard loads it:** add it to `SHELL` in `public/sw.js`
  and bump `VERSION` there.
- **A feature moved from planned to shipped:** change its `status` in `site/data/features.json` and run
  `npm run site:sync`.

## Add a recipe

The rules that matter are in CLAUDE.md under "Recipe file contract": never invent amounts (`amount: null`,
`basis: "unstated"` when the video does not say), steps come from the video, reuse ingredient keys, add a `t`
timestamp to steps where you can. The Recipe Agent instructions are [agent/RECIPE-AGENT.md](agent/RECIPE-AGENT.md);
a person can use the dashboard's editor (`#/new`) instead.

1. Write `recipes/<id>.json`, where `<id>` is a kebab-case slug and equals the file name.
2. Credit the creator (`creator.name`, and their handle and an `https://` profile link if you have them) and keep
   the original video link.
3. A new ingredient `key` needs an aisle in `AISLE_KEYS` in `lib/plan.mjs`; `npm run validate` warns otherwise.
4. Run `npm run validate`, remove the video's entry from `data/queue.json` if it was queued, and update
   `test/video-compat.json` (see above).

Never commit captions, transcripts, audio, video or frames: they are the creator's material. They belong in the
private capture folder outside the repository ([SELF-HOSTING.md](SELF-HOSTING.md)).

## Add a video platform

Everything that knows about platforms reads the `PLATFORMS` table in `lib/video.mjs`. To add one:

1. **`lib/video.mjs`:** add `{ id, label, embeds }` to `PLATFORMS`, and a branch in `parseVideoUrl` that
   accepts only the platform's exact hosts and URL shapes, returns `{ platform, id, url }` with a canonical `url`,
   and returns `null` for anything else on those hosts (so it never falls back to a web page). Add the host to the
   `serviceHosts` list. If the platform has a public embed, add it to `embedUrl`, building the iframe URL from a
   checked id only.
2. **Short links** (optional): add the host to `SHORT_HOSTS` in `lib/video.mjs` and make sure
   `lib/video-resolver.mjs` only follows redirects to that same platform.
3. **`schema/recipe.schema.json`:** add the id to the `video.platform` enum and one host and id rule to
   `$defs.video.allOf`, in table order. `test/schema.test.mjs` checks both against `PLATFORMS`.
4. **oEmbed** (optional): only a public endpoint that needs no key, in `oembed()` in `server.mjs`.
5. **Tests:** URL shapes, look-alike hosts and hostile input in `test/platforms.test.mjs` or
   `test/platform-nits.test.mjs`.
6. **Docs:** the table in [docs/PLATFORMS.md](docs/PLATFORMS.md), and the platform list in
   `agent/RECIPE-AGENT.md` and the analysis skill (`test/agent-docs.test.mjs` checks the agent docs).

The dashboard labels, the Add dialog copy, the server's error message and the capture script's message are built
from `PLATFORMS`, so they need no change.

## Add a dashboard feature

A feature is two files in `public/features/`, plugged in through `public/features/index.js`. It never edits
`public/app.js` or the views in `public/ui/`.

1. **The module** (`<name>.mjs`): exports `mount(element, options)` and returns a controller with `destroy()`.
   It renders with `esc()` from `shared.mjs` for every string that comes from data, wraps every browser-storage read
   and write in `try`/`catch` (`makeStore` or `readStored`/`writeStored` in `shared.mjs`), and loads its own
   stylesheet with `ensureStylesheet(new URL('./<name>.css', import.meta.url).href)`. Logic that needs no DOM goes in
   `lib/` with a test.
2. **The installer** (`<name>-feature.js`): exports `install(rb)` and uses the `rb` API: `rb.mount(name)` for a mount
   point, `rb.addRoute()` for a page of its own, `rb.addFilter()` for a filter, `rb.on('view', …)` to react to
   navigation. On the static build (`rb.isStatic`) it must not offer to write anything. The contract is
   [docs/design/MOUNT-POINTS.md](docs/design/MOUNT-POINTS.md).
3. **Register it:** one loader line in `public/features/index.js`.
4. **Styles:** the module's CSS uses custom properties with fallbacks; map them to the dashboard's tokens in the
   "feature modules" block of `public/styles.css`.
5. **Offline:** add the module, what it imports and its stylesheet to `SHELL` in `public/sw.js`
   (`test/sw.test.mjs` follows the imports).
6. **Docs and tests:** a section in `public/features/INTEGRATION.md` (or a page of its own next to it), and tests for
   the module (render functions in Node) and the installer (`test/feature-installers.test.mjs` shows how).

## Security

The local server listens on `127.0.0.1` unless `HOST` is set, and has no login, so leave `HOST` on `127.0.0.1` unless
the network is trusted. `writeRefusal` in `server.mjs` checks every change: a `POST` or `PUT` must be sent as
`application/json` (415), and a change gets 403 when `Sec-Fetch-Site` says another site, when `Origin` is not the
server's own, when `Host` is not a loopback name, a name in `RECIPE_BANK_HOSTS` or a non-wildcard `HOST`, or when a
loopback or missing `Host` comes from another machine. A request with no `Origin` and no `Sec-Fetch-Site` (curl,
scripts) passes those two checks.
Links from recipe files, packs and oEmbed go through `safeUrl()` (`lib/format.mjs`) before they reach an `href`
or `src`, and `validateRecipe` only accepts `http(s)` links. Keep both true when you touch rendering or the API.
Report a security problem privately through the repository's security advisories rather than in a public issue.
