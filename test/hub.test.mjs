import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHub, MOUNTS, REPEATED_MOUNTS, EVENTS, RESERVED_ROUTES, LAYOUTS } from '../lib/hub.mjs';

const pork = { id: 'pork', status: 'analyzed' };
const tofu = { id: 'tofu', status: 'partial' };

test('a registered filter becomes a predicate; removing it takes it away', () => {
  const hub = createHub();
  assert.deepEqual(hub.tests(), []);
  const off = hub.addFilter('no-pork', (r) => r.id !== 'pork');
  const [t] = hub.tests();
  assert.equal(t(pork), false);
  assert.equal(t(tofu), true);
  off();
  assert.equal(hub.tests().length, 0);
});

test('the object form reports how many conditions are on, describes them and clears them', () => {
  const hub = createHub();
  const excluded = new Set(['pork', 'nuts']);
  let tagsCleared = 0;
  hub.addFilter('exclude', {
    test: () => true,
    active: () => excluded.size,
    describe: () => [...excluded].map((k) => `without ${k}`),
    clear: () => excluded.clear(),
  });
  hub.addFilter('tags', { test: () => true, active: () => 1, describe: () => ['air fryer'], clear: () => { tagsCleared++; } });
  hub.addFilter('plain', () => true);

  assert.equal(hub.activeCount(), 3);
  assert.deepEqual(hub.describe(), [
    { id: 'exclude', label: 'without pork' },
    { id: 'exclude', label: 'without nuts' },
    { id: 'tags', label: 'air fryer' },
  ]);

  hub.clear('tags');
  assert.equal(tagsCleared, 1);
  assert.equal(excluded.size, 2, 'clearing one filter leaves the others alone');

  hub.clear();
  assert.equal(tagsCleared, 2);
  assert.equal(excluded.size, 0);
  assert.equal(hub.activeCount(), 1);
});

test('a broken feature filter never hides recipes and is reported', () => {
  const warnings = [];
  const hub = createHub({ warn: (...args) => warnings.push(args) });
  hub.addFilter('broken', {
    test: () => { throw new Error('boom'); },
    active: () => { throw new Error('boom'); },
    describe: () => { throw new Error('boom'); },
    clear: () => { throw new Error('boom'); },
  });
  hub.addFilter('odd', { test: () => 1, active: () => 'many' });
  hub.addFilter('negative', { test: () => 0, active: () => -2 });

  const [broken, odd, negative] = hub.tests();
  assert.equal(broken(pork), true);
  assert.equal(odd(pork), true, 'truthy results are coerced to booleans');
  assert.equal(negative(pork), false);
  assert.equal(hub.activeCount(), 0, 'throwing, non-numeric and negative counts are ignored');
  assert.deepEqual(hub.describe(), []);
  assert.doesNotThrow(() => hub.clear());
  assert.equal(warnings.length, 4);
  assert.match(warnings[0][0], /broken/);
});

test('addFilter validates its arguments and re-registering an id replaces the filter', () => {
  const hub = createHub();
  assert.throws(() => hub.addFilter('', () => true), TypeError);
  assert.throws(() => hub.addFilter(42, () => true), TypeError);
  assert.throws(() => hub.addFilter('x'), TypeError);
  assert.throws(() => hub.addFilter('x', { active: () => 1 }), TypeError);

  const offOld = hub.addFilter('same', () => false);
  hub.addFilter('same', () => true);
  assert.equal(hub.tests().length, 1);
  assert.equal(hub.tests()[0](pork), true);
  offOld();
  assert.equal(hub.tests().length, 1, 'the old remover must not remove the replacement');
  assert.equal(hub.removeFilter('same'), true);
  assert.equal(hub.removeFilter('same'), false);
});

test('routes are registered with a layout type and show up in the navigation when labelled', () => {
  const hub = createHub();
  const render = () => {};
  const off = hub.addRoute('plan', { render, label: 'Week plan' });
  hub.addRoute('shop', { render, layout: 'detail' });

  assert.deepEqual(hub.routeNames(), ['plan', 'shop']);
  assert.equal(hub.route('plan').layout, 'list', 'layout defaults to list');
  assert.equal(hub.route('plan').render, render);
  assert.equal(hub.route('shop').layout, 'detail');
  assert.equal(hub.route('nope'), undefined);
  assert.deepEqual(hub.navItems(), [{ name: 'plan', label: 'Week plan', href: '#/plan' }]);

  off();
  assert.deepEqual(hub.routeNames(), ['shop']);
  assert.deepEqual(hub.navItems(), []);
});

test('re-registering a route replaces it, and the old remover leaves the replacement alone', () => {
  const hub = createHub();
  const first = () => {};
  const second = () => {};
  const offFirst = hub.addRoute('plan', { render: first });
  const offSecond = hub.addRoute('plan', { render: second });
  offFirst();
  assert.equal(hub.route('plan')?.render, second, 'the old remover must not remove the replacement');
  offSecond();
  assert.equal(hub.route('plan'), undefined);
});

test('addRoute rejects reserved names, bad names, a missing render and unknown layouts', () => {
  const hub = createHub();
  const render = () => {};
  for (const name of RESERVED_ROUTES) assert.throws(() => hub.addRoute(name, { render }), TypeError, name);
  for (const name of ['', 'Plan', '1plan', 'week plan', 'a/b', null]) {
    assert.throws(() => hub.addRoute(name, { render }), TypeError, String(name));
  }
  assert.throws(() => hub.addRoute('plan', {}), TypeError);
  assert.throws(() => hub.addRoute('plan'), TypeError);
  assert.throws(() => hub.addRoute('plan', { render, layout: 'wide' }), TypeError);
  assert.deepEqual(hub.routeNames(), []);
});

test('the published names are stable', () => {
  assert.deepEqual(Object.keys(MOUNTS).sort(), [
    'filter-exclude', 'filter-nutrition', 'filter-tags', 'home-tools', 'home-top',
    'recipe-actions', 'recipe-aside', 'recipe-scaling', 'topbar',
  ]);
  for (const [name, id] of Object.entries(MOUNTS)) assert.equal(id, `mount-${name}`);
  assert.deepEqual(REPEATED_MOUNTS, ['card-actions']);
  assert.deepEqual(EVENTS, ['ready', 'view', 'grid', 'filters', 'check', 'cook']);
  assert.deepEqual(RESERVED_ROUTES, ['r', 'q']);
  assert.deepEqual(LAYOUTS, ['list', 'detail', 'message']);
});
