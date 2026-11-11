// Week plan and the combined shopping list (week-plan.mjs, shopping-list.mjs).
//   #/plan                 the week on one side, the shopping list for it on the other
//   card-actions slot      "Add to week" on every recipe card
//   recipe-actions slot    "Add to week" on the recipe page
// Both modules keep their own storage and follow each other through the rb:plan-change event.
import { mount as mountWeek, addRecipeToWeek } from './week-plan.mjs';
import { mount as mountShop } from './shopping-list.mjs';
import { householdTarget } from './household-target.js';

const ROUTE = 'plan';

export function install(rb) {
  let parts = [];
  const unmount = () => {
    for (const p of parts) p.destroy();
    parts = [];
  };

  const add = (id) => {
    const r = rb.recipe(id);
    if (!r) return;
    addRecipeToWeek(id);
    rb.toast(`Added to this week: ${r.title}`);
  };

  rb.addRoute(ROUTE, {
    label: 'Week plan',
    title: 'Week plan',
    layout: 'list',
    render(root) {
      unmount();
      const target = householdTarget();
      root.innerHTML = `
        <div class="feature-page">
          <header class="feature-head">
            <h1>This week</h1>
            <p>Plan recipes for the days of the week; the shopping list merges their ingredients by key and keeps
              every amount in the creator's own words.</p>
            ${target
              ? `<p class="feature-note">Your household: ${rb.esc(target.description)}, about ${rb.esc(target.servings.toFixed(1))}
                  adult-equivalent servings per meal. <a href="#/household">Change</a></p>`
              : '<p class="feature-note">Tip: set up your <a href="#/household">household</a> to see how many servings a meal needs.</p>'}
          </header>
          <div class="feature-cols">
            <div data-part="week"></div>
            <div data-part="shop"></div>
          </div>
        </div>`;
      const recipes = rb.recipes();
      parts = [
        mountWeek(root.querySelector('[data-part="week"]'), { recipes }),
        mountShop(root.querySelector('[data-part="shop"]'), { recipes }),
      ];
    },
  });

  rb.on('view', ({ name, recipe }) => {
    if (name !== ROUTE) unmount();
    if (name === 'recipe' && recipe) {
      const slot = rb.mount('recipe-actions');
      slot?.insertAdjacentHTML('beforeend',
        `<button type="button" class="btn" data-plan-add="${rb.esc(recipe.id)}">${rb.icon('plus')}<span>Add to week</span></button>`);
    }
  });

  rb.on('grid', ({ root }) => {
    for (const slot of rb.mounts('card-actions', root)) {
      slot.insertAdjacentHTML('beforeend',
        `<button type="button" class="btn btn-quiet" data-plan-add="${rb.esc(slot.dataset.recipeId)}">Add to week</button>`);
    }
  });

  // One delegated listener for every "Add to week" button the two slots render.
  document.addEventListener('click', (e) => {
    const btn = e.target.closest?.('[data-plan-add]');
    if (btn) add(btn.dataset.planAdd);
  });
}
