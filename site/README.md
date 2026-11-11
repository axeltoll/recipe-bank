# Recipe Bank website

The public site for the project: what Recipe Bank is, a showcase built from the repository's own recipe files, a feature list with a status on every entry, docs pages and a changelog. It is a static folder, separate from the dashboard in `public/`. No build step, no dependencies, served as it is in the repository.

**Status:** written in two rounds without a browser or Node at hand. The tests cover the logic, the data and the static structure; nothing here has been looked at in a browser yet. Do the checks under [What to check in a browser](#what-to-check-in-a-browser) before it goes anywhere public. Nothing is deployed, and the hosting decision is open.

## Preview locally

```bash
npm run site        # http://127.0.0.1:4790 (SITE_PORT / HOST to override)
```

Any static server pointed at `site/` works too, for example `python3 -m http.server 4790 --directory site`. Opening the files straight from disk (`file://`) shows the pages without scripts: browsers refuse to load ES modules that way. That is a fair preview of the no-JavaScript view.

```bash
npm test            # includes test/site*.test.mjs
npm run site:sync   # rewrite the generated parts of the pages after editing data/features.json or data/site.json
npm run site:data   # regenerate data/showcase.js after editing a showcased recipe
```

## When something merges: change one status

Every feature the site names is one entry in `data/features.json`:

```json
{ "id": "cook-mode", "status": "next", "title": "Cook mode", "text": "…", "source": "where the claim comes from" }
```

| `status` | Means | Where it shows |
|---|---|---|
| `shipped` | On the main branch | Home page, Features: "In the repository today" |
| `next` | Built, being merged | Home page, Features: "Built, being merged" |
| `planned` | On the roadmap, not built | Home page, Roadmap |

To flip one: change `status` in `data/features.json`, then run `npm run site:sync`. That is all.

- The home page's feature and roadmap groups and the status notes in the docs (the small "Being merged" lines) are drawn from this file. In the browser `js/features.js` reads the file and redraws them, so a changed status shows at once.
- The same markup is also in the HTML, between `<!-- gen:… -->` comments, so the pages are complete without JavaScript. `npm run site:sync` rewrites those parts. `npm test` fails while a page is out of step with the data, and says which command to run.
- A group with no entries disappears, heading included. When the last `next` feature ships, "Built, being merged" is gone.
- To put a status note above some text in a docs page, add `<!-- gen:status:<feature id> -->` and `<!-- /gen:status:<feature id> -->` on two lines and run the sync.
- Keep `title` and `text` plain: no quotes, ampersands or angle brackets, no em or en dashes. A test checks it.

Two pieces of prose are not driven by the data and need a look when statuses change: the "Being merged" entry in `changelog.html`, and the sentence under a status note that says what the note is about.

## Publishing settings

`data/site.json` holds the address of the site:

```json
{ "baseUrl": "", "ogImage": "assets/og.svg" }
```

`baseUrl` is empty until hosting is decided. While it is empty:

- no page has a `canonical` link, an `og:url` or an `og:image` (a test makes sure no page claims an address);
- `robots.txt` and `sitemap.xml` are written for the placeholder `https://base-url.invalid`. They are not valid for publishing in that state.

When the address is known:

1. Set `baseUrl` (https, for example `https://recipes.example`; the site must be served from the root of that host).
2. Export `assets/og.svg` to `assets/og.png` at 1200 x 630 and set `ogImage` to `assets/og.png`. Social platforms do not read SVG, so the PNG is needed for link previews. The SVG stays as the source artwork.
3. Run `npm run site:sync`. It writes `canonical`, `og:url` and `og:image` into every page, and the real address into `robots.txt` and `sitemap.xml`.
4. Change `twitter:card` from `summary` to `summary_large_image` in the pages once the PNG exists.
5. Run `npm test`.

## Files

| Path | What |
|---|---|
| `index.html` | The home page: hero, four facts, how it works, showcase, features, the amounts rule, self-hosting, roadmap, FAQ, close. |
| `getting-started.html`, `recipe-format.html`, `recipe-agent.html`, `self-hosting.html` | The docs: install and a dashboard tour, the file contract, the Recipe Agent, running it yourself. |
| `how-analysis-works.html`, `recipe-format-cheatsheet.html`, `contributing.html` | The analysis pipeline with an inline SVG diagram, a one-page printable cheat sheet, and how to add a platform, a recipe or a feature module. |
| `changelog.html`, `404.html` | The changelog and the not-found page. `404.html` uses root-absolute paths, so the site must be served from the root of its host. |
| `data/features.json` | Every feature with its status. See above. |
| `data/site.json` | Publishing settings. See above. |
| `data/showcase.js` | Three recipes copied from `recipes/` by `scripts/build-site-data.mjs`. Generated: do not edit by hand. |
| `robots.txt`, `sitemap.xml` | Written by `npm run site:sync` from `data/site.json` and the list of pages. |
| `brand.json` | Name, promise, voice, the layout contract and the facts ledger (every claim on the pages with its source). |
| `css/site.css` | One stylesheet for every page, on the dashboard's design tokens. |
| `js/theme.js` | Runs before first paint: marks the page as scripted and sets the theme (stored choice, else the system's). |
| `js/main.js` | Theme button, docs menu, scroll reveals, progress line, sticky action, copy and print buttons. Loads the three parts below only on pages that have them. |
| `js/features-core.js`, `js/features.js` | The feature cards and status notes: pure render functions (tested, shared with the sync script), and the DOM wiring. |
| `js/showcase-core.js`, `js/showcase.js` | The showcase: pure filter and render functions (tested), and the DOM wiring. |
| `js/hero-shapes.js`, `js/stage-math.js` | The hero mark's tile geometry and scroll maths (pure, tested). |
| `js/hero.js`, `js/hero-boot.js` | The live three.js mark, and the code that decides whether to mount it and moves it with the scroll. |
| `assets/favicon.svg`, `assets/og.svg` | The favicon (the dashboard's mark) and the source artwork for a social preview image. |
| `../scripts/sync-site.mjs` | `npm run site:sync`. Rewrites only the lines between `gen:` marker comments, plus `robots.txt` and `sitemap.xml`. |
| `../scripts/serve-site.mjs`, `../scripts/build-site-data.mjs` | The preview server and the showcase data generator. |

The site is flat: every page sits in the root of `site/`, so all pages share the same relative paths and the same header and footer markup. A test compares the header, the footer and the docs sidebar across pages.

## One visual language

The site uses the dashboard's design contract (`docs/design/DESIGN.md`): the same colour tokens for light and dark, the type scale, the 4 px spacing scale, the radii, the motion durations and the layers. They are written out in the first block of `css/site.css`. Component rules use tokens only; a test fails on a raw colour or duration outside the token blocks.

- **The site's own tokens** are marked "site only" in the stylesheet and listed in `brand.json`: the hero and section title sizes, one larger spacing step, the reveal duration, two layers for the 3D mark, the reading width (1240 px, 1440 px from 1920), the header height and the docs sidebar width.
- **Dark theme.** Follows the system; the header button stores a choice (`rb-site-theme`). The dark values are in the stylesheet twice, for `data-theme="dark"` and for the system preference without JavaScript. A test fails if the two lists differ.
- **Contrast.** A test recomputes the contrast of every text pair the site uses, in both themes, from the values in the stylesheet, and asks for 5:1 (AA is 4.5:1) and 3:1 for control boundaries and the focus ring. The lowest pair is white on the accent button at 5.2:1.
- **When the redesign is merged,** a test compares the site's colour tokens with `public/styles.css` and fails if they drift. Until then that test is skipped.
- **Changing a colour:** change it in the three places in the stylesheet (light, dark, dark without JavaScript), in `js/hero.js` `PALETTES` if it is `--ink` or `--accent`, and in `THEME_COLOR` in `js/main.js` and the `theme-color` meta of every page if it is `--bg`. Tests check each of these.

## Layout contract

Breakpoints, mobile-first `min-width` steps only: tablet 768, desktop 1280, wide 1920. Checked at 390, 768, 1280, 1920 and 2560.

| | Phone (390) | Tablet (768) | Desktop (1280) | Wide (1920+) |
|---|---|---|---|---|
| Header | Brand row, then a nav row that scrolls sideways inside itself | Same, plus the GitHub button | One row: brand, nav, theme, GitHub | Same, wider gutters |
| Home | One column; mark under the copy; sticky action bar | Two-up cards, four facts in a row, filter beside results | Split hero, the mark travels to "How it works", three-up cards, filter beside the recipe | Four-up cards, two-column FAQ, content capped at 1440 px |
| Docs | Docs menu button, "on this page", text | Same, menus in two columns | Sticky sidebar beside the text | Sidebar, text, "on this page" as a third column |

- `html` paints the page colour. Bands and the header and footer are full-bleed; `.inner` caps the content with padding, never with a width, so every band reaches both edges at any window width.
- The header navigation needs no script at any width. There is no menu button.
- The header is about 100 px tall on a phone (two rows) and stays sticky. If that turns out to be too much in a browser check, make it non-sticky below 768 px in one rule.

## How the hero works

- The hero always contains an inline SVG poster of the mark. That is what you see without JavaScript, without WebGL 2, when three.js cannot be loaded, with data saving on, and under `prefers-reduced-motion: reduce` (no canvas is created and nothing is requested in that case).
- Otherwise `js/hero-boot.js` waits for the page to finish loading and for the hero to be on screen, then loads `js/hero.js`, which imports three.js r170 and draws about 220 instanced tiles on one canvas. The tiles read as a video (a phone frame with a play button) and reflow into a recipe (a card with ingredient rows). It shows that once on its own, then waits for a click, the button under it, or the scroll.
- From 1280 px the canvas is a fixed layer behind the section content. It slides from the hero to the empty slot beside the "How it works" steps, turning into the recipe on the way, then scrolls off with that slot. Below 1280 px it stays inside the hero.
- **The fixed layer takes no pointer events.** Hover is read from the window, and the switch is the button under the mark, so the canvas cannot sit between a visitor and a link. In the hero slot (below 1280 px) the canvas itself takes the click.
- **No jump at the breakpoint.** Every change of mode measures, places and positions the stage in the same task, so there is no frame where the stage is fixed but not yet positioned.
- Rails: one canvas on the page, device pixel ratio capped at 1.5 (touch, narrow) or 1.75, rendering paused when the canvas is off-screen or the tab is hidden.

## External requests

The pages load nothing from another host: no fonts, no analytics, no images, no embeds. Type is a system font stack; the dashboard's faces (Fraunces, Inter) are named first, so a visitor who has them installed sees them, and nothing is downloaded.

Every remaining request to another host:

| Request | When | Why |
|---|---|---|
| `https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js` | Home page only, after load, once the hero is on screen. Never under reduced motion, with data saving on, or without WebGL 2. | The animated mark in the hero. If it fails, the SVG poster stays. |

To remove it too, vendor `three.module.js` next to the scripts and change `THREE_URL` in `js/hero.js` and `three_url` in `brand.json`.

Links, not requests: the pages link to GitHub and, in the static recipe list and the showcase, to the videos and creators on YouTube. A test fails if a page links to any other host or loads a script, stylesheet, image or frame from one.

Same-origin requests: `js/features.js` fetches `data/features.json`.

## Accessibility and the no-JavaScript view

- Every page is complete without JavaScript: all text is in the HTML, the header navigation is plain links, the docs menu is a visible list, the feature groups are static markup, and the showcase is a static list of the three recipes with links to the videos and the recipe files. Controls that only work with a script (theme, copy, print, the docs menu button, the 3D switch, the filter) are hidden until a script shows them.
- Skip link first; one `header`, `main` and `footer`; every `nav` and `section` named; one `h1` and no skipped heading level; focus order is document order (no `tabindex` other than 0).
- Focus is always visible: a 2 px ring in the focus colour with a halo in the page colour.
- `prefers-reduced-motion`: no smooth scroll, no reveals, no canvas. `prefers-contrast: more`: dividers become real boundaries, tertiary text becomes secondary, shadows and the hero wash go. `forced-colors` and print are handled.
- Known and left as it is: in the header the theme button and the GitHub button follow the navigation in focus order, but sit before it visually below 1280 px, where the navigation is the second row.

## Rules for editing

1. **Only true things.** A feature is named on the site only through `data/features.json`, with a status and a source. Other claims go into `facts` in `brand.json` with their source. No invented users, numbers, reviews or logos.
2. **Copy style.** Calm and specific. No exclamation marks, and no em or en dashes in page copy (a test enforces both).
3. **Recipes on the page come from the files.** The showcase, the static recipe list and the four amount examples are checked against `recipes/` by the tests. Creators are credited and linked. The page does not embed or re-host videos and does not load thumbnails.
4. **One layout contract.** Header, bands, footer, docs layout and breakpoints are shared by all pages. Change them in `css/site.css`, not per page. When you change the header, the footer or the docs sidebar, change it in every page: a test compares them.
5. **Tokens only** in component rules.
6. **No script holds content.**

## What to check in a browser

None of this has been done yet. A Playwright harness or a patient person can do it.

**At 390 x 844, 768 x 1024, 1280 x 800, 1920 x 1080 and 2560 x 1440, in both themes, on the home page and one docs page**

- No sideways scroll (`document.documentElement.scrollWidth` equals `clientWidth`), and no element cut off at the right edge. Try 320 and 360 too. Tables and code blocks scroll inside themselves.
- At 1920 and 2560 every band's background reaches both edges, and the content sits centred inside it.
- The header: at 390 the brand row holds the logo and the theme button, and the nav row scrolls sideways without moving the page. At 768 the GitHub button fits in the brand row. At 1280 everything is on one row with room to spare (about 930 px of controls in 1216 px).
- 1280 is a different layout from 768: inline navigation, split hero, three-up cards, the filter column beside the recipe, the docs sidebar.
- Tap targets: every visible link, button, input and `summary` that is not inside running text measures at least 44 x 44 px.
- Text lines stay at or under about 80 characters.
- The hero headline, the primary button and the top of the mark are visible without scrolling at 390 x 844 and at 1280 x 800.
- The fonts: the system serif for headings looks acceptable on Windows, macOS, Android and Linux.

**The 3D hero**

- The live mark appears, replaces the poster, and looks right in both themes. The light intensities in `js/hero.js` were chosen without seeing them: expect to tune `LIGHTS`.
- Exactly one canvas exists. Scrolling it out of view stops the render loop.
- Below 1280 px: hovering lifts tiles; a click or tap on the mark and the button under it switch between video and recipe; a vertical swipe that starts on the canvas scrolls the page.
- From 1280 px: scrolling moves the mark behind the text into the slot left of the "How it works" steps, where it has become the recipe and does not cover any text; further scrolling carries it off the top. Scrolling back up returns it to the hero. Hover still lifts tiles. Every link and button the mark passes behind still takes a click.
- Resize the window slowly across 1280 px in both directions, at several scroll positions: the mark must not jump or flash at the wrong place.
- With WebGL disabled, with JavaScript disabled, with the jsDelivr request blocked, with data saving on, and with reduced motion on: the poster stays, the page has no errors, and under reduced motion nothing animates and three.js is not requested.

**Everything else**

- The showcase: chips, Has all and Has any, search, Clear, opening each recipe, ticking ingredients, a timestamp opening YouTube at that second, Copy shopping list (and its fallback when the clipboard is blocked).
- The features: change a status in `data/features.json` without running the sync and reload. The card moves to the other group.
- The docs menu below 1280 px: opens, closes with Escape and returns focus, and is a plain sidebar from 1280 px.
- Keyboard only: the skip link appears on the first Tab and works; every control shows a focus ring; the order makes sense.
- Without JavaScript: the static recipe list shows, the feature cards show, the docs list shows, no dead button is visible.
- Print `recipe-format-cheatsheet.html`: it fits one page, without header, sidebar or footer.
- Contrast with a real tool, in both themes, including text on the accent button, the badges and the code block. Turn on "increase contrast" in the system and look again.
- A screen reader pass over the hero, the showcase, the feature list and a docs page.
- The console is clean and the only request to another host is three.js on the home page.

## What a deploy needs

No deploy has been done. For one:

1. **A static host** serving the contents of `site/` from the root of a domain or subdomain. Do not point it at `dist/`: that is the dashboard's export (`npm run build`), a different thing.
2. **The publishing settings** above: `baseUrl`, the PNG, `npm run site:sync`.
3. **Decide what ships.** `brand.json` and this `README.md` are not needed by the pages. Leave them out of the upload, or accept that they are public (they contain nothing private). `data/features.json` is needed.
4. **Headers.** Serve `.js` as `text/javascript` and `.json` as `application/json`. A real 404 status for unknown paths, using `404.html`. Long cache lifetimes are only safe if you add a version to the file names; otherwise keep them short.
5. **Check the links to GitHub.** They assume the default branch is `main` and that `ROADMAP.md`, `LICENSE` and `recipes/` stay where they are.
6. **Run the browser checks above against the deployed address**, not only locally.
