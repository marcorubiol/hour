import { execSync } from 'node:child_process';
import { sentrySvelteKit } from '@sentry/sveltekit';
import { sveltekit } from '@sveltejs/kit/vite';
import { loadEnv } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import { defineConfig } from 'vitest/config';

/**
 * Build stamp — ties a deployment to a commit.
 *
 * `wrangler deploy` uploads the working tree, not a git ref, so nothing
 * otherwise records what is actually running. On 2026-07-14 the scope-v2
 * work went to production uncommitted; for two days git and prod disagreed
 * and the docs confidently described a state that wasn't live. Baking the
 * SHA into the bundle makes "what is in production?" a curl against
 * /health/live instead of an act of faith.
 *
 * The prevention half of this is scripts/assert-clean-tree.mjs, which
 * refuses to deploy a dirty tree. `dirty` here stays honest when someone
 * takes the ALLOW_DIRTY_DEPLOY escape hatch.
 */
function buildStamp() {
  const git = (cmd: string): string => {
    try {
      return execSync(`git ${cmd}`, {
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'ignore'],
      }).trim();
    } catch {
      return '';
    }
  };
  const sha = git('rev-parse --short HEAD');
  return {
    // 'unknown' (not a fake SHA) when git is unavailable — e.g. a build from
    // a tarball. Better a loud gap than a plausible lie.
    sha: sha || 'unknown',
    dirty: git('status --porcelain').length > 0,
    builtAt: new Date().toISOString(),
  };
}

// `sentrySvelteKit` uploads source maps to Sentry on `vite build` so server
// stack traces resolve to original .ts/.svelte. It only runs when both
// SENTRY_AUTH_TOKEN and the org/project env vars are present in `.env` —
// silently skipped otherwise. Skipped under Vitest (`VITEST=true`) to keep
// the test runner free of build-time hooks.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
    // Literal-substituted at build time; read by /health/live. Also defined
    // under Vitest (same config), so tests see a real stamp.
    define: {
      __BUILD_STAMP__: JSON.stringify(buildStamp()),
    },
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
          // SW disabled in `pnpm dev`: an active dev SW precaches the
          // /offline page and serves it stuck whenever the dev server
          // hiccups/restarts (the "You're back online" trap). Test PWA /
          // offline behaviour via `pnpm preview` (runs the real Worker) or
          // production, not vite dev. Cost of disabling: a cosmetic manifest
          // 404 in the dev console — harmless. Prod build is unaffected.
          devOptions: {
            enabled: false,
            type: 'module',
          },
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
            // NO navigateFallback. In generateSW mode Workbox's
            // NavigationRoute serves the fallback for EVERY navigation
            // (precache-first), not just offline ones — with an active SW
            // every hard load of the app answered with the precached
            // /offline page ("You're back online. Reload" trap, hit in
            // production 2026-07-02; dev had already disabled the SW for
            // this exact reason). Navigations instead go NetworkFirst with
            // a runtime page cache: online always reaches the Worker,
            // offline serves the last visited copy of the page — the
            // D-PRE-08 smart-offline behaviour without the trap. /api is
            // never a navigation, so it stays untouched.
            //
            // navigateFallback must be EXPLICITLY null — omitting it makes
            // vite-plugin-pwa inject its SPA default ('index.html', which
            // this server-rendered app doesn't even precache).
            navigateFallback: null,
            runtimeCaching: [
              {
                urlPattern: ({ request }: { request: Request }) =>
                  request.mode === 'navigate',
                handler: 'NetworkFirst',
                options: {
                  cacheName: 'pages',
                  networkTimeoutSeconds: 5,
                },
              },
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
        {
          // RLS regression suite — integration tests that hit the live
          // hour-phase0 Supabase project. Excluded from default `test:unit`
          // run; use `pnpm test:rls` (or `vitest run --project rls`).
          // Reads env vars set by .env.test (sourced by the caller). Tests
          // self-skip when those env vars are missing.
          extends: './vite.config.ts',
          test: {
            name: 'rls',
            environment: 'node',
            include: ['tests/rls/**/*.test.ts'],
            // These integration files intentionally mutate and restore the
            // same fixture identities. Running files concurrently makes one
            // authorization assertion observe another file's temporary role
            // or permission grant, so preserve transaction-like isolation.
            fileParallelism: false,
            // _setup.ts loads .env + .env.test into process.env so tests
            // can read PUBLIC_SUPABASE_* and PW_TEST_* without the caller
            // having to source both files first.
            setupFiles: ['./tests/rls/_setup.ts'],
            // 30s per test — login + a few PostgREST hits over the network.
            testTimeout: 30_000,
          },
        },
      ],
    },
  };
});
