import { test } from 'node:test';
import assert from 'node:assert/strict';
import { exportShopsCsv, importShopsCsv, summary } from '../lib/budget.mjs';
import { renderSpendChart } from '../public/features/budget.mjs';
const shop = { date: '2024-02-29', total: '1.005', currency: 'SEK', meals: 2, note: 'Beans, "large" tins' };

test('CSV header and quoted notes round-trip, preserving decimal inputs', () => {
  const csv = exportShopsCsv([shop, { date: shop.date, total: '0', currency: 'JPY' }]);
  assert.ok(csv.startsWith('date,total,currency,meals,note\r\n'));
  assert.ok(csv.includes('"Beans, ""large"" tins"'));
  assert.deepEqual(importShopsCsv(csv)[0], shop);
  assert.equal(importShopsCsv(csv)[1].meals, undefined);
  assert.deepEqual(importShopsCsv('\uFEFF' + csv.replaceAll('\r\n', '\n')), importShopsCsv(csv));
  assert.deepEqual(importShopsCsv(exportShopsCsv([])), []);
  assert.equal(importShopsCsv('date,total,currency,meals,note\n2024-02-29,0,SEK,,plain')[0].note, 'plain');
});

test('CSV rejects malformed headers, rows, quoting, fields and limits atomically', () => {
  for (const input of [null, 'x'.repeat(1_000_001), '', 'date,total,currency',
    'date,total,currency,meals,note\n"unterminated',
    'date,total,currency,meals,note\n2024-02-29,1,SEK,,"note"trailer',
    'date,total,currency,meals,note\n2024-02-29,1,SEK,,no"te',
    'date,total,currency,meals,note\n2024-02-29,1,SEK,,note,extra',
    'date,total,currency,meals,note\n2024-02-30,1,SEK,,bad',
    'date,total,currency,meals,note\n2024-02-29,-1,SEK,,bad',
    'date,total,currency,meals,note\n2024-02-29,1,ZZZ,,bad',
    'date,total,currency,meals,note\n2024-02-29,1,SEK,2e1,bad',
    'date,total,currency,meals,note\n2024-02-29,1,SEK,,"multi\nline"',
    'date,total,currency,meals,note\n' + '2024-02-29,1,SEK,,\n'.repeat(10_001),
  ]) assert.throws(() => importShopsCsv(input));
  assert.throws(() => exportShopsCsv([{}, shop])); assert.throws(() => exportShopsCsv(null));
});

test('SVG chart escapes text, handles empty spend, and exposes exact values', () => {
  assert.equal(renderSpendChart([]), '');
  const report = summary({ period: 'month', amount: '10', currency: 'SEK' }, [shop], { today: shop.date });
  const svg = renderSpendChart(report.history);
  assert.ok(svg.includes('<svg')); assert.ok(svg.includes('role="img"'));
  assert.ok(svg.includes('SEK')); assert.ok(svg.includes('1.01'));
  assert.ok(!svg.includes('NaN')); assert.ok(!svg.includes('Infinity'));
  const hostile = renderSpendChart([{ key: '<script>&"', spendMinor: 0, currency: 'USD' }]);
  assert.ok(hostile.includes('&lt;script&gt;&amp;&quot;')); assert.ok(!hostile.includes('<script>'));
});
