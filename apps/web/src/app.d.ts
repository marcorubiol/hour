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
   * Mirrors the bindings block: R2 bucket MEDIA, static assets ASSETS, and
   * the two PUBLIC_SUPABASE_* vars passed to the runtime.
   */
  interface Env {
    MEDIA: R2Bucket;
    ASSETS: Fetcher;
    PUBLIC_SUPABASE_URL: string;
    PUBLIC_SUPABASE_ANON_KEY: string;
  }
}

export {};
