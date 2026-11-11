// The feature hub: the registry that lets self-contained modules under public/features/ add filters and
// routes to the dashboard without editing it. DOM-free. The contract is documented in docs/design/MOUNT-POINTS.md.

/** Mount points by name → element id (or, for per-card slots, a data-mount value). Keep in step with MOUNT-POINTS.md. */
export const MOUNTS = {
  'topbar': 'mount-topbar',
  'home-tools': 'mount-home-tools',
  'home-top': 'mount-home-top',
  'filter-exclude': 'mount-filter-exclude',
  'filter-tags': 'mount-filter-tags',
  'filter-nutrition': 'mount-filter-nutrition',
  'recipe-actions': 'mount-recipe-actions',
  'recipe-scaling': 'mount-recipe-scaling',
  'recipe-aside': 'mount-recipe-aside',
};

/** Slots that repeat (one per card), found by `[data-mount="<name>"]` instead of an id. */
export const REPEATED_MOUNTS = ['card-actions'];

/** Events the dashboard dispatches on `document`, each as `rb:<name>`. */
export const EVENTS = ['ready', 'view', 'grid', 'filters', 'check', 'cook'];

/** Route names the dashboard owns. */
export const RESERVED_ROUTES = ['r', 'q'];

/** Layout types a route may use (docs/design/DESIGN.md). */
export const LAYOUTS = ['list', 'detail', 'message'];

const ROUTE_NAME = /^[a-z][a-z0-9-]*$/;

export function createHub({ warn = () => {} } = {}) {
  const filters = new Map();
  const routes = new Map();

  return {
    /**
     * Register a recipe filter. `filter` is a function (recipe) => boolean, or
     * { test(recipe), active?(): number, clear?(), describe?(): string[] }.
     * A recipe is shown only if every registered test returns true. Returns a function that removes the filter.
     */
    addFilter(id, filter) {
      const f = typeof filter === 'function' ? { test: filter } : filter;
      if (typeof id !== 'string' || !id) throw new TypeError('addFilter: id must be a non-empty string');
      if (!f || typeof f.test !== 'function') throw new TypeError(`addFilter(${id}): test must be a function`);
      filters.set(id, f);
      return () => { if (filters.get(id) === f) filters.delete(id); };
    },

    removeFilter(id) {
      return filters.delete(id);
    },

    /**
     * The registered tests as plain predicates. A test that throws is reported once per call through `warn`
     * and counts as a pass, so a broken feature can never hide recipes.
     */
    tests() {
      return [...filters].map(([id, f]) => (recipe) => {
        try {
          return Boolean(f.test(recipe));
        } catch (e) {
          warn(`filter "${id}" failed`, e);
          return true;
        }
      });
    },

    /** How many feature filters are switched on (the sum of each filter's active()). */
    activeCount() {
      let n = 0;
      for (const [id, f] of filters) {
        if (typeof f.active !== 'function') continue;
        try {
          const a = Number(f.active());
          if (Number.isFinite(a) && a > 0) n += a;
        } catch (e) {
          warn(`filter "${id}" failed`, e);
        }
      }
      return n;
    },

    /** Human-readable labels of what is switched on, for the active-filter row: [{ id, label }]. */
    describe() {
      const out = [];
      for (const [id, f] of filters) {
        if (typeof f.describe !== 'function') continue;
        try {
          for (const label of f.describe() ?? []) out.push({ id, label: String(label) });
        } catch (e) {
          warn(`filter "${id}" failed`, e);
        }
      }
      return out;
    },

    /** Ask every filter to reset itself ("Clear all"). With an id, only that one. */
    clear(only) {
      for (const [id, f] of filters) {
        if (only != null && id !== only) continue;
        if (typeof f.clear !== 'function') continue;
        try {
          f.clear();
        } catch (e) {
          warn(`filter "${id}" failed`, e);
        }
      }
    },

    /**
     * Register a hash route `#/<name>` (and `#/<name>/<param>`).
     * def: { render(root, param, rb), title?: string, layout?: 'list' | 'detail' | 'message', label?: string }.
     * `label` adds the route to the header navigation.
     */
    addRoute(name, def) {
      if (typeof name !== 'string' || !ROUTE_NAME.test(name)) throw new TypeError(`addRoute: "${name}" is not a valid route name`);
      if (RESERVED_ROUTES.includes(name)) throw new TypeError(`addRoute: "${name}" is reserved`);
      if (!def || typeof def.render !== 'function') throw new TypeError(`addRoute(${name}): render must be a function`);
      const layout = def.layout ?? 'list';
      if (!LAYOUTS.includes(layout)) throw new TypeError(`addRoute(${name}): layout must be one of ${LAYOUTS.join(', ')}`);
      routes.set(name, { ...def, name, layout });
      return () => routes.delete(name);
    },

    route(name) {
      return routes.get(name);
    },

    routeNames() {
      return [...routes.keys()];
    },

    /** Header navigation entries for routes that declared a label: [{ name, label, href }]. */
    navItems() {
      return [...routes.values()].filter((r) => r.label).map((r) => ({ name: r.name, label: String(r.label), href: `#/${r.name}` }));
    },
  };
}
