/// <reference types="@cloudflare/workers-types" />

declare global {
  namespace App {
    // interface Error {}
    // interface Locals {}
    // interface PageData {}
    // interface PageState {}
    interface Platform {
      env: Env;
      cf: CfProperties;
      ctx: ExecutionContext;
    }
  }

  /**
   * Cloudflare Worker bindings + public env vars declared in wrangler.toml.
   * Mirrors the [vars] + [[r2_buckets]] blocks in wrangler.toml.
   *
   * Note: Sentry config (PUBLIC_SENTRY_DSN, PUBLIC_SENTRY_ENV) is NOT here —
   * those are read from `$env/static/public` at build time, baked into the
   * bundle, and not present on `event.platform.env`.
   */
  interface Env {
    MEDIA: R2Bucket;
    ASSETS: Fetcher;
    PUBLIC_SUPABASE_URL: string;
    PUBLIC_SUPABASE_ANON_KEY: string;
  }
}

export {};
