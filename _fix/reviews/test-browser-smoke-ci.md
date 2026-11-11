Verdict: GO WITH NITS at 556d8d65b27a48bfda4efa5c0dd03777627e7b6c · Reviewer: claude fable-5.2 (recipe-bank-pam lane) · Author: codex gpt-6.1-sol (recipe-bank-pam lane)

# test/browser-smoke-ci

Reviewed by reading only: no shell, no Node, no browser in this lane. Line numbers refer to the files under `_review/test-browser-smoke-ci/`.

I found no defect that reading can prove, so this is not FIX_FIRST. One condition comes with the verdict: **this code has never driven a browser.** The lane's report says so, and I could not run it either. The workflow makes the smoke check a required step (`SMOKE_REQUIRED=1`) on every pull request, so if it fails against real Chrome, every later PR is red. Run `npm run smoke` once on a machine with Chrome, or let the first CI run on this PR prove it, before merging. If that run fails, treat the failure as a blocking finding.

## Findings, most severe first

### 1. A crash outside the `try` blocks leaves Chrome running and the profile on disk
`scripts/browser/cdp.mjs:94-107` (`close`), `scripts/browser/support.mjs:63-100` (`withBrowser`)

- **Covered today:** normal completion, a thrown error inside `run`, a failed launch, the first SIGINT or SIGTERM.
- **Not covered:** an exception thrown inside a WebSocket event listener (`cdp.mjs:50`, `JSON.parse` of a frame, or any listener in `cdp.mjs:146-153` and `208-219`) is an uncaught exception. Node exits, nothing calls `close()`, the Chrome child keeps running because it is not tied to the parent, and `recipe-bank-chrome-*` stays in the temp folder. The same happens on an unhandled rejection, and on a second Ctrl-C during cleanup because the handlers are registered with `process.once` (`cdp.mjs:92-93`, `support.mjs:72-73`).
- **Fix:** register `process.on('uncaughtException')` and `process.on('unhandledRejection')` in `launch` that run `close()` and then exit non-zero, plus a synchronous `process.on('exit')` fallback (`child.kill('SIGKILL')` and `rmSync(profile, { recursive: true, force: true })`). Keep the signal handlers installed until `close()` has finished.

### 2. `close()` skips the kill if closing the socket throws
`scripts/browser/cdp.mjs:96-101`

- **What goes wrong:** `connection?.close()` and the kill share one `try`. If `socket.close()` throws, control jumps to `finally`, the profile is removed and the browser is never killed. If `rm` then fails, the rejection replaces the original error in `launch`'s `catch` (`cdp.mjs:230`).
- **Fix:** give each of the three steps its own `try`, kill first, and rethrow the first error at the end.

### 3. Actions are pinned to a moving tag, not a commit
`.github/workflows/ci.yml:16-17`

- **What goes wrong:** `actions/checkout@v4` and `actions/setup-node@v4` follow whatever the tag points at. The damage is limited here (`contents: read`, no secrets, `pull_request` not `pull_request_target`), but the brief asks for pinned actions.
- **Fix:** pin both to full commit SHAs with the version in a comment, and add `with: { persist-credentials: false }` to checkout so the token is not left in `.git/config` for the later `npm` steps.

### 4. The confinement and cleanup claims have no test
`test/cdp.test.mjs`, `test/browser-layout.test.mjs`

- **What is tested:** binary lookup, stderr parsing, the `Connection` class and `layoutIssues`.
- **What is not:** `staticServer` (`support.mjs:24-34`) and `launch`/`close`. The path-traversal check is correct as written (see below), but one refactor can break it silently.
- **Fix:** add a test that starts `staticServer(tmpDir)` on port 0 and requests `/..%2f..%2fetc/passwd`, `/%2e%2e/x`, `/%00`, `/%` and a directory, expecting 403 or 404; and a `launch` test with a fake executable script that prints a DevTools line, asserting the profile folder is gone after `close()`.

### 5. Only the main browser process is killed
`scripts/browser/cdp.mjs:99`

- **What goes wrong:** `child.kill('SIGKILL')` hits the browser process. Renderers, the GPU process and the crash handler normally exit when their parent disappears, and `rm` has `maxRetries: 3` for the files they still hold, so this probably works. On Windows the children can outlive `TerminateProcess` long enough for `rm` to fail.
- **Fix:** send `Browser.close` over the connection first, wait up to a second or two for `exit`, and use SIGKILL as the fallback.

## Smaller nits

- **`cdp.mjs:123-125`: after startup the child has no `error` listener.** A later `error` event (a failed kill, for example) is an uncaught exception; see finding 1. Keep a no-op listener.
- **`cdp.mjs:10-25`: `findChrome` reads `env.PATH` only.** An injected Windows environment that spells it `Path` finds nothing; `process.env` itself is case-insensitive on Windows, so real use is fine.
- **`smoke.mjs:70-72`: the creator-search check needs at least two creators** in `recipes/`. True today; say so in the assertion message.
- **`smoke.mjs:135`: the queue check pins the hint text** `Not a supported video link yet`. Any lane that rewords it (the redesign) breaks the check; see `reviews/merge-risks.md`.
- **`device-check.mjs:10` and `smoke.mjs:19`: a bad `--only` value throws at top level** with a stack trace instead of the `FAIL:` line the other errors get.
- **README:** the added paragraph is accurate; nothing private.

## Checked and found in order

- **Workflow:** `permissions: contents: read` at top level; triggers are `push` to `main` and `pull_request`; no `pull_request_target`, no secrets, no deploy, a 10-minute timeout.
- **No `--no-sandbox`:** not passed anywhere, and nothing disables site isolation or web security.
- **Debug port:** `--remote-debugging-port=0` binds to loopback on an ephemeral port; the URL is read from stderr with a parser that survives split chunks.
- **No third-party traffic:** `--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost` plus `Fetch` interception that fulfils every non-local request locally (`cdp.mjs:204-220`). Fonts, thumbnails and video embeds never leave the machine.
- **Static server confined to `dist/`** (`support.mjs:24-34`): the path is decoded, resolved against the root and required to start with `root + sep`. `/..%2f..%2fetc/passwd` decodes to a path outside the root and gets 403; a malformed `%`, a NUL byte and a directory all end in the `catch` as 404. It listens on `127.0.0.1` only.
- **Live server:** `server.mjs` only gains `export`; it still listens only when run directly. The smoke run binds it to `127.0.0.1:0`.
- **No queue writes:** the queue check types an unsupported link and reads the hint; it never submits.
- **Selectors:** every selector in `smoke.mjs:2-10` exists in `public/app.js` and `public/index.html` on main, and the handlers behind them render synchronously, so reading the DOM straight after a click is sound.
- **Unit tests:** I traced each assertion in `cdp.test.mjs` and `browser-layout.test.mjs` by hand; they hold, and every pending timer is cleared.
- **Dependencies:** none; Node 22's built-in `WebSocket`.

## For the PAM to verify with a real browser

1. **Handshake:** Chrome refuses DevTools WebSocket connections that send an `Origin` header unless `--remote-allow-origins` is set. Node's built-in client should send none; if the handshake returns 403, that is the cause.
2. **Runner Chrome:** `/usr/bin/google-chrome` must exist on `ubuntu-latest` and start without `--no-sandbox` under the runner's AppArmor rules. If it does not, fix the runner setup; do not add `--no-sandbox`.
3. **Keyboard check** (`smoke.mjs:100-128`): Tab has to pass through a cross-origin iframe whose document was fulfilled as empty HTML. This is the most likely flaky step.
4. **Leftovers:** after a run, and after a Ctrl-C mid-run, no Chrome process and no `recipe-bank-chrome-*` folder remain.
