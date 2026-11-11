// Capture creator-owned material outside the repository, using optional tools.
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import path from 'node:path';
import { existsSync, realpathSync, statSync } from 'node:fs';
import { mkdir, readFile, readdir, writeFile, stat } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { parseVideoUrl, PLATFORMS } from '../lib/video.mjs';
import { detectTools, runCommand } from './local-tools.mjs';

export const ROOT = path.resolve(import.meta.dirname, '..');

// "YouTube, TikTok, Instagram, Facebook, Pinterest or X": every source lib/video.mjs parses without the
// web-page opt-in. Whether yt-dlp can fetch a given post is up to yt-dlp and the platform.
export const SOURCES = (() => {
  const labels = PLATFORMS.filter((p) => p.id !== 'web').map((p) => p.label);
  return `${labels.slice(0, -1).join(', ')} or ${labels.at(-1)}`;
})();

// videoKey's colon is not portable to Windows filenames; short URLs use a hash.
export function captureKey(video) {
  const id = video.id ? encodeURIComponent(video.id).replaceAll('%', '_')
    : createHash('sha256').update(video.url).digest('hex').slice(0, 24);
  return `${video.platform}-${id}`;
}

export function resolveCaptureDir(video, { env = process.env, platform = process.platform, home = homedir() } = {}) {
  const p = platform === 'win32' ? path.win32 : path.posix;
  let base = env.RECIPE_BANK_CAPTURE_DIR;
  if (!base) {
    const data = platform === 'darwin' ? p.join(home, 'Library', 'Application Support')
      : platform === 'win32' ? env.LOCALAPPDATA || p.join(home, 'AppData', 'Local')
        : env.XDG_DATA_HOME || p.join(home, '.local', 'share');
    if (!p.isAbsolute(data)) throw new Error('The per-user data directory must be absolute.');
    base = p.join(data, 'recipe-bank', 'captures');
  }
  if (!p.isAbsolute(base)) throw new Error('RECIPE_BANK_CAPTURE_DIR must be an absolute directory.');
  return p.join(base, captureKey(video));
}

export function isInside(folder, root) {
  const rel = path.relative(root, folder);
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel));
}

// Resolve existing symlink ancestors even when the leaf directory does not exist.
function physicalPath(folder) {
  let parent = path.resolve(folder);
  const suffix = [];
  while (!existsSync(parent)) {
    const next = path.dirname(parent);
    if (next === parent) throw new Error('Cannot resolve capture destination.');
    suffix.unshift(path.basename(parent));
    parent = next;
  }
  return path.join(realpathSync(parent), ...suffix);
}

/**
 * The identity of an existing directory: device and inode (exact, as bigints). Two spellings of one folder
 * have the same identity: letter case on a case-insensitive volume (macOS, Windows), a symlink, a bind
 * mount. Throws when the path does not exist.
 */
export function directoryIdentity(folder) {
  const s = statSync(folder, { bigint: true });
  return `${s.dev}:${s.ino}`;
}

/** Identities of the folder and each of its ancestors that exist, nearest first. */
function ancestorIdentities(folder, identify) {
  const ids = [];
  let current = path.resolve(folder);
  for (;;) {
    try { ids.push(identify(current)); } catch { /* does not exist (yet) */ }
    const next = path.dirname(current);
    if (next === current) return ids;
    current = next;
  }
}

const INSIDE_REPOSITORY = 'Refusing a capture directory inside the repository. Set RECIPE_BANK_CAPTURE_DIR outside all checkouts.';

/**
 * Throws unless `folder` is outside every repository root. Compared three ways: by spelling, by the
 * physical path (symlinks resolved), and by identity, so that /Users/me/Dev/Recipe-Bank on a
 * case-insensitive volume is still recognised as /Users/me/dev/recipe-bank. `identify` is for tests.
 */
export function assertPrivateCaptureDir(folder, repoRoots = [ROOT], { identify = directoryIdentity } = {}) {
  const requested = path.resolve(folder);
  const physical = physicalPath(requested);
  const rootIds = new Set();
  for (const root of repoRoots) {
    const absoluteRoot = path.resolve(root);
    if (isInside(requested, absoluteRoot) || isInside(physical, physicalPath(absoluteRoot))) throw new Error(INSIDE_REPOSITORY);
    try { rootIds.add(identify(absoluteRoot)); } catch { /* a root that does not exist contains nothing */ }
  }
  for (const id of [...ancestorIdentities(requested, identify), ...ancestorIdentities(physical, identify)]) {
    if (rootIds.has(id)) throw new Error(INSIDE_REPOSITORY);
  }
  return requested;
}

export async function repositoryRoots({ root = ROOT, info = stat, read = readFile, list = readdir } = {}) {
  // Read worktree pointers directly so even dry-run executes no subprocesses.
  const optional = async (operation) => {
    try { return await operation(); }
    catch (err) { if (err.code === 'ENOENT') return null; throw err; }
  };
  const marker = path.join(root, '.git');
  const metadata = await optional(() => info(marker));
  if (!metadata) return [root]; // Source archive, without Git metadata.
  let gitDir = marker;
  if (!metadata.isDirectory()) {
    const pointer = (await read(marker, 'utf8')).trim().match(/^gitdir: (.+)$/);
    if (!pointer) throw new Error('Cannot resolve repository Git metadata.');
    gitDir = path.resolve(root, pointer[1]);
  }
  const common = await optional(() => read(path.join(gitDir, 'commondir'), 'utf8'));
  const commonDir = common ? path.resolve(gitDir, common.trim()) : gitDir;
  const roots = [root];
  if (path.basename(commonDir) === '.git') roots.push(path.dirname(commonDir));
  const worktrees = path.join(commonDir, 'worktrees');
  for (const name of await optional(() => list(worktrees)) ?? []) {
    const pointer = await optional(() => read(path.join(worktrees, name, 'gitdir'), 'utf8'));
    if (pointer) roots.push(path.dirname(path.resolve(worktrees, name, pointer.trim())));
  }
  return [...new Set(roots)];
}

/** How long each step may run before it is stopped and recorded as failed, in milliseconds. */
export const STEP_TIMEOUTS = Object.freeze({
  metadata: 2 * 60_000,
  captions: 2 * 60_000,
  audio: 10 * 60_000,
  transcribe: 30 * 60_000,
  video: 15 * 60_000,
  frames: 5 * 60_000,
  ocr: 60_000, // per frame
});

/** Placeholder in the captions step, replaced by captionLanguages() once the video's language is known. */
export const CAPTION_LANGS = '<caption-languages>';

const LANGUAGE = /^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/i;

/**
 * yt-dlp's --sub-langs for a video whose language is `language` (from its info JSON). Only the original
 * language: the creator's own captions and the automatic captions in that language ("en", "en-GB",
 * "en-orig"). Never "all": on YouTube that is every automatic translation, a hundred or more files,
 * fetched one by one until the platform rate-limits the capture, and a translation is no source for
 * the creator's amounts. Without a known language only the "-orig" automatic track is asked for.
 */
export function captionLanguages(language) {
  if (typeof language !== 'string' || !LANGUAGE.test(language)) return '.*-orig';
  const base = language.split('-')[0].toLowerCase();
  // "all" is a real language code (Allar), but yt-dlp reads the bare word as every track. "al[l]" is a pattern
  // for the same code that yt-dlp does not take as that keyword.
  const pattern = base === 'all' ? 'al[l]' : base;
  return `${pattern},${pattern}-.*`;
}

/** True for a caption file name the capture asked for: `source.<lang>.vtt|srt` in the original language. */
export function isOriginalCaption(name, language) {
  const m = /^source\.(.+)\.(?:vtt|srt)$/i.exec(name);
  if (!m) return false;
  const lang = m[1].toLowerCase();
  if (typeof language !== 'string' || !LANGUAGE.test(language)) return lang.endsWith('-orig');
  const base = language.split('-')[0].toLowerCase();
  return lang === base || lang.startsWith(`${base}-`);
}

// Pure command planning; commands and arguments stay separate (never a shell). yt-dlp writes into the
// capture folder through -P, so the folder name is never read as an output template (a "%" in it would be).
export function buildCapturePlan({ video, captureDir, tools = {}, modelPath = null, transcribe = false, timeouts = STEP_TIMEOUTS }) {
  const p = path.join;
  const commands = [];
  const warnings = [];
  const add = (id, tool, args, when = 'always') => commands.push({ id, command: tools[tool], args, when, timeout: timeouts[id] ?? 0 });
  const common = ['--ignore-config', '--no-playlist', '--no-progress', '--no-overwrites', '-P', captureDir];
  if (tools['yt-dlp']) {
    add('metadata', 'yt-dlp', [...common, '--skip-download', '--write-info-json', '--write-description',
      '-o', 'source.%(ext)s', '--', video.url]);
    add('captions', 'yt-dlp', [...common, '--skip-download', '--write-subs', '--write-auto-subs',
      '--sub-langs', CAPTION_LANGS, '--sub-format', 'vtt/srt/best', '-o', 'source.%(ext)s', '--', video.url]);
    const fallback = transcribe ? 'always' : 'no-captions';
    const stt = tools['whisper-ctranslate2'] ? 'whisper-ctranslate2' : tools.whisper ? 'whisper' : null;
    if (stt && modelPath && tools.ffmpeg) {
      add('audio', 'yt-dlp', [...common, '-f', 'bestaudio/best', '-x', '--audio-format', 'wav',
        '-o', 'audio.%(ext)s', '--', video.url], fallback);
      // whisper-ctranslate2 takes a local CTranslate2 model folder through --model_directory (its --model
      // only accepts model names); openai-whisper takes a name or a checkpoint file through --model.
      const model = stt === 'whisper-ctranslate2'
        ? ['--model_directory', modelPath, '--local_files_only', 'True']
        : ['--model', modelPath];
      add('transcribe', stt, [p(captureDir, 'audio.wav'), ...model,
        '--device', 'cpu', '--output_format', 'json', '--output_dir', captureDir], fallback);
    } else {
      warnings.push('Local transcription needs ffmpeg, whisper-ctranslate2 or whisper, and RECIPE_BANK_STT_MODEL pointing to an existing local model.');
    }
    if (tools.ffmpeg) {
      // Real pixels for OCR: up to 1080p video merged with audio by ffmpeg, not the 360p pre-merged file.
      add('video', 'yt-dlp', [...common, '-f', 'bv*[height<=1080]+ba/b', '-o', 'video.%(ext)s', '--', video.url]);
      // ffmpeg reads "%" in its output name as a frame number, so the output is a bare name in the capture folder
      // (the runner's cwd), never the folder path.
      add('frames', 'ffmpeg', ['-nostdin', '-n', '-i', '<downloaded-video>', '-vf', 'fps=1/10,scale=1280:-2',
        '-frames:v', '60', 'frame-%03d.jpg']);
      if (tools.tesseract) {
        add('ocr', 'tesseract', ['<frame.jpg>', '<frame-output-base>', '-l', 'eng'], 'each-frame');
      } else warnings.push('tesseract missing: read the captured frame images manually.');
    } else warnings.push('ffmpeg missing: keyframe extraction and local transcription are unavailable.');
  } else warnings.push('yt-dlp missing: no platform content can be captured. Install it and retry.');
  return { video, captureDir, commands, warnings, transcribe };
}

/** The video's language from the captured info JSON, or null. */
async function videoLanguage(dir) {
  try {
    const info = JSON.parse(await readFile(path.join(dir, 'source.info.json'), 'utf8'));
    return typeof info?.language === 'string' && LANGUAGE.test(info.language) ? info.language : null;
  } catch {
    return null;
  }
}

export function formatCommand(command) {
  // JSON quoting is for display only; execution passes an argv array to spawn.
  return [command.command, ...command.args].map((s) => JSON.stringify(s)).join(' ');
}

export function hasCaptionText(text) {
  return text.split(/\r?\n/).some((line) => {
    const clean = line.replace(/<[^>]*>/g, '').trim();
    return clean && !/^(WEBVTT|NOTE|Kind:|Language:|STYLE|REGION|\d+$)/i.test(clean)
      && !line.includes('-->') && /[\p{L}]/u.test(clean);
  });
}

// Only captions in the video's own language count: a machine translation must not stand in for the
// creator's words and suppress local transcription.
async function usableCaptions(dir, language) {
  for (const name of await readdir(dir)) {
    if (isOriginalCaption(name, language) && hasCaptionText(await readFile(path.join(dir, name), 'utf8'))) return true;
  }
  return false;
}

export async function runCapturePlan(plan, { run = runCommand, repoRoots = [ROOT] } = {}) {
  assertPrivateCaptureDir(plan.captureDir, repoRoots);
  await mkdir(plan.captureDir, { recursive: true, mode: 0o700 });
  assertPrivateCaptureDir(plan.captureDir, repoRoots);
  const report = { video: plan.video, warnings: plan.warnings, language: null, results: [] };
  const successful = new Set();
  const execute = async (spec, args = spec.args) => {
    const result = await run(spec.command, args, { cwd: plan.captureDir, timeout: spec.timeout ?? 0 });
    const ok = result.status === 0 && !result.error;
    if (ok) successful.add(spec.id);
    report.results.push({ id: spec.id, args, status: ok ? 'ok' : 'failed', code: result.status ?? null, error: result.error?.message });
    const logName = spec.id === 'ocr' ? `ocr-${path.basename(args[0], '.jpg')}` : spec.id;
    await writeFile(path.join(plan.captureDir, `${logName}.log`), `${result.stdout ?? ''}\n${result.stderr ?? ''}\n${result.error?.message ?? ''}`, { mode: 0o600 });
  };
  for (const spec of plan.commands) {
    assertPrivateCaptureDir(plan.captureDir, repoRoots);
    if (spec.id === 'captions') {
      report.language = await videoLanguage(plan.captureDir);
      const langs = captionLanguages(report.language);
      await execute(spec, spec.args.map((arg) => (arg === CAPTION_LANGS ? langs : arg)));
      continue;
    }
    if (spec.when === 'no-captions' && await usableCaptions(plan.captureDir, report.language)) {
      report.results.push({ id: spec.id, status: 'skipped', reason: 'Usable captions exist; read them before requesting transcription.' });
      continue;
    }
    if (spec.id === 'transcribe' && !successful.has('audio')) {
      report.results.push({ id: spec.id, status: 'skipped', reason: 'Audio download failed.' });
      continue;
    }
    if (spec.id === 'frames') {
      const file = (await readdir(plan.captureDir)).find((name) => /^video\.(mp4|webm|mkv|mov|flv|avi|m4v)$/i.test(name));
      if (!successful.has('video') || !file) {
        report.results.push({ id: spec.id, status: 'skipped', reason: 'No downloaded video available.' });
        continue;
      }
      await execute(spec, spec.args.map((arg) => arg === '<downloaded-video>' ? path.join(plan.captureDir, file) : arg));
    } else if (spec.id === 'ocr') {
      const frames = (await readdir(plan.captureDir)).filter((name) => /^frame-\d+\.jpg$/.test(name)).sort();
      if (!successful.has('frames') || !frames.length) {
        report.results.push({ id: spec.id, status: 'skipped', reason: 'No keyframes available.' });
        continue;
      }
      for (const frame of frames) await execute(spec, [path.join(plan.captureDir, frame), path.join(plan.captureDir, frame.slice(0, -4)), '-l', 'eng']);
    } else await execute(spec);
  }
  await writeFile(path.join(plan.captureDir, 'capture-report.json'), JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
  return report;
}

export async function captureMain(args, { env = process.env, lookup, run = runCommand, log = console.log, error = console.error } = {}) {
  const flags = new Set(['--dry-run', '--transcribe']);
  const urls = args.filter((arg) => !arg.startsWith('--'));
  if (urls.length !== 1 || args.some((arg) => arg.startsWith('--') && !flags.has(arg))) {
    error('Usage: node scripts/capture.mjs [--dry-run] [--transcribe] <url>');
    return 1;
  }
  const video = parseVideoUrl(urls[0]);
  if (!video || !/^https?:\/\//i.test(urls[0])) {
    error(`Use a supported ${SOURCES} video URL.`);
    return 1;
  }
  try {
    const roots = await repositoryRoots();
    const captureDir = assertPrivateCaptureDir(resolveCaptureDir(video, { env }), roots);
    const modelPath = env.RECIPE_BANK_STT_MODEL;
    if (modelPath && (!path.isAbsolute(modelPath) || !existsSync(modelPath))) throw new Error('RECIPE_BANK_STT_MODEL must point to an existing absolute local model path.');
    const plan = buildCapturePlan({ video, captureDir, tools: detectTools(lookup), modelPath, transcribe: args.includes('--transcribe') });
    log(`Capture directory: ${captureDir}`);
    for (const warning of plan.warnings) log(`Warning: ${warning}`);
    for (const cmd of plan.commands) log(`[${cmd.when}] ${formatCommand(cmd)}`);
    if (args.includes('--dry-run')) { log('Dry run: no directories created or capture tools executed.'); return 0; }
    if (!plan.commands.length) return 1;
    const report = await runCapturePlan(plan, { run, repoRoots: roots });
    log('Read capture-report.json and the captured evidence before writing a recipe.');
    return report.results.some((r) => r.status === 'failed') ? 1 : 0;
  } catch (err) { error(err.message); return 1; }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  process.exitCode = await captureMain(process.argv.slice(2));
}
