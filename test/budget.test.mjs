import { test } from 'node:test';
import assert from 'node:assert/strict';
import { currencyDigits, toMinor, formatMoney, validateBudget, validateShop, periodOf, summary } from '../lib/budget.mjs';
import { defaultProfile } from '../lib/household.mjs';
const budget = { period: 'week', amount: '100.00', currency: 'SEK' };
const shop = { date: '2026-11-11', total: '10.00', currency: 'SEK' };

test('budget and shop validation rules', () => {
  assert.deepEqual(validateBudget(budget), []); assert.deepEqual(validateShop(shop), []);
  for (const value of [undefined, null, [], 'x', 4]) {
    assert.ok(validateBudget(value).length); assert.ok(validateShop(value).length);
  }
  for (const period of ['year', '', undefined]) assert.ok(validateBudget({ ...budget, period }).length);
  for (const currency of ['sek', 'ZZZ', 'EURO', '', null, undefined]) {
    assert.ok(validateBudget({ ...budget, currency }).length); assert.ok(validateShop({ ...shop, currency }).length);
  }
  for (const amount of [-1, '-1', '', ' 1', '1 ', null, undefined, {}, NaN, Infinity, '1e999', '9007199254740992']) {
    assert.ok(validateBudget({ ...budget, amount }).length, String(amount));
    assert.ok(validateShop({ ...shop, total: amount }).length, String(amount));
  }
  for (const date of ['2025-02-29', '2024-04-31', '2026-13-01', '2026-1-01', '', null]) assert.ok(validateShop({ ...shop, date }).length);
  for (const meals of [0, -1, 1.5, '2', null, Infinity, Number.MAX_SAFE_INTEGER + 1]) assert.ok(validateShop({ ...shop, meals }).length);
  for (const note of [null, 2, 'a'.repeat(201), 'a\nb', 'a\rb', 'a\0b']) assert.ok(validateShop({ ...shop, note }).length);
  assert.deepEqual(validateShop({ ...shop, date: '2024-02-29', total: 0, meals: 1, note: '' }), []);
});

test('minor units round decimal halves precisely for different currencies and exponents', () => {
  assert.equal(toMinor('.5', 'SEK'), 50); assert.equal(toMinor('1.', 'SEK'), 100);
  assert.equal(toMinor(1.005, 'SEK'), 101); assert.equal(toMinor(2.675, 'SEK'), 268);
  assert.equal(toMinor('0.0049', 'SEK'), 0); assert.equal(toMinor('0.005', 'SEK'), 1);
  assert.equal(toMinor('123.5', 'JPY'), 124); assert.equal(currencyDigits('JPY'), 0);
  assert.equal(toMinor('1.2345', 'KWD'), 1235); assert.equal(currencyDigits('KWD'), 3);
  assert.equal(toMinor(1e-7, 'SEK'), 0); assert.equal(toMinor('1.23e2', 'SEK'), 12300);
  assert.equal(toMinor('90071992547409.91', 'SEK'), Number.MAX_SAFE_INTEGER);
  assert.throws(() => toMinor('90071992547409.92', 'SEK'));
  assert.equal(formatMoney(101, 'USD', 'en-US'), '$1.01');
  assert.equal(formatMoney(-1, 'USD', 'en-US'), '-$0.01');
  assert.equal(formatMoney(Number.MAX_SAFE_INTEGER, 'USD', 'en-US'), '$90,071,992,547,409.91');
  assert.match(formatMoney(101, 'SEK', 'sv-SE'), /1,01/);
  assert.throws(() => formatMoney(1.5, 'USD')); assert.throws(() => currencyDigits('ZZZ'));
});

test('ISO weeks across year ends and 53-week years', () => {
  assert.deepEqual(periodOf('2021-01-01', 'week'), { key: '2020-W53', start: '2020-12-28', end: '2021-01-03' });
  assert.deepEqual(periodOf('2021-01-04', 'week'), { key: '2021-W01', start: '2021-01-04', end: '2021-01-10' });
  assert.equal(periodOf('2015-12-31', 'week').key, '2015-W53');
  assert.equal(periodOf('2016-01-03', 'week').key, '2015-W53');
  assert.equal(periodOf('2018-12-31', 'week').key, '2019-W01');
  assert.equal(periodOf('2026-12-31', 'week').key, '2026-W53');
  assert.equal(periodOf('0099-01-05', 'week').key, '0099-W02');
});

test('calendar months include leap days and year transitions', () => {
  assert.deepEqual(periodOf('2024-02-29', 'month'), { key: '2024-02', start: '2024-02-01', end: '2024-02-29' });
  assert.equal(periodOf('2025-02-15', 'month').end, '2025-02-28');
  assert.equal(periodOf('2026-12-31', 'month').end, '2026-12-31');
  assert.equal(periodOf('2026-04-30', 'month').end, '2026-04-30');
  assert.throws(() => periodOf('2025-02-29', 'week')); assert.throws(() => periodOf('2026-11-11', 'year'));
});

test('summary separates currencies, avoids float drift and uses only explicit meal data', () => {
  const result = summary(budget, [
    { ...shop, total: '0.10', meals: 2 }, { ...shop, total: '0.20', meals: 1 },
    { ...shop, total: '3' }, { ...shop, total: '7', currency: 'USD', meals: 10 },
    { ...shop, total: '1', currency: 'USD' }, { ...shop, date: '2026-11-08', total: '9' },
    { ...shop, total: -1 },
  ], { household: defaultProfile(), today: shop.date, periods: 2 });
  assert.equal(result.spendMinor, 330); assert.equal(result.remainingMinor, 9670);
  assert.equal(result.meals, 3); assert.equal(result.mealSpendMinor, 30); assert.equal(result.perMealMinor, 10);
  assert.equal(result.perPersonMinor, 165);
  assert.deepEqual(result.otherCurrencies, [{ currency: 'USD', spendMinor: 800, shopCount: 2 }]);
  assert.equal(result.history[0].spendMinor, 900); assert.equal(result.history[1].key, result.key);
  assert.equal(result.invalidShops.length, 1);
});

test('empty data, unavailable metrics, overspend, history and input errors', () => {
  const empty = summary(budget, [], { today: shop.date });
  assert.equal(empty.spendMinor, 0); assert.equal(empty.remainingMinor, 10000);
  assert.equal(empty.perMealMinor, null); assert.equal(empty.perPersonMinor, null); assert.equal(empty.people, null);
  assert.equal(empty.history.length, 8);
  assert.equal(summary(budget, [{ ...shop, total: '101' }], { today: shop.date }).remainingMinor, -100);
  assert.equal(summary(budget, [shop], { today: shop.date }).perPersonMinor, null);
  const months = summary({ ...budget, period: 'month' }, [{ ...shop, date: '2024-02-29' }], { today: '2024-03-01', periods: 3 });
  assert.deepEqual(months.history.map((p) => p.key), ['2024-01', '2024-02', '2024-03']);
  assert.equal(months.history[1].spendMinor, 1000);
  for (const periods of [0, 53, 1.5]) assert.throws(() => summary(budget, [], { periods }));
  assert.throws(() => summary({}, [])); assert.throws(() => summary(budget, {}));
  assert.throws(() => summary(budget, [], { today: 'bad' }));
  assert.throws(() => summary(budget, [{ ...shop, total: '90071992547409.91' }, shop], { today: shop.date }));
});

test('ratio rounding, zero spend and currencies with different precision', () => {
  const p = defaultProfile();
  const result = summary(budget, [{ ...shop, total: '0.01', meals: 2 },
    { ...shop, currency: 'JPY', total: '10.5' },
    { ...shop, currency: 'KWD', total: '1.2345' }], { today: shop.date, household: p });
  assert.equal(result.perMealMinor, 1); assert.equal(result.perPersonMinor, 1);
  assert.deepEqual(result.otherCurrencies.map((c) => [c.currency, c.spendMinor]), [['JPY', 11], ['KWD', 1235]]);
  const zero = summary({ ...budget, amount: '0' }, [{ ...shop, total: '0', meals: 1 }], { today: shop.date, household: p });
  assert.equal(zero.perMealMinor, 0); assert.equal(zero.perPersonMinor, 0);
  const history = summary({ ...budget, period: 'month' }, [], { today: '2027-01-01', periods: 3 }).history;
  assert.deepEqual(history.map((p) => p.key), ['2026-11', '2026-12', '2027-01']);
  assert.throws(() => periodOf('1900-02-29', 'month'));
  assert.equal(periodOf('2000-02-29', 'month').end, '2000-02-29');
});
