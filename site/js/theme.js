// Runs before first paint (a classic script in <head>): marks the page as scripted and sets the theme, so
// there is no flash of the wrong one. A stored choice wins; otherwise the system preference decides.
(function () {
  var root = document.documentElement;
  root.classList.remove('no-js');
  root.classList.add('js');
  var stored = null;
  try { stored = localStorage.getItem('rb-site-theme'); } catch (e) { /* storage unavailable */ }
  var dark = false;
  try { dark = window.matchMedia('(prefers-color-scheme: dark)').matches; } catch (e) { /* no matchMedia */ }
  root.setAttribute('data-theme', stored === 'light' || stored === 'dark' ? stored : dark ? 'dark' : 'light');
})();
