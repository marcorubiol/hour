import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import adapter from '@sveltejs/adapter-cloudflare';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';
import { loadEnv } from 'vite';

const productionSupabaseUrl = 'https://lqlyorlccnniybezugme.supabase.co';

/**
 * Which Supabase this bundle is allowed to talk to — it feeds the CSP's
 * `connect-src`, so getting it wrong does not warn, it BLOCKS.
 *
 * The subtlety that cost an afternoon: this file is loaded before Vite reads
 * the `.env*` files, so `process.env.PUBLIC_SUPABASE_URL` is empty for anyone
 * whose URL lives in `.env.local` — which is everyone developing against a
 * local Supabase. The CSP was then baked for the PRODUCTION host while the app
 * talked to `127.0.0.1`, and every realtime websocket was refused:
 *
 *   Connecting to 'ws://…/realtime/v1/websocket' violates the following
 *   Content Security Policy directive: "connect-src 'self' https://<prod>"
 *
 * Silently, in the console, forever — presence and collaboration simply dead
 * in local dev. So the files are read here too, the same ones and in the same
 * precedence Vite itself uses (`loadEnv` also folds in matching process.env,
 * which keeps a shell variable winning).
 *
 * NEVER ON A BUILD, and that guard is the important half. `wrangler deploy`
 * runs the build from a developer's machine, where `.env.local` may well point
 * at localhost. Reading it there would bake `connect-src http://127.0.0.1`
 * into a bundle served from production — a page that loads and can reach
 * nothing. A build therefore uses only the real environment, exactly as it did
 * before this change, and no local file can reach a deployed artefact.
 */
const isBuild = process.argv.includes('build');
const fileEnv = isBuild
  ? {}
  : loadEnv(
      process.env.NODE_ENV || 'development',
      dirname(fileURLToPath(import.meta.url)),
      'PUBLIC_',
    );
const supabaseUrl =
  process.env.PUBLIC_SUPABASE_URL ?? fileEnv.PUBLIC_SUPABASE_URL ?? productionSupabaseUrl;
/** http → ws as well as https → wss: a local stack is served over plain http. */
const supabaseWsUrl = supabaseUrl.replace(/^http(s?):/, 'ws$1:');

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
