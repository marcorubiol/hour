import type { RequestHandler } from './$types';

/**
 * Liveness probe (Phase 0.9) — "is the Worker executing code at all".
 * No dependencies touched: a green /health/live with a red /health/ready
 * means the Worker is fine and Supabase isn't.
 */
export const GET: RequestHandler = async () => {
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
};
