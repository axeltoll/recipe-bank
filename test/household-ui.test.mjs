import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultProfile } from '../lib/household.mjs';
import { renderHousehold, mount as mountHousehold, HOUSEHOLD_KEY } from '../public/features/household.mjs';
import { renderBudget, mount as mountBudget, BUDGET_KEY, defaultBudget } from '../public/features/budget.mjs';
import { esc, readStored, writeStored } from '../public/features/shared.mjs';

// Only the event/element surface used by mount. No browser globals or dependencies needed.
class Element extends EventTarget {
  markup = '';
  renders = 0;
  get innerHTML() { return this.markup; }
  set innerHTML(html) { this.markup = html; this.renders++; }
  status = { textContent: '', setAttribute() {} };
  summary = { innerHTML: '' };
  ownerDocument = { defaultView: { CustomEvent } };
  contains(target) { return target.inside !== false; }
  querySelector(selector) { return selector === '.rb-budget-summary' ? this.summary : this.status; }
}
const form = (kind, values) => ({ dataset: { rbForm: kind }, elements: { namedItem: (name) => ({ value: String(values[name] ?? '') }) } });
function submit(root, kind, values) {
  const event = new Event('submit', { cancelable: true });
  Object.defineProperty(event, 'target', { value: form(kind, values) });
  root.dispatchEvent(event);
  return event;
}
function profileFields(p = defaultProfile()) {
  const values = { portionSize: p.portionSize, vegetarianDays: p.vegetarianDays, cookingDays: p.cookingDays };
  for (const [k, v] of Object.entries(p.people)) values[`people.${k}`] = v;
  for (const group of ['age', 'size']) for (const [k, v] of Object.entries(p.portionFactors[group])) values[`factor.${group}.${k}`] = v;
  return values;
}
const memoryStorage = () => {
  const data = new Map();
  return { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => data.set(k, v) };
};
const throwingStorage = { getItem() { throw Error('read denied'); }, setItem() { throw Error('write denied'); } };
const today = '2026-11-11';

test('pure renderers escape all user strings including hostile shop notes and errors', () => {
  const attack = '<img src=x onerror="alert(1)">&\'';
  assert.equal(esc(attack), '&lt;img src=x onerror=&quot;alert(1)&quot;&gt;&amp;&#39;');
  const html = renderBudget(defaultBudget(), [{ date: today, total: '12', currency: 'SEK', note: attack }], { today, household: defaultProfile(), message: attack, errors: [attack] });
  assert.ok(html.includes(esc(attack))); assert.ok(!html.includes('<img'));
  assert.ok(renderHousehold(defaultProfile(), { message: attack, errors: [attack] }).includes(esc(attack)));
  assert.match(renderBudget(defaultBudget(), [], { today }), /No shops recorded yet/);
  assert.match(renderHousehold(defaultProfile()), /2.0 adult-equivalent/);
});

test('storage helpers handle disabled storage, thrown getters, corrupt JSON and write failures', () => {
  for (const storage of [() => throwingStorage, () => null, () => { throw Error('getter'); }, () => ({ getItem: () => '{bad' })]) {
    assert.deepEqual(readStored(storage, 'recipe-bank:test', 'fallback'), { value: 'fallback', available: false });
    assert.equal(writeStored(storage, 'recipe-bank:test', {}), false);
  }
  const storage = memoryStorage();
  assert.equal(writeStored(() => storage, 'recipe-bank:test', { a: 1 }), true);
  assert.deepEqual(readStored(() => storage, 'recipe-bank:test', null).value, { a: 1 });
});

test('household mount saves, emits exact serving interface, validates, reloads and destroys', () => {
  const root = new Element(), storage = memoryStorage();
  const mounted = mountHousehold(root, { storage });
  let detail; root.addEventListener('recipe-bank:household-change', (e) => { detail = e.detail; });
  const values = { ...profileFields(), 'people.child6to10': 1 };
  assert.equal(submit(root, 'household', values).defaultPrevented, true);
  assert.equal(detail.servingsPerMeal, 2.6); assert.equal(detail.profile.people.child6to10, 1);
  assert.equal(JSON.parse(storage.getItem(HOUSEHOLD_KEY)).people.child6to10, 1);
  detail.profile.people.adult = 90; // Event consumers cannot mutate the internal profile.
  const fresh = new Element(); mountHousehold(fresh, { storage }); assert.match(fresh.innerHTML, /2 adults/);
  submit(root, 'household', { ...values, 'people.adult': '' }); assert.match(root.status.textContent, /people.adult/);
  mounted.destroy(); assert.equal(root.innerHTML, '');
  submit(root, 'household', values); assert.equal(root.innerHTML, '');
});

test('both modules remain usable when storage reads and writes throw', () => {
  for (const storage of [throwingStorage, null]) {
    const h = new Element(); mountHousehold(h, { storage });
    assert.match(h.innerHTML, /Storage unavailable/);
    let servings; h.addEventListener('recipe-bank:household-change', (e) => { servings = e.detail.servingsPerMeal; });
    submit(h, 'household', profileFields()); assert.equal(servings, 2);
    assert.match(h.innerHTML, /Storage unavailable/);
    const b = new Element(); const mounted = mountBudget(b, { storage, today });
    submit(b, 'shop', { date: today, total: '12.50', currency: 'SEK', note: 'visit only' });
    assert.match(b.innerHTML, /visit only/); assert.match(b.innerHTML, /Storage unavailable/);
    mounted.destroy(); assert.equal(b.innerHTML, '');
  }
});

test('budget forms, currency flags, event details, household updates, remove and cleanup', () => {
  const root = new Element(), h = new Element(), storage = memoryStorage();
  const mounted = mountBudget(root, { storage, today, householdElement: h });
  let detail; root.addEventListener('recipe-bank:budget-change', (e) => { detail = e.detail; });
  submit(root, 'budget', { period: 'month', amount: '200', currency: 'sek' });
  assert.equal(detail.budget.currency, 'SEK'); assert.equal(detail.budget.period, 'month');
  submit(root, 'shop', { date: today, total: '10', currency: 'SEK', meals: '2', note: 'pantry' });
  assert.equal(detail.summary.perMealMinor, 500); assert.equal(detail.summary.perPersonMinor, 500);
  submit(root, 'shop', { date: today, total: '5', currency: 'USD' });
  assert.match(root.innerHTML, /Other currencies excluded/);
  assert.equal(JSON.parse(storage.getItem(BUDGET_KEY)).shops.length, 2);
  const p = defaultProfile(); p.people.adult = 1;
  const rendersBeforeHouseholdSave = root.renders;
  h.dispatchEvent(new CustomEvent('recipe-bank:household-change', { detail: { profile: p } }));
  assert.equal(root.renders, rendersBeforeHouseholdSave, 'household saves must preserve unsaved budget and shop forms');
  assert.match(root.summary.innerHTML, /Per person<\/dt><dd>SEK\s*10.00/);
  mounted.setHousehold(defaultProfile());
  assert.equal(root.renders, rendersBeforeHouseholdSave);
  assert.match(root.summary.innerHTML, /Per person<\/dt><dd>SEK\s*5.00/);
  detail.shops[0].total = '10000';
  const button = { dataset: { rbRemove: '1' } };
  const click = new Event('click'); Object.defineProperty(click, 'target', { value: { closest: () => button } });
  root.dispatchEvent(click); assert.equal(detail.shops.length, 1); assert.equal(detail.shops[0].total, '10');
  const fresh = new Element(); mountBudget(fresh, { storage, today }); assert.match(fresh.innerHTML, /pantry/);
  submit(root, 'budget', { period: 'year', amount: '-1', currency: 'BAD' }); assert.match(root.status.textContent, /period must/);
  submit(root, 'shop', { date: '2026-02-30', total: '2', currency: 'SEK' }); assert.match(root.status.textContent, /real YYYY/);
  mounted.destroy();
  h.dispatchEvent(new CustomEvent('recipe-bank:household-change', { detail: { profile: p } }));
  root.dispatchEvent(click); assert.equal(root.innerHTML, '');
});

test('corrupt persisted shapes are filtered and profile fields are allowlisted', () => {
  const storage = memoryStorage();
  storage.setItem(BUDGET_KEY, JSON.stringify({ budget: null, shops: [{ note: 'bad' }] }));
  const root = new Element(); mountBudget(root, { storage, today });
  assert.match(root.innerHTML, /invalid and was skipped/); assert.match(root.innerHTML, /No shops recorded/);
  storage.setItem(HOUSEHOLD_KEY, JSON.stringify({ people: { adult: 3 }, name: 'never render this' }));
  const h = new Element(); mountHousehold(h, { storage });
  assert.match(h.innerHTML, /3 adults/); assert.ok(!h.innerHTML.includes('never render this'));
});

test('CSV import appends valid rows, emits changes and rejects bad imports without mutation', () => {
  const root = new Element(), storage = memoryStorage();
  mountBudget(root, { storage, today });
  let detail; root.addEventListener('recipe-bank:budget-change', (e) => { detail = e.detail; });
  submit(root, 'shops-csv', { csv: `date,total,currency,meals,note\n${today},12,SEK,2,"Beans, ""big"" tins"` });
  assert.equal(detail.shops.length, 1); assert.equal(detail.shops[0].note, 'Beans, "big" tins');
  assert.match(root.innerHTML, /CSV export/);
  submit(root, 'shops-csv', { csv: 'bad header' });
  assert.match(root.status.textContent, /header must/);
  assert.equal(JSON.parse(storage.getItem(BUDGET_KEY)).shops.length, 1);
});

test('mounts survive a throwing global localStorage getter and a failed write after a valid read', () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  try {
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw Error('blocked getter'); } });
    const h = new Element(), b = new Element();
    mountHousehold(h); mountBudget(b, { today });
    assert.match(h.innerHTML, /Storage unavailable/); assert.match(b.innerHTML, /Storage unavailable/);
    submit(h, 'household', profileFields());
    submit(b, 'shop', { date: today, total: '1', currency: 'SEK' });
    assert.match(h.innerHTML, /Storage unavailable/); assert.match(b.innerHTML, /Storage unavailable/);
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'localStorage', descriptor);
    else delete globalThis.localStorage;
  }
  const quota = { getItem() { return null; }, setItem() { throw Error('quota'); } };
  const root = new Element(); mountBudget(root, { storage: quota, today });
  assert.ok(!root.innerHTML.includes('Storage unavailable'));
  submit(root, 'shop', { date: today, total: '1', currency: 'SEK' });
  assert.match(root.innerHTML, /Storage unavailable/);
});

test('overflow is shown without dropping shops, and hostile textarea notes stay escaped', () => {
  const html = renderBudget(defaultBudget(), [
    { date: today, total: '90071992547409.91', currency: 'SEK' },
    { date: today, total: '1', currency: 'SEK', note: '</textarea><script>alert(1)</script>' },
    null,
  ], { today });
  assert.match(html, /Combined amounts exceed/);
  assert.match(html, /Remove shop 1/); assert.match(html, /Invalid shop/);
  assert.ok(!html.includes('<script>')); assert.ok(html.includes('&lt;/textarea&gt;'));
});
