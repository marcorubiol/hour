// Apply theme + mode BEFORE first paint to avoid FOIC.
//
// Served as a static file (script-src 'self' covers it) rather than inline:
// kit.csp does NOT scan the app.html template for inline scripts, so an
// inline block would be refused under our nonce/hash CSP on SSR pages. A
// static synchronous <script src> runs before the body paints just like the
// inline version did, with no CSP hash to keep in sync.
//
// Mirrors $lib/theme.svelte.ts. Two axes: data-theme (palette/fonts) +
// data-mode (light/dark). Mode: 'light' | 'dark' | 'system'. 'system' (or no
// saved value) follows prefers-color-scheme live; explicit light/dark wins.
(function () {
  try {
    var root = document.documentElement;
    var theme = localStorage.getItem('hour_theme') || 'editorial-sobrio';
    if (theme !== 'editorial-sobrio') root.setAttribute('data-theme', theme);
    var saved = localStorage.getItem('hour_mode');
    var mode = saved === 'light' || saved === 'dark' ? saved : 'system';
    var dark =
      mode === 'dark' ||
      (mode === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    if (dark) root.setAttribute('data-mode', 'dark');
  } catch (e) {}
})();
