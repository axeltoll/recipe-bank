// scripts/validate.mjs: contract + JSON Schema, text and --json output.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { makeRecipe, tempBank, runScript } from './helpers/bank.mjs';

test('the repository validates, in --json mode too', async () => {
  const r = await runScript('validate.mjs', ['--json']);
  assert.equal(r.code, 0, r.stdout + r.stderr);
  const report = JSON.parse(r.stdout);
  assert.equal(report.ok, true);
  assert.ok(report.recipes > 0);
  assert.deepEqual(report.problems, []);
});

test('schema problems are reported once the contract passes; --json lists everything', async () => {
  const alpha = makeRecipe('alpha', 1);
  const beta = makeRecipe('beta', 2, { creator: { name: 'B', handle: 'nohandle' } });
  const gamma = makeRecipe('gamma', 3, { status: 'draft', creator: { name: 'C', handle: 'nohandle' } });
  const dir = await tempBank([alpha, beta, gamma]);
  await writeFile(join(dir, 'data', 'queue.json'), JSON.stringify([{ id: 'q1', video: alpha.video, status: 'queued' }]));
  const env = { RECIPE_BANK_DIR: dir };
  try {
    let r = await runScript('validate.mjs', ['--json'], env);
    assert.equal(r.code, 1);
    const report = JSON.parse(r.stdout);
    assert.equal(report.ok, false);
    assert.equal(report.recipes, 3);
    assert.equal(report.queue, 1);
    const by = (file) => report.problems.filter((p) => p.where === file).map((p) => p.message);
    assert.deepEqual(by('alpha.json'), []);
    assert.equal(by('beta.json').length, 1);
    assert.match(by('beta.json')[0], /^schema: creator\.handle: must match/);
    assert.ok(by('gamma.json').some((m) => m.startsWith('status must be one of')));
    assert.ok(!by('gamma.json').some((m) => m.startsWith('schema:')), 'no duplicate schema report for a contract failure');
    assert.deepEqual(report.warnings.map((w) => w.where), ['data/queue.json[0]']);
    assert.match(report.warnings[0].message, /already analyzed as alpha\.json/);

    r = await runScript('validate.mjs', [], env);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /✗ beta\.json: schema: creator\.handle/);
    assert.match(r.stderr, /problem\(s\)\./);

    r = await runScript('validate.mjs', ['--yaml'], env);
    assert.equal(r.code, 2);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
