# Recipe Bank design contract

The visual and layout contract for the dashboard in `public/`. `public/styles.css` implements it; when the two disagree, fix one of them in the same change. The reasons behind it are in [AUDIT.md](AUDIT.md) (round 1) and [ROUND2.md](ROUND2.md) (round 2, after the feature modules were merged). Extension points for feature modules are in [MOUNT-POINTS.md](MOUNT-POINTS.md).

## Principles

1. **A kitchen tool first.** Read at arm's length, touched with a wet thumb. Steps and amounts are the largest body text on the page, and what you press while cooking is in the bottom third of a phone.
2. **Honest.** What the video did not say is shown as plainly as what it did: "amount not given", and the gaps of a partial recipe above the ingredients, never below the fold.
3. **Warm and quiet.** Paper, ink and one terracotta accent. Colour marks state and the one primary action, nothing else.
4. **Three designs, one shell.** Phone, tablet and desktop are each laid out on purpose, inside one header and one page surface.
5. **One product.** A feature module looks like the dashboard: the same buttons, chips, panels, headings, focus ring, and the same empty, loading and error states.
6. **No dependencies.** Vanilla ES modules and one stylesheet. The only third-party request is the Google Fonts stylesheet the repo already used; the fallbacks are system fonts. Icons are inline SVG.

## Tokens

All tokens are custom properties on `:root` in `public/styles.css`. Components use tokens only: no raw colours, sizes or durations in component rules (the video stage, which is always black, is the one exception and has its own token).

### Colour

The theme follows the system (`prefers-color-scheme`) until the reader chooses one. The header's theme button steps through **same as your device, light, dark**; light and dark set `data-theme` on `<html>` and are remembered in `localStorage` (`rb:theme`), and "same as your device" removes both. CSS needs the dark values in two rules (the media query and the attribute); `test/design.test.mjs` fails if the two lists differ, and checks every pair in the contrast table below against the real values.

| Token | Light | Dark | Use |
|---|---|---|---|
| `--bg` | `#faf6f0` | `#14110e` | Page canvas, painted on `html` |
| `--surface` | `#ffffff` | `#1d1915` | Cards, panels, dialogs, header |
| `--surface-2` | `#f3ece2` | `#26211c` | Insets: tags, facts, notes; hover fills |
| `--surface-3` | `#e9dfd1` | `#322b24` | Skeletons and tracks only. No muted text on it. |
| `--ink` | `#1f1a16` | `#f4eee7` | Text |
| `--ink-2` | `#4a423b` | `#d6cdc3` | Secondary text |
| `--muted` | `#655b53` | `#a89d92` | Tertiary text, never under 12 px, never on `--surface-3` |
| `--line` | `#e6ddd1` | `#3a322b` | Decorative dividers, panel edges |
| `--line-strong` | `#8f8378` | `#7d7166` | Boundaries of inputs and toggles (3:1) |
| `--accent` | `#c2410c` | `#f08a4b` | Primary button fill, selected chip fill. A fill, never a text colour. |
| `--accent-strong` | `#a83a0b` | `#f5a06a` | The same fills on hover |
| `--accent-ink` | `#ffffff` | `#1a0f08` | Text on `--accent` and `--accent-strong` |
| `--accent-text` | `#9a3412` | `#f5a06a` | Accent-coloured text and icons |
| `--accent-soft` | `#fde8d7` | `#3a2416` | Step numbers, matching ingredients, a running timer |
| `--ok` / `--ok-soft` | `#1f6b3f` / `#dff1e5` | `#7fd09c` / `#1c3325` | Done, detected, a finished timer |
| `--warn` / `--warn-soft` | `#7a4d00` / `#fbefd2` | `#f0c060` / `#3a2e14` | Partial recipe, gaps, "check" |
| `--info` / `--info-soft` | `#2b5fa8` / `#e1ebf8` | `#8db8f0` / `#1b2a40` | Queue states |
| `--danger` / `--danger-soft` | `#b3261e` / `#fbe4e1` | `#ff8a80` / `#3d1b18` | Errors, failed analysis |
| `--focus` | `#1f1a16` | `#f4eee7` | Focus ring (with a `--bg` halo) |
| `--stage` / `--stage-ink` | `#0d0b09` / `#d6cdc3` | same | Behind the video, and text on it |
| `--scrim` | `rgb(20 12 6 / .5)` | `rgb(0 0 0 / .6)` | Behind sheets and dialogs |

The website in `site/` uses the same values for `--bg` to `--info-soft`, and `test/site.test.mjs` fails if the two palettes differ. Change them together.

Contrast, calculated from the hex values (WCAG 2 relative luminance). Text pairs meet AA (4.5:1); control boundaries meet 3:1.

| Pair | Light | Dark |
|---|---|---|
| `--muted` on `--bg` | 6.1 | 7.1 |
| `--muted` on `--surface` | 6.6 | 6.6 |
| `--muted` on `--surface-2` | 5.6 | 6.0 |
| `--accent-ink` on `--accent` | 5.2 | 7.5 |
| `--accent-ink` on `--accent-strong` | 6.4 | 9.1 |
| `--accent-text` on `--accent-soft` | 6.2 | 7.0 |
| `--accent-text` on `--bg` | 6.7 | 8+ |
| `--ok` on `--ok-soft` | 5.5 | 7.4 |
| `--warn` on `--warn-soft` | 6.4 | 7.9 |
| `--info` on `--info-soft` | 5.3 | 7+ |
| `--danger` on `--surface` | 6.5 | 7+ |
| `--danger` on `--danger-soft` | 5.4 | 7+ |
| `--line-strong` on `--bg` (boundary) | 3.4 | 3.9 |

Rules that keep the table true:

- **Margin.** Muted, ok and warn text keeps at least 5:1 in both themes; `test/design-round2.test.mjs` enforces it. (`--muted` on `--surface-3` is 5.0 light and 5.2 dark, the thinnest pair in the palette, which is why that pairing is not allowed.)
- **No dimming.** Text is never made quieter with `opacity`; use `--muted`. Only disabled controls and animations change opacity. Opacity on text is how a passing palette ends up below 4.5:1 without any test noticing.
- **Fill or text.** `--accent` is a fill. As text it is 4.4:1 on `--accent-soft`; accent-coloured text is `--accent-text`.
- State is never colour alone: every badge has a text label.
- `prefers-contrast: more` lifts `--muted` to `--ink-2`, `--line` to `--line-strong` and `--accent-text` to `--ink`. `forced-colors: active` gives controls a system-colour border.

### Type

Sizes are in `rem`, so the reader's browser font size scales everything. The root stays at the browser default (16 px).

| Token | Size | Use |
|---|---|---|
| `--text-xs` | 0.75rem (12) | Badges, counts. Nothing smaller exists. |
| `--text-sm` | 0.875rem (14) | Meta lines, tags, hints |
| `--text-md` | 1rem (16) | Body, inputs (never smaller: iOS zooms below 16 px) |
| `--text-lg` | 1.125rem (18) | Steps, ingredient names, summaries; ingredients in cook mode |
| `--text-xl` | 1.375rem (22) | Panel and card titles, feature module titles |
| `--text-2xl` | 1.75rem (28) | Section titles, nutrition numbers |
| `--text-3xl` | clamp(2rem, 1.5rem + 2.2vw, 3rem) | Page titles, on every route |
| `--text-cook` | clamp(1.625rem, 1.1rem + 2.6vw, 3rem) | The step in cook mode: about 28 px on a phone, 48 px on a desktop |

- `--font-display`: Fraunces, then Georgia and system serifs. Titles and numbers only.
- `--font-body`: Inter, then the system UI font.
- Line height: `--lh-tight` 1.15 (titles), `--lh-snug` 1.35 (cards, labels), `--lh-body` 1.6 (reading).
- **Measure:** running text is capped with `--measure-text`, which is 60ch (steps, summaries, notes, gaps, every paragraph in a feature module). `ch` is the width of "0", which is wider than an average letter: 60ch holds about 73 characters in Inter and 69 in Segoe UI, inside the 65 to 80 the device check asks for. `--measure: 72ch` is the older outer cap (about 87 characters); it stays defined because a test names it, and no rule uses it. Cap the text block, not its container; extra width goes to columns.
- Heading order is strict: one `h1` per view, `h2` for sections, `h3` inside them.

### Spacing, radius, elevation, motion, layers

| Group | Tokens |
|---|---|
| Spacing (4 px scale) | `--s-1` 4, `--s-2` 8, `--s-3` 12, `--s-4` 16, `--s-5` 24, `--s-6` 32, `--s-7` 48, `--s-8` 64 |
| Radius | `--r-sm` 8 (inputs, small buttons), `--r-md` 12 (buttons, insets), `--r-lg` 18 (cards, panels, dialogs), `--r-pill` 999 |
| Elevation | `--shadow-1` resting card, `--shadow-2` raised or hovered, `--shadow-3` sheet and dialog |
| Motion | `--dur-1` 120ms (press), `--dur-2` 200ms (hover, toast), `--dur-3` 320ms (view, sheet, card); `--stagger` 30ms (between cards); `--ease` cubic-bezier(.2,.8,.2,1) |
| Layers | `--z-bar` 20 (header, sticky action bar), `--z-sheet` 40 (filter sheet), `--z-toast` 60 |
| Targets | `--tap` 44px (minimum size of every control), `--tap-lg` 56px (Back and Next in cook mode, timers there) |
| Shell | `--gutter` (16 / 24 / 32 / 48 by breakpoint), `--content-max` 1760px, `--bar-h` (the brand row: 56 phone, 64 above), `--nav-h` 48px (the nav row), `--head-h` (the part of the header that stays on screen: 48 px below desktop, 64 px from desktop, plus the top safe area) |

## Layout contract

### Breakpoints

Declared once, here. CSS cannot read a custom property in a media query, so the numbers appear literally in `styles.css` (mobile-first `min-width` queries only) and once in JS as `BREAKPOINTS` in `lib/nav.mjs`. Feature stylesheets use the same numbers and the same direction.

| Name | From | Checked at |
|---|---|---|
| phone | 0 | 390 × 844 |
| tablet | 768 px | 768 × 1024 |
| desktop | 1280 px | 1280 × 800 |
| wide | 1920 px | 1920 × 1080, 2560 × 1440 |

### Shell

One shell for every route, at every width:

- `html` paints `--bg`. `body` is transparent. Nothing in the shell has a `max-width`.
- `header.topbar`: full-bleed, painted edge to edge. Brand, section nav, recipe count, theme button, **Add video**.
  - **Phone and tablet:** two rows. The brand row (brand, the count from tablet, theme, Add video) scrolls away; the nav row stays stuck to the top (`top: calc(-1 * (var(--bar-h) + env(safe-area-inset-top, 0px)))`). On a phone Add video is the plus icon alone. That leaves 48 px of header on screen instead of about 150. Under a notch the header's top safe-area padding scrolls away with the brand row, and the nav row pads its own top by the same inset, so the stuck row clears the notch.
  - **Desktop and wide:** one row, sticky as a whole, nav inline after the brand.
- `main#view`: the content pane. It caps content with padding, not with a width: `padding-inline: max(var(--gutter), (100% - var(--content-max)) / 2)`.
- `footer.footer`: full-bleed; holds the offline switch.
- **Navigation:** one pattern at all widths, the `nav#nav` in the header. It is hidden while "Recipes" is the only destination and appears when a feature registers a route. Below desktop it scrolls sideways inside itself if the sections do not fit.
- Anything sticky under the header is offset by `--head-h`, never by `--bar-h`.
- Safe areas: the viewport meta has `viewport-fit=cover`; the header, footer, sticky bars, sheet, cook mode and toast pad with `env(safe-area-inset-*)`.

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
| phone | One column. Title, then the tools: a search field, a **Filters** button, the list-view toggle, and feature buttons; they wrap to two rows. Filters open as a bottom sheet (scrim, focus kept inside, Escape closes, a "Show N recipes" button to close). Selected filters show as removable chips under the search. Cards are full-width **rows**: square thumbnail left, text right. |
| tablet | Title above the tools row. The filter panel opens **inline** above the grid as a two-column panel. Cards become vertical tiles in a 3-column grid. |
| desktop | Title left, tools right. Two panes: a sticky **filter rail** (300 px, always open, scrolls inside itself) and the grid beside it, 3 columns. The Filters button is gone. |
| wide | Same two panes (rail 320 px); the grid adds columns: 5 at 1920. Above `--content-max` (1760 px) the content stays centred on the painted page, so 2560 shows the 1920 design with wider margins. Card width stays between 220 and about 340 px. |

**Compact list.** The toggle in the tools (remembered in `rb:view`) turns the grid into dense rows at every width: a 64 px thumbnail, title, creator and the card's action; from tablet the ingredient and step counts too, in two or more columns of at least 340 px. Tags and macros are left out. A partial recipe says "partial" in the creator line, because the badge does not fit the thumbnail.

The queue ("In the queue") is a section under the grid: rows on a phone, a 2-up grid from tablet, 3-up on wide.

### `detail` (recipe, queued video)

Areas: `media` (the embed), `head` (back and Edit, status, title, creator, summary, tags, facts, and the gaps of a partial recipe), `actions`, `ingredients`, `steps`, `more` (nutrition, notes, source).

| Width | Design |
|---|---|
| phone | One column: head, media, ingredients, steps, more. The player is capped at 62svh so the title and the first ingredients stay near. A **sticky action bar** at the bottom is one row: **Start cooking** takes the width, then **Copy list** and the feature action (Add to week) as 44 px icon buttons. Print is not offered on a phone. |
| tablet | Two columns: the player in a sticky 280 px column, everything else beside it. Actions sit inline under the head, with their labels and Print. |
| desktop | Three areas: sticky player (300 px); the head spans the rest; under it **ingredients (300 to 360 px, sticky, own scroll) beside steps**, so amounts stay in view while you read the method. Steps are the widest column. |
| wide | Same areas with wider panes (400 px player, 440 px ingredients). Step text keeps the measure. |

The queued-video page uses the same areas with `media`, `head` and one status panel. The editor routes (`#/new`, `#/edit/<id>`) are `detail` pages whose whole content is capped at 960 px and centred.

### Feature pages

`#/plan`, `#/household` and `#/packs` use one frame: `.feature-page` with a `.feature-head` (an `h1` in `--text-3xl`, a measure-capped intro) and the module below. Two modules on a page sit in `.feature-cols`: one column below desktop, two from desktop. The packs module makes its own two columns (Share, Import) from desktop.

### Cook mode

A full-window `<dialog>` over the recipe, laid out for a phone held in one hand.

- **Top bar** (pressed once): the recipe title, a **Keep screen on** switch, **Exit**.
- **Stage:** the component name and "Step 4 of 20", then the step in `--text-cook`, at most 30ch wide, then a timer for each duration the step states (56 px tall).
- **Foot** (pressed all the time, in thumb reach): progress, timers running for other steps, then a row with **Ingredients** and **Watch step**, then **Back** and **Next** at 56 px, Next twice as wide.
- **Ingredients:** a checklist that shares its ticks with the recipe page. Below desktop it opens over the stage from the foot button and closes again when the step changes; from desktop it is a side pane (380 px, 460 px on wide).
- **Screen:** a wake lock is held while cook mode is open and the switch is on, and taken again when the tab becomes visible. The switch is the state. Where the browser has no Wake Lock API the switch is off and disabled, and a line under the bar says to set a longer screen timeout; a refused lock switches it off and says why. Switching it off releases the lock and is remembered (`rb:wake`).
- The step is remembered per recipe (`rb:cook:<id>`). Ticks are remembered per recipe (`rb:checked:<id>`) and survive a reload.

## Components

- **Buttons** `.btn`: 44 px min height everywhere (no small variant on touch). Variants: `-primary` (one per view; hover is `--accent-strong`), `-quiet`, `-danger`, `-lg` (56 px). A toggle button carries `aria-pressed` and is drawn in `--accent-soft` when on. `.icon-btn` is 44 × 44 with an `aria-label`.
- **A label that phones drop** `.label-wide`: inside a button next to an icon. It is always in the accessible name; it is drawn from tablet up. Used for Add video, Copy list and Add to week.
- **Chips** `.chip`: toggle buttons with `aria-pressed`, 44 px tall on coarse pointers and phones, 36 px with a fine pointer from desktop. 8 px apart. The feature filters' chips are drawn the same.
- **Segmented** `.segmented`: the Has all / Has any switch. The exclude ("Without") filter gets its own group right under the ingredient chips (see MOUNT-POINTS).
- **Card** `.card`: an `article` whose title link is stretched over the whole card (the link's name is the title only, and its own box is 44 px tall). The last row holds the counts and a slot for one feature action, an icon button above the stretched link.
- **Badge** `.badge`: text label plus a dot. Cards show a badge only when it matters (Partial); the recipe page always states the status.
- **Panel** `.panel`: surface, `--line` edge, `--r-lg`, `--shadow-1`. Feature modules draw their sections the same way.
- **Callout** `.callout`: `-gaps` (warn) and `-notes` (inset).
- **Timestamp** `.ts` and **timer** `.timer`: pills in a row under a step. The timestamp is a solid outline with a play icon; the timer is dashed while idle (it shows the duration), `--accent-soft` while running (the time left), `--ok-soft` when done.
- **Text links in a sentence** (creator, "household", planned recipes): a 44 px box on touch screens; plain inline text with a fine pointer from desktop.
- **Toast**: bottom centre, above the sticky action bar, `role="status"`.

## States

One design per state, in the dashboard and in every feature module:

| State | Design |
|---|---|
| **Loading** | A skeleton in the shape of what is coming (`--surface-3`, pulsing), never a spinner and never a line of text alone. `index.html` carries two, so they show before the script runs: the card grid, and a recipe page when the address is a recipe or queued video. A module that waits (packs, standalone) shows skeleton rows. |
| **Empty** | Muted text. When it is the whole content of an area it sits centred in a dashed `--line-strong` box (`.state`, the shopping list, the shop ledger); inside a card that has other content (a day with nothing planned) the card itself is dashed. One sentence, and one action if there is one. |
| **Error** | `--danger` text on `--danger-soft` with a 4 px `--danger` left edge, `role="alert"`. Form problems that block a save (the editor) use the same block in warn colours with a heading, and turn to the ok colours when the form is ready. |
| **Status** | One muted `--text-sm` line with `role="status"` ("Saved on this device", "3 of 12 ticked"). |
| **Pending** | The button is disabled with `aria-busy` and a changed label ("Adding…", "Importing…"). |

Where they appear:

| State | Where | Notes |
|---|---|---|
| Load error | fetch failed | Message, **Try again** button; the `npm start` hint only on the local server |
| Empty bank | no recipes | Invitation to add the first video |
| No matches | filters or search exclude everything | Says which filters are on, **Clear filters** button |
| Not found | unknown recipe or queue id | Message and a link home |
| Partial recipe | `status: "partial"` | Badge on card and page; gaps callout in the head, above the ingredients |
| Amount not given | `basis: "unstated"` | Italic muted text in the amount column, on the recipe page, in cook mode and in the shopping list alike; never an invented number |
| Thumbnail missing | no stable thumbnail, offline, or image error | Drawn placeholder with the platform name |
| Queue | `queued`, `analyzing`, `failed`, `done` | Labelled badge and a three-step progress line on the queue page |
| Ticked | an ingredient or a shopping item | Struck through in `--muted` |

## Kitchen timers

A step that states a duration in figures ("simmer for 10 minutes", "3-4 mins", "1 hour 30 minutes") gets a timer chip, on the recipe page and in cook mode. The parsing is `durations()` in `lib/format.mjs`; it never guesses, so "half an hour" or "a few minutes" gives no chip. A range runs for its lower bound.

- A tap starts it, another stops it, a tap on a finished one clears it.
- The same timer shows on the recipe page and in cook mode. In cook mode, timers of other steps are listed in the foot.
- When it ends: the chip turns to the ok colours and says "done", a toast (and a live line inside cook mode, which covers the toast), three short tones, and a vibration where the device has one.
- Timers live in memory. They keep running while you move between pages and stop when the page is reloaded.

## Motion

- Views fade and rise 8 px on route change (`--dur-3`). The first draw of the card grid on a view brings the cards in one after another (`--stagger` apart, the first eight); a filter change redraws without it, so typing in the search never flickers. Cards lift on hover (inside `@media (hover: hover)`) and press to 0.99; buttons press to 0.98. The sheet slides up, the add dialog rises, the toast fades. A finished timer pulses four times.
- `prefers-reduced-motion: reduce` sets every animation and transition to near-zero **and removes their delays**, and JS scrolls with `behavior: 'auto'`. State changes still happen.

## Accessibility

- Visible focus on everything: a 2 px `--focus` ring with a 2 px `--bg` halo, drawn with `outline` and `box-shadow` so it never changes the element's shape. Feature modules use the same ring from the same token.
- A skip link moves focus to `main`. Every route change moves focus to `main` and updates `document.title`.
- Result counts are announced through one polite live region.
- Tap targets are at least 44 × 44 px on phones and coarse pointers, 8 px apart. That includes links inside sentences and `summary` elements.
- Keyboard: `/` focuses search; arrow keys, Home and End move through the card grid; Up and Down move between step timestamps; in cook mode Left and Right change step and Escape leaves.
- Nothing depends on hover or on a `title` attribute. The basis of an amount is visible text for screen readers and a visible legend. An icon-only button has a name in words; the theme button also confirms the new theme in a toast.
- Strings from data files and oEmbed are escaped with `esc()` before they reach `innerHTML`.

## Print

`@media print` prints a recipe as a clean sheet on 16 mm margins: title, creator, the video URL as text, the four facts, ingredients in two columns with empty boxes (ticks are not printed), numbered steps with their timestamps as text, nutrition, gaps and notes. The shell, player, buttons, timers, tags and feature mounts are hidden, and the palette is forced to black on white whatever the theme. The week-plan page prints as the shopping list alone.

## Offline (behind a switch)

`public/sw.js` is a cache-first service worker for the app shell and the recipe data. It is **off by default**. The footer switch "Keep recipes for offline use" registers it and stores `rb:offline`; switching it off unregisters the worker and deletes its caches. Videos and thumbnails are not cached.

## Browser storage

Conveniences only, each read and write through `store` in `public/ui/core.js`, which never throws: `rb:theme`, `rb:view`, `rb:wake`, `rb:filters`, `rb:checked:<id>`, `rb:cook:<id>`, `rb:offline`, plus the feature modules' own keys (see their docs).
