// Draws the feature and roadmap groups and the status notes from data/features.json. The pages already hold
// the same markup as static HTML (written by scripts/sync-site.mjs), so without JavaScript, or when the
// file cannot be fetched, nothing is missing. With JavaScript a changed status shows at once.

import { STATUSES, renderGroup, renderStatusNote, validateFeatures } from './features-core.js';

const squash = (s) => s.replace(/\s+/g, '');

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
  const differs = (el, html) => {
    scratch.innerHTML = html;
    return squash(scratch.textContent) !== squash(el.textContent);
  };

  for (const el of groups) {
    const status = el.dataset.features;
    if (!STATUSES.includes(status)) continue;
    const html = renderGroup(data.features, status).join('\n');
    // Only touch the DOM when the data says something else than the page, so focus and scroll are kept.
    if (differs(el, html)) el.innerHTML = html;
  }
  for (const el of notes) {
    const feature = data.features.find((f) => f.id === el.dataset.featureStatus);
    if (!feature) continue;
    const html = renderStatusNote(feature);
    if (differs(el, html)) el.outerHTML = html;
  }
}
