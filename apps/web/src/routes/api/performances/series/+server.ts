/**
 * POST /api/performances/series — una función que dura varios días (ADR-084 §1).
 *
 * N filas de `performance`, un `series_id`, UNA sentencia. La atomicidad es
 * toda la razón de que esta ruta exista en vez de que el cliente haga un bucle
 * de POST /api/performances: una tanda a medio crear es indistinguible, más
 * tarde, de una tanda que alguien dejó incompleta a propósito. Calcado de
 * `/api/dates/series`, que lleva meses haciendo esto para las fechas.
 *
 * Monta sobre `create_performance_series` — SECURITY DEFINER, gateada en
 * `has_permission(project, 'edit:performance')`, que vuelve a exigir cada regla
 * pre-comprobada aquí (paridad AI=UI, ADR-078 §7: ningún camino de escritura se
 * salta el contrato).
 */
import type { RequestHandler } from './$types';
import * as v from 'valibot';
import { extractAccessToken } from '$lib/auth';
import { PerformanceSeriesCreateSchema } from '$lib/performance';
import { pgPostRpc, type SupabaseEnv } from '$lib/supabase';
import { pgErrorResponse } from '$lib/server/errors';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

export const POST: RequestHandler = async ({ request, platform, locals }) => {
  if (!platform?.env) return json({ error: 'platform_unavailable' }, 500);
  const env = platform.env as unknown as SupabaseEnv;

  const jwt = extractAccessToken(request);
  if (!jwt) return json({ error: 'missing_authorization' }, 401);

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return json({ error: 'invalid_body' }, 400);
  }
  const parsed = v.safeParse(PerformanceSeriesCreateSchema, raw);
  if (!parsed.success) {
    return json(
      {
        error: 'invalid_body',
        issues: parsed.issues.map((i) => ({
          path: i.path?.map((p) => p.key).join('.'),
          message: i.message,
        })),
      },
      400,
    );
  }
  const input = parsed.output;

  // Un día repetido no es una tanda, es un error de quien llama. Se
  // pre-comprueba para dar un 400 que dice QUÉ pasa; la RPC lo vuelve a
  // exigir, así que saltarse esta ruta no gana nada.
  if (new Set(input.performed_at).size !== input.performed_at.length) {
    return json({ error: 'invalid_body', hint: 'a series cannot repeat a day.' }, 400);
  }

  try {
    const { data } = await pgPostRpc<Record<string, unknown>>(
      env,
      'create_performance_series',
      jwt,
      {
        p_project_id: input.project_id,
        p_performed_at: input.performed_at,
        p_venue_name: input.venue_name ?? null,
        p_city: input.city ?? null,
        p_country: input.country ? input.country.toUpperCase() : null,
        p_status: input.status ?? 'proposed',
        p_conversation_id: input.conversation_id ?? null,
        p_line_id: input.line_id ?? null,
      },
    );
    if (data.length === 0) return json({ error: 'create_failed' }, 502);
    return json({ performances: data }, 201);
  } catch (err) {
    // RAISEs de la RPC: 22023 entrada inválida (pocos/muchos días, día
    // repetido, línea ∉ proyecto) → 400; 42501 junta «proyecto desconocido» y
    // «sin permiso» → 403, para no ser un oráculo de existencia.
    return pgErrorResponse(
      err,
      { route: 'POST /api/performances/series', requestId: locals.requestId },
      {
        codes: {
          '22023': { status: 400, error: 'invalid_input' },
          '42501': { status: 403, error: 'forbidden' },
        },
      },
    );
  }
};
