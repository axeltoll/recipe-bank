// site/js/features.js redraws a feature group or status note only when data/features.json says something else
// than the static page. "Something else" includes a link or a status class, not only the visible words.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { markupDiffers, renderGroup, renderStatusNote } from '../site/js/features-core.js';

const SITE = resolve(import.meta.dirname, '..', 'site');
const features = JSON.parse(await readFile(join(SITE, 'data', 'features.json'), 'utf8')).features;

test('the static group in index.html, markers and indentation included, equals a fresh render', async () => {
  const html = await readFile(join(SITE, 'index.html'), 'utf8');
  const block = html.match(/<div class="feature-group" data-features="shipped">([\s\S]*?)\n\s*<\/div>\n/)[1];
  assert.equal(markupDiffers(block, renderGroup(features, 'shipped').join('\n')), false);
});

test('a new href or badge class with the same words counts as a change', () => {
  const linked = features.find((f) => f.link);
  assert.ok(linked, 'features.json has a feature with a link');
  const before = renderGroup(features, linked.status).join('\n');
  const moved = features.map((f) => (f === linked ? { ...f, link: { ...f.link, href: `${f.link.href}-moved` } } : f));
  assert.equal(markupDiffers(before, renderGroup(moved, linked.status).join('\n')), true, 'href');

  const note = renderStatusNote(linked);
  assert.equal(markupDiffers(note, note.replace(`badge-${linked.status}`, 'badge-other')), true, 'badge class');
  assert.equal(markupDiffers(note, `  ${note.replace('> ', '>\n   ')}\n`), false, 'layout whitespace only');
  assert.equal(markupDiffers(note, note.replace('</p>', ' more</p>')), true, 'words');
});
