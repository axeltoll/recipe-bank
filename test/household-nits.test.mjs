// Household and budget follow-ups: formatters made once, a usable currency list everywhere, blank CSV
// lines, a "this week" that moves on at midnight, and a standalone preview that loads from the static copy.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import {
  currencyList, isCurrency, formatMoney, validateShop, importShopsCsv, FALLBACK_CURRENCIES, NON_MONEY,
} from '../lib/budget.mjs';
import { mount as mountBudget } from '../public/features/budget.mjs';
import { buildStatic } from '../scripts/build-static.mjs';
import { makeRecipe, tempBank } from './helpers/bank.mjs';

test('the currency list survives a runtime without Intl.supportedValuesOf, and refuses non-money codes', () => {
  const fallback = currencyList({ supportedValuesOf() { throw new TypeError('not a function'); } });
  assert.deepEqual([...fallback].sort(), [...FALLBACK_CURRENCIES].sort());
  assert.deepEqual([...currencyList({})].sort(), [...FALLBACK_CURRENCIES].sort(), 'missing function');
  assert.deepEqual([...currencyList({ supportedValuesOf: () => ['USD', 'XAU', 'XTS', 'XXX', 'XOF'] })], ['USD', 'XOF']);
  for (const code of NON_MONEY) assert.equal(isCurrency(code), false, code);
  for (const code of ['SEK', 'EUR', 'USD', 'JPY']) assert.equal(isCurrency(code), true, code);
});

test('number formatters are made once per currency and locale, not per shop', (t) => {
  const made = t.mock.method(Intl, 'NumberFormat');
  for (let i = 0; i < 500; i++) {
    formatMoney(12345 + i, 'CHF', 'de-CH');
    assert.deepEqual(validateShop({ date: '2026-11-11', total: '12.50', currency: 'CHF' }), []);
  }
  assert.ok(made.mock.callCount() <= 3, `${made.mock.callCount()} formatters for 1,000 calls`);
  assert.match(formatMoney(150, 'CHF', 'de-CH'), /1[.,]50/);
});

test('blank lines in an imported CSV are skipped; row numbers still match the file', () => {
  const shops = importShopsCsv('date,total,currency,meals,note\n2024-02-29,1,SEK,,a\n\n2024-03-01,2,SEK,,b\r\n\r\n');
  assert.deepEqual(shops.map((s) => s.note), ['a', 'b']);
  assert.deepEqual(importShopsCsv('date,total,currency,meals,note\n\n'), []);
  assert.throws(() => importShopsCsv('date,total,currency,meals,note\n\n2024-02-30,1,SEK,,bad'), /CSV row 3:/);
  assert.throws(() => importShopsCsv('date,total,currency,meals,note\n ,,,,\n'), /CSV row 2:/, 'a row of empty cells is not blank');
});

// The element surface mount uses (same stand-in as test/household-ui.test.mjs).
class Element extends EventTarget {
  markup = '';
  get innerHTML() { return this.markup; }
  set innerHTML(html) { this.markup = html; }
  status = { textContent: '', setAttribute() {} };
  summary = { innerHTML: '' };
  ownerDocument = { defaultView: { CustomEvent } };
  contains() { return true; }
  querySelector(selector) { return selector === '.rb-budget-summary' ? this.summary : this.status; }
}
const memoryStorage = () => {
  const data = new Map();
  return { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => data.set(k, v) };
};
function submitBudget(root) {
  const event = new Event('submit', { cancelable: true });
  const values = { period: 'week', amount: '100', currency: 'SEK' };
  Object.defineProperty(event, 'target', { value: { dataset: { rbForm: 'budget' }, elements: { namedItem: (n) => ({ value: values[n] }) } } });
  root.dispatchEvent(event);
}

test('the budget reads today at every render, so an open tab moves on to the new week', (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date(2026, 10, 15, 23, 59).getTime() }); // Sunday, local time
  const root = new Element();
  const budget = mountBudget(root, { storage: memoryStorage() });
  assert.match(root.markup, /2026-W46 · 2026-11-09 to 2026-11-15/);
  t.mock.timers.setTime(new Date(2026, 10, 16, 0, 1).getTime()); // Monday
  submitBudget(root);
  assert.match(root.markup, /2026-W47 · 2026-11-16 to 2026-11-22/);
  budget.destroy();

  const fixed = new Element();
  mountBudget(fixed, { storage: memoryStorage(), today: '2026-01-01' });
  t.mock.timers.setTime(new Date(2026, 5, 1).getTime());
  submitBudget(fixed);
  assert.match(fixed.markup, /2026-W01/, 'a fixed options.today stays fixed');
});

test('the static copy serves the standalone household preview and every module it loads', async (t) => {
  const bank = await tempBank([makeRecipe('alpha', 1)]);
  t.after(() => rm(bank, { recursive: true, force: true }));
  const out = join(bank, 'dist');
  await buildStatic({ outDir: out, recipesDir: join(bank, 'recipes'), queueFile: join(bank, 'data', 'queue.json') });

  const headers = await readFile(join(out, '_headers'), 'utf8');
  assert.match(headers, /^\/lib\/\*\n {2}Content-Type: text\/javascript/m);
  assert.match(headers, /^\/features\/\*\.mjs\n {2}Content-Type: text\/javascript/m);

  // Resolve imports the way the browser does: as URLs on the site, where "../../lib" stops at the root.
  const resolveUrl = (spec, from) => new URL(spec, `https://bank.example${from}`).pathname;
  const page = '/features/household-demo.html';
  const html = await readFile(join(out, page), 'utf8');
  const todo = [...html.matchAll(/\bfrom\s+['"](\.[^'"]+)['"]/g)].map((m) => resolveUrl(m[1], page));
  assert.ok(todo.length >= 2, 'the preview imports its modules');
  const seen = new Set();
  while (todo.length) {
    const urlPath = todo.pop();
    if (seen.has(urlPath)) continue;
    seen.add(urlPath);
    await stat(join(out, urlPath)); // throws if the static copy lacks it
    assert.ok(/^\/lib\/.+\.mjs$/.test(urlPath) || /^\/features\/.+\.mjs$/.test(urlPath), `${urlPath} is covered by a _headers JavaScript rule`);
    const src = (await readFile(join(out, urlPath), 'utf8')).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    for (const m of src.matchAll(/\bfrom\s+['"](\.[^'"]+)['"]/g)) todo.push(resolveUrl(m[1], urlPath));
  }
  assert.ok(seen.has('/lib/budget.mjs') && seen.has('/features/shared.mjs'));
  for (const css of ['household.css', 'budget.css']) await stat(join(out, 'features', css));
});
