// Pure logic and HTML strings for the feature and roadmap sections of the site. No DOM access: the browser
// (js/features.js), the sync script (scripts/sync-site.mjs) and node:test all use the same functions, so
// the static HTML in the pages and what the browser draws from data/features.json cannot differ.

/** In display order. shipped = on the main branch; next = built, being merged; planned = roadmap only. */
export const STATUSES = ['shipped', 'next', 'planned'];

export const GROUPS = {
  shipped: {
    label: 'Shipped',
    title: 'In the repository today',
    lede: 'On the main branch now. Clone it and it is there.',
    note: 'This is on the main branch today.',
  },
  next: {
    label: 'Being merged',
    title: 'Built, being merged',
    lede: 'Built and tested on branches that are being merged into the main branch. Until a merge lands, a fresh clone may not have it.',
    note: 'This is built and is being merged into the main branch. Until the merge lands, a fresh clone may not have it.',
  },
  planned: {
    label: 'Planned',
    title: 'Planned, not built yet',
    lede: 'From the roadmap. None of this exists yet, and the order can change.',
    note: 'This is planned and not built yet.',
  },
};

const ENTITIES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ENTITIES[c]);

const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const LOCAL_HREF = /^[a-z0-9-]+\.html(?:#[a-z0-9-]+)?$/;
const str = (v) => typeof v === 'string' && v.trim().length > 0;

/** Returns a list of human-readable problems with data/features.json; empty means valid. */
export function validateFeatures(data) {
  const errs = [];
  if (!data || typeof data !== 'object' || !Array.isArray(data.features)) return ['features must be an array'];
  const seen = new Set();
  data.features.forEach((f, i) => {
    const at = `features[${i}]${f && str(f.id) ? ` (${f.id})` : ''}`;
    if (!f || typeof f !== 'object') return errs.push(`${at} is not an object`);
    if (!str(f.id) || !ID.test(f.id)) errs.push(`${at}.id must be a kebab-case slug`);
    else if (seen.has(f.id)) errs.push(`${at}.id is used twice`);
    else seen.add(f.id);
    if (!STATUSES.includes(f.status)) errs.push(`${at}.status must be one of ${STATUSES.join(', ')}`);
    if (!str(f.title)) errs.push(`${at}.title is required`);
    if (!str(f.text)) errs.push(`${at}.text is required`);
    if (!str(f.source)) errs.push(`${at}.source is required: where in the repository the claim comes from`);
    if (f.link != null) {
      if (!f.link || !str(f.link.label) || !str(f.link.href) || !LOCAL_HREF.test(f.link.href)) {
        errs.push(`${at}.link needs a label and an href to a page of the site`);
      }
    }
  });
  return errs;
}

export const featuresWith = (features, status) => features.filter((f) => f.status === status);

/** One card, on one line. Every string from the data file is escaped. */
export function renderFeatureCard(f) {
  const group = GROUPS[f.status];
  const link = f.link ? `<a class="text-link" href="${esc(f.link.href)}">${esc(f.link.label)}</a>` : '';
  return `<li class="card" data-feature="${esc(f.id)}"><span class="badge badge-${esc(f.status)}">${esc(group.label)}</span><h4>${esc(f.title)}</h4><p>${esc(f.text)}</p>${link}</li>`;
}

/** The lines of one group: heading, one sentence, the cards. An empty group renders nothing at all. */
export function renderGroup(features, status) {
  const list = featuresWith(features, status);
  const group = GROUPS[status];
  if (!group || !list.length) return [];
  return [
    `<h3 class="group-title" id="features-${status}">${esc(group.title)}</h3>`,
    `<p class="group-lede">${esc(group.lede)}</p>`,
    '<ul class="cards cards-3">',
    ...list.map((f) => `  ${renderFeatureCard(f)}`),
    '</ul>',
  ];
}

/** One line that says where a feature stands. Docs pages use it above text about that feature. */
export function renderStatusNote(f) {
  const group = GROUPS[f.status];
  return `<p class="status-note" data-feature-status="${esc(f.id)}"><span class="badge badge-${esc(f.status)}">${esc(group.label)}</span> ${esc(group.note)}</p>`;
}

/** Markup without comments (the gen: markers) and with layout whitespace collapsed, so the static page compares equal. */
const normalise = (html) => String(html).replace(/<!--[\s\S]*?-->/g, '').replace(/>\s+</g, '><').replace(/\s+/g, ' ').trim();

/**
 * True when two pieces of serialised markup differ in anything but layout whitespace: words, but also an href
 * or a badge class that leaves the visible text as it was.
 */
export const markupDiffers = (current, next) => normalise(current) !== normalise(next);
