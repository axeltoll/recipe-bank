# Design round 2

Round 1 rebuilt the dashboard to a written contract. Since then six feature installers were merged into it (filters, scaling, week plan and shopping list, household and budget, packs, editor). This round makes the result one product. Like round 1 it was done by reading: no browser has shown these pages, so every claim below about a width comes from the CSS, the markup and arithmetic. The first browser run (`npm run device-check`, `npm run smoke`) is still owed.

## What round 1 got right

- **The contract.** Tokens, three breakpoints, one shell, three layout types, and a test that recomputes contrast from the stylesheet. Nothing here replaces it.
- **Honesty in the layout.** "Amount not given", the basis of each amount, and the gaps of a partial recipe above the ingredients.
- **The shell.** `html` paints the page, content is capped by padding, so 1920 and 2560 have no unpainted edge.
- **Mount points.** All six features plugged in without touching `app.js`.
- **Cook mode exists**, with a wake lock, a remembered step and shared ingredient ticks.

## What still felt unfinished

Findings are numbered so `DESIGN.md`, and the stylesheet comments can point at them.

### Every width

| # | Finding | Fix |
|---|---|---|
| A1 | **The measure was too long.** `72ch` is 72 times the width of "0". In Inter a digit is about 0.63 em and average prose about 0.52 em, so 72ch holds about 87 characters. The device check counts average characters and fails above 85. | Running text uses `--measure-text: 60ch` (about 73 characters in Inter, 69 in Segoe UI). `--measure` stays defined because `test/design.test.mjs` pins it. |
| A2 | **Feature pages had no measure at all.** The packs intro ran to about 160 characters a line at 1280, the editor lede to about 117, household and budget notes to about 100 at 1920, the shopping-list note to 88 at 768. | Every paragraph in a feature module is capped with the same token. |
| A3 | **The modules looked like guests.** Four colour vocabularies with their own fallbacks (one of them blue-grey), square-ish buttons at 36 px, system headings, three different focus rings, and errors in three colours. | Each module stylesheet now reads the dashboard tokens (through its own custom properties, so it still works standalone), with the dashboard's button, chip, panel, heading and focus styles. |
| A4 | **Contrast below 4.5:1 that the test did not see**, because it came from opacity or from using a fill colour as text: empty days at 75% opacity (3.7:1), ticked shopping items at 60% (4.4:1), chip counts at 70%, `--accent` as text on `--accent-soft` (4.36:1) and on `--bg` (4.81:1), and the primary button brightened on hover (4.57:1). | No text is dimmed with opacity. Accent-coloured text is `--accent-text`. Hover uses a new token, `--accent-strong` (6.4:1 with `--accent-ink`). |
| A5 | **States differed per module**: "Nothing planned" at 75% opacity, a dashed box in one place, plain grey text in another; errors in warn or danger; "Loading recipes…" as text. | One empty state (muted text, dashed inset when it stands alone), one status line, one error block (`--danger` on `--danger-soft`), a skeleton for loading. |
| A6 | **Icons were partly text glyphs** and one button used "+" for two different actions. | Seven icons added to the inline set (`timer`, `auto`, `grid`, `rows`, `edit`, `week`, `stop`); "Add to week" has its own. |

### Phone (390)

| # | Finding | Fix |
|---|---|---|
| P1 | **The header wrapped to three rows** (brand, then the actions, then the nav): brand 165 + actions 186 + gap is 363 px in a 358 px row. With the nav it took about 150 px of an 844 px screen, and it was sticky. | "Add video" is an icon button on phones. The brand row scrolls away and only the 48 px nav row sticks. |
| P2 | **The sticky action bar wrapped to two rows** (Start cooking, Copy list, Edit, Add to week are 529 px): 124 px of screen, permanently. | One row: Start cooking, then Copy list and Add to week as 44 px icon buttons. Edit moved to the top of the page beside the back link. |
| P3 | **Tap targets under 44 px** that the device check would report: the card title link (the link box is the text, about 24 px; the stretched `::after` does not count), queue titles, the creator link, links in feature notes, planned recipes and "For …" links on the plan page, `summary` in household and budget, the extra filter chips (36 px unless the pointer is coarse), "This link can't be embedded". | Each gets a 44 px box: padding with a negative margin for the card and queue links, so the layout does not move; `inline-flex` with a minimum height for text links. |
| P4 | **Sideways scroll waiting to happen**: the recipe `<select>` on the plan page is as wide as its longest option; an opened JSON preview in the editor sets the page width. | `width: 100%` and `min-width: 0` on the selects; `min-width: 0` on the editor's grid children. |
| P5 | **Each card grew a full-width "Add to week" row**, making rows about 190 px tall. | The card action is an icon button on the meta line. |
| P6 | **Cook mode put Ingredients and Exit at the top**, out of thumb reach, and the wake lock could not be switched off. | Ingredients and "Watch this step" sit in a row directly above Back and Next. The top bar holds a "Keep screen on" switch and Exit. |

### Tablet (768)

| # | Finding | Fix |
|---|---|---|
| T1 | **The header did not fit on one row** once four sections were registered: brand 165 + nav 372 + stats 190 + actions 186 is over 900 px in 720. It wrapped unpredictably. | Tablet keeps the phone header (nav on its own row, collapsing); the count moves in beside the brand. The nav goes inline from desktop. |
| T2 | Sticky offsets assumed a one-row header. | One token, `--head-h`, is the height of the part of the header that stays: 48 px below desktop, 64 px from desktop. |

### Desktop (1280)

| # | Finding | Fix |
|---|---|---|
| D1 | **Steps were the narrowest column** on the recipe page: 340 player + 400 ingredients left 412 px, about 35 characters a line for the main text. | Player 300, ingredients 300–360: steps get about 490 px. |
| D2 | **Packs was one full-width column** with rows 1184 px wide. | Share and Import sit side by side. |
| D3 | The editor form was centred at 960 px under a left-aligned page head. | The whole editor page is capped and centred together. |

### Wide (1920, 2560)

| # | Finding | Fix |
|---|---|---|
| W1 | Step lines reached 83 characters at 1920. | A1. |
| W2 | Feature pages stretched paragraphs across 868 px columns. | A2. |

Nothing was found against the painted edge: `html` carries `--bg` and no shell element has a `max-width`.

## The palette

The brief says muted, ok and warn were reported just under 4.5:1. That is the pre-redesign palette (AUDIT C1, C4, C5). Recomputed from today's values:

| Pair | Light | Dark |
|---|---|---|
| `--muted` on `--bg` / `--surface` / `--surface-2` / `--surface-3` | 6.14 / 6.61 / 5.64 / 5.02 | 7.08 / 6.57 / 6.00 / 5.25 |
| `--ok` on `--ok-soft` | 5.52 | 7.36 |
| `--warn` on `--warn-soft` | 6.36 | 8+ |

The thinnest margin is `--muted` on `--surface-3`. Two things were done:

1. **The contract now forbids that pairing** (`--surface-3` is for skeletons and tracks; text on it is `--ink-2`), which nothing used anyway. The floor for muted text becomes 5.6:1.
2. **A margin is enforced by test**: `test/design-round2.test.mjs` requires 5:1 for the muted, ok and warn pairs in both themes, so a later palette change cannot slide back to the edge.

Darker values were worked out (`--muted: #5e544c` gives 5.6 on `--surface-3`, `--ok: #1a5c36` gives 6.8, `--info: #254f8f` gives 6.7) but **not applied**: `test/site.test.mjs` requires the website's palette to equal the dashboard's, so they need a change to the website's stylesheet and that test at the same time. They are on the follow-up list.

## Plan, in the order it was done

1. Contract first: `DESIGN.md` gets the new tokens, the collapsing header, the action bar, the measure, the state patterns, cook mode, timers, the list view and the theme switch.
2. `public/styles.css`: the findings above.
3. `public/features/*.css`: eight stylesheets rewritten on the tokens (A3, A4, A5, P3, P4).
4. Recipe page and cook mode for a phone in a kitchen (P2, P6): larger step type, timers on steps that state a duration, the wake switch, a fuller print sheet.
5. Motion and polish: staggered cards, reduced motion that also removes delays, `prefers-contrast` and forced-colours rules, a skeleton that matches the route being loaded.
6. Stretch: system / light / dark theme button, compact list view, kitchen timers.

## Not in this round

- Nothing in `lib/` beyond one added pure function (`durations` in `lib/format.mjs`), nothing in `server.mjs`, `scripts/`, `agent/` or the service worker.
- The feature modules' markup is unchanged apart from three class and icon edits; their tests match the markup.
- `docs/screenshot.png` still shows the first design. It needs a browser.
