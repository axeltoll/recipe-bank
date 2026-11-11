# Recipe packs

Share a few recipes as one file or a link, and import someone else's. No accounts and no
server are needed to share; importing writes files, so it needs the local server or the CLI.

| File | What |
|---|---|
| `lib/pack.mjs` | The logic: export, read, plan, apply, links. Pure, shared by browser, server and CLI. |
| `public/features/packs.mjs` | The panel: `mount(element, options)` → `{ destroy() }`. |
| `public/features/packs.css` | Its styles, scoped to `.rb-packs`. |
| `server.mjs` | `POST /api/packs/import`. |
| `scripts/pack.mjs` | `export` and `import` from the command line. |

## Pack format

```jsonc
{
  "format": "recipe-bank-pack",   // required, exactly this
  "version": 1,                   // pack format version (not the recipe contract version)
  "title": "Weeknight chicken",
  "exported": "2026-11-11T10:00:00.000Z",
  "recipes": [ /* complete recipe files, as in recipes/<id>.json */ ]
}
```

Each recipe keeps its own `schema` field (missing means 1); `readPack` runs it through
`lib/migrate.mjs` before checking it with `validateRecipe`.

## Mounting the panel

```js
import { mount } from '/features/packs.mjs';
// <link rel="stylesheet" href="/features/packs.css"> once on the page

const panel = mount(document.querySelector('#packs'), {
  recipes: state.recipes,                 // optional; fetched from /api/recipes(.json) when missing
  onImported: (ids) => reloadRecipes(),   // optional; called with the created ids
});
// later
panel.destroy();
```

| Option | Default | |
|---|---|---|
| `recipes` | fetched | The bank's recipes, for the picker and for duplicate detection. |
| `static` | `<html data-static="1">` | Static copy: shows the plan but no Import button (there is no server to write to). |
| `apiBase` | `''` | Prefix for `/api/…` calls. |
| `fetch` | `window.fetch` | For tests or a wrapped fetch. |
| `readHash` | `true` | Open a `#pack=…` link from `location.hash` on mount and on `hashchange`. |
| `onImported` | none | Called with the list of created recipe ids. |

The module does not touch the DOM until `mount` is called, so it can be imported in Node
(`test/packs-ui.test.mjs` tests its pure renderers `renderPicker` and `renderPlan`).
`destroy()` removes its markup and every listener it added, including `hashchange`.

**Routing.** Pack links look like `http://127.0.0.1:4780/#pack=<data>`. The dashboard router
treats any hash it doesn't know as home, so the host page decides where the panel lives;
for example, mount it on the home view (or in a dialog) when `location.hash` starts with
`#pack=`. With `readHash` on, the panel opens that pack by itself.

## What import does

`planImport(pack, existingRecipes)` sorts every recipe in the pack, without writing anything:

| Status | When | Result |
|---|---|---|
| `new` | Video and id are new to the bank | Imported as `recipes/<id>.json` |
| `conflict` | The id is taken by a recipe with a different video | Imported under the first free `<id>-2`, `<id>-3`, … |
| `duplicate` | Same video (`videoKey`) as a recipe in the bank, or earlier in the pack | Skipped |
| `invalid` | Fails the contract, or the pack entry is malformed or hostile | Skipped; `problems` says why |

`applyImport(plan, { include } | { exclude })` turns the plan into `{ files, skipped }`
(`files[i]` = `{ id, path, contents }`). The caller writes them and must never overwrite:
the server and the CLI both write with the `wx` flag, which fails if a file appeared
in the meantime. The server always re-plans against the recipes on disk; it never trusts a
plan from the browser.

### `POST /api/packs/import`

```http
POST /api/packs/import
Content-Type: application/json

{ "pack": { …a pack… }, "include": [0, 2] }      // include is optional: default all new/conflict
```

- `201 { created: [ids], skipped: [{ index, id, reason }], counts }` when something was created, `200` with the same shape when nothing was.
- `400` for a body that is not a usable pack (`error` says why), `415` without a JSON content type, `413` past about 2 MB.
- The JSON content type is required on purpose: it makes browsers send a CORS preflight, which the server never grants, so other websites cannot write recipes through it.

### Command line

```bash
node scripts/pack.mjs export gochujang-chicken-thighs banana-milk --title "Two favourites" --out favourites.recipe-pack.json
node scripts/pack.mjs export --all --out everything.recipe-pack.json
node scripts/pack.mjs export banana-milk --link            # prints http://127.0.0.1:4780/#pack=…
node scripts/pack.mjs import favourites.recipe-pack.json   # dry run: prints the plan
node scripts/pack.mjs import favourites.recipe-pack.json --write
node scripts/pack.mjs import 'http://127.0.0.1:4780/#pack=…'
```

After `--write`, run `npm run validate` and commit the new files.

## Links

`packLink(pack, base)` returns `base#pack=<base64url of the pack JSON>` (UTF-8, no padding).
The fragment never reaches a server. The payload is limited to `MAX_LINK_CHARS` (32,000
characters, about three typical recipes); past that `packLink` throws a `PackError` with code
`too-large-for-link` and a message telling the user to download a file instead.
`packFromLink(link)` accepts a full URL, `#pack=…` or `pack=…`, refuses payloads past the same
limit, and reports a damaged link instead of throwing.

## Safety

A pack is untrusted input from someone else.

- **Size:** pack files over `MAX_PACK_CHARS` (2,000,000 characters) and packs with more than `MAX_PACK_RECIPES` (200) recipes are refused; nesting deeper than 32 levels is refused.
- **Prototype pollution:** any `__proto__`, `constructor` or `prototype` key, anywhere, is refused (the whole pack if it is in the wrapper, the one recipe if it is inside a recipe). Plans use `Set`/`Map`, never objects keyed by pack data. Only objects created by `readPack` count as read results.
- **Ids and paths:** every file is re-checked with `validateRecipe(recipe, id)` right before it is returned, so its id is a kebab-case slug and the path is always `recipes/<slug>.json`.
- **HTML:** titles and problems keep their text (control and bidi-override characters become spaces, titles are capped at 120 characters). The panel escapes every string with `esc()`; any other renderer must do the same.
- **Hostile recipe shapes** (a `null` component, a string where a list belongs) are reported as problems instead of crashing.

## Error codes

`PackError.code`: `empty`, `too-many`, `invalid-recipe`, `duplicate` (export); `invalid-pack`
(apply); `too-large-for-link` (link); `bad-link` (base64url decoding).
