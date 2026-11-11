import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, symlink, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runCommand } from '../scripts/local-tools.mjs';
import { assertPrivateCaptureDir, captureMain, captureKey, isInside, repositoryRoots, resolveCaptureDir, ROOT } from '../scripts/capture.mjs';

const video = { platform: 'youtube', id: 'mhNQ8y5ud0A', url: 'https://youtu.be/mhNQ8y5ud0A' };
const key = captureKey(video);

test('capture location uses each OS data folder, with environment overrides taking precedence', () => {
  assert.equal(resolveCaptureDir(video, { platform: 'linux', env: {}, home: '/profile' }), `/profile/.local/share/recipe-bank/captures/${key}`);
  assert.equal(resolveCaptureDir(video, { platform: 'linux', env: { XDG_DATA_HOME: '/data' }, home: '/profile' }), `/data/recipe-bank/captures/${key}`);
  assert.equal(resolveCaptureDir(video, { platform: 'darwin', env: { XDG_DATA_HOME: '/ignored' }, home: '/profile' }), `/profile/Library/Application Support/recipe-bank/captures/${key}`);
  assert.equal(resolveCaptureDir(video, { platform: 'win32', env: { LOCALAPPDATA: 'C:\\Data' }, home: 'C:\\Profile' }), `C:\\Data\\recipe-bank\\captures\\${key}`);
  assert.equal(resolveCaptureDir(video, { platform: 'win32', env: {}, home: 'C:\\Profile' }), `C:\\Profile\\AppData\\Local\\recipe-bank\\captures\\${key}`);
  for (const platform of ['linux', 'darwin']) {
    assert.equal(resolveCaptureDir(video, { platform, env: { RECIPE_BANK_CAPTURE_DIR: '/capture-store', XDG_DATA_HOME: '/other' }, home: '/profile' }), `/capture-store/${key}`);
  }
  assert.equal(resolveCaptureDir(video, { platform: 'win32', env: { RECIPE_BANK_CAPTURE_DIR: 'D:\\Captures' }, home: 'C:\\Profile' }), `D:\\Captures\\${key}`);
});

test('relative capture/data overrides fail instead of depending on the working directory', () => {
  for (const env of [{ RECIPE_BANK_CAPTURE_DIR: 'captures' }, { XDG_DATA_HOME: 'data' }]) {
    assert.throws(() => resolveCaptureDir(video, { platform: 'linux', env, home: '/profile' }), /absolute/);
  }
});

test('inside detection handles the root, dot traversal and similarly named siblings', () => {
  assert.equal(isInside('/repo', '/repo'), true);
  assert.equal(isInside(path.resolve('/repo', 'sub', '..', 'frames'), '/repo'), true);
  assert.equal(isInside('/repo-neighbor/captures', '/repo'), false);
});

test('privacy guard rejects the repo itself, ignored evidence and symlink ancestors, including other worktrees', async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), 'recipe-privacy-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const root = path.join(dir, 'repo');
  const linked = path.join(dir, 'linked');
  const outside = path.join(dir, 'private');
  await mkdir(root);
  await mkdir(linked);
  await mkdir(outside);
  const alias = path.join(outside, 'alias');
  await symlink(root, alias, process.platform === 'win32' ? 'junction' : 'dir');
  const roots = [root, linked];
  for (const destination of [root, path.join(root, 'evidence', key), path.join(root, 'new', key), path.join(alias, 'not-created', key), path.join(linked, key)]) {
    assert.throws(() => assertPrivateCaptureDir(destination, roots), /inside the repository/);
  }
  assert.equal(assertPrivateCaptureDir(path.join(outside, key), roots), path.join(outside, key));
  assert.equal(assertPrivateCaptureDir(path.join(dir, 'repo-other', key), roots), path.join(dir, 'repo-other', key));
  await symlink(outside, path.join(root, 'escape'), process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => assertPrivateCaptureDir(path.join(root, 'escape', key), roots), /inside the repository/);
});

test('capture CLI refuses an in-repo destination before any optional tool is run or directory created', async () => {
  const before = await readdir(ROOT);
  const errors = [];
  const code = await captureMain([video.url], {
    env: { RECIPE_BANK_CAPTURE_DIR: path.join(ROOT, 'evidence') },
    lookup: assert.fail,
    run: assert.fail,
    error: (message) => errors.push(message), log() {},
  });
  assert.equal(code, 1);
  assert.match(errors.join('\n'), /inside the repository/);
  assert.deepEqual(await readdir(ROOT), before);
});

test('linked checkout discovery uses local Git metadata and falls back for a source archive', async () => {
  const missing = () => { throw Object.assign(new Error('missing'), { code: 'ENOENT' }); };
  const files = {
    '/checkout/.git': 'gitdir: /main/.git/worktrees/current\n',
    '/main/.git/worktrees/current/commondir': '../..\n',
    '/main/.git/worktrees/current/gitdir': '/checkout/.git\n',
    '/main/.git/worktrees/other/gitdir': '/other/.git\n',
  };
  assert.deepEqual(await repositoryRoots({ root: '/checkout', info: () => ({ isDirectory: () => false }),
    read: (file) => files[file] ?? missing(), list: () => ['current', 'other'],
  }), ['/checkout', '/main', '/other']);
  assert.deepEqual(await repositoryRoots({ root: '/archive', info: missing }), ['/archive']);
  assert.deepEqual(await repositoryRoots({ root: '/main', info: () => ({ isDirectory: () => true }), read: missing, list: missing }), ['/main']);
});

function captureLikeFiles(files) {
  return files.filter((file) => /\.(vtt|srt|aac|mp3|m4a|wav|flac|ogg|opus|aiff|wma|mp4|mkv|mov|webm|avi|flv|m4v)$/i.test(file)
    || (!file.startsWith('docs/') && /\.(png|jpe?g|webp|gif|bmp|tiff?|avif)$/i.test(file)));
}

test('tracked-content guard rejects subtitles/audio/video anywhere and frame images outside docs', async () => {
  assert.deepEqual(captureLikeFiles(['docs/screenshot.png', 'agent/RECIPE-AGENT.md', 'recipes/meal.json', 'docs/subtitles.vtt',
    'evidence/audio.wav', 'frames/keyframe.jpg', 'clip.webm']), ['docs/subtitles.vtt', 'evidence/audio.wav', 'frames/keyframe.jpg', 'clip.webm']);
  const result = await runCommand('git', ['-C', ROOT, 'ls-files', '-z']);
  assert.ifError(result.error);
  assert.equal(result.status, 0, 'Git must be available to check tracked capture files.');
  assert.ok(result.stdout.split('\0').includes('package.json'), 'Git tracked-file output must not be empty.');
  const captures = captureLikeFiles(result.stdout.split('\0').filter(Boolean));
  assert.deepEqual(captures, [], `Creator-owned captures must not be tracked: ${captures.join(', ')}`);
});
