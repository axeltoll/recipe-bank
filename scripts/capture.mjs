// Capture creator-owned material outside the repository, using optional tools.
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import path from 'node:path';
import { existsSync, realpathSync } from 'node:fs';
import { mkdir, readFile, readdir, writeFile, stat } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { parseVideoUrl } from '../lib/video.mjs';
import { detectTools, runCommand } from './local-tools.mjs';

export const ROOT = path.resolve(import.meta.dirname, '..');

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

export function assertPrivateCaptureDir(folder, repoRoots = [ROOT]) {
  const requested = path.resolve(folder);
  const physical = physicalPath(requested);
  for (const root of repoRoots) {
    const absoluteRoot = path.resolve(root);
    if (isInside(requested, absoluteRoot) || isInside(physical, physicalPath(absoluteRoot))) {
      throw new Error('Refusing a capture directory inside the repository. Set RECIPE_BANK_CAPTURE_DIR outside all checkouts.');
    }
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

// Pure command planning; commands and arguments stay separate (never a shell).
export function buildCapturePlan({ video, captureDir, tools = {}, modelPath = null, transcribe = false }) {
  const p = path.join;
  const commands = [];
  const warnings = [];
  const add = (id, tool, args, when = 'always') => commands.push({ id, command: tools[tool], args, when });
  const common = ['--ignore-config', '--no-playlist', '--no-progress', '--no-overwrites'];
  const captionTemplate = p(captureDir, 'source.%(ext)s');
  if (tools['yt-dlp']) {
    add('metadata', 'yt-dlp', [...common, '--skip-download', '--write-info-json', '--write-description',
      '--write-subs', '--write-auto-subs', '--sub-langs', 'all,-live_chat', '--sub-format', 'vtt/srt/best',
      '-o', captionTemplate, '--', video.url]);
    const fallback = transcribe ? 'always' : 'no-captions';
    const stt = tools['whisper-ctranslate2'] ? 'whisper-ctranslate2' : tools.whisper ? 'whisper' : null;
    if (stt && modelPath && tools.ffmpeg) {
      add('audio', 'yt-dlp', [...common, '-f', 'bestaudio/best', '-x', '--audio-format', 'wav',
        '-o', p(captureDir, 'audio.%(ext)s'), '--', video.url], fallback);
      add('transcribe', stt, [p(captureDir, 'audio.wav'), '--model', modelPath,
        ...(stt === 'whisper-ctranslate2' ? ['--local_files_only', 'True'] : []),
        '--device', 'cpu', '--output_format', 'json', '--output_dir', captureDir], fallback);
    } else {
      warnings.push('Local transcription needs ffmpeg, whisper-ctranslate2 or whisper, and RECIPE_BANK_STT_MODEL pointing to an existing local model.');
    }
    if (tools.ffmpeg) {
      add('video', 'yt-dlp', [...common, '-f', 'best[ext=mp4]/best', '-o', p(captureDir, 'video.%(ext)s'), '--', video.url]);
      add('frames', 'ffmpeg', ['-nostdin', '-n', '-i', '<downloaded-video>', '-vf', 'fps=1/10,scale=1280:-2',
        '-frames:v', '60', p(captureDir, 'frame-%03d.jpg')]);
      if (tools.tesseract) {
        add('ocr', 'tesseract', ['<frame.jpg>', '<frame-output-base>', '-l', 'eng'], 'each-frame');
      } else warnings.push('tesseract missing: read the captured frame images manually.');
    } else warnings.push('ffmpeg missing: keyframe extraction and local transcription are unavailable.');
  } else warnings.push('yt-dlp missing: no platform content can be captured. Install it and retry.');
  return { video, captureDir, commands, warnings, transcribe };
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

async function usableCaptions(dir) {
  for (const name of await readdir(dir)) {
    if (/^source\..+\.(vtt|srt)$/i.test(name) && hasCaptionText(await readFile(path.join(dir, name), 'utf8'))) return true;
  }
  return false;
}

export async function runCapturePlan(plan, { run = runCommand, repoRoots = [ROOT] } = {}) {
  assertPrivateCaptureDir(plan.captureDir, repoRoots);
  await mkdir(plan.captureDir, { recursive: true, mode: 0o700 });
  assertPrivateCaptureDir(plan.captureDir, repoRoots);
  const report = { video: plan.video, warnings: plan.warnings, results: [] };
  const successful = new Set();
  const execute = async (spec, args = spec.args) => {
    const result = await run(spec.command, args, { cwd: plan.captureDir });
    const ok = result.status === 0 && !result.error;
    if (ok) successful.add(spec.id);
    report.results.push({ id: spec.id, args, status: ok ? 'ok' : 'failed', code: result.status ?? null, error: result.error?.message });
    const logName = spec.id === 'ocr' ? `ocr-${path.basename(args[0], '.jpg')}` : spec.id;
    await writeFile(path.join(plan.captureDir, `${logName}.log`), `${result.stdout ?? ''}\n${result.stderr ?? ''}\n${result.error?.message ?? ''}`, { mode: 0o600 });
  };
  for (const spec of plan.commands) {
    assertPrivateCaptureDir(plan.captureDir, repoRoots);
    if (spec.when === 'no-captions' && await usableCaptions(plan.captureDir)) {
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
    error('Use a supported YouTube, TikTok or Instagram video URL.');
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
