/**
 * Central PostgREST error boundary (Phase 0.9 hardening gate).
 *
 * Before this existed, 30 endpoints reflected `err.body` — PostgREST's
 * structured error JSON with constraint names, RAISE messages, schema
 * details and (for 23505) the conflicting key values — straight to the
 * browser as `detail`. The full detail now goes to the server log (JSON,
 * correlated by request id, picked up by Workers observability + Sentry);
 * the client gets stable machine codes and nothing else.
 *
 * Lives in $lib/server so SvelteKit enforces it can never reach a client
 * bundle.
 *
 * Per-endpoint semantics survive via `codes`: each call site maps the
 * Postgres error codes it used to special-case (22023 → invalid_input,
 * 42501 → forbidden/not_found, 23505 → conflict, …) to the same public
 * status + error it returned before — minus the leaked detail.
 */

import { PostgrestError } from '$lib/supabase';

export interface PgErrorMapEntry {
  status: number;
  error: string;
  /** Optional human hint, shown in client toasts. Must be a stable string
   * written here — never derived from the upstream error body. */
  hint?: string;
}

export interface PgErrorContext {
  /** Route + method for the log line, e.g. 'POST /api/venues'. */
  route: string;
  requestId?: string | null;
}

export interface PgErrorOptions {
  codes?: Record<string, PgErrorMapEntry>;
  /** Upstream PostgREST statuses passed through verbatim (default [401] —
   * an expired/invalid JWT must surface as 401 so the client refreshes). */
  passUpstream?: number[];
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

export function pgErrorResponse(
  err: unknown,
  ctx: PgErrorContext,
  opts: PgErrorOptions = {},
): Response {
  if (err instanceof PostgrestError) {
    const code = err.code;
    console.error(
      JSON.stringify({
        level: 'error',
        kind: 'postgrest',
        route: ctx.route,
        request_id: ctx.requestId ?? null,
        upstream_status: err.status,
        code,
        body: err.body.slice(0, 500),
      }),
    );
    const mapped = code ? opts.codes?.[code] : undefined;
    if (mapped) {
      return json(
        { error: mapped.error, ...(mapped.hint ? { hint: mapped.hint } : {}) },
        mapped.status,
      );
    }
    const pass = opts.passUpstream ?? [401];
    const status = pass.includes(err.status) ? err.status : 502;
    return json({ error: 'postgrest_error', status: err.status }, status);
  }

  console.error(
    JSON.stringify({
      level: 'error',
      kind: 'unexpected',
      route: ctx.route,
      request_id: ctx.requestId ?? null,
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack?.slice(0, 1000) : undefined,
    }),
  );
  return json({ error: 'unexpected' }, 500);
}
