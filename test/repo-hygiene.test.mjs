// Repository-level promises: one command for every check, pinned CI actions, and public files written in
// project words (the repository is public; readers cannot know internal process names).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { ROOT } from './helpers/bank.mjs';

test('npm run check runs the tests (with the schema cross-check), the validator and the build, in order', async () => {
  const pkg = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8'));
  assert.equal(pkg.scripts.check, 'npm test && npm run validate && npm run build');
  assert.match(pkg.scripts.test, /test\/\*\.test\.mjs/, 'the schema test is one of them');
  assert.deepEqual(pkg.dependencies ?? {}, {});
  assert.deepEqual(pkg.devDependencies ?? {}, {});
});

test('CI pins every action to a full commit SHA, keeps no token in .git/config and tests the Node floor', async () => {
  const ci = await readFile(join(ROOT, '.github', 'workflows', 'ci.yml'), 'utf8');
  const uses = [...ci.matchAll(/uses:\s*(\S+)(.*)$/gm)];
  assert.ok(uses.length >= 2);
  for (const [, action, rest] of uses) {
    assert.match(action, /^[\w.-]+\/[\w.-]+@[0-9a-f]{40}$/, `${action} is pinned to a commit`);
    assert.match(rest, /#\s*v\d+/, `${action} names its tag in a comment`);
  }
  assert.match(ci, /persist-credentials:\s*false/);
  assert.match(ci, /permissions:\s*\n\s*contents:\s*read/);
  assert.doesNotMatch(ci, /pull_request_target/);
  assert.match(ci, /node:\s*\[22\b/, 'Node 22 (the engines floor) is in the matrix');
});

// Working folders that never belong in the repository (any top-level folder starting with _) are a failure, not a skip.
const SKIP_DIRS = new Set(['.git', 'node_modules', 'dist', '.smoke', 'evidence']);

async function* files(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) yield* files(join(dir, entry.name));
    } else yield join(dir, entry.name);
  }
}

test('public docs and code use project words, not internal process words', async () => {
  const found = [];
  for await (const file of files(ROOT)) {
    const rel = relative(ROOT, file).replaceAll('\\', '/');
    if (!/\.(md|mjs|js|html|json|yml|css)$/.test(rel) || /^LANE-/.test(rel)) continue;
    if (rel === 'test/repo-hygiene.test.mjs') continue;
    const text = await readFile(file, 'utf8');
    for (const m of text.matchAll(/\bPAM\b|\b(?:the|this|a|each|every|other|dashboard|household|week-plan)[ -]lanes?\b|\brbank-[a-z]+|\bround-1\b/gi)) {
      found.push(`${rel}: ${m[0]}`);
    }
  }
  assert.deepEqual(found, []);
});

test('no working folder is committed (top-level folders starting with _)', async () => {
  const top = (await readdir(ROOT, { withFileTypes: true })).filter((e) => e.isDirectory() && e.name.startsWith('_'));
  assert.deepEqual(top.map((e) => e.name), []);
});
