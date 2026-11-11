// The saved household profile as a serving target, for the week plan and serving scaling.
// The household lane's contract (HOUSEHOLD.md): servingsPerMeal(profile) is adult-equivalent servings
// per meal; it is never multiplied again by head count or cooking days.
import { normalizeProfile, servingsPerMeal, describeProfile } from '../../lib/household.mjs';
import { HOUSEHOLD_KEY } from './household.mjs';
import { readStored } from './shared.mjs';

/**
 * { profile, servings, description } from the saved profile, or null when none is saved or storage is blocked.
 * `storage` is a getter (reading globalThis.localStorage can itself throw); tests pass their own.
 */
export function householdTarget(storage = () => globalThis.localStorage) {
  const { value } = readStored(storage, HOUSEHOLD_KEY, null);
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const profile = normalizeProfile(value);
  return { profile, servings: servingsPerMeal(profile), description: describeProfile(profile) };
}
