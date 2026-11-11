import test from 'node:test';
import assert from 'node:assert/strict';
import { doctorMain, doctorReport } from '../scripts/doctor.mjs';
import { detectTools, findExecutable, TOOL_NAMES } from '../scripts/local-tools.mjs';

test('doctor tolerates every optional tool missing and emits useful OS-specific hints', () => {
  for (const platform of ['linux', 'darwin', 'win32']) {
    const checked = [];
    const report = doctorReport({ nodeVersion: '22.0.0', platform, lookup(name) { checked.push(name); return null; } });
    assert.equal(report.exitCode, 0);
    assert.equal(report.node.status, 'found');
    assert.equal(report.tools.length, 4);
    assert.ok(report.tools.every((tool) => tool.status === 'missing' && tool.command === null && tool.hint.length > 10));
    assert.deepEqual(checked, TOOL_NAMES);
    assert.ok(report.tools.find((tool) => tool.id === 'ffmpeg').hint.includes(platform === 'darwin' ? 'brew' : platform === 'win32' ? 'PATH' : 'package manager'));
  }
});

test('doctor detects preferred and fallback local speech-to-text engines', () => {
  const all = doctorReport({ lookup: (name) => `/tools/${name}` });
  assert.ok(all.tools.every((t) => t.status === 'found'));
  assert.equal(all.tools.find((t) => t.id === 'stt').command, '/tools/whisper-ctranslate2');
  const fallback = doctorReport({ lookup: (name) => name === 'whisper' ? '/tools/whisper' : null });
  assert.equal(fallback.tools.find((t) => t.id === 'stt').command, '/tools/whisper');
});

test('only unsupported Node causes an environment-check failure', () => {
  for (const nodeVersion of ['18.20.0', '20.0.0', '21.9.0']) {
    assert.equal(doctorReport({ nodeVersion, lookup: () => '/tools/tool' }).exitCode, 1);
  }
  for (const nodeVersion of ['22.0.0', 'v24.1.0', '26.0.0']) {
    assert.equal(doctorReport({ nodeVersion, lookup: () => null }).exitCode, 0);
  }
});

test('doctor JSON is parseable without prose and carries detection and exit status', () => {
  const output = [];
  assert.equal(doctorMain(['--json'], { nodeVersion: '22.0.0', lookup: () => null, log: (line) => output.push(line) }), 0);
  assert.equal(output.length, 1);
  const report = JSON.parse(output[0]);
  assert.equal(report.exitCode, 0);
  assert.ok(report.tools.every((t) => t.status === 'missing'));
  const text = [];
  assert.equal(doctorMain([], { nodeVersion: '20.0.0', lookup: () => null, log: (line) => text.push(line) }), 1);
  assert.ok(text.some((line) => line.includes('requires 22+')));
  assert.ok(text.some((line) => line.includes('missing')));
});

test('doctor exits 0 and emits JSON with an empty PATH using the real filesystem lookup', () => {
  const output = [];
  const code = doctorMain(['--json'], {
    nodeVersion: '22.0.0', lookup: (name) => findExecutable(name, { env: { PATH: '' } }), log: (line) => output.push(line),
  });
  assert.equal(output.length, 1);
  assert.equal(code, 0);
  const report = JSON.parse(output[0]);
  assert.equal(report.tools.filter((t) => t.status === 'missing').length, 4);
});

test('PATH lookup handles unavailable executables, spaces and Windows EXE extensions without a shell', () => {
  const visited = [];
  const found = findExecutable('ffmpeg', { platform: 'linux', env: { PATH: '/missing:/tools with spaces' },
    accessible(candidate) { visited.push(candidate); if (candidate !== '/tools with spaces/ffmpeg') throw new Error('missing'); },
  });
  assert.equal(found, '/tools with spaces/ffmpeg');
  assert.deepEqual(visited, ['/missing/ffmpeg', '/tools with spaces/ffmpeg']);
  assert.equal(findExecutable('ffmpeg', { platform: 'linux', env: { PATH: '' }, accessible: assert.fail }), null);
  assert.equal(findExecutable('whisper', { platform: 'win32', env: { Path: 'C:\\Tools', PATHEXT: '.CMD;.EXE' },
    accessible(candidate) { assert.equal(candidate, 'C:\\Tools\\whisper.EXE'); },
  }), 'C:\\Tools\\whisper.EXE');
  assert.ok(Object.values(detectTools(() => null)).every((v) => v === null));
});
