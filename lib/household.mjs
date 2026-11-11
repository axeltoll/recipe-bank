// Rough estimates inspired by common adult-equivalent scales, not nutritional advice.
// Individual appetites vary: every factor is editable in the device-local profile.
export const DEFAULT_PORTION_FACTORS = Object.freeze({
  age: Object.freeze({ adult: 1, teen: 1, child11to13: 0.8, child6to10: 0.6, child2to5: 0.4, toddler: 0.2 }),
  size: Object.freeze({ light: 0.8, normal: 1, hearty: 1.2 }),
});
export const AGE_GROUPS = Object.freeze({
  adult: ['adult', 'adults'],
  teen: ['teen aged 14-17', 'teens aged 14-17'],
  child11to13: ['child aged 11-13', 'children aged 11-13'],
  child6to10: ['child aged 6-10', 'children aged 6-10'],
  child2to5: ['child aged 2-5', 'children aged 2-5'],
  toddler: ['toddler under 2', 'toddlers under 2'],
});
const object = (v) => v != null && typeof v === 'object' && !Array.isArray(v);
const integer = (v, max) => Number.isInteger(v) && v >= 0 && v <= max;
const factor = (v) => Number.isFinite(v) && v >= 0.1 && v <= 3;

export function defaultProfile() {
  return {
    people: Object.fromEntries(Object.keys(AGE_GROUPS).map((k) => [k, k === 'adult' ? 2 : 0])),
    portionSize: 'normal', vegetarianDays: 0, cookingDays: 5,
    portionFactors: { age: { ...DEFAULT_PORTION_FACTORS.age }, size: { ...DEFAULT_PORTION_FACTORS.size } },
  };
}

/** A list of human-readable problems, empty when valid. Missing factors use defaults. */
export function validateProfile(p) {
  if (!object(p)) return ['profile must be an object'];
  const errors = [];
  for (const key of Object.keys(AGE_GROUPS)) {
    if (!integer(p.people?.[key], 100)) errors.push(`people.${key} must be an integer from 0 to 100`);
  }
  if (object(p.people) && Object.keys(AGE_GROUPS).every((k) => integer(p.people[k], 100)) &&
      Object.keys(AGE_GROUPS).every((k) => p.people[k] === 0)) errors.push('household must contain at least one person');
  if (!Object.hasOwn(DEFAULT_PORTION_FACTORS.size, p.portionSize)) errors.push('portionSize must be light, normal or hearty');
  for (const key of ['vegetarianDays', 'cookingDays']) {
    if (!integer(p[key], 7)) errors.push(`${key} must be an integer from 0 to 7`);
  }
  if (p.portionFactors !== undefined) {
    if (!object(p.portionFactors)) errors.push('portionFactors must be an object');
    else for (const group of ['age', 'size']) {
      if (p.portionFactors[group] !== undefined && !object(p.portionFactors[group])) {
        errors.push(`portionFactors.${group} must be an object`);
      } else for (const key of Object.keys(DEFAULT_PORTION_FACTORS[group])) {
        const value = p.portionFactors[group]?.[key];
        if (value !== undefined && !factor(value)) errors.push(`portionFactors.${group}.${key} must be a number from 0.1 to 3`);
      }
    }
  }
  return errors;
}

/** Fills defaults, clamps finite numbers, drops unknown fields; never mutates input. */
export function normalizeProfile(input) {
  const p = object(input) ? input : {};
  const result = defaultProfile();
  const clamp = (v, fallback, min, max, round = false) => {
    if (!Number.isFinite(v)) return fallback;
    return Math.min(max, Math.max(min, round ? Math.round(v) : v));
  };
  for (const key of Object.keys(AGE_GROUPS)) result.people[key] = clamp(p.people?.[key], result.people[key], 0, 100, true);
  if (Object.values(result.people).every((n) => n === 0)) result.people.adult = 1;
  if (Object.hasOwn(DEFAULT_PORTION_FACTORS.size, p.portionSize)) result.portionSize = p.portionSize;
  for (const key of ['vegetarianDays', 'cookingDays']) result[key] = clamp(p[key], result[key], 0, 7, true);
  for (const group of ['age', 'size']) for (const key of Object.keys(result.portionFactors[group])) {
    result.portionFactors[group][key] = clamp(p.portionFactors?.[group]?.[key], result.portionFactors[group][key], 0.1, 3);
  }
  return result;
}

export function servingsPerMeal(profile) {
  const p = normalizeProfile(profile);
  const servings = Object.keys(AGE_GROUPS).reduce((n, key) => n + p.people[key] * p.portionFactors.age[key], 0);
  return Math.round(servings * p.portionFactors.size[p.portionSize] * 10) / 10;
}

export function describeProfile(profile) {
  const p = normalizeProfile(profile);
  return Object.entries(AGE_GROUPS).filter(([key]) => p.people[key] > 0)
    .map(([key, labels]) => `${p.people[key]} ${labels[p.people[key] === 1 ? 0 : 1]}`).join(', ');
}
