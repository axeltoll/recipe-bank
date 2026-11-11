// Decides whether the hero gets its live 3D mark, and moves it with the scroll.
//
// Poster first: the hero always contains an inline SVG poster. The live mark replaces it only when motion is
// allowed, WebGL 2 works and three.js loads. Under prefers-reduced-motion there is no canvas at all.
//
// Desktop (1024 px and up): the stage is a fixed layer behind the section content. It slides from the hero
// to the empty slot beside the "How it works" steps while the video shape turns into the recipe shape, then
// scrolls away with that slot. Phones and tablets: the stage sits inside the hero and scrolls with it (no
// travel, one canvas).

import { stagePose } from './stage-math.js';

export function initHero() {
  const wrap = document.getElementById('hero-slot');
  const area = document.getElementById('hero-stage');
  if (!wrap || !area) return;
  const landing = document.getElementById('how-slot');
  const toggle = document.getElementById('hero-toggle');
  const reduce = matchMedia('(prefers-reduced-motion: reduce)');
  const desktop = matchMedia('(min-width: 1024px)');

  let api = null;
  let stage = null;
  let booting = false;
  let travel = false;
  let home = null;
  let land = null;
  let frame = 0;

  const theme = () => (document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light');

  function docBox(el) {
    const r = el.getBoundingClientRect();
    return {
      cx: r.left + window.scrollX + r.width / 2,
      cy: r.top + window.scrollY + r.height / 2,
      w: r.width,
      h: r.height,
    };
  }

  function measure() {
    home = docBox(area);
    land = desktop.matches && landing && landing.offsetParent !== null ? docBox(landing) : null;
  }

  // Fixed layer on desktop, inside the hero slot otherwise. The canvas follows its container's size.
  function place() {
    if (!stage) return;
    const next = Boolean(land) && home.w > 0 && home.h > 0;
    if (next) {
      if (stage.parentNode !== document.body) document.body.appendChild(stage);
      stage.className = 'stage stage--fixed';
      stage.style.width = `${home.w}px`;
      stage.style.height = `${home.h}px`;
    } else {
      if (stage.parentNode !== area) area.appendChild(stage);
      stage.className = 'stage stage--inflow';
      stage.removeAttribute('style');
    }
    travel = next;
  }

  function update() {
    frame = 0;
    if (!stage || !home) return;
    const pose = stagePose({ scrollY: window.scrollY, home, land, travel });
    if (travel) {
      const x = pose.cx - home.w / 2;
      const y = pose.cy - home.h / 2;
      stage.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) scale(${pose.scale.toFixed(4)})`;
      stage.classList.toggle('is-parked', pose.parked);
    }
    api?.setProgress(pose.t);
  }

  const schedule = () => { if (!frame) frame = requestAnimationFrame(update); };
  const relayout = () => { if (!stage) return; measure(); place(); schedule(); };

  function setToggle(isRecipe) {
    if (!toggle) return;
    toggle.setAttribute('aria-pressed', String(isRecipe));
    toggle.textContent = isRecipe ? 'Show it as a video' : 'Show it as a recipe';
  }

  function teardown() {
    const old = api;
    api = null;
    old?.dispose();
    stage?.remove();
    stage = null;
    wrap.classList.remove('is-live');
    if (toggle) toggle.hidden = true;
  }

  async function boot() {
    if (api || booting || reduce.matches) return;
    booting = true;
    try {
      const mod = await import('./hero.js');
      if (!mod.webgl2Available()) return;
      stage = document.createElement('div');
      stage.setAttribute('aria-hidden', 'true');
      measure();
      place();
      update();
      const mounted = await mod.mountHero(stage, { theme: theme(), onState: setToggle, onLost: teardown });
      if (reduce.matches || !stage) { mounted.dispose(); teardown(); return; }
      api = mounted;
      await api.ready;
      wrap.classList.add('is-live');
      if (toggle) { setToggle(false); toggle.hidden = false; }
      relayout();
    } catch {
      // three.js did not load, or the renderer could not start: keep the poster.
      teardown();
    } finally {
      booting = false;
    }
  }

  window.addEventListener('scroll', schedule, { passive: true });
  window.addEventListener('resize', relayout);
  window.addEventListener('load', relayout);
  desktop.addEventListener('change', relayout);
  reduce.addEventListener('change', () => (reduce.matches ? teardown() : boot()));
  document.addEventListener('rb:theme', () => api?.setTheme(theme()));
  toggle?.addEventListener('click', () => api?.toggle());
  if ('ResizeObserver' in window) {
    const watch = new ResizeObserver(relayout);
    watch.observe(document.body);
    watch.observe(area);
  }

  // Load three.js after the page has painted, so the hero copy and the poster never wait for it.
  const idle = window.requestIdleCallback ?? ((fn) => setTimeout(fn, 200));
  if (document.readyState === 'complete') idle(boot);
  else window.addEventListener('load', () => idle(boot), { once: true });
}
