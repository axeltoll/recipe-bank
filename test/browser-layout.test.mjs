import test from 'node:test';
import assert from 'node:assert/strict';
import { layoutIssues, deviceRecipe, filterSheetIssues, measureLayout } from '../scripts/browser/layout.mjs';

const snapshot = (overrides = {}) => ({ width: 390, scrollWidth: 390, targets: [], textLines: [], edgeSamples: [], ...overrides });
test('device audit fails sideways scroll, undersized mobile targets and long lines', () => {
  const issues = layoutIssues(snapshot({ scrollWidth: 391,
    targets: [{ width: 44, height: 44 }, { width: 43.9, height: 44 }, { width: 100, height: 30 }],
    textLines: [{ estimatedCharacters: 80 }, { estimatedCharacters: 85 }, { estimatedCharacters: 86 }],
  }));
  assert.deepEqual(issues.map((i) => i.check), ['sideways-scroll', 'tap-target', 'tap-target', 'line-length']);
});
test('tap target rule is mobile-only, edge paint rule is wide-only', () => {
  const values = { targets: [{ width: 10, height: 10 }], edgeSamples: [{ painted: false, x: 0, y: 0 }, { painted: true, x: 1, y: 0 }] };
  assert.deepEqual(layoutIssues(snapshot({ ...values, width: 1280 })), []);
  assert.equal(layoutIssues(snapshot({ ...values, width: 1920 }))[0].check, 'unpainted-edge');
  assert.equal(layoutIssues(snapshot({ ...values, width: 2560 }))[0].check, 'unpainted-edge');
});
test('the phone and wide rules follow the requested viewport, with a scrollbar of tolerance', () => {
  const values = { targets: [{ width: 10, height: 10 }], edgeSamples: [{ painted: false, x: 0, y: 0 }] };
  assert.deepEqual(layoutIssues(snapshot({ ...values, width: 389, scrollWidth: 389 })).map((i) => i.check), ['tap-target']);
  assert.deepEqual(layoutIssues(snapshot({ ...values, width: 1919, scrollWidth: 1919 })).map((i) => i.check), ['unpainted-edge']);
  assert.deepEqual(layoutIssues(snapshot({ ...values, width: 375, scrollWidth: 375 }), 390).map((i) => i.check), ['tap-target']);
  assert.deepEqual(layoutIssues(snapshot({ ...values, width: 1905, scrollWidth: 1905 }), 1920).map((i) => i.check), ['unpainted-edge']);
  assert.deepEqual(layoutIssues(snapshot({ ...values, width: 1280, scrollWidth: 1280 }), 1280), []);
});

test('the device check measures a recipe that has steps, and names the recipes when none has', () => {
  const recipe = (id, steps) => ({ id, components: [{ steps }] });
  assert.equal(deviceRecipe([recipe('empty', []), recipe('full', [{ text: 'Cook' }])]).id, 'full');
  assert.throws(() => deviceRecipe([recipe('empty', []), recipe('none', [])]), /No recipe has steps.*empty, none/);
});

// A fake page: evaluate() answers the toggle probe with `state`, and measureLayout with `measured`.
function fakePage({ state, opens = true, measured = snapshot() }) {
  return {
    evaluate: async (fn) => (fn === measureLayout ? measured : state),
    waitFor: async () => { if (!opens) throw new Error('Timed out waiting for page condition'); },
  };
}

test('a missing Filters button or a sheet that never opens fails the phone home page', async () => {
  const missing = await filterSheetIssues(fakePage({ state: 'missing' }), [], 390);
  assert.deepEqual(missing.issues.map((i) => i.check), ['filter-sheet']);
  assert.equal(missing.opened, false);
  const stuck = await filterSheetIssues(fakePage({ state: 'clicked', opens: false }), [], 390);
  assert.deepEqual(stuck.issues.map((i) => i.check), ['filter-sheet']);
  assert.equal(stuck.close, true, 'the check still closes what it clicked');
});

test('the open filter sheet reports only findings the closed page did not have', async () => {
  const old = { check: 'tap-target', width: 10, height: 10 };
  const chip = { check: 'tap-target', width: 30, height: 30 };
  const measured = snapshot({ targets: [{ width: 10, height: 10 }, { width: 30, height: 30 }] });
  const sheet = await filterSheetIssues(fakePage({ state: 'clicked', measured }), [old], 390);
  assert.deepEqual(sheet.issues, [{ ...chip, state: 'filters-open' }]);
  assert.deepEqual([sheet.opened, sheet.close], [true, true]);
  const already = await filterSheetIssues(fakePage({ state: 'open', measured }), [old], 390);
  assert.equal(already.close, false, 'a sheet that was already open stays open');
});
