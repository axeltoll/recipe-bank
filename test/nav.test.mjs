import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BREAKPOINTS, parseRoute, recipeHash, queueHash, clampIndex, columnCount, gridMove,
} from '../lib/nav.mjs';

test('the existing hash routes still parse', () => {
  assert.deepEqual(parseRoute(''), { name: 'home' });
  assert.deepEqual(parseRoute('#/'), { name: 'home' });
  assert.deepEqual(parseRoute('#/r/gochujang-chicken-thighs'), { name: 'recipe', id: 'gochujang-chicken-thighs' });
  assert.deepEqual(parseRoute('#/q/0b6c1f0e-4c0f-4f0a-9d5e-2f6f5c1f7a11'), { name: 'queue', id: '0b6c1f0e-4c0f-4f0a-9d5e-2f6f5c1f7a11' });
});

test('incomplete, unknown and malformed hashes fall back to home instead of throwing', () => {
  for (const h of ['#/r', '#/r/', '#/q/', '#/x/y', '#/Plan', '#nonsense', '#', undefined, null]) {
    assert.deepEqual(parseRoute(h), { name: 'home' }, String(h));
  }
});

test('ids are URL-decoded, and a broken escape is kept as text', () => {
  assert.equal(parseRoute('#/r/a%20b').id, 'a b');
  assert.equal(parseRoute('#/r/%E0%A4%A').id, '%E0%A4%A');
});

test('feature routes parse only when registered', () => {
  assert.deepEqual(parseRoute('#/plan'), { name: 'home' });
  assert.deepEqual(parseRoute('#/plan', ['plan']), { name: 'plan', param: '', custom: true });
  assert.deepEqual(parseRoute('#/plan/2026-W46', ['plan', 'shop']), { name: 'plan', param: '2026-W46', custom: true });
  // A feature can never take over the built-in routes.
  assert.deepEqual(parseRoute('#/r/x', ['r']), { name: 'recipe', id: 'x' });
});

test('recipeHash and queueHash round-trip through parseRoute', () => {
  assert.equal(recipeHash('pad-kra-pao-pork'), '#/r/pad-kra-pao-pork');
  assert.equal(recipeHash('a b'), '#/r/a%20b');
  assert.deepEqual(parseRoute(recipeHash('a b/c')), { name: 'recipe', id: 'a b/c' });
  assert.deepEqual(parseRoute(queueHash('abc-123')), { name: 'queue', id: 'abc-123' });
});

test('clampIndex keeps an index inside the list', () => {
  assert.equal(clampIndex(5, 3), 2);
  assert.equal(clampIndex(-1, 3), 0);
  assert.equal(clampIndex(1, 3), 1);
  assert.equal(clampIndex(1.9, 3), 1);
  assert.equal(clampIndex('x', 3), 0);
  assert.equal(clampIndex(4, 0), 0);
});

test('columnCount counts the items on the first row', () => {
  assert.equal(columnCount([]), 1);
  assert.equal(columnCount([10]), 1);
  assert.equal(columnCount([10, 10, 10, 200, 200]), 3);
  assert.equal(columnCount([10, 50, 90]), 1);
});

test('gridMove walks a 3-column grid of 7 cards and stops at the edges', () => {
  const move = (i, key) => gridMove(i, key, 3, 7);
  assert.equal(move(0, 'ArrowRight'), 1);
  assert.equal(move(6, 'ArrowRight'), 6);
  assert.equal(move(0, 'ArrowLeft'), 0);
  assert.equal(move(3, 'ArrowLeft'), 2);
  assert.equal(move(0, 'ArrowDown'), 3);
  assert.equal(move(3, 'ArrowDown'), 6);
  assert.equal(move(4, 'ArrowDown'), 6, 'above a short last row: land on the last card');
  assert.equal(move(6, 'ArrowDown'), 6);
  assert.equal(move(6, 'ArrowUp'), 3);
  assert.equal(move(1, 'ArrowUp'), 1);
  assert.equal(move(4, 'Home'), 0);
  assert.equal(move(4, 'End'), 6);
  assert.equal(move(4, 'a'), 4);
});

test('gridMove handles one column, an empty grid and a bad column count', () => {
  assert.equal(gridMove(2, 'ArrowDown', 1, 5), 3);
  assert.equal(gridMove(4, 'ArrowDown', 1, 5), 4);
  assert.equal(gridMove(0, 'ArrowRight', 3, 0), 0);
  assert.equal(gridMove(1, 'ArrowDown', 0, 5), 2);
  assert.equal(gridMove(1, 'ArrowDown', NaN, 5), 2);
});

test('the breakpoints are the ones in the layout contract', () => {
  assert.deepEqual(BREAKPOINTS, { tablet: 768, desktop: 1280, wide: 1920 });
});
