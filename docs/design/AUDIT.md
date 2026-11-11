# Dashboard audit

An audit of `public/` as it stood before the redesign (`index.html`, `styles.css`, `app.js`; routes `#/`, `#/r/<id>`, `#/q/<queueId>`). It was done by reading the code, not in a browser. Contrast ratios are calculated by hand from the hex values with the WCAG relative-luminance formula. Line numbers refer to the files before the rebuild.

The short version: the dashboard works and has a consistent warm look, but it is one desktop layout that shrinks. On a phone in a kitchen the targets are small, the type is small, several colour pairs miss AA, and there is no loading state, no cook mode and no place for the planned features to attach.

## Layout

| # | Finding | Where |
|---|---|---|
| L1 | Two ad-hoc breakpoints (900 and 560 px, `max-width`) and a third one in JS (`matchMedia('(min-width: 901px)')`). They are not shared tokens and none is a tablet or wide design. | `styles.css:309-332`, `app.js:149,363` |
| L2 | The phone layout is the desktop layout squeezed: the grid becomes two ~175 px cards with the ingredient chips hidden, so a card shows a cropped title and little else. | `styles.css:325-328` |
| L3 | At 768 px the page uses the phone structure (single column, collapsed filter). At 1280 it is the same two columns as at 901. At 1920 and above the content stops at 1280 px and nothing is added: no extra columns, a lot of empty page. | `styles.css:75,111,117` |
| L4 | The recipe page is two columns at every width above 900 px. On a wide screen the ingredients sit far above the steps they belong to, and you scroll back and forth while cooking. | `styles.css:211` |
| L5 | The header and `main` compute their gutters from `100vw`, which includes the scrollbar, and `body` hides the resulting overflow with `overflow-x: hidden`. That also hides any real overflow bug. | `styles.css:62,75,111` |
| L6 | Only `body` is painted. Overscroll and the moment before the app mounts show the browser canvas. | `styles.css:57-63` |
| L7 | No safe-area handling: the viewport meta lacks `viewport-fit=cover`, and the sticky header and toast ignore `env(safe-area-inset-*)`. | `index.html:5` |
| L8 | The summary and intro are capped (60–65ch), but step text and notes are not: on a 1280 px window a step line runs past 100 characters. | `styles.css:259` |
| L9 | The queue lives only as a section under the grid, and `#/q/<id>` reuses the recipe layout with one panel. There is no sense of where a queued video is in the process. | `app.js:391-415` |

## Type

| # | Finding | Where |
|---|---|---|
| T1 | Body text is 15 px and set in `px`, so it ignores the reader's browser font size. Kitchen reading distance wants 16–18 px for steps. | `styles.css:61` |
| T2 | A lot of text is 11–13 px: chip counts 11 px, badges 11 px, card meta 12 px, notes 12 px, the amounts legend 12 px, the source line 12 px. | `styles.css:138,174,177,181,244,248,280` |
| T3 | There is no type scale. Sizes are written per rule (11, 12, 13, 14, 15, 16, 18, 20, 22 px plus two `clamp()`s). | throughout |
| T4 | Inputs inherit 15 px. Below 16 px iOS Safari zooms the page on focus and does not zoom back. | `styles.css:65,127,293` |
| T5 | The panel `h3` (component names) is a 12 px uppercase accent label. It is the main way to find your place in a six-part recipe and is the smallest text in the panel. | `styles.css:235` |
| T6 | Heading levels skip: the home page goes `h1` → `h2` (filter labels "Search", "Ingredients") → `h2` "Recipes" → `h3` cards, and the filter labels are headings only for styling. | `app.js:117,122` |

## Colour and contrast

Calculated ratios (AA needs 4.5:1 for text, 3:1 for control boundaries):

| # | Pair | Ratio | Verdict |
|---|---|---|---|
| C1 | `--muted` #7a6f66 on `--bg` #f8f4ee (all secondary text) | 4.46 | fails, and it is used at 11–13 px |
| C2 | `--muted` on `--surface-2` #f2ece3 (nutrition labels, card chips) | about 4.2 | fails |
| C3 | `--accent` #c2410c on `--accent-soft` #fde8d7 (step numbers, matching chips) | 4.37 | fails |
| C4 | `--ok` #2f7d4f on `--ok-soft` #dff1e5 ("Full recipe" badge) | 4.29 | fails |
| C5 | `--warn` #9a6400 on `--warn-soft` #fbefd2 ("Partial recipe" badge, gaps heading) | 4.38 | fails |
| C6 | `--line` #e6ddd1 as the only boundary of inputs, chips and the mode switch on `--bg` | about 1.2 | fails 3:1 for controls |
| C7 | White on `--accent` (primary button) | 5.18 | passes |
| C8 | `--info` #2b5fa8 on `--info-soft` | 5.28 | passes |

Other colour findings:

- C9. The dark palette is written twice (once in the media query, once for `[data-theme='dark']`), so the two can drift. Nothing sets `data-theme`, so there is no way to choose a theme.
- C10. Raw colours bypass the tokens: `#c0262d` for form errors (no dark value), `#bbb` and `#000` in the player fallback, `rgb(0 0 0 / 0.6)` on the play mark.
- C11. Status is shown by colour plus text, which is right. But every card carries a badge, so the one that matters ("Partial") does not stand out.

## Spacing and shape

- S1. No spacing scale. Paddings and gaps use 2, 3, 4, 6, 8, 9, 10, 12, 14, 16, 18, 20, 22, 24, 28, 36, 40 px.
- S2. One radius token (`14px`) next to hard-coded 6, 7, 8, 10, 12, 18 px and `999px`.
- S3. One shadow token used for cards, panels and the selected segment alike; the dialog has its own literal shadow. There is no elevation order.
- S4. Inline styles in markup (`style="margin-top:10px"`, the player fallback) and four `!important` overrides to undo panel heading styles inside callouts.

## Touch targets

At 390 px almost every control is under 44 px:

| Control | Size |
|---|---|
| Ingredient chips | 30 px high |
| Has all / Has any | 30 px high |
| `.btn-sm` (Clear, Show all, Copy shopping list, Watch, Copy request, Remove) | 32 px high |
| Timestamp button on a step | about 22 px high |
| Ingredient checkbox | 18 px box; the row label is about 40 px |
| Back link | about 22 px high |
| Player links | text height only |
| Filter `summary` row | about 46 px (passes) |

Neighbouring chips are 6 px apart and queue actions 4 px apart (8 px is the minimum).

## States

- ST1. No loading state. `#view` is empty until both fetches finish.
- ST2. One error state, and it has no retry. The copy tells the reader to run `npm start`, which is right for the local server only.
- ST3. One empty state for the grid, and its copy is wrong when only the search has no hits ("No recipe has all of those"). There is no empty state for a bank with no recipes.
- ST4. `Remove` and `Add to queue` give no pending feedback beyond a disabled button; a failed `DELETE` shows a toast but a network error is an unhandled rejection.
- ST5. A queue entry with status `failed` (allowed by the validator) is labelled "Queued".
- ST6. No hover/pressed distinction on chips and the mode switch; hover styles are not behind `@media (hover: hover)`, so they stick after a tap.
- ST7. Missing or failed thumbnails (TikTok and Instagram have none) leave a blank block with a play mark.
- ST8. The clipboard fallback is `prompt()`.
- ST9. `decodeURIComponent` on a malformed hash throws and leaves the page blank.

## Motion

- M1. Three motions exist: card lift, toast, badge pulse. Durations and easings are literals.
- M2. Route changes swap `innerHTML` with a jump to the top; returning to the list loses the scroll position.
- M3. Reduced motion is honoured with a blanket `* { transition: none; animation: none }`, which is fine, but `scrollIntoView({behavior:'smooth'})` in JS ignores the preference.

## Accessibility

- A1. The partial-recipe gaps sit in the last panel, under the notes. A reader finds out the method is missing after scrolling past ingredients and steps.
- A2. `main` takes focus on the recipe route only; home and queue routes leave focus where it was. There is no skip link.
- A3. The filter result count is not announced (`#match-count` has no live region), while `#stats` is `aria-live` and re-announces on every queue change.
- A4. Timestamp buttons are inside the step `<p>`, and there is no keyboard path through steps or the grid beyond Tab.
- A5. The focus ring forces `border-radius: 6px` on the focused element, which changes the shape of pills and cards, and uses `--accent`, which is under 3:1 against `--accent-soft`.
- A6. The `<iframe>` title is "Recipe video" for every recipe.
- A7. `title` attributes carry information that touch and keyboard users cannot reach (amount basis, the Telegram hint).
- A8. The card is one big link whose accessible name is the whole card text.

## Structure and extensibility

- X1. One 500-line module renders everything with template strings and re-queries the DOM for handlers on each render. Pure logic (matching, shopping list, time formatting) is mixed with DOM code, so none of it is tested.
- X2. No extension points. The roadmap's week plan, combined shopping list, serving scaling, exclude filter, tag and nutrition filters would each have to edit `app.js` and `styles.css`.
- X3. No cook mode, no print styles, no offline support.

## What already works and is kept

- The warm paper-and-terracotta identity, the Fraunces and Inter pairing, and the plain, honest copy.
- Amounts in the creator's words with "amount not given", and the basis of each amount.
- "Play from here" timestamps that reload the embed at the right second.
- `esc()` on every string from data files and oEmbed.
- Browser storage as a convenience only, each access in `try/catch`.
- Zero dependencies and the static build (`data-static="1"`).
