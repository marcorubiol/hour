import { sentrySvelteKit } from '@sentry/sveltekit';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

// `sentrySvelteKit` uploads source maps to Sentry on `vite build` so server
// stack traces resolve to original .ts/.svelte. It only runs when both
// SENTRY_AUTH_TOKEN and the org/project env vars are present — silently
// skipped otherwise. Org + project are public-safe (slugs); the auth token
// must stay secret (.env, gitignored).
export default defineConfig({
  plugins: [
    sentrySvelteKit({
      sourceMapsUploadOptions: {
        org: process.env.SENTRY_ORG,
        project: process.env.SENTRY_PROJECT,
        authToken: process.env.SENTRY_AUTH_TOKEN,
      },
      autoUploadSourceMaps: Boolean(process.env.SENTRY_AUTH_TOKEN),
    }),
    sveltekit(),
  ],
});
