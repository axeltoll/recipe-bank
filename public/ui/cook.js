// Cook mode: one step at a time in large type, in a full-window <dialog>, laid out for a phone held in one hand.
// Everything pressed while cooking (ingredients, watch this step, timers, Back, Next) is at the bottom; the top
// bar holds the two things pressed once: the "Keep screen on" switch and Exit.
import { flattenSteps, withShownAmounts } from '/lib/catalog.mjs';
import { clampIndex } from '/lib/nav.mjs';
import { esc, mmss } from '/lib/format.mjs';
import { $, $$, store, emit, icon, timerChips, paintTimers } from './core.js';

const WAKE_KEY = 'rb:wake'; // false = the reader switched "Keep screen on" off; anything else = on
const dlg = $('#cook');
let session = null; // { recipe, steps, index, checked, amounts, onCheck, onWatch, canWatch, returnFocus, pendingWatch }
let wakeLock = null;
let wakeWanted = store.get(WAKE_KEY, true) !== false;

/**
 * Open cook mode for a recipe.
 * opts: { checked: Set of "ci.ii" keys shared with the page, onCheck(key, on),
 *         amounts: Map of "ci.ii" → the amount the page shows when a feature scaled it, canWatch, onWatch(seconds), returnFocus }
 */
export function openCook(recipe, opts = {}) {
  const steps = flattenSteps(recipe);
  if (!dlg || !steps.length || session) return;
  session = {
    recipe,
    steps,
    index: clampIndex(store.get(`rb:cook:${recipe.id}`, 0), steps.length),
    checked: opts.checked ?? new Set(),
    amounts: opts.amounts ?? new Map(),
    onCheck: opts.onCheck,
    onWatch: opts.onWatch,
    canWatch: Boolean(opts.canWatch),
    returnFocus: opts.returnFocus ?? null,
    pendingWatch: null,
  };
  renderShell();
  renderStep();
  dlg.showModal();
  $('#cook-next').focus();
  requestWake();
  emit('cook', { recipe, open: true, root: dlg });
}

/** Close cook mode if it is open (the router calls this on every route change). */
export function closeCook() {
  if (dlg?.open) dlg.close();
}

function renderShell() {
  const { recipe, steps, checked, amounts } = session;
  // The same .ing-amt hooks as the recipe page; a scaled amount there is the scaled amount here.
  const shown = withShownAmounts(recipe, amounts);
  const groups = recipe.components.map((c, ci) => (c.ingredients.length ? `
    <div class="cook-group" data-ci="${ci}">
      <h3>${esc(c.name)}</h3>
      <ul class="ing-list">
        ${c.ingredients.map((i, ii) => {
          const amount = shown.components[ci].ingredients[ii].amount;
          return `
          <li><label class="ing">
            <input type="checkbox" data-check="${ci}.${ii}" ${checked.has(`${ci}.${ii}`) ? 'checked' : ''}>
            <span class="ing-text"><span class="ing-name">${esc(i.item)}</span></span>
            <span class="ing-amt${i.basis === 'unstated' ? ' unstated' : ''}" data-ci="${ci}" data-ii="${ii}" data-key="${esc(i.key)}" data-basis="${esc(i.basis)}" data-amount="${esc(i.amount ?? '')}"${amount !== i.amount ? ' data-scaled="true"' : ''}>
              <span class="ing-amt-text">${esc(amount ?? 'amount not given')}</span>
            </span>
          </label></li>`;
        }).join('')}
      </ul>
    </div>` : '')).join('');

  dlg.innerHTML = `
    <div class="cook-bar">
      <p class="cook-recipe">${esc(recipe.title)}</p>
      <label class="switch" for="cook-wake-on">
        <input type="checkbox" role="switch" id="cook-wake-on"${wakeWanted ? ' checked' : ''}>
        <span>Keep screen on</span>
      </label>
      <button class="btn btn-quiet icon-btn" type="button" id="cook-close" aria-label="Exit cook mode">${icon('close')}</button>
    </div>
    <p class="cook-note" id="cook-wake" role="status"></p>
    <div class="cook-body">
      <aside class="cook-ings" id="cook-ings" aria-label="Ingredients" data-open="false">${groups || '<p class="muted">No ingredients are listed.</p>'}</aside>
      <section class="cook-stage" aria-label="Current step">
        <div aria-live="polite" aria-atomic="true">
          <p class="cook-where" id="cook-where"></p>
          <p class="cook-text" id="cook-text"></p>
        </div>
        <div class="cook-timers" id="cook-timers"></div>
      </section>
    </div>
    <div class="cook-foot">
      <progress class="cook-progress" id="cook-progress" max="${steps.length}" value="1" aria-label="Steps done"></progress>
      <div class="timer-tray" data-timer-tray></div>
      <p class="sr-only" role="status" data-timer-live></p>
      <div class="cook-tools">
        <button class="btn ing-toggle" type="button" id="cook-ing-toggle" aria-expanded="false" aria-controls="cook-ings">${icon('list')}<span>Ingredients</span></button>
        <button class="btn" type="button" id="cook-watch" hidden></button>
      </div>
      <div class="cook-nav">
        <button class="btn btn-lg" type="button" id="cook-prev">${icon('back')}<span>Back</span></button>
        <button class="btn btn-primary btn-lg" type="button" id="cook-next"></button>
      </div>
    </div>`;
}

function renderStep() {
  const { recipe, steps, index, canWatch } = session;
  const s = steps[index];
  const multi = recipe.components.length > 1;
  $('#cook-where').textContent = `${multi ? `${s.component} · ` : ''}Step ${s.n} of ${s.of}`;
  $('#cook-text').textContent = s.text;

  // The same keys as the recipe page (recipe id, step number across the parts): one timer, shown in both.
  $('#cook-timers').innerHTML = timerChips(`${recipe.id}:${s.n}`, s.text, `Step ${s.n}`);
  paintTimers();

  const watch = $('#cook-watch');
  const can = canWatch && s.t != null;
  watch.hidden = !can;
  if (can) {
    watch.innerHTML = `${icon('play')}<span>Watch step (${mmss(s.t)})</span>`;
    watch.setAttribute('aria-label', `Watch this step in the video, from ${mmss(s.t)}`);
  } else {
    watch.innerHTML = '';
    watch.removeAttribute('aria-label');
  }

  $('#cook-progress').value = s.n;
  $('#cook-prev').setAttribute('aria-disabled', String(index === 0));
  $('#cook-next').innerHTML = index === steps.length - 1
    ? `${icon('check')}<span>Done</span>`
    : `<span>Next step</span>${icon('next')}`;
  $$('.cook-group', dlg).forEach((g) => g.classList.toggle('is-current', Number(g.dataset.ci) === s.componentIndex));
  store.set(`rb:cook:${recipe.id}`, index);
}

function go(delta) {
  if (!session) return;
  const next = clampIndex(session.index + delta, session.steps.length);
  if (next === session.index) return;
  session.index = next;
  toggleIngredients(false); // a new step is shown, not hidden under the ingredient list
  renderStep();
  $('.cook-stage', dlg).scrollTop = 0;
}

function toggleIngredients(open) {
  const pane = $('#cook-ings');
  const on = open ?? pane.dataset.open !== 'true';
  pane.dataset.open = String(on);
  $('#cook-ing-toggle').setAttribute('aria-expanded', String(on));
}

if (dlg) {
  dlg.addEventListener('click', (e) => {
    if (!session) return;
    const b = e.target.closest('button');
    if (!b) return;
    if (b.id === 'cook-close') dlg.close();
    else if (b.id === 'cook-prev') go(-1);
    else if (b.id === 'cook-ing-toggle') toggleIngredients();
    else if (b.id === 'cook-next') {
      if (session.index === session.steps.length - 1) {
        store.remove(`rb:cook:${session.recipe.id}`); // finished: start from the top next time
        dlg.close();
      } else {
        go(1);
      }
    } else if (b.id === 'cook-watch') {
      session.pendingWatch = session.steps[session.index].t;
      dlg.close();
    }
  });

  dlg.addEventListener('change', (e) => {
    if (!session) return;
    if (e.target.id === 'cook-wake-on') {
      setWake(e.target.checked);
      return;
    }
    const key = e.target.dataset?.check;
    if (key == null) return;
    if (e.target.checked) session.checked.add(key);
    else session.checked.delete(key);
    session.onCheck?.(key, e.target.checked);
  });

  dlg.addEventListener('keydown', (e) => {
    if (!session || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === 'ArrowRight' || e.key === 'PageDown') { e.preventDefault(); go(1); }
    if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); go(-1); }
  });

  // Fires for the Exit button, "Done", Escape and route changes alike.
  dlg.addEventListener('close', () => {
    const s = session;
    session = null;
    releaseWake();
    dlg.innerHTML = '';
    if (!s) return;
    emit('cook', { recipe: s.recipe, open: false, root: dlg });
    if (s.returnFocus?.isConnected) s.returnFocus.focus({ preventScroll: true });
    if (s.pendingWatch != null) s.onWatch?.(s.pendingWatch);
  });

  // A wake lock is released whenever the tab is hidden; take it again when the cook comes back.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && session) requestWake();
  });
}

// ---------- keeping the screen on ----------
// The switch in the top bar is the state: on means a wake lock is held. When the browser has no Wake Lock
// API, or refuses the lock, the switch goes off and a line under the bar says why.

function sayWake(text) {
  const note = $('#cook-wake');
  if (note && session) note.textContent = text;
}

/** The reader's choice, remembered for the next time cook mode opens. */
function setWake(on) {
  wakeWanted = on;
  store.set(WAKE_KEY, on);
  if (on) {
    requestWake();
  } else {
    releaseWake();
    sayWake('');
  }
}

async function requestWake() {
  const box = $('#cook-wake-on');
  if (!('wakeLock' in navigator)) {
    if (box) {
      box.checked = false;
      box.disabled = true;
    }
    sayWake("This browser can't keep the screen on. Set a longer screen timeout while you cook.");
    return;
  }
  if (!wakeWanted) return;
  try {
    const lock = await navigator.wakeLock.request('screen');
    if (!session || !wakeWanted) {
      lock.release().catch(() => {});
      return;
    }
    releaseWake();
    wakeLock = lock;
    const current = $('#cook-wake-on');
    if (current) current.checked = true;
    sayWake('');
  } catch {
    const current = $('#cook-wake-on');
    if (current) current.checked = false;
    sayWake("Couldn't keep the screen on. Battery saver may be blocking it.");
  }
}

function releaseWake() {
  wakeLock?.release().catch(() => {});
  wakeLock = null;
}
