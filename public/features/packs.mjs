// Recipe packs panel: pick recipes and download a pack or copy a link; open a pack file
// or link and see what importing it would do; import it through the local server.
// Self-contained: mount(element, options) → { destroy() }. Styles: packs.css. Docs: PACKS.md.
// Every string from a pack or a recipe goes through esc(); packs are untrusted input.

import {
  exportPack, serializePack, packFileName, packLink, packFromLink, hasPackLink, readPack, planImport,
  packFromRead, PackError, MAX_PACK_CHARS,
} from '../../lib/pack.mjs';

export const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const plural = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`;
const IMPORTABLE = new Set(['new', 'conflict']);

const STATUS_LABEL = {
  new: 'New',
  conflict: 'New, renamed',
  duplicate: 'Already in your bank',
  invalid: 'Can’t import',
};

// ---------- pure renderers (exported for tests) ----------

/** The recipe picker list. `selected` is a Set of ids; `q` filters by title, creator and tags. */
export function renderPicker(recipes, selected, q = '') {
  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const shown = recipes.filter((r) => {
    if (!words.length) return true;
    const hay = [r.title, r.creator?.name, ...(r.tags ?? [])].join(' ').toLowerCase();
    return words.every((w) => hay.includes(w));
  });
  if (!shown.length) return `<li class="pk-empty">${recipes.length ? 'No recipe matches.' : 'No recipes in the bank yet.'}</li>`;
  return shown.map((r) => `
    <li><label class="pk-row">
      <input type="checkbox" data-pick="${esc(r.id)}" ${selected.has(r.id) ? 'checked' : ''}>
      <span class="pk-name">${esc(r.title)}</span>
      <span class="pk-sub">${esc(r.creator?.name)}</span>
    </label></li>`).join('');
}

/** The import plan. `include` is a Set of pack positions to import; `canImport` shows the button. */
export function renderPlan(plan, { include = new Set(), canImport = false, busy = false } = {}) {
  if (!plan.ok) {
    return `<div class="pk-plan"><p class="pk-error" role="alert">${esc(plan.errors[0] ?? 'This pack cannot be read.')}</p></div>`;
  }
  const c = plan.counts;
  const summary = [
    c.new && `${c.new} new`,
    c.conflict && `${c.conflict} renamed`,
    c.duplicate && `${c.duplicate} already in your bank`,
    c.invalid && `${c.invalid} can’t be imported`,
  ].filter(Boolean).join(' · ');
  const chosen = plan.items.filter((i) => IMPORTABLE.has(i.status) && include.has(i.index)).length;
  const items = plan.items.map((i) => {
    const importable = IMPORTABLE.has(i.status);
    const detail = {
      new: esc(i.creator),
      conflict: `${esc(i.creator)} · saved as <code>${esc(i.id)}</code> because <code>${esc(i.packId)}</code> is taken`,
      duplicate: i.inBank
        ? `same video as <a href="#/r/${esc(encodeURIComponent(i.duplicateOf ?? ''))}">${esc(i.duplicateOf)}</a>`
        : `same video as <code>${esc(i.duplicateOf)}</code>, earlier in this pack`,
      invalid: '',
    }[i.status];
    return `
      <li class="pk-item" data-status="${esc(i.status)}">
        <label class="pk-row">
          <input type="checkbox" data-include="${i.index}" ${importable ? '' : 'disabled'} ${importable && include.has(i.index) ? 'checked' : ''}>
          <span class="pk-name">${esc(i.title)}</span>
          <span class="pk-badge">${STATUS_LABEL[i.status]}</span>
        </label>
        ${detail ? `<p class="pk-sub">${detail}</p>` : ''}
        ${i.problems.length ? `<ul class="pk-problems">${i.problems.map((p) => `<li>${esc(p)}</li>`).join('')}</ul>` : ''}
      </li>`;
  }).join('');
  const action = canImport
    ? `<button type="button" class="pk-btn pk-primary" data-act="import" ${chosen && !busy ? '' : 'disabled'}>${busy ? 'Importing…' : `Import ${plural(chosen, 'recipe')}`}</button>`
    : `<p class="pk-note">This copy can’t save recipes. To import, run Recipe Bank locally (<code>npm start</code>) or use <code>node scripts/pack.mjs import &lt;file&gt; --write</code>.</p>`;
  return `
    <div class="pk-plan">
      <h3 class="pk-plan-title">${esc(plan.title)}</h3>
      <p class="pk-sub">${plan.exported ? `Exported ${esc(plan.exported.slice(0, 10))} · ` : ''}${esc(summary)}</p>
      <ul class="pk-items">${items}</ul>
      <div class="pk-actions">${action}</div>
    </div>`;
}

// ---------- mount ----------

/**
 * Mount the packs panel into `element`.
 * options:
 *   recipes      the bank's recipes; fetched from the API when missing
 *   static       true on the static copy (no server: no import); default <html data-static="1">
 *   apiBase      prefix for API calls, default ''
 *   fetch        fetch implementation, default window.fetch
 *   readHash     open a #pack= link from location.hash on mount and on hashchange; default true
 *   onImported   called with the created ids after a successful import
 */
export function mount(element, options = {}) {
  const doc = element.ownerDocument;
  const win = doc.defaultView;
  const isStatic = options.static ?? doc.documentElement.dataset.static === '1';
  const canImport = !isStatic;
  const fetchFn = options.fetch ?? win.fetch.bind(win);
  const api = (name) => `${options.apiBase ?? ''}/api/${name}${isStatic ? '.json' : ''}`;
  const uid = `pk${Math.random().toString(36).slice(2, 8)}`;
  const ac = new AbortController();
  const on = (target, type, fn) => target.addEventListener(type, fn, { signal: ac.signal });

  const state = {
    recipes: Array.isArray(options.recipes) ? options.recipes : null,
    picked: new Set(),
    q: '',
    read: null,
    plan: null,
    include: new Set(),
    busy: false,
  };
  let destroyed = false;

  element.classList.add('rb-packs');
  element.innerHTML = `
    <section class="pk-section" aria-labelledby="${uid}-share">
      <h2 id="${uid}-share">Share recipes</h2>
      <p class="pk-sub">Pick recipes, then download them as one pack file or copy a link (links fit a few recipes).</p>
      <label class="pk-field"><span>Pack title</span>
        <input type="text" data-el="title" maxlength="120" placeholder="e.g. Weeknight chicken"></label>
      <div class="pk-toolbar">
        <input type="search" data-el="q" placeholder="Find a recipe…" aria-label="Find a recipe">
        <button type="button" class="pk-btn" data-act="all">Select shown</button>
        <button type="button" class="pk-btn" data-act="none">Clear</button>
      </div>
      <ul class="pk-list" data-el="pick" aria-label="Recipes"><li class="pk-empty">Loading recipes…</li></ul>
      <div class="pk-actions">
        <button type="button" class="pk-btn pk-primary" data-act="download">Download pack</button>
        <button type="button" class="pk-btn" data-act="link">Copy link</button>
        <span class="pk-sub" data-el="count"></span>
      </div>
      <p class="pk-status" data-el="share-status" role="status"></p>
      <input class="pk-linkout" data-el="link-out" type="text" readonly hidden aria-label="Pack link">
    </section>
    <section class="pk-section" aria-labelledby="${uid}-import">
      <h2 id="${uid}-import">Import a pack</h2>
      <p class="pk-sub">Open a pack file or paste a pack link to see what it holds. Recipes whose video is already in your bank are skipped; nothing is overwritten.</p>
      <label class="pk-field"><span>Pack file</span>
        <input type="file" data-el="file" accept=".json,application/json"></label>
      <form class="pk-toolbar" data-el="link-form">
        <input type="url" data-el="link" placeholder="…or paste a pack link" aria-label="Pack link to open">
        <button type="submit" class="pk-btn">Open link</button>
      </form>
      <div data-el="plan" aria-live="polite"></div>
      <p class="pk-status" data-el="import-status" role="status"></p>
    </section>`;

  const $ = (name) => element.querySelector(`[data-el="${name}"]`);
  const setStatus = (name, msg, kind = '') => {
    const el = $(name);
    el.textContent = msg;
    el.dataset.kind = kind;
  };

  // ----- data -----
  async function ensureRecipes() {
    if (state.recipes) return state.recipes;
    const res = await fetchFn(api('recipes'));
    if (!res.ok) throw new Error(`recipes: HTTP ${res.status}`);
    const body = await res.json();
    state.recipes = Array.isArray(body.recipes) ? body.recipes : [];
    return state.recipes;
  }
  const sorted = () => [...(state.recipes ?? [])].sort((a, b) => String(a.title).localeCompare(String(b.title)));

  // ----- share -----
  function renderShare() {
    if (!state.recipes) return;
    $('pick').innerHTML = renderPicker(sorted(), state.picked, state.q);
    $('count').textContent = state.picked.size ? `${plural(state.picked.size, 'recipe')} picked` : '';
  }
  function currentPack() {
    const recipes = sorted().filter((r) => state.picked.has(r.id));
    return exportPack(recipes, { title: $('title').value });
  }
  function download() {
    const pack = currentPack();
    const url = URL.createObjectURL(new Blob([serializePack(pack)], { type: 'application/json' }));
    const a = doc.createElement('a');
    a.href = url;
    a.download = packFileName(pack);
    doc.body.append(a);
    a.click();
    a.remove();
    win.setTimeout(() => URL.revokeObjectURL(url), 1000);
    setStatus('share-status', `Downloaded ${a.download} with ${plural(pack.recipes.length, 'recipe')}.`, 'ok');
  }
  async function copyLink() {
    const link = packLink(currentPack(), win.location.href);
    const out = $('link-out');
    out.value = link;
    try {
      await win.navigator.clipboard.writeText(link);
      out.hidden = true;
      setStatus('share-status', 'Link copied. Anyone who opens it can import these recipes.', 'ok');
    } catch {
      out.hidden = false;
      out.select();
      setStatus('share-status', 'Copy the link below.', '');
    }
  }
  const shareAction = (fn) => async () => {
    try {
      await fn();
    } catch (e) {
      if (!(e instanceof PackError)) throw e;
      $('link-out').hidden = true;
      setStatus('share-status', e.code === 'empty' ? 'Pick at least one recipe first.' : e.message, 'error');
    }
  };

  // ----- import -----
  async function showRead(read) {
    state.read = read;
    setStatus('import-status', '');
    try {
      await ensureRecipes();
    } catch {
      // Without the bank we can still show the pack; duplicates just aren't detected.
      setStatus('import-status', 'Couldn’t load your recipes, so duplicates are not checked.', 'error');
    }
    if (destroyed) return;
    state.plan = planImport(read, state.recipes ?? []);
    state.include = new Set(state.plan.items.filter((i) => IMPORTABLE.has(i.status)).map((i) => i.index));
    renderImport();
    renderShare();
  }
  function renderImport() {
    $('plan').innerHTML = state.plan ? renderPlan(state.plan, { include: state.include, canImport, busy: state.busy }) : '';
  }
  async function openFile(file) {
    if (!file) return;
    if (file.size > MAX_PACK_CHARS * 4) {
      state.plan = null;
      renderImport();
      return setStatus('import-status', 'That file is far too large to be a recipe pack.', 'error');
    }
    await showRead(readPack(await file.text()));
  }
  async function doImport() {
    if (!state.read || state.busy) return;
    state.busy = true;
    renderImport();
    try {
      const res = await fetchFn(`${options.apiBase ?? ''}/api/packs/import`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ pack: packFromRead(state.read), include: [...state.include] }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setStatus('import-status', body.error ?? `Import failed (HTTP ${res.status}).`, 'error');
        return;
      }
      const created = Array.isArray(body.created) ? body.created : [];
      setStatus('import-status', created.length
        ? `Imported ${plural(created.length, 'recipe')}: ${created.join(', ')}.`
        : 'Nothing was imported; those recipes are already in your bank.', created.length ? 'ok' : '');
      state.recipes = null; // reload so the plan shows the new recipes as already in the bank
      options.onImported?.(created);
      state.busy = false;
      await showRead(state.read);
    } catch {
      setStatus('import-status', 'The Recipe Bank server is not reachable. Is `npm start` running?', 'error');
    } finally {
      state.busy = false;
      if (!destroyed) renderImport();
    }
  }
  function fromHash() {
    if (options.readHash === false || !hasPackLink(win.location.hash)) return;
    showRead(packFromLink(win.location.hash));
  }

  // ----- events -----
  on(element, 'input', (e) => {
    if (e.target === $('q')) {
      state.q = e.target.value;
      renderShare();
    }
  });
  on(element, 'change', (e) => {
    const t = e.target;
    if (t.dataset.pick != null) {
      t.checked ? state.picked.add(t.dataset.pick) : state.picked.delete(t.dataset.pick);
      renderShare();
    } else if (t.dataset.include != null) {
      const i = Number(t.dataset.include);
      t.checked ? state.include.add(i) : state.include.delete(i);
      renderImport();
    } else if (t === $('file')) {
      openFile(t.files?.[0]).catch(() => setStatus('import-status', 'Couldn’t read that file.', 'error'));
    }
  });
  on(element, 'click', (e) => {
    const btn = e.target.closest?.('[data-act]');
    const act = btn && element.contains(btn) ? btn.dataset.act : null;
    if (act === 'all') {
      for (const box of element.querySelectorAll('[data-pick]')) state.picked.add(box.dataset.pick);
      renderShare();
    } else if (act === 'none') {
      state.picked.clear();
      renderShare();
    } else if (act === 'download') shareAction(download)();
    else if (act === 'link') shareAction(copyLink)();
    else if (act === 'import') doImport();
  });
  on(element, 'submit', (e) => {
    if (e.target !== $('link-form')) return;
    e.preventDefault();
    const value = $('link').value;
    if (value.trim()) showRead(packFromLink(value));
  });
  on(win, 'hashchange', fromHash);

  ensureRecipes()
    .then(() => { if (!destroyed) renderShare(); })
    .catch(() => {
      if (!destroyed) $('pick').innerHTML = '<li class="pk-empty">Couldn’t load the recipes.</li>';
    });
  fromHash();

  return {
    destroy() {
      destroyed = true;
      ac.abort();
      element.innerHTML = '';
      element.classList.remove('rb-packs');
    },
  };
}
