import { test } from 'node:test';
import assert from 'node:assert/strict';
import { esc, mmss, plural, formatDate, safeUrl } from '../lib/format.mjs';

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

test('safeUrl only lets absolute http(s) links through, in the form the browser uses', () => {
  for (const bad of ['javascript:alert(1)', 'JAVASCRIPT:alert(1)', ' javascript:alert(1)', 'java\tscript:alert(1)',
    'data:text/html,<script>alert(1)</script>', 'vbscript:msgbox(1)', '//example.com/x', '/relative', 'not a url', '',
    42, null, undefined, {}]) {
    assert.equal(safeUrl(bad), null, String(bad));
  }
  assert.equal(safeUrl('HTTPS://Example.COM/A?b=1'), 'https://example.com/A?b=1', 'scheme and host lowercased');
  assert.equal(safeUrl('  http://example.com/ok \n'), 'http://example.com/ok');
  // Userinfo stays in the href, so the link still says where it really goes.
  assert.equal(safeUrl('https://user:pass@example.com/x'), 'https://user:pass@example.com/x');
  assert.equal(new URL(safeUrl('https://facebook.com@evil.example/x')).hostname, 'evil.example');
  // A quote cannot end the attribute: " and < > come back percent-encoded, and esc() covers the rest.
  assert.equal(safeUrl('https://example.com/a"onmouseover="x'), 'https://example.com/a%22onmouseover=%22x');
  assert.equal(safeUrl('https://example.com/<b>'), 'https://example.com/%3Cb%3E');
  assert.doesNotMatch(esc(safeUrl("https://example.com/it's")), /['"<>]/);
});
