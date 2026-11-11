// Keeps the static pages of the public site (site/) in step with its two data files (`npm run site:sync`):
//
//   site/data/features.json  ->  the feature and roadmap groups on the home page and the status notes in the
//                                docs, so every page is complete without JavaScript
//   site/data/site.json      ->  canonical, og:url and og:image in every page, robots.txt and sitemap.xml
//
// The pages are hand-written HTML. This script only rewrites the lines between marker comments:
//
//   <!-- gen:features:shipped -->  ...  <!-- /gen:features:shipped -->     (also :next and :planned)
//   <!-- gen:status:<feature id> -->  ...  <!-- /gen:status:<feature id> -->
//   <!-- gen:meta -->  ...  <!-- /gen:meta -->
//
// It is not a build step: the site is served as it is in the repository. test/site.test.mjs fails when a
// page, robots.txt or sitemap.xml differs from what this script would write.

import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { STATUSES, renderGroup, renderStatusNote, validateFeatures } from '../site/js/features-core.js';
import { isMain } from './is-main.mjs';

export const SITE = resolve(import.meta.dirname, '..', 'site');
/** Stands in for the address while site.json has no baseUrl. `.invalid` can never be a real host. */
export const PLACEHOLDER_BASE = 'https://base-url.invalid';
/** Pages that search engines should not list. */
export const NOINDEX = ['404.html'];

const BLOCK = /^([ \t]*)<!-- gen:([a-z0-9:-]+) -->\n([\s\S]*?)^[ \t]*<!-- \/gen:\2 -->/gm;

/** The base URL from site.json without trailing slashes, or '' when it is not set. Throws on a bad value. */
export function baseUrl(site) {
  const raw = String(site?.baseUrl ?? '').trim();
  if (!raw) return '';
  if (!/^https:\/\/[^\s"'<>]+$/.test(raw)) throw new Error(`site.json baseUrl must be an https address, got "${raw}"`);
  return raw.replace(/\/+$/, '');
}

/** The public address of a page. index.html is the folder itself. */
export const pageUrl = (base, page) => `${base}/${page === 'index.html' ? '' : page}`;

/** The .html files in site/, sorted by name. The site is flat: every page sits in the root of the folder. */
export async function listPages(dir = SITE) {
  return (await readdir(dir)).filter((f) => f.endsWith('.html')).sort();
}

/** Pages for the sitemap: the home page first, then the rest by name, without the not-found page. */
export const sitemapPages = (pages) =>
  ['index.html', ...pages.filter((p) => p !== 'index.html' && !NOINDEX.includes(p))];

export function metaLines(site, page) {
  const base = baseUrl(site);
  if (!base) {
    return ['<!-- baseUrl in data/site.json is empty. Once it is set, npm run site:sync writes canonical, og:url and og:image here. -->'];
  }
  const url = pageUrl(base, page);
  return [
    `<link rel="canonical" href="${url}">`,
    `<meta property="og:url" content="${url}">`,
    `<meta property="og:image" content="${base}/${site.ogImage}">`,
  ];
}

export function renderRobots(site) {
  const base = baseUrl(site) || PLACEHOLDER_BASE;
  return ['User-agent: *', 'Allow: /', '', `Sitemap: ${base}/sitemap.xml`, ''].join('\n');
}

export function renderSitemap(site, pages) {
  const base = baseUrl(site) || PLACEHOLDER_BASE;
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...sitemapPages(pages).map((p) => `  <url><loc>${pageUrl(base, p)}</loc></url>`),
    '</urlset>',
    '',
  ].join('\n');
}

/** The lines for one marker block, by its name. Throws on a name this script does not know. */
export function blockLines(name, page, { site, features }) {
  if (name === 'meta') return metaLines(site, page);
  const [kind, arg] = [name.slice(0, name.indexOf(':')), name.slice(name.indexOf(':') + 1)];
  if (kind === 'features' && STATUSES.includes(arg)) return renderGroup(features.features, arg);
  if (kind === 'status') {
    const feature = features.features.find((f) => f.id === arg);
    if (!feature) throw new Error(`${page}: gen:${name} names a feature that is not in features.json`);
    return [renderStatusNote(feature)];
  }
  throw new Error(`${page}: unknown block gen:${name}`);
}

/** Returns the page with every marker block rewritten from the data. Text outside the blocks is untouched. */
export function syncPage(html, page, data) {
  return html.replace(BLOCK, (all, indent, name) => {
    const lines = blockLines(name, page, data);
    return `${indent}<!-- gen:${name} -->\n${lines.map((l) => `${indent}${l}\n`).join('')}${indent}<!-- /gen:${name} -->`;
  });
}

/** The names of the marker blocks in a page, in order. */
export const blockNames = (html) => [...html.matchAll(BLOCK)].map((m) => m[2]);

export async function loadData(dir = SITE) {
  const json = async (rel) => JSON.parse(await readFile(join(dir, rel), 'utf8'));
  const data = { site: await json('data/site.json'), features: await json('data/features.json') };
  const errs = validateFeatures(data.features);
  if (errs.length) throw new Error(`site/data/features.json is not valid:\n  ${errs.join('\n  ')}`);
  baseUrl(data.site);
  return data;
}

if (isMain(import.meta.url)) {
  const data = await loadData();
  const pages = await listPages();
  const changed = [];
  const put = async (rel, next) => {
    const file = join(SITE, rel);
    const before = await readFile(file, 'utf8').catch(() => null);
    if (before === next) return;
    await writeFile(file, next);
    changed.push(rel);
  };
  for (const page of pages) await put(page, syncPage(await readFile(join(SITE, page), 'utf8'), page, data));
  await put('robots.txt', renderRobots(data.site));
  await put('sitemap.xml', renderSitemap(data.site, pages));
  console.log(changed.length ? `site: rewrote ${changed.join(', ')}` : 'site: already in step with data/');
  if (!baseUrl(data.site)) console.log('site: baseUrl is empty, so no canonical or og:url was written (see site/README.md)');
}
