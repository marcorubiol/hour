import adapter from '@sveltejs/adapter-cloudflare';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

const productionSupabaseUrl = 'https://lqlyorlccnniybezugme.supabase.co';
const supabaseUrl = process.env.PUBLIC_SUPABASE_URL ?? productionSupabaseUrl;
const supabaseWsUrl = supabaseUrl.replace(/^https:/, 'wss:');

/** @type {import('@sveltejs/kit').Config} */
export default {
  preprocess: vitePreprocess(),
  kit: {
    adapter: adapter({
      platformProxy: {
        configPath: process.env.HOUR_WRANGLER_CONFIG_PATH ?? 'wrangler.jsonc',
        persist: false,
      },
    }),
    alias: {
      $components: 'src/lib/components',
    },
    /**
     * CSP (Phase 0.9 hardening gate). mode 'auto': per-request nonces on
     * SSR responses, hashes + <meta> on the prerendered /offline page.
     * SvelteKit nonces its own inline hydration script; the hand-written
     * theme script in app.html carries an explicit %sveltekit.nonce%.
     *
     * Origin notes:
     *  - Supabase project host (https + wss): browser-direct Realtime and
     *    the has_permission RPC. Derived from PUBLIC_SUPABASE_URL so local,
     *    staging and production builds get the matching CSP origin.
     *  - Sentry needs NO origin here: envelopes tunnel same-origin through
     *    /api/sentry-tunnel. If the tunnel is ever dropped, add the ingest
     *    host to connect-src.
     *  - style-src keeps 'unsafe-inline' (Svelte transitions inject inline
     *    <style>; SvelteKit skips style nonces when unsafe-inline is
     *    present). The XSS win that matters is nonced script-src.
     *  - worker-src blob: is required by Sentry Replay's compression
     *    worker; 'self' covers the PWA service worker.
     */
    csp: {
      mode: 'auto',
      directives: {
        'default-src': ['self'],
        'script-src': ['self'],
        'style-src': ['self', 'unsafe-inline', 'https://fonts.googleapis.com'],
        'font-src': ['self', 'https://fonts.gstatic.com'],
        'connect-src': [
          'self',
          supabaseUrl,
          supabaseWsUrl,
        ],
        'img-src': ['self', 'data:'],
        'worker-src': ['self', 'blob:'],
        'manifest-src': ['self'],
        'object-src': ['none'],
        'base-uri': ['self'],
        'frame-ancestors': ['none'],
        'form-action': ['self'],
      },
    },
    // Required by @sentry/sveltekit 10.8+ for proper Workers-runtime tracing.
    // Without these, the Cloudflare init handle can't hook server-side spans.
    experimental: {
      instrumentation: { server: true },
      tracing: { server: true },
    },
  },
};
