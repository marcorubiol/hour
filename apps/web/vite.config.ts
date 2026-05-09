import { sentrySvelteKit } from '@sentry/sveltekit';
import { sveltekit } from '@sveltejs/kit/vite';
import { loadEnv } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import { defineConfig } from 'vitest/config';

// `sentrySvelteKit` uploads source maps to Sentry on `vite build` so server
// stack traces resolve to original .ts/.svelte. It only runs when both
// SENTRY_AUTH_TOKEN and the org/project env vars are present in `.env` —
// silently skipped otherwise. Skipped under Vitest (`VITEST=true`) to keep
// the test runner free of build-time hooks.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
    plugins: [
      !process.env.VITEST &&
        sentrySvelteKit({
          sourceMapsUploadOptions: {
            org: env.SENTRY_ORG,
            project: env.SENTRY_PROJECT,
            authToken: env.SENTRY_AUTH_TOKEN,
          },
          autoUploadSourceMaps: Boolean(env.SENTRY_AUTH_TOKEN),
        }),
      sveltekit(),
      // PWA — D-PRE-08 (smart offline) + D-PRE-13 (silent SW updates).
      //
      // `registerType: 'prompt'` is intentional, not the auto-update default:
      // we want the new SW to wait until all tabs close before activating,
      // matching the Windsurf/Chrome update style. Workbox's default
      // (skipWaiting: false) gives us that — `prompt` means the plugin
      // doesn't auto-call skipWaiting either.
      //
      // We register the SW manually from $lib/offline/register so the
      // smoke-test can opt out via navigator.webdriver. Hence
      // `injectRegister: false`.
      //
      // navigateFallbackDenylist keeps the SW out of /api/* and /login —
      // those must always hit the network, especially while we're still
      // shipping JWT-in-localStorage (Phase 0.9 will move to httpOnly
      // cookies and SW handling can be revisited then).
      !process.env.VITEST &&
        VitePWA({
          registerType: 'prompt',
          injectRegister: false,
          manifest: {
            name: 'Hour',
            short_name: 'Hour',
            description: 'Live performing arts management — Phase 0',
            theme_color: '#9d3f70',
            background_color: '#ffffff',
            display: 'standalone',
            start_url: '/',
            scope: '/',
            icons: [
              {
                src: '/icon.svg',
                sizes: 'any',
                type: 'image/svg+xml',
                purpose: 'any',
              },
            ],
          },
          workbox: {
            globPatterns: ['**/*.{js,css,svg,png,webmanifest}'],
            // /offline is a SvelteKit-prerendered page (see
            // src/routes/offline/+page.ts). It's emitted to
            // .svelte-kit/cloudflare/offline.html by adapter-cloudflare —
            // AFTER vite-plugin-pwa has built its precache manifest from
            // .svelte-kit/output/client. So globPatterns can't catch it,
            // and we inject it explicitly here with a build-stamp revision
            // so cache busts when the page changes.
            additionalManifestEntries: [
              { url: '/offline', revision: String(Date.now()) },
            ],
            navigateFallback: '/offline',
            navigateFallbackDenylist: [
              /^\/api\//,
              /^\/login/,
              /^\/dev\//,
              /^\/sw\.js$/,
            ],
          },
        }),
    ].filter(Boolean),
    test: {
      projects: [
        {
          extends: './vite.config.ts',
          // jsdom runs in Node, so vite would resolve packages via SSR exports
          // by default — that ships svelte's index-server.js where mount() is
          // unavailable. Forcing the `browser` condition picks the client
          // entrypoint, the one @testing-library/svelte's render() needs.
          resolve: { conditions: ['browser'] },
          test: {
            name: 'client',
            environment: 'jsdom',
            clearMocks: true,
            include: ['src/**/*.svelte.{test,spec}.{js,ts}'],
            exclude: ['src/lib/server/**'],
            setupFiles: ['./vitest-setup-client.ts'],
          },
        },
        {
          extends: './vite.config.ts',
          test: {
            name: 'server',
            environment: 'node',
            include: ['src/**/*.{test,spec}.{js,ts}'],
            exclude: ['src/**/*.svelte.{test,spec}.{js,ts}'],
          },
        },
      ],
    },
  };
});
