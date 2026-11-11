import { AGE_GROUPS, DEFAULT_PORTION_FACTORS, defaultProfile, normalizeProfile, validateProfile, servingsPerMeal, describeProfile } from '../../lib/household.mjs';
import { esc, selected, field, numberField, storageFor, readStored, writeStored, emit, renderNotice } from './shared.mjs';

export const HOUSEHOLD_KEY = 'recipe-bank:household';
export function renderHousehold(profile, { message = 'Anonymous. Saved only on this device.', errors = [] } = {}) {
  const p = normalizeProfile(profile);
  return `<section class="rb-household" aria-label="Household profile">
    <h2>Household profile</h2>
    <p>No names or accounts. Set the people you usually cook for.</p>
    ${renderNotice(message, errors)}
    <form data-rb-form="household">
      <fieldset><legend>People</legend><div class="rb-household-grid">
      ${Object.entries(AGE_GROUPS).map(([key, labels]) => `<label>${esc(labels[1])}
        <input name="people.${esc(key)}" type="number" min="0" max="100" step="1" required value="${esc(p.people[key])}"></label>`).join('')}
      </div></fieldset>
      <div class="rb-household-grid">
        <label>Portion size<select name="portionSize">${Object.keys(DEFAULT_PORTION_FACTORS.size).map((size) =>
          `<option value="${esc(size)}"${selected(size, p.portionSize)}>${esc(size)}</option>`).join('')}</select></label>
        <label>Vegetarian days per week<input name="vegetarianDays" type="number" min="0" max="7" step="1" required value="${esc(p.vegetarianDays)}"></label>
        <label>Cooking days per week<input name="cookingDays" type="number" min="0" max="7" step="1" required value="${esc(p.cookingDays)}"></label>
      </div>
      <details><summary>Adjust portion estimates</summary>
        <p>Rough adult-equivalent estimates, not nutritional targets. Change these for your household’s appetites.</p>
        ${['age', 'size'].map((group) => `<fieldset><legend>${group === 'age' ? 'Age factors' : 'Size multipliers'}</legend><div class="rb-household-grid">
          ${Object.entries(p.portionFactors[group]).map(([key, value]) => `<label>${esc(group === 'age' ? AGE_GROUPS[key][1] : key)}
            <input name="factor.${esc(group)}.${esc(key)}" type="number" min="0.1" max="3" step="any" required value="${esc(value)}"></label>`).join('')}
          </div></fieldset>`).join('')}
      </details>
      <p><strong>${esc(describeProfile(p))}</strong><br>${esc(servingsPerMeal(p).toFixed(1))} adult-equivalent servings per meal (estimate).</p>
      <button type="submit">Save household</button>
    </form>
  </section>`;
}
export function profileFromForm(form) {
  const p = defaultProfile();
  for (const key of Object.keys(AGE_GROUPS)) p.people[key] = numberField(form, `people.${key}`);
  p.portionSize = field(form, 'portionSize');
  for (const key of ['vegetarianDays', 'cookingDays']) p[key] = numberField(form, key);
  for (const group of ['age', 'size']) for (const key of Object.keys(p.portionFactors[group])) {
    p.portionFactors[group][key] = numberField(form, `factor.${group}.${key}`);
  }
  return p;
}
export function mount(element, options = {}) {
  const storage = storageFor(options);
  const stored = readStored(storage, HOUSEHOLD_KEY, defaultProfile());
  let profile = normalizeProfile(options.profile ?? stored.value);
  let available = stored.available;
  const render = (errors = [], message) => {
    element.innerHTML = renderHousehold(profile, { errors,
      message: message ?? (available ? 'Anonymous. Saved only on this device when you press Save.' : 'Storage unavailable or unreadable. Changes work for this visit only.') });
  };
  const submit = (event) => {
    if (event.target.dataset.rbForm !== 'household') return;
    event.preventDefault();
    const next = profileFromForm(event.target);
    const errors = validateProfile(next);
    if (errors.length) {
      // Keep the form values so they can be corrected; render errors without replacing inputs.
      const status = element.querySelector('.rb-feature-status');
      status.textContent = errors.join('; '); status.setAttribute('role', 'alert');
      return;
    }
    profile = normalizeProfile(next);
    available = writeStored(storage, HOUSEHOLD_KEY, profile);
    render([], available ? 'Household saved on this device.' : undefined);
    emit(element, 'recipe-bank:household-change', { profile: normalizeProfile(profile), servingsPerMeal: servingsPerMeal(profile) });
  };
  element.addEventListener('submit', submit);
  render();
  return { destroy() { element.removeEventListener('submit', submit); element.innerHTML = ''; } };
}
