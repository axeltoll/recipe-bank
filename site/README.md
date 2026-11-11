# Recipe Bank website

The public page for the project: what Recipe Bank is, a showcase built from the repository's own recipe files, a self-hosting guide and a changelog. It is a static folder, separate from the dashboard in `public/`. No build step, no dependencies.

**Status:** written without a browser or Node at hand. The tests cover the logic and the static structure; nothing here has been looked at in a browser yet. Do the checks under [What to check in a browser](#what-to-check-in-a-browser) before it goes anywhere public.

## Preview locally

```bash
npm run site        # http://127.0.0.1:4790 (SITE_PORT / HOST to override)
```

Any static server pointed at `site/` works too, for example `python3 -m http.server 4790 --directory site`. Opening the files straight from disk (`file://`) does not: browsers refuse to load ES modules that way, so you would only see the page without scripts.

```bash
npm test            # includes test/site*.test.mjs
npm run site:data   # regenerate data/showcase.js after editing a showcased recipe
```

## Files

| Path | What |
|---|---|
| `brand.json` | The brand definition, written first: name, palette, type, voice, layout contract, and the facts ledger (every claim on the pages with its source). Tests compare the pages with it. |
| `index.html` | The landing page: hero, four facts, how it works, showcase, features, the amounts rule, self-hosting, roadmap, FAQ, close. |
| `self-hosting.html`, `changelog.html`, `404.html` | The guide, the changelog, the not-found page. `404.html` uses root-absolute paths, so the site must be served from the root of its host. |
| `css/site.css` | One stylesheet for every page. Tokens for light and dark, breakpoints at 768, 1024, 1280 and 1920. |
| `js/theme.js` | Runs before first paint: sets the theme (stored choice, else the system's) so there is no flash. |
| `js/main.js` | Navigation, theme button, scroll reveals, progress line, sticky action, copy buttons; starts the showcase and the hero. |
| `js/showcase-core.js`, `js/showcase.js` | The showcase: pure filter and render functions (tested), and the DOM wiring. |
| `data/showcase.js` | Three recipes copied from `recipes/` by `scripts/build-site-data.mjs`. Generated: do not edit by hand. |
| `js/hero-shapes.js`, `js/stage-math.js` | The hero mark's tile geometry and scroll maths (pure, tested). |
| `js/hero.js`, `js/hero-boot.js` | The live three.js mark, and the code that decides whether to mount it and moves it with the scroll. |
| `assets/favicon.svg`, `assets/og.svg` | The favicon (the dashboard's mark) and the source artwork for a social preview image. |

## How the hero works

- The hero always contains an inline SVG poster of the mark. That is what you see without JavaScript, without WebGL 2, when three.js cannot be loaded, and under `prefers-reduced-motion: reduce` (no canvas is created at all in that case).
- Otherwise `js/hero.js` loads three.js r170 from jsDelivr through the import map in `index.html` and draws about 220 instanced tiles on one canvas. The tiles read as a video (a phone frame with a play button) and reflow into a recipe (a card with ingredient rows). It shows that once on its own, then waits for a click, the button under it, or the scroll.
- From 1024 px the canvas is a fixed layer behind the section content. It slides from the hero to the empty slot beside the "How it works" steps, turning into the recipe on the way, then scrolls off with that slot. Below 1024 px it stays inside the hero.
- Rails: one canvas on the page, device pixel ratio capped at 1.5 (touch, narrow) or 1.75, rendering paused when the canvas is off-screen or the tab is hidden.

## Rules for editing

1. **Only true things.** Every claim must be in `README.md`, `ROADMAP.md`, `CLAUDE.md` or the code. Add it to `facts` in `brand.json` with its source. Planned features carry the word planned. No invented users, numbers, reviews or logos.
2. **Copy style.** Calm and specific. No exclamation marks, and no em or en dashes in page copy (a test enforces the dashes).
3. **Recipes on the page come from the files.** The showcase and the four amount examples are checked against `recipes/` by the tests. Creators are credited and linked the way the dashboard does it. The page does not embed or re-host videos and does not load thumbnails.
4. **One layout contract.** Header, bands, footer and breakpoints are shared by all pages. Change them in `css/site.css`, not per page.
5. **Colours.** Change a colour in `brand.json` and in `css/site.css` together (three places in the stylesheet: light, dark, and the no-JavaScript dark block). Recheck contrast: the figures in `brand.json` were worked out by hand.

## What to check in a browser

None of this has been done yet. A Playwright harness or a patient person can do it.

**At 390 x 844, 768 x 1024, 1280 x 800, 1920 x 1080 and 2560 x 1440, in both themes**

- No sideways scroll (`document.documentElement.scrollWidth` equals `clientWidth`), and no element cut off at the right edge. Try 320 and 360 too.
- At 1920 and 2560 every band's background reaches both edges, and the content sits centred inside it.
- 1280 is a different layout from 768: inline navigation, split hero, three-up cards, the filter column beside the recipe.
- Tap targets: every visible link, button, input and `summary` that is not inside running text measures at least 44 x 44 px. The header at 390 and at 1024 is the tightest spot: check that nothing wraps or overflows there.
- Text lines stay at or under about 80 characters.
- The hero headline, the primary button and the top of the mark are visible without scrolling at 390 x 844 and at 1280 x 800.

**The 3D hero**

- The live mark appears, replaces the poster, and looks right in both themes. The light intensities and tile colours in `js/hero.js` were chosen without seeing them: expect to tune `LIGHTS` and `PALETTES`.
- Exactly one canvas exists. Scrolling it out of view stops the render loop (watch the GPU or add a counter).
- Hovering lifts tiles; a click or tap and the button under the mark switch between video and recipe; a vertical swipe that starts on the canvas scrolls the page.
- From 1024 px: scrolling moves the mark behind the text into the slot left of the "How it works" steps, where it has become the recipe and does not cover any text; further scrolling carries it off the top. Scrolling back up returns it to the hero. Resize the window across 1024 px in both directions.
- The hero copy buttons and the "Show it as a recipe" button still take clicks while the mark is behind them.
- With WebGL disabled, with JavaScript disabled, with the jsDelivr request blocked, and with reduced motion on: the poster stays, the page has no errors, and under reduced motion nothing animates.

**Everything else**

- The showcase: chips, Has all and Has any, search, Clear, opening each recipe, ticking ingredients, a timestamp opening YouTube at that second, Copy shopping list (and its fallback when the clipboard is blocked).
- Keyboard only: the skip link appears on the first Tab and works; the menu opens, closes with Escape and returns focus; every control shows a focus ring; the order makes sense.
- Without JavaScript: navigation links are visible, the showcase shows its fallback text, nothing is hidden.
- Contrast with a real tool, in both themes, including text on the accent button, the badges and the code block.
- A screen reader pass over the hero, the showcase and the FAQ.
- The console is clean and no request fails (fonts and three.js are the only external ones).
- The inputs are 16 px (no zoom on focus in iOS), and the sticky action bar hides when the self-hosting section, the close or the footer is on screen.

## What a deploy needs

No deploy has been done. For one:

1. **A static host** serving the contents of `site/` from the root of a domain or subdomain. Do not point it at `dist/`: that is the dashboard's export (`npm run build`), a different thing.
2. **Decide what ships.** `brand.json` and this `README.md` are not needed by the pages. Leave them out of the upload, or accept that they are public (they contain nothing private).
3. **Social preview.** Export `assets/og.svg` to `assets/og.png` at 1200 x 630, then add `og:image` (absolute URL), `og:url` and a `link rel="canonical"` to each page once the address is known. Change `twitter:card` to `summary_large_image` at the same time.
4. **Headers.** Serve `.js` as `text/javascript`. A real 404 status for unknown paths, using `404.html`. Long cache lifetimes are only safe if you add a version to the file names; otherwise keep them short.
5. **External requests.** The pages load fonts from Google Fonts and three.js from jsDelivr. To avoid both, self-host the font files (with their licence) and vendor `three.module.js` next to the scripts, then change the import map in `index.html`, `three_url` in `brand.json` and the font link on every page.
6. **Check the links to GitHub.** They assume the default branch is `main` and that `ROADMAP.md`, `LICENSE`, `CLAUDE.md` and `recipes/` stay where they are.
7. **Run the browser checks above against the deployed address**, not only locally.
