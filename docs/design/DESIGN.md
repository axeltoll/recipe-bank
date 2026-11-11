# Recipe Bank design contract

The visual and layout contract for the dashboard in `public/`. `public/styles.css` implements it; when the two disagree, fix one of them in the same change. The reasons behind it are in [AUDIT.md](AUDIT.md). Extension points for feature modules are in [MOUNT-POINTS.md](MOUNT-POINTS.md).

## Principles

1. **A kitchen tool first.** Read at arm's length, touched with a wet thumb. Steps and amounts are the largest body text on the page.
2. **Honest.** What the video did not say is shown as plainly as what it did: "amount not given", and the gaps of a partial recipe above the ingredients, never below the fold.
3. **Warm and quiet.** Paper, ink and one terracotta accent. Colour marks state and the one primary action, nothing else.
4. **Three designs, one shell.** Phone, tablet and desktop are each laid out on purpose, inside one header and one page surface.
5. **No dependencies.** Vanilla ES modules and one stylesheet. The only third-party request is the Google Fonts stylesheet the repo already used; the fallbacks are system fonts.

## Tokens

All tokens are custom properties on `:root` in `public/styles.css`. Components use tokens only: no raw colours, sizes or durations in component rules (the video stage, which is always black, is the one exception and has its own token).

### Colour

The theme follows the system (`prefers-color-scheme`). The header toggle sets `data-theme="light"` or `"dark"` on `<html>` and remembers it in `localStorage` (`rb:theme`). CSS needs the dark values in two rules (the media query and the attribute); `test/design.test.mjs` fails if the two lists differ, and checks every pair in the contrast table below against the real values.

| Token | Light | Dark | Use |
|---|---|---|---|
| `--bg` | `#faf6f0` | `#14110e` | Page canvas, painted on `html` |
| `--surface` | `#ffffff` | `#1d1915` | Cards, panels, dialogs, header |
| `--surface-2` | `#f3ece2` | `#26211c` | Insets: tags, facts, notes |
| `--surface-3` | `#e9dfd1` | `#322b24` | Pressed and hover fills, skeletons |
| `--ink` | `#1f1a16` | `#f4eee7` | Text |
| `--ink-2` | `#4a423b` | `#d6cdc3` | Secondary text |
| `--muted` | `#655b53` | `#a89d92` | Tertiary text, never under 12 px |
| `--line` | `#e6ddd1` | `#3a322b` | Decorative dividers |
| `--line-strong` | `#8f8378` | `#7d7166` | Boundaries of inputs and toggles (3:1) |
| `--accent` | `#c2410c` | `#f08a4b` | Primary button fill, selected chip fill |
| `--accent-ink` | `#ffffff` | `#1a0f08` | Text on `--accent` |
| `--accent-text` | `#9a3412` | `#f5a06a` | Accent-coloured text and icons |
| `--accent-soft` | `#fde8d7` | `#3a2416` | Step numbers, matching ingredients |
| `--ok` / `--ok-soft` | `#1f6b3f` / `#dff1e5` | `#7fd09c` / `#1c3325` | Done, detected |
| `--warn` / `--warn-soft` | `#7a4d00` / `#fbefd2` | `#f0c060` / `#3a2e14` | Partial recipe, gaps |
| `--info` / `--info-soft` | `#2b5fa8` / `#e1ebf8` | `#8db8f0` / `#1b2a40` | Queue states |
| `--danger` / `--danger-soft` | `#b3261e` / `#fbe4e1` | `#ff8a80` / `#3d1b18` | Errors, failed analysis |
| `--focus` | `#1f1a16` | `#f4eee7` | Focus ring (with a `--bg` halo) |
| `--stage` / `--stage-ink` | `#0d0b09` / `#d6cdc3` | same | Behind the video, and text on it |
| `--scrim` | `rgb(20 12 6 / .5)` | `rgb(0 0 0 / .6)` | Behind sheets and dialogs |

Contrast, calculated from the hex values (WCAG 2 relative luminance). Text pairs meet AA (4.5:1); control boundaries meet 3:1.

| Pair | Light | Dark |
|---|---|---|
| `--muted` on `--bg` | 6.1 | 7.0 |
| `--muted` on `--surface-2` | 5.6 | 6.0 |
| `--muted` on `--surface-3` | 5.0 | 5.2 |
| `--accent-ink` on `--accent` | 5.2 | 7.5 |
| `--accent-text` on `--accent-soft` | 6.2 | 7.0 |
| `--accent-text` on `--bg` | 6.7 | 8+ |
| `--ok` on `--ok-soft` | 5.5 | 7+ |
| `--warn` on `--warn-soft` | 6.4 | 7+ |
| `--info` on `--info-soft` | 5.3 | 7+ |
| `--danger` on `--surface` | 6.5 | 7+ |
| `--line-strong` on `--bg` (boundary) | 3.4 | 3.9 |

The figures were calculated by hand to one decimal ("7+" and "8+" mean comfortably above 7); the test suite recomputes them from the stylesheet and enforces the thresholds. State is never colour alone: every badge has a text label.

### Type

Sizes are in `rem`, so the reader's browser font size scales everything. The root stays at the browser default (16 px).

| Token | Size | Use |
|---|---|---|
| `--text-xs` | 0.75rem (12) | Badges, counts. Nothing smaller exists. |
| `--text-sm` | 0.875rem (14) | Meta lines, tags, hints |
| `--text-md` | 1rem (16) | Body, inputs (never smaller: iOS zooms below 16 px) |
| `--text-lg` | 1.125rem (18) | Steps, ingredient names, summaries |
| `--text-xl` | 1.375rem (22) | Panel and card titles |
| `--text-2xl` | 1.75rem (28) | Section titles, nutrition numbers |
| `--text-3xl` | clamp(2rem, 1.5rem + 2.2vw, 3rem) | Page titles |
| `--text-cook` | clamp(1.5rem, 1rem + 2.4vw, 2.75rem) | The step in cook mode |

- `--font-display`: Fraunces, then Georgia and system serifs. Titles and numbers only.
- `--font-body`: Inter, then the system UI font.
- Line height: `--lh-tight` 1.15 (titles), `--lh-snug` 1.35 (cards, labels), `--lh-body` 1.6 (reading).
- **Measure:** running text is capped with `--measure: 72ch` (steps, summaries, notes, gaps). Cap the text block, not its container; extra width goes to columns.
- Heading order is strict: one `h1` per view, `h2` for sections, `h3` inside them.

### Spacing, radius, elevation, motion, layers

| Group | Tokens |
|---|---|
| Spacing (4 px scale) | `--s-1` 4, `--s-2` 8, `--s-3` 12, `--s-4` 16, `--s-5` 24, `--s-6` 32, `--s-7` 48, `--s-8` 64 |
| Radius | `--r-sm` 8 (inputs, small buttons), `--r-md` 12 (buttons, insets), `--r-lg` 18 (cards, panels, dialogs), `--r-pill` 999 |
| Elevation | `--shadow-1` resting card, `--shadow-2` raised or hovered, `--shadow-3` sheet and dialog |
| Motion | `--dur-1` 120ms (press), `--dur-2` 200ms (hover, toast), `--dur-3` 320ms (view, sheet); `--ease` cubic-bezier(.2,.8,.2,1) |
| Layers | `--z-bar` 20 (header, sticky action bar), `--z-sheet` 40 (filter sheet), `--z-toast` 60 |
| Targets | `--tap` 44px (minimum size of every control) |
| Shell | `--gutter` (16 / 24 / 32 / 48 by breakpoint), `--content-max` 1760px, `--bar-h` (56 phone, 64 above) |

## Layout contract

### Breakpoints

Declared once, here. CSS cannot read a custom property in a media query, so the numbers appear literally in `styles.css` (mobile-first `min-width` queries only) and once in JS as `BREAKPOINTS` in `lib/nav.mjs`.

| Name | From | Checked at |
|---|---|---|
| phone | 0 | 390 × 844 |
| tablet | 768 px | 768 × 1024 |
| desktop | 1280 px | 1280 × 800 |
| wide | 1920 px | 1920 × 1080, 2560 × 1440 |

### Shell

One shell for every route, at every width:

- `html` paints `--bg`. `body` is transparent. Nothing in the shell has a `max-width`.
- `header.topbar`: sticky, full-bleed, painted edge to edge. Brand, section nav, stats, theme toggle, **Add video**.
- `main#view`: the content pane. It caps content with padding, not with a width: `padding-inline: max(var(--gutter), (100% - var(--content-max)) / 2)`.
- `footer.footer`: full-bleed; holds the offline switch.
- **Navigation:** one pattern at all widths, the `nav#nav` in the header. It is hidden while "Recipes" is the only destination and appears when a feature registers a route. On a phone it wraps to a second header row that scrolls sideways inside itself; from tablet up it sits inline after the brand.
- Safe areas: the viewport meta has `viewport-fit=cover`; the header, footer, sticky bars, sheet and toast pad with `env(safe-area-inset-*)`.

A route never changes the shell. It picks a **layout type**, which `app.js` writes to `main[data-layout]`:

| Type | Routes | Content geometry |
|---|---|---|
| `list` | `#/` and list-like feature routes | Head, filters, card grid |
| `detail` | `#/r/<id>`, `#/q/<queueId>`, detail-like feature routes | Media, head, panels |
| `message` | loading, error, not found | One centred block, measure-capped |

The set is closed. A feature route must name one of the three.

### `list` (home)

| Width | Design |
|---|---|
| phone | One column. Title, then a search field and a **Filters** button on one row. Filters open as a bottom sheet (scrim, focus kept inside, Escape closes, a "Show N recipes" button to close). Selected filters show as removable chips under the search. Cards are full-width **rows**: square thumbnail left, text right. |
| tablet | Search and Filters button on one row; the filter panel opens **inline** above the grid as a multi-column panel. Cards become vertical tiles in a 3-column grid. |
| desktop | Two panes: a sticky **filter rail** (300 px, always open, scrolls inside itself) and the grid beside it, 3 columns. The Filters button is gone. |
| wide | Same two panes (rail 320 px); the grid adds columns: 5 at 1920. Above `--content-max` (1760 px) the content stays centred on the painted page, so 2560 shows the 1920 design with wider margins. Card width stays between 220 and about 340 px. |

The queue ("In the queue") is a section under the grid: rows on a phone, a 2-up grid from tablet, 3-up on wide.

### `detail` (recipe, queued video)

Areas: `media` (the embed), `head` (status, title, creator, summary, tags, facts, actions, and the gaps of a partial recipe), `ingredients`, `steps`, `more` (nutrition, notes, source).

| Width | Design |
|---|---|
| phone | One column: head, media, ingredients, steps, more. The player is capped at 62svh so the title and the first ingredients stay near. A **sticky action bar** at the bottom holds the primary action, **Start cooking**, and **Copy list**; content has matching bottom padding. |
| tablet | Two columns: the player in a sticky 280 px column, everything else beside it. Actions sit inline in the head. |
| desktop | Three areas: sticky player (340 px); the head spans the rest; under it **ingredients (sticky, own scroll) beside steps**, so amounts stay in view while you read the method. |
| wide | Same areas with wider panes (400 px player, 440 px ingredients). Step text keeps the 72ch measure. |

The queued-video page uses the same areas with `media`, `head` and one status panel.

### Cook mode

A full-window `<dialog>` over the recipe: one step at a time in `--text-cook`, the component name and "Step 4 of 20", **Back** and **Next** as full-height buttons in thumb reach, an ingredients checklist (side pane from desktop, a toggled panel below that), and a button to watch the step in the video. It holds a screen wake lock while open (re-acquired when the tab becomes visible again) and says so; where the browser has no Wake Lock API it says that instead. The step is remembered per recipe.

## Components

- **Buttons** `.btn`: 44 px min height everywhere (no small variant on touch). Variants: `-primary` (one per view), `-quiet`, `-danger`. `.icon-btn` is 44 × 44 with an `aria-label`.
- **Chips** `.chip`: toggle buttons with `aria-pressed`, 44 px tall on coarse pointers and phones, 36 px with a fine pointer from desktop. 8 px apart.
- **Segmented** `.segmented`: the Has all / Has any switch. The exclude ("Without") filter gets its own group right under the ingredient chips (see MOUNT-POINTS).
- **Card** `.card`: an `article` whose title link is stretched over the whole card (the link's name is the title only). A slot for feature actions sits above the stretched link.
- **Badge** `.badge`: text label plus a dot. Cards show a badge only when it matters (Partial); the recipe page always states the status.
- **Panel** `.panel`: surface, `--r-lg`, `--shadow-1`.
- **Callout** `.callout`: `-gaps` (warn) and `-notes` (inset).
- **Empty / error / loading** `.state`: icon, one sentence, one action. Loading uses skeleton cards that match the grid.
- **Toast**: bottom centre, above the sticky action bar, `role="status"`.

## States

| State | Where | Design |
|---|---|---|
| Loading | first paint | Skeleton header and cards, already in `index.html` so they show before the script runs |
| Load error | fetch failed | Message, **Try again** button; the `npm start` hint only on the local server |
| Empty bank | no recipes | Invitation to add the first video |
| No matches | filters or search exclude everything | Says which filters are on, **Clear filters** button |
| Not found | unknown recipe or queue id | Message and a link home |
| Partial recipe | `status: "partial"` | Badge on card and page; gaps callout in the head, above the ingredients |
| Amount not given | `basis: "unstated"` | Italic muted text in the amount column, never an invented number |
| Thumbnail missing | no stable thumbnail, offline, or image error | Drawn placeholder with the platform name |
| Queue | `queued`, `analyzing`, `failed`, `done` | Labelled badge and a three-step progress line on the queue page |
| Pending | add, remove | Button disabled with `aria-busy` and a changed label |

## Motion

- Views fade and rise 8 px on route change (`--dur-3`). Cards lift on hover (inside `@media (hover: hover)`), press scales to 0.98. The sheet slides up. The toast fades.
- `prefers-reduced-motion: reduce` sets every animation and transition to near-zero and JS scrolls with `behavior: 'auto'`. State changes still happen.

## Accessibility

- Visible focus on everything: a 2 px `--focus` ring with a 2 px `--bg` halo, drawn with `outline` and `box-shadow` so it never changes the element's shape.
- A skip link moves focus to `main`. Every route change moves focus to `main` and updates `document.title`.
- Result counts are announced through one polite live region.
- Tap targets are at least 44 × 44 px on phones and coarse pointers, 8 px apart.
- Keyboard: `/` focuses search; arrow keys, Home and End move through the card grid; Up and Down move between step timestamps; in cook mode Left and Right change step and Escape leaves.
- Nothing depends on hover or on a `title` attribute. The basis of an amount is visible text for screen readers and a visible legend.
- Strings from data files and oEmbed are escaped with `esc()` before they reach `innerHTML`.

## Print

`@media print` prints a recipe as a clean sheet: title, creator, the video URL as text, ingredients in two columns with empty boxes, numbered steps, gaps and notes. The shell, player, buttons and feature mounts are hidden.

## Offline (behind a switch)

`public/sw.js` is a cache-first service worker for the app shell and the recipe data. It is **off by default**. The footer switch "Keep recipes for offline use" registers it and stores `rb:offline`; switching it off unregisters the worker and deletes its caches. Videos and thumbnails are not cached.
