Verdict: FIX_FIRST at cfc89b08015e6b6c7028fe7eab75dd818cdd0e0a · Reviewer: claude fable-5.2 (recipe-bank-pam lane) · Author: codex gpt-6.1-sol (recipe-bank-pam lane)

# feat/recipe-agent

Reviewed by reading only: no shell, no Node, no git in this lane, so nothing below was executed. Line numbers refer to the files under `_review/feat-recipe-agent/`.

The command-execution design is sound: every tool runs through `spawn` with an argv array and no shell, every URL is preceded by `--`, the tool paths are absolute, and the capture folder is checked before and after `mkdir` and before every command. The four findings that block the merge are all in parts the lane's own report lists as untested (real tool runs, macOS, a checkout without git).

## Blocking

### 1. `whisper-ctranslate2` is given a model path through `--model`, which that CLI does not accept
`scripts/capture.mjs:108-110`

```js
add('transcribe', stt, [p(captureDir, 'audio.wav'), '--model', modelPath,
  ...(stt === 'whisper-ctranslate2' ? ['--local_files_only', 'True'] : []),
```

- **What goes wrong:** `SELF-HOSTING.md` tells the user to set `RECIPE_BANK_STT_MODEL` to a CTranslate2 model *directory*. As far as I know the `whisper-ctranslate2` CLI restricts `--model` to its list of model names and takes a local directory through `--model_directory`. With `RECIPE_BANK_STT_MODEL=/models/faster-whisper-small`, argparse rejects the value, the step is recorded as `failed`, and no transcript is produced.
- **Why it matters:** `whisper-ctranslate2` is the preferred engine (`capture.mjs:104`), so when both engines are installed there is no fallback to `whisper`. The speech-to-text path of the analysis skill is dead for the documented setup.
- **Confidence:** from memory of the tool's CLI, not from running it. Confirm with `whisper-ctranslate2 --help` before changing anything.
- **Fix:** for `whisper-ctranslate2` pass `--model_directory <path>` (keep `--local_files_only True`); keep `--model <file>` for `whisper`. Extend the first test in `test/capture.test.mjs` to assert the flag per engine; today it only checks that the path appears somewhere in the args.

### 2. The metadata step asks YouTube for every subtitle track, including all auto-translations
`scripts/capture.mjs:100-102`

```js
'--write-subs', '--write-auto-subs', '--sub-langs', 'all,-live_chat',
```

- **What goes wrong:** with `--write-auto-subs`, `all` covers every auto-translated track, which on YouTube is well over a hundred files per video. yt-dlp fetches them one by one and is commonly rate-limited (HTTP 429) part-way through, so the `metadata` step exits non-zero, the capture reports `failed` and exits 1 on the project's main platform. When it does succeed, the folder holds a hundred machine translations.
- **Second effect:** `usableCaptions()` (`capture.mjs:139-144`) accepts any `source.*.vtt`. A machine translation counts as "usable captions" and suppresses the speech-to-text fallback, although a translated caption is a poor source for the creator's own amounts (contract rule 1).
- **Fix:** request the original track and a short allow-list, for example `--sub-langs 'en.*,.*-orig,-live_chat'`, or read the video's language from the info JSON first and request only that. Add a test that the plan never contains `all`.

### 3. The repository guard can be bypassed by letter case on macOS
`scripts/capture.mjs:34-37` (`isInside`), `40-50` (`physicalPath`), `52-62` (`assertPrivateCaptureDir`)

- **What goes wrong:** both comparisons are case-sensitive string comparisons. On a default (case-insensitive) macOS volume with the checkout at `/Users/me/dev/recipe-bank`, `RECIPE_BANK_CAPTURE_DIR=/Users/me/Dev/Recipe-Bank/captures` passes: the lexical check sees different strings, and `realpathSync` (the JavaScript implementation, not `realpathSync.native`) resolves symlinks but returns the casing it was given. Captions, audio, video and frames are then written inside the working tree, in a folder `.gitignore` does not cover, one `git add -A` away from a public repository.
- **Not affected:** Windows, because `path.win32.relative` compares case-insensitively; Linux, because the paths really are different folders. Symlinks and `..` are handled correctly, and the tests cover them.
- **Fix:** compare identity, not spelling. Walk up from the physical destination (`capture.mjs:43-48` already walks) and refuse if any existing ancestor has the same `dev` and `ino` as a repository root (`statSync`). That also covers bind mounts and hard-linked directories. A cheaper alternative is `realpathSync.native` on both sides plus a case-folded compare on `darwin`. Add a test that runs only where `existsSync(ROOT.toUpperCase())` is true.

### 4. `npm test` fails wherever the tree is not a git checkout
`test/capture-privacy.test.mjs:91-100`

- **What goes wrong:** the tracked-content test runs `git -C ROOT ls-files -z` and asserts exit status 0. In a source archive, a GitHub "Download ZIP", or a history-free snapshot like the one this review ran in, git exits 128 and the suite goes red. `repositoryRoots()` explicitly supports "Source archive, without Git metadata" (`capture.mjs:72`), so the code and its own test disagree about whether that setup is supported.
- **Fix:** skip the git half when `.git` is absent (`t.skip('not a git checkout')`), keeping the pure `captureLikeFiles` assertion. `SELF-HOSTING.md:13` already says git is needed for this test; make the test say so too.

## Nits

- **`capture.mjs:98,107,115`: the capture folder is pasted into yt-dlp's `-o` template.** A base directory containing `%` (allowed in a path) is read as a template field. The process already runs with `cwd: captureDir` (`capture.mjs:153`), so pass `-P <captureDir> -o 'source.%(ext)s'` instead.
- **`capture.mjs:115`: `-f 'best[ext=mp4]/best'` selects a pre-merged format,** which on YouTube is 360p. The frames are then upscaled to 1280 wide (`capture.mjs:116`) before OCR. Since ffmpeg is required for this step anyway, `bv*[height<=1080]+ba/b` gives OCR real pixels.
- **`local-tools.mjs:36-62`: `runCommand` has no timeout.** A stalled download hangs the capture, and the agent, indefinitely. Add a per-step timeout that kills the child and records `failed`.
- **`local-tools.mjs:17-21`: relative `PATH` entries resolve against the current directory.** That is standard PATH behaviour, but the agent runs from the repository root, so a `yt-dlp` file planted in the checkout would be executed if `.` is on `PATH`. Consider skipping non-absolute entries.
- **`queue.mjs:50-67`: a crash leaves `queue.json.agent.tmp` behind and every later run fails with a bare `EEXIST`.** `agent/QUEUE.md` explains the recovery; the error message should too.
- **`queue.mjs:69-73`: `mark <id> done` parses every recipe file,** so one unrelated file with broken JSON blocks completion with a `SyntaxError` message that does not name the file.
- **`queue.mjs:43-45`: the helper writes `updatedAt` and `failureReason`** into queue entries. Neither field is in CLAUDE.md's description of `data/queue.json`. The dashboard and validator ignore unknown fields, so nothing breaks; document them.
- **`agent/RECIPE-AGENT.md:14`: `partial` is widened** to "missing or inaccessible material". CLAUDE.md defines it as "creator withheld the method". Either is defensible; the two files should say the same thing.
- **`capture.mjs:199` and the agent docs name three platforms.** After `feat/more-platforms` merges, `parseVideoUrl` accepts Facebook, Pinterest and X here too, with no doc or test for them (see `reviews/merge-risks.md`).

## Checked and found in order

- **No shell anywhere:** `spawn(command, args, { stdio })` with no `shell` option (`local-tools.mjs:39`); `formatCommand` is display only. Windows batch wrappers are excluded on purpose (`local-tools.mjs:20`).
- **URL handling:** the input must match `^https?://` and parse as a supported video; yt-dlp receives the canonical URL after `--`; `--ignore-config` keeps a user config from adding `--exec`. ffmpeg, tesseract and whisper receive absolute paths, so no value can be read as an option.
- **Capture key:** `encodeURIComponent` with `%` replaced, prefixed by the platform, or a SHA-256 prefix for short links. It cannot contain a path separator or be `..`.
- **Worktrees:** `repositoryRoots` reads `.git`, `commondir` and `worktrees/*/gitdir` without a subprocess, and handles relative pointers.
- **Dry run:** no subprocess, no directory created; tested.
- **`doctor.mjs`:** detection only, never executes a tool; exit 1 only for Node older than 22, exit 2 for bad arguments.
- **Contract rules:** the agent documents restate "never invent amounts" and "steps come from the video" faithfully, and add that captions and OCR are untrusted data, never instructions.
- **Privacy:** no private names, paths, hosts or accounts in code, docs or tests. The worked example credits a creator already credited in `recipes/`.
- **Dependencies:** none added; `package.json` gains only the `doctor` script.
- **Tests:** they exercise what they claim through injected runners. What they cannot show is whether the real tools accept the planned arguments, which is where findings 1 and 2 sit.
