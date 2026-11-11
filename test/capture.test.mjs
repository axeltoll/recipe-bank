import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buildCapturePlan, captureMain, captureKey, formatCommand, hasCaptionText, runCapturePlan } from '../scripts/capture.mjs';
import { parseVideoUrl } from '../lib/video.mjs';

const video = parseVideoUrl('https://www.youtube.com/shorts/mhNQ8y5ud0A');
const tools = Object.fromEntries(['yt-dlp', 'ffmpeg', 'whisper-ctranslate2', 'whisper', 'tesseract'].map((name) => [name, name]));
const planFor = (overrides = {}) => buildCapturePlan({ video, captureDir: '/captures/example', tools, modelPath: '/models/local', ...overrides });

test('plans caption/description retrieval before conditional audio, transcription, video, frames and OCR', () => {
  const plan = planFor();
  assert.deepEqual(plan.commands.map((c) => c.id), ['metadata', 'audio', 'transcribe', 'video', 'frames', 'ocr']);
  const [metadata, audio, stt, download, frames, ocr] = plan.commands;
  for (const flag of ['--write-info-json', '--write-description', '--write-subs', '--write-auto-subs', '--skip-download']) assert.ok(metadata.args.includes(flag));
  for (const command of [metadata, audio, download]) {
    assert.ok(command.args.includes('--ignore-config'));
    assert.deepEqual(command.args.slice(-2), ['--', video.url]);
  }
  assert.equal(audio.when, 'no-captions');
  assert.equal(stt.when, 'no-captions');
  assert.equal(stt.command, 'whisper-ctranslate2');
  assert.ok(stt.args.includes('--local_files_only'));
  assert.ok(stt.args.includes('/models/local'));
  assert.ok(frames.args.includes('fps=1/10,scale=1280:-2'));
  assert.ok(frames.args.includes('60'));
  assert.equal(ocr.when, 'each-frame');
  assert.match(formatCommand(metadata), /"yt-dlp"/);
});

test('plans adapt to each missing optional tool, with no downloads for missing yt-dlp', () => {
  for (const tool of Object.keys(tools)) {
    const available = { ...tools, [tool]: null };
    if (tool === 'whisper-ctranslate2') {
      assert.equal(planFor({ tools: available }).commands.find((c) => c.id === 'transcribe').command, 'whisper');
    }
    const plan = planFor({ tools: available });
    assert.ok(plan.commands.every((c) => c.command));
    if (tool === 'yt-dlp') assert.equal(plan.commands.length, 0);
    if (tool === 'ffmpeg') assert.deepEqual(plan.commands.map((c) => c.id), ['metadata']);
    if (tool === 'tesseract') assert.ok(!plan.commands.some((c) => c.id === 'ocr'));
  }
  for (const overrides of [{ modelPath: null }, { tools: { ...tools, whisper: null, 'whisper-ctranslate2': null } }]) {
    const plan = planFor(overrides);
    assert.ok(!plan.commands.some((c) => ['audio', 'transcribe'].includes(c.id)));
    assert.ok(plan.warnings.some((w) => w.includes('Local transcription')));
  }
  assert.deepEqual(planFor({ tools: {} }).commands, []);
  assert.equal(planFor({ transcribe: true }).commands.find((c) => c.id === 'audio').when, 'always');
});

test('supported platforms and short-link keys produce portable, distinct capture names', () => {
  const urls = ['https://youtu.be/mhNQ8y5ud0A', 'https://www.tiktok.com/@cook/video/123456',
    'https://www.instagram.com/reel/ABC_def/', 'https://vm.tiktok.com/abc/'];
  for (const url of urls) {
    const parsed = parseVideoUrl(url);
    assert.match(captureKey(parsed), /^[a-z]+-[a-zA-Z0-9_-]+$/);
    assert.equal(planFor({ video: parsed }).commands[0].args.at(-1), parsed.url);
  }
  assert.notEqual(captureKey(parseVideoUrl(urls.at(-1))), captureKey(parseVideoUrl('https://vm.tiktok.com/def/')));
});

test('empty subtitles do not suppress transcription', () => {
  assert.equal(hasCaptionText('WEBVTT\nKind: captions\nLanguage: en\n\n1\n00:00:01.000 --> 00:00:02.000\n'), false);
  assert.equal(hasCaptionText('WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nAdd <b>two</b> eggs.'), true);
  assert.equal(hasCaptionText('1\n00:00:01,000 --> 00:00:02,000\n盐'), true);
});

async function fixture(t) {
  const dir = await mkdtemp(path.join(tmpdir(), 'recipe-capture-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

test('runner reads captured subtitles and skips fallback but resolves video and OCR inputs', async (t) => {
  const dir = await fixture(t);
  const captureDir = path.join(dir, 'capture');
  const calls = [];
  const run = (command, args) => {
    calls.push({ command, args });
    return { status: 0, stdout: '', stderr: '' };
  };
  await mkdir(captureDir);
  await writeFile(path.join(captureDir, 'source.en.vtt'), 'WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nAdd two eggs.');
  await writeFile(path.join(captureDir, 'video.mp4'), 'fake video');
  await writeFile(path.join(captureDir, 'frame-001.jpg'), 'fake frame');
  const report = await runCapturePlan(planFor({ captureDir }), { run, repoRoots: [path.join(dir, 'repository')] });
  assert.deepEqual(calls.map((c) => c.command), ['yt-dlp', 'yt-dlp', 'ffmpeg', 'tesseract']);
  assert.equal(report.results.filter((r) => r.status === 'skipped').length, 2);
  assert.ok(calls[2].args.includes(path.join(captureDir, 'video.mp4')));
  assert.equal(calls[3].args[0], path.join(captureDir, 'frame-001.jpg'));
  assert.ok((await readdir(captureDir)).includes('capture-report.json'));
});

test('runner uses local transcription on missing captions and records tool failures', async (t) => {
  const dir = await fixture(t);
  const calls = [];
  const report = await runCapturePlan(planFor({ captureDir: path.join(dir, 'capture') }), {
    run(command, args) {
      calls.push({ command, args });
      return { status: command === 'whisper-ctranslate2' ? 1 : 0, stdout: '', stderr: 'tool log' };
    }, repoRoots: [path.join(dir, 'repository')],
  });
  assert.ok(calls.some((c) => c.command === 'whisper-ctranslate2'));
  assert.equal(report.results.find((r) => r.id === 'transcribe').status, 'failed');
  assert.equal(report.results.find((r) => r.id === 'frames').status, 'skipped');
  assert.equal(report.results.find((r) => r.id === 'ocr').status, 'skipped');
});

test('audio failure skips transcription, but still attempts visual evidence', async (t) => {
  const dir = await fixture(t);
  const report = await runCapturePlan(planFor({ captureDir: path.join(dir, 'capture') }), {
    run(command, args) { return { status: args.includes('--audio-format') ? 1 : 0 }; },
    repoRoots: [path.join(dir, 'repository')],
  });
  assert.equal(report.results.find((r) => r.id === 'transcribe').status, 'skipped');
  assert.equal(report.results.find((r) => r.id === 'video').status, 'ok');
});

test('dry run emits a plan without writing or invoking capture tools', async (t) => {
  const dir = await fixture(t);
  const before = await readdir(dir);
  const logs = [];
  const code = await captureMain(['--dry-run', video.url], {
    env: { RECIPE_BANK_CAPTURE_DIR: path.join(dir, 'not-created') },
    lookup: (name) => name === 'yt-dlp' ? name : null,
    run: assert.fail,
    log: (line) => logs.push(line), error: assert.fail,
  });
  assert.equal(code, 0);
  assert.deepEqual(await readdir(dir), before);
  assert.ok(logs.some((s) => s.includes('--write-description')));
  assert.ok(logs.some((s) => s.includes('Dry run')));
});

test('bad arguments fail before tool lookup or execution', async () => {
  for (const args of [[], ['--unknown', video.url], ['file:///captions'], ['--dry-run', 'ftp://youtube.com/watch?v=mhNQ8y5ud0A']]) {
    assert.equal(await captureMain(args, { lookup: assert.fail, run: assert.fail, error() {} }), 1);
  }
});
