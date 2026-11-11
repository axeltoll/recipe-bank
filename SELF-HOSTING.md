# Self-hosting Recipe Bank

## Install and run

Install Node.js **22 or newer** and Git, then clone the repository and start the dashboard. There are no npm dependencies to install and no build step for local use.

```sh
git clone https://github.com/axeltoll/recipe-bank.git
cd recipe-bank
npm start
```

Open `http://127.0.0.1:4780`. The dashboard and recipe validator work with Node alone. `npm run dev` restarts the server when its code changes. Use `npm test` and `npm run validate` to check local changes; Git is needed for the tracked-capture privacy test, which is skipped in a copy without `.git` (a source archive).

The server listens on `127.0.0.1` only (set `HOST` to change that). It refuses changes (adding to the queue, saving recipes, importing packs) that are not sent as `application/json` or that come from another website (`Origin`, `Sec-Fetch-Site`), and changes addressed to a host name that is not this machine's loopback name. To use the dashboard under another name, such as `kitchen.lan`, list it in `RECIPE_BANK_HOSTS` (comma-separated). A loopback name such as `127.0.0.1` only counts for requests from this machine: with `HOST` set to a reachable address, other devices must use a listed name or that address. `RECIPE_BANK_DIR` points the server and scripts at another folder holding `recipes/` and `data/`; keep it a folder only you use. The static build (`npm run build`, `npm run deploy`) ignores it and always publishes this repository's recipes and queue.

## Optional capture tools

Run `npm run doctor` for found/missing checks and install hints. A missing capture tool is informational; exit code 1 means Node is too old. The check looks on `PATH` and does not run tools, access the network, validate tool versions or fetch models. For machine-readable output use `npm run --silent doctor -- --json` (or `node scripts/doctor.mjs --json`). Incorrect CLI arguments exit 2.

| Tool | Purpose | Linux | macOS | Windows |
|---|---|---|---|---|
| `yt-dlp` | Captions, description, metadata and optional audio/video downloads | Distro package or `pipx install yt-dlp` | `brew install yt-dlp` | Install the standalone executable and add its directory to `PATH` |
| `ffmpeg` | Audio conversion and sampled frames | Distro `ffmpeg` package | `brew install ffmpeg` | Install FFmpeg and add `bin` to `PATH` |
| `whisper-ctranslate2` or `whisper` | Local speech-to-text | `pipx install whisper-ctranslate2` or `pipx install openai-whisper` | Same pipx packages (Python required) | Same pipx packages (Python required); expose the executable on `PATH` |
| `tesseract` | English on-screen text (OCR) | Distro `tesseract-ocr` or `tesseract` plus English language data | `brew install tesseract` | Install Tesseract OCR with English language data; add it to `PATH` |

Tool installation and model provisioning are separate, user-controlled steps that may require downloads. A local model is required for transcription: set `RECIPE_BANK_STT_MODEL` to an existing **absolute path**, a CTranslate2 model directory for `whisper-ctranslate2` (passed as `--model_directory`, with `--local_files_only True`) or a Whisper model file for `whisper` (passed as `--model`). Check with `whisper-ctranslate2 --help` that your version has `--model_directory`. When both CLIs are installed, `whisper-ctranslate2` takes precedence; provide its model format. The helper never supplies a model name that would initiate an automatic model download. CLI variants with other names/flags are not automatically supported. `ffmpeg` must be on `PATH` for both the downloader and the speech engine. Transcription uses CPU so no GPU setup is required.

## Run the Recipe Agent

Use the coding agent you already have, launched from the repository root. Its normal account, model and installation requirements still apply; Recipe Bank adds no hosted analysis service. Read [agent/RECIPE-AGENT.md](agent/RECIPE-AGENT.md) for the task and [the analysis skill](agent/skills/recipe-video-analysis/SKILL.md) for the capture workflow.

| Harness | Entry and invocation |
|---|---|
| Codex / AGENTS.md-aware tools | The root `AGENTS.md` links to the shared instructions. Ask: “Follow agent/RECIPE-AGENT.md and analyze the oldest queued video.” Or give a supported link. |
| Claude Code | The root `CLAUDE.md` links to the shared instructions and `agent/CLAUDE.md`. Use the same request, naming the shared file explicitly. |
| Persona-file agents | Load `agent/SOUL.md` in the harness's persona configuration, then point it at this checkout and a video or queue entry. |
| Other coding agents | Explicitly ask the tool to read `agent/RECIPE-AGENT.md` and its linked skill before analyzing. The skill lives in standard Agent Skills format, but discovery paths depend on your harness. |

Add a supported video through the local dashboard, or give the agent its original link. Inspect a capture plan yourself before downloading:

```sh
node scripts/capture.mjs --dry-run https://www.youtube.com/shorts/mhNQ8y5ud0A
```

Dry run prints commands and warnings, reads only local configuration/tool locations, and creates no directories or captured files. Remove `--dry-run` to perform capture when you are ready and authorized to access that video. The script runs `yt-dlp` first for the description and metadata, then for captions in the video's own language only (the language from the metadata: the creator's captions and the automatic ones, never automatic translations; without a known language only the original automatic track). If usable captions in that language exist it skips audio/transcription; `--transcribe` requests local transcription even with captions. Transcription is skipped when its engine, model or FFmpeg is missing. With FFmpeg installed, it also downloads a video file (up to 1080p) for sampled frames; with Tesseract installed, it runs OCR on those images. Each step has a time limit (two minutes for metadata and captions, up to thirty for transcription; `STEP_TIMEOUTS` in `scripts/capture.mjs`); a stalled tool is stopped and recorded as failed. Tools are looked up only in absolute `PATH` entries.

The helper collects evidence; the coding agent reads it and writes the recipe. It does not generate recipe JSON by itself. Captures include `capture-report.json` with per-step results; failed commands return exit code 1 but other independent capture steps are still attempted. Files are reused without overwriting downloader output; use a fresh external capture base to retry with a clean store. Frames are sampled every ten seconds with a sixty-frame cap. Review unsampled moments when needed instead of assuming the samples show the entire method.

## Private capture storage

`scripts/capture.mjs` keeps creator-owned material outside the repository. `RECIPE_BANK_CAPTURE_DIR` is an absolute **base directory**; the helper adds a stable video subfolder. Otherwise it uses the OS data directory:

| OS | Capture base |
|---|---|
| Linux | `$XDG_DATA_HOME/recipe-bank/captures` or `$HOME/.local/share/recipe-bank/captures` |
| macOS | `$HOME/Library/Application Support/recipe-bank/captures` |
| Windows | `%LOCALAPPDATA%\recipe-bank\captures` (falls back to the user's `AppData\Local`) |

The portable video key is `platform-id` (for example `youtube-mhNQ8y5ud0A`). Unresolved TikTok short links use a stable URL hash until their canonical ID is known. Use a canonical link when possible to avoid duplicate capture folders.

The helper reads local Git metadata to reject destinations inside the current repository, its main checkout and linked worktrees, including ignored directories and symlinks into a checkout. It compares folders by identity (device and inode), not by spelling, so another letter case on a case-insensitive macOS or Windows volume is refused too. Dry run starts no subprocesses. `evidence/` stays ignored for compatibility; do not use it as the capture store. A test rejects tracked captions, audio and video, and raster frame images outside `docs/`. Store descriptions, transcripts and metadata outside the repository too; the extension guard cannot identify every kind of captured text.

Captures may include captions, description, metadata, local audio/video, timestamped transcription, sampled frame images, OCR text, tool logs and `capture-report.json`. Do not publish these or put them in commits, issues or support messages. Local creation requests owner-only permissions where the OS supports them; manage access, backups, disk usage and deletion yourself. Delete a video's capture folder when you no longer need it.

You are responsible for complying with each platform's terms and obtaining permission to capture content. Do not bypass login requirements, paywalls or other access restrictions. Recipes should credit the creator and link to the original, using your own wording for the method. See [the shared agent instructions](agent/RECIPE-AGENT.md).

## Worked example without downloading

Open [recipes/gochujang-chicken-thighs.json](recipes/gochujang-chicken-thighs.json), an existing analyzed recipe credited to Eat Like an Adult. This is a format walk-through using the existing file; it does not reanalyze the video or add a duplicate.

1. Its video ID is `mhNQ8y5ud0A`. The dry-run command above plans an external `youtube-mhNQ8y5ud0A` capture folder. Check for an existing recipe before capturing: this video is already present, so leave that file unchanged.
2. In the `Chicken` component, “2 per person” has basis `spoken`. Cucumbers have `amount: null` and `basis: "unstated"`. The agent retains that distinction instead of estimating a weight from the picture.
3. The cold-pan step has `t: 17`, allowing the dashboard to play from that moment. The chicken oven temperature is listed as a gap; the potato temperature cannot be reused for it. Gaps can accompany an analyzed recipe; use `partial` when the video itself does not give the whole method (see CLAUDE.md). Evidence you could not access is a limitation to record or a reason to fail the analysis, not a reason for `partial`.
4. For a new video, the agent follows the same structure only from that video's actual evidence, reuses ingredient keys such as `chicken` and `cucumber`, and records what it checked. Run `npm run validate` to see this example and all current recipes pass the contract.
5. For a queued analysis, stop the dashboard, inspect `node scripts/queue.mjs next`, claim the ID with `mark <id> analyzing`, and remove it with `mark <id> done` only after the matching recipe validates. See [the full queue procedure](agent/QUEUE.md), including failures and retries. Direct links work without creating a queue entry.

## Troubleshooting

- **Missing tools:** rerun `npm run doctor` in the same terminal as the agent. Restart the terminal after changing `PATH`. Without `yt-dlp`, the capture helper reports the missing tool and exits; the dashboard still runs.
- **No speech-to-text:** verify the CLI name and `RECIPE_BANK_STT_MODEL`, its format and local dependencies. Caption-only analysis is still possible. A found engine does not mean a model is installed. The helper refuses a nonexistent model path.
- **No captions or access denied:** inspect the report and tool logs in the private store. Captions may be unavailable, automatic or in another language. Failed platform access must be recorded as a limitation. Retry only with access you are allowed to use; do not guess a recipe from a title.
- **Poor OCR:** the helper uses English OCR; review frames manually for other languages or handwriting. A missing English language pack may fail OCR while leaving the frames usable.
- **Capture directory refused:** use an absolute external directory in `RECIPE_BANK_CAPTURE_DIR`. Relative paths, directories within any checkout and symlinks back into a checkout are refused. Do not move captured content into `evidence/` to work around the guard.
- **Stale queue or concurrent edits:** stop the dashboard before using the queue helper; see [agent/QUEUE.md](agent/QUEUE.md). Validate the recipe before removing its queue entry.
- **Validation fails:** follow the errors from `npm run validate` against `lib/recipe.mjs`. Missing facts become unstated amounts or explicit gaps, never guessed values. Existing recipes demonstrate the format; they are not evidence for a new video.
