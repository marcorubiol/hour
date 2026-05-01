import adapter from '@sveltejs/adapter-cloudflare';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
export default {
  preprocess: vitePreprocess(),
  kit: {
    adapter: adapter({
      platformProxy: {
        configPath: 'wrangler.jsonc',
        persist: false,
      },
    }),
    alias: {
      $components: 'src/lib/components',
    },
    // Required by @sentry/sveltekit 10.8+ for proper Workers-runtime tracing.
    // Without these, the Cloudflare init handle can't hook server-side spans.
    experimental: {
      instrumentation: { server: true },
      tracing: { server: true },
    },
  },
};
