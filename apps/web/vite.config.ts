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
          // SvelteKit builds with a relative Vite base ('./'), so without this
          // the client registers './sw.js' with scope './': on /h/<space>/…
          // that asks for /h/<space>/sw.js and the Worker logs a 404.
          base: '/',
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
            name: 'hour',
            short_name: 'hour',
            description: 'Gestión de compañías de artes en vivo: todo junto, hora a hora.',
            lang: 'es',
            theme_color: '#f7f5ef',
            // The launch screen: the colour of the page and the boot skeleton.
            background_color: '#f7f5ef',
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
            // A SHORT PRECACHE (19-11). It used to be every js/css/png of the
            // build: 443 files, 7 MB, each fetched with a cache-busting
            // revision, so the install never reused what the page had just
            // downloaded. Measured against production: after 15 s on a fast
            // line the SW was still installing (52 of 443) and controlled
            // nothing; on a phone, every deploy restarted that download
            // alongside the open, which sat on a blank screen. Now only the
            // icons and the manifest are precached; the app's code is cached
            // as it is used (the `_app/immutable` rule below), so the SW
            // installs in a moment and a second open reads its code from the
            // device. Offline still works for what has been opened before.
            //
            // theme-init.js too (19-11): it is the synchronous <script> at the
            // top of app.html's <head>, so the page paints nothing until it
            // arrives. Not precached, every open fetched it from the network
            // (measured 130-718 ms on a slow line) before anything else.
            globPatterns: ['*.{svg,png,webmanifest}', 'theme-init.js'],
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
              // The app's code and styles: hashed names that never change
              // content, so cache-first, kept a month. A deploy brings new
              // names; the old ones age out.
              {
                urlPattern: ({ url, sameOrigin }: { url: URL; sameOrigin: boolean }) =>
                  sameOrigin && url.pathname.startsWith('/_app/immutable/'),
                handler: 'CacheFirst',
                options: {
                  cacheName: 'app-immutable',
                  cacheableResponse: { statuses: [200] },
                  expiration: { maxEntries: 800, maxAgeSeconds: 30 * 24 * 3600, purgeOnQuotaError: true },
                },
              },
              // The app's own shell opens from the device (20-11-2026): `/`
              // (an empty page that forwards to Hoy) and the /h frame
              // (client-rendered, the same for everyone). Network-first made
              // every open wait for a round trip to the Worker, three seconds
              // on a phone whose radio was asleep, before a single pixel. A
              // calendar opens with what it had and catches up: the copy
              // kept is shown and refreshed behind, so a deploy reaches the
              // next open. Only these two: a public page renders its data on
              // the server and stays network-first below.
              {
                urlPattern: ({ request, url }: { request: Request; url: URL }) =>
                  request.mode === 'navigate' && (url.pathname === '/' || url.pathname === '/h' || url.pathname.startsWith('/h/')),
                // Stale-while-revalidate again (20-11, 12:04): network-first
                // cost a blank 3-4 s on every cold open. What broke the first
                // time (11:14: the saved page named code a later deploy had
                // removed) is now covered twice: when the fresh page is
                // saved, its entry code is saved with it (the plugin below),
                // and theme-init.js reloads once if a module still fails.
                handler: 'StaleWhileRevalidate',
                options: {
                  cacheName: 'shell',
                  plugins: [
                    {
                      // The page just saved for the next open: fetch now the
                      // code it starts with, into the cache CacheFirst reads.
                      cacheDidUpdate: async ({ newResponse }: { newResponse: Response }) => {
                        try {
                          const html = await newResponse.clone().text();
                          const urls = Array.from(new Set(html.match(/\/_app\/immutable\/[^"'\s)]+\.(?:js|css)/g) || []));
                          const cache = await caches.open('app-immutable');
                          await Promise.all(
                            urls.map(async (u) => {
                              if (await cache.match(u)) return;
                              const r = await fetch(u);
                              if (r.ok) await cache.put(u, r);
                            }),
                          );
                        } catch {
                          // A miss here only means the next open fetches it.
                        }
                      },
                    },
                  ],
                  cacheableResponse: { statuses: [200] },
                },
              },
              {
                urlPattern: ({ request }: { request: Request }) =>
                  request.mode === 'navigate',
                handler: 'NetworkFirst',
                options: {
                  cacheName: 'pages',
                  // 3 s, not 5 (19-11): on a phone whose radio is slow to
                  // wake, every second here is a blank screen. Past 3 s the
                  // last copy of the page opens and the app catches up.
                  networkTimeoutSeconds: 3,
                },
              },
              // Google's font stylesheet is render-blocking and its HTTP
              // cache lasts a day (`private, max-age=86400`): the first open
              // of each day waited a cross-origin round trip before painting
              // anything. Served from the SW and refreshed behind; the font
              // files themselves are immutable, so they never go back out.
              // Status 0: the stylesheet is a no-cors (opaque) request.
              {
                urlPattern: ({ url }: { url: URL }) => url.origin === 'https://fonts.googleapis.com',
                handler: 'StaleWhileRevalidate',
                options: {
                  cacheName: 'google-fonts-css',
                  cacheableResponse: { statuses: [0, 200] },
                },
              },
              {
                urlPattern: ({ url }: { url: URL }) => url.origin === 'https://fonts.gstatic.com',
                handler: 'CacheFirst',
                options: {
                  cacheName: 'google-fonts',
                  cacheableResponse: { statuses: [0, 200] },
                  expiration: { maxEntries: 40, maxAgeSeconds: 365 * 24 * 3600 },
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
            include: ['src/**/*.{test,spec}.{js,ts}', 'scripts/**/*.test.ts'],
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
            // Hooks do more round trips than a test (two logins, fixtures,
            // grants). At vitest's 10s default, a slow remote (staging, run
            // 38456825114) cut a beforeAll after its grant and the afterAll
            // before its restore, and the next files inherited the grant.
            hookTimeout: 60_000,
          },
        },
      ],
    },
  };
});
