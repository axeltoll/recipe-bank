# Mount points for feature modules

How a feature (week plan, combined shopping list, serving scaling, exclude filter, tag and nutrition filters) plugs into the dashboard without editing `public/app.js` or the views in `public/ui/`.

The names in this file are defined in code in `lib/hub.mjs` (`MOUNTS`, `REPEATED_MOUNTS`, `EVENTS`, `RESERVED_ROUTES`, `LAYOUTS`). `test/design.test.mjs` fails if a mount id or event listed there is missing from the views or from this document.

## 1. How a feature is loaded

A feature is one ES module in `public/features/` that exports `install(rb)`. Register it in `public/features/index.js`:

```js
export const features = [
  () => import('./week-plan.js'),
  () => import('./exclude-filter.js'),
];
```

At boot the dashboard loads the recipes and the queue, then calls each loader in order and awaits `install(rb)`, then dispatches `rb:ready` and renders the first route. A feature that throws while loading or installing is skipped with a console warning; the dashboard carries on.

```js
// public/features/exclude-filter.js
export function install(rb) {
  const excluded = new Set();

  rb.addFilter('exclude', {
    test: (recipe) => !recipe.components.some((c) => c.ingredients.some((i) => excluded.has(i.key))),
    active: () => excluded.size,
    describe: () => [...excluded].map((k) => `without ${k}`),
    clear: () => excluded.clear(),
  });

  rb.on('view', ({ name }) => {
    if (name !== 'home') return;
    const slot = rb.mount('filter-exclude');
    slot.innerHTML = '<h3>Without</h3><div class="chip-list"></div>';
    // …render chips into slot, toggle `excluded`, then call rb.refresh()
  });
}
```

Rules for a feature:

- Import shared logic from `/lib/` (for example `/lib/catalog.mjs`, `/lib/format.mjs`). Do not import from `/ui/` or `/app.js`.
- Escape every string from recipes, the queue or oEmbed with `rb.esc()` before it goes into `innerHTML`.
- Use the tokens and components of [DESIGN.md](DESIGN.md) (`.btn`, `.chip`, `.segmented`, `.panel`, `.callout`, `.badge`, `.state`). A feature's own CSS goes in its own file, loaded by the feature, and uses tokens only.
- Controls are at least 44 px on phones. Nothing depends on hover.
- Browser storage is a convenience: use `rb.store`, which never throws.
- Never change a recipe's data. A scaled amount is a display value and must be marked as scaled (see `recipe-scaling`).

## 2. Mount points

A mount point is an empty element the dashboard renders and then leaves alone. It is hidden while empty (`.mount:empty { display: none }`), so write markup without leading whitespace and empty it (`slot.replaceChildren()`) to hide it again.

Mount points are re-created every time their view renders. Fill them from an `rb:view` listener (or `rb:grid` for card slots), not once at install.

Get one with `rb.mount(name)`; it returns the element, or `null` when the current view does not have it.

| Name | Element | View | Where it is | Meant for |
|---|---|---|---|---|
| `topbar` | `#mount-topbar` | every view (in the header; rendered once, never re-created) | Before the theme toggle | A compact status or shortcut, e.g. "Week: 3" linking to the plan |
| `home-tools` | `#mount-home-tools` | home | In the tools row, after the Filters button | A button such as "Plan this week" |
| `home-top` | `#mount-home-top` | home | Above the recipe grid, full width of the grid column | A strip: this week's plan, a nutrition summary |
| `filter-exclude` | `#mount-filter-exclude` | home | In the filter panel, right under the ingredient chips | The "Without" ingredient filter |
| `filter-tags` | `#mount-filter-tags` | home | In the filter panel, after `filter-exclude` | Tag chips |
| `filter-nutrition` | `#mount-filter-nutrition` | home | In the filter panel, last group | Minimum protein, maximum calories |
| `recipe-actions` | `#mount-recipe-actions` | recipe | In the action row after Start cooking, Copy list and Print. On a phone this row is the sticky bottom bar, so keep it to one short button | "Add to week", "Add to list" |
| `recipe-scaling` | `#mount-recipe-scaling` | recipe | Top of the Ingredients panel, above the legend | The servings control |
| `recipe-aside` | `#mount-recipe-aside` | recipe | Bottom of the Ingredients panel | Anything that follows the list, e.g. "3 of these are on your shopping list" |

The three filter mounts carry the class `filter-group`. Start the content with an `<h3>` so it matches the built-in "Ingredients" group:

```html
<h3>Tags</h3>
<div class="chip-list">
  <button type="button" class="chip" aria-pressed="false">air fryer<span class="count">3</span></button>
</div>
```

### Repeated slot: one per card

| Name | Selector | View | Where it is |
|---|---|---|---|
| `card-actions` | `[data-mount="card-actions"]`, with `data-recipe-id="<id>"` | home | Bottom of each recipe card, above the card's stretched link, so buttons in it are clickable |

`rb.mounts('card-actions')` returns all of them. The grid is redrawn on every filter change, so fill these from `rb:grid`:

```js
rb.on('grid', ({ root }) => {
  for (const slot of rb.mounts('card-actions', root)) {
    const id = slot.dataset.recipeId;
    slot.innerHTML = `<button type="button" class="btn btn-quiet" data-plan="${rb.esc(id)}">Add to week</button>`;
  }
});
```

### Hooks in the ingredient list (serving scaling)

On the recipe page each amount is rendered as:

```html
<span class="ing-amt" data-ci="0" data-ii="2" data-key="chicken" data-basis="spoken" data-amount="2 per person">
  <span class="ing-amt-text">2 per person</span>
  <span class="ing-basis">…</span>
</span>
```

- `data-ci` / `data-ii`: component and ingredient index in the recipe file.
- `data-amount`: the creator's original words (empty when `data-basis="unstated"`). Never overwrite this attribute; restore from it.
- To show a scaled value, set the text of `.ing-amt-text` and add `data-scaled="true"` to `.ing-amt`. The stylesheet colours scaled amounts with `--accent-text`; also say in words that amounts are scaled (the `recipe-scaling` mount is the place). Leave amounts that are not plain numbers and units untouched, and never give an unstated amount a number.
- Each checkbox is `input[data-check="<ci>.<ii>"]`.

## 3. Events

All events are `CustomEvent`s on `document`, named `rb:<name>`. `rb.on(name, fn)` subscribes, calls `fn(detail, event)` and returns an unsubscribe function.

| Event | When | `detail` |
|---|---|---|
| `rb:ready` | Once, after data is loaded and features are installed, before the first view | `{ rb }` |
| `rb:view` | After every route render (first load, navigation, and a re-render of the same route) | `{ name, layout, root }` plus, by view: `recipe` → `{ id, recipe }`; `queue` → `{ id, entry }`; a feature route → `{ param }`. `name` is `home`, `recipe`, `queue`, `missing`, or a feature route's name. `root` is `main#view`. |
| `rb:grid` | After every redraw of the home grid (each filter or search change) | `{ recipes, total, root }`: the recipes shown, the number in the bank, and `#grid` |
| `rb:filters` | When the built-in filters change (search text, ingredient chips, Has all / Has any, Clear all) | `{ q, keys, mode }` |
| `rb:check` | When an ingredient is ticked or unticked, on the page or in cook mode | `{ recipe, key, checked, all }`: `key` is `"<ci>.<ii>"`, `all` the list of ticked keys |
| `rb:cook` | When cook mode opens or closes | `{ recipe, open, root }`: `root` is the cook `<dialog>` |

On the home view the order is `rb:grid`, then `rb:view`. A feature that filters should therefore set up its state at install and draw its controls on `rb:view`.

## 4. The `rb` API

`install(rb)` receives it; it is also `window.recipeBank` for debugging.

| Member | What |
|---|---|
| `rb.version` | `1`. Bumped on a breaking change to this contract. |
| `rb.isStatic` | `true` on the static build (no server, the queue is read-only). |
| `rb.recipes()` | All valid recipes, newest first. Treat as read-only. |
| `rb.recipe(id)` | One recipe or `undefined`. |
| `rb.queue()` | Queue entries. |
| `rb.filters()` | `{ q, keys, mode }`: a copy of the built-in filter state. |
| `rb.current()` | The current route: `{ name, id? , param? }`. |
| `rb.mount(name, root?)` | The mount element or `null`. |
| `rb.mounts(name, root?)` | All elements of a repeated slot. |
| `rb.on(event, fn)` | Subscribe; returns unsubscribe. |
| `rb.addFilter(id, filter)` | Register a recipe filter (below). Redraws the grid. Returns a function that removes it. |
| `rb.refresh()` | Re-run all filters and redraw the grid. Call it after your filter's state changes. Does nothing off the home view. |
| `rb.addRoute(name, def)` | Register a hash route (below). Returns a function that removes it. |
| `rb.navigate(hash)` | Go to a hash, e.g. `rb.navigate('#/plan')`. |
| `rb.reload()` | Re-read recipes and the queue from the API (after a feature wrote a recipe file) and update the header count. Resolves when done; navigate or `rb.refresh()` afterwards to redraw. |
| `rb.store` | `get(key, fallback)`, `set(key, value)`, `remove(key)` over `localStorage`, JSON-encoded, never throws. Prefix keys with `rb:`. |
| `rb.toast(text)` | Short confirmation. |
| `rb.copy(text, doneMessage)` | Copy to the clipboard with a toast. |
| `rb.esc(value)` | HTML-escape. |
| `rb.icon(name)` | Inline SVG markup. Names: `search`, `filter`, `close`, `plus`, `play`, `back`, `next`, `check`, `sun`, `moon`, `copy`, `print`, `pot`, `external`, `alert`, `list`. |

### Filters

```js
rb.addFilter(id, (recipe) => boolean);
rb.addFilter(id, {
  test(recipe) {},      // required: true keeps the recipe
  active() {},          // optional: how many conditions are on (number); feeds the count on the Filters button
  describe() {},        // optional: labels for the removable chips under the search, e.g. ['without pork']
  clear() {},           // optional: reset your state; called by "Clear all" and by a click on one of your chips
});
```

- A recipe is shown when the built-in filters and every registered `test` pass.
- A `test` that throws counts as a pass and is reported in the console, so a bug in a feature never empties the grid.
- After `clear()` the dashboard redraws the grid itself. Redraw your own controls from the next `rb:grid`.
- Clicking one of your `describe()` chips calls your `clear()` (the whole filter, not one condition).
- Registering the same `id` again replaces the filter.

### Routes

```js
rb.addRoute('plan', {
  label: 'Week plan',             // optional: adds a link to the header navigation
  title: 'Week plan',             // optional: document.title prefix (defaults to label, then name)
  layout: 'list',                 // 'list' | 'detail' | 'message' (DESIGN.md); default 'list'
  render(root, param, rb) {},     // draw into root (main#view, already emptied)
});
```

- The route is `#/plan`, and `#/plan/<param>` with `param` URL-decoded (`''` when absent).
- Names are lowercase letters, digits and dashes, starting with a letter. `r` and `q` are reserved.
- The header navigation appears once any route has a `label`; "Recipes" is always its first entry.
- A route never changes the shell. It gets the pane's padding and width from its layout type.
- `render` that throws shows an error state instead of a blank page.
- A deep link to a feature route works on first load, because features install before the first render.

## 5. The installed features

`public/features/index.js` installs these, in this order. Each installer is a small `*-feature.js` file that mounts a
self-contained module (`*.mjs`, documented in `INTEGRATION.md`, `HOUSEHOLD.md`, `EDITOR.md` and `PACKS.md`).

| Installer | Module(s) | Uses |
|---|---|---|
| `filters-feature.js` | `filters.mjs` | `filter-exclude`, `filter-tags`, `filter-nutrition`; `addFilter('without' / 'tags' / 'nutrition', …)` over `/lib/filter.mjs`. Recipes that don't state a macro never pass an active nutrition filter, and the panel says how many state them. State in `rb:filters-extra`. |
| `scale-feature.js` | `scale.mjs` | `recipe-scaling` plus the `.ing-amt` hooks, on `rb:view` for `name === 'recipe'`; a "Scale to your household" button when a household profile is saved |
| `plan-feature.js` | `week-plan.mjs`, `shopping-list.mjs` | `addRoute('plan', …)` (week plan beside the combined shopping list), `card-actions` and `recipe-actions` ("Add to week") |
| `household-feature.js` | `household.mjs`, `budget.mjs` | `addRoute('household', …)` |
| `packs-feature.js` | `packs.mjs` | `addRoute('packs', …)`; turns a `#pack=…` link into `#/packs` and opens the pack |
| `editor-feature.js` | `recipe-editor.mjs` | `addRoute('new', …)` (`#/new`, `#/new/<queueId>`), `addRoute('edit', …)` (`#/edit/<id>`), a "New recipe" button in `home-tools`; `rb.reload()` after a save |

The modules' own custom properties (`--rbf-*`, `--rb-*`, `--re-*`, `--pk-*`) are mapped to the design tokens in one
block of `public/styles.css` ("feature modules"), so the modules follow both themes without CSS of their own.

On the static build (`rb.isStatic`) the editor is read-only and offers "Download JSON", and the packs panel shows what a
pack holds without an Import button: nothing in `dist/` writes.
