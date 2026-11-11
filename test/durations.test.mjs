// durations() in lib/format.mjs finds the durations a step states in figures; the dashboard turns each into a
// kitchen-timer chip (public/ui/core.js). It must never guess: words like "half an hour" give no timer.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { durations } from '../lib/format.mjs';

test('plain durations in minutes, hours and seconds', () => {
  assert.deepEqual(durations('Simmer for 10 minutes.'), [{ seconds: 600, label: '10 min' }]);
  assert.deepEqual(durations('Simmer 10 MINUTES'), [{ seconds: 600, label: '10 min' }]);
  assert.deepEqual(durations('Give it 20 mins.'), [{ seconds: 1200, label: '20 min' }]);
  assert.deepEqual(durations('Roast for 2 hours'), [{ seconds: 7200, label: '2 h' }]);
  assert.deepEqual(durations('Blend 30 seconds'), [{ seconds: 30, label: '30 sec' }]);
  assert.deepEqual(durations('A 5-minute rest'), [{ seconds: 300, label: '5 min' }]);
  assert.deepEqual(durations('Cook 2.5 minutes'), [{ seconds: 150, label: '2.5 min' }]);
});

test('a range runs for its lower bound and keeps both figures in the label', () => {
  assert.deepEqual(durations('Cook 3-4 mins per side'), [{ seconds: 180, label: '3–4 min' }]);
  assert.deepEqual(durations('Air fry at 400 for 8 to 10 minutes'), [{ seconds: 480, label: '8–10 min' }]);
});

test('fractions: "1 1/2", "1½" and "½"', () => {
  assert.deepEqual(durations('Braise 1 1/2 hours'), [{ seconds: 5400, label: '1 1/2 h' }]);
  assert.deepEqual(durations('Chill 1½ hours'), [{ seconds: 5400, label: '1½ h' }]);
  assert.deepEqual(durations('Rest ½ hour'), [{ seconds: 1800, label: '½ h' }]);
  assert.deepEqual(durations('Wait 1/0 hours'), [], 'a broken fraction is no duration');
});

test('"1 hour 30 minutes" is one duration, but only when the units go down', () => {
  assert.deepEqual(durations('Bake for 1 hour 30 minutes, then rest 10 minutes'), [
    { seconds: 5400, label: '1 h 30 min' },
    { seconds: 600, label: '10 min' },
  ]);
  assert.deepEqual(durations('Cook 2 minutes, 30 seconds'), [{ seconds: 150, label: '2 min 30 sec' }]);
  assert.deepEqual(durations('Sear 30 seconds and 2 minutes'), [
    { seconds: 30, label: '30 sec' },
    { seconds: 120, label: '2 min' },
  ]);
});

test('nothing is guessed: words, other units and look-alikes give no timer', () => {
  assert.deepEqual(durations('Mix for half an hour'), []);
  assert.deepEqual(durations('Cook for a few minutes'), []);
  assert.deepEqual(durations('Add 2 minced garlic cloves'), [], '"min" inside a word');
  assert.deepEqual(durations('Heat the oven to 200 degrees'), []);
  assert.deepEqual(durations('Add 1 to 2 tablespoons'), []);
  assert.deepEqual(durations('Stir for 1 second'), [], 'under five seconds is not worth a timer');
  assert.deepEqual(durations('Age for 48 hours'), [], 'over a day is not a kitchen timer');
  assert.deepEqual(durations(''), []);
  assert.deepEqual(durations(null), []);
  assert.deepEqual(durations(undefined), []);
  assert.deepEqual(durations(42), []);
});

test('at most three per step by default, in reading order', () => {
  const text = '1 minute, stir, 2 minutes, stir, 3 minutes, stir, 4 minutes';
  assert.deepEqual(durations(text).map((d) => d.seconds), [60, 120, 180]);
  assert.deepEqual(durations(text, 1), [{ seconds: 60, label: '1 min' }]);
});

test('every step of every real recipe parses without throwing, and stays within a day', async () => {
  const dir = resolve(import.meta.dirname, '..', 'recipes');
  let steps = 0;
  for (const file of (await readdir(dir)).filter((f) => f.endsWith('.json'))) {
    const recipe = JSON.parse(await readFile(join(dir, file), 'utf8'));
    for (const c of recipe.components ?? []) {
      for (const s of c.steps ?? []) {
        steps++;
        for (const d of durations(s.text)) {
          assert.ok(Number.isInteger(d.seconds) && d.seconds >= 5 && d.seconds <= 86400, `${file}: ${d.label}`);
          assert.match(d.label, / (h|min|sec)$/, `${file}: ${d.label}`);
        }
      }
    }
  }
  assert.ok(steps > 20, `only ${steps} steps were read`);
});
