import { test } from 'node:test';
import assert from 'node:assert/strict';
import { esc, mmss, plural, formatDate } from '../lib/format.mjs';

test('esc escapes the five HTML-significant characters and stringifies the rest', () => {
  assert.equal(esc(`<a href="x">&'`), '&lt;a href=&quot;x&quot;&gt;&amp;&#39;');
  assert.equal(esc('Swiss & Hot Honey'), 'Swiss &amp; Hot Honey');
  assert.equal(esc(null), '');
  assert.equal(esc(undefined), '');
  assert.equal(esc(0), '0');
  assert.equal(esc(517), '517');
});

test('mmss formats seconds as m:ss and treats bad input as 0:00', () => {
  assert.equal(mmss(0), '0:00');
  assert.equal(mmss(17), '0:17');
  assert.equal(mmss(62.4), '1:02');
  assert.equal(mmss(139), '2:19');
  assert.equal(mmss(600), '10:00');
  assert.equal(mmss(-5), '0:00');
  assert.equal(mmss(NaN), '0:00');
  assert.equal(mmss(undefined), '0:00');
});

test('plural picks the singular only for exactly one', () => {
  assert.equal(plural(1, 'recipe'), '1 recipe');
  assert.equal(plural(0, 'recipe'), '0 recipes');
  assert.equal(plural(17, 'recipe'), '17 recipes');
  assert.equal(plural(2, 'match', 'matches'), '2 matches');
  assert.equal(plural(1, 'match', 'matches'), '1 match');
});

test('formatDate turns ISO dates into day month year and leaves anything else alone', () => {
  assert.equal(formatDate('2026-02-11'), '11 Feb 2026');
  assert.equal(formatDate('2026-10-02'), '2 Oct 2026');
  assert.equal(formatDate('2026-11-11T09:30:00.000Z'), '11 Nov 2026');
  assert.equal(formatDate('soon'), 'soon');
  assert.equal(formatDate('2026-13-01'), '2026-13-01');
  assert.equal(formatDate(null), '');
  assert.equal(formatDate(undefined), '');
});
