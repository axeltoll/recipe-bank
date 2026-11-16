// Serving scaling on the recipe page (scale.mjs) through the recipe-scaling mount and the .ing-amt hooks
// (docs/design/MOUNT-POINTS.md). The control sits above the ingredient list; scaled amounts replace the text of
// .ing-amt-text and are marked data-scaled="true". Amounts in words and rates keep the creator's words, and while
// the factor is not 1 they also show amountHtml's "not scaled" label; data-amount is never changed.
// With a saved household profile there is one more button: scale to the household's servings per meal.
import { mount as mountScale } from './scale.mjs';
import { factorFor, servingCount } from '../../lib/scale.mjs';
import { householdTarget } from './household-target.js';

/** Show a scaled recipe's amounts in the page's ingredient list, or (scaled = null) restore the creator's words. */
export function applyAmounts(root, scaled) {
  const factor = scaled?.scale?.factor;
  const marking = typeof factor === 'number' && factor !== 1;
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
    // The same words amountHtml uses, so a kept amount is marked wherever the list is the page's or cook mode's.
    const why = marking && (ing?.scaleReason === 'words' || ing?.scaleReason === 'per-unit')
      ? (ing.scaleReason === 'per-unit' ? 'already per person or per item' : 'given in words')
      : '';
    const note = span.querySelector('[data-not-scaled]');
    if (why) {
      const el = note ?? (span.ownerDocument ?? root.ownerDocument ?? document).createElement('span');
      el.className = 'rbf-orig';
      el.dataset.notScaled = '';
      el.textContent = `not scaled (${why})`;
      if (!note) span.append(el);
    } else if (note) {
      note.remove();
    }
  }
}

export function install(rb) {
  let scaler = null;
  let pageRoot = null;
  let cookRoot = null;

  const paint = (root) => {
    if (!root || !scaler) return;
    applyAmounts(root, scaler.getFactor() === 1 ? null : scaler.getRecipe());
  };

  rb.on('view', ({ name, recipe, root }) => {
    scaler?.destroy();
    scaler = null;
    pageRoot = null;
    cookRoot = null;
    if (name !== 'recipe' || !recipe) return;
    const slot = rb.mount('recipe-scaling');
    if (!slot) return;
    pageRoot = root;
    const target = householdTarget();
    // Only a recipe that states servings scales to a household; "about 12 nuggets" counts items, not servings.
    const householdFactor = target && servingCount(recipe.serves) != null ? factorFor(recipe, target.servings) : null;
    const servings = target ? target.servings.toFixed(1) : '';
    slot.innerHTML = `<div data-scale></div>${householdFactor
      ? `<p class="scale-household">Your household eats about ${rb.esc(servings)} servings a meal.
          <button type="button" class="btn btn-quiet" data-scale-household>Scale to ${rb.esc(servings)}</button></p>`
      : ''}`;
    scaler = mountScale(slot.querySelector('[data-scale]'), {
      recipe,
      list: false, // the page's own ingredient list shows the amounts
      onChange: () => {
        paint(pageRoot);
        paint(cookRoot);
      },
    });
    slot.querySelector('[data-scale-household]')?.addEventListener('click', () => scaler?.setFactor(householdFactor));
  });

  rb.on('cook', ({ open, root }) => {
    cookRoot = open ? root : null;
    if (open) paint(root);
  });
}
