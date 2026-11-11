// Recipe editor: a self-contained form that writes recipes/<id>.json through the contract in lib/recipe.mjs.
//
//   import { mount } from '/features/recipe-editor.mjs';
//   const editor = mount(element, { recipe, video, readOnly, recipes });
//   editor.destroy();
//
// recipe    an existing recipe to edit (PUT /api/recipes/<id>); leave out to create one (POST /api/recipes)
// video     for a new recipe: a video URL, a parsed video or a queue entry (fills video, title and creator)
// readOnly  no saving, a "Download JSON" button instead (default: true on the static build)
// recipes   the bank's recipes, if the host already has them; otherwise the editor fetches /api/recipes
//
// Emits `recipe-bank:recipe-saved` ({ id, created, recipe, dequeued }) and `recipe-bank:editor-cancel`
// ({ id, dirty }) on `element`; both bubble. See public/features/EDITOR.md.

import {
  emptyDraft, draftFromRecipe, recipeFromDraft, checkDraft, slugify, parseTimestamp, formatRecipe,
  emptyIngredient, emptyStep, emptyComponent, problemField, BASES, STATUSES,
} from '/lib/draft.mjs';
import { parseVideoUrl, videoKey, embedUrl } from '/lib/video.mjs';

const STATIC = typeof document !== 'undefined' && document.documentElement.dataset.static === '1';
const PLATFORM = { youtube: 'YouTube', tiktok: 'TikTok', instagram: 'Instagram' };
const BASIS_LABEL = {
  'on-screen': 'shown on screen',
  spoken: 'said in the video',
  description: 'from the video description',
  unstated: 'amount not given',
};
const STATUS_LABEL = { analyzed: 'Full recipe', partial: 'Partial recipe' };
const NUTRIENTS = [['calories', 'Calories (kcal)'], ['protein_g', 'Protein (g)'], ['carbs_g', 'Carbs (g)'], ['fat_g', 'Fat (g)']];

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function ensureStyles() {
  if (document.querySelector('link[data-recipe-editor-css]')) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = new URL('./recipe-editor.css', import.meta.url).href;
  link.dataset.recipeEditorCss = '';
  document.head.append(link);
}

const FORBIDDEN = new Set(['__proto__', 'prototype', 'constructor']);
const key = (k) => (/^\d+$/.test(k) ? Number(k) : k);

/** Sets draft fields by their data-path ("components.0.ingredients.2.amount"). */
function setPath(obj, path, value) {
  const keys = path.split('.');
  if (keys.some((k) => FORBIDDEN.has(k))) return;
  let o = obj;
  for (const k of keys.slice(0, -1)) o = o?.[key(k)];
  if (o && typeof o === 'object') o[key(keys.at(-1))] = value;
}

/** Mounts the editor into `element`. Returns { destroy(), isDirty(), getRecipe() }. */
export function mount(element, { recipe, video, readOnly = STATIC, recipes } = {}) {
  ensureStyles();
  const uid = `re${Math.random().toString(36).slice(2, 8)}`;
  const aborter = new AbortController();
  let draft = recipe ? draftFromRecipe(recipe) : emptyDraft(video);
  let editing = Boolean(recipe);
  let idAuto = !editing && !draft.id;
  if (idAuto && draft.title.trim()) draft.id = slugify(draft.title); // a queue entry brings a title
  let bank = { ids: new Set(), videos: new Map(), keys: [] };
  let baseline = formatRecipe(recipeFromDraft(draft));
  let lastRemoved = null;
  let serverProblems = [];
  let saving = false;
  let frame = 0;
  let playFrom = null;
  let destroyed = false;

  const root = document.createElement('div');
  root.className = 're';
  root.innerHTML = `
    <div class="re-body"></div>
    <div class="re-footer">
      <section class="re-problems" aria-labelledby="${uid}-ph" tabindex="-1">
        <h3 id="${uid}-ph" class="re-problems-head"></h3>
        <ul class="re-problem-list"></ul>
      </section>
      <details class="re-preview">
        <summary>JSON preview</summary>
        <pre class="re-json" tabindex="0" aria-label="Recipe file preview"></pre>
      </details>
      <div class="re-actions">
        <p class="re-status" role="status" aria-live="polite"></p>
        <div class="re-buttons">
          <button type="button" class="re-btn re-quiet" data-action="undo" hidden>Undo</button>
          <button type="button" class="re-btn re-quiet" data-action="cancel">Cancel</button>
          <button type="button" class="re-btn re-quiet" data-action="copy">Copy JSON</button>
          <button type="button" class="re-btn ${readOnly ? 're-primary' : 're-quiet'}" data-action="download">Download JSON</button>
          ${readOnly ? '' : '<button type="button" class="re-btn re-primary" data-action="save">Save recipe</button>'}
        </div>
      </div>
    </div>`;
  element.append(root);
  const $ = (sel) => root.querySelector(sel);
  const body = $('.re-body');

  // ---------- data from the bank ----------

  function useBank(list) {
    const ids = new Set();
    const videos = new Map();
    const counts = new Map();
    for (const r of list ?? []) {
      if (!r || typeof r !== 'object') continue;
      ids.add(r.id);
      videos.set(videoKey(r.video), r.id);
      for (const c of r.components ?? []) for (const i of c.ingredients ?? []) if (i?.key) counts.set(i.key, (counts.get(i.key) ?? 0) + 1);
    }
    bank = { ids, videos, keys: [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([k]) => k) };
    // Update in place: a full render here would take focus away from someone already typing.
    const datalist = body.querySelector(`#${uid}-keys`);
    if (datalist) datalist.innerHTML = keyOptions();
    if (idAuto) {
      draft.id = draft.title.trim() ? slugify(draft.title, bank.ids) : '';
      const idEl = body.querySelector('[data-path="id"]');
      if (idEl) idEl.value = draft.id;
    }
    refresh();
  }

  const keyOptions = () => bank.keys.map((k) => `<option value="${esc(k)}"></option>`).join('');

  if (Array.isArray(recipes)) {
    queueMicrotask(() => !destroyed && useBank(recipes));
  } else {
    fetch(STATIC ? '/api/recipes.json' : '/api/recipes', { signal: aborter.signal })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
      .then((j) => !destroyed && useBank(j.recipes))
      .catch((e) => {
        if (destroyed || e.name === 'AbortError') return;
        setStatus('Could not load the other recipes: key suggestions and duplicate checks are off.');
      });
  }

  // ---------- rendering ----------

  const field = (label, control, hint = '') =>
    `<label class="re-field"><span class="re-label">${label}</span>${control}${hint ? `<span class="re-hint">${hint}</span>` : ''}</label>`;

  const input = (path, value, attrs = '') =>
    `<input class="re-input" data-path="${path}" value="${esc(value)}" ${attrs}>`;

  const tools = (kind, c, i, n, label) => `
    <div class="re-tools" role="group" aria-label="${esc(label)}">
      <button type="button" class="re-icon" data-action="move-${kind}" data-dir="-1" data-c="${c}" data-i="${i}"
        aria-label="Move ${esc(label)} up" ${i === 0 ? 'disabled' : ''}>↑</button>
      <button type="button" class="re-icon" data-action="move-${kind}" data-dir="1" data-c="${c}" data-i="${i}"
        aria-label="Move ${esc(label)} down" ${i === n - 1 ? 'disabled' : ''}>↓</button>
      <button type="button" class="re-icon re-danger" data-action="remove-${kind}" data-c="${c}" data-i="${i}"
        aria-label="Remove ${esc(label)}">✕</button>
    </div>`;

  function basisSelect(path, value, label) {
    const opts = [...BASES];
    if (value && !opts.includes(value)) opts.push(value);
    return `<select class="re-input" data-path="${path}" aria-label="${esc(label)}">${opts
      .map((b) => `<option value="${esc(b)}" ${b === value ? 'selected' : ''}>${esc(BASIS_LABEL[b] ?? b)}</option>`)
      .join('')}</select>`;
  }

  function ingredientView(ing, c, i, n) {
    const p = `components.${c}.ingredients.${i}`;
    const name = `ingredient ${i + 1}`;
    return `
      <li class="re-row">
        <div class="re-ing">
          ${field('Ingredient', input(`${p}.item`, ing.item, `aria-label="Ingredient ${i + 1}" placeholder="e.g. Skin-on chicken thighs"`))}
          ${field('Filter key', input(`${p}.key`, ing.key, `aria-label="Ingredient ${i + 1} filter key" list="${uid}-keys" autocomplete="off" autocapitalize="none" placeholder="e.g. chicken"`))}
          ${field('Amount', input(`${p}.amount`, ing.amount, `aria-label="Ingredient ${i + 1} amount" placeholder="amount not given"`))}
          ${field('Where the amount comes from', basisSelect(`${p}.basis`, ing.basis, `Ingredient ${i + 1}: where the amount comes from`))}
          ${field('Note <span class="re-opt">(optional)</span>', input(`${p}.note`, ing.note, `aria-label="Ingredient ${i + 1} note"`))}
        </div>
        ${tools('ingredient', c, i, n, name)}
      </li>`;
  }

  function stepView(s, c, i, n) {
    const p = `components.${c}.steps.${i}`;
    const t = parseTimestamp(s.t);
    return `
      <li class="re-row">
        <div class="re-step">
          ${field(`Step ${i + 1}`, `<textarea class="re-input" rows="2" data-path="${p}.text" aria-label="Step ${i + 1}">${esc(s.text)}</textarea>`)}
          <div class="re-time">
            ${field('Time in video', input(`${p}.t`, s.t, `aria-label="Step ${i + 1} time in video" autocomplete="off" placeholder="m:ss" size="7"`))}
            <button type="button" class="re-icon" data-action="play" data-c="${c}" data-i="${i}"
              aria-label="Play the video from step ${i + 1}" ${t == null || Number.isNaN(t) ? 'disabled' : ''}>▶</button>
          </div>
        </div>
        ${tools('step', c, i, n, `step ${i + 1}`)}
      </li>`;
  }

  function componentView(comp, c, n) {
    const label = `part ${c + 1}`;
    return `
      <section class="re-part" aria-labelledby="${uid}-c${c}">
        <div class="re-part-head">
          <h4 id="${uid}-c${c}">Part ${c + 1}${comp.name.trim() ? `: ${esc(comp.name)}` : ''}</h4>
          ${tools('component', c, c, n, label)}
        </div>
        ${field('Part name', input(`components.${c}.name`, comp.name, `aria-label="Part ${c + 1} name" placeholder="e.g. Chicken, Pan sauce, To serve"`))}
        <h5>Ingredients</h5>
        <ol class="re-list">${comp.ingredients.map((x, i) => ingredientView(x, c, i, comp.ingredients.length)).join('')}</ol>
        <button type="button" class="re-btn re-quiet re-add" data-action="add-ingredient" data-c="${c}">Add an ingredient</button>
        <h5>Steps</h5>
        <ol class="re-list">${comp.steps.map((x, i) => stepView(x, c, i, comp.steps.length)).join('')}</ol>
        <button type="button" class="re-btn re-quiet re-add" data-action="add-step" data-c="${c}">Add a step</button>
      </section>`;
  }

  function listView(kind, items, label, placeholder) {
    return `
      <ol class="re-list">${items.map((v, i) => `
        <li class="re-row">
          ${field(`${label} ${i + 1}`, `<textarea class="re-input" rows="2" data-path="${kind}.${i}" placeholder="${esc(placeholder)}">${esc(v)}</textarea>`)}
          <div class="re-tools"><button type="button" class="re-icon re-danger" data-action="remove-${kind}" data-i="${i}"
            aria-label="Remove ${esc(label.toLowerCase())} ${i + 1}">✕</button></div>
        </li>`).join('')}</ol>
      <button type="button" class="re-btn re-quiet re-add" data-action="add-${kind}" data-focus-for="${kind}">Add ${esc(label.toLowerCase())}</button>`;
  }

  function nutritionView() {
    const nu = draft.nutrition;
    if (!nu) {
      return `<p class="re-hint">Only add nutrition the creator states (on screen, spoken or in the description).</p>
        <button type="button" class="re-btn re-quiet re-add" data-action="add-nutrition">Add nutrition</button>`;
    }
    const bases = BASES.filter((b) => b !== 'unstated');
    if (nu.basis && !bases.includes(nu.basis)) bases.push(nu.basis);
    return `
      <div class="re-grid">
        ${field('Per', input('nutrition.per', nu.per, 'placeholder="e.g. serving, roll, wrap"'))}
        ${field('Source', `<select class="re-input" data-path="nutrition.basis">${['', ...bases].map((b) =>
          `<option value="${esc(b)}" ${b === nu.basis ? 'selected' : ''}>${esc(b ? BASIS_LABEL[b] ?? b : 'choose…')}</option>`).join('')}</select>`)}
        ${NUTRIENTS.map(([k, l]) => field(l, input(`nutrition.${k}`, nu[k], 'inputmode="decimal" size="6"'))).join('')}
      </div>
      ${field('Note <span class="re-opt">(optional)</span>', input('nutrition.note', nu.note, 'placeholder="e.g. creator-reported, not verified"'))}
      <button type="button" class="re-btn re-quiet re-add" data-action="remove-nutrition">Remove nutrition</button>`;
  }

  function videoHint() {
    const url = draft.video.url.trim();
    if (!url) return '';
    const v = parseVideoUrl(url);
    return v ? `✓ ${PLATFORM[v.platform]} video` : 'Not a supported video link yet';
  }

  function view() {
    const d = draft;
    return `
      <header class="re-head">
        <h2>${editing ? 'Edit recipe' : 'New recipe'}</h2>
        <p class="re-lede">Write amounts exactly as the creator gave them (“1 can”, “about 1 cup”). Leave an amount
          blank when the video doesn't say: the recipe then shows “amount not given”. Steps come from the video only.</p>
        ${readOnly ? `<p class="re-callout">This copy of Recipe Bank can't save. Fill in the form, download the JSON
          and add it to <code>recipes/</code> in your local copy.</p>` : ''}
      </header>
      <datalist id="${uid}-keys">${keyOptions()}</datalist>

      <fieldset class="re-section">
        <legend>Video</legend>
        ${field('Video link', input('video.url', d.video.url, 'type="url" inputmode="url" autocomplete="off" placeholder="https://www.youtube.com/shorts/…"'),
          `<span class="re-detect" data-video-hint>${esc(videoHint())}</span>`)}
        <details class="re-player" data-player>
          <summary>Watch the video while you write</summary>
          <div class="re-frame" data-frame></div>
        </details>
      </fieldset>

      <fieldset class="re-section">
        <legend>About the recipe</legend>
        ${field('Title', input('title', d.title, 'placeholder="e.g. Gochujang Chicken Thighs"'))}
        ${field('Id', input('id', d.id, `autocomplete="off" autocapitalize="none" spellcheck="false" ${editing ? 'readonly aria-readonly="true"' : ''}`),
          editing ? 'The id is the file name and can\'t change here.' : `File name: <code data-id-file>recipes/${esc(d.id || '…')}.json</code>. Filled in from the title until you change it.`)}
        ${field('Status', `<select class="re-input" data-path="status">${[...new Set([...STATUSES, d.status].filter(Boolean))].map((s) =>
          `<option value="${esc(s)}" ${s === d.status ? 'selected' : ''}>${esc(STATUS_LABEL[s] ?? s)}</option>`).join('')}</select>`,
          '<b>Partial</b> means part of the method or amounts can\'t be taken from the video. List what is missing under “What the video doesn\'t say”: a partial recipe needs at least one entry there.')}
        ${field('Summary', `<textarea class="re-input" rows="3" data-path="summary" placeholder="1–2 plain sentences">${esc(d.summary)}</textarea>`)}
        <div class="re-grid">
          ${field('Makes <span class="re-opt">(as stated)</span>', input('serves', d.serves, 'placeholder="e.g. 2 thighs per person"'))}
          ${field('Posted on <span class="re-opt">(optional)</span>', input('uploaded', d.uploaded, 'type="date"'))}
          ${field('Analyzed on', input('analyzed', d.analyzed, 'type="date"'))}
        </div>
        ${field('Tags', input('tags', d.tags.map((t) => t.trim()).filter(Boolean).join(', '),'autocapitalize="none" placeholder="chicken, dinner, air fryer"'), 'Lowercase, separated by commas.')}
      </fieldset>

      <fieldset class="re-section">
        <legend>Creator</legend>
        <div class="re-grid">
          ${field('Name', input('creator.name', d.creator.name, 'autocomplete="off"'))}
          ${field('Handle <span class="re-opt">(optional)</span>', input('creator.handle', d.creator.handle, 'autocomplete="off" autocapitalize="none" placeholder="@name"'))}
          ${field('Profile link <span class="re-opt">(optional)</span>', input('creator.url', d.creator.url, 'type="url" inputmode="url" autocomplete="off"'))}
        </div>
      </fieldset>

      <section class="re-section" aria-labelledby="${uid}-parts">
        <h3 id="${uid}-parts">Ingredients and steps</h3>
        <p class="re-hint">Split the recipe into parts when the video does, for example Chicken, Pan sauce and To serve.
          The filter key is what you'd shop for: lowercase and singular (<code>chicken</code>, not <code>skin-on chicken thighs</code>);
          pick an existing key where one fits. Times are <code>m:ss</code> or seconds into the video.</p>
        ${d.components.map((c, i) => componentView(c, i, d.components.length)).join('')}
        <button type="button" class="re-btn re-quiet re-add" data-action="add-component">Add a part</button>
      </section>

      <section class="re-section" aria-labelledby="${uid}-nut">
        <h3 id="${uid}-nut">Nutrition</h3>
        ${nutritionView()}
      </section>

      <section class="re-section" aria-labelledby="${uid}-gaps">
        <h3 id="${uid}-gaps">What the video doesn't say</h3>
        <p class="re-hint">Amounts, times or steps the video leaves out. Required when the status is Partial.</p>
        ${listView('gaps', d.gaps, 'Gap', 'e.g. The oven temperature isn\'t given.')}
      </section>

      <section class="re-section" aria-labelledby="${uid}-notes">
        <h3 id="${uid}-notes">Notes</h3>
        ${listView('notes', d.notes, 'Note', 'e.g. A remake: the description credits the original creator.')}
      </section>

      <fieldset class="re-section">
        <legend>Source</legend>
        ${field('What was checked <span class="re-opt">(optional)</span>', input('source.evidence', d.source.evidence, 'placeholder="e.g. YouTube captions + video description"'))}
        ${field('Where the amounts come from <span class="re-opt">(optional)</span>', input('source.quantity_basis', d.source.quantity_basis, 'placeholder="e.g. Spoken only; nothing on screen."'))}
      </fieldset>`;
  }

  function render(focus) {
    if (destroyed) return;
    body.innerHTML = view();
    body.querySelector('[data-player]')?.addEventListener('toggle', (e) => {
      if (e.target.open) loadPlayer(playFrom ?? 0, playFrom != null);
      else e.target.querySelector('[data-frame]').innerHTML = '';
      playFrom = null;
    });
    refresh();
    if (focus) {
      const el = root.querySelector(focus);
      if (el && !el.disabled) el.focus();
    }
  }

  // ---------- live parts: problems, preview, hints ----------

  function problems() {
    return checkDraft(draft, { existingIds: bank.ids, existingVideoKeys: bank.videos });
  }

  const FIELD_NAME = { item: 'ingredient', key: 'filter key', amount: 'amount', basis: 'basis', note: 'note', text: 'text', t: 'time' };

  function describe(p, r) {
    const head = p.split(' ')[0];
    const rest = p.slice(head.length + 1);
    let m = head.match(/^components\[(\d+)\]\.(ingredients|steps)\[(\d+)\]\.(\w+)$/);
    if (m) {
      const c = r.components?.[Number(m[1])];
      const row = c?.[m[2]]?.[Number(m[3])];
      const part = c?.name || `Part ${Number(m[1]) + 1}`;
      const what = m[2] === 'ingredients'
        ? `ingredient ${Number(m[3]) + 1}${row?.item ? ` (${row.item})` : ''}`
        : `step ${Number(m[3]) + 1}`;
      return `${part} › ${what}: ${FIELD_NAME[m[4]] ?? m[4]} ${rest}`;
    }
    m = head.match(/^components\[(\d+)\]\.(\w+)$/);
    if (m) return `Part ${Number(m[1]) + 1}: ${m[2]} ${rest}`;
    return p;
  }

  function refresh() {
    if (destroyed) return;
    const r = recipeFromDraft(draft);
    const list = problems();
    const shown = [...list, ...serverProblems.filter((p) => !list.includes(p))];
    $('.re-problems-head').textContent = shown.length
      ? `${shown.length} ${shown.length === 1 ? 'thing' : 'things'} to fix before ${readOnly ? 'downloading' : 'saving'}`
      : 'Ready: the recipe matches the contract.';
    $('.re-problems').classList.toggle('re-ok', !shown.length);
    $('.re-problem-list').innerHTML = shown.map((p) => {
      const path = problemField(p, draft);
      return `<li>${path
        ? `<button type="button" class="re-problem" data-action="focus" data-path-target="${esc(path)}">${esc(describe(p, r))}</button>`
        : `<span class="re-problem">${esc(describe(p, r))}</span>`}</li>`;
    }).join('');
    $('.re-json').textContent = formatRecipe(r);
    const hint = body.querySelector('[data-video-hint]');
    if (hint) hint.textContent = videoHint();
    const file = body.querySelector('[data-id-file]');
    if (file) file.textContent = `recipes/${r.id || '…'}.json`;
    const undo = $('[data-action="undo"]');
    undo.hidden = !lastRemoved;
    undo.textContent = lastRemoved ? `Undo: remove ${lastRemoved.label}` : 'Undo';
    const save = $('[data-action="save"]');
    if (save) save.disabled = saving;
  }

  function schedule() {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      refresh();
    });
  }

  function setStatus(msg, html = false) {
    const el = $('.re-status');
    if (!el) return;
    if (html) el.innerHTML = msg;
    else el.textContent = msg;
  }

  // ---------- player ----------

  function loadPlayer(start, autoplay) {
    const box = body.querySelector('[data-frame]');
    if (!box) return;
    const v = parseVideoUrl(draft.video.url);
    const src = v && embedUrl(v, { start, autoplay });
    box.innerHTML = src
      ? `<iframe src="${esc(src)}" title="Recipe video" loading="lazy"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
          referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe>`
      : `<p class="re-hint">${v ? 'This link can\'t be embedded.' : 'Add a supported video link first.'}</p>`;
  }

  // ---------- input ----------

  function onInput(e) {
    const el = e.target.closest('[data-path]');
    if (!el || !root.contains(el)) return;
    const path = el.dataset.path;
    serverProblems = [];
    if (path === 'tags') {
      draft.tags = el.value.split(',');
    } else {
      setPath(draft, path, el.value);
    }
    if (path === 'title' && idAuto) {
      draft.id = draft.title.trim() ? slugify(draft.title, bank.ids) : '';
      const idEl = body.querySelector('[data-path="id"]');
      if (idEl) idEl.value = draft.id;
    }
    if (path === 'id' && !editing) idAuto = el.value.trim() === '';
    if (/^components\.\d+\.ingredients\.\d+\.amount$/.test(path) && el.value.trim() === '') {
      // A blank amount is "not given": keep the basis picker honest.
      const basisPath = path.replace(/amount$/, 'basis');
      setPath(draft, basisPath, 'unstated');
      const sel = body.querySelector(`[data-path="${basisPath}"]`);
      if (sel) sel.value = 'unstated';
    }
    if (/^components\.\d+\.steps\.\d+\.t$/.test(path)) {
      const t = parseTimestamp(el.value);
      const play = el.closest('.re-time')?.querySelector('[data-action="play"]');
      if (play) play.disabled = t == null || Number.isNaN(t);
    }
    if (/^components\.\d+\.name$/.test(path)) {
      const c = Number(path.split('.')[1]);
      const h = body.querySelector(`#${uid}-c${c}`);
      if (h) h.textContent = `Part ${c + 1}${el.value.trim() ? `: ${el.value}` : ''}`;
    }
    if (path === 'video.url') {
      const player = body.querySelector('[data-player]');
      if (player?.open) loadPlayer(0, false);
    }
    schedule();
  }

  // ---------- actions ----------

  const move = (list, i, dir) => {
    const j = i + dir;
    if (j < 0 || j >= list.length) return i;
    [list[i], list[j]] = [list[j], list[i]];
    return j;
  };

  function remove(kind, list, i, label, c) {
    const [value] = list.splice(i, 1);
    lastRemoved = { kind, c, i, value, label };
    setStatus(`Removed ${label}.`);
  }

  function onClick(e) {
    const btn = e.target.closest('[data-action]');
    if (!btn || !root.contains(btn) || btn.disabled) return;
    const a = btn.dataset.action;
    const c = Number(btn.dataset.c);
    const i = Number(btn.dataset.i);
    const comp = draft.components[c];
    const structural = (focus) => {
      serverProblems = [];
      render(focus);
    };
    switch (a) {
      case 'add-component': {
        lastRemoved = null;
        draft.components.push(emptyComponent());
        return structural(`[data-path="components.${draft.components.length - 1}.name"]`);
      }
      case 'remove-component': {
        remove('component', draft.components, c, `part ${c + 1}${comp.name.trim() ? ` (${comp.name.trim()})` : ''}`);
        const next = Math.min(c, draft.components.length - 1);
        return structural(next >= 0 ? `[data-path="components.${next}.name"]` : '[data-action="add-component"]');
      }
      case 'move-component': {
        lastRemoved = null;
        const j = move(draft.components, c, Number(btn.dataset.dir));
        return structural(`[data-action="move-component"][data-dir="${btn.dataset.dir}"][data-c="${j}"]`);
      }
      case 'add-ingredient': {
        lastRemoved = null;
        comp.ingredients.push(emptyIngredient());
        return structural(`[data-path="components.${c}.ingredients.${comp.ingredients.length - 1}.item"]`);
      }
      case 'remove-ingredient': {
        const item = comp.ingredients[i].item.trim();
        remove('ingredient', comp.ingredients, i, `ingredient ${i + 1}${item ? ` (${item})` : ''}`, c);
        const next = Math.min(i, comp.ingredients.length - 1);
        return structural(next >= 0 ? `[data-path="components.${c}.ingredients.${next}.item"]` : `[data-action="add-ingredient"][data-c="${c}"]`);
      }
      case 'move-ingredient': {
        lastRemoved = null;
        const j = move(comp.ingredients, i, Number(btn.dataset.dir));
        return structural(`[data-action="move-ingredient"][data-dir="${btn.dataset.dir}"][data-c="${c}"][data-i="${j}"]`);
      }
      case 'add-step': {
        lastRemoved = null;
        comp.steps.push(emptyStep());
        return structural(`[data-path="components.${c}.steps.${comp.steps.length - 1}.text"]`);
      }
      case 'remove-step': {
        remove('step', comp.steps, i, `step ${i + 1}`, c);
        const next = Math.min(i, comp.steps.length - 1);
        return structural(next >= 0 ? `[data-path="components.${c}.steps.${next}.text"]` : `[data-action="add-step"][data-c="${c}"]`);
      }
      case 'move-step': {
        lastRemoved = null;
        const j = move(comp.steps, i, Number(btn.dataset.dir));
        return structural(`[data-action="move-step"][data-dir="${btn.dataset.dir}"][data-c="${c}"][data-i="${j}"]`);
      }
      case 'add-gaps':
      case 'add-notes': {
        const kind = a.slice(4);
        draft[kind].push('');
        return structural(`[data-path="${kind}.${draft[kind].length - 1}"]`);
      }
      case 'remove-gaps':
      case 'remove-notes': {
        const kind = a.slice(7);
        remove(kind, draft[kind], i, `${kind === 'gaps' ? 'gap' : 'note'} ${i + 1}`);
        const next = Math.min(i, draft[kind].length - 1);
        return structural(next >= 0 ? `[data-path="${kind}.${next}"]` : `[data-action="add-${kind}"]`);
      }
      case 'add-nutrition': {
        draft.nutrition = { per: '', basis: 'description', calories: '', protein_g: '', carbs_g: '', fat_g: '', note: '', extra: {}, blank: {} };
        return structural('[data-path="nutrition.per"]');
      }
      case 'remove-nutrition': {
        draft.nutrition = null;
        return structural('[data-action="add-nutrition"]');
      }
      case 'undo':
        return undo();
      case 'play': {
        const t = parseTimestamp(comp.steps[i].t);
        const player = body.querySelector('[data-player]');
        if (!player || t == null || Number.isNaN(t)) return;
        if (player.open) {
          loadPlayer(t, true);
        } else {
          playFrom = t; // the toggle handler loads the player from here
          player.open = true;
        }
        player.scrollIntoView({ block: 'nearest' });
        return;
      }
      case 'focus': {
        const target = btn.dataset.pathTarget;
        const el = body.querySelector(`[data-path="${CSS.escape(target)}"]`) ??
          body.querySelector(`[data-path^="${CSS.escape(target)}."]`) ??
          body.querySelector(`[data-focus-for="${CSS.escape(target)}"]`);
        el?.focus();
        return;
      }
      case 'copy':
        return copyJson();
      case 'download':
        return download();
      case 'save':
        return save();
      case 'cancel':
        element.dispatchEvent(new CustomEvent('recipe-bank:editor-cancel', {
          bubbles: true, detail: { id: editing ? draft.original?.id ?? draft.id : null, dirty: isDirty() },
        }));
        return;
      default:
    }
  }

  function undo() {
    const u = lastRemoved;
    if (!u) return;
    lastRemoved = null;
    let focus;
    if (u.kind === 'component') {
      draft.components.splice(Math.min(u.i, draft.components.length), 0, u.value);
      focus = `[data-path="components.${u.i}.name"]`;
    } else if (u.kind === 'ingredient' || u.kind === 'step') {
      const list = draft.components[u.c]?.[u.kind === 'ingredient' ? 'ingredients' : 'steps'];
      if (!list) return refresh();
      list.splice(Math.min(u.i, list.length), 0, u.value);
      focus = `[data-path="components.${u.c}.${u.kind === 'ingredient' ? 'ingredients' : 'steps'}.${u.i}.${u.kind === 'ingredient' ? 'item' : 'text'}"]`;
    } else {
      draft[u.kind].splice(Math.min(u.i, draft[u.kind].length), 0, u.value);
      focus = `[data-path="${u.kind}.${u.i}"]`;
    }
    setStatus(`Restored ${u.label}.`);
    render(focus);
  }

  // ---------- output ----------

  function isDirty() {
    return formatRecipe(recipeFromDraft(draft)) !== baseline;
  }

  async function copyJson() {
    try {
      await navigator.clipboard.writeText(formatRecipe(recipeFromDraft(draft)));
      setStatus('JSON copied.');
    } catch {
      $('.re-preview').open = true;
      $('.re-json').focus();
      setStatus('Copying is blocked here: the JSON is shown below the problems; select and copy it.');
    }
  }

  function download() {
    const r = recipeFromDraft(draft);
    const n = problems().length;
    const url = URL.createObjectURL(new Blob([formatRecipe(r)], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `${r.id || 'recipe'}.json`;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setStatus(n ? `Downloaded ${a.download}. It still has ${n} problem${n === 1 ? '' : 's'}: npm run validate will list them.` : `Downloaded ${a.download}.`);
  }

  async function save() {
    if (saving || readOnly) return;
    const list = problems();
    if (list.length) {
      setStatus(`Fix ${list.length} ${list.length === 1 ? 'problem' : 'problems'} first.`);
      $('.re-problems').focus();
      return;
    }
    const r = recipeFromDraft(draft);
    const created = !editing;
    saving = true;
    refresh();
    setStatus('Saving…');
    try {
      const res = await fetch(created ? '/api/recipes' : `/api/recipes/${encodeURIComponent(draft.original.id)}`, {
        method: created ? 'POST' : 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(r),
        signal: aborter.signal,
      });
      const j = await res.json().catch(() => ({}));
      if (destroyed) return;
      if (res.ok) {
        const saved = j.recipe ?? r;
        draft = draftFromRecipe(saved);
        editing = true;
        idAuto = false;
        baseline = formatRecipe(recipeFromDraft(draft));
        bank.ids.add(saved.id);
        bank.videos.set(videoKey(saved.video), saved.id);
        lastRemoved = null;
        saving = false;
        render();
        setStatus(`Saved recipes/${saved.id}.json.`);
        element.dispatchEvent(new CustomEvent('recipe-bank:recipe-saved', {
          bubbles: true, detail: { id: saved.id, created, recipe: saved, dequeued: j.dequeued ?? [] },
        }));
        return;
      }
      if (res.status === 400 && Array.isArray(j.problems)) {
        serverProblems = j.problems;
        setStatus(j.error ?? 'The server found problems.');
        $('.re-problems').focus();
      } else if (res.status === 409 && j.recipeId) {
        setStatus(`${esc(j.error ?? 'Already in the bank.')} <a href="#/r/${encodeURIComponent(j.recipeId)}">Open ${esc(j.recipeId)}</a>`, true);
      } else {
        setStatus(j.error ?? `Could not save (HTTP ${res.status}).`);
      }
    } catch (e) {
      if (destroyed || e.name === 'AbortError') return;
      setStatus('The Recipe Bank server is not reachable. Is `npm start` running?');
    } finally {
      saving = false;
      if (!destroyed) refresh();
    }
  }

  // ---------- lifecycle ----------

  root.addEventListener('input', onInput);
  root.addEventListener('click', onClick);
  render();

  return {
    destroy() {
      if (destroyed) return;
      destroyed = true;
      aborter.abort();
      if (frame) cancelAnimationFrame(frame);
      root.removeEventListener('input', onInput);
      root.removeEventListener('click', onClick);
      root.remove();
    },
    isDirty,
    getRecipe: () => recipeFromDraft(draft),
  };
}
