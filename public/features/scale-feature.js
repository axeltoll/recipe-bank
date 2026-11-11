// Serving scaling on the recipe page (scale.mjs) through the recipe-scaling mount and the .ing-amt hooks
// (docs/design/MOUNT-POINTS.md). The control sits above the ingredient list; scaled amounts replace the text of
// .ing-amt-text and are marked data-scaled="true". Amounts in words, rates and unstated amounts are left exactly
// as the creator gave them, and data-amount (the creator's words) is never changed: it is what we restore from.
// With a saved household profile there is one more button: scale to the household's servings per meal.
import { mount as mountScale } from './scale.mjs';
import { factorFor } from '../../lib/scale.mjs';
import { householdTarget } from './household-target.js';

/** Show a scaled recipe's amounts in the page's ingredient list, or (scaled = null) restore the creator's words. */
export function applyAmounts(root, scaled) {
  for (const span of root.querySelectorAll('.ing-amt[data-ci][data-ii]')) {
    const ing = scaled?.components?.[Number(span.dataset.ci)]?.ingredients?.[Number(span.dataset.ii)];
    const text = span.querySelector('.ing-amt-text');
    if (!text) continue;
    if (ing?.scaled) {
      text.textContent = ing.amount;
      span.dataset.scaled = 'true';
    } else if (span.dataset.scaled) {
      text.textContent = span.dataset.amount || 'amount not given';
      delete span.dataset.scaled;
    }
  }
}

export function install(rb) {
  let scaler = null;

  rb.on('view', ({ name, recipe, root }) => {
    scaler?.destroy();
    scaler = null;
    if (name !== 'recipe' || !recipe) return;
    const slot = rb.mount('recipe-scaling');
    if (!slot) return;
    const target = householdTarget();
    const householdFactor = target ? factorFor(recipe, target.servings) : null;
    const servings = target ? target.servings.toFixed(1) : '';
    slot.innerHTML = `<div data-scale></div>${householdFactor
      ? `<p class="scale-household">Your household eats about ${rb.esc(servings)} servings a meal.
          <button type="button" class="btn btn-quiet" data-scale-household>Scale to ${rb.esc(servings)}</button></p>`
      : ''}`;
    scaler = mountScale(slot.querySelector('[data-scale]'), {
      recipe,
      list: false, // the page's own ingredient list shows the amounts
      onChange: (factor, scaled) => applyAmounts(root, factor === 1 ? null : scaled),
    });
    slot.querySelector('[data-scale-household]')?.addEventListener('click', () => scaler?.setFactor(householdFactor));
  });
}
