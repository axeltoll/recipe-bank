import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AGE_GROUPS, DEFAULT_PORTION_FACTORS, defaultProfile, validateProfile, normalizeProfile, servingsPerMeal, describeProfile } from '../lib/household.mjs';

test('default household is valid and independent on every call', () => {
  const a = defaultProfile();
  assert.deepEqual(validateProfile(a), []);
  a.people.adult = 8; a.portionFactors.age.adult = 2;
  assert.equal(defaultProfile().people.adult, 2);
  assert.equal(DEFAULT_PORTION_FACTORS.age.adult, 1);
});

test('all household validation rules reject invalid values', () => {
  for (const value of [null, undefined, [], 2, 'profile']) assert.ok(validateProfile(value).length);
  for (const key of Object.keys(AGE_GROUPS)) {
    for (const value of [-1, 101, 1.5, '2', NaN, Infinity, undefined]) {
      const p = defaultProfile(); p.people[key] = value;
      assert.ok(validateProfile(p).some((e) => e.includes(`people.${key}`)));
    }
  }
  const empty = defaultProfile(); empty.people.adult = 0;
  assert.ok(validateProfile(empty).some((e) => e.includes('at least one')));
  for (const value of ['large', null, 'toString']) assert.ok(validateProfile({ ...defaultProfile(), portionSize: value }).length);
  for (const key of ['vegetarianDays', 'cookingDays']) for (const value of [-1, 8, 1.5, '5', undefined]) {
    assert.ok(validateProfile({ ...defaultProfile(), [key]: value }).some((e) => e.startsWith(key)));
  }
  for (const value of [null, [], 'bad']) assert.ok(validateProfile({ ...defaultProfile(), portionFactors: value }).length);
  for (const group of ['age', 'size']) {
    assert.ok(validateProfile({ ...defaultProfile(), portionFactors: { [group]: [] } }).length);
    for (const key of Object.keys(DEFAULT_PORTION_FACTORS[group])) for (const value of [0, 3.1, '1', NaN, Infinity, null]) {
      assert.ok(validateProfile({ ...defaultProfile(), portionFactors: { [group]: { [key]: value } } }).length);
    }
  }
  assert.deepEqual(validateProfile({ ...defaultProfile(), portionFactors: {} }), []);
});

test('normalization fills, clamps, rounds, removes unknown fields and never mutates', () => {
  for (const input of [null, [], undefined, 'bad']) assert.deepEqual(normalizeProfile(input), defaultProfile());
  const raw = { people: { adult: -2, teen: 200, child6to10: 1.6 }, cookingDays: 99, vegetarianDays: -5,
    portionSize: 'bad', privateText: 'discard', portionFactors: { age: { adult: 8, teen: -1 }, size: { normal: NaN } } };
  const p = normalizeProfile(raw);
  assert.equal(p.people.adult, 0); assert.equal(p.people.teen, 100); assert.equal(p.people.child6to10, 2);
  assert.equal(p.cookingDays, 7); assert.equal(p.vegetarianDays, 0);
  assert.equal(p.portionFactors.age.adult, 3); assert.equal(p.portionFactors.age.teen, 0.1);
  assert.equal(p.portionFactors.size.normal, 1); assert.equal(p.privateText, undefined);
  assert.equal(raw.people.adult, -2); assert.deepEqual(validateProfile(p), []);
  assert.equal(normalizeProfile({ people: Object.fromEntries(Object.keys(AGE_GROUPS).map((k) => [k, 0])) }).people.adult, 1);
  assert.equal(normalizeProfile({ people: { adult: Infinity }, cookingDays: '7' }).cookingDays, 5);
});

test('mixed households, sizes, custom factors and descriptions', () => {
  const p = defaultProfile(); p.people.child6to10 = 1;
  assert.equal(servingsPerMeal(p), 2.6);
  assert.equal(describeProfile(p), '2 adults, 1 child aged 6-10');
  p.portionSize = 'light'; assert.equal(servingsPerMeal(p), 2.1);
  p.portionSize = 'hearty'; assert.equal(servingsPerMeal(p), 3.1);
  p.portionFactors.age.child6to10 = 1; assert.equal(servingsPerMeal(p), 3.6);
  for (const key of Object.keys(AGE_GROUPS)) p.people[key] = 1;
  p.portionSize = 'normal'; p.portionFactors = undefined;
  assert.equal(servingsPerMeal(p), 4);
  assert.match(describeProfile(p), /1 adult, 1 teen aged 14-17, 1 child aged 11-13/);
  p.people.toddler = 2; assert.match(describeProfile(p), /2 toddlers under 2/);
});

test('normalization fills nested invalid values and keeps independent planning days', () => {
  const p = normalizeProfile({ people: { adult: '3', teen: NaN }, vegetarianDays: 6.6, cookingDays: 0.2,
    portionFactors: { age: { adult: null }, size: { light: Infinity, normal: 0.05, hearty: 4 } } });
  assert.equal(p.people.adult, 2); assert.equal(p.people.teen, 0);
  assert.equal(p.vegetarianDays, 7); assert.equal(p.cookingDays, 0);
  assert.equal(p.portionFactors.age.adult, 1); assert.equal(p.portionFactors.size.light, 0.8);
  assert.equal(p.portionFactors.size.normal, 0.1); assert.equal(p.portionFactors.size.hearty, 3);
  assert.deepEqual(validateProfile(p), []);
});
