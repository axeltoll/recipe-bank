// The dashboard's selectors for the browser checks (scripts/smoke.mjs, scripts/device-check.mjs), in one place so a
// redesign has one file to update. test/selectors.test.mjs checks that every id and class named here is rendered
// somewhere in public/. Pure data: importing this file starts nothing.

export const SELECTORS = {
  // home (public/ui/home.js)
  cards: '#grid .card .card-link', // one link per card; its hash is #/r/<id>
  chips: '#chips .chip', more: '#more',
  all: '[data-mode="all"]', any: '[data-mode="any"]', clear: '#clear', search: '#search',
  filterToggle: '#filter-toggle', filtersOpen: '#filters[data-open="true"]',
  withoutChips: '#mount-filter-exclude .rbf-chip',
  // recipe page (public/ui/recipe.js)
  ingredients: '.ing-list .ing-name', steps: '.steps li', timestamp: 'button.ts', player: '.player iframe',
  scale: '#mount-recipe-scaling .rbf-scale', addToWeek: '[data-plan-add]',
  // add dialog (public/index.html, public/ui/add.js)
  add: '#open-add', url: '#add-url', hint: '#add-detect', cancel: '#add-cancel', web: '#add-web',
  // feature routes (public/features/*-feature.js)
  nav: '#nav a',
  weekPlan: '.rbf-week', shoppingList: '.rbf-shop',
  household: '.rb-household', budget: '.rb-budget',
  packs: '.rb-packs .pk-section',
  editor: '.re-body', editorSave: '.re [data-action="save"]', editorDownload: '.re [data-action="download"]',
  // parameterised
  card: (id) => `#grid .card-link[href="#/r/${encodeURIComponent(id)}"]`,
  chip: (key) => `#chips .chip[data-key=${JSON.stringify(key)}]`,
  timestampAt: (t) => `button.ts[data-t="${t}"]`,
};

/** Pages the device check measures: [name, hash, selector that says the page has rendered]. `recipe` gets an id. */
export const PAGES = [
  ['home', '#/', SELECTORS.cards],
  ['recipe', (id) => `#/r/${encodeURIComponent(id)}`, SELECTORS.steps],
  ['plan', '#/plan', SELECTORS.weekPlan],
  ['household', '#/household', SELECTORS.budget],
  ['packs', '#/packs', SELECTORS.packs],
  ['editor', '#/new', SELECTORS.editor],
];
