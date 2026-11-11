// Page behaviour for every page of the site: navigation, theme, scroll reveals, the reading progress line,
// the sticky action on phones and tablets, copy buttons, then the showcase and the hero on the home page.
// Each part runs on its own, so one failure cannot take the others down. Without this module the page is
// still complete: all content is in the HTML and nothing is hidden until `js-ready` is set below.

import { initShowcase } from './showcase.js';
import { initHero } from './hero-boot.js';

const root = document.documentElement;
const THEME_KEY = 'rb-site-theme';
const THEME_COLOR = { light: '#f8f4ee', dark: '#15120f' };

function initTheme() {
  const button = document.getElementById('theme-toggle');
  const meta = document.querySelector('meta[name="theme-color"]');
  const system = matchMedia('(prefers-color-scheme: dark)');
  const current = () => (root.getAttribute('data-theme') === 'dark' ? 'dark' : 'light');
  const stored = () => {
    try { return localStorage.getItem(THEME_KEY); } catch { return null; }
  };

  function apply(theme) {
    root.setAttribute('data-theme', theme);
    if (meta) meta.setAttribute('content', THEME_COLOR[theme]);
    if (button) button.setAttribute('aria-label', theme === 'dark' ? 'Switch to the light theme' : 'Switch to the dark theme');
    document.dispatchEvent(new CustomEvent('rb:theme', { detail: theme }));
  }

  apply(current());
  button?.addEventListener('click', () => {
    const next = current() === 'dark' ? 'light' : 'dark';
    try { localStorage.setItem(THEME_KEY, next); } catch { /* storage unavailable */ }
    apply(next);
  });
  // Follow the system only while the visitor has not chosen.
  system.addEventListener('change', () => { if (!stored()) apply(system.matches ? 'dark' : 'light'); });
}

function initNav() {
  const button = document.getElementById('nav-toggle');
  const nav = document.getElementById('site-nav');
  if (!button || !nav) return;
  const set = (open) => {
    nav.classList.toggle('is-open', open);
    button.setAttribute('aria-expanded', String(open));
  };
  button.addEventListener('click', () => set(button.getAttribute('aria-expanded') !== 'true'));
  nav.addEventListener('click', (e) => { if (e.target instanceof Element && e.target.closest('a')) set(false); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && button.getAttribute('aria-expanded') === 'true') { set(false); button.focus(); }
  });
  document.addEventListener('click', (e) => {
    if (e.target instanceof Node && !nav.contains(e.target) && !button.contains(e.target)) set(false);
  });
  matchMedia('(min-width: 1024px)').addEventListener('change', () => set(false));
}

function initReveal() {
  const items = [...document.querySelectorAll('.reveal')];
  if (!items.length || !('IntersectionObserver' in window)) return;
  // Mark what is already on screen first, so nothing visible blinks when js-ready turns the effect on.
  for (const item of items) {
    if (item.getBoundingClientRect().top < window.innerHeight) item.classList.add('is-in');
  }
  const watch = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (entry.isIntersecting) { entry.target.classList.add('is-in'); watch.unobserve(entry.target); }
    }
  }, { rootMargin: '0px 0px -8% 0px' });
  for (const item of items) if (!item.classList.contains('is-in')) watch.observe(item);
  root.classList.add('js-ready');
}

function initProgress() {
  const bar = document.getElementById('scroll-progress');
  if (!bar) return;
  let frame = 0;
  const draw = () => {
    frame = 0;
    const max = document.documentElement.scrollHeight - window.innerHeight;
    bar.style.transform = `scaleX(${max > 0 ? Math.min(1, window.scrollY / max).toFixed(4) : 0})`;
  };
  const schedule = () => { if (!frame) frame = requestAnimationFrame(draw); };
  window.addEventListener('scroll', schedule, { passive: true });
  window.addEventListener('resize', schedule);
  draw();
}

// The bar shows once the hero has left the screen and hides while a section that carries the same action
// (or the footer) is on screen, so it never sits on top of its own target.
function initSticky() {
  const bar = document.getElementById('sticky-cta');
  const hero = document.getElementById('hero');
  if (!bar || !hero || !('IntersectionObserver' in window)) return;
  const quiet = [...document.querySelectorAll('[data-sticky-quiet]')];
  const onScreen = new Set();
  let heroVisible = true;
  const sync = () => {
    const on = !heroVisible && onScreen.size === 0;
    bar.classList.toggle('is-on', on);
    bar.toggleAttribute('inert', !on);
  };
  new IntersectionObserver(([entry]) => { heroVisible = entry.isIntersecting; sync(); }).observe(hero);
  const watch = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (entry.isIntersecting) onScreen.add(entry.target); else onScreen.delete(entry.target);
    }
    sync();
  });
  quiet.forEach((section) => watch.observe(section));
  document.body.classList.add('has-sticky');
  sync();
}

function initCopy() {
  for (const button of document.querySelectorAll('[data-copy-from]')) {
    const source = document.getElementById(button.dataset.copyFrom);
    const status = button.parentElement?.querySelector('[data-copy-status]');
    if (!source) continue;
    button.hidden = false;
    button.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(source.textContent.trim());
        if (status) status.textContent = 'Copied.';
      } catch {
        // Clipboard access blocked: select the text so the visitor can copy it by hand.
        const range = document.createRange();
        range.selectNodeContents(source);
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
        if (status) status.textContent = 'Selected. Copy it with your keyboard.';
      }
    });
  }
}

for (const init of [initTheme, initNav, initReveal, initProgress, initSticky, initCopy, initShowcase, initHero]) {
  try {
    init();
  } catch (err) {
    console.error(`Recipe Bank site: ${init.name} failed`, err);
  }
}
