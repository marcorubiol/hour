/**
 * GET /api/threads/audience?anchor_kind=bolo&anchor_id=…&facet_id=…: quién
 * lee un hilo y por qué (`thread_audience`, ADR-106): la línea «Lo ven N, por
 * permiso de X», que no se pliega nunca (ADR-083, enmienda §6). Vale para un
 * hilo que aún no existe: la audiencia es de la regla, no de la fila.
 *
 * Solo a quien ya lee el hilo, y solo de ese hilo (hallazgo 12): a quien no,
 * 403, igual que a un ancla que no existe.
 */

import type { RequestHandler } from './$types';
import * as v from 'valibot';
import { extractAccessToken } from '$lib/auth';
import { pgPostRpc, type SupabaseEnv } from '$lib/supabase';
import { pgErrorResponse } from '$lib/server/errors';
import { AudienceQuerySchema, type ThreadAudience } from '$lib/threads';
import { json } from '$lib/server/http';

export const GET: RequestHandler = async ({ url, request, platform, locals }) => {
  if (!platform?.env) return json({ error: 'platform_unavailable' }, 500);
  const env = platform.env as unknown as SupabaseEnv;

  const jwt = extractAccessToken(request);
  if (!jwt) return json({ error: 'missing_authorization' }, 401);

  const parsed = v.safeParse(AudienceQuerySchema, Object.fromEntries(url.searchParams));
  if (!parsed.success) return json({ error: 'invalid_query' }, 400);
  const q = parsed.output;

  try {
    const { data } = await pgPostRpc<ThreadAudience>(env, 'thread_audience', jwt, {
      p_anchor_kind: q.anchor_kind,
      p_anchor_id: q.anchor_id,
      p_facet_id: q.facet_id ?? null,
    });
    const audience = data[0];
    if (!audience) return json({ error: 'not_found' }, 404);
    return json(audience);
  } catch (err) {
    return pgErrorResponse(
      err,
      { route: 'GET /api/threads/audience', requestId: locals.requestId },
      { codes: { '42501': { status: 403, error: 'forbidden_or_not_found' } } },
    );
  }
};
