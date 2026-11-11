# Recipe editor

`recipe-editor.mjs` is a self-contained form for creating and editing a recipe without hand-written JSON. It writes
`recipes/<id>.json` through the contract in `lib/recipe.mjs`, via the local server's `POST /api/recipes` and
`PUT /api/recipes/<id>`. It brings its own stylesheet (`recipe-editor.css`, loaded by the module on first mount) and
does not depend on `app.js`, `index.html` or `styles.css`.

The form logic lives in `lib/draft.mjs` (pure functions, tested in `test/draft.test.mjs`); the module is the DOM
around it.

## Mount it

```js
import { mount } from '/features/recipe-editor.mjs';

const editor = mount(element, { recipe, video, readOnly, recipes });
// later, when the view changes:
editor.destroy();
```

| Option | What |
|---|---|
| `recipe` | A recipe object to edit (as returned by `GET /api/recipes`). Saving does `PUT /api/recipes/<id>`. The id is read-only. |
| `video` | For a new recipe only: a video URL, a parsed video (`{ platform, id, url }`) or a queue entry from `GET /api/queue`. A queue entry also fills in the title and creator from its oEmbed data. |
| `readOnly` | No saving: the form offers **Download JSON** instead. Defaults to `true` on the static build (`<html data-static="1">`), `false` on the local server. |
| `recipes` | The bank's recipes, if the host already has them. Used for filter-key suggestions, the auto id and duplicate checks. Without it the editor fetches `/api/recipes` (or `/api/recipes.json` on the static build). |

`mount` returns `{ destroy(), isDirty(), getRecipe() }`. `destroy()` removes the form, aborts pending requests and
drops its listeners. `isDirty()` is true when the form differs from what was loaded or last saved; use it to ask before
leaving. `getRecipe()` returns the recipe object the form currently describes.

### From the dashboard

Two entry points cover it. Both are a few lines in `app.js`; nothing in the editor needs to change.

**New recipe.** A "New recipe" action (for example next to **Add video**, or on a queue entry's page as "Write it up
myself") routes to `#/new` or `#/new/<queueId>`:

```js
import { mount } from '/features/recipe-editor.mjs';

let editor = null;
function renderEditor({ recipe, video }) {
  editor?.destroy();
  view.innerHTML = '<a class="back" href="#/">← All recipes</a><div id="editor"></div>';
  editor = mount(document.getElementById('editor'), { recipe, video, recipes: state.recipes });
}

// in route():
//   #/new             → renderEditor({})
//   #/new/<queueId>   → renderEditor({ video: state.queue.find((q) => q.id === queueId) })
//   #/edit/<id>       → renderEditor({ recipe: state.recipes.find((r) => r.id === id) })
// and call editor?.destroy(); editor = null; before rendering any other view.
```

**Edit.** On the recipe page, an "Edit" link to `#/edit/<id>`.

On the static build the same routes work: the form explains that this copy can't save and offers the JSON download.

## Events

Both events are `CustomEvent`s dispatched on the mount element with `bubbles: true`, so a listener on `document` works.

| Event | `detail` | When |
|---|---|---|
| `recipe-bank:recipe-saved` | `{ id, created, recipe, dequeued }` | After a successful save. `created` is true for a new recipe; `dequeued` lists the queue entry ids the server removed because the recipe's video was queued. The editor stays mounted and switches to edit mode. |
| `recipe-bank:editor-cancel` | `{ id, dirty }` | The user pressed **Cancel**. `id` is the recipe being edited, or `null` for a new one; `dirty` says whether there are unsaved changes. The host decides what to do (for example confirm, then go back). |

A typical host reaction:

```js
document.addEventListener('recipe-bank:recipe-saved', async (e) => {
  await load();                    // re-read /api/recipes and /api/queue
  location.hash = `#/r/${e.detail.id}`;
});
document.addEventListener('recipe-bank:editor-cancel', (e) => {
  if (!e.detail.dirty || confirm('Discard your changes?')) history.back();
});
```

## Data

- **Reads**: `GET /api/recipes` (unless `recipes` is passed) for ids, video keys and ingredient keys. Nothing else is
  fetched; the embedded video player loads only when the user opens "Watch the video while you write".
- **Writes**: `POST /api/recipes` with the recipe as JSON → `201 { recipe, dequeued }`; `PUT /api/recipes/<id>` →
  `200 { recipe, dequeued }`. Errors: `400 { error, problems }` when `validateRecipe` finds problems, `409 { error,
  recipeId }` for a duplicate id or video, `404` for an unknown id on PUT. The editor shows server problems in its
  problem list and links to the existing recipe on a 409.
- **Never invents amounts.** A blank amount is saved as `amount: null, basis: "unstated"` ("amount not given"); the
  basis picker resets to "amount not given" when an amount is cleared, and an amount typed while the basis says
  "amount not given" is a problem to fix, as is the vague filler "some".
- **Live problems** come from `checkDraft` (the contract plus form checks: duplicate id or video, amount/basis
  mismatch, unreadable times, non-numeric nutrition). Each problem is a button that focuses its field. Saving is
  refused while any are left.
- **Round trip.** Fields the form doesn't show (anything outside the contract) are kept as they are, and a recipe
  saved without changes is identical to the file it came from (as data; the server writes two-space JSON, so a file
  written in a compact style is re-indented on its first save).
- **Ids** are filled in from the title (`slugify`: kebab-case ASCII, `-2`, `-3` … when taken) until the user types
  their own.
- **Times** are typed as `m:ss`, `h:mm:ss` or seconds and saved as seconds (`t`). The ▶ button beside a time plays the
  video from there.
- Browser storage is not used.

## Accessibility

Every control has a label; repeated rows carry their number ("Ingredient 3 amount"). Add, remove and reorder are
buttons (↑ ↓ ✕), keyboard focus follows the row that moved or the next row after a removal, and **Undo** restores the
last removed ingredient, step, part, gap or note. All targets are at least 44 px. Every string from data or oEmbed is
escaped before it reaches the page.
