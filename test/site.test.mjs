// Static checks on the public site (site/). The pages are read with a small tolerant HTML parser (below),
// not with regular expressions, so a reordered attribute or a reflowed line does not break a test.
// Covered: page basics, landmarks and heading order, links, the shared shell, the features data file and
// the pages generated from it, publishing settings, the design tokens and their contrast, third-party
// requests, the no-JavaScript view, and the preview server. No browser: layout and rendering are not
// covered here (see site/README.md, "What to check in a browser").
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { SHOWCASE_IDS } from '../scripts/build-site-data.mjs';
import { resolveSitePath, SITE_ROOT, TYPES } from '../scripts/serve-site.mjs';
import {
  NOINDEX, PLACEHOLDER_BASE, baseUrl, blockNames, listPages, loadData, metaLines, pageUrl, renderRobots,
  renderSitemap, sitemapPages, syncPage,
} from '../scripts/sync-site.mjs';
import showcase from '../site/data/showcase.js';
import {
  GROUPS, STATUSES, renderFeatureCard, renderGroup, renderStatusNote, validateFeatures,
} from '../site/js/features-core.js';
import { PALETTES, THREE_URL } from '../site/js/hero.js';
import { TRAVEL_FROM } from '../site/js/hero-boot.js';
import { recipeKeys, stepCount } from '../site/js/showcase-core.js';

const ROOT = resolve(import.meta.dirname, '..');
const SITE = join(ROOT, 'site');
const read = (rel) => readFile(join(SITE, rel), 'utf8');
const exists = (file) => access(file).then(() => true, () => false);

// ---------- a small tolerant HTML parser ----------
// Builds a tree of { tag, attrs, children, parent }, with { text } and { comment } leaves. It knows void
// elements, self-closing SVG elements, raw-text elements (script, style), comments and the doctype, ignores
// a closing tag that matches nothing, and never throws on malformed input. It does not implement the
// implied end tags of HTML (an unclosed <p> or <li>); the site's pages close what they open.

const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
const RAW_TEXT = new Set(['script', 'style']);
const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', middot: '·' };
const ATTR = /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/y;

function decode(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, ref) => {
    if (ref[0] !== '#') return NAMED[ref.toLowerCase()] ?? all;
    const code = ref[1].toLowerCase() === 'x' ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10);
    try { return String.fromCodePoint(code); } catch { return all; }
  });
}

function parseHtml(html) {
  const root = { tag: '#root', attrs: {}, children: [], parent: null, doctype: null };
  const lower = html.toLowerCase();
  let node = root;
  let i = 0;
  const addText = (s) => { if (s) node.children.push({ text: s, parent: node }); };
  const after = (index, length) => (index === -1 ? html.length : index + length);

  while (i < html.length) {
    const lt = html.indexOf('<', i);
    if (lt === -1) { addText(html.slice(i)); break; }
    addText(html.slice(i, lt));

    if (html.startsWith('<!--', lt)) {
      const end = html.indexOf('-->', lt + 4);
      node.children.push({ comment: html.slice(lt + 4, end === -1 ? html.length : end), parent: node });
      i = after(end, 3);
      continue;
    }
    if (html[lt + 1] === '!' || html[lt + 1] === '?') {
      const end = html.indexOf('>', lt);
      if (lower.startsWith('<!doctype', lt)) root.doctype = html.slice(lt + 2, end === -1 ? html.length : end).trim();
      i = after(end, 1);
      continue;
    }
    if (html[lt + 1] === '/') {
      const end = html.indexOf('>', lt);
      const name = html.slice(lt + 2, end === -1 ? html.length : end).trim().toLowerCase();
      let open = node;
      while (open !== root && open.tag !== name) open = open.parent;
      if (open !== root) node = open.parent; // a closing tag that matches nothing is ignored
      i = after(end, 1);
      continue;
    }
    const name = /^[a-zA-Z][^\s/>]*/.exec(html.slice(lt + 1, lt + 65));
    if (!name) { addText('<'); i = lt + 1; continue; }

    const el = { tag: name[0].toLowerCase(), attrs: {}, children: [], parent: node };
    let j = lt + 1 + name[0].length;
    let selfClosing = false;
    while (j < html.length && html[j] !== '>') {
      if (/\s/.test(html[j])) { j++; continue; }
      if (html[j] === '/') { selfClosing = true; j++; continue; }
      ATTR.lastIndex = j;
      const a = ATTR.exec(html);
      if (!a) { j++; continue; }
      el.attrs[a[1].toLowerCase()] = decode(a[2] ?? a[3] ?? a[4] ?? '');
      selfClosing = false;
      j = ATTR.lastIndex;
    }
    i = j + 1;
    node.children.push(el);

    if (RAW_TEXT.has(el.tag)) {
      const close = lower.indexOf(`</${el.tag}`, i);
      const stop = close === -1 ? html.length : close;
      if (stop > i) el.children.push({ text: html.slice(i, stop), parent: el });
      i = close === -1 ? html.length : after(html.indexOf('>', close), 1);
      continue;
    }
    if (!selfClosing && !VOID.has(el.tag)) node = el;
  }
  return root;
}

function* walk(node) {
  for (const child of node.children ?? []) { yield child; yield* walk(child); }
}
const els = (node, pred = () => true) => [...walk(node)].filter((n) => n.tag && pred(n));
const byTag = (node, ...tags) => els(node, (e) => tags.includes(e.tag));
const one = (node, pred, label) => {
  const found = els(node, pred);
  assert.equal(found.length, 1, `${label}: expected exactly one, found ${found.length}`);
  return found[0];
};
const textOf = (n) => {
  if (n.text != null) return decode(n.text);
  if (n.comment != null || RAW_TEXT.has(n.tag)) return '';
  return (n.children ?? []).map(textOf).join('');
};
const clean = (s) => s.replace(/\s+/g, ' ').trim();
const label = (n) => clean(textOf(n));
const has = (e, attr) => Object.hasOwn(e.attrs, attr);
const classes = (e) => (e.attrs.class ?? '').split(/\s+/).filter(Boolean);
const hasClass = (e, name) => classes(e).includes(name);
const ancestors = (e) => { const out = []; for (let p = e.parent; p && p.tag !== '#root'; p = p.parent) out.push(p); return out; };
const within = (e, pred) => ancestors(e).some(pred);
const idsOf = (doc) => els(doc, (e) => has(e, 'id')).map((e) => e.attrs.id);
const isHeading = (e) => /^h[1-6]$/.test(e.tag);

// ---------- the site ----------

const PAGES = await listPages();
const INDEXED = PAGES.filter((p) => !NOINDEX.includes(p));
const brand = JSON.parse(await read('brand.json'));
const css = await read('css/site.css');
const data = await loadData();
const docs = new Map();
for (const name of PAGES) {
  const html = await read(name);
  docs.set(name, { html, doc: parseHtml(html) });
}
const eachPage = (fn) => { for (const [name, { html, doc }] of docs) fn(name, doc, html); };

// ---------- the parser itself ----------

test('the HTML parser is tolerant: attributes, entities, void and self-closing elements, comments, stray tags', () => {
  const doc = parseHtml([
    '<!DOCTYPE html>',
    '<html lang=en class="a  b"><head><title>T &amp; t</title><meta charset="utf-8">',
    '<script>if (a < b) { x = "</p>"; }</script></head>',
    '<body data-flag><!-- <p>not an element</p> --><p id=\'one\'>Hello <b>there</b>, 1 < 2 &#39;ok&#x27;</p>',
    '<svg viewBox="0 0 1 1"><rect width="1" height="1"/><path d="M0 0"/><title>inner</title></svg>',
    '<input type="search" hidden></i><p>after</p>',
  ].join('\n'));

  assert.equal(doc.doctype, 'DOCTYPE html');
  const html = byTag(doc, 'html')[0];
  assert.deepEqual([html.attrs.lang, classes(html)], ['en', ['a', 'b']]);
  assert.equal(label(byTag(doc, 'head')[0]), 'T & t', 'entities are decoded, script text is not page text');
  assert.equal(byTag(doc, 'p').length, 2, 'markup inside a comment or a script is not an element');
  assert.equal(label(els(doc, (e) => e.attrs.id === 'one')[0]), "Hello there, 1 < 2 'ok'");
  const body = byTag(doc, 'body')[0];
  assert.ok(has(body, 'data-flag') && body.attrs['data-flag'] === '');
  const svg = byTag(doc, 'svg')[0];
  assert.deepEqual(svg.children.filter((c) => c.tag).map((c) => c.tag), ['rect', 'path', 'title'], 'self-closing siblings');
  assert.equal(byTag(doc, 'input')[0].parent, body, 'a void element does not swallow what follows');
  assert.ok(has(byTag(doc, 'input')[0], 'hidden'));
  assert.equal(label(byTag(doc, 'p')[1]), 'after', 'a stray closing tag is ignored');
  assert.equal(byTag(byTag(doc, 'head')[0], 'title').length, 1, 'the svg title is not in the head');
  assert.doesNotThrow(() => parseHtml('<p <<< a="b'));
});

// ---------- every page ----------

test('there are ten pages, and every page has a title, a description, a language and one h1', () => {
  assert.deepEqual(PAGES, [
    '404.html', 'changelog.html', 'contributing.html', 'getting-started.html', 'how-analysis-works.html',
    'index.html', 'recipe-agent.html', 'recipe-format-cheatsheet.html', 'recipe-format.html', 'self-hosting.html',
  ]);
  const titles = new Set();
  const descriptions = new Set();
  eachPage((page, doc) => {
    assert.equal(doc.doctype?.toLowerCase(), 'doctype html', page);
    assert.equal(one(doc, (e) => e.tag === 'html', `${page} html`).attrs.lang, brand.lang, page);

    const head = one(doc, (e) => e.tag === 'head', `${page} head`);
    const meta = (name) => els(head, (e) => e.tag === 'meta' && e.attrs.name === name).map((e) => e.attrs.content);
    assert.ok(els(head, (e) => e.tag === 'meta' && has(e, 'charset')).length === 1, `${page}: charset`);

    const title = label(one(head, (e) => e.tag === 'title', `${page} title`));
    assert.ok(title.length >= 10 && title.includes(brand.brand_name), `${page}: title "${title}"`);
    titles.add(title);

    const [description, ...more] = meta('description');
    assert.ok(description && !more.length, `${page}: one description`);
    assert.ok(description.length >= 50 && description.length <= 300, `${page}: description length ${description.length}`);
    descriptions.add(description);

    const [viewport] = meta('viewport');
    assert.ok(viewport?.includes('width=device-width') && viewport.includes('viewport-fit=cover'), `${page}: viewport`);
    assert.ok(!/user-scalable|maximum-scale/.test(viewport), `${page} must not block zoom`);
    assert.deepEqual(meta('color-scheme'), ['light dark'], page);

    const h1 = one(doc, (e) => e.tag === 'h1', `${page} h1`);
    assert.ok(label(h1).length > 3, `${page}: the h1 has text`);

    const icon = one(head, (e) => e.tag === 'link' && e.attrs.rel === 'icon', `${page} icon`);
    assert.equal(icon.attrs.href.replace(/^\//, ''), 'assets/favicon.svg', page);
  });
  assert.equal(titles.size, PAGES.length, 'every title is different');
  assert.equal(descriptions.size, PAGES.length, 'every description is different');
  assert.equal(label(els(docs.get('index.html').doc, (e) => e.tag === 'title' && e.parent.tag === 'head')[0]), brand.title);
});

test('landmarks: skip link first, one header, one main, one footer, every nav named', () => {
  eachPage((page, doc) => {
    const body = one(doc, (e) => e.tag === 'body', `${page} body`);
    const top = body.children.filter((c) => c.tag);
    assert.ok(top[0].tag === 'a' && hasClass(top[0], 'skip-link') && top[0].attrs.href === '#main', `${page}: the skip link is the first element`);
    assert.deepEqual(top.slice(1, 4).map((e) => e.tag), ['header', 'main', 'footer'], `${page}: header, main, footer in order`);
    assert.equal(one(doc, (e) => e.tag === 'main', `${page} main`).attrs.id, 'main', page);

    const navs = byTag(doc, 'nav');
    const names = navs.map((n) => n.attrs['aria-label']);
    assert.ok(names.every(Boolean), `${page}: every nav has an aria-label`);
    assert.equal(new Set(names).size, names.length, `${page}: nav names are unique (${names.join(', ')})`);

    // Sections are named, so they are landmarks a screen reader can list.
    for (const section of byTag(doc, 'section')) {
      assert.ok(section.attrs['aria-label'] || section.attrs['aria-labelledby'], `${page}: an unnamed section`);
    }
  });
});

test('heading order: starts at h1 and never skips a level', () => {
  eachPage((page, doc) => {
    const levels = els(byTag(doc, 'body')[0], isHeading).map((h) => [Number(h.tag[1]), label(h)]);
    assert.equal(levels[0][0], 1, `${page}: the first heading is the h1`);
    for (let i = 1; i < levels.length; i++) {
      assert.ok(levels[i][0] <= levels[i - 1][0] + 1, `${page}: "${levels[i][1]}" (h${levels[i][0]}) follows an h${levels[i - 1][0]}`);
      assert.ok(levels[i][1].length > 0, `${page}: an empty heading`);
    }
  });
});

test('names: links, buttons, images, inputs and tables can be read without seeing them', () => {
  eachPage((page, doc) => {
    for (const e of byTag(doc, 'a', 'button', 'summary')) {
      assert.ok(label(e) || e.attrs['aria-label'], `${page}: a ${e.tag} without a name`);
    }
    for (const a of byTag(doc, 'a')) assert.ok(has(a, 'href') && a.attrs.href !== '#', `${page}: a link without a target`);
    for (const b of byTag(doc, 'button')) assert.equal(b.attrs.type, 'button', `${page}: button "${label(b)}" needs type="button"`);
    for (const svg of byTag(doc, 'svg')) {
      const decorative = svg.attrs['aria-hidden'] === 'true';
      const named = svg.attrs.role === 'img' && (svg.attrs['aria-label'] || svg.attrs['aria-labelledby']);
      assert.ok(decorative || named, `${page}: an svg that is neither hidden nor named`);
    }
    assert.equal(byTag(doc, 'img').filter((img) => !has(img, 'alt')).length, 0, `${page}: img without alt`);
    const ids = idsOf(doc);
    for (const input of byTag(doc, 'input')) {
      const labelled = input.attrs['aria-label'] || els(doc, (e) => e.tag === 'label' && e.attrs.for === input.attrs.id).length;
      assert.ok(labelled && ids.includes(input.attrs.id), `${page}: an input without a label`);
    }
    for (const th of byTag(doc, 'th')) assert.ok(['col', 'row'].includes(th.attrs.scope), `${page}: th "${label(th)}" needs a scope`);
    for (const pre of byTag(doc, 'pre')) {
      if (has(pre, 'tabindex')) assert.ok(pre.attrs['aria-label'], `${page}: a focusable code block needs a name`);
    }
    for (const d of byTag(doc, 'details')) assert.equal(d.children.filter((c) => c.tag)[0]?.tag, 'summary', `${page}: details without summary`);
    // Focus order is document order: nothing reorders it.
    assert.equal(els(doc, (e) => has(e, 'tabindex') && e.attrs.tabindex !== '0').length, 0, `${page}: a positive or negative tabindex`);
  });
});

test('page copy uses no em or en dashes and no exclamation marks', () => {
  const dash = /[–—]|&mdash;|&ndash;|&#8211;|&#8212;|&#x2013;|&#x2014;/i;
  eachPage((page, doc, html) => {
    assert.doesNotMatch(html, dash, page);
    assert.ok(!label(byTag(doc, 'main')[0]).includes('!'), `${page}: an exclamation mark`);
  });
  for (const file of ['data/features.json', 'data/site.json']) assert.doesNotMatch(JSON.stringify(data), dash, file);
});

test('ids are unique and every reference to an id resolves', () => {
  eachPage((page, doc) => {
    const ids = idsOf(doc);
    assert.equal(new Set(ids).size, ids.length, `${page}: duplicate id in ${ids.join(' ')}`);
    for (const e of els(doc)) {
      const href = e.attrs.href;
      if (href?.startsWith('#')) assert.ok(ids.includes(href.slice(1)), `${page}: ${href}`);
      for (const attr of ['aria-labelledby', 'aria-describedby', 'aria-controls', 'for', 'data-copy-from']) {
        for (const ref of (e.attrs[attr] ?? '').split(/\s+/).filter(Boolean)) {
          assert.ok(ids.includes(ref), `${page}: ${attr}="${ref}"`);
        }
      }
    }
  });
});

test('every internal link, script and stylesheet resolves to a file, and every fragment to an id in it', async () => {
  const targets = [];
  eachPage((page, doc) => {
    for (const e of els(doc)) for (const attr of ['href', 'src']) if (has(e, attr)) targets.push([page, e.attrs[attr]]);
  });
  for (const f of data.features.features) if (f.link) targets.push(['data/features.json', f.link.href]);
  assert.ok(targets.length > 200, 'links were found');

  const hosts = new Set();
  for (const [from, url] of targets) {
    if (/^https?:/.test(url)) {
      assert.ok(url.startsWith('https://'), `${from}: ${url} is not https`);
      hosts.add(new URL(url).host);
      continue;
    }
    if (url.startsWith('#')) continue; // checked per page above
    assert.doesNotMatch(url, /^(?:[a-z]+:|\/\/)/i, `${from}: unexpected kind of link ${url}`);
    const [path, hash] = url.replace(/^\//, '').split('#');
    assert.ok(path && (await exists(join(SITE, path))), `${from}: ${url} does not exist`);
    if (hash !== undefined) {
      assert.ok(docs.has(path), `${from}: ${url} has a fragment but is not a page`);
      assert.ok(idsOf(docs.get(path).doc).includes(hash), `${from}: ${url} has no such id`);
    }
  }
  // Pages link out to the repository and, in the static recipe list, to the videos. Nothing else.
  assert.deepEqual([...hosts].sort(), ['github.com', 'www.youtube.com']);

  // Every page can be reached from the home page's header, footer or body.
  const linked = new Set(targets.filter(([from]) => from === 'index.html').map(([, url]) => url.split('#')[0]));
  for (const page of INDEXED) if (page !== 'index.html') assert.ok(linked.has(page), `index.html does not link to ${page}`);
});

// ---------- the shared shell ----------

/** What an element says and links to, without the parts that may differ per page. */
const signature = (root) => els(root).map((e) => {
  const attrs = Object.entries(e.attrs)
    .filter(([k]) => k !== 'aria-current')
    .map(([k, v]) => `${k}=${k === 'href' || k === 'src' ? v.replace(/^\//, '') : v}`)
    .sort().join(' ');
  const own = clean(e.children.filter((c) => c.text != null).map((c) => decode(c.text)).join(' '));
  return `${e.tag} [${attrs}] ${own}`;
});

test('header and footer are the same markup on every page', () => {
  const home = docs.get('index.html').doc;
  const header = signature(byTag(home, 'header')[0]);
  const footer = signature(byTag(home, 'footer')[0]);
  assert.ok(header.length > 15 && footer.length > 15);
  eachPage((page, doc) => {
    assert.deepEqual(signature(one(doc, (e) => e.tag === 'header', `${page} header`)), header, `${page}: header differs from index.html`);
    assert.deepEqual(signature(one(doc, (e) => e.tag === 'footer', `${page} footer`)), footer, `${page}: footer differs from index.html`);
    const current = els(byTag(doc, 'header')[0], (e) => has(e, 'aria-current'));
    assert.ok(current.length <= 1 && current.every((e) => e.attrs['aria-current'] === 'page'), `${page}: aria-current in the header`);
  });
  // The header navigation needs no script: there is no menu button to open it.
  assert.equal(byTag(byTag(home, 'header')[0], 'button').length, 1, 'the theme button is the only button in the header');
});

test('docs pages share one sidebar, and it marks the page you are on', () => {
  const withNav = PAGES.filter((p) => els(docs.get(p).doc, (e) => e.attrs.id === 'docs-nav').length);
  assert.deepEqual(withNav, Object.values(brand.layout_contract.layout_types.docs).sort());
  const nav = (page) => one(docs.get(page).doc, (e) => e.attrs.id === 'docs-nav', `${page} docs-nav`);
  const first = signature(nav(withNav[0]));
  const listed = byTag(nav(withNav[0]), 'a').map((a) => a.attrs.href);
  assert.deepEqual([...listed].sort(), withNav, 'the sidebar lists every docs page');

  for (const page of withNav) {
    const doc = docs.get(page).doc;
    assert.deepEqual(signature(nav(page)), first, `${page}: sidebar differs`);
    const current = els(nav(page), (e) => e.attrs['aria-current'] === 'page');
    assert.deepEqual(current.map((a) => a.attrs.href), [page], `${page}: aria-current in the sidebar`);

    // A menu on phones: the button is hidden until the script shows it, so without JavaScript the list shows.
    const toggle = one(doc, (e) => e.attrs.id === 'docs-menu-toggle', `${page} menu button`);
    assert.ok(has(toggle, 'hidden') && toggle.attrs['aria-controls'] === 'docs-nav' && toggle.attrs['aria-expanded'] === 'false', page);
    // Reading order: the docs menu, then "on this page", then the text.
    const order = els(doc, (e) => e.attrs.id === 'docs-nav' || hasClass(e, 'toc') || hasClass(e, 'prose') || hasClass(e, 'sheet-wrap'));
    assert.equal(order[0].attrs.id, 'docs-nav', page);
    assert.ok(hasClass(order.at(-1), 'prose') || hasClass(order.at(-1), 'sheet-wrap'), page);
  }
  assert.match(css, /\.js \.docs-nav \{ display: none; \}/);
  assert.match(css, /\.docs-nav, \.js \.docs-nav \{ display: block; \}/, 'from the desktop breakpoint the sidebar always shows');
});

test('the primary action is the same everywhere and leads to the repository', () => {
  assert.equal(brand.primary_cta.href, brand.repo_url);
  assert.equal(data.site.repoUrl, brand.repo_url);
  let primary = 0;
  eachPage((page, doc) => {
    for (const a of els(doc, (e) => e.attrs['data-cta'] === 'primary')) {
      primary++;
      assert.equal(a.attrs.href, brand.primary_cta.href, page);
      assert.equal(label(a), brand.primary_cta.label, page);
    }
    const headerCta = one(doc, (e) => hasClass(e, 'header-cta'), `${page} header action`);
    assert.equal(headerCta.attrs.href, brand.repo_url, page);
    assert.equal(label(headerCta), brand.primary_cta.nav_label, page);
  });
  const home = docs.get('index.html').doc;
  assert.ok(els(home, (e) => e.attrs['data-cta'] === 'primary').length >= 4, 'hero, self-hosting, close and the sticky bar');
  assert.ok(primary >= 5);
  assert.equal(label(byTag(home, 'h1')[0]), brand.one_line);
});

// ---------- features: one data file ----------

test('site/data/features.json is valid and tells shipped, next and planned apart', () => {
  const { features } = data.features;
  assert.deepEqual(validateFeatures(data.features), []);
  assert.ok(features.length >= 20);
  assert.deepEqual(Object.keys(GROUPS), STATUSES);
  for (const f of features) {
    for (const field of [f.title, f.text]) {
      assert.doesNotMatch(field, /[&<>"'!]/, `${f.id}: keep the text plain (no quotes, ampersands, angle brackets)`);
    }
    assert.ok(f.text.length <= 320, `${f.id}: the text is ${f.text.length} characters long`);
    assert.ok(f.text.endsWith('.'), `${f.id}: the text is a sentence`);
  }
  // The six features of the first round of the site are in the file.
  const ids = features.map((f) => f.id);
  for (const id of ['ingredient-filter', 'cook-from-video', 'shopping-list', 'honest-amounts', 'queue', 'credit']) {
    assert.ok(ids.includes(id), `${id} is missing`);
  }
});

test('validateFeatures names what is wrong', () => {
  const ok = { id: 'a', status: 'shipped', title: 'A', text: 'A.', source: 'README.md' };
  assert.deepEqual(validateFeatures({ features: [ok] }), []);
  assert.deepEqual(validateFeatures({ features: [{ ...ok, link: { label: 'More', href: 'recipe-format.html#rules' } }] }), []);
  assert.deepEqual(validateFeatures(null), ['features must be an array']);
  assert.deepEqual(validateFeatures({ features: {} }), ['features must be an array']);
  const errors = (feature, ...rest) => validateFeatures({ features: [feature, ...rest] });
  assert.match(errors(ok, ok).join('\n'), /used twice/);
  assert.match(errors({ ...ok, status: 'done' }).join('\n'), /status must be one of shipped, next, planned/);
  assert.match(errors({ ...ok, id: 'Not A Slug' }).join('\n'), /kebab-case/);
  assert.match(errors({ ...ok, text: ' ' }).join('\n'), /text is required/);
  assert.match(errors({ ...ok, source: undefined }).join('\n'), /source is required/);
  assert.match(errors({ ...ok, link: { label: 'Out', href: 'https://example.invalid/' } }).join('\n'), /link needs/);
  assert.match(errors(null).join('\n'), /not an object/);
});

test('feature cards, groups and status notes are rendered from the data, escaped', () => {
  const next = { id: 'a-b', status: 'next', title: 'T <b>', text: 'x & y', source: 's', link: { label: 'More', href: 'recipe-format.html' } };
  const planned = { id: 'p', status: 'planned', title: 'P', text: 'Later.', source: 's' };
  assert.equal(
    renderFeatureCard(next),
    '<li class="card" data-feature="a-b"><span class="badge badge-next">Being merged</span><h4>T &lt;b&gt;</h4><p>x &amp; y</p><a class="text-link" href="recipe-format.html">More</a></li>',
  );
  assert.deepEqual(renderGroup([next, planned], 'planned'), [
    '<h3 class="group-title" id="features-planned">Planned, not built yet</h3>',
    `<p class="group-lede">${GROUPS.planned.lede}</p>`,
    '<ul class="cards cards-3">',
    '  <li class="card" data-feature="p"><span class="badge badge-planned">Planned</span><h4>P</h4><p>Later.</p></li>',
    '</ul>',
  ]);
  assert.deepEqual(renderGroup([next, planned], 'shipped'), [], 'an empty group renders nothing, not an empty heading');
  assert.deepEqual(renderGroup([next], 'unknown'), []);
  assert.equal(
    renderStatusNote(planned),
    '<p class="status-note" data-feature-status="p"><span class="badge badge-planned">Planned</span> This is planned and not built yet.</p>',
  );
});

test('the home page shows every feature once, in the group of its status', () => {
  const home = docs.get('index.html').doc;
  const groups = els(home, (e) => has(e, 'data-features'));
  assert.deepEqual(groups.map((g) => g.attrs['data-features']), STATUSES);
  const shown = [];
  for (const group of groups) {
    const status = group.attrs['data-features'];
    for (const card of els(group, (e) => has(e, 'data-feature'))) {
      const feature = data.features.features.find((f) => f.id === card.attrs['data-feature']);
      assert.ok(feature, `${card.attrs['data-feature']} is not in features.json`);
      assert.equal(feature.status, status, `${feature.id} is shown under ${status}`);
      assert.equal(label(byTag(card, 'h4')[0]), feature.title);
      assert.equal(label(byTag(card, 'p')[0]), feature.text);
      assert.equal(label(one(card, (e) => hasClass(e, 'badge'), feature.id)), GROUPS[status].label);
      shown.push(feature.id);
    }
  }
  assert.deepEqual(shown, STATUSES.flatMap((s) => data.features.features.filter((f) => f.status === s).map((f) => f.id)));
  // The roadmap section holds the planned group and nothing that is built.
  const roadmap = one(home, (e) => e.attrs.id === 'roadmap', 'roadmap');
  assert.deepEqual(els(roadmap, (e) => has(e, 'data-features')).map((g) => g.attrs['data-features']), ['planned']);
});

test('status notes in the pages name real features and show their status', () => {
  let notes = 0;
  eachPage((page, doc) => {
    for (const note of els(doc, (e) => has(e, 'data-feature-status'))) {
      notes++;
      const feature = data.features.features.find((f) => f.id === note.attrs['data-feature-status']);
      assert.ok(feature, `${page}: ${note.attrs['data-feature-status']} is not in features.json`);
      assert.ok(label(note).startsWith(GROUPS[feature.status].label), `${page}: the note for ${feature.id}`);
    }
  });
  assert.ok(notes >= 6);
  for (const page of ['recipe-agent.html', 'how-analysis-works.html', 'index.html']) {
    assert.ok(blockNames(docs.get(page).html).includes('status:recipe-agent'), `${page} says where the Recipe Agent stands`);
  }
});

// ---------- generated blocks and publishing settings ----------

test('the pages, robots.txt and sitemap.xml are in step with the data files (npm run site:sync)', async () => {
  eachPage((page, doc, html) => {
    assert.equal(syncPage(html, page, data), html, `${page} is out of date: run \`npm run site:sync\``);
    const meta = blockNames(html).filter((n) => n === 'meta').length;
    assert.equal(meta, NOINDEX.includes(page) ? 0 : 1, `${page}: gen:meta blocks`);
  });
  assert.deepEqual(
    blockNames(docs.get('index.html').html).filter((n) => n.startsWith('features:')),
    STATUSES.map((s) => `features:${s}`),
  );
  assert.equal(await read('robots.txt'), renderRobots(data.site), 'robots.txt is out of date: run `npm run site:sync`');
  assert.equal(await read('sitemap.xml'), renderSitemap(data.site, PAGES), 'sitemap.xml is out of date: run `npm run site:sync`');
});

test('site.json drives canonical, og:url and og:image', async () => {
  const base = baseUrl(data.site);
  assert.ok(await exists(join(SITE, data.site.ogImage)), `${data.site.ogImage} does not exist`);
  eachPage((page, doc) => {
    const head = byTag(doc, 'head')[0];
    const canonical = els(head, (e) => e.tag === 'link' && e.attrs.rel === 'canonical').map((e) => e.attrs.href);
    const og = (prop) => els(head, (e) => e.tag === 'meta' && e.attrs.property === prop).map((e) => e.attrs.content);
    if (NOINDEX.includes(page)) {
      assert.deepEqual(els(head, (e) => e.tag === 'meta' && e.attrs.name === 'robots').map((e) => e.attrs.content), ['noindex'], page);
      assert.deepEqual(canonical, [], page);
      return;
    }
    assert.ok(og('og:title')[0]?.includes(brand.brand_name) && og('og:description')[0]?.length > 20, `${page}: og:title and og:description`);
    assert.deepEqual(og('og:site_name'), [data.site.name], page);
    if (base) {
      assert.deepEqual(canonical, [pageUrl(base, page)], page);
      assert.deepEqual(og('og:url'), [pageUrl(base, page)], page);
      assert.deepEqual(og('og:image'), [`${base}/${data.site.ogImage}`], page);
    } else {
      // Not published yet: no page may claim an address.
      assert.deepEqual([canonical, og('og:url'), og('og:image')], [[], [], []], page);
    }
  });
  if (!base) assert.ok((await read('sitemap.xml')).includes(`${PLACEHOLDER_BASE}/`));
});

test('sync functions: base URL, page addresses, blocks, robots and sitemap', () => {
  const site = { baseUrl: 'https://recipes.example/', ogImage: 'assets/og.png' };
  const none = { features: [] };
  assert.equal(baseUrl(site), 'https://recipes.example');
  assert.equal(baseUrl({}), '');
  assert.equal(baseUrl({ baseUrl: '  ' }), '');
  assert.throws(() => baseUrl({ baseUrl: 'http://recipes.example' }), /https/);
  assert.throws(() => baseUrl({ baseUrl: 'https://a.example/"><script>' }), /https/);
  assert.equal(pageUrl('https://recipes.example', 'index.html'), 'https://recipes.example/');
  assert.equal(pageUrl('https://recipes.example', 'recipe-format.html'), 'https://recipes.example/recipe-format.html');

  assert.deepEqual(metaLines(site, 'index.html'), [
    '<link rel="canonical" href="https://recipes.example/">',
    '<meta property="og:url" content="https://recipes.example/">',
    '<meta property="og:image" content="https://recipes.example/assets/og.png">',
  ]);
  assert.equal(metaLines({ baseUrl: '' }, 'index.html').length, 1);

  const before = '<head>\n  <!-- gen:meta -->\n  old\n  lines\n  <!-- /gen:meta -->\n</head>\n';
  const after = [
    '<head>',
    '  <!-- gen:meta -->',
    '  <link rel="canonical" href="https://recipes.example/a.html">',
    '  <meta property="og:url" content="https://recipes.example/a.html">',
    '  <meta property="og:image" content="https://recipes.example/assets/og.png">',
    '  <!-- /gen:meta -->',
    '</head>',
    '',
  ].join('\n');
  assert.equal(syncPage(before, 'a.html', { site, features: none }), after);
  assert.equal(syncPage(after, 'a.html', { site, features: none }), after, 'a second run changes nothing');

  const group = '<div>\n<!-- gen:features:next -->\n<p>stale</p>\n<!-- /gen:features:next -->\n</div>';
  const emptied = '<div>\n<!-- gen:features:next -->\n<!-- /gen:features:next -->\n</div>';
  assert.equal(syncPage(group, 'a.html', { site, features: none }), emptied, 'a group without features is emptied');
  assert.equal(syncPage(emptied, 'a.html', { site, features: none }), emptied);
  assert.deepEqual(blockNames(group), ['features:next']);

  const feature = { id: 'x', status: 'shipped', title: 'X', text: 'X.', source: 's' };
  const noted = syncPage('  <!-- gen:status:x -->\n  <!-- /gen:status:x -->', 'a.html', { site, features: { features: [feature] } });
  assert.equal(noted, `  <!-- gen:status:x -->\n  ${renderStatusNote(feature)}\n  <!-- /gen:status:x -->`);
  assert.throws(() => syncPage('<!-- gen:status:gone -->\n<!-- /gen:status:gone -->', 'a.html', { site, features: none }), /not in features\.json/);
  assert.throws(() => syncPage('<!-- gen:nope -->\n<!-- /gen:nope -->', 'a.html', { site, features: none }), /unknown block/);
  assert.equal(syncPage('<p>no blocks</p>', 'a.html', { site, features: none }), '<p>no blocks</p>');

  assert.equal(renderRobots(site), 'User-agent: *\nAllow: /\n\nSitemap: https://recipes.example/sitemap.xml\n');
  assert.ok(renderRobots({ baseUrl: '' }).includes(`Sitemap: ${PLACEHOLDER_BASE}/sitemap.xml`));
  assert.deepEqual(sitemapPages(['404.html', 'b.html', 'index.html']), ['index.html', 'b.html']);
  const map = renderSitemap(site, ['404.html', 'b.html', 'index.html']);
  assert.ok(map.includes('<url><loc>https://recipes.example/</loc></url>\n  <url><loc>https://recipes.example/b.html</loc></url>'));
  assert.ok(!map.includes('404'));
});

// ---------- one visual language ----------

const declarations = (block) =>
  Object.fromEntries([...(block ?? '').matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
const light = declarations(css.match(/:root \{([^}]*)\}/)?.[1]);
const dark = declarations(css.match(/:root\[data-theme='dark'\] \{([^}]*)\}/)?.[1]);
const system = declarations(css.match(/:root:not\(\[data-theme\]\) \{([^}]*)\}/)?.[1]);

const luminance = (hex) => {
  assert.match(hex, /^#[0-9a-f]{6}$/i, `${hex} is not a six-digit hex colour`);
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

test('contrast helpers match known values', () => {
  assert.ok(Math.abs(contrast('#000000', '#ffffff') - 21) < 1e-9, 'black on white');
  assert.ok(Math.abs(contrast('#ffffff', '#000000') - 21) < 1e-9, 'the order does not matter');
  assert.equal(contrast('#ffffff', '#ffffff'), 1);
  assert.ok(Math.abs(contrast('#ffffff', '#c2410c') - 5.18) < 0.02, 'white on the accent');
});

test('the dark theme is the same with and without JavaScript, and covers every colour', () => {
  assert.ok(Object.keys(dark).length >= 20);
  assert.deepEqual(system, dark);
  const colours = Object.keys(light).filter((k) => /^#[0-9a-f]{6}$/i.test(light[k]));
  assert.ok(colours.length >= 20);
  for (const token of colours) assert.match(dark[token] ?? '', /^#[0-9a-f]{6}$/i, `${token} has no dark value`);
});

test('every text pair the site uses has contrast with margin, in both themes', () => {
  // [foreground, background]. AA asks 4.5:1 for text; the site asks 5:1 so a rounding error cannot sink it.
  const TEXT = [
    ['--ink', '--bg'], ['--ink', '--surface'], ['--ink', '--surface-2'], ['--ink', '--surface-3'], ['--ink', '--accent-soft'],
    ['--ink-2', '--bg'], ['--ink-2', '--surface'], ['--ink-2', '--surface-2'], ['--ink-2', '--surface-3'],
    ['--muted', '--bg'], ['--muted', '--surface'], ['--muted', '--surface-2'],
    ['--accent-text', '--bg'], ['--accent-text', '--surface'], ['--accent-text', '--surface-2'], ['--accent-text', '--accent-soft'],
    ['--accent-ink', '--accent'],
    ['--ok', '--ok-soft'], ['--ok', '--surface'], ['--ok', '--bg'],
    ['--warn', '--warn-soft'], ['--info', '--info-soft'],
    ['--stage-ink', '--stage'],
  ];
  // Boundaries of controls and the focus ring: 3:1.
  const EDGES = [['--line-strong', '--bg'], ['--line-strong', '--surface'], ['--focus', '--bg'], ['--focus', '--surface-2'], ['--stage-ink', '--stage']];
  for (const [name, theme] of [['light', light], ['dark', dark]]) {
    for (const [fg, bg] of TEXT) {
      const ratio = contrast(theme[fg], theme[bg]);
      assert.ok(ratio >= 5, `${name}: ${fg} on ${bg} is ${ratio.toFixed(2)}:1`);
    }
    for (const [fg, bg] of EDGES) {
      const ratio = contrast(theme[fg], theme[bg]);
      assert.ok(ratio >= 3, `${name}: ${fg} against ${bg} is ${ratio.toFixed(2)}:1`);
    }
  }
});

test('components use the tokens: type scale, spacing, radius, motion, and the hero colours', async () => {
  for (const token of [
    '--text-xs', '--text-sm', '--text-md', '--text-lg', '--text-xl', '--text-2xl', '--text-3xl',
    '--s-1', '--s-2', '--s-3', '--s-4', '--s-5', '--s-6', '--s-7', '--s-8',
    '--r-sm', '--r-md', '--r-lg', '--r-pill', '--dur-1', '--dur-2', '--dur-3', '--ease', '--tap', '--gutter', '--measure',
  ]) {
    assert.ok(light[token], `${token} is not defined`);
  }
  assert.deepEqual([light['--text-xs'], light['--text-md'], light['--tap'], light['--measure']], ['0.75rem', '1rem', '44px', '72ch']);
  for (const token of brand.design.site_only_tokens) assert.ok(light[token], `${token} (site only) is not defined`);

  // Outside the token blocks and the print sheet, no rule carries a raw colour.
  const rules = css.slice(css.indexOf('/* ---------- base ---------- */'), css.indexOf('/* ---------- print ---------- */'));
  assert.ok(rules.length > 5000);
  assert.doesNotMatch(rules, /#[0-9a-f]{3,8}\b/i, 'a raw hex colour in a component rule');
  assert.doesNotMatch(rules, /\brgba?\(/, 'a raw rgb colour in a component rule');
  const beforeMotion = rules.slice(0, rules.indexOf('/* ---------- motion ---------- */'));
  assert.ok(beforeMotion.length > 5000);
  assert.doesNotMatch(beforeMotion, /\b\d+m?s\b/, 'a raw duration in a component rule');

  // The live mark, the SVG poster and the browser chrome use the same colours as the page.
  for (const [name, theme] of [['light', light], ['dark', dark]]) {
    assert.equal(PALETTES[name].tile, theme['--ink'], `hero tile, ${name}`);
    assert.equal(PALETTES[name].accent, theme['--accent'], `hero accent, ${name}`);
    assert.match(PALETTES[name].rim, /^#[0-9a-f]{6}$/);
  }
  assert.match(css, /\.p-tile \{ fill: var\(--ink\); \}/);
  assert.match(css, /\.p-accent \{ fill: var\(--accent\); \}/);
  const main = await read('js/main.js');
  assert.ok(main.includes(`light: '${light['--bg']}'`) && main.includes(`dark: '${dark['--bg']}'`), 'THEME_COLOR in main.js');
  eachPage((page, doc) => {
    const themeColor = els(doc, (e) => e.tag === 'meta' && e.attrs.name === 'theme-color').map((e) => e.attrs.content);
    assert.deepEqual(themeColor, [light['--bg']], page);
  });
  for (const file of ['js/theme.js', 'js/main.js']) {
    assert.ok((await read(file)).includes(`'${brand.theme_storage_key}'`), file);
  }
});

test('one layout contract: three breakpoints, mobile-first, shared by CSS and scripts', async () => {
  const widths = [...new Set([...css.matchAll(/@media \(min-width: (\d+)px\)/g)].map((m) => Number(m[1])))].sort((a, b) => a - b);
  assert.deepEqual(widths, brand.layout_contract.breakpoints_px);
  assert.doesNotMatch(css, /@media[^{]*max-width/, 'min-width steps only');
  assert.equal(TRAVEL_FROM, 1280);
  assert.ok(brand.layout_contract.breakpoints_px.includes(TRAVEL_FROM));
  assert.ok((await read('js/main.js')).includes(`'(min-width: ${TRAVEL_FROM}px)'`));
  assert.match(await read('js/showcase.js'), /\(min-width: (\d+)px\)/);
  for (const m of (await read('js/showcase.js')).matchAll(/\(min-width: (\d+)px\)/g)) {
    assert.ok(brand.layout_contract.breakpoints_px.includes(Number(m[1])), `showcase.js uses ${m[1]}px`);
  }
  // Nothing in the shell has a max-width: bands paint to both edges and the content is capped by padding.
  assert.match(css, /\.inner \{\s*padding-left: max\(var\(--gutter\), env\(safe-area-inset-left\), \(100% - var\(--content-max\)\) \/ 2\);/);
  assert.match(css, /html \{\s*background: var\(--bg\);/);
});

test('the dashboard and the site share their colour tokens once the redesign is merged', async (t) => {
  const dashboard = await readFile(join(ROOT, 'public', 'styles.css'), 'utf8').catch(() => '');
  if (!dashboard.includes('--surface-3') || !dashboard.includes('--accent-text')) {
    return t.skip('public/styles.css is not on the redesign tokens in this checkout');
  }
  const shared = [
    '--bg', '--surface', '--surface-2', '--surface-3', '--ink', '--ink-2', '--muted', '--line', '--line-strong',
    '--accent', '--accent-ink', '--accent-text', '--accent-soft', '--ok', '--ok-soft', '--warn', '--warn-soft',
    '--info', '--info-soft',
  ];
  for (const token of shared) {
    const name = token.replace(/-/g, '\\-');
    const values = new Set([...dashboard.matchAll(new RegExp(`(?<![a-z0-9-])${name}\\s*:\\s*([^;}]+)[;}]`, 'gi'))].map((m) => m[1].trim().toLowerCase()));
    if (!values.size) continue; // the dashboard does not define this one
    assert.ok(values.has(light[token].toLowerCase()), `${token}: the site's light value ${light[token]} is not a dashboard value (${[...values].join(', ')})`);
    assert.ok(values.has(dark[token].toLowerCase()), `${token}: the site's dark value ${dark[token]} is not a dashboard value (${[...values].join(', ')})`);
  }
});

test('motion, contrast and focus preferences are honoured in the stylesheet', () => {
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{[^}]*\{[^}]*animation-duration: 0\.01ms !important;[^}]*transition-duration: 0\.01ms !important;/);
  assert.match(css, /@media \(prefers-reduced-motion: no-preference\) \{\s*html \{ scroll-behavior: smooth; \}/);
  assert.ok((css.match(/@media \(prefers-contrast: more\)/g) ?? []).length >= 1);
  assert.match(css, /@media \(forced-colors: active\)/);
  assert.match(css, /@media print/);
  assert.match(css, /:focus-visible \{ outline: 2px solid var\(--focus\);/);
  assert.doesNotMatch(css, /outline:\s*(?:none|0)\b/, 'focus outlines are never removed');
  // Content is only hidden for the reveal effect once the script has marked what is on screen.
  for (const line of css.split('\n').filter((l) => l.includes('.reveal') && /opacity: 0\b/.test(l))) {
    assert.ok(line.includes('html.js-ready .reveal'), `reveal without js-ready: ${line.trim()}`);
  }
});

// ---------- third-party requests ----------

test('the pages load nothing from another host, and no web fonts', () => {
  eachPage((page, doc) => {
    for (const e of byTag(doc, 'script', 'link', 'img', 'iframe', 'source', 'video', 'audio', 'object', 'embed')) {
      const url = e.attrs.src ?? e.attrs.href ?? e.attrs.data ?? '';
      assert.doesNotMatch(url, /^(?:https?:)?\/\//, `${page}: <${e.tag}> loads ${url}`);
    }
    assert.equal(els(doc, (e) => e.tag === 'script' && e.attrs.type === 'importmap').length, 0, `${page}: no import map`);
    assert.equal(byTag(doc, 'style').length, 0, `${page}: no inline style element`);
    assert.equal(els(doc, (e) => has(e, 'style')).length, 0, `${page}: no inline style attribute`);
    assert.equal(els(doc, (e) => e.tag === 'link' && /preconnect|dns-prefetch|preload/.test(e.attrs.rel ?? '')).length, 0, page);
    const scripts = byTag(doc, 'script').map((s) => [s.attrs.src.replace(/^\//, ''), s.attrs.type ?? 'classic']);
    assert.deepEqual(scripts, [['js/theme.js', 'classic'], ['js/main.js', 'module']], `${page}: scripts`);
    assert.ok(byTag(doc, 'script').every((s) => s.children.length === 0), `${page}: no inline script`);
  });
  assert.doesNotMatch(css, /@import|url\(|@font-face/, 'the stylesheet requests nothing');
  assert.doesNotMatch(css, /fonts\.googleapis|fonts\.gstatic/);
  for (const stack of ['--font-display', '--font-body', '--font-mono']) {
    assert.match(light[stack], /(?:serif|sans-serif|monospace)$/, `${stack} ends in a system family`);
  }
});

test('site scripts import only their own files; three.js is the one outside address, loaded lazily', async () => {
  const dir = join(SITE, 'js');
  const files = (await readdir(dir)).filter((f) => f.endsWith('.js'));
  const outside = [];
  for (const name of files) {
    const src = await readFile(join(dir, name), 'utf8');
    for (const m of src.matchAll(/(?:\bfrom|\bimport)\s*\(?\s*['"]([^'"]+)['"]/g)) {
      assert.ok(m[1].startsWith('.'), `${name} imports the bare module "${m[1]}"`);
    }
    for (const m of src.matchAll(/['"`](\.\.?\/[^'"`]+\.js(?:on)?)['"`]/g)) {
      assert.ok(await exists(join(dir, m[1])), `${name}: ${m[1]} does not exist`);
    }
    for (const m of src.matchAll(/https?:\/\/[^\s'"`<>)]+/g)) outside.push([name, m[0]]);
    if (name !== 'features.js') assert.doesNotMatch(src, /\bfetch\(|XMLHttpRequest|sendBeacon|new WebSocket/, `${name} makes a request`);
  }
  // Two addresses in all of site/js: the three.js build, and the link a timestamp opens on YouTube.
  assert.deepEqual(outside.map(([name, url]) => `${name} ${url.replace(/\$\{.*$/, '')}`).sort(), [
    `hero.js ${THREE_URL}`,
    'showcase-core.js https://www.youtube.com/watch?v=',
  ]);
  assert.equal(THREE_URL, brand.three_url);
  assert.match(THREE_URL, /^https:\/\/cdn\.jsdelivr\.net\/npm\/three@\d+\.\d+\.\d+\/build\/three\.module\.js$/, 'a pinned version');

  const hero = await read('js/hero.js');
  const boot = await read('js/hero-boot.js');
  const main = await read('js/main.js');
  assert.ok(hero.includes('await import(THREE_URL)'), 'three.js is imported inside mountHero, not at module load');
  assert.doesNotMatch(hero, /^import .*three/m);
  assert.doesNotMatch(main, /^import /m, 'main.js has no static imports: page-specific parts load on demand');
  assert.ok(boot.includes("await import('./hero.js')"), 'the hero module is loaded on demand');
  // Skipped under reduced motion and data saving, and only after the hero has been on screen.
  assert.match(boot, /if \(api \|\| booting \|\| !wanted \|\| reduce\.matches \|\| saveData\(\)\) return;/);
  assert.ok(boot.indexOf('mod.webgl2Available()') < boot.indexOf('mod.mountHero('), 'WebGL 2 is probed before three.js is requested');
  assert.match(boot, /new IntersectionObserver/);
  // The fetch in features.js stays on the site.
  assert.match(await read('js/features.js'), /fetch\(new URL\('\.\.\/data\/features\.json', import\.meta\.url\)/);

  // Every remaining outside request is written down for whoever publishes the site.
  const readme = await read('README.md');
  assert.ok(readme.includes(THREE_URL), 'site/README.md lists the three.js address');
  assert.match(readme, /## External requests/);
});

test('the fixed 3D layer can never take a click, and a change of mode is positioned at once', async () => {
  assert.match(css, /\.stage \{ pointer-events: none; \}/);
  assert.match(css, /\.stage--fixed \.stage-canvas \{ pointer-events: none;/);
  assert.match(css, /\.stage--fixed \{[^}]*z-index: var\(--z-stage\);/);
  assert.match(css, /\.band > \.inner \{ position: relative; z-index: var\(--z-content\); \}/);
  assert.match(css, /\.site-footer \{\s*position: relative; z-index: var\(--z-content\);/);
  assert.ok(Number(light['--z-stage']) < Number(light['--z-content']) && Number(light['--z-content']) < Number(light['--z-bar']));
  // Nothing on the page is made click-through to let the canvas be reached.
  assert.doesNotMatch(css.replace(/\.stage[^{]*\{[^}]*\}/g, '').replace(/\.hero::before \{[^}]*\}/, ''), /pointer-events: none/);

  const boot = await read('js/hero-boot.js');
  assert.match(boot, /const relayout = \(\) => \{ if \(!stage\) return; measure\(\); place\(\); update\(\); \};/);
  assert.match(boot, /desktop\.addEventListener\('change', relayout\)/);
  const hero = await read('js/hero.js');
  assert.match(hero, /window\.addEventListener\('pointermove', onPointerMove/);
  assert.doesNotMatch(hero, /canvas\.addEventListener\('pointer/);
  assert.match(hero, /window\.removeEventListener\('pointermove', onPointerMove\)/);
});

// ---------- without JavaScript ----------

test('every page is usable without JavaScript', () => {
  const revealedByScript = (e) =>
    ['demo-side', 'demo-detail', 'hero-toggle', 'docs-menu-toggle'].includes(e.attrs.id) || has(e, 'data-copy-from') || has(e, 'data-print');
  eachPage((page, doc) => {
    assert.ok(hasClass(byTag(doc, 'html')[0], 'no-js'), `${page}: starts as no-js; js/theme.js flips it`);
    // Only controls that do nothing without a script are hidden in the markup.
    for (const e of els(doc, (x) => has(x, 'hidden'))) {
      assert.ok(revealedByScript(e), `${page}: <${e.tag} id="${e.attrs.id ?? ''}"> is hidden and no script shows it`);
    }
    // No button is offered that cannot work: each is hidden, inside a hidden part, or the theme button
    // (which the stylesheet hides under .no-js).
    for (const b of byTag(doc, 'button')) {
      const safe = has(b, 'hidden') || within(b, (p) => has(p, 'hidden')) || hasClass(b, 'theme-toggle');
      assert.ok(safe, `${page}: button "${label(b)}" shows without JavaScript`);
    }
    assert.equal(byTag(doc, 'noscript').length, 0, `${page}: content is in the page itself, not in noscript`);
  });
  assert.match(css, /\.no-js \.theme-toggle \{ display: none; \}/);

  // The showcase degrades to a static list of the same recipes.
  const home = docs.get('index.html').doc;
  const fallback = one(home, (e) => e.attrs.id === 'demo-fallback', 'the static recipe list');
  assert.ok(!has(fallback, 'hidden') && fallback.tag === 'ul');
  const items = els(fallback, (e) => has(e, 'data-static-recipe'));
  assert.deepEqual(items.map((li) => li.attrs['data-static-recipe']), SHOWCASE_IDS);
  for (const [i, li] of items.entries()) {
    const r = showcase[i];
    const text = label(li);
    assert.equal(label(byTag(li, 'h3')[0]), r.title);
    for (const part of [`by ${r.creator.name}`, `${recipeKeys(r).length} ingredients`, `${stepCount(r)} steps`, r.summary]) {
      assert.ok(text.includes(part), `${r.id}: the static list does not say "${part}"`);
    }
    const hrefs = byTag(li, 'a').map((a) => a.attrs.href);
    assert.deepEqual(hrefs, [r.video.url, `${brand.repo_url}/blob/main/recipes/${r.id}.json`], r.id);
  }
  // The feature groups are in the HTML, so they need no script either (they are compared with the data above).
  assert.ok(els(home, (e) => has(e, 'data-feature')).length === data.features.features.length);
});

// ---------- facts from the recipe files ----------

test('amounts quoted on the home page are the amounts in the recipe files', async () => {
  const home = docs.get('index.html').doc;
  const examples = els(home, (e) => has(e, 'data-example'));
  assert.equal(examples.length, 4);
  for (const li of examples) {
    const [id, item, amount, basis] = li.attrs['data-example'].split('|');
    assert.ok(SHOWCASE_IDS.includes(id), `${id} is not one of the showcased recipes`);
    const recipe = JSON.parse(await readFile(join(ROOT, 'recipes', `${id}.json`), 'utf8'));
    const found = recipe.components.flatMap((c) => c.ingredients).find((i) => i.item === item);
    assert.ok(found, `${id}: no ingredient "${item}"`);
    assert.equal(found.amount ?? '', amount, `${id}: ${item}`);
    assert.equal(found.basis, basis, `${id}: ${item}`);
    // What the visitor reads is the same as the data attribute.
    assert.equal(label(one(li, (e) => hasClass(e, 'ex-item'), id)), item);
    assert.ok(label(one(li, (e) => hasClass(e, 'ex-amt'), id)).startsWith(amount || 'amount not given'), `${id}: ${item}`);
  }
  assert.equal(SHOWCASE_IDS.length, 3);
  assert.ok(label(one(home, (e) => e.attrs.id === 'showcase-title', 'showcase title')).startsWith('Three recipes from the repository'));
});

// ---------- the preview server ----------

test('the preview server only serves files inside site/', () => {
  assert.equal(resolveSitePath('/'), join(SITE_ROOT, 'index.html'));
  assert.equal(resolveSitePath('/js/main.js'), join(SITE_ROOT, 'js', 'main.js'));
  assert.equal(resolveSitePath('/self-hosting.html'), join(SITE_ROOT, 'self-hosting.html'));
  assert.equal(resolveSitePath('/data/features.json'), join(SITE_ROOT, 'data', 'features.json'));
  assert.equal(resolveSitePath('/../package.json'), null);
  assert.equal(resolveSitePath('/%2e%2e/%2e%2e/etc/passwd'), null);
  assert.equal(resolveSitePath('/%E0%A4%A'), null, 'malformed escape');
  assert.equal(resolveSitePath('/a%00b'), null, 'NUL byte');
  assert.equal(SITE_ROOT, SITE);
  assert.match(TYPES['.js'], /^text\/javascript/);
  assert.match(TYPES['.svg'], /^image\/svg\+xml/);
  assert.match(TYPES['.json'], /^application\/json/);
  assert.match(TYPES['.xml'], /^application\/xml/);
  assert.match(TYPES['.txt'], /^text\/plain/);
});
