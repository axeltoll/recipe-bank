Verdict: FIX_FIRST at ccf3efd2757ddeb35911cd3c7ed4e3e73639fd57 · Reviewer: claude fable-5.2 (recipe-bank-pam lane) · Author: codex gpt-6.1-sol (recipe-bank-pam lane)

# feat/more-platforms

Reviewed by reading only: no shell, no Node, no network in this lane. Line numbers refer to the files under `_review/feat-more-platforms/`.

The parser and the short-link resolver are careful work and I found no security hole in them. The one blocking finding is that the branch changes what the browser accepts without changing what the browser can label, so merging it alone puts the word "undefined" into the dashboard. The lane was not allowed to edit `public/`, and its report hands the wiring to the PAM; the fix is three lines, but it has to land with this branch.

## Blocking

### 1. The dashboard accepts the new platforms and labels them "undefined"
`lib/video.mjs:75-93` (new platforms parse by default) with `public/app.js:19, 240, 287, 399, 438` (unchanged)

- **What goes wrong:** `lib/video.mjs` is served to the browser, so after this merge the Add dialog recognises Facebook, Pinterest and X links. `public/app.js:19` still maps only three platforms:
  - Paste `https://x.com/kitchen/status/12345` into Add video: the hint reads `✓ undefined video` (`app.js:438`).
  - Submit it: the server queues it (`server.mjs:100`). The queued-video page shows `Open on undefined ↗` (`app.js:399`).
  - A recipe on one of these platforms shows the same link text (`app.js:287`).
  - The dialog copy and the static override still say "YouTube Short, TikTok or Instagram Reel" (`index.html:31`, `app.js:442`).
- **Fix (minimum, in the same merge):** in `public/app.js` import `PLATFORMS` and replace line 19 with `const PLATFORM = Object.fromEntries(PLATFORMS.map(({ id, label }) => [id, label]));`, and use `PLATFORM[p] ?? 'the original site'` at the four call sites. `docs/PLATFORMS.md` steps 1 and 2 describe exactly this. The web-page checkbox (step 3) can follow later, because the default parse stays strict.
- **If the redesign branch merges first:** apply the same change to its replacement for `app.js`; see `reviews/merge-risks.md`.

## Nits

- **`lib/video.mjs:38, 64-66, 82-84`: short links keep an `http:` scheme and their query string.** `http://vm.tiktok.com/AbC/` is stored as typed and the resolver refuses it because it is not HTTPS (`video-resolver.mjs:9`), so it never resolves. `https://pin.it/AbC?si=1` and `https://pin.it/AbC` get different `videoKey`s and can be queued twice. Fix: build short-link URLs as `https://<host><pathname>` without the query.
- **`lib/video.mjs:75-101`: a trailing dot on the host escapes the service list.** `https://www.facebook.com./reel/12345` and `https://l.facebook.com./l.php?u=…` match none of the exact host lists nor the `serviceHosts` suffix check, so with `allowWeb: true` they become `web` sources, contrary to "invalid links on recognized platform domains do not fall back to web pages" in `docs/PLATFORMS.md`. No request is made and the result is link-only, so this is consistency and deduplication, not security. Fix: strip one trailing dot from `u.hostname` before matching, and add both URLs to the hostile-input test.
- **`lib/video.mjs:100-101`: `web` accepts loopback, IP-literal and single-label hosts** (`https://127.0.0.1/x`, `https://router/x`). Nothing fetches them, and the scheme is always `https:`, so the worst case is a link in the queue. Consider requiring a dotted, non-IP hostname.
- **`lib/video.mjs:86-89, 98-99`: Pinterest's language subdomains are rejected.** Share links such as `https://br.pinterest.com/pin/123/` fail the exact-host check, and the `pinterest` label check stops them becoming `web` sources either, so they cannot be queued. Accepting a two-letter subdomain of the listed domains would cover them.
- **`lib/video.mjs:91-92`: X links with a media suffix are rejected** (`…/status/123/video/1`, `…/status/123/photo/1`), which is what the share sheet often gives. Allow and drop the suffix.
- **`lib/video-resolver.mjs:28-31`: every hop must itself parse as a video URL of the same platform.** As I remember them, real `pin.it` links go through `api.pinterest.com/url_shortener/…` and end on `/pin/<id>/sent/…`; neither parses, so these links would always stay unresolved. That degrades safely (the short link is kept). Check with one real link during dashboard integration, and if confirmed, allow that one intermediate host and the `/sent/` suffix explicitly.
- **`server.mjs:99-100, 162-173`: any web page the user visits can POST to `http://127.0.0.1:4780/api/queue`,** because `readBody` does not require `content-type: application/json` and so no CORS preflight is triggered. That already exists on main. With `allowWeb` it now lets a hostile page put arbitrary HTTPS links into the queue (rendered escaped, as links). Requiring the JSON content type closes it cheaply.
- **`server.mjs:71`: the X oEmbed host** is `publish.x.com`; the long-standing name is `publish.twitter.com`. Either should answer; verify once with a real link.
- **`docs/PLATFORMS.md:114-118` uses internal process words in a public document:** the heading "Dashboard integration for the PAM", "This lane deliberately does not edit…", "the dashboard lane". Nothing private is disclosed, but a reader of the public repo cannot know what a PAM or a lane is. Reword to "Dashboard integration (not done yet)".
- **`ROADMAP.md` / `README.md`:** the roadmap item correctly stays unchecked. The README sentence already lists all seven sources as supported; after the fix above that is true for labels, and web pages still need the checkbox.

## Checked and found in order

**URL parsing** (`lib/video.mjs`)
- **Schemes:** anything but `http:` and `https:` is rejected up front (line 38), so `javascript:`, `data:` and `ftp:` never reach a host check. `web` additionally requires `https:`.
- **Userinfo and ports:** rejected for every platform (line 38). `https://facebook.com@evil.example/…` and `https://facebook.com:444/…` return null. Default ports are normalised away by `URL`.
- **Look-alike hosts:** new platforms use exact host lists, and Pinterest an exact list of country domains instead of a suffix match. `facebook.com.evil.example`, `evilfacebook.com` and `pinterest.evil.example` return null; all are in the tests.
- **IDN:** `URL` converts hosts to punycode before comparison, so a homograph host cannot equal an ASCII entry in the lists.
- **Redirector hosts:** `l.facebook.com` is neither a video host nor allowed as a web source.
- **IDs:** numeric IDs are matched with `\d+` and kept as strings; the embed helpers re-check `^\d+$` before building a URL (lines 124-130), so a hand-edited recipe file cannot inject parameters into an iframe `src`.

**Short-link resolver** (`lib/video-resolver.mjs`)
- **Hop limit:** at most three redirects, four requests (lines 23-30); a loop is caught by the `seen` set.
- **Host allow-list:** the first URL must be one of four short hosts; every redirect target must be HTTPS without credentials or a port and parse as the same platform; TikTok has an exact host list on top.
- **Timeout:** one `AbortSignal.timeout(3000)` for the whole chain.
- **No SSRF:** a request can only go to a fixed platform hostname over HTTPS on the default port. A redirect to `http://169.254.169.254/`, `https://localhost/` or any other host fails `allowed()` and is never fetched. Only `HEAD` is sent and no body is read.
- **Web pages are never fetched:** not for resolution, not for oEmbed (`server.mjs:66-74`).

**Server**
- `allowWeb` must be the JSON boolean `true`; the string `'true'` and `1` are rejected, and tested.
- oEmbed keeps its 5-second timeout and its failure fallback; third-party `html` is never used.

**Contract, data, dependencies, privacy**
- `lib/recipe.mjs`: `web` only when the recipe declares `platform: "web"`; an invented `id` on a URL-keyed source is rejected. The amount and step rules are untouched.
- No recipe or queue file changed. `test/video-compat.json` pins the parsed value and key of all 17 recipes, so a parser regression on stored data would fail the suite.
- No dependency added. No private names, paths, hosts or accounts; test hosts are `example.com` and `evil.example`.

**Tests**
- I traced the resolver, queue and validation tests by hand, including the request count of 8 in `test/platform-queue.test.mjs:104` and the redirect cases in `test/video-resolver.test.mjs`. They test what they claim, with `fetch` mocked throughout.
- Not covered by any test: the dashboard, which is where the blocking finding is.
