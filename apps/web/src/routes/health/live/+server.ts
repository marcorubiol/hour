import type { RequestHandler } from './$types';

/**
 * Liveness probe (Phase 0.9) — "is the Worker executing code at all".
 * No dependencies touched: a green /health/live with a red /health/ready
 * means the Worker is fine and Supabase isn't.
 *
 * Also answers "WHICH build is alive". `wrangler deploy` ships the working
 * tree, not a git ref, so without this the only record of what is in
 * production is whatever a human remembered to write down — and on
 * 2026-07-14 that record was wrong for two days. `version` makes the
 * question a curl. A `dirty: true` reply means the build came from an
 * uncommitted tree (ALLOW_DIRTY_DEPLOY) and the SHA alone won't reproduce
 * it. See scripts/assert-clean-tree.mjs.
 *
 * The SHA is safe to expose: it's an opaque hash of a private repo, it
 * grants nothing, and the cost of NOT being able to ask production what it
 * runs is the drift this fixes.
 */
export const GET: RequestHandler = async () => {
  return new Response(JSON.stringify({ ok: true, version: __BUILD_STAMP__ }), {
    status: 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
};
