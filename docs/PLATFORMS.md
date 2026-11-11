# Video platforms

`lib/video.mjs` is dependency-free and DOM-free: the server, validator and browser
share the same parser. Parsing recognizes a URL shape, not whether a public post
exists or contains a video. Analysis must check that before writing a recipe.

## Plain web pages require an explicit opt-in

`parseVideoUrl(url)` stays strict. To represent an arbitrary HTTPS page containing
a video, call `parseVideoUrl(url, { allowWeb: true })`. This returns
`{ platform: 'web', id: null, url }`, with the URL normalized by `URL`. Its entire
query and fragment are retained because they can identify a particular video.
`videoKey` uses this URL. HTTP pages, non-HTTP schemes, credentials and non-default
ports are rejected. Invalid links on recognized platform domains (including
Facebook redirect links) do not fall back to web pages.

Recipes may use web pages only by explicitly declaring `video.platform: "web"`;
the recipe validator enables web parsing only for that declaration. The queue
API requires the explicit JSON property `allowWeb: true` alongside `url` to queue
a web page. Normal queue requests and the dashboard's existing supported-link
hint stay strict. `scripts/validate.mjs` opts in only for queue entries explicitly
saved with `video.platform: "web"`, just as the recipe validator does.
For web pages and unresolved short links, `video.id` must be null or omitted.
An invented ID would make unrelated URLs share a `videoKey`; both recipe and
queue validation reject it.

Web sources are link-only. The parser does not inspect HTML, fetch arbitrary
pages, discover video files or promise that every HTTPS page contains a video.
This keeps "supported video link" meaningful and avoids rendering arbitrary
third-party HTML as an embed.

## Platform contract

`PLATFORMS` is an immutable array of `{ id, label, embeds }` objects. `embeds` is a
boolean for the platform's public iframe capability; a particular post may still
be private, deleted, region restricted or blocked by the viewer's browser.

| ID | Label | Canonical URL / ID | Public embed |
|---|---|---|---|
| `youtube` | YouTube | Existing Shorts URL / 11-character video ID | YouTube privacy-enhanced player; supports start time |
| `tiktok` | TikTok | Existing creator video URL / numeric video ID | TikTok player |
| `instagram` | Instagram | Existing Reel URL / post shortcode | Reel iframe |
| `facebook` | Facebook | `https://www.facebook.com/watch/?v=<id>` / numeric ID | Public video plugin |
| `pinterest` | Pinterest | `https://www.pinterest.com/pin/<id>/` / numeric ID | Public pin iframe |
| `x` | X | `https://x.com/<user>/status/<id>` / numeric status ID | Link only |
| `web` | Web page | Full normalized HTTPS page URL / `null` | Link only |

Facebook accepts `/watch?v=`, `/watch/?v=`, `/reel/<id>` and
`/<page>/videos/<id>`, on the root, `www.`, `m.` and `web.` hosts. `l.facebook.com`
redirect links are rejected. Pinterest accepts `/pin/<id>` on the root or `www.`
of the exact country domains in `PINTEREST_DOMAINS` in `lib/video.mjs` (including
`.com`, `.co.uk`, `.com.au` and `.se`), and canonicalizes them to `.com`. Other
subdomains and domains are not implicitly trusted. X accepts root, `www.` and
`mobile.` hosts on both `x.com` and `twitter.com`. IDs stay strings, so large
numeric IDs retain their precision. Query tracking and fragments on these full
platform URLs are discarded; an optional trailing slash is accepted.

Unresolved `fb.watch/<code>`, `pin.it/<code>`, `vm.tiktok.com/<code>` and
`vt.tiktok.com/<code>` links retain their original normalized URL and `id: null`,
just as TikTok short links did before. Without a resolved ID they have no embed.
`videoKey` is unchanged: `<platform>:<id>` when an ID exists, otherwise the URL.
No stored recipe or queue entry is rewritten. The compatibility fixture pins all
17 existing recipes and the currently empty queue; deliberately update that
fixture when the collection changes.

On new queue submissions only, the server tries to resolve these four short-link
hosts before metadata lookup and deduplication. `lib/video-resolver.mjs` uses HEAD,
manual redirects (at most three, or four requests including the initial URL),
and a single three-second timeout for the whole chain. Every target must be an
HTTPS URL without credentials or a non-default port and parse as the same
platform. TikTok additionally uses an exact root/`www.`/`m.`/`vm.`/`vt.` host list.
Relative redirects are accepted; cross-platform targets, redirector subdomains,
loops, excess hops, failed requests and unsupported HEAD responses retain the
original short link. Browser parsing and static exports never resolve links.
The oEmbed timeout is a separate five-second budget after resolution.

Facebook embeds use `https://www.facebook.com/plugins/video.php` with a fixed,
encoded canonical `href`. Pinterest uses
`https://assets.pinterest.com/ext/embed.html?id=<id>`. Only YouTube advertises
timestamp seeking; the other helpers ignore `start` and `autoplay`. New platforms
return `null` from `thumbnailUrl`: no stable public poster URL is assumed.

The server requests best-effort oEmbed metadata from YouTube, TikTok, Pinterest
and X's public key-free endpoints, with the existing five-second timeout and
failure fallback. X often omits a title; an entry with a null title is valid.
Facebook and Instagram need app credentials for oEmbed and are skipped. Web
pages are never fetched for metadata. Third-party HTML returned by oEmbed is
never rendered or used as a title.

Provider references: [Facebook embedded videos](https://developers.facebook.com/docs/plugins/embedded-video-player/),
[Pinterest widgets](https://developers.pinterest.com/docs/web-features/widgets/),
[Pinterest widget source](https://github.com/pinterest/widgets), and
[X oEmbed API](https://docs.x.com/x-for-websites/oembed-api).
WordPress also documents its [Pinterest oEmbed endpoint registration](https://make.wordpress.org/core/2022/01/04/miscellaneous-core-changes-in-wordpress-5-9/#two-new-oembed-providers-wolfram-notebook-and-pinterest).
Provider playback and live metadata availability are not verified by offline
tests; test with public posts during dashboard integration.

## Offline verification

`npm test` covers URL shapes, hostile inputs, embed URLs, opt-in parsing, recipe
validation and the existing collection's exact parsed values and deduplication
keys. oEmbed and short-link tests mock `fetch`, including timeout, error-status,
non-JSON, redirect-loop and hop-limit cases.

`test/platform-queue.test.mjs` exercises the exported `handleRequest` with request
streams and response objects against a disposable copy of the server and data.
It checks API-level web opt-in, persisted queue values, alias and recipe
deduplication, resolution before metadata lookup, and offline fallback. It does
not bind a socket or call providers. `test/platform-validation.test.mjs` runs the
CLI against disposable queue entries to check platform and ID consistency.
`npm run validate` still checks the actual collection. `npm run build` copies the
shared modules to the static export; parsing there remains offline.

## Dashboard integration

Done in the round-1 merge: `public/ui/core.js` derives `PLATFORM` and the
supported-platform copy (`PLATFORM_LIST`) from `PLATFORMS`; the Add dialog
(`public/index.html`, `public/ui/add.js`) has the "It's a web page with a video
on it" checkbox, passes `{ allowWeb: true }` only while it is ticked, labels web
results as a page to check, and the static copy's request names a web source;
`player()` keeps the link fallback; timestamps are buttons only on YouTube. The
recipe editor takes its labels from the same table. What still needs a person
is the visual check in step 5 below. The original checklist:

1. Add `PLATFORMS` to the import from `/lib/video.mjs` in `public/app.js`. Replace
   the hard-coded `PLATFORM` object with
   `const PLATFORM = Object.fromEntries(PLATFORMS.map(({ id, label }) => [id, label]));`.
   Keep using this derived map for queue subtitles, recipe and queue "Open on"
   links, and the Add dialog's detection hint. Escape labels when inserting HTML
   and fall back to a generic label if a future platform is unknown.
2. Derive the Add dialog's supported-platform copy from
   `PLATFORMS.filter(({ id }) => id !== 'web')`. Update both its initial HTML copy
   in `public/index.html` and the static-site override in `setupAdd()`, which
   currently lists only three platforms. Keep default `parseVideoUrl(url)` strict
   in both the live and static supported-link checks.
3. Add an explicit "This is a web page containing a video" checkbox, off by
   default. Only while checked, pass `{ allowWeb: true }` to parsing in the input
   hint and submit validation, and send `allowWeb: true` in `POST /api/queue`.
   For static requests, include the parsed platform and URL in the copied
   analysis request so web-page opt-in survives the handoff. Label web results
   as a page to check, rather than a verified video.
4. Keep `player()`'s `embedUrl(video) === null` link fallback: X, web pages and
   unresolved short links use it. Preserve the always-visible original link for
   embeds that fail to load. Do not inject X's oEmbed HTML or load widget scripts.
   Use `embeds` for capability copy, and `embedUrl` for each actual iframe.
5. Make timestamp controls truthful: use YouTube seeking where supported; for
   other platforms offer an original-video link or omit the seek button. Verify
   Facebook and Pinterest iframe sizing on mobile, link-only X/web views, labels
   on recipe and queue views, strict hints, and web opt-in for live/static modes.
   Rebuild the static export; `scripts/build-static.mjs` already copies shared
   `lib/` modules, so no special bundling change is required.
