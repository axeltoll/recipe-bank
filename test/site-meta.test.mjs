// npm run site:sync writes site.json values into every page's <head>; they must not be able to break out of
// the attribute they are written into.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { metaLines, ogImagePath } from '../scripts/sync-site.mjs';

const site = (over) => ({ baseUrl: 'https://recipes.example', ogImage: 'assets/og.png', ...over });

test('meta lines escape the base URL and the image path', () => {
  const lines = metaLines(site({ baseUrl: 'https://recipes.example/a&b' }), 'docs.html');
  assert.deepEqual(lines, [
    '<link rel="canonical" href="https://recipes.example/a&amp;b/docs.html">',
    '<meta property="og:url" content="https://recipes.example/a&amp;b/docs.html">',
    '<meta property="og:image" content="https://recipes.example/a&amp;b/assets/og.png">',
  ]);
});

test('an ogImage that is not a relative path inside site/ is rejected', () => {
  for (const bad of ['assets/og.png" onload="alert(1)', 'x"><script>alert(1)</script>', '/assets/og.png',
    '../secret.png', 'assets/../../x.png', 'https://elsewhere.example/og.png', '', undefined, 'assets//og.png']) {
    assert.throws(() => ogImagePath({ ogImage: bad }), /ogImage must be a relative path/, String(bad));
    assert.throws(() => metaLines(site({ ogImage: bad }), 'index.html'), /ogImage/, String(bad));
  }
  assert.equal(ogImagePath({ ogImage: 'assets/og.svg' }), 'assets/og.svg');
  assert.deepEqual(metaLines(site({ baseUrl: '', ogImage: '"bad' }), 'index.html').length, 1, 'no address yet: nothing is written');
});
