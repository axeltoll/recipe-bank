// Household profile and food budget (household.mjs, budget.mjs) on a route of their own: #/household.
// The two modules don't load their stylesheets themselves (HOUSEHOLD.md), so this file does. The budget
// listens to the household form for profile changes, which update its per-person figures.
import { mount as mountHousehold } from './household.mjs';
import { mount as mountBudget } from './budget.mjs';
import { ensureStylesheet } from './shared.mjs';

const ROUTE = 'household';

export function install(rb) {
  let parts = [];
  const unmount = () => {
    for (const p of parts) p.destroy();
    parts = [];
  };

  rb.addRoute(ROUTE, {
    label: 'Household',
    title: 'Household and budget',
    layout: 'list',
    render(root) {
      unmount();
      ensureStylesheet(new URL('./household.css', import.meta.url).href);
      ensureStylesheet(new URL('./budget.css', import.meta.url).href);
      root.innerHTML = `
        <div class="feature-page">
          <header class="feature-head">
            <h1>Household and food budget</h1>
            <p>Who you usually cook for, and what you spend on food. Both stay on this device: no names, no accounts.
              The week plan and serving scaling use the household's servings per meal.</p>
          </header>
          <div class="feature-cols">
            <div data-part="household"></div>
            <div data-part="budget"></div>
          </div>
        </div>`;
      const householdElement = root.querySelector('[data-part="household"]');
      parts = [mountHousehold(householdElement)];
      parts.push(mountBudget(root.querySelector('[data-part="budget"]'), { householdElement }));
    },
  });

  rb.on('view', ({ name }) => {
    if (name !== ROUTE) unmount();
  });
}
