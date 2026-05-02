// The /h/ subtree is auth-gated app shell. SSR adds no value here (no SEO,
// no anonymous render path) and burns a server round-trip per request.
// Render client-only — the auth guard in +layout.svelte runs on hydrate.
export const ssr = false;
