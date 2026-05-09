// Prerendered at build time so the Service Worker can cache the resulting
// static HTML and serve it as `navigateFallback` when the user is offline
// and tries to navigate to a route the SW hasn't cached individually.
export const prerender = true;
export const ssr = true;
