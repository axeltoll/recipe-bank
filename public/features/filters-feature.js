// Without, tag and nutrition filters (filters.mjs) in the dashboard's filter panel.
// One filter state, three mounts: each section goes into its own mount point (filter-exclude, filter-tags,
// filter-nutrition) and registers its own rb filter, so the active-filter chips and the count on the Filters
// button include them and each chip clears only its own section. The matching is lib/filter.mjs.
import { mount as mountFilters, extraFilter, FILTER_KEY } from './filters.mjs';
import { matchesWithout, matchesTags, matchesNutrition } from '../../lib/filter.mjs';

const SECTIONS = [
  { slot: 'filter-exclude', section: 'without', fields: ['without'] },
  { slot: 'filter-tags', section: 'tags', fields: ['tags'] },
  { slot: 'filter-nutrition', section: 'nutrition', fields: ['minProtein', 'maxCalories'] },
];

export function install(rb) {
  let filter = extraFilter(rb.store.get(FILTER_KEY, {}));
  let mounted = [];
  let redraw = false; // set when a clear() came from the dashboard; the controls catch up on the next rb:grid

  const save = () => rb.store.set(FILTER_KEY, filter);
  const set = (fields) => {
    filter = extraFilter({ ...filter, ...fields });
    save();
  };
  const cleared = (fields) => {
    set(Object.fromEntries(fields.map((f) => [f, f === 'without' || f === 'tags' ? [] : null])));
    redraw = true;
  };

  rb.addFilter('without', {
    test: (r) => matchesWithout(r, filter.without),
    active: () => filter.without.length,
    describe: () => filter.without.map((k) => `without ${k}`),
    clear: () => cleared(['without']),
  });
  rb.addFilter('tags', {
    test: (r) => matchesTags(r, filter.tags),
    active: () => filter.tags.length,
    describe: () => filter.tags.map((t) => `tag: ${t}`),
    clear: () => cleared(['tags']),
  });
  rb.addFilter('nutrition', {
    test: (r) => matchesNutrition(r, filter),
    active: () => (filter.minProtein != null ? 1 : 0) + (filter.maxCalories != null ? 1 : 0),
    describe: () => [
      ...(filter.minProtein != null ? [`≥ ${filter.minProtein} g protein`] : []),
      ...(filter.maxCalories != null ? [`≤ ${filter.maxCalories} kcal`] : []),
    ],
    clear: () => cleared(['minProtein', 'maxCalories']),
  });

  const unmount = () => {
    for (const m of mounted) m.destroy();
    mounted = [];
  };

  rb.on('view', ({ name }) => {
    unmount();
    if (name !== 'home') return;
    const recipes = rb.recipes();
    for (const { slot, section, fields } of SECTIONS) {
      const el = rb.mount(slot);
      if (!el) continue;
      mounted.push(mountFilters(el, {
        recipes,
        filter,
        persist: false, // this file stores the one shared state
        sections: [section],
        onChange: (f) => {
          set(Object.fromEntries(fields.map((k) => [k, f[k]])));
          rb.refresh();
        },
      }));
    }
  });

  // After "Clear all" or a click on one of these chips the grid redraws; bring the controls in line.
  rb.on('grid', () => {
    if (!redraw) return;
    redraw = false;
    for (const m of mounted) m.update({ filter });
  });
}
