import type { RequestHandler } from './$types';
import type { SupabaseEnv } from '$lib/supabase';

/**
 * Readiness probe (Phase 0.9) — "can this Worker serve real traffic".
 * Checks the one hard dependency: Supabase (Auth health endpoint — cheap,
 * unauthenticated, same infrastructure as PostgREST). 503 tells an uptime
 * monitor the app is degraded even though the Worker itself is alive.
 */
export const GET: RequestHandler = async ({ platform }) => {
  const json = (body: unknown, status: number) =>
    new Response(JSON.stringify(body), {
      status,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
      },
    });

  if (!platform?.env) return json({ ok: false, checks: { platform: 'unavailable' } }, 503);
  const env = platform.env as unknown as SupabaseEnv;

  try {
    const res = await fetch(`${env.PUBLIC_SUPABASE_URL}/auth/v1/health`, {
      headers: { apikey: env.PUBLIC_SUPABASE_ANON_KEY },
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return json({ ok: false, checks: { supabase: `status_${res.status}` } }, 503);
    return json({ ok: true, checks: { supabase: 'ok' } }, 200);
  } catch {
    return json({ ok: false, checks: { supabase: 'unreachable' } }, 503);
  }
};
