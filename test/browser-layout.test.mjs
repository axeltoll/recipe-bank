import test from 'node:test';
import assert from 'node:assert/strict';
import { layoutIssues } from '../scripts/browser/layout.mjs';

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
