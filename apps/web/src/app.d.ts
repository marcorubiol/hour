/// <reference types="@cloudflare/workers-types" />
/// <reference types="vite-plugin-pwa/client" />

declare global {
  namespace App {
    // interface Error {}
    interface Locals {
      /** Per-request correlation id — set in hooks.server.ts, echoed as the
       * x-request-id response header and in every structured error log. */
      requestId: string;
    }
    // interface PageData {}
    // interface PageState {}
    interface Platform {
      env: Env;
      cf: CfProperties;
      ctx: ExecutionContext;
    }
  }

  /**
   * Cloudflare Worker bindings + public env vars declared in wrangler.jsonc.
   * Mirrors the [vars] + [[r2_buckets]] blocks in wrangler.jsonc.
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
    /**
     * DO namespace hosted in the `hour-collab` Worker (script_name binding).
     * Used by /api/collab/[target_table]/[target_id]/+server.ts to forward
     * authenticated WebSocket upgrades to the per-document RoadsheetCollab
     * Durable Object.
     */
    ROADSHEET_COLLAB: DurableObjectNamespace;
    /**
     * Optional KV namespace backing $lib/server/rate-limit.ts (login,
     * refresh, sentry-tunnel). Absent binding = limiter no-ops, so local
     * dev and pre-KV deploys keep working. See wrangler.jsonc for the
     * activation step.
     */
    RATE_LIMIT?: KVNamespace;
    /**
     * Cloudflare-native burst limiter for password login. The 10/minute
     * native gate composes with RATE_LIMIT's 10/five-minute KV window.
     */
    LOGIN_RATE_LIMIT?: RateLimit;
  }

  /**
   * Build provenance, literal-substituted by vite.config.ts `define` and
   * served by /health/live. Exists because `wrangler deploy` ships the
   * working tree rather than a git ref — see `buildStamp()` in
   * vite.config.ts and scripts/assert-clean-tree.mjs.
   */
  const __BUILD_STAMP__: {
    /** Short commit SHA, or 'unknown' when built outside a git checkout. */
    sha: string;
    /** True when the tree had uncommitted changes at build time. */
    dirty: boolean;
    /** ISO timestamp of the build. */
    builtAt: string;
  };
}

export {};
