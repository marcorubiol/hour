import { sentrySvelteKit } from '@sentry/sveltekit';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig, loadEnv } from 'vite';

// `sentrySvelteKit` uploads source maps to Sentry on `vite build` so server
// stack traces resolve to original .ts/.svelte. It only runs when both
// SENTRY_AUTH_TOKEN and the org/project env vars are present in `.env` —
// silently skipped otherwise. Org + project are public-safe (slugs); the
// auth token must stay secret (.env, gitignored).
//
// Note: Vite does NOT auto-populate `process.env` from `.env` files for
// secret vars (only PUBLIC_/VITE_ are inlined into the bundle). To read
// secret vars at config time we use `loadEnv(mode, root, '')` — empty
// prefix returns the full `.env` parse including unprefixed keys.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
    plugins: [
      sentrySvelteKit({
        sourceMapsUploadOptions: {
          org: env.SENTRY_ORG,
          project: env.SENTRY_PROJECT,
          authToken: env.SENTRY_AUTH_TOKEN,
        },
        autoUploadSourceMaps: Boolean(env.SENTRY_AUTH_TOKEN),
      }),
      sveltekit(),
    ],
  };
});
