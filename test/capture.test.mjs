import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  buildCapturePlan, captureMain, captureKey, formatCommand, hasCaptionText, runCapturePlan,
  captionLanguages, isOriginalCaption, CAPTION_LANGS, STEP_TIMEOUTS, SOURCES,
} from '../scripts/capture.mjs';
import { runCommand, findExecutable } from '../scripts/local-tools.mjs';
import { parseVideoUrl, PLATFORMS } from '../lib/video.mjs';

const video = parseVideoUrl('https://www.youtube.com/shorts/mhNQ8y5ud0A');
const tools = Object.fromEntries(['yt-dlp', 'ffmpeg', 'whisper-ctranslate2', 'whisper', 'tesseract'].map((name) => [name, name]));
const planFor = (overrides = {}) => buildCapturePlan({ video, captureDir: '/captures/example', tools, modelPath: '/models/local', ...overrides });
const after = (args, flag) => args[args.indexOf(flag) + 1];

test('plans metadata and original-language captions before conditional audio, transcription, video, frames and OCR', () => {
  const plan = planFor();
  assert.deepEqual(plan.commands.map((c) => c.id), ['metadata', 'captions', 'audio', 'transcribe', 'video', 'frames', 'ocr']);
  const [metadata, captions, audio, stt, download, frames, ocr] = plan.commands;
  for (const flag of ['--write-info-json', '--write-description', '--skip-download']) assert.ok(metadata.args.includes(flag), flag);
  for (const flag of ['--write-subs', '--write-auto-subs', '--skip-download']) assert.ok(captions.args.includes(flag), flag);
  assert.equal(after(captions.args, '--sub-langs'), CAPTION_LANGS, 'chosen once the language is known');
  for (const command of [metadata, captions, audio, download]) {
    assert.ok(command.args.includes('--ignore-config'));
    assert.deepEqual(command.args.slice(-2), ['--', video.url]);
    // The folder goes through -P; the -o template is a bare file name, so a "%" in the folder is never a field.
    assert.equal(after(command.args, '-P'), '/captures/example');
    assert.ok(!after(command.args, '-o').includes('/captures/example'), command.id);
    assert.doesNotMatch(after(command.args, '-o'), /[/\\]/, command.id);
  }
  assert.equal(audio.when, 'no-captions');
  assert.equal(stt.when, 'no-captions');
  assert.equal(after(download.args, '-f'), 'bv*[height<=1080]+ba/b', 'real pixels for OCR, not the 360p pre-merged file');
  assert.ok(frames.args.includes('fps=1/10,scale=1280:-2'));
  assert.ok(frames.args.includes('60'));
  assert.equal(ocr.when, 'each-frame');
  assert.match(formatCommand(metadata), /"yt-dlp"/);
});

test('each speech-to-text engine gets the model flag it understands', () => {
  const ct2 = planFor().commands.find((c) => c.id === 'transcribe');
  assert.equal(ct2.command, 'whisper-ctranslate2');
  assert.equal(after(ct2.args, '--model_directory'), '/models/local', 'a CTranslate2 model folder');
  assert.equal(after(ct2.args, '--local_files_only'), 'True');
  assert.ok(!ct2.args.includes('--model'), 'whisper-ctranslate2 --model only takes model names');

  const whisper = planFor({ tools: { ...tools, 'whisper-ctranslate2': null } }).commands.find((c) => c.id === 'transcribe');
  assert.equal(whisper.command, 'whisper');
  assert.equal(after(whisper.args, '--model'), '/models/local', 'a model name or checkpoint file');
  assert.ok(!whisper.args.includes('--model_directory'));
  assert.ok(!whisper.args.includes('--local_files_only'));
  for (const c of [ct2, whisper]) {
    assert.equal(c.args[0], path.join('/captures/example', 'audio.wav'));
    assert.equal(after(c.args, '--output_format'), 'json');
  }
});

test('no plan ever asks for every subtitle track', () => {
  const plans = [planFor(), planFor({ transcribe: true }), planFor({ tools: { ...tools, ffmpeg: null } })];
  for (const plan of plans) {
    for (const c of plan.commands) for (const a of c.args) assert.doesNotMatch(a, /(?:^|,)all(?:,|$)/, `${c.id}: ${a}`);
  }
  for (const language of [null, undefined, '', 'en', 'en-US', 'de', 'pt-BR', 'zh-Hans', 'x'.repeat(40), 'en,all', '.*']) {
    const langs = captionLanguages(language);
    assert.doesNotMatch(langs, /(?:^|,)all(?:,|$)/, String(language));
    assert.ok(!langs.split(',').includes('.*'), String(language));
  }
  assert.equal(captionLanguages('en'), 'en,en-.*');
  assert.equal(captionLanguages('en-US'), 'en,en-.*');
  assert.equal(captionLanguages('PT-br'), 'pt,pt-.*');
  assert.equal(captionLanguages(null), '.*-orig', 'unknown language: the original automatic track only');
  assert.equal(captionLanguages('en,all'), '.*-orig', 'a malformed language is not pasted into the list');
});

test('only captions in the original language count', () => {
  assert.equal(isOriginalCaption('source.en.vtt', 'en'), true);
  assert.equal(isOriginalCaption('source.en-GB.srt', 'en'), true);
  assert.equal(isOriginalCaption('source.en-orig.vtt', 'en-US'), true);
  assert.equal(isOriginalCaption('source.de.vtt', 'en'), false, 'an automatic translation');
  assert.equal(isOriginalCaption('source.en.vtt', 'de'), false);
  assert.equal(isOriginalCaption('source.eng.vtt', 'en'), false);
  assert.equal(isOriginalCaption('source.de-orig.vtt', null), true);
  assert.equal(isOriginalCaption('source.en.vtt', null), false);
  assert.equal(isOriginalCaption('source.info.json', 'en'), false);
  assert.equal(isOriginalCaption('audio.en.vtt', 'en'), false);
});

test('every step has a timeout', () => {
  for (const c of planFor().commands) {
    assert.ok(c.timeout > 0, c.id);
    assert.equal(c.timeout, STEP_TIMEOUTS[c.id]);
  }
  const custom = planFor({ timeouts: { ...STEP_TIMEOUTS, video: 1234 } });
  assert.equal(custom.commands.find((c) => c.id === 'video').timeout, 1234);
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
    if (tool === 'ffmpeg') assert.deepEqual(plan.commands.map((c) => c.id), ['metadata', 'captions']);
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

test('every platform lib/video.mjs accepts, and short links, produce portable, distinct capture names', () => {
  const urls = ['https://youtu.be/mhNQ8y5ud0A', 'https://www.tiktok.com/@cook/video/123456',
    'https://www.instagram.com/reel/ABC_def/', 'https://www.facebook.com/watch/?v=12345',
    'https://www.pinterest.com/pin/12345/', 'https://x.com/kitchen/status/12345',
    'https://vm.tiktok.com/abc/', 'https://fb.watch/AbC123/', 'https://pin.it/AbC123'];
  const keys = new Set();
  for (const url of urls) {
    const parsed = parseVideoUrl(url);
    assert.ok(parsed, url);
    assert.match(captureKey(parsed), /^[a-z]+-[a-zA-Z0-9_-]+$/);
    keys.add(captureKey(parsed));
    assert.equal(planFor({ video: parsed }).commands[0].args.at(-1), parsed.url);
  }
  assert.equal(keys.size, urls.length);
  const covered = new Set(urls.map((u) => parseVideoUrl(u).platform));
  for (const { id } of PLATFORMS) if (id !== 'web') assert.ok(covered.has(id), `${id} is covered`);
  assert.notEqual(captureKey(parseVideoUrl('https://vm.tiktok.com/abc/')), captureKey(parseVideoUrl('https://vm.tiktok.com/def/')));
  assert.equal(SOURCES, 'YouTube, TikTok, Instagram, Facebook, Pinterest or X');
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
  const run = (command, args, options) => {
    calls.push({ command, args, options });
    return { status: 0, stdout: '', stderr: '' };
  };
  await mkdir(captureDir);
  await writeFile(path.join(captureDir, 'source.info.json'), JSON.stringify({ language: 'en' }));
  await writeFile(path.join(captureDir, 'source.en.vtt'), 'WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nAdd two eggs.');
  await writeFile(path.join(captureDir, 'video.mp4'), 'fake video');
  await writeFile(path.join(captureDir, 'frame-001.jpg'), 'fake frame');
  const report = await runCapturePlan(planFor({ captureDir }), { run, repoRoots: [path.join(dir, 'repository')] });
  assert.deepEqual(calls.map((c) => c.command), ['yt-dlp', 'yt-dlp', 'yt-dlp', 'ffmpeg', 'tesseract']);
  assert.equal(report.language, 'en');
  assert.equal(after(calls[1].args, '--sub-langs'), 'en,en-.*');
  assert.equal(report.results.filter((r) => r.status === 'skipped').length, 2);
  assert.ok(calls[3].args.includes(path.join(captureDir, 'video.mp4')));
  assert.equal(calls[4].args[0], path.join(captureDir, 'frame-001.jpg'));
  for (const c of calls) {
    assert.equal(c.options.cwd, captureDir);
    assert.ok(c.options.timeout > 0, 'every run has a timeout');
  }
  assert.ok((await readdir(captureDir)).includes('capture-report.json'));
});

test('a machine translation does not stand in for the original captions', async (t) => {
  const dir = await fixture(t);
  const captureDir = path.join(dir, 'capture');
  await mkdir(captureDir);
  await writeFile(path.join(captureDir, 'source.info.json'), JSON.stringify({ language: 'de' }));
  await writeFile(path.join(captureDir, 'source.en.vtt'), 'WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nAdd two eggs.');
  const calls = [];
  const report = await runCapturePlan(planFor({ captureDir, tools: { ...tools, ffmpeg: 'ffmpeg', tesseract: null } }), {
    run(command, args) { calls.push({ command, args }); return { status: 0 }; },
    repoRoots: [path.join(dir, 'repository')],
  });
  assert.equal(after(calls[1].args, '--sub-langs'), 'de,de-.*');
  assert.equal(report.results.find((r) => r.id === 'audio').status, 'ok');
  assert.equal(report.results.find((r) => r.id === 'transcribe').status, 'ok');
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
  assert.equal(after(calls[1].args, '--sub-langs'), '.*-orig', 'no info JSON: the original automatic track only');
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

test('a stalled tool is stopped at its timeout and recorded as failed', async (t) => {
  const started = Date.now();
  const result = await runCommand(process.execPath, ['-e', 'setTimeout(() => {}, 20000)'], { timeout: 300 });
  assert.ok(Date.now() - started < 10_000, 'it did not wait for the tool');
  assert.notEqual(result.status, 0);
  assert.match(result.error?.message ?? '', /Timed out/);

  const quick = await runCommand(process.execPath, ['-e', 'process.stdout.write("ok")'], { timeout: 10_000 });
  assert.equal(quick.status, 0);
  assert.equal(quick.stdout, 'ok');
  assert.equal(quick.error, undefined);

  const dir = await fixture(t);
  const report = await runCapturePlan(planFor({ captureDir: path.join(dir, 'capture'), tools: { 'yt-dlp': 'yt-dlp' } }), {
    run: () => ({ status: null, error: new Error('Timed out after 120 s; the tool was stopped.') }),
    repoRoots: [path.join(dir, 'repository')],
  });
  assert.equal(report.results.find((r) => r.id === 'metadata').status, 'failed');
  assert.match(report.results.find((r) => r.id === 'metadata').error, /Timed out/);
});

test('tool lookup skips relative PATH entries', () => {
  const visited = [];
  const found = findExecutable('yt-dlp', { platform: 'linux', env: { PATH: '.:bin:./tools:/usr/local/bin:/usr/bin' },
    accessible(candidate) { visited.push(candidate); if (candidate !== '/usr/bin/yt-dlp') throw new Error('missing'); },
  });
  assert.equal(found, '/usr/bin/yt-dlp');
  assert.deepEqual(visited, ['/usr/local/bin/yt-dlp', '/usr/bin/yt-dlp']);
  assert.equal(findExecutable('yt-dlp', { platform: 'linux', env: { PATH: '.:bin' }, accessible: assert.fail }), null);
  assert.equal(findExecutable('yt-dlp', { platform: 'win32', env: { PATH: 'tools;.\\bin' }, accessible: assert.fail }), null);
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

test('bad arguments fail before tool lookup or execution, naming every supported source', async () => {
  for (const args of [[], ['--unknown', video.url], ['file:///captions'], ['--dry-run', 'ftp://youtube.com/watch?v=mhNQ8y5ud0A']]) {
    const errors = [];
    assert.equal(await captureMain(args, { lookup: assert.fail, run: assert.fail, error: (m) => errors.push(m) }), 1);
    if (args.length && !args.includes('--unknown')) assert.match(errors.join('\n'), /YouTube, TikTok, Instagram, Facebook, Pinterest or X/);
  }
});

test('the new platforms reach the capture plan', async (t) => {
  const dir = await fixture(t);
  for (const url of ['https://www.facebook.com/reel/12345', 'https://www.pinterest.com/pin/12345/', 'https://x.com/kitchen/status/12345']) {
    const logs = [];
    const code = await captureMain(['--dry-run', url], {
      env: { RECIPE_BANK_CAPTURE_DIR: path.join(dir, 'captures') },
      lookup: (name) => name === 'yt-dlp' ? name : null,
      run: assert.fail,
      log: (line) => logs.push(line), error: assert.fail,
    });
    assert.equal(code, 0, url);
    assert.ok(logs.some((s) => s.includes(JSON.stringify(parseVideoUrl(url).url))), url);
  }
});
