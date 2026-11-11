// The Recipe Agent documents must agree with the code and with CLAUDE.md.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PLATFORMS } from '../lib/video.mjs';
import { ROOT } from './helpers/bank.mjs';

const read = (...p) => readFile(join(ROOT, ...p), 'utf8');

test('the agent documents name every platform lib/video.mjs accepts', async () => {
  const docs = {
    'agent/RECIPE-AGENT.md': await read('agent', 'RECIPE-AGENT.md'),
    'agent/skills/recipe-video-analysis/SKILL.md': await read('agent', 'skills', 'recipe-video-analysis', 'SKILL.md'),
  };
  for (const [name, text] of Object.entries(docs)) {
    for (const { id, label } of PLATFORMS) {
      if (id === 'web') continue;
      assert.match(text, new RegExp(`\\b${label}\\b`), `${name} names ${label}`);
    }
  }
  assert.match(docs['agent/RECIPE-AGENT.md'], /web page/i, 'and says what happens to web pages');
});

test('"partial" means the same in CLAUDE.md, RECIPE-AGENT.md and SELF-HOSTING.md', async () => {
  const claude = await read('CLAUDE.md');
  assert.match(claude, /partial = creator withheld the method/);
  const agent = await read('agent', 'RECIPE-AGENT.md');
  assert.match(agent, /creator withheld part of it/);
  assert.doesNotMatch(agent, /"partial"` and specific `gaps` for missing or inaccessible material/, 'the old, wider definition is gone');
  const hosting = await read('SELF-HOSTING.md');
  assert.doesNotMatch(hosting, /use `partial` when missing method or evidence/);
  assert.match(hosting, /not a reason for `partial`/);
});

test('the speech-to-text docs give each engine its own model flag', async () => {
  const hosting = await read('SELF-HOSTING.md');
  assert.match(hosting, /--model_directory/);
  assert.match(hosting, /`whisper` \(passed as `--model`\)/);
});

test('the queue fields the helper writes are documented', async () => {
  const queue = await read('agent', 'QUEUE.md');
  for (const field of ['failureReason', 'updatedAt']) assert.match(queue, new RegExp(`\`${field}\``), field);
});
