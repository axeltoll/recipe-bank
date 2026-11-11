// The docs pages in site/ against the code they describe. Each test reads what a page says and checks it
// against the module that does the work, so a change on either side that makes the page wrong fails here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { allowedHosts, writeRefusal } from '../server.mjs';
import { markEntry } from '../scripts/queue.mjs';
import { buildCapturePlan } from '../scripts/capture.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const page = (name) => readFile(join(ROOT, 'site', name), 'utf8');

/** The readable text of an HTML fragment: inline tags dropped, other tags read as a space, the few entities the pages use decoded, spaces collapsed. */
const text = (html) => html.replace(/<\/?(?:a|code|em|strong|span)\b[^>]*>/g, '').replace(/<[^>]*>/g, ' ')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&')
  .replace(/\s+/g, ' ').trim();

/** The text of the table row whose first cell is `command`. */
function row(html, command) {
  const rows = [...html.matchAll(/<tr>([\s\S]*?)<\/tr>/g)].map((m) => text(m[1]));
  const found = rows.find((r) => r.startsWith(command));
  assert.ok(found, `a row for ${command}`);
  return found;
}

test('the changelog names the version in package.json as the current one', async () => {
  const { version } = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8'));
  const html = await page('changelog.html');
  const lede = text(/<p class="lede">([\s\S]*?)<\/p>/.exec(html)[1]);
  assert.match(lede, new RegExp(`the version in the repository, ${version.replace(/\./g, '\\.')} in package\\.json`));
  const current = [...html.matchAll(/<section class="release"[^>]*>([\s\S]*?)<\/section>/g)]
    .map((m) => m[1]).filter((s) => /<span class="badge">Current<\/span>/.test(s));
  assert.equal(current.length, 1, 'one release is marked Current');
  assert.equal(text(/<h2[^>]*>([\s\S]*?)<\/h2>/.exec(current[0])[1]), version);
  assert.match(text(/<nav class="toc"[\s\S]*?<\/nav>/.exec(html)[0]), new RegExp(`${version.replace(/\./g, '\\.')}, the current version`));
});

test('the Recipe Agent page says failed and done need an analyzing entry, as the queue helper does', async () => {
  const html = await page('recipe-agent.html');
  const video = { platform: 'youtube', id: 'mhNQ8y5ud0A', url: 'https://youtu.be/mhNQ8y5ud0A' };
  const queued = [{ id: 'a', video, addedAt: '2026-11-01', status: 'queued' }];
  assert.throws(() => markEntry(queued, 'a', 'failed', { reason: 'No captions' }), /Cannot mark queued as failed/);
  assert.throws(() => markEntry(queued, 'a', 'done'), /Only an analyzing entry/);
  for (const command of ['node scripts/queue.mjs mark <id> failed', 'node scripts/queue.mjs mark <id> done']) {
    assert.match(row(html, command), /already marked analyzing/, `${command} states that it needs an analyzing entry`);
  }
});

test('the self-hosting page describes the write gate: a wildcard HOST allows no name, RECIPE_BANK_HOSTS does', async () => {
  const html = await page('self-hosting.html');
  const start = text(/<h2 id="start">[\s\S]*?(?=<h2 id="data">)/.exec(html)[0]);
  // What the code does.
  for (const HOST of ['0.0.0.0', '::']) assert.deepEqual(allowedHosts({ HOST }), [], `HOST=${HOST} allows no name`);
  assert.deepEqual(allowedHosts({ HOST: '192.168.1.20' }), ['192.168.1.20']);
  assert.deepEqual(allowedHosts({ HOST: '0.0.0.0', RECIPE_BANK_HOSTS: 'kitchen.lan' }), ['kitchen.lan']);
  const lan = { host: 'kitchen.lan:4780', 'content-type': 'application/json' };
  assert.equal(writeRefusal(lan, { hosts: allowedHosts({ HOST: '0.0.0.0' }), peer: '192.168.1.30' })?.status, 403);
  assert.equal(writeRefusal(lan, { hosts: allowedHosts({ HOST: '0.0.0.0', RECIPE_BANK_HOSTS: 'kitchen.lan' }), peer: '192.168.1.30' }), null);
  assert.equal(writeRefusal({ host: '127.0.0.1:4780' }, { hosts: [], peer: '192.168.1.30' })?.status, 403);
  // What the page says about it.
  assert.match(start, /RECIPE_BANK_HOSTS/);
  assert.match(start, /HOST=0\.0\.0\.0 or HOST=:: listens on every interface but allows no name by itself/);
  assert.match(start, /answer 403 until their name is in RECIPE_BANK_HOSTS/);
  assert.match(start, /A loopback name only counts for requests from your own machine/);
  assert.match(start, /has no login/);
});

test('the self-hosting page names the folder that is the bank and the tree a build publishes', async () => {
  const html = await page('self-hosting.html');
  const data = text(/<h2 id="data">[\s\S]*?(?=<h2 id="check">)/.exec(html)[0]);
  assert.doesNotMatch(data, /backed up everything/);
  assert.match(data, /RECIPE_BANK_DIR/);
  assert.match(data, /in the folder your bank is in/);
  const build = await readFile(join(ROOT, 'scripts', 'build-static.mjs'), 'utf8');
  assert.match(build, /dataDir = ROOT/, 'the static build defaults to this repository, not RECIPE_BANK_DIR');
  assert.doesNotMatch(build, /process\.env\.RECIPE_BANK_DIR/);
  const statics = text(/<h2 id="static">[\s\S]*?(?=<h2 id="tools">)/.exec(html)[0]);
  assert.match(statics, /always use the recipes and the queue in the repository\. They ignore RECIPE_BANK_DIR/);
});

test('the self-hosting page says which speech-to-text program wins and what model each wants', async () => {
  const plan = buildCapturePlan({
    video: { platform: 'youtube', id: 'mhNQ8y5ud0A', url: 'https://youtu.be/mhNQ8y5ud0A' },
    captureDir: '/captures/youtube-mhNQ8y5ud0A',
    tools: { 'yt-dlp': '/bin/yt-dlp', ffmpeg: '/bin/ffmpeg', 'whisper-ctranslate2': '/bin/whisper-ctranslate2', whisper: '/bin/whisper' },
    modelPath: '/models/stt',
  });
  const step = plan.commands.find((c) => c.id === 'transcribe');
  assert.equal(step.command, '/bin/whisper-ctranslate2');
  assert.ok(step.args.includes('--model_directory'));
  const only = buildCapturePlan({
    video: { platform: 'youtube', id: 'mhNQ8y5ud0A', url: 'https://youtu.be/mhNQ8y5ud0A' },
    captureDir: '/captures/youtube-mhNQ8y5ud0A',
    tools: { 'yt-dlp': '/bin/yt-dlp', ffmpeg: '/bin/ffmpeg', whisper: '/bin/whisper' },
    modelPath: '/models/stt.pt',
  }).commands.find((c) => c.id === 'transcribe');
  assert.ok(only.args.includes('--model') && !only.args.includes('--model_directory'));

  const tools = text(/<h2 id="tools">[\s\S]*?(?=<h2 id="captures">)/.exec(await page('self-hosting.html'))[0]);
  assert.match(tools, /When both programs are on your PATH, the helper uses whisper-ctranslate2/);
  assert.match(tools, /CTranslate2 model folder \(passed as --model_directory\)/);
  assert.match(tools, /whisper wants a Whisper model file \(passed as --model\)/);
});
