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
    // One style (tarea 132): only the crash test `stress` is set by hand; a
    // style that was removed is not applied, and its key goes.
    var theme = localStorage.getItem('hour_theme');
    if (theme === 'stress') root.setAttribute('data-theme', theme);
    else if (theme) localStorage.removeItem('hour_theme');
    var saved = localStorage.getItem('hour_mode');
    var mode = saved === 'light' || saved === 'dark' ? saved : 'system';
    var dark =
      mode === 'dark' ||
      (mode === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    if (dark) root.setAttribute('data-mode', 'dark');
    // An app open (the home-screen icon lands on `/`, a reload on /h): the
    // boot skeleton shows until the frame has something to draw ($lib/boot).
    var path = location.pathname;
    if (path === '/' || path === '/h' || path.indexOf('/h/') === 0) root.setAttribute('data-boot', '');
  } catch (e) {}
  // The web fonts, without holding the first paint (app.html says why).
  try {
    var fonts = document.createElement('link');
    fonts.rel = 'stylesheet';
    fonts.href =
      'https://fonts.googleapis.com/css2?family=Newsreader:ital,opsz,wght@0,6..72,400..600;1,6..72,400..600&family=Inter:wght@400..600&family=JetBrains+Mono:wght@400;500&display=swap';
    document.head.appendChild(fonts);
  } catch (e) {}
})();

// A stale page reloads itself (20-11-2026, «la aplicación no me abre»).
//
// The service worker serves an app open (`/`, `/h…`) from the page it saved
// last time and fetches the new one behind it (stale-while-revalidate). That
// saved page was fetched in the background, so the code it names was never
// downloaded; after another deploy those hashed files are gone from the
// server and the open stops on the skeleton. When a module of the app fails
// to load, reload once: by then the service worker holds the current page.
// At most once every 30 s, so an offline open does not loop.
(function () {
  var KEY = 'hour_stale_reload';
  function moduleFailed(reason) {
    var m = String((reason && (reason.message || reason)) || '');
    return /dynamically imported module|Importing a module script failed|_app\/immutable/i.test(m);
  }
  function reloadOnce() {
    try {
      var last = Number(sessionStorage.getItem(KEY)) || 0;
      if (Date.now() - last < 30000) return false;
      sessionStorage.setItem(KEY, String(Date.now()));
    } catch (e) {
      return false;
    }
    location.reload();
    return true;
  }
  // Vite's preload helper: a route's code or its CSS failed to load.
  window.addEventListener('vite:preloadError', function (e) {
    if (reloadOnce()) e.preventDefault();
  });
  // The start script's own imports (entry/start, entry/app).
  window.addEventListener('unhandledrejection', function (e) {
    if (moduleFailed(e.reason)) reloadOnce();
  });
})();
