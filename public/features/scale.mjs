// Serving scaling for one recipe. Self-contained; see INTEGRATION.md.
//
//   import { mount } from '/features/scale.mjs';
//   mount(document.querySelector('#scale'), { recipe });
//
// When the recipe's `serves` is a plain number ("4", "10 bowls") it shows − / + servings;
// otherwise a ×½ ×1 ×2 ×3 choice. Fires 'rb:scale-change' { factor, recipe } with the scaled recipe.
// Scaled amounts are marked and keep the creator's original next to them; amounts in words stay as they are.

import { scaleRecipe, parseServes, formatFactor, formatFraction } from '../../lib/scale.mjs';
import { esc, ensureStylesheet, emit } from './shared.mjs';

export const SCALE_EVENT = 'rb:scale-change';
const DEFAULT_FACTORS = [0.5, 1, 2, 3];

/**
 * One ingredient amount as HTML, marked by how it was scaled. Use it in your own ingredient
 * list with an ingredient from scaleRecipe(): `amountHtml(ing, factor)`.
 */
export function amountHtml(ing, factor = 1) {
  if (ing.amount == null) return '<span class="rbf-amt rbf-unstated">amount not given</span>';
  if (ing.scaled) {
    return `<span class="rbf-amt rbf-scaled" title="Scaled ${esc(formatFactor(factor))} from the creator’s “${esc(ing.originalAmount)}”">`
      + `<span class="rbf-badge" aria-hidden="true">${esc(formatFactor(factor))}</span> ${esc(ing.amount)}</span>`
      + `<span class="rbf-orig">creator: ${esc(ing.originalAmount)}</span>`;
  }
  if (factor !== 1 && (ing.scaleReason === 'words' || ing.scaleReason === 'per-unit')) {
    const why = ing.scaleReason === 'per-unit' ? 'already per person or per item' : 'given in words';
    return `<span class="rbf-amt rbf-kept" title="Not scaled: ${why}">${esc(ing.amount)}</span><span class="rbf-orig">not scaled (${why})</span>`;
  }
  return `<span class="rbf-amt">${esc(ing.amount)}</span>`;
}

/** The control and (optionally) the scaled ingredient list as HTML. Pure: used by mount() and the tests. */
export function renderScale(recipe, factor = 1, { list = true, factors = DEFAULT_FACTORS, title = 'Scale amounts' } = {}) {
  const serves = parseServes(recipe.serves);
  const scaled = scaleRecipe(recipe, factor);
  const s = scaled.scale;
  let control;
  if (serves) {
    const target = serves.count * factor;
    control = `
      <span class="rbf-label">Makes</span>
      <button type="button" class="rbf-btn rbf-step" data-step="-1" aria-label="Fewer"${target <= 1 ? ' disabled' : ''}>−</button>
      <output class="rbf-target" data-target aria-live="polite">${esc(formatFraction(target))}</output>
      <span class="rbf-unit">${esc(serves.unit ?? 'servings')}</span>
      <button type="button" class="rbf-btn rbf-step" data-step="1" aria-label="More">+</button>`;
  } else {
    control = `
      <span class="rbf-label">Amounts</span>
      ${factors.map((f) => `<button type="button" class="rbf-btn rbf-factor" data-factor="${f}" aria-pressed="${f === factor}">${esc(formatFactor(f))}</button>`).join('')}`;
  }
  const note = factor === 1
    ? (serves ? 'Amounts as the creator gave them.' : 'Amounts as the creator gave them. This recipe doesn’t give a plain serving count, so scale it by a factor.')
    : `Scaled ${esc(formatFactor(factor))}: ${s.scaled} ${s.scaled === 1 ? 'amount' : 'amounts'} changed`
      + (s.kept ? `, ${s.kept} kept in the creator’s words` : '')
      + (s.unstated ? `, ${s.unstated} not given` : '')
      + '. Check anything marked “not scaled” yourself.';
  const comps = scaled.components.filter((c) => c.ingredients.length);
  return `
    <section class="rbf rbf-scale" aria-label="${esc(title)}" data-factor="${factor}">
      <div class="rbf-scale-ctl" role="group" aria-label="${esc(title)}">
        ${control}
        ${factor !== 1 ? '<button type="button" class="rbf-btn rbf-btn-quiet" data-reset>Original amounts</button>' : ''}
      </div>
      <p class="rbf-scale-note">${note}</p>
      ${list ? comps.map((c) => `
        ${comps.length > 1 ? `<h3>${esc(c.name)}</h3>` : ''}
        <ul class="rbf-scale-list">
          ${c.ingredients.map((i) => `<li><span class="rbf-item">${esc(i.item)}</span><span class="rbf-amts">${amountHtml(i, factor)}</span></li>`).join('')}
        </ul>`).join('') : ''}
    </section>`;
}

/**
 * Mount the scaler into `el`.
 * options: recipe (required), factor (default 1), list (default true: show the scaled ingredients),
 *          factors (choices when serves isn't a plain number), title, css (default true), onChange(factor, scaledRecipe).
 * Returns { getFactor, setFactor, getRecipe, update, destroy }.
 */
export function mount(el, options = {}) {
  let opts = { factor: 1, list: true, factors: DEFAULT_FACTORS, css: true, ...options };
  if (opts.css) ensureStylesheet(new URL('./scale.css', import.meta.url).href);
  let recipe = opts.recipe;
  let factor = validFactor(opts.factor) ? opts.factor : 1;

  const render = () => {
    el.innerHTML = renderScale(recipe, factor, opts);
  };
  const set = (next) => {
    if (!validFactor(next) || next === factor) return;
    factor = next;
    render();
    const scaled = scaleRecipe(recipe, factor);
    opts.onChange?.(factor, scaled);
    emit(el, SCALE_EVENT, { factor, recipe: scaled });
  };

  const onClick = (e) => {
    const step = e.target.closest('[data-step]');
    if (step) {
      const serves = parseServes(recipe.serves);
      if (!serves) return;
      // Step from the target as shown (a household target of 2.6 goes to 3.6 or 1.6), not from a
      // rounded one; the rounding only absorbs float noise.
      const target = Math.max(1, Math.round((serves.count * factor + Number(step.dataset.step)) * 1e6) / 1e6);
      return set(target / serves.count);
    }
    const f = e.target.closest('[data-factor]');
    if (f) return set(Number(f.dataset.factor));
    if (e.target.closest('[data-reset]')) return set(1);
  };

  el.addEventListener('click', onClick);
  render();

  return {
    getFactor: () => factor,
    setFactor: (f) => set(f),
    getRecipe: () => scaleRecipe(recipe, factor),
    update(next = {}) {
      opts = { ...opts, ...next };
      if (next.recipe) {
        recipe = next.recipe;
        factor = 1;
      }
      if (validFactor(next.factor)) factor = next.factor;
      render();
    },
    destroy() {
      el.removeEventListener('click', onClick);
      el.innerHTML = '';
    },
  };
}

function validFactor(f) {
  return typeof f === 'number' && Number.isFinite(f) && f > 0;
}
