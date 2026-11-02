import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// Partial can mean access failed, not that the creator withheld the method.
test('partial-recipe UI copy does not blame the creator for missing details', async () => {
  const app = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  assert.doesNotMatch(app, /the creator held details back/i);
});
