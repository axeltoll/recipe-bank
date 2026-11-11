// Recipe packs (packs.mjs) on #/packs: share recipes as a file or a link, and open someone else's pack.
// A pack link looks like http://127.0.0.1:4780/#pack=<data>. The router doesn't know that hash, so this file
// catches it (on first load and on hashchange), swaps it for #/packs and opens the pack in the panel.
// On the static build the panel shows what a pack holds but has no Import button (PACKS.md), so nothing writes.
import { mount as mountPacks } from './packs.mjs';
import { hasPackLink } from '../../lib/pack.mjs';

const ROUTE = 'packs';

export function install(rb) {
  let panel = null;
  let pending = null; // a #pack= hash waiting for the panel
  const unmount = () => {
    panel?.destroy();
    panel = null;
  };

  // A link opened from outside: keep the pack, show the panel. replace() keeps the long link out of history.
  const catchLink = () => {
    if (!hasPackLink(location.hash)) return false;
    pending = location.hash;
    location.replace(`#/${ROUTE}`);
    return true;
  };
  if (hasPackLink(location.hash)) {
    pending = location.hash;
    history.replaceState(null, '', `#/${ROUTE}`); // before the first render, so the router lands on #/packs
  }
  window.addEventListener('hashchange', catchLink);

  rb.addRoute(ROUTE, {
    label: 'Share',
    title: 'Share recipes',
    layout: 'list',
    render(root) {
      unmount();
      root.innerHTML = `
        <div class="feature-page">
          <header class="feature-head">
            <h1>Share recipes</h1>
            <p>A pack is a few recipes in one file or one link, with the creators still credited. Importing one only
              ever adds new recipe files: anything whose video is already in your bank is skipped.</p>
          </header>
          <div data-part="packs"></div>
        </div>`;
      panel = mountPacks(root.querySelector('[data-part="packs"]'), {
        recipes: rb.recipes(),
        static: rb.isStatic,
        readHash: false, // this file hands links over (above)
        onImported: (ids) => {
          if (!ids.length) return;
          rb.reload().catch(() => rb.toast('Imported, but the list could not be reloaded'));
        },
      });
      if (pending) {
        const link = pending;
        pending = null;
        const input = root.querySelector('[data-el="link"]');
        const form = root.querySelector('[data-el="link-form"]');
        if (input && form) {
          input.value = new URL(link, location.href).href;
          form.requestSubmit();
        }
      }
    },
  });

  rb.on('view', ({ name }) => {
    if (name !== ROUTE) unmount();
  });
}
