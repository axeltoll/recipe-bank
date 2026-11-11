// The repository's own docs (README, CHANGELOG, CLAUDE.md, CONTRIBUTING, ROADMAP, docs/ARCHITECTURE.md) against the
// code they describe. Each test checks what the code does, then that the docs say it, so a change on either side
// that makes a doc wrong fails here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { allowedHosts, writeRefusal } from '../server.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const read = (rel) => readFile(join(ROOT, rel), 'utf8');
/** Markdown as one line of text: line breaks folded into spaces, so a reflowed paragraph still matches. */
const flat = (md) => md.replace(/\s+/g, ' ');

test('the write gate is described as writeRefusal checks it', async () => {
  const json = { 'content-type': 'application/json' };
  const remote = '192.168.1.30';
  // No Origin and no Sec-Fetch-Site (curl, scripts) is allowed.
  assert.equal(writeRefusal({ ...json, host: '127.0.0.1:4780' }, { peer: '127.0.0.1' }), null);
  // A non-wildcard HOST is allowlisted; a wildcard adds no name.
  assert.deepEqual(allowedHosts({ HOST: 'kitchen.lan' }), ['kitchen.lan']);
  for (const HOST of ['0.0.0.0', '::', '[::]']) assert.deepEqual(allowedHosts({ HOST }), []);
  assert.equal(writeRefusal({ ...json, host: 'kitchen.lan:4780' }, { hosts: allowedHosts({ HOST: 'kitchen.lan' }), peer: remote }), null);
  assert.equal(writeRefusal({ ...json, host: 'kitchen.lan:4780' }, { hosts: allowedHosts({ HOST: '0.0.0.0' }), peer: remote })?.status, 403);
  // A loopback or missing Host from another machine is refused.
  assert.equal(writeRefusal({ ...json, host: 'localhost:4780' }, { peer: remote })?.status, 403);
  assert.equal(writeRefusal({ ...json }, { peer: remote })?.status, 403);
  // DELETE carries no body and is not held to the JSON check; POST is.
  assert.equal(writeRefusal({ host: '127.0.0.1:4780' }, { method: 'DELETE', peer: '127.0.0.1' }), null);
  assert.equal(writeRefusal({ host: '127.0.0.1:4780' }, { method: 'POST', peer: '127.0.0.1' })?.status, 415);

  for (const file of ['CHANGELOG.md', 'CONTRIBUTING.md', 'CLAUDE.md', 'docs/ARCHITECTURE.md']) {
    const text = flat(await read(file));
    assert.match(text, /RECIPE_BANK_HOSTS/, `${file} names RECIPE_BANK_HOSTS`);
    assert.match(text, /non-wildcard `HOST`|the `HOST` (?:it|the server) binds to/, `${file} says HOST is allowlisted`);
    assert.match(text, /wildcard `HOST`|`0\.0\.0\.0`, `::` and `\[::\]` add no name/, `${file} says a wildcard HOST adds no name`);
    assert.match(text, /loopback or missing `Host` (?:from|comes from) another machine/, `${file} names the other-machine check`);
    assert.match(text, /\(curl, scripts\)/, `${file} says a request without Origin or Sec-Fetch-Site passes`);
    assert.doesNotMatch(text, /Every POST, PUT and DELETE must be sent as `application\/json`/, `${file}: DELETE is exempt from the JSON check`);
    assert.doesNotMatch(text, /a host name that is not this machine/, `${file}: the Host check is not "this machine"`);
  }
  assert.doesNotMatch(flat(await read('CONTRIBUTING.md')), /only accepts changes sent as `application\/json` from its own origin/);
  assert.doesNotMatch(await read('docs/ARCHITECTURE.md'), /`DELETE \/api\/queue\/<id>`[^\n]*415/, 'DELETE never answers 415');
});

test('README lists household purchase amounts under "What it does" only once the dashboard shows them', async () => {
  const plan = await read('public/features/plan-feature.js');
  const shown = /household:\s*true/.test(plan);
  const readme = await read('README.md');
  const whatItDoes = /## What it does\n([\s\S]*?)\n## /.exec(readme)[1];
  assert.equal(/Amounts for your household|how much to buy/.test(whatItDoes), shown,
    shown ? 'the dashboard shows purchase amounts: README should say so' : '#/plan mounts the creator-words list: README must not promise purchase amounts');
});
