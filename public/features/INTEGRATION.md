# Feature modules: integration guide

Four self-contained UI modules for the dashboard. The dashboard mounts them through small installers listed in `features/index.js` (`filters-feature.js`, `scale-feature.js`, `plan-feature.js`; see section 5 of `docs/design/MOUNT-POINTS.md`), and `public/styles.css` maps their `--rbf-*` properties to the design tokens. They also work on any other page. Each one:

- is a plain ES module with a `mount(element, options)` function that renders into `element` and returns a small controller (`update`, `destroy`, …);
- loads its own small stylesheet next to it (pass `css: false` to skip that and style it yourself);
- takes its colours and spacing from CSS custom properties (below), so it follows whatever theme the page sets;
- keeps its logic in `lib/` (`plan.mjs`, `filter.mjs`, `scale.mjs`), which is tested with `npm test`;
- escapes every string that comes from a recipe file;
- keeps browser storage to conveniences, with every read and write in try/catch.

| Module | What it does | Logic | Stylesheet | Storage key | Event |
|---|---|---|---|---|---|
| `week-plan.mjs` | Pick recipes for the days of the week | `lib/plan.mjs` | `week-plan.css` | `rb:week-plan` | `rb:plan-change` |
| `shopping-list.mjs` | One shopping list for the week, merged by ingredient key | `lib/plan.mjs` | `shopping-list.css` | `rb:shopping-checked` | `rb:shopping-check`, `rb:shopping-copy` |
| `scale.mjs` | Scale one recipe's amounts by servings or by a factor | `lib/scale.mjs` | `scale.css` | none | `rb:scale-change` |
| `filters.mjs` | *Without* (exclude ingredients), tags, minimum protein and maximum calories | `lib/filter.mjs` | `filters.css` | `rb:filters-extra` | `rb:filter-change` |

All events are `CustomEvent`s that bubble from the mounted element (so you can listen on the element or on `document`), with the payload in `event.detail`. Every `mount()` also takes an `onChange` callback if you prefer that.

The modules import `lib/` with relative paths (`../../lib/plan.mjs`), which resolve to `/lib/…` both on `npm start` and in the static build (`npm run build` copies `public/features/` and `lib/`).

## Data the modules need

All four take `recipes`: the array from `GET /api/recipes` (`/api/recipes.json` in the static build), i.e. `(await res.json()).recipes`. The dashboard already holds it as `state.recipes`. `scale.mjs` takes one recipe object instead.

## week-plan.mjs

```js
import { mount, addRecipeToWeek } from '/features/week-plan.mjs';

const week = mount(document.querySelector('#week'), { recipes: state.recipes });
// later, when the recipes reload:
week.update({ recipes: state.recipes });
```

Options: `recipes` (required); `plan` (start from this plan instead of the stored one); `persist` (default `true`); `storageKey` (default `'rb:week-plan'`); `href(recipe)` (link for a planned recipe, default `#/r/<id>`); `showEmptyDays` (default `true`); `title` (default `'Week plan'`); `css`; `onChange(plan)`.

Controller: `getPlan()`, `setPlan(plan)`, `add(recipeId, day)`, `update({ recipes, plan, … })`, `destroy()`.

Event `rb:plan-change`, `detail: { plan, source }`.

A plan is `{ version: 1, items: [{ recipe: '<recipe id>', day: 'mon' … 'sun' | null }] }`; `null` means "this week, any day". The same recipe can be on several days (cook it twice); the shopping list counts that. Recipes that are no longer in the bank are hidden, not deleted from storage.

**"Add to week" from a recipe page.** `addRecipeToWeek(recipeId, day = null)` adds to the stored plan and fires `rb:plan-change` on `document`, so a mounted week plan and shopping list update at once:

```js
button.addEventListener('click', () => addRecipeToWeek(r.id));
```

`readPlan()` and `writePlan(plan)` are exported too (both safe when storage is blocked).

## shopping-list.mjs

```js
import { mount } from '/features/shopping-list.mjs';

const shop = mount(document.querySelector('#shop'), { recipes: state.recipes });
```

By default it follows the stored week plan and re-renders on every `rb:plan-change` (from this tab) and on `storage` events (from other tabs). Pass `plan` to show a fixed set instead, for example "shopping list for these two recipes": `{ plan: { items: [{ recipe: 'a', day: null }, { recipe: 'b', day: null }] }, persist: false }`.

Options: `recipes` (required); `plan`; `persist` (default `true`, ticked items in `'rb:shopping-checked'`); `planKey`; `checkedKey`; `title`; `href(recipeId)`; `copyChecked` (default `false`: ticked items are left out of the copied text); `css`.

Controller: `getList()` (the structure from `shoppingList()` in `lib/plan.mjs`), `getText()`, `update({ recipes, plan })`, `destroy()`.

Events: `rb:shopping-check`, `detail: { checked: [keys] }`; `rb:shopping-copy`, `detail: { text, copied }`. When the clipboard is blocked, the list shows the text in a read-only box to copy by hand.

What it shows: ingredients merged by their `key` and grouped by aisle (fruit and veg, meat and fish, dairy and eggs, bread and wraps, pasta/rice/baking, oils/sauces/tins, spices, drinks, other, and "check the cupboard" for salt, pepper, oil and water). Under each ingredient, every recipe's amount **in the creator's own words**: amounts are never added up or converted, and an unstated amount reads "amount not given". The aisle of a new key comes from the table in `lib/plan.mjs` (`AISLE_KEYS`), then from word rules; add new keys to the table.

## scale.mjs

```js
import { mount } from '/features/scale.mjs';

const scaler = mount(document.querySelector('#scale'), { recipe: r });
```

If the recipe's `serves` is a single plain number (`"4"`, `"10 bowls"`, `"about 12 nuggets"`) it shows − / + servings; otherwise (`null`, `"2 thighs per person"`, two different numbers) it offers ×½ ×1 ×2 ×3.

Options: `recipe` (required); `factor` (default `1`); `list` (default `true`: render the scaled ingredient list; set `false` to render only the control and use the event to update your own list); `factors` (default `[0.5, 1, 2, 3]`); `title`; `css`; `onChange(factor, scaledRecipe)`.

Controller: `getFactor()`, `setFactor(f)`, `getRecipe()` (scaled copy), `update({ recipe, factor })` (a new recipe resets to ×1), `destroy()`.

Event `rb:scale-change`, `detail: { factor, recipe }`: `recipe` is a scaled copy. Each ingredient in it has `amount` (what to show), `originalAmount` (the creator's words), `scaled` (boolean) and `scaleReason` (`scaled`, `same`, `words`, `per-unit` or `unstated`).

Using your own ingredient list: listen for the event (or call `scaleRecipe(recipe, factor)` from `/lib/scale.mjs`) and render each amount with the exported `amountHtml(ingredient, factor)`, which marks scaled amounts (badge plus "creator: …") and amounts kept in words ("not scaled").

What gets scaled: plain numbers and units, including fractions (`1/2`, `½`), mixed numbers (`1 1/2`, `1½`), decimals (`1.5`, `1,5`) and ranges (`2–3`, `1/2–1`, `2 to 3`); count words agree (`1 can` → `2 cans`). Kept as written: words (`a good amount`, `a couple`, `½ a garlic head`), rates (`2 per person`, `20 g per roll`), percentages and pack sizes (`2 x 400g`: only the 2 scales). Steps and nutrition are never changed.

## filters.mjs

```js
import { mount } from '/features/filters.mjs';
import { matchesFilter } from '/lib/filter.mjs';

let extra = {};
mount(document.querySelector('#more-filters'), {
  recipes: state.recipes,
  onChange: (f) => { extra = f; update(); },
});
// in the dashboard's update(): one call covers search, Has all / Has any and these filters
const list = state.recipes.filter((r) => matchesFilter(r, { ...state, ...extra }));
```

The dashboard's own search and *Has all* / *Has any* already run through `matchesFilter` (`lib/catalog.mjs` delegates to `/lib/filter.mjs`), so merging the extra fields into the same object is all that is needed. In the dashboard, `filters-feature.js` mounts one section per filter mount point (`sections: ['without']` and so on) with one shared state, and registers each section with `rb.addFilter`.

Options: `recipes` (required); `filter` (initial; default the stored one); `persist` (default `true`, in `'rb:filters-extra'`); `storageKey`; `sections` (any of `'without'`, `'tags'`, `'nutrition'`; default all three; the summary and **Clear these** cover only these sections' fields); `limit` (chips before "Show all", default 16); `css`; `onChange(filter)`.

Controller: `getFilter()`, `setFilter(filter)`, `update({ recipes, filter })`, `destroy()`.

Event `rb:filter-change`, `detail: { filter }` where `filter` is `{ without: [keys], tags: [tags], minProtein: number | null, maxCalories: number | null }`.

Behaviour: *Without* hides a recipe that lists any of the chosen ingredient keys (exact keys, so it is not an allergy check, and the UI says so). Tags must all be present. The nutrition filters only pass recipes that **state** the value; values are per `nutrition.per` as the creator gives them (per serving, per nugget, per bar), so the panel says how many recipes state macros at all.

## Theming

Set any of these on the mount element or an ancestor. Each falls back to the dashboard's current token (`--accent`, `--line`, …) and then to a plain default, so the modules look right with no setup.

| Property | Used for | Falls back to |
|---|---|---|
| `--rbf-fg` | text | `--ink` |
| `--rbf-muted` | secondary text | `--muted` |
| `--rbf-line` | borders, dividers | `--line` |
| `--rbf-surface` | cards, inputs, buttons | `--surface` |
| `--rbf-accent` | primary button, selected chips, focus ring | `--accent` |
| `--rbf-accent-ink` | text on the accent colour | `--accent-ink` |
| `--rbf-accent-soft` | scaled-amount highlight | `--accent-soft` |
| `--rbf-warn` | "amount not given" | `--warn` |
| `--rbf-radius` | corner radius | `--radius` |
| `--rbf-gap` | spacing unit | `12px` |
| `--rbf-font` | `font` shorthand for the module | inherited |

Class names all start with `rbf-` and are scoped under the module's root class (`.rbf-week`, `.rbf-shop`, `.rbf-scale`, `.rbf-filters`), so they don't collide with the dashboard's styles. Buttons and inputs are at least 44 px tall (chips are 36 px on fine pointers, 44 px on touch).

## Example page wiring

```js
import { mount as mountWeek, addRecipeToWeek } from '/features/week-plan.mjs';
import { mount as mountShop } from '/features/shopping-list.mjs';

// a #/week route: plan on the left, list on the right
view.innerHTML = '<div class="week-layout"><div id="week"></div><div id="shop"></div></div>';
const week = mountWeek(view.querySelector('#week'), { recipes: state.recipes });
const shop = mountShop(view.querySelector('#shop'), { recipes: state.recipes });
// before rendering another route:
week.destroy(); shop.destroy();
```

Call `destroy()` before replacing the element's parent: it removes the `document` and `window` listeners the modules add.
