// Draws the feature and roadmap groups and the status notes from data/features.json. The pages already hold
// the same markup as static HTML (written by scripts/sync-site.mjs), so without JavaScript, or when the
// file cannot be fetched, nothing is missing. With JavaScript a changed status shows at once.

import { STATUSES, markupDiffers, renderGroup, renderStatusNote, validateFeatures } from './features-core.js';

export async function initFeatures() {
  const groups = [...document.querySelectorAll('[data-features]')];
  const notes = [...document.querySelectorAll('[data-feature-status]')];
  if (!groups.length && !notes.length) return;

  let data;
  try {
    const res = await fetch(new URL('../data/features.json', import.meta.url), { cache: 'no-cache' });
    if (!res.ok) return;
    data = await res.json();
  } catch {
    return; // offline or blocked: the static copy stays
  }
  if (validateFeatures(data).length) return;

  const scratch = document.createElement('div');
  // Compares markup, not text: a new link or status class with the same words must still reach the page.
  // Both sides are serialised by the browser, so attribute quoting and entities match.
  const differs = (current, html) => {
    scratch.innerHTML = html;
    return markupDiffers(current, scratch.innerHTML);
  };

  for (const el of groups) {
    const status = el.dataset.features;
    if (!STATUSES.includes(status)) continue;
    const html = renderGroup(data.features, status).join('\n');
    // Only touch the DOM when the data says something else than the page, so focus and scroll are kept.
    if (differs(el.innerHTML, html)) el.innerHTML = html;
  }
  for (const el of notes) {
    const feature = data.features.find((f) => f.id === el.dataset.featureStatus);
    if (!feature) continue;
    const html = renderStatusNote(feature);
    if (differs(el.outerHTML, html)) el.outerHTML = html;
  }
}
