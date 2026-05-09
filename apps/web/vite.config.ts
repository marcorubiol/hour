import { sentrySvelteKit } from '@sentry/sveltekit';
import { sveltekit } from '@sveltejs/kit/vite';
import { loadEnv } from 'vite';
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
