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
ports are rejected, and so are hosts that are not a dotted public name: IP
literals (`https://127.0.0.1/`, `https://[::1]/`) and single labels
(`https://router/`). Invalid links on recognized platform domains (including
Facebook redirect links, and hosts written with a trailing dot such as
`www.facebook.com.`) do not fall back to web pages.

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
redirect links are rejected. Pinterest accepts `/pin/<id>` (and the
`/pin/<id>/sent/` page a shared link lands on) on the root, `www.` or a
two-letter language subdomain (`br.`, `de.`) of the exact country domains in
`PINTEREST_DOMAINS` in `lib/video.mjs` (including `.com`, `.co.uk`, `.com.au` and
`.se`), and canonicalizes them to `.com`. Other subdomains and domains are not
implicitly trusted. X accepts root, `www.` and `mobile.` hosts on both `x.com` and
`twitter.com`, with or without the `/video/<n>` or `/photo/<n>` suffix the share
sheet adds. IDs stay strings, so large numeric IDs retain their precision. Query
tracking and fragments on these full platform URLs are discarded; an optional
trailing slash is accepted. One trailing dot on a host name is ignored.

Unresolved `fb.watch/<code>`, `pin.it/<code>`, `vm.tiktok.com/<code>` and
`vt.tiktok.com/<code>` links keep `id: null` and the URL
`https://<host>/<code>` (path as given, query and fragment dropped, `http:`
turned into `https:` so the resolver can follow it). Without a resolved ID they
have no embed. `videoKey` is `<platform>:<id>` when an ID exists, otherwise that
normal form of the URL, so `http://pin.it/AbC?si=1` and `https://pin.it/AbC`
are one video. No stored recipe or queue entry is rewritten. The compatibility fixture pins all
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
original short link. One intermediate hop is allowed for Pinterest only:
`https://api.pinterest.com/url_shortener/<code>/redirect/`, the shortener that
`pin.it` links pass through; it is never accepted as the result. Browser parsing and static exports never resolve links.
The oEmbed timeout is a separate five-second budget after resolution.

Facebook embeds use `https://www.facebook.com/plugins/video.php` with a fixed,
encoded canonical `href`. Pinterest uses
`https://assets.pinterest.com/ext/embed.html?id=<id>`. Only YouTube advertises
timestamp seeking; the other helpers ignore `start` and `autoplay`. New platforms
return `null` from `thumbnailUrl`: no stable public poster URL is assumed.

The server requests best-effort oEmbed metadata from YouTube, TikTok, Pinterest
and X's public key-free endpoints, with the existing five-second timeout and
failure fallback. X is asked at `publish.twitter.com`, the host X's oEmbed
documentation names. X often omits a title; an entry with a null title is valid.
Only text titles and author names (trimmed, at most 300 characters) and an
`http(s)` author link are kept from any provider's answer.
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

How the dashboard uses this table:

- `public/ui/core.js` derives `PLATFORM` (labels) and the supported-source copy
  (`PLATFORM_LIST`) from `PLATFORMS`. Every view falls back to a generic label
  ("Video", "the platform") for an unknown id; `test/platform-nits.test.mjs`
  checks that.
- The Add dialog (`public/index.html`, `public/ui/add.js`) has an "It's a web
  page with a video on it" checkbox, off by default. Only while it is ticked does
  it parse with `{ allowWeb: true }` and send `allowWeb: true`; web results are
  labelled as a page to check. The static copy's request names the web source.
- `player()` in `public/ui/recipe.js` shows the original link when `embedUrl`
  is null (X, web pages, unresolved short links). X's oEmbed HTML and widget
  scripts are never used. Every link from data goes through `safeUrl()`
  (`lib/format.mjs`).
- Timestamps are buttons only on YouTube, the one player that can start at a
  given second; elsewhere they are plain text.
- The recipe editor takes its labels from the same table.

Still to check by eye in a browser: Facebook and Pinterest iframe sizing on a
phone, the link-only X and web views, and the web-page opt-in on the live and
static copies.
